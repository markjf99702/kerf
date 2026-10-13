// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// Everything shows the example project (renamed, so the "this is an example" bar is out of the way),
// so the same pictures come out each time.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>card</title>'); return; } // where the og.png card is laid out, so fonts/ resolves
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const SEED = 4;
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

async function open(viewport, deviceScaleFactor) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, isMobile: viewport.width < 600, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(seed => {
    let a = seed; // mulberry32
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }, SEED);
  await page.goto(base);
  await page.fill('#pname', 'Garage shelves');
  await page.waitForSelector('[data-tip]', { timeout: 20000 }); // the tip shows once Kerf has checked the parts
  await page.evaluate(() => document.fonts.ready);
  return page;
}
const view = (page, t) => page.click(`#tabs button[data-t="${t}"]`).then(() => page.evaluate(() => scrollTo(0, 0)));

// Phone screenshots for the README: the cut list, the plan, and the first board at the saw.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await view(page, 'list');
  await page.screenshot({ path: join(root, 'docs/phone-list.png') });
  await view(page, 'plan');
  await page.screenshot({ path: join(root, 'docs/phone-plan.png') });
  await view(page, 'saw');
  for (let i = 0; i < 4; i++) await page.locator('#sawOut .cut[data-k]').nth(i).click();
  await page.evaluate(() => document.activeElement.blur());
  await page.screenshot({ path: join(root, 'docs/phone-saw.png') });
  await page.context().close();
}

// Link preview, 1200 x 630: a card with the name and one line on the left, and the example's 2×4 cutting
// diagram on the right, taken from the app at desktop size with the app's own styles.
{
  const app = await open({ width: 1280, height: 800 }, 1);
  const css = await app.evaluate(() => document.querySelector('style').textContent);
  const diagram = await app.evaluate(() => document.querySelector('#planOut .mdiag').outerHTML);
  const hatch = await app.evaluate(() => document.querySelector('pattern#hatch').closest('svg').outerHTML);
  await app.context().close();

  const page = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
  await page.goto(base + 'blank');
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}
    html,body{width:1200px;height:630px;overflow:hidden}
    .og-l{position:absolute;left:64px;top:92px;width:440px}
    .og-brand{display:inline-block;background:var(--tape);color:var(--tape-ink);font:800 104px/1 var(--disp);letter-spacing:.02em;padding:10px 26px 4px;border-radius:12px;box-shadow:0 2px 1px rgba(28,31,34,.14)}
    .og-l h1{margin:36px 0 0;font:600 40px/47px var(--body);color:var(--ink)}
    .og-l p{margin:16px 0 0;font:400 26px/36px var(--body);color:var(--ink2)}
    .og-r{position:absolute;left:549px;top:66px;width:716px;transform:scale(.835);transform-origin:0 0}
    .og-r .mdiag{margin:0;box-shadow:0 22px 48px -20px rgba(28,31,34,.4)}
  </style></head><body>
    <div class="og-l"><div class="og-brand">KERF</div><h1>Cut lists for lumber and plywood.</h1><p>List the parts. Kerf finds the cheapest boards and sheets to buy, and how to cut them.</p></div>
    <div class="og-r">${diagram}</div>${hatch}
  </body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(root, 'og.png') });
  await page.context().close();
}

await browser.close();
server.close();
console.log('screenshots written');
