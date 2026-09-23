// Checks Kerf's optimizer against brute force, and every sheet layout for overlaps.
// Run with: node test/solver.test.js   (no dependencies)
'use strict';
const fs = require('fs');
const path = require('path');

// The app is one HTML file; pull the pieces under test out of it by name.
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fn(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing function ' + name);
  for (let k = src.indexOf('{', i), d = 0; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && !--d) return src.slice(i, k + 1);
  }
}
function list(name) {
  const i = src.indexOf('var ' + name + ' = ');
  return src.slice(i, src.indexOf('\n  ];', i) + 5);
}
function line(start) { const i = src.indexOf(start); return src.slice(i, src.indexOf('\n', i)); }
const K = new Function([
  "var U = 'in';",
  line('var VULGAR = '), line('var SPLITS = '), line('var MINR = '), list('SORTS'), list('FITS'),
  ...['sixteenths', 'mmOf', 'fmt', 'parseLen', 'mulberry', 'bestFill', 'solveBoards', 'orientations', 'newSheet',
    'placeIn', 'fitsStock', 'packRun', 'freeArea', 'evalSheets', 'sheetSteps', 'solveSheets'].map(fn),
  'return { parseLen: parseLen, fmt: fmt, solveBoards: solveBoards, solveSheets: solveSheets, units: function (u) { U = u; } };'
].join('\n'))();

let failed = 0;
function check(ok, what) { if (!ok) { failed++; console.log('  FAIL ' + what); } }
function rng(seed) { let a = seed; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const LUMBER = [[96, 4.28], [120, 6.38], [144, 7.68], [192, 10.98]];

// Cheapest possible cost by brute force: every piece into every open board or a new one.
function brute(pieces, stocks, kerf) {
  pieces = pieces.slice().sort((a, b) => b - a);
  let best = Infinity; const bins = [], left = stocks.map(s => s.left);
  (function go(i, cost) {
    if (cost >= best - 1e-9) return;
    if (i === pieces.length) { best = cost; return; }
    const p = pieces[i], seen = new Set();
    for (const b of bins) {
      const key = b.cap + ':' + b.used.toFixed(4); if (seen.has(key)) continue; seen.add(key);
      if (b.used + kerf + p <= b.cap + 1e-9) { const u = b.used; b.used += kerf + p; go(i + 1, cost); b.used = u; }
    }
    stocks.forEach((s, si) => {
      if (left[si] > 0 && p <= s.cap + 1e-9) { left[si]--; bins.push({ cap: s.cap, used: p }); go(i + 1, cost + s.price); bins.pop(); left[si]++; }
    });
  })(0, 0);
  return best;
}

console.log('lengths');
const inches = { '35 3/4': 35.75, '35-3/4': 35.75, '2\' 11 3/4"': 35.75, '8\'': 96, '8 ft': 96, '3/4': 0.75, '¾': 0.75, '1½"': 1.5, '910mm': 910 / 25.4, '2.4 m': 2400 / 25.4, 'abc': NaN, '1/0': NaN };
for (const [s, want] of Object.entries(inches)) {
  const got = K.parseLen(s);
  check(Number.isNaN(want) ? Number.isNaN(got) : Math.abs(got - want) < 1e-9, `parseLen(${JSON.stringify(s)}) = ${got}, want ${want}`);
}
check(K.fmt(35.75) === '35 3/4"' && K.fmt(96, { ft: true }) === "8'" && K.fmt(102.5, { ft: true }) === "8' 6 1/2\"", 'fmt in inches');
K.units('mm'); check(K.parseLen('600') === 600 / 25.4 && K.fmt(600 / 25.4) === '600 mm', 'millimeters'); K.units('in');

console.log('boards: the example project');
{
  const stock = LUMBER.map(s => ({ len: s[0], price: s[1], have: 0 }));
  const r = K.solveBoards({ stock, parts: [{ len: 72, qty: 4 }, { len: 48, qty: 8 }, { len: 21, qty: 8 }] }, { kerf: 0.125, trim: 0 });
  check(Math.abs(r.cost - 42.64) < 1e-6, `garage shelves 2×4s cost $${r.cost.toFixed(2)}, want $42.64`);
}

console.log('boards: random jobs against brute force (offcuts on hand, end trim, two kerfs)');
{
  const R = rng(17); let n = 0;
  for (let t = 0; t < 400; t++) {
    const trim = t % 3 === 0 ? 0.5 : 0, kerf = t % 2 ? 0.125 : 0.09375;
    const stock = LUMBER.slice(0, 2 + (t % 3)).map(s => ({ len: s[0], price: s[1], have: 0 }));
    if (R() < 0.6) stock.push({ len: Math.round(30 + R() * 60), price: 0, have: 1 + Math.floor(R() * 2) });
    const parts = [];
    for (let k = 0, nT = 1 + Math.floor(R() * 4); k < nT; k++) parts.push({ len: Math.round((6 + R() * 80) * 8) / 8, qty: 1 + Math.floor(R() * 3) });
    if (parts.reduce((a, p) => a + p.qty, 0) > 9) continue;
    const r = K.solveBoards({ stock, parts }, { kerf, trim });
    const pieces = []; parts.forEach(p => { for (let q = 0; q < p.qty; q++) pieces.push(p.len); });
    const best = brute(pieces, stock.map(s => ({ cap: s.len - 2 * trim, price: s.have ? 0 : s.price, left: s.have || Infinity })), kerf);
    const used = new Map(); r.items.forEach(b => used.set(b.stock, (used.get(b.stock) || 0) + 1));
    n++;
    check(r.cost <= best + 1e-6, `job ${t}: $${r.cost.toFixed(2)}, cheapest is $${best.toFixed(2)} ${JSON.stringify(parts)}`);
    check(stock.every(s => !s.have || (used.get(s) || 0) <= s.have), `job ${t}: used more offcuts than on hand`);
    check(r.items.every(b => b.need <= b.cap + 1e-9), `job ${t}: a board is overfilled`);
  }
  console.log('  ' + n + ' jobs');
}

console.log('boards: a big job stays quick');
{
  const stock = LUMBER.map(s => ({ len: s[0], price: s[1], have: 0 }));
  const parts = Array.from({ length: 30 }, (_, i) => ({ len: 10 + (i * 37) % 80 + 0.25 * (i % 4), qty: 1 + i % 5 }));
  const t0 = Date.now(); const r = K.solveBoards({ stock, parts }, { kerf: 0.125, trim: 0 }); const ms = Date.now() - t0;
  console.log(`  90 pieces → ${r.items.length} boards, $${r.cost.toFixed(2)} in ${ms} ms`);
  check(ms < 2000, 'big job took ' + ms + ' ms');
  check(r.items.reduce((a, b) => a + b.pieces.length, 0) === 90, 'big job lost pieces');
}

console.log('sheets: two half sheets beat one full sheet');
{
  const stock = [{ len: 96, wid: 48, price: 58, have: 0 }, { len: 48, wid: 24, price: 24, have: 0 }];
  const parts = [{ len: 48, wid: 16, qty: 1, grain: true }, { len: 44.75, wid: 12.75, qty: 1, grain: true }];
  const r = K.solveSheets({ stock, parts }, { kerf: 0.125 });
  check(Math.abs(r.cost - 48) < 1e-6, `bench seat and shelf cost $${r.cost}, want $48 (two half sheets)`);
}

console.log('sheets: random jobs, every layout checked');
{
  const R = rng(11), kerf = 0.125; let n = 0;
  for (let t = 0; t < 200; t++) {
    const parts = [];
    for (let k = 0, nT = 1 + Math.floor(R() * 6); k < nT; k++) parts.push({ len: Math.round((6 + R() * 60) * 4) / 4, wid: Math.round((4 + R() * 30) * 4) / 4, qty: 1 + Math.floor(R() * 5), grain: R() < 0.5 });
    const stock = [{ len: 96, wid: 48, price: 58, have: 0 }];
    if (t % 4 === 0) stock.push({ len: 48, wid: 24, price: 21, have: 0 });
    const r = K.solveSheets({ stock, parts }, { kerf });
    if (r.errors.length) continue;
    n++;
    let count = 0;
    r.items.forEach(sh => sh.placed.forEach((p, i) => {
      count++;
      const part = parts[p.pi];
      check(p.x > -1e-9 && p.y > -1e-9 && p.x + p.l <= sh.L + 1e-9 && p.y + p.w <= sh.W + 1e-9, `job ${t}: part off the sheet`);
      check(!(part.grain && p.rot), `job ${t}: a grain-locked part was turned`);
      const same = Math.abs(p.l - part.len) < 1e-9 && Math.abs(p.w - part.wid) < 1e-9, turned = Math.abs(p.l - part.wid) < 1e-9 && Math.abs(p.w - part.len) < 1e-9;
      check(same || (!part.grain && turned), `job ${t}: part placed at the wrong size`);
      sh.placed.forEach((q, j) => {
        if (j <= i) return;
        const apartX = p.x + p.l + kerf <= q.x + 1e-9 || q.x + q.l + kerf <= p.x + 1e-9;
        const apartY = p.y + p.w + kerf <= q.y + 1e-9 || q.y + q.w + kerf <= p.y + 1e-9;
        check(apartX || apartY, `job ${t}: parts overlap (kerf included)`);
      });
    }));
    check(count === parts.reduce((a, p) => a + p.qty, 0), `job ${t}: placed ${count} parts`);
    check(r.items.every(sh => sh.steps.every(s => s.type === 'none' || (s.at > 0 && s.on))), `job ${t}: a cut step is incomplete`);
  }
  console.log('  ' + n + ' jobs');
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall good');
process.exit(failed ? 1 : 0);
