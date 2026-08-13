# TIERFORM

Build a team chart from a list of names and photos — as a **pyramid**, a
**tornado**, a **histogram**, **swimlanes**, a **hive** or a **matrix** — and
export it as a PNG, a PDF, an SVG or a CSV.

One self-contained HTML file. No build step, no install, no server, no account.
Open it and it works.

![Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-blue) — see [LICENSE](LICENSE)

---

## Using it

[Download `tierform_app.html`](https://github.com/chrisjohe/tierform/raw/main/tierform_app.html)
and double-click it. That is the whole setup. GitHub serves the file as plain
text, so the link shows it in the browser instead of downloading it — save it to
disk first.

The ribbon has three tabs — **Start**, **Structure** and **Design** — and a
**Roster** panel down the left that lists everyone on the chart. The panel can
be hidden; a slim rail at the left edge brings it back.

1. **Start** — file commands, exports, adding people and the Info documents,
   in groups running File, Export, People, Info from left to right.
2. **Structure** — the grades: add, rename, reorder, colour and combine them;
   apply a template; manage the groups that give the chart its second
   dimension.
3. **Design** — the look: layout, spacing, page, angle, header, labels,
   colours and the font.

Your work lives in a **roster file** (`.json`) that you save and re-open. The
app stores nothing between visits — see [Privacy](#privacy) for why that is
deliberate.

### Starting a chart

**Start ▸ New** opens an empty document: no grades, nobody on the chart. The
empty canvas shows three starter cards — the same three templates as
**Structure ▸ Templates**, each a different structure, layout and colour — and
one click applies one. You do not have to start there: type a list or add a
person straight into the empty document and the structure builds itself from
what you enter.

- **Add people** (Start) is a split button. Its face opens a dialog that adds
  one person at a time — photo, name, grade, group and role, everything asked
  for in one place — and stays open so you can add several in a row. On an
  empty document its grade field becomes a free-text field that creates the
  first grade for you.
- Behind the caret, **Add list…** takes a pasted table — one person per line,
  **Name, Grade, Group, Role**, separated by tabs, commas or semicolons, which
  is what a spreadsheet puts on the clipboard — and shows a preview before
  anything is added. **Import CSV…** lands a `.csv` file in the same preview.
  Rows naming a grade the document does not have go to a grade called NEW; on
  an empty document the Grade column itself becomes the structure, in the
  order the list first mentions each grade.
- Or drop photos onto the chart or the panel. A file called
  `Vorname_Nachname.jpg` becomes "Vorname Nachname"; a photo whose name
  matches someone without a picture becomes that person's picture, no
  questions asked; a batch that adds new people asks once which grade and
  group the batch should get; a single new face opens the Add dialog,
  prefilled.

**Structure ▸ Templates** replaces the grade structure and restyles the
document in one undoable step; it asks first when there are grades to replace
and refuses while people exist. **Clear grades** and Start's **Clear roster**
each remove one half — the structure or the people — and both undo.

### The grades

The Structure tab shows the grades as a strip of chips, in chart order. Each
chip is a split: the name is the drag handle for reordering, the caret opens
that grade's settings — code and name, band fill (accent or border only),
where its people sit (left, centre, right), **Attach to left** (close the gap
to the neighbour) and **Share band** (draw two grades on one band), plus
Left/Right buttons that do the reordering without dragging and a Delete. Every
move is one undo step, and people stay assigned to the grade that moved.

### The groups

Groups are the chart's second dimension — a person's group prints in their
subline, and the Matrix layout turns groups into rows. Groups are created by
typing: any group text in the Add dialog, the Edit dialog, a pasted list or a
CSV either matches an existing group or creates one. **Structure ▸ Group**
manages them — reorder, rename, and renaming one group onto another's name
merges them. A group nobody belongs to disappears by itself.

### Six layouts

**Design ▸ Layout** switches between them. The same roster, the same title,
colours, photos and page — only the arrangement changes, and switching is one
undo step in either direction. Nothing is lost in the round trip: every
setting a layout ignores is kept, not reset.

| Layout | Shape | Reads as |
|---|---|---|
| **Pyramid** | One band per grade, stacked top to bottom, widening downward | A ranking — the taper is the point |
| **Tornado** | The funnel: same bands, widest grade at the top | A pipeline narrowing toward its outcome |
| **Histogram** | Each band exactly as wide as its own headcount | A count — this is the one layout where width states a number |
| **Swimlanes** | One vertical lane per grade, left to right, all lanes equal | A comparison on equal footing, whatever the headcounts |
| **Hive** | One hexagonal cell per grade, all cells equal, tiled | A map of teams side by side |
| **Matrix** | Swimlanes crossed with the groups: grade columns, group rows | Who sits where on both dimensions at once |

Grades follow the Grades strip's order everywhere — top-down in the band
layouts, along the lanes and cells in the rest — and people stay in roster
order. The band layouts draw an empty grade as an empty band; the others
leave empty grades out, unless nobody is on the chart at all. Attach and Share apply in
every layout, closing the gap or combining two grades on whatever surface the
layout draws — band, lane, cell or column.

**Angle** — five steps from flat to steep — applies to the Pyramid and the
Tornado, the two layouts with a slope. In the others the command stays
visible but disabled, and the value is **not reset**: switching back restores
the chart you had. The grade panel's left/centre/right placement works in the
band layouts and is likewise kept, disabled, in the rest.

### Labels and text

**Design ▸ Header** edits the chart title and the optional right-hand label.

**Design ▸ Grade labels** shows or hides the grade code and the grade name
independently. Both shown puts the code above the name as one block; both
hidden removes the headings entirely.

**Design ▸ Name labels** works in every layout. Position puts the text
**below** the photo or **next to** it; Display independently shows or hides
each person's name, grade and group; Bold picks which part of the name
carries the weight — first names, last name, the whole name or none.

What prints under a person as their role is their own "Role shown on the
chart" if they have one, otherwise their grade's name.

**Design ▸ Accent** sets the chart's colour — eight swatches or the system
colour dialog — and **Text** sets the ink colours used on coloured and on
white surfaces. Background, photo ring, page (A3 landscape, A3 portrait or
297 mm square, all at 300 dpi) and spacing each have their own command.

No layout paginates. What the app watches is the point size names and
photos come out at on the printed page; when that drops below readable, an
amber warning bar appears and names a setting to change.

### Keyboard

| | |
|---|---|
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd> | Undo |
| <kbd>⇧</kbd>+<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd> | Redo |
| <kbd>Esc</kbd> | Close a menu or dialog |
| <kbd>←</kbd> <kbd>→</kbd> <kbd>Home</kbd> <kbd>End</kbd> | Move between ribbon tabs |
| <kbd>←</kbd> <kbd>↑</kbd> <kbd>→</kbd> <kbd>↓</kbd> | Nudge a photo, with the framing circle focused (<kbd>⇧</kbd> for bigger steps) |

The whole app is operable without a mouse.

---

## Browser support

Current **Safari**, **Firefox** and **Chrome/Edge** on macOS and Windows.

Opening the file directly from disk is the intended way to run it, and
everything works that way with one exception:

> **Copy PNG** needs the browser's asynchronous clipboard API, which Safari
> and Chrome do not grant to a page opened from a file. Where it is
> unavailable the button is disabled and says so — use **Export ▸ Export
> PNG**, which writes the file to disk instead, or serve the file over http
> and Copy PNG comes back.

Copy PNG renders at 150 dpi for pasting into a document; Export PNG and PDF
render at 300 dpi for printing.

---

## Fonts

TIERFORM is designed for **Open Sans** and ships with it: the variable font
is embedded in the file, so the chart looks the same on every machine whether
the font is installed or not. **Design ▸ Font** can switch a document to
Segoe UI, Roboto, Helvetica or Arial instead; a family this machine lacks is
marked in the menu but stays selectable — the fallback still draws a clean
chart.

**This matters for SVG.** PNG and PDF are rasterised on the machine that made
them and look the same everywhere afterwards. The exported SVG deliberately
embeds no font and names the stack instead, so it uses whatever the machine
*opening* it has — a colleague without the chosen font will see it laid out
slightly differently. Send a PNG or PDF when the exact appearance matters;
send an SVG when the recipient needs to edit it.

---

## Privacy

**Nothing leaves your machine.** While you edit and while you export, the app
makes **no network requests at all** — no uploads, no analytics, no
telemetry, no error reporting. The only requests it can ever make are the
attribution links in the Info group on the Start tab, and only if you click
one.

This is enforced, not just promised: the test suite fails the build if
`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, a dynamic `import()` or
a `<form>` appears anywhere in the source.

**There is no in-app storage — deliberately.** No localStorage, no IndexedDB,
not even a draft. Opened from a file there is no reliable storage to use, so
anything "saved" in-app would evaporate on reload and quietly lose work. The
roster file is the only durable thing, which is why the app warns before you
close a tab with unsaved changes.

### Roster files are personal data

A roster file contains names, groups, roles and the photos themselves,
embedded in full. In most jurisdictions that makes it personal data, with the
obligations that follow. So do the exports: the PNG, the PDF, the SVG and the
CSV all carry the names, and all but the CSV the faces.

Share rosters and charts only with people entitled to see who is in the team.
Emailing a chart to a wide distribution list is a disclosure like any other.

### ⚠️ Opening a roster file from someone else

This is the one genuinely risky action. A roster file is a document from an
untrusted source, and it is treated as one:

- Every imported file is validated before it is opened, and refused whole if
  its structure cannot be trusted — including a file that declares a roster
  format this build does not read. A refused file never touches the roster
  you have open.
- All identifiers are regenerated on import, so nothing from the file can
  reach the page as markup.
- Photos must be JPEG or PNG data URLs within a size limit. URLs, SVG data
  URLs and anything else are dropped, and you are told which person lost a
  picture.
- **Each photo's header is read from the bytes before the browser is asked to
  decode it** — the PNG signature and IHDR, or the JPEG start marker and its
  first frame header. The type the file declares has to match what is
  actually there, so a PNG labelled as a JPEG, an SVG document inside a JPEG
  envelope, or a paragraph of text inside either one is refused at that
  point. The size the header declares is checked against the limits there
  too, so a picture far too large to draw is dropped without ever being
  decoded.
- The photo is then decoded to confirm the rest of it is readable, and the
  decoded dimensions must agree with the header. The real dimensions are
  used, not the ones the file claims. A roster full of photos takes a moment
  to open; the status bar says so while it works.
- **A bad photo costs only that photo.** The person keeps their name, grade,
  group and role, the rest of the roster opens normally, and the reason is
  listed for you afterwards. Only a broken *structure* refuses the file
  whole.
- Values that are merely wrong — an unknown colour, an unknown layout — are
  repaired to their defaults, counted, and reported after opening.

None of this sandboxes image decoding — no page can do that — and the checks
are deliberately bounded rather than exhaustive; [SECURITY.md](SECURITY.md)
states precisely what they do and do not prove. The ordinary habit is still
the right one: **open roster files from people you know.**

---

## For developers

Everything is in `tierform_app.html`: markup, one stylesheet, one script, an
inline SVG icon sprite and the embedded font. Open it in an editor and change
it.

There is no build step and there must not be one. No dependencies, no
bundler, no CDN — the file has to keep working when opened from `file://`.

### Tests

Five suites, each running under either `node` or `osascript -l JavaScript`
(macOS, no install needed):

```sh
osascript -l JavaScript test/harness.js     # geometry — every coordinate stays finite
osascript -l JavaScript test/dom.js         # DOM wiring, ids, accessibility, house rules
osascript -l JavaScript test/document.js    # document model, undo/redo, the photo store
osascript -l JavaScript test/fixtures.js    # real roster files, and the panel they build
osascript -l JavaScript test/import.js      # what the validator refuses and repairs
```

Roughly 21,000 assertions. `test/fixtures/` holds the roster files they run
against, generated by `generate.py` — regenerate rather than hand-edit. They
contain no real roster data.

`test/MANUAL.md` covers what no headless suite can: whether the chart
renders, whether PNG and PDF export, keyboard and screenreader behaviour, and
the browser matrix.

---

## Licensing

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

Third-party material, attributed in `NOTICE` and in the app's About dialog:

- **Material Symbols** icon paths (© Google LLC, Apache 2.0). Every symbol in
  the sprite is Google artwork except the TIERFORM mark, this project's own
  work; `test/dom.js` audits every symbol's path data against its source file
  in `sprites/`.
- **Open Sans** (© The Open Sans Project Authors, SIL Open Font License 1.1)
  is bundled: the variable font is embedded in the app and its exact source
  file is kept in `fonts/`, with the licence text in `licenses/`.
- The **GitHub logo** appears only as the link to this repository, under
  GitHub's logo guidelines; it is a GitHub trademark, not part of this
  project's licence.

Security reports: [SECURITY.md](SECURITY.md).
