// Checks Kerf's optimizer against brute force, and every sheet layout for overlaps.
// Run with: node test/solver.test.cjs   (no dependencies)
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
const SOLVER = [
  "var U = 'in';",
  line('var VULGAR = '), line('var EFFORT = '), line('var SPLITS = '), line('var MINR = '), list('SORTS'), list('FITS'),
  ...['esc', 'sixteenths', 'mmOf', 'fmt', 'fmtH', 'parseLen', 'mulberry', 'bestFill', 'solveBoards', 'orientations', 'newSheet',
    'placeIn', 'fitsStock', 'packRun', 'freeArea', 'evalSheets', 'sheetSteps', 'solveSheets'].map(fn),
];
const K = new Function([
  ...SOLVER,
  'return { parseLen: parseLen, fmt: fmt, fmtH: fmtH, solveBoards: solveBoards, solveSheets: solveSheets, units: function (u) { U = u; } };'
].join('\n'))();
// The page's own solveAll, with the plans it keeps between edits, noting the id of each material it plans (a full solve:
// the quick ones that look for tips aren't plans). `forget` drops the kept plans, as opening the page afresh does.
function planner() {
  return new Function([
    ...SOLVER, 'var P = null, RES = null, planned = [];', line('var PLANS = '), ...['lastIsLeft', 'cfg', 'solveMat', 'planInputs', 'solveAll'].map(fn),
    'var boards = solveBoards, sheets = solveSheets;',
    'solveBoards = function (m, c, quick) { if (!quick) planned.push(m.id); return boards(m, c, quick); };',
    'solveSheets = function (m, c, quick) { if (!quick) planned.push(m.id); return sheets(m, c, quick); };',
    'return { solve: function (p) { P = p; U = p.units; planned = []; return { res: solveAll(), planned: planned }; }, forget: function () { PLANS = {}; } };'
  ].join('\n'))();
}

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
// Just under a whole foot rounds up to it, not to 12": 2438 mm is 8', not 7' 12".
for (const [x, want, wantH] of [[95.98, "8'", '8′'], [2438 / 25.4, "8'", '8′'], [107.97, "9'", '9′'], [191.975, "16'", '16′'], [95.96, "7' 11 15/16\"", '7′ 11 <span class="fr"><sup>15</sup>⁄<sub>16</sub></span>″']]) {
  const got = K.fmt(x, { ft: true }), gotH = K.fmtH(x, { ft: true });
  check(got === want && gotH === wantH, `fmt(${x}, in feet) = ${got} and ${gotH}, want ${want}`);
}
K.units('mm'); check(K.parseLen('600') === 600 / 25.4 && K.fmt(600 / 25.4) === '600 mm', 'millimeters'); K.units('in');

console.log('boards: the example project');
{
  const stock = LUMBER.map(s => ({ len: s[0], price: s[1], have: 0 }));
  const r = K.solveBoards({ stock, parts: [{ len: 72, qty: 4 }, { len: 48, qty: 8 }, { len: 21, qty: 8 }] }, { kerf: 0.125, trim: 0 });
  check(Math.abs(r.cost - 42.64) < 1e-6, `garage shelves 2×4s cost $${r.cost.toFixed(2)}, want $42.64`);
}

console.log('boards: on-hand boards that run short');
{
  // Only two boards on hand and nothing to buy: three legs can't all be cut, and the plan has to say so.
  let r = null;
  try { r = K.solveBoards({ stock: [{ len: 96, price: 0, have: 2 }], parts: [{ len: 72, qty: 3 }] }, { kerf: 0.125, trim: 0 }); } catch (e) { check(false, 'have 2 for 3 legs threw: ' + e.message); }
  if (r) check(r.items.length === 0 && r.errors.length === 1 && r.errors[0].pi === -1, 'have 2 for 3 legs: ' + JSON.stringify(r.errors));
  r = K.solveBoards({ stock: [{ len: 96, price: 0, have: 3 }], parts: [{ len: 72, qty: 3 }] }, { kerf: 0.125, trim: 0 });
  check(r.items.length === 3 && r.cost === 0 && !r.errors.length, 'have 3 for 3 legs uses all three, free');
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

console.log('boards: hundreds of pieces in many lengths');
{
  // The exact search nests a call or more per board and length; this job used to run out of stack and stop the page.
  const stock = LUMBER.map(s => ({ len: s[0], price: s[1], have: 0 }));
  const parts = Array.from({ length: 16 }, (_, i) => ({ len: 7 + i * 5.25, qty: 50 }));
  let r = null;
  try { r = K.solveBoards({ stock, parts }, { kerf: 0.125, trim: 0 }); } catch (e) { check(false, '16 lengths × 50 threw: ' + e.message); }
  if (r) check(r.items.reduce((a, b) => a + b.pieces.length, 0) === 800 && !r.errors.length, '16 lengths × 50: not every piece is planned');
}

console.log('sheets: two half sheets beat one full sheet');
{
  const stock = [{ len: 96, wid: 48, price: 58, have: 0 }, { len: 48, wid: 24, price: 24, have: 0 }];
  const parts = [{ len: 48, wid: 16, qty: 1, grain: true }, { len: 44.75, wid: 12.75, qty: 1, grain: true }];
  const r = K.solveSheets({ stock, parts }, { kerf: 0.125 });
  check(Math.abs(r.cost - 48) < 1e-6, `bench seat and shelf cost $${r.cost}, want $48 (two half sheets)`);
}

console.log('sheets: more than 300 of one part');
{
  // Kerf packs at most 300 of a sheet part. The rest used to be left out without a word, so the plan under-bought.
  const r = K.solveSheets({ stock: [{ len: 96, wid: 48, price: 58, have: 0 }], parts: [{ len: 4, wid: 4, qty: 400, grain: false }] }, { kerf: 0.125 });
  check(r.items.reduce((a, s) => a + s.placed.length, 0) === 300, '400 pegs: placed ' + r.items.reduce((a, s) => a + s.placed.length, 0) + ', want 300');
  check(r.errors.length === 1 && r.errors[0].pi === 0 && r.errors[0].max === 300, '400 pegs: the plan doesn’t say it’s short: ' + JSON.stringify(r.errors.map(e => ({ pi: e.pi, max: e.max }))));
}

console.log('sheets: shuffling long enough to find the cheaper plan');
{
  // Two random ¾ plywood jobs, with full, half and quarter sheets for sale as the ¾ plywood preset has, that cost more
  // than the old 120 ms limit found on a laptop when the shuffle had half the work it has now: one bought a full
  // sheet where a half would do, the other an extra half sheet.
  const stock = [{ len: 96, wid: 48, price: 58, have: 0 }, { len: 48, wid: 48, price: 34, have: 0 }, { len: 48, wid: 24, price: 21, have: 0 }];
  const jobs = [
    [150, 174, [{ len: 22.25, wid: 13.25, qty: 8, grain: true }, { len: 19.5, wid: 28.875, qty: 5, grain: false }, { len: 26.75, wid: 25.375, qty: 6, grain: false }]],
    [290, 324, [{ len: 27.25, wid: 12.5, qty: 8, grain: true }, { len: 13, wid: 26.375, qty: 5, grain: false }, { len: 43.75, wid: 31.25, qty: 6, grain: true },
      { len: 25.25, wid: 27.25, qty: 4, grain: false }, { len: 42, wid: 27.875, qty: 2, grain: true }]],
  ];
  for (const [want, was, parts] of jobs) {
    const r = K.solveSheets({ stock, parts }, { kerf: 0.125 });
    check(Math.abs(r.cost - want) < 1e-6, `${parts.reduce((a, p) => a + p.qty, 0)} pieces of plywood cost $${r.cost}, want $${want} (half the shuffling bought $${was})`);
  }
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

console.log('the same plan on a slow or busy device');
{
  // Each search stops after a fixed amount of work, not time, so a clock that crawls (as on a slow phone, or a busy
  // computer) changes nothing. With time limits, the example's 2×4s cost $43.94 instead of $42.64 when each look at
  // the clock took a millisecond, and the layout of a bigger sheet job changed with the speed of the machine.
  const plan = r => r.cost.toFixed(2) + ' ' + r.items.map(it => it.pieces
    ? it.stock.len + ':' + it.pieces.map(p => p.pi + '@' + p.len).join(',')
    : it.L + 'x' + it.W + ':' + it.placed.map(p => p.pi + '@' + p.x.toFixed(3) + ',' + p.y.toFixed(3) + (p.rot ? 'r' : '')).join(',')).join(' | ');
  const stock = LUMBER.map(s => ({ len: s[0], price: s[1], have: 0 }));
  const sheets = [{ len: 96, wid: 48, price: 58, have: 0 }, { len: 48, wid: 48, price: 34, have: 0 }, { len: 48, wid: 24, price: 21, have: 0 }];
  const jobs = [
    ['the example 2×4s', () => K.solveBoards({ stock, parts: [{ len: 72, qty: 4 }, { len: 48, qty: 8 }, { len: 21, qty: 8 }] }, { kerf: 0.125, trim: 0 })],
    ['the example 2×4s, quick (for tips)', () => K.solveBoards({ stock, parts: [{ len: 72, qty: 4 }, { len: 47.9375, qty: 8 }, { len: 21, qty: 8 }] }, { kerf: 0.125, trim: 0 }, true)],
    ['14 lengths of 2×4', () => K.solveBoards({ stock, parts: Array.from({ length: 14 }, (_, i) => ({ len: 9.5 + i * 5.375, qty: 1 + i % 4 })) }, { kerf: 0.125, trim: 0 })],
    ['a plywood cabinet', () => K.solveSheets({ stock: sheets, parts: [{ len: 34.5, wid: 23.25, qty: 4, grain: true }, { len: 30, wid: 23.25, qty: 2, grain: true }, { len: 30, wid: 4, qty: 4 },
      { len: 28.5, wid: 11.25, qty: 6, grain: true }, { len: 33, wid: 15.75, qty: 2, grain: true }, { len: 15, wid: 6, qty: 8 }] }, { kerf: 0.125 })],
  ];
  const realNow = Date.now;
  for (const [what, solve] of jobs) {
    const usual = plan(solve());
    let t = realNow(), slow;
    Date.now = () => (t += 1);
    try { slow = plan(solve()); } finally { Date.now = realNow; }
    check(slow === usual, `${what}: a slow clock changed the plan\n    usual ${usual.slice(0, 120)}\n    slow  ${slow.slice(0, 120)}`);
    if (what === 'the example 2×4s') check(slow.startsWith('42.64 '), `the example 2×4s cost $${slow.split(' ')[0]} with a slow clock, want $42.64`);
  }
}

console.log('plans kept between edits');
{
  // Kerf keeps each material's plan until something it's worked out from changes. In a project with a board and a
  // sheet material, each edit below plans again only the materials listed, and what the page has is the plan a fresh
  // start finds (every search does a set amount of work, so it's the same plan), pointing at the project's own sizes
  // and parts. The edits follow on from each other, so a plan is kept across several.
  const page = planner(), fresh = planner();
  const p = { name: 'Garage shelves', units: 'in', kerf: 0.125, trim: 0, keep: 12, cur: '$', materials: [
    { id: 'studs', kind: 'board', name: '2×4', note: '1½ × 3½ in', stock: LUMBER.map((s, i) => ({ id: 'b' + i, len: s[0], price: s[1], have: 0 })),
      parts: [{ id: 'leg', name: 'Leg', qty: 4, len: 72 }, { id: 'rail', name: 'Rail', qty: 8, len: 48 }, { id: 'beam', name: 'Beam', qty: 1, len: 200 }] },
    { id: 'ply', kind: 'sheet', name: '¾ plywood', note: '23/32 in actual', stock: [{ id: 's0', len: 96, wid: 48, price: 58, have: 0 }, { id: 's1', len: 48, wid: 24, price: 21, have: 0 }],
      parts: [{ id: 'shelf', name: 'Shelf', qty: 4, len: 47.75, wid: 23.75, grain: true }, { id: 'top', name: 'Top', qty: 1, len: 100, wid: 30, grain: true }] },
  ] };
  const [studs, ply] = p.materials;
  // What the page shows from a plan, and whether it points at this project's own material, sizes and parts.
  const own = (yes, id) => (yes ? id : 'another copy of ' + id);
  const shown = (res, proj) => JSON.stringify([res.cost, res.boards, res.sheets, res.cuts, res.boardYield, res.boardKerf, res.sheetYield, res.mats.map((r, mi) => {
    const m = proj.materials[mi];
    return [own(r.mat === m, m.id), r.cost, r.errors.map(e => [e.pi, e.max, e.pi < 0 || own(e.part === m.parts[e.pi], m.parts[e.pi].id)]),
      r.items.map(it => [own(m.stock.includes(it.stock), it.stock.id), it.price, it.cap, it.trim, it.need, it.offcut, it.pieces, it.L, it.W, it.placed, it.spare,
        it.steps && it.steps.map(s => [s.type, s.at, s.on, s.line, s.gives && [s.gives.it.pi, s.gives.l, s.gives.w, s.gives.rot]])])];
  })]);
  const edits = [
    ['opening the project', () => {}, ['studs', 'ply']],
    ['renaming a sheet part', () => { ply.parts[0].name = 'Adjustable shelf'; }, []],
    ['renaming a board part', () => { studs.parts[0].name = 'Long leg'; }, []],
    ['renaming a part too big for any size', () => { ply.parts[1].name = 'Bench top'; studs.parts[2].name = 'Ridge beam'; }, []],
    ['renaming the materials, and a note', () => { studs.name = 'Stud'; ply.name = 'Birch ply'; ply.note = 'from the yard'; }, []],
    ['the project’s name, currency and offcuts worth keeping', () => { p.name = 'Shed shelves'; p.cur = '€'; p.keep = 18; }, []],
    ['a sheet part’s count', () => { ply.parts[0].qty = 6; }, ['ply']],
    ['a sheet part’s width', () => { ply.parts[0].wid = 22; }, ['ply']],
    ['a sheet part’s grain', () => { ply.parts[0].grain = false; }, ['ply']],
    ['a sheet part’s length', () => { ply.parts[0].len = 46; }, ['ply']],
    ['a board part’s length', () => { studs.parts[0].len = 70.5; }, ['studs']],
    ['a board part’s count', () => { studs.parts[1].qty = 6; }, ['studs']],
    ['a board size’s price', () => { studs.stock[0].price = 4.5; }, ['studs']],
    ['three of a board size on hand', () => { studs.stock[1].have = 3; }, ['studs']],
    ['buying that size again', () => { studs.stock[1].have = 0; }, ['studs']],
    ['a sheet size’s price', () => { ply.stock[0].price = 61; }, ['ply']],
    ['a sheet size’s width', () => { ply.stock[1].wid = 30; }, ['ply']],
    ['a sheet size’s length', () => { ply.stock[1].len = 60; }, ['ply']],
    ['a sheet on hand', () => { ply.stock[0].have = 1; }, ['ply']],
    ['buying that sheet again', () => { ply.stock[0].have = 0; }, ['ply']],
    ['a board size’s length', () => { studs.stock[3].len = 180; }, ['studs']],
    ['an offcut on hand', () => { studs.stock.push({ id: 'b4', len: 40, price: 0, have: 2 }); }, ['studs']],
    ['a sheet size taken away', () => { ply.stock.pop(); }, ['ply']],
    ['the kerf', () => { p.kerf = 0.09375; }, ['studs', 'ply']],
    ['trimming each board end', () => { p.trim = 0.25; }, ['studs']],
    ['millimetres, which a sheet’s steps are written in', () => { p.units = 'mm'; }, ['ply']],
    ['back to inches', () => { p.units = 'in'; }, ['ply']],
    ['a new part with no length yet', () => { studs.parts.push({ id: 'cleat', name: '', qty: 1, len: 0 }); }, []],
    ['its name and count', () => { studs.parts[3].name = 'Cleat'; studs.parts[3].qty = 3; }, []],
    ['its length', () => { studs.parts[3].len = 30; }, ['studs']],
    ['a sheet part taken away', () => { ply.parts.pop(); }, ['ply']],
    // A part's place in the list is how the plan finds its letter and name, so a part that moves up plans again.
    ['an empty board part, and another after it', () => { studs.parts.push({ id: 'gap', name: '', qty: 1, len: 0 }, { id: 'brace', name: 'Brace', qty: 2, len: 20 }); }, ['studs']],
    ['the empty board part taken away', () => { studs.parts.splice(4, 1); }, ['studs']],
    ['an empty sheet part, and another after it', () => { ply.parts.push({ id: 'gap2', name: '', qty: 1, len: 0, wid: 0, grain: true }, { id: 'back', name: 'Back', qty: 1, len: 30, wid: 20, grain: true }); }, ['ply']],
    ['the empty sheet part taken away', () => { ply.parts.splice(1, 1); }, ['ply']],
  ];
  let proj = p;
  const run = (what, want) => {
    const got = page.solve(proj);
    check(JSON.stringify(got.planned) === JSON.stringify(want), `${what} planned ${JSON.stringify(got.planned)}, want ${JSON.stringify(want)}`);
    const copy = JSON.parse(JSON.stringify(proj));
    fresh.forget();
    const plan = shown(got.res, proj), anew = shown(fresh.solve(copy).res, copy);
    check(plan === anew, `after ${what}, the page’s plan isn’t the one a fresh start finds\n    kept  ${plan.slice(0, 160)}\n    fresh ${anew.slice(0, 160)}`);
    return got.res;
  };
  for (const [what, edit, want] of edits) { edit(); run(what, want); }
  // Another window's save brings a new copy of the whole project: nothing is planned, and the plan points at the copy.
  proj = JSON.parse(JSON.stringify(p));
  const res = run('another window’s copy of the project', []);
  // A size the plan uses, taken away there and put back the same but under a new id: the plan points at the new one.
  const used = proj.materials.map((m, mi) => m.stock.findIndex(s => s.id === res.mats[mi].items[0].stock.id));
  proj = JSON.parse(JSON.stringify(proj));
  proj.materials.forEach((m, mi) => { m.stock[used[mi]].id += ' again'; });
  run('another window’s copy with a size put back', []);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall good');
process.exit(failed ? 1 : 0);
