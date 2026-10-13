// Uses Kerf in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// Opens the example project, a link and a project file from the kerf-planner skill, works through cuts
// at the saw, and checks it all on a phone with nothing loaded from elsewhere, then once more offline.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // A page on the same address that isn't Kerf, for putting things in storage before Kerf starts.
  if (path === '/blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

// The Mudroom bench from the kerf-planner skill (skill/kerf-planner/references/kerf-format.md), as make_kerf.py writes it.
const MUDROOM = { kerf: 1, project: {
  name: 'Mudroom bench', units: 'in', kerf: 0.125, trim: 0, keep: 12, cur: '$',
  materials: [
    { kind: 'board', name: '2×4', note: '1½ × 3½ in',
      stock: [{ len: 96, price: 4.28, have: 0 }, { len: 120, price: 6.38, have: 0 }, { len: 30, price: 0, have: 1 }],
      parts: [{ name: 'Leg', qty: 4, len: 16.5 }, { name: 'Long rail', qty: 4, len: 41 }] },
    { kind: 'sheet', name: '¾ plywood', note: '23/32 in actual',
      stock: [{ len: 96, wid: 48, price: 58, have: 0 }],
      parts: [{ name: 'Seat', qty: 1, len: 48, wid: 16, grain: true }] },
  ] } };
// A link the way make_kerf.py makes one: the project, deflated, in base64url after #k1z.
const linkTo = doc => '#k1z' + deflateRawSync(Buffer.from(JSON.stringify(doc))).toString('base64url');

// Projects as Kerf stores them.
let ids = 0;
const id = () => 'e2e' + ids++;
const project = (name, materials, extra = {}) => ({ id: id(), name, units: 'in', kerf: 0.125, trim: 0, keep: 12, cur: '$', updated: Date.now(), materials, done: {}, ...extra });
const board = (name, stock, parts) => ({ id: id(), kind: 'board', name, note: '', stock: stock.map(s => ({ id: id(), price: 0, have: 0, ...s })), parts: parts.map(p => ({ id: id(), ...p })) });
const sheet = (name, stock, parts) => ({ id: id(), kind: 'sheet', name, note: '', stock: stock.map(s => ({ id: id(), price: 0, have: 0, ...s })), parts: parts.map(p => ({ id: id(), grain: true, ...p })) });
const saved = (...projects) => ({ projects: Object.fromEntries(projects.map(p => [p.id, p])), order: projects.map(p => p.id), current: projects[0].id, tab: 'plan', rtab: 'plan' });

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
// A request cut short because the test moved on to another page isn't a problem; any other failure is (a missing file logs an error too).
page.on('requestfailed', r => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') problems.push('failed: ' + r.url()); });
page.on('request', r => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('blob:')) problems.push('left the site: ' + u); });

// Opens Kerf as a fresh page load, with `db` in storage (null for a first visit) and `hash` after the address.
// Going by about:blank makes a link a real page load rather than a jump within the page.
async function open(db, hash = '') {
  await page.goto(base + 'blank');
  await page.evaluate(d => { localStorage.clear(); if (d) localStorage.setItem('kerf.v1', JSON.stringify(d)); }, db);
  await page.goto('about:blank');
  await page.goto(base + hash);
  await page.waitForSelector('#planOut > *', { state: 'attached' });
}
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('kerf.v1')));
const view = t => page.click(`#tabs button[data-t="${t}"]`);
const fitsPhone = async what => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `the ${what} scrolls sideways on a phone`);
const cutsFact = () => page.evaluate(() => [...document.querySelectorAll('.fact')].map(f => f.textContent).filter(t => /cut/.test(t))[0]);
const sawSteps = () => page.$$eval('#sawOut .cut[data-k]', els => els.map(e => e.querySelector('small').textContent));
// Saves the shop PDF and returns it as text (its streams aren't compressed).
async function shopPdf() {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#pdfBtn')]);
  return (await readFile(await dl.path())).toString('latin1');
}
const pdfKerfLines = pdf => (pdf.match(/0\.14 0\.38 0\.8 RG 1 w [\d. ]+ m [\d. ]+ l S/g) || []).length; // solid blue: a board's saw cuts
// The PDF's lines of text, and how wide each is in Helvetica (the widths Kerf's own table uses, by character code).
const pdfRuns = pdf => [...pdf.matchAll(/BT \/(F1|F2) ([\d.]+) Tf [\d. ]+ rg ([\d.-]+) ([\d.-]+) Td \(((?:\\.|[^\\)])*)\) Tj ET/g)]
  .map(m => ({ bold: m[1] === 'F1', size: +m[2], x: +m[3], y: +m[4], text: m[5].replace(/\\(.)/g, '$1') }));
const kerfSource = await readFile(join(root, 'index.html'), 'utf8');
const HELVETICA = { true: kerfSource.match(/HB: '([\d,]+)'/)[1].split(',').map(Number), false: kerfSource.match(/\bH: '([\d,]+)'/)[1].split(',').map(Number) };
const pdfWidth = r => [...r.text].reduce((w, ch) => { const c = ch.charCodeAt(0); return w + (c >= 32 && c <= 126 ? HELVETICA[r.bold][c - 32] : { 128: 556, 133: 1000, 151: 1000, 215: 584, 183: 278 }[c] || 1000); }, 0) * r.size / 1000;

// A first visit opens the example: the legs, rails and shelves cost $100.64.
await open(null);
await page.evaluate(() => document.fonts.ready);
assert.equal(await page.textContent('.total'), '$100.64');
assert.match(await page.textContent('.facts'), /8\s*boards\s*1\s*sheet\s*27\s*cuts/);
await fitsPhone('plan');
await view('list');
await fitsPhone('cut list');
await view('saw');
await fitsPhone('saw checklist');

// Ticks at the saw are kept: three cuts done, a reload, and they're still done.
const cuts = page.locator('#sawOut .cut[data-k]');
for (let i = 0; i < 3; i++) await cuts.nth(i).click();
assert.equal(await page.textContent('.saw-bar b'), '3 / 27');
await page.waitForTimeout(600);
await page.reload();
await page.waitForSelector('#sawOut .cut[data-k]');
assert.equal(await page.textContent('.saw-bar b'), '3 / 27', 'ticks survive a reload');
assert.equal(await cuts.nth(2).getAttribute('aria-checked'), 'true');

// A link from the kerf-planner skill shows what's in it and comes in as a new project once you say so.
await open(null, linkTo(MUDROOM));
await page.waitForSelector('#lkAdd');
assert.match(await page.textContent('#sheet .lk'), /Mudroom bench\s*2×4 — 8 parts\s*¾ plywood — 1 part/);
assert.equal(await page.evaluate(() => location.hash), '', 'the project leaves the address bar');
await page.click('#lkAdd');
assert.equal(await page.inputValue('#pname'), 'Mudroom bench');
assert.equal(await page.textContent('.total'), '$70.76');
assert.deepEqual(Object.values((await stored()).projects).map(p => p.name).sort(), ['Garage shelves (example)', 'Mudroom bench']);

// The same plan saved as a .kerf.json file opens from Projects.
const file = { kerf: 1, project: { ...MUDROOM.project, name: 'Garage bench' } };
await page.click('#projBtn');
await page.setInputFiles('#pjFile', { name: 'garage-bench.kerf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file, null, 1)) });
await page.waitForFunction(() => document.getElementById('pname').value === 'Garage bench');
assert.ok(await page.isHidden('#sheet'), 'Projects closes once the file is open');
assert.equal(await page.textContent('.total'), '$70.76');
assert.equal((await stored()).order.length, 3);

// A broken link says so instead of failing quietly, and a good link after it in the same tab still opens.
for (const bad of ['#k1zABCDE', '#project=%E0%A4%A', '#project={"name":"50% off bench"}']) {
  await open(null, bad);
  await page.waitForFunction(() => document.getElementById('toast').classList.contains('show'), null, { timeout: 3000 }).catch(() => {});
  assert.equal(await page.textContent('#toast'), 'That link doesn’t hold a Kerf project', bad + ' says nothing');
}
await page.evaluate(hash => { location.hash = hash; }, linkTo(MUDROOM));
await page.waitForSelector('#lkAdd', { timeout: 5000 });
await page.click('#lkx');

// Opening Kerf writes nothing until something really changes. A first visit that only looks around leaves
// storage empty, so carry.js can still bring projects over from junkdrawer.works/kerf/ on a later visit.
await open(null);
for (const t of ['list', 'saw', 'plan']) await view(t);
await page.waitForTimeout(600);
assert.equal(await page.evaluate(() => localStorage.getItem('kerf.v1')), null, 'opening Kerf and looking around saved the example');
await page.fill('#pname', 'My shelves');
await page.waitForFunction(() => /My shelves/.test(localStorage.getItem('kerf.v1')), null, { timeout: 3000 });
// A project already here isn't written back just by opening it.
{
  const p = project('Opened', [board('2×4', [{ len: 96, price: 4.28 }], [{ name: 'Leg', qty: 2, len: 30 }])]);
  await open(saved(p));
  await page.waitForTimeout(600);
  assert.equal('doneKey' in (await stored()).projects[p.id], false, 'opening a project saved it');
}

// Saving waits a moment for typing to stop, but an edit made just before the page closes is still kept.
{
  const p = project('Quick', [board('2×4', [{ len: 96, price: 4.28 }], [{ name: 'Leg', qty: 2, len: 30 }])]);
  await open(saved(p));
  await page.evaluate(() => { const i = document.getElementById('pname'); i.value = 'Renamed just now'; i.dispatchEvent(new Event('input', { bubbles: true })); location.reload(); }).catch(() => {});
  await page.waitForLoadState('load');
  await page.waitForSelector('#planOut > *', { state: 'attached' });
  assert.equal(await page.inputValue('#pname'), 'Renamed just now', 'an edit right before a reload was lost');
  // Leaving with nothing waiting to save writes nothing, so a first visit still leaves storage empty.
  await open(null);
  await page.reload();
  await page.waitForSelector('#planOut > *', { state: 'attached' });
  assert.equal(await page.evaluate(() => localStorage.getItem('kerf.v1')), null, 'leaving the page saved the example');
}

// The Source menu offers every count on hand from 1 to 10, the range a planner link can carry.
await open(saved(project('Offcuts', [board('2×4', [{ len: 96, price: 4.28 }, { len: 40, have: 7 }], [{ name: 'Leg', qty: 2, len: 30 }])])));
await view('list');
await page.click('details.stock summary');
const source = page.locator('.srow[data-sid] select').nth(1);
assert.equal(await source.inputValue(), '7', 'seven on hand shows as Buy');
assert.deepEqual(await source.locator('option').evaluateAll(os => os.map(o => o.value)), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);

// Secondary buttons line up with their headings and neighbours; only the plan's sections are spaced apart.
await page.click('#projBtn');
assert.deepEqual(await page.$$eval('#sheet .btn', bs => [...new Set(bs.map(b => getComputedStyle(b).marginTop))]), ['0px'], 'buttons in Projects');
await page.click('#pjx');
assert.equal(await page.$eval('#planOut div.sec', d => getComputedStyle(d).marginTop), '22px');

// A board you already have is labelled "yours" inside its drawing, not cut off past the edge.
await open(saved(project('Yours', [board('2×4', [{ len: 96, price: 4.28 }, { len: 96, have: 1 }], [{ name: 'Leg', qty: 3, len: 72 }])])));
assert.ok(await page.evaluate(() => {
  const svg = document.querySelector('#planOut svg.diag'), yours = [...svg.querySelectorAll('text')].find(t => t.textContent === 'yours');
  return yours.getBoundingClientRect().right <= svg.getBoundingClientRect().right + 0.5;
}), '"yours" runs past the drawing');

// The shop PDF keeps everything on the page: a long project name stops short of the total, a board's parts and the
// legend wrap onto more lines instead of running off (and losing parts), and an emoji is left out, not printed as "??".
{
  const name = 'Workshop wall cabinet with sliding doors, French cleats and a tool shelf';
  const parts = [['Stile, left and right', 2, 30], ['Top rail with a groove', 1, 22.5], ['Bottom rail with a groove', 1, 22.5], ['Shelf cleat, short', 4, 9.75], ['Shelf cleat, long', 2, 21.25],
    ['French cleat for the wall', 1, 24], ['French cleat for the cabinet', 1, 24], ['Door stop block', 4, 3.5], ['Drawer runner 🪵', 2, 18], ['Back slat, tongue and groove', 3, 30]];
  await open(saved(project(name, [board('1×4 board', [{ len: 96, price: 5.48 }], parts.map(([name, qty, len]) => ({ name, qty, len })))], { cur: '€' })));
  const runs = pdfRuns(await shopPdf()), total = await page.textContent('.total');
  const title = runs.find(r => r.bold && r.size === 16), sum = runs.find(r => r.bold && r.size === 22);
  assert.equal(sum.text, total.replace('€', '\x80'), 'the total, with the euro sign in the PDF\'s own encoding');
  assert.ok(title.x + pdfWidth(title) < sum.x - 6, 'the project name runs under the total');
  for (const r of runs) assert.ok(r.x + pdfWidth(r) <= 612 - 40 + 0.5, `"${r.text}" runs past the right margin`);
  assert.ok(!runs.some(r => r.text.includes('?')), 'something printed as "?"');
  const all = runs.map(r => r.text).join(' ');
  for (const [i, [name, qty]] of parts.entries()) assert.ok(all.includes(`${'ABCDEFGHIJ'[i]} ${name.replace(' 🪵', '')} `) && all.includes(`×${qty}`), `part ${'ABCDEFGHIJ'[i]} is missing from the legend`);
}

// Dialogs take the keyboard: focus moves in, they're named by their heading, Tab doesn't wander to the page behind,
// and closing one puts focus back on the button that opened it.
await page.focus('#setBtn');
await page.keyboard.press('Enter');
assert.ok(await page.evaluate(() => document.getElementById('sheet').contains(document.activeElement)), 'focus stays behind the Settings dialog');
assert.equal(await page.evaluate(() => { const d = document.querySelector('#sheet [role=dialog]'); return document.getElementById(d.getAttribute('aria-labelledby')).textContent; }), 'Settings for this project');
for (let i = 0; i < 9; i++) {
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => !document.getElementById('app').contains(document.activeElement) && !document.querySelector('.jd-foot').contains(document.activeElement)), 'Tab reached the page behind the dialog');
}
await page.keyboard.press('Escape');
assert.equal(await page.evaluate(() => document.activeElement.id), 'setBtn', 'focus is lost when the dialog closes');

// On a phone the top bar's buttons show only their icons, but each still has a name.
for (const name of ['Projects', 'Shop PDF', 'Settings']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 1, `no button named ${name} on a phone`);

// Ticking a cut from the keyboard keeps focus on that cut, and Start over moves it to the first one.
await view('saw');
await page.locator('#sawOut .cut[data-k]').nth(1).focus();
await page.keyboard.press('Space');
assert.deepEqual(await page.evaluate(() => [document.activeElement.dataset.k, document.activeElement.getAttribute('aria-checked')]), ['0.1', 'true'], 'focus left the cut just ticked');
await page.focus('#sawReset');
await page.keyboard.press('Enter');
assert.equal(await page.evaluate(() => document.activeElement.dataset.k), '0.0', 'focus after Start over');
assert.match(await page.textContent('.saw-bar b'), /^0 \//);

// A tip does what it says even when it's tapped while Kerf is still looking for new tips after an edit (a slow
// sheet job keeps it looking for a while). Side by side on a wide screen, so the edit and the tap are quick.
{
  await page.setViewportSize({ width: 1280, height: 800 });
  const cabinet = sheet('¾ plywood', [{ len: 96, wid: 48, price: 58 }, { len: 48, wid: 48, price: 34 }, { len: 48, wid: 24, price: 21 }], [
    { name: 'Side', qty: 4, len: 34.5, wid: 23.25 }, { name: 'Top & bottom', qty: 2, len: 30, wid: 23.25 }, { name: 'Stretcher', qty: 4, len: 30, wid: 4, grain: false },
    { name: 'Shelf', qty: 6, len: 28.5, wid: 11.25 }, { name: 'Door', qty: 2, len: 33, wid: 15.75 }, { name: 'Drawer side', qty: 8, len: 15, wid: 6, grain: false }]);
  const studs = board('2×4', [{ len: 96, price: 4.28 }, { len: 120, price: 6.38 }, { len: 144, price: 7.68 }, { len: 192, price: 10.98 }],
    [{ name: 'Leg', qty: 4, len: 72 }, { name: 'Front & back rail', qty: 8, len: 48 }, { name: 'Side rail', qty: 8, len: 21 }]);
  await open(saved(project('Tips', [cabinet, studs])));
  await page.waitForSelector('[data-tip]', { timeout: 30000 });
  assert.equal(await page.textContent('[data-tip]'), 'Use 47 15/16"');
  await page.evaluate(() => { window.redrawn = new Promise(done => new MutationObserver((m, o) => { o.disconnect(); done(); }).observe(document.getElementById('planOut'), { childList: true })); });
  await page.fill('.prow[data-pid] input[data-f="pname"] >> nth=0', 'Side panel');
  await page.evaluate(() => window.redrawn);
  await page.waitForTimeout(150);
  await page.click('[data-tip]');
  await page.waitForFunction(() => [...document.querySelectorAll('.prow[data-pid]')].some(r => r.querySelector('[data-f="pname"]').value === 'Front & back rail' && r.querySelector('[data-f="len"]').value === '47 15/16"'), null, { timeout: 3000 })
    .catch(() => assert.fail('a tip tapped while tips were being checked did nothing'));
  await page.setViewportSize({ width: 390, height: 844 });
}

// Deleting takes two separate taps: a double tap only asks.
{
  const keep = project('Keep me', [board('2×4', [{ len: 96, price: 4.28 }], [{ name: 'Leg', qty: 2, len: 30 }])]);
  const other = project('Other', [board('2×4', [{ len: 96, price: 4.28 }], [{ name: 'Leg', qty: 2, len: 30 }]), board('1×4 board', [{ len: 96, price: 5.48 }], [{ name: 'Slat', qty: 2, len: 30 }])]);
  await open(saved(keep, other));
  await view('list');
  await page.dblclick('[data-a="delmat"] >> nth=0');
  assert.equal(await page.locator('#mats .mat').count(), 1, 'a double tap removed a material');
  await page.click('#projBtn');
  await page.dblclick('#sheet .btn.danger');
  assert.equal(await page.locator('#sheet .pitem').count(), 2, 'a double tap deleted the project');
  await page.waitForTimeout(600);
  await page.click('#sheet .btn.danger');
  assert.deepEqual((await stored()).order, [other.id], 'a second tap a moment later deletes it');
}

// A price typed with a decimal comma means what it says, and a thousands comma still reads as one.
await open(saved(project('Komma', [board('45×90', [{ len: 2400 / 25.4, price: 6.5 }], [{ name: 'Bein', qty: 2, len: 700 / 25.4 }])], { units: 'mm', cur: '€' })));
await view('list');
await page.click('details.stock summary');
for (const [typed, shown] of [['4,28', '€4.28'], ['1.234,50', '€1234.50'], ['1,234', '€1234.00'], ['6.90', '€6.90']]) {
  await page.fill('.srow[data-sid] input[data-f="price"]', typed);
  assert.match(await page.textContent('details.stock .chips'), new RegExp(shown.replace('.', '\\.')), `a price typed as ${typed}`);
}

// The plan says why parts are left out: too big for any size listed, or more than the stock on hand can hold.
await open(saved(project('Left out', [board('2×4', [{ len: 96, price: 4.28 }], [{ name: 'Leg', qty: 4, len: 72 }]),
  sheet('¾ plywood', [{ len: 96, wid: 48, have: 1 }], [{ name: 'Shelf', qty: 3, len: 90, wid: 40 }]),
  board('4×4', [{ len: 96, price: 11.98 }], [{ name: 'Post', qty: 1, len: 120 }])])));
assert.equal(await page.textContent('#planOut .warn'), 'Some parts are left out. ¾ plywood: these parts don’t fit together on any stock listed; 4×4 has 1 part too big for any size listed — see the cut list.');

// An empty plan points to the cut list (a phone has no left side), and when every part is left out it says why.
await open(saved(project('Nothing yet', [])));
assert.match(await page.textContent('#planOut .empty'), /^Nothing to cut yet\.Add a material in the cut list, then the parts you need from it/);
await open(saved(project('Too long', [board('2×4', [{ len: 96, price: 4.28 }], [{ name: 'Beam', qty: 1, len: 120 }])])));
assert.equal(await page.textContent('#planOut'), 'Some parts are left out. 2×4 has 1 part too big for any size listed — see the cut list.');
await open(saved(project('Short of legs', [board('Other board', [{ len: 96, have: 2 }], [{ name: 'Leg', qty: 3, len: 72 }])])));
assert.equal(await page.textContent('#planOut'), 'Some parts are left out. Other board: these parts don’t fit together on any stock listed — see the cut list.');

// A sheet's outline goes under its cut lines and numbers, not through them, on screen and in the PDF.
await open(null);
assert.ok(await page.evaluate(() => {
  const svg = [...document.querySelectorAll('#planOut svg.diag')].find(d => d.querySelector('.dg-num')), els = [...svg.children];
  return els.indexOf(svg.querySelector('rect.dg-pedge')) < els.indexOf(svg.querySelector('.dg-cut'));
}), 'the sheet outline is drawn over its cut numbers');
{
  const pdf = await shopPdf(), outline = pdf.search(/0\.62 0\.5 0\.32 RG 0\.8 w [\d. ]+ re S/);
  assert.ok(outline > 0 && outline < pdf.indexOf('0.14 0.38 0.8 RG 1 w [3 2] 0 d'), 'the PDF draws the sheet outline over its cut numbers');
}

// A board's last part comes off without a cut only when it's all that's left. Two 47 7/8" rails from an 8' board
// (the planner's advice) leave 48" after the first cut, so the second rail is measured and cut too.
const RAIL = 'Measure from the end, cut on the waste side of the mark', FRESH = 'Measure from the fresh end';
const sawCases = [
  { trim: 0, parts: [{ name: 'Rail', qty: 2, len: 47.875 }], steps: [RAIL, FRESH], cuts: 2, lines: 2 },
  { trim: 0.25, parts: [{ name: 'Rail', qty: 2, len: 47 + 11 / 16 }], steps: ['Trim off 1/4" and measure every part from this fresh end', RAIL, FRESH + ' — this cut squares up the far end too'], cuts: 3, lines: 2 },
  { trim: 0.25, parts: [{ name: 'Top', qty: 1, len: 95.5 }], steps: ['Trim off 1/4" and measure every part from this fresh end', RAIL + ' — this cut squares up the far end too'], cuts: 2, lines: 1 },
  { trim: 0, parts: [{ name: 'Top', qty: 1, len: 96 }], steps: ['What’s left is this part — no cut needed'], cuts: 0, lines: 0 },
  { trim: 0, parts: [{ name: 'Leg', qty: 1, len: 72 }], steps: [RAIL], cuts: 1, lines: 1 },
];
for (const c of sawCases) {
  await open(saved(project('Saw', [board('2×4', [{ len: 96, price: 4.28 }], c.parts)], { trim: c.trim })));
  const what = `${c.parts[0].qty} × ${c.parts[0].len} on 8', trim ${c.trim}`;
  assert.equal(await cutsFact(), c.cuts + (c.cuts === 1 ? 'cut' : 'cuts'), what + ': cuts in the plan');
  assert.equal(await page.locator('#planOut .dg-kerf').count(), c.lines, what + ': saw cuts drawn');
  assert.equal(pdfKerfLines(await shopPdf()), c.lines, what + ': saw cuts in the PDF');
  await view('saw');
  assert.deepEqual(await sawSteps(), c.steps, what + ': steps at the saw');
}

// Boards on hand that run short say so in the cut list, instead of stopping the page.
await open(saved(project('Short of legs', [board('Other board', [{ len: 96, have: 2 }], [{ name: 'Leg', qty: 3, len: 72 }])])));
await view('list');
assert.match(await page.textContent('.perr'), /don’t fit together on any stock listed/);

assert.deepEqual(problems, [], 'no errors, and nothing loaded from anywhere else');

// Works offline once it has been opened, fonts and all.
await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('#planOut > *', { state: 'attached' });
assert.equal(await page.inputValue('#pname'), 'Short of legs', 'the page did not load offline');
assert.deepEqual(await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === 'error').map(f => f.family); }), [], 'a font failed offline');
await ctx.setOffline(false);

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while offline');
await browser.close();
server.close();
console.log('kerf e2e: all passed');
