#!/usr/bin/env python3
"""Turn a woodworking plan into a Kerf project: a link that opens it in Kerf, a file, and paste text.

    python3 make_kerf.py plan.json [--out DIR] [--base URL] [--no-paste]

plan.json (lengths may be numbers in the plan's units, or strings the way a tape reads:
"35 3/4", "35-3/4", "2' 11 3/4\"", "8'", "¾", "910mm", "2.4 m"):

{
  "name": "Mudroom bench",
  "units": "in",                      # "in" or "mm": what Kerf shows; bare numbers are in these units
  "kerf": "1/8", "trim": 0, "keep": 12, "currency": "$",      # all optional
  "materials": [
    {"kind": "board", "name": "2×4", "note": "1½ × 3½ in",
     "stock": [{"len": "8'", "price": 4.28}, {"len": "10'", "price": 6.38}, {"len": "30", "have": 1}],
     "parts": [{"name": "Leg", "qty": 4, "len": "17 1/4"}]},
    {"kind": "sheet", "name": "¾ plywood", "note": "23/32 in actual",
     "stock": [{"len": "96", "wid": "48", "price": 58}],
     "parts": [{"name": "Seat", "qty": 1, "len": "48", "wid": "16", "grain": true}]}
  ]
}

Kerf stores every length in inches whatever the display units; this script does that conversion,
checks that every part fits some stock, and exits 1 (printing why) if anything is wrong.
"""
import argparse, base64, json, math, re, sys, zlib
from pathlib import Path

DEFAULT_BASE = 'https://markjf99702.github.io/kerf/'
VULGAR = {'½': ' 1/2', '¼': ' 1/4', '¾': ' 3/4', '⅛': ' 1/8', '⅜': ' 3/8', '⅝': ' 5/8', '⅞': ' 7/8'}


def parse_len(v, units):
    """A length in inches, from a number (in `units`) or a tape-measure string. None if unreadable."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return v / 25.4 if units == 'mm' else float(v)
    s = str(v).strip().lower()
    for k, r in VULGAR.items():
        s = s.replace(k, r)
    s = re.sub(r"[′’‘`]", "'", s)
    s = re.sub(r'[″“”]', '"', s).replace('⁄', '/').replace(',', '.')
    s = re.sub(r'\s+', ' ', s).strip()
    m = re.fullmatch(r'(\d*\.?\d+)\s*(mm|cm|m)', s)
    if m:
        return float(m[1]) * {'mm': 1, 'cm': 10, 'm': 1000}[m[2]] / 25.4
    if units == 'mm' and re.fullmatch(r'\d*\.?\d+', s):
        return float(s) / 25.4
    ft = 0.0
    m = re.fullmatch(r"(\d*\.?\d+)\s*(?:'|ft|feet|foot)\s*-?\s*(.*)", s)
    if m:
        ft, s = float(m[1]), m[2].strip()
        if not s:
            return ft * 12
    s = re.sub(r'\s*(?:"|in|inch|inches)$', '', s).strip()
    if (m := re.fullmatch(r'(\d+)(?:\s+|\s*-\s*)(\d+)/(\d+)', s)):
        inch = int(m[1]) + int(m[2]) / int(m[3]) if int(m[3]) else None
    elif (m := re.fullmatch(r'(\d+)/(\d+)', s)):
        inch = int(m[1]) / int(m[2]) if int(m[2]) else None
    elif re.fullmatch(r'\d*\.?\d+', s):
        inch = float(s)
    else:
        return None
    return None if inch is None else ft * 12 + inch


def show(x, units):
    """Inches back to how Kerf would print them."""
    if units == 'mm':
        mm = round(x * 25.4 * 2) / 2
        return f'{mm:g} mm'
    n = round(x * 16)
    w, f, d = n // 16, n % 16, 16
    while f and f % 2 == 0:
        f //= 2; d //= 2
    return (f'{w} {f}/{d}' if w and f else f'{f}/{d}' if f else f'{w}') + '"'


def build(plan):
    errors, warnings = [], []
    units = 'mm' if plan.get('units') == 'mm' else 'in'
    L = lambda v: parse_len(v, units)

    def setting(key, default, lo, hi):
        if plan.get(key) is None:
            return default
        v = L(plan[key])
        if v is None or not lo <= v <= hi:
            errors.append(f'{key}: can\'t read {plan[key]!r} as a length between {show(lo, units)} and {show(hi, units)}')
            return default
        return v

    project = {
        'name': str(plan.get('name') or 'Untitled project')[:80],
        'units': units,
        'kerf': setting('kerf', 3 / 25.4 if units == 'mm' else 0.125, 0, 1),
        'trim': setting('trim', 0, 0, 6),
        'keep': setting('keep', 300 / 25.4 if units == 'mm' else 12, 0, 240),
        'cur': str(plan.get('currency') or '$')[:3],
        'materials': [],
    }
    mats = plan.get('materials')
    if not isinstance(mats, list) or not mats:
        errors.append('the plan has no materials')
        return project, errors, warnings

    for mi, m in enumerate(mats):
        kind = m.get('kind')
        if kind not in ('board', 'sheet'):
            errors.append(f'material {mi + 1}: kind must be "board" or "sheet", not {kind!r}')
            continue
        sheet = kind == 'sheet'
        mname = str(m.get('name') or ('Sheet' if sheet else 'Board'))[:60]
        out = {'kind': kind, 'name': mname, 'note': str(m.get('note') or '')[:80], 'stock': [], 'parts': []}

        for si, s in enumerate(m.get('stock') or []):
            ln = L(s.get('len'))
            wd = L(s.get('wid')) if sheet else None
            have = int(s.get('have') or 0)
            if ln is None or ln <= 0 or (sheet and (wd is None or wd <= 0)):
                errors.append(f'{mname}: stock size {si + 1} needs a length' + (' and a width' if sheet else ''))
                continue
            if not 0 <= have <= 10:
                errors.append(f'{mname}: "have" is a count of pieces on hand, 0–10 (0 means buy it)')
                continue
            price = 0 if have else s.get('price')
            if not have and (price is None or not isinstance(price, (int, float)) or price < 0):
                errors.append(f'{mname}: stock {show(ln, units)} needs a price (a number), or "have": N if it\'s on hand')
                continue
            st = {'len': ln, 'price': float(price or 0), 'have': have}
            if sheet:
                st['wid'] = wd
            out['stock'].append(st)
        if not out['stock']:
            errors.append(f'{mname}: list at least one size to buy (or have)')

        trim = project['trim']
        for pi, p in enumerate(m.get('parts') or []):
            pname = str(p.get('name') or '').strip()[:60]
            label = pname or f'part {pi + 1}'
            qty = p.get('qty', 1)
            if isinstance(qty, str) and qty.strip().isdigit():
                qty = int(qty)
            if not isinstance(qty, int) or isinstance(qty, bool) or not 1 <= qty <= 500:
                errors.append(f'{mname} / {label}: qty must be a whole number 1–500, not {qty!r}')
                continue
            ln = L(p.get('len'))
            if ln is None or ln <= 0:
                errors.append(f'{mname} / {label}: can\'t read the length {p.get("len")!r}')
                continue
            q = {'name': pname, 'qty': qty, 'len': ln}
            if sheet:
                wd = L(p.get('wid'))
                if wd is None or wd <= 0:
                    errors.append(f'{mname} / {label}: sheet parts need a width too')
                    continue
                grain = bool(p.get('grain', True))
                q.update({'wid': wd, 'grain': grain})
                fits = any(
                    (ln <= max(s['len'], s['wid']) + 1e-9 and wd <= min(s['len'], s['wid']) + 1e-9) or
                    (not grain and wd <= max(s['len'], s['wid']) + 1e-9 and ln <= min(s['len'], s['wid']) + 1e-9)
                    for s in out['stock'])
                if not fits:
                    errors.append(f'{mname} / {label} ({show(ln, units)} × {show(wd, units)}) won\'t fit on any sheet listed'
                                  + (' with the grain along its length' if grain else ''))
                if grain and ln < wd:
                    warnings.append(f'{mname} / {label}: grain-locked and shorter along the grain ({show(ln, units)}) than across '
                                    f'({show(wd, units)}). Kerf runs the grain along "len" — swap them if that\'s wrong.')
            else:
                if p.get('wid') is not None:
                    warnings.append(f'{mname} / {label}: board parts only take a length; the width was ignored')
                if not any(ln <= s['len'] - 2 * trim + 1e-9 for s in out['stock']):
                    errors.append(f'{mname} / {label} ({show(ln, units)}) is longer than any board listed')
            out['parts'].append(q)
        if not out['parts']:
            warnings.append(f'{mname}: no parts')
        project['materials'].append(out)
    return project, errors, warnings


def summary(project):
    units, kerf, lines = project['units'], project['kerf'], []
    for m in project['materials']:
        lines.append(f"{m['name']}" + (f" ({m['note']})" if m['note'] else ''))
        stock = ', '.join((f"{show(s['wid'], units)} × {show(s['len'], units)}" if m['kind'] == 'sheet' else show(s['len'], units))
                          + (f" (have {s['have']})" if s['have'] else f" @ {project['cur']}{s['price']:.2f}") for s in m['stock'])
        lines.append(f'  stock: {stock}')
        for p in m['parts']:
            dims = f"{show(p['len'], units)} × {show(p['wid'], units)}" + (' grain' if p['grain'] else '') if m['kind'] == 'sheet' else show(p['len'], units)
            lines.append(f"  {p['qty']:>3} × {p['name'] or '(unnamed)'}  {dims}")
        if m['kind'] == 'board' and m['parts'] and m['stock']:
            need = sum(p['qty'] * (p['len'] + kerf) for p in m['parts'])
            longest = max(s['len'] for s in m['stock'])
            cap = longest - 2 * project['trim'] + kerf
            lines.append(f'  no fewer than {math.ceil(need / cap - 1e-9)} of the longest board ({show(longest, units)}) by length alone; Kerf finds the real number')
        if m['kind'] == 'sheet' and m['parts'] and m['stock']:
            area = sum(p['qty'] * p['len'] * p['wid'] for p in m['parts'])
            big = max(s['len'] * s['wid'] for s in m['stock'])
            lines.append(f'  no fewer than {math.ceil(area / big - 1e-9)} of the largest sheet by area alone; grain and layout usually need more')
    return '\n'.join(lines)


def link(doc, base):
    raw = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    z = zlib.compressobj(9, zlib.DEFLATED, -15)
    packed = z.compress(raw) + z.flush()
    return base + '#k1z' + base64.urlsafe_b64encode(packed).decode('ascii').rstrip('=')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('plan', help='plan JSON file, or - for stdin')
    ap.add_argument('--out', default='.', help='folder for the .kerf.json file')
    ap.add_argument('--base', default=DEFAULT_BASE, help='where Kerf is hosted')
    ap.add_argument('--no-paste', action='store_true', help="don't print the paste text")
    a = ap.parse_args()
    try:
        plan = json.load(sys.stdin if a.plan == '-' else open(a.plan, encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as e:
        sys.exit(f'Could not read the plan: {e}')
    project, errors, warnings = build(plan)
    for w in warnings:
        print('warning:', w)
    if errors:
        print('\nFix these, then run again:')
        for e in errors:
            print(' -', e)
        sys.exit(1)
    for k in ('kerf', 'trim', 'keep'):
        project[k] = round(project[k], 5)
    for m in project['materials']:
        for s in m['stock']:
            s['len'] = round(s['len'], 5)
            if 'wid' in s:
                s['wid'] = round(s['wid'], 5)
        for p in m['parts']:
            p['len'] = round(p['len'], 5)
            if 'wid' in p:
                p['wid'] = round(p['wid'], 5)
    doc = {'kerf': 1, 'project': project}
    slug = re.sub(r'[^a-z0-9]+', '-', project['name'].lower()).strip('-') or 'project'
    path = Path(a.out) / f'{slug}.kerf.json'
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(summary(project))
    print(f'\nFile: {path}')
    print(f'\nLink: {link(doc, a.base)}')
    if not a.no_paste:
        print('\nPaste text (Kerf › Projects › paste box):')
        print(json.dumps(doc, separators=(',', ':'), ensure_ascii=False))


if __name__ == '__main__':
    main()
