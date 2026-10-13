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
const saved = (...projects) => ({ projects: Object.fromEntries(projects.map(p => [p.id, p])), order: projects.map(p => p.id), current: projects[0].id, tab: 'plan', rtab: 'plan' });

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
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

// A board's last part comes off without a cut only when it's all that's left. Two 47 7/8" rails from an 8' board
// (the planner's advice) leave 48" after the first cut, so the second rail is measured and cut too.
const RAIL = 'Measure from the end, cut on the waste side of the mark', FRESH = 'Measure from the fresh end';
const sawCases = [
  { trim: 0, parts: [{ name: 'Rail', qty: 2, len: 47.875 }], steps: [RAIL, FRESH], cuts: 2, lines: 2 },
  { trim: 0.25, parts: [{ name: 'Rail', qty: 2, len: 47 + 11 / 16 }], steps: ['Trim off 1/4" and measure every part from this fresh end', RAIL, FRESH + ' — this cut squares up the far end too'], cuts: 3, lines: 2 },
  { trim: 0.25, parts: [{ name: 'Top', qty: 1, len: 95.5 }], steps: ['Trim off 1/4" and measure every part from this fresh end', RAIL + ' — this cut squares up the far end too'], cuts: 2, lines: 1 },
  { trim: 0, parts: [{ name: 'Top', qty: 1, len: 96 }], steps: ['What’s left is this part — no cut needed'], cuts: 0, lines: 0 },
];
for (const c of sawCases) {
  await open(saved(project('Saw', [board('2×4', [{ len: 96, price: 4.28 }], c.parts)], { trim: c.trim })));
  const what = `${c.parts[0].qty} × ${c.parts[0].len} on 8', trim ${c.trim}`;
  assert.equal(await cutsFact(), c.cuts + 'cuts', what + ': cuts in the plan');
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
