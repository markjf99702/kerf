---
name: kerf-planner
description: Plan a woodworking or DIY build with the user — furniture, shelves, benches, cabinets, workbenches, planters, storage, framing — from a rough idea to an agreed design and an exact cut list, then hand it to Kerf (the cut-list optimizer) as a one-tap link and a project file. Use this whenever someone wants to build something out of lumber or plywood, asks what wood to buy or how to cut it, wants a cut list or parts list, mentions Kerf, or says "send it to Kerf" — even if they only describe the thing they want to make.
---

# Kerf planner

Help someone go from "I want to build a bench for the mudroom" to a design you both agree on, then to a cut list exact enough to buy wood with, delivered as a project that opens in **Kerf**. Kerf works out the cheapest boards and sheets to buy, draws every cut, and gives a checklist for the saw. Your job is the part before that: the design conversation and the arithmetic that turns a design into parts.

Two things make this valuable, so protect them:
- **The person stays in charge of the design.** Propose, don't impose. They know their space, tools and taste.
- **The numbers are right.** A cut list that's off by the thickness of a board wastes a trip to the store. Actual lumber sizes and joinery allowances are where plans usually go wrong — `references/woodworking.md` has them.

## 1. Get the picture

Find out what's missing from:
- what it is and where it goes;
- the size limits;
- what it has to hold;
- the tools they have;
- the look or wood they want;
- whether they have leftover wood to use up.

Ask two to four questions at a time, not a questionnaire. Offer a sensible default with each one, so a short answer ("sure, defaults") moves things along. Tools matter more than people expect: a circular saw with no table saw changes the joinery and how sheets get broken down. A pocket-hole jig opens up simple, strong joints.

If they've already given a cut list and just want it in Kerf, skip to step 4 and carry their sizes over exactly. It's their design. Do check the sizes against each other and against the stock. If something won't work as written, say so and suggest a fix, but don't change it without asking. The usual problem is a part that won't come out of a board the way they expect.

## 2. Agree on a design

Propose one clear approach before any cut list:
- overall dimensions;
- how it goes together (the joinery, chosen for their tools);
- which materials, and a line on why.

A small text sketch or a parts-by-role list helps: "four legs, two long rails and two short rails top and bottom, a plywood seat". Mention the one or two choices that really matter, like shelf span, seat height or overhang. Let them react. Iterate until they say it looks right, and don't derive the full cut list until they have. It's much cheaper to change a design than a cut list.

If they ask you to just decide, pick sound defaults, say what you picked in a line or two, and carry on.

## 3. Work out the cut list

Derive every part from the agreed design, using **actual** dimensions:
- A 2×4 is 1½ × 3½.
- ¾ plywood is really 23/32.

For each part, show the arithmetic when its size depends on others, so they can check it:
- *Long rail = 48 − 2 × 3½ (legs) = 41*
- *Shelf = 30 + 2 × ¼ (dados) = 30½*

Read `references/woodworking.md` for:
- lumber and sheet sizes;
- the allowance each joint needs;
- common furniture dimensions;
- shelf spans.

Name parts by what they are ("Front rail", "Left side"), not "Part A". The names show up at the saw.

**Watch for parts that are exact fractions of a stock length.** Two 48″ parts won't come out of one 8′ board, and two 60″ slats won't come out of a 10′ board: each saw cut eats about ⅛″. When the design has slack, size the part a hair under, like 47⅞. Otherwise, point out that it takes a longer board. Kerf's tips catch these too, but the cut list is the better place to settle it.

How Kerf sees materials, so the plan maps cleanly:
- **Boards.** Each board material is one cross-section: "2×4", "1×6 pine", "5/4 × 6 decking". Board parts have only a length. A strip ripped narrower from a board is still a board part; say so in its name ("Cleat — rip to 1½").
- **Sheets.** Plywood, MDF and so on. Parts have a length and a width.
  - Set `grain: true` on visible parts (tops, sides, doors), so the grain runs along the part's length.
  - Use `false` for hidden parts (backs, drawer bottoms, cleats) and for MDF. That lets Kerf turn them to fit better.
- **Leave the kerf out.** Kerf adds the saw kerf between parts itself; don't add it to part sizes.
- **Not in Kerf:** hardware, finish, edge banding, glue-ups wider than a board, and rough hardwood sold by the board foot. List these in your notes instead (`references/woodworking.md` covers how to model glue-ups and hardwood).

Stock sizes and prices:
- Offer what's usual for their region (the reference has US and metric sizes, with rough prices).
- Include more than one length or sheet size where it's sold. Kerf picks the cheapest mix, and half sheets or longer boards often win.
- Say plainly that prices are examples to update.
- Ask about offcuts they already have. Kerf uses them first, for free (`"have": N`).
- For construction lumber, suggest buying a spare board for knots and warps rather than quietly padding the list.
- Leave end trim at 0 unless the ends are rough or split, which is common with framing lumber and hardwood; then use ¼–½″ per end, and say so.

## 4. Build the Kerf project

When code tools are available, write the plan as JSON and run the bundled script:

```
python3 scripts/make_kerf.py plan.json --out /mnt/user-data/outputs
```

(Use any writable folder for `--out`; `/mnt/user-data/outputs` is where claude.ai offers files for download.)

In `plan.json`, lengths are written the way a tape reads — `"35 3/4"`, `"8'"`, `"2' 11 3/4\""`, `"¾"`, `"900mm"`, `"2.4 m"` — or as bare numbers in the plan's units. The script's docstring shows the full shape:

```json
{"name": "Mudroom bench", "units": "in",
 "materials": [
  {"kind": "board", "name": "2×4", "note": "1½ × 3½ in",
   "stock": [{"len": "8'", "price": 4.28}, {"len": "10'", "price": 6.38}, {"len": "30", "have": 1}],
   "parts": [{"name": "Leg", "qty": 4, "len": "16 1/2"}]},
  {"kind": "sheet", "name": "¾ plywood", "note": "23/32 in actual",
   "stock": [{"len": "96", "wid": "48", "price": 58}, {"len": "48", "wid": "24", "price": 24}],
   "parts": [{"name": "Seat", "qty": 1, "len": "48", "wid": "16", "grain": true}]}]}
```

Optional top-level settings: `"kerf"` (default ⅛″, or 3 mm in a metric plan), `"trim"` (squaring each board end, default 0), `"keep"` (the smallest offcut worth keeping, default 12″ or 300 mm), and `"currency"`. For a metric plan, use `"units": "mm"`; bare numbers are then millimetres. Set `"currency"` for the region, such as `"£"` or `"€"`.

The script does four things:
- converts everything to inches, which is how Kerf stores lengths;
- checks every part fits some stock (a grain-locked sheet part must fit with its length along the sheet's long side);
- warns about likely slips, such as a grain-locked part whose length is shorter than its width;
- prints a summary, a **link**, the **paste text**, and writes a `.kerf.json` file.

If it reports errors, fix the plan, not the script, and run it again. The summary's "no fewer than" lines are floors from length and area alone; real layouts usually need more. Don't quote them as what to buy. If a part doesn't fit, that's a design conversation: add a longer board, a bigger sheet, or a glue-up.

Without code tools, write the project by hand following `references/kerf-format.md`. Remember the inches. Give the paste text only; the link needs the script.

## 5. Hand it over

Keep the final message tidy:
1. A two- or three-line recap of the design.
2. The cut list, grouped by material: quantity, part, size, and grain where it matters.
3. Notes Kerf won't cover: hardware, glue-ups, finish, the spare board.
4. The Kerf link, presented as a link. Tapping it opens Kerf and offers to add the project.
5. The fallback: offer the `.kerf.json` file (**Projects** → **Open a project file** in Kerf). Only put paste text in the reply if you can't offer the file. Copy the link and the paste text character for character from the script's output; they are encoded data, and one retyped digit breaks them.
6. One line saying prices are examples, and that Kerf will show exactly what to buy and how to cut it. Leave the buying arithmetic to Kerf; hand-worked totals are easy to get wrong. If you mention one, call it rough.

If they change the design afterwards, update the plan and run the script again. The new link comes in as a separate project, so their old one isn't overwritten.

The link points at `https://markjf99702.github.io/kerf/` by default. If they use Kerf somewhere else, pass `--base` with that address.
