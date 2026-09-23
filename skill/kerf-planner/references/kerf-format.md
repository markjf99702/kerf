# Kerf project format

Use this when you can't run `scripts/make_kerf.py` and need to write a project by hand. The script produces exactly this.

Kerf reads a project as JSON: from a file (**Projects → Open a project file**), from the paste box under **Projects**, or from a link.

```json
{"kerf": 1, "project": {
  "name": "Mudroom bench",
  "units": "in",
  "kerf": 0.125, "trim": 0, "keep": 12, "cur": "$",
  "materials": [
    {"kind": "board", "name": "2×4", "note": "1½ × 3½ in",
     "stock": [{"len": 96, "price": 4.28, "have": 0}, {"len": 120, "price": 6.38, "have": 0}, {"len": 30, "price": 0, "have": 1}],
     "parts": [{"name": "Leg", "qty": 4, "len": 16.5}, {"name": "Long rail", "qty": 4, "len": 41}]},
    {"kind": "sheet", "name": "¾ plywood", "note": "23/32 in actual",
     "stock": [{"len": 96, "wid": 48, "price": 58, "have": 0}],
     "parts": [{"name": "Seat", "qty": 1, "len": 48, "wid": 16, "grain": true}]}
  ]}}
```

## Fields

**Every length is a number in inches**, even when `units` is `"mm"`: 900 mm is `35.43307`. `units` only sets how Kerf shows lengths.

| Field | Meaning |
|---|---|
| `name` | Project name, up to 80 characters |
| `units` | `"in"` or `"mm"` |
| `kerf` | Saw kerf in inches, 0–1. Default 0.125; 3 mm = 0.11811 |
| `trim` | Inches squared off each board end, 0–6. Default 0 |
| `keep` | Offcuts at least this long (inches) are called out as worth keeping. Default 12 |
| `cur` | Currency sign, up to 3 characters |
| `materials[].kind` | `"board"` (one cross-section; parts have a length) or `"sheet"` (parts have a length and a width) |
| `materials[].name`, `note` | Shown as the material's title and subtitle |
| `stock[]` | Sizes to buy or already on hand: `len` (and `wid` for sheets) in inches, `price` each, `have` = pieces on hand (0 = buy; on-hand pieces are free and used first; at most 10) |
| `parts[]` | `name`, `qty` (whole number 1–500), `len`, and for sheets `wid` and `grain` |
| `grain` | `true` keeps the grain along the part's `len`, and Kerf won't turn the part |

For a grain-locked sheet part, `len` must fit along the sheet's long side and `wid` across it.

Kerf ignores fields it doesn't know. It clamps out-of-range numbers and drops sizes with no length, so a small slip degrades quietly instead of failing. Get the inches right.

## Links

A link is Kerf's address with the project in the fragment:

```
https://markjf99702.github.io/kerf/#k1z<data>
```

`<data>` is the compact JSON above, compressed with raw DEFLATE, then base64url-encoded without padding. `#k1j<data>` is the same without compression. Kerf also accepts `#project=<URL-encoded JSON>`, which can be written by hand, but it gets long.

Opening a link shows the project and asks before adding it. It never replaces an existing project.
