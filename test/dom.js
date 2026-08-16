/* DOM wiring guard for tierform_app.html.
 *
 * Every handler in this app binds once at boot via $("#id"), and the roster and
 * grade editors use event delegation on fixed ids. So the way markup changes
 * break this app is silent: an element gets moved or renamed, $("#id") returns
 * null, and a button simply stops doing anything — no error, no failing layout
 * test. This file is the guard for exactly that.
 *
 * It checks, without a browser:
 *   1. every $("#id") the script references exists in the markup
 *   2. every id in the markup is actually used (catches orphans left behind)
 *   3. every data-act / data-tact / data-fact verb emitted has a handler
 *   4. the ids that MUST exist at boot for delegation to work are present
 *   5. the font block and the no-dependency rules still hold
 *
 * Run:  node test/dom.js
 *   or: osascript -l JavaScript test/dom.js
 */

function readFile(path){
  if(typeof require !== "undefined") return require("fs").readFileSync(path, "utf8");
  ObjC.import("Foundation");
  return $.NSString.stringWithContentsOfFileEncodingError(
    path, $.NSUTF8StringEncoding, null).js;
}
/* Binary read, base64-encoded — for comparing the bundled font payload
   against the tracked asset byte-for-byte. Returns "" for a missing or
   unreadable file (never throws), so a mutation that deletes the asset or
   points this at the wrong path lands on a red check() naming the rule
   instead of aborting the section. */
function readFileBase64(path){
  try{
    if(typeof require !== "undefined") return require("fs").readFileSync(path).toString("base64");
    ObjC.import("Foundation");
    const data = $.NSData.dataWithContentsOfFile(path);
    if(!data) return "";
    return ObjC.unwrap(data.base64EncodedStringWithOptions(0));
  }catch(e){
    return "";
  }
}
function here(){
  if(typeof __dirname !== "undefined") return __dirname + "/../";
  ObjC.import("Foundation");
  return $.NSFileManager.defaultManager.currentDirectoryPath.js + "/";
}
function listDir(path){
  if(typeof require !== "undefined") return require("fs").readdirSync(path);
  ObjC.import("Foundation");
  const arr = $.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(path, null);
  const out = [];
  for(let i = 0; i < arr.count; i++) out.push(arr.objectAtIndex(i).js);
  return out;
}

const HTML   = readFile(here() + "tierform_app.html");
const RAW    = /<script>([\s\S]*)<\/script>/.exec(HTML)[1];
const MARKUP = HTML.slice(0, HTML.indexOf("<script>"));

/* Scan code, not prose. Comments in this file legitimately quote things like
   $("#id") and data-act="del" while explaining the wiring, and counting those
   as real references produces phantom failures. */
const SCRIPT = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

let passed = 0;
const failures = [];
const check = (c, m) => { if(c) passed++; else failures.push(m); };

const uniq = a => [...new Set(a)];
const matchAll = (re, s) => { const o = []; let m; while((m = re.exec(s))) o.push(m); return o; };

/* The Accent editor, sliced out once. Read from the start of its own tag to the
   start of the next popup rather than by counting </div>s: it holds nested
   groups, and a lazy match would stop at the first inner close and take the
   swatches with it while leaving the hex field outside. */
function accentPop(){
  const from = MARKUP.indexOf('<div class="menu style-pop" id="accentPop"');
  if(from < 0) return "";
  const to = MARKUP.indexOf('<div class="menu style-menu" id="bgMenu"', from);
  return to > from ? MARKUP.slice(from, to) : MARKUP.slice(from);
}

/* ---------------------------------------------------------- 1. $("#id") resolves */

const referenced = uniq(matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g, SCRIPT).map(m => m[1])).sort();
const declared   = uniq(matchAll(/\bid="([A-Za-z0-9_-]+)"/g, MARKUP).map(m => m[1]));
/* Not every id is written into MARKUP: el()'s o.attrs is spread through
   setAttribute(), so a row built at runtime — the Templates menu's status
   hint, at least — declares its id from the script instead, as
   attrs:{id:"…", …}. That is the one shape el() offers for it (o.attrs is
   the only route to setAttribute("id", …) anywhere in this file), so this is
   the one pattern to match, not a guess at several. */
const declaredInScript = uniq(matchAll(/attrs:\{[^}]*\bid:"([A-Za-z0-9_-]+)"/g, SCRIPT).map(m => m[1]));

for(const id of referenced){
  check(declared.includes(id) || declaredInScript.includes(id),
    'MISSING ELEMENT: the script calls $("#' + id + '") but no id="' + id + '" exists in the '
    + 'markup, and the script declares no attrs:{id:"' + id + '"} either');
}

/* ---------------------------------------------------------- 2. no orphaned ids */

/* An id in the markup that nothing references is usually the leftover half of a
   move. An id is "used" if the script queries it, if it is a styling hook
   (MARKUP includes the <style> block, so a `#foo{...}` rule counts), or if an
   <use href="#id"> points at it.

   Icon symbols (i-*) are exempt: the sprite is a library, and carrying a symbol
   before the feature that uses it exists is deliberate, not a leftover. What
   matters for icons is the reverse direction, checked below.

   "fontcss" is exempt for a different reason: it names the bundled-font
   <style> block (see the house-rules section below), and its only reader is
   this suite — it is the anchor the byte-identity, ordering and @font-face
   checks locate the block by. The app itself has no reason to query it, the
   same "used by the test, not the app" shape i-* gets, so it is not a
   leftover either. */
for(const id of declared){
  if(id.startsWith("i-") || id === "fontcss") continue;
  /* aria-controls / aria-labelledby / aria-describedby point at an id without a
     "#", and an id wired only that way is genuinely in use — the tab/panel and
     dialog/title relationships are exactly that. */
  const ariaRef = new RegExp('aria-(?:controls|labelledby|describedby|activedescendant)="'
    + '(?:[^"]*\\s)?' + id + '(?:\\s[^"]*)?"').test(MARKUP);
  const used = referenced.includes(id)
            || SCRIPT.includes('getElementById("' + id + '")')
            || SCRIPT.includes("#" + id)
            || MARKUP.includes('href="#' + id + '"')
            || ariaRef
            || new RegExp("#" + id + "\\s*[{,:.\\[]").test(MARKUP);
  check(used, 'ORPHAN ELEMENT: id="' + id + '" exists in the markup but nothing uses it');
}

/* ---------------------------------------------------------- 2b. icon references resolve */

/* A mistyped <use href="#i-foo"> renders precisely nothing — no error, no
   fallback, just a blank space where the icon should be. */
const symbols = uniq(matchAll(/<symbol[^>]*\bid="(i-[\w-]+)"/g, HTML).map(m => m[1]));
/* Two ways an icon is referenced now: written into the static markup as
   <use href="#i-…">, or built by icon("#i-…") in a DOM-constructed control.
   Both must be read, or converting a control from markup to DOM would silently
   drop it out of this check. */
const iconUses = uniq(
  matchAll(/<use\s+href="#(i-[\w-]+)"/g, HTML).map(m => m[1])
  .concat(matchAll(/\bicon\("#(i-[\w-]+)"\)/g, SCRIPT).map(m => m[1])));

check(symbols.length > 0, "the icon sprite defines at least one symbol");
for(const ref of iconUses){
  check(symbols.includes(ref),
    'BROKEN ICON: <use href="#' + ref + '"> has no matching <symbol id="' + ref + '"> — it renders as nothing');
}
/* The sprite mixes Google's icons with this project's own artwork, so "which
   symbols are third-party" has to be answered by something other than the
   sprite. The source files in
   sprites/ are that answer: every symbol's ordered `d` path data is compared,
   byte-for-byte, against every file in sprites/, and the file it matches is
   its provenance record — a Material Symbols download for Google's artwork,
   sprites/logo.svg for this project's own mark. Nothing here trusts a
   hand-written table naming the mapping; the mapping is derived from the
   actual bytes on both sides, which is what makes it a second writer rather
   than a restatement. Everything in the sprite that matches no download is
   this project's own artwork, and the rest of this suite — the viewBox rule,
   NOTICE's count, the PLACEHOLDER boundary — is measured against the split
   rather than restating it three times. sprites/ may hold files the sprite
   does not use (parked candidates); every SYMBOL must resolve to a file, not
   the reverse. */
const spriteSourceFiles = listDir(here() + "sprites").filter(f => /\.svg$/.test(f));
const spriteSourceD = {};
for(const f of spriteSourceFiles){
  spriteSourceD[f] = matchAll(/\bd="([^"]+)"/g, readFile(here() + "sprites/" + f)).map(m => m[1]);
}
const symbolSourceFiles = {};
for(const s of symbols){
  const tagMatch = new RegExp('<symbol[^>]*\\bid="' + s + '"[^>]*>([\\s\\S]*?)</symbol>').exec(HTML);
  const ds = tagMatch ? matchAll(/\bd="([^"]+)"/g, tagMatch[1]).map(m => m[1]) : [];
  symbolSourceFiles[s] = ds.length === 0 ? [] : spriteSourceFiles.filter(f => {
    const fd = spriteSourceD[f] || [];
    return fd.length === ds.length && fd.every((d, i) => d === ds[i]);
  });
  check(symbolSourceFiles[s].length > 0,
    "icon #" + s + "'s path data matches a source file in sprites/ — provenance unknown otherwise");
}
const materialSymbols = symbols.filter(s =>
  symbolSourceFiles[s].some(f => /_40dp_E3E3E3_FILL0_wght400_GRAD0_opsz40\.svg$/.test(f)));
const ownSymbols = symbols.filter(s => !materialSymbols.includes(s));

/* Google's own icons all come off the same 40dp grid, and one that does not is
   either a bad download or not theirs. This project's mark keeps the artwork's
   own canvas instead — but it must still declare one, or it scales to whatever
   the first <use> asked for. */
for(const s of symbols){
  const tag = (new RegExp('<symbol[^>]*id="' + s + '"[^>]*>').exec(HTML) || [""])[0];
  if(ownSymbols.includes(s)){
    check(/viewBox="0 0 \d+ \d+"/.test(tag),
      "icon " + s + " is this project's own artwork and declares its own viewBox — "
      + "it is not held to Google's 960 grid, but it cannot go without one");
    continue;
  }
  check(/viewBox="0 -960 960 960"/.test(tag),
    "icon " + s + " keeps the Material Symbols viewBox");
}
/* The other half of "unmodified download, fill stripped", and it was guarded for
   exactly one symbol — #i-logo, down in the About section, and only as a foil to
   sprites/logo.svg keeping its literal fill. Every symbol in here is subject to
   the rule: a Google download arrives as fill="#e3e3e3", that attribute beats the
   .ic rule's `fill:currentColor` on the element it sits on, and the icon then
   paints pale grey in every home at once — in a button, in a menu row, in the
   title bar and in a link. Adding a symbol is the moment it happens, because
   what you paste from is the file that still has it. So the rule is asserted
   over the class rather than per instance, which is what makes it cover the next
   symbol nobody has added yet. `fill-rule` and `fill-opacity` are untouched: the
   pattern wants `fill` followed immediately by `=`. */
for(const s of symbols){
  const sym = (new RegExp('<symbol[^>]*id="' + s + '"[\\s\\S]*?</symbol>').exec(HTML) || [""])[0];
  check(sym && !/\bfill="/.test(sym),
    "icon " + s + " carries no fill of its own, so currentColor decides its colour "
    + "in every home — strip the source fill when you paste a download in");
}
/* An href assembled at runtime — <use href="#i-'+x+'"> or icon("#i-" + x) —
   cannot be checked statically, so the reference above is worthless if any
   exist. Fail on them: icon names must be written out in full. */
for(const re of [/<use\s+href="#i-'\s*\+/g, /\bicon\(\s*(?!"#i-[\w-]+"\s*\))/g]){
  for(const m of matchAll(re, SCRIPT)){
    /* the declaration `function icon(href){` is the one legitimate icon( that
       is not a call site */
    if(SCRIPT.slice(Math.max(0, m.index - 9), m.index) === "function ") continue;
    check(false, "DYNAMIC ICON REFERENCE at offset " + m.index +
      " — build the full href in each branch so it can be verified");
  }
}

/* A spare symbol is a failure: an unused symbol is not free — it is
   third-party artwork NOTICE's count and the sprite's own provenance check both
   have to keep accounting for. If you are adding an icon before the code that
   uses it, wire the two together in the same change. */
const unusedIcons = symbols.filter(s => !iconUses.includes(s));
check(unusedIcons.length === 0,
  "the sprite carries no unreferenced symbols — spare: " + unusedIcons.join(", "));

/* NOTICE states a count, and a count is exactly the kind of claim that goes
   stale silently. It is an attribution document for someone else's artwork, so
   it has to agree with what actually ships. A blanket sentence like "All N
   icons … are Material Symbols" would turn any own-work symbol into one
   credited to Google, silently, and a bare total would still add up even so.
   So NOTICE states two numbers and both are checked, against two different
   writers — the sprite for the total, the matched files in sprites/ for how
   many of them are Google's. */
{
  const notice = readFile(here() + "NOTICE");
  const m = /(\d+) of the (\d+) icons in the inline sprite are Material Symbols/.exec(notice);
  check(!!m, "NOTICE still states how many of the sprite's icons are Material Symbols "
    + "and how many it carries");
  check(m && Number(m[2]) === symbols.length,
    "and the total matches the sprite — NOTICE says " + (m && m[2])
    + ", the sprite has " + symbols.length);
  check(m && Number(m[1]) === materialSymbols.length,
    "and the Material Symbols figure excludes this project's own artwork — NOTICE says "
    + (m && m[1]) + " are Google's, sprites/ resolves " + materialSymbols.length
    + " symbols to a *_40dp_E3E3E3_FILL0_wght400_GRAD0_opsz40.svg download");
  check(ownSymbols.length === symbols.length - materialSymbols.length,
    "every symbol is on exactly one side of that split — " + symbols.length + " in the sprite, "
    + materialSymbols.length + " attributed to Google, " + ownSymbols.length + " own work");
}

/* ---------------------------------------------------------- 2c. data-cmd coverage */

/* Commands are dispatched by name, and the whole point is that one command can
   appear in several places. That makes both directions easy to get wrong: a
   button naming a command that does not exist does nothing when clicked, and a
   command nothing points at is dead code. */
const cmdEmitted  = uniq(matchAll(/data-cmd="([A-Za-z]+)"/g, HTML).map(m => m[1]));
const cmdTable    = /const COMMANDS\s*=\s*\{([\s\S]*?)\n\};/.exec(SCRIPT);
check(!!cmdTable, "the COMMANDS table is present");
const cmdDefined  = cmdTable
  ? uniq(matchAll(/^\s{2}([A-Za-z]+):/gm, cmdTable[1]).map(m => m[1]))
  : [];

for(const c of cmdEmitted){
  check(cmdDefined.includes(c),
    'DEAD BUTTON: data-cmd="' + c + '" has no entry in COMMANDS — clicking it does nothing');
}
for(const c of cmdDefined){
  check(cmdEmitted.includes(c),
    'UNREACHABLE COMMAND: COMMANDS.' + c + ' exists but no element carries data-cmd="' + c + '"');
}

/* ---------------------------------------------------------- 2d. no orphaned classes */

/* §2 polices ids and nothing policed classes, which is how `.rb-row`,
   `.info-doc .lic`, `.style-command.disabled` and `button.icon` all reached the
   stylesheet's end of life without anyone noticing. This is §2 for classes: a
   rule whose class nothing applies is dead weight the next reader has to
   re-judge.

   The two sides:

   DECLARED — every `.name` in a selector prelude. Preludes are the text runs
   that end at a `{`, so declaration bodies are never scanned: `opacity:.9` and
   `rgba(0,0,0,.12)` cannot be mistaken for classes, and a leading digit is
   excluded anyway. CSS comments are stripped first, on the same principle
   SCRIPT is — this stylesheet's comments legitimately name classes while
   explaining them, and counting prose would hide a rule behind its own
   documentation.

   USED — the four mechanisms that actually put a class on an element:
   `class="…"` in the body markup, `cls:` in an `el()` spec, `classList.*()`,
   and `className` / `setAttribute("class", …)`. Deliberately NOT "the token
   appears in some string literal": `open` is a `.g-chip.open` class AND a
   `data-tact` verb, and a sweep of every literal would call every such rule
   used forever. HTML comments are stripped for the same reason CSS ones are.

   Classes that cannot be resolved by reading text: a name assembled from a
   non-literal (`cls: "g-" + kind`) contributes no token here, so its rule is
   REPORTED, not passed. That is the direction this check has to fail in — the
   two dead rules above would both have been passed by anything that shrugged at
   what it could not resolve. The cost is a false red naming the rule, and the
   fix is an exception entry that names the site applying the class; there is no
   exception list today because every class this app applies is written out
   somewhere as a literal, ternary arms and `"p-row" + " open"` included. */
(() => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(HTML);
  const CSS = (css ? css[1] : "").replace(/\/\*[\s\S]*?\*\//g, " ");
  /* the body only: the <style> block is inside MARKUP and holds no elements */
  const BODY = MARKUP.slice(MARKUP.indexOf("</style>")).replace(/<!--[\s\S]*?-->/g, " ");

  const tokens  = s => s.split(/\s+/).filter(Boolean);
  const litsIn  = s => matchAll(/"([^"]*)"|'([^']*)'/g, s)
    .map(m => m[1] !== undefined ? m[1] : m[2]).flatMap(tokens);
  /* classList.toggle's second argument is a force flag, and it is often a
     comparison against a string ‒ toggle("clear", L.bg === "transparent"). Only
     the leading run of literal arguments is the class list. */
  const leadLits = s => {
    const out = []; const re = /\s*(?:"([^"]*)"|'([^']*)')\s*(,|$)/g;
    let m, at = 0;
    while((m = re.exec(s)) && m.index === at){
      out.push(m[1] !== undefined ? m[1] : m[2]);
      at = re.lastIndex;
      if(m[3] !== ",") break;
    }
    return out.flatMap(tokens);
  };

  const declaredClasses = uniq(matchAll(/([^{}]*)\{/g, CSS)
    .flatMap(m => matchAll(/\.([A-Za-z_][\w-]*)/g, m[1]).map(x => x[1])));

  const usedClasses = uniq([]
    .concat(matchAll(/\bclass="([^"]*)"/g, BODY).flatMap(m => tokens(m[1])))
    .concat(matchAll(/\bcls:\s*([^,}]*)/g, SCRIPT).flatMap(m => litsIn(m[1])))
    .concat(matchAll(/\bclassList\.(?:add|remove|toggle|contains|replace)\(([^)]*)\)/g, SCRIPT)
      .flatMap(m => leadLits(m[1])))
    .concat(matchAll(/\bclassName\s*=\s*([^;]*)/g, SCRIPT).flatMap(m => litsIn(m[1])))
    .concat(matchAll(/setAttribute\(\s*"class"\s*,\s*([^)]*)\)/g, SCRIPT)
      .flatMap(m => litsIn(m[1])))
    /* makeDragSurface applies its slot class from cfg.slotClass, not a literal
       at the call site — the literal lives one hop away, in each instance's
       own config. */
    .concat(matchAll(/\bslotClass:\s*([^,}]*)/g, SCRIPT).flatMap(m => litsIn(m[1]))));

  /* Both extractions are anchors for the loop below, and an empty one would
     make it pass by having nothing to say. They get their own assertions so a
     regex that stops matching is reported as itself rather than as silence. */
  check(declaredClasses.length > 50,
    "the stylesheet's class selectors are extractable (found " + declaredClasses.length + ")");
  check(usedClasses.length > 50,
    "the classes the app applies are extractable (found " + usedClasses.length + ")");

  for(const c of declaredClasses){
    check(usedClasses.includes(c),
      'ORPHAN RULE: the stylesheet styles .' + c + ' but no class="", cls:, '
      + 'classList call or className assignment ever applies it');
  }
})();

/* ------------------------------------------ 2e. every .hidden-toggled section
   hides via CSS too, not only via the [hidden] attribute

   [hidden]'s UA rule is display:none, but an author rule at the SAME
   specificity that sets display overrides it regardless of source order —
   for example, .add-photo-empty{display:flex} would silently defeat
   `empty.hidden = true`, putting the placeholder circle and the framing
   editor on screen together, unless a companion rule,
   .add-photo-empty[hidden]{display:none}, exists. This check is that
   companion-rule requirement turned into a class check, so the next section
   somebody toggles with .hidden under a class that sets display is caught
   here rather than in a screenshot two steps from now.

   Resolving every $("#id").hidden = write in the whole script back to an id
   is impractical without a real parser: $("#id") is routinely bound to a
   short local name (well, empty, chip, bar, m, p…) and the SAME name means a
   different element in a different function, so a whole-script name→id map
   would misattribute writes across functions. The script side of this scan
   is honestly scoped instead to two sources of truth:
     (a) every bare $("#id").hidden = site anywhere — no resolution needed,
     (b) the modal dialogs' own top-level functions, where a local variable
         bound via `const NAME = $("#id")` earlier in the SAME function body
         is resolved only within that body, so two functions using the same
         local name can never cross-contaminate each other's id.
   A .hidden write reached through a variable bound outside these functions —
   there are a few, e.g. contrast/status-bar chips — is not covered; this
   scope is a deliberate choice over a full scan.

   That script-side scan still misses two whole families: elements a function
   toggles only through a compound selector local (`$("#fontMenu .font-legend")`
   bound to `legend`, then `legend.hidden = …` — no bare id to catch, and
   syncFontAvailability isn't a modal function) and every ribbon menu opened
   through the shared openMenu()/closeMenu() pair, which writes `m.hidden`
   through a table-driven `$(spec.menu)` no static regex can resolve at all.
   Both are covered instead by a THIRD, independent source that needs no
   script resolution: every element the MARKUP itself marks `hidden` — a
   div/menu/dialog that starts hidden always carries the attribute on the tag,
   whether or not a script ever flips it back off. Reading id and class
   straight off that tag is exactly how .font-legend (:1807, no id, class
   only) and the whole RIBBON_MENUS family enter this check. SVG elements are
   excluded on purpose: `icon.hidden = true` on an SVGElement sets a plain JS
   property with no reflected attribute (see the comment at :192–196), so an
   SVG can never legitimately carry a static `hidden` attribute here — the one
   that does, the #icons sprite container, carries no class and so
   contributes nothing to the check either way. */
(() => {
  const MODAL_FNS = ["openAddModal","closeAddModal","setAddPhoto",
    "syncAddAvailability","openEditModal","closeEditModal","syncEditModal",
    "openPasteModal","closePasteModal","showPastePreview","confirmPaste",
    "askImport","importClose"];

  function fnBody(name){
    const re = new RegExp("(^|\\n)(async\\s+)?function\\s+" + name + "\\s*\\(");
    const m = re.exec(SCRIPT);
    if(!m) return "";
    let depth = 0, open = SCRIPT.indexOf("{", m.index);
    for(let j = open; j < SCRIPT.length; j++){
      if(SCRIPT[j] === "{") depth++;
      else if(SCRIPT[j] === "}" && --depth === 0) return SCRIPT.slice(open, j + 1);
    }
    return "";
  }

  const hiddenIds = new Set();
  for(const m of matchAll(/\$\("#([\w-]+)"\)\.hidden\s*=/g, SCRIPT)) hiddenIds.add(m[1]);
  for(const name of MODAL_FNS){
    const body = fnBody(name);
    if(!body) continue;
    const binds = {};
    for(const m of matchAll(/(?:const|let)\s+(\w+)\s*=\s*\$\("#([\w-]+)"\)/g, body))
      binds[m[1]] = m[2];
    for(const m of matchAll(/\b(\w+)\.hidden\s*=/g, body))
      if(binds[m[1]]) hiddenIds.add(binds[m[1]]);
  }
  /* The two script-side anchors this half is built around — an empty set here
     would make everything below pass by having nothing to check. */
  check(hiddenIds.has("addPhotoEmpty") && hiddenIds.has("addPhotoWell"),
    "the scan resolves both halves of the Add photo section this check "
    + "protects — got " + [...hiddenIds].sort().join(", "));

  const css = /<style>([\s\S]*?)<\/style>/.exec(HTML);
  const CSS = (css ? css[1] : "").replace(/\/\*[\s\S]*?\*\//g, " ");

  /* class -> a representative element label, for the failure message. One
     entry per class is deliberate (see CLAUDE.md: prefer a class check to a
     case check) — a companion rule guards the CLASS, so two elements sharing
     one undeclared class must not produce two assertions over one true gap. */
  const classesToCheck = new Map();
  function noteClass(cls, label){
    if(!classesToCheck.has(cls)) classesToCheck.set(cls, label);
  }
  function classesOfId(id){
    const tagMatch = new RegExp('<[a-z]+ class="([^"]*)" id="' + id + '"').exec(MARKUP)
                   || new RegExp('<[a-z]+ id="' + id + '" class="([^"]*)"').exec(MARKUP);
    if(!tagMatch) return;        // no static class on this element — nothing can override [hidden]
    for(const cls of tagMatch[1].split(/\s+/).filter(Boolean)) noteClass(cls, "#" + id);
  }

  for(const id of hiddenIds) classesOfId(id);

  /* The markup source: every tag carrying a literal `hidden` attribute,
     read for its own id (folded back into the id resolution above, so an
     id AND class both present is not checked twice) and its own class list
     (for id-less elements like .font-legend, which have no other way in). */
  const HIDDEN_TAG = /<([a-z][a-z0-9]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s+hidden(?=[\s>])/g;
  let markupHiddenCount = 0;
  for(const m of matchAll(HIDDEN_TAG, MARKUP)){
    if(m[1] === "svg") continue;               // TRAP SVG — see the comment above
    markupHiddenCount++;
    const attrs = m[2];
    const idm  = /\sid="([^"]*)"/.exec(attrs);
    const clsm = /\sclass="([^"]*)"/.exec(attrs);
    if(idm) classesOfId(idm[1]);
    if(clsm) for(const cls of clsm[1].split(/\s+/).filter(Boolean)) noteClass(cls, "." + cls);
  }
  /* The markup-source anchor — proves .font-legend, which has no id and
     reaches this check only through its own `hidden` attribute, was found. */
  check(markupHiddenCount > 30 && classesToCheck.has("font-legend"),
    "the markup scan resolves .font-legend as a hidden-by-default element "
    + "(found " + markupHiddenCount + " markup-hidden tags)");

  for(const [cls, label] of classesToCheck){
    const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rule = new RegExp("\\." + esc + "(?:,[^{]*)?\\{([^}]*)\\}").exec(CSS);
    if(!rule || !/display\s*:/.test(rule[1])) continue;    // this class sets no display — [hidden] is undisturbed
    const companion = new RegExp("\\." + esc + "\\[hidden\\]\\s*\\{\\s*display\\s*:\\s*none\\s*\\}");
    check(companion.test(CSS),
      label + "'s class ." + cls + " sets display, so it needs its own ."
      + cls + "[hidden]{display:none} companion rule or .hidden = true silently "
      + "stops hiding it, exactly as it would for .add-photo-empty without one");
  }
})();

/* ---------------------------------------------------------- 3. delegated verbs are handled */

/* The roster and grade editors emit buttons/inputs carrying a verb, then a single
   delegated listener switches on it. An emitted verb with no branch is a dead
   control; a handled verb never emitted is dead code. */
/* Controls are emitted either as markup strings — data-act="del" — or built
   as elements through el({act:"del"}). Both spellings are read, because the
   check is worthless if a control can escape it simply by changing how it is
   constructed: reading only one spelling would silently narrow coverage as
   controls move between the two forms, with fewer matches and no failure to
   show for it. */
function verbs(attr){
  const short = attr.replace(/^data-/, "");           // data-act -> act
  return uniq(
    matchAll(new RegExp(attr + '="([a-z]+)"', "g"), SCRIPT).map(m => m[1])
    .concat(matchAll(new RegExp("\\b" + short + ':\\s*"([a-z]+)"', "g"), SCRIPT).map(m => m[1])));
}

const emitted = {
  "data-act":  verbs("data-act"),
  "data-tact": verbs("data-tact"),
  "data-fact": verbs("data-fact")
};

/* how each family is dispatched, as actually written in the script */
const handled = {
  /* if(act==="del") … */
  "data-act":  uniq(matchAll(/\bact\s*===\s*"([a-z]+)"/g, SCRIPT).map(m => m[1])),
  "data-tact": uniq(matchAll(/\bact\s*===\s*"([a-z]+)"/g, SCRIPT).map(m => m[1])),
  /* framing uses dataset.fact and closest('[data-fact="pan"]') */
  "data-fact": uniq(
      matchAll(/\bact\s*===\s*"([a-z]+)"/g, SCRIPT).map(m => m[1])
      .concat(matchAll(/dataset\.fact\s*!==\s*"([a-z]+)"/g, SCRIPT).map(m => m[1]))
      .concat(matchAll(/closest\('\[data-fact="([a-z]+)"\]'\)/g, SCRIPT).map(m => m[1])))
};

for(const attr of Object.keys(emitted)){
  for(const v of emitted[attr]){
    check(handled[attr].includes(v),
      "DEAD CONTROL: " + attr + '="' + v + '" is emitted but no handler branches on it');
  }
}

/* ---------------------------------------------------------- 4. delegation roots exist at boot */

/* These must be in the DOM when the script runs, or addEventListener throws and
   the whole IIFE dies. Tab bodies must therefore be rendered and hidden with CSS,
   never created lazily on first tab click. */
const DELEGATION_ROOTS = uniq(
  matchAll(/\$\("#([A-Za-z0-9_-]+)"\)\.addEventListener/g, SCRIPT).map(m => m[1]));
for(const id of DELEGATION_ROOTS){
  check(declared.includes(id),
    "BOOT FAILURE: $(\"#" + id + "\").addEventListener would throw — no such element in the markup");
}

/* ---------------------------------------------------------- 4b. no markup built from data */

/* The reason the UI is built from elements rather than markup strings: a
   roster file carries names, codes, labels and photo data written by someone
   else, and the moment any of it is
   concatenated into a markup string it stops being data. So the UI is built
   from elements, and the only innerHTML left is the one that parses a complete
   SVG document the app generated itself.

   This is a blunt check on purpose. A precise one — "is THIS innerHTML fed
   untrusted data?" — cannot be decided by reading the source, and the blunt
   version has a useful property: adding an innerHTML makes the test fail and
   forces the author to come here and say why it is safe. */
{
  const writes = matchAll(/\.innerHTML\s*=/g, SCRIPT);
  check(writes.length === 1,
    "exactly one innerHTML assignment remains (found " + writes.length + ") — "
    + "build UI from elements, not markup strings");
  const line = writes.length === 1
    ? SCRIPT.slice(SCRIPT.lastIndexOf("\n", writes[0].index) + 1,
                   SCRIPT.indexOf("\n", writes[0].index))
    : "";
  check(/\$\("#sheet"\)\.innerHTML\s*=\s*toSVG\(L\);?/.test(line.trim()),
    'the surviving innerHTML is $("#sheet").innerHTML = toSVG(L) — got: ' + line.trim());

  /* insertAdjacentHTML, outerHTML and document.write are the same hazard by
     another name, and none of them has ever been used here */
  for(const bad of ["insertAdjacentHTML", "outerHTML", "document.write"]){
    check(!SCRIPT.includes(bad), "no " + bad + " (it is innerHTML with a different name)");
  }
}

/* Every value the SVG writer interpolates has to pass a guard, because the SVG
   is the one output that still leaves this app as markup. These are the guards;
   losing one silently would reopen the hole the fixtures were written for. */
for(const fn of ["xmlText", "xmlAttr", "paint", "validatePhoto", "parseAndValidateRoster",
                 "decodeImage", "photoSizeProblem", "decodeRosterPhotos", "openRoster"]){
  check(new RegExp("(async\\s+)?function\\s+" + fn + "\\s*\\(").test(SCRIPT),
    "the " + fn + "() guard still exists");
}
/* the file-open path must go through the validator and nothing else */
check(/openRoster\(fr\.result\s*[,)]/.test(SCRIPT),
  "the roster file reader hands its text to openRoster");
/* …and hands it the cancellation predicate, or a superseded Open goes on
   decoding every photo it was never going to be allowed to adopt */
check(/openRoster\(fr\.result\s*,\s*\{\s*cancelled\s*:/.test(SCRIPT),
  "and gives it a way to be told the Open has been superseded");
check(/function\s+openRoster[\s\S]{0,400}parseAndValidateRoster\(raw\)/.test(SCRIPT),
  "openRoster proves the structure before it decodes anything");
/* There is no normalising pass in front of the validator, and nothing
   may quietly reintroduce one: parseAndValidateRoster answers for every field a
   file omits, and it is the only door a roster comes through. */
check(!/function migrate\(/.test(SCRIPT),
  "no migrate() has crept back in beside the validator");
check(!/state\s*=\s*migrate\(/.test(SCRIPT),
  "and nothing is wired straight into state ahead of it");

/* ---------------------------------------------------------- 4c. exports cannot strand a button */

/* Every export disables its own button while it runs. Before exportWrap owned
   that, an early return could leave the button disabled with nothing to
   re-enable it, and the app looked broken until reload. These are static
   checks because the failure needs a real canvas to reproduce. */
{
  const EXPORTS = ["copyPng", "exportPng", "exportPdf", "exportSvg", "exportCsv"];
  const table = /const COMMANDS\s*=\s*\{([\s\S]*?)\n\};/.exec(SCRIPT);
  check(!!table, "the COMMANDS table is readable");
  for(const cmd of EXPORTS){
    const entry = table && new RegExp(cmd + ":\\s*\\(\\)\\s*=>\\s*exportWrap\\(\"" + cmd + "\"").test(table[1]);
    check(entry, "COMMANDS." + cmd + " goes through exportWrap(\"" + cmd + "\")");
  }
  /* CSV has no canvas/PDF machinery of its own to check above, but its body
     has three things nothing else in the table proves: the BOM is prepended
     to toCSV's output (not baked into toCSV itself, which stays a clean
     serializer), the blob is typed text/csv, and the filename reuses
     fileStem() like every other export. */
  {
    const csv = table && /exportCsv:[\s\S]*?\n  \}\),/.exec(table[1]);
    check(!!csv, "COMMANDS.exportCsv's body is readable");
    check(csv && /"﻿"\s*\+\s*toCSV\(state\)/.test(csv[0]),
      "exportCsv prepends the UTF-8 BOM to toCSV(state) at the command site, not inside toCSV");
    check(csv && /type:\s*"text\/csv;charset=utf-8"/.test(csv[0]),
      "exportCsv's Blob is typed text/csv;charset=utf-8");
    check(csv && /fileStem\(\)\s*\+\s*"\.csv"/.test(csv[0]),
      "exportCsv downloads to fileStem() + \".csv\", like every other export");
  }
  check(/function exportWrap\(/.test(SCRIPT), "exportWrap exists");
  /* the finally is the whole point of the wrapper */
  const wrap = /function exportWrap\([\s\S]*?\n\}/.exec(SCRIPT);
  check(wrap && /\.finally\(/.test(wrap[0]), "exportWrap restores the buttons in a finally");
  check(wrap && /\.catch\(/.test(wrap[0]), "exportWrap catches a failed export");
  check(wrap && /el\.disabled = true/.test(wrap[0]), "exportWrap disables while running");

  /* toBlob hands back null on an encoder failure; nothing may use it raw */
  check(/function canvasBlob\(/.test(SCRIPT), "canvasBlob wraps toBlob");
  const blobFn = /function canvasBlob\([\s\S]*?\n\}/.exec(SCRIPT);
  check(blobFn && /b \? res\(b\) : rej\(/.test(blobFn[0]), "canvasBlob rejects a null blob");
  const rawToBlob = matchAll(/\.toBlob\(/g, SCRIPT);
  check(rawToBlob.length === 1, "toBlob is called in exactly one place, inside canvasBlob (found "
    + rawToBlob.length + ")");

  /* The PDF must not go back through the base64 round trip it was rebuilt to
     avoid. Scoped to toPDF: processImage legitimately still produces a data
     URL, because that is the form a photo is stored in. */
  const pdf = /async function toPDF\([\s\S]*?\n\}/.exec(SCRIPT);
  check(!!pdf, "toPDF is readable");
  check(pdf && /canvasBlob\(/.test(pdf[0]), "toPDF gets its JPEG bytes from canvasBlob");
  check(pdf && /arrayBuffer\(\)/.test(pdf[0]), "toPDF reads the blob as an ArrayBuffer");
  check(pdf && !/toDataURL/.test(pdf[0]), "toPDF does not round-trip through a data URL");
  check(pdf && !/atob\(/.test(pdf[0]), "toPDF has no base64 decode step");
  check(pdf && !/charCodeAt/.test(pdf[0]), "toPDF has no per-byte copy loop");

  /* copy-to-clipboard is unavailable on file:// in most browsers */
  check(/function canCopyImage\(/.test(SCRIPT), "clipboard support is feature-detected");
  const cc = /function canCopyImage\([\s\S]*?\n\}/.exec(SCRIPT);
  check(cc && /typeof ClipboardItem !== "undefined"/.test(cc[0]), "ClipboardItem itself is detected");
  check(cc && /navigator\.clipboard && navigator\.clipboard\.write/.test(cc[0]),
    "the async clipboard write is detected");
  check(/applyClipboardSupport\(\)/.test(SCRIPT), "the detection is applied at boot");
}

/* ---------------------------------------------------------- 4d. accessibility */

/* None of this is visible in a screenshot, and all of it is easy to delete by
   accident while moving markup. Static checks are enough for the structural
   half; the behavioural half (focus order, VoiceOver) is in test/MANUAL.md. */
{
  /* --- the document is a document */
  check(/^<!doctype html>/i.test(HTML.trim()), "the file starts with a doctype");
  check(/<html lang="[a-z]{2}(-[A-Za-z]+)?"[^>]*>/.test(HTML),
    "html carries a language, so text is announced with the right voice");
  check(/<head>/.test(HTML) && /<\/head>/.test(HTML), "there is an explicit head");
  check(/<body>/.test(HTML) && /<\/body>/.test(HTML), "there is an explicit body");
  check(HTML.indexOf("<head>") < HTML.indexOf("<body>"), "head comes before body");
  check(/<meta charset="utf-8">/i.test(HTML), "the charset is still declared first");

  /* --- tabs */
  check(/role="tablist"/.test(MARKUP), "the ribbon is a tablist");
  const tabs  = matchAll(/<button[^>]*class="rb-tab[^"]*"[^>]*>/g, MARKUP).map(m => m[0]);
  const panes = matchAll(/<div class="rb-pane[^"]*"[^>]*>/g, MARKUP).map(m => m[0]);
  check(tabs.length === 3, "all three ribbon tabs are present (found " + tabs.length + ")");
  check(panes.length === 3, "all three ribbon panes are present (found " + panes.length + ")");
  for(const t of tabs){
    check(/role="tab"/.test(t), "each ribbon tab has role=tab");
    check(/aria-controls="pane-[a-z]+"/.test(t), "each ribbon tab names the pane it controls");
    check(/id="tab-[a-z]+"/.test(t), "each ribbon tab has an id its pane can point back at");
  }
  for(const p of panes){
    check(/role="tabpanel"/.test(p), "each ribbon pane has role=tabpanel");
    check(/aria-labelledby="tab-[a-z]+"/.test(p), "each ribbon pane names its tab");
    check(/id="pane-[a-z]+"/.test(p), "each ribbon pane has an id its tab can point at");
  }
  /* The visible wording and the internal hooks are deliberately different, and
     both halves are pinned here. A relabel that renamed data-tab/id along with
     the text would take selectTab, the panes, the CSS and half this suite with
     it; a rename that "tidied" the labels back would undo the relabel. Matching
     the pair together is what says the split is on purpose. */
  {
    const NAMED = [["file", "Start"], ["grades", "Structure"], ["design", "Design"]];
    const labelled = matchAll(/<button[^>]*class="rb-tab[^"]*"[^>]*data-tab="([a-z]+)"[^>]*>([^<]*)</g,
                              MARKUP).map(m => [m[1], m[2].trim()]);
    for(const [hook, label] of NAMED){
      const got = labelled.find(l => l[0] === hook);
      check(got && got[1] === label,
        "the " + hook + " tab reads \"" + label + "\" — got " + JSON.stringify(got && got[1]));
      /* the hook is not renamed to follow the label */
      check(new RegExp('data-tab="' + hook + '"[^>]*id="tab-' + hook
                     + '"[^>]*aria-controls="pane-' + hook + '"').test(MARKUP),
        "and its data-tab, id and aria-controls all stay \"" + hook + "\"");
      check(new RegExp('<div class="rb-pane[^"]*"[^>]*data-pane="' + hook
                     + '"[^>]*id="pane-' + hook + '"').test(MARKUP),
        "and the pane it controls keeps the same hook");
    }
    /* the visible tab wording must not leak into the hooks */
    check(!/data-tab="(start|people|structure|style)"/.test(MARKUP)
       && !/data-pane="(start|people|structure|style)"/.test(MARKUP)
       && !/id="(tab|pane)-(start|people|structure|style)"/.test(MARKUP),
      "no hook matches the visible tab wording");
    check(!/data-tab="roster"|data-pane="roster"|id="(?:tab|pane)-roster"/.test(MARKUP),
      "there is no tab or pane using the roster hook — a removed feature must "
      + "not leave an empty placeholder behind");
    check(!/id="tab-info"/.test(MARKUP) && !/id="pane-info"/.test(MARKUP),
      "Info is a group in Start, not an empty tab and pane");
  }

  /* ---- attach / share is one rule, in one function ----
     What matters is that there is exactly one place to change the
     invariant, and that every producer of a tiers array goes through that
     place — scattering it across defaults(), the import validator and the
     panel's own controls is how they end up contradicting each other. */
  {
    const fn = /function normalizeGradeLinks\(tiers\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!fn, "normalizeGradeLinks is readable");
    if(fn){
      check(/i === 0/.test(fn[0]) && /t\.attach = false; t\.merge = false;/.test(fn[0]),
        "the first grade is cleared of both flags");
      check(/t\.attach = t\.merge \|\| t\.attach === true/.test(fn[0]),
        "and sharing implies attaching");
      check(!/toast\(|commit\(|markDirty\(|render/.test(fn[0]),
        "it only normalizes — it does not render, commit or report");
    }
    /* every producer runs it */
    for(const [name, rx] of [
      ["TEMPLATES",               /const TEMPLATES = \[[\s\S]*?\n\];/],
      ["parseAndValidateRoster",  /function parseAndValidateRoster\(raw\)[\s\S]*?\n\}/]
    ]){
      const m = rx.exec(SCRIPT);
      check(!!m, name + " is readable");
      check(m && /normalizeGradeLinks\(/.test(m[0]),
        name + " normalizes through the shared helper rather than restating the rule");
      if(name === "TEMPLATES")
        check(m && (m[0].match(/normalizeGradeLinks\(/g) || []).length === 3,
          "…and all three templates do, not just one — a class check over every entry");
    }
    const defaults = /function defaults\(\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(defaults && /tiers:\[\]/.test(defaults[0]),
      "New ships no grades at all — Templates under Structure is how a document "
      + "gets its first structure now");
    /* and the UI mutations, each inside ONE commit. They live in the CLICK
       handler with Fill and People: all four are buttons now, and a button
       fires no input event. */
    const clk = /\$\("#gradePanel"\)\.addEventListener\("click"[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(!!clk, "the grade editor's click handler is readable");
    const inp = /\$\("#gradePanel"\)\.addEventListener\("input"[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(inp && !/act==="attach"/.test(inp[0]) && !/act==="merge"/.test(inp[0]),
      "Attach and Share have left the input handler, where a button fires nothing");
    const links = clk && /if\(act==="attach"\|\|act==="merge"\)\{[\s\S]*?\n  \}/.exec(clk[0]);
    check(!!links, "and are handled on click, where their buttons are");
    if(links){
      const attach = /if\(act==="attach"\) commit\([\s\S]*?\{render:"chart"\}\);/.exec(links[0]);
      const merge  = /else commit\(\(on\?"shared a band with "[\s\S]*?\{render:"chart"\}\);/
                       .exec(links[0]);
      check(!!attach && !!merge, "both toggles are wired");
      /* A toggle has no .checked to read, so the new value has to come from
         somewhere. It comes from the grade — the same object the rule and the
         undo step are written against — and not from the button's own
         aria-pressed, which is presentation this handler happens to write. */
      check(/const t=state\.tiers\[i\], on=!t\[act\];/.test(links[0]),
        "the new value is the negation of what the GRADE says, not of what the button shows");
      check(!/aria-pressed"\)\s*(?:!==|===)/.test(links[0]),
        "so nothing reads the pressed attribute back to decide what to commit");
      check(attach && /t\.merge = false/.test(attach[0]),
        "turning Attach off also drops the share — a band cannot be shared with a grade "
        + "this one no longer touches");
      check(attach && /normalizeGradeLinks\(state\.tiers\)/.test(attach[0])
         && merge  && /normalizeGradeLinks\(state\.tiers\)/.test(merge[0]),
        "and both run the rule inside the commit, so the pair is one undo step");
      check(merge && !/t\.attach\s*=/.test(merge[0]),
        "Share does not set attach by hand — the rule does it, so there is one description");
      /* one commit each, never two */
      for(const [nm, m] of [["Attach", attach], ["Share", merge]]){
        check(m && (m[0].match(/commit\(/g) || []).length === 1,
          nm + " is a single commit, so undo restores both flags together");
      }
      /* THE thing a chart-only render cannot do for a button — and unlike Fill
         and People, pressing one of these can move the OTHER one, so both are
         re-read from the grade rather than the pressed one being flipped. */
      check(/setAttribute\("aria-pressed", String\(!!t\[b\.dataset\.tact\]\)\)/.test(links[0]),
        "the pressed state of both toggles is moved in place, read back from the grade");
      check(/querySelectorAll\("button\[data-tact\]"\)/.test(links[0]),
        "over every toggle in the row, so a third one would be carried along");
    }
    /* reordering and deletion can promote a grade to the top */
    check(clk && /move\(state\.tiers,i,act==="up"\?-1:1\);\s*\n\s*normalizeGradeLinks\(state\.tiers\);/
      .test(clk[0]), "reordering normalizes AFTER the move");
    check(clk && /state\.tiers\.splice\(i,1\);\s*\n\s*normalizeGradeLinks\(state\.tiers\);/.test(clk[0]),
      "and so does deleting, which promotes whatever was below");

    /* ---- Fill and People are icon buttons, not selects -------------------
       Fill and People are rows of radio buttons, not <select>s. What has to
       be proven is that the VALUES line up with the enums behind them — a
       button carrying "centre" or "outline" would look right, commit
       cleanly, and draw nothing different. */
    {
      const gpb = /function gradePanelBody\(t, i\)[\s\S]*?\n\}/.exec(SCRIPT);
      check(gpb && !/el\("select"/.test(gpb[0]),
        "the grade panel builds no <select> at all");
      check(gpb && !/\.gmenu select/.test(MARKUP),
        "and no rule is left styling one");
      for(const heading of ["Label", "Fill", "People"]){
        check(gpb && new RegExp('cls:"style-menu-group-title", text:"' + heading + '"').test(gpb[0]),
          'the panel heads a group with the shared all-caps title "' + heading + '"');
      }
      /* the values, against the enums that actually decide what is drawn */
      const fillVals  = (gpb ? gpb[0].match(/fillOpt\("(\w+)"/g)  || [] : [])
                          .map(s => s.replace(/fillOpt\("|"/g, ""));
      const alignVals = (gpb ? gpb[0].match(/alignOpt\("(\w+)"/g) || [] : [])
                          .map(s => s.replace(/alignOpt\("|"/g, ""));
      /* Membership is what has to match the enum: a button carrying a value the
         enum does not hold would commit cleanly and draw nothing different. The
         ORDER is a separate claim, checked below — the row reads left to right
         the way the band it describes does. */
      const enumOf = (name) => {
        const m = new RegExp(name + ':\\s*\\[([^\\]]*)\\]').exec(SCRIPT);
        return m ? m[1].split(",").map(s => s.trim().replace(/"/g, "")) : [];
      };
      const sorted = (a) => a.slice().sort().join(",");
      check(sorted(fillVals) === sorted(enumOf("fill")) && fillVals.length === 2,
        "Fill offers exactly ENUMS.fill — got " + JSON.stringify(fillVals)
        + " against " + JSON.stringify(enumOf("fill")));
      check(sorted(alignVals) === sorted(enumOf("align")) && alignVals.length === 3,
        "People offers exactly ENUMS.align — got " + JSON.stringify(alignVals)
        + " against " + JSON.stringify(enumOf("align")));
      /* Left, Centre, Right: where the three answers actually put people on the
         band, read left to right. Centre must not lead merely because it is
         the default — that would make the row read as a ranking rather than
         a picture. */
      check(alignVals.join(",") === "left,center,right",
        "and reads Left, Centre, Right — got " + JSON.stringify(alignVals));
      check(fillVals.join(",") === "green,white",
        "while Fill reads Accent then Border only — got " + JSON.stringify(fillVals));
      /* each is a radio in a radiogroup: an exclusive choice, announced as one */
      check(gpb && (gpb[0].match(/role:"radiogroup"/g) || []).length === 2,
        "Fill and People are each a radiogroup");
      check(gpb && /role:"radio", "aria-checked"/.test(gpb[0]),
        "and every option is a radio that says whether it is the current one");
      /* the artwork, written out in full so this check can see it */
      for(const ref of ["#i-colors", "#i-square",
                        "#i-align-center", "#i-align-left", "#i-align-right"]){
        check(gpb && gpb[0].indexOf('icon("' + ref + '")') >= 0,
          'the option artwork is referenced literally: ' + ref);
      }
      /* the click path that replaced the select's input event */
      const clkAll = /\$\("#gradePanel"\)\.addEventListener\("click"[\s\S]*?\n\}\);/.exec(SCRIPT);
      const inp = /\$\("#gradePanel"\)\.addEventListener\("input"[\s\S]*?\n\}\);/.exec(SCRIPT);
      check(inp && !/act==="fill"/.test(inp[0]) && !/act==="align"/.test(inp[0]),
        "fill and align do not sit in the input handler — a button fires no input event");
      check(clkAll && /act==="fill"\|\|act==="align"/.test(clkAll[0]),
        "they are handled on click instead");
      check(clkAll && /if\(t\[act\]===want\) return;/.test(clkAll[0]),
        "re-picking the value already chosen is not a change and adds no undo step");
      check(clkAll && /commit\("restyled grade "\+t\.label[\s\S]{0,60}\{render:"chart"\}\)/.test(clkAll[0]),
        "and picking a new one is the commit these two always made, chart-only");
      /* THE thing a chart-only render cannot do for a button: move the check */
      check(clkAll && /setAttribute\("aria-checked", String\(b\.dataset\.value === want\)\)/.test(clkAll[0]),
        "so the checked option is moved in place — a rebuild would take focus off the button");
    }

    /* the two controls, their artwork and their dependency */
    const body = /function gradePanelBody\(t, i\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!body, "gradePanelBody is readable");
    if(body){
      check(/icon\("#i-link"\)/.test(body[0]), "Attach shows the link artwork");
      check(/icon\("#i-share"\)/.test(body[0]), "Share shows the share artwork");
      /* Share stays usable while Attach is off — pressing it attaches */
      const merges = /tact:"merge"[\s\S]*?\}\)/.exec(body[0]);
      check(merges && /disabled:first/.test(merges[0]),
        "Share is disabled only for the first grade");
      check(merges && !/disabled:\s*!t\.attach|disabled:first \|\| !t\.attach/.test(merges[0]),
        "and NOT disabled when Attach is off — pressing it is what attaches the grade");

      /* ---- both are toggle BUTTONS in the segmented row, not checkboxes ----
         The panel's other two choices are already rows of icon buttons; a pair
         of 11px checkboxes underneath them was a third way of asking the same
         kind of question. What has to hold is that the pressed state each one
         shows is read out of the grade, and that the panel builds no checkbox
         at all — a leftover one would look like a live control. */
      check(!/type:"checkbox"/.test(body[0]),
        "the grade panel builds no checkbox");
      check(!/\.chk\b/.test(MARKUP),
        "and no .chk rule is left behind, pointing at a class nothing carries");
      check(!/chk-sub/.test(body[0]) && !/chk-sub/.test(MARKUP),
        "nor an indent rule that would set Share apart from Attach");
      /* one row, so they read as a pair the way Fill and People do — and the
         row is what the two checks below are scoped to, rather than a window of
         so-many characters after the verb: the buttons carry two sentences of
         tooltip and accessible name each, and a window wide enough to reach
         past them reaches into the next control too. */
      const row = /el\("div", \{cls:"gopts"\}, \[[\s\S]*?tact:"attach"[\s\S]*?tact:"merge"[\s\S]*?\n    \]\)/
                    .exec(body[0]);
      check(!!row, "both sit in one .gopts row, so they are side by side and equally wide");
      const pressed = (row ? row[0].match(/"aria-pressed":String\(!!t\.(\w+)\)/g) || [] : [])
                        .map(s => s.replace(/.*t\./, "").replace(/\)$/, ""));
      check(pressed.join(",") === "attach,merge",
        "each toggle shows the flag it writes — got " + JSON.stringify(pressed));
      /* aria-pressed, not aria-checked: these are two independent states that a
         rule happens to couple, not one exclusive choice out of a set. A radio
         pair here would tell a screenreader user that pressing one releases the
         other, which is true in one direction only and never announced. */
      check(row && !/aria-checked/.test(row[0]),
        "and says pressed rather than checked — they are not an exclusive choice");
      /* and it is a PLAIN .gopts row: no private class, so Attach and Share are
         the same two equal buttons, at the same height, with icons at the same
         size as Accent and Border only. The faces are short enough for that to
         hold — the band-or-lane wording lives in the tooltip and the accessible
         name, which have room for it. */
      check(!/\.?\bglinks\b/.test(MARKUP),
        "the toggles take no row class of their own — .glinks is gone from CSS and script alike");
      const icSizes = (MARKUP.match(/\.gopt \.ic\{[^}]*\}/g) || []);
      check(icSizes.length === 1 && /width:17px;height:17px/.test(icSizes[0]),
        "so ONE rule sizes every option icon in the panel, and Attach and Share draw at "
        + "the same 17px as Accent and Border only — got " + JSON.stringify(icSizes));
      /* the blue border that says "on" is one declaration for both kinds of
         option, or the two rows drift apart the moment either is restyled */
      check(/\.gopts \.gopt\[aria-checked="true"\], \.gopts \.gopt\[aria-pressed="true"\]\{/
              .test(MARKUP),
        "checked and pressed take the same on-state rule, not two copies of it");
      check(/\.gopts \.gopt\[aria-checked="true"\] \.ic, \.gopts \.gopt\[aria-pressed="true"\] \.ic\{/
              .test(MARKUP),
        "and so does the icon inside it");
    }
  }

  /* ---- the saved / not-saved-yet / unsaved status ----
     Two statically referenced icons that are toggled, not one icon whose href is
     rewritten: a built href defeats the sprite check and renders nothing at all
     when it is wrong. And #docName.textContent must never be assigned, because
     the icons are its children. */
  {
    /* matched on the id, not on an exact attribute list — otherwise adding an
       attribute makes this block silently stop testing rather than fail */
    const doc = /<span[^>]*id="docName"[^>]*>[\s\S]*?<\/span>\s*<\/div>/.exec(MARKUP);
    check(!!doc, "the doc-status element is readable");
    const d = doc ? doc[0] : "";
    check(/id="docIconSaved"[^>]*>\s*<use href="#i-file-save"\/>/.test(d),
      "the saved state's icon is file_save, referenced statically");
    check(/id="docIconUnsaved"[^>]*>\s*<use href="#i-file-save-off"\/>/.test(d),
      "the unsaved state's icon is file_save_off, referenced statically");
    /* NEITHER icon may carry `hidden`, and updateDocLabel may not set it: these
       are SVG elements, and `hidden` is an IDL attribute of HTMLElement only, so
       assigning it from script writes a property that reflects to no attribute
       and matches no selector. That is exactly the failure this guards against —
       the saved icon staying on screen under the words "Unsaved changes". Which icon renders is
       decided in the stylesheet from the .dirty/.fresh classes alone;
       test/document.js §5b resolves the real rules and proves what is painted. */
    check(!/id="docIconUnsaved"[^>]*\shidden/.test(d) && !/id="docIconSaved"[^>]*\shidden/.test(d),
      "neither status icon carries a hidden attribute — it does nothing on an SVG element");
    const iconRules = (/<style[^>]*>([\s\S]*?)<\/style>/.exec(HTML)[1].match(/[^{}]*\{[^{}]*\}/g) || [])
      .filter(r => /#docIcon/.test(r));
    check(iconRules.length === 5,
      "five rules decide the two icons across the three states — got " + iconRules.length);
    check(iconRules.some(r => /\.rb-doc\s+#docIconUnsaved\s*\{[^}]*display:\s*none/.test(r)),
      "the resting state hides the unsaved icon");
    /* One class check over both states that ever brighten the strip and swap
       the icon, rather than one hand-written case per state — a class-level
       assertion catches the next state nobody thought to pair. */
    for(const cls of ["dirty", "fresh"]){
      check(iconRules.some(r => new RegExp("\\.rb-doc\\." + cls + "\\s+#docIconSaved\\s*\\{[^}]*display:\\s*none").test(r)),
        "." + cls + " hides the saved icon");
      check(iconRules.some(r => new RegExp("\\.rb-doc\\." + cls + "\\s+#docIconUnsaved\\s*\\{[^}]*display:\\s*block").test(r)),
        "." + cls + " shows the unsaved icon");
    }
    check(!iconRules.some(r => /!important/.test(r)),
      "without !important — the cascade did not need it");
    check(/\.rb-doc\.dirty,\.rb-doc\.fresh\{color:#fff;font-weight:600\}/.test(MARKUP),
      ".fresh takes the same emphasis as .dirty, in one shared rule rather than two copies");
    check(/id="docText"/.test(d), "the name has its own element, separate from the icons");
    check(/id="docStatus"><\/span>/.test(d)
       && !/id="docStatus"[^>]*class="sr-only"/.test(d) && !/class="sr-only"[^>]*id="docStatus"/.test(d),
      "the status is now visible text beside the icon, not a screenreader-only echo of one");
    /* A decorative dot separates the status from the name — a static
       aria-hidden span, not a CSS ::after, because generated content is read
       aloud by some screenreaders (Safari/VoiceOver in particular); an
       aria-hidden node is silent everywhere. Pinned as markup adjacency
       between the two ids: both spans are always filled, so the dot is
       visible in all three states with no conditional logic of its own. */
    check(/id="docStatus"><\/span>\s*<span aria-hidden="true">·<\/span>\s*<span id="docText">/.test(d),
      "a decorative separator dot sits between the status and the name, hidden from assistive tech");
    /* informational, not a third Save button */
    check(!/<button/.test(d) && !/data-cmd/.test(d) && !/tabindex/.test(d),
      "the status is not clickable and not focusable — it reports, it does not act");

    const u = /function updateDocLabel\(\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!u, "updateDocLabel is readable");
    const b = u ? u[0] : "";
    /* the bullet is gone */
    check(!/\\u2022|•/.test(b), "no bullet is appended to the name");
    /* the bug this guards: assigning to the wrapper deletes the icons */
    check(!/\$\("#docName"\)\.textContent\s*=/.test(b) && !/\bel\.textContent\s*=/.test(b),
      "updateDocLabel never assigns to #docName.textContent, which would destroy the icons");
    check(/\$\("#docText"\)/.test(b) && /textContent = docName \|\| "Untitled roster"/.test(b),
      "the name or Untitled roster still shows, in #docText");
    /* The icons are not script's business at all. Anything reaching for
       them from in here would reintroduce the bug the stylesheet-only
       approach avoids. */
    check(!/docIconSaved|docIconUnsaved/.test(b),
      "updateDocLabel does not touch either icon element — the stylesheet decides which one renders");
    check(!/\.hidden\s*=/.test(b),
      "and sets no hidden property, which an SVG element would ignore");
    check(/"Not saved yet"/.test(b) && /"Unsaved changes"/.test(b) && /"Saved"/.test(b),
      "all three status names exist");
    /* there is no tooltip at all: the status text itself is the only place
       this string appears */
    check(!/\.title\s*=/.test(b),
      "updateDocLabel writes no tooltip — the visible status text is the only place this string appears");
    /* no fourth state: saving is synchronous */
    check(!/Saving/.test(b), "there is no Saving state — saving is synchronous");
    /* never-saved outranks dirty: dirty is only consulted once fresh is ruled
       out, so an edit to an untitled document cannot fall through to
       "Unsaved changes" */
    check(/const fresh\s*=\s*!docName/.test(b),
      "never-saved is decided from docName alone");
    check(/const dirty\s*=\s*!fresh\s*&&\s*dirtyDoc/.test(b),
      "dirty is only checked once fresh has been ruled out — never-saved outranks it");
    check(/classList\.toggle\("fresh", fresh\)/.test(b) && /classList\.toggle\("dirty", dirty\)/.test(b),
      "exactly one of .fresh/.dirty is toggled, from the derived state — never dirtyDoc directly");
    /* the semantics are read, never recomputed */
    check(!/JSON\.stringify|deepEqual|packState|===\s*savedState/.test(b),
      "it reads dirtyDoc and nothing else — no deep comparison was introduced");
    check(/syncNeverSavedBar\(\)/.test(b),
      "updateDocLabel calls syncNeverSavedBar on every state change — the single choke point");
  }

  /* ---- the never-saved warning bar ----
     A second warnbar, styled exactly like the legibility one, visible only
     while an edit has landed on a document that has never touched disk. Its
     own text names the actual Save command by extracting the Start ribbon's
     face for data-cmd="save" — never a second literal restating it — so a
     rename of that button turns this test red too, rather than leaving
     stale prose behind. */
  {
    check(/<div class="warnbar" id="neverSaved" role="status" hidden>\s*<\/div>/.test(MARKUP),
      "the never-saved bar exists, styled like the legibility warning");
    const legAt = MARKUP.indexOf('id="legibility"');
    const nsAt  = MARKUP.indexOf('id="neverSaved"');
    check(legAt >= 0 && nsAt >= 0 && Math.abs(nsAt - legAt) < 400,
      "the never-saved bar sits right beside the legibility bar in the stage");

    /* Every data-cmd="save" element that carries a visible text face must
       read the same thing — a class check over however many exist, not one
       hand-written assertion per button, so a third one added later is
       covered for free. */
    const saveButtons = matchAll(/<button[^>]*\sdata-cmd="save"[^>]*>([\s\S]*?)<\/button>/g, MARKUP)
      .map(m => m[1]);
    check(saveButtons.length >= 1, "at least one data-cmd=\"save\" button exists");
    const texted = saveButtons.filter(f => /<span>/.test(f))
      .map(f => (/<span>([^<]*)<\/span>/.exec(f) || [])[1]);
    check(texted.length >= 1, "at least one data-cmd=\"save\" face carries visible text");
    const label = texted[0];
    check(label === "Save copy", "the extracted save face reads Save copy — got " + JSON.stringify(label));
    check(texted.every(t => t === label),
      "every data-cmd=\"save\" face with visible text reads the same label");

    const nb = (/function syncNeverSavedBar\(\)[\s\S]*?\n\}/.exec(SCRIPT) || [""])[0];
    check(!!nb, "syncNeverSavedBar is readable");
    check(nb.indexOf('"' + label + '"') >= 0,
      "the bar's text quotes the button's own extracted face, not a restated literal — got "
      + JSON.stringify(nb));
    check(/!docName && dirtyDoc/.test(nb),
      "the bar shows only while the document is both never-saved and dirty");
  }

  /* ---- the Office-style controls on the Design tab ---- */
  {
    const pane = /<div class="rb-pane" data-pane="design"[\s\S]*?<!-- Design menus/.exec(MARKUP);
    check(!!pane, "the Design pane is readable");
    const p = pane ? pane[0] : "";
    check((p.match(/<div class="lbl">(Layout|Colour|Text)<\/div>/g) || []).length === 3,
      "Design has exactly the Layout, Colour and Text groups");
    for(const id of ["layout","density","page","bg","ring","font"])
      check(new RegExp('<select class="style-source" id="' + id + '"[^>]*hidden').test(p),
        "#" + id + " remains the hidden canonical select");
    check(/id="layout"[\s\S]*?<option value="pyramid">Pyramid<\/option><option value="tornado">Tornado<\/option><option value="histogram">Histogram<\/option><option value="swimlanes">Swimlanes<\/option><option value="hive">Hive<\/option><option value="matrix">Matrix<\/option><\/select>/.test(p),
      "the canonical layout has exactly Pyramid, Tornado, Histogram, Swimlanes, Hive and Matrix, in that order — closed by </select> so a seventh option cannot slip past the word exactly");
    /* Page is a shape choice now, not a paper-size choice: "A3"/"DIN" left the
       visible labels for the menu row tooltips, and Square joined as a third
       page format at the A3 short side (297mm), so it prints naturally beside
       an A3 sheet. The three enum keys (landscape/portrait/square) are
       unchanged file-format hooks — only what a person reads changed. */
    check(/id="page"[\s\S]*?<option value="landscape">Landscape<\/option><option value="portrait">Portrait<\/option><option value="square">Square<\/option><\/select>/.test(p),
      "the canonical page has exactly Landscape, Portrait and Square, in that order — closed by </select> so a fourth option cannot slip past the word exactly");
    for(const id of ["layoutBtn","densityBtn","pageBtn","accentBtn","bgBtn","ringBtn"]){
      const face = new RegExp('<button class="style-command[^>]*id="' + id + '"[^>]*aria-controls="([^"]+)"').exec(p);
      check(!!face, id + " is one whole selector button with its own aria-controls");
    }
    check(!/class="[^"]*split-toggle[^"]*"[^>]*id="(layoutBtn|densityBtn|pageBtn|accentBtn|bgBtn|ringBtn)"/.test(p)
       && !/id="(layoutBtn|densityBtn|pageBtn|accentBtn|bgBtn|ringBtn)"[^>]*class="[^"]*split-toggle/.test(p),
      "Design selectors are not fake split buttons");
    check(!/style-value/.test(MARKUP),
      "Design commands have one visible label — the grey value rows are gone");
    check(/\.style-tall\{[^}]*min-width:74px[^}]*line-height:1\.2/.test(MARKUP)
       && /\.style-tall > \.ic:not\(\.style-caret\)\{width:26px;height:26px/.test(MARKUP),
      "Design primary commands use the standard big-button width, line height and icon size");
    check(!/\.style-tall > \.ic\{width:26px/.test(MARKUP),
      "the primary icon rule excludes the caret, so it cannot override the 18px standard");
    check(/\.style-stack\{[^}]*grid-row:1 \/ span 2[^}]*grid-template-rows:1fr 1fr/.test(MARKUP),
      "Spacing and Angle fill the same two-row height as the tall commands");
    check(/button\.style-mini\{[^}]*justify-content:flex-start[^}]*text-align:left/.test(MARKUP),
      "Spacing and Angle are explicitly left-aligned");
    check(/button\.style-mini\{[^}]*min-width:145px/.test(MARKUP)
       && /\.style-stack\{[^}]*min-width:145px/.test(MARKUP),
      "the compact Design pair is 145px wide — the base for Grade labels/Name "
      + "labels and Background/Photo ring, whose longer labels need it");
    /* Angle's short label ("Angle", not "Pyramid angle") leaves the
       Spacing/Angle stack needing less width than the other two compact
       stacks, so it gets its own narrower modifier — 120px — while Grade
       labels/Name labels and Background/Photo ring keep the 145px base
       because their longer labels would clip at 120px. Two literals are a
       deliberate design decision, not one, so both are pinned, each named
       for the stack it belongs to; mutation-tested as M9. */
    check(/\.style-stack\.stack-narrow\{min-width:120px\}/.test(MARKUP)
       && /\.style-stack\.stack-narrow > button\.style-mini\{min-width:120px\}/.test(MARKUP),
      "the Spacing/Angle stack has its own 120px override, at higher specificity than "
      + "button.style-mini's own 145px so it does not lose that fight");
    const densityStack = /<div class="style-stack stack-narrow">[\s\S]*?<button[^>]*id="densityBtn"/.exec(MARKUP);
    check(!!densityStack, "Spacing/Angle's own stack carries the narrow modifier");
    const labelsStack = /<div class="style-stack">[\s\S]*?<button[^>]*id="labelsBtn"/.exec(MARKUP);
    const bgStack = /<div class="style-stack">[\s\S]*?<button[^>]*id="bgBtn"/.exec(MARKUP);
    check(!!labelsStack && !!bgStack,
      "Grade labels/Name labels and Background/Photo ring keep the PLAIN style-stack — "
      + "their longer labels still need the 145px base, not the narrower override");
    check(MARKUP.indexOf("button.style-mini{") > MARKUP.indexOf("button.style-command,.style-command{"),
      "the equally specific left-alignment rule follows the centred command rule and wins");
    check(/id="headerBtn"[\s\S]*href="#i-header"[\s\S]*>Header</.test(p),
      "Header has the page-header artwork and its own command");
    check(/id="headerPop"[\s\S]*id="title"[\s\S]*id="brand"/.test(MARKUP),
      "Header opens one editor containing the original Title and Right-hand label inputs");
    /* Anchored tightly — style-stack open, immediately the Grade labels
       button (with its own visible text bounded to that button's own tag),
       immediately the Name labels button (same), immediately the close —
       rather than a loose scan across the whole pane. The loose version this
       replaces (class="style-stack"[\s\S]*?id="labelsBtn"...) still matched
       after the wrapper div was deleted outright, because unbounded [\s\S]*?
       happily skips over an intervening </div> — including the *next*
       style-stack's own opening div — and keeps hunting for the later
       strings anywhere else in the pane: a mutation that removes the actual
       nesting must fail this, not just remove indentation. */
    check(/<div class="style-stack">\s*<button class="style-command style-mini" id="labelsBtn"[\s\S]*?>Grade labels<[\s\S]*?<\/button>\s*<button class="style-command style-mini" id="nameLabelsBtn"[\s\S]*?>Name labels<[\s\S]*?<\/button>\s*<\/div>/.test(p),
      "Grade labels and Name labels are stacked secondary one-row commands, in that order, inside one style-stack");
    check(/class="[^"]*style-mini[^"]*" id="labelsBtn"/.test(p)
       && /class="[^"]*style-mini[^"]*" id="nameLabelsBtn"/.test(p),
      "neither labels command uses a tall primary face");
    const labels = /id="labelsPop"[\s\S]*?<\/div>/.exec(MARKUP);
    check(labels && /id="showGradeCode"/.test(labels[0]) && /Display grade code/.test(labels[0])
      && /id="showGradeName"/.test(labels[0]) && /Display grade name/.test(labels[0]),
      "Grade labels contains the two grade-heading checkboxes");
    check(labels && (labels[0].match(/type="checkbox"/g) || []).length === 2,
      "and no third label mode is implied");
    check(labels && /class="style-menu-group-title">Display<\/span>/.test(labels[0])
       && !/>Grade labels<\/b>/.test(labels[0]),
      "the Grade labels editor heads its checkbox group with the all-caps DISPLAY pattern");

    /* An editor whose heading is the all-caps group title cannot ALSO take its
       accessible name from that heading: "Display" and "Colours" name the fields
       under them, not the editor, and a dialog announced as "Display" tells a
       screenreader user nothing about what it edits. Each carries its own
       aria-label instead. Angle is the exception on purpose — its
       heading IS its name — so it still points at one. */
    for(const pair of [["labelsPop", "Grade labels"], ["headerPop", "Chart header"],
                       ["textPop", "Text colours"]]){
      const tag = new RegExp('id="' + pair[0] + '"[^>]*>').exec(MARKUP);
      check(tag && tag[0].indexOf('aria-label="' + pair[1] + '"') >= 0,
        pair[0] + ' announces itself as "' + pair[1] + '" — got '
        + JSON.stringify(tag && tag[0]));
      check(tag && tag[0].indexOf("aria-labelledby") < 0,
        pair[0] + " does not take its name from the all-caps heading inside it");
    }
    const angleTag = /id="anglePop"[^>]*>/.exec(MARKUP);
    check(angleTag && /aria-labelledby="anglePopTitle"/.test(angleTag[0]),
      "Angle still names itself from its own heading");
    check(/<b class="style-pop-title" id="anglePopTitle">Angle<\/b>/.test(MARKUP),
      "the heading carries no live-value readout beside its text — and reads "
      + "\"Angle\", not \"Pyramid angle\", now that Tornado applies to it too");
    const nameStart = MARKUP.indexOf('<div class="menu style-menu" id="nameLabelsMenu"');
    const nameEnd = MARKUP.indexOf('<div class="menu style-pop" id="headerPop"', nameStart);
    const nameLabels = nameStart >= 0 && nameEnd > nameStart ? MARKUP.slice(nameStart, nameEnd) : "";
    check(/role="menu"/.test(nameLabels)
       && /data-style-select="nameLabelPosition" data-value="below"/.test(nameLabels)
       && /data-style-select="nameLabelPosition" data-value="next"/.test(nameLabels)
       && nameLabels.indexOf('data-value="below"') < nameLabels.indexOf('data-value="next"'),
      "Name labels begins with the two concise position choices in below/next order");
    /* Row-binding pins, mutation-tested: each
       Position row must carry its OWN artwork, immediately before its own
       text — a check that only asked "is there an icon here" would stay green
       under a swap of the two hrefs. */
    check(/data-style-select="nameLabelPosition" data-value="below"><svg class="ic"><use href="#i-name-below"\/><\/svg>Below photo</.test(nameLabels),
      "the Below-photo row carries #i-name-below in full, immediately before its text");
    check(/data-style-select="nameLabelPosition" data-value="next"><svg class="ic"><use href="#i-name-next"\/><\/svg>Next to photo</.test(nameLabels),
      "the Next-to-photo row carries #i-name-next in full, immediately before its text");
    /* Scoped to the Position group specifically: the whole menu carries more
       than two menuitemradio rows once Display and Bold are included, and a
       count taken over the whole menu would stop meaning what this message
       says. */
    const posGroup = (/<div class="style-menu-group" role="group" aria-labelledby="namePositionGroup">[\s\S]*?<\/div>/.exec(nameLabels) || [""])[0];
    check((posGroup.match(/role="menuitemradio"/g) || []).length === 2,
      "both position choices expose the radio/checkmark menu pattern");
    check((nameLabels.match(/class="style-menu-group"/g) || []).length === 3
       && /id="namePositionGroup">Position</.test(nameLabels)
       && /id="nameDisplayGroup">Display</.test(nameLabels)
       && /id="nameBoldGroup">Bold</.test(nameLabels),
      "Name labels separates Position, Display and Bold into three labelled groups");
    check(/id="showPersonName">Display name/.test(nameLabels)
       && /id="showPersonGrade">Display grade/.test(nameLabels)
       && /id="showPersonGroup">Display group/.test(nameLabels),
      "the Display group has independent name, grade and group checkboxes");
    check((nameLabels.match(/type="checkbox"/g) || []).length === 3,
      "the display group contains exactly those three checkboxes");
    /* Bold: four choices, membership against ENUMS.nameBold (a case check, not
       a per-value list) and the reading order pinned separately as a literal —
       the same split gradePanelBody's Fill/People rows use. */
    const boldGroup = (/<div class="style-menu-group" role="group" aria-labelledby="nameBoldGroup">[\s\S]*?<\/div>/.exec(nameLabels) || [""])[0];
    const boldVals = (boldGroup.match(/data-style-select="nameBold" data-value="(\w+)"/g) || [])
      .map(s => s.replace(/.*data-value="|"/g, ""));
    const nameBoldEnum = (() => {
      const m = /nameBold:\s*\[([^\]]*)\]/.exec(SCRIPT);
      return m ? m[1].split(",").map(s => s.trim().replace(/"/g, "")) : [];
    })();
    check(boldVals.slice().sort().join(",") === nameBoldEnum.slice().sort().join(",")
       && boldVals.length === 4,
      "the Bold group offers exactly ENUMS.nameBold — got " + JSON.stringify(boldVals)
      + " against " + JSON.stringify(nameBoldEnum));
    check(boldVals.join(",") === "given,family,all,none",
      "and reads First names, Last name, Whole name, None — got " + JSON.stringify(boldVals));
    check((boldGroup.match(/role="menuitemradio"/g) || []).length === 4,
      "all four Bold choices expose the radio/checkmark menu pattern");
    check(/data-value="given">First names/.test(boldGroup)
       && /data-value="family">Last name/.test(boldGroup)
       && /data-value="all">Whole name/.test(boldGroup)
       && /data-value="none">None/.test(boldGroup),
      "the four Bold rows carry the labels a user reads");
    check(/id="nameLabelPosition" hidden aria-hidden="true"[\s\S]*?<option value="below">Below photo<\/option>[\s\S]*?<option value="next">Next to photo<\/option>/.test(p),
      "the menu remains a facade over one canonical hidden select");
    check(/id="nameBold" hidden aria-hidden="true"[\s\S]*?<option value="given">First names<\/option>[\s\S]*?<option value="family">Last name<\/option>[\s\S]*?<option value="all">Whole name<\/option>[\s\S]*?<option value="none">None<\/option>/.test(p),
      "and Bold is a facade over its own canonical hidden select");
    check(/id="textPop"[\s\S]*id="inkOnColour"[\s\S]*id="inkOnWhite"[\s\S]*id="contrastWarn"/.test(MARKUP),
      "Text opens one editor containing both original colour inputs and the warning");
    check(/<label for="inkOnColour">On accent/.test(MARKUP),
      "the On-colour row's label now names what it actually recolours: the accent");
    check(/<span class="accent-dot" id="inkAccentDot"><\/span>/.test(MARKUP),
      "the On-accent row carries a live swatch of the current accent colour");
    {
      const contrastCSS = (/<style>([\s\S]*?)<\/style>/.exec(MARKUP) || ["", ""])[1];
      check(/\.warn-chip\{[^}]*color:var\(--warn\)/.test(contrastCSS),
        "the contrast warning chip takes its text colour from the danger family, not a bespoke amber");
      check(/\.warn-chip\{[^}]*background:var\(--warn-tint\)/.test(contrastCSS)
         && /\.warnbar\{[^}]*background:var\(--warn-tint\)/.test(contrastCSS)
         && /button\.danger:hover\{[^}]*background:var\(--warn-tint\)/.test(contrastCSS)
         && (HTML.match(/#fdf1f3/g) || []).length === 1,
        "the contrast warning chip, the legibility warning bar and button.danger:hover all read the one --warn-tint definition, and #fdf1f3 appears nowhere but that definition");
      check(!/\.style-warn\{[^}]*background:#fff0c9/.test(contrastCSS)
         && !/\.style-warn\{[^}]*color:#7a5200/.test(contrastCSS),
        "the Text face's warning badge carries no hardcoded amber literals "
        + "(#fff0c9 background, #7a5200 text) — it uses the shared --warn tokens instead");
      check(new RegExp('<p class="warn-chip"[^>]*id="importNoGrades"').test(MARKUP),
        "the photo-import dialog's no-grades notice renders through the shared warning component, not a private copy of the amber panel");
    }
    { /* The true extent of .rb-body, walked by div depth from its opening
         tag: the panes scroll and clip, so a menu or editor nested inside
         the body clips with them. Anchored on the block itself, not on a
         neighbouring element's position — a neighbour that later moves or is
         removed would make indexOf(-1) sail through the rest of the check
         silently, turning every clause vacuously green. */
      const bodyStart = MARKUP.indexOf('<div class="rb-body">');
      check(bodyStart >= 0, "the ribbon body's opening tag is findable");
      const divTag = /<div\b|<\/div>/g;
      divTag.lastIndex = bodyStart + 1;
      let divDepth = 1, dm, bodyEnd = -1;
      while((dm = divTag.exec(MARKUP))){
        divDepth += dm[0] === "<div" ? 1 : -1;
        if(divDepth === 0){ bodyEnd = dm.index; break; }
      }
      check(bodyEnd > bodyStart, "the ribbon body's closing tag is findable");
      for(const outId of ["layoutMenu", "headerPop", "labelsPop", "nameLabelsMenu"]){
        const at = MARKUP.indexOf('id="' + outId + '"');
        check(at > bodyEnd,
          "#" + outId + " lives outside the clipping ribbon body");
      }
    }
    /* The Layout menu's own rows: the same icon-before-text pattern the
       density/page menus below use, in the fixed owner-decided order —
       Pyramid, Tornado, Histogram, Swimlanes, Hive, Matrix. One loop over
       value→icon→label so a row cannot drift (right icon, wrong label, or
       vice versa) without failing here. Matrix alone carries the shared
       "2D" badge after its label — the literal is the same one the Group
       button face carries, checked against it directly in §4o2 below. */
    {
      const layoutMenu = /<div class="menu style-menu" id="layoutMenu"[\s\S]*?<\/div>/.exec(MARKUP);
      check(!!layoutMenu, "the Layout menu is found by id");
      const lm = layoutMenu ? layoutMenu[0] : "";
      for(const [value, iconHref, label] of
          [["pyramid","#i-pyramid","Pyramid"],["tornado","#i-tornado","Tornado"],
           ["histogram","#i-histogram","Histogram"],["swimlanes","#i-swimlanes","Swimlanes"],
           ["hive","#i-hive","Hive"]]){
        check(new RegExp('data-style-select="layout" data-value="' + value
            + '"><svg class="ic"><use href="' + iconHref + '"\\/></svg>' + label + '</button>').test(lm),
          "Layout's " + value + " row carries " + iconHref + " and reads " + JSON.stringify(label));
      }
      check(new RegExp('data-style-select="layout" data-value="matrix"><svg class="ic"><use href="#i-matrix"\\/></svg>Matrix '
          + '<span class="badge-2d" aria-hidden="true">2D<\\/span></button>').test(lm),
        "Layout's matrix row carries #i-matrix, reads \"Matrix\" and wears the 2D badge");
      const order = matchAll(/data-style-select="layout" data-value="(\w+)"/g, lm).map(m => m[1]);
      check(order.join(",") === "pyramid,tornado,histogram,swimlanes,hive,matrix",
        "the Layout menu rows are built Pyramid, Tornado, Histogram, Swimlanes, Hive, Matrix, in that order — got "
        + order.join(","));
    }
    /* Tight/Balanced/Airy carry density_small/medium/
       large, the same pattern #layoutMenu already shows (an icon before the row
       text, coexisting with the aria-checked mechanism syncStyleSummaries
       moves). One loop over value→icon, like the Export menu's format→icon
       loop, so the next density value nobody has added yet is covered too. */
    {
      const densityMenu = /<div class="menu style-menu" id="densityMenu"[\s\S]*?<\/div>/.exec(MARKUP);
      check(!!densityMenu, "the Spacing menu is found by id");
      const dm = densityMenu ? densityMenu[0] : "";
      for(const [value, icon] of [["tight","#i-tight"],["balanced","#i-balanced"],["airy","#i-airy"]]){
        check(new RegExp('data-style-select="density" data-value="' + value
            + '"><svg class="ic"><use href="' + icon + '"\\/>').test(dm),
          "Spacing's " + value + " row carries " + icon);
      }
    }
    /* Page's three rows: the same icon-before-text pattern as Spacing, plus a
       title on every row carrying the physical truth the label does not
       state — "Landscape"/"Portrait" say nothing about A3, so a printer still
       needs to be told. Checked together (value + icon + title in one match)
       so a row cannot drift — e.g. carry the right icon under the wrong
       tooltip — without this failing. */
    {
      const pageMenu = /<div class="menu style-menu" id="pageMenu"[\s\S]*?<\/div>/.exec(MARKUP);
      check(!!pageMenu, "the Page menu is found by id");
      const pm = pageMenu ? pageMenu[0] : "";
      const DIN = "Prints as ISO A3 at 300 dpi";
      const SQ  = "Prints as 297 × 297 mm at 300 dpi";
      for(const [value, icon, title] of [
        ["landscape", "#i-page-landscape", DIN],
        ["portrait",  "#i-page-portrait",  DIN],
        ["square",       "#i-page-square",    SQ]
      ]){
        check(new RegExp('data-style-select="page" data-value="' + value + '" title="'
            + title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"><svg class="ic"><use href="' + icon + '"\\/>').test(pm),
          "Page's " + value + " row carries " + icon + " and its physical-size tooltip");
      }
      /* the rows read landscape, portrait, square, left to right — the DIN
         pair keeps its original order and Square is appended after it */
      const order = ["landscape", "portrait", "square"].map(v => pm.indexOf('data-value="' + v + '"'));
      check(order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2],
        "Page's rows are ordered Landscape, Portrait, Square — got " + JSON.stringify(order));
    }
    /* Accent is a single tall menu button, like the three next to it, with the
       OS colour dialog and the hex field both living inside #accentPop rather
       than on the face. The swatch stays on the face — a menu hides its
       value, and which colour the chart is set to has to be readable
       without opening anything. */
    const accentFace = /<button class="style-command style-tall style-accent" id="accentBtn"[\s\S]*?<\/button>/.exec(p);
    check(!!accentFace, "Accent is one whole menu button in the Colour group");
    if(accentFace){
      check(/aria-controls="accentPop"/.test(accentFace[0]) && /aria-haspopup="dialog"/.test(accentFace[0]),
        "…naming the editor it opens, and declaring it a dialog rather than a menu "
        + "because it holds a text field");
      check(/href="#i-caret"/.test(accentFace[0]) && /class="ic style-caret"/.test(accentFace[0]),
        "…and carrying the same caret Background, Text and Photo ring carry");
      check(/id="accentSwatch"/.test(accentFace[0]),
        "…with the swatch still on the face, so the current accent is readable closed");
      /* The colour bar is an underline under the icon, so it comes between the
         icon and the label — not after the label, where it would push "Accent"
         off the row its three neighbours sit on. */
      check(/href="#i-colors"/.test(accentFace[0]) && !/href="#i-palette"/.test(accentFace[0]),
        "…and the face carries the colours artwork, not the palette icon");
      const order = ["#i-colors", 'id="accentSwatch"', 'class="style-label"'].map(s => accentFace[0].indexOf(s));
      check(order[0] >= 0 && order[0] < order[1] && order[1] < order[2],
        "…in the order icon, colour bar, label — got " + JSON.stringify(order));
    }
    /* Colour is the one command left beside Accent that is not allowed to have
       moved to make room for anything — it keeps its tall primary face and its
       original hooks (id="textBtn", icon #i-text) even though the visible
       label reads Colour, the same hooks-vs-label split the ribbon uses
       throughout. */
    for(const pair of [["textBtn", "text", "Colour"]]){
      const face = new RegExp('<button class="style-command style-tall" id="' + pair[0]
        + '"[\\s\\S]*?</button>').exec(p);
      check(!!face, pair[2] + " keeps the unmodified tall face");
      check(face && !/style-accent/.test(face[0]),
        "…and takes none of Accent's icon modifier");
      check(face && face[0].indexOf("#i-" + pair[1]) < face[0].indexOf('class="style-label"'),
        "…with its icon still ahead of its label and no bar between them");
      check(face && !/style-swatch/.test(face[0]),
        "…and no colour bar of its own");
    }
    /* Background and Photo ring form a compact stacked pair beside Accent, the
       same construction Spacing/Angle and Grade labels/Name labels already
       use — two columns in the Colour group rather than three separate tall
       buttons. */
    /* Anchored tightly — style-stack open, immediately the Background button,
       immediately the Photo ring button, immediately the close — rather than a
       loose scan across the whole pane. A loose version of this (matching the
       nameLabels/labelsBtn check's own pattern) would still match even if the
       wrapper div were deleted outright, because unbounded [\s\S]*? happily
       skips over an intervening </div> and keeps hunting for the later strings
       anywhere else in the pane: a mutation that removes the actual nesting
       must fail this, not just remove indentation. */
    check(/<div class="style-stack">\s*<button class="style-command style-mini" id="bgBtn"[\s\S]*?<\/button>\s*<button class="style-command style-mini" id="ringBtn"[\s\S]*?<\/button>\s*<\/div>/.test(p),
      "Background and Photo ring are stacked secondary one-row commands, in that order, inside one style-stack");
    check(/class="[^"]*style-mini[^"]*" id="bgBtn"/.test(p)
       && /class="[^"]*style-mini[^"]*" id="ringBtn"/.test(p),
      "neither Background nor Photo ring uses a tall primary face");
    for(const pair of [["bgBtn", "background", "Background", "bgMenu"],
                       ["ringBtn", "ring", "Photo ring", "ringMenu"]]){
      const face = new RegExp('<button class="style-command style-mini" id="' + pair[0]
        + '"[\\s\\S]*?</button>').exec(p);
      check(!!face, pair[2] + " keeps its id, icon, label, aria-haspopup, aria-controls "
        + "and menu — only the face format changed");
      check(face && face[0].indexOf("#i-" + pair[1]) < face[0].indexOf('class="style-label"'),
        "…with its icon still ahead of its label");
      check(face && /aria-haspopup="menu"/.test(face[0]) && new RegExp('aria-controls="' + pair[3] + '"').test(face[0]),
        "…and it still opens the same menu it always did");
    }
    check(!/style-colour-direct|style-hex/.test(MARKUP),
      "the direct colour command and the standalone hex control leave no selector behind");
    check(MARKUP.indexOf('id="accent"') > MARKUP.indexOf('id="accentPop"')
       && MARKUP.indexOf('id="accentHex"') > MARKUP.indexOf('id="accentPop"'),
      "both the colour input and the hex field live inside the menu");
    check(!/<input type="(color|text)" id="accent(Hex)?"/.test(p),
      "…and neither is left in the ribbon body, which clips and scrolls");
    for(const icon of ["layout","spacing","angle","page","header","label","badge","colors","palette","background","text","ring","pyramid","swimlanes"])
      check(MARKUP.indexOf('href="#i-' + icon + '"') >= 0, "Design writes #i-" + icon + " out in full");

    /* The palette icon lives only in More colours…, the row that actually
       opens a palette — not on the face. Asserted as a count and a location,
       because §2's unreferenced-symbol check only fails once a symbol reaches
       ZERO references, and a palette appearing on the face as well as in the
       menu would pass that check while meaning two different things in one
       group. */
    const paletteUses = (HTML.match(/href="#i-palette"/g) || []).length
                      + (SCRIPT.match(/icon\("#i-palette"\)/g) || []).length;
    check(paletteUses === 1,
      "#i-palette is referenced exactly once — got " + paletteUses);
    const morePalette = /<label class="accent-more">[\s\S]*?<\/label>/.exec(MARKUP);
    check(morePalette && /href="#i-palette"/.test(morePalette[0]),
      "…and the one reference is More colours…, which is what opens a palette");

    /* ---- the four Colour labels sit on one baseline ----
       The tall faces are centred columns, so where a label lands is decided by
       the height of everything above it. Background, Text and Photo ring have
       icon + gap there. Accent has icon + gap + bar + gap, with the bar's
       negative margin cancelling the first gap so it underlines the icon rather
       than floating between two of them — and the icon gives up exactly what the
       bar and its remaining gap cost.
       Added up rather than pinned one number at a time: four separate checks all
       pass while the label sits a pixel low, which is the failure this is for. */
    {
      const px = re => { const m = re.exec(MARKUP); return m ? parseFloat(m[1]) : NaN; };
      const gap        = px(/button\.style-command,\.style-command\{[^}]*gap:(-?[\d.]+)px/);
      const sharedIcon = px(/\.style-tall > \.ic:not\(\.style-caret\)\{width:(-?[\d.]+)px/);
      const accentIcon = px(/\.style-tall\.style-accent > \.ic:not\(\.style-caret\)\{width:(-?[\d.]+)px/);
      const barH       = px(/\.style-tall > \.style-swatch\{[^}]*height:(-?[\d.]+)px/);
      const barLift    = px(/\.style-tall > \.style-swatch\{[^}]*margin-top:(-?[\d.]+)px/);
      check([gap, sharedIcon, accentIcon, barH, barLift].every(n => !isNaN(n)),
        "every number the baseline depends on is readable from the sheet — got "
        + JSON.stringify({gap, sharedIcon, accentIcon, barH, barLift}));
      const neighbour = sharedIcon + gap;
      const accent    = accentIcon + gap + barLift + barH + gap;
      check(neighbour === accent,
        "Accent's label sits on the same row as its three neighbours' — "
        + accentIcon + "+" + gap + "+" + barLift + "+" + barH + "+" + gap + " = " + accent
        + ", neighbours " + sharedIcon + "+" + gap + " = " + neighbour);
      check(barLift < 0 && gap + barLift === 0,
        "…and the bar's lift exactly cancels the gap above it, so it reads as an "
        + "underline against the icon rather than a band floating below it");
      check(sharedIcon === 26,
        "…without moving the shared 26px icon the other three are drawn at");
      check(accentIcon < sharedIcon,
        "…the modifier shrinks Accent's icon alone, which is what pays for the bar");
    }
    check(/id="nameLabelsBtn"[\s\S]{0,250}?href="#i-badge"/.test(p),
      "Name labels uses the supplied badge artwork");
    check(/<symbol id="i-badge"[^>]*><path d="M146\.67-80q-27 0-46\.84-19\.83Q80-119\.67 80-146\.67v-466\.66/.test(MARKUP),
      "the badge symbol carries the supplied path rather than a substitute");
    check(/<symbol id="i-text"[^>]*><path d="M80 0v-160h800V0H80Zm140-280 216\.67-560/.test(MARKUP),
      "Text uses the supplied format_color_text path");
    {
      const srcD = (/\bd="([^"]+)"/.exec(
        readFile(here() + "sprites/format_color_text_40dp_E3E3E3_FILL0_wght400_GRAD0_opsz40.svg")) || [])[1];
      const symD = (/<symbol id="i-text"[^>]*><path d="([^"]+)"/.exec(MARKUP) || [])[1];
      check(!!srcD && !!symD && symD === srcD,
        "#i-text's path data matches sprites/format_color_text_40dp_E3E3E3_FILL0_wght400_GRAD0_opsz40.svg "
        + "in full — format_color_text rather than text_fields, and not a hand-typed approximation of it");
    }

    /* canonical wiring is unchanged */
    check(/\$\("#layout"\)\.addEventListener\("change"/.test(SCRIPT),
      "the layout selector is wired");
    const lis = /\$\("#layout"\)\.addEventListener\("change",[\s\S]{0,400}?\)\);/.exec(SCRIPT);
    check(!!lis, "and its handler is readable");
    const l = lis ? lis[0] : "";
    check(/commit\(/.test(l) && !/\bedit\(/.test(l),
      "changing the layout is one commit — a discrete change, one undo step");
    check(/state\.layout\s*=/.test(l), "and it writes state.layout");
    check(/oneOf\(/.test(l) && /ENUMS\.layout/.test(l),
      "through the same enum the validator uses, so the UI cannot set what a file may not");
    check(/render:"all"/.test(l), "and re-renders all Design summaries");
    check(!/state\.angle\s*=/.test(l) && !/attach|merge/.test(l),
      "it touches nothing else — not the angle, not attach, not share");

    const choice = /const styleChoice =[\s\S]*?return;\n  \}/.exec(SCRIPT);
    check(choice && /dispatchEvent\(new Event\("change"/.test(choice[0]),
      "a Design menu choice dispatches the canonical select's ordinary change event");
    check(choice && !/state\./.test(choice[0]), "the menu facade never writes document state directly");

    /* renderAll puts values and disabled state back after undo, Open and New */
    const ra = /function renderAll\(\)[\s\S]*?\n\}/.exec(SCRIPT);
    const r = ra ? ra[0] : "";
    check(/\$\("#layout"\)\.value/.test(r), "renderAll restores the selector from the document");
    check(/\$\("#showGradeCode"\)\.checked = state\.showGradeCode !== false/.test(r)
       && /\$\("#showGradeName"\)\.checked = state\.showGradeName === true/.test(r),
      "renderAll restores both independent grade-label checkboxes");
    check(/\$\("#nameLabelPosition"\)\.value = oneOf\(state\.nameLabelPosition, ENUMS\.nameLabelPosition, "below"\)/.test(r),
      "renderAll restores the saved Swimlane name-label position");
    check(/\$\("#nameBold"\)\.value = oneOf\(state\.nameBold, ENUMS\.nameBold, "given"\)/.test(r),
      "renderAll restores the saved name-bolding choice");
    check(/\$\("#showPersonName"\)\.checked = state\.showPersonName !== false/.test(r)
       && /\$\("#showPersonGrade"\)\.checked = state\.showPersonGrade !== false/.test(r)
       && /\$\("#showPersonGroup"\)\.checked = state\.showPersonGroup !== false/.test(r),
      "renderAll restores all three person-label display choices");
    check(/syncStyleSummaries\(\)/.test(r), "and derives menu checks and accessible values from the controls");
    check(/\$\("#angle"\)\.value = angleIndex\(state\.angle\)/.test(r),
      "while the angle's own value is always restored — it is never reset");
    const sync = /function syncStyleSummaries\(\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(sync && /\$\("#angleBtn"\)\.disabled = lane/.test(sync[0]),
      "Swimlanes disables the angle command instead of removing it");
    /* The reason is table-driven now — notAvailableIn(cap), never a hand-typed
       "Only applies to Pyramid" (which would also be false once Tornado
       exists: Tornado is disabled by nothing, and Swimlanes is what disables
       Angle today). The runtime proof that this is genuinely LAYOUTS-driven,
       not a same-looking hardcoded string, lives in test/fixtures.js §6i
       (doctors LAYOUTS.swimlanes.label and drives the real function). */
    check(sync && /const angleReason = notAvailableIn\(cap\)/.test(sync[0]),
      "and explains why through the shared notAvailableIn(cap) helper");
    check(!/Only applies to Pyramid/.test(SCRIPT),
      "no hand-typed reason naming a single disabling layout survives in the "
      + "script — Tornado's existence would make any such single-layout reason false");
    check(sync && /\$\("#nameLabelsBtn"\)\.disabled = false/.test(sync[0]),
      "Name labels is enabled unconditionally — available in every layout");
    /* Position applies to every engine, Pyramid included: it draws a
       below-photo label under a centred photo and widens the gap between
       bands to hold it. The rows must not be disabled in any layout, and no
       explanation may be left attached to them — a disabled-looking control
       with no reason attached is worse than either state. */
    check(sync && /querySelectorAll\('\[data-style-select="nameLabelPosition"\]'\)[\s\S]{0,160}?b\.disabled = false/.test(sync[0]),
      "no layout disables the two position choices");
    check(sync && !/Only applies to Swimlanes/.test(sync[0]),
      "and the Swimlanes-only explanation is gone with the restriction");
    check(!/Only applies to Swimlanes/.test(MARKUP),
      "including anywhere in the markup");
    check(sync && /setAttribute\("aria-label", names\[id\] \+ ": " \+ value\)/.test(sync[0]),
      "the selected value remains available in the selector's accessible name");
    check(!/angleWrap/.test(MARKUP), "no disappearing angle wrapper (angleWrap) exists in the markup");

    for(const id of ["showGradeCode","showGradeName","showPersonName","showPersonGrade","showPersonGroup"]){
      const listener = new RegExp('\\$\\("#' + id + '"\\)\\.addEventListener\\("change",[\\s\\S]{0,260}?\\)\\);').exec(SCRIPT);
      check(!!listener, id + " is wired as a discrete change");
      check(listener && /commit\(/.test(listener[0]) && /render:"chart"/.test(listener[0])
        && !/\bedit\(/.test(listener[0]), id + " is one undoable chart commit");
    }
    const namePosition = /\$\("#nameLabelPosition"\)\.addEventListener\("change",[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(namePosition && /oneOf\(e\.target\.value, ENUMS\.nameLabelPosition, "below"\)/.test(namePosition[0]),
      "the name-label selector validates through the shared enum");
    check(namePosition && /commit\(/.test(namePosition[0]) && /state\.nameLabelPosition = value/.test(namePosition[0])
       && /render:"chart"/.test(namePosition[0]) && !/\bedit\(/.test(namePosition[0]),
      "changing name-label position is one undoable chart commit");
    const nameBoldListener = /\$\("#nameBold"\)\.addEventListener\("change",[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(nameBoldListener && /oneOf\(e\.target\.value, ENUMS\.nameBold, "given"\)/.test(nameBoldListener[0]),
      "the name-bolding selector validates through the shared enum");
    check(nameBoldListener && /commit\(/.test(nameBoldListener[0]) && /state\.nameBold = value/.test(nameBoldListener[0])
       && /render:"chart"/.test(nameBoldListener[0]) && !/\bedit\(/.test(nameBoldListener[0]),
      "changing which part of a name is bold is one undoable chart commit");
    check(/\{menu:"#nameLabelsMenu", btn:"#nameLabelsBtn", anchor:"#nameLabelsBtn"\}/.test(SCRIPT),
      "the shared menu table gives Name labels every dismissal path");
    const heading = /function gradeHeadingTexts\(st, tiers, x, cy, maxW, ink, soloCodeSize\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(heading && /if\(!codeOn && !nameOn\) return \[\]/.test(heading[0]),
      "the shared heading policy emits nothing when both choices are off");
    check(heading && /anchor:"middle"/.test(heading[0]) && /y:cy-10/.test(heading[0])
      && /y:cy\+10/.test(heading[0]),
      "and stacks both lines as one centred block");
    /* This geometry now lives in buildBandGroups (the content-width policy)
       and emitBandPeople (positioning people within it) — the shared
       band-stack machinery computeTriangleLayout, computeHistogramLayout AND
       their callers (Pyramid, Tornado, Histogram) all call, so the
       padding/centring logic these lines pin applies to all three, not just
       Pyramid. */
    const bandGroups = /function buildBandGroups\(st\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(bandGroups && /const leftInset = labelW \|\| G\.padRight/.test(bandGroups[0])
      && /const contentW = groups\.map\(g => leftInset \+ g\.people\.length\*personW \+ G\.padRight\)/.test(bandGroups[0]),
      "a label-free band reserves equal left and right padding");
    const bandPeople = /function emitBandPeople\(st, ctx, i, y0, L0, R0, prevGroupX0\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(bandPeople && /const peopleL = L0 \+ leftInset/.test(bandPeople[0])
      && /const avail = \(R0 - G\.padRight\) - peopleL/.test(bandPeople[0])
      && /const x0\s*= peopleL \+ off/.test(bandPeople[0]),
      "and centres people inside that symmetric span");
    check(/^function computePyramidLayout\(st\)\{ return computeTriangleLayout\(st, 1\); \}$/m.test(SCRIPT),
      "computePyramidLayout is a thin wrapper over the shared solver (dir=+1)");
    check(/^function computeTornadoLayout\(st\)\{ return computeTriangleLayout\(st, -1\); \}$/m.test(SCRIPT),
      "computeTornadoLayout is a thin wrapper over the shared solver (dir=-1)");

    /* Save's caret is the visual standard everywhere a ribbon command opens. */
    check(/\.split-toggle \.ic\{width:18px;height:18px/.test(MARKUP),
      "Save establishes the 18px caret standard");
    check(/\.style-caret\{[^}]*width:18px;height:18px[^}]*color:currentColor/.test(MARKUP),
      "Design uses the same size and inherits the command colour");
    /* The chip's caret IS a .split-toggle — Structure does not approximate
       Save's caret with a lookalike. Sharing the class is the whole
       guarantee — a second 20px column with its own borders would drift
       from Save's the first time either was touched. */
    check(/cls:"split-toggle g-chip-toggle"/.test(SCRIPT),
      "Structure's caret is Save's own control, not a lookalike");
    check(/\.split-toggle \.ic\{width:18px;height:18px\}/.test(MARKUP),
      "…which is where its 18px comes from");
    check(!/\.g-chip-toggle[^{]*\{[^}]*color:var\(--mute\)/.test(MARKUP),
      "Structure carries no small grey caret variant");

    /* ---- Font joins the moved Colour command in a new Text group ---- */
    const fontFace = /<button class="style-command style-tall" id="fontBtn"[\s\S]*?<\/button>/.exec(p);
    check(!!fontFace, "Font is one whole selector button in the Text group");
    check(fontFace && /aria-controls="fontMenu"/.test(fontFace[0]) && /aria-haspopup="menu"/.test(fontFace[0]),
      "…naming the menu it opens");
    check(fontFace && /href="#i-brand-family"/.test(fontFace[0]),
      "…carrying the supplied brand_family artwork");
    check(fontFace && />Font</.test(fontFace[0]), "…labelled Font");
    const colourFace = /<button class="style-command style-tall" id="textBtn"[\s\S]*?<\/button>/.exec(p);
    check(colourFace && />Colour</.test(colourFace[0]) && /id="textWarnBadge"/.test(colourFace[0])
       && /href="#i-text"/.test(colourFace[0]) && /aria-controls="textPop"/.test(colourFace[0]),
      "the moved Text command now reads Colour but keeps its id, badge, icon and target");
    /* Colour must not sit in the trailing position of the Text group:
       sitting last there would read as belonging to the group whose caption
       sits right beside it. Font goes first in the Text group instead. */
    check(p.indexOf('id="fontBtn"') >= 0 && p.indexOf('id="textBtn"') >= 0
       && p.indexOf('id="fontBtn"') < p.indexOf('id="textBtn"'),
      "the Text group orders Font before Colour");

    /* FONTS.open-sans has to be the FONT identifier itself, not a second
       spelling of its literal — that duplication is exactly the drift the
       CSS/JS --font check above exists to catch for the base stack, and a
       second copy here would reopen the same hole one property over. */
    check(/"open-sans":\s*FONT\s*,/.test(SCRIPT),
      "FONTS.open-sans is the FONT constant itself, not a duplicated literal");

    /* #fontMenu is bounded to #app rather than a naive non-greedy </div>,
       because it now contains the legend's own nested <div> — the first
       </div> encountered belongs to that, not to the menu. */
    const fontMenuStart = MARKUP.indexOf('<div class="menu style-menu" id="fontMenu"');
    const fontMenuEndAt = MARKUP.indexOf('<div id="app">', fontMenuStart);
    check(fontMenuStart >= 0, "#fontMenu exists beside the other style menus, outside .rb-body");
    const fontMenu = fontMenuStart >= 0 && fontMenuEndAt > fontMenuStart
      ? MARKUP.slice(fontMenuStart, fontMenuEndAt) : "";
    const fontRows = matchAll(
      /<button role="menuitemradio"[^>]*data-style-select="font"[^>]*>[\s\S]*?<\/button>/g, fontMenu
    ).map(m => m[0]);
    check(fontRows.length === 5, "#fontMenu offers exactly five font choices — got " + fontRows.length);
    const fontVals = fontRows.map(rw => (/data-value="([\w-]+)"/.exec(rw) || [])[1]);
    const fontEnum = (() => {
      const m = /font:\s*\["open-sans"[^\]]*\]/.exec(SCRIPT);
      return m ? m[0].replace(/^font:\s*\[/, "").replace(/\]$/, "")
                     .split(",").map(s => s.trim().replace(/"/g, "")) : [];
    })();
    check(fontVals.slice().sort().join(",") === fontEnum.slice().sort().join(",")
       && fontVals.length === 5,
      "the Font menu offers exactly ENUMS.font — got " + JSON.stringify(fontVals)
      + " against " + JSON.stringify(fontEnum));
    check(fontVals.join(",") === fontEnum.join(","),
      "…in ENUMS.font's own order, which the brief also states is the menu order — got "
      + JSON.stringify(fontVals));
    /* Each row previews itself in its own stack and carries the shared warning
       badge — asserted as a class over all five rows rather than five separate
       cases, so the next font added to the enum is covered automatically. */
    check(fontRows.every(rw => /style="font-family:[^"]+"/.test(rw)),
      "every Font row previews itself inline in its own font stack");
    check(fontRows.every(rw => /<span class="style-warn" aria-hidden="true" hidden>!<\/span>/.test(rw)),
      "every Font row carries the shared not-installed badge, hidden until "
      + "syncFontAvailability finds it missing");

    /* The not-installed indicator is a badge plus one legend at the foot of
       the menu, shown only once at least one row actually needs it. */
    const legendMatches = matchAll(/<div class="font-legend"[^>]*>[\s\S]*?<\/div>/g, fontMenu).map(m => m[0]);
    check(legendMatches.length === 1,
      "#fontMenu carries exactly one legend for the badge — got " + legendMatches.length);
    const legend = legendMatches[0] || "";
    check(/role="presentation"/.test(legend), "the legend is a non-interactive presentation element");
    check(!/role="menuitem/.test(legend),
      "…never a menu item — a screenreader must not announce it as a choice");
    check(/font not installed/.test(legend), 'the legend reads "! font not installed"');
    check(/<span class="style-warn" aria-hidden="true">!<\/span>/.test(legend),
      "…drawing its \"!\" with the same shared badge look as the per-row marks");
    const lastRow = fontRows[fontRows.length - 1] || "";
    check(legendMatches.length === 1 && lastRow && fontMenu.indexOf(legend) > fontMenu.lastIndexOf(lastRow),
      "the legend sits after all five rows, not among them");

    /* The canonical hidden select, wired exactly like every other Design
       selector — a menu row commit that reaches straight into state would be
       the one path here that bypasses the shared enum. */
    check(/id="font" hidden aria-hidden="true"[\s\S]*?<option value="open-sans">Open Sans<\/option>[\s\S]*?<option value="segoe-ui">Segoe UI<\/option>[\s\S]*?<option value="roboto">Roboto<\/option>[\s\S]*?<option value="helvetica">Helvetica<\/option>[\s\S]*?<option value="arial">Arial<\/option>/.test(p),
      "the menu is a facade over one canonical hidden select, in ENUMS.font order");
    const rtable = /const RIBBON_MENUS = \[[\s\S]*?\];/.exec(SCRIPT);
    check(rtable && rtable[0].indexOf('menu:"#fontMenu"') >= 0 && rtable[0].indexOf('btn:"#fontBtn"') >= 0,
      "#fontMenu and #fontBtn are registered in RIBBON_MENUS, so Escape, a tab "
      + "change, a resize and a click away all reach it");
    const fontListener = /\$\("#font"\)\.addEventListener\("change",[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(fontListener && /oneOf\(e\.target\.value, ENUMS\.font, "open-sans"\)/.test(fontListener[0]),
      "the font selector validates through the shared enum");
    check(fontListener && /commit\(/.test(fontListener[0]) && /state\.font = value/.test(fontListener[0])
       && /render:"chart"/.test(fontListener[0]) && !/\bedit\(/.test(fontListener[0]),
      "changing the font is one undoable chart commit");
    check(/\$\("#font"\)\.value = oneOf\(state\.font, ENUMS\.font, "open-sans"\)/.test(r),
      "renderAll restores the saved font choice");
    check(sync && /font:\$\("#fontBtn"\)/.test(sync[0]),
      "syncStyleSummaries keeps Font's face in step with aria-checked and its accessible name");
  }

  /* The left panel lists the roster, which is what a saved file is called
     throughout the app and the Info group. It keeps its own heading. */
  check(/<h2>Roster<button/.test(MARKUP),
    "the left sidebar heading text is still exactly \"Roster\", immediately "
    + "followed by its own close button — no text sits between the two");

  /* ---- no standing defaults survive, and nothing is left behind ----
     A grade-and-office pair that silently decided where a batch dropped much
     later would land is exactly the invisible state this app rejects: every
     destination is asked for in the dialog where it takes effect instead.
     Removal has to be complete in every layer at once, because a leftover in
     any one of them is either a dead control or a live one nobody can see. */
  {
    for(const gone of ["dropTier", "dropOffice", "defTier", "defOffice",
                       "defTierName", "defOfficeName", "defTierMenu", "officePop"]){
      check(!new RegExp('id="' + gone + '"').test(MARKUP),
        "#" + gone + " is gone from the markup");
      check(!new RegExp('\\$\\("#' + gone + '"\\)').test(SCRIPT),
        "…and nothing in the script still looks it up");
    }
    check(!/Defaults for new people/.test(MARKUP),
      "the ribbon group they sat in is gone with them");
    for(const cls of ["rb-defaults", "rb-def", "rb-def-txt", "rb-def-label",
                      "rb-def-value", "rb-def-caret", "officepop", "--def-value"]){
      check(MARKUP.indexOf(cls) < 0,
        "the " + cls + " rule is gone from the stylesheet — a stale rule invites the layout back");
    }
    for(const fn of ["syncDefaultSummaries", "openOfficePop", "closeOfficePop", "placeOfficePop"]){
      check(SCRIPT.indexOf(fn) < 0,
        fn + " is absent — such a function would exist only to maintain controls "
        + "that are not in the markup");
    }
    check(!/data-default-tier/.test(MARKUP) && !/data-default-tier/.test(SCRIPT),
      "the grade menu's facade verb is gone, markup and handler together");
    /* the dismissal machinery it was registered in must not still name it */
    const table = /const RIBBON_MENUS = \[[\s\S]*?\];/.exec(SCRIPT);
    check(table && table[0].indexOf("defTierMenu") < 0,
      "RIBBON_MENUS carries no row for a menu that does not exist");
    check(!/placeOfficePop/.test(SCRIPT),
      "and no resize or scroll handler still re-anchors it");
  }

  /* ---- #filePick is gone ----
     The picker's own change handler and the drop route are the only two
     paths into the app's photo decoders; a scan of the WHOLE file, not a
     slice near one call site, is what catches a reintroduced reference
     wherever it turns up. */
  {
    check(!/id="filePick"/.test(MARKUP), "#filePick is gone from the markup");
    check(!/filePick/.test(SCRIPT),
      "…and the word appears nowhere in the script — no lookup, no listener, no click()");
  }

  /* ---- the photo-import dialog asks instead ---- */
  {
    const at = MARKUP.indexOf('id="importModal"');
    check(at > 0, "the import dialog is in the markup");
    const dlg = at > 0 ? MARKUP.slice(at, MARKUP.indexOf('id="addModal"')) : "";
    check(/class="modal-backdrop" id="importModal" hidden/.test(MARKUP),
      "it is a .modal-backdrop and starts hidden, like every other dialog");
    check(/role="dialog"/.test(dlg) && /aria-modal="true"/.test(dlg)
       && /aria-labelledby="importTitle"/.test(dlg) && /id="importTitle"/.test(dlg),
      "built like the others: modal, named by its own heading");
    check(/class="btnrow modal-foot"/.test(dlg),
      "and its actions use the shared .btnrow.modal-foot alignment");
    check(/trapTab\("#importModal"\)/.test(SCRIPT), "Tab is trapped inside it");
    check(/id="importCount"/.test(dlg),
      "it has somewhere to say how many photos it is about to import");
    check(/<select id="importTier">/.test(dlg) && /id="importGroup"/.test(dlg),
      "and the two fields it asks for");
    check(/fillTierOptions\(\$\("#importTier"\)/.test(SCRIPT),
      "…the grade list built by the same helper every other grade select uses");

    const ask = /function askImport\(count\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!ask, "askImport is readable");
    if(ask){
      check(/\$\("#importCount"\)\.textContent/.test(ask[0]) && /count \+ " photos to import/.test(ask[0]),
        "it states the count, which is what makes the answer a considered one");
      check(/\$\("#importConfirmBtn"\)\.disabled = noGrades/.test(ask[0])
         && /\$\("#importNoGrades"\)\.hidden = !noGrades/.test(ask[0]),
        "with no grades it disables Import and shows the reason — the dialog explains");
      check(/\$\("#importGroup"\)\.value = ""/.test(ask[0]),
        "and it opens with an empty group: nothing is remembered between imports");
      check(!/state\.tiers\.some/.test(ask[0]),
        "…and keeps no previous grade either — that would be the default it replaced");
    }
    check(/id="importNoGrades"[^>]*hidden>Add a grade or apply a template under Structure first</.test(dlg),
      "the reason is the wording every other add route already uses");

    /* addFiles: plans before it asks, and asks only when the plan adds someone
       (a pure-attachment batch has no destination to ask about) */
    const af = /async function addFiles\(files\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!af, "addFiles is readable");
    if(af){
      check(af[0].indexOf("const plan = imgs.map") < af[0].indexOf("await askImport"),
        "the name-match plan is built before the dialog is ever asked, not after");
      check(af[0].indexOf("const additions") < af[0].indexOf("await askImport"),
        "…so the batch already knows whether it has anywhere new to ask about");
      check(/if\(additions\)\{[\s\S]*?await askImport\(imgs\.length\)/.test(af[0]),
        "addFiles asks only when the batch adds someone, and asks about the photos "
        + "it will actually import");
      check(/if\(!answer\) return;/.test(af[0]),
        "…and a cancelled dialog imports nobody, with no separate branch to get wrong");
      check(af[0].indexOf("askImport") < af[0].indexOf("state.people.push"),
        "the question, when asked, comes before anything is added");
      check(af[0].indexOf("importBusy") < af[0].indexOf("askImport"),
        "…and after the busy check, so a second batch is never asked about while the first decodes");
      check(af[0].indexOf("imgs.length") < af[0].indexOf("askImport"),
        "…and after the filter, so the count it states is the count it will import");
      check(/if\(additions\)\{[\s\S]*?if\(!state\.tiers\.length\)/.test(af[0])
         && af[0].indexOf("askImport") < af[0].indexOf("if(!state.tiers.length)"),
        "and it refuses on its own after the dialog, still inside the addition-only branch: "
        + "disabled is a claim about the UI, not a lock");
      check(af[0].indexOf("if(state.people.length + additions > LIMITS.people)")
          > af[0].indexOf("if(additions)"),
        "…the roster-size refusal reads the plan's own additions count, computed up front");
    }
    /* the entry points stay live, so the dialog is reachable to explain */
    const avail = /function syncStructureAvailability\(\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(avail && !/\$\("#drop"\)/.test(avail[0]),
      "the drop zone is not disabled when there are no grades — a dead zone "
      + "cannot be dropped on and cannot explain itself");

    /* The picker's own change handler and the drop route both hand a single
       decoded photo to the Add dialog the same way — importBusy guard, gen
       capture, decode, blank-name fill, failure alert, setAddPhoto. One
       function, driven from both places, or a fix to one path could silently
       not reach the other. Counted rather than merely searched for: a third
       call site, or a caller that inlines its own copy instead, has to turn
       this red. */
    const dialogFn = /async function addPhotoIntoDialog\(file\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!dialogFn, "addPhotoIntoDialog exists as its own named function");
    const dialogCalls = (SCRIPT.match(/addPhotoIntoDialog\(/g) || []).length;
    check(dialogCalls === 3,
      "…and the name appears three times total — its own definition plus exactly two "
      + "callers — got " + dialogCalls);
    const pickHandler = /\$\("#addPhoto"\)\.addEventListener\("change", async e=>\{[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(pickHandler && /await addPhotoIntoDialog\(file\)/.test(pickHandler[0]),
      "…one caller is the picker's own change handler, calling the shared function "
      + "rather than keeping its own copy of the body");
    check(pickHandler && !/processImage/.test(pickHandler[0]),
      "…and does not decode anything itself — decoding lives in the shared function alone");
  }

  /* ---- the Group field offers existing groups ----------------------------

     #addGroup / #editGroup / #importGroup stay free text — the on-ramp
     (typing an existing label reuses that group, typing new text mints one)
     — but a shared <datalist> now offers what already exists, the same
     one-writer rule fillTierOptions keeps for every grade list. */
  {
    const dlCount = (MARKUP.match(/<datalist id="groupOptions">/g) || []).length;
    check(dlCount === 1,
      "the groupOptions datalist exists exactly once in the markup — got " + dlCount);

    /* A class check over the set of all three inputs, not three separate
       assertions — the point is the rule, not any one instance of it. */
    for(const id of ["addGroup", "editGroup", "importGroup"]){
      const tag = (new RegExp('<input[^>]*id="' + id + '"[^>]*>').exec(MARKUP) || [""])[0];
      check(/list="groupOptions"/.test(tag),
        "#" + id + " offers the group suggestion list via list=\"groupOptions\"");
    }

    const fillGroupOptionsFn = /function fillGroupOptions\(\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!fillGroupOptionsFn, "fillGroupOptions is readable");
    check(fillGroupOptionsFn && /\$\("#groupOptions"\)/.test(fillGroupOptionsFn[0])
       && /state\.groups/.test(fillGroupOptionsFn[0]),
      "…and it is the one writer: built from #groupOptions and state.groups, "
      + "not a second list that could drift from fillTierOptions' pattern");

    /* Called on each dialog's open, plus once more after a successful Add —
       never from a render/scroll path, which would rebuild the list under
       the user while a field is focused. */
    const openAddModalFn = /function openAddModal\(wantTier\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(openAddModalFn && /fillGroupOptions\(\)/.test(openAddModalFn[0]),
      "openAddModal refills the group suggestion list when it opens");

    const openEditModalFn = /function openEditModal\(id\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(openEditModalFn && /fillGroupOptions\(\)/.test(openEditModalFn[0]),
      "openEditModal refills it too — not syncEditModal, which reruns on every "
      + "render while the dialog stays open and must not rebuild the list under "
      + "the user's hands");
    check(openEditModalFn && !/function syncEditModal/.test(openEditModalFn[0]),
      "…confirming the extract really is openEditModal and not syncEditModal itself");

    const askImportFn = /function askImport\(count\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(askImportFn && /fillGroupOptions\(\)/.test(askImportFn[0]),
      "askImport refills it when the import dialog opens");

    const addOnePersonFn = /async function addOnePerson\(\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(addOnePersonFn && /fillGroupOptions\(\)/.test(addOnePersonFn[0]),
      "addOnePerson refills it after a successful Add — the person just added may "
      + "have minted a new group");
  }

  /* ---- the paste dialog asks nothing about grades ----

     The paste dialog must never carry a "Grade for rows that do not name one"
     select, asked before the user can see which rows it is about: rows that
     name no grade this document has go to a grade called NEW, created or
     reused inside the commit that adds the people. What is asserted here is
     the markup half — that no part of such a control exists, and that the
     prose does not point at it. test/document.js §5b3 drives the behaviour. */
  {
    check(!/pasteTier/.test(MARKUP),
      "the paste dialog carries no grade field — not the select, not its label");
    check(!/pasteTier/.test(SCRIPT),
      "…and nothing in the script reads, fills or listens to one");
    check(!/Grade for rows that do not name one/.test(MARKUP),
      "…so the question it asked is not on screen either");
    /* The prose is the part no suite can catch by structure: a paragraph still
       saying "falls back to the grade chosen above" would be naming a control
       that does not exist, which sends the reader looking for it. */
    const entry = /id="pasteEntry"[\s\S]*?<\/textarea>/.exec(MARKUP);
    check(entry && !/chosen above/.test(entry[0]),
      "and the entry step's help text names no control above it");
    check(entry && /grade called NEW/.test(entry[0]),
      "…it names where an unrecognised grade actually sends the row");
    /* Two independent sources: the promise in the markup and the code the script
       will actually give the grade. Prose is the one thing no structural check
       catches, and a help text naming a grade the app does not create sends the
       reader looking for something that is not there. */
    const codeConst = /const PASTE_NEW_CODE\s*=\s*"([^"]*)"/.exec(SCRIPT);
    check(!!codeConst, "the code the new grade carries is a named constant");
    check(codeConst && entry && entry[0].indexOf("grade called " + codeConst[1]) >= 0,
      "…and the help text names that same code — markup says "
      + JSON.stringify(entry && /grade called (\S+)/.exec(entry[0]) ? RegExp.$1 : "?")
      + ", script creates " + JSON.stringify(codeConst && codeConst[1]));

    /* A document with no grades yet does not
       refuse a paste — the Grade column becomes the structure instead
       (pasteGradePlan, driven end to end in test/document.js). The entry hint
       gained a sentence saying so, and kept naming NEW for the case that still
       reaches it (an empty grade cell in an otherwise-populated document). */
    check(entry && /no grades yet/.test(entry[0]),
      "the entry hint states the zero-grade case explicitly");
    check(entry && /grade called NEW/.test(entry[0]),
      "…without losing the sentence about where an empty cell still goes");


    /* The sentinel, and the one thing that could quietly break it: a value that
       could collide with a real grade id. uid() is base36, so the leading
       control character is what makes the collision impossible — asserted here
       rather than trusted, because a sentinel that equalled an id would put
       people in a real grade chosen at random. */
    const sent = /const PASTE_NEW\s*=\s*("[^"]*")/.exec(SCRIPT);
    check(!!sent, "the paste fallback is one module-level sentinel constant");
    const val = sent && JSON.parse(sent[1]);
    check(val && !/^[0-9a-z]+$/.test(val),
      "…whose value is outside uid()'s base36 alphabet, so it can never be a grade id");

    /* One wording for the grade limit, not a fourth. COMMANDS.addGrade owns the
       sentence; the two paste sites must state the identical string. A class
       check over every site that mentions the grade cap, so the next one is
       caught too. */
    const capRx = /"A roster can contain at most " \+ LIMITS\.tiers \+ " grades"/g;
    const caps = SCRIPT.match(capRx) || [];
    check(caps.length >= 3,
      "the grade limit is stated at the add command and at both paste checks — got "
      + caps.length + " site(s)");
    const anyCap = SCRIPT.match(/at most " \+ LIMITS\.tiers \+ "[^"]*"/g) || [];
    check(anyCap.length === caps.length,
      "…and every site that states the grade cap states it in the same words — "
      + anyCap.length + " mention(s), " + caps.length + " in the shared wording");
  }

  /* Every add route asks for its destination instead of reading a standing
     one — addFiles and the paste preview take the answer from the dialog
     where the question is asked, which the two blocks above assert directly.
     What is left to check here is that neither reads a standing default. */
  {
    for(const [name, rx] of [
      ["addFiles",          /async function addFiles\(files\)[\s\S]*?\n\}/],
      ["the paste preview", /function showPastePreview\(\)[\s\S]*?\n\}/],
      ["addOnePerson",      /async function addOnePerson\(\)[\s\S]*?\n\}/]
    ]){
      const m = rx.exec(SCRIPT);
      check(!!m, name + " is readable");
      check(m && !/dropTier|dropOffice/.test(m[0]),
        name + " reads no standing default — the value comes from its own dialog");
    }
    check(/parsePasteText\(\$\("#pasteArea"\)\.value, PASTE_NEW\)/.test(SCRIPT),
      "and the paste preview passes the sentinel as the grade fallback — "
      + "nothing is read from a control");
  }

  /* An empty-chart apology — "No grades defined." plus a sentence pointing
     at Structure, its last word switching on the layout — must not exist
     anywhere: zero grades is the start view every new document opens to
     (see 4e3 below), not a state to apologise for. */
  check(!/No grades defined/.test(SCRIPT) && !/No grades defined/.test(MARKUP),
    "no \"No grades defined\" apology message exists in the app");
  check(!/Add one under Structure to start the/.test(SCRIPT),
    "…and its call to action with it");
  check(!/under Grades|Design tab|Roster tab/.test(SCRIPT),
    "and no instruction still sends the user to a tab name that is gone");

  /* aria-selected and the roving tabindex are set by selectTab, not in markup —
     if they were only in markup they would go stale on the first tab change */
  check(/setAttribute\("aria-selected"/.test(SCRIPT), "selectTab maintains aria-selected");
  check(/tabIndex = on \? 0 : -1/.test(SCRIPT), "selectTab maintains a roving tabindex");
  check(/ArrowRight/.test(SCRIPT) && /ArrowLeft/.test(SCRIPT), "arrow keys move between tabs");
  check(/"Home"/.test(SCRIPT) && /"End"/.test(SCRIPT), "Home and End jump to the ends");

  /* --- the dialog */
  check(/role="dialog"/.test(MARKUP), "the paste modal is a dialog");
  check(/aria-modal="true"/.test(MARKUP), "the dialog is modal");
  check(/aria-labelledby="pasteTitle"/.test(MARKUP), "the dialog is named by its heading");
  check(/id="pasteTitle"/.test(MARKUP), "that heading exists");
  {
    const actionRows = matchAll(/class="([^"]*\bbtnrow\b[^"]*)"/g, MARKUP);
    check(actionRows.length === 8, "all eight modal action rows are present");
    check(actionRows.every(m => /\bmodal-foot\b/.test(m[1])),
      "every modal action row shares .modal-foot");
    check(/\.modal-foot\{[^}]*justify-content:center/.test(MARKUP),
      "and .modal-foot centres every popup's action buttons");
  }
  /* Naming the variable is not the behaviour. What matters is that closing
     actually calls focus() on it — dropping that line left the test green. */
  check(/modalReturn = document\.activeElement/.test(SCRIPT),
    "the dialog records what had focus when it opened");
  /* one implementation for every dialog, so this is checked in one place */
  const closeFn = /function modalClose\([\s\S]*?\n\}/.exec(SCRIPT);
  check(!!closeFn, "modalClose is readable");
  check(closeFn && /modalReturn\.focus\(\)/.test(closeFn[0]),
    "closing a dialog gives focus back, rather than stranding it at the top of the page");
  check(closeFn && /modalReturn = null/.test(closeFn[0]),
    "and forgets it afterwards, so a stale element is never focused");
  check(/trapTab\("#pasteModal"\)/.test(SCRIPT) && /trapTab\("#askModal"\)/.test(SCRIPT),
    "both dialogs get the same focus trap");
  check(/\.inert = true/.test(SCRIPT), "the page behind the dialog is made inert");
  check(/setAttribute\("aria-hidden", "true"\)/.test(SCRIPT),
    "and hidden from assistive technology as a fallback where inert is missing");
  check(/e\.key !== "Tab"/.test(SCRIPT), "Tab is trapped inside the dialog");

  /* --- live regions */
  check(/id="toast"[^>]*role="status"/.test(MARKUP), "the toast is a status region");
  check(/id="toast"[^>]*aria-live="polite"/.test(MARKUP), "the toast is announced politely");
  check(/id="alerts"[^>]*role="alert"/.test(MARKUP), "there is a separate alert region");
  check(/id="alerts"[^>]*aria-live="assertive"/.test(MARKUP), "failures interrupt");
  check(/function alertMsg\(/.test(SCRIPT), "alertMsg routes failures to it");
  /* the cases where the user has to do something differently */
  for(const site of ["could not be opened", "did not finish"]){
    check(new RegExp('alertMsg\\("[^"]*' + site).test(SCRIPT),
      'the "' + site + '" failure is announced assertively, not just toasted');
  }

  /* --- the chart is a picture, and there is a text equivalent of it */
  check(/function describeChart\(/.test(SCRIPT), "the chart is described");
  check(/setAttribute\("role", "img"\)/.test(SCRIPT), "the chart SVG is exposed as an image");
  check(/setAttribute\("aria-label", summary\)/.test(SCRIPT), "and carries a summary");
  check(/id="chartText"/.test(MARKUP), "there is a host for the text equivalent");
  check(/\.sr-only\{/.test(MARKUP), "the visually-hidden helper exists");
  check(!/\.sr-only\{[^}]*display:\s*none/.test(MARKUP),
    "sr-only does not use display:none, which would hide it from screenreaders too");

  /* --- the drop zone sits BELOW the roster, and its click is deliberate ---
     The Add people dialog is the primary way to add someone, so the zone is
     the secondary path and the reading order says so: who is on the chart,
     then a way to add more. */
  {
    const rosterAt = MARKUP.indexOf('<h2>Roster<button');
    const zoneAt   = MARKUP.indexOf('id="drop"');
    check(rosterAt > 0 && zoneAt > rosterAt,
      "the drop zone renders BELOW the roster, not above it");
    /* One surface, two gestures — and the text has to name both, or the click
       is a discovery rather than an affordance. A
       single dropped photo opens the Add dialog too, so the drop half of
       the copy is honest only if it says "a photo" (singular) and admits a
       batch behaves differently — it must not read as "every drop opens the
       dialog", which would be false for several photos at once. */
    const zone = /<button type="button" class="drop" id="drop">[\s\S]*?<\/button>/.exec(MARKUP);
    check(zone && /Drop a photo here to add its person/.test(zone[0]),
      "the zone says a photo can be dropped on it, and says what that does");
    check(zone && /several at once start an import/i.test(zone[0]),
      "…and admits out loud that a batch behaves differently, rather than letting "
      + "the singular claim be read as covering every drop");
    check(zone && /click to add someone/.test(zone[0]),
      "…and says the click adds someone, so the second gesture is not hidden");
    check(zone && !/click to choose/.test(zone[0]),
      "…and promises no file picker, which is not what it opens");
    check(zone && !/Drop JPEG or PNG photos here/.test(zone[0]),
      "…and states no blanket phrasing that every drop is a batch");
    /* the click goes to the deliberate dialog; a single drop now goes to the
       SAME dialog (below); several, or one that already matches somebody,
       still go to addFiles and the import dialog */
    /* Greedy to the end of the line, not lazy to the first ")": the argument this
       exists to read is itself a call, so a lazy match stops inside it and the
       capture is a fragment that fails every check below for the wrong reason. */
    const dropClick = /\$\("#drop"\)\.addEventListener\("click",(.*)\);\s*$/m.exec(SCRIPT);
    check(dropClick && /openAddModal/.test(dropClick[1]),
      "clicking the zone opens the Add people dialog — the same one the split's face opens");
    /* THE POINT OF THIS ONE: openAddModal's first argument is a grade id now, and
       a listener bound to the bare function is handed the click instead. A
       PointerEvent fails the "does this grade exist" test, so the dialog opens on
       the previous choice and nothing looks wrong — there is no visible symptom
       and no other assertion that can see it. Checked as a class over every
       argument form rather than by pinning one spelling: what is forbidden is
       handing the listener's own event to a function that now reads it. */
    check(dropClick && !/^\s*openAddModal\s*$/.test(dropClick[1]),
      "…through a wrapper, not the bare function reference — bound bare, the click "
      + "event itself arrives where a grade id is expected, silently — got "
      + JSON.stringify(dropClick && dropClick[1]));
    check(dropClick && /^\s*\(\s*\)\s*=>/.test(dropClick[1]),
      "…and the wrapper takes no parameter of its own, so nothing can be "
      + "forwarded into it later either");
    check(!/\$\("#drop"\)\.addEventListener\("click",[\s\S]{0,120}?filePick/.test(SCRIPT),
      "…and not a file picker");
    const drops = /\[\$\("#drop"\), \$\("#dropZone"\)\]\.forEach[\s\S]*?\}\);\n\}\);/.exec(SCRIPT);
    check(!!drops, "the drop handler is readable");
    /* Exactly one dropped photo that names nobody
       already on the roster is the deliberate single add — same dialog the
       click opens, prefilled. Everything else (several files, a single
       non-photo, or a single photo whose derived name matches a photo-less
       person) still goes to addFiles unchanged; the matched-name case then
       attaches with no dialog at all because addFiles' own plan is pure
       attachment — that half is proved behaviourally in test/document.js. */
    check(drops && /addFiles\(files\)/.test(drops[0]),
      "several photos, or a single one that already matches somebody, still go to addFiles");
    check(drops && /files\.length === 1/.test(drops[0]),
      "…the single-vs-batch decision is made on the drop's own file count");
    check(drops && /openAddModal\(\)/.test(drops[0]),
      "…and a lone unmatched photo opens the Add dialog — the same one the click opens");
    check(drops && /addPhotoIntoDialog\(solo\)/.test(drops[0]),
      "…and hands it the dropped file directly, through the same function the picker uses");
    check(drops && /photolessMatch\(/.test(drops[0]),
      "…the name-match question is asked through the shared helper, not a second comparison "
      + "that could quietly disagree with addFiles' own plan");
    check(drops && drops[0].indexOf("openAddModal()") < drops[0].indexOf("addFiles(files)"),
      "…and the single-add branch is decided and returns before the batch fallback is ever reached");
    /* the empty state must not send anyone the wrong way */
    check(!/Photos dropped above land here/.test(SCRIPT),
      "the empty state does not say photos dropped ABOVE land in the roster");
    check(/Add someone with the button below, or drop photos on it/.test(SCRIPT),
      "…it names the zone's real position and both of its gestures");
  }

  /* --- no action is pointer-only */
  check(/<button type="button" class="drop" id="drop">/.test(MARKUP),
    "the photo drop zone is a button, not a clickable div");
  /* The naming hint carries an info icon. The base .ic is display:block — right
     for the ribbon buttons that stack an icon over a label, wrong here, where it
     would put the glyph on its own line above the text it introduces. The
     override is the whole reason this reads as one sentence. */
  {
    const zone = /<button type="button" class="drop" id="drop">[\s\S]*?<\/button>/.exec(MARKUP);
    check(!!zone, "the drop zone is readable");
    check(zone && zone[0].indexOf('<use href="#i-info"/>') > 0,
      "the naming hint is introduced by the info icon");
    check(zone && /<use href="#i-info"\/><\/svg>Dropped file names become names:/.test(zone[0]),
      "and the icon sits in front of that line, not in front of the whole zone");
    check(/\.drop \.ic\{[^}]*display:inline-block/.test(MARKUP),
      "the icon is put back inline — the base .ic is display:block and would break the line");
  }
  /* The roster thumbnail is deliberately not a button: it is the row's
     surface, and a surface made of controls has nothing to take hold of. Both
     halves are stated, because "no button" alone would pass on a row that had
     lost its thumbnail altogether. */
  check(/el\("span", \{cls:"thumb"/.test(SCRIPT),
    "the roster thumbnail is a span — surface, not a control");
  check(!/cls:"thumb", act:|type:"button", cls:"thumb"/.test(SCRIPT),
    "…carrying no verb and no button type, so it is not a target and not a tab stop");
  check(/el\("button", \{type:"button", cls:"fp-circle"/.test(SCRIPT),
    "the photo framing circle is a button");
  /* \b matters: `const PAN_STEP` also matches `const PAN_STEP_UNUSED`, so
     renaming the constant to disable the feature passed this check. */
  check(/\bPAN_STEP\b\s*=/.test(SCRIPT), "panning has a keyboard step size");
  check(/ArrowLeft:\[-1,0\]/.test(SCRIPT), "the arrow keys are mapped");
  /* and the step is actually applied to the frame */
  check(/dir\[0\]\s*\*\s*step/.test(SCRIPT) && /dir\[1\]\s*\*\s*step/.test(SCRIPT),
    "an arrow press moves the photo on both axes");
  check(/PAN_STEP \* \(e\.shiftKey/.test(SCRIPT), "Shift takes a bigger step");

  /* --- names, not just titles. An icon-only button with a title but no
     accessible name is announced as "button". */
  check(/if\(o\.label\) n\.setAttribute\("aria-label", o\.label\)/.test(SCRIPT),
    "el() can set an accessible name");
  const labels = matchAll(/label:/g, SCRIPT).length;
  check(labels >= 15, "controls are given accessible names (found " + labels + " label: uses)");

  /* --- the grade options that cannot apply to the first grade */
  /* The panel has room to say what these do rather than abbreviating. What
     must never come back is the single letter.
     "Left" is the direction in the strip the user is looking at, the same one
     the reorder buttons under them use — not "previous", which names a place in
     an array nobody can see. */
  check(/text:"Attach to left"/.test(SCRIPT)
     && /text:"Share band"/.test(SCRIPT),
    'the grade toggles are labelled in words, not as "A" and "S"');
  check(/disabled:first/.test(SCRIPT),
    "both are disabled on the first grade, which has nothing above it");

  /* --- contrast */
  check(/function luminance\(/.test(SCRIPT), "WCAG luminance is implemented");
  check(/function contrastRatio\(/.test(SCRIPT), "contrast ratio is implemented");
  check(/const CONTRAST_MIN = 4\.5/.test(SCRIPT), "the AA threshold for normal text is used");
  check(/id="contrastWarn"/.test(MARKUP), "there is somewhere to show the warning");
  check(/checkContrast\(\)/.test(SCRIPT), "the check runs on render");
}

/* --------------------------- 4d4. Design-pane typography + Position icons */
/* Two separate rules, and they are deliberately not the same rule. #labelsPop
   and #nameLabelsMenu's Display group keep real, visible
   <input type="checkbox"> elements inside .style-check labels — never
   check-mark rows, which is what the radio-style Position group uses. The
   typography IS shared: .style-check reads at the same reference weight as
   everything else in a style-pop or Design menu, folded into the one shared
   rule rather than keeping a font-size term of its own. */
{
  /* ---- the shared style-pop typography rule: one grouped selector, one
     writer, at the same weight a Design menu row itself uses —
     12.5px/550/--ink-2 — covering FIVE parts: .style-pop .field > span,
     .style-colour-row label, .accent-more, .style-check, and .gf > span (the
     grade panel's Code and Name field labels). No part carries a font-size
     declaration of its own beside it — a second statement of one size is
     what drifts. */
  const typo = /\.style-pop \.field > span, \.style-colour-row label, \.accent-more, \.style-check, \.gf > span\{[^}]*\}/.exec(MARKUP);
  check(!!typo, "the shared style-pop typography rule exists, as one five-part grouped selector");
  check(typo && /font-size:12\.5px/.test(typo[0]) && /font-weight:550/.test(typo[0])
     && /color:var\(--ink-2\)/.test(typo[0]),
    "…at 12.5px/550/--ink-2 — got " + JSON.stringify(typo && typo[0]));
  check((MARKUP.match(/\.style-pop \.field > span, \.style-colour-row label, \.accent-more, \.style-check, \.gf > span\{/g) || []).length === 1,
    "…and it exists exactly once — one shared rule, one writer");
  check(!/\.style-colour-row label\{font-size:12\.5px\}/.test(MARKUP),
    "no standalone .style-colour-row label{font-size:12.5px} declaration exists — it is folded "
    + "into the shared rule instead of duplicated");
  check(!/\.gf > span\{font-size:11px;color:var\(--mute\)\}/.test(MARKUP),
    "no standalone .gf > span{font-size:11px;color:var(--mute)} declaration exists — it is folded "
    + "into the shared rule instead of duplicated");
  /* Anchored on display:flex specifically, not a bare /\.style-check\{/
     search: if the shared rule's own selector list ever ended "…,
     .style-check{" — its current five-part form does not, but a future
     reordering could put .style-check last — a bare search would match that
     occurrence and find the very same rule's own font-size:12.5px right
     after it, a false pass from the wrong occurrence that proves nothing
     about the base rule. The check stays anchored on display:flex
     regardless, since that is what actually names the base rule either way. */
  check(!/\.style-check\{display:flex[^}]*font-size:12\.5px/.test(MARKUP),
    "the base .style-check rule states no font-size of its own — it is folded into the shared "
    + "rule instead of duplicated (mutation M2': removing .style-check from the shared rule's "
    + "selector list must fail this five-part assertion)");
  check(/\.style-check\{display:flex;align-items:center;gap:8px;margin:7px 0;cursor:pointer\}/.test(MARKUP),
    "…while .style-check keeps every one of its layout terms — display/align-items/gap/margin/cursor");

  /* ---- the Position icons are Material's move_selection_up /
     move_selection_left, specifically — the same dedicated-pin pattern as
     Swimlanes/waves, Histogram/graphic_eq and Hive/hive elsewhere in this
     file: the general provenance loop (§2b) only proves each symbol matches
     SOME file in sprites/, and a mix-up between the two (or a hand-typed
     approximation) would still pass it. Mutation-tested as M5 together with
     the row-binding pins beside the Position markup checks above. */
  const upSrc = readFile(here() + "sprites/move_selection_up_40dp_E3E3E3_FILL0_wght400_GRAD0_opsz40.svg");
  const upD = (/\bd="([^"]+)"/.exec(upSrc) || [])[1];
  const belowD = (/<symbol[^>]*\bid="i-name-below"[^>]*><path d="([^"]+)"/.exec(HTML) || [])[1];
  check(!!upD, "sprites/move_selection_up_…svg is readable");
  check(!!belowD && belowD === upD,
    "#i-name-below's path data matches sprites/move_selection_up_40dp_E3E3E3_FILL0_wght400_GRAD0_opsz40.svg "
    + "in full — the move_selection_up artwork, not a hand-typed approximation");

  const leftSrc = readFile(here() + "sprites/move_selection_left_40dp_E3E3E3_FILL0_wght400_GRAD0_opsz40.svg");
  const leftD = (/\bd="([^"]+)"/.exec(leftSrc) || [])[1];
  const nextD = (/<symbol[^>]*\bid="i-name-next"[^>]*><path d="([^"]+)"/.exec(HTML) || [])[1];
  check(!!leftD, "sprites/move_selection_left_…svg is readable");
  check(!!nextD && nextD === leftD,
    "#i-name-next's path data matches sprites/move_selection_left_40dp_E3E3E3_FILL0_wght400_GRAD0_opsz40.svg "
    + "in full — the move_selection_left artwork, not a hand-typed approximation");
}

/* ---------------------------------------------------------- 4e. UX */

{
  /* --- no native dialogs left. They block the thread, cannot be labelled or
     styled, and can be suppressed by the browser — a user who ticks "don't
     show me these again" would silently lose the unsaved-work guard. */
  for(const [call, why] of [
    ["confirm(", "confirm() blocks and cannot be labelled"],
    ["prompt(",  "prompt() blocks and cannot be labelled"],
    ["alert(",   "alert() blocks"]
  ]){
    /* askConfirm/confirmDiscard/confirmPaste legitimately contain the word */
    const hits = matchAll(new RegExp("(^|[^A-Za-z.])" + call.replace("(", "\\("), "g"), SCRIPT)
      .filter(m => !/ask|Discard|Paste/.test(SCRIPT.slice(Math.max(0, m.index - 12), m.index + 10)));
    check(hits.length === 0, "no native " + call + ") — " + why
      + (hits.length ? " (found at offset " + hits[0].index + ")" : ""));
  }
  check(/function ask\(/.test(SCRIPT), "there is an in-app dialog");
  check(/function askConfirm\(/.test(SCRIPT), "and a confirm shape");
  check(/function askText\(/.test(SCRIPT), "and a text shape");
  check(/id="askModal"/.test(MARKUP), "the dialog exists in the markup at boot");
  check(/id="askModal"[\s\S]{0,200}role="dialog"/.test(MARKUP), "it is a dialog");
  check(/aria-modal="true"/.test(MARKUP.slice(MARKUP.indexOf('id="askModal"'))),
    "and a modal one");
  check(/askClose\(null\)/.test(SCRIPT), "Escape and the backdrop cancel it");
  /* a cancelled dialog must resolve, not hang: every path clears askResolve */
  const askCloseFn = /function askClose\([\s\S]*?\n\}/.exec(SCRIPT);
  check(askCloseFn && /askResolve = null/.test(askCloseFn[0]),
    "closing the dialog releases the pending promise");
  check(askCloseFn && /if\(done\) done\(value\)/.test(askCloseFn[0]),
    "and resolves it, so an awaiting caller cannot hang");
  /* the buttons say what they do */
  check(/"Discard and open"/.test(SCRIPT) && /"Discard and start new"/.test(SCRIPT),
    'discard buttons name the action, not "OK"');
  check(/confirmLabel \|\| "Discard changes"/.test(SCRIPT),
    "a caller that forgets a label still gets a real one, not undefined");

  /* --- Cancel takes the emphasis when the confirmer is destructive:
     one policy, written once in askConfirm, and no
     call site opts out. document.js stubs askConfirm out wholesale rather
     than driving the real dialog (its own comment says so, by MODAL_FNS), so
     no suite executes ask()'s action-building — except this block does,
     by extracting the real askConfirm source and running it against a
     stand-in ask() that only records what it was handed. That is a second
     source from the assertion's point of view: the recorded actions come
     from actually running the shipped function, not from re-reading its
     text a second time. */
  {
    const askConfirmSrc = /function askConfirm\([\s\S]*?\n\}/.exec(SCRIPT);
    check(!!askConfirmSrc, "askConfirm's source can be extracted whole");
    let built = null;
    if(askConfirmSrc){
      try{
        const factory = new Function("ask",
          askConfirmSrc[0] + "\nreturn askConfirm;");
        const stubAskConfirm = factory((opts) => { built = opts; return {then(){}}; });
        stubAskConfirm("T", "M", "Do it", "danger");
        const dangerActions = built && built.actions;
        stubAskConfirm("T", "M", "Do it");
        const plainActions = built && built.actions;
        check(dangerActions && dangerActions[1] && dangerActions[1].label === "Cancel"
           && dangerActions[1].cls === "primary",
          "a danger confirmer makes Cancel the emphasized button — got cls "
          + JSON.stringify(dangerActions && dangerActions[1] && dangerActions[1].cls));
        check(dangerActions && dangerActions[0] && dangerActions[0].cls === "danger",
          "…without disturbing the confirmer's own danger styling");
        check(plainActions && plainActions[1] && plainActions[1].label === "Cancel"
           && !plainActions[1].cls,
          "a call that passes no cls leaves Cancel exactly as before — no cls "
          + "at all — got " + JSON.stringify(plainActions && plainActions[1] && plainActions[1].cls));
        check(plainActions && plainActions[0] && plainActions[0].cls === "primary",
          "…and the confirmer still defaults to primary when no cls is given");
      } catch(e){
        check(false, "askConfirm's extracted source ran without throwing — got " + e);
      }
    }
  }

  /* --- the legibility warning */
  check(/function checkLegibility\(/.test(SCRIPT), "the chart warns when it is too small to read");
  check(/id="legibility"/.test(MARKUP), "there is somewhere to show it");
  check(/MIN_NAME_PT/.test(SCRIPT) && /MIN_FACE_PT/.test(SCRIPT),
    "both text and face size are considered");
  const legFn = /function checkLegibility\([\s\S]*?\n\}/.exec(SCRIPT);
  check(legFn && /fixes\.push/.test(legFn[0]),
    "the warning suggests what to change, not just that something is wrong");
  check(legFn && /turn the page to portrait/.test(legFn[0]),
    "and names concrete settings");
  check(/checkLegibility\(L\)/.test(SCRIPT), "it runs on every redraw");
  {
    const stageAt = MARKUP.indexOf('<main class="stage">');
    const stageEnd = MARKUP.indexOf('</main>', stageAt);
    const stageSlice = stageAt >= 0 && stageEnd > stageAt ? MARKUP.slice(stageAt, stageEnd) : "";
    check(/id="legibility"/.test(stageSlice),
      "the bar lives inside the stage, ending at the chart's edge rather than spanning under the roster");
    const warnbarCSS = /\.warnbar\{[\s\S]*?\}/.exec(MARKUP);
    check(warnbarCSS && /color:var\(--warn\)/.test(warnbarCSS[0]),
      "the legibility warning's text takes the danger family colour, not a bespoke amber");
    check(warnbarCSS && /background:var\(--warn-tint\)/.test(warnbarCSS[0])
       && /\.warn-chip\{[^}]*background:var\(--warn-tint\)/.test(MARKUP)
       && /button\.danger:hover\{[^}]*background:var\(--warn-tint\)/.test(MARKUP)
       && (HTML.match(/#fdf1f3/g) || []).length === 1,
      "the legibility warning bar, the contrast warning chip and button.danger:hover all read the one --warn-tint definition, and #fdf1f3 appears nowhere but that definition");
  }

  /* --- narrow viewports */
  check(/@media \(max-width:900px\)/.test(MARKUP), "there is a narrow-viewport breakpoint");
  /* One class, roster-hidden, answers panel-vs-stage visibility at every
     width. There must be no second mechanism deciding this — no setView
     function, no viewRoster/viewChart commands, and no view-roster/
     view-chart classes anywhere in the file. */
  check(!/function setView\(/.test(SCRIPT), "setView is gone — roster-hidden is read directly");
  check(!/data-cmd="viewRoster"/.test(MARKUP) && !/data-cmd="viewChart"/.test(MARKUP),
    "no element still dispatches the retired view commands");
  check(!/view-roster/.test(HTML) && !/view-chart/.test(HTML),
    "the view-roster/view-chart classes appear nowhere in the file");
  check(/body\.roster-hidden\s+\.panel\{display:none\}/.test(MARKUP),
    "hiding the panel below the breakpoint is governed by the same roster-hidden "
    + "class the rail toggles everywhere else");
  check(/body:not\(\.roster-hidden\)\s+\.stage\{display:none\}/.test(MARKUP),
    "and the stage is hidden by its complement — the panel or the stage, "
    + "never both, chosen by one class");
  /* both panes must stay in the DOM: every handler binds once at boot */
  check(!/createElement\("aside"\)/.test(SCRIPT),
    "the roster panel is hidden, never rebuilt — a rebuilt pane would have no listeners");
  check(/min-height:36px/.test(MARKUP) || /min-height:44px/.test(MARKUP),
    "touch targets are enlarged on small screens");
}

/* ------------------------------------------- 4e2. the preview contain-fits the page */

/* The svg has to fit inside the page on all three page shapes (Landscape
   wide, Portrait and Square taller) without overflowing and scrolling.
   Putting max-height:100% on the svg itself does not work: .sheet's own
   height is auto, and a percentage max-height against an auto-height
   containing block resolves to none, so it never clamps. The constraint
   instead sits on .sheet, a flex item of .canvas-wrap whose height IS
   definite, and .sheet learns the page's shape from drawChart through
   --page-ar since CSS itself cannot know which of three page shapes is
   loaded. Anchored on ".sheet{", ".sheet > svg{" and ".canvas-wrap{" exactly,
   because ".sheet" is a prefix of both ".sheet > svg" and ".sheet-empty" and
   a loose match would read the wrong rule's declarations. The selector is a
   direct-child combinator, not a descendant one: the chart svg from
   toSVG(L) is #sheet's only direct svg child (the drawn branch assigns it
   straight into innerHTML), while every start-view icon sits at least two
   levels deeper — a descendant ".sheet svg" would catch those too and
   inflate any of them whose own rule loses the specificity fight. */
{
  const canvasWrapCSS = /\.canvas-wrap\{[^}]*\}/.exec(MARKUP);
  check(!!canvasWrapCSS, "the .canvas-wrap rule is found in the stylesheet");
  check(canvasWrapCSS && /display:flex/.test(canvasWrapCSS[0]),
    ".canvas-wrap declares display:flex, so it can centre the sheet inside it — got: "
    + (canvasWrapCSS && canvasWrapCSS[0]));

  const sheetCSS = /\.sheet\{[^}]*\}/.exec(MARKUP);
  check(!!sheetCSS, "the .sheet rule is found in the stylesheet");
  check(sheetCSS && /aspect-ratio:var\(--page-ar/.test(sheetCSS[0]),
    ".sheet declares aspect-ratio:var(--page-ar…) — the box itself takes the "
    + "page's shape now, not the svg inside it — got: " + (sheetCSS && sheetCSS[0]));

  const sheetSvgCSS = /\.sheet > svg\{[^}]*\}/.exec(MARKUP);
  check(!!sheetSvgCSS, "the .sheet > svg rule is found in the stylesheet");
  const sheetSvgDecls = sheetSvgCSS
    ? sheetSvgCSS[0].slice(sheetSvgCSS[0].indexOf("{") + 1, -1).split(";").map(d => d.trim()).filter(Boolean)
    : [];
  /* The svg fills a box that is already contained by .sheet's own
     aspect-ratio/max-width/max-height, so width:100%/height:100% is correct
     here: the box, not the svg, carries the sizing constraint. Those same
     declarations on the svg itself would be a bug if the svg carried the
     only constraint — it does not. */
  check(sheetSvgDecls.includes("width:100%"),
    ".sheet > svg declares width:100% — got: " + sheetSvgDecls.join(";"));
  check(sheetSvgDecls.includes("height:100%"),
    ".sheet > svg declares height:100% — got: " + sheetSvgDecls.join(";"));
  /* The page-filling rule belongs to the chart svg, which is #sheet's only
     direct svg child — the descendant form ".sheet svg{" would also match
     every icon nested inside the start view (template cards, the footer
     Privacy button), overriding their own, weaker-specificity .ic sizing
     with 100%/100% the moment their own rule loses that fight. */
  check(!/\.sheet svg\{/.test(MARKUP),
    "the descendant form .sheet svg{ is gone — it would swallow every "
    + "start-view icon whose own rule is weaker than 0,1,1");

  /* .sheet.start is the class drawChart's empty branch adds and its draw
     branch removes (checked below, on drawChart's own source). CSS lets
     min-height win over max-height when the two conflict, so this keeps
     .sheet's fitted chart-state solve — max-height:100% still supplies the
     transferred cap — right up until the start content genuinely needs more
     height, at which point growing past that box is what lets .canvas-wrap
     scroll the stage instead of the white page scrolling itself. */
  const sheetStartCSS = /\.sheet\.start\{[^}]*\}/.exec(MARKUP);
  check(!!sheetStartCSS, "the .sheet.start rule is found in the stylesheet");
  check(sheetStartCSS && /min-height:min-content/.test(sheetStartCSS[0]),
    ".sheet.start declares min-height:min-content — min beats max, which is "
    + "what lets the stage scroll instead of the page — got: "
    + (sheetStartCSS && sheetStartCSS[0]));

  /* .sheet-empty used to float at its own content width and scroll inside
     itself; both moved out — see the stylesheet comment above .sheet-empty
     for the full mechanism (out-asking .sheet's own cap the same way the
     chart svg does, and min-height so .sheet.start can still grow the box). */
  const sheetEmptyCSS = /\.sheet-empty\{[^}]*\}/.exec(MARKUP);
  check(!!sheetEmptyCSS, "the .sheet-empty rule is found in the stylesheet");
  check(sheetEmptyCSS && !/overflow/.test(sheetEmptyCSS[0]),
    ".sheet-empty declares no overflow — the scroll moved to .canvas-wrap, "
    + "the stage, not the white page — got: "
    + (sheetEmptyCSS && sheetEmptyCSS[0]));
  check(sheetEmptyCSS && /min-height:100%/.test(sheetEmptyCSS[0]),
    ".sheet-empty declares min-height:100%, not height:100% — the fitted box "
    + "still fills at short content but yields to .sheet.start's "
    + "min-height:min-content when the content is tall — got: "
    + (sheetEmptyCSS && sheetEmptyCSS[0]));
  check(sheetEmptyCSS && /max-width:100%/.test(sheetEmptyCSS[0]),
    ".sheet-empty declares max-width:100% — that is what keeps the used "
    + "width inside the solved sheet once its own width out-asks the cap — "
    + "got: " + (sheetEmptyCSS && sheetEmptyCSS[0]));
  /* Relation, not a literal: .sheet-empty's own width and .sheet's max-width
     cap are two independent numbers written in two different rules, and the
     start view only sizes the sheet the same way the chart svg does — by
     asking for more than any cap allows — as long as the child's width stays
     at or above the sheet's cap. Extracted from the two rules themselves so
     this is answered by a second source, not restated as a literal pin. */
  const sheetEmptyWidthM = sheetEmptyCSS && /width:(\d+)px/.exec(sheetEmptyCSS[0]);
  const sheetCapCSS = /\.sheet\{[^}]*\}/.exec(MARKUP);
  const sheetCapM = sheetCapCSS && /max-width:min\((\d+)px/.exec(sheetCapCSS[0]);
  check(!!sheetEmptyWidthM, ".sheet-empty's width is a px literal — got: "
    + (sheetEmptyCSS && sheetEmptyCSS[0]));
  check(!!sheetCapM, ".sheet's max-width cap is a min(...px,100%) literal — got: "
    + (sheetCapCSS && sheetCapCSS[0]));
  check(sheetEmptyWidthM && sheetCapM
    && Number(sheetEmptyWidthM[1]) >= Number(sheetCapM[1]),
    "the start view's width (" + (sheetEmptyWidthM && sheetEmptyWidthM[1])
    + "px) must stay at or above .sheet's max-width cap ("
    + (sheetCapM && sheetCapM[1]) + "px) — fall below it and the solve "
    + "silently under-sizes the page, the same collapse a percentage "
    + "min-width once caused");

  /* drawChart is the only thing that can tell CSS which page shape is
     loaded. The empty branch is a full landscape page in its own right, the
     app's own default shape, so it sets the property too, from a fixed
     source (PAGES["landscape"]) rather than the last-drawn page — leaving
     the property unset would let the empty state inherit whatever shape the
     previous chart last set, stretching its content-sized card into the
     wrong ratio. */
  const draw = /function drawChart\([\s\S]*?\n\}/.exec(SCRIPT);
  check(!!draw, "drawChart is readable");
  if(draw){
    const setCount = (draw[0].match(/setProperty\("--page-ar"/g) || []).length;
    check(setCount === 2,
      "drawChart sets --page-ar in both branches — got " + setCount);
    check(draw[0].indexOf('removeProperty("--page-ar")') < 0,
      "the empty branch does not remove --page-ar — the start view is a real "
      + "landscape page, not a content-sized card");
    check(/PAGES\["landscape"\]\.w \/ PAGES\["landscape"\]\.h/.test(draw[0]),
      "…and reads that landscape ratio from PAGES rather than a copied number");
    /* .sheet.start's min-height:min-content only stays honest as a pair with
       its removal below — leaving it on a chart drawn after the start view
       would keep the sheet's fitted geometry hostage to a class nothing
       ever turns off. */
    const startAdd = /classList\.add\("start"\)/.test(draw[0]);
    const startRemove = /classList\.remove\("start"\)/.test(draw[0]);
    check(startAdd && startRemove,
      "drawChart adds #sheet's \"start\" class in the empty branch and "
      + "removes it in the draw branch — half the pair missing leaves a "
      + "chart drawn after the start view stuck at min-height:min-content, "
      + "a lie waiting for a tall chart to overflow — got add:" + startAdd
      + " remove:" + startRemove);
  }
}

/* ------------------------------------------------- 4e3. the start view */

/* Zero grades is the first thing every new document shows now that
   defaults() ships with none — see the note above drawChart's empty branch.
   startView() is the one builder for it; nothing may restate a template's
   name, hex or grade count beside TEMPLATES itself, or the two will read the
   same today and drift the next time TEMPLATES changes. */
{
  const sv = /function startView\(\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!sv, "startView is readable");
  if(sv){
    check(/TEMPLATES\.map\(/.test(sv[0]),
      "the template cards are built by mapping TEMPLATES, not a static list");
    check(/tpl\.name/.test(sv[0]) && /tpl\.accent/.test(sv[0])
       && /tpl\.layout/.test(sv[0]) && /tpl\.grades\(\)\.length/.test(sv[0]),
      "each card reads its name, accent, layout and grade count off the "
      + "template object rather than a literal of its own");
    check(/"data-tpl":tpl\.id/.test(sv[0]),
      "each card carries the template's own id, computed, not written out");
    /* the swatch: one writer, the JS build, through the same --swatch custom
       property the Accent menu's own swatches use */
    check(/style:"--swatch:" \+ tpl\.accent/.test(sv[0]),
      "the accent swatch is set from tpl.accent as a custom property, not a "
      + "hex literal in markup or CSS");
    /* no template name or hex may appear a second time anywhere in the
       builder as its own literal — TEMPLATE_NAMES/TEMPLATE_HEXES are read off
       TEMPLATES here (a second source from the builder under test, though
       still the same table — the stronger claim is the property-access checks
       above, which a table-vs-itself comparison cannot fake: hard-coding
       "Big 4 green" into sv[0] would still satisfy an .indexOf against the
       table, but would already have failed the tpl.name check above). */
    const tplSrc = /const TEMPLATES = \[[\s\S]*?\n\];/.exec(SCRIPT);
    check(!!tplSrc, "TEMPLATES is readable");
    if(tplSrc){
      const names = matchAll(/name:"([^"]+)"/g, tplSrc[0]).map(m => m[1]);
      const hexes = matchAll(/accent:"(#[0-9A-Fa-f]{6})"/g, tplSrc[0]).map(m => m[1]);
      check(names.length === 3 && hexes.length === 3,
        "found three template names and three accents in TEMPLATES — got "
        + names.length + "/" + hexes.length);
      for(const n of names){
        check(sv[0].indexOf('"' + n + '"') < 0,
          'startView does not restate the literal "' + n + '" — it reads tpl.name');
      }
      for(const h of hexes){
        check(sv[0].indexOf(h) < 0,
          "startView does not restate the literal " + h + " — it reads tpl.accent");
      }
    }

    /* ---- the footer: the offline-processing claim and a second Privacy
       control, in the same command and wording as the ribbon's own. */
    check(/Everything processed offline on your device · nothing uploaded/.test(sv[0]),
      "the start view footer states the offline-processing claim");
    /* a class check over the command, not a case check: every dispatcher of
       infoPrivacy, wherever it lives, counted together */
    const privacyMarkup = (MARKUP.match(/data-cmd="infoPrivacy"/g) || []).length;
    const privacyScript = (SCRIPT.match(/"data-cmd":"infoPrivacy"/g) || []).length;
    check(privacyMarkup + privacyScript === 2,
      "exactly two controls dispatch infoPrivacy — the ribbon button and the "
      + "start view's own — got markup:" + privacyMarkup + " script:" + privacyScript);
    /* the title text is bound through ONE literal, extracted from the ribbon
       button's own markup — a second source, not a copy of the code under
       test — so the two cannot drift apart unnoticed */
    const ribbonPrivacy = /<button class="rb-mini" data-cmd="infoPrivacy" title="([^"]+)"/.exec(MARKUP);
    check(!!ribbonPrivacy, "the ribbon Privacy button's title is readable");
    check(ribbonPrivacy && sv[0].indexOf(ribbonPrivacy[1]) >= 0,
      "the start view's Privacy control carries the same title as the ribbon's — got "
      + JSON.stringify(ribbonPrivacy && ribbonPrivacy[1]));

    /* ---- the layout icon: drawn through the shared layoutIcon(id) helper,
       never by comparing tpl.layout to a literal inline, and an aria-label
       ending in " layout" taken off LAYOUTS' own label. */
    check(sv[0].indexOf("layoutIcon(tpl.layout)") >= 0,
      "startView draws each card's icon through the shared layoutIcon helper, keyed on tpl.layout");
    check(/\+ " layout"/.test(sv[0]),
      "and each card's layout icon aria-label ends in \" layout\"");
    check(!/tpl\.layout === "swimlanes"/.test(sv[0]),
      "startView compares tpl.layout to no literal itself — that answer lives in LAYOUTS");

    /* both full hrefs, never built by concatenation, live in layoutIcon
       itself (the whole-file static check below also guards this, but this
       pins it to layoutIcon specifically) */
    const li = /function layoutIcon\(id\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!li, "layoutIcon is readable");
    check(li && li[0].indexOf('icon("#i-swimlanes")') >= 0 && li[0].indexOf('icon("#i-pyramid")') >= 0
              && li[0].indexOf('icon("#i-tornado")') >= 0,
      "layoutIcon references all three layout icons by their full hrefs, written out");
  }

  /* the Open… tile: dispatched by the ordinary [data-cmd] mechanism, so it
     needs no wiring of its own beyond the attribute */
  check(sv && /"data-cmd":"open"/.test(sv[0]),
    'the Open… tile carries data-cmd="open"');
  check(sv && /"Open…"/.test(sv[0]) && /"Continue from a roster file"/.test(sv[0]),
    "…labelled Open… with its own secondary line");
  /* All four tiles share one anatomy — icon or swatch, title, descriptor —
     so the Open… tile's icon has to sit in that same first slot, ahead of
     its title, the way a template card's accent-dot does. */
  check(sv && /"data-cmd":"open"\}\}, \[\s*icon\("#i-open"\)/.test(sv[0]),
    "the Open… tile carries #i-open as the first child of its button, in "
    + "the icon/swatch slot");

  /* the delegated listener: #sheet is rebuilt by every render, the same as
     #roster and #tiers, so per-card listeners would die with their nodes —
     this binds once at boot instead. */
  const listener = /\$\("#sheet"\)\.addEventListener\("click"[\s\S]*?\}\);/.exec(SCRIPT);
  check(!!listener, "the #sheet delegated click listener is readable");
  check(listener && /closest\("\[data-tpl\]"\)/.test(listener[0]),
    "it reads the closest element carrying data-tpl…");
  check(listener && /if\(!card\) return;/.test(listener[0]),
    "…and ignores a click that hit no card");
  check(listener && /applyTemplate\(card\.dataset\.tpl\)/.test(listener[0]),
    "…then calls applyTemplate with the chosen id");
}

/* ------------------------------------------------- 4f. the privacy claim is true */

/* The Info tab tells the user this app makes no network requests while editing
   or exporting. That is a promise about behaviour, and a promise about
   behaviour should be checked rather than believed — it is exactly the kind of
   claim that quietly stops being true when someone adds a convenience. */
{
  const NETWORK = [
    ["fetch(",            "fetch"],
    ["XMLHttpRequest",    "XMLHttpRequest"],
    ["WebSocket",         "a WebSocket"],
    ["EventSource",       "an EventSource"],
    ["sendBeacon",        "navigator.sendBeacon"],
    ["importScripts",     "importScripts"],
    ["navigator.geolocation", "geolocation"],
    ["RTCPeerConnection", "WebRTC"]
  ];
  for(const [needle, label] of NETWORK){
    check(!SCRIPT.includes(needle),
      "no " + label + " — the Info tab promises no network requests");
  }
  /* dynamic import() would fetch a module at runtime */
  check(!/[^.\w]import\s*\(/.test(SCRIPT), "no dynamic import()");
  /* a form could POST somewhere without any script at all */
  check(!/<form\b/i.test(MARKUP), "no form element that could submit data anywhere");

  /* Links are allowed — they cost nothing until clicked — but every one must be
     external-safe and must not leak the page it came from. */
  const links = matchAll(/<a\s[^>]*href="https?:[^"]*"[^>]*>/g, MARKUP).map(m => m[0]);
  check(links.length > 0, "the Info tab has its attribution links");
  for(const a of links){
    check(/target="_blank"/.test(a), "an external link opens in a new tab: " + a.slice(0, 60));
    check(/rel="noopener noreferrer"/.test(a),
      "and carries rel=noopener noreferrer, so it cannot reach back into this page "
      + "or leak the URL: " + a.slice(0, 60));
  }

  /* the claim itself must actually be on the page */
  check(/no network requests at all/.test(MARKUP),
    "the Info tab states the no-network guarantee in so many words");
  check(/personal data/.test(MARKUP),
    "the Info tab says a roster file is personal data");
  check(/Copy PNG/.test(MARKUP) && /clipboard/i.test(MARKUP),
    "the Info tab explains the clipboard limitation rather than leaving a dead button");
}

/* ------------------------------------------------- 4g. no dead layout path */

/* A `chips` array iterated by both renderers, or an `n` length variable
   computed and never read, would be dead scaffolding for a feature that is
   not being built — a hook nobody uses does not belong in computeLayout.
   This is the guard against either appearing. */
check(!/\bchips\b/.test(SCRIPT), "no chips array — an unused hook does not belong in computeLayout");
check(!/chipH/.test(SCRIPT), "no chipH — no geometry constant for an unused feature belongs here");
{
  const layout = /function computeLayout\([\s\S]*?\n\}/.exec(SCRIPT);
  check(!!layout, "computeLayout is readable");
  check(layout && !/,\s*n = tiers\.length/.test(layout[0]),
    "computeLayout does not compute a length it never reads");
}

/* ------------------------------------------ 4g2. the layout capability table */

/* The layout capability table: LAYOUTS[...] plus a layoutIcon(id) helper for
   the one thing the table cannot carry (a static, literal icon href). This
   is the guard that the centralisation holds — that no site compares the
   layout id to a literal, and that the two places layout identity is
   declared (LAYOUTS' own keys, layoutIcon's own cases) both agree with
   ENUMS.layout, the list a file is actually validated against. */
{
  /* ENUMS.layout is the second source throughout this section: what a file
     may state, read off the app's own enum rather than a hand-typed list, so
     a layout added to one and not the other is what fails here — never a
     literal this test could drift from on its own. */
  const enumsSrc = /const ENUMS = \{[\s\S]*?\n\};/.exec(SCRIPT);
  check(!!enumsSrc, "ENUMS is readable");
  const layoutEnumSrc = enumsSrc && /layout:\s*\[([^\]]*)\]/.exec(enumsSrc[0]);
  check(!!layoutEnumSrc, "ENUMS.layout is readable");
  const layoutEnum = layoutEnumSrc
    ? matchAll(/"([^"]+)"/g, layoutEnumSrc[1]).map(m => m[1])
    : [];
  check(layoutEnum.length >= 2, "ENUMS.layout names at least pyramid and swimlanes — got "
    + JSON.stringify(layoutEnum));

  /* ---- LAYOUTS itself: one row per ENUMS.layout value, no more, no fewer.
     A row LAYOUTS is missing falls back to LAYOUTS.pyramid at every read
     site — the same silent mis-description a deleted row would cause in the
     app, so the set comparison (not just "at least these") is what a deleted
     row actually needs to fail. */
  const layoutsSrc = /const LAYOUTS = \{[\s\S]*?\n\};/.exec(SCRIPT);
  check(!!layoutsSrc, "LAYOUTS is readable");
  const layoutsKeys = layoutsSrc
    ? uniq(matchAll(/(?:^|\n)\s*(\w+):\s*\{/g, layoutsSrc[0]).map(m => m[1]))
    : [];
  check(layoutsKeys.length === layoutEnum.length
     && layoutEnum.every(id => layoutsKeys.includes(id)),
    "LAYOUTS has exactly one row per ENUMS.layout value — enum: "
    + JSON.stringify(layoutEnum) + ", LAYOUTS: " + JSON.stringify(layoutsKeys));

  /* ---- layoutIcon: one explicit case per ENUMS.layout value, each
     returning a full icon("#i-…") literal — the static icon check elsewhere
     in this file already forbids anything less, this just proves every
     layout actually has a case rather than silently riding the default. */
  const liSrc = /function layoutIcon\(id\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!liSrc, "layoutIcon is readable");
  const iconCases = liSrc
    ? matchAll(/case\s+"(\w+)":\s*return\s+icon\("(#i-[\w-]+)"\)/g, liSrc[0])
        .map(m => ({id:m[1], href:m[2]}))
    : [];
  check(layoutEnum.every(id => iconCases.some(c => c.id === id)),
    "layoutIcon carries an explicit case for every ENUMS.layout value — enum: "
    + JSON.stringify(layoutEnum) + ", cases: " + JSON.stringify(iconCases.map(c => c.id)));

  /* ---- E0: the Swimlanes artwork is Material's waves, specifically.
     The general provenance loop above only proves #i-swimlanes' path data
     matches SOME file in sprites/, which any future download would satisfy
     just as well. This is the dedicated pin: the symbol's path data must
     equal the waves file's. */
  {
    const wavesSrc = readFile(here()
      + "sprites/waves_40dp_E3E3E3_FILL0_wght400_GRAD0_opsz40.svg");
    const wavesD = (/\bd="([^"]+)"/.exec(wavesSrc) || [])[1];
    const symD = (/<symbol[^>]*\bid="i-swimlanes"[^>]*><path d="([^"]+)"/.exec(HTML) || [])[1];
    check(!!wavesD, "sprites/waves_…svg is readable");
    check(!!symD && symD === wavesD,
      "E0: #i-swimlanes' path data matches sprites/waves_40dp_E3E3E3_FILL0_wght400_GRAD0_opsz40.svg "
      + "in full — the waves artwork, not a hand-typed approximation and not another "
      + "download that happens to sit in sprites/");
  }

  /* ---- the Histogram artwork is Material's graphic_eq, rotated 90° — bars of
     varying length, which is literally what the Histogram engine draws (each
     band's width is its own headcount). Shrinking centred lines would read as
     a funnel, which is Tornado's job, not Histogram's. It gets the same
     dedicated pin E0 above gives Swimlanes/waves, for the same reason: the
     general provenance loop only proves #i-histogram matches SOME file in
     sprites/, never which one. The rotation is carried
     as a `transform` on the <path>, never baked into the `d` coordinates —
     that is what lets the general loop's `d`-only comparison still call this
     graphic_eq, byte-for-byte, rather than a hand-rotated approximation. The
     transform IS the design decision (upright bars read as an equalizer, not
     a histogram), so it gets its own assertion — without it, dropping the
     transform would ship the wrong artwork and every other check here would
     stay green. */
  {
    const graphicEqSrc = readFile(here()
      + "sprites/graphic_eq_40dp_E3E3E3_FILL0_wght400_GRAD0_opsz40.svg");
    const graphicEqD = (/\bd="([^"]+)"/.exec(graphicEqSrc) || [])[1];
    const histTag = (/<symbol[^>]*\bid="i-histogram"[^>]*><path ([^>]*)\/?>/.exec(HTML) || [])[1] || "";
    const histD = (/\bd="([^"]+)"/.exec(histTag) || [])[1];
    check(!!graphicEqD, "sprites/graphic_eq_…svg is readable");
    check(!!histD && histD === graphicEqD,
      "#i-histogram's path data matches sprites/graphic_eq_40dp_E3E3E3_FILL0_wght400_GRAD0_opsz40.svg "
      + "in full — the graphic_eq artwork, not a hand-typed approximation");
    check(histTag.includes('transform="rotate(90 480 -480)"'),
      "#i-histogram's path carries transform=\"rotate(90 480 -480)\" — the 90° rotation that turns "
      + "graphic_eq's vertical bars into Histogram's horizontal ones, kept as a transform rather than "
      + "rewritten coordinates so the d-comparison above stays honest");
  }

  /* ---- the Hive artwork is Material's hive icon, specifically — the same
     dedicated pin as Swimlanes/waves and Histogram/graphic_eq above: the
     general provenance loop only proves #i-hive matches SOME file in
     sprites/, so a swap to any other download there would stay green
     without this pin. */
  {
    const hiveSrc = readFile(here()
      + "sprites/hive_40dp_E3E3E3_FILL0_wght400_GRAD0_opsz40.svg");
    const hiveD = (/\bd="([^"]+)"/.exec(hiveSrc) || [])[1];
    const symD = (/<symbol[^>]*\bid="i-hive"[^>]*><path d="([^"]+)"/.exec(HTML) || [])[1];
    check(!!hiveD, "sprites/hive_…svg is readable");
    check(!!symD && symD === hiveD,
      "#i-hive's path data matches sprites/hive_40dp_E3E3E3_FILL0_wght400_GRAD0_opsz40.svg "
      + "in full — the hive artwork, not a hand-typed approximation");
  }

  /* ---- the rule itself: outside computeLayout's own engine table (which is
     the dispatcher, not UI capability data, and stays untouched), nothing in
     the script may compare the layout id to a literal — that comparison
     happens exactly once, at each LAYOUTS[...] lookup. The
     alternation is built from ENUMS.layout itself (the same second source
     used above), not a hand-typed pair, so every layout this app knows about
     — including the next one added after Hive — is covered automatically. */
  const layoutAlt = layoutEnum.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const cmpRe = new RegExp('===\\s*"(?:' + layoutAlt + ')"|"(?:' + layoutAlt + ')"\\s*==='
    + '|!==\\s*"(?:' + layoutAlt + ')"|"(?:' + layoutAlt + ')"\\s*!==', "g");
  const cmp = matchAll(cmpRe, SCRIPT);
  check(cmp.length === 0,
    "no state.layout/tpl.layout === \"" + layoutEnum.join("\"/\"") + "\" comparisons anywhere "
    + "in the script — LAYOUTS is the only place layout identity means anything — found "
    + cmp.length + " at offsets " + JSON.stringify(cmp.map(m => m.index)));
}

/* ---------------------------------------------- 4h. wiring guards */

/* These are wiring guards, not behaviour ones: the code itself is correct,
   but it has to run at the right moment or not at all. The behaviour is
   covered in test/fixtures.js §6c/6d; these checks guard against the order
   silently regressing. */
{
  const draw = /function drawChart\([\s\S]*?\n\}/.exec(SCRIPT);
  check(!!draw, "drawChart is readable");
  if(draw){
    const insertAt   = draw[0].indexOf('$("#sheet").innerHTML');
    const describeAt = draw[0].lastIndexOf("describeChart()");
    check(insertAt >= 0 && describeAt >= 0, "drawChart both inserts and describes");
    check(describeAt > insertAt,
      "describeChart() runs AFTER the SVG is inserted — before it, it labels the "
      + "previous render, and on the first draw there is nothing to label");
    /* the empty branch has to describe too, or the text keeps the old chart */
    check(/describeChart\(\);[\s\S]{0,80}return;/.test(draw[0]),
      "the no-grades branch describes the empty state instead of leaving stale text");
    /* …and it has to settle the transparency class, which the toggle below it
       never reaches. Without this the "no chart" message would print on the
       checkerboard left behind by a transparent chart still marked .clear. */
    const toggleAt = draw[0].indexOf('classList.toggle("clear"');
    const clearAt  = draw[0].indexOf('classList.remove("clear")');
    check(clearAt >= 0, "the no-grades branch settles the transparent-background class");
    check(clearAt >= 0 && toggleAt >= 0 && clearAt < toggleAt,
      "and does so inside the empty branch, which returns before the toggle");

    /* The live-preview note follows the chart, so it is written in the same two
       places #hintRight is and nowhere else — hidden where the empty branch
       clears the hint, shown where the normal path fills it. A third writer
       somewhere else is how it would end up announcing a preview of the
       "No grades defined" card. */
    const notes = matchAll(/\$\("#previewNote"\)\.hidden = (true|false)/g, draw[0]).map(m => m[1]);
    check(notes.length === 2,
      "drawChart writes #previewNote exactly twice — got " + notes.length);
    check(notes.join(",") === "true,false",
      "hidden in the empty branch first, shown on the normal path — got " + notes.join(","));
    const hideAt = draw[0].indexOf('$("#previewNote").hidden = true');
    check(hideAt >= 0 && clearAt >= 0 && hideAt > clearAt && hideAt < draw[0].indexOf("innerHTML"),
      "the hide is inside the empty branch, which returns before the chart is drawn");

    /* The separator dot is a prefix of #hintRight's own text rather than a
       separate span, because both are toggled by the same two sites under
       the same condition — one writer, one condition, no orphaned dot when
       no chart is drawn. Found
       structurally (both #hintRight writers, by statement shape) rather than
       by a literal that a mutation to either one would itself remove. */
    const hrAssignments = matchAll(/\$\("#hintRight"\)\.textContent = [^;]*;/g, draw[0]).map(m => m[0]);
    check(hrAssignments.length === 2,
      "drawChart writes #hintRight exactly twice — got " + hrAssignments.length);
    const hrAssign = hrAssignments[1] || "";
    check(/^\$\("#hintRight"\)\.textContent = "· " \+ L\.page\.label/.test(hrAssign),
      "the drawn-branch #hintRight assignment starts with the \"· \" prefix — got "
      + JSON.stringify(hrAssign));
    check(hrAssign.length > 0 && !/PNG/.test(hrAssign),
      "and states no dpi detail — that lives in #previewNote's title instead — got "
      + JSON.stringify(hrAssign));
  }
  check((SCRIPT.match(/previewNote/g) || []).length === 2,
    "and no other line in the app touches #previewNote — got "
      + (SCRIPT.match(/previewNote/g) || []).length);

  /* The note itself: what "fitted at 47%" means, sat where the reader is
     already looking. It is not a live region and not focusable — #opening is
     the status bar's one announcing element, and a second one repeating two
     unchanging words on every repaint is noise, so the detail lives in the
     title attribute instead. */
  {
    const bar = /<div class="statusbar">[\s\S]*?<\/div>/.exec(MARKUP);
    check(!!bar, "the status bar is readable");
    if(bar){
      const order = matchAll(/id="([A-Za-z]+)"|class="(sp)"/g, bar[0])
        .map(m => m[1] || m[2]);
      check(order.join(",") === "hint,opening,sp,previewNote,hintRight",
        "the id scan is flat over the markup, so nesting #hintRight inside "
        + "#previewNote leaves this order unchanged — it sits after the spacer, "
        + "INSIDE the note whose fit percentage it states — got " + order.join(","));

      /* #hintRight nests inside #previewNote, so a lazy match that stops
         at the first </span> would cut the container off at #hintRight's own
         close and never see the rest of it — exactly the trap this suite
         documents elsewhere. Written to require BOTH </span> tags in order
         (hintRight's own close, then previewNote's), it captures the whole
         container instead of just its head. */
      const note = /<span class="preview-note" id="previewNote"[\s\S]*?<\/span>[\s\S]*?<\/span>/.exec(bar[0]);
      check(!!note, "the note is one span in the status bar, containing #hintRight");

      /* Containment, asserted structurally and independently of the
         extraction above — by index, not by trusting `note` — so a broken
         extraction cannot also blind the one check meant to catch it.
         #hintRight's own opening tag has to sit strictly between
         #previewNote's opening and closing tags, not after it as a sibling. */
      const openIdx = bar[0].indexOf('<span class="preview-note" id="previewNote"');
      const hrOpenIdx = openIdx >= 0
        ? bar[0].indexOf('<span id="hintRight">', openIdx) : -1;
      const hrCloseIdx = hrOpenIdx >= 0
        ? bar[0].indexOf('</span>', hrOpenIdx) : -1;
      const noteCloseIdx = hrCloseIdx >= 0
        ? bar[0].indexOf('</span>', hrCloseIdx + 1) : -1;
      check(openIdx >= 0 && hrOpenIdx >= 0 && hrCloseIdx >= 0 && noteCloseIdx >= 0
          && openIdx < hrOpenIdx && hrOpenIdx < noteCloseIdx,
        "#hintRight sits between #previewNote's own opening and closing tags — "
        + "not as a sibling after it — got openIdx=" + openIdx + " hrOpenIdx=" + hrOpenIdx
        + " hrCloseIdx=" + hrCloseIdx + " noteCloseIdx=" + noteCloseIdx);

      if(note){
        /* On the opening tag, not anywhere in the span: \bhidden\b over the
           whole element is satisfied by the icon's own aria-hidden, so the
           first draft of this passed with the attribute deleted. */
        const open = /<span class="preview-note" id="previewNote"[^>]*>/.exec(note[0]);
        check(open && /\shidden[\s>]/.test(open[0]),
          "it ships hidden — drawChart decides, and there is no chart before the first draw");
        check(note[0].indexOf('<use href="#i-info"/>') > 0,
          "it carries the info icon, written out in full");
        check(/>Live preview\s*<span id="hintRight">/.test(note[0]),
          "and reads Live preview, immediately before the nested #hintRight span "
          + "it shares one container with");
        check(/title="The chart on screen is a live preview\./.test(note[0])
           && /Copy PNG renders at 150 dpi, Export PNG and PDF at 300 dpi\."/.test(note[0]),
          "the dpi detail is in the title, on the same container that also "
          + "holds the fit text, so hovering the percentage explains it too");
        check(!/aria-live|role=|tabindex/.test(note[0]),
          "it is neither a live region nor focusable — #opening is the bar's one "
          + "announcing element");
        check(/aria-hidden="true"/.test(note[0]),
          "and its icon is decoration beside the words, not a second name for them");
      }
    }
    const CSS = (/<style>([\s\S]*?)<\/style>/.exec(MARKUP) || ["", ""])[1];
    check(/\.preview-note\[hidden\]\{display:none\}/.test(CSS),
      "the [hidden] rule is stated, because inline-flex would otherwise beat it");
    check(/\.preview-note\{display:inline-flex/.test(CSS),
      "the note lays its icon out beside its words");
    check(/\.preview-note \.ic\{width:13px;height:13px\}/.test(CSS),
      "the icon is sized down to the 11.5px status bar rather than the 18px default");
  }

  /* the tabs carry their state in the markup AND are confirmed at boot */
  const tabTags = matchAll(/<button[^>]*class="rb-tab[^"]*"[^>]*>/g, MARKUP).map(m => m[0]);
  const selected = tabTags.filter(t => /aria-selected="true"/.test(t));
  check(selected.length === 1, "exactly one tab ships marked selected (found "
    + selected.length + ")");
  check(/data-tab="file"/.test(selected[0] || ""), "and it is Start, using the stable file hook");
  for(const t of tabTags){
    check(/aria-selected="(true|false)"/.test(t),
      "every tab ships with an explicit aria-selected");
    check(/tabindex="(0|-1)"/.test(t), "and an explicit tabindex");
  }
  check(tabTags.filter(t => /tabindex="0"/.test(t)).length === 1,
    "exactly one tab is in the tab order at rest");
  check(/selectTab\("file", false\)/.test(SCRIPT),
    "boot runs selectTab so markup and script cannot drift — and does not steal focus");

  /* a grade rename refreshes the roster, but only once the session is over */
  check(/onEnd: renderRoster/.test(SCRIPT),
    "finishing a grade rename refreshes the roster panel");
  const editFn = /function edit\([\s\S]*?\n\}/.exec(SCRIPT);
  check(editFn && /onEnd: opts && opts\.onEnd/.test(editFn[0]),
    "edit() carries the end-of-session callback");
  const endFn = /function endEdit\([\s\S]*?\n\}/.exec(SCRIPT);
  check(endFn && /if\(after\) after\(\)/.test(endFn[0]), "endEdit() runs it");
  check(endFn && endFn[0].indexOf("session = null") < endFn[0].indexOf("if(after)"),
    "and clears the session first, so a callback that edits cannot recurse");
  /* the rebuild must not cost the caret */
  check(/function focusedField\(/.test(SCRIPT) && /function restoreField\(/.test(SCRIPT),
    "the roster rebuild records and restores the focused field");
  const rr = /function renderRoster\([\s\S]*?\n\}/.exec(SCRIPT);
  check(rr && /const keepFocus = focusedField\(\)/.test(rr[0]),
    "renderRoster captures focus before rebuilding");
  check(rr && /restoreField\(keepFocus\)/.test(rr[0]), "and restores it afterwards");
  check(/setSelectionRange/.test(SCRIPT), "including the caret position");
  /* (verb, id) is not unique: Fill and People are rows of radio buttons, so
     two or three of them share a verb AND a grade id, and only the value
     separates them. A restore that ignores it silently moves focus to
     whichever comes first in the row. */
  {
    const ff = /function focusedField\(\)[\s\S]*?\n\}/.exec(SCRIPT);
    const rf = /function restoreField\(f\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(ff && /value: a\.dataset\.value/.test(ff[0]),
      "focusedField records which option of a row was focused, not just its verb");
    check(rf && /data-value="' \+ f\.value \+ '"/.test(rf[0]),
      "and restoreField narrows by it, so focus returns to that same option");
    check(rf && /f\.value === null \|\| f\.value === undefined/.test(rf[0]),
      "while a control that has no value is still matched on verb and id alone");
  }

  /* the contrast warning follows the colour that changed */
  for(const id of ["accent", "inkOnColour", "inkOnWhite", "accentHex"]){
    const h = new RegExp('\\$\\("#' + id + '"\\)\\.addEventListener\\("input"[\\s\\S]*?\\n\\}\\);')
      .exec(SCRIPT);
    check(!!h, "the " + id + " handler is readable");
    check(h && /checkContrast\(\)/.test(h[0]),
      "changing " + id + " re-checks contrast immediately, rather than waiting for a full render");
  }

  /* ---- Accent can be typed, not only picked ----
     <input type="color"> is the OS dialog: no hex field at all on Windows, and
     behind a tab on macOS. The behaviour is test/document.js §7b1; what is
     guarded here is the wiring a later edit could break with nothing noticing —
     a second validator, a second coalescing mechanism, or a field that stops
     being kept in step with the picker. */
  {
    const pop = accentPop();
    check(/id="accentHex"/.test(pop), "the hex field is inside the Accent menu");
    /* Under the swatches and above More colours: the eight are the fast route,
       the field is the one for a colour that is not among them, and the OS
       dialog is the fallback behind both. */
    check(pop.indexOf('class="accent-swatch"') < pop.indexOf('id="accentHex"')
       && pop.indexOf('id="accentHex"') < pop.indexOf('id="accent"'),
      "…below the swatches and above More colours");
    const field = /<input type="text" id="accentHex"[^>]*>/.exec(MARKUP);
    check(!!field, "it is a text input, so a hex can be typed and pasted into it");
    check(field && /aria-label="[^"]+"/.test(field[0]),
      "…with an accessible name of its own — the visible caption is three letters");
    check(field && /maxlength="7"/.test(field[0]),
      "…capped at #RRGGBB, so there is nothing past a complete value to type");
    /* the picker is an ADDITION's companion, not its casualty */
    check(/<input type="color" id="accent"/.test(MARKUP),
      "the colour picker exists alongside the hex field — the field is an addition, not a replacement");

    const hex = /\$\("#accentHex"\)\.addEventListener\("input"[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(!!hex, "the hex field's input handler is readable");
    if(hex){
      /* ONE validator. validColour is what the Open path judges a roster file's
         accent with, so a second regex here is how the field comes to accept
         something a file would be repaired for. */
      check(/hexFieldValue\(/.test(hex[0]),
        "the typed value goes through hexFieldValue");
      check(!/HEX6|[0-9a-fA-F]\{6\}|test\(/.test(hex[0]),
        "…and the handler itself tests nothing — no second validator beside validColour");
      const hf = /function hexFieldValue\([\s\S]*?\n\}/.exec(SCRIPT);
      check(!!hf, "hexFieldValue is readable");
      check(hf && /validColour\(/.test(hf[0]),
        "…and it delegates to validColour, the same one parseAndValidateRoster uses");
      check(hf && !/HEX6/.test(hf[0]),
        "…without reaching past it to the regex, which is what a second rule would look like");
      check(hf && /"#"/.test(hf[0]),
        "…adding only the optional leading #");

      /* nothing unusable may commit */
      const guard = hex[0].indexOf("=== null");
      check(guard >= 0 && guard < hex[0].indexOf("edit("),
        "an unusable value returns BEFORE edit() — no snapshot, no history entry, no repaint");

      /* ONE coalescing mechanism, and it is the file's own */
      check(/\bedit\("accent",/.test(hex[0]),
        "it edits under the SAME session key the picker uses, so a typed colour is one "
        + "undo step and switching to the picker mid-session stays one change");
      check(!/session\s*=|setTimeout\(/.test(hex[0]),
        "…and invents no second coalescing mechanism of its own");
      check(!/commit\(/.test(hex[0]),
        "…nor commits, which would make every valid keystroke its own undo step");

      /* the chart's colour, never the chrome's */
      check(/state\.accent\s*=/.test(hex[0]), "it writes state.accent");
      check(!/--brand|setProperty|documentElement|state\.brand\s*=/.test(hex[0]),
        "…and nothing else — --brand is app chrome and fixed, and state.brand is the "
        + "header text, not a colour");
      /* the two halves show one colour */
      check(/\$\("#accent"\)\.value\s*=/.test(hex[0]),
        "typing moves the picker, so the two halves never disagree");
    }
    const pick = /\$\("#accent"\)\.addEventListener\("input"[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(pick && /\$\("#accentHex"\)\.value\s*=/.test(pick[0]),
      "and picking moves the field, which is the other direction of the same sync");

    /* undo, Open and New all land in renderAll, so the field has to be there */
    const ra = /function renderAll\(\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(ra && /\$\("#accentHex"\)\.value\s*=\s*state\.accent/.test(ra[0]),
      "renderAll writes the field, so undo, Open and New leave it showing the real accent");
    check(ra && /\$\("#accent"\)\.value\s*=\s*state\.accent/.test(ra[0]),
      "…as it already did for the picker");
    /* leaving the field tidies it, and commits nothing */
    const blur = /\$\("#accentHex"\)\.addEventListener\("blur"[\s\S]*?\);/.exec(SCRIPT);
    check(!!blur, "leaving the field is handled");
    check(blur && /state\.accent/.test(blur[0]),
      "…by showing what the chart actually has, so a half-typed value cannot be left on screen");
    check(blur && !/edit\(|commit\(|state\.accent\s*=/.test(blur[0]),
      "…and it changes no state — blur is a repair to the field, not an edit");
  }

  /* ---- Accent is a menu of eight curated colours ----
     Accent is a single menu holding both the eight curated swatches and the
     hex field. The behaviour of the swatches is test/document.js §7b1a; what
     is guarded here is the wiring: a swatch that names no ink, a menu
     nothing dismisses, and a list of colours copied into the script beside
     the one that is drawn. */
  {
    const pop = accentPop();
    check(!!pop, "the Accent editor is readable");
    const tag = /<div class="menu style-pop" id="accentPop"[^>]*>/.exec(pop);
    /* A dialog, not a menu: a role="menu" whose items include somewhere to type
       is not a menu, and a screenreader told otherwise will offer menu
       navigation over a text field. */
    check(tag && /role="dialog"/.test(tag[0]),
      "the Accent editor is a dialog — it holds a text field, which no menu does");
    check(tag && /aria-label="Accent colour"/.test(tag[0]) && tag[0].indexOf("aria-labelledby") < 0,
      "…named by its own aria-label, not by the all-caps heading over its swatches");
    check(/class="menu style-pop"/.test(tag ? tag[0] : ""),
      "…and it carries .menu, which is what keeps a click inside it from counting "
      + "as a click away — the hex field is the whole reason that matters");

    /* Registered like every other one, so Escape, a tab change, a resize, a
       ribbon scroll and a click away all reach it with no new code. */
    const table = /const RIBBON_MENUS = \[[\s\S]*?\];/.exec(SCRIPT);
    check(table && table[0].indexOf('menu:"#accentPop"') >= 0
                && table[0].indexOf('btn:"#accentBtn"') >= 0,
      "#accentBtn and #accentPop are registered in RIBBON_MENUS");
    check(table && table[0].indexOf('anchor:"#accentBtn"') >= 0,
      "…anchored to its own face, like the five Design selectors above it");

    /* The eight, stated once. A copy in the script is how the row a user clicks
       and the colour it applies come apart. */
    const swatches = matchAll(/<button class="accent-swatch"[\s\S]*?<\/button>/g, pop).map(m => m[0]);
    check(swatches.length === 8, "there are eight swatches — got " + swatches.length);
    const WANT = [["#003153", "#FFFFFF", "Prussian Blue"],
                  ["#801818", "#FFFFFF", "Falu Red"],
                  ["#602F6B", "#FFFFFF", "Imperial Purple"],
                  ["#FF4F00", "#000000", "International Orange"],
                  ["#004225", "#FFFFFF", "British Racing Green"],
                  ["#848482", "#000000", "Battleship Grey"],
                  ["#FADA5E", "#000000", "Naples Yellow"],
                  ["#000000", "#FFFFFF", "Vantablack"]];
    for(let i = 0; i < WANT.length; i++){
      const s = swatches[i] || "";
      check(s.indexOf('data-accent="' + WANT[i][0] + '"') >= 0,
        WANT[i][2] + " is " + WANT[i][0]);
      /* Three of the eight need black text. A swatch that set only the accent
         would leave the previous colour's ink on it, which is how a curated
         colour ships an unreadable chart. */
      check(s.indexOf('data-ink="' + WANT[i][1] + '"') >= 0,
        "…and states the ink that goes on it: " + WANT[i][1]);
      check(s.indexOf(">" + WANT[i][2] + "</button>") >= 0,
        "…and is named in words, not in hex — a swatch announced as \"" + WANT[i][0]
        + "\" tells a screenreader user nothing");
      check(s.indexOf('title="' + WANT[i][0] + '"') >= 0,
        "…with the hex on the title, where it is available without being the name");
      check(s.indexOf('data-cmd="accentSwatch"') >= 0,
        "…and it is dispatched by data-cmd like every other command");
    }
    /* Both of the three that need black text and the five that do not — asserted
       as counts so a swap between two rows cannot pass the per-row checks. */
    check((pop.match(/data-ink="#000000"/g) || []).length === 3
       && (pop.match(/data-ink="#FFFFFF"/g) || []).length === 5,
      "three of the eight carry black ink and five carry white");
    /* Prussian Blue is also the document's default accent, so it legitimately
       appears twice in the script — defaults() and the validator's fallback, the
       two places that must agree. Extracted from defaults() alone,
       not from the whole script: TEMPLATES states an "accent:" literal of
       its own, earlier in the file, and a bare first-match search would find
       that one instead. TEMPLATES adds three more legitimate repeats — British
       Racing Green, International Orange and Prussian Blue again are three of
       the nine template accents, chosen because they are recognisable named
       colours on purpose, not a colour table creeping back in beside the one
       that is drawn. The other five swatches still have no business appearing
       in the script at all: the command reads the pair off the button it was
       given, so the list is stated once, in the markup that draws it. Stating
       the exceptions rather than dropping the check is the point — a colour
       table creeping back into the script would otherwise be invisible. */
    const defaultsSrc = (/function defaults\(\)[\s\S]*?\n\}/.exec(SCRIPT) || [""])[0];
    const defaultAccent = (/accent:"(#[0-9A-Fa-f]{6})"/.exec(defaultsSrc) || [])[1];
    check(!!defaultAccent, "defaults() states an accent");
    /* LITERALS, not read off TEMPLATES itself — the claim is that exactly
       these three, and no others, are the templates' legitimate reuse of a
       swatch colour; a table compared against itself would pass under a
       mutation that changed a template's accent to any other swatch hex. */
    const TEMPLATE_ACCENTS = ["#004225", "#FF4F00", "#003153"];
    /* The search stays the same blind whole-script SCRIPT.indexOf() that
       catches a colour table creeping back in — narrowing it to an
       accent:"…" shape would also blind it to exactly that table, planted as
       a bare array or anything else that is not the accent literal shape.
       The one thing excused is the ink:"#…" shape itself: a swatch's black or
       white ink is a legitimate, unrelated reuse of the same six digits
       (International Orange's own row states ink:"#000000" two screens up),
       so only that shape is stripped before the search runs — every other
       occurrence of a swatch hex, in any other shape, still counts. */
    const scriptSansInks = SCRIPT.replace(/\bink:"#[0-9A-Fa-f]{6}"/g, "");
    const stray = WANT.map(w => w[0])
      .filter(h => h !== defaultAccent && !TEMPLATE_ACCENTS.includes(h)
                 && scriptSansInks.indexOf(h) >= 0);
    check(stray.length === 0,
      "no swatch colour beyond the document default and TEMPLATES' three is "
      + "repeated in the script — stray: " + (stray.join(", ") || "none"));
    check(defaultAccent === "#003153",
      "…and that default is Prussian Blue, the first swatch — got " + defaultAccent);
    /* Named site by site rather than counted. The document default and --brand
       are the same value by taste, not by wiring — collapsing them into one
       constant is exactly what the rule against --brand following the accent
       exists to prevent, so each of these states the colour itself. */
    check(/accent:"#003153"/.test(SCRIPT),
      "defaults() writes the default accent into every new document");
    check(/validColour\(st\.accent,\s*"#003153"\)/.test(SCRIPT),
      "…and the validator answers with the same one for a file that omits it");
    check((SCRIPT.match(/paint\(L\.accent, "#003153"\)/g) || []).length === 2,
      "…and both renderers fall back to it for an accent that will not paint");
    check(!/#046A38/.test(SCRIPT),
      "…with no green left behind in the script for one of them to disagree with");

    /* One commit for both writes. Two would put a colour wearing the other
       colour's ink between them, and cost two undos to get out of. */
    const cmd = /accentSwatch: \(el\)=>\{[\s\S]*?\n  \},/.exec(SCRIPT);
    check(!!cmd, "COMMANDS.accentSwatch is readable");
    if(cmd){
      check((cmd[0].match(/commit\(/g) || []).length === 1,
        "a swatch is exactly one commit, so one undo restores both fields together");
      check(!/\bedit\(/.test(cmd[0]),
        "…and not an edit session — picking a swatch is a discrete choice, and a "
        + "second one is a second undo step");
      check(/state\.accent\s*=/.test(cmd[0]) && /state\.inkOnColour\s*=/.test(cmd[0]),
        "…writing both state.accent and state.inkOnColour");
      check((cmd[0].match(/validColour\(/g) || []).length === 2,
        "both values are judged by validColour — a data attribute is still a string, "
        + "and this is the door the Open path uses");
      check(!/--brand|setProperty\(|state\.inkOnWhite/.test(cmd[0]),
        "…and nothing else: not the chrome, and not the ink on white bands, which "
        + "the Text editor owns");
      check(/checkContrast\(\)/.test(cmd[0]),
        "…and it re-checks contrast, which is what proves the curation held");
      check(/\$\("#accentHex"\)\.value/.test(cmd[0]) && /\$\("#accent"\)\.value/.test(cmd[0])
         && /\$\("#inkOnColour"\)\.value/.test(cmd[0]),
        "…and puts all three controls showing these two values back in step, because "
        + "render:\"chart\" repaints the chart and not the ribbon");
    }

    /* More colours keeps the OS dialog: on several platforms it can pick a
       colour off the screen, which nothing else here can do. */
    const more = /<label class="accent-more">[\s\S]*?<\/label>/.exec(pop);
    check(!!more, "More colours is the last row of the editor");
    check(more && /More colours…/.test(more[0]),
      "…with an ellipsis, because it needs input before it acts");
    check(more && /<input type="color" id="accent"/.test(more[0]),
      "…and it is the original colour input, not a picker built here");
    check(/\.accent-more input\[type=color\]\{[^}]*opacity:0/.test(MARKUP)
       && /\.accent-more\{[^}]*position:relative/.test(MARKUP),
      "…stretched invisibly over the row, so the click that opens the OS dialog "
      + "lands on the input rather than being forwarded to it");

    /* Clicking into the hex field must not dismiss the menu around it. That is
       the .menu class plus the dispatcher's existing click-away rule, not a new
       branch — asserted together so removing either one fails here. */
    check(/if\(!e\.target\.closest\("\.menu"\)\) closeMenu\(\)/.test(SCRIPT),
      "a click inside anything carrying .menu is not a click away");
    check(!/accentPop|accentHex|accent-swatch/.test(
      (/document\.addEventListener\("click"[\s\S]*?\n\}\);/.exec(SCRIPT) || [""])[0]),
      "…and the click dispatcher names none of this — the swatches are data-cmd and "
      + "the field is inside a .menu, so both are covered by rules already there");
    /* Escape ends the session before it closes the menu, so a half-typed value
       is neither committed nor left on screen — the field's blur tidies it. */
    const keys = /document\.addEventListener\("keydown", e=>\{[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(keys && keys[0].indexOf("endEdit()") < keys[0].indexOf("menuOpen()"),
      "Escape ends the edit session BEFORE closing the menu");
    const close = /function closeMenu\(refocus\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(close && /endEdit\(\)/.test(close[0]),
      "…and closing the menu ends one too, whichever way it was dismissed");

    /* The face still says what the accent is, closed. */
    const sum = /function syncStyleSummaries\(\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(sum && /\$\("#accentSwatch"\)\.style\.setProperty\("--swatch"/.test(sum[0]),
      "the swatch on the face follows the accent");
    check(sum && /\$\("#accentBtn"\)\.setAttribute\("aria-label"/.test(sum[0]),
      "…and so does the face's accessible name, the way the five selectors carry "
      + "their checked value");
  }

  /* --brand is fixed app chrome and must never follow the chart's accent. */
  {
    const css = /<style>([\s\S]*?)<\/style>/.exec(MARKUP);
    const CSS = css ? css[1] : "";
    check(/--brand:#[0-9a-fA-F]{6};/.test(CSS),
      "--brand is a literal in the sheet, not derived from anything");
    check(!/--brand\s*:\s*var\(--accent/.test(CSS),
      "…and no rule aliases it to an accent variable");
    check(!/setProperty\(\s*"--brand"/.test(SCRIPT) && !/--brand[^\n]*state\.accent/.test(SCRIPT),
      "and no script writes --brand at all, from state.accent or anything else");
  }
}

/* -------------------------------- 4i. asynchronous writes name their document */

/* Behaviour is covered in test/document.js §8. What is guarded here is the
   thing a later edit could break without any test noticing: an await added in
   front of a commit, with nothing capturing the generation first. */
{
  check(/function staleWrite\(/.test(SCRIPT),
    "there is one decision point for whether an async result may still be written");
  check(/function newGeneration\(/.test(SCRIPT), "and one place the generation advances");

  const reset = /function resetPerRoster\([\s\S]*?\n\}/.exec(SCRIPT);
  check(reset && /newGeneration\(\)/.test(reset[0]),
    "New and Open advance the generation — resetPerRoster is where both of them meet");

  /* every await that precedes a commit must have captured the generation */
  for(const name of ["addFiles"]){
    const fn = new RegExp("async function " + name + "\\([\\s\\S]*?\\n\\}").exec(SCRIPT);
    check(!!fn, name + " is readable");
    if(fn){
      const captured = fn[0].indexOf("= docGen");
      const decoded  = fn[0].indexOf("await processImage");
      check(captured >= 0, name + " captures the document generation");
      check(captured >= 0 && decoded >= 0 && captured < decoded,
        "and captures it before the first decode, not after");
      check(/staleWrite\(/.test(fn[0]), "and re-checks before committing anything");
      check(fn[0].indexOf("staleWrite(") < fn[0].indexOf("commit("),
        "with the check ahead of the commit, so a refusal takes no snapshot");
    }
  }

  const swap = /\$\("#fileSwap"\)\.addEventListener\("change"[\s\S]*?\n\}\);/.exec(SCRIPT);
  check(!!swap, "the replace-photo handler is readable");
  if(swap){
    check(swap[0].indexOf("= docGen") < swap[0].indexOf("await processImage"),
      "a photo replacement captures the generation before decoding");
    check(swap[0].indexOf("staleWrite(") < swap[0].indexOf("commit("),
      "and checks it before committing");
    check(/staleWrite\([^)]*person/.test(swap[0]),
      "and checks the person it captured is still the one in the roster");
  }

  /* Whole-structure replacement stays inside the document but deliberately
     invalidates the destination an outstanding photo batch captured.
     applyTemplate is a standalone function, not a COMMANDS entry — the
     Templates menu items call it directly with the chosen id — so it is
     read out separately from clearGrades below. */
  {
    const fn = /async function applyTemplate\(id\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!fn, "applyTemplate is readable");
    check(fn && /newGeneration\(\)/.test(fn[0]),
      "applyTemplate invalidates outstanding imports before replacing all grades");
    check(fn && fn[0].indexOf("newGeneration()") < fn[0].indexOf("commit("),
      "applyTemplate advances the generation before its undo snapshot");
  }
  for(const cmd of ["clearGrades"]){
    const fn = new RegExp(cmd + ":\\s*async\\s*\\(\\)\\s*=>\\s*\\{[\\s\\S]*?\\n  \\},").exec(SCRIPT);
    check(fn && /newGeneration\(\)/.test(fn[0]),
      cmd + " invalidates outstanding imports before replacing all grades");
    check(fn && fn[0].indexOf("newGeneration()") < fn[0].indexOf("commit("),
      cmd + " advances the generation before its undo snapshot");
  }
}

/* -------------------------------- 4j. opening a roster decodes before it adopts */

/* Behaviour is covered in test/import.js §10 (what the decoder refuses) and
   test/document.js §10 (which of two Opens wins). What is guarded here is the
   ordering a later edit could quietly invert: adopting the state first and
   checking the photos afterwards would pass both of those suites' happy paths
   while reintroducing exactly the half-applied import this app is designed
   to prevent. */
{
  const open = /async function openRoster\([\s\S]*?\n\}/.exec(SCRIPT);
  check(!!open, "openRoster is readable");
  if(open){
    check(open[0].indexOf("parseAndValidateRoster(") < open[0].indexOf("decodeRosterPhotos("),
      "openRoster proves the structure before it decodes a single image");
    check(/if\(!r\.ok\) return r;/.test(open[0]),
      "and returns a refusal without decoding anything");
    /* cancellation is not a refusal: it carries no reason, because there is
       nothing wrong with the file and nothing to tell the user about it */
    check(/cancelled/.test(open[0]),
      "openRoster can be told the caller no longer wants the answer");
    check(/return \{ok:false, cancelled:true\}/.test(open[0]),
      "and reports that as its own kind of verdict, not as a reason a file was bad");
    check(!/reason/.test(open[0].replace(/\/\*[\s\S]*?\*\//g, " ")),
      "a cancelled open invents no reason for anyone to display");
  }

  /* the one function in the app that hands a string from a file to a loader */
  const dec = /function decodeImage\([\s\S]*?\n\}/.exec(SCRIPT);
  check(!!dec, "decodeImage is readable");
  if(dec){
    check(dec[0].indexOf("validatePhoto(src)") < dec[0].indexOf("img.src = src"),
      "nothing is handed to an image decoder that validatePhoto has not passed");
    check(/new Image\(\)/.test(dec[0]) && !/fetch|XMLHttpRequest|createImageBitmap\(new/.test(dec[0]),
      "and it is decoded from the data URL, never fetched");

    /* THE preflight ordering guard. Reading the header after the decode would
       pass every behavioural assertion in test/import.js §11 that looks at the
       verdict, while putting the browser back in front of the size check —
       which is the entire cost being avoided, since it is the decoder that
       allocates the pixels. */
    const srcAt = dec[0].indexOf("img.src = src");
    check(dec[0].indexOf("photoHeader(src)") >= 0 && dec[0].indexOf("photoHeader(src)") < srcAt,
      "the header is read from the bytes BEFORE the browser is asked to decode them");
    check(dec[0].indexOf("photoSizeProblem(head") >= 0
       && dec[0].indexOf("photoSizeProblem(head") < srcAt,
      "and the size limits are applied to the header dimensions before img.src");
    check(dec[0].indexOf("photoSizeProblem(real") > srcAt,
      "and again to what the decoder actually produced");
    check(/sizeMatchesHeader\(real\.w, real\.h, head\)/.test(dec[0]),
      "and checks what the decoder produced against the header through the one shared predicate");
    const matchesHeader = /function sizeMatchesHeader\(w, h, head\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!matchesHeader, "sizeMatchesHeader is readable");
    check(matchesHeader && /w === head\.h && h === head\.w/.test(matchesHeader[0]),
      "an EXIF-rotated JPEG is recognised as the same picture transposed, not as a lying file");
    check(dec[0].indexOf("stop()") < srcAt,
      "a cancelled decode gives up before it starts the decoder");
  }

  /* the header readers themselves must exist and must not be reachable around */
  for(const fn of ["photoBytes", "photoHeader", "pngHeaderSize", "jpegHeaderSize", "be32"]){
    check(new RegExp("function\\s+" + fn + "\\s*\\(").test(SCRIPT),
      "the " + fn + "() preflight step still exists");
  }
  {
    const pb = /function photoBytes\([\s\S]*?\n\}/.exec(SCRIPT);
    check(!!pb, "photoBytes is readable");
    /* the envelope check has to come first, or "accepts only what validatePhoto
       accepted" is a comment rather than a fact — and a remote URL would be
       base64-decoded into nothing instead of being refused */
    check(pb && pb[0].indexOf("validatePhoto(src)") < pb[0].indexOf("new Uint8Array"),
      "photoBytes proves the envelope before it allocates any bytes");
    check(pb && /Math\.min\(PHOTO_SCAN_BYTES/.test(pb[0]),
      "and bounds what it allocates, whatever the encoded length allowed");
    check(pb && !/fetch|XMLHttpRequest|atob\(/.test(pb[0]),
      "and decodes the base64 itself, without fetching anything");
    const ph = /function photoHeader\([\s\S]*?\n\}/.exec(SCRIPT);
    check(ph && /mime === "png" \? pngHeaderSize/.test(ph[0]),
      "the declared type picks the parser, so a mislabelled file fails on its own bytes");
  }
  /* Every assignment to a .src is a place a URL could be loaded, so each one has
     to be provably fed from validatePhoto. `img.src = p.photo` would put a value
     straight from a roster file on the wire, and reads identically.

     A name is not trusted for being spelled `src` or `safe` — an allowlist of
     names is exactly the check that goes green after someone renames a local and
     stays green after someone assigns an imported field to a local of the same
     name. What is demanded instead is a proof, inside the function that does the
     assigning and textually ahead of it, in one of the two forms the app uses:

       bound    const safe = validatePhoto(fr.result);   … img.src = safe;
       guarded  if(!validatePhoto(src)) return null;      … img.src = src;

     loadImg is the one function that takes what it is given, and it is covered
     by the call-site check below instead. */
  {
    /* top-level function spans — every .src assignment in this file sits inside
       one, including the ones nested in an arrow or a Promise executor */
    const spans = [...SCRIPT.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)]
      .map(m => ({name: m[1], at: m.index}));
    spans.forEach((s, i) => { s.end = i + 1 < spans.length ? spans[i + 1].at : SCRIPT.length; });
    const spanAt = at => spans.find(s => at >= s.at && at < s.end);
    const rx = n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    /* `name` is proved validated within `body`, before offset `before` */
    function provenValidated(body, name, before){
      const head = body.slice(0, before);
      const bound  = new RegExp("(?:const|let|var)\\s+" + rx(name) + "\\s*=[^;]*validatePhoto\\s*\\(");
      const guard  = new RegExp("if\\s*\\(\\s*!\\s*validatePhoto\\s*\\(\\s*" + rx(name)
                              + "\\s*\\)\\s*\\)\\s*return");
      return bound.test(head) || guard.test(head);
    }

    const EXEMPT = ["loadImg"];        // justified by its own call-site check below
    const assigns = [...SCRIPT.matchAll(/\.src\s*=\s*([A-Za-z_$][\w$.]*)/g)]
      .map(m => ({name: m[1], at: m.index}));
    check(assigns.length >= 4, "the .src assignments are found at all — " + assigns.length);

    const unproven = assigns.filter(a => {
      const fn = spanAt(a.at);
      if(!fn) return true;                              // outside every function: unprovable
      if(EXEMPT.indexOf(fn.name) >= 0) return false;
      return !provenValidated(SCRIPT.slice(fn.at, fn.end), a.name, a.at - fn.at);
    }).map(a => (spanAt(a.at) ? spanAt(a.at).name : "<top level>") + ": .src = " + a.name);

    check(unproven.length === 0,
      "every .src is assigned a value proved to come from validatePhoto, never a field "
      + "off an imported object — unproven: " + JSON.stringify(unproven));

    /* the exemption is only worth as much as this: loadImg loads whatever it is
       handed, so every hand must have been validated first */
    const calls = [...SCRIPT.matchAll(/loadImg\s*\(\s*([A-Za-z_$][\w$.]*)\s*\)/g)]
      /* `function loadImg(src)` is the declaration, not a call site */
      .filter(m => !/function\s+$/.test(SCRIPT.slice(Math.max(0, m.index - 12), m.index)))
      .map(m => ({name: m[1], at: m.index}));
    check(calls.length >= 1, "loadImg's call sites are found at all — " + calls.length);
    const loose = calls.filter(c => {
      const fn = spanAt(c.at);
      return !fn || !provenValidated(SCRIPT.slice(fn.at, fn.end), c.name, c.at - fn.at);
    }).map(c => (spanAt(c.at) ? spanAt(c.at).name : "<top level>") + ": loadImg(" + c.name + ")");
    check(loose.length === 0,
      "and every value handed to loadImg was validated at the call site — unproven: "
      + JSON.stringify(loose));
  }

  /* dimensions come from the decoder, not from the file */
  const rp = /async function decodeRosterPhotos\([\s\S]*?\n\}/.exec(SCRIPT);
  check(!!rp, "decodeRosterPhotos is readable");
  if(rp){
    check(/p\.pw\s*=\s*dim\.w/.test(rp[0]) && /p\.ph\s*=\s*dim\.h/.test(rp[0]),
      "the decoded size replaces what the roster file claimed");
    check(/clampFrame\(p\)/.test(rp[0]),
      "and the frame is re-clamped against it, so a corrected size cannot strand a crop");
    /* the limits are checked inside decodeImage, ahead of the decoder — what
       has to survive here is that an over-limit photo still costs only the
       photo */
    check(/dim\.problem/.test(rp[0]),
      "every photo is measured against the limits, and the reason reaches the report");
    check(/applyPhoto\(p, null\)/.test(rp[0]),
      "and a photo that fails costs the photo, never the person");

    /* cancellation is checked on both sides of the await: before the photo so a
       superseded Open stops doing work, and after it because the document can
       change while one photo decodes */
    const awaitAt = rp[0].indexOf("await decodeImage");
    check(rp[0].indexOf("stop()") >= 0 && rp[0].indexOf("stop()") < awaitAt,
      "decodeRosterPhotos checks for cancellation BEFORE starting each photo");
    check(rp[0].indexOf("DECODE_CANCELLED") > awaitAt,
      "and again the moment a decode comes back");
    check(/return !stop\(\)/.test(rp[0]),
      "and once more before it hands back a roster to adopt");
  }

  /* the ordering guard: which of two Opens wins */
  const pick = /\$\("#jsonPick"\)\.addEventListener\("change"[\s\S]*?\n\}\);/.exec(SCRIPT);
  check(!!pick, "the file-open handler is readable");
  if(pick){
    check(pick[0].indexOf("++openSeq") < pick[0].indexOf("await openRoster"),
      "an Open takes its sequence number before it starts, not after");
    check(pick[0].indexOf("mine !== openSeq") < pick[0].indexOf("state = r.state"),
      "and a superseded Open returns before it can adopt anything");
    check(/openingStatus\(/.test(pick[0]), "opening shows a status while it works");

    /* A read that fails late belongs to the same rule as a decode that finishes
       late. Clearing the status behind the guard while alerting in front of it
       reported a failure the user had moved on from, over the top of an Open
       that was still working. */
    const err = /fr\.onerror\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\n  \};/.exec(pick[0]);
    check(!!err, "the read-failure handler is readable");
    check(err && err[0].indexOf("mine !== openSeq") < err[0].indexOf("alertMsg("),
      "a superseded read gives up before it reports anything");
    check(err && err[0].indexOf("mine !== openSeq") < err[0].indexOf("openingStatus("),
      "and before it touches a status line that is not its own");
  }
}

/* ------------------------------- 4k. Start combines document and People commands */

/* New is the one whole-document start-over action; a second Reset command
   would duplicate it under a less accurate label. Whole-grade actions live
   in Structure. */
{
  const paneAt   = MARKUP.indexOf('id="pane-file"');
  const nextPane = MARKUP.indexOf('class="rb-pane"', paneAt);
  check(paneAt > 0 && nextPane > paneAt, "the Start pane is locatable in the markup");
  const pane = MARKUP.slice(paneAt, nextPane);

  const groups = matchAll(/<div class="rb-group">([\s\S]*?)<div class="lbl">([^<]+)<\/div>\s*<\/div>/g,
                          pane).map(m => ({body:m[1], label:m[2]}));
  check(groups.length === 4, "Start has exactly four groups — got " + groups.length);
  /* PEOPLE, not ADD PEOPLE: a group caption names what the group is about, and
     the verb belongs to the command inside it — which still says Add people on
     its face. FILE and EXPORT beside it are nouns for the same reason. There
     is no VIEW group: the rail's one button covers every width, so Start
     needs no toggle of its own for the roster panel. */
  check(groups.map(g => g.label).join(",") === "File,Export,People,Info",
    "Start orders File, Export, People, then Info — there is no standing-defaults "
      + "group and no View group; their questions are asked elsewhere — got "
      + groups.map(g => g.label).join(","));
  check(!/<div class="lbl">Add people<\/div>/.test(pane),
    "the caption is not the command's own label repeated — the face says Add people");

  const cmdsIn = s => matchAll(/data-cmd="([A-Za-z]+)"/g, s).map(m => m[1]);

  /* --- group 1: Save copy | Open/New --- */
  check(/<div class="lbl">File<\/div>/.test(pane),
    'the first group label is FILE, not Roster — that name belongs to the tab beside it');
  check(!/<div class="lbl">Roster<\/div>/.test(pane),
    "no group in Start is labelled Roster");

  check(cmdsIn(groups[0].body).join(",") === "save,saveAs,open,new",
    "group 1 is save (+ saveAs), then the Open/New stack — got: "
      + cmdsIn(groups[0].body).join(","));
  check(!/data-cmd="reset"/.test(pane) && !/>Reset</.test(pane),
    "File has no second whole-document start-over action beside New");

  /* --- group 2: Copy PNG | the Export menu button ---
     The three export-format buttons are one whole menu button: the face
     carries no primary action of its own, so clicking anywhere on it opens
     the format menu. Copy PNG stays its own command because it is a different
     act — it puts a picture on the clipboard, it does not write a file. */
  check(/<div class="lbl">Export<\/div>/.test(pane), "the second group label is still EXPORT");
  check(cmdsIn(groups[1].body).join(",") === "copyPng,exportPng,exportPdf,exportSvg,exportCsv",
    "group 2 is Copy PNG, then the Export menu button's four menu items, PNG "
      + "first and CSV last — got: " + cmdsIn(groups[1].body).join(","));
  check(!/rb-stack/.test(pane),
    "Start uses no shared .rb-stack — it is a grid");

  const minis = s => matchAll(/class="[^"]*\brb-mini\b[^"]*"/g, s).length;
  check(minis(groups[0].body) === 2,
    "column 2 of group 1 holds exactly two compact buttons (Open, New) — got " + minis(groups[0].body));
  check(minis(groups[1].body) === 0,
    "the Export group has no compact stack — got " + minis(groups[1].body));

  /* --- group 3: the Add people split ---
     The Add people commands are one split — a lead plus a menu — so this
     group reads face-then-menu exactly as Export's does. §4m asserts the
     split's own parts. */
  check(cmdsIn(groups[2].body).join(",") === "addPeople,pasteList,importCsv,clearRoster",
    "group 3 is the Add people split — its face, then its two menu items — and "
      + "Clear roster beside them — got: " + cmdsIn(groups[2].body).join(","));
  /* One, not two: the second half of that column is deliberately empty, and a
     count is the only thing that notices a button quietly filling it. */
  check(minis(groups[2].body) === 1,
    "People's compact column holds Clear roster and nothing else — got " + minis(groups[2].body));
  check(!/\brb-side\b/.test(pane),
    "File carries no third-column .rb-side layout");

  /* --- the Export menu button ---
     Export is not a split and not a look-alike of one: it is a genuine
     button.style-command.style-tall, reusing the Design selector-face layout
     rather than a second copy of it, so it needs no rule of its own for the
     icon-over-label centring or the right-centred caret — it gets both by
     carrying the same classes Background, Layout, Text and Photo ring do. */
  {
    /* Anchored on id, with the class list captured rather than hard-coded into
       the extraction: a hard-coded literal would make the class-membership
       checks below unreachable on their own — any mutation that broke them
       would also break the extraction first, and only the coarser failure
       would ever be seen. */
    const ex = /<button class="([^"]*)" id="exportMenuBtn"[\s\S]*?<\/button>[\s\S]*?<div class="menu" id="exportMenu"[\s\S]*?<\/div>/.exec(groups[1].body);
    check(!!ex, "Export's button and menu are found by id");
    if(ex){
      const btn = /<button class="([^"]*)" id="exportMenuBtn"[\s\S]*?<\/button>/.exec(ex[0]);
      check(!!btn, "the button element is found inside the group");
      if(btn){
        const classes = btn[1].split(" ");
        check(classes.includes("rb-lead2"),
          "it keeps rb-lead2, so it still spans both rows like the lead beside it");
        check(!/data-cmd=/.test(btn[0]),
          "the face carries NO data-cmd — clicking anywhere on it only opens the menu");
        check(/aria-haspopup="menu"/.test(btn[0]),
          "it declares aria-haspopup=menu");
        check(/aria-expanded="false"/.test(btn[0]),
          "and starts collapsed");
        check(/aria-controls="exportMenu"/.test(btn[0]) && /id="exportMenu"[^>]*role="menu"/.test(ex[0]),
          "and controls the menu it names");
        check(/<use href="#i-export"\/>/.test(btn[0]),
          "it carries the file_export artwork (#i-export)");
        /* The layout claim is answered by a second writer, not a copied pixel
           list: Layout's own class string, read out of the live markup, is
           what Export is compared against — so a change to what makes a
           Design selector face reaches this check too, instead of a literal
           this suite would have to remember to update by hand. Layout is the
           reference because it remains a whole style-tall face — Background
           and Photo ring are compact style-mini buttons and would not be
           comparable. */
        const bg = /<button class="([^"]*)"[^>]*id="layoutBtn"/.exec(MARKUP);
        check(!!bg, "a reference Design selector face (Layout) is found to compare against");
        if(bg){
          check(bg[1].split(" ").every(c => classes.includes(c)),
            "Export carries every class that makes Layout a whole selector face "
            + "— style-command and style-tall — so the same rules lay both out");
        }
        /* The label and caret carry the same two classes every other selector
           face's do, rather than a copy of the values those classes resolve
           to: .style-label is what makes the row read on its own line, and
           .style-caret is the absolute, right-centred positioning that puts
           the caret at the edge instead of under or beside the label text. */
        check(/<span class="style-label">Export<\/span>/.test(btn[0]),
          "the label carries style-label, like every other selector face's label, "
          + "and reads Export");
        check(/<svg class="ic style-caret"><use href="#i-caret"\/><\/svg>/.test(btn[0]),
          "the caret carries style-caret — the same absolute, right-centred "
          + "positioning every other selector face's caret gets, not a rule of "
          + "Export's own");
      }
      /* three formats, PNG first, each a real menuitem — the face carries no
         data-cmd, so this loop has no face row to skip */
      const items = matchAll(/role="menuitem" data-cmd="([A-Za-z]+)"/g, ex[0]).map(m => m[1]);
      check(items.join(",") === "exportPng,exportPdf,exportSvg,exportCsv",
        "the menu offers PNG, PDF, SVG and CSV in that order — got " + items.join(","));
      for(const [cmd, icon] of [["exportPng","#i-png"],["exportPdf","#i-pdf"],["exportSvg","#i-photos"],["exportCsv","#i-csv"]]){
        check(new RegExp('data-cmd="' + cmd + '"><svg class="ic"><use href="' + icon + '"\\/>')
          .test(ex[0]), cmd + " reuses the existing " + icon + " artwork");
      }
    }
    /* Choosing a format must not rewrite the face. Nothing in the script may
       assign to a button's data-cmd — that is what would turn a stable command
       into one that silently does something else next time. */
    /* `=(?!=)` so a comparison like `b.dataset.cmd === "viewRoster"` is not read
       as an assignment — that would be a green check that never fails */
    check(!/dataset\.cmd\s*=(?!=)/.test(SCRIPT) && !/setAttribute\("data-cmd"/.test(SCRIPT),
      "no code rewrites a data-cmd, so picking a format cannot change any button's command");
  }

  /* --- the split button --- */
  const split = /<div class="split rb-lead">[\s\S]*?<\/div>\s*<\/div>/.exec(groups[0].body);
  check(!!split, "Save copy is still a split button");
  if(split){
    check(/data-cmd="save"/.test(split[0]), "the split's primary action is the save command");
    check(/id="saveMenuBtn"[\s\S]*?aria-haspopup="menu"/.test(split[0]),
      "the split toggle still declares aria-haspopup=menu");
    check(/aria-controls="saveMenu"/.test(split[0]) && /id="saveMenu"[^>]*role="menu"/.test(split[0]),
      "the toggle still controls the menu it names");
    check(/role="menuitem" data-cmd="saveAs"/.test(split[0]), "saveAs is still the menu item");
    check(split[0].indexOf("rb-lead") >= 0, "the split is the column-1 lead action");
    /* Both halves say COPY, because that is what the command does — it writes a
       fresh file to the downloads folder every time, it never writes back over
       one. Asserted as whole labels rather than through the ">" + want list
       below, whose fallback clause is a prefix match and so cannot tell "Save"
       from "Save copy" — the exact distinction this rename is about. */
    check(/<span>Save copy<\/span>/.test(split[0]),
      "the face reads Save copy, not Save");
    check(/>Save copy as…</.test(split[0]),
      "and the menu item reads Save copy as…, not Save As…");
    /* Save copy as… carries the save_as icon, the same
       shape the Export menu items already have. Scoped to the split, which is
       the only place #i-save-as can appear. */
    check(/data-cmd="saveAs"><svg class="ic"><use href="#i-save-as"\/><\/svg>/.test(split[0]),
      "saveAs carries its own icon (save_as)");
    check(!/>Save<|>Save As…</.test(split[0]),
      'neither bare label ("Save"/"Save As…") appears on either half');
    check(/data-cmd="save" title="Save a copy of the roster file"/.test(split[0]),
      "the face's tooltip says a copy too");
  }
  /* The QAT carries the same command and must use the same "copy" wording —
     it is the half a user reaches for most and the only one with no visible
     label. */
  check(/class="qbtn" data-cmd="save" title="Save a copy of the roster file"/.test(MARKUP),
    "the quick-access save button's tooltip says a copy as well");
  check(MARKUP.indexOf("Save (the roster file)") < 0 && MARKUP.indexOf("Save the roster file") < 0,
    "no tooltip promises to save THE roster file");

  /* --- every label still has text to show --- */
  /* "Save copy" is deliberately NOT in this list. The fallback clause below is a
     prefix match — it is there so "New" can find "New canvas" — and ">Save copy"
     is a prefix of the menu item ">Save copy as…", so the entry would pass with
     the face's label deleted entirely. Both save labels are asserted whole, in
     the split-button block above. */
  for(const want of ["Open…", "New", "Copy PNG",
                     "Export PNG", "Export PDF", "Export SVG",
                     "Add people", "Add list…"]){
    check(pane.indexOf(">" + want + "<") >= 0 || pane.indexOf(">" + want) >= 0,
      'the label "' + want + '" is still rendered in Start');
  }
}

/* The layout itself. Assert the rules exist rather than trusting the markup
   classes to mean something. */
{
  const css = /<style>([\s\S]*?)<\/style>/.exec(MARKUP);
  check(!!css, "the stylesheet is readable");
  const CSS = css ? css[1] : "";
  check(/\.rb-file\{[^}]*display:grid/.test(CSS), ".rb-file is a CSS grid");
  /* One explicit track. The compact buttons flow into the implicit second, so a
     lead-only group declares nothing it does not fill. */
  check(/\.rb-file\{[^}]*grid-template-columns:auto;/.test(CSS),
    ".rb-file declares one column and lets the rest be implicit");
  check(/\.rb-file\{[^}]*grid-template-rows:1fr 1fr/.test(CSS), ".rb-file declares two rows");
  check(/\.rb-file > \.rb-lead\{grid-column:1;grid-row:1 \/ span 2\}/.test(CSS),
    "the lead action occupies column 1 across both rows");

  check(!/\.rb-side/.test(CSS),
    "the stylesheet carries no third-column .rb-side Reset class");
  /* The start view's own Privacy button must look exactly like the ribbon's —
     one writer, so the two faces cannot drift — which means it rides the
     SAME rule rather than restating its values in a second one. */
  check(/\.rb-file > \.rb-mini, \.start-foot-btn\{justify-content:flex-start;padding:4px 9px;font-size:12px\}/.test(CSS),
    "column 2 uses the shared compact-button metrics, and the start view's "
    + "own Privacy button rides the same grouped rule");

  /* The ribbon body is one fixed height for every tab, so the chart cannot jump
     when tabs change. 88px fits the standard controls and group label; touch
     make the same controls 100px tall, so that breakpoint carries its own value.
     Lowering either without measuring puts a scrollbar in the ribbon. */
  check(/\.rb-body\{[^}]*padding:6px 6px 4px;height:88px/.test(CSS),
    "the desktop ribbon is the measured 88px body with 10px vertical padding");
  check(/\.rb-body\.has-scroll\{height:104px\}/.test(CSS),
    "a ribbon that needs a horizontal scrollbar reserves its full height");
  check(/\.rb-pane\{[^}]*overflow-x:auto;overflow-y:hidden/.test(CSS),
    "ribbon panes scroll only horizontally and cannot flash a vertical scrollbar");
  check(/@media \(max-width:900px\)\{[\s\S]*?\.ribbon\{overflow-x:auto;overflow-y:hidden\}/.test(CSS),
    "the narrow whole-ribbon scroller also clips its vertical axis");
  check(/\.rb-group > \.lbl\{[^}]*padding-top:2px/.test(CSS),
    "the group caption's top padding is 2px");
  /* The touch override and the rule it overrides have the SAME specificity, so
     source order is the whole story. Placed in the narrow-viewport block near
     the top of the sheet — the obvious home for it — it loses to the base rule
     further down and does nothing, silently: the CSS parses, the media query
     matches, and the height simply never changes. Assert the position, not just
     the presence, because presence is what was green while it was broken. */
  {
    const base  = CSS.indexOf(".rb-body{position:relative;padding:6px 6px 4px;height:88px");
    const touch = CSS.indexOf("@media (max-width:900px){ .rb-body{height:100px} }");
    check(touch >= 0, "the touch breakpoint raises the body to 100px for its 36px targets");
    check(base >= 0 && touch > base,
      "the touch override comes AFTER the base .rb-body rule — at equal "
      + "specificity an earlier one would lose and change nothing");
  }
  check(!/\.rb-body\{[^}]*height:104px/.test(CSS),
    "104px is conditional on a scrollbar, not the default body height");
  check(/\.rb-pane\.rb-measure\{[^}]*display:flex[^}]*position:absolute[^}]*visibility:hidden/.test(CSS),
    "hidden panes have an invisible measurement state");
  {
    const sync = /function syncRibbonOverflow\(\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!sync, "syncRibbonOverflow is readable");
    check(sync && /document\.querySelectorAll\("\.rb-pane"\)/.test(sync[0])
      && /scrollWidth > pane\.clientWidth \+ 1/.test(sync[0]),
      "it checks every pane for real horizontal overflow");
    check(sync && /classList\.add\("rb-measure"\)/.test(sync[0])
      && /classList\.remove\("rb-measure"\)/.test(sync[0]),
      "and measures hidden panes without leaving them exposed");
    check(sync && /classList\.toggle\("has-scroll", overflow\)/.test(sync[0]),
      "one shared class controls the height for every tab");
    const select = /function selectTab\([\s\S]*?\n\}/.exec(SCRIPT);
    const roster = /function renderRoster\(\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(select && /syncRibbonOverflow\(\)/.test(select[0])
       && roster && /syncRibbonOverflow\(\)/.test(roster[0])
       && /addEventListener\("resize"[\s\S]{0,120}syncRibbonOverflow\(\)/.test(SCRIPT),
      "tab changes, grade changes and window resizes all refresh the shared state");
  }
  check(/\.rb-file > \.rb-lead,\s*\.rb-file > \.rb-lead > \.big\{height:auto;min-height:66px\}/.test(CSS),
    "the lead stretches to its spanned area instead of pinning a second height");

  /* Two compact buttons at 36px stretch their lead to 75px on a touch screen.
     A lead beside prose has nothing doing that, so it has to say 75px itself or
     that group ends 9px short of the ones either side of it. Same specificity as
     the 66px rule again, so position is the assertion. */
  {
    const base  = CSS.indexOf(".rb-file > .rb-lead > .big{height:auto;min-height:66px}");
    const touch = CSS.indexOf(".rb-file > .rb-lead > .big{min-height:75px}");
    check(touch >= 0, "the touch breakpoint states the lead's 75px outright");
    check(base >= 0 && touch > base,
      "the 75px touch rule comes AFTER the 66px one — earlier it would lose silently");
    check(/@media \(max-width:900px\)\{\s*\.rb-file > \.rb-lead,\s*\.rb-file > \.rb-lead > \.big\{min-height:75px\}/.test(CSS),
      "and it is inside the touch breakpoint, not applied at every width");
  }

  /* The height must not depend entirely on the lead: a .rb-file group with
     no lead has nothing stretching its rows, and would otherwise collapse to
     the button's own content height — visibly shorter than every other
     single-row compact button in the ribbon. The container states its own
     66/75px instead of leaving it to whichever child happens to enforce it.
     Anchor on ".rb-file{" itself, with the brace
     immediately after — ".rb-file > .rb-lead{" starts with the same
     characters and a looser prefix match would be satisfied by that rule's
     own 66/75px without ever looking at this one. */
  check(/\.rb-file\{[^}]*min-height:66px/.test(CSS),
    "the .rb-file container itself states the 66px group height");
  {
    /* Bound the search to the SAME media block the .rb-lead touch override
       already lives in (proven above), rather than a bare .test() that
       "@media (max-width:900px)…somewhere later…min-height:75px" would also
       satisfy from an unrelated breakpoint elsewhere in the sheet — .style-grid,
       .info-lead and .g-chip-face all have their own 900px/75px rules. */
    const mediaStart = CSS.indexOf(
      "@media (max-width:900px){\n    .rb-file > .rb-lead,\n"
      + "    .rb-file > .rb-lead > .big{min-height:75px}");
    check(mediaStart >= 0, "the .rb-lead touch breakpoint has the expected shape");
    const closeBrace = mediaStart >= 0 ? CSS.indexOf("\n  }", mediaStart) : -1;
    const decl = mediaStart >= 0 ? CSS.indexOf(".rb-file{min-height:75px}", mediaStart) : -1;
    check(decl >= 0 && closeBrace >= 0 && decl < closeBrace,
      "and a lead-less .rb-file is raised to 75px inside that same touch breakpoint");
  }
}

/* ------------------------------- 4k2. the rail's roster-panel toggle */

/* Hiding the roster panel does not remove it entirely — a slim rail stays
   at the left edge holding exactly one control, the button that brings the
   panel back, present and working at every width. There is no ribbon
   toggle and no View group; the rail is the one place this command lives
   outside the panel's own close button (§4k3). */
{
  const CSS = (/<style>([\s\S]*?)<\/style>/.exec(MARKUP) || ["", ""])[1];

  /* --- the rail sits directly before the panel aside, one button inside --- */
  const railBlock = /<div class="panel-rail" id="panelRail">([\s\S]*?)<\/div>\s*<aside class="panel">/
    .exec(MARKUP);
  check(!!railBlock, "#panelRail is locatable directly before the panel aside");
  if(railBlock){
    const btns = matchAll(/<button\b/g, railBlock[1]);
    check(btns.length === 1, "the rail holds exactly one button — got " + btns.length);
    check(/data-cmd="toggleRoster"/.test(railBlock[1]),
      "…and it dispatches toggleRoster");
    check(/<use href="#i-panel-open"\/>/.test(railBlock[1]),
      "…carrying the full #i-panel-open href, not one built by concatenation");
  }

  /* --- no button anywhere inside the ribbon still carries the command —
     it moved out entirely, it did not grow a second home --- */
  const ribbonAt = MARKUP.indexOf('<div class="ribbon">');
  const appAt    = MARKUP.indexOf('<div id="app">');
  check(ribbonAt > 0 && appAt > ribbonAt, "the ribbon block is locatable");
  if(ribbonAt > 0 && appAt > ribbonAt){
    check(!/data-cmd="toggleRoster"/.test(MARKUP.slice(ribbonAt, appAt)),
      "no button inside the ribbon dispatches toggleRoster — the rail is its only home now");
  }

  /* --- both icons ship, above the PLACEHOLDER boundary (§2 already proves
     every referenced symbol exists somewhere; this pins WHERE) --- */
  const placeholderAt = MARKUP.indexOf("PLACEHOLDER");
  const closeAt = MARKUP.indexOf('<symbol id="i-panel-close"');
  const openAt  = MARKUP.indexOf('<symbol id="i-panel-open"');
  check(closeAt > 0 && closeAt < placeholderAt,
    "i-panel-close is Material Symbols artwork and sits ABOVE the PLACEHOLDER comment");
  check(openAt > 0 && openAt < placeholderAt,
    "i-panel-open is Material Symbols artwork and sits ABOVE the PLACEHOLDER comment");

  /* Page's three new icons (crop_landscape/crop_portrait/crop_square) are the
     same kind of download as the pair above — Material Symbols artwork, so
     they belong ABOVE the boundary too, distinct from the pre-existing
     #i-square (the plain "square" outline icon used by Fill's Border-only
     row): a page-shape icon and a fill-style icon are different symbols on
     purpose, so #i-square is left untouched rather than reused or duplicated. */
  for(const id of ["i-page-landscape", "i-page-portrait", "i-page-square"]){
    const at = MARKUP.indexOf('<symbol id="' + id + '"');
    check(at > 0 && at < placeholderAt,
      id + " is Material Symbols artwork and sits ABOVE the PLACEHOLDER comment");
  }
  check(MARKUP.indexOf('<symbol id="i-square"') !== MARKUP.indexOf('<symbol id="i-page-square"'),
    "i-square (Fill's Border-only icon) and i-page-square (Page's Square row) remain two distinct symbols");

  /* --- the dual-icon aria-pressed rules are gone along with the ribbon
     button that used them — the rail's button is a plain affordance, like
     the panel's own close button, and ships only one icon --- */
  check(!/\.ric-open/.test(CSS) && !/\.ric-close/.test(CSS),
    "the .ric-open/.ric-close rules are gone from the stylesheet");
  check(!/\bric-open\b/.test(MARKUP) && !/\bric-close\b/.test(MARKUP),
    "and neither class remains on any element");

  /* --- roster-hidden's rules — resolved from the real CSS text, not by
     trusting a class name — hold at EVERY width, not just above 900px. The
     narrow-only query is the one place a width restriction could still be
     hiding, so the check is: found in the sheet, and NOT confined inside
     that block. --- */
  check(/body\.roster-hidden \.panel\{display:none\}/.test(CSS),
    "hiding the panel is governed by roster-hidden");
  check(/body\.roster-hidden #app\{grid-template-columns:auto 1fr\}/.test(CSS),
    "and the rail's column plus the stage replace it — got a different rule "
    + "if this fails, the rail's own column may have been dropped");
  check(/#panelRail\.panel-rail\{[^}]*display:none/.test(CSS),
    "the rail itself is display:none by default");
  check(/body\.roster-hidden #panelRail\.panel-rail\{display:flex\}/.test(CSS),
    "…and becomes visible once roster-hidden is set");
  const narrowBlock = /@media \(max-width:900px\)\{([\s\S]*?)\n  \}/.exec(CSS);
  check(!!narrowBlock, "the narrow-viewport query is locatable");
  if(narrowBlock){
    check(!/#panelRail/.test(narrowBlock[1]) && !/roster-hidden \.panel\{/.test(narrowBlock[1])
       && !/roster-hidden #app\{/.test(narrowBlock[1]),
      "none of the rail's own visibility rules are confined inside the "
      + "narrow-only block — they hold above 900px too");
  }

  /* --- the JS reveal-on-narrow check names the identical breakpoint the CSS
     queries use — a literal 900px, not a different number that would redraw
     the chart at a width the CSS itself still shows the panel at --- */
  check(/matchMedia\("\(max-width:900px\)"\)/.test(SCRIPT),
    "the toggle's narrow check reads the same (max-width:900px) query the CSS states");
}

/* ------------------------------- 4k3. the panel's own close button */

/* A second way to reach the same command, this one living inside the roster
   panel's own <h2>, top right — an IDE-style close, not another toggle. It
   must never carry aria-pressed in markup: syncRosterToggle only writes that
   attribute onto buttons that already have it (see test/document.js §9b), so a
   button that ships it here would be announced as permanently pressed. */
{
  const css = /<style>([\s\S]*?)<\/style>/.exec(MARKUP);
  const CSS = css ? css[1] : "";
  const h2 = /<h2>Roster<button[\s\S]*?<\/button><\/h2>/.exec(MARKUP);
  check(!!h2, "the roster heading's own close button is findable, immediately after the heading text");
  check(h2 && h2[0].indexOf('data-cmd="toggleRoster"') >= 0,
    "…and dispatches the same command the rail's toggle does");
  check(h2 && h2[0].indexOf('<use href="#i-panel-close"/>') >= 0,
    "…carrying the full #i-panel-close href, not one built by concatenation");
  check(h2 && !/aria-pressed/.test(h2[0]),
    "…and ships NO aria-pressed — it is a plain close affordance, not a toggle");

  check(/\.blk > h2\{[^}]*display:flex/.test(CSS),
    "the heading row is a flex row so the close button sits inline with the "
    + "heading text, centred on it vertically");
  check(/\.panel-hide\{[^}]*margin-left:8px/.test(CSS),
    "…directly right of the word ROSTER, margin-left:8px rather than pushed "
    + "to the row's far end");
}

/* ------------------------------- 4l. the Save menu escapes the ribbon */

/* .rb-pane needs overflow-x:auto — the Design tab is wider than the window — and
   any non-visible overflow axis makes it a clipping container. The pane now
   states overflow-y:hidden explicitly to prevent a stray vertical scrollbar,
   but it still clips the Save As menu at the ribbon's bottom edge. The
   menu must overlap the roster panel below, which is outside the ribbon, so it
   is position:fixed and openMenu() places it. This fails silently if reverted:
   the menu still opens, still dispatches, still passes every other assertion —
   it is just sliced in half, and no suite but this one can see it. */
{
  const css = /<style>([\s\S]*?)<\/style>/.exec(MARKUP);
  const CSS = css ? css[1] : "";
  check(/\.menu\{[^}]*position:fixed/.test(CSS),
    "the Save menu is position:fixed so the ribbon's overflow cannot clip it");
  check(!/\.menu\{[^}]*position:absolute/.test(CSS),
    "the Save menu is not absolute — it would be clipped by .rb-pane's overflow");
  check(!/\.menu\{[^}]*top:calc\(100% \+ 3px\)/.test(CSS),
    "the menu's position comes from openMenu(), not from a CSS offset off its parent's height");
  check(/\.rb-pane\{[^}]*overflow-x:auto/.test(CSS),
    "the pane still scrolls horizontally — that is why the menu had to go fixed");

  const open = /function openMenu\(id\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!open, "openMenu is readable");
  if(open){
    check(/getBoundingClientRect\(\)/.test(open[0]),
      "openMenu measures its anchor rather than trusting CSS to place the menu");
    check(/style\.top\s*=/.test(open[0]) && /style\.left\s*=/.test(open[0]),
      "openMenu sets both coordinates of the fixed menu");
    const unhide = open[0].indexOf("hidden = false");
    const measure = open[0].indexOf("offsetWidth");
    check(unhide >= 0 && measure > unhide,
      "the menu is unhidden BEFORE it is measured — display:none measures as 0");
    check(/innerWidth/.test(open[0]),
      "openMenu keeps the menu inside the viewport");
    /* one at a time, and the keyboard lands inside what opened */
    check(/closeMenu\(\)/.test(open[0]),
      "opening one ribbon menu closes the other — only one may be open at a time");
    check(!/closeOfficePop/.test(open[0]),
      "and calls no closeOfficePop — no such function exists in this file");
    /* The first focusable control in reading order, whatever it is. Naming
       `button[role^="menuitem"]` first was the same answer for every menu that
       existed then and the wrong one for Accent, whose swatches are buttons in a
       dialog rather than menu items — focus would have skipped all eight and
       landed in the hex field underneath them. */
    check(/querySelector\('button:not\(\[disabled\]\),input:not\(\[disabled\]\)'\)/.test(open[0])
       && /\.focus\(\)/.test(open[0]),
      "and focus moves to the first focusable control inside what opened");
    check(!/role\^="menuitem"/.test(open[0]),
      "…without preferring a role, which would step over a dialog's own buttons");
    /* The open half of the mirror. closeMenu's "false" is asserted below; without
       this one a caret could announce itself collapsed while its menu is on
       screen, and every other assertion here would still pass. */
    check(/setAttribute\("aria-expanded", "true"\)/.test(open[0]),
      "and the toggle that owns it says so — aria-expanded is mirrored both ways");
  }

  /* Every caret in the ribbon is wired the same way, so a new split cannot be
     half-wired: it must name a menu, that menu must exist, and it must be in the
     table that dismisses it. Asserted over all of them rather than per id — this
     is what catches the fourth split nobody remembered to register. */
  {
    const table = /const RIBBON_MENUS = \[[\s\S]*?\];/.exec(SCRIPT);
    /* [^"]* so a caret that carries a modifier beside the shared class is still
       one of the two. Anchored on `class="split-toggle` rather than searching
       the attribute, because that is what says the shared class comes first and
       the modifier is an addition to it. Export is not one of them — it is a
       whole menu button, with no caret element of its own. */
    const carets = matchAll(/<button class="split-toggle[^"]*"[\s\S]*?<\/button>/g, MARKUP)
      .map(m => m[0]);
    check(carets.length === 2,
      "the ribbon has two split carets — Save and Add people — got "
        + carets.length);
    for(const c of carets){
      const id  = (/aria-controls="([\w-]+)"/.exec(c) || [])[1];
      const btn = (/id="([\w-]+)"/.exec(c) || [])[1];
      check(!!id && !!btn, "a split caret names both itself and its menu: " + c.slice(0, 60));
      if(!id || !btn) continue;
      check(new RegExp('id="' + id + '"[^>]*role="menu"').test(MARKUP),
        "#" + id + " exists and is a real menu");
      check(!/data-cmd=/.test(c),
        "#" + btn + " carries no data-cmd — a caret opens a menu and runs nothing, "
        + "or it stops meaning what the two beside it mean");
      check(/aria-haspopup="menu"/.test(c) && /aria-expanded="false"/.test(c),
        "#" + btn + " declares aria-haspopup=menu and starts collapsed");
      check(table && table[0].indexOf('menu:"#' + id + '"') >= 0
                  && table[0].indexOf('btn:"#'  + btn + '"') >= 0,
        "#" + btn + " and #" + id + " are registered in RIBBON_MENUS, so Escape, a "
        + "tab change, a resize and a click away all reach them");
    }
  }

  /* ---- all three ribbon menus go through one table ----
     Save, Export and Add people's menus are dismissed by the same code — Export's
     is opened by a whole selector-face button now rather than a caret, but the
     menu itself is wired exactly like the other two. A menu wired with its own
     copy of these paths is how one of them ends up outliving a tab change.
     Add people is the newest and therefore the likeliest to have been wired by
     hand, so it is named here rather than left to the generic checks below. */
  {
    const table = /const RIBBON_MENUS = \[[\s\S]*?\];/.exec(SCRIPT);
    check(!!table, "the ribbon menus are declared in one table");
    if(table){
      for(const id of ["#saveMenu", "#exportMenu", "#addMenu"]){
        check(table[0].indexOf('menu:"' + id + '"') >= 0, id + " is in the table");
      }
      for(const id of ["#saveMenuBtn", "#exportMenuBtn", "#addMenuBtn"]){
        check(table[0].indexOf('btn:"' + id + '"') >= 0, id + " is its toggle");
      }
      /* Export is the one of the three with an explicit anchor. Save and Add
         people fall back to openMenu()'s m.parentElement, which resolves to
         their .split wrapper — snug around face+caret+menu, so it doubles as
         the button's own footprint. Export has no wrapper — unlike Save and
         Add people, it is a single button — so the same fallback would
         resolve to .rb-file, the whole group, and the menu would open under
         Copy PNG instead of Export. Anchoring directly to the button avoids
         that, the same fix every Design selector already uses. */
      check(table[0].indexOf('anchor:"#exportMenuBtn"') >= 0,
        "#exportMenu is anchored to its own button rather than falling back to "
        + "its parent element");
    }
    const close = /function closeMenu\(refocus\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(close && /for\(const spec of RIBBON_MENUS\)/.test(close[0]),
      "closeMenu closes every menu in the table, so no dismissal path has to name one");
    check(close && /setAttribute\("aria-expanded", "false"\)/.test(close[0]),
      "and leaves aria-expanded truthful on the way out");

    /* the caret is wired from the markup's own aria-controls, not an id list */
    check(/const toggle = e\.target\.closest\("\.split-toggle"\)/.test(SCRIPT),
      "any split toggle opens its menu, not just Save's");
    check(/toggle\.getAttribute\("aria-controls"\)/.test(SCRIPT),
      "and the menu it opens comes from aria-controls, so the pairing is stated once");
    /* click-away must consider every menu, not just Save's */
    check(/if\(!e\.target\.closest\("\.menu"\)\) closeMenu\(\)/.test(SCRIPT),
      "clicking outside ANY menu dismisses it — a #saveMenu-only test would leave "
      + "the Export menu open when you clicked past it");
    check(/if\(e\.key==="Escape" && menuOpen\(\)\)\{ closeMenu\(true\)/.test(SCRIPT),
      "Escape closes whichever menu is open and returns focus to its toggle");
    const st = /function selectTab\([\s\S]*?\n\}/.exec(SCRIPT);
    check(st && /closeMenu\(\)/.test(st[0]), "a tab change dismisses whichever menu is open");
  }
  /* A fixed popup does not move with its anchor, so both ways the anchor can
     move under it have to dismiss it. */
  check(/addEventListener\("resize",\s*\(\)\s*=>\s*\{[^}]*\bcloseMenu\(\)/.test(SCRIPT),
    "resizing the window closes the menu — it would not follow the button");
  check(/addEventListener\("scroll",\s*\(\)\s*=>\s*\{[^}]*\bcloseMenu\(\)[^}]*\},\s*true\)/.test(SCRIPT),
    "scrolling closes the menu, in the capture phase because scroll does not bubble");
  /* The grade panel takes the same two events and re-anchors rather than
     dismissing — it holds half-typed text, which a menu never does. */
  check(/addEventListener\("resize",\s*\(\)\s*=>\s*\{[^}]*\bplaceGradePanel\(\)/.test(SCRIPT),
    "resizing re-anchors the grade panel to its chip");
  check(/addEventListener\("scroll",\s*\(\)\s*=>\s*\{[^}]*\bplaceGradePanel\(\)[^}]*\},\s*true\)/.test(SCRIPT),
    "scrolling re-anchors the grade panel, capture phase for the same reason");
  check(!/addEventListener\("scroll",\s*\(\)\s*=>\s*\{[^}]*\bsyncGradePanel\(\)/.test(SCRIPT),
    "…and re-anchors WITHOUT rebuilding the body: fill() on a scroll event would "
    + "take the caret out of the field being typed in");
}

/* --------------------- 4m. Add people sits inside Start on the shared grid */

/* Add people uses the same .rb-file grid as Start's other groups, so its
   buttons' heights come from one shared layout rather than a bespoke flex
   row of a .big beside a column of two natural-height buttons, which would
   put them at different heights from the identically-shaped File group one
   tab over. Reverting to a bespoke layout would still parse, render and
   dispatch — the buttons would just be the wrong size, and only a layout
   assertion can see that. */
{
  const paneAt   = MARKUP.indexOf('id="pane-file"');
  const nextPane = MARKUP.indexOf('class="rb-pane"', paneAt);
  check(paneAt > 0 && nextPane > paneAt, "the Start pane is locatable in the markup");
  const pane = MARKUP.slice(paneAt, nextPane);
  const labelAt = pane.indexOf('<div class="lbl">People</div>');
  const groupAt = pane.lastIndexOf('<div class="rb-group">', labelAt);
  const group = groupAt >= 0 && labelAt > groupAt ? pane.slice(groupAt, labelAt) : "";
  check(groupAt >= 0 && labelAt > groupAt,
    "Add people is a distinct group inside Start, captioned PEOPLE");

  check(/<div class="rb-file">/.test(group),
    "Add people is laid out by Start's shared .rb-file grid");
  check(!/rb-row/.test(group),
    "Add people carries no rb-row — it uses the shared grid, not a flex row");

  const lead = /<button class="([^"]*)"[^>]*data-cmd="addPeople"/.exec(group);
  check(!!lead, "the Add people command is a button in its group");
  check(lead && /\bbig\b/.test(lead[1]),
    "it is a .big face, the same shape Save's face is");
  check(/<div class="split rb-lead">/.test(group),
    "and it is wrapped in the split, which is the column-1 lead spanning both rows");

  /* A .big is icon-over-label, so a second label line is a sixth row of pixels
     the 66px lead does not have: "Choose<br>photos" measured 71.8px, which drove
     the whole grid past the fixed .rb-body and put a scrollbar in the ribbon.
     min-height cannot save it — content wins. Every lead label stays one line. */
  for(const m of matchAll(/<button class="[^"]*\brb-lead\b[^"]*"[\s\S]*?<\/button>/g, MARKUP)){
    check(!/<br\s*\/?>/.test(m[0]),
      "no lead button wraps its label — a second line outgrows the 66px row and "
      + "scrolls the ribbon: " + m[0].replace(/\s+/g, " ").slice(0, 70));
  }

  /* The two routes that are not a photo import were compact buttons at the far
     end of the group, where the people who most need them did not look. They are
     the split's menu now, and the group is one command wide. */
  check(matchAll(/class="[^"]*\brb-mini\b[^"]*"/g, group).length === 1,
    "the adding routes are all inside the split — the group's one compact button "
    + "is the other direction, Clear roster");
  check(!/rb-side/.test(group),
    "Add people has no third-column action — the grid's second column is its last");

  /* ---- Clear roster ----
     Cut on the verb alone, so everything else about the button — which shape it
     is, which glyph, what its face says — is asserted rather than matched on the
     way in. It is Structure's Clear grades in the other group: same compact
     button, same bin, same danger, and the icon href written out in full because
     a built one is invisible to this suite. */
  {
    const b = /<button class="([^"]*)" data-cmd="clearRoster"([\s\S]*?)<\/button>/.exec(group);
    check(!!b, "Clear roster is a button in the People group");
    if(b){
      check(/\brb-mini\b/.test(b[1]),
        "it is a compact button, so it takes half a column and the group keeps its height — got " + b[1]);
      check(/\bdanger\b/.test(b[1]),
        "…and it is marked danger, like the other whole-collection removal — got " + b[1]);
      check(/<use href="#i-delete"\/>/.test(b[2]),
        "it draws the bin, the same glyph Clear grades and Remove person draw");
      check(/Clear roster\s*$/.test(b[2]),
        "its face reads Clear roster, and that text is the last thing in the button");
      check(/title="[^"]*\bgrades\b[^"]*"/.test(b[2]),
        "…and its tooltip says the grades survive it, because the name only says what goes");
    }
    /* One element, one command: a second Clear roster in the menu would be a
       second way to empty the roster that syncStructureAvailability would still
       disable, but nothing here would notice it had been added. */
    check(matchAll(/data-cmd="clearRoster"/g, MARKUP).length === 1,
      "clearRoster is on exactly one element");
    check(!/role="menuitem" data-cmd="clearRoster"/.test(MARKUP),
      "…and it is not in the Add people menu: that menu is the ways in");
  }
  check(!/>Paste list…</.test(MARKUP),
    "the Paste list… mini button is gone from the app, not merely hidden");
  check(matchAll(/data-cmd="pasteList"/g, MARKUP).length === 1,
    "and pasteList is on exactly one element — the menu item");
  /* importCsv sits beside it in the same menu, and is likewise the only door
     to a .csv file: the command opens #csvPick, nothing else dispatches it. */
  check(matchAll(/data-cmd="importCsv"/g, MARKUP).length === 1,
    "and importCsv is on exactly one element — the menu item beside it");
  /* The dialog absorbed it. Both halves: no button dispatches it and no command
     is left behind it, so §2c's dead-code check has nothing to forgive. */
  check(!/addBlank/.test(MARKUP),
    "Add without photo is gone from the app entirely — markup, command and all");
  check(!/choosePhotos/.test(MARKUP),
    "and so is choosePhotos: the face opens the dialog, whose Photo field is the "
    + "picker now, and #drop keeps its own handler");

  /* ---- the split itself ----
     Built from the parts Save is built from, and asserted the same way it is.
     A hand-rolled copy of this markup would render identically and drift the
     moment .split-toggle is touched, so check the shared class by name rather
     than checking that something caret-shaped is present. */
  {
    const sp = /<div class="split rb-lead">[\s\S]*?<\/div>\s*<\/div>/.exec(group);
    check(!!sp, "Add people is a split button");
    if(sp){
      /* two focusable buttons, and they say different things — a caret that
         repeated the face's name would be one control announced twice */
      const buttons = matchAll(/<button\b[\s\S]*?<\/button>/g, sp[0]).map(m => m[0]);
      const inSplit = buttons.filter(b => !/role="menuitem"/.test(b));
      check(inSplit.length === 2,
        "the split is exactly two buttons, face and caret — got " + inSplit.length);
      check(!inSplit.some(b => /\btabindex="-1"/.test(b) || /\bdisabled\b/.test(b)),
        "both halves are in the tab order — the caret is the only way to the menu");
      check(/data-cmd="addPeople"[\s\S]*?<span>Add people<\/span>/.test(sp[0]),
        "the face reads Add people and opens the dialog");
      check(/id="addMenuBtn"[\s\S]*?title="Other ways to add people"/.test(sp[0]),
        "the caret has an accessible name of its own, distinct from the face's");
      check(!/id="addMenuBtn"[\s\S]*?data-cmd=/.test(sp[0].slice(sp[0].indexOf('id="addMenuBtn"'),
                                                                sp[0].indexOf('id="addMenu"'))),
        "the caret carries NO data-cmd — it opens a menu, like the two beside it, "
        + "and a command on it would make this caret mean something else");
      /* the face's artwork */
      check(/data-cmd="addPeople"[\s\S]{0,200}<use href="#i-group-add"\/>/.test(sp[0]),
        "the face carries the group_add artwork (#i-group-add)");
      /* the caret's wiring, asserted exactly as Save's is */
      check(/id="addMenuBtn"[\s\S]*?aria-haspopup="menu"/.test(sp[0]),
        "the toggle declares aria-haspopup=menu");
      check(/aria-controls="addMenu"/.test(sp[0]) && /id="addMenu"[^>]*role="menu"/.test(sp[0]),
        "and controls the menu it names");
      check(/id="addMenuBtn"[\s\S]*?aria-expanded="false"/.test(sp[0]),
        "and starts collapsed, so aria-expanded has something to mirror");
      check(/class="split-toggle rb-primary-toggle" id="addMenuBtn"/.test(sp[0]),
        "the caret IS a .split-toggle — the same control as Save's, "
        + "so the two cannot drift apart — with the fill added as a modifier "
        + "beside it, never as a change to the shared class");
      check(/<use href="#i-caret"\/>/.test(sp[0]),
        "and it draws the shared #i-caret, not artwork of its own");
      /* the menu */
      const items = matchAll(/role="menuitem" data-cmd="([A-Za-z]+)"/g, sp[0]).map(m => m[1]);
      check(items.join(",") === "pasteList,importCsv",
        "the menu holds the two ways in beside a person at a time, Add list… "
        + "then Import CSV… — got " + items.join(","));
      check(/data-cmd="pasteList"><svg class="ic"><use href="#i-paste"\/>/.test(sp[0]),
        "pasteList reuses the existing #i-paste artwork");
      check(/>Add list…</.test(sp[0]), "and it is labelled");
      check(/data-cmd="importCsv"><svg class="ic"><use href="#i-csv"\/>/.test(sp[0]),
        "importCsv reuses the existing #i-csv artwork, added for Export CSV");
      check(/>Import CSV…</.test(sp[0]), "and it is labelled");
    }
  }

  /* ---- Import CSV's own plumbing ----
     The menu item's data-cmd was asserted above; this is the file input, the
     bound handler and the command behind it. */
  {
    check(/<input type="file" id="csvPick" accept="\.csv,text\/csv" hidden>/.test(MARKUP),
      "csvPick is a hidden file input scoped to .csv files, beside jsonPick's own");
    const handler = /\$\("#csvPick"\)\.addEventListener\("change"[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(!!handler, "the CSV-import handler is readable");
    if(handler){
      check(/LIMITS\.pasteChars/.test(handler[0]),
        "an oversized file is refused against the same limit the paste textarea itself enforces");
      check(/openPasteModal\(\)/.test(handler[0]) && /showPastePreview\(\)/.test(handler[0]),
        "a picked file opens the paste dialog and previews it, rather than a dialog of its own");
      /* openPasteModal() clears #pasteArea as part of opening on a blank
         slate. Filling the textarea AFTER that call, not before, is what
         keeps the imported text on screen instead of being wiped by it. */
      check(handler[0].indexOf("openPasteModal()") >= 0
         && handler[0].indexOf("openPasteModal()") < handler[0].indexOf('$("#pasteArea").value = text'),
        "the textarea is filled AFTER the modal opens, or openPasteModal's own reset erases it");
    }
    check(/importCsv:\s*\(\)=>\$\("#csvPick"\)\.click\(\)/.test(SCRIPT),
      "COMMANDS.importCsv opens the file picker, the same way open opens #jsonPick");
  }

  /* The fill. .big stays the ghost every other big button is; the modifier is
     what makes this one read as the action a new roster starts with. Written at
     button.big.rb-primary so it outranks button:hover on the border as well as
     the background — overriding only one leaves a grey rim on hover. */
  {
    const css = /<style>([\s\S]*?)<\/style>/.exec(MARKUP);
    const CSS = css ? css[1] : "";
    /* off the face's own class attribute, not off the group: the markup comment
       beside it names the modifier too, and a search of the whole group passes
       on the comment alone — which is what the mutation test caught */
    check(lead && /\brb-primary\b/.test(lead[1]),
      "the face carries the fill modifier");
    check(/button\.big\.rb-primary\{[^}]*background:var\(--brand\)/.test(CSS)
       && /button\.big\.rb-primary\{[^}]*color:#fff/.test(CSS),
      "the modifier fills with --brand and writes on it in white");
    check(/button\.big\.rb-primary:hover\{[^}]*background:var\(--brand-dark\)/.test(CSS)
       && /button\.big\.rb-primary:hover\{[^}]*border-color:var\(--brand-dark\)/.test(CSS),
      "and its hover restates BOTH colours, so button:hover's grey border cannot "
      + "outrank it and draw a rim around the fill");
    check(!/\brb-primary\b[^{]*\{[^}]*var\(--accent\)/.test(CSS)
       && !/button\.big\.rb-primary[^{]*\{[^}]*accent/.test(CSS),
      "the fill is app chrome and never follows state.accent — the chart's colour "
      + "is the user's and can be one that makes white text unreadable");
    check(!/^\s*button\.big\{[^}]*background:var\(--brand\)/m.test(CSS),
      ".big itself is untouched — every other big button is still a ghost");

    /* ---- and the caret half is filled with it ----
       Without a caret-specific modifier the fill would stop at the face,
       leaving a white 20px tab bolted to the side of a blue button. Same
       modifier discipline as .rb-primary: the
       shared .split-toggle may not move, because Save's caret is the same
       control and the comment above the Structure caret says the two cannot
       drift apart. So the fill is something only this caret opts into.

       Every assertion here is written against the modifier's OWN rule, not
       against .split-toggle — a fix applied to the shared class would pass a
       check that merely looked for --brand somewhere near a caret, and would
       repaint Save at the same time. */
    check(/button\.split-toggle\.rb-primary-toggle\{[^}]*background:var\(--brand\)/.test(CSS)
       && /button\.split-toggle\.rb-primary-toggle\{[^}]*border-color:var\(--brand\)/.test(CSS),
      "the caret half takes the same --brand fill the face does, so the split reads "
      + "as one control rather than a blue button with a white tab");
    /* The glyph is currentColor. The sheet's button colour is --ink-2, a dark
       slate that on --brand is not a contrast anyone can read. */
    /* [;{]\s* before `color:` — without it `border-left-color:#fff` satisfies a
       bare /color:#fff/ and the glyph check passes with no glyph rule at all.
       It did; the mutation caught it. */
    check(/button\.split-toggle\.rb-primary-toggle\{[^}]*[;{]\s*color:#fff/.test(CSS),
      "and its caret glyph is white, matching the face's own content — currentColor "
      + "would otherwise leave --ink-2 on the fill");
    /* The face gives up its right border to this one, so it is the seam. */
    check(/\.split > \.big\{[^}]*border-right:none/.test(CSS),
      "the face still has no right border — the caret's left border is the seam");
    check(/button\.split-toggle\.rb-primary-toggle\{[^}]*border-left-color:#fff/.test(CSS),
      "which is white here: a hairline is what still shows where the menu begins "
      + "once both halves are filled");
    /* Open state. .split-toggle's own is var(--line-2), a near-white that would
       punch a hole in the blue, so the modifier has to answer for it too. */
    {
      const open = /button\.split-toggle\.rb-primary-toggle(?:[^{]*)\[aria-expanded="true"\]\{[^}]*\}/
        .exec(CSS) || /button\.split-toggle\.rb-primary-toggle:hover,\s*button\.split-toggle\.rb-primary-toggle\[aria-expanded="true"\]\{[^}]*\}/
        .exec(CSS);
      check(!!open,
        "the modifier states its own aria-expanded fill — .split-toggle's var(--line-2) "
        + "is a near-white and would punch a hole in the blue when the menu opens");
      check(open && /background:var\(--brand-dark\)/.test(open[0]),
        "…and that fill is a darkening of the brand, the same move the face makes on hover");
      check(open && /border-left-color:#fff/.test(open[0]),
        "…with the white seam kept, so the divider does not vanish while the menu is open");
      check(!/button\.split-toggle\.rb-primary-toggle[^{]*\{[^}]*[;{]\s*color:var\(--ink-2\)/.test(CSS),
        "and nothing puts --ink-2 back on the glyph in either state");
    }

    /* The other caret, in both states. Asserted as what it still is rather
       than as the absence of the modifier: a rule added to .split-toggle
       itself would leave the modifier untouched and pass that. Export is not
       among these — it has no caret element at all. */
    check(/\.split-toggle\{[^}]*background:#fff/.test(CSS),
      "Save's caret is still white — .split-toggle itself is untouched");
    check(!/\.split-toggle\{[^}]*[;{]\s*color:#fff/.test(CSS)
       && !/\.split-toggle\{[^}]*background:var\(--brand\)/.test(CSS),
      "the shared class carries neither the fill nor the white glyph — the two "
      + "carets are one control and only this one opted in");
    check(/\.split-toggle\[aria-expanded="true"\]\{background:var\(--line-2\)\}/.test(CSS),
      "and its open state is still the neutral one, on white");
    /* the glyph it draws with is the sheet's button colour, inherited */
    check(/\bbutton, \.g-chip-face\{[^}]*color:var\(--ink-2\)/.test(CSS),
      "which it writes in --ink-2, inherited from button — legible on white, which "
      + "is exactly why the filled one had to override it");
    check(!new RegExp('class="[^"]*rb-primary-toggle[^"]*"[^>]*id="saveMenuBtn"').test(MARKUP),
      "#saveMenuBtn does not carry the fill modifier");
    /* Export is not a split at all, so this is not "does it carry the fill
       modifier" (trivially true of anything that isn't a caret) but the
       structural claim this section depends on. */
    {
      const expBtnTag = /<button class="([^"]*)"[^>]*id="exportMenuBtn"/.exec(MARKUP);
      check(!!expBtnTag, "#exportMenuBtn's own opening tag is found");
      check(expBtnTag && !/\bsplit-toggle\b/.test(expBtnTag[1]),
        "#exportMenuBtn is not a split-toggle caret — it is the whole menu button");
    }
    /* class attributes only: the sheet declares it and the markup comment beside
       the split names it, and neither is an element wearing it */
    check(matchAll(/class="[^"]*\brb-primary-toggle\b[^"]*"/g, MARKUP).length === 1,
      "the modifier is on exactly one element in the document — Add people's caret");
    /* Structure's chips build their caret in the script, from the shared class
       alone. It must not have picked the fill up on the way. */
    check(!/g-chip-toggle[^"]*rb-primary-toggle|rb-primary-toggle[^"]*g-chip-toggle/.test(SCRIPT),
      "and the grade chips' carets did not acquire it — they are the neutral control");
  }

  /* .rb-stack is gone from the document, not merely unused here: a stale rule
     left behind is a standing invitation to reach for a flex-row layout in
     another pane instead of the shared grid. */
  check(!/rb-stack/.test(MARKUP),
    "the .rb-stack layout is gone from the app entirely, markup and stylesheet");

  /* The two placeholder squares these buttons carried were indistinguishable
     from each other on screen. Both are real Material Symbols now; NOTICE and
     the sprites/ source files name them, so the ids have to keep matching what
     is written down there. */
  check(/<use href="#i-paste"\/>/.test(group),
    "Add list… carries its own icon (list_alt_add)");
  /* no_photography went with the button it was drawn for. An unreferenced
     symbol is not free — it is third-party artwork NOTICE's count and the
     sprite's own provenance check both have to keep accounting for — so the
     symbol and its NOTICE count move together or §2b fails. */
  check(!/id="i-nophoto"/.test(MARKUP) && !/#i-nophoto/.test(MARKUP),
    "the no_photography symbol is gone with its last call site, symbol and reference together");
  check(!/id="i-addperson"/.test(MARKUP) && !/#i-addperson/.test(MARKUP),
    "the i-addperson placeholder is gone, symbol and reference together");
  const square = 'd="M240-240v-480h480v480H240Zm66.67-66.67h346.66v-346.66H306.67v346.66Z"';
  for(const id of ["i-paste", "i-group-add"]){
    const sym = new RegExp('<symbol id="' + id + '"[^>]*>([\\s\\S]*?)</symbol>').exec(MARKUP);
    check(!!sym, id + " is defined in the sprite");
    check(sym && sym[1].indexOf(square) < 0,
      id + " is real artwork — its path data is not the plain placeholder square");
    check(sym && !/\bfill=/.test(sym[1]),
      id + " has the source fill stripped, so it inherits its button's colour");
  }
}

/* --------------------- 4m2. the Add people dialog

   The dialog asks for all four fields — photo, name, grade, group — where
   they are used, so adding a person who has no photo yet is not a special
   case reached through a menu. What has to stay true: it is built out of the
   modal parts every other dialog here uses, it asks in the order the spec
   fixed, and it owns no second copy of the photo validation. */
{
  const at = MARKUP.indexOf('id="addModal"');
  check(at > 0, "the Add people dialog is in the markup");
  /* Cut at the next dialog of any name, not at #pasteModal by name: this read
     to #pasteModal until #editModal was inserted between the two, and the slice
     then quietly contained two dialogs — which turned "there is exactly one
     close X here" into a failure naming the wrong dialog and would have let
     anything in the Edit dialog answer an assertion about this one. */
  const nextAt = MARKUP.indexOf('class="modal-backdrop"', at);
  const dlg = at > 0 ? MARKUP.slice(at, nextAt > at ? nextAt : MARKUP.length) : "";
  check(dlg.indexOf('id="editModal"') < 0 && dlg.indexOf('id="pasteModal"') < 0,
    "…and the slice holds this dialog alone, not the ones after it");

  /* built like the others, not like itself */
  check(/class="modal-backdrop" id="addModal" hidden/.test(MARKUP),
    "it is a .modal-backdrop and starts hidden, like every other dialog");
  check(/role="dialog"/.test(dlg) && /aria-modal="true"/.test(dlg),
    "it is a modal dialog");
  check(/aria-labelledby="addTitle"/.test(dlg) && /id="addTitle"/.test(dlg),
    "it is named by its own heading");
  check(/class="btnrow modal-foot"/.test(dlg),
    "its actions use the shared .btnrow.modal-foot alignment, not a private one");
  check(/trapTab\("#addModal"\)/.test(SCRIPT),
    "Tab is trapped inside it, like the other three");
  check(/if\(e\.key==="Escape" && !\$\("#addModal"\)\.hidden\)\{ closeAddModal\(\)/.test(SCRIPT),
    "and Escape closes it");

  /* the four fields, in the order the spec fixed. Order is asserted by
     position, not by presence: a dialog that asks for the group first is a
     different dialog. */
  const order = ["addPhoto", "addName", "addTier", "addGroup"]
    .map(id => dlg.indexOf('id="' + id + '"'));
  check(order.every(i => i >= 0), "it has all four fields");
  check(order[0] < order[1] && order[1] < order[2] && order[2] < order[3],
    "and asks Photo, Name, Grade, Group in that order");
  /* off the whole tag rather than forwards from the id: attribute order in the
     markup is not something this assertion has any business pinning */
  const photoTag = /<input[^>]*id="addPhoto"[^>]*>/.exec(dlg);
  check(photoTag && /type="file"/.test(photoTag[0])
     && /accept="image\/jpeg,image\/png/.test(photoTag[0]),
    "Photo is a file input accepting only JPEG and PNG");
  /* The picker itself is off screen now — the placeholder circle and Add
     photo open it instead — but it still has to be the real control the
     picker's change handler binds to, or choosing a file would silently do
     nothing. Hidden, not merely invisible: an id="addPhoto" without the
     attribute here would be the input still asking to be filled in by hand. */
  check(photoTag && /\bhidden\b/.test(photoTag[0]),
    "…and it is hidden, like csvPick and the other file pickers this app opens by proxy");
  check(/\$\("#addPhoto"\)\.addEventListener\("change",/.test(SCRIPT),
    "…and still has the change handler that decodes whatever it is given");
  check(/<select id="addTier">/.test(dlg), "Grade is a select");
  check(/fillTierOptions\(\$\("#addTier"\)/.test(SCRIPT),
    "…filled by the same helper the roster row's grade select uses, so the two "
    + "lists cannot disagree");
  check(!/id="addName"[^>]*required/.test(dlg) && !/id="addGroup"[^>]*required/.test(dlg),
    "Name and Group are optional — nothing here is marked required");

  /* Three exits, and each one says what it does to the dialog: Add & continue
     keeps it open, Add & close finishes and closes, Close leaves without
     adding anyone. The ids do not spell out the labels — both are named from
     more than one place, and renaming a hook to match a label is how the two
     drift apart — so the labels are asserted here whole, against the ids. */
  check(/<button id="addAddBtn">Add &amp; continue<\/button>/.test(dlg),
    "Add & continue is the repeat route, and stays plain — it is the power path");
  check(/<button class="primary" id="addAddCloseBtn">Add &amp; close<\/button>/.test(dlg),
    "Add & close is the primary CTA — closing after one person is the common case");
  check(/<button id="addDoneBtn">Close<\/button>/.test(dlg),
    "and Close is the way out that adds nobody");
  check(!/>Add<\/button>/.test(dlg) && !/>Done<\/button>/.test(dlg),
    "no ambiguous bare Add or Done label appears in the dialog — every exit names what it does");
  {
    const order = ["addAddBtn", "addAddCloseBtn", "addDoneBtn"].map(id => dlg.indexOf('id="' + id + '"'));
    check(order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2],
      "in that order: the two adding routes together, then the one that does not add");
  }
  check(/\$\("#addAddBtn"\)\.addEventListener\("click", addOnePerson\)/.test(SCRIPT),
    "Add & continue runs addOnePerson");
  check(/\$\("#addDoneBtn"\)\.addEventListener\("click", closeAddModal\)/.test(SCRIPT),
    "Close runs closeAddModal and nothing else");
  /* The whole reason addOnePerson returns a value. Five of its paths refuse and
     leave an alert on screen saying which one; closing regardless would dismiss
     the explanation with the dialog and leave a roster that silently did not
     grow. The awaited call is the load-bearing half — addOnePerson is async, so
     an unawaited one is a pending promise and always truthy. test/document.js
     drives the return value itself; this guards the wiring. */
  {
    const ac = /\$\("#addAddCloseBtn"\)\.addEventListener\("click",[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(!!ac, "the Add & close handler is readable");
    check(ac && /if\(await addOnePerson\(\)\) closeAddModal\(\);/.test(ac[0]),
      "Add & close closes only if the add succeeded — and awaits the answer, "
      + "because an unawaited async call is a truthy promise");
  }

  /* it stays open: nothing in the add path closes it */
  const add = /async function addOnePerson\(\)[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!add, "addOnePerson is readable");
  if(add){
    check(!/closeAddModal\(\)/.test(add[0]) && !/modalClose\(/.test(add[0]),
      "adding a person does NOT close the dialog — that is the whole point of it");
    check(/\$\("#addName"\)\.value = ""/.test(add[0])
       && /setAddPhoto\(null\)/.test(add[0]),
      "…it clears Photo and Name for the next person — the photo through its one "
      + "owner, because the well now outlives a single Add");
    check(/\$\("#addGroup"\)\.value = ""/.test(add[0]),
      "…and clears Group too — it described the person just added, not the next one");
    check(/\$\("#addName"\)\.focus\(\)/.test(add[0]),
      "…and puts the caret back where the next person starts");
    /* ONE commit, so one added person is one history entry */
    check(matchAll(/\bcommit\(/g, add[0]).length === 1,
      "exactly one commit() — one added person is one undo step");
    check(!/\bedit\(/.test(add[0]),
      "and no edit() session, so typing in the fields writes no history at all");
    /* The decode happens at the picker, so what has to stay true here is the
       negative: addOnePerson reads no file and opens no decoder of its own —
       it only consumes what the picker left in the well. */
    check(!/processImage\(/.test(add[0]) && !/\.files\b/.test(add[0]),
      "addOnePerson reads no file and decodes nothing — that happens when "
      + "the photo is chosen, so a refusal lands next to the choice");
    check(!/new Image\(/.test(add[0]) && !/photoHeader\(/.test(add[0])
       && !/FileReader\(/.test(add[0]),
      "and addOnePerson opens no second validation path of its own");
    check(/photoBudgetExceeded\(state,/.test(add[0]),
      "it applies the same aggregate photo budget the drop path applies — still "
      + "here, because the budget is measured against a roster the picker cannot see");
    check(/staleWrite\(addPending\.gen/.test(add[0])
       && add[0].indexOf("staleWrite(addPending.gen") < add[0].indexOf("commit("),
      "and checks the document has not moved on BEFORE committing, against the "
      + "generation the PICKER captured — the dialog can sit open across a New");
    /* A class check over every exit rather than a list of the known ones: "did
       anybody get added" is the question Add & close asks, so a refusal added
       later that returned nothing would read as success and close the dialog
       over its own alert. Asserted as "no bare return", which is what makes the
       next one impossible to write by accident. */
    const exits = matchAll(/\breturn\b([^;]*);/g, add[0]).map(m => m[1].trim());
    check(exits.length === 6,
      "addOnePerson leaves through six returns — five refusals and one "
      + "success. A decode failure is refused at the picker, before the "
      + "photo reaches this function, so it adds no seventh return here; "
      + "got " + exits.length);
    check(exits.filter(v => v === "false").length === 5,
      "five of them are false — every one of the paths that adds nobody; got "
        + JSON.stringify(exits));
    check(exits.filter(v => v === "true").length === 1,
      "and exactly one is true");
    check(exits.every(v => v === "true" || v === "false"),
      "with no bare return left to read as a refusal that did add somebody — got "
        + JSON.stringify(exits));
    check(add[0].lastIndexOf("return true") > add[0].indexOf("commit("),
      "the true is after the commit, so nothing can report success without one");
  }

  /* ---- the photo well ----------------------------------------------------

     addPending, #addPhoto and the preview are three views of one thing, and the
     dialog stays open across an Add — so a write that skips setAddPhoto is
     either a photo the dialog shows and will not add, or one it adds and does
     not show. test/document.js drives what the well DOES; this is the static
     half: that the markup exists and that nothing else touches the three.

     Asserted as "no other site", not as a list of the callers: the callers are
     the sites that exist today, and the rule has to catch the one nobody has
     written yet.

     #addPhotoWell is filled from script now, exactly like #editPhoto: with a
     photo chosen it holds the SAME framing editor Edit's dialog shows, built
     by the one shared framePanel — never a second, Add-only copy of it. */
  check(/<div id="addPhotoWell" hidden><\/div>/.test(dlg),
    "the dialog has a photo well, hidden until a photo is in it, and empty "
    + "until then — its content is built, not static markup");
  {
    /* framePanel({ appears at exactly two call sites — Edit's editPhotoBody
       and Add's setAddPhoto — never a third, Add-only builder that could
       drift from the one Edit's dialog already uses. Matched on the open
       brace of its object argument so the function's own declaration line
       (framePanel(subj){) cannot satisfy the count. */
    const calls = matchAll(/framePanel\(\{/g, SCRIPT);
    check(calls.length === 2,
      "framePanel({ is called from exactly two places — got " + calls.length);
  }
  {
    const well = MARKUP.indexOf('id="addPhotoWell"');
    const photo = MARKUP.indexOf('id="addPhoto"');
    const name  = MARKUP.indexOf('id="addName"');
    check(photo > 0 && well > photo && name > well,
      "the well sits between the picker it previews and the Name field, so the "
      + "photo question is answered in one place");
  }
  {
    const own = /function setAddPhoto\(pending\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!own, "setAddPhoto is readable");
    check(own && /addPending = /.test(own[0]) && /\$\("#addPhoto"\)\.value = ""/.test(own[0])
       && /framePanel\(\{/.test(own[0]),
      "…and it is the one place that writes all three of addPending, the file "
      + "input's value and the preview — the preview built through the shared "
      + "framePanel builder, not a hand-written <img>");
    /* Everything outside setAddPhoto, so the check cannot be satisfied by
       setAddPhoto's own writes. */
    const rest = own ? SCRIPT.split(own[0]).join("") : SCRIPT;
    check(!/addPending\s*=/.test(rest.replace(/let addPending = null;/, "")),
      "nothing outside setAddPhoto assigns addPending — a hand-written "
      + "assignment is a well that disagrees with what is on screen");
    check(!/\$\("#addPhoto"\)\.value/.test(rest),
      "…and nothing outside it clears the file input, which is what makes a "
      + "removed photo re-choosable");
    check(!/"#addPhotoWell"/.test(rest),
      "…and nothing outside it reaches #addPhotoWell at all — the well has "
      + "exactly one owner");
    /* The one owner has to be reachable from the four moments the well can
       change, or it is a rule with no call sites. */
    const open = /function openAddModal\(\w*\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(open && /setAddPhoto\(null\)/.test(open[0]),
      "openAddModal empties the well");
    check(/function closeAddModal\(\)\{ setAddPhoto\(null\); modalClose\("#addModal"\); \}/.test(SCRIPT),
      "…and so does closeAddModal, or a dialog reopened after a close would "
      + "still hold a photo the user decided against");
    /* Remove photo is not a dedicated #addPhotoRemove button — it is the
       Add framing editor's own [data-fact="remove"] branch, on #addModal's
       click listener, and it goes through the one owner, setAddPhoto. */
    const addClick = /\$\("#addModal"\)\.addEventListener\("click", e=>\{[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(!!addClick, "the Add dialog's framing click listener is readable");
    check(addClick && /if\(act==="remove"\)\{[\s\S]{0,80}?setAddPhoto\(null\)/.test(addClick[0]),
      "…and Remove photo, with no commit(), because the person it would have "
      + "belonged to does not exist yet");
  }

  /* ---- the Add framing editor's negative space, proven statically ---------

     document.js proves BEHAVIOURALLY that a zoom, a pan step and a reset in
     the Add dialog leave history and the dirty flag untouched. This is the
     other half — that the handler bodies cannot do otherwise, because the
     four functions that could (edit, commit, endEdit, snapshot) are simply
     absent from their text. Scoped to exactly these five bodies, so Edit's
     own legitimate edit()/commit() calls elsewhere in the file cannot mask a
     violation here the way a whole-script scan would. */
  {
    const addKeys = matchAll(/\$\("#addModal"\)\.addEventListener\("keydown", e=>\{[\s\S]*?\n\}\);/g, SCRIPT);
    check(addKeys.length === 2,
      "#addModal carries two keydown listeners — Enter-submit, then the "
      + "framing editor's own pan — got " + addKeys.length);
    const bodies = [
      ["click",        (/\$\("#addModal"\)\.addEventListener\("click", e=>\{[\s\S]*?\n\}\);/.exec(SCRIPT) || [])[0]],
      ["input",        (/\$\("#addModal"\)\.addEventListener\("input", e=>\{[\s\S]*?\n\}\);/.exec(SCRIPT) || [])[0]],
      ["pan keydown",  addKeys[1] && addKeys[1][0]],
      ["pointerdown",  (/\$\("#addModal"\)\.addEventListener\("pointerdown", e=>\{[\s\S]*?\n\}\);/.exec(SCRIPT) || [])[0]],
      ["pointermove",  (/\$\("#addModal"\)\.addEventListener\("pointermove", e=>\{[\s\S]*?\n\}\);/.exec(SCRIPT) || [])[0]],
      ["pointerup/pointercancel",
        (/\["pointerup","pointercancel"\]\.forEach\(ev=>\$\("#addModal"\)\.addEventListener\(ev, \(\)=>\{[\s\S]*?\n\}\)\);/.exec(SCRIPT) || [])[0]]
    ];
    for(const [ev, body] of bodies){
      check(!!body, "the Add framing " + ev + " handler is readable");
      if(!body) continue;
      check(!/\bedit\(/.test(body),
        "the Add framing " + ev + " handler calls no edit() — the person this "
        + "photo will belong to does not exist yet, so nothing here may open "
        + "or join a history session");
      check(!/\bcommit\(/.test(body),
        "…nor commit() — no write here may create an undo step");
      check(!/\bendEdit\(/.test(body),
        "…nor endEdit() — there is no edit() session for it to close");
      check(!/\bsnapshot\(/.test(body),
        "…nor snapshot(), the lower-level call both of the above are built on");
    }
  }

  /* ---- one shared framing panel, one shared clamp, Edit's own lookups
     untouched ---------------------------------------------------------- */
  {
    /* No second .frame-ed template anywhere outside framePanel itself — the
       whole point of generalizing it was that the structure exists ONCE. */
    const frameEdSites = matchAll(/el\("div", \{cls:"frame-ed"\}/g, SCRIPT);
    check(frameEdSites.length === 1,
      'el("div", {cls:"frame-ed"} is built in exactly one place — got '
      + frameEdSites.length);
  }
  {
    /* addFrameShim is the one thing standing in for a person object before
       one exists, and it is read by clampFrame — not by a second, hand-rolled
       min/max pair. Grabbed by name rather than assumed at a fixed spot, so a
       reordering of the file cannot make this pass by accident. */
    const shim = /function addFrameShim\(\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!shim, "addFrameShim is readable");
    check(shim && /pw:\s*addPending\.result\.w,\s*ph:\s*addPending\.result\.h,\s*frame:\s*addPending\.frame/.test(shim[0]),
      "…and it returns the {pw, ph, frame} shape clampFrame reads — nothing "
      + "more, nothing recomputed");
    const shimCalls = matchAll(/clampFrame\(addFrameShim\(\)\)/g, SCRIPT);
    check(shimCalls.length === 3,
      "clampFrame(addFrameShim()) is called from all three Add framing sites "
      + "that clamp — zoom, keydown pan, pointer pan — got " + shimCalls.length);
    /* Negative scan: the zoom-clamp signature every legitimate clamp site
       shares (Math.max(1, Math.min(ZOOM_MAX, …)) is frameRect's, frameLimit's
       and clampFrame's own opening move. Strip those three bodies out and the
       signature must not appear anywhere else — which is what rules out a
       fourth, Add-only reimplementation of the same maths hiding beside the
       shim instead of going through it. */
    const frameRectFn  = /function frameRect\([\s\S]*?\n\}/.exec(SCRIPT);
    const frameLimitFn = /function frameLimit\([\s\S]*?\n\}/.exec(SCRIPT);
    const clampFrameFn = /function clampFrame\([\s\S]*?\n\}/.exec(SCRIPT);
    check(!!frameRectFn && !!frameLimitFn && !!clampFrameFn,
      "frameRect, frameLimit and clampFrame — the three canonical clamp sites — are readable");
    let rest = SCRIPT;
    for(const fn of [frameRectFn, frameLimitFn, clampFrameFn]) if(fn) rest = rest.split(fn[0]).join("");
    check(!/Math\.max\(1,\s*Math\.min\(ZOOM_MAX/.test(rest),
      "no fourth site outside frameRect/frameLimit/clampFrame reimplements "
      + "their zoom-clamp expression — the Add framing editor goes through "
      + "clampFrame(addFrameShim()) instead");
  }
  {
    /* Edit's own preview lookups — untouched by any of this, byte for byte,
       per this batch's explicit premise. */
    check(/const wrap = \$\('\.fp-circle\[data-id="'\+p\.id\+'"\]'\);/.test(SCRIPT),
      "syncFramePreview still finds the circle by '.fp-circle[data-id=\"'+p.id+'\"]' — unchanged");
    check(/const lab = \$\('b\[data-fz="'\+p\.id\+'"\]'\);/.test(SCRIPT),
      "…and the zoom label by 'b[data-fz=\"'+p.id+'\"]' — unchanged");
  }

  {
    /* The decode happens at the choice, not at Add — the two failure paths
       are the ones that can leave the input naming a file the dialog
       refused. addPhotoIntoDialog is the shared function so the drop route
       (test/dom.js §… "drops") can hand it a file too; this block reads
       that shared function's OWN body, and the picker's listener is checked
       separately just below for calling it. */
    const pick = /async function addPhotoIntoDialog\(file\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!pick, "addPhotoIntoDialog is readable");
    if(pick){
      check(/processImage\(/.test(pick[0]),
        "choosing (or dropping) a photo decodes it there and then, through the "
        + "drop path's own decoder — not at Add, one step after the choice that caused it");
      check(/const gen = docGen/.test(pick[0]) && !/staleWrite\(/.test(pick[0]),
        "…capturing the generation before the decode, and leaving the verdict "
        + "to Add, which is where the write happens");
      check(/importBusy = true/.test(pick[0]) && /finally\{ importBusy = false; \}/.test(pick[0]),
        "…taking importBusy across the decode and releasing it on both paths");
      check(/alertMsg\("That photo was not used — "/.test(pick[0]),
        "a refused file says the PHOTO was not used — nobody was being added "
        + "yet, so it must not borrow addOnePerson's wording");
      check(!/Nobody was added/.test(pick[0]),
        "…and does not say nobody was added, which is a different outcome");
      /* One exit, and it is the owner. A branch that returned early would be a
         path that leaves the input holding a file the well does not have. */
      check(matchAll(/setAddPhoto\(/g, pick[0]).length === 1 && /setAddPhoto\(pending\)/.test(pick[0]),
        "and every path through it — no file, busy, refused, decoded — ends at the one owner");
    }
    /* And the picker's own listener does none of that itself — it hands the
       chosen file straight to the shared function. */
    const pickListener = /\$\("#addPhoto"\)\.addEventListener\("change", async e=>\{[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(!!pickListener, "the picker has a change listener");
    check(pickListener && /await addPhotoIntoDialog\(file\)/.test(pickListener[0]),
      "…which calls addPhotoIntoDialog rather than repeating its body");
    check(pickListener && !/processImage\(/.test(pickListener[0]),
      "…and decodes nothing itself");
  }

  /* ---- step B: the picker is hidden, and the two states of the centred
     section above it are opened by a placeholder circle and a static button.
     setAddPhoto still owns which of the two is on screen — #addPhotoEmpty is
     the mirror of #addPhotoWell it already toggled. */
  {
    const own = /function setAddPhoto\(pending\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(own && /const empty = \$\("#addPhotoEmpty"\)/.test(own[0])
       && /empty\.hidden = false/.test(own[0]) && /empty\.hidden = true/.test(own[0]),
      "setAddPhoto shows the placeholder section when there is no pending "
      + "photo and hides it again once there is one");
  }
  {
    /* Live initials: initials() is read off the Name field's live value, and a
       script assignment to .value fires no input event — so every hand-written
       assignment needs its own call, and typing needs the field's own
       listener. A class check over the assignment SITES rather than a list of
       today's two, so a third write later cannot forget the circle. */
    const sync = /function syncAddPhotoInitials\(\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!sync, "syncAddPhotoInitials is readable");
    check(sync && /\$\("#addPhotoPick"\)\.textContent = initials\(\$\("#addName"\)\.value\)/.test(sync[0]),
      "…and it writes the placeholder circle from initials() read off the live "
      + "Name field");
    check(/\$\("#addName"\)\.addEventListener\("input", syncAddPhotoInitials\)/.test(SCRIPT),
      "…and typing in Name keeps it current through the field's own input listener");
    /* Broadened from "= \"\"" (only the two clears) to any assignment, so the
       picker's own fill-from-filename — a WRITE, not a clear — is caught by
       the same class rather than needing a parallel, easily-forgotten check
       of its own. That is exactly how the empty-section CSS rule went missing
       for two steps: one path got its own bespoke check and the next path
       that needed the same treatment had nothing pointing at it. */
    const assigns = matchAll(/\$\("#addName"\)\.value = [^;]+;/g, SCRIPT);
    check(assigns.length === 3,
      "…three programmatic sites write Name today — openAddModal and the tail "
      + "of a successful Add clear it, and the picker fills it from the file "
      + "name when it was blank — got " + assigns.length);
    for(const m of assigns){
      const after = SCRIPT.slice(m.index, m.index + 200);
      check(/syncAddPhotoInitials\(\)/.test(after),
        "…and every one of them calls syncAddPhotoInitials() nearby, or the "
        + "circle would go on showing whoever the dialog last had");
    }
  }
  {
    /* Two controls, one action, like Save in the QAT and Start: the
       placeholder circle and the static Add photo button both open the same
       hidden picker. */
    check(/\$\("#addPhotoPick"\)\.addEventListener\("click", \(\)=>\{ \$\("#addPhoto"\)\.click\(\); \}\)/.test(SCRIPT),
      "the placeholder circle opens the picker");
    check(/\$\("#addPhotoBtn"\)\.addEventListener\("click", \(\)=>\{ \$\("#addPhoto"\)\.click\(\); \}\)/.test(SCRIPT),
      "…and so does the Add photo button beneath it");
    const pickTag = /<button type="button" class="np-circle" id="addPhotoPick"[^>]*>/.exec(dlg);
    check(!!pickTag, "the placeholder circle is readable");
    check(pickTag && /aria-label="Add a photo"/.test(pickTag[0]),
      "…and carries its own accessible name — a button lettered with initials "
      + "alone would otherwise announce as just those letters");
    /* Standard button chrome — the same default look Reset/Replace/Remove
       photo have in the Edit dialog — not the bare ghost. Asserted against
       the literal emitted tag, not merely "no .ghost token", so a stray class
       squeezed in beside a missing one still reads as the exact markup. */
    check(/<button type="button" id="addPhotoBtn">/.test(dlg),
      "Add photo carries no class at all — plain button chrome, like Reset "
      + "photo and Replace photo, not the ghost look the rest of the dialog uses");
  }

  /* At zero grades the dialog is a door, not a wall: syncAddAvailability
     toggles which of the two Grade-row fields is on screen instead of
     disabling anything. */
  const avail = /function syncAddAvailability\(\)[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!avail, "syncAddAvailability is readable");
  if(avail){
    check(!/\.disabled\s*=/.test(avail[0]),
      "having no grades disables neither Add button — the dialog is fully "
      + "functional in both modes");
    check(SCRIPT.indexOf('id="addNoGrades"') < 0 && !/addNoGrades/.test(SCRIPT),
      "…and #addNoGrades is gone everywhere — the First-grade field is the "
      + "explanation, not a chip beside it");
    check(/\$\("#addTierField"\)\.hidden = noGrades/.test(avail[0]),
      "…the grade select's own field hides at zero grades");
    check(/\$\("#addFirstGradeField"\)\.hidden = !noGrades/.test(avail[0]),
      "…and the First-grade field takes its place");
    check(/\$\("#addTemplateHint"\)\.hidden = !noGrades/.test(avail[0]),
      "…alongside the escape hatch to Templates");
  }
  check(SCRIPT.indexOf('id="addNoGrades"') < 0,
    "#addNoGrades is gone from the markup too — a negative scan across the whole file");
  check(/modalOpen\("#addModal", \$\("#addName"\)\)/.test(SCRIPT),
    "and the dialog always opens on Name — it is fully functional even at zero grades");
  /* The two ids syncAddAvailability toggles, and their [hidden] companions:
     dom.js §2e already enforces the companion rule generically once it finds
     these ids in the hiddenIds scan — this just proves that scan actually
     found them, so a future refactor that stopped writing $("#id").hidden
     bare (moving the write behind a local variable outside the §2e resolver)
     would go red here first. */
  check(/label class="field" id="addTierField"/.test(dlg)
     && /label class="field" id="addFirstGradeField" hidden/.test(dlg),
    "both halves of the Grade row carry the ids syncAddAvailability toggles");
  check(/label\.field\[hidden\]\{display:none\}/.test(HTML),
    "label.field's own [hidden] companion rule exists, since label.field{display:block} "
    + "would otherwise defeat .hidden = true on either half — the exact "
    + "failure a missing companion rule produces");
  /* The escape hatch: closes first (so modalClose returns focus to the
     opener), switches to Structure, then lands focus ON Templates itself —
     not merely the tab — because the whole point of the sentence is to get
     the user's hand onto that button. */
  const goTpl = /\$\("#addGoTemplates"\)\.addEventListener\("click", \(\)=>\{[\s\S]*?\n\}\);/.exec(SCRIPT);
  check(!!goTpl, "#addGoTemplates is wired");
  check(goTpl && /closeAddModal\(\);/.test(goTpl[0])
             && /selectTab\("grades"\);/.test(goTpl[0])
             && /\$\("#templatesBtn"\)\.focus\(\);/.test(goTpl[0])
             && goTpl[0].indexOf("closeAddModal()") < goTpl[0].indexOf('selectTab("grades")')
             && goTpl[0].indexOf('selectTab("grades")') < goTpl[0].indexOf('$("#templatesBtn").focus()'),
    "…closes the dialog, switches to Structure, then focuses Templates — in that order");
  /* The role placeholder's one policy gains a zero-grade branch rather than a
     second writer, so #addFirstGrade has to feed it the same way #addTier
     already does. */
  check(/\$\("#addFirstGrade"\)\.addEventListener\("input", syncAddRolePlaceholder\)/.test(SCRIPT),
    "typing the first grade's name re-syncs the role placeholder live");
  /* addOnePerson's zero-grade staleWrite call: the destination grade does not
     exist yet to check against, so only the generation may be — the same
     precedent addFiles sets when its own batch needs no pre-existing grade. */
  const addFn = /async function addOnePerson\(\)[\s\S]*?\n\}\n/.exec(SCRIPT);
  check(!!addFn, "addOnePerson is readable");
  check(addFn && /staleWrite\(addPending\.gen, zeroGrades \? null : \{tierId: tierId\}\)/.test(addFn[0]),
    "at zero grades the pending-photo staleWrite check passes null — there is "
    + "no grade yet to name");
}

/* --------------------- 4m3. every dialog has the same close X, wired to Escape
   Presence is easy to grep and proves nothing: the failure this section exists
   for is an X that hides the backdrop without resolving the promise its caller
   is awaiting, which looks perfectly fine until something much later never
   resumes. So the two mappings — what Escape does, and what the X does — are
   read out of the file separately and compared against each other, rather than
   either being compared against a copy written down here. */
{
  const DIALOGS = ["askModal", "importModal", "addModal", "editModal", "pasteModal", "groupModal", "infoModal"];

  /* --- one X per dialog, and one shape for all five --- */
  const shapes = [];
  for(const id of DIALOGS){
    const from = MARKUP.indexOf('<div class="modal-backdrop" id="' + id + '"');
    const next = DIALOGS.map(d => MARKUP.indexOf('<div class="modal-backdrop" id="' + d + '"'))
      .filter(i => i > from);
    const box = from < 0 ? "" : MARKUP.slice(from, next.length ? Math.min(...next) : MARKUP.length);
    check(from >= 0, "#" + id + " is readable");
    /* Matched on .modal-x alone, not on the whole class attribute: extracting by
       `class="ghost modal-x"` made the .ghost assertion below unfalsifiable —
       it read a string the regex had already required — and turned "the X lost
       a class" into "there is no X", which sends the reader to the wrong place. */
    const xs = matchAll(/<button[^>]*class="[^"]*\bmodal-x\b[^"]*"[^>]*>[\s\S]*?<\/button>/g, box);
    check(xs.length === 1,
      "#" + id + " has exactly one close X — got " + xs.length);
    if(xs.length === 1){
      shapes.push(xs[0][0]);
      /* first thing inside .modal, before the title — so it is where every
         other close button in every other application is */
      const modalAt = box.indexOf('<div class="modal');
      const h3At    = box.indexOf("<h3");
      check(modalAt >= 0 && xs[0].index > modalAt && xs[0].index < h3At,
        "#" + id + "'s X sits inside .modal and before its <h3>");
    }
  }
  check(shapes.length === DIALOGS.length && uniq(shapes).length === 1,
    "all seven are the same button, character for character — one dismiss "
    + "affordance in a second place, not six slightly different ones. Got "
    + uniq(shapes).length + " distinct");
  if(shapes.length){
    check(/aria-label="Close"/.test(shapes[0]) && /title="Close"/.test(shapes[0]),
      "…named Close, the same as .gmenu-head's");
    check(shapes[0].indexOf('<use href="#i-close"/>') > 0,
      "…using #i-close, written out in full");
    check(/class="ghost modal-x"/.test(shapes[0]),
      "…and carrying .ghost, so it is the neutral button the panel's close already is");
    check(/^<button type="button"/.test(shapes[0]),
      "…declared type=button, so it is not a submit inside anything");
    check(!/data-cmd=|data-act=/.test(shapes[0]),
      "it dispatches through neither table — it is bound directly, per dialog");
  }

  /* --- the X calls exactly what Escape calls, per dialog --- */
  const pairs = s => {
    const m = {};
    for(const x of s) m[x[1]] = x[2];
    return m;
  };
  const esc = pairs(matchAll(
    /e\.key==="Escape" && !\$\("#(\w+)"\)\.hidden\)\{ (\w+\([^)]*\)); return; \}/g, SCRIPT));
  const xtab = pairs(matchAll(/\["#(\w+)",\s*\(\)=>(\w+\([^)]*\))\]/g, SCRIPT));
  check(DIALOGS.every(d => esc[d]),
    "the Escape branch still answers for all seven dialogs — got "
      + JSON.stringify(Object.keys(esc)));
  check(DIALOGS.every(d => xtab[d]),
    "and the X table names all seven — got " + JSON.stringify(Object.keys(xtab)));
  for(const d of DIALOGS){
    check(esc[d] && xtab[d] && esc[d] === xtab[d],
      "#" + d + "'s X calls what its Escape calls — Escape says " + esc[d]
        + ", the X says " + xtab[d]);
  }
  /* The two that matter most, stated as themselves: modalClose would hide the
     backdrop and strand a caller for ever, and this is the only assertion that
     names why these two are different from the other three. */
  check(xtab.askModal === "askClose(null)" && xtab.importModal === "importClose(null)",
    "the two dialogs that park a promise are closed through the function that "
    + "resolves it, never through modalClose");
  check(!/\.modal-x[\s\S]{0,200}?modalClose\(/.test(SCRIPT),
    "no X reaches modalClose directly");

  /* --- ask()'s focus fallback moved off the X --- */
  check(/modalOpen\("#askModal", input \|\| primaryAction \|\| focusables\(\$\("#askActions"\)\)\[0\]\)/.test(SCRIPT),
    "ask() falls back to the PRIMARY action, not the first focusable — the X is "
    + "the first focusable, and a confirmation opening on its dismiss button "
    + "asks a different question from the one ask() built");
  check(!/focusables\(\$\("#askModal"\)\)/.test(SCRIPT),
    "…and no whole-dialog fallback survives beside the actions-scoped one");
  /* Focus follows whichever action carries .primary —
     the confirmer normally, Cancel in a danger dialog — so this pins WHERE
     that element is read from, not just that a variable named primaryAction
     exists (a variable that queried the wrong scope would still pass a bare
     name check). */
  check(/const primaryAction = actions\.querySelector\("button\.primary"\)/.test(SCRIPT),
    "the primary action is read from #askActions' own button set, the same "
    + "actions[] the loop above it just built — not from the document at large");

  /* --- the rules that put it there --- */
  {
    const CSS = (/<style>([\s\S]*?)<\/style>/.exec(MARKUP) || ["", ""])[1];
    /* Anchored on the rule above it, not on ".modal{" alone: there are two of
       those, and the first one in the sheet is the narrow-screen override
       inside a media query — which is what this read the first time. askModal's
       own z-index override sits between the anchor and .modal{ now, so the
       gap allows that one named rule (and nothing else unbounded) without
       losing the disambiguation the anchor exists for. */
    const modalRule = /\.modal-backdrop\[hidden\]\{display:none\}\s*(?:\/\*[\s\S]*?\*\/\s*#askModal\{[^}]*\}\s*)?\.modal\{([^}]*)\}/.exec(CSS);
    /* Its own assertion, because this extraction is anchored on a DIFFERENT
       rule from the one it reads. A miss does fail the two checks below — they
       are guarded — but it fails them saying .modal lost position:relative,
       which sends the reader to a rule that is fine. Mutating the anchor away
       is what this one line answers for. */
    check(!!modalRule,
      "the .modal rule is still the next rule after .modal-backdrop[hidden] "
      + "(askModal's own override aside) — that pairing is what tells it apart "
      + "from the ≤900px override of the same name");
    check(modalRule && /position:relative/.test(modalRule[1]),
      ".modal is the positioning context, so the X cannot land on the backdrop");
    check(modalRule && /max-height:86vh/.test(modalRule[1]) && /overflow-y:auto/.test(modalRule[1]),
      "…and is still the scroll container itself — no inner wrapper was introduced "
      + "to keep the X in view");
    check(/\.modal-x\{position:absolute;top:12px;right:14px;padding:2px 3px;line-height:1\}/.test(CSS),
      "the X is pinned to the dialog's top-right with .gmenu-head's own padding");
    const xIc = /\.modal-x \.ic\{([^}]*)\}/.exec(CSS);
    const gIc = /\.gmenu-head \.ic\{([^}]*)\}/.exec(CSS);
    check(xIc && gIc && xIc[1] === gIc[1],
      "and at the same size as the grade panel's close — got " + (xIc && xIc[1])
        + " against " + (gIc && gIc[1]));
    const h3 = /\.modal h3\{([^}]*)\}/.exec(CSS);
    check(h3 && /padding-right:26px/.test(h3[1]),
      "a long title is kept out from under the X");
    /* About's title is the same title the other three get. Its own rule undoes
       the centring the identity layout would apply to it and states NOTHING
       else — a size, a weight or a padding written here is a second copy of
       .modal h3's answer, and the pair drifts. Asserted as an absence, since
       the way this comes back is a value at a time. */
    const aboutTitle = /\.about-open #infoTitle\{([^}]*)\}/.exec(CSS);
    check(!!aboutTitle, "About's title rule is readable");
    check(aboutTitle && /text-align:left/.test(aboutTitle[1]),
      "About's title sits left like every other dialog's, against the centring "
      + "of the identity layout around it — got "
      + JSON.stringify(aboutTitle && aboutTitle[1]));
    check(aboutTitle && !/font-size|font-weight|padding/.test(aboutTitle[1]),
      "…and restates none of .modal h3's own values — got "
      + JSON.stringify(aboutTitle && aboutTitle[1]));
    /* About's width comes from the same .modal-info every other Info
       document uses, so there is one writer of the dialog's width rather
       than two that could disagree. Asserted as an absence in the
       about-open rule, the same style as the #infoTitle check just above,
       plus the shared rule's own literal as the second source. */
    const aboutOpenRule = /\.modal-info\.about-open\{([^}]*)\}/.exec(CSS);
    check(!!aboutOpenRule, "About's open-state rule is readable");
    check(aboutOpenRule && !/max-width/.test(aboutOpenRule[1]),
      "…and states no max-width of its own — got "
      + JSON.stringify(aboutOpenRule && aboutOpenRule[1]));
    check(/\.modal-info\{max-width:540px\}/.test(CSS),
      "…so About takes the shared .modal-info width, 540px, stated once");
  }
}

/* ------------------------ 4n. Add grade is a lead action that asks for a name */

/* Add grade is the .rb-file lead action, and it asks for a name before
   creating the grade rather than pushing a placeholder called NEW straight
   into the document that has to be found in the strip and renamed
   afterward, with no way to back out. Both halves fail quietly if undone:
   the button still dispatches either way. */
{
  const paneAt   = MARKUP.indexOf('id="pane-grades"');
  const nextPane = MARKUP.indexOf('class="rb-pane"', paneAt);
  check(paneAt > 0 && nextPane > paneAt, "the Grades pane is locatable in the markup");
  const pane  = MARKUP.slice(paneAt, nextPane);
  const group = pane.split(/<div class="lbl">/)[0];

  check(/<div class="rb-file">/.test(group),
    "the Grades group uses the shared .rb-file grid, like File and Add people");
  check(!/rb-row/.test(group), "no loose flex row is left in the Grades group");

  const btn = /<button class="([^"]*)"[^>]*data-cmd="addGrade"/.exec(group);
  check(!!btn, "Add grade is still a button");
  check(btn && /\bbig\b/.test(btn[1]) && /\brb-lead\b/.test(btn[1]),
    "Add grade is the two-row primary lead, the same shape as Save and Copy PNG");
  check(/data-cmd="addGrade"[\s\S]{0,160}<use href="#i-floor"\/>/.test(group),
    "Add grade carries the floor icon (#i-floor), not a placeholder square");
  const commands = matchAll(/data-cmd="([A-Za-z]+)"/g, group).map(m => m[1]);
  check(commands.join(",") === "addGrade,clearGrades,groups",
    "Structure's three data-cmd actions are Add grade, Clear grades and Group — got: "
      + commands.join(","));
  /* Templates sits between them in reading order but carries no data-cmd of
     its own — applyTemplate takes an id, which data-cmd's zero-argument
     dispatch has nowhere to put — so it is found by id instead, and its
     position is checked directly against its two neighbours rather than
     through the data-cmd list above. */
  const addAt = group.indexOf('data-cmd="addGrade"');
  const tplAt = group.indexOf('id="templatesBtn"');
  const clrAt = group.indexOf('data-cmd="clearGrades"');
  check(addAt >= 0 && tplAt > addAt && clrAt > tplAt,
    "Structure reads Add grade, then Templates, over Clear grades");
  /* #i-delete, not #i-close: `close` is the dismiss glyph — it shuts the grade
     panel, collapses a person's row and removes one grade from the strip. On
     the command that empties the whole structure it said "dismiss this" about
     the most destructive action in the tab. The sprite's own two symbols keep
     the two apart in artwork; this keeps them apart in the markup. */
  {
    const action = /<button class="([^"]*)"[^>]*data-cmd="clearGrades"[\s\S]*?<use href="#i-delete"\/>[\s\S]*?<\/button>/.exec(group);
    check(!!action, "clearGrades is a visible Structure command with #i-delete");
    check(action && /\brb-mini\b/.test(action[1]),
      "clearGrades is one row in the stack to the right of Add grade");
    check(action && /\bdanger\b/.test(action[1]),
      "clearGrades carries destructive styling");
  }
  {
    const action = /<button class="([^"]*)"[^>]*id="templatesBtn"[\s\S]*?<use href="#i-cards-star"\/>[\s\S]*?<\/button>/.exec(group);
    check(!!action, "Templates is a visible Structure command with #i-cards-star");
    check(action && /\brb-mini\b/.test(action[1]),
      "Templates is one row in the stack to the right of Add grade");
    check(action && !/\bdanger\b/.test(action[1]),
      "Templates does not carry destructive styling");
  }
  check(/Templates/.test(group) && /Clear grades\b/.test(group),
    "both complete-structure actions are named on the strip — Templates and Clear grades");

  /* Templates' own markup: the button that opens it, the menu and its three
     actions, its registration alongside every other ribbon menu, and the two
     places wiring happens — the whole-button click-to-open clause and the
     item click's own delegated listener. */
  {
    const btnTag = (/<button[^>]*id="templatesBtn"[^>]*>/.exec(group) || [""])[0];
    check(/aria-haspopup="menu"/.test(btnTag) && /aria-expanded="false"/.test(btnTag)
       && /aria-controls="templatesMenu"/.test(btnTag),
      "Templates announces itself as a menu button, closed, naming its menu");
    check(!/data-cmd/.test(btnTag),
      "…and carries no data-cmd — applyTemplate takes an id, which the "
      + "zero-argument dispatch has nowhere to put");

    const menu = /<div class="menu" id="templatesMenu"[\s\S]*?<\/div>/.exec(MARKUP);
    check(!!menu, "the Templates menu is in the markup");
    if(menu){
      check(/role="menu"/.test(menu[0]) && /aria-label="Templates"/.test(menu[0])
         && / hidden><\/div>/.test(menu[0]),
        "it is a menu, named for itself, starts closed like every other one, "
        + "and starts empty — its rows are built at boot, not written here");
      check(!/aria-checked/.test(menu[0]),
        "its items are actions, not a checked choice — applying a "
        + "template does not become \"the current template\"");
      check(!/data-tpl="/.test(menu[0]),
        "no static data-tpl row remains — a second copy of TEMPLATES' rows "
        + "here is exactly what would drift the day a template changed");

      /* The rows themselves are built at boot, in fillTemplatesMenu(), which
         this checks on its SOURCE: that it is driven from TEMPLATES rather
         than a second list, that data-tpl/the accent/the icon all come from
         the template object rather than a literal, and loosely, that the
         three pieces are appended dot-then-icon-then-name — the real order
         assertion, on the BUILT dom, lives in test/fixtures.js. */
      const fillFn = (/function fillTemplatesMenu\(\)[\s\S]*?\n\}/.exec(SCRIPT) || [""])[0];
      check(!!fillFn, "fillTemplatesMenu is defined");
      check(/TEMPLATES\.forEach\(|TEMPLATES\.map\(|for\s*\(\s*const \w+ of TEMPLATES\)/.test(fillFn),
        "…and is built by iterating TEMPLATES, not a second static list");
      check(/"data-tpl"\s*:\s*tpl\.id/.test(fillFn),
        "…data-tpl comes from tpl.id");
      check(/--swatch:["']?\s*\+\s*tpl\.accent/.test(fillFn),
        "…the accent dot's --swatch comes from tpl.accent");
      check(/\baccent-dot\b/.test(fillFn),
        "…the row carries an accent-dot span");
      check(/layoutIcon\(tpl\.layout\)/.test(fillFn),
        "…the layout icon comes from layoutIcon(tpl.layout), the sanctioned "
        + "dynamic-icon path, never a concatenated href");
      check(/tpl\.name/.test(fillFn),
        "…the row's label text comes from tpl.name");
      const dotAt  = fillFn.indexOf("accent-dot");
      const iconAt = fillFn.indexOf("layoutIcon(tpl.layout)");
      check(dotAt >= 0 && iconAt >= 0 && dotAt < iconAt,
        "…and the accent dot is written before the layout icon in source order");

      /* The one non-row this menu carries: the sentence saying why the rows
         are dead, which a disabled button cannot show as a tooltip. Built
         here with them rather than written into the markup, so a menu that
         opens can never be missing it, and built hidden — a document with
         nobody on the roster must not see it. */
      const noteAt = fillFn.indexOf('"templatesNote"');
      check(noteAt >= 0 && /cls:\s*"warn-chip"/.test(fillFn),
        "fillTemplatesMenu also builds #templatesNote, wearing the same "
        + "warn-chip the Design popups' contrast warning wears");
      check(/note\.hidden = true/.test(fillFn),
        "…built hidden, so a roster with nobody on it never shows the reason");
      check(noteAt >= 0 && noteAt > fillFn.indexOf("TEMPLATES"),
        "…and appended after the rows it explains, not above them");

      /* Two rules, not one: `#templatesMenu .warn-chip` is an id selector and
         outranks the generic `.warn-chip[hidden]` further down the sheet, so
         without the scoped pair the note would never go away again. */
      const CSS = (/<style>([\s\S]*?)<\/style>/.exec(MARKUP) || ["", ""])[1];
      check(/#templatesMenu \.warn-chip\s*\{[^}]*display:block/.test(CSS),
        "the note is a block inside the menu, not the inline chip .warn-chip "
        + "is by default");
      check(/#templatesMenu \.warn-chip\[hidden\]\s*\{[^}]*display:none/.test(CSS),
        "…and its hidden state is restated at the same specificity, or the id "
        + "selector outranks .warn-chip[hidden] and keeps it on screen");

      /* Called once, at boot, before the menu's own click listener is wired —
         which is itself wired unconditionally at the top level, so both run
         before any click on #templatesBtn is possible. Building the rows
         lazily on first open would hand focus to a menu with nothing in it. */
      check(/^fillTemplatesMenu\(\);$/m.test(SCRIPT),
        "fillTemplatesMenu is called once at the top level, at boot");
      const bootCallAt  = SCRIPT.search(/^fillTemplatesMenu\(\);$/m);
      const listenerAt  = SCRIPT.indexOf('$("#templatesMenu").addEventListener("click"');
      check(bootCallAt >= 0 && listenerAt > bootCallAt,
        "…and runs before the menu's own click listener is wired");
    }

    /* Registered like every other ribbon menu, anchored to its own face so it
       opens under Templates rather than under whatever sits to its left. */
    const table = /const RIBBON_MENUS = \[[\s\S]*?\];/.exec(SCRIPT);
    check(table && table[0].indexOf('menu:"#templatesMenu"') >= 0
                && table[0].indexOf('btn:"#templatesBtn"') >= 0
                && table[0].indexOf('anchor:"#templatesBtn"') >= 0,
      "#templatesBtn and #templatesMenu are registered in RIBBON_MENUS, anchored to the button");

    /* The whole-button-opens-its-menu clause — Structure's equivalent of the
       Design selector faces' own dispatcher clause, since Templates carries
       neither .split-toggle nor .style-command. */
    check(/e\.target\.closest\("#templatesBtn"\)/.test(SCRIPT),
      "clicking the Templates face opens its menu the same way a Design "
      + "selector face does");

    /* The item click goes to applyTemplate via its own delegated listener, not
       through data-cmd — and closes the menu itself, since the generic
       dispatcher's "choosing an item closes it" branch only fires for
       [data-cmd]. */
    const tplClick = /\$\("#templatesMenu"\)\.addEventListener\("click"[\s\S]*?\}\);/.exec(SCRIPT);
    check(!!tplClick, "the Templates menu's click listener is readable");
    check(tplClick && /closest\("\[data-tpl\]"\)/.test(tplClick[0])
                    && /applyTemplate\(el\.dataset\.tpl\)/.test(tplClick[0])
                    && /closeMenu\(true\)/.test(tplClick[0]),
      "it reads data-tpl, closes the menu and calls applyTemplate with the chosen id");
  }

  /* The literal string held in OLD must not survive anywhere in the file —
     a class check across the whole file rather than four separate literal
     checks, so the NEXT site that copies the wrong wording also fails here. */
  {
    const OLD = "Add or restore a grade under Structure first";
    const NEW = "Add a grade or apply a template under Structure first";
    check(MARKUP.indexOf(OLD) < 0 && SCRIPT.indexOf(OLD) < 0,
      "the OLD sentence is absent from both MARKUP and SCRIPT");
    const escaped = NEW.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sites = matchAll(new RegExp(escaped, "g"), MARKUP + "\n" + SCRIPT);
    /* One site, not four: #importNoGrades alone. A zero-grade paste builds
       its structure from the list via pasteGradePlan instead of being
       refused, and Add's First-grade field is the door at zero grades
       rather than a wall — so neither route needs this guard. The
       photo-import dialog is the one route that still refuses outright: a
       dropped photo genuinely has nowhere to go without a destination
       grade, where Add and Paste can both build one from what was typed or
       pasted. */
    check(sites.length === 1,
      "the new wording appears at the one site that still carries it — "
      + "got " + sites.length);
  }
  /* pasteList and #csvPick both land in the paste dialog through the same
     pipeline (see the comment above COMMANDS.importCsv) and must stay twins:
     #csvPick never refused at zero grades, and pasteList must not either. A
     class check over both bodies together, so a guard reappearing on EITHER
     route fails here rather than only the one someone happened to think to
     re-test. */
  {
    const pasteListBody = /pasteList:\s*\(\)=>[\s\S]*?,\n/.exec(SCRIPT);
    check(!!pasteListBody, "COMMANDS.pasteList is readable");
    const csvPickHandler = /\$\("#csvPick"\)\.addEventListener\("change"[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(!!csvPickHandler, "the #csvPick change handler is readable");
    check(pasteListBody && csvPickHandler
       && !/state\.tiers\.length/.test(pasteListBody[0])
       && !/state\.tiers\.length/.test(csvPickHandler[0]),
      "neither of the two paste-dialog entry routes refuses at zero grades");
  }
  /* The ellipsis is for a command that needs further input before it can act —
     Open…, Save copy as…, Add list…. This one asks for consent, not a value: the
     dialog behind it is a confirmation with a yes and a no, and there is
     nothing to fill in. Both halves, so the ellipsis cannot come back on the
     button while the convention is still written down. */
  check(!/Clear grades…/.test(MARKUP),
    "Clear grades takes no ellipsis — it opens a confirmation, not a form");
  check(/Clear grades\?/.test(SCRIPT),
    "…and the confirmation it opens is what asks");
  for(const needsInput of ["Open…", "Save copy as…", "Add list…"]){
    check(MARKUP.indexOf(needsInput) >= 0,
      '"' + needsInput + '" keeps its ellipsis — it cannot act until something is typed or picked');
  }
  /* #i-add is not an orphaned placeholder — it belongs to a real control,
     the roster heading's "+" (below, at the addTo slice) — so "i-add is
     gone" is deliberately not the invariant. What has to hold is the
     narrower claim: Add grade — the command this section is about — does
     not carry it. #i-floor above already proves what Add grade's own icon
     is; a second match here would mean the id was shared between two
     different commands' artwork instead of naming exactly one. */
  check(!/data-cmd="addGrade"[\s\S]{0,160}<use href="#i-add"\/>/.test(group),
    "Add grade does not carry #i-add — that id belongs to the roster heading's "
    + "own button, not to Structure's lead action");

  /* The new symbol, and the one it replaced. §2b already proves every symbol is
     referenced, carries the Material viewBox, is counted in NOTICE and resolves
     to a file in sprites/ — this names which artwork this particular id holds,
     which a count cannot. */
  {
    const sym = /<symbol id="i-delete"[^>]*>([\s\S]*?)<\/symbol>/.exec(MARKUP);
    check(!!sym, "the bin symbol is in the sprite");
    check(sym && /viewBox="0 -960 960 960"/.test(
      (/<symbol id="i-delete"[^>]*>/.exec(MARKUP) || [""])[0]),
      "and keeps the Material Symbols viewBox the rest of the sprite uses");
    check(sym && !/\bfill=/.test(sym[1]),
      "with the source fill stripped, so it inherits its button's colour");
    /* the artwork itself, taken from sprites/ rather than approximated */
    const src = readFile(here() + "sprites/delete_40dp_E3E3E3_FILL0_wght400_GRAD0_opsz40.svg");
    const d = /\bd="([^"]+)"/.exec(src);
    check(!!d, "sprites/delete_…svg is readable");
    check(sym && d && sym[1].indexOf(d[1]) >= 0,
      "and the path is the supplied file's, not a redrawing of it");
    /* #i-close stays: it is the dismiss glyph for the grade panel, a person's
       row and one grade out of the strip. Removing it with this call site would
       blank three controls. */
    check(/<symbol id="i-close"/.test(MARKUP),
      "#i-close stays in the sprite — it is still the dismiss glyph elsewhere");
    check(matchAll(/<use href="#i-close"\/>/g, MARKUP).length
        + matchAll(/\bicon\("#i-close"\)/g, SCRIPT).length >= 2,
      "…and it still has call sites, so removing it here left nothing unreferenced");
    check(!/data-cmd="clearGrades"[\s\S]{0,200}<use href="#i-close"\/>/.test(MARKUP),
      "but Clear grades does not use it — its own icon is #i-delete, the bin");
  }

  const availability = /function syncStructureAvailability\(\)[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!availability, "whole-structure availability has one synchronizer");
  if(availability){
    check(/state\.people\.length > 0/.test(availability[0]),
      "both whole-structure actions are gated by whether people exist");
    /* Templates' rows carry data-tpl rather than data-cmd — applyTemplate
       takes an id, which the zero-argument dispatch has nowhere to put — so
       setCommandDisabled's [data-cmd] lookup cannot reach them and this
       function mirrors its logic over the menu instead. The face stays live
       at every moment: a disabled button explains nothing, so the refusal
       sits on the rows behind it and in the note under them. */
    check(availability[0].indexOf("templatesBtn") < 0,
      "the Templates face is not disabled here — it stays openable, because "
      + "the explanation lives inside the menu it opens");
    check(/querySelectorAll\("#templatesMenu \[data-tpl\]"\)/.test(availability[0])
       && /item\.disabled = hasPeople/.test(availability[0])
       && /item\.title = hasPeople \? occupied : item\.dataset\.enabledTitle/.test(availability[0]),
      "the menu's template rows are disabled with people instead, and their "
      + "title swaps to the reason and back");
    check(/\$\("#templatesNote"\)/.test(availability[0])
       && /note\.hidden = !hasPeople/.test(availability[0]),
      "…and #templatesNote is shown exactly while those rows are dead — a "
      + "disabled button shows no tooltip, so the reason has to be visible text");
    check(/setCommandDisabled\("clearGrades", hasPeople \|\| noGrades/.test(availability[0]),
      "Clear grades is disabled when people exist or already empty");
    /* A zero-grade document is not a wall for
       a paste or a CSV import — the list's own Grade column becomes the
       structure (pasteGradePlan), so neither command is disabled here. A
       class check over the whole function body, not two literal lookups for
       just these two names: the next command someone adds to this list by
       copying an existing line should go red here too. */
    check(availability[0].indexOf('"pasteList"') < 0,
      "pasteList is not named in syncStructureAvailability at all — it is never disabled at zero grades");
    check(availability[0].indexOf('"importCsv"') < 0,
      "…and neither is importCsv — the zero-grade case is a feature, not a wall");
    check(/setCommandDisabled\("clearRoster", !hasPeople/.test(availability[0]),
      "Clear roster is disabled while there is nobody to clear — the mirror of "
      + "clearGrades' own empty-collection clause");
    /* addPeople deliberately is NOT: the dialog opens and explains instead of
       the face going dead, and syncAddAvailability is what disables its Add.
       Both halves asserted, so re-adding the face to this list fails here. */
    check(availability[0].indexOf('"addPeople"') < 0,
      "addPeople is NOT disabled here — the dialog explains rather than the face dying");
    check(/syncAddAvailability\(\)/.test(availability[0]),
      "…and this is where the dialog's own Add button is disabled instead");
  }
  const rosterRender = /function renderRoster\(\)[\s\S]*?\n\}/.exec(SCRIPT);
  check(rosterRender && /syncStructureAvailability\(\)/.test(rosterRender[0]),
    "every roster render refreshes the enabled states, including undo and redo");

  /* ---- the "+" on each roster group heading ----------------------------

     A shortcut for a grade already on screen: it opens the Add people dialog with
     that grade chosen, instead of making the user pick it for the third time.
     The heading is built in renderRoster, so this reads the source rather than
     the markup; test/fixtures.js renders it, and test/document.js drives what the
     dialog does with the id. */
  {
    /* Cut the slice on the VERB alone — the least that identifies the button —
       so the class, the icon and the name below are asserted rather than assumed
       by the way the slice was taken. */
    const addTo = /el\("button", \{[^}]*act:"addTo"[\s\S]*?\]\)\);/.exec(SCRIPT);
    check(!!addTo, "the roster heading emits an addTo button");
    check(addTo && /cls:"ghost th-add"/.test(addTo[0]),
      "…as a ghost button with its own heading class");
    check(addTo && /did:t\.id/.test(addTo[0]),
      "…carrying the GRADE's id, which is what the handler passes on");
    /* This button reads as its own "add here" affordance, a plain plus in a
       small frame (#i-add), distinct from the ribbon face's group icon
       (#i-group-add) even though the two open the same dialog. #i-group-add
       stays the ribbon face's glyph — checked separately, out of this slice
       — and is not used here. Written out in full, because a built href
       defeats the static check. */
    check(addTo && /icon\("#i-add"\)/.test(addTo[0]),
      "…and its own framed-plus glyph, not the ribbon face's group icon");
    check(addTo && /title:"Add someone to " \+ t\.label/.test(addTo[0])
              && /label:"Add someone to " \+ t\.label/.test(addTo[0]),
      "…named for the grade it sits on, as a tooltip and as an accessible name");

    /* The frame. cls:"ghost th-add" is checked above as a string, but
       button.ghost itself sets border-color:transparent — so a rule adding a
       second, visible border-color only means something if IT actually wins
       the cascade, not merely because it was written after the ghost rule.
       That is a resolution question, the same one document.js §5b answers for
       the saved/unsaved icon, so it is answered the same way: parse the real
       stylesheet's rules, match them against the chain this button actually
       sits in (a div.th ancestor, then button.ghost.th-add itself), and grade
       every match by CSS's own specificity rather than reading the .th .th-add
       rule's own declaration and assuming it applies. dom.js and document.js
       run as separate scripts, so this is a local copy of that machinery
       rather than a shared import — kept to exactly the one property this
       needs. Neither rule sits behind an @media guard: this file's @media
       blocks are listed near the top of this suite and neither selector
       appears in one, which is what lets a plain (no-@media) specificity
       comparison stand in for a full cascade. */
    {
      const css = (/<style>([\s\S]*?)<\/style>/.exec(MARKUP) || ["", ""])[1];
      const cssRules = raw => {
        const clean = raw.replace(/\/\*[\s\S]*?\*\//g, "");
        const rules = []; const at = []; let i = 0, buf = "";
        while(i < clean.length){
          const c = clean[i];
          if(c === "{"){
            const sel = buf.trim(); buf = "";
            if(sel.charAt(0) === "@"){ at.push(sel); i++; continue; }
            let j = i + 1, depth = 1;
            while(j < clean.length && depth){
              if(clean[j] === "{") depth++;
              else if(clean[j] === "}") depth--;
              j++;
            }
            rules.push({sel:sel, decls:clean.slice(i + 1, j - 1), at:at.slice()});
            i = j; continue;
          }
          if(c === "}"){ at.pop(); buf = ""; i++; continue; }
          buf += c; i++;
        }
        return rules;
      };
      const compound = text => {
        const out = {tag:null, cls:[], pseudo:[], odd:false};
        const re = /(::?[a-z-]+(?:\([^)]*\))?)|(#[\w-]+)|(\.[\w-]+)|(\[[^\]]+\])|([A-Za-z][\w-]*)|(\*)/g;
        let m, seen = 0;
        while((m = re.exec(text))){
          seen += m[0].length;
          if(m[1]) out.pseudo.push(m[1]);
          else if(m[3]) out.cls.push(m[3].slice(1));
          else if(m[5]) out.tag = m[5];
        }
        if(seen !== text.length) out.odd = true;
        return out;
      };
      /* Resolving the RESTING state only: a compound carrying :hover, :focus,
         [aria-expanded="true"] or any other pseudo/attribute condition must
         NOT match — nothing here is asking "what if the pointer were over it".
         Dropping this rejected button:hover{border-color:#cfd5dc} silently:
         its compound has cls:[] and tag:"button", which matches the chain's
         button node on tag alone, and its declaration would have satisfied
         both checks below even with .th .th-add's own border-color removed —
         caught by mutating that removal and finding the suite still green. */
      const matchOne = (c, elm) => {
        if(c.pseudo.length) return false;
        if(c.tag && c.tag !== elm.tag) return false;
        if(!c.cls.every(k => elm.cls.indexOf(k) >= 0)) return false;
        return true;
      };
      const matchesChain = (parts, chain) => {
        let k = chain.length - 1;
        for(let p = parts.length - 1; p >= 0; p--){
          if(p === parts.length - 1){
            if(!matchOne(parts[p], chain[k])) return false;
            k--;
          }else{
            let found = false;
            while(k >= 0){ if(matchOne(parts[p], chain[k])){ found = true; k--; break; } k--; }
            if(!found) return false;
          }
        }
        return true;
      };
      const specificity = parts => {
        let b = 0, c = 0;
        parts.forEach(p => { b += p.cls.length; if(p.tag) c++; });
        return b * 100 + c;
      };
      const lastDecl = (decls, prop) => {
        const re = new RegExp("(?:^|;)\\s*" + prop + "\\s*:\\s*([^;]+)", "g");
        let m, v = null;
        while((m = re.exec(decls))) v = m[1].trim();
        return v;
      };

      /* the resting state only — no id, no pseudo-class */
      const chain = [{tag:"div", cls:["th"]}, {tag:"button", cls:["ghost", "th-add"]}];
      let winner = null, winnerSpec = -1;
      cssRules(css).forEach(r => {
        if(r.at.length) return;
        r.sel.split(",").forEach(one => {
          if(/[>+~]/.test(one)) return;
          const parts = one.trim().split(/\s+/).map(compound);
          if(parts.some(p => p.odd)) return;
          if(!matchesChain(parts, chain)) return;
          const v = lastDecl(r.decls, "border-color");
          if(v === null) return;
          const spec = specificity(parts);
          if(spec >= winnerSpec){ winnerSpec = spec; winner = v; }
        });
      });
      check(winner !== null,
        "some rule in the real stylesheet resolves border-color for .th .th-add's own chain");
      check(winner !== "transparent",
        "…and the winning declaration paints a real border, not button.ghost's "
        + "transparent one — got " + JSON.stringify(winner));
    }

    /* Last in the heading, after the count. .ct carries margin-left:auto, so
       anything emitted before it lands on the left of the gap instead of beside
       the number. Positions read off renderRoster, not off a rendered tree. */
    const head = rosterRender && rosterRender[0];
    const at = s => head ? head.indexOf(s) : -1;
    check(at('cls:"ct"') > at('cls:"nm"') && at('act:"addTo"') > at('cls:"ct"'),
      "…and appended last, after the count — .ct's margin-left:auto puts "
      + "everything after it on the right");

    /* The handler half. A verb emitted with nothing listening is the failure this
       suite exists for, and dom.js's own verb sweep only proves SOMETHING handles
       it — this pins what. */
    const rosterClick = /\$\("#roster"\)\.addEventListener\("click", e=>\{[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(rosterClick && /if\(act==="addTo"\) openAddModal\(id\)/.test(rosterClick[0]),
      "the roster's click handler passes that grade id to openAddModal");
    /* openAddModal has to be willing to take it. A parameter-less signature with
       a caller passing an argument is the silent version of this whole change. */
    check(/function openAddModal\(wantTier\)/.test(SCRIPT),
      "…and openAddModal takes a grade to select");
  }

  /* The sprite is split by a comment: everything above it is Google's artwork,
     everything below it is not — the TIERFORM mark ships below that boundary,
     alongside any other own-drawn symbol.

     Which symbols are Google's is decided at §2b, by matching each symbol's
     path data against the source files in sprites/, not by anything in the
     file being checked. That matters here: identifying own artwork by the
     literal path of one known placeholder would only ever recognise that one
     drawing — a new own-drawn symbol added later would sail past such a
     check and be silently credited to Google.

     The invariant NOTICE and the sprites/ provenance check rest on is
     unchanged: a symbol that is not Material Symbols path data must sit below
     a PLACEHOLDER comment, and
     the two move together — a comment describing a boundary that is not there
     is exactly how a Google symbol ends up disclaimed, or an own one credited
     to them. Assert both halves, so removing either alone fails. */
  {
    const at   = MARKUP.indexOf("<!-- PLACEHOLDER");
    const syms = matchAll(/<symbol id="(i-[\w-]+)"[^>]*>([\s\S]*?)<\/symbol>/g, MARKUP);
    const drawn = syms.filter(m => ownSymbols.includes(m[1]));

    /* today's state, which NOTICE states as two numbers */
    check(drawn.length > 0,
      "the sprite carries artwork that is not Material Symbols — the TIERFORM mark — "
      + "which is why NOTICE does not claim every icon is Google's "
      + "(the counts themselves are checked at §2b, against the sprite and sprites/)");
    check(at >= 0,
      "and the comment marking where Google's artwork stops is there to describe it");

    /* the invariant, which holds whether or not anything is own work */
    check((drawn.length > 0) === (at >= 0),
      "own artwork and the PLACEHOLDER comment move together — a comment with "
      + "nothing below it is as wrong as artwork with no comment above it");
    for(const m of drawn){
      check(at >= 0 && m.index > at,
        m[1] + " is NOT Material Symbols artwork and must sit BELOW the PLACEHOLDER "
             + "comment — that split is what NOTICE describes");
    }
    for(const m of syms){
      if(drawn.indexOf(m) >= 0) continue;
      check(at < 0 || m.index < at,
        m[1] + " is real Material Symbols artwork and must sit ABOVE the PLACEHOLDER comment");
    }
    /* A boundary comment that says only "PLACEHOLDER" would satisfy everything
       above while telling the next reader nothing about whose work is below it,
       which is the one job it has. */
    const note = /<!-- PLACEHOLDER[\s\S]*?-->/.exec(MARKUP);
    check(note && /TIERFORM\s+mark/.test(note[0]) && /own\s+work/.test(note[0])
       && note[0].indexOf("sprites/logo.svg") >= 0,
      "and it names the artwork below it, says it is own work, and points at the file "
      + "it was copied from");
  }

  /* ------------------------------------------------ the deliverable is the app
     The sprite/NOTICE/sprites-provenance agreement is already guarded above,
     at §2b. What nothing guarded is which *file* the documents send people to.
     Timestamped `*.backup-YYYYMMDD-HHMMSS.html` snapshots are not how this
     directory works — version control is the checkpoint — but a stale
     instruction naming one, surviving a rename, would still send whoever
     follows it to a file no suite was run against. A README that names one
     is the obvious way that happens. */
  {
    const deliverable = /`[\w-]+\.backup-\d{8}-\d{6}\.html`/;
    for(const name of ["README.md", "NOTICE"]){
      check(!deliverable.test(readFile(here() + name)),
        name + " names no .backup-*.html file — tierform_app.html is the deliverable");
    }
    /* and the app must not link to one either */
    check(!/\.backup-\d{8}-\d{6}\.html/.test(HTML),
      "the app itself references no backup snapshot");
  }

  /* The Attach/Share note belongs in the Info tab's tips list, not beside
     the button in the Grades group: a ribbon group is for controls, and the
     ribbon body is a fixed height for every tab, so prose in one is height
     the controls cannot use. Both halves are checked — the note is present
     in Tips, and absent from the Grades group — because checking only the
     absence would equally pass if the note had simply been deleted. */
  check(!/rb-note/.test(MARKUP),
    "no prose is left in a ribbon group, in markup or in the sheet");
  check(group.indexOf("Attach") < 0 && group.indexOf("Share") < 0,
    "the Attach/Share wording is out of the Grades group");
  {
    const tips = MARKUP.indexOf("Shortcuts &amp; tips");
    check(tips > 0, "the Info tab still has a Shortcuts & tips list");
    const list = MARKUP.slice(tips, MARKUP.indexOf("</ul>", tips));
    check(/<b>Attach<\/b> removes the gap to the previous grade/.test(list)
       && /<b>Share<\/b> combines the two grades on one surface/.test(list),
      "and both halves of the note arrived there — deleting it is not moving it "
      + "(Share's wording names the rule across all six layouts and four "
      + "surface words, rather than naming just two of the six)");
  }

  /* A lead-only group still pays no invisible explicit second track; Structure
     now fills that implicit track with its two compact actions. */
  {
    const css = /<style>([\s\S]*?)<\/style>/.exec(MARKUP);
    const CSS = css ? css[1] : "";
    check(/\.rb-file\{[^}]*grid-template-columns:auto;/.test(CSS),
      ".rb-file declares ONE column — the other two are implicit, so a group that "
      + "stops short of three pays no gap for the tracks it does not fill");
    check(!/\.rb-file\{[^}]*grid-template-columns:auto auto/.test(CSS),
      "no explicit empty track survives in .rb-file");
  }
}

/* The dialog it opens. ask() grew a second shape; the single-field one that Save
   As depends on has to keep resolving to a plain string. */
{
  const askFn = /function ask\(opts\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!askFn, "ask() is readable");
  if(askFn){
    check(/opts\.fields/.test(askFn[0]), "ask() accepts several named fields");
    check(/if\(!opts\.fields\) return inputs\.length \? inputs\[0\]\.node\.value : null/.test(askFn[0]),
      "a single-field dialog still resolves to the STRING typed — saveDoc reads it directly");
    check(/for\(const x of inputs\) out\[x\.key\] = x\.node\.value/.test(askFn[0]),
      "a multi-field dialog resolves to an object keyed by field");
    check(/cls: opts\.fields \? "ask-label" : "sr-only"/.test(askFn[0]),
      "named fields show their labels; a lone field keeps its label to screenreaders");
  }
  check(/function askFields\(/.test(SCRIPT), "there is a multi-field shape");
  check(/function askText\(/.test(SCRIPT) && /input:value/.test(SCRIPT),
    "askText still opens a single input field, not the multi-field shape askFields uses");
  /* askText takes a confirmLabel parameter, the same pattern askFields
     already uses above, with "OK" as a neutral fallback for a caller that
     forgets to pass one. A bare "Save copy" literal baked into askText
     itself would be right for Save-a-copy but wrong for renameGroup, an
     unrelated caller that would inherit the same word; both of today's
     callers pass their own label explicitly, and each call site is checked
     below as a full literal rather than restated from the source. */
  {
    const at = /function askText\(title, message, value, inputLabel, confirmLabel\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!at, "askText is readable, and takes a confirmLabel parameter");
    check(at && /\{label:confirmLabel \|\| "OK", value:"", takesInput:true, cls:"primary"\}/.test(at[0]),
      "askText's confirm button label comes from confirmLabel, defaulting to OK");
    check(at && !/label:"Save copy"/.test(at[0]),
      "askText does not hardcode Save copy — each caller supplies its own confirmLabel");
    check(at && !/label:"Save"/.test(at[0]),
      "…nor a bare Save label");
    check(/askText\("Save a copy", "The roster is written to your downloads folder\.",\s*stem, "File name", "Save copy"\)/.test(SCRIPT),
      'saveDoc\'s call passes "Save copy" as its own confirmLabel');
    check(!/askText\("Save roster"/.test(SCRIPT),
      "no askText call uses the title \"Save roster\"");
    check(/askText\("Rename group",\s*"Renaming changes the label everywhere it is shown; people keep pointing at the same group\.",\s*g\.label, "Group name", "Rename"\)/.test(SCRIPT),
      'renameGroup\'s call passes "Rename" as its own confirmLabel, not the Save-a-copy verb');
  }
  /* All modal backdrops share one stacking layer (z-index:100), so paint order
     among them falls back to DOM order — and askModal happens to be first in
     the markup only by accident of history. ask() is the app's prompt
     primitive: by nature it opens on top of whatever asked it, so it must
     outrank the shared layer explicitly. The comparison is read from the two
     extracted numbers, not restated, so this stays a class check on "ask wins"
     rather than a fact about today's two literals — which are pinned
     separately below, so a silent change to either is still seen. */
  {
    const css = /<style>([\s\S]*?)<\/style>/.exec(MARKUP);
    const CSS = css ? css[1] : "";
    const shared = /\.modal-backdrop\{[^}]*z-index:(\d+)/.exec(CSS);
    const ask = /#askModal\{z-index:(\d+)\}/.exec(CSS);
    check(!!shared, "the shared .modal-backdrop layer states a z-index");
    check(!!ask, "askModal states its own z-index override");
    check(!!shared && !!ask && Number(ask[1]) > Number(shared[1]),
      "askModal's z-index outranks the shared .modal-backdrop layer, whatever either number is");
    check(/\.modal-backdrop\{[^}]*z-index:100;/.test(CSS),
      "the shared layer is still z-index:100");
    check(/#askModal\{z-index:110\}/.test(CSS),
      "askModal's override is z-index:110");
  }

  const add = /addGrade: async \(\)=>\{[\s\S]*?\n  \}/.exec(SCRIPT);
  check(!!add, "addGrade is async — it awaits a dialog before it changes anything");
  if(add){
    const asked  = add[0].indexOf("askFields");
    const bailed = add[0].indexOf("if(!got) return");
    const wrote  = add[0].indexOf("commit(");
    check(asked >= 0, "addGrade asks for the grade's names");
    /* Cancel must reach `return` before commit(): a commit past this point is an
       undo step and a dirty flag for a grade the user declined to add. */
    check(bailed > asked && wrote > bailed,
      "a cancelled dialog returns BEFORE commit() — no grade, no undo step, no dirty flag");
    check(/\{key:"code"/.test(add[0]) && /\{key:"label"/.test(add[0]),
      "it asks for both the band's short code and the grade's name");
    check(/clampText\(got\.code,\s*LIMITS\.text\)/.test(add[0])
       && /clampText\(got\.label,\s*LIMITS\.text\)/.test(add[0]),
      "what was typed is held to the same length cap as every other name");
    check(/\|\| "NEW"/.test(add[0]) && /\|\| "New grade"/.test(add[0]),
      "a field left blank falls back — an empty code draws a band with nothing on it");
    check(/\.trim\(\)/.test(add[0]), "whitespace alone counts as blank, not as a name");
    /* A grade has no title of its own to write. Its name IS what gets printed
       under its people, and a person who needs something else carries it. */
    check(!/role:/.test(add[0]),
      "a new grade is built with no role field at all");
    check(!/role:label/.test(add[0]),
      "and the name is not copied into it — that copy is what showed twice");
  }

  /* There is ONE place a grade is made from nothing: newTier(). If grade
     creation had three separate literals of the same shape instead — a
     template's local factory, Add grade, and the NEW grade a paste creates
     — three writers is how a field like `role` comes back in one of them.
     So the agreement is structural rather than three parallel assertions
     that happen to match. */
  {
    const def = /function newTier\(code, label, o\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!def, "newTier() is the one factory for a grade made from nothing");
    check(def && !/role:/.test(def[0]),
      "newTier() writes no role — a grade prints its own name");
    check(def && !/role:o\.role\|\|label/.test(def[0]),
      "and does not fall back to the label — tierRole() does that at draw time");
    /* A class check over the whole file, which is what makes this catch the NEXT
       create path rather than the three that existed when it was written. The
       option-less defaults are the tell: any literal spelling them out is a
       fourth writer, whatever it is called. */
    check(!/attach:false, merge:false/.test(SCRIPT),
      "no create path spells the option-less defaults out for itself — every one "
      + "of them goes through newTier()");
    /* …and the three known callers do go through it, so the check above cannot be
       satisfied by a path that stopped creating grades altogether. */
    const templates = /const TEMPLATES = \[[\s\S]*?\n\];/.exec(SCRIPT);
    check(templates && /newTier/.test(templates[0]), "TEMPLATES builds every template's grades with it");
    const add = /addGrade: async \(\)[\s\S]*?\n  \}/.exec(SCRIPT);
    check(add && /state\.tiers\.push\(newTier\(code, label\)\)/.test(add[0]),
      "Add grade pushes newTier(code, label) with no options of its own");
    const conf = /function confirmPaste\(replace\)[\s\S]*?\n\}/.exec(SCRIPT);
    check(conf && /newTier\(PASTE_NEW_CODE, PASTE_NEW_LABEL\)/.test(conf[0]),
      "and the paste's NEW grade comes from the same call with the same absence of options");
    /* The validator is deliberately NOT a caller: it is judging a grade someone
       else wrote, and its per-field defaults exist to produce repair notes, which
       a factory cannot answer for. What has to hold is that it still emits no
       role — if it did, every Open would put the field back on a document
       that has no control anywhere else in the app to show it with. */
    const outTier = /out\.tiers\.push\(\{[\s\S]*?\n    \}\);/.exec(SCRIPT);
    check(outTier && !/role:/.test(outTier[0]),
      "and the validator does not put one back on the way in");
    check(outTier && !/newTier/.test(outTier[0]),
      "…nor does it borrow the factory: salvaging an untrusted grade is not creating one");
  }
}

/* -------------------------------------- 4l. Start ends with the Info button group */

/* Info's four commands form a group in Start, each opening its own dialog.
   The Start pane and the Design pane must both remain inside .rb-body: an
   orphan closing div between Structure and Design moves Design and the
   whole application stage down by a page. */
{
  const paneAt   = MARKUP.indexOf('id="pane-file"');
  const nextPane = MARKUP.indexOf('class="rb-pane"', paneAt);
  check(paneAt > 0 && nextPane > paneAt, "the Start pane is locatable in the markup");
  const pane = MARKUP.slice(paneAt, nextPane);

  check(!/info-col/.test(MARKUP),
    "no .info-col prose column is left, in the markup or in the sheet");
  check(!/<p[ >]/.test(pane) && !/<ul[ >]/.test(pane),
    "the Start ribbon carries no Info prose — a ribbon group is for controls");
  check(/<div class="lbl">Info<\/div>/.test(pane),
    "the Start pane names the group INFO");

  /* Five buttons, and the four documents are peers: one .big lead and four
     .rb-mini, whatever else changes. The kind is asserted per button and the
     COUNT of leads over the whole group, because per-button checks alone
     would stay green even if a second button were promoted to .big — the
     count is what catches that. */
  for(const [cmd, icon, label, kind] of [["infoTips",    "i-tips",       "Tips",       "mini"],
                                         ["infoPrivacy", "i-privacy",    "Privacy",    "mini"],
                                         ["infoBug",     "i-bug-report", "Bug report", "mini"],
                                         ["infoAbout",   "i-copyright",  "About",      "info-lead"]]){
    const btn = new RegExp('<button class="([^"]*)"[^>]*data-cmd="' + cmd + '"[\\s\\S]{0,200}?</button>')
      .exec(pane);
    check(!!btn, cmd + " is a button in Start's Info group");
    if(!btn) continue;
    check(btn[0].indexOf('<use href="#' + icon + '"/>') > 0,
      cmd + " carries the " + icon + " icon written out in full");
    check(btn[0].indexOf(label) > 0, cmd + ' is labelled "' + label + '"');
    if(kind === "mini"){
      check(/\brb-mini\b/.test(btn[1]) && !/\bbig\b/.test(btn[1]),
        label + " is a secondary one-row command");
    }else{
      check(/\bbig\b/.test(btn[1]) && new RegExp("\\b" + kind + "\\b").test(btn[1])
         && !/\brb-mini\b/.test(btn[1]),
        label + " is a full-height command carrying ." + kind);
    }
  }
  /* The group's shape, read off the group rather than off any one button.
     .rb-file's cells come in pairs — two half-height minis to a column, or one
     full-height command spanning both — so four minis fill columns 1 and 2 and
     About takes column 3. A grid-column pinned to 2 would be correct only
     for exactly two minis, and would land silently on top of a third or
     fourth instead of failing — which is why the count is asserted here,
     not just the position. */
  {
    const css = /<style>([\s\S]*?)<\/style>/.exec(MARKUP);
    const CSS = css ? css[1] : "";
    const groupAt  = pane.indexOf('class="rb-file info-actions"');
    const groupEnd = pane.indexOf('<div class="lbl">Info</div>', groupAt);
    const group    = groupAt >= 0 && groupEnd > groupAt ? pane.slice(groupAt, groupEnd) : "";

    check(/class="rb-file info-actions"/.test(pane),
      "the Info group uses the shared two-row ribbon grid");
    check((group.match(/\brb-mini\b/g) || []).length === 4,
      "four of its buttons are compact peers — got "
      + (group.match(/\brb-mini\b/g) || []).length);
    check((group.match(/\binfo-lead\b/g) || []).length === 1
       && (group.match(/\bbig\b/g) || []).length === 1,
      "and exactly one is the full-height lead — a second .big here is the fifth "
      + "half-slot going missing again");
    check(!/info-report/.test(MARKUP),
      "the info-report rule is gone from markup and sheet entirely — "
      + ".rb-lead2 stays, because that one is the Export group's");
    /* Four minis occupy columns 1 and 2, so the lead's column is 3. A literal,
       because the number is the whole claim. */
    check(/\.info-actions > \.info-lead\{[^}]*grid-column:3;[^}]*grid-row:1 \/ span 2/.test(CSS),
      "About spans both rows of column 3 — the column after the two the four minis fill");
    check(/\.info-actions > \.info-lead\{[^}]*min-height:66px/.test(CSS),
      ".info-lead is the same 66px full height as other lead commands");
    check(/@media \(max-width:900px\)\{ \.info-actions > \.info-lead\{min-height:75px\}/.test(CSS),
      "including at the breakpoint where lead commands rise to 75px");

    /* Column-major flow, so markup order IS the two columns read downwards. */
    const tourAt    = pane.indexOf('id="tourBtn"');
    const tipsAt    = pane.indexOf('data-cmd="infoTips"');
    const privacyAt = pane.indexOf('data-cmd="infoPrivacy"');
    const bugAt     = pane.indexOf('data-cmd="infoBug"');
    const aboutAt   = pane.indexOf('data-cmd="infoAbout"');
    check(tourAt > 0 && tourAt < tipsAt && tipsAt < privacyAt
       && privacyAt < bugAt && bugAt < aboutAt,
      "and the grid flows down each column before moving right, so the markup order "
      + "is Tour, Tips, Privacy, Bug report, About");
  }

  /* Tour is the group's fifth cell and has nothing behind it yet. Three things
     make that honest rather than a lie the user finds by clicking, and each is
     asserted separately because they fail in different ways: it says so, it is
     still reachable to be asked, and it dispatches nothing. */
  {
    const tour = /<button class="([^"]*)"[^>]*id="tourBtn"[\s\S]{0,400}?<\/button>/.exec(pane);
    check(!!tour, "Tour is a button in Start's Info group");
    if(tour){
      check(/\brb-mini\b/.test(tour[1]) && !/\bbig\b/.test(tour[1]),
        "Tour is a compact peer of the four documents, not a lead");
      check(tour[0].indexOf('<use href="#i-animated-images"/>') > 0,
        "Tour carries the i-animated-images icon written out in full");
      check(/>\s*Tour\s*<\/button>/.test(tour[0]),
        "and is labelled Tour — one word, so column 1's width is Tips's and the "
        + "group cannot grow far enough to tip the ribbon into .has-scroll");
      /* Two different breakages, so two checks: shipping it with neither
         attribute makes it look live, and shipping it with the real one takes
         it out of the tab order. The second reads the tag with the ARIA name
         removed, or `aria-disabled` would satisfy a search for `disabled`. */
      check(/aria-disabled="true"/.test(tour[0]),
        "Tour is marked aria-disabled, or it looks like a command that works");
      check(!/\bdisabled\b/.test(tour[0].replace(/aria-disabled/g, "")),
        "and NOT with the real disabled attribute — that takes a control out of the "
        + "tab order, and a keyboard user could then never reach the explanation");
      check(/title="[^"]*not available[^"]*"/.test(tour[0]),
        "and says why, in the wording Copy PNG uses for a capability it does not have");
      check(!/data-cmd/.test(tour[0]),
        "Tour names no command — there is nothing behind it, and a data-cmd pointing "
        + "at an empty COMMANDS entry would look live to the dispatcher and the suites");
    }
    /* The click, and the single copy of the sentence it repeats.
       Cut to the end of the LINE, not to the first `;`. Cutting at the
       semicolon read only as far as `toast(e.currentTarget.title` and left
       everything after it outside the slice — a handler that toasted and then
       opened a dialog was green, because the extraction had already thrown
       away the half being asserted about. */
    const wire = /\$\("#tourBtn"\)\.addEventListener\("click",(.*)$/m.exec(SCRIPT);
    check(!!wire, "#tourBtn's click is wired at boot, since no command dispatches to it");
    check(wire && /toast\(/.test(wire[1]),
      "and it only toasts — the tooltip's own text, so hover and click cannot disagree");
    check(wire && !/commit\(|edit\(|openInfo\(|state\./.test(wire[1]),
      "it changes nothing: no state, no undo step, no dialog");
    /* And it stays one expression on one line, which is what keeps the slice
       above honest: a block body would put statements below the line this
       reads, and the check would go quiet instead of going red. */
    check(wire && !/\{/.test(wire[1]),
      "the handler is a single expression — give it a block body and the check "
      + "above stops seeing what you added, so rewrite it rather than widening it");
    check(!/tour\s*:/i.test((/const COMMANDS\s*=\s*\{([\s\S]*?)\n\};/.exec(SCRIPT) || ["", ""])[1]),
      "and COMMANDS gained no placeholder entry to satisfy the wiring check");
    /* The weight it is drawn at, and the one property it must NOT copy from
       :disabled — pointer-events:none there would swallow the click that asks. */
    const CSS = (/<style>([\s\S]*?)<\/style>/.exec(MARKUP) || ["", ""])[1];
    const rule = /button\[aria-disabled="true"\]\{([^}]*)\}/.exec(CSS);
    check(!!rule, "aria-disabled has a rule of its own, or the button looks enabled");
    check(rule && /opacity:\.38/.test(rule[1]),
      "drawn at the same .38 weight :disabled gives Copy PNG");
    check(rule && !/pointer-events/.test(rule[1]),
      "and without :disabled's pointer-events:none, which would swallow the click "
      + "that is the only way to be told why");
  }

  /* Read the actual .rb-body extent, then require every ribbon pane — notably
     Design, which follows the deleted Info pane in source order — to be inside
     it. This is structural rather than a tag-count check: HTML can have balanced
     tags and still close the right container one element too early. */
  {
    const bodyAt = MARKUP.indexOf('<div class="rb-body">');
    let depth = 0, bodyEnd = -1;
    for(let i = bodyAt; i < MARKUP.length && bodyAt >= 0; i++){
      if(MARKUP.startsWith("<div", i)) depth++;
      else if(MARKUP.startsWith("</div>", i) && !--depth){ bodyEnd = i; break; }
    }
    check(bodyEnd > bodyAt, "the ribbon body's extent is readable");
    for(const hook of ["file", "grades", "design"]){
      const at = MARKUP.indexOf('id="pane-' + hook + '"');
      check(at > bodyAt && at < bodyEnd,
        "the " + hook + " pane is inside .rb-body, not displaced into the page");
    }
  }

  /* The dialogs. One backdrop, three bodies, all of them static: prose built at
     runtime would put the privacy and licensing claims behind a code path, and
     4f reads them straight out of the markup. */
  const modalAt = MARKUP.indexOf('id="infoModal"');
  check(modalAt > 0, "the Info dialog is in the DOM at boot, not built on first click");
  const modal = MARKUP.slice(modalAt);
  for(const [name, id, needle] of [
        ["privacy", "infoPrivacyDoc", "no network requests at all"],
        ["tips",    "infoTipsDoc",    "Shortcuts &amp; tips"],
        ["bug",     "infoBugDoc",     "strip any real names and photos first"],
        ["about",   "infoAboutDoc",   "© 2026 Christian J. Heinze"]]){
    const at = modal.indexOf('id="' + id + '"');
    check(at > 0, "the " + name + " body is in the dialog markup");
    if(at < 0) continue;
    const body = modal.slice(at, modal.indexOf("</div>", modal.indexOf('id="' + id + '"')) + 6);
    check(/^[^>]*\bhidden\b/.test(modal.slice(at)),
      "the " + name + " body starts hidden — openInfo shows exactly one");
    check(modal.slice(at, modal.indexOf('class="btnrow', at)).indexOf(needle) > 0,
      "the " + name + " body still carries its text: " + JSON.stringify(needle));
    check(new RegExp('doc:"#' + id + '"').test(SCRIPT),
      "and INFO_DOCS points a command at it — " + id);
    void body;
  }

  /* The Tips paragraph about the two whole-structure actions must describe
     Structure ▸ Templates and Clear grades — the two commands as they exist
     today — or the list of ribbon tips misdescribes the ribbon. */
  {
    const tipsAt = modal.indexOf('id="infoTipsDoc"');
    const tipsBody = modal.slice(tipsAt, modal.indexOf("</div>", tipsAt) + 6);
    check(!/Restore default grades/.test(tipsBody),
      "Tips names no \"Restore default grades\" command");
    check(/Structure ▸ Templates/.test(tipsBody) && /Clear grades/.test(tipsBody),
      "…and instead names Templates alongside Clear grades");
    check(/layout/.test(tipsBody) && /colour/.test(tipsBody),
      "…and explains that Templates also sets the layout and colours, not just the grades");
  }
  check(/role="dialog"/.test(modal.slice(0, 400)) && /aria-modal="true"/.test(modal.slice(0, 400))
     && /aria-labelledby="infoTitle"/.test(modal.slice(0, 400)),
    "the Info dialog is a labelled modal dialog like the other two");
  check(/trapTab\("#infoModal"\)/.test(SCRIPT),
    "Tab is trapped inside it — otherwise tabbing walks into a page nobody can see");
  check(/e\.key==="Escape" && !\$\("#infoModal"\)\.hidden/.test(SCRIPT),
    "Escape closes it, which the tips list promises it does");
  check(/\$\("#infoCloseBtn"\)\.addEventListener\("click", closeInfoModal\)/.test(SCRIPT),
    "and the Close button is wired once at boot");

  /* About carries the only external brand mark in the product. Keep that mark
     confined to a safe repository link, keep the temporary project-logo block
     deliberately plain, and keep the corresponding trademark acknowledgement
     in all three places a redistributed one-file build may travel. */
  {
    const at = modal.indexOf('id="infoAboutDoc"');
    const end = modal.indexOf('<div class="btnrow modal-foot">', at);
    const about = at >= 0 && end > at ? modal.slice(at, end) : "";
    const repo = 'https://github.com/chrisjohe/tierform';
    const css = /<style>([\s\S]*?)<\/style>/.exec(MARKUP);
    const CSS = css ? css[1] : "";
    const logo = readFile(here() + "sprites/logo.svg");
    const notice = readFile(here() + "NOTICE");
    /* About's notices are now full paragraphs that wrap across source lines
       like every other info-doc paragraph, so a sentence that straddles a
       wrap carries the source indentation's newline-plus-spaces where a
       rendered page would carry a single collapsed space. Comparing through
       these flattened copies (and an identically flattened NOTICE) is what
       lets the sentence literals below match the wrapped source without
       pinning where each one happens to wrap. */
    const flat = s => s.replace(/\s+/g, " ");
    const aboutFlat = flat(about);
    const noticeFlat = flat(notice);

    check(new RegExp('<a class="about-github" href="' + repo.replace(/[/.]/g, "\\$&")
      + '"[\\s\\S]*?target="_blank"[\\s\\S]*?rel="noopener noreferrer"').test(about),
      "About links safely to the TIERFORM repository in a new tab");
    check(/aria-label="Open TIERFORM on GitHub"/.test(about)
       && />\s*Support on GitHub\s*<\/span>/.test(about),
      "the repository link has a clear accessible and visible purpose");
    /* The Invertocat is a trademark that must be the file GitHub supplies,
       reproduced verbatim — so its provenance record is the standalone file it
       was copied from, sprites/github-logo.svg, compared here in full rather
       than against a hand-typed prefix: a copy nothing renders is a copy
       nothing else would catch drifting. */
    const aboutGithubD = (/<a class="about-github"[\s\S]*?<path[^>]*\bd="([^"]+)"/.exec(about) || [])[1];
    const githubLogoD = (/<path[^>]*\bd="([^"]+)"/.exec(readFile(here() + "sprites/github-logo.svg")) || [])[1];
    check(!!aboutGithubD && !!githubLogoD && aboutGithubD === githubLogoD,
      "the repository link's inline path matches sprites/github-logo.svg in full — that file "
      + "is the provenance record for the GitHub mark, not an approximation of it");
    /* The flat block is gone and the real mark is in its place, from the sprite
       rather than as a second inline copy. No accessible name on it: the
       wordmark spelling TIERFORM is the next element down, and a named mark
       would have a screenreader say the product twice. */
    check(/<svg class="about-mark" aria-hidden="true"><use href="#i-logo"\/><\/svg>/.test(about)
       && !/<img\b/i.test(about),
      "About draws the mark from the sprite's one symbol, silent beside the wordmark");
    /* Both of these said "green". The About mark takes var(--brand), and --brand
       is #003153 — so the word described neither the rule being checked nor the
       colour on screen, and would have gone on describing neither for any value
       of --brand. The colour is read out of the sheet and named in the message
       instead, which is a claim that can be wrong. */
    const brandHex = (/--brand:(#[0-9A-Fa-f]{6})/.exec(CSS) || [])[1];
    check(/\.about-mark\{[^}]*width:78px;[^}]*height:65px;[^}]*color:var\(--brand\)/.test(CSS),
      "the About mark keeps the box the placeholder reserved and takes the app's own brand "
      + "colour (" + brandHex + ") through `color`, so one symbol can serve both homes");
    /* This file is the real mark, not the flat placeholder, and what is
       load-bearing follows from that: nothing loads sprites/logo.svg, so it
       cannot break visibly — it can only go stale against the copy that
       ships. Compare the path data itself, from the two files, so the two
       writers are genuinely independent. */
    const fileD   = (/<path[^>]*\bd="([^"]+)"/.exec(logo) || [])[1];
    const spriteD = (/<symbol id="i-logo"[\s\S]*?<path[^>]*\bd="([^"]+)"/.exec(MARKUP) || [])[1];
    check(!!fileD && !!spriteD && fileD === spriteD,
      "the sprite's TIERFORM mark is the path sprites/logo.svg holds — that file is the "
      + "provenance record for artwork that is not Google's, and a copy nothing renders "
      + "is a copy nothing else would catch drifting");
    /* Stripped in the sprite so currentColor decides; kept in the standalone
       file, which has no page around it to inherit from. */
    const spriteSym = (/<symbol id="i-logo"[\s\S]*?<\/symbol>/.exec(MARKUP) || [""])[0];
    check(spriteSym && !/\bfill="/.test(spriteSym),
      "and the sprite copy carries no fill of its own, so both homes colour it from CSS");
    check(/\bfill="#[0-9A-Fa-f]{6}"/.test(logo),
      "while sprites/logo.svg keeps its literal fill — it is opened on its own, with no "
      + "currentColor to inherit");
    /* Only the standalone file needs its own accessible name — a standalone
       mark opened directly is an image with a name, not decoration. Once
       embedded, that name would be redundant, so the two EMBEDDED uses (the
       About mark and the tab icon) must stay silent instead. */
    check(/<svg[^>]*\brole="img"/.test(logo)
       && /<title[^>]*>[^<]*TIERFORM[^<]*<\/title>/.test(logo)
       && /aria-labelledby="title"/.test(logo),
      "sprites/logo.svg names itself — role=img plus a <title> the label points at");
    check(/GitHub and the Invertocat are trademarks of GitHub, Inc\./.test(about)
       && about.includes('https://docs.github.com/en/site-policy/other-site-policies/github-logo-policy')
       && /no affiliation or endorsement is implied\./.test(about),
      "About gives the GitHub mark a trademark acknowledgement and no-endorsement statement");
    check(/GitHub Invertocat/.test(notice) && /GitHub, Inc\./.test(notice)
       && /github-logo-policy/.test(notice),
      "NOTICE carries the GitHub trademark and policy notice");
    check(/box\.classList\.toggle\("about-open", name === "about"\)/.test(SCRIPT),
      "only About switches the shared Info dialog to the centred identity layout");
    check(/about:\s*\{title:"About",\s*doc:"#infoAboutDoc"\}/.test(SCRIPT),
      "the redesigned pop-out keeps the concise About title");
    check(/\.about-open \.about-notices-title\{[^}]*font-size:10\.5px;[^}]*font-weight:700;[^}]*letter-spacing:\.06em;[^}]*text-transform:uppercase/.test(CSS),
      "Notices & licences keeps the all-caps group-heading treatment");
    /* It heads a left-aligned column of notices, so it is left over them; the
       hero above it is where the dialog's centring lives. */
    check(/\.about-open \.about-notices-title\{[^}]*text-align:left/.test(CSS),
      "…and is aligned with the notices it heads, not with the hero above them");
    /* Section 1 (TIERFORM itself) is not a third-party notice, so the heading
       dropped "Third-party" — checked against the markup, not just the CSS
       rule's selector name, since renaming the class without renaming the
       text (or vice versa) would leave one half stale. */
    check(about.includes('<h4 class="about-notices-title">Notices &amp; licences</h4>'),
      "the heading text itself reads \"Notices & licences\", not \"Third-party notices & licences\"");
    /* The markup carries no release-number literal at all — VERSION is the
       only source, written into .about-version by script. A literal typed
       directly into this <p> would be a second copy that could silently
       drift from VERSION. Guarded in both directions — an empty <p>, and
       exactly one writer — because either half alone still leaves room for
       a second copy. `id="appVersion"` stays rejected: the hook is the
       class that is already there.

       One requirement per check(), not six &&-ed into one condition: a
       literal typed back into the markup, the write site deleted, a second
       write site added, and VERSION itself reverted are four structurally
       different breakages, and a single combined condition would report the
       same sentence for all of them — true or false, with nothing about
       which. The count of writers is named in its own message because none
       and two are one clause but two different bugs. */
    const versionWrites = (SCRIPT.match(/\$\("\.about-version"\)\.textContent\s*=\s*"Version "\s*\+\s*VERSION\b/g) || []).length;
    check(about.includes('<p class="about-version"></p>'),
      "the About version element is emitted as an empty <p class=\"about-version\"></p>");
    check(!/about-version[^>]*>[^<]/.test(about),
      "and nothing sits between its tags in the markup — a version literal there would be a second copy VERSION could drift from");
    check(versionWrites === 1,
      "exactly one line writes VERSION into .about-version — found " + versionWrites);
    check(/const VERSION = "2026\.8";/.test(SCRIPT),
      "VERSION itself holds the current release, 2026.8");
    check(!/id="appVersion"/.test(about),
      "About needs no id=\"appVersion\" hook in the markup — the class already there is the hook");
    check(!/appVersion/.test(SCRIPT),
      "and the script names no appVersion either");
    /* The Apache sentence and its link belong in the first notice paragraph
       below, not the hero — so the hero's .about-copy is scoped narrowly
       here (not the whole About slice, which still says "Licensed under the
       Apache License" in that first notice) and must carry neither the
       sentence nor the link, only the bare copyright line. */
    const copyAt = about.indexOf('class="about-copy"');
    const copyEnd = copyAt >= 0 ? about.indexOf('</p>', copyAt) + 4 : -1;
    const aboutCopy = copyAt >= 0 && copyEnd > copyAt ? about.slice(copyAt, copyEnd) : "";
    check(aboutCopy.includes('© 2026 Christian J. Heinze'),
      "the hero's about-copy still states the bare copyright line");
    check(!/Licensed under the Apache License/.test(aboutCopy),
      "…but carries no Apache licence sentence — that sentence lives in the first notice below");
    check(!aboutCopy.includes('apache.org/licenses/LICENSE-2.0'),
      "…nor the licence link that went with it");

    /* The notices below the hero are four full sections plus a closing
       line. Each heading is checked for presence on its own, and their order
       together in one check, since presence and order are two different
       claims — a heading present but out of order would satisfy four
       presence checks and fail only the order one. */
    const headings = ['TIERFORM and the TIERFORM logo', 'Open Sans', 'GitHub Invertocat', 'Material Symbols'];
    for(const h of headings){
      check(about.includes('<b>' + h + '</b>'),
        "About's notices carry the \"" + h + "\" section heading");
    }
    const headingPositions = headings.map(h => about.indexOf('<b>' + h + '</b>'));
    check(headingPositions.every((p, i) => i === 0 || p > headingPositions[i - 1]),
      "…in the order TIERFORM, Open Sans, GitHub Invertocat, Material Symbols — found at "
      + JSON.stringify(headingPositions));

    check(aboutFlat.includes('Use it, modify it, sell it, fork it.'),
      "the TIERFORM section states the licence permits selling and forking it");
    check(aboutFlat.includes('Passing this file on is redistribution: the licence and the notices '
      + 'on this page travel with it.'),
      "…and that passing the file on is redistribution, so this page has to travel with it");
    check(aboutFlat.includes('the font may not be sold on its own'),
      "the Open Sans section states the OFL's first redistribution condition — not sold on its own");
    check(aboutFlat.includes('may not be shipped under the name “Open Sans”.'),
      "…and its second — a modified copy may not keep the name “Open Sans”");
    check(about.includes('href="https://openfontlicense.org"') && about.includes('openfontlicense.org'),
      "…and links the OFL text itself");
    check(aboutFlat.includes('Google’s name and trademarks are not used to imply any affiliation '
      + 'with or endorsement of TIERFORM.'),
      "the Material Symbols section states Google's marks are not used to imply affiliation "
      + "with or endorsement of TIERFORM");
    check(about.includes('A summary of what the licenses say, not legal advice.'),
      "the notices end with the not-legal-advice disclaimer");

    /* The trademark sentence pair, held here as a literal so the app and
       NOTICE are compared through a second source rather than against each
       other's substrings — a change that moved both together would still
       satisfy an about.includes(notice-slice) style check. */
    const trademarkSentence = "TIERFORM and the TIERFORM logo are trademarks of "
      + "Christian J. Heinze. No trademark licence is granted under the Apache License; "
      + "see Section 6.";
    check(aboutFlat.includes(trademarkSentence),
      "About states the trademark claim verbatim in the TIERFORM notice");
    check(noticeFlat.includes(trademarkSentence),
      "…and NOTICE states the identical sentence — the literal above is the second source "
      + "the two are checked against, not each other");

    /* The flag closes the whole document: a small single-line Flag of Europe
       plus "Designed and developed in Europe", after .about-notices and
       before infoAboutDoc's own closing tag — never inside .about-notices,
       whose :last-child styling assumes the not-legal-advice line is last
       there. Placement is checked positionally, not just by presence, since
       a stray about-made dropped anywhere in the doc would satisfy an
       includes() check alone. */
    const noticesCloseAt = about.indexOf('</div>', about.indexOf('class="about-notices"'));
    const madeAt = about.indexOf('<p class="about-made">');
    check(noticesCloseAt > 0 && madeAt > noticesCloseAt,
      "the about-made line sits after .about-notices' own closing div, not inside it");
    const madeBlock = (/<p class="about-made">[\s\S]*?<\/p>/.exec(about) || [""])[0];
    check(!!madeBlock && madeAt >= 0 && madeBlock.length > 0,
      "the about-made paragraph is readable as one block");
    check(/<svg class="about-flag"[^>]*\baria-hidden="true"/.test(madeBlock),
      "…opens with a silent, decorative flag — the sentence beside it carries the meaning");
    check(/<\/svg>\s*Designed and developed in Europe\s*<\/p>$/.test(madeBlock),
      "…and closes with the sentence itself, right after the flag");
    const afterMade = madeAt >= 0 ? about.slice(madeAt + madeBlock.length) : "";
    check(/^\s*<\/div>\s*$/.test(afterMade),
      "…and is the last content in infoAboutDoc — nothing follows it before the doc's own "
      + "closing </div> — got " + JSON.stringify(afterMade));

    /* The flag artwork is OWN-DRAWN (a rendition of the published Council of
       Europe geometric spec), so — like the TIERFORM mark and unlike the
       GitHub Invertocat — it earns no NOTICE entry, but it still follows the
       sprite folder's provenance pattern: it cannot be a <symbol> (a
       two-colour flag cannot honour the no-own-fill rule every symbol is
       held to), so its provenance record is a standalone file in sprites/,
       compared here in full — fill AND d, every path, not just the first —
       exactly the two-writer check the Invertocat gets. */
    const extractPaths = svg => {
      const re = /<path[^>]*\bfill="([^"]*)"[^>]*\bd="([^"]*)"/g;
      const out = [];
      let m;
      while((m = re.exec(svg || ""))) out.push([m[1], m[2]]);
      return out;
    };
    const flagSvg = (/<svg class="about-flag"[\s\S]*?<\/svg>/.exec(about) || [""])[0];
    const eu = readFile(here() + "sprites/eu-flag.svg");
    const flagPaths = extractPaths(flagSvg);
    const euPaths = extractPaths(eu);
    check(flagPaths.length > 0 && euPaths.length > 0 && flagPaths.length === euPaths.length
       && flagPaths.every((p, i) => (euPaths[i] || [])[0] === p[0] && (euPaths[i] || [])[1] === p[1]),
      "the inline About flag matches sprites/eu-flag.svg in full, path by path, fill and d — "
      + "that file is the provenance record for the flag artwork, the same pattern the GitHub "
      + "mark uses, not an approximation of it");
    /* Literals held here as a second source, so both copies drifting TOGETHER
       (which the byte-match above cannot catch) still fails — the same
       both-writers guard the trademark sentence gets above. */
    check(flagPaths.length === 2,
      "the flag is exactly two paths, the blue field and the star path — found " + flagPaths.length);
    check((flagPaths[0] || [])[0] === "#003399" && (flagPaths[1] || [])[0] === "#FFCC00",
      "…field then stars, in the Council of Europe's own colours #003399 then #FFCC00 — got "
      + JSON.stringify(flagPaths.map(p => p[0])));
    check((flagPaths[0] || [])[1] === "M0 0H810V540H0Z",
      "…the field's own path is the literal M0 0H810V540H0Z — got " + JSON.stringify((flagPaths[0] || [])[1]));
    const starD = (flagPaths[1] || [])[1] || "";
    const starMs = (starD.match(/M/g) || []).length;
    const starZs = (starD.match(/Z/g) || []).length;
    check(starMs === 12, "…twelve stars, twelve M commands in the star path — found " + starMs);
    check(starZs === 12, "…each star closes its own subpath, twelve Z commands — found " + starZs);

    /* Small and single-line: the two dimensions that keep the flag from
       reading as a graphic element in its own right, and the row that keeps
       it centred under the notices like the rest of the About footer. */
    const aboutFlagRule = /\.about-flag\{([^}]*)\}/.exec(CSS);
    check(aboutFlagRule && /width:18px/.test(aboutFlagRule[1]) && /height:12px/.test(aboutFlagRule[1]),
      "the flag stays a small single line at 18×12 (the flag's own 2:3 ratio) — got "
      + JSON.stringify(aboutFlagRule && aboutFlagRule[1]));
    const aboutMadeRule = /\.about-made\{([^}]*)\}/.exec(CSS);
    check(aboutMadeRule && /justify-content:center/.test(aboutMadeRule[1]),
      "…and the line it sits in is centred like every other element in About — got "
      + JSON.stringify(aboutMadeRule && aboutMadeRule[1]));
  }

  /* The Bug report document exists because the app travels as one file: someone
     who was emailed it has no repository, so the reporting route and the one
     instruction that matters have to be in here. Two things are pinned.

     The first is the route itself — the advisory URL, and that this is the only
     document naming it, since a second copy is how one of them goes stale.

     The second is the difference between this link and About's, which looks
     like an inconsistency and is not: About embeds its path inline because the
     Invertocat is a trademark that must be GitHub's own file reproduced
     verbatim, while this one is an ordinary Material symbol and references the
     sprite. Asserted in both directions — a <use> here and no inline path —
     because "tidying" it into a second inline copy would satisfy either half
     alone. The rel/target guarantee is not restated here: §4f already reads
     EVERY external <a> in the markup, which is the check that covers a link
     nobody has thought of yet.
     The sprite reference is read out of the document rather than out of the
     button in the ribbon: the two are separate writers of the same id, and the
     ribbon button is asserted above, in the four-way listing. */
  {
    const CSS  = (/<style>([\s\S]*?)<\/style>/.exec(MARKUP) || ["", ""])[1];
    const at   = modal.indexOf('id="infoBugDoc"');
    const end  = modal.indexOf('id="infoAboutDoc"', at);
    const bug  = at >= 0 && end > at ? modal.slice(at, end) : "";
    const advisory = "https://github.com/chrisjohe/tierform/security/advisories/new";
    const link = /<a class="info-link"[\s\S]*?<\/a>/.exec(bug);

    check(!!link, "the Bug report document carries the advisory link");
    check(link && link[0].includes('href="' + advisory + '"'),
      "and it points at the repository's private-advisory form: " + advisory);
    check((MARKUP.split(advisory).length - 1) === 1,
      "which is written in exactly one place in the app — found "
      + (MARKUP.split(advisory).length - 1) + " copies");
    check(link && /aria-label="[^"]+"/.test(link[0])
       && />\s*Report a vulnerability\s*<\/span>/.test(link[0]),
      "the advisory link has a clear accessible and visible purpose");
    check(link && link[0].includes('<use href="#i-frame-bug"/>'),
      "its icon comes from the sprite, written out in full — it is an ordinary "
      + "Material symbol, not a trademark that has to be reproduced verbatim");
    /* A pair, not two independent claims: the two Bug-report icons are
       DIFFERENT symbols now (the advisory link's frame-bug artwork versus the
       Start ribbon button's own bug-report artwork), read from their two
       separate homes in the same assertion — a swap between the two would
       leave each half's own literal check green if it only compared against
       itself, since the two sites never otherwise talk to each other. */
    const startBugBtn = /<button class="[^"]*"[^>]*data-cmd="infoBug"[\s\S]{0,200}?<\/button>/.exec(MARKUP);
    check(link && link[0].includes('<use href="#i-frame-bug"/>')
       && startBugBtn && startBugBtn[0].includes('<use href="#i-bug-report"/>'),
      "the advisory link draws #i-frame-bug and the Start ribbon's Bug report "
      + "button keeps #i-bug-report — asserted as a pair so neither can "
      + "silently take the other's icon");
    check(link && !/<path\b/.test(link[0]),
      "and carries no inline path of its own — that is About's rule, and only "
      + "About's, because the Invertocat must be the file GitHub supplies");

    /* It is the one filled button in a document of prose, and it is centred like
       the buttons in every modal foot. Being inline-flex it is only as wide as
       its label, so the alignment can come from nowhere but the paragraph around
       it — which is why both halves are asserted: either one alone centres
       nothing. */
    check(/<p class="info-link-row"><a class="info-link"/.test(bug),
      "the advisory link's own paragraph is what positions it");
    check(/\.info-doc p\.info-link-row\{[^}]*text-align:center/.test(CSS),
      "…and that paragraph centres it, as the modal feet centre theirs");

    /* The prose the document exists to deliver. The strip-first instruction is
       the reason it travels with the file at all; the SECURITY.md pointer is
       what keeps this from becoming a second copy of that document. */
    check(/strip any real names and photos first/.test(bug),
      "the document tells a reporter to strip real names and photos before attaching a roster");
    check(/<code>SECURITY\.md<\/code>/.test(bug),
      "and points at SECURITY.md for the full account rather than repeating it");
    check(/described under <b>Privacy<\/b>/.test(bug),
      "what happens when you open someone else's roster is referenced, not repeated — "
      + "that paragraph stays in Privacy");
    check(/bug:\s*\{title:"Bug report",\s*doc:"#infoBugDoc"\}/.test(SCRIPT),
      "INFO_DOCS titles it \"Bug report\" — the first two-word title in this dialog");
    /* .modal h3 is what keeps it off the close X, and it is only now that a
       title is long enough for that to matter. */
    check(/\.modal h3\{[^}]*padding-right:26px\}/.test(CSS),
      "and .modal h3 still clears 26px on the right, so the longer title cannot "
      + "run under the close X");
  }

  /* Read-only: nothing in the Info tab may leave an undo step or a dirty flag. */
  {
    const open = /function openInfo\(name\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!open, "openInfo() is readable");
    check(open && !/commit\(|edit\(|state\./.test(open[0]),
      "openInfo touches no state — showing a dialog is not a document change");
  }
}

/* --------------------- 4o. the title bar is a mark-and-word lockup */

/* The mark sits beside the wordmark, and what is centred in the bar is the
   pair, not the word alone. Collapsing that back into a single element is an
   easy "simplification" that would look almost right, which is why the
   shape is pinned rather than just the icon's presence: .wordmark is
   optically centred by `letter-spacing` plus a `text-indent` cancelling the
   trailing gap after the final M, and both are properties of a block with
   text in it. Put the <svg> inside it, or give it `display:flex`, and the
   word drifts by half a letter-space with nothing else on the page changing. */
{
  const css = /<style>([\s\S]*?)<\/style>/.exec(MARKUP);
  const CSS = css ? css[1] : "";
  const from = MARKUP.indexOf('<div class="tb-top">');
  const bar = from >= 0 ? MARKUP.slice(from, MARKUP.indexOf('<div class="rb-tabs"', from)) : "";
  const rule = n => ((new RegExp("\\." + n + "\\{([^}]*)\\}").exec(CSS) || [])[1] || "");
  const wm = rule("wordmark"), tb = rule("tb-brand"), tm = rule("tb-mark");

  check(/<svg class="tb-mark" aria-hidden="true"><use href="#i-logo"\/><\/svg>/.test(bar),
    "the title bar draws the mark from the sprite's one symbol, and states nothing else "
    + "on the element — no name beside a word that already spells the product, and no "
    + "colour or size smuggled in as an attribute");
  check(/<div class="tb-brand">\s*<svg class="tb-mark"[^>]*>[\s\S]*?<\/svg>\s*<div class="wordmark">/
      .test(bar),
    "mark and word are SIBLINGS in one .tb-brand row, mark first — the mark inside "
    + ".wordmark is the change this section exists to catch");
  check(/<div class="wordmark">TIERFORM<\/div>/.test(bar),
    "and .wordmark still holds the word and nothing else");

  check(/letter-spacing:\.34em/.test(wm),
    ".wordmark keeps its letter-spacing");
  check(/text-indent:\.34em/.test(wm),
    "and the matching text-indent that cancels the gap the last letter's spacing leaves — "
    + "one without the other is a word sitting half a letter-space off centre");
  check(!/display:\s*(inline-)?flex/.test(wm),
    "and it is not a flex container: text-indent does not apply to one, so the "
    + "compensation would silently stop working");

  check(/display:flex/.test(tb) && /justify-content:center/.test(tb),
    ".tb-brand is the row that centres the lockup");
  check(/\bflex:1\b/.test(tb),
    "and it is what fills the bar between the two 150px sidebars");
  check(!/\bflex:1\b/.test(wm),
    "which .wordmark gave up — left on both, the word would grow to fill the row and "
    + "the mark would sit at its left edge instead of beside it");

  /* Colour. The bar states white-on-brand once and the mark inherits it, so a
     new --brand cannot leave a hard-coded white behind on one element. */
  check(/\.titlebar\{[^}]*background:var\(--brand\)[^}]*color:#fff/.test(CSS),
    "the bar is the one place white-on-brand is written down");
  check(tm !== "" && !/#[0-9A-Fa-f]{3,8}\b/.test(tm) && !/\bwhite\b/.test(tm)
     && !/\bfill:(?!currentColor\b)/.test(tm),
    "and the mark states no colour of its own — it takes the bar's ink through "
    + "currentColor rather than repeating the literal");

  /* Size and position, both stated relative to the WORD rather than the bar. */
  const em     = Number((/font-size:(\d+(?:\.\d+)?)px/.exec(wm) || [])[1]);
  const indent = Number((/text-indent:(\.\d+|\d+(?:\.\d+)?)em/.exec(wm) || [])[1]);
  const mirror = Number((/margin-left:(\d+(?:\.\d+)?)px/.exec(tm) || [])[1]);
  const height = Number((/height:(\d+(?:\.\d+)?)px/.exec(tm) || [])[1]);
  check(em > 0 && height > 0 && height <= em,
    "the mark is sized to the word's height, not the 44px bar's — .tb-mark is "
    + height + "px against a " + em + "px wordmark");
  const px = n => (n > 0 ? Math.round(n * 100) / 100 + "px" : "nothing");
  check(em > 0 && indent > 0 && mirror > 0 && Math.abs(mirror - em * indent) < 0.05,
    "and its left margin mirrors the wordmark's text-indent (" + (indent > 0 ? indent + "em" : "unstated")
    + " at " + px(em) + " = " + px(em * indent) + "), which is what keeps the lockup's ink "
    + "centred once the word's box has that indent inside its left edge — .tb-mark says "
    + px(mirror));
}

/* ------------------------------ 4o2. the tab icon is that lockup in a square */

/* The tab icon cannot draw the sprite: a data: URI is its own document and
   reaches no symbol in the page around it, so the mark's path is written out a
   second time inside the icon. That copy has no reader who would notice it
   drifting — nothing on screen changes when the tab icon goes wrong — so every
   part of it is answered here from a second writer: the path, its frame and its
   canvas from the sprite, the tile from --brand, the ink from the title bar's
   own white-on-brand rule. */
{
  const css = /<style>([\s\S]*?)<\/style>/.exec(MARKUP);
  const CSS = css ? css[1] : "";
  const link = (/<link\b[^>]*\brel="icon"[^>]*>/.exec(MARKUP) || [""])[0];
  check(!!link, "the document declares a tab icon at all — without one the browser shows "
    + "the generic page glyph and the product has no mark where a user looks for it");
  check(!!link && MARKUP.indexOf(link) < MARKUP.indexOf("</head>"),
    "…in the head, where a link element is honoured");
  const href = (/\bhref="([^"]*)"/.exec(link) || [])[1] || "";
  check(/^data:image\/svg\+xml,/.test(href) && /\btype="image\/svg\+xml"/.test(link),
    "…as an inline SVG data URI, declared as one — an icon fetched from anywhere else is "
    + "the request this app promises never to make");
  check(href !== "" && !/[<>]/.test(href),
    "…with its angle brackets percent-encoded: written raw, the icon is markup to every "
    + "regex that scans this file, and §6's tag-balance scan reads an attribute as a tag");
  const svg = decodeURIComponent(href.replace(/^data:image\/svg\+xml,/, ""));

  const spriteD  = (/<symbol id="i-logo"[\s\S]*?<path[^>]*\bd="([^"]+)"/.exec(MARKUP) || [])[1];
  const iconD    = (/<path[^>]*\bd='([^']+)'/.exec(svg) || [])[1];
  check(!!spriteD && iconD === spriteD,
    "the tab icon's path is the sprite's mark, character for character — the two copies of "
    + "the artwork in this file must stay one drawing");
  const spriteRule = (/<symbol id="i-logo"[\s\S]*?<path[^>]*\bfill-rule="([^"]+)"/.exec(MARKUP) || [])[1];
  const iconRule   = (/<path[^>]*\bfill-rule='([^']+)'/.exec(svg) || [])[1];
  check(!!spriteRule && iconRule === spriteRule,
    "…under the sprite's own fill-rule, which is what cuts the hollow out of the mark: "
    + "the same path filled the other way is a solid triangle");
  const spriteTr = (/<symbol id="i-logo"[\s\S]*?<path[^>]*\btransform="([^"]+)"/.exec(MARKUP) || [])[1];
  const iconTr   = (/<path[^>]*\btransform='([^']+)'/.exec(svg) || [])[1];
  const spriteG  = (/<symbol id="i-logo"[^>]*><g transform="([^"]+)"/.exec(MARKUP) || [])[1];
  const iconG    = (/<g transform='([^']+)'/.exec(svg) || [])[1];
  check(!!spriteTr && iconTr === spriteTr && !!spriteG && iconG === spriteG,
    "…inside the sprite's own frame, group translate and path matrix both — the path's "
    + "coordinates are upside down and offset without them, and the flip is the only thing "
    + "standing the mark on its base");
  const spriteVB = (/<symbol id="i-logo"[^>]*\bviewBox="([^"]+)"/.exec(MARKUP) || [])[1];
  const iconVB   = (/<svg[^>]*\bviewBox='([^']+)'[^>]*\bx='/.exec(svg) || [])[1];
  check(!!spriteVB && iconVB === spriteVB,
    "…on the sprite's own canvas: the inner svg states the symbol's viewBox, and any other "
    + "one crops the mark or shrinks it inside the tile");

  /* The one place white-on-brand is written down is .titlebar (§4o pins that
     rule); the tab icon is that bar in a square, so it takes both values from
     it rather than restating a colour of its own. */
  const brandHex = (/--brand:(#[0-9A-Fa-f]{3,6})\b/.exec(CSS) || [])[1];
  const tileFill = (/<rect[^>]*\bfill='([^']+)'/.exec(svg) || [])[1];
  check(!!brandHex && tileFill === brandHex,
    "the tile behind the mark is --brand itself (" + brandHex + ") — the chrome colour, "
    + "never the chart's accent, and never a hex that outlives a change to it");
  const barInk   = (/\.titlebar\{[^}]*\bcolor:(#[0-9A-Fa-f]{3,6})\b/.exec(CSS) || [])[1];
  const markFill = (/<path[^>]*\bfill='([^']+)'/.exec(svg) || [])[1];
  check(!!barInk && markFill === barInk,
    "and the mark takes the ink the title bar draws it in (" + barInk + ") — the icon is "
    + "that lockup squared, and it reads on a dark tab strip because of it");
}

/* ------------------------------------------- 4m. people move vertically in Roster */
{
  const row  = /function personRow\(p\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  const menu = /function personMenuBody\(p\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!row && !!menu, "the row and the menu it opens are both readable");
  if(menu){
    check(/act:"up"[\s\S]{0,220}?label:upMove\.label[\s\S]{0,140}?icon\("#i-up"\), "Move up"/.test(menu[0]),
      "the menu's first reorder item is labelled and drawn as Move up");
    check(/act:"down"[\s\S]{0,220}?label:downMove\.label[\s\S]{0,140}?icon\("#i-down"\), "Move down"/.test(menu[0]),
      "the menu's second reorder item is labelled and drawn as Move down");
    /* `who` comes through the same resolver the row's caret uses, so the
       person-specific name survives rather than becoming a bare "Move up". */
    check(/moveAffordance\(p, -1, who\), downMove = moveAffordance\(p, 1, who\)/.test(menu[0]),
      "the menu names the person in those labels");
    check(!/icon\("#i-left"\)|icon\("#i-right"\)|Move left|Move right/.test(menu[0]),
      "person actions borrow no horizontal grade-order language");
    check(/disabled:upMove\.disabled/.test(menu[0]) && /disabled:downMove\.disabled/.test(menu[0])
       && !/disabled:i===/.test(menu[0]),
      "the menu's moves take their enabled state from moveTarget, not the group index");
    check(/title:upMove\.title, label:upMove\.label/.test(menu[0])
       && /title:downMove\.title, label:downMove\.label/.test(menu[0]),
      "and expose both the tooltip and the person-specific accessible name");
    /* Four items, and every one of them announced as a menu item — a .menu of
       plain buttons is a box of buttons to a screenreader. */
    const items = ["edit", "up", "down", "del"].map(v => menu[0].indexOf('act:"' + v + '"'));
    check(items.every(i => i >= 0) && items[0] < items[1] && items[1] < items[2] && items[2] < items[3],
      "Edit details, Move up, Move down, Remove — in that order");
    check((menu[0].match(/role:"menuitem"/g) || []).length === 4,
      "…each one a menuitem, all four of them");
  }
  /* The row itself: three children, and the only one that does anything is the
     caret. Stated as an inventory rather than one absence at a time, so a
     control added back to the row fails here whatever it is called. */
  if(row){
    check((row[0].match(/act:"/g) || []).length === 1 && /act:"menu"/.test(row[0]),
      "the row emits exactly one verb, and it is the caret's");
    check((row[0].match(/el\("button"/g) || []).length === 1,
      "…and it is the row's only button, so the thumbnail and the name are surface "
      + "rather than targets and take no tab stop");
    check(!/el\("input"/.test(row[0]),
      "the row holds no input at all: the name is typed in the dialog now");
    check(/cls:"p-name"[\s\S]{0,120}?text:personRowName\(p\)/.test(row[0]),
      "the name is text, and it comes from personRowName rather than a second fallback here");
    check(/"aria-hidden":"true"/.test(row[0]),
      "the thumbnail is hidden from the accessibility tree — the name beside it already says who");
    check(/"aria-haspopup":"menu"/.test(row[0]) && /"aria-expanded":"false"/.test(row[0])
       && /"aria-controls":"personMenu"/.test(row[0]),
      "the caret says what it opens and starts collapsed, so the state it exposes is not a lie");
    check(/icon\("#i-caret"\)/.test(row[0]),
      "and it draws the same caret the ribbon's and the grade chip's do");
  }
  check(/\.p-row\{[\s\S]*?grid-template-columns:32px minmax\(0,1fr\) auto/.test(MARKUP)
     && !/grid-template-columns:32px minmax\(0,1fr\) auto auto/.test(MARKUP),
    "the row is three columns now — avatar, name, caret — not five");
  /* A name too long for a 300px panel gets the app's one answer, the same one
     .g-name and .gmenu-head b give. Compared against .g-name's own declaration
     rather than against a copy written here, so a project that changed its mind
     about clipping changes it in one place. */
  {
    /* Anchored on the line start and the sheet's own indent. Unanchored, a
       compound selector mentioning the class — `.p-row .p-name{cursor:grab}` —
       matches first and the rule being read is whichever one happens to come
       earlier in the file. */
    const pn = /\n  \.p-name\{([^}]*)\}/.exec(MARKUP);
    const gn = /\n  \.g-name\{([^}]*)\}/.exec(MARKUP);
    check(!!pn && !!gn, "both name rules are readable");
    const clip = s => (s.match(/overflow:hidden|text-overflow:ellipsis|white-space:nowrap/g) || []).sort();
    check(pn && gn && clip(pn[1]).length === 3 && clip(pn[1]).join("|") === clip(gn[1]).join("|"),
      "a name too wide for the row is clipped with an ellipsis on one line, exactly as "
      + "a grade's name is — got " + (pn && clip(pn[1]).join(", ")));
  }

  /* The arrows now cross grade boundaries, so what the button promises, what the
     history records and what the array does are three separate statements about
     one rule. They are kept honest by all asking moveTarget — which is only true
     while it has one definition and no fourth reader open-coding the boundary. */
  check((SCRIPT.match(/function moveTarget\(id, dir\)\{/g) || []).length === 1,
    "moveTarget is defined exactly once");
  const readers = (SCRIPT.match(/moveTarget\(/g) || []).length - 1;   // less the definition
  check(readers === 3, "moveTarget has exactly three readers, not a fourth copy of the rule");
  check(/function moveAffordance\(p, dir, who\)\{[\s\S]*?moveTarget\(p\.id, dir\)/.test(SCRIPT),
    "the tooltip, accessible name and enabled state come from one resolver call");
  check(/function moveLabel\(id, dir\)\{[\s\S]*?moveTarget\(id, dir\)/.test(SCRIPT)
     && /function movePerson\(id, dir\)\{\s*const want = moveTarget\(id, dir\);/.test(SCRIPT),
    "the undo label and the mutation ask the same question the button did");
  /* Naming the destination is the whole point of the crossing case: an arrow
     that silently changes someone's grade is the accident this must not be. */
  check(/title:"Move " \+ word \+ " — to " \+ dest/.test(SCRIPT)
     && /label:"Move " \+ who \+ " " \+ word \+ ", to " \+ dest/.test(SCRIPT),
    "a boundary-crossing arrow says which grade it would move the person to");
  check(/commit\(moveLabel\(id, dir\), \(\)=>movePerson\(id, dir\)\)/.test(SCRIPT),
    "the history entry is resolved before the move, while the old grade is still current");

  /* Accessible names are written by the render that builds a row, and the name
     field is in a dialog and the things it names are behind it — so they are
     repaired in place instead. What makes that safe is what syncRowIdentity does
     NOT do: it must not commit, it must not re-render, and it must not touch the
     field being typed into. */
  const relabel = /function syncRowIdentity\(p\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!relabel, "syncRowIdentity is readable");
  if(relabel){
    check(!/\b(commit|edit|snapshot|markDirty|endEdit)\s*\(/.test(relabel[0]),
      "relabelling changes no document state — it is a repair, not an edit");
    check(!/\b(renderRoster|renderAll|render|fill|personRow|personMenuBody|syncEditPhoto)\s*\(/.test(relabel[0]),
      "and rebuilds nothing — a rebuild would take the caret out of the field being typed in");
    /* The dialog's four fields are static markup with ids, so they are not
       reachable through this at all — but a future hand could add them, and the
       Name field's own label must never become person-derived. */
    check(!/#editName|#editGroup|#editRole|#editTier/.test(relabel[0]),
      "it does not reach for the dialog's own fields, whose labels are not person-derived");
    check(/moveAffordance\(p, -1, who\)\.label/.test(relabel[0])
       && /moveAffordance\(p,  1, who\)\.label/.test(relabel[0]),
      "the move items get their name from moveAffordance, so the destination grade stays in one place");
    /* The USE, not the declaration. This read the string being BUILT, and
       cutting `sel + mine` down to `sel` left the declaration in place and the
       test green — an assertion answered by a line the mutation never touched. */
    check(/document\.querySelector\(sel \+ mine\)/.test(relabel[0])
       && /\[data-id="' \+ p\.id \+ '"\]/.test(relabel[0]),
      "every control is found by the person's id, never by position");
    check(/personLabel\(p\)/.test(relabel[0]),
      "and the name itself still comes from personLabel");
    /* the visible half of the rule, both pieces of it: the row shows initials
       and a line of text, and both lag a rename the same way. The thumbnail is
       written only where it is text — with a photo it holds an <img>, and
       assigning textContent over that deletes the image. */
    check(/if\(thumb && !src\) thumb\.textContent = initials\(p\.name\);/.test(relabel[0]),
      "the thumbnail's initials are refreshed, and only where there is no photo to destroy");
    check(/line\.textContent = personRowName\(p\)/.test(relabel[0]),
      "the row's line of text is refreshed too, from the same writer personRow used");
    check(!/toUpperCase\(\)|\.split\(|\.charAt\(|\[0\]\[0\]/.test(relabel[0]),
      "and neither is re-derived here — initials() and personRowName() are the rules");
  }
  /* the call site: after the edit, in the handler for the field being typed in */
  check(/\$\("#editName"\)\.addEventListener\("input", e=>\{[\s\S]{0,320}?syncRowIdentity\(p\);/.test(SCRIPT),
    "the dialog's name handler relabels the row behind it after committing the keystroke");
  check((SCRIPT.match(/syncRowIdentity\(/g) || []).length === 2,
    "syncRowIdentity has one definition and one caller");
}

/* --------------------- 4m4. what a person's photo can do besides exist
   Three things about one dialog. Behaviour — that the four photo fields clear
   together and one undo brings them all back — is driven through the real
   click handler in test/document.js §5d; what is guarded here is the markup
   and the wiring, which that suite cannot see. */
{
  const panel  = /function framePanel\(subj\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  const body   = /function editPhotoBody\(p\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  const facts  = /\[data-fact\]"\);[\s\S]*?\n\}\);/.exec(SCRIPT);
  const menu   = /function personMenuBody\(p\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!panel && !!body, "framePanel and the section that chooses between its two states are readable");
  check(!!facts, "the framing click handler is readable");

  /* --- 1. Remove photo --- */
  if(panel){
    check(/fact:"remove"/.test(panel[0]),
      "the framing editor offers a way back to initials");
    check(/cls:"danger", fact:"remove", did:subj\.key,[\s\S]{0,200}?\[icon\("#i-delete"\), "Remove photo"\]/.test(panel[0]),
      "…as a destructive-styled button reading Remove photo");
    /* Order is the argument: it sits with the other two things you can do to a
       picture you already have, after replacing it. */
    const order = ["reset", "replace", "remove"].map(v => panel[0].indexOf('fact:"' + v + '"'));
    check(order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2],
      "Reset framing, Replace photo, Remove photo — in that order");
    check(/label:"Remove " \+ who \+ "'s photo, leaving " \+ who \+ "'s initials"/.test(panel[0]),
      "…and its accessible name says what is left behind, so it is not confused "
      + "with the button that removes the person");
  }
  if(facts){
    /* THE assertion of this batch. A photo is four fields — photo, pw, ph and
       frame — and photoFields is the one place that knows it. Clearing p.photo
       by hand leaves the other three pointing at a picture that is gone, and
       every one of them is read by the layout. */
    check(/if\(act==="remove"\)\{[\s\S]{0,200}?\(\)=>applyPhoto\(p, null\)\)/.test(facts[0]),
      "remove goes through applyPhoto(p, null) — the pair that knows a photo is four fields");
    check(!/p\.photo\s*=|p\.pw\s*=|p\.ph\s*=|p\.frame\s*=\s*null/.test(facts[0]),
      "…and no branch writes any photo field by hand beside it");
    const rm = /if\(act==="remove"\)\{[\s\S]*?\n  \}/.exec(facts[0]);
    check(rm && !/\{render:/.test(rm[0]),
      "it takes the default render scope — the photo section has to be rebuilt, so "
      + "the editor goes and the initials take its place");
    check(rm && /commit\(/.test(rm[0]) && !/askConfirm|ask\(/.test(rm[0]),
      "and it commits without asking, as removing the whole person already does");
    /* Removing the photo destroys the button that was pressed, and every other
       control in the section with it. Focus left on the body while a modal is
       open is a hole in the trap: trapTab only fires on a keydown inside the
       dialog, so Tab from there walks out of it. */
    check(rm && /\$\("#editPhoto"\)\.querySelector\("button:not\(\[disabled\]\)"\)/.test(rm[0])
       && /\.focus\(\)/.test(rm[0]),
      "…and it puts focus back inside the dialog afterwards, on whatever the section now holds");
  }

  /* --- 2. the section has two states, and only #editPhoto swaps --- */
  if(body){
    check(/if\(p\.photo\) return framePanel\(\{key:p\.id, src:p\.photo, pw:p\.pw, ph:p\.ph, frame:p\.frame, who:who\}\)/.test(body[0]),
      "with a photo the section IS the framing editor — built by the one "
      + "shared framePanel, no second copy of it");
    check(/cls:"np-circle"[\s\S]{0,120}?text:initials\(p\.name\)/.test(body[0]),
      "without one it is the initials circle, lettered by initials()");
    check(/act:"photo", did:p\.id,[\s\S]{0,200}?\[icon\("#i-add-photo"\), "Add photo"\]/.test(body[0]),
      "…beside the one way to change that");
    /* The same action has the same face in both dialogs — plain bordered
       chrome, like Reset/Replace photo, not the borderless ghost the rest of
       this dialog uses. Asserted against the literal emitted call, not
       merely "no cls:\"ghost\"", the same pattern the Add dialog's identical
       button is held to. */
    check(/el\("button", \{act:"photo", did:p\.id,/.test(body[0]),
      "Add photo (Edit dialog) carries no cls at all — plain button chrome, "
      + "the same face the Add dialog's Add photo has, not the ghost "
      + "look the rest of this dialog uses");
    check(/label:"Add a photo for " \+ who/.test(body[0]),
      "…which names whose photo it would be");
    /* step B: the circle itself is a real control, not decoration behind
       the button beside it — same verb, same id, its own accessible name. */
    const circleTag = /el\("button", \{type:"button", cls:"np-circle", act:"photo", did:p\.id,[\s\S]{0,160}?label:"Add a photo for " \+ who, text:initials\(p\.name\)\}\)/.exec(body[0]);
    check(!!circleTag,
      "the placeholder circle is itself a real button, carrying act:\"photo\" "
      + "and did:p.id like the button beside it");
    check(circleTag && !/aria-hidden/.test(circleTag[0]),
      "…and carries no aria-hidden — it is a control now, not decoration");
  }
  check(/function syncEditPhoto\(p\)\{\s*fill\(\$\("#editPhoto"\), \[editPhotoBody\(p\)\]\);/.test(SCRIPT),
    "swapping states fills #editPhoto alone — the dialog around it is not rebuilt, "
    + "so a name being typed above survives a photo being removed below");
  check(/function syncEditPhoto\(p\)\{[\s\S]*?if\(p\.photo\) syncFramePreview\(p\);/.test(SCRIPT),
    "…and re-places the preview image, which is positioned from JS and would otherwise "
    + "snap to its natural size in the corner");

  /* --- 3. the bin, and the one route behind both of them --- */
  if(menu){
    check(/act:"del"[\s\S]{0,200}?icon\("#i-delete"\), "Remove"/.test(menu[0]),
      "the menu's person-removal item carries the bin");
    check(!/icon\("#i-close"\)/.test(menu[0]),
      "…and not the cross, which means dismiss-this everywhere else in the app");
  }
  {
    /* Removing a person shares the foot row with Done, rather than sitting
       in its own ruled-off region above it; the markup and CSS for that
       split are checked in full in §4m6, this only re-confirms the bin it
       carries is the same one the row menu's item draws. */
    const btn = /<button class="danger foot-start" id="editRemoveBtn">[\s\S]*?<\/button>/.exec(MARKUP);
    check(!!btn, "the dialog's own Remove person button is readable");
    check(btn && btn[0].indexOf('<use href="#i-delete"/>') > 0,
      "…carrying the same bin the menu's item does");
  }
  /* One function, two callers, and nothing else in the file may remove a person:
     two copies would be two labels in the undo list for one act. */
  check((SCRIPT.match(/function removePerson\(id\)\{/g) || []).length === 1,
    "removePerson is defined exactly once");
  check((SCRIPT.match(/removePerson\(/g) || []).length === 3,
    "…and reached from exactly two places — the menu's Remove and the dialog's Remove person");
  check(/function removePerson\(id\)\{[\s\S]*?commit\("removed "\+\(first \|\| "the person"\)/.test(SCRIPT),
    "both therefore leave the same history entry");
  {
    /* The rule stated over the class rather than at the two call sites: any
       other filter of state.people that drops one id is a second removal route,
       whatever it is called. */
    const drops = (SCRIPT.match(/state\.people\s*=\s*state\.people\.filter\(x\s*=>\s*x\.id\s*!==/g) || []);
    check(drops.length === 1,
      "and nothing else in the app takes a person out of the roster by id — found "
      + drops.length + " such writes");
  }

  /* --- 4. the row's retired verbs are gone, not merely unused --- */
  for(const dead of ["toggle", "done"]){
    check((SCRIPT.match(new RegExp('\\bact:"' + dead + '"', "g")) || []).length === 0
       && (SCRIPT.match(new RegExp('\\bfact:"' + dead + '"', "g")) || []).length === 0
       && (SCRIPT.match(new RegExp('act===\\"' + dead + '\\"', "g")) || []).length === 0,
      'no "' + dead + '" verb is left anywhere — the expanding row is gone, not hidden');
  }
  check(!/\bexpandedId\b|function collapseRow|function expandRow|function personDetail/.test(SCRIPT),
    "and neither is the state or any of the three functions that drove it");
}

/* --------------------- 4m5. the row's caret opens the app's one kind of popup

   Not a second popup mechanism. The grade chip's caret and the row's caret open
   the same shape of thing in the same way: one element reused by whichever
   anchor is open, an id saying which, and place/sync/close in three functions of
   the same three shapes. What could NOT carry over is the ribbon's own machinery
   — RIBBON_MENUS pairs a menu with a button by fixed id, and a row's caret has
   neither a fixed id nor a fixed existence, since renderRoster throws every one
   of them away. So the anchor is resolved from the person's id at the moment it
   is needed, exactly as gradeChipFor resolves a chip. */
{
  check(/<div class="menu" id="personMenu" role="menu" hidden><\/div>/.test(MARKUP),
    "#personMenu is one empty element in the markup, filled by whichever caret opens it");
  /* Outside the roster panel, and outside the ribbon: renderRoster empties
     #roster on every change, and a menu built inside a row would be destroyed
     by the very move it just ran. Stated against #alerts, which is the first
     thing PAST the application shell — "after #shell and after #roster" was
     satisfied by a second copy of the element pasted anywhere later, which is
     exactly the mutation that found it. */
  check(MARKUP.indexOf('id="personMenu"') > MARKUP.indexOf('id="alerts"'),
    "…and it sits out with the dialogs, past the application shell, so nothing "
    + "that rebuilds the roster can take it with it");
  check(/\.menu\{[^}]*position:fixed/.test(MARKUP),
    "it takes .menu's fixed positioning, so nothing between it and the viewport clips it");

  /* --- the arithmetic is shared, not copied --- */
  check(/function placePopover\(pop, anchor\)\{/.test(SCRIPT),
    "there is one function that positions a popup under its anchor");
  {
    const grade  = /function placeGradePanel\(\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    const person = /function placePersonMenu\(\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!grade && !!person, "both placers are readable");
    for(const [name, m] of [["placeGradePanel", grade], ["placePersonMenu", person]]){
      if(!m) continue;
      check(/placePopover\(/.test(m[0]), name + " positions through placePopover");
      check(!/getBoundingClientRect|innerHeight|innerWidth|style\.top|style\.left/.test(m[0]),
        name + " keeps no arithmetic of its own — a second copy is how one popup "
        + "starts avoiding the bottom of the window and the other does not");
    }
  }
  /* --- opened, rebuilt and closed in the same three shapes --- */
  /* Read out of each function's OWN body. Written as one regex per pair these
     said `function openPersonMenu(id){[\s\S]*?closeGradePanel();` — and
     `[\s\S]*?` walked straight out of the function to the closeGradePanel() in
     beginGradeDrag further down the file, so deleting the real call changed
     nothing. Three of the four passed under a mutation that removed what they
     name. */
  {
    const body = n => (new RegExp("function " + n + "\\([^)]*\\)\\{[\\s\\S]*?\\n\\}")
      .exec(SCRIPT) || [""])[0];
    const person = body("openPersonMenu"), grade = body("openGradePanel"), ribbon = body("openMenu");
    check(!!person && !!grade && !!ribbon, "all three openers are readable");
    check(/closeMenu\(\);/.test(person) && /closeGradePanel\(\);/.test(person),
      "opening the row menu closes the ribbon's menus and the grade panel first");
    check(/closePersonMenu\(\);/.test(grade),
      "openGradePanel closes the row menu, so the exclusion is mutual");
    check(/closePersonMenu\(\);/.test(ribbon),
      "openMenu closes the row menu, so the exclusion is mutual");
  }
  {
    const sync = /function syncPersonMenu\(\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!sync, "syncPersonMenu is readable");
    check(sync && /if\(!personOpen\) return;/.test(sync[0]),
      "…returns at once when nothing is open, as syncGradePanel does");
    check(sync && /return closePersonMenu\(\)/.test(sync[0]),
      "…and shuts itself when the person or the caret it was anchored to has gone");
    /* Line-anchored at the function's own indent: a guarded
       `if(!…firstChild) fill(…)` satisfied the bare call and left the menu
       showing the moves that were possible before the move. */
    check(sync && /\n  fill\(\$\("#personMenu"\), \[personMenuBody\(p\)\]\);/.test(sync[0]),
      "…rebuilding the body from current state unconditionally, so a move re-reads "
      + "what is still possible");
  }
  {
    const close = /function closePersonMenu\(refocus\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!close, "closePersonMenu is readable");
    check(close && /clear\(m\)/.test(close[0]),
      "closing EMPTIES the menu — its items carry (verb, person id), and a hidden "
      + "menu still holding them would answer restoreField's and syncRowIdentity's "
      + "selectors for a person whose dialog is what is actually on screen");
    check(close && /"aria-expanded", "false"/.test(close[0]) && /if\(refocus\) caret\.focus\(\)/.test(close[0]),
      "…and hands the caret back its collapsed state and, on request, the focus");
  }
  /* --- dismissed the same way the grade panel is --- */
  check(/if\(e\.key==="Escape" && !\$\("#personMenu"\)\.hidden\)\{ closePersonMenu\(true\); return; \}/.test(SCRIPT),
    "Escape dismisses it and returns focus to the caret, exactly as it does for the grade panel");
  check(/if\(!e\.target\.closest\("#personMenu"\) && !e\.target\.closest\('\[data-act="menu"\]'\)\) closePersonMenu\(\);/.test(SCRIPT),
    "a click anywhere else dismisses it, and its own caret is left out so a second "
    + "press closes what the first opened");
  {
    const resize = /addEventListener\("resize", \(\)=>\{[\s\S]*?\}\);/.exec(SCRIPT);
    const scroll = /document\.addEventListener\("scroll", \(\)=>\{[\s\S]*?\}, true\);/.exec(SCRIPT);
    check(!!resize && !!scroll, "the resize and scroll handlers are readable");
    for(const [name, m] of [["resize", resize], ["scroll", scroll]]){
      if(!m) continue;
      check(/placeGradePanel\(\)/.test(m[0]) && /placePersonMenu\(\)/.test(m[0]),
        "the " + name + " handler re-anchors both popups rather than dismissing either — "
        + "the roster panel scrolls, and a menu that vanished whenever the list moved "
        + "under it would be unusable on a long roster");
    }
  }
  /* --- the renders that keep it, and the dialog, honest --- */
  {
    const rr = /function renderRoster\(\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!rr, "renderRoster is readable");
    check(rr && /syncPersonMenu\(\);\s*\n\s*syncEditModal\(\);/.test(rr[0]),
      "every render brings both the open menu and the open dialog up to the roster it just built");
    const at = rr ? rr[0].indexOf("syncPersonMenu()") : -1;
    const restore = rr ? rr[0].indexOf("restoreField(keepFocus)") : -1;
    check(at >= 0 && restore > at,
      "…before restoreField, or the control it wants to put the focus back in has "
      + "not been rebuilt yet");
    check(/function renderAll\(\)\{[\s\S]*?renderRoster\(\);/.test(SCRIPT),
      "and renderAll goes through renderRoster, which is what carries an undo into the dialog");
  }
  /* --- what each item does, and what it leaves open --- */
  {
    const h = /\$\("#personMenu"\)\.addEventListener\("click", e=>\{[\s\S]*?\n\}\);/.exec(SCRIPT);
    check(!!h, "the row menu's click handler is readable");
    if(h){
      check(/if\(!el \|\| el\.disabled\) return;/.test(h[0]),
        "a disabled item does nothing — Move up on the first person is not a silent no-op commit");
      check(/if\(act==="edit"\)\{\s*[\s\S]{0,300}?closePersonMenu\(true\);\s*openEditModal\(id\);/.test(h[0]),
        "Edit details closes the menu FIRST, so the caret is what modalOpen records "
        + "and hands the focus back to");
      check(/if\(act==="del"\)\{ closePersonMenu\(\); removePerson\(id\); \}/.test(h[0]),
        "Remove closes the menu and goes through the one removal route");
      const move = /if\(act==="up"\|\|act==="down"\)\{[\s\S]*?\n  \}/.exec(h[0]);
      check(!!move, "the move branch is readable");
      check(move && !/closePersonMenu/.test(move[0]),
        "a move leaves the menu open — moving somebody two places is two presses, "
        + "not two openings");
      check(move && /commit\(moveLabel\(id, dir\), \(\)=>movePerson\(id, dir\)\)/.test(move[0]),
        "…resolving the history entry before the move, while the old grade is still current");
      check(move && /focusPersonMenuItem\(act, id\)/.test(move[0]),
        "…and putting focus back on the item that was pressed, since the menu was "
        + "rebuilt underneath it");
    }
  }
  check(/function focusPersonMenuItem\(verb, id\)\{[\s\S]*?\|\| m\.querySelector\("button:not\(\[disabled\]\)"\)/.test(SCRIPT),
    "…falling back to the menu's first live item where that one came back disabled, "
    + "so focus is never left on the body with a menu open");
}

/* --------------------- 4m6. the Edit person dialog is built like the other five

   Deliberately not the Add dialog in a second mode. It is the sixth dialog, out
   of the same parts, and §4m3 above already holds its X to the same shape and
   the same close route as the other five. What is left to say is that it is
   registered like them, that its fields are the canonical ids the handlers bind
   to, and that its foot carries one button. */
{
  const at = MARKUP.indexOf('id="editModal"');
  check(at > 0, "the Edit person dialog is in the markup");
  const nextAt = MARKUP.indexOf('class="modal-backdrop"', at);
  const dlg = at > 0 ? MARKUP.slice(at, nextAt > at ? nextAt : MARKUP.length) : "";
  check(dlg.indexOf('id="pasteModal"') < 0, "and the slice is that dialog alone");

  check(/class="modal-backdrop" id="editModal" hidden/.test(MARKUP),
    "it is a .modal-backdrop and starts hidden, like every other dialog");
  check(/role="dialog"/.test(dlg) && /aria-modal="true"/.test(dlg),
    "it is a modal dialog");
  check(/aria-labelledby="editTitle"/.test(dlg) && /id="editTitle"/.test(dlg),
    "it is named by its own heading");
  check(/trapTab\("#editModal"\)/.test(SCRIPT),
    "Tab is trapped inside it, like the other five — without this, tabbing walks "
    + "out into a page the user cannot see");

  /* the fields, in the order they are asked for. Order is asserted by position,
     not by presence: a dialog that asks for the role above the name is a
     different dialog. */
  {
    const order = ["editPhoto", "editName", "editTier", "editGroup", "editRole"]
      .map(id => dlg.indexOf('id="' + id + '"'));
    check(order.every(i => i >= 0), "it has the photo section and all four fields");
    check(order.every((v, i) => i === 0 || v > order[i - 1]),
      "…photo, name, grade, group, role — in that order");
  }
  /* Each field is bound once, by id, the way every other dialog's are — and it
     is the canonical control, not a façade over one. */
  for(const id of ["editName", "editGroup", "editRole", "editTier"]){
    const binds = (SCRIPT.match(new RegExp('\\$\\("#' + id + '"\\)\\.addEventListener', "g")) || []);
    check(binds.length === 1,
      "#" + id + " has exactly one handler bound to it — got " + binds.length);
  }
  /* The foot row: Done, which is not one of Add's three — Add creates
     somebody and stays open for the next one, this changes somebody who
     exists and has nothing to apply, so there is nothing for a second button
     of Done's own kind to mean — and, sharing the row with it, Remove person:
     pinned to the row's start rather than set apart in its own region,
     bordered like Reset/Replace photo rather than the bare ghost look, red on
     hover through the shared button.danger:hover rule Clear roster uses. */
  {
    const foot = /<div class="btnrow modal-foot">([\s\S]*?)<\/div>/.exec(dlg);
    check(!!foot, "its actions use the shared .btnrow.modal-foot alignment");
    const buttons = foot ? matchAll(/<button[^>]*>/g, foot[1]) : [];
    check(buttons.length === 2, "…holding exactly two buttons — got " + buttons.length);
    check(foot && /<button class="danger foot-start" id="editRemoveBtn">/.test(foot[1]),
      "Remove person is in the foot row now, carrying the danger class for its "
      + "hover and the foot-start modifier that pins it to the start");
    /* Named separately from the structural check above: this is the one that
       has to go red on its own if "danger" alone is ever dropped from the
       class list, independent of foot-start or the exact class order. */
    check(foot && /class="[^"]*\bdanger\b[^"]*"\s+id="editRemoveBtn"/.test(foot[1]),
      "Remove person keeps the shared destructive hover — the button.danger "
      + "rule Clear roster uses");
    check(foot && !/id="editRemoveBtn"[^>]*class="[^"]*\bghost\b/.test(foot[1])
       && !/class="[^"]*\bghost\b[^"]*"\s+id="editRemoveBtn"/.test(foot[1]),
      "…and carries no .ghost — normal button chrome, like Reset/Replace photo, "
      + "not the bare icon-and-text look it had set apart from the fields");
    check(foot && /<button class="primary" id="editDoneBtn">Done<\/button>/.test(foot[1]),
      "…and Done, the primary, is still the one way out that keeps every edit");
    const order = ["editRemoveBtn", "editDoneBtn"].map(id => foot ? foot[1].indexOf('id="' + id + '"') : -1);
    check(order[0] >= 0 && order[1] >= 0 && order[0] < order[1],
      "…Remove person before Done in the markup, so tab order still reaches the "
      + "destructive action first — position:absolute does not change that");
  }
  {
    /* The mechanism behind the split: one reusable modifier, taken out of
       flow entirely, so Done's own centring cannot be affected by the pinned
       button's width at all — not "centred in the remaining space", the true
       centre a foot without Remove person would have. */
    const css = /<style>([\s\S]*?)<\/style>/.exec(MARKUP);
    const CSS = (css ? css[1] : "").replace(/\/\*[\s\S]*?\*\//g, " ");
    const footStartDefs = matchAll(/\.foot-start\s*\{/g, CSS);
    check(footStartDefs.length === 1,
      ".foot-start is defined exactly once — a reusable modifier, not a "
      + "dialog-specific rule — got " + footStartDefs.length);
    const footStartRule = /\.foot-start\{([^}]*)\}/.exec(CSS);
    check(!!footStartRule && /(?:^|;)position:absolute(?:;|$)/.test(footStartRule[1]),
      "…and it is taken out of flow — position:absolute — so it cannot "
      + "participate in the row's flex centring at all");
    check(!!footStartRule && /(?:^|;)left:0(?:;|$)/.test(footStartRule[1]),
      "…pinned to the row's own left edge");
    check(!!footStartRule && !/transform/.test(footStartRule[1]),
      "…and centred on the row's own height without a transform — the shared "
      + "button:active rule already uses one for its press effect, and a "
      + "second here would replace it instead of combining with it");
    /* .modal-foot's own centring, byte-exact: position:relative only gives
       the pinned button a containing block and changes nothing else here, so
       every other dialog's foot still centres exactly as it always has. */
    check(/\.modal-foot\{margin-top:12px;justify-content:center;position:relative\}/.test(CSS),
      "…and .modal-foot keeps its own justify-content:center exactly as "
      + "before — no alignment override, only a containing block added");
    check(!/\bedit-danger\b/.test(MARKUP),
      "no .edit-danger region exists — markup and stylesheet both name no "
      + "such region, since Remove person shares the foot row rather than "
      + "sitting apart in one");
  }
  /* Done, the X and Escape are the same act, which is the whole reason the
     dialog has no Apply and no Cancel. */
  check(/\$\("#editDoneBtn"\)\.addEventListener\("click", \(\)=>closeEditModal\(\)\)/.test(SCRIPT),
    "Done closes it through the same function the X and Escape call");
  check(!/id="edit(Apply|Cancel|Save)/.test(dlg),
    "and there is no Apply, Cancel or Save — every field committed as it changed");
}

/* --------------------- 4n-bis. Add gets a Role field too, matching Edit's ----

   Role is per-person, like Name — Add asks for it in exactly the shape Edit
   uses for #editRole, rather than a bespoke field of its own. Checked as ONE
   rule read off both dialogs, not two separate literal checks: the whole
   point is that the two must not drift apart, and a per-dialog case check
   would let a future edit change one shape without the other going red.

   Both dialogs sit the Role field inside its own <div class="add-row
   role-row">, so it takes the Grade column's width rather than the full
   row; that wrapper is folded into the SAME regex the loop below already
   shares across both dialogs, rather than a second, separate check bolted
   on beside it. */
{
  function roleFieldMatches(dlgName){
    const at = MARKUP.indexOf('id="' + dlgName + '"');
    const nextAt = MARKUP.indexOf('class="modal-backdrop"', at);
    const dlg = at > 0 ? MARKUP.slice(at, nextAt > at ? nextAt : MARKUP.length) : "";
    const re = /<div class="add-row role-row">\s*<label class="field">\s*<span>Role shown on the chart<\/span>\s*<input type="text" id="(\w+)" maxlength="200"[^>]*autocomplete="off">\s*<\/label>\s*<\/div>/g;
    return {dlg, matches: matchAll(re, dlg)};
  }
  for(const [dlgName, id] of [["addModal", "addRole"], ["editModal", "editRole"]]){
    const {dlg, matches} = roleFieldMatches(dlgName);
    check(dlg.length > 0, "#" + dlgName + " is in the markup");
    check(matches.length === 1,
      "#" + dlgName + " has exactly one Role field shaped like the shared "
      + "spec (its own .add-row.role-row wrapper, label.field, the same span "
      + "text, a maxlength=200 text input, autocomplete off) — got " + matches.length);
    check(matches.length === 1 && matches[0][1] === id,
      "…and that field's input carries id=\"" + id + "\", not a copy under a "
      + "different name");
  }

  /* The placeholder follows the grade, the same way syncEditModal's does —
     three sites have to keep it current: opening the dialog, switching the
     grade mid-dialog, and the moment after a person is added when the grade
     selection itself can carry over unchanged. */
  check(/\$\("#addTier"\)\.addEventListener\("change", syncAddRolePlaceholder\)/.test(SCRIPT),
    "changing the Grade select re-syncs the Role placeholder");

  const openAdd = /function openAddModal\(wantTier\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!openAdd, "openAddModal is readable");
  check(openAdd && /syncAddRolePlaceholder\(\)/.test(openAdd[0]),
    "…and openAddModal calls it on open, so a dialog opened for a different "
    + "grade (or by the roster heading's own +) shows THAT grade's placeholder, "
    + "not the previous one's");

  const addFn = /async function addOnePerson\(\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!addFn, "addOnePerson is readable");
  check(addFn && /syncAddRolePlaceholder\(\)/.test(addFn[0]),
    "…and addOnePerson re-syncs it after adding, since Grade persists to the "
    + "next person while Role itself is about to be cleared below");
  check(addFn && /\$\("#addRole"\)\.value = ""/.test(addFn[0]),
    "…and addOnePerson clears Role for the next person, the same as Name");

  const helper = /function syncAddRolePlaceholder\(\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!helper, "syncAddRolePlaceholder is readable");
  check(helper && /tierRole\(t\)/.test(helper[0]),
    "…and it gets the label through tierRole(t) — the single policy for what "
    + "a grade prints under someone with no role of their own");
  check(helper && !/t\.label/.test(helper[0]),
    "…not a second, competing read of t.label sitting beside it");
}

/* --------------------- 4n-ter. three refinements on the Add batch ----
   Role's width, the zero-grade hint's wording, and the extra breathing room
   around both. Static, source-level checks — the load-bearing CSS
   properties, not the whole declaration block, so an unrelated property
   added later beside them does not make this section brittle. */
{
  check(/Setting up more than the first grade\?/.test(MARKUP),
    "the zero-grade hint's sentence names the FIRST grade, not just \"more "
    + "than one\" — got no match");
  check(!/Setting up more than one grade\?/.test(MARKUP),
    "…and no second copy of that wording (\"Setting up more than one grade?\") is left behind");

  const roleRowRule = /\.role-row\{([^}]*)\}/.exec(MARKUP);
  check(!!roleRowRule, ".role-row has its own declaration block");
  check(roleRowRule && /margin-bottom:\s*16px/.test(roleRowRule[1]),
    "…and it sets margin-bottom:16px — enough to beat .modal-foot's pinned "
    + "12px margin-top in the collapse, which is what actually widens the "
    + "gap to the action buttons below Role — got "
    + JSON.stringify(roleRowRule && roleRowRule[1]));

  const hintRule = /\.add-template-hint\{([^}]*)\}/.exec(MARKUP);
  check(!!hintRule, ".add-template-hint has its own declaration block");
  check(hintRule && /margin:\s*12px 0 14px/.test(hintRule[1]),
    "…and its margin gives it breathing room on both sides — 12px above, "
    + "14px below, toward the Role row under it — got "
    + JSON.stringify(hintRule && hintRule[1]));
}

/* --------------------- 4o. one drag surface, made twice

   The row (vertical, #roster, a PERSON) and the grade chip (horizontal,
   #tiers, a GRADE) drag through one shared factory, makeDragSurface,
   configured once per instance below it — not two hand-built copies of the
   same nine event handlers. What is guarded here is that shared body — each
   rule asserted once as a class check rather than once per surface — and
   the two instantiations' own configuration: which root, which markup,
   which axis, what a drop resolves to. The event sequences that exercise
   both instances end to end are test/fixtures.js §6e–§6h; what a drop does
   to the document is test/document.js §13. */
{
  const row = /function personRow\(p\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!row, "personRow is readable");
  if(row){
    /* Only the surface. Putting draggable on .p-row would make the caret a
       drag handle, which is the division the strip makes with .g-chip-face. */
    check((row[0].match(/draggable:true/g) || []).length === 2,
      "the thumbnail and the name are the two draggable halves — got "
        + (row[0].match(/draggable:true/g) || []).length);
    /* Read across the row's own options object only — `[^}]*` stops at the
       brace that closes it. Reaching past it finds the two handles' draggable
       and answers about them instead, which is the opposite of the question. */
    check(row[0].indexOf('cls:"ghost p-menu"') > 0 && !/cls:"p-row"[^}]*draggable/.test(row[0]),
      "…and the row itself is not draggable, so a native drag cannot begin on the caret");
  }

  /* --- the factory: one function, its shared rules asserted once --- */
  const factory = /function makeDragSurface\(cfg\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!factory, "makeDragSurface is readable");
  const F = factory ? factory[0] : "";

  check((F.match(/root\.addEventListener\(/g) || []).length === 9,
    "the factory binds all nine drag events on the root it is given, once each "
    + "— got " + (F.match(/root\.addEventListener\(/g) || []).length);
  for(const event of ["dragstart","dragover","dragleave","drop","dragend",
                       "pointerdown","pointermove","pointerup","pointercancel"])
    check(new RegExp('root\\.addEventListener\\("' + event + '"').test(F),
      "…including " + event);

  const dragStart = /root\.addEventListener\("dragstart", e=>\{[\s\S]*?\n  \}\);/.exec(F);
  const dragOver  = /root\.addEventListener\("dragover", e=>\{[\s\S]*?\n  \}\);/.exec(F);
  const dragEnd   = /root\.addEventListener\("dragend", \(\)=>\{[\s\S]*?\n  \}\);/.exec(F);
  const moveFn    = /root\.addEventListener\("pointermove", e=>\{[\s\S]*?\n  \}\);/.exec(F);
  const finishFn  = /function finish\(e, cancelled\)\{[\s\S]*?\n  \}/.exec(F);
  const beginFn   = /function begin\(item\)\{[\s\S]*?\n  \}/.exec(F);
  const markDrop  = /function markDrop\(node, client\)\{[\s\S]*?\n  \}/.exec(F);
  const dropSlotFn = /function dropSlot\(\)\{[\s\S]*?\n  \}/.exec(F);
  const clearDragFn = /function clearDrag\(\)\{[\s\S]*?\n  \}/.exec(F);
  check(!!dragStart && !!dragOver && !!dragEnd && !!moveFn && !!finishFn
     && !!beginFn && !!markDrop && !!dropSlotFn && !!clearDragFn,
    "all nine bodies the class checks below read from are readable");

  /* The size, read before the hide — the vertical form of the strip's own
     width-before-hide rule, the one form both surfaces share. */
  check(beginFn && /dragSize = cfg\.axis === "x" \? item\.getBoundingClientRect\(\)\.width/.test(beginFn[0]),
    "begin measures the item along the configured axis before anything hides it");
  check(dragStart && /setTimeout\(hideDragItem, 0\)/.test(dragStart[0]),
    "…and the item is hidden a task later out of dragstart, so the measurement "
    + "and the drag image both happen while it is still in the flow");
  check(beginFn && !/classList\.add/.test(beginFn[0]),
    "…with no hide inside begin itself, which would make the order a matter "
    + "of where the call happens to sit");

  /* The target is measured before anything moves, and the gap it stands in is
     the position already chosen, not "nowhere". */
  check(markDrop && markDrop[0].indexOf("getBoundingClientRect") >= 0
     && markDrop[0].indexOf("getBoundingClientRect") < markDrop[0].indexOf("hideDragItem"),
    "markDrop measures the target BEFORE hiding it and moving the slot — both "
    + "reflow the list the pointer is being compared against");
  check(markDrop && /if\(drop && overSlot\(client\)\) return;/.test(markDrop[0]),
    "a pointer standing inside the slot changes nothing — without that the "
    + "slot flickers on and off at half of all drop positions");
  check(markDrop && /insertBefore\(dropSlot\(\), after \? aim\.item\.nextSibling : aim\.item\)/.test(markDrop[0]),
    "…and stands the slot on that side of the target, so what is drawn and "
    + "what drop carries to the drop are the one decision");

  /* The gap is sized in JS from that measurement, along whichever style
     property the axis picks, and is not hittable — both paths ask what item
     is under the pointer, and a hittable gap answers "none" at exactly the
     position being aimed at. */
  check(dropSlotFn && /slot\.style\[sizeProp\] = dragSize \+ "px"/.test(dropSlotFn[0]),
    "the slot is drawn at the measured size, not a literal");
  check(dropSlotFn && /root\.querySelector\("\." \+ cfg\.slotClass\)\s*\n\s*\|\|/.test(dropSlotFn[0]),
    "…and a slot already standing in the list is reused — a second one built at "
    + "the new position would leave the first behind at the position the "
    + "pointer just left");
  check(/\.p-drop-slot\{[^}]*pointer-events:none/.test(MARKUP)
     && /\.g-drop-slot\{[^}]*pointer-events:none/.test(MARKUP),
    "…and neither surface's slot is hittable");
  check(/\.p-row\.dragging\{display:none\}/.test(MARKUP)
     && /\.g-chip\.dragging\{display:none\}/.test(MARKUP),
    "…and the dragged item leaves the flow on both surfaces, so the gap "
    + "stands in a space rather than being added to the list's size");

  /* Ending a drag nulls the id, which is the only thing hideDragItem reads —
     that is what disarms a hide still sitting in the queue. */
  check(clearDragFn && /dragId = null/.test(clearDragFn[0]),
    "clearDrag nulls the id");
  const clearMarksFn = /function clearDropMarkers\(\)\{[\s\S]*?\n  \}/.exec(F);
  check(clearMarksFn && /slot\.remove\(\)/.test(clearMarksFn[0])
     && /classList\.remove\("dragging"\)/.test(clearMarksFn[0]),
    "clearDropMarkers takes the slot out AND puts the dragged item back — "
    + "dragleave calls only this, and an item left hidden is one that vanished");

  /* --- the four rules, once each --- */
  check(dragStart && /if\(pointer && pointer\.dragging\)\{ e\.preventDefault\(\); return; \}/.test(dragStart[0]),
    "RULE 1a: native DnD refuses a gesture the fallback already owns");
  check(moveFn && /if\(dragId && !pointer\.dragging\) return;/.test(moveFn[0]),
    "RULE 1b: the fallback refuses one native DnD already owns");

  /* RULE 2. Both halves are positional, so both are read as positions. */
  const guard = dragOver ? dragOver[0].indexOf("if(!dragId) return;") : -1;
  const pd    = dragOver ? dragOver[0].indexOf("e.preventDefault();")  : -1;
  const mark  = dragOver ? dragOver[0].indexOf("markDrop(")            : -1;
  check(guard >= 0 && pd > guard,
    "RULE 2: preventDefault sits BELOW the foreign-drag guard — the guard is "
    + "the only thing keeping a dragged file from being offered a drop on "
    + "either surface");
  check(mark > guard && pd > mark,
    "…and ABOVE nothing that returns: the drag is accepted for its whole "
    + "duration, not only where a position has been chosen");
  check(dragOver && !/return;[\s\S]*e\.preventDefault\(\)/.test(dragOver[0].slice(guard + 20)),
    "…with no early return between the two");
  const dvEff = dragOver ? dragOver[0].indexOf('dropEffect = "move"') : -1;
  check(dvEff > pd,
    "dropEffect is set alongside preventDefault rather than left behind under "
    + "a guard, or the cursor keeps the refusal preventDefault just lifted");

  /* RULE 3. The condition is about ownership, not about existence. */
  check(finishFn && /if\(dragId && !pointer\.dragging\)\{ pointer = null; return; \}/.test(finishFn[0]),
    "RULE 3: pointercancel drops the press record and leaves the native drag "
    + "it is only announcing alone");
  check(finishFn && /clearDrag\(\)/.test(finishFn[0]),
    "…while still cleaning up after a drag the fallback started itself");

  /* RULE 4, both routes to the same stale record. */
  check(dragEnd && /pointer = null;[\s\S]{0,40}clearDrag\(\)/.test(dragEnd[0]),
    "RULE 4: a native drag's end clears the press record it swallowed the "
    + "pointerup for");
  const buttons = moveFn ? moveFn[0].indexOf("if(!e.buttons)") : -1;
  const owns    = moveFn ? moveFn[0].indexOf("if(dragId && !pointer.dragging) return;") : -1;
  check(buttons > owns,
    "…and a press with no button behind it is dropped, below the ownership "
    + "check so a native drag is never torn down by what buttons reports during one");

  /* --- the two click handlers read the surface's own flag, not a module one --- */
  check(/if\(rowDragSurface\.clickSuppressed\(\)\) return;/.test(SCRIPT),
    "the roster's click handler reads the row surface's suppressed flag");
  check(/if\(gradeDragSurface\.clickSuppressed\(\)\) return;/.test(SCRIPT),
    "…and the strip's click handler reads the grade surface's");

  /* --- the two instantiations: what still differs between the surfaces --- */
  const rowInst   = /const rowDragSurface = makeDragSurface\(\{[\s\S]*?\n\}\);/.exec(SCRIPT);
  const gradeInst = /const gradeDragSurface = makeDragSurface\(\{[\s\S]*?\n\}\);/.exec(SCRIPT);
  check(!!rowInst, "rowDragSurface's instantiation is readable");
  check(!!gradeInst, "gradeDragSurface's instantiation is readable");
  const R = rowInst ? rowInst[0] : "", G = gradeInst ? gradeInst[0] : "";

  check(/root:\s*"#roster"/.test(R), "the row surface delegates from #roster");
  check(/itemSelector:\s*"\.p-row"/.test(R), "…dragging .p-row items");
  check(/slotClass:\s*"p-drop-slot"/.test(R), "…into a .p-drop-slot gap");
  check(/axis:\s*"y"/.test(R), "…moving vertically");
  check(/excludePress:\s*"\.p-menu"/.test(R), "…except a press that begins on the caret");
  check(/onBegin:\s*closePersonMenu/.test(R), "…closing the person menu on the way in");
  check(/onDrop:\s*reorderPerson/.test(R), "…and naming reorderPerson on a drop");
  check(/\.closest\("\.th"\)/.test(R)
     && /rows\[rows\.length-1\], after:true\}/.test(R)
     && /querySelectorAll\("\.p-row:not\(\.dragging\)"\)/.test(R),
    "…and its resolveAim aims a heading at the LAST .p-row:not(.dragging) of "
    + "its group, after it — which is what the end of a grade means, and "
    + "needs no case of its own in reorderPerson");

  check(/root:\s*"#tiers"/.test(G), "the grade surface delegates from #tiers");
  check(/itemSelector:\s*"\.g-chip"/.test(G), "…dragging .g-chip items");
  check(/slotClass:\s*"g-drop-slot"/.test(G), "…into a .g-drop-slot gap");
  check(/axis:\s*"x"/.test(G), "…moving horizontally");
  check(/excludePress:\s*"\.g-chip-toggle"/.test(G), "…except a press that begins on the caret");
  check(/onBegin:\s*closeGradePanel/.test(G), "…closing the grade panel on the way in");
  check(/onDrop:\s*reorderGrade/.test(G), "…and naming reorderGrade on a drop");

  /* --- the drop entry point, and the one thing it must not become --- */
  check(/function reorderPerson\(sourceId, targetId, after\)\{/.test(SCRIPT),
    "reorderPerson takes reorderGrade's three arguments, so the two drop systems "
    + "can be read side by side");
  {
    const rp = /function reorderPerson\(sourceId, targetId, after\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!rp, "reorderPerson is readable");
    check(rp && /commit\(label, \(\)=>\{/.test(rp[0]),
      "one commit wraps the whole walk, so a drop is one undo step");
    check(rp && (rp[0].match(/commit\(/g) || []).length === 1,
      "…and exactly one, not one per step");
    check(rp && /moveLabelTo\(sourceId, dest\)/.test(rp[0])
       && rp[0].indexOf("moveLabelTo") < rp[0].indexOf("commit("),
      "…labelled from the DESTINATION and resolved before the mutation");
    check(rp && /walkOnce\(p,/.test(rp[0]) && !/splice|state\.people\s*=\s*\[/.test(rp[0]),
      "…and it drives movePerson rather than rewriting state.people itself");
    /* The counter has to be FINITE and it has to guard BOTH loops. Written as
       a presence test this passed under `let fuel = Infinity` — the two strings
       were still there — and .test() is satisfied by either loop carrying the
       guard while the other spins. The bound is the only thing between a defect
       in the stepping and a hang, so it is read as a value and as a count. */
    check(rp && (rp[0].match(/--fuel < 0/g) || []).length === 2,
      "…bounded on BOTH loops — got "
        + (rp ? (rp[0].match(/--fuel < 0/g) || []).length : 0) + " guarded");
    check(rp && /let fuel = state\.people\.length \+ state\.tiers\.length/.test(rp[0]),
      "…from a count of the roster, so the bound cannot be made infinite");
    check(rp && /restore\.order/.test(rp[0]) && /p\.tierId = restore\.tierId/.test(rp[0]),
      "…and both halves of the person's position are put back if it is ever reached");
  }
  /* THE constraint that shaped all of it: a fourth statement of where a person
     may go is a fourth thing to keep in step. §4m pins the count; this names
     why reorderPerson does not add to it. */
  check(!/function reorderPerson[\s\S]*?moveTarget\(/.test(
          (/function reorderPerson\(sourceId, targetId, after\)\{[\s\S]*?\n\}/.exec(SCRIPT) || [""])[0]),
    "reorderPerson asks moveTarget nothing — it steps movePerson, which asks it, "
    + "so the resolver still has exactly three readers");

  /* --- the sentence has one writer --- */
  {
    const to = /function moveLabelTo\(id, destTier\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    const by = /function moveLabel\(id, dir\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!to && !!by, "both label functions are readable");
    check(to && /"moved " \+ first \+ " to " \+ gradeName\(destTier\)/.test(to[0]),
      "moveLabelTo holds the wording");
    check(by && /moveLabelTo\(id,/.test(by[0]) && !/"moved "/.test(by[0]),
      "…and moveLabel delegates to it rather than keeping a second copy");
    check(by && /moveTarget\(id, dir\)/.test(by[0]),
      "…resolving a direction into a destination on the way");
  }
}

/* --------------------- 4o2. Groups: the second dimension's one management
   surface (Structure ▸ Group). A group is created only by free text
   elsewhere (Add/Edit, paste, CSV) and swept by pruneGroups when its last
   member leaves; this dialog reorders and renames the entities already
   there and creates or deletes none itself. */
{
  /* --- the command and its one button --- */
  const groupBtns = matchAll(/data-cmd="groups"/g, MARKUP);
  check(groupBtns.length === 1,
    "exactly one element carries data-cmd=\"groups\" — got " + groupBtns.length);
  check(/\bgroups:\s*\(\)=>openGroupModal\(\)/.test(SCRIPT),
    "groups is in COMMANDS and opens the dialog");
  const groupBtnTag = /<button class="[^"]*"\s*data-cmd="groups"[\s\S]*?<\/button>/.exec(MARKUP);
  check(!!groupBtnTag, "the Group button is readable");
  check(groupBtnTag && groupBtnTag[0].indexOf('<use href="#i-circles"/>') > 0,
    "…and its icon href is the full literal #i-circles, not built by concatenation");
  check(groupBtnTag && groupBtnTag[0].indexOf("and as the rows of the Matrix layout") > 0,
    "…and its tooltip names Matrix's rows too, the one other place the second dimension is drawn — got "
    + JSON.stringify(groupBtnTag && groupBtnTag[0]));

  /* --- the "2D" badge: ONE literal, worn on two faces — the Group button
     and the Matrix menu row are the two places a chart's second dimension
     shows up in the ribbon, and neither "2D" may be able to drift from the
     other. Comparing both sites against a shared literal (rather than
     restating the regex per site) is what makes that true. */
  const BADGE_2D = '<span class="badge-2d" aria-hidden="true">2D</span>';
  check((MARKUP.match(/\.badge-2d\{/g) || []).length === 1,
    ".badge-2d is defined exactly once in the stylesheet");
  check(groupBtnTag && groupBtnTag[0].indexOf(BADGE_2D) > 0,
    "…and the Group button face carries the shared badge literal");
  const matrixMenuRow = /<button role="menuitemradio" aria-checked="false" data-style-select="layout" data-value="matrix"[\s\S]*?<\/button>/.exec(MARKUP);
  check(!!matrixMenuRow, "the Matrix menu row is readable");
  check(matrixMenuRow && matrixMenuRow[0].indexOf(BADGE_2D) > 0,
    "…and the Matrix menu row carries the SAME badge literal, not a second copy of \"2D\"");

  /* --- the modal: ids exist and are referenced --- */
  check(/<div class="modal-backdrop" id="groupModal" hidden>/.test(MARKUP),
    "#groupModal is in the markup, starting hidden like every other dialog");
  check(/<div id="groupList"><\/div>/.test(MARKUP),
    "#groupList is an empty container at boot — syncGroupModal fills it, "
    + "and a panel destroyed mid-rebuild must not take a nested control with it");
  check(/id="groupTitle">Groups</.test(MARKUP), "#groupTitle names the dialog");
  check(/aria-labelledby="groupTitle"/.test(MARKUP), "the dialog is named by its heading");
  check(/id="groupDoneBtn"/.test(MARKUP), "#groupDoneBtn is in the markup");
  check(/\$\("#groupDoneBtn"\)\.addEventListener\("click", \(\)=>closeGroupModal\(\)\)/.test(SCRIPT),
    "Done is wired to close the dialog");
  check(/id="groupEmpty"/.test(MARKUP), "#groupEmpty is in the markup");
  check(/No groups yet\. People get one in the Add and Edit dialogs, or from the Group column of a pasted list or CSV\./.test(MARKUP),
    "the empty-state sentence is stated exactly, for the zero-groups case only");

  /* --- syncGroupModal: the ONE list builder, guarded against a missing
     state.groups the way pruneGroups is --- */
  const sync = /function syncGroupModal\(\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!sync, "syncGroupModal is readable");
  check(sync && /if\(!Array\.isArray\(state\.groups\)\) return;/.test(sync[0]),
    "…tolerant of a missing state.groups, so a hand-built test state cannot throw it");
  check(sync && /\$\("#groupEmpty"\)\.hidden = groups\.length > 0/.test(sync[0]),
    "…the empty sentence shows only at zero groups");
  check(sync && /fill\(\$\("#groupList"\), groups\.map\(/.test(sync[0]),
    "…and the list is rebuilt through fill(), one call, not appended to");
  check(!/syncGroupModal\(\);/.test((/function renderAll\(\)\{[\s\S]*?\n\}/.exec(SCRIPT) || [""])[0])
     && !/syncGroupModal\(\);/.test((/function renderRoster\(\)\{[\s\S]*?\n\}/.exec(SCRIPT) || [""])[0]),
    "syncGroupModal is not wired into renderAll or renderRoster — it runs on "
    + "open and after this dialog's own commits only, never on every render");

  /* --- the row: name, count, and the three actions --- */
  const row = /function groupRow\(g, i, total\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!row, "groupRow is readable");
  check(row && /cls:"grp-row", did:g\.id/.test(row[0]),
    "each row carries the group's id on .grp-row, like a person row's .p-row");
  check(row && /cls:"grp-name", did:g\.id, draggable:true/.test(row[0]),
    "the name is the draggable handle, mirroring .p-name's own draggable:true, did: pattern");
  check(row && /cls:"grp-count", text:String\(n\)/.test(row[0]),
    "the count is the bare number — nothing precedes it in the row, so no separator dot");
  check(row && /const n = state\.people\.filter\(p => p\.groupId === g\.id\)\.length/.test(row[0]),
    "…counted live off state.people, not a cached list");
  for(const act of ["up", "down", "rename"])
    check(new RegExp('act:"' + act + '", did:g\\.id').test(row[0]),
      "…the " + act + " control carries the group's id");
  check(row && /disabled:first/.test(row[0]) && /disabled:last/.test(row[0])
     && /first = i === 0, last = i === total - 1/.test(row[0]),
    "the first row's Up and the last row's Down are disabled");
  /* Rename is icon-only, like Up/Down beside it. Its
     href must be the full literal, never built by concatenation, and it
     carries both a short title (sighted users, since the face lost its
     word) and the full aria-label the merge/rename tests already drive. */
  check(row && /act:"rename", did:g\.id, title:"Rename"/.test(row[0]),
    "the rename control carries a title, since its face is icon-only now");
  check(row && row[0].indexOf('[icon("#i-edit")]') > 0,
    "…and its icon href is the full literal #i-edit, not built by concatenation");
  check(row && !/\["Rename"\]/.test(row[0]),
    "…with no text face left behind beside the icon");

  /* --- moveGroup: one commit, refuses out of range silently --- */
  const move = /function moveGroup\(id, dir\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!move, "moveGroup is readable");
  check(move && /if\(j < 0 \|\| j >= state\.groups\.length\) return false;/.test(move[0])
     && move[0].indexOf("return false") < move[0].indexOf("commit("),
    "an out-of-range move is refused BEFORE any commit — commit() always "
    + "snapshots, so refusing after it would still add empty history");
  check(move && /commit\("moved group " \+ name/.test(move[0]),
    "a real move is one commit");

  /* --- renameGroup: plain rename vs. case-insensitive merge --- */
  const rename = /async function renameGroup\(id\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!rename, "renameGroup is readable");
  check(rename && /if\(asked === null \|\| asked === undefined\) return false;/.test(rename[0]),
    "cancelled adds no commit");
  check(rename && /if\(!trimmed \|\| trimmed === g\.label\) return false;/.test(rename[0]),
    "empty-after-trim or textually unchanged adds no commit");
  check(rename && /x\.id !== id[\s\S]{0,40}x\.label\.toLowerCase\(\) === norm/.test(rename[0]),
    "the merge candidate search excludes the group being renamed, so renaming "
    + "a group to its own label case-differently is a plain rename, not a self-merge");
  check(rename && /state\.people\.forEach\(p => \{ if\(p\.groupId === id\) p\.groupId = hit\.id; \}\)/.test(rename[0]),
    "a merge repoints every person of the renamed group to the survivor");
  check(rename && !/state\.groups\.splice|state\.groups = state\.groups\.filter/.test(rename[0]),
    "…and never removes the source entity by hand — pruneGroups, run inside "
    + "every commit, is the only thing that may do that");
  check(rename && /commit\("merged group " \+ g\.label \+ " into " \+ hit\.label/.test(rename[0])
     && /commit\("renamed group " \+ g\.label \+ " to " \+ trimmed/.test(rename[0]),
    "merge and plain rename are each exactly one commit");

  /* --- reorderGroupRow: the same shape as reorderGrade, for the same reason --- */
  const reorderRow = /function reorderGroupRow\(sourceId, targetId, after\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!reorderRow, "reorderGroupRow is readable");
  check(reorderRow && /sourceId === targetId/.test(reorderRow[0])
     && /if\(insertAt === from\) return false;/.test(reorderRow[0]),
    "self-drops and drops back into the same slot do nothing");
  check(reorderRow && /commit\("moved group " \+ name/.test(reorderRow[0])
     && (reorderRow[0].match(/commit\(/g) || []).length === 1,
    "a real drop is exactly one commit");
  check(reorderRow && /syncGroupModal\(\);/.test(reorderRow[0]),
    "…and the list is resynced afterwards, since nothing else redraws this dialog");

  /* --- the third drag surface: same factory, same class checks from §4o,
     its own configuration pinned the same way rowInst/gradeInst are --- */
  const groupInst = /const groupDragSurface = makeDragSurface\(\{[\s\S]*?\n\}\);/.exec(SCRIPT);
  check(!!groupInst, "groupDragSurface's instantiation is readable");
  const D = groupInst ? groupInst[0] : "";
  check(/root:\s*"#groupList"/.test(D), "the group surface delegates from #groupList");
  check(/itemSelector:\s*"\.grp-row"/.test(D), "…dragging .grp-row items");
  check(/slotClass:\s*"p-drop-slot"/.test(D),
    "…into the SAME .p-drop-slot gap the roster uses — it is a generic dashed "
    + "placeholder, not roster-specific, so the two surfaces share it");
  check(/axis:\s*"y"/.test(D), "…moving vertically");
  check(/excludePress:\s*"button"/.test(D),
    "…except a press that begins on any of the row's three buttons");
  check(/onDrop:\s*reorderGroupRow/.test(D), "…and naming reorderGroupRow on a drop");
  check(/if\(groupDragSurface\.clickSuppressed\(\)\) return;/.test(SCRIPT),
    "the list's click handler reads the group surface's own suppressed flag, "
    + "not a module-level one");
}

/* ------------------------------------------------- 4n. the Grades strip is chips */

/* Nine controls per grade cannot sit on the strip at once — seven grades of
   that would overflow sideways and clip a third row against the ribbon's
   fixed height — so the controls live in a panel a chip opens instead.
   Three things have to hold for that to be an improvement rather than a
   hiding place: the chip carries nothing editable, the panel carries
   everything, and the panel is dismissed by every path that can strand it. */
{
  /* --- the strip */
  check(/function gradeChip\(/.test(SCRIPT), "gradeChip() builds the strip");
  check(/fill\(\$\("#tiers"\), state\.tiers\.length\s*\?\s*state\.tiers\.map\(gradeChip\)/.test(SCRIPT),
    "and renderRoster fills #tiers with one per grade when any exist");
  const chip = /function gradeChip\(t\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!chip, "gradeChip is readable");
  if(chip){
    check(/tact:"open"/.test(chip[0]),
      'the chip emits the one verb it has, data-tact="open"');
    for(const v of ["code","label","role","fill","align","attach","merge","up","down","del"]){
      check(!new RegExp('tact:"' + v + '"').test(chip[0]),
        'the chip does NOT emit data-tact="' + v + '" — that control belongs in the panel');
    }
    check(/"aria-haspopup":"dialog"/.test(chip[0]),
      "the chip says it opens a dialog, not that it navigates");
    check(/"aria-expanded":"false"/.test(chip[0]),
      "and starts collapsed, so the state it exposes is not a lie");
    check(/draggable:true/.test(chip[0]),
      "each current-grade chip is natively draggable");
    check(/if\(o\.draggable\) n\.draggable = true/.test(SCRIPT),
      "the element builder writes the live draggable property, not just decoration");
    check(/const dragHelp = \$\("#gradeDragHelp"\)/.test(chip[0])
       && /"aria-describedby":dragHelp \? dragHelp\.id : "gradeDragHelp"/.test(chip[0]),
      "and points to the keyboard-alternative instructions");
    /* The split, which is the point: two targets, two tooltips, one verb. A
       single button doing both jobs would let the same gesture either
       reorder the strip or open the panel, depending on how far the pointer
       drifted before release. */
    check(/cls:"g-chip", did:t\.id/.test(chip[0]),
      "the chip itself is the wrapper — it carries the id the drag code reads");
    check(/cls:"big g-chip-face", draggable:true/.test(chip[0]),
      "the face is the drag handle");
    check(!/g-chip-face[\s\S]{0,120}?tact:/.test(chip[0]),
      "and carries no verb, so clicking it cannot also open the panel");
    check(/title:"Drag to reorder"/.test(chip[0]) && /title:"Grade settings"/.test(chip[0]),
      "each half says which of the two things it is for");
    check(!/Drag to reorder · Click for settings/.test(chip[0]),
      "and no tooltip needs to explain both actions at once — each half has its own title");
    const toggleAt = chip[0].indexOf('cls:"split-toggle g-chip-toggle"');
    check(toggleAt >= 0, "the caret half is Save's split-toggle");
    check(/tact:"open"/.test(chip[0].slice(toggleAt)),
      "and it is the half carrying data-tact=\"open\"");
    check(/href="#i-caret"/.test(chip[0]) || /icon\("#i-caret"\)/.test(chip[0]),
      "the caret is the affordance for that dialog");
    /* A chip face is a .big box, not a lookalike. Sharing the class is what puts
       the grade's name on the same pixel row as "Add grade"'s label — restating
       the metrics instead would drift the moment either is touched. */
    check(/cls:"big g-chip-face"/.test(chip[0]),
      "the face carries .big, so it inherits the lead button's height, gap and padding");
    check(/button\.big, \.g-chip-face\{/.test(MARKUP),
      "…by riding along in button.big's own rule rather than copying its values");
  }
  /* the CSS side of the same claim */
  {
    const css = /\.g-chip\{[\s\S]*?\}/.exec(MARKUP);
    check(!!css, ".g-chip is styled");
    check(css && /width:118px/.test(css[0]),
      "every chip is the same fixed width, so the strip is not ragged");
    check(css && /display:flex/.test(css[0]) && /align-items:stretch/.test(css[0]),
      "and it lays its two halves out side by side at equal height, the way .split does");
    const face = /\.g-chip > \.g-chip-face\{[\s\S]*?\}/.exec(MARKUP);
    check(!!face, "the face has its own overrides");
    check(face && !/padding:/.test(face[0]) && !/height:/.test(face[0]),
      "which do NOT restate padding or height — .big's are what keep the labels aligned");
    check(face && /cursor:grab/.test(face[0]),
      "the pointer advertises that a current grade can be dragged");
    check(/\.g-chip > \.g-chip-face:active\{cursor:grabbing\}/.test(MARKUP),
      "the pointer says grabbing while a chip is being pressed");
    check(/\.g-chip\.dragging\{display:none\}/.test(MARKUP),
      "the dragged chip leaves the flow, so the strip closes up behind it and the "
      + "slot can stand in the gap it will land in");
    check(!/\.g-chip\.dragging\{[^}]*opacity/.test(MARKUP),
      "…and is not merely faded in place — fading alone would leave its old "
      + "position visually claimed while the slot already showed the order "
      + "it is about to become");
    /* The insertion point is a box standing in the strip, not a rule drawn
       down the edge of the neighbour it will land beside. */
    const slotCss = /\.g-drop-slot\{[\s\S]*?\}/.exec(MARKUP);
    check(!!slotCss, "the insertion point has a rule of its own");
    check(slotCss && /pointer-events:none/.test(slotCss[0]),
      "which cannot be hit — both drag paths ask what .g-chip is under the pointer, "
      + "and a hittable slot answers none of them at exactly the position being aimed at");
    check(slotCss && /dashed/.test(slotCss[0]) && /background:transparent/.test(slotCss[0]),
      "it is drawn as a dashed outline with no fill, so it reads as a gap and not as "
      + "a chip that is already there");
    check(slotCss && !/(^|[;{])\s*width:/.test(slotCss[0]),
      "and states no width of its own: gradeDropSlot() writes the dragged chip's, so "
      + "the strip does not change total width when a chip is taken out of it");
    const code = /\.g-code\{[\s\S]*?\}/.exec(MARKUP);
    check(code && /height:26px/.test(code[0]),
      "the code badge is 26px, the same slot button.big gives its icon — any other "
      + "height moves every name on the strip off the lead's");
    check(/button\.big \.ic\{width:26px;height:26px\}/.test(MARKUP),
      "…which is the height it has to match");
    const nm = /\.g-name\{[\s\S]*?\}/.exec(MARKUP);
    check(nm && /text-overflow:ellipsis/.test(nm[0]) && /white-space:nowrap/.test(nm[0]),
      "a name too long for the fixed width is cut with an ellipsis, not wrapped or "
      + "allowed to widen its chip");
    /* The same cascade trap a bare class rule always risks: the face is a
       DIV, so .g-chip-face is 0,1,0 — which
       loses to button.big's 0,1,1 on every property the two share, silently.
       Each face rule therefore has to either ride along inside button's own rule
       (no conflict possible: it IS that rule) or be qualified by the chip to
       reach 0,2,0. A bare .g-chip-face{...} would be outranked and do nothing. */
    const CSS = (/<style>([\s\S]*?)<\/style>/.exec(MARKUP) || ["", ""])[1];
    const cssOnly = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const faceSelectors = (cssOnly.match(/[^{}]*\.g-chip-face[^{}]*\{/g) || [])
      .map(s => s.replace(/\{$/, "").replace(/\s+/g, " ").trim());
    check(faceSelectors.length >= 4,
      "the face is styled in the shared button rules and its own — got "
      + JSON.stringify(faceSelectors));
    for(const sel of faceSelectors){
      const shared = /^button[^,]*, \.g-chip-face/.test(sel);
      const qualified = sel.split(",").every(part =>
        part.indexOf(".g-chip-face") < 0 || /\.g-chip[ .>]/.test(part.trim()));
      check(shared || qualified,
        'the face rule "' + sel + '" rides along in button\'s own rule or is '
        + 'qualified by .g-chip — a bare .g-chip-face is outranked by button.big');
    }
    /* The wrapper is a div, so nothing element-qualified competes with it
       and it stays a plain class — unlike the face, which sits inside
       button's own rule. */
    check(!/button\.g-chip/.test(MARKUP),
      "and no button.g-chip rule is left behind, pointing at an element that is gone");
  }

  /* --- zero grades: the strip names itself, instead of staying blank */
  {
    const rr = /function renderRoster\(\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!rr, "renderRoster is readable");
    check(rr && /cls:"tiers-empty"/.test(rr[0]),
      "the zero-grade case is its own class, tiers-empty — never .g-chip, so "
      + "drag paths, chip counts and this section's own delegated listener "
      + "cannot mistake it for a grade");
    check(rr && !/cls:"tiers-empty g-chip"|cls:"g-chip tiers-empty"/.test(rr[0]),
      "…and is never combined with .g-chip on the same element");
    const PLACEHOLDER = "No grades yet. Add one, or apply a template.";
    check(rr && rr[0].indexOf(PLACEHOLDER) >= 0,
      "the placeholder states the exact wording — " + JSON.stringify(PLACEHOLDER));
    /* el() only writes aria-label from o.label — the placeholder must pass
       neither that nor a raw aria-hidden attribute, so a screenreader reads it */
    const ph = /el\("p", \{cls:"tiers-empty"[^}]*\}\)/.exec(rr && rr[0] || "");
    check(!!ph, "the placeholder element is readable");
    check(ph && !/label:|attrs:/.test(ph[0]),
      "…and carries no aria-label or attrs — in particular no aria-hidden, so "
      + "a screenreader reads the state");

    /* the muted look: one rule shared with the roster's own .empty paragraph,
       read from the app's real stylesheet rather than a JS property, the way
       §6e/§6g elsewhere in this suite settle pointer-events and display from
       the sheet instead of assuming them. */
    const shared = /\.empty,\.tiers-empty\{([^}]*)\}/.exec(MARKUP);
    check(!!shared, "one rule styles both .empty and .tiers-empty");
    check(shared && shared[1].indexOf("color:var(--mute)") >= 0
       && shared[1].indexOf("font-size:12.5px") >= 0,
      "…carrying the literal declarations the roster's own .empty rule uses, "
      + "not a lookalike copy — got " + JSON.stringify(shared && shared[1]));
    check(/\.tiers-empty\{[^}]*pointer-events:none/.test(MARKUP),
      "the placeholder cannot be hit — both grade-strip drag paths ask what "
      + ".g-chip is under the pointer, and a hittable placeholder answers "
      + "none of them at exactly the position being aimed at");
  }

  const body = /function gradePanelBody\(t, i\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!body, "gradePanelBody() builds what the chip opens");
  if(body){
    for(const v of ["code","label","fill","align","attach","merge","up","down","del"]){
      check(new RegExp('tact:"' + v + '"').test(body[0]),
        'every control the card had survived the move: data-tact="' + v + '"');
    }
    /* Reorder buttons say Left/Right (the chips are a row) but keep the verbs
       up/down (the array order is what the chart reads top-down). */
    check(/icon\("#i-left"\)/.test(body[0]) && /icon\("#i-right"\)/.test(body[0]),
      "reordering is drawn as left and right, matching the strip");
    check(/tact:"up"[\s\S]{0,400}?icon\("#i-left"\)/.test(body[0]),
      'the "up" verb is the one drawn as Left — swapping them reverses move()');
    check(/tact:"down"[\s\S]{0,400}?icon\("#i-right"\)/.test(body[0]),
      'and "down" is Right');
    check(/towards the top of the chart/.test(body[0])
          && /towards the bottom of the chart/.test(body[0]),
      "and both say which end of the CHART they mean, since left is not up");
    /* Delete is a bin, not the close cross the panel's own dismiss button
       uses two rows above it — one of them ends the editing, the other ends
       the grade, and they must not be the same picture. */
    check(/tact:"del"[\s\S]{0,300}?icon\("#i-delete"\)/.test(body[0]),
      "deleting a grade is drawn as a bin");
    check(!/tact:"del"[\s\S]{0,300}?icon\("#i-close"\)/.test(body[0]),
      "and not as the cross that closes the panel without changing anything");
  }

  /* --- the two groups are named for what they hold */
  {
    const pane = /<div class="rb-pane" data-pane="grades"[\s\S]*?\n    <\/div>/.exec(MARKUP);
    check(!!pane, "the Grades pane is readable");
    if(pane){
      check(/<div class="lbl">Edit<\/div>/.test(pane[0]),
        "the Add grade group is labelled EDIT — it is the group that changes things");
      check(/<div class="lbl">Current grades<\/div>/.test(pane[0]),
        "and the strip is labelled CURRENT GRADES, so it reads as a list and not as "
        + "more buttons");
      check(!/<div class="lbl">Grades<\/div>/.test(pane[0]),
        "no single GRADES label remains — two groups, two names");
      check(pane[0].indexOf('class="lbl">Edit') < pane[0].indexOf('class="lbl">Current grades'),
        "in that order, matching the groups they sit under");
      /* .rb-group > .lbl centres its text in the GROUP. At flex:1 that group ran
         to the pane's right edge, so CURRENT GRADES was centred in the empty
         space past the last chip rather than under the chips. */
      const strip = /<div class="rb-group" style="([^"]*)">\s*<div id="tiers"/.exec(pane[0]);
      check(!!strip, "the strip's group is readable");
      check(strip && /flex:0 0 auto/.test(strip[1]),
        "the strip's group is content-width, so its label centres under the chips "
        + "— got style=\"" + (strip && strip[1]) + "\"");
      check(strip && !/flex:1[;"]/.test(strip[1]),
        "and NOT flex:1, which centred the label in the empty space beyond them");
      check(strip && /min-width:max-content/.test(strip[1]),
        "it keeps its natural width so the pane, not the grade strip, owns overflow");
      check(/\.tier-strip\{[^}]*overflow:visible[^}]*flex:0 0 auto[^}]*min-width:max-content/.test(MARKUP),
        "#tiers has no private scrollbar and contributes its full width to the pane");
      check(/id="gradeDragHelp">Drag grades to reorder them, or open a grade and use Move left or Move right\.<\/span>/.test(pane[0]),
        "the strip names the non-pointer reordering path for assistive technology");
      check(/\.rb-group > \.lbl\{[^}]*text-align:center/.test(MARKUP),
        "…because the label is centred in its group and nowhere else");
      check((pane[0].match(/<div class="lbl">/g) || []).length === 2,
        "every group in the pane has a label — .rb-group > .lbl is what pushes it to "
        + "the bottom, so a group without one loses the ribbon's baseline");
    }
  }

  /* --- the panel is in the markup at boot, empty */
  const panel = /<div class="gmenu" id="gradePanel"[\s\S]*?\n      <\/div>/.exec(MARKUP);
  check(!!panel, "#gradePanel is in the markup");
  if(panel){
    check(/\bhidden\b/.test(panel[0]), "and starts hidden");
    check(/role="dialog"/.test(panel[0]), "it is a dialog");
    check(!/aria-modal/.test(panel[0]),
      "but NOT a modal one — the chart underneath is what you watch while you type in it");
    check(/id="gradePanelBody"><\/div>/.test(panel[0]),
      "its body is empty in the markup and filled per grade, so one panel serves every chip");
    check(/id="gradePanelClose"/.test(panel[0]) && /aria-label="Close grade settings"/.test(panel[0]),
      "there is a named close button");
  }
  check(/\$\("#gradePanel"\)\.addEventListener\("input"/.test(SCRIPT)
        && /\$\("#gradePanel"\)\.addEventListener\("click"/.test(SCRIPT),
    "the panel is a delegation root for both families of control");
  check(/\$\("#tiers"\)\.addEventListener\("click"/.test(SCRIPT),
    "and the strip is still one, for the chips");
  /* The nine drag events, the shared arbitration rules and the per-instance
     configuration (root #tiers, .g-chip, .g-drop-slot, axis x, excludePress
     .g-chip-toggle, onDrop reorderGrade) are all asserted once, generically,
     in §4o over makeDragSurface and its two instantiations — this strip is
     one of the two. What remains here is reorderGrade's own body, which the
     factory calls but does not change. */
  check(!/drop-before|drop-after/.test(HTML),
    "drop-before and drop-after do not appear anywhere in the file — no "
    + "rule, selector, class write or handler names either marker");
  const reorder = /function reorderGrade\(sourceId, targetId, after\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(reorder && /sourceId === targetId/.test(reorder[0])
     && /if\(insertAt === from\) return false/.test(reorder[0]),
    "self-drops and drops back into the same slot do nothing");
  check(reorder && /commit\("moved grade " \+ name/.test(reorder[0])
     && /normalizeGradeLinks\(state\.tiers\)/.test(reorder[0]),
    "a real drop is one commit and normalises first-grade attach/share");
  /* An index comparison would pass with the panel nested inside #tiers, so the
     container is asserted EMPTY instead: renderRoster clears it on every change,
     and a panel destroyed mid-edit takes the focus and the caret with it. */
  check(/<div id="tiers" class="tier-strip"><\/div>/.test(MARKUP),
    "#tiers is an empty container in the markup — nothing may be nested inside it, "
    + "because renderRoster throws its contents away");
  check(MARKUP.indexOf('id="gradePanel"') > MARKUP.indexOf('id="tiers"'),
    "and #gradePanel is a sibling after it");

  /* --- every way it can be stranded */
  check(/function selectTab\([\s\S]*?closeGradePanel\(\)/.test(SCRIPT),
    "switching ribbon tabs dismisses the panel — it is anchored to a chip on one tab");
  check(/e\.key==="Escape" && !\$\("#gradePanel"\)\.hidden/.test(SCRIPT),
    "Escape dismisses it");
  check(/closest\("#gradePanel"\)[\s\S]{0,80}closest\("\.g-chip"\)[\s\S]{0,40}closeGradePanel\(\)/.test(SCRIPT),
    "and a click that is on neither the panel nor a chip dismisses it");
  check(/\$\("#gradePanelClose"\)\.addEventListener\("click"/.test(SCRIPT),
    "the close button is wired");
  const close = /function closeGradePanel\(refocus\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(close && /endEdit\(\)/.test(close[0]),
    "closing ends the edit session — typing in the panel is one, and it must not "
    + "keep collecting keystrokes into a step the user has walked away from");
  check(close && /clear\(\$\("#gradePanelBody"\)\)/.test(close[0]),
    "and empties the body, so no stale control is left holding a deleted grade's id");
  const open = /function openGradePanel\(id\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(open && /gradeOpen && gradeOpen !== id\) closeGradePanel\(\)/.test(open[0]),
    "opening a second chip closes the first — otherwise the chip left behind keeps "
    + "aria-expanded=\"true\" and its highlight while the panel shows another grade");
  const sync = /function syncGradePanel\(\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(sync && /findIndex[\s\S]{0,120}closeGradePanel\(\)/.test(sync[0]),
    "a panel whose grade was deleted closes itself rather than editing a ghost");
  check(/syncGradePanel\(\);/.test(SCRIPT)
        && SCRIPT.indexOf("syncGradePanel();") < SCRIPT.indexOf("restoreField(keepFocus)"),
    "renderRoster rebuilds the panel BEFORE restoreField, or the field it wants to "
    + "put the caret back in does not exist yet");
}

/* The full set of data-cmd values in the markup is fixed and named here in
   one place, so a stray command added or removed anywhere fails this single
   check. */
{
  const all = uniq(matchAll(/data-cmd="([A-Za-z]+)"/g, MARKUP).map(m => m[1])).sort();
  const want = ["accentSwatch", "addGrade", "addPeople", "clearGrades", "clearRoster", "copyPng",
                "exportCsv", "exportPdf", "exportPng", "exportSvg", "groups", "importCsv", "infoAbout", "infoBug",
                "infoPrivacy", "infoTips",
                "new", "open", "pasteList", "redo", "save", "saveAs",
                "toggleRoster",
                "undo"];
  check(all.join(",") === want.join(","),
    "the full set of data-cmd values matches exactly — got: " + all.join(","));
}

/* ---------------------------------- 4n. boot opens narrow windows with the
   roster already put away, the same state a hand-driven toggle reaches */
{
  const boot = /fontsReady\.then\(\(\)=>\{[\s\S]*?\n\}\);/.exec(SCRIPT);
  check(!!boot, "the boot sequence is readable");
  check(boot && /rosterToggleMQ\.matches[\s\S]{0,60}roster-hidden/.test(boot[0]),
    "boot adds roster-hidden to the body when the narrow query already matches");
  check(!/function setView\(/.test(SCRIPT) && !SCRIPT.includes("setView("),
    "setView has no definition and no call site left anywhere in the script");
}

/* ---------------------------------------------------------- 5. house rules */

/* Open Sans is bundled: the variable font ships as a WOFF2 data URI inside
   its own <style id="fontcss"> block, placed AFTER the main stylesheet on
   purpose — every CSS extraction in this suite matches the FIRST
   <style ...> tag only, so a fontcss block ahead of the main one would feed
   this payload into checks that expect icon rules. This section guards: the block
   exists exactly once and stays after the main stylesheet; @font-face and
   data:font/ each occur exactly once in the whole file, and both occurrences
   live inside that one block; the payload is byte-identical to the tracked
   asset; the declared family matches the family the app actually measures
   and draws with (a second, independent writer answers the claim);
   and the variable font's weight axis is declared. */
{
  const mainStyleOpen = HTML.indexOf("<style>");
  const fontcssOpens = matchAll(/<style id="fontcss">/g, HTML);
  check(fontcssOpens.length === 1,
    "the bundled font block <style id=\"fontcss\"> occurs exactly once — got " + fontcssOpens.length);

  const fontcssOpen = fontcssOpens[0];
  const fontcssStart = fontcssOpen ? fontcssOpen.index : -1;
  check(fontcssStart >= 0 && mainStyleOpen >= 0 && fontcssStart > mainStyleOpen,
    "the bundled font block sits after the main stylesheet, not before it");

  const fontcssEnd = fontcssStart >= 0 ? HTML.indexOf("</style>", fontcssStart) : -1;
  const fontcssBlock = (fontcssStart >= 0 && fontcssEnd >= 0) ? HTML.slice(fontcssStart, fontcssEnd) : "";
  const inBlock = idx => fontcssStart >= 0 && fontcssEnd >= 0 && idx >= fontcssStart && idx < fontcssEnd;

  const allFontFace = matchAll(/@font-face/g, HTML);
  check(allFontFace.length === 1,
    "@font-face occurs exactly once in the whole file — got " + allFontFace.length);
  check(allFontFace.length === 1 && inBlock(allFontFace[0].index),
    "the one @font-face rule lives inside the bundled font block");

  const allDataFont = matchAll(/data:font\//g, HTML);
  check(allDataFont.length === 1,
    "data:font/ occurs exactly once in the whole file — got " + allDataFont.length);
  check(allDataFont.length === 1 && inBlock(allDataFont[0].index),
    "the one data:font/ payload lives inside the bundled font block");

  const payloadMatch = /url\(data:font\/woff2;base64,([A-Za-z0-9+\/=]+)\)/.exec(fontcssBlock);
  const payload = (payloadMatch && payloadMatch[1]) || "";
  const diskB64 = readFileBase64(here() + "fonts/OpenSans-VariableFont_wdth,wght.woff2");
  check(payload !== "" && diskB64 !== "" && payload === diskB64,
    "the bundled font payload is byte-identical to fonts/OpenSans-VariableFont_wdth,wght.woff2");

  const familyMatch = /font-family:\s*'([^']+)'/.exec(fontcssBlock);
  const family = (familyMatch && familyMatch[1]) || "";
  const jsStackMatch = /const FONT\s*=\s*"([^"]+)"/.exec(SCRIPT);
  const jsFirstFamily = jsStackMatch
    ? (jsStackMatch[1].split(",")[0] || "").replace(/["']/g, "").trim()
    : "";
  check(family !== "" && jsFirstFamily !== "" && family === jsFirstFamily,
    "the bundled @font-face family matches the first family in the JS FONT stack (css: '"
    + family + "' · js: '" + jsFirstFamily + "')");

  check(/font-weight:\s*300\s+800/.test(fontcssBlock),
    "the bundled @font-face declares font-weight:300 800, the variable weight axis range");
}

/* CSS and JS must name the same families in the same order, or canvas
   measurement and rendering disagree and the layout is computed for a font the
   page never draws with. */
{
  const cssStack = /--font:\s*([^;]+);/.exec(HTML);
  const jsStack  = /const FONT\s*=\s*"([^"]+)"/.exec(SCRIPT);
  check(!!cssStack, "--font is declared in the stylesheet");
  check(!!jsStack,  "FONT is declared in the script");
  const norm = s => s.replace(/["']/g, "").replace(/\s+/g, "").toLowerCase();
  check(cssStack && jsStack && norm(cssStack[1]) === norm(jsStack[1]),
    "the CSS and JS font stacks are identical (css: " + (cssStack && cssStack[1].trim())
    + " · js: " + (jsStack && jsStack[1]) + ")");
}

for(const [needle, label] of [
  ["localStorage",    "localStorage"],
  ["sessionStorage",  "sessionStorage"],
  ["<script src",     "an external script tag"],
  ['src="http',       "a remote src"],
  ["cdn.",            "a CDN reference"]
]){
  check(!HTML.includes(needle), "no " + label + " (found " + needle + ")");
}
/* An <a href="https://…"> costs nothing until clicked, so links are allowed —
   but a stylesheet or preload <link> fetches on load and must never appear. */
for(const m of matchAll(/<link\b[^>]*href="https?:/g, HTML)){
  check(false, "a <link> loads a remote resource at offset " + m.index);
}
check(!/@import\s+url\(\s*["']?https?:/.test(HTML), "no CSS @import of a remote stylesheet");

/* Actual window.storage INVOCATIONS must stay wrapped, since the API is absent
   on file://. Bare property reads (the `window.storage && window.storage.get`
   capability probe) cannot throw and are deliberately not flagged. */
for(const m of matchAll(/window\.storage\.\w+\s*\(/g, HTML)){
  const around = HTML.slice(Math.max(0, m.index - 400), m.index);
  check(around.includes("try{") || around.includes("try {"),
        "window.storage call at offset " + m.index + " is inside a try/catch");
}

/* ---------------------------------------------------------- 6. tag balance */

const VOID = ["input","br","img","hr","meta","link"];
{
  /* The stylesheet's own comments are not markup: prose there may name a tag
     (one names a bare <p>), and the scan must not read it as one. */
  let stripped = HTML.replace(/<script>[\s\S]*?<\/script>/, "")
                     .replace(/<!--[\s\S]*?-->/g, "")
                     .replace(/\/\*[\s\S]*?\*\//g, "");
  const stack = [], problems = [];
  for(const m of matchAll(/<(\/?)([a-z0-9]+)\b[^>]*?(\/?)>/g, stripped)){
    const closing = m[1] === "/", tag = m[2], self = m[3] === "/";
    if(VOID.includes(tag) || self) continue;
    if(!closing) stack.push(tag);
    else{
      const top = stack.pop();
      if(top !== tag) problems.push("expected </" + top + "> but found </" + tag + ">");
    }
  }
  check(stack.length === 0, "no unclosed tags (open: " + stack.join(", ") + ")");
  check(problems.length === 0, "no mismatched tags (" + problems.slice(0, 3).join("; ") + ")");
}

/* ---------------------------------------------------------- 7. roster caret reveal */

/* A roster row is a surface plus one control: the caret is the row's only
   button, its only tab stop, and the only door to Edit details and Remove. On
   hover-capable machines it rests at opacity:0 and reveals per PANEL — pointer
   or focus anywhere in the aside shows every caret at once — and the open
   menu's anchor stays visible by its own aria-expanded, because #personMenu
   lives outside the aside, so pointer or focus inside the popup drops both
   panel pseudo-classes. None of that errors when it drifts: a caret hidden by
   display would silently leave the tab order, and a hide that escaped the
   hover guard would blind every touch device. The block is sliced on its
   literal prelude and a balanced closing brace — a [^}]* regex across rule
   boundaries is the false-pass this suite has already shipped once. */
{
  const CSS = ((/<style>([\s\S]*?)<\/style>/.exec(MARKUP) || ["", ""])[1])
    .replace(/\/\*[\s\S]*?\*\//g, " ");

  /* --- a. one guard block, cut on its literal prelude */
  const prelude = "@media (hover: hover){";
  const starts = matchAll(/@media \(hover: hover\)\{/g, CSS).map(m => m.index);
  check(starts.length === 1,
    "exactly one @media (hover: hover) block exists in the stylesheet (found "
    + starts.length + ")");
  let hoverBlock = "";
  if(starts.length){
    let depth = 0;
    for(let i = starts[0] + prelude.length - 1; i < CSS.length; i++){
      if(CSS[i] === "{") depth++;
      else if(CSS[i] === "}" && --depth === 0){ hoverBlock = CSS.slice(starts[0], i + 1); break; }
    }
  }

  /* --- b. the hide is opacity, and opacity alone */
  const hide = /[\n{}]\s*\.p-menu\{([^{}]*)\}/.exec(hoverBlock);
  const hideDecl = hide?.[1] ?? "";
  check(/(?:^|;)\s*opacity\s*:\s*0\s*(?:;|$)/.test(hideDecl),
    "inside the hover guard, a bare .p-menu rule hides the caret with opacity:0");
  check(!!hide && !/\b(?:display|visibility)\s*:/.test(hideDecl),
    "the hide declares neither display nor visibility — either would take the "
    + "caret's tab stop, hit target and grid column with it");

  /* --- c. the three reveals, each asserted on its own */
  const rules  = matchAll(/([^{}]+)\{([^{}]*)\}/g, hoverBlock.slice(prelude.length));
  const reveal = rules.find(r => /opacity\s*:\s*1/.test(r[2]));
  const revealSel = reveal?.[1] ?? "";
  check(revealSel.includes(".panel:hover .p-menu"),
    "the opacity:1 reveal names .panel:hover .p-menu — the pointer anywhere over "
    + "the roster panel shows every caret at once");
  check(revealSel.includes(".panel:focus-within .p-menu"),
    "the reveal names .panel:focus-within .p-menu — keyboard focus in the panel "
    + "reveals the carets, deterministically even for closePersonMenu(true)'s "
    + "programmatic refocus, which :focus-visible would leave to a heuristic");
  check(revealSel.includes('.p-menu[aria-expanded="true"]'),
    'the reveal names .p-menu[aria-expanded="true"] — the open menu\'s anchor stays '
    + "visible while pointer or focus is in #personMenu, which lives outside the "
    + "aside and so drops both panel pseudo-classes");

  /* --- d. the hide exists nowhere outside the guard */
  const hides = matchAll(/\.p-menu\{\s*opacity\s*:\s*0\s*;?\s*\}/g, CSS).map(m => m.index);
  check(hides.length === 1,
    "the .p-menu opacity:0 hide is written exactly once in the sheet (found "
    + hides.length + ")");
  check(starts.length === 1 && hides.length === 1
     && hides[0] > starts[0] && hides[0] < starts[0] + hoverBlock.length,
    "and that one hide lies inside the hover guard — outside it, a touch device "
    + "would hide carets it has no pointer to reveal");

  /* --- e. class check: no rule aimed at the caret may remove it from layout */
  for(const m of matchAll(/([^{}]+)\{([^{}]*)\}/g, CSS)){
    for(const sel of m[1].split(",")){
      const last = sel.trim().split(/[\s>+~]+/).pop() || "";
      if(!/\.p-menu(?![\w-])/.test(last)) continue;
      check(!/\b(?:display|visibility)\s*:/.test(m[2]),
        "no rule whose final compound targets the caret (" + sel.trim() + ") declares "
        + "display or visibility — the caret must never leave layout or the tab "
        + "order by CSS");
    }
  }

  /* --- f. the attribute the reveal keys on has both of its writers.
     Each body is cut by balanced braces from its own declaration, so neither
     check can be satisfied by the other function or by markup. */
  const fnBody = name => {
    const at = SCRIPT.indexOf("function " + name + "(");
    if(at < 0) return "";
    const open = SCRIPT.indexOf("{", at);
    if(open < 0) return "";
    let depth = 0;
    for(let i = open; i < SCRIPT.length; i++){
      if(SCRIPT[i] === "{") depth++;
      else if(SCRIPT[i] === "}" && --depth === 0) return SCRIPT.slice(open, i + 1);
    }
    return "";
  };
  check(fnBody("syncPersonMenu").includes('caret.setAttribute("aria-expanded", "true")'),
    'syncPersonMenu sets the caret\'s aria-expanded to "true" — the attribute the '
    + "reveal's open-menu exception keys on");
  check(fnBody("closePersonMenu").includes('caret.setAttribute("aria-expanded", "false")'),
    'closePersonMenu sets it back to "false", so a closed menu\'s caret can fade again');
}

/* ---------------------------------------------------------- 4n. photo dialog
   step A: icons on the photo actions, the Reset button's face ("Reset
   photo"), one-decimal zoom, and the modal Grade select matching the text
   inputs' height.

   The provenance/symbol-count/PLACEHOLDER checks in §2b/§2c already prove the
   three new symbols are real, correctly split from Google's artwork and
   counted; this section is only about where they are USED. */
{
  const panel = /function framePanel\(subj\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  const body  = /function editPhotoBody\(p\)\{[\s\S]*?\n\}/.exec(SCRIPT);
  check(!!panel && !!body, "framePanel and editPhotoBody are readable");
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /* --- a. class check: every photo-action face carries its icon written in
     full. One rule (attr → icon, in the source the button actually lives in)
     applied uniformly, rather than a hand-typed regex per button — the next
     photo-action button added to either function is caught by the same loop,
     not only the four that exist today. */
  const photoIconSites = [
    ["Add photo",     body  && body[0],  'act:"photo"',    "#i-add-photo"],
    ["Reset photo",   panel && panel[0], 'fact:"reset"',   "#i-reset-image"],
    ["Replace photo", panel && panel[0], 'fact:"replace"', "#i-replace-image"],
    ["Remove photo (framing editor)", panel && panel[0], 'fact:"remove"', "#i-delete"]
  ];
  for(const [name, src, attr, iconId] of photoIconSites){
    const re = new RegExp(esc(attr) + "[\\s\\S]{0,220}?icon\\(\"" + esc(iconId) + "\"\\)");
    check(!!src && re.test(src),
      name + " carries " + iconId + " via icon(\"" + iconId + "\"), written in full");
  }
  /* The Add dialog's own Remove photo is DOM-built through the SAME
     framePanel Edit's dialog uses, not static markup checked here
     separately, so the photoIconSites loop above already covers it via
     panel[0] — a second, Add-only check here would be exactly the drift risk
     sharing framePanel is meant to remove. */

  /* --- b. the Reset face --- */
  check(!!panel && /\[icon\("#i-reset-image"\), "Reset photo"\]/.test(panel[0]),
    'the Reset button\'s face reads "Reset photo"');
  check(!/Reset framing/.test(SCRIPT),
    'no "Reset framing" face remains anywhere in the script');

  /* --- c. one-decimal zoom display. Both literal sites, by name, so a
     mutation to either one is caught by name rather than by a generic count;
     the negative check is scoped to a toFixed(2) immediately followed by the
     × glyph, which is only ever true of a zoom label — the export code's many
     other toFixed(2) calls (page/photo geometry, no × beside them) cannot
     satisfy or break it. */
  check(/zoom\.toFixed\(1\) \+ "×"/.test(SCRIPT),
    "framePanel's zoom label reads zoom.toFixed(1) — one decimal");
  check(/\.toFixed\(1\)\+"×"/.test(SCRIPT),
    "syncFramePreview's zoom label reads …toFixed(1)+\"×\" — one decimal");
  const staleZoom = matchAll(/toFixed\(2\)[^\n]{0,12}["']×["']/g, SCRIPT);
  check(staleZoom.length === 0,
    "no zoom-label site still reads toFixed(2) (found " + staleZoom.length + ")");
  check(/step:"0\.01"/.test(SCRIPT),
    "the zoom slider itself keeps step=\"0.01\" — only the display coarsens");

  /* --- d. the modal Grade select's height, scoped to modal fields only.
     Comments are stripped first — the shared field rule above and the .modal
     rule below are separated in the sheet only by a prose comment that itself
     mentions ".rb-group" and "select", and an unstripped scan would let that
     prose satisfy a pattern meant to match real declarations. */
  const css = /<style>([\s\S]*?)<\/style>/.exec(MARKUP);
  const CSS = (css ? css[1] : "").replace(/\/\*[\s\S]*?\*\//g, " ");
  const modalSelectRule = /\.modal\s+label\.field\s+select\s*\{([^}]*)\}/.exec(CSS);
  check(!!modalSelectRule
      && /height:\s*29px\s*;?/.test(modalSelectRule[1])
      && /padding-top:\s*0\s*;?/.test(modalSelectRule[1])
      && /padding-bottom:\s*0\s*;?/.test(modalSelectRule[1]),
    "the modal Grade select's height and its zeroed vertical padding are one "
    + "decision: 29px with the shared rule's 7px top/bottom padding still "
    + "applied squeezes the line box to 13px, which a native menulist needs "
    + "more room than to draw uncropped — height alone is not the fix");
  const sharedFieldRule = /input\[type=text\],select,input\[type=color\]\{[^}]*\}/.exec(CSS);
  check(!!sharedFieldRule && !/height/.test(sharedFieldRule[0]),
    "the shared field rule gains no height property — the fix stays scoped to "
    + ".modal label.field select and does not touch every select");
  check(!/\.rb-group[^{}]*select[^{}]*\{[^{}]*height:\s*29px/.test(CSS),
    "the ribbon's compact .rb-group selects are not pinned to 29px");

  /* --- e. step B: the zoom slider stands vertically, via a rotated
     horizontal range inside its own scoped wrapper — not the global rule
     every other slider in the app uses, and not a browser vertical-slider
     keyword (not uniform across the three file:// engines this opens in). */
  check(/\.fp-zoom-vert\s+input\[type=range\]\s*\{[^}]*transform\s*:\s*rotate\(-90deg\)/.test(CSS),
    "the zoom slider's own wrapper rotates it -90deg, so the thumb rises as the value grows");
  const globalRange = /(?:^|[\n};])\s*input\[type=range\]\s*\{([^}]*)\}/.exec(CSS);
  check(!!globalRange && /width\s*:\s*100%/.test(globalRange[1]) && !/rotate\(/.test(globalRange[1]),
    "…and the global input[type=range] rule is untouched — width:100%, no rotation");
  check(!/appearance\s*:\s*slider-vertical/.test(CSS) && !/writing-mode/.test(CSS),
    "no slider-vertical appearance and no writing-mode trick anywhere in the "
    + "sheet — neither is uniform across the three file:// browsers this opens in");
  /* The framing editor's own range input is untouched by the restyle: same
     verb, same id, same bounds, same precision. */
  check(!!panel && /type:"range", fact:"zoom", did:subj\.key, value:String\(zoom\),/.test(panel[0]),
    "framePanel's range input keeps fact:\"zoom\" and did:subj.key — the "
    + "generalized subject in place of did:p.id — unaffected by the CSS "
    + "rotation that turns the slider vertical");
  check(!!panel && /attrs:\{min:"1", max:String\(ZOOM_MAX\), step:"0\.01"\}/.test(panel[0]),
    "…and its min/max/step attributes are unaffected by the same CSS rotation");

  /* --- f. the photo circle centres exactly where the no-photo placeholder's
     does — one shared centring rule, not two copies of it — and the zoom
     control stands at its right edge entirely out of flow, so nothing beside
     the circle can move its centre no matter how tall the slider is. */
  {
    const sharedDefs = matchAll(/\.frame-ed,\s*\.no-photo\s*\{/g, CSS);
    check(sharedDefs.length === 1,
      ".frame-ed, .no-photo is defined exactly once as a shared centring rule "
      + "— got " + sharedDefs.length);
    /* Remove that one legitimate occurrence first — ".no-photo{" is a literal
       substring of it — so what is left can only be a second, un-shared rule
       for either name. */
    const withoutShared = CSS.replace(/\.frame-ed,\s*\.no-photo\s*\{/g, " ");
    check(!/\.frame-ed\{/.test(withoutShared) && !/\.no-photo\{/.test(withoutShared),
      "neither .frame-ed nor .no-photo has a separate rule of its own beside "
      + "the shared one — the two states cannot drift apart a second time");
  }
  {
    const anchorRule = /\.fp-anchor\{([^}]*)\}/.exec(CSS);
    check(!!anchorRule && /(?:^|;)position:relative(?:;|$)/.test(anchorRule[1]),
      ".fp-anchor is position:relative — the containing block the zoom "
      + "column positions off, and nothing more sizes or centres it");
  }
  {
    /* Re-anchoring the zoom column into flow — a flex sibling of the circle,
       in a shared row — is exactly the regression this guards against. */
    const ctlRule = /\.fp-ctl\{([^}]*)\}/.exec(CSS);
    check(!!ctlRule && /(?:^|;)\s*position:absolute\s*(?:;|$)/.test(ctlRule[1]),
      ".fp-ctl is taken out of flow — position:absolute — so it cannot "
      + "displace the circle it stands beside, however tall the slider is");
    check(!!ctlRule && /(?:^|;)\s*left:100%\s*(?:;|$)/.test(ctlRule[1]),
      "…anchored at the circle's own right edge");
  }
  check(!!panel && /el\("div", \{cls:"fp-anchor"\}, \[\s*circle,/.test(panel[0]),
    "the circle is .fp-anchor's own first child, not behind a row shared "
    + "with the zoom control — sharing a row would let the row's width push "
    + "the circle off centre");

  /* --- g. the circle-as-button washes out on hover
     without this — the global button:hover, .g-chip-face:hover rule is
     (0,1,1) and beats .np-circle's own (0,1,0) regardless of source order,
     flipping the 160px circle to near-white and washing out its white
     initials. .np-circle:hover ties that specificity, so the tie is broken
     by order instead — this rule has to sit AFTER button:hover in the sheet,
     or a later refactor that moves it above silently reintroduces the
     wash-out with no error anywhere. */
  {
    const globalHover = CSS.indexOf("button:hover, .g-chip-face:hover{");
    check(globalHover >= 0, "the global button:hover rule is readable");
    const npHover = /\.np-circle:hover\{background:[^}]+\}/.exec(CSS);
    check(!!npHover, ".np-circle:hover restates an explicit background — not "
      + "merely a selector with no declaration, which would win the "
      + "specificity tie but paint nothing");
    check(!!npHover && npHover.index > globalHover,
      "…and it sits AFTER button:hover in the sheet — the tie-breaker IS the "
      + "order, so this is what actually keeps the initials legible on hover");
    /* .fp-circle never showed this defect only because a photo — cropped by
       frameRect to fully cover the circle — sits opaque on top of it. A photo
       with a transparent edge would show the same wash-out through the gap
       the image does not cover without the same restatement here. */
    const fpHover = /\.fp-circle:hover\{background:none\}/.exec(CSS);
    check(!!fpHover,
      ".fp-circle:hover likewise restates its own background");
    check(!!fpHover && fpHover.index > globalHover,
      "…also after button:hover, for the same tie-breaking reason");
  }
}

/* ---------------------------------------------------------- report */

console.log("ids referenced: " + referenced.length + " · declared: " + declared.length
  + " · verbs: " + Object.values(emitted).reduce((n, v) => n + v.length, 0)
  + " · commands: " + cmdEmitted.length
  + " · icons: " + iconUses.length + "/" + symbols.length + " used");
if(unusedIcons.length) console.log("spare icons (fails this suite): " + unusedIcons.join(", "));
if(failures.length){
  console.log("\nFAILURES (" + failures.length + "):");
  failures.forEach(f => console.log("  ✗ " + f));
  console.log("\n" + passed + " passed, " + failures.length + " FAILED");
  if(typeof process !== "undefined") process.exit(1);
}else{
  console.log("all " + passed + " DOM wiring assertions passed");
}
