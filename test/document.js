/* Document-model tests for tierform_app.html.
 *
 * The app now behaves like a single-document editor: one roster open at a time,
 * files as the only durable storage, and a dirty flag guarding unsaved work.
 * This suite drives the real functions out of the HTML against stubs, because
 * the failure modes here are quiet ones — a Save that forgets to clear the
 * dirty flag, an Open that leaves the previous roster's undo history in place,
 * a validator that stops answering for a field a file leaves out.
 *
 * Run:  node test/document.js
 *   or: osascript -l JavaScript test/document.js
 */

function readFile(path){
  if(typeof require !== "undefined") return require("fs").readFileSync(path, "utf8");
  ObjC.import("Foundation");
  return $.NSString.stringWithContentsOfFileEncodingError(
    path, $.NSUTF8StringEncoding, null).js;
}
function here(){
  if(typeof __dirname !== "undefined") return __dirname + "/../";
  ObjC.import("Foundation");
  return $.NSFileManager.defaultManager.currentDirectoryPath.js + "/";
}

const HTML   = readFile(here() + "tierform_app.html");
const SCRIPT = /<script>([\s\S]*)<\/script>/.exec(HTML)[1];
const STYLE  = /<style[^>]*>([\s\S]*?)<\/style>/.exec(HTML)[1];

/* ---------------------------------------------------------- what RENDERS

   The saved/unsaved icons were toggled with `icon.hidden = …`. `hidden` is an
   IDL attribute of HTMLElement and those two elements are <svg>, i.e.
   SVGElement, which has no such property — so the assignment created a plain
   JavaScript expando that reflected to no content attribute and matched no
   selector. Both icons stayed exactly as the markup shipped them: the saved one
   on screen, under the words "Unsaved changes".

   A stub that stored `hidden` and read it back agreed with the JavaScript at
   every step and never noticed. So this resolves display the way a browser
   does: it reads the app's OWN stylesheet and the app's OWN markup for the two
   icons, and answers what would actually be painted for a given set of classes
   on the wrapper. Nothing below restates a rule — change the CSS and the answer
   changes with it. */

/* rules at the top level of the sheet, with any @media context recorded */
function cssRules(css){
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const at = [];
  let i = 0, buf = "";
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
}
const RULES = cssRules(STYLE);

/* one compound selector: div#id.cls[attr]:hover */
function compound(text){
  const out = {tag:null, id:null, cls:[], attrs:[], pseudo:[], odd:false};
  const re = /(::?[a-z-]+(?:\([^)]*\))?)|(#[\w-]+)|(\.[\w-]+)|(\[[^\]]+\])|([A-Za-z][\w-]*)|(\*)/g;
  let m, seen = 0;
  while((m = re.exec(text))){
    seen += m[0].length;
    if(m[1]) out.pseudo.push(m[1]);
    else if(m[2]) out.id = m[2].slice(1);
    else if(m[3]) out.cls.push(m[3].slice(1));
    else if(m[4]) out.attrs.push(m[4].slice(1, -1));
    else if(m[5]) out.tag = m[5];
  }
  if(seen !== text.length) out.odd = true;      // something this matcher cannot read
  return out;
}
/* a full selector: compounds separated by descendant combinators only */
function parseSelector(sel){
  if(/[>+~]/.test(sel)) return null;            // no combinator in the rules that reach here
  const parts = sel.trim().split(/\s+/).map(compound);
  return parts.some(p => p.odd) ? null : parts;
}
function matchOne(c, el, active){
  if(c.tag && c.tag !== el.tag) return false;
  if(c.id && c.id !== el.id) return false;
  if(!c.cls.every(k => el.cls.indexOf(k) >= 0)) return false;
  if(!c.attrs.every(a => Object.prototype.hasOwnProperty.call(el.attrs, a.split(/[=~^$*|]/)[0]))) return false;
  if(!c.pseudo.every(p => active.indexOf(p) >= 0)) return false;
  return true;
}
/* right-to-left over [outermost … element] */
function matches(parts, chain, active){
  let k = chain.length - 1;
  for(let p = parts.length - 1; p >= 0; p--){
    if(p === parts.length - 1){
      if(!matchOne(parts[p], chain[k], active)) return false;
      k--;
    }else{
      let found = false;
      while(k >= 0){ if(matchOne(parts[p], chain[k], active)){ found = true; k--; break; } k--; }
      if(!found) return false;
    }
  }
  return true;
}
function specificity(parts){
  let a = 0, b = 0, c = 0;
  parts.forEach(p => {
    if(p.id) a++;
    b += p.cls.length + p.attrs.length + p.pseudo.filter(x => x.indexOf("::") !== 0).length;
    if(p.tag) c++;
  });
  return a * 10000 + b * 100 + c;
}
function lastDecl(decls, prop){
  const re = new RegExp("(?:^|;)\\s*" + prop + "\\s*:\\s*([^;]+)", "g");
  let m, v = null;
  while((m = re.exec(decls))) v = m[1].trim();
  return v;
}

/* the two icons and their wrapper, taken from the markup rather than described
   here — an attribute added back to either tag changes what this resolves */
function tagOf(id){
  const m = new RegExp("<([a-z]+)([^>]*\\sid=\"" + id + "\"[^>]*)>").exec(HTML);
  if(!m) throw new Error("markup for #" + id + " not found");
  const attrs = {};
  let a;
  const re = /([\w-]+)(?:="([^"]*)")?/g;
  while((a = re.exec(m[2]))) attrs[a[1]] = a[2] === undefined ? "" : a[2];
  return {tag:m[1], id:id, cls:(attrs["class"] || "").split(/\s+/).filter(Boolean), attrs:attrs};
}
const ICON_SAVED   = tagOf("docIconSaved");
const ICON_UNSAVED = tagOf("docIconUnsaved");
const DOC_WRAP     = tagOf("docName");

/* `classes` is what the app put on the wrapper; `active` lists pseudo-classes
   to treat as matching, so :hover can be asked about as an ordinary state. */
function displayOf(icon, classes, active){
  const wrap = {tag:DOC_WRAP.tag, id:DOC_WRAP.id, cls:classes.slice(), attrs:DOC_WRAP.attrs};
  return resolveDisplay([{tag:"body", id:null, cls:[], attrs:{}}, wrap, icon], active);
}
/* the winning declaration of one property for the element at the end of the
   chain, or null when the sheet says nothing about it */
function resolveProp(chain, prop, active){
  let best = null, bestSpec = -1;
  RULES.forEach(r => {
    if(r.at.length) return;                    // no @media rule touches these — §5c pins that
    r.sel.split(",").forEach(one => {
      const parts = parseSelector(one);
      if(!parts) return;
      if(!matches(parts, chain, active || [])) return;
      const v = lastDecl(r.decls, prop);
      if(v === null) return;
      const spec = specificity(parts);
      if(spec >= bestSpec){ bestSpec = spec; best = v; }
    });
  });
  return best;
}
function resolveDisplay(chain, active){
  const v = resolveProp(chain, "display", active);
  return v === null ? "inline" : v;            // <svg> is inline by default
}
function iconsShown(classes, active){
  return {saved:   displayOf(ICON_SAVED,   classes, active) !== "none",
          unsaved: displayOf(ICON_UNSAVED, classes, active) !== "none"};
}

/* Brace and paren counting runs over a MASK of the source, never over the
   source itself: a "{" inside a comment, a string or a regex is not a brace,
   and counting it ends a slice early — on a fragment that may still parse, so
   the suite goes green having tested something that is not the function. The
   mask is the same LENGTH as the source and keeps every newline, so an index
   found in it addresses the same character in the original; slices are always
   cut from the ORIGINAL, or every extracted function reaches new Function()
   with its strings blanked out.
   Duplicated in four suites. test/fixtures.js §0 asserts the copies are
   byte-identical and carries the rest of the reasoning — which literals the
   mask has to know about, and why. */
function maskLiterals(src){
  const out = src.split(""), n = src.length;
  const sp = k => { if(out[k] !== "\n") out[k] = " "; };
  /* after one of these words a "/" opens a regex; after any other identifier,
     after a number and after ) ] it divides */
  const REWORD = /^(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/;
  const stack = [{tmpl:false, depth:0}];
  let value = false;                       // the last token ended a value
  let i = 0;
  while(i < n){
    const top = stack[stack.length - 1], c = src[i];

    if(top.tmpl){                          // inside a template's TEXT
      if(c === "\\"){ sp(i); if(i + 1 < n) sp(i + 1); i += 2; continue; }
      if(c === "`"){ sp(i); i++; stack.pop(); value = true; continue; }
      if(c === "$" && src[i + 1] === "{"){ // the "$" goes, the "{" stays
        sp(i); stack.push({tmpl:false, depth:0}); i += 2; value = false; continue;
      }
      sp(i); i++; continue;
    }

    if(c === "/" && src[i + 1] === "/"){                       // line comment
      while(i < n && src[i] !== "\n"){ sp(i); i++; }
      continue;
    }
    if(c === "/" && src[i + 1] === "*"){                       // block comment
      const e = src.indexOf("*/", i + 2), end = e < 0 ? n : e + 2;
      while(i < end){ sp(i); i++; }
      continue;
    }
    if(c === '"' || c === "'"){                                // quoted string
      let j = i + 1;
      while(j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      if(j < n && src[j] === c){ while(i <= j){ sp(i); i++; } }
      else i++;                            // no close on this line: not a string
      value = true; continue;
    }
    if(c === "`"){ sp(i); stack.push({tmpl:true, depth:0}); i++; continue; }
    if(c === "/" && !value){                                   // regex literal
      let j = i + 1, cls = false, end = -1;
      for(; j < n; j++){
        const ch = src[j];
        if(ch === "\n") break;             // a regex does not span a line
        if(ch === "\\"){ j++; continue; }
        if(cls){ if(ch === "]") cls = false; continue; }
        if(ch === "[") cls = true;
        else if(ch === "/"){
          j++;
          while(j < n && /[A-Za-z]/.test(src[j])) j++;         // flags
          end = j; break;
        }
      }
      if(end > 0){ while(i < end){ sp(i); i++; } value = true; continue; }
    }
    if(/[A-Za-z0-9_$]/.test(c)){                               // identifier or number
      let j = i;
      while(j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      value = !REWORD.test(src.slice(i, j));
      i = j; continue;
    }
    if(c === "}" && top.depth === 0 && stack.length > 1){       // closes a ${ }
      stack.pop(); i++; value = true; continue;                 // stays visible
    }
    if(c === "{"){ top.depth++; value = false; i++; continue; }
    if(c === "}"){ top.depth--; value = false; i++; continue; }
    if(c === ")" || c === "]"){ value = true; i++; continue; }
    if(c === " " || c === "\t" || c === "\n" || c === "\r"){ i++; continue; }
    value = false; i++;
  }
  return out.join("");
}

const MASK = maskLiterals(SCRIPT);

function grabFn(name){
  const start = MASK.search(new RegExp("(^|\\n)(async\\s+)?function\\s+" + name + "\\s*\\("));
  if(start < 0) throw new Error("not found: function " + name);
  let depth = 0;
  for(let j = MASK.indexOf("{", start); j < MASK.length; j++){
    if(MASK[j] === "{") depth++;
    else if(MASK[j] === "}" && !--depth) return SCRIPT.slice(start, j + 1);
  }
  throw new Error("unbalanced: " + name);
}
function grabDecl(name){
  const m = new RegExp("(^|\\n)(const|let)\\s+" + name + "\\s*=").exec(MASK);
  if(!m) throw new Error("not found: " + name);
  const start = m.index + (m[1] ? 1 : 0);
  let depth = 0;
  for(let j = start; j < MASK.length; j++){
    const c = MASK[j];
    if("{[(".includes(c)) depth++;
    else if("}])".includes(c)) depth--;
    else if(c === ";" && depth === 0) return SCRIPT.slice(start, j + 1);
  }
  throw new Error("unterminated: " + name);
}

/* One listener body is needed whole: the "Replace photo" path lives in an
   inline handler, and its guard against a stale decode is exactly what §8
   tests. Pulling the real body out beats retyping it into the suite, where it
   would go on passing after the app stopped doing it. */
/* `nth` because #roster carries two click listeners — one for [data-act] and
   one for [data-fact] — and taking whichever comes first would silently give
   the wrong body to whatever asked. */
/* The needle is looked for in the ORIGINAL: it is made of string literals, and
   in the mask those are blank. Everything structural after it — the arrow, the
   opening brace, the depth count — reads the mask. */
/* Shared tail of grabListener and grabRawListener: from a known start index,
   find the arrow and the brace it opens, then count depth in the MASK back
   out to the matching close. */
function braceBody(start, label){
  const arrow = MASK.indexOf("=>", start);
  const open  = MASK.indexOf("{", arrow);
  let depth = 0;
  for(let j = open; j < MASK.length; j++){
    if(MASK[j] === "{") depth++;
    else if(MASK[j] === "}" && !--depth) return SCRIPT.slice(open, j + 1);
  }
  throw new Error("unbalanced listener: " + label);
}
function grabListener(selector, event, nth){
  const needle = '$("' + selector + '").addEventListener("' + event + '"';
  let start = -1;
  for(let i = 0; i < (nth || 1); i++){
    start = SCRIPT.indexOf(needle, start + 1);
    if(start < 0) throw new Error("not found: listener " + selector + " " + event
      + " #" + (nth || 1));
  }
  return braceBody(start, selector + " " + event);
}
/* For a listener bound to a variable rather than a fresh $(selector) call —
   the drop zone's two elements share one handler through a `zone` closure
   variable from a forEach, so grabListener's own needle-building (which
   assumes a literal $("#id") call) cannot find it. The needle is looked for
   verbatim, exactly as grabListener's own comment describes. */
function grabRawListener(needle, label){
  const start = SCRIPT.indexOf(needle);
  if(start < 0) throw new Error("not found: " + (label || needle));
  return braceBody(start, label || needle);
}

const DECLS = ["HEX6","CONTRAST_MIN","SVGNS",
               "uid","HISTORY_MAX","SESSION_IDLE","ZOOM_MAX","docName","dirtyDoc",
               "history","hIndex","historyPending","photoStore","photoIds","photoSeq","session",
               /* the bounds stateLimitProblem measures a roster against — ENUMS
                  because the layouts this build can draw are one of them */
               "LIMITS","ENUMS",
               /* saveDoc composes {app, format} onto the written copy — a free
                  identifier inside its own body, grabbed whole below */
               "FILE_FORMAT",
               "docGen","importBusy","openSeq","COMMANDS",
               /* the parked resolver askImport hands out and importClose calls */
               "importResolve",
               /* The paste dialog's rows and the sentinel that stands in for
                  "no grade this document has". The two names beside it are what
                  the sentinel resolves TO, and they are asserted against
                  COMMANDS.addGrade's defaults rather than restated here. */
               "pasteRows","PASTE_NEW","PASTE_NEW_CODE","PASTE_NEW_LABEL",
               /* the Add dialog's photo well: the decoded photo waiting for an
                  Add, and the radius its preview is placed at. PAN_STEP comes
                  along because the Add framing editor's own keydown listener
                  is grabbed whole below, and it is a free identifier inside
                  that body — exactly as ZOOM_MAX already was for the zoom
                  slider's bounds. */
               "addPending","PREVIEW_R","modalReturn","PAN_STEP","ADD_FRAME_KEY",
               /* Whichever row's menu is showing and whichever person the Edit
                  dialog is open on. resetPerRoster shuts both, so both come
                  along — a New or an Open that left either pointing at somebody
                  from the document just discarded is what that call prevents. */
               "personOpen","editId"];
/* cloneState is gone: history entries now cross a boundary that swaps photo
   bytes for store ids, so the two directions are named separately. commit()
   and edit() are the only ways state changes, so both come along. */
const FNS   = ["updateDocLabel","syncNeverSavedBar","markDirty","resetPerRoster","confirmDiscard","newDoc",
               /* saveDoc refuses a roster that exceeds the file limits before it
                  writes anything, so the limit check comes along with it — without
                  it the suite dies on the first Save rather than failing a case */
               "saveDoc","stateLimitProblem","encodedPhotoBytes","photoBudgetExceeded","openDoc","fileStem",
               /* toCSV is the flat-text export's one pure function; it is
                  driven directly against hand-built states rather than through
                  a command, so the quoting rule is asserted on its own. */
               "toCSV",
               "firstTierId",
               /* newTier is the one factory every CREATE path goes through, so it
                  comes along with the three callers this suite drives. */
               "newTier",
               /* TEMPLATES states grades AND layout AND accent AND ink together;
                  applyTemplate is the one path that reads it, so both come along
                  as a pair rather than one being driven through a stub. */
               "TEMPLATES","applyTemplate",
               "defaults","normalizeGradeLinks","reorderGrade","angleIndex","clampFrame",
               "frameLimit","photoPut","photoGet","photoSweep","packState","unpackState",
               "snapshot","canUndo","canRedo","undo","redo","render","commit","endEdit","edit",
               /* commit()/edit() both call pruneGroups after every mutate, and
                  toCSV/subline-adjacent paths read a person's group through
                  groupLabel — which reads what resolveGroupId (and the
                  newGroup it mints through) wrote. All four come along or
                  commit() itself cannot be extracted. */
               "newGroup","resolveGroupId","groupLabel","pruneGroups",
               /* Groups' one management surface (Structure ▸ Group): reorder,
                  rename-or-merge, and the drag drop reorderGroupRow answers
                  for. "move" is the generic array-swap moveGroup calls, the
                  same one the grade Left/Right buttons use inline. groupRow
                  and syncGroupModal are the list builder; open/closeGroupModal
                  round out the dialog's own lifecycle the way open/closePasteModal
                  do for that one. */
               "move","moveGroup","renameGroup","reorderGroupRow",
               "groupRow","syncGroupModal","openGroupModal","closeGroupModal",
               /* the asynchronous import paths and the generation guard that
                  keeps their results out of the wrong document */
               "newGeneration","staleWrite","addFiles","nameFromFile","photoFields","applyPhoto",
               /* the one comparison a dropped photo's derived name is judged
                  by, shared between addFiles' batch plan and the drop route's
                  single-add decision; addPhotoIntoDialog is the function both
                  the picker's change handler and that same drop route call to
                  put a decoded photo in the Add dialog's well */
               "photolessMatch","addPhotoIntoDialog",
               /* the Add people dialog: the one that creates a person, the one
                  that decides whether it may, and the two that open and close
                  it — a photo left in the well across a close is the failure
                  this batch exists to prevent, so both halves of the cycle are
                  driven rather than described.
                  setAddPhoto owns the well; frameRect comes with it so the
                  preview is placed by the shipped geometry and not a copy. */
               "addOnePerson","syncAddAvailability","openAddModal","closeAddModal",
               /* fillGroupOptions is the Group field's one suggestion-list
                  builder, real here (unlike the stubbed fillTierOptions) so the
                  datalist it fills is asserted against the shipped function
                  rather than a copy of its contract. */
               "fillGroupOptions",
               /* Real, not stubbed: their guards are what resetPerRoster relies
                  on, and a stub would go on being called after either lost one. */
               "closePersonMenu","closeEditModal",
               "setAddPhoto","frameRect",
               /* the Add dialog's own framing editor, sharing framePanel with
                  Edit's (grabbed below) but placing its preview and clamping
                  its frame through these two of its own */
               "syncAddFramePreview","addFrameShim",
               /* the placeholder circle's live initials — openAddModal and the
                  tail of a successful Add both call it after clearing Name by
                  hand, so it has to be real here or both throw */
               "syncAddPhotoInitials",
               /* the Add dialog's Role placeholder — the same tierRole(t)
                  policy as #editRole's, but keyed off whichever grade is
                  currently chosen in #addTier rather than off a person */
               "syncAddRolePlaceholder",
               /* the import dialog: the question addFiles asks, and the one way
                  out of it */
               "askImport","importClose",
               /* The paste dialog, end to end. It is here rather than in
                  test/import.js because what this batch changed is a COMMIT: the
                  NEW grade the sentinel resolves to has to arrive in the same
                  undo step as the people put in it, and this is the suite that
                  owns commit(), undo() and the history. The parsing helpers come
                  along because the preview builds its rows with the real ones —
                  a copy would go on passing after the app stopped matching
                  grades the way it does. el/fill/clear build the preview table
                  against the element stub below. */
               "splitCsvLine","splitPasteRow","matchTierByGrade","parsePasteText",
               "pasteNewTier",
               /* the zero-grade grouping policy —
                  the one place showPastePreview and confirmPaste both ask what
                  the list's own Grade column needs to build */
               "pasteGradePlan",
               "showPastePreview","confirmPaste",
               "openPasteModal","closePasteModal","el","fill","clear",
               /* addFiles bounds every field it builds against the same LIMITS */
               "clampText",
               /* the roster arrows: one resolver, and the two things that must
                  agree with it — the mutation and the history entry */
               "gradeName","moveTarget","moveLabelTo","moveLabel","movePerson",
               /* the drop entry point and the two helpers it resolves a
                  destination with — it drives movePerson rather than repeating
                  it, so all four come along together or none of them means
                  anything */
               "personSlot","personDropIsNoop","walkOnce","reorderPerson",
               /* syncRowIdentity itself changes no state — which is the point, and
                  therefore worth proving here rather than only reading */
               "personLabel","validatePhoto","moveAffordance","syncRowIdentity",
               /* the Accent hex field. validColour is what decides a colour
                  everywhere, including on Open, and hexFieldValue is the one
                  thing on top of it — so both come along and the suite drives
                  the real pair rather than restating the rule. checkContrast
                  and its WCAG arithmetic come too, so the warning is asserted
                  against the shipped threshold. */
               "validColour","hexFieldValue","luminance","contrastRatio","checkContrast",
               /* The Edit person dialog, end to end. Its fields commit through
                  edit() and its photo section is the one part of it built from
                  script, so both the writes and the swap between the section's
                  two states are driven here rather than described. removePerson
                  comes along because the dialog and the row menu are two faces
                  of it and the whole claim is that they are the same act. */
               "initials","tierRole","icon","personRowName","editPerson","firstName",
               "openEditModal","syncEditModal","syncEditPhoto","editPhotoBody",
               "framePanel","syncFramePreview","placeFramePreview",
               /* modalOpen and modalClose are deliberately NOT grabbed: the
                  PREAMBLE's pair records which dialog opened and closed, which
                  is what this suite asserts, and the real ones drive #shell's
                  inert state — chrome that test/dom.js owns. */
               "rowMenuFor","syncPersonMenu","focusPersonMenuItem","removePerson"];

/* Browser surface the document layer touches. Every interaction the user could
   have with a dialog is scripted, so a run is deterministic. */
const PREAMBLE = `
  let framingId = null, state = null;
  let TIMERS = 0;
  function setTimeout(fn){ TIMERS++; return TIMERS; }   // sessions never expire on their own here
  function clearTimeout(){}
  const DOWNLOADS = [], TOASTS = [], LABELS = [];
  let CONFIRM = true;            // what a confirm dialog resolves to
  let PROMPT  = null;            // what a text dialog resolves to (null = cancelled)
  let PICKED  = 0;               // times the file picker was opened
  const ASKED = [];              // every dialog raised, for inspecting the wording
  /* The real ask() opens a dialog and resolves when a button is clicked. Here
     it resolves immediately with a scripted answer, so a run stays
     deterministic — but it stays a PROMISE, because these paths are
     genuinely asynchronous, and a stub that resolved synchronously would let
     a caller's await slip past unnoticed. */
  function askConfirm(title, message, label){
    ASKED.push({kind:"confirm", title:title, message:message, label:label});
    return Promise.resolve(CONFIRM);
  }
  /* COMMANDS.addGrade asks for a code and a name and offers a default for each.
     Answered here with exactly the defaults it offered — pressing Enter twice,
     which the command's own comment confirms is still the fast path — so
     the grade it creates can be compared against the one a paste creates
     without either being compared to the constant it was built from. */
  const ASKED_FIELDS = [];
  let FIELD_ANSWER = "defaults";     // "defaults", null for cancelled, or an object
  function askFields(title, message, fields, confirmLabel){
    ASKED_FIELDS.push({title:title, message:message, fields:fields, label:confirmLabel});
    if(FIELD_ANSWER !== "defaults") return Promise.resolve(FIELD_ANSWER);
    const out = {};
    (fields || []).forEach(f => { out[f.key] = f.value; });
    return Promise.resolve(out);
  }
  function askText(title, message, value){
    ASKED.push({kind:"text", title:title, message:message, value:value});
    return Promise.resolve(PROMPT);
  }
  function toast(m){ TOASTS.push(m); }
  const ALERTS = [];
  function alertMsg(m){ ALERTS.push(m); }
  /* renderAll rebuilds the roster on its way through, which is what puts an
     undone photo back into the open dialog. Same standing as the two calls
     below: that the APP'S renderAll does it is test/dom.js's assertion. */
  const STEPS = {n:0};
  function renderAll(){ renderRoster(); }
  /* The two the real renderRoster makes at this point, and the reason a commit
     from inside the dialog is a whole path here rather than a call followed by
     a hand-run sync. That the APP'S renderRoster still makes them is
     test/dom.js's assertion; what this reproduces is the ordering they happen
     in, so the behaviour under test is driven the way a click drives it. */
  function renderRoster(){ syncPersonMenu(); syncEditModal(); }
  function drawChart(){}
  function updateHistoryButtons(){}
  function Blob(parts, opts){ this.parts = parts; this.type = opts && opts.type; }
  /* WRITTEN keeps the bytes as well as the name, so a test can read back what a
     roster file actually contains rather than only that one was produced. */
  const WRITTEN = [];
  function download(blob, name){
    DOWNLOADS.push(name);
    WRITTEN.push({name:name, text:(blob && blob.parts || []).join("")});
  }

  /* Decoding is where the document can change underneath an import, so the
     stub hands the test the resolver instead of resolving on its own. Nothing
     completes until the test says so, which is what makes "New was pressed
     halfway through the batch" an ordinary, deterministic assertion. */
  const DECODES = [];
  function processImage(file){
    return new Promise((res, rej) => DECODES.push({name:file.name, res:res, rej:rej}));
  }
  let swapId = null;                  // the row whose photo is being replaced

  /* The import dialog. addFiles asks before it imports now, so a suite that
     never answers would hang on the first drop — IMPORT_ANSWER is what the
     dialog will be answered with, and it defaults to null, which is Cancel.
     A test that wants an import says so with answerImportWith().
     The dialog function itself is the REAL one: what is stubbed is the DOM it
     writes to and modalOpen, so the count wording and the no-grades state are
     asserted against the shipped logic rather than a copy of it. */
  const IMPORT = {count:"", countShown:true, noGradesShown:false,
                  confirmDisabled:false, tier:"", group:""};
  let IMPORT_ANSWER = null;
  const MODALS = [];
  function modalOpen(id, focusEl){
    MODALS.push({id:id, action:"open"});
    if(id === "#importModal"){
      /* answered on a later turn, the way a user would: addFiles must be parked
         on the promise before anything resolves it */
      const answer = IMPORT_ANSWER;
      Promise.resolve().then(()=> importClose(answer));
    }
  }
  function modalClose(id){ MODALS.push({id:id, action:"close"}); }

  /* The Add people dialog's fields, as state rather than as DOM. A test drives
     them with setAdd() and reads them back after an Add, which is how "Grade
     and Group persist while Photo and Name clear" becomes an assertion rather
     than a screenshot. tierFieldShown/firstGradeFieldShown/templateHintShown
     are what syncAddAvailability writes now that zero grades is a door, not a
     wall: it toggles which half of the Grade row is on screen instead of
     disabling anything. wellShown is what setAddPhoto's own hidden-toggle
     writes; what the well actually shows with a photo in it — the decoded
     bytes, and the frame a drag or a zoom left behind — is addPending itself
     now that both dialogs share framePanel, exactly as Edit's own preview is
     read off the person rather than off a DOM node. */
  const ADD = {tier:"", group:"", name:"", role:"", rolePlaceholder:"", files:[],
               firstGrade:"",
               tierFieldShown:true, firstGradeFieldShown:false, templateHintShown:false,
               wellShown:false, pickText:""};
  /* The Group field's shared suggestion list, filled by the real fillGroupOptions
     through the real clear()/el() — one persistent element for the whole run,
     same reason #pasteTableBody is, so a refill is observably a replacement
     rather than a write into a throwaway. */
  let GROUP_OPTIONS = null;
  /* The Group modal's own list, filled by the real syncGroupModal through the
     real fill()/el() — one persistent element for the whole run, same reason
     #pasteTableBody and #groupOptions above are, so a rebuild is observably a
     replacement rather than a write into a throwaway. GROUP_EMPTY is the
     empty-state paragraph's hidden flag, backed the same way #pastePreview's is. */
  let GROUP_LIST = null;
  const GROUP_EMPTY = {hidden: false};
  const FOCUSED = [];
  /* The placeholder section's one focusable control, reached by the Add
     framing editor's own remove handler exactly as Edit's reaches into its
     rebuilt #editPhoto — a persistent object, not a fresh one per lookup, so
     a focus() call on it is observable afterwards. */
  const ADD_EMPTY_PICK = {focus(){ FOCUSED.push("#addPhotoPick"); }};
  /* The real one builds <option> elements; what addOnePerson depends on is only
     that the select ends up holding the id it asked to keep. test/fixtures.js
     owns the option-building against a DOM stub. */
  function fillTierOptions(select, want){ select.value = want || ""; return select; }

  /* ---- the paste dialog -------------------------------------------------

     el(), fill() and clear() are the REAL ones, so the preview table is built by
     the app's own constructors; what is stubbed is the element they build. Only
     what showPastePreview actually writes is backed: a tag, a class, a title,
     textContent, and children. firstChild/removeChild are here because clear()
     walks them, and a stub without them would make fill() throw rather than
     empty the body — a throw abandons the section and looks like coverage. */
  function stubEl(tag){
    const n = {tag:tag, className:"", title:"", textContent:"", kids:[]};
    Object.defineProperty(n, "firstChild", {get(){ return n.kids[0] || null; }});
    n.appendChild = k => { n.kids.push(k); return k; };
    n.removeChild = k => { const i = n.kids.indexOf(k); if(i >= 0) n.kids.splice(i,1); return k; };
    n.setAttribute = (a, v) => { n[a] = v; };
    /* Enough of a query for the one thing the app asks a built subtree: which
       control to put focus on after a rebuild. Tag and the :not([disabled])
       filter only — a selector shape it does not implement throws, where
       shrugging would be indistinguishable from "the app did not look". */
    n.querySelector = sel => {
      const live = sel.indexOf(":not([disabled])") > 0;
      const tag  = live ? sel.slice(0, sel.indexOf(":")) : sel;
      if(!/^[a-z]+$/.test(tag))
        throw new Error("stubEl querySelector: unsupported selector " + sel);
      const hit = k => (k.tag === tag && (!live || !k.disabled)) ? k
                     : (k.querySelector ? k.querySelector(sel) : null);
      for(const k of n.kids){ const found = hit(k); if(found) return found; }
      return null;
    };
    n.focus = () => { FOCUSED.push(n.tag + ":" + (n.dataset.act || n.dataset.fact || "")); };
    n.dataset = {};
    return n;
  }
  /* Nothing else in this suite touches the document object — every extracted
     function that would has its DOM stubbed at $() instead — so this exists only
     for el() and the preview's text nodes. (No backticks in PREAMBLE: it is one
     template literal, and a quoted identifier in a comment ends it.) */
  const document = {createElement:stubEl,
                    /* icon() builds its <svg><use> in the SVG namespace, and
                       createElement would give it an inert HTML element of the
                       same name — so the stub answers both, and records which. */
                    createElementNS(ns, tag){ const n = stubEl(tag); n.ns = ns; return n; },
                    contains(){ return false; },
                    createTextNode(t){ const n = stubEl("#text"); n.textContent = String(t); return n; }};
  /* Everything the built table says, flattened the way a browser's own
     textContent would read it. This is what makes "the Grade column names NEW"
     an assertion about the emitted cell rather than about a variable. */
  function cellText(n){
    if(!n) return "";
    return (n.textContent || "") + n.kids.map(cellText).join("");
  }
  /* The dialog as state. PASTE.body is filled by the real fill() through the
     #pasteTableBody stub, so it holds whatever the real preview emitted. */
  const PASTE = {area:"", entryShown:false, previewShown:false, summary:"",
                 body:null, addDisabled:false, addTitle:"",
                 replaceDisabled:false, replaceTitle:""};
  function pasteCells(){
    return (PASTE.body ? PASTE.body.kids : []).map(tr => tr.kids.map(cellText));
  }

  /* Opening is asynchronous twice over — a read, then one image decode per
     photo — so the same trick as the decode stub: openRoster hands the test its
     resolver and finishes only when the test says so. That is what makes "two
     Opens finishing in the wrong order" a deterministic assertion instead of a
     race nobody can reproduce. */
  const OPENS = [];
  function openRoster(raw, options){
    return new Promise((res, rej) => OPENS.push({raw:raw, options:options, res:res, rej:rej}));
  }
  const OPENING = [];                 // every status message the open path set
  function openingStatus(m){ OPENING.push(m || ""); }
  let READ_FAILS = false;             // make the next FileReader fail instead
  let READ_HOLD  = false;             // …or neither, until the test says which
  /* A read that finishes immediately cannot be superseded, because nothing can
     happen between readAsText and onerror. READ_HOLD parks the reader instead
     and hands the test its two endings, which is what makes "the file failed to
     read AFTER a newer Open started" an ordinary assertion. */
  const READS = [];
  function FileReader(){
    const self = this;
    this.readAsText = function(f){
      READS.push({
        name: f.name,
        fail(){ self.onerror && self.onerror(); },
        deliver(){ self.result = f.text; self.onload && self.onload(); }
      });
      if(READ_HOLD) return;
      if(READ_FAILS){ self.onerror && self.onerror(); return; }
      self.result = f.text;
      self.onload && self.onload();
    };
  }

  /* The status strip is stateful across calls, so these have to be the SAME
     objects every time — a fresh stub per lookup would make every assertion
     about what updateDocLabel produced read back its own default. */
  /* ICON_WRITES traps any attempt to drive the icons from script. That is the
     bug this whole area exists for: setting .hidden on an <svg> writes a
     property the browser never reads, so the only safe rule is that
     updateDocLabel does not touch these two elements at all. A write recorded
     here is a failure, not a state. */
  const ICON_WRITES = [];
  function iconStub(id){
    const o = {id:id};
    ["hidden","style","className"].forEach(prop => {
      Object.defineProperty(o, prop, {
        get(){ return undefined; },
        set(v){ ICON_WRITES.push(id + "." + prop + " = " + v); }
      });
    });
    return o;
  }
  /* TITLE_WRITES traps any attempt to write a tooltip from updateDocLabel —
     there is no tooltip at all, since the status text beside the icon is
     visible on its own. A write recorded here is
     a regression, not a state; nothing legitimately reads DOC.name.title any
     more, so there is no getter returning a real value to trip up. */
  const TITLE_WRITES = [];
  const DOC = {
    name:    {classes:{}, classList:{toggle(c,on){ DOC.name.classes[c] = !!on; }},
              get title(){ return undefined; },
              set title(v){ TITLE_WRITES.push(v); }},
    text:    {textContent:""},
    saved:   iconStub("docIconSaved"),
    unsaved: iconStub("docIconUnsaved"),
    status:  {textContent:""}
  };
  const NEVER_SAVED = {hidden:true, text:""};
  /* The Accent control: the OS picker's value, the hex field's text, and what
     the contrast warning is showing. SUMMARIES counts the ribbon refresh, which
     is what keeps the swatch in step with the value. */
  /* ink is the third control the swatches write: a curated accent sets the text
     colour that goes on it as well, and a stub that dropped that write would let
     "the ribbon still shows both" pass while the app showed one. */
  const EDIT = {name: stubEl("input"), group: stubEl("input"),
                role: stubEl("input"), tier: stubEl("select"),
                photo: stubEl("div"), menu: stubEl("div")};
  EDIT.menu.hidden = true;            // no row menu is showing unless a test opens one
  ["name","group","role","tier"].forEach(k => { EDIT[k].value = ""; });
  EDIT.role.placeholder = "";
  const COLOUR = {picker:"", hex:"", ink:""};
  const WARN = {shown:false, text:"", badge:false};
  /* The drop zone's own element: zoneDrop (grabbed below) reads it as a free
     closure variable, exactly as the shipped listener does — it is bound to
     one zone shared by both drop targets through a forEach, not built fresh
     per $(selector) call, so it needs a standing stub rather than one riding
     along inside $(). Only .classList.remove is ever called on it. */
  let zone = {classList:{add(){}, remove(){}}};
  let SUMMARIES = 0;
  function syncStyleSummaries(){ SUMMARIES++; }
  function $(sel){
    if(sel === "#jsonPick") return {click(){ PICKED++; }};
    /* a roster host that contains nothing: syncRowIdentity runs end to end and finds
       no control to write to, which is exactly the shape this suite watches —
       whether it touched the DOCUMENT. test/fixtures.js owns the labels. */
    if(sel === "#roster") return {querySelector(){ return null; }};
    /* No row menu is open unless a test opens one, and this is the state
       closePersonMenu returns on. */
    if(sel === "#personMenu") return EDIT.menu;
    /* The Edit dialog. Its four fields are static markup in the app, so they are
       backed values here — a catch-all stub returns a fresh object per lookup,
       and "the dialog shows this person's group" would then be asserted against
       a throwaway. #editPhoto is ONE element for the whole run for the same
       reason: what a rebuild put in it has to be readable afterwards — and it
       needs real children, because the Remove photo branch looks inside the
       rebuilt section for something to put focus on. */
    if(sel === "#editName")   return EDIT.name;
    if(sel === "#editGroup")  return EDIT.group;
    if(sel === "#editRole")   return EDIT.role;
    if(sel === "#editTier")   return EDIT.tier;
    if(sel === "#editPhoto")  return EDIT.photo;
    if(sel === "#importCount")   return {get textContent(){ return IMPORT.count; },
                                         set textContent(v){ IMPORT.count = v; },
                                         get hidden(){ return !IMPORT.countShown; },
                                         set hidden(v){ IMPORT.countShown = !v; }};
    if(sel === "#importNoGrades")return {get hidden(){ return !IMPORT.noGradesShown; },
                                         set hidden(v){ IMPORT.noGradesShown = !v; }};
    if(sel === "#importConfirmBtn") return {get disabled(){ return IMPORT.confirmDisabled; },
                                            set disabled(v){ IMPORT.confirmDisabled = v; }};
    if(sel === "#importTier")   return {get value(){ return IMPORT.tier; },
                                        set value(v){ IMPORT.tier = v; }};
    if(sel === "#importGroup")  return {get value(){ return IMPORT.group; },
                                        set value(v){ IMPORT.group = v; }};
    if(sel === "#addTier")    return {get value(){ return ADD.tier; },
                                      set value(v){ ADD.tier = v; }};
    if(sel === "#addGroup")   return {get value(){ return ADD.group; },
                                      set value(v){ ADD.group = v; }};
    if(sel === "#addName")    return {get value(){ return ADD.name; },
                                      set value(v){ ADD.name = v; },
                                      focus(){ FOCUSED.push("#addName"); }};
    if(sel === "#addRole")    return {get value(){ return ADD.role; },
                                      set value(v){ ADD.role = v; },
                                      get placeholder(){ return ADD.rolePlaceholder; },
                                      set placeholder(v){ ADD.rolePlaceholder = v; }};
    /* The placeholder circle's live initials, backed by a real value rather
       than a fresh throwaway — otherwise "the picker's own fill syncs the
       initials too" could only be checked by reading setAddPhotoInitials'
       own source text, which is the claim and its evidence from one place. */
    if(sel === "#addPhotoPick")
                              return {get textContent(){ return ADD.pickText; },
                                      set textContent(v){ ADD.pickText = v; }};
    /* setting .value on a file input is how a browser clears it; the only
       reading it supports is .files */
    if(sel === "#addPhoto")   return {get files(){ return ADD.files; },
                                      set value(v){ ADD.files = []; },
                                      focus(){ FOCUSED.push("#addPhoto"); },
                                      /* Replace photo (Add's own framing editor)
                                         opens this same picker, exactly as
                                         #addPhotoPick and #addPhotoBtn already
                                         do — counted the same way #jsonPick's
                                         click is. */
                                      click(){ PICKED++; }};
    /* Filled from script now, exactly like #editPhoto: setAddPhoto fills it
       with framePanel's own tree through the real fill()/clear(), so this
       stub only has to support that traffic without throwing — what the
       panel actually contains is addPending's own business, asserted
       directly rather than by reading a DOM node back. */
    if(sel === "#addPhotoWell")
                              return {get hidden(){ return !ADD.wellShown; },
                                      set hidden(v){ ADD.wellShown = !v; },
                                      firstChild:null,
                                      appendChild(k){ return k; },
                                      removeChild(k){ return k; }};
    /* The placeholder section a Remove reaches back into for a focus target —
       persistent, so a focus() the handler calls on it is observable. */
    if(sel === "#addPhotoEmpty")
                              return {querySelector(q){
                                        return q === "button:not([disabled])" ? ADD_EMPTY_PICK : null; }};
    /* The Grade row's two halves — syncAddAvailability shows exactly one of
       them depending on whether the document has a grade yet. Own backing
       values, not aliases of one another, for the same reason the three
       Structure availability targets below are: a stub that coupled them
       could not tell "the row genuinely swapped" from "one write reached two
       properties". */
    if(sel === "#addTierField")
                              return {get hidden(){ return !ADD.tierFieldShown; },
                                      set hidden(v){ ADD.tierFieldShown = !v; }};
    if(sel === "#addFirstGradeField")
                              return {get hidden(){ return !ADD.firstGradeFieldShown; },
                                      set hidden(v){ ADD.firstGradeFieldShown = !v; }};
    if(sel === "#addFirstGrade")
                              return {get value(){ return ADD.firstGrade; },
                                      set value(v){ ADD.firstGrade = v; }};
    if(sel === "#addTemplateHint")
                              return {get hidden(){ return !ADD.templateHintShown; },
                                      set hidden(v){ ADD.templateHintShown = !v; }};
    /* The two halves of the Accent control, backed by real values so the sync
       between them is observable. A catch-all stub returns a fresh object per
       lookup, so "the picker updated the field" would write into a throwaway
       and every assertion about it would pass. */
    if(sel === "#accent")     return {get value(){ return COLOUR.picker; },
                                      set value(v){ COLOUR.picker = v; }};
    if(sel === "#accentHex")  return {get value(){ return COLOUR.hex; },
                                      set value(v){ COLOUR.hex = v; }};
    if(sel === "#inkOnColour")return {get value(){ return COLOUR.ink; },
                                      set value(v){ COLOUR.ink = v; }};
    /* checkContrast is the REAL one here, so the warning is asserted against
       the shipped WCAG arithmetic rather than a copy of the threshold. */
    if(sel === "#contrastWarn")  return {get hidden(){ return !WARN.shown; },
                                         set hidden(v){ WARN.shown = !v; },
                                         get textContent(){ return WARN.text; },
                                         set textContent(v){ WARN.text = v; }};
    if(sel === "#textWarnBadge") return {get hidden(){ return !WARN.badge; },
                                         set hidden(v){ WARN.badge = !v; }};
    /* The paste dialog. #pasteTableBody is one element for the whole run, so a
       table filled and then re-filled is observably replaced rather than written
       into a throwaway — which is what lets a second preview be asserted at all. */
    if(sel === "#pasteArea")     return {get value(){ return PASTE.area; },
                                         set value(v){ PASTE.area = v; },
                                         focus(){ FOCUSED.push("#pasteArea"); }};
    if(sel === "#pasteEntry")    return {get hidden(){ return !PASTE.entryShown; },
                                         set hidden(v){ PASTE.entryShown = !v; }};
    if(sel === "#pastePreview")  return {get hidden(){ return !PASTE.previewShown; },
                                         set hidden(v){ PASTE.previewShown = !v; }};
    if(sel === "#pastePreviewSummary")
                                 return {get textContent(){ return PASTE.summary; },
                                         set textContent(v){ PASTE.summary = v; }};
    if(sel === "#pasteTableBody"){
      if(!PASTE.body) PASTE.body = stubEl("tbody");
      return PASTE.body;
    }
    if(sel === "#pasteAddBtn")   return {get disabled(){ return PASTE.addDisabled; },
                                         set disabled(v){ PASTE.addDisabled = v; },
                                         get title(){ return PASTE.addTitle; },
                                         set title(v){ PASTE.addTitle = v; }};
    /* Its own backing values, not a second view of the Add button's: a stub that
       aliased them could not tell "the grade limit disables both actions" from
       "one write reached one element twice". */
    if(sel === "#pasteReplaceBtn")
                                 return {get disabled(){ return PASTE.replaceDisabled; },
                                         set disabled(v){ PASTE.replaceDisabled = v; },
                                         get title(){ return PASTE.replaceTitle; },
                                         set title(v){ PASTE.replaceTitle = v; }};
    if(sel === "#docName")       return DOC.name;
    if(sel === "#docText")       return DOC.text;
    if(sel === "#docIconSaved")  return DOC.saved;
    if(sel === "#docIconUnsaved")return DOC.unsaved;
    if(sel === "#docStatus")     return DOC.status;
    if(sel === "#neverSaved")    return {get hidden(){ return NEVER_SAVED.hidden; },
                                         set hidden(v){ NEVER_SAVED.hidden = !!v; },
                                         get textContent(){ return NEVER_SAVED.text; },
                                         set textContent(v){ NEVER_SAVED.text = v; }};
    if(sel === "#groupOptions"){
      if(!GROUP_OPTIONS) GROUP_OPTIONS = stubEl("datalist");
      return GROUP_OPTIONS;
    }
    if(sel === "#groupList"){
      if(!GROUP_LIST) GROUP_LIST = stubEl("div");
      return GROUP_LIST;
    }
    if(sel === "#groupEmpty") return {get hidden(){ return GROUP_EMPTY.hidden; },
                                      set hidden(v){ GROUP_EMPTY.hidden = !!v; }};
    /* Anything that is not an id is not on screen in this suite: there is no
       document to query, and the throwaway below would answer "yes there is" to
       every one of them. syncFramePreview asks for the framing circle by class
       and must find nothing here — test/fixtures.js is where that tree exists. */
    if(sel.charAt(0) !== "#") return null;
    /* modalOpen and modalClose reach for #shell and the dialog's own backdrop,
       and neither is what this suite watches — but a stub that threw on them
       would abandon the section instead of failing it. */
    return {textContent:"", classList:{toggle(){}}, click(){ PICKED++; },
            files:[], value:""};
  }
`;

function makeModule(){
  const src = PREAMBLE
    + DECLS.map(grabDecl).join("\n") + "\n"
    + FNS.map(n => { try{ return grabFn(n); }catch(e){ return grabDecl(n); } }).join("\n") + "\n"
    + "async function swapChange(e)" + grabListener("#fileSwap", "change") + "\n"
    /* the file-open path, taken whole for the same reason as swapChange: the
       sequence guard that decides which of two Opens wins lives in this
       listener and nowhere else */
    + "function pickChange(e)" + grabListener("#jsonPick", "change") + "\n"
    /* The three Accent handlers, taken whole for the same reason: the decision
       not to commit a half-typed value, and the session key that makes a typed
       colour one undo step, live in these bodies and nowhere else. Retyping
       them into the suite is how a test goes on passing after the app stops
       doing it. */
    /* The event target IS the control, as it is in a browser: the value goes
       into the field first and the handler reads it back off e.target. A
       synthetic {value:…} target instead would leave the real stub untouched,
       and "the field is not rewritten mid-session" would be asserting about a
       field nothing had ever written to. */
    + "function accentPick(v){ COLOUR.picker = v; accentPickInput({target:$('#accent')}); }\n"
    + "function accentPickInput(e)" + grabListener("#accent", "input") + "\n"
    + "function typeHex(v){ COLOUR.hex = v; hexInput({target:$('#accentHex')}); }\n"
    + "function hexInput(e)" + grabListener("#accentHex", "input") + "\n"
    + "function hexBlur()"   + grabListener("#accentHex", "blur") + "\n"
    /* The framing editor's button row — #editModal's SECOND click listener; the
       first is the one verb the no-photo state carries. Taken
       whole, and for the same reason as the two above: "Remove photo" is one
       call to applyPhoto inside this body, and a suite that reached for
       applyPhoto directly would go on passing after the handler stopped using
       it. The other three branches are not evaluated on a remove, so the
       identifiers they reach for do not have to exist here. */
    + "function rosterFact(e)" + grabListener("#editModal", "click", 2) + "\n"
    /* The picker, taken whole for the same reason as the three above: the
       decode, the generation capture, the importBusy pair and the choice of
       wording for a refused file all live in this body and nowhere else. A
       suite that called processImage and setAddPhoto itself would go on passing
       after the listener stopped doing either. */
    + "async function pickPhoto(e)" + grabListener("#addPhoto", "change") + "\n"
    /* The drop zone's own routing decision: a
       single dropped photo naming nobody photo-less goes to the Add dialog
       through addPhotoIntoDialog; everything else still goes to addFiles.
       Taken whole for the same reason as the listeners above — the
       single-vs-batch decision and the name-match check live in this body and
       nowhere else, and a suite that called addFiles/openAddModal itself
       would go on passing after the listener stopped choosing between them. */
    + "function zoneDrop(e)" + grabRawListener('zone.addEventListener("drop", e=>{', "zone drop") + "\n"
    /* The Add dialog's own framing editor — three listeners on #addModal,
       parallel to #editModal's own three above, taken whole for the same
       reason: the heart of this batch is what these bodies must NOT do
       (no edit(), no commit(), no snapshot(), no endEdit()), and a suite that
       called addPending.frame's fields directly would go on passing after a
       handler started reaching for state instead. #addModal's keydown is the
       SECOND listener bound to that event — the first is Enter-submits. */
    + "function addFrameClick(e)" + grabListener("#addModal", "click") + "\n"
    + "function addFrameZoom(e)"  + grabListener("#addModal", "input") + "\n"
    + "function addFramePan(e)"   + grabListener("#addModal", "keydown", 2) + "\n"
    /* The Edit dialog's four fields and its Remove person, and the row menu's
       four items — every one of them taken whole for the reason the handlers
       above are: what makes a burst of typing ONE history entry is the edit()
       key written in these bodies, and a suite that called edit() itself would
       choose its own key and go on passing after the app changed one. */
    + "function typeName(e)"   + grabListener("#editName", "input") + "\n"
    + "function typeGroup(e)" + grabListener("#editGroup", "input") + "\n"
    + "function typeRole(e)"   + grabListener("#editRole", "input") + "\n"
    + "function pickGrade(e)"  + grabListener("#editTier", "change") + "\n"
    + "function clickRemovePerson()" + grabListener("#editRemoveBtn", "click") + "\n"
    + "function menuClick(e)"  + grabListener("#personMenu", "click") + "\n"
    + `return {
        addFiles, swapChange, newGeneration, staleWrite, applyPhoto,
        /* the click, not the function it happens to call */
        clickFact(verb, id){
          rosterFact({target:{closest(sel){
            return sel === "[data-fact]" ? {dataset:{fact:verb, id:id}} : null;
          }}});
        },
        pick(name, text){ pickChange({target:{files:[{name:name, text:text}], value:"x"}}); },
        get opens(){ return OPENS; },
        get opening(){ return OPENING; },
        setReadFails(v){ READ_FAILS = v; },
        setReadHold(v){ READ_HOLD = v; },
        get reads(){ return READS; },
        get docGen(){ return docGen; },
        get decodes(){ return DECODES; },
        get alerts(){ return ALERTS; },
        askImport, importClose,
        /* what the import dialog will be answered with. null is Cancel, which
           is also the default, so a test that never answers imports nobody
           rather than hanging. */
        answerImportWith(tierId, group){ IMPORT_ANSWER = {tierId:tierId, groupText:group || ""}; },
        cancelImport(){ IMPORT_ANSWER = null; },
        get import(){ return IMPORT; },
        get modals(){ return MODALS; },
        setSwapId(v){ swapId = v; },
        addOnePerson, syncAddAvailability, openAddModal, closeAddModal,
        syncAddRolePlaceholder,
        setAdd(o){ Object.assign(ADD, o); },
        get add(){ return ADD; },
        /* The Group field's suggestion list, read back as the plain array of
           option values fillGroupOptions actually wrote — not the element
           itself, so a test compares against a literal rather than the stub's
           own shape. */
        get groupOptions(){ return GROUP_OPTIONS ? GROUP_OPTIONS.kids.map(k => k.value) : null; },
        fillGroupOptions,
        /* The paste dialog, driven the way a user drives it: text into the
           textarea, then Preview, then one of the two actions. The functions are
           the real ones — nothing here decides where a row goes. */
        openPasteModal, closePasteModal,
        preview(text){
          if(text != null) PASTE.area = text;
          showPastePreview();
        },
        pasteAdd(){ confirmPaste(false); },
        pasteReplace(){ confirmPaste(true); },
        get paste(){ return PASTE; },
        /* every cell of the built table, as [name, grade, group] strings */
        pasteCells,
        /* what the preview left behind for the commit to read */
        get pasteRows(){ return pasteRows; },
        PASTE_NEW, PASTE_NEW_CODE, PASTE_NEW_LABEL, pasteNewTier, parsePasteText,
        /* The choice, as the user makes it: the file goes into the input and
           the listener reads it back off e.target, exactly as a browser hands
           it over. A synthetic {files:…} target instead would leave the real
           stub untouched, and "a refused file left the input empty" would be
           asserting about an input nothing had ever written to. */
        choosePhoto(f){
          ADD.files = f ? [f] : [];
          return pickPhoto({target:$("#addPhoto")});
        },
        /* A drop, driven the way the real listener receives one: a synthetic
           event carrying dataTransfer.files, exactly what e.dataTransfer.files
           is in a browser. zoneDrop is not async — it calls out to async work
           without awaiting it, same as the shipped listener — so callers that
           care about the outcome still need tick()/settle() same as addFiles. */
        dropOn(files){
          return zoneDrop({preventDefault(){}, dataTransfer:{files: files}});
        },
        photolessMatch,
        /* The Add dialog's own framing editor, driven the way a user drives
           it — a click on one of the three [data-fact] buttons, a value typed
           into the zoom slider, an arrow key on the circle — through the real
           delegated listeners rather than by touching addPending.frame by
           hand, which is exactly what would hide a handler that forgot to go
           through clampFrame or started calling edit()/commit() itself. */
        addClickFact(verb){
          addFrameClick({target:{closest(sel){
            return sel === "[data-fact]" ? {dataset:{fact:verb}} : null;
          }}});
        },
        addZoom(v){
          addFrameZoom({target:{dataset:{fact:"zoom"}, value:String(v)}});
        },
        addPanKey(key, shift){
          addFramePan({target:{closest(sel){
            return sel === '[data-fact="pan"]' ? {} : null;
          }}, key:key, shiftKey:!!shift, preventDefault(){}});
        },
        setAddPhoto, frameRect, encodedPhotoBytes, photoBudgetExceeded, LIMITS, PREVIEW_R,
        /* The Edit dialog, driven the way a user drives it: open it on somebody,
           put text in a field, let the field's own handler read it back. A
           synthetic {value:…} target would leave the real field untouched, and
           "the dialog still shows what was typed" would assert about a
           throwaway. */
        openEditModal, closeEditModal, removePerson,
        get editId(){ return editId; },
        /* Not named "edit": that is the app's own edit() a few lines down, and
           an object literal keeps the last of two identical keys.
           (No backticks here — this whole block is one template literal.) */
        get editFields(){ return EDIT; },
        typeInto(which, v){
          const map = {name:["#editName", typeName], group:["#editGroup", typeGroup],
                       role:["#editRole", typeRole]};
          const [sel, fn] = map[which];
          $(sel).value = v;
          fn({target:$(sel)});
        },
        chooseGrade(id){ EDIT.tier.value = id; pickGrade({target:EDIT.tier}); },
        clickRemovePerson,
        /* Everything the roster row's caret opens. personOpen is set the way
           openPersonMenu sets it — that function measures and places the popup,
           which this suite has no geometry for — and the click is then the real
           delegated handler. */
        openMenuOn(id){ personOpen = id; },
        get personOpen(){ return personOpen; },
        clickMenu(verb, id){
          menuClick({target:{closest(sel){
            return sel === "[data-act]"
              ? {dataset:{act:verb, id:id}, disabled:false} : null;
          }}});
        },
        /* what the photo section currently holds, flattened far enough to tell
           its two states apart */
        photoSection(){
          const verbs = [];
          (function walk(n){
            if(!n) return;
            if(n.dataset && n.dataset.fact) verbs.push("fact:" + n.dataset.fact);
            if(n.dataset && n.dataset.act)  verbs.push("act:" + n.dataset.act);
            (n.kids || []).forEach(walk);
          })(EDIT.photo);
          return {verbs: verbs, text: cellText(EDIT.photo)};
        },
        get pending(){ return addPending; },
        /* by hand, the way a careless edit would — what the one-owner rule
           forbids, so a test can prove the rule is what catches it */
        setPendingDirectly(v){ addPending = v; },
        get focused(){ return FOCUSED; },
        newDoc, saveDoc, openDoc, markDirty, updateDocLabel, resetPerRoster, confirmDiscard,
        TEMPLATES, applyTemplate, newTier, defaults, normalizeGradeLinks, reorderGrade, stateLimitProblem,
        gradeName, moveTarget, moveLabel, moveLabelTo, movePerson, syncRowIdentity,
        /* The drop entry point, plus a way to make its step refuse. The bound
           and the restore are only reachable through a movePerson that stops
           making progress, and there is no roster shape that produces one — so
           the step is broken deliberately, and the SHIPPED guard, restore and
           report are what run. */
        reorderPerson,
        /* STEPS counts the calls the walk actually makes. Without it the
           progress check is invisible: the fuel bound catches a step that never
           moves anyone too, just N spins later, so "it stops when a step changes
           nothing" and "it stops eventually" are the same assertion until the
           number of steps is readable. */
        get steps(){ return STEPS.n; },
        resetSteps(){ STEPS.n = 0; },
        /* n real steps, then a step that achieves nothing. breakTheStep() alone
           stalls on the FIRST call, so nobody is ever half-moved and the array
           restore is never the thing that puts the roster back — it passed with
           the restore deleted. This leaves a person genuinely mid-walk. */
        breakTheStepAfter(n){
          let left = n;
          const real = movePerson;
          movePerson = (id, dir) => { STEPS.n++; if(left-- > 0) real(id, dir); };
        },
        breakTheStep(){ movePerson = ()=>{ STEPS.n++; }; },
        commands: COMMANDS,
        snapshot, undo, redo, canUndo, canRedo, fileStem, toCSV,
        /* the second-dimension entity: groupLabel is the one reader every
           assertion below uses to turn a person's groupId back into the text
           it was resolved from — the same function subline() and toCSV()
           themselves call, never a second hand-rolled lookup living only in
           this suite. */
        groupLabel, resolveGroupId, pruneGroups,
        /* Groups' management surface, driven the way a click drives it: the
           real moveGroup/renameGroup/reorderGroupRow, and syncGroupModal to
           read back what they left in the list. openGroupModal is here too,
           for the one assertion that it fills the list before opening. */
        moveGroup, renameGroup, reorderGroupRow, syncGroupModal, openGroupModal,
        closeGroupModal,
        /* The list as built, flattened far enough to assert against: one entry
           per row, in order, with the two pieces of text a person actually
           reads plus which of the three actions are disabled — not the raw
           stub nodes, which would make every assertion here retrace fill()'s
           own shape instead of what syncGroupModal put in it. */
        groupRows(){
          return (GROUP_LIST ? GROUP_LIST.kids : []).map(row => {
            const nameEl  = row.kids.find(k => k.className === "grp-name");
            const countEl = row.kids.find(k => k.className === "grp-count");
            const byAct = act => row.kids.find(k => k.dataset && k.dataset.act === act);
            return {
              label: nameEl ? nameEl.textContent : "",
              count: countEl ? countEl.textContent : "",
              upDisabled: !!(byAct("up") && byAct("up").disabled),
              downDisabled: !!(byAct("down") && byAct("down").disabled)
            };
          });
        },
        get groupEmptyHidden(){ return GROUP_EMPTY.hidden; },
        commit, edit, endEdit, packState, unpackState, photoPut, photoGet, photoSweep,
        get photoStore(){ return photoStore; },
        get session(){ return session; },
        get hIndex(){ return hIndex; },
        get historyPending(){ return historyPending; },
        get state(){ return state; },        set state(v){ state = v; },
        /* what the ribbon's status strip is actually showing */
        /* saved/unsaved are what a browser would PAINT for the classes the app
           has put on the wrapper — resolved from the real stylesheet by
           iconsShown, not read back off the property the app just wrote. The
           old getter did the latter and stayed green through the whole bug. */
        get shown(){
          const cls = ["rb-doc"].concat(Object.keys(DOC.name.classes).filter(k => DOC.name.classes[k]));
          const rendered = iconsShown(cls, []);
          const hovered  = iconsShown(cls, [":hover"]);
          return {name: DOC.text.textContent,
                  status: DOC.status.textContent,
                  dirtyClass: !!DOC.name.classes.dirty,
                  freshClass: !!DOC.name.classes.fresh,
                  classes: cls,
                  saved: rendered.saved, unsaved: rendered.unsaved,
                  savedOnHover: hovered.saved, unsavedOnHover: hovered.unsaved,
                  iconWrites: ICON_WRITES.slice(),
                  /* no tooltip is ever written */
                  titleWrites: TITLE_WRITES.slice()};
        },
        /* The red bar above the canvas, read the way the DOM would show it —
           not the mutable NEVER_SAVED object the stub writes into directly,
           which would let a test read state nobody set through updateDocLabel. */
        get neverSavedBar(){ return {hidden: NEVER_SAVED.hidden, text: NEVER_SAVED.text}; },
        get docName(){ return docName; },    set docName(v){ docName = v; },
        get dirtyDoc(){ return dirtyDoc; },  set dirtyDoc(v){ dirtyDoc = v; },
        get history(){ return history; },
        get downloads(){ return DOWNLOADS; },
        get written(){ return WRITTEN; },
        get toasts(){ return TOASTS; },
        get picked(){ return PICKED; },
        /* the Accent control, driven the way a user drives it: type into the
           field, drag the picker, leave the field */
        typeHex, hexBlur, accentPick, hexFieldValue, validColour,
        contrastRatio, CONTRAST_MIN,
        /* A swatch, driven as the click dispatcher drives it: closeMenu() ends
           any open session, then COMMANDS.accentSwatch gets the button. The
           element is the real shape — a dataset and its text — because the
           command reads the pair off the markup rather than off a list. */
        clickSwatch(hex, ink, name){
          endEdit();
          COMMANDS.accentSwatch({dataset:{accent:hex, ink:ink}, textContent:name || ""});
        },
        get colour(){ return {picker: COLOUR.picker, hex: COLOUR.hex, ink: COLOUR.ink}; },
        setColourFields(picker, hex, ink){
          COLOUR.picker = picker; COLOUR.hex = hex; COLOUR.ink = ink === undefined ? "" : ink;
        },
        get warn(){ return {shown: WARN.shown, text: WARN.text, badge: WARN.badge}; },
        get summaries(){ return SUMMARIES; },
        setConfirm(v){ CONFIRM = v; },
        setPrompt(v){ PROMPT = v; },
        get asked(){ return ASKED; }
      };`;
  /* iconsShown is handed in rather than rebuilt inside: it reads the app's
     stylesheet and markup, which the module has no business parsing. */
  return new Function("iconsShown", src)(iconsShown);
}

let passed = 0;
const failures = [];
const check = (c, m) => { if(c) passed++; else failures.push(m); };
const eq = (a, b, m) => check(a === b, m + " — got " + JSON.stringify(a) + ", want " + JSON.stringify(b));
const countOf = M => ((M.state && M.state.people) || []).length;
/* A renamed or missing COMMANDS entry must not throw and abandon the rest of
   the suite — it has to land on a red check() naming the rule, the same way
   every other tolerant read in this file does. */
const callCommand = async (M, name) => {
  const fn = M.commands[name];
  check(typeof fn === "function", "COMMANDS." + name + " exists and is callable");
  if(typeof fn === "function") await fn();
};

/* ---------------------------------------------------------- 5d. the two logo
   marks are PAINTED, not merely coloured.

   `fill` does not inherit from `color`. Every other symbol in the sprite takes
   its button's colour because `.ic` says `fill:currentColor`; the title-bar and
   About marks carry no `.ic`, and without that declaration of their own both
   fell back to SVG's initial black while `color:var(--brand)` and the bar's
   inherited `#fff` sat above them, set and never read.

   That is §5b's bug in a second costume — a value assigned in one language and
   painted in another — and the same kind of test missed it: dom.js asserts that
   neither mark states a colour LITERAL, which is exactly as true of a black
   mark as of a white one. So the question here is the only one that settles it,
   what ARRIVES, and it is answered by resolving the app's own sheet against the
   markup's own nesting rather than by reading back what the rule says. */
{
  const VOIDS = ["input","br","img","hr","meta","link"];
  /* Comments, CSS and script are blanked to the same LENGTH so an index found
     in the scan addresses the same character in HTML, and no "<div>" written
     inside any of the three is walked as markup. */
  const blank = s => s.replace(/[^\n]/g, " ");
  const SCAN = HTML.replace(/<!--[\s\S]*?-->/g, blank)
                   .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/, (_, a, b, c) => a + blank(b) + c)
                   .replace(/(<script>)([\s\S]*?)(<\/script>)/,    (_, a, b, c) => a + blank(b) + c);
  const elOf = (tag, text) => {
    const attrs = {};
    const re = /([\w-]+)(?:="([^"]*)")?/g;
    let a;
    while((a = re.exec(text))) attrs[a[1]] = a[2] === undefined ? "" : a[2];
    return {tag:tag, id:attrs.id || null,
            cls:(attrs["class"] || "").split(/\s+/).filter(Boolean), attrs:attrs};
  };
  /* The first element carrying `cls`, with its REAL ancestors — replayed from
     the open tags before it rather than described here, so moving the mark out
     of the title bar changes the answer instead of being invisible to it. The
     replay staying in step is what dom.js §6's balance check is for. */
  const chainTo = cls => {
    const at = SCAN.search(new RegExp('<[a-z]+[^>]*\\sclass="[^"]*\\b' + cls + '\\b'));
    if(at < 0) return null;
    const stack = [], re = /<(\/?)([a-z]+)([^>]*?)(\/?)>/g;
    let m;
    while((m = re.exec(SCAN)) && m.index < at){
      if(VOIDS.indexOf(m[2]) >= 0 || m[4] === "/") continue;
      if(m[1] === "/") stack.pop(); else stack.push(elOf(m[2], m[3]));
    }
    const open = new RegExp('<([a-z]+)((?:[^>]*\\sclass="[^"]*\\b' + cls + '\\b[^"]*")[^>]*?)/?>')
      .exec(SCAN.slice(at));
    return open ? stack.concat([elOf(open[1], open[2])]) : null;
  };
  /* What the path is actually filled with: the winning `fill`, and where that
     says currentColor, the nearest `color` at or above it. Every step reads
     tolerantly — a mutation that removes an element or a declaration has to
     land on a red eq() naming the rule, not throw and abandon the section. */
  const inkOf = chain => {
    if(!chain) return "no such element in the markup";
    const fill = resolveProp(chain, "fill");
    if(fill === null) return "nothing sets fill — the path keeps SVG's initial black";
    if(fill.toLowerCase() !== "currentcolor") return fill;
    for(let i = chain.length - 1; i >= 0; i--){
      const c = resolveProp(chain.slice(0, i + 1), "color");
      if(c !== null) return c;
    }
    return "fill follows currentColor but nothing up the chain sets color";
  };

  const aboutChain = chainTo("about-mark");
  /* openInfo() adds .about-open to .modal-info for this document, so the chain
     asked about is the one on screen when the mark is visible at all */
  if(aboutChain){
    const box = aboutChain.filter(e => e.cls.indexOf("modal-info") >= 0)[0];
    if(box) box.cls.push("about-open");
  }

  eq(inkOf(chainTo("tb-mark")), "#fff",
     "the title-bar mark is painted in the bar's own ink — the inherited color only "
     + "reaches the path because the mark's own rule says fill:currentColor");
  eq(inkOf(aboutChain), "var(--brand)",
     "and the About mark is painted in --brand, from the color its own rule states — "
     + "same reason, and it is the only thing that makes one symbol serve both homes");
}

/* Let every already-resolved promise run. Six turns is well past the deepest
   await chain in the import path; the number is slack, not a measurement. */
async function tick(){ for(let i = 0; i < 6; i++) await Promise.resolve(); }

const IMG  = {data:"data:image/jpeg;base64,AAAA", w:120, h:120};
const file = n => ({name:n, type:"image/jpeg"});

/* addFiles decodes strictly one image at a time, so the queue holds at most one
   pending decode. Draining it is what "let the batch finish" means here, and
   doing it explicitly is what lets a test change the document mid-batch. */
async function settle(M, result){
  for(let guard = 0; guard < 50; guard++){
    await tick();
    if(!M.decodes.length) break;
    const d = M.decodes.shift();
    if(result === "fail") d.rej(new Error("could not be read"));
    else d.res(result || IMG);
  }
  await tick();
}

/* The nth person, or an empty stand-in. A mutation that stops an Add from
   happening leaves nobody at that index, and `people[0].photo` would then throw
   and abandon the rest of the section — which reads in a report exactly like
   coverage and is not. Reading tolerantly is what turns that into a red
   `check()` naming the rule. */
function who(M, i){ return ((M.state && M.state.people) || [])[i] || {}; }

function personIn(M, name){
  /* Resolved through the app's own resolveGroupId, against M.state — the
     same policy a real Add or a real edit()'d group field goes through —
     so every caller of this helper gets a person whose group reads back as
     "FRA" through groupLabel exactly as a real person's would. */
  return {id: "x" + Math.random().toString(36).slice(2,7), name: name,
          tierId: M.state.tiers[0].id, groupId: M.resolveGroupId(M.state, "FRA"),
          role: "", photo: null,
          pw: 0, ph: 0, frame: null};
}

/* defaults() ships no grades at all — Templates is the only source of a
   starting grade list. Almost this entire suite is about people, photos,
   undo and Save — not about grades — and is written against this shipped
   shape (an attached second band, a shared last band, six entries so
   tiers[0]..tiers[5] are all addressable), so it keeps living here as
   ordinary test fixture data — not read from TEMPLATES or from any
   production factory, which is what keeps this suite a second, independent
   source rather than a table checked against itself. Fresh ids every call, so
   two documents in the same test never share one. */
let sixGradesSeq = 0;
function sixGrades(){
  sixGradesSeq++;
  const g = (code, label, o) => Object.assign(
    {id: "sg" + sixGradesSeq + "-" + code, code: code, label: label,
     fill: "green", attach: false, merge: false, align: "center"}, o || {});
  return [
    g("P", "Partner"),
    g("A", "Assistant", {fill: "white", attach: true}),
    g("D", "Director"),
    g("M", "Manager"),
    g("SC", "Senior Consultant"),
    g("C", "Consultant", {attach: true, merge: true})
  ];
}

/* Several document commands are async — the dialogs they raise are — so the
   suite runs inside an async function and awaits them. Without the await
   every assertion would run against a pending promise and pass by
   accident. */
async function runSuite(){
  /* ---------------------------------------------------------- 1. dirty flag */

  {
    const M = makeModule();
    M.state = M.defaults();
    /* defaults() ships no grades at all now — a fresh document is genuinely
       empty and is proved not-yet-saveable a few lines down. The rest of this
       block (the Save lifecycle, the dirty-icon lifecycle) is about document
       plumbing that has nothing to do with grades, so it needs a saveable
       structure to get there — one plain grade, not read from any factory. */
    M.state.tiers = [{id:"g1", code:"G", label:"Grade", fill:"green",
                       attach:false, merge:false, align:"center"}];
    M.docName = ""; M.dirtyDoc = false;

    /* A new document opens on a neutral placeholder title, not a blank one.
       It has to be a real string: the title is drawn into the chart and
       written into the roster file, and "" would render an untitled chart
       that reads as a layout bug. */
    eq(M.defaults().title, "Team name", "a new document's title is the neutral placeholder");
    eq(M.defaults().showGradeCode, true, "new charts show grade codes");
    eq(M.defaults().showGradeName, false, "new charts do not show grade names");
    eq(M.defaults().nameLabelPosition, "below", "new Swimlanes put name labels below photos");
    eq(M.defaults().nameBold, "given", "new charts bold the given names, not the family name");
    eq(M.defaults().font, "open-sans", "new charts draw with the Open Sans stack");
    eq(M.defaults().showPersonName, true, "new charts show person names");
    eq(M.defaults().showPersonGrade, true, "new charts show person grades");
    eq(M.defaults().showPersonGroup, true, "new charts show person groups");
    /* A file that omits these takes the documented default, and one that states
       them keeps what it said — including an explicit false, which is a real
       choice and the trap this pair of loops exists for. There is no upgrade
       step in front of the validator, so the validator answers for both;
       test/import.js drives it, this only pins what the answers are. */
    /* A fresh document ships no grades at all, so it is NOT yet saveable —
       Templates (Structure) is the route to a saveable structure. */
    eq(M.stateLimitProblem(M.defaults()), "the roster has no grades",
      "and a fresh document is not yet saveable — it has no grades to save");
    {
      /* One grade, so every check below is about the FIELD it names rather
         than being masked by the empty-grades refusal proved just above. */
      const bad = M.defaults();
      bad.tiers = [{id:"g1", code:"G", label:"Grade", fill:"green",
                    attach:false, merge:false, align:"center"}];
      bad.showGradeCode = "yes";
      check(/grade-code/.test(M.stateLimitProblem(bad) || ""),
        "Save refuses a non-boolean grade-code setting");
      bad.showGradeCode = true; bad.showGradeName = 1;
      check(/grade-name/.test(M.stateLimitProblem(bad) || ""),
        "Save refuses a non-boolean grade-name setting");
      bad.showGradeName = false; bad.nameLabelPosition = "above";
      check(/name-label position/.test(M.stateLimitProblem(bad) || ""),
        "Save refuses a name-label position the renderer does not know");
      bad.nameLabelPosition = "below"; bad.nameBold = "bold";
      check(/name-bolding/.test(M.stateLimitProblem(bad) || ""),
        "Save refuses a name-bolding setting the renderer does not know");
      bad.nameBold = "given"; bad.font = "comic-sans";
      check(/font/.test(M.stateLimitProblem(bad) || ""),
        "Save refuses a font this version cannot draw");
      bad.font = "open-sans"; bad.showPersonName = "yes";
      check(/person-label/.test(M.stateLimitProblem(bad) || ""),
        "Save refuses a non-boolean person-name display setting");
      bad.showPersonName = true; bad.showPersonGrade = 1;
      check(/person-label/.test(M.stateLimitProblem(bad) || ""),
        "Save refuses a non-boolean person-grade display setting");
      bad.showPersonGrade = true; bad.showPersonGroup = null;
      check(/person-label/.test(M.stateLimitProblem(bad) || ""),
        "Save refuses a non-boolean person-group display setting");
    }

    eq(M.dirtyDoc, false, "a fresh document starts clean");

    /* ---- 5c. the ground the resolver above stands on.
       It answers from top-level rules only and ignores pseudo-classes it was
       not asked about, so both of those have to be true of the real sheet. */
    {
      const touching = RULES.filter(r => /docIcon/.test(r.sel));
      check(touching.length >= 3,
            "the sheet decides both icons by rule — found " + touching.length);
      check(touching.every(r => r.at.length === 0),
            "no @media block moves the status icons, so the resolver may read top-level rules");
      check(!touching.some(r => /:hover|:focus|:active/.test(r.sel)),
            "no icon rule keys off a pointer or focus state");
      /* The attribute that did nothing. If it comes back to the markup the app
         is one careless `icon.hidden = …` away from the same bug, so the tag
         itself is pinned. */
      check(ICON_SAVED.attrs.hidden === undefined && ICON_UNSAVED.attrs.hidden === undefined,
            "neither icon carries a hidden attribute — CSS decides, not an attribute "
            + "the DOM will not reflect for an <svg>");
      eq(ICON_SAVED.tag, "svg", "the saved icon really is an <svg>, which is why hidden did nothing");
      eq(ICON_UNSAVED.tag, "svg", "and so is the unsaved one");
      /* both hrefs still written out in full, and still the two different glyphs */
      check(/<use href="#i-file-save"\/>/.test(HTML), "the saved icon references #i-file-save statically");
      check(/<use href="#i-file-save-off"\/>/.test(HTML), "the unsaved icon references #i-file-save-off statically");
      /* informational, not a control */
      check(!/id="docName"[^>]*\sdata-cmd=/.test(HTML) && !/id="docName"[^>]*onclick/.test(HTML),
            "the status strip is not clickable");
      /* no Saving state crept in */
      check(!/"Saving/.test(SCRIPT), "there is no Saving state");
    }
    /* ---- what the ribbon's status strip shows, over one document's life.
       Exactly one icon at a time, and the name beside it, with no bullet. */
    M.updateDocLabel();
    /* ---- 5b. which icon is PAINTED, at each point in that life.
       shown.saved / shown.unsaved are resolved from the app's stylesheet
       against the classes the app put on the wrapper — not read back off a
       property the app just set. The bug that made this necessary is written
       up at the top of this file. exactlyOne is the invariant that actually
       matters to a reader of the screen: never two icons, never none.

       Three named states: "fresh" (never
       saved), "unsaved" (saved once, dirty since) and "saved". Fresh paints
       the SAME icon as unsaved — there is no third glyph — so iconState folds
       the two together for the icon assertion while status/freshClass/
       dirtyClass still tell them apart. */
    const STATUS_TEXT = {fresh:"Not saved yet", unsaved:"Unsaved changes", saved:"Saved"};
    const exactlyOne = (want, where) => {
      const s = M.shown;
      const iconState = want === "saved" ? "saved" : "unsaved";
      eq(s.saved === (iconState === "saved") && s.unsaved === (iconState === "unsaved"), true,
         where + ": exactly the " + iconState + " icon renders — got saved=" + s.saved
         + " unsaved=" + s.unsaved);
      /* Hover brightens the strip and must do nothing else. Asking the same
         question with :hover active is how that gets proved rather than
         eyeballed — no rule in the sheet may key these icons off a pointer. */
      eq(s.savedOnHover, s.saved,   where + ": hover does not change the saved icon");
      eq(s.unsavedOnHover, s.unsaved, where + ": hover does not change the unsaved icon");
      /* and the words agree with the picture */
      eq(s.status, STATUS_TEXT[want],
         where + ": the visible status reads " + STATUS_TEXT[want] + " — got " + s.status);
      /* no tooltip is written; the visible status text stands in its place */
      eq(s.titleWrites.length, 0,
         where + ": updateDocLabel writes no tooltip — got " + JSON.stringify(s.titleWrites));
      eq(s.iconWrites.length, 0,
         where + ": nothing wrote to the icon elements — got " + JSON.stringify(s.iconWrites));
      /* exactly one of .fresh/.dirty, matching the named state — never both,
         never neither of the two active ones */
      eq(s.freshClass, want === "fresh", where + ": .fresh class matches the fresh state");
      eq(s.dirtyClass, want === "unsaved", where + ": .dirty class matches the unsaved state");
      check(!(s.freshClass && s.dirtyClass),
        where + ": .fresh and .dirty are never both set");
    };
    exactlyOne("fresh", "a clean, never-saved document");

    eq(M.shown.name, "Untitled roster", "a fresh document is named Untitled roster");
    eq(M.shown.saved, false, "the never-saved state does not show the saved icon");
    eq(M.shown.unsaved, true, "it shows the same unsaved-shaped icon as a dirty save");
    eq(M.shown.status, "Not saved yet", "with the visible status Not saved yet");
    eq(M.shown.freshClass, true, "and the .fresh emphasis");
    eq(M.shown.dirtyClass, false, "but not .dirty — the document itself is clean");
    check(M.neverSavedBar.hidden,
      "the never-saved bar stays hidden on a clean canvas — nothing to lose yet");

    M.markDirty();
    eq(M.dirtyDoc, true, "an edit marks the document dirty");
    eq(M.shown.status, "Not saved yet",
      "an edit to an untitled document still reads Not saved yet — never-saved outranks dirty");
    eq(M.shown.freshClass, true, "and stays .fresh");
    eq(M.shown.dirtyClass, false, "never .dirty while the document has no name at all");
    check(!M.neverSavedBar.hidden,
      "now the never-saved bar appears — there is unsaved work with nowhere to go");
    check(/Save copy/.test(M.neverSavedBar.text),
      "and it names Save copy — got " + JSON.stringify(M.neverSavedBar.text));
    check(!/•/.test(M.shown.name), "and no bullet appended to the name — got " + M.shown.name);
    exactlyOne("fresh", "after an edit to an untitled document");

    /* saving clears the dirty flag AND gives the document a name for the
       first time, so the never-saved bar has to come down along with the
       state that put it up — this is also what makes the close-guard
       trustworthy from here on */
    M.setPrompt("my-team");
    eq(await M.saveDoc(false), true, "save completes");
    eq(M.dirtyDoc, false, "saving clears the dirty flag");
    eq(M.docName, "my-team", "saving records the document name");
    eq(M.shown.name, "my-team", "a successful Save shows the document's name");
    eq(M.shown.saved, true, "and goes back to the saved icon");
    eq(M.shown.unsaved, false, "with the unsaved one hidden");
    eq(M.shown.status, "Saved", "and the status reads Saved again");
    check(M.neverSavedBar.hidden,
      "and the never-saved bar hides — the document now has somewhere to be saved to");
    exactlyOne("saved", "after saving");
    eq(M.downloads.length, 1, "saving produced a download");
    eq(M.downloads[0], "my-team.json", "saved under the chosen name");
    /* The file records which geometry drew it. Every roster saved from here on
       carries the property, so a later build never has to guess. */
    eq(JSON.parse((M.written[0] || {}).text || "{}").layout, "pyramid",
       "the saved roster file states its layout");
    /* app/format identify the file on sight; state itself never carries either
       key, so this is the one place that can see them — the written bytes. */
    {
      const written = JSON.parse((M.written[0] || {}).text || "{}");
      eq(written.app, "tierform", "the saved file names the app that wrote it");
      eq(written.format, 1, "and states the roster format version");
      check(M.state.app === undefined && M.state.format === undefined,
        "and neither key lives on state itself — only the written file carries them");
    }

    /* a second save must not re-prompt — it is Save, not Save As. And an edit
       to an already-named document reads Unsaved changes, never Not saved
       yet — the never-saved bar has no business reappearing once the
       document has somewhere to go. */
    M.setPrompt(null);                       // if it prompts, it will now cancel
    M.markDirty();
    eq(M.shown.status, "Unsaved changes",
      "an edit after saving reads Unsaved changes, not Not saved yet");
    check(M.neverSavedBar.hidden,
      "the never-saved bar stays hidden — this document already has a name");
    exactlyOne("unsaved", "an edit after a save");
    eq(await M.saveDoc(false), true, "a second Save does not re-prompt");
    eq(M.downloads[1], "my-team.json", "Save reuses the established name");
    eq(M.dirtyDoc, false, "the second save cleared the flag too");

    /* Save As always prompts, and a cancel must change nothing */
    M.markDirty();
    M.setPrompt(null);
    eq(await M.saveDoc(true), false, "Save As returns false when cancelled");
    eq(M.downloads.length, 2, "a cancelled Save As writes no file");
    eq(M.dirtyDoc, true, "a cancelled Save As leaves the document dirty");
    eq(M.docName, "my-team", "a cancelled Save As leaves the name alone");
    eq(M.shown.unsaved, true, "and the status still shows unsaved — nothing was written");
    eq(M.shown.status, "Unsaved changes", "with the status name to match");
    eq(M.shown.name, "my-team", "and the old name, since the rename did not happen");
    exactlyOne("unsaved", "after a cancelled Save As");

    /* Save As with a new name retargets the document */
    M.setPrompt("other-team");
    eq(await M.saveDoc(true), true, "Save As with a name succeeds");
    eq(M.docName, "other-team", "Save As renames the document");
    eq(M.downloads[2], "other-team.json", "Save As wrote the new name");

    /* a typed ".json" must not double up */
    M.setPrompt("with-ext.json");
    await M.saveDoc(true);
    eq(M.downloads[3], "with-ext.json", "a typed .json extension is not doubled");

    /* an empty name falls back rather than producing ".json" */
    M.setPrompt("   ");
    await M.saveDoc(true);
    eq(M.downloads[4], "with-ext.json", "a blank name falls back to the current one");
  }

  /* ---------------------------------------------------------- 2. the close guard */

  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();

    M.dirtyDoc = false;
    eq(await M.confirmDiscard("do a thing"), true, "a clean document never prompts");

    M.dirtyDoc = true;
    M.setConfirm(false);
    eq(await M.confirmDiscard("do a thing"), false, "a dirty document prompts, and No means No");
    M.setConfirm(true);
    eq(await M.confirmDiscard("do a thing"), true, "a dirty document proceeds when confirmed");
  }

  /* ---------------------------------------------------------- 3. New */

  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.state.people.push(personIn(M, "Someone Here"));
    M.state.accent = "#123456";
    M.docName = "old-doc";
    M.dirtyDoc = true;

    /* refusing the prompt must abandon the whole operation */
    M.setConfirm(false);
    await M.newDoc();
    eq(countOf(M), 1, "New cancelled: the roster is untouched");
    eq(M.docName, "old-doc", "New cancelled: the document name is untouched");
    eq(M.dirtyDoc, true, "New cancelled: still dirty");

    M.setConfirm(true);
    await M.newDoc();
    eq(countOf(M), 0, "New: the roster is empty");
    eq(M.state.accent, "#003153", "New: chart design is back to defaults");
    eq(M.docName, "", "New: the document is untitled again");
    eq(M.dirtyDoc, false, "New: starts clean, so closing straight away is silent");
    eq(M.state.tiers.length, 0,
      "New: genuinely empty — no grades ship by default, Templates is the way in");
    /* newDoc calls renderAll, which is not in this module — the label is what
       the app repaints, so drive it directly and check what it would show.
       A brand-new document has never touched disk either, so this reads
       Not saved yet, not Saved — the same never-saved state a first launch
       shows. */
    M.updateDocLabel();
    eq(M.shown.name, "Untitled roster", "New: the status shows Untitled roster again");
    eq(M.shown.saved, false, "New: the never-saved state, not the saved icon");
    eq(M.shown.unsaved, true, "New: showing the same glyph as an unsaved edit");
    eq(M.shown.status, "Not saved yet", "New: and the Not saved yet status name");
    eq(M.shown.freshClass, true, "New: with .fresh, since New starts clean but untitled");
    eq(M.shown.dirtyClass, false, "New: not .dirty — the document itself is clean");
    check(M.neverSavedBar.hidden,
      "New: the never-saved bar stays hidden — the fresh document is clean");
  }

  /* ------------------------------------------ 3b. complete grade structures */

  {
    /* applyTemplate replaces FIVE properties in one commit — tiers, layout,
       accent, inkOnColour and nameLabelPosition — unlike the Restore default
       grades command it replaced, which touched only tiers. Every literal
       below (codes, layout, accent, ink, name label position) is written by
       hand from the approved template brief, not read off TEMPLATES itself —
       a table compared against itself would stay green under a mutation that
       changed a template's own colour. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.title = "Keep this title";
    M.state.accent = "#123456";
    M.state.inkOnColour = "#000000";
    M.state.layout = "swimlanes";
    M.state.page = "a4-portrait";
    /* Big 4 green states "next" — starting from "below" (the opposite, and
       also defaults()' own value) is what makes the assertion below prove
       the template's OWN value was written, not merely that the field
       survived untouched. */
    M.state.nameLabelPosition = "below";
    M.state.tiers = [{id:"custom-grade", code:"X", label:"Custom", role:"",
                      fill:"green", attach:false, merge:false, align:"center"}];
    M.docName = "current-file";
    M.dirtyDoc = false;
    const before = JSON.stringify(M.state);
    const gen = M.docGen;

    M.setConfirm(false);
    await M.applyTemplate("big4-green");
    eq(JSON.stringify(M.state), before,
      "cancelled: the custom structure, layout, colours and name label position are all untouched");
    eq(M.dirtyDoc, false, "cancelled: no dirty flag");
    eq(M.history.length, 0, "cancelled: no undo step");
    eq(M.docGen, gen, "cancelled: outstanding work is not invalidated");

    M.setConfirm(true);
    await M.applyTemplate("big4-green");
    eq(M.state.tiers.map(t => t.code).join(","), "P,AS,D,SM,M,SC,C,A,JS",
      "Big 4 green installs its nine grades in template order");
    eq(M.state.layout, "pyramid", "…and its layout");
    eq(M.state.accent, "#004225", "…and its accent");
    eq(M.state.inkOnColour, "#FFFFFF", "…and the ink that goes on that accent");
    eq(M.state.nameLabelPosition, "next", "…and its name label position");
    eq(M.state.title, "Keep this title", "the title is untouched — a template is not a New");
    eq(M.state.page, "a4-portrait", "…and neither is the page");
    eq(M.docName, "current-file", "applying a template stays inside the current file");
    eq(M.dirtyDoc, true, "applying a template marks the file unsaved");
    check(M.docGen !== gen, "applying a template invalidates work aimed at the replaced structure");
    check(M.state.tiers.every(t => t.id !== "custom-grade"),
      "applying a template creates fresh grade ids rather than reusing the replaced structure");

    M.undo();
    eq(JSON.stringify(M.state), before,
      "one Undo restores the complete custom structure, layout, colours and name label position together");
    eq(M.state.nameLabelPosition, "below",
      "…name label position back to below specifically, not just equal to \"before\" as a whole");
    M.redo();
    eq(M.state.tiers.map(t => t.code).join(","), "P,AS,D,SM,M,SC,C,A,JS",
      "one Redo re-applies the whole template again");
    eq(M.state.layout, "pyramid", "…layout included");
    eq(M.state.accent, "#004225", "…accent included");
    eq(M.state.nameLabelPosition, "next", "…name label position included");
  }

  {
    /* At zero grades there is nothing a template would destroy, so the
       confirmation is skipped entirely — asking "replace the structure?"
       about a structure that does not exist has one honest answer. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = [];
    M.docName = "current-file";
    M.dirtyDoc = false;
    const asked = M.asked.length;

    M.setConfirm(true);            // would answer yes if asked — proves it wasn't
    await M.applyTemplate("mbb-blue");
    eq(M.asked.length, asked, "zero grades: applying a template opens no confirmation");
    eq(M.state.tiers.map(t => t.code).join(","), "SP,AP,EM,A,F,JF",
      "…and still applies immediately");
    eq(M.state.layout, "hive", "…including the layout");
    eq(M.state.accent, "#003153", "…and the accent");
    eq(M.state.nameLabelPosition, "below", "…and its name label position");
    eq(M.dirtyDoc, true, "…and marks the file unsaved");
    eq(M.history.length, 1, "…as one undo step");
  }

  {
    /* An id nothing named — a stale menu, a corrupted data-tpl — does nothing
       rather than guessing. No alert either: nothing was asked for that could
       be refused, so there is nothing to explain. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const before = JSON.stringify(M.state);
    const asked = M.asked.length, alerted = M.alerts.length;

    await M.applyTemplate("not-a-real-template");
    eq(JSON.stringify(M.state), before, "an unknown template id changes nothing");
    eq(M.asked.length, asked, "…and asks nothing");
    eq(M.alerts.length, alerted, "…and alerts nothing — there was no request to refuse");
    eq(M.history.length, 0, "…and creates no undo step");
    eq(M.dirtyDoc, false, "…and marks nothing unsaved");
  }

  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.state.title = "Keep this title";
    M.state.layout = "swimlanes";
    M.docName = "current-file";
    const before = JSON.stringify(M.state);

    M.setConfirm(false);
    await callCommand(M, "clearGrades");
    eq(JSON.stringify(M.state), before, "Delete all cancelled: every grade remains");
    eq(M.history.length, 0, "Delete all cancelled: no undo step");

    M.setConfirm(true);
    await callCommand(M, "clearGrades");
    eq(M.state.tiers.length, 0, "Delete all leaves a deliberately empty structure");
    eq(M.state.title, "Keep this title", "Delete all preserves the title");
    eq(M.state.layout, "swimlanes", "Delete all preserves the layout");
    eq(M.docName, "current-file", "Delete all stays inside the current file");
    eq(M.stateLimitProblem(M.state), "the roster has no grades",
      "an empty structure cannot be saved until a grade is added or a template is applied");
    M.undo();
    eq(JSON.stringify(M.state), before, "one Undo restores every deleted grade");
  }

  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.state.people.push(personIn(M, "Assigned Person"));
    const before = JSON.stringify(M.state);
    const asked = M.asked.length;

    await M.applyTemplate("big4-green");
    await callCommand(M, "clearGrades");
    eq(JSON.stringify(M.state), before,
      "people present: neither whole-structure action changes their grades");
    eq(M.asked.length, asked,
      "people present: neither action even opens a destructive confirmation");
    eq(M.history.length, 0, "people present: neither action creates an undo step");
    check(M.alerts.length === 2 && M.alerts.every(x => /Remove all people/.test(x)),
      "people present: both actions explain how to make them available");
  }

  /* ------------------------------------------------- 3b2. the whole roster

     Clear roster is the people-shaped twin of Clear grades, and it is
     asserted the same way: cancelled it does nothing at all, confirmed it
     empties state.people and leaves every other field of the document standing,
     and one Undo brings the whole roster back. The grades are the interesting
     half — this command is next to them in the same ribbon group, and "it
     deleted the grades too" is the failure it exists not to have. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.state.title  = "Keep this title";
    M.state.accent = "#123456";
    M.state.layout = "swimlanes";
    M.state.people.push(personIn(M, "Ada Lovelace"), personIn(M, "Grace Hopper"));
    M.docName = "current-file";
    M.dirtyDoc = false;
    const before = JSON.stringify(M.state);
    /* the grades as a whole, written down before the command runs: the
       comparison below has to be against something this command never touches,
       not against state.tiers read back out of the state it just edited */
    const grades = JSON.stringify(M.state.tiers);
    const gen = M.docGen;

    M.setConfirm(false);
    await M.commands.clearRoster();
    eq(JSON.stringify(M.state), before, "Clear cancelled: everyone is still on the roster");
    eq(M.dirtyDoc, false, "Clear cancelled: no dirty flag");
    eq(M.history.length, 0, "Clear cancelled: no undo step");
    eq(M.docGen, gen, "Clear cancelled: outstanding work is not invalidated");

    M.setConfirm(true);
    await M.commands.clearRoster();
    eq(countOf(M), 0, "Clear roster removes every person");
    eq(JSON.stringify(M.state.tiers), grades, "Clear roster changes no grade");
    eq(M.state.title, "Keep this title", "Clear roster preserves the title");
    eq(M.state.accent, "#123456", "Clear roster preserves the style");
    eq(M.state.layout, "swimlanes", "Clear roster preserves the layout");
    eq(M.docName, "current-file", "Clear roster stays inside the current file");
    eq(M.dirtyDoc, true, "Clear roster marks that file unsaved");
    check(M.docGen !== gen, "Clear roster invalidates work aimed at the roster it emptied");
    eq(M.stateLimitProblem(M.state), null,
      "an empty roster is still a saveable document — it is the grades that are required");

    M.undo();
    eq(JSON.stringify(M.state), before, "one Undo brings the whole roster back");
    M.redo();
    eq(countOf(M), 0, "one Redo empties it again");
  }

  /* An empty roster has nothing to clear, so the command stops before it asks —
     a confirmation about nobody is a question with one honest answer. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const asked = M.asked.length;

    M.setConfirm(true);
    await M.commands.clearRoster();
    eq(M.asked.length, asked, "nobody on the roster: Clear roster opens no confirmation");
    eq(M.history.length, 0, "nobody on the roster: and creates no undo step");
    eq(M.dirtyDoc, false, "nobody on the roster: and marks nothing unsaved");
  }

  {
    /* TEMPLATES itself. Every value below is a LITERAL taken from the approved
       brief, not read off TEMPLATES — comparing the table to itself would stay
       green under a mutation that moved a value and the expectation together. */
    const M = makeModule();
    const WANT = [
      {id:"big4-green",  name:"Big 4 green",  layout:"pyramid",
       accent:"#004225", ink:"#FFFFFF", nameLabelPosition:"next",
       codes:"P,AS,D,SM,M,SC,C,A,JS"},
      /* The one template that writes in black: white on this orange is 3.3:1,
         and the ink here is the pair the International Orange swatch carries. */
      {id:"big4-orange", name:"Big 4 orange", layout:"swimlanes",
       accent:"#FF4F00", ink:"#000000", nameLabelPosition:"below",
       codes:"P,D,SM,M,SA,A"},
      {id:"mbb-blue",    name:"MBB blue",     layout:"hive",
       accent:"#003153", ink:"#FFFFFF", nameLabelPosition:"below",
       codes:"SP,AP,EM,A,F,JF"}
    ];
    eq(M.TEMPLATES.length, WANT.length, "there are exactly three templates");
    for(let i = 0; i < WANT.length; i++){
      const t = M.TEMPLATES[i] || {};
      const w = WANT[i];
      eq(t.id, w.id, "template " + (i + 1) + "'s id");
      eq(t.name, w.name, "template " + (i + 1) + "'s name");
      eq(t.layout, w.layout, "template " + (i + 1) + "'s layout");
      eq(t.accent, w.accent, "template " + (i + 1) + "'s accent");
      eq(t.ink, w.ink, "template " + (i + 1) + "'s ink — the accent's own on-colour text");
      eq(t.nameLabelPosition, w.nameLabelPosition,
        "template " + (i + 1) + "'s name label position");
      check(typeof t.grades === "function",
        "template " + (i + 1) + "'s grades is a function, not a shared array");
      const a = (t.grades && t.grades()) || [], b = (t.grades && t.grades()) || [];
      eq(a.map(x => x.code).join(","), w.codes,
        "template " + (i + 1) + "'s grades, in order — got " + a.map(x => x.code).join(","));
      check(a.length > 0 && a.every((x, j) => x.id !== (b[j] || {}).id),
        "template " + (i + 1) + ": each call builds fresh ids, not one shared array");
    }
    /* A template is a complete look, and an unreadable one is not a look: the
       app raises its own contrast warning under CONTRAST_MIN, so a template
       shipping white text on a light accent would fire that warning on its own
       first draw. Answered by the app's real WCAG arithmetic and its real
       threshold over each pair, and over ALL of them rather than the one that
       needed black — the next template nobody has written yet is covered too. */
    for(const t of M.TEMPLATES){
      const r = M.contrastRatio(t.accent, t.ink);
      check(r >= M.CONTRAST_MIN,
        t.name + " writes on its own accent at " + r.toFixed(2) + ":1, at or "
        + "above the threshold the app's own warning enforces");
    }

    /* The two attach/merge specifics named in the brief, each answered by
       running the real template rather than restating its numbers. */
    const green = (M.TEMPLATES.find(t => t.id === "big4-green") || {}).grades() || [];
    check((green[1] || {}).attach === true && (green[1] || {}).fill === "white"
       && (green[1] || {}).align === "right",
      "Big 4 green's second grade (Assistant) attaches, in white, aligned right");
    const mbb = (M.TEMPLATES.find(t => t.id === "mbb-blue") || {}).grades() || [];
    check((mbb[1] || {}).merge === true && (mbb[1] || {}).attach === true,
      "MBB blue's second grade (Associate Partner) shares the first grade's band "
      + "— merge implies attach, the same rule as everywhere else");
  }

  {
    /* At zero grades, the Add dialog is a door, not a wall. The Grade field
       itself becomes the place the FIRST grade is created — the typed value
       becomes the created grade's LABEL in full, but its CODE is only the
       first letter, uppercased, a one-letter code like the shipped
       templates' (unlike pasteGradePlan's value-as-both convention for an
       unmatched paste row, which is a paste-only rule) — and the first
       grade and the first person land in ONE commit. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = [];
    M.dirtyDoc = false;

    M.syncAddAvailability();
    eq(M.add.tierFieldShown, false, "no grades: the grade select gives way to the First-grade field");
    eq(M.add.firstGradeFieldShown, true, "no grades: …which is shown in its place");
    eq(M.add.templateHintShown, true, "no grades: …alongside the escape hatch to Templates");

    /* (b) An empty First-grade field is the one refusal left in this dialog —
       nothing disables the dialog itself, so addOnePerson has to say no when
       there is nothing to create a grade from. */
    M.setAdd({firstGrade:"", name:"Ada"});
    eq(await M.addOnePerson(), false,
      "no grades, no typed grade: addOnePerson reports that it added nobody");
    check(M.alerts.length > 0
       && /name the first grade, or apply a template under Structure/.test(M.alerts[M.alerts.length - 1]),
      "…and the alert names the escape hatch — got "
      + JSON.stringify(M.alerts[M.alerts.length - 1]));
    eq(M.state.tiers.length, 0, "…no grade is created on a refused add");
    eq(countOf(M), 0, "…and no person either");
    eq(M.history.length, 0, "…no history entry");
    eq(M.dirtyDoc, false, "…and the document is not marked dirty");

    /* A stale typed grade name must not survive a close/reopen — it identified
       the LAST dialog's grade, not this one, the same "value that outlives its
       dialog" defect that cost this app every standing default it used to
       carry. openAddModal clears #addFirstGrade and THEN calls
       syncAddRolePlaceholder, so the reopened dialog's placeholder must not
       echo the stale name either — two reads, not one, pin the order as
       load-bearing rather than incidental. */
    M.setAdd({firstGrade:"Leftover Grade"});
    M.openAddModal();
    eq(M.add.firstGrade, "",
      "no grades, reopened: the First-grade field is cleared, not left over from the last dialog");
    eq(M.add.rolePlaceholder, "",
      "…and the role placeholder does not echo the stale grade name either");

    /* (d, part 1) The role placeholder follows the typed value live, before
       any grade exists for tierRole to read from — two different literals, so
       a stale first-keystroke snapshot would be caught, not just a wrong
       initial read. */
    M.setAdd({firstGrade:"Director"});
    M.syncAddRolePlaceholder();
    eq(M.add.rolePlaceholder, "Director",
      "no grades: the role placeholder mirrors the typed first grade");
    M.setAdd({firstGrade:"Senior Director"});
    M.syncAddRolePlaceholder();
    eq(M.add.rolePlaceholder, "Senior Director",
      "…and stays live as the field is retyped");

    /* (a) Back to the value that will actually be added. */
    M.setAdd({firstGrade:"Director", name:"Ada"});
    eq(await M.addOnePerson(), true,
      "no grades, a typed first grade: addOnePerson reports success");
    eq(M.state.tiers.length, 1, "…exactly one grade now exists");
    /* Read tolerantly: a mutation that never creates the grade must land on a
       red check() below, not on a thrown TypeError that abandons the rest of
       this section. */
    const created = M.state.tiers[0] || {};
    eq(created.code, "D",
      "…whose code is the typed grade's first letter, uppercased — got " + created.code);
    eq(created.label, "Director",
      "…and whose label is the full typed value, unlike the code");
    eq(countOf(M), 1, "…and one person");
    eq(who(M, 0).tierId, created.id,
      "…filed under the grade that was just created, not left unassigned");
    eq(M.history.length, 1, "…the grade and the person are ONE commit, one undo step");

    /* "Director" already starts with an uppercase letter, so the assertion
       above alone would still pass if the uppercasing were silently dropped.
       A lowercase-first typed grade is the one input that actually exercises
       .toUpperCase() — read tolerantly, the same reason as above. */
    const M2 = makeModule();
    M2.state = M2.defaults();
    M2.state.tiers = [];
    M2.setAdd({firstGrade:"partner", name:"Cai"});
    eq(await M2.addOnePerson(), true, "…and a lowercase-first typed grade also succeeds");
    const created2 = M2.state.tiers[0] || {};
    eq(created2.code, "P",
      "…with the code uppercased even though the typed grade was not — got "
      + JSON.stringify(created2.code));
    eq(created2.label, "partner",
      "…while the label keeps the typed casing verbatim — got " + JSON.stringify(created2.label));

    /* (c) renderRoster is stubbed in this harness (it drives syncPersonMenu
       and syncEditModal only, see the comment beside it) so the real render
       chain's own call to syncStructureAvailability -> syncAddAvailability
       does not fire here; called by hand instead so this assertion still
       sees the availability the real render chain would have produced. */
    M.syncAddAvailability();
    eq(M.add.tierFieldShown, true, "after the add: the grade select is shown again");
    eq(M.add.firstGradeFieldShown, false, "…and the First-grade field is hidden");
    eq(M.add.firstGrade, "", "…and its own value was cleared, not left for the next person");

    /* (d, part 2) After the add, the placeholder is driven by the created
       grade's own label (tierRole) rather than the now-cleared, now-hidden
       First-grade field — proven by renaming the grade out from under it and
       checking the placeholder follows the rename, not the value that
       created it. */
    if(M.state.tiers[0]) M.state.tiers[0].label = "Managing Director";
    M.syncAddRolePlaceholder();
    eq(M.add.rolePlaceholder, "Managing Director",
      "…the role placeholder now follows the grade's own label, not the "
      + "cleared First-grade field");

    /* Undo removes the person AND the grade created with it in the same step
       — the trap named in the plan: hoisting the grade's creation above the
       commit would leave it behind as an orphan the strip still shows. */
    M.undo();
    eq(countOf(M), 0, "undo: the person is gone");
    eq(M.state.tiers.length, 0,
      "undo: …and so is the grade created with it — no orphan left on the strip");
  }

  {
    /* (e) A pending photo at zero grades follows the same precedent addFiles'
       own batch already sets when it needs no pre-existing grade: the
       destination does not exist yet to check, so only the generation may
       be. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = [];
    M.setPendingDirectly({result:{data:"data:image/jpeg;base64,EEEE", w:50, h:50},
                          gen: M.docGen});
    M.newGeneration();                // the document moved on while the photo decoded
    M.setAdd({firstGrade:"Partner", name:"Ada"});
    eq(await M.addOnePerson(), false,
      "no grades, a stale pending-photo generation: addOnePerson reports no add");
    eq(M.state.tiers.length, 0, "…no grade is created for a refused add");
    eq(countOf(M), 0, "…nor a person");

    const M2 = makeModule();
    M2.state = M2.defaults();
    M2.state.tiers = [];
    M2.setPendingDirectly({result:{data:"data:image/jpeg;base64,FFFF", w:60, h:60},
                           gen: M2.docGen});
    M2.setAdd({firstGrade:"Partner", name:"Ada"});
    eq(await M2.addOnePerson(), true,
      "no grades, a fresh pending-photo generation: the grade, the person and the photo land together");
    eq(M2.state.tiers.length, 1, "…the grade lands");
    eq(who(M2, 0).tierId, (M2.state.tiers[0] || {}).id, "…the person is filed under it");
    eq(who(M2, 0).photo, "data:image/jpeg;base64,FFFF", "…and the photo lands too");
  }

  {
    /* (f) The photo-import dialog is the one route left that still refuses
       outright at zero grades, for a BATCH — addFiles' own plan finds nothing
       to attach a batch photo to and so still has additions, and a batch
       genuinely has nowhere to go, where Add and Paste can both build a grade
       from what was typed or pasted instead. This drives addFiles() directly,
       which is what a multi-photo drop reaches; a SINGLE dropped photo does
       not reach this refusal at all — the drop route below sends it straight
       to the Add dialog instead, which is where the zero-grade case is a
       door (see the drop tests just below). */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = [];
    M.dirtyDoc = false;

    const alertsBeforePaste = M.alerts.length;
    /* pasteList does not refuse at zero grades —
       a zero-grade paste builds the structure FROM the list (pasteGradePlan),
       so the dialog is the answer here, not a wall in front of it. */
    M.commands.pasteList();
    eq(M.alerts.length, alertsBeforePaste,
      "no grades: pasteList raises no alert of its own");
    eq(M.paste.entryShown, true, "no grades: …it opens the paste dialog instead");
    M.closePasteModal();

    /* The import dialog answers the same condition at the same three layers, so
       assert all three rather than only the outcome. It is ANSWERED here on
       purpose — a cancelled import would never reach the third layer, and the
       third layer is the one that has to hold when the button's disabled state
       does not. */
    M.answerImportWith(M.state.tiers[0] && M.state.tiers[0].id);
    const dropped = M.addFiles([file("Ada_Lovelace.jpg")]);
    await tick();

    eq(M.import.noGradesShown, true, "no grades: the import dialog says so in its own body");
    eq(M.import.confirmDisabled, true, "no grades: and its Import button is disabled");
    eq(M.import.countShown, false, "no grades: the count gives way to the reason");
    eq(M.decodes.length, 0, "no grades: a dropped photo never reaches the decoder");
    /* If the guard regresses, do not leave the suite parked on the mock decoder:
       drain it so the assertions below see the illegal person it would create.
       This branch is mutation-tested; awaiting addFiles directly instead would
       leave a broken build printing neither PASS nor FAIL. */
    await settle(M);
    await dropped;
    eq(countOf(M), 0, "no grades: the photo-import route creates no unassigned person");
    eq(M.history.length, 0, "no grades: no history entry from the refused import");
    eq(M.dirtyDoc, false, "no grades: and no dirty flag");
    /* One alert here, not two — the photo-import path is the only route
       that refuses outright. Add's own refusal (tested above) needs an empty
       typed grade, and pasteList raises no alert of its own at all. */
    check(M.alerts.length === alertsBeforePaste + 1
       && /under Structure/.test(M.alerts[M.alerts.length - 1]),
      "no grades: the one remaining refusing route names the one action that unblocks it");
  }

  /* ---------------------------------------- 5b1b. a single dropped photo

     Dropping ONE photo leads to the SAME Add
     people dialog the split's face opens — one add surface, reached two ways
     — unless its derived name already matches a still-photo-less person, in
     which case it attaches with no dialog at all. Everything else (several
     files, or a single file that already matches somebody) is still
     addFiles' job, unchanged. zoneDrop (grabbed above, the real listener
     body both drop targets share) is what is under test here; addFiles and
     askImport themselves are exercised throughout the rest of this file. */
  {
    /* (a) a single unmatched photo opens the Add dialog, prefilled, and
       never asks the batch import dialog at all — no #importModal entry
       appears in the modal log, which is what would exist if askImport had
       been called. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.dirtyDoc = false;
    const historyBefore = M.history.length;

    const drop = M.dropOn([file("Grace_Hopper.jpg")]);
    await tick();
    check(M.decodes.length === 1,
      "the dropped photo reaches the real decoder — got " + M.decodes.length);
    /* Guarded: a mutation that routes this drop through addFiles instead
       (asked, then cancelled — IMPORT_ANSWER defaults to null here) leaves
       decodes empty rather than throwing, so the checks below still run and
       report red by NAME instead of aborting the section. */
    if(M.decodes[0]) M.decodes[0].res({data:"data:image/jpeg;base64,GGGG", w:90, h:90});
    await settle(M);
    await drop;

    check(M.modals.some(m => m.id === "#addModal" && m.action === "open"),
      "a single unmatched drop opens the Add dialog — the same one the click opens");
    check(!M.modals.some(m => m.id === "#importModal"),
      "…and the batch import dialog is never asked at all — got " + JSON.stringify(M.modals));
    eq(M.add.name, "Grace Hopper",
      "…prefilled from the file name, the same courtesy the picker gives");
    check(!!M.pending && M.pending.result.data === "data:image/jpeg;base64,GGGG",
      "…with the decoded photo waiting in the well");
    eq(countOf(M), 0, "nothing is committed yet — Add still has to happen");
    eq(M.history.length, historyBefore, "…no history entry either");
    eq(M.dirtyDoc, false, "…and the document is not yet dirty");
  }

  {
    /* (b) a single photo whose derived name matches an existing, still-
       photo-less person attaches to them with no dialog at all: addFiles'
       own plan (reached through the drop route unchanged) is pure
       attachment, so neither dialog has a question to ask. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.dirtyDoc = false;
    const grace = personIn(M, "Grace Hopper");
    M.state.people.push(grace);

    const drop = M.dropOn([file("Grace_Hopper.jpg")]);
    await settle(M);
    await drop;

    check(!M.modals.some(m => m.action === "open"),
      "a matched single drop opens no dialog at all — got " + JSON.stringify(M.modals));
    eq(grace.photo, IMG.data, "…the photo lands on the matched person");
    eq(countOf(M), 1, "…and nobody new was added");
    eq(M.history.length, 1, "…in one undo step");
    /* (M.history[0] || {}) tolerates a mutation that routes this drop to the
       dialog instead — nothing commits there, so history stays empty rather
       than throwing on a read of an entry that was never made. */
    eq((M.history[0] || {}).label, "1 photo attached", "…labelled as an attach, not an add");
    eq(M.dirtyDoc, true, "…and the document is now dirty");
  }

  {
    /* (c) a dropped batch with at least one addition still asks the batch
       import dialog — unchanged from before the drop route existed. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const tier = M.state.tiers[0].id;
    M.answerImportWith(tier, "FRA");

    const drop = M.dropOn([file("Ada_Lovelace.jpg"), file("Alan_Turing.jpg")]);
    await tick();
    check(M.modals.some(m => m.id === "#importModal" && m.action === "open"),
      "a batch with an addition still asks the import dialog");
    await settle(M);
    await drop;
    eq(countOf(M), 2, "…and both land, exactly as a direct addFiles batch would");
  }

  {
    /* (d) a dropped batch that is PURE attachment — every photo matches
       somebody — asks nothing at all: the same guard step 1 gave addFiles is
       reached here through the very same plan, not a second copy of it. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const ada  = personIn(M, "Ada Lovelace");
    const alan = personIn(M, "Alan Turing");
    M.state.people.push(ada, alan);

    const drop = M.dropOn([file("Ada_Lovelace.jpg"), file("Alan_Turing.jpg")]);
    await settle(M);
    await drop;

    check(!M.modals.some(m => m.action === "open"),
      "a pure-attachment batch asks nothing — got " + JSON.stringify(M.modals));
    eq(ada.photo, IMG.data, "…the first photo attaches");
    eq(alan.photo, IMG.data, "…and the second one too");
    eq(M.history.length, 1, "…both in the same one commit");
  }

  {
    /* (e) the match predicate is photo-less people only — the SAME rule
       addFiles' own plan has always used, driven here through the drop
       route's own call to it. Someone who already has a photo does not
       silently lose it to the next same-named drop; that drop is instead the
       deliberate single add, exactly as an unmatched name would be. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const grace = personIn(M, "Grace Hopper");
    grace.photo = "data:image/jpeg;base64,OLD";
    M.state.people.push(grace);

    const drop = M.dropOn([file("Grace_Hopper.jpg")]);
    await tick();
    /* Guarded the same way (a) is: a mutation that stops routing this drop
       to the dialog sends it through addFiles instead, where an unanswered
       import dialog (IMPORT_ANSWER is null here) cancels before decoding —
       leaving decodes empty rather than throwing. */
    if(M.decodes[0]) M.decodes[0].res({data:"data:image/jpeg;base64,NEW", w:90, h:90});
    await settle(M);
    await drop;

    check(M.modals.some(m => m.id === "#addModal" && m.action === "open"),
      "a name match who already has a photo is not a match at all — the drop "
      + "opens the Add dialog instead");
    eq(grace.photo, "data:image/jpeg;base64,OLD",
      "…and their existing photo is left untouched");
    eq(countOf(M), 1, "…nobody new was added either — Add still has to happen");
  }

  /* ---------------------------------------- 5b2. the photo-import dialog

     The two standing controls it replaced were set at one moment and silently
     decided where a batch dropped much later would land. What has to be true of
     the question that replaced them: it applies to every photo in the batch, it
     names the count, one dialog serves any count, and Cancel means nobody. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const tier = M.state.tiers[3].id;
    M.answerImportWith(tier, "FRA");

    const run = M.addFiles([file("Ada_Lovelace.jpg"), file("Alan_Turing.jpg"),
                            file("Grace_Hopper.jpg")]);
    await tick();
    eq(M.import.count, "3 photos to import. They will all be added to:",
      "the dialog states how many photos it is about to import");
    await settle(M);
    await run;

    eq(countOf(M), 3, "confirming imports all three");
    check(M.state.people.every(x => x.tierId === tier),
      "…every one of them in the grade the dialog asked for");
    check(M.state.people.every(x => M.groupLabel(M.state, x) === "FRA"),
      "…and every one with the group it asked for");
    eq(M.history.length, 1, "the batch is one undo step, as it has always been");
  }

  {
    /* one dialog whatever the count — a single file is not special-cased */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const tier = M.state.tiers[1].id;
    M.answerImportWith(tier, "BER");

    const run = M.addFiles([file("Ada_Lovelace.jpg")]);
    await tick();
    eq(M.import.count, "1 photo to import. It will be added to:",
      "a single-file drop goes through the same dialog, counted in the singular");
    eq(M.modals.filter(m => m.id === "#importModal" && m.action === "open").length, 1,
      "…exactly one dialog, not a special case that skips it");
    await settle(M);
    await run;
    eq(countOf(M), 1, "and it imports the one photo");
    eq((M.state.people[0] || {}).tierId, tier, "into the grade the dialog asked for");
    eq(M.groupLabel(M.state, M.state.people[0] || {}), "BER", "with the group it asked for");
  }

  {
    /* Cancel imports nobody and leaves everything exactly as it was */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.state.people.push(personIn(M, "Already Here"));
    const before = JSON.stringify(M.state);
    M.dirtyDoc = false;
    M.cancelImport();

    const run = M.addFiles([file("Ada_Lovelace.jpg"), file("Alan_Turing.jpg")]);
    await settle(M);
    await run;

    eq(countOf(M), 1, "cancelling imports nobody");
    eq(JSON.stringify(M.state), before, "…and leaves the roster byte-for-byte as it was");
    eq(M.history.length, 0, "…with no undo step");
    eq(M.dirtyDoc, false, "…and no dirty flag");
    eq(M.decodes.length, 0, "…and nothing ever reached the decoder");
    eq(M.alerts.length, 0, "…and nothing is reported: cancelling is not a failure");
  }

  {
    /* Nothing is remembered between imports. The whole point of asking is that
       there is no default left behind to shape the next one. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.answerImportWith(M.state.tiers[4].id, "LON");
    const first = M.addFiles([file("Ada_Lovelace.jpg")]);
    await settle(M); await first;

    /* Type into the field the way a user would, so there is something to
       remember. Without this the stub could never be dirty and the assertion
       below would pass against a build that never clears it — which is exactly
       what the mutation test caught. */
    M.import.group = "LON";
    M.import.tier = M.state.tiers[4].id;

    M.answerImportWith(M.state.tiers[0].id, "");
    const second = M.addFiles([file("Alan_Turing.jpg")]);
    await tick();
    eq(M.import.group, "", "the group field opens empty, not holding the last answer");
    eq(M.import.tier, M.state.tiers[0].id,
      "and the grade opens on the first grade, not on the last import's answer");
    await settle(M); await second;
    eq(M.groupLabel(M.state, who(M, 1)), "", "so the second import takes its own answer");
  }

  /* ---------------------------------------- 5b3. pasted rows that name no grade

     The dialog asks nothing about which grade an unmatched row should go
     to: those rows carry PASTE_NEW out of parsePasteText, and confirmPaste
     resolves it to a grade called NEW inside the commit that adds the
     people.

     Driven here rather than in test/import.js because what matters is the
     COMMIT — one grade for many rows, an existing one reused, and the grade
     and the people arriving as a single undo step. A grade created outside
     the commit passes every parse-level assertion and still leaves an orphan
     in the strip after one undo, which is the failure this section exists for.

     Every read below is tolerant of a mutation that adds nobody and creates no
     grade. That is not defensive style for its own sake: a mutation that made
     `M.state.people[0]` undefined threw here, and a throw abandons the rest of
     the section, so what it left behind was a missing assertion printed as a
     passing one. `tierOf`/`cell` fail the check instead of dying on it. */
  const tierOf = (M, i) => (M.state.people[i] || {}).tierId;
  const cell = (rows, r, c) => ((rows[r] || [])[c] != null ? rows[r][c] : "<no cell>");
  {
    /* Every row names a grade the document has, so nothing needs NEW. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const tiers0 = M.state.tiers.length;
    M.openPasteModal();
    M.preview("Ada Lovelace\tP\tFRA\tCountry Head\nAlan Turing\tSC\tHAM");
    eq(M.paste.previewShown, true, "a preview of matched rows reaches the table step");
    eq(M.pasteRows.filter(r => r.tierId === M.PASTE_NEW).length, 0,
      "every row matched a grade, so none carries the sentinel");
    eq(M.paste.summary, "2 people",
      "…and the summary says nothing about a new grade — got " + JSON.stringify(M.paste.summary));
    M.pasteAdd();
    eq(M.state.tiers.length, tiers0,
      "a paste whose every row names a known grade creates no NEW grade");
    check(!M.pasteNewTier(), "…and there is no grade called NEW to find");
    eq(countOf(M), 2, "both people were added");
    eq(M.history.length, 1, "in one undo step");
    /* The fourth column reaches the created person — tolerant of a mutation
       that drops a person outright, which must fail this check rather than
       throw and abandon the rest of the section. */
    eq((M.state.people[0] || {}).role, "Country Head",
      "a pasted row's fourth column lands on the person's role");
    eq((M.state.people[1] || {}).role, "",
      "…and a row with no fourth column gets no role at all");
  }

  {
    /* The P5 distinction, which is the whole reason the count is off the
       sentinel and not off r.unmatched: "Nobody" names no grade at all and is
       therefore NOT unmatched, while "Zaphod" names one the document does not
       have and is. Both are headed for NEW, and a summary counting `unmatched`
       would say one row where there are two. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const tiers0 = M.state.tiers.length;
    M.openPasteModal();
    M.preview("Ada Lovelace\tP\tFRA\nNo Grade Column\nNamed Nonsense\tZaphod\tHAM");

    const rows = M.pasteRows;
    eq(rows.length, 3, "all three rows are parsed");
    eq(rows.filter(r => r.tierId === M.PASTE_NEW).length, 2,
      "the row with no grade column and the row naming an unknown grade both carry the sentinel");
    eq(rows.filter(r => r.unmatched).length, 1,
      "…but only one of them is `unmatched` — which is why the summary cannot use it");
    check(/2 rows name no grade this document has/.test(M.paste.summary),
      "the summary counts the sentinel rows, not the unmatched ones — got "
      + JSON.stringify(M.paste.summary));
    check(/a new grade called NEW/.test(M.paste.summary),
      "…and says where they are going");
    /* the table's own Grade column, read off the cells the real preview built */
    const cells = M.pasteCells();
    eq(cells.length, 3, "the table has a row per parsed row");
    eq(cell(cells, 0, 1), "Partner", "a matched row's Grade column names its grade");
    eq(cell(cells, 1, 1), "NEW", "a row with no grade column is shown going to NEW");
    check(cell(cells, 2, 1).indexOf("NEW") >= 0,
      "…and so is a row naming a grade the document does not have — got "
      + JSON.stringify(cell(cells, 2, 1)));

    M.pasteAdd();
    eq(M.state.tiers.length, tiers0 + 1,
      "ONE grade is created for both rows that needed it, not one each");
    /* `|| {}` so a mutation that creates no grade fails the reads below
       instead of throwing and abandoning the rest of this block. */
    const made = M.pasteNewTier() || {};
    check(!!M.pasteNewTier(), "and it is findable as the NEW grade");
    /* Against the CELL, not against the constant the cell was built from: the
       claim worth making is that the preview named the grade the commit went on
       to create, and comparing the grade's code to PASTE_NEW_CODE would only
       restate that both sites read the same constant. */
    eq(made.code, cell(cells, 1, 1),
      "…carrying the code the preview's Grade column promised");
    /* The shape, as a class check against another writer of a grade: a field
       this one invented (or forgot) is how the writers drift apart. */
    eq(Object.keys(made).sort().join(","),
       Object.keys(M.newTier("Z", "Z")).sort().join(","),
      "…and exactly the fields newTier() writes — no more, no fewer");
    check(!("role" in made), "…and no grade-wide role, which no grade has");

    eq(countOf(M), 3, "all three people were added");
    check(tierOf(M, 1) === made.id && tierOf(M, 2) === made.id,
      "both sentinel rows landed in that one grade");
    eq(tierOf(M, 0), (M.state.tiers[0] || {}).id,
      "and the matched row still went where it matched");
    /* The sentinel is resolved, not stored. A person carrying it would name no
       grade at all and draw in no band. */
    check(M.state.people.every(p => p.tierId !== M.PASTE_NEW),
      "no person carries the sentinel into state");
    eq(M.pasteRows.length, 0, "and it does not outlive confirmPaste");

    /* One undo, both halves. This is the assertion that goes red if the grade is
       created above the commit instead of inside it. */
    eq(M.history.length, 1, "the people and the grade are ONE undo step");
    M.undo();
    eq(countOf(M), 0, "undo takes the people back");
    eq(M.state.tiers.length, tiers0,
      "…and the grade with them — a paste undone leaves no orphan grade");
    check(!M.pasteNewTier(), "…so there is no NEW grade left in the strip");
  }

  {
    /* A second paste into the same document reuses the first NEW rather than
       adding a second one beside it. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const tiers0 = M.state.tiers.length;
    M.openPasteModal();
    M.preview("First Person");
    M.pasteAdd();
    const first = M.pasteNewTier() || {};
    check(!!M.pasteNewTier(), "the first paste created the NEW grade");
    eq(M.state.tiers.length, tiers0 + 1, "…one grade");

    M.openPasteModal();
    M.preview("Second Person");
    check(/the existing NEW grade/.test(M.paste.summary),
      "the second preview says the grade already exists rather than promising a new one — got "
      + JSON.stringify(M.paste.summary));
    eq(cell(M.pasteCells(), 0, 1), first.label,
      "…and the Grade column names that grade by its own name");
    M.pasteAdd();
    eq(M.state.tiers.length, tiers0 + 1,
      "a second paste reuses the first NEW grade rather than adding a second");
    eq(tierOf(M, 1), first.id, "…and puts its row in it");
  }

  {
    /* Renamed, the grade is still found — matchTierByGrade matches a code OR a
       name, so a NEW grade someone relabelled is reused by whichever half still
       says NEW. Here the code has been changed and the label has not. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.openPasteModal();
    M.preview("First Person");
    M.pasteAdd();
    const made = M.pasteNewTier() || {};
    const tiers1 = M.state.tiers.length;
    made.code = "TBD";
    made.label = "new";                       // matched case-insensitively
    M.openPasteModal();
    M.preview("Second Person");
    M.pasteAdd();
    eq(M.state.tiers.length, tiers1,
      "a NEW grade found by its name rather than its code is still reused");
    eq(tierOf(M, 1), made.id, "…and the row goes into it");
  }

  {
    /* replace empties the people and never the grades — and it needs the NEW
       grade exactly as much as Add does, since emptying state.people cannot
       remove the grade a pasted row is asking for. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.state.people.push(personIn(M, "Already Here"));
    const tiers0 = M.state.tiers.length;
    M.openPasteModal();
    M.preview("Replacement Person");
    M.pasteReplace();
    eq(countOf(M), 1, "replace leaves only the pasted person");
    eq((M.state.people[0] || {}).name, "Replacement Person", "…and it is the pasted one");
    eq(M.state.tiers.length, tiers0 + 1,
      "replace added the NEW grade its row needed and removed no grade");
    eq(M.history.length, 1, "one undo step for the replacement and the grade");
  }

  {
    /* At the grade limit with no NEW grade present, the paste cannot go through.
       Refused the way the people limit is: the buttons are disabled at preview
       time with the reason on them, and confirmPaste refuses anyway, because
       `disabled` is a claim about the UI and not a lock on the path. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = [];
    for(let i = 0; i < M.LIMITS.tiers; i++){
      M.state.tiers.push({id:"t" + i, code:"G" + i, label:"Grade " + i,
                          fill:"green", attach:false, merge:false, align:"center"});
    }
    M.dirtyDoc = false;
    M.openPasteModal();
    M.preview("Nobody Fits");
    /* Not "the document is at the grade limit" — the loop above just made that
       true, and an assertion that restates its own setup went green under a
       mutation. What is worth checking is that PREVIEWING committed nothing:
       showPastePreview must decide the refusal without creating the grade it is
       refusing to create. */
    eq(M.state.tiers.length, M.LIMITS.tiers,
      "previewing creates no grade — the refusal is decided without making one");
    eq(M.history.length, 0, "…and snapshots nothing");
    eq(M.paste.addDisabled, true, "at the grade limit: Add these is disabled");
    check(/at most \d+ grades/.test(M.paste.addTitle),
      "…and says why — got " + JSON.stringify(M.paste.addTitle));
    /* Replace too. The people limit lets Replace through and says "replace
       instead"; this one cannot, because replacing does not free a grade slot. */
    eq(M.paste.replaceDisabled, true,
      "at the grade limit: Replace roster is disabled as well — replacing frees no grade slot");
    check(M.paste.addTitle === M.paste.replaceTitle,
      "…for the same stated reason");

    const before = JSON.stringify(M.state);
    M.pasteAdd();
    /* check() rather than eq(): the document here is at the grade limit, so
       eq() would print two sixty-grade rosters into the failure message and
       bury every assertion after it. The counts below name what moved. */
    check(JSON.stringify(M.state) === before,
      "and confirmPaste refuses anyway, leaving the document byte-for-byte as it was");
    eq(countOf(M), 0, "nobody was added");
    eq(M.history.length, 0, "nothing was snapshotted for a paste that cannot go through");
    eq(M.dirtyDoc, false, "…and the document is not dirty");
    check(M.alerts.length === 1 && /at most \d+ grades/.test(M.alerts[0]),
      "…and the refusal is reported once, in the grade-limit wording — got "
      + JSON.stringify(M.alerts));
    /* Reuse still works at the limit: the refusal is about CREATING a grade, not
       about the sentinel. */
    M.state.tiers[0].code = "NEW";
    M.preview("Nobody Fits");
    eq(M.paste.addDisabled, false,
      "with a NEW grade already present the same paste is allowed at the limit");
    M.pasteAdd();
    eq(countOf(M), 1, "…and goes through");
    eq(tierOf(M, 0), "t0", "into the existing NEW grade");
    eq(M.state.tiers.length, M.LIMITS.tiers, "creating nothing");
  }

  {
    /* The grade a paste creates is the grade COMMANDS.addGrade creates when its
       two fields are left at their defaults. Asserted by running BOTH writers
       and comparing them to each other — a test that checked the pasted grade
       against PASTE_NEW_LABEL would be restating the constant the app had just
       used, and went green under a mutation that moved both. */
    const A = makeModule();
    A.state = A.defaults();
    A.state.tiers = sixGrades();
    await A.commands.addGrade();
    const byCommand = A.state.tiers[A.state.tiers.length - 1] || {};
    check(!!A.state.tiers.length, "the add-grade command, answered with its own defaults, creates a grade");

    const B = makeModule();
    B.state = B.defaults();
    B.state.tiers = sixGrades();
    B.openPasteModal();
    B.preview("Nobody Named A Grade");
    B.pasteAdd();
    const byPaste = B.pasteNewTier() || {};
    check(!!B.pasteNewTier(), "and so does a paste with a row naming no grade");

    eq(byPaste.code, byCommand.code,
      "the two writers give the grade the same code");
    eq(byPaste.label, byCommand.label,
      "…and the same name — the paste uses addGrade's default pair, not a pair of its own");
    eq(Object.keys(byPaste).sort().join(","), Object.keys(byCommand).sort().join(","),
      "…and the same fields");
    eq(JSON.stringify(Object.assign({}, byPaste, {id:0})),
       JSON.stringify(Object.assign({}, byCommand, {id:0})),
      "…and the same value for every one of them but the id");
  }

  {
    /* The alert wording is the one COMMANDS.addGrade uses. Asserted by running
       both, so it cannot drift the way two string literals silently can. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = [];
    for(let i = 0; i < M.LIMITS.tiers; i++){
      M.state.tiers.push({id:"t" + i, code:"G" + i, label:"Grade " + i,
                          fill:"green", attach:false, merge:false, align:"center"});
    }
    await M.commands.addGrade();
    const fromAdd = M.alerts.slice();
    eq(fromAdd.length, 1, "the add-grade command refuses at the limit");
    M.openPasteModal();
    M.preview("Nobody Fits");
    M.pasteAdd();
    eq(M.alerts.length, 2, "and so does the paste");
    eq(M.alerts[1], fromAdd[0],
      "…in the identical sentence, not a fourth phrasing of the same limit");
  }

  /* ---------------------------------- 5b3b. zero grades: the file brings its
     own structure

     A paste or CSV import into a document with no grades at all is not
     refused: every distinct value in the Grade column becomes its own
     grade, in the order it first appears, and only a row with an EMPTY
     grade cell goes to NEW. pasteGradePlan is the one place that decides
     this, and both showPastePreview and confirmPaste must read the same
     answer from it — driven end to end here for the same reason 5b3 is: the
     created grades and the people they hold have to land in ONE undo step,
     which only a test that drives commit() can see. */
  {
    /* Ada and Bob both say "Partner" (different casing — the SAME grade, and
       the FIRST row's casing is what gets created); Cyd names a second grade;
       Dee's row has no grade cell at all and is the only one that reaches
       NEW. Expectations below are the test's own literals, never read back
       off pasteGradePlan's output — a claim and its evidence from one place
       agree no matter what that place says. */
    const M = makeModule();
    M.state = M.defaults();
    eq(M.state.tiers.length, 0, "a fresh document ships with no grades — the premise this block tests");
    M.openPasteModal();
    M.preview("Ada Lovelace\tPartner\nBob\tpartner\nCyd\tAssociate\nDee");
    check(/creates 2 grades/.test(M.paste.summary),
      "the preview names the creation — two distinct values in the Grade column — got "
      + JSON.stringify(M.paste.summary));
    check(/1 row names no grade, and goes to a new grade called NEW/.test(M.paste.summary),
      "…and counts only the one row with an empty cell, not the two that matched "
      + "each other — got " + JSON.stringify(M.paste.summary));
    /* Nothing is unmatched in this mode — the file defines the structure —
       so the table names the group each row lands in with no ⚠. */
    const cells = M.pasteCells();
    eq(cell(cells, 0, 1), "Partner", "Ada's row shows the grade it will create");
    eq(cell(cells, 1, 1), "Partner",
      "Bob's differently-cased row shows the SAME grade — Partner's first-seen casing, not his own");
    eq(cell(cells, 2, 1), "Associate", "Cyd's row shows her own, second, grade");
    eq(cell(cells, 3, 1), "NEW", "Dee's empty-cell row shows where it is actually going");

    M.pasteAdd();
    eq(M.state.tiers.map(t => t.code).join(","), "Partner,Associate,NEW",
      "exactly three grades, in the order the list produced them — Partner and Associate "
      + "from first appearance in the Grade column, NEW appended after them for the empty cell");
    /* code === label only for the grades the LIST itself produced (Partner,
       Associate) — the trailing NEW grade goes through the pre-existing
       PASTE_NEW resolution, whose code/label pair ("NEW" / "New grade") is
       COMMANDS.addGrade's own default and stays that way, exactly as it does
       with grades already present (5b3, 5b3-iii below). */
    ["Partner", "Associate"].forEach(code => {
      const t = M.state.tiers.find(x => x.code === code) || {};
      eq(t.code, t.label, "a grade the list's own Grade column creates carries the pasted "
        + "value as BOTH code and label — " + JSON.stringify(t));
    });
    const byCode = code => (M.state.tiers.find(t => t.code === code) || {}).id;
    eq(tierOf(M, 0), byCode("Partner"), "Ada resolved to the Partner grade");
    eq(tierOf(M, 1), byCode("Partner"), "…and so did Bob, despite the different casing");
    eq(tierOf(M, 2), byCode("Associate"), "Cyd resolved to her own grade");
    eq(tierOf(M, 3), byCode("NEW"), "Dee's empty cell resolved to NEW");

    /* 5b3b-ii: one undo step, both halves — the grades and the people. A grade
       created above the commit instead of inside it survives the undo that
       removes its people and leaves an orphan in the strip; this is the
       assertion that would go red for that mistake. */
    eq(M.history.length, 1, "the three grades and the four people are ONE undo step");
    M.undo();
    eq(countOf(M), 0, "undo takes every pasted person back");
    eq(M.state.tiers.length, 0, "…and every grade it created with them — no orphans left in the strip");
  }

  {
    /* 5b3b-iii: with grades already present, the mode condition must hold —
       an unmatched row still goes to the single shared NEW, and never gets a
       created grade of its own named after whatever it typed. This is the
       test that would go red if the zero-grade condition were dropped (or
       always true). */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const tiers0 = M.state.tiers.length;
    M.openPasteModal();
    M.preview("Zora Zaphod\tZaphod");
    M.pasteAdd();
    eq(M.state.tiers.length, tiers0 + 1, "one grade added — the shared NEW, not a grade called Zaphod");
    check(!M.state.tiers.some(t => t.code === "Zaphod" || t.label === "Zaphod"),
      "no grade named after the unmatched value was created");
    const made = M.pasteNewTier() || {};
    check(!!M.pasteNewTier(), "the existing NEW-resolution path still found (or made) the grade");
    eq(tierOf(M, 0), made.id, "…and the row landed in it, exactly as it does with grades present today");
  }

  /* 5b3b-iv: the grade limit, at the edge pasteGradePlan's own count is meant
     to get right — distinct values plus ONE more only when an empty-cell row
     exists AND none of the file's own values already normalizes to "new". */
  {
    /* 60 distinct grades plus one empty-cell row need 61 — one over the
       limit, so this paste can create nothing. */
    const M = makeModule();
    M.state = M.defaults();
    M.dirtyDoc = false;
    let text = "";
    for(let i = 0; i < 60; i++) text += "Person" + i + "\tGrade" + i + "\n";
    text += "Nobody's Grade\n";
    M.openPasteModal();
    M.preview(text);
    eq(M.paste.addDisabled, true,
      "60 distinct values in the list plus an empty-cell row need 61 grades — over the 60-grade limit");
    eq(M.paste.replaceDisabled, true, "…Replace too — replacing frees no grade slot");
    check(/at most \d+ grades/.test(M.paste.addTitle), "…for the grade-limit reason");
    M.pasteAdd();
    eq(M.state.tiers.length, 0, "confirmPaste refuses before creating a single grade");
    eq(countOf(M), 0, "…and adds nobody");
    eq(M.history.length, 0, "…snapshotting nothing for a paste that cannot go through");
    eq(M.dirtyDoc, false, "…and the document stays clean");
    check(M.alerts.length === 1 && /at most \d+ grades/.test(M.alerts[0]),
      "the refusal is reported once, in the grade-limit wording");
  }
  {
    /* 59 distinct grades plus one empty-cell row need exactly 60 — AT the
       limit, not over it, so this one goes through. */
    const M = makeModule();
    M.state = M.defaults();
    let text = "";
    for(let i = 0; i < 59; i++) text += "Person" + i + "\tGrade" + i + "\n";
    text += "Nobody's Grade\n";
    M.openPasteModal();
    M.preview(text);
    eq(M.paste.addDisabled, false, "59 distinct values plus one empty-cell row need exactly 60 grades — allowed at the limit");
    M.pasteAdd();
    eq(M.state.tiers.length, 60, "59 created from the list, plus one NEW for the empty-cell row");
    eq(countOf(M), 60, "all 60 people were added");
  }
  {
    /* 60 distinct values where one of them already normalizes to "new" needs
       no 61st grade for the empty-cell rows — they reuse the file's own. */
    const M = makeModule();
    M.state = M.defaults();
    let text = "";
    for(let i = 0; i < 59; i++) text += "Person" + i + "\tGrade" + i + "\n";
    text += "Files Own New Grade\tNEW\n";
    text += "Nobody's Grade\n";
    M.openPasteModal();
    M.preview(text);
    eq(M.paste.addDisabled, false,
      "60 distinct values where one IS \"NEW\" need no extra grade for the empty-cell row — still allowed at the limit");
    M.pasteAdd();
    eq(M.state.tiers.length, 60, "no 61st grade created — the empty-cell row reused the file's own NEW");
    eq(countOf(M), 61, "all 61 people were added — 59 named grades, the file's own NEW, and the empty-cell row");
    const madeNew = M.state.tiers.find(t => t.code === "NEW") || {};
    check(!!madeNew.id, "the file's own NEW-normalizing grade exists");
    eq(tierOf(M, 60), madeNew.id, "…and the empty-cell row (the last one pasted) landed in it");
  }

  /* ------------------------------ 5b4. one factory for a fresh grade

     newTier() is the one place that builds a grade object literal from
     nothing — a template's grades, Add grade, and the NEW grade a paste
     makes all call it rather than each building their own. Asserted by
     RUNNING all three and comparing their output to EACH OTHER — never to a
     field list copied out of the factory, which is the same source
     answering for itself and would go green under a mutation that moved the
     factory and the expectation together. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();

    /* Writer 1: a template. P is the option-less one — AS, C and the rest
       state options, and the claim here is about the defaults. */
    const fromDefaults = (M.TEMPLATES.find(t => t.id === "big4-green") || {}).grades()[0];
    /* Writer 2: Add grade, answered with the defaults its own dialog offers. */
    await M.commands.addGrade();
    const fromCommand = M.state.tiers[M.state.tiers.length - 1] || {};
    /* Writer 3: the paste — in a SEPARATE document, because Add grade answered
       with its defaults has just created a grade coded NEW and a paste into the
       same document would correctly reuse it rather than create one. Reusing it
       here would compare the second writer with itself and report three agreeing
       writers when only two had run. */
    const P = makeModule();
    P.state = P.defaults();
    P.state.tiers = sixGrades();
    P.openPasteModal();
    P.preview("Nobody Named A Grade");
    P.pasteAdd();
    const fromPaste = P.pasteNewTier() || {};

    const writers = [["a template",  fromDefaults],
                     ["Add grade",     fromCommand],
                     ["a paste",       fromPaste]];
    const shape = o => Object.keys(o).sort().join(",");
    for(const [name, o] of writers){
      check(!!o && !!o.id, name + " produced a grade with an id");
      eq(shape(o), shape(fromDefaults),
        name + " writes the same field set as the others — got " + shape(o));
      check(!("role" in o), name + " writes no role");
    }
    /* The option-less defaults, pinned to LITERALS and not to each other.
       Comparing the three writers against fromDefaults proves they agree — which
       is worth proving, and three separate runs answer it — but it cannot say
       WHAT they agree on, because all three now come from one factory: a mutation
       that changed the factory's default moved every expectation with it and this
       block went green. There is no second writer of these values left, by
       design, so a literal is the only independent source available. */
    const DEFAULTS = {fill:"green", attach:false, merge:false, align:"center"};
    for(const [name, o] of writers){
      for(const k of Object.keys(DEFAULTS)){
        eq(o[k], DEFAULTS[k],
          name + "'s default " + k + " is " + JSON.stringify(DEFAULTS[k]));
      }
    }
    /* And they still agree with each other, which is the claim a fourth writer
       would break without touching the values above. */
    for(const [name, o] of writers){
      eq(JSON.stringify(Object.assign({}, o, {id:0, code:0, label:0})),
         JSON.stringify(Object.assign({}, fromDefaults, {id:0, code:0, label:0})),
        name + " agrees with the others on every field but the code and name");
    }
    /* Distinct ids, or the factory is handing out one object. */
    const ids = writers.map(w => w[1].id);
    eq(new Set(ids).size, 3, "each call produces a fresh id");

    /* The options still work — a factory that ignored them would pass everything
       above, because everything above is about the defaults. Big 4 green's
       second grade (Assistant) is the template grade that states all three. */
    const a = (M.TEMPLATES.find(t => t.id === "big4-green") || {}).grades()[1] || {};
    eq(a.fill, "white", "an option the caller passes is honoured (fill)");
    eq(a.attach, true, "…and attach");
    eq(a.align, "right", "…and align");
    /* And they are still normalised: MBB blue's second grade (Associate
       Partner) states merge, and the normalizer raises attach from it, on
       this path as on every other. */
    const c = (M.TEMPLATES.find(t => t.id === "mbb-blue") || {}).grades()[1] || {};
    check(c.merge === true && c.attach === true,
      "normalizeGradeLinks still runs over a template's grades");
  }

  /* The validator is deliberately NOT a fourth caller — it judges a grade someone
     else wrote rather than creating one, and its per-field defaults exist to
     decide what to report as a repair. That it nonetheless agrees on the SHAPE is
     asserted in test/import.js §12, which is the suite that drives it. */

  /* -------------------------- 5b5. openAddModal's optional grade

     The roster heading's "+" says which grade it sits on. It replaces the
     CHOICE only — the list is still rebuilt from state, so the dialog opened
     from a heading offers every grade, not just that one. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    /* Every read here is tolerant: a mutation that made newTier hand out one
       id for every grade collapsed the filter below into an empty array and this
       block THREW, abandoning the rest of the section. `at()` fails the check
       instead of dying on it. */
    const at = i => (M.state.tiers[i] || {}).id;
    const third = at(3);

    /* asked for: that grade is the selection, whatever was chosen last */
    M.setAdd({tier:at(0)});
    M.openAddModal(third);
    eq(M.add.tier, third, "openAddModal(id) opens on the grade it was given");

    /* not asked for: unchanged behaviour — the previous choice is kept */
    M.openAddModal();
    eq(M.add.tier, third, "openAddModal() keeps whatever was chosen last");

    /* An id that no longer names a grade falls back rather than selecting
       nothing — a select whose value matches no option shows blank, and Add would
       put the person nowhere. "Falls back" means the unchanged behaviour, and
       that is TWO steps: the previous choice, and only then the first grade. Both
       are asserted, because the second step alone is also what a build with no
       existence check produces, and a test that only checked it could not tell
       the two apart. */
    const gone = at(3);
    const stays = at(1);
    M.state.tiers = M.state.tiers.filter(t => t.id !== gone);
    check(M.state.tiers.length > 0 && !M.state.tiers.some(t => t.id === gone),
      "…after removing exactly that grade and leaving the others — got "
      + M.state.tiers.length + " grade(s)");

    /* step one: a live previous choice is what a dead id falls back TO */
    M.setAdd({tier:stays});
    M.openAddModal(gone);
    eq(M.add.tier, stays,
      "a deleted grade's id leaves the previous choice standing — it replaces the "
      + "choice only when it names a grade that exists");

    /* step two: and only when that is unusable too does it reach the first grade */
    M.setAdd({tier:gone});
    M.openAddModal(gone);
    eq(M.add.tier, at(0),
      "…and with no usable previous choice either, the first grade");
    check(M.add.tier !== "" && M.add.tier != null,
      "…so the dialog never opens with no grade selected");

    /* The silent case the wrapper on #drop exists for: anything that is not a
       grade id is simply not a grade, and the dialog opens as it always did.
       Asserted so the fallback is known to be reached, rather than assumed —
       this is what a PointerEvent would do if one arrived. */
    M.setAdd({tier:at(2)});
    M.openAddModal({type:"click", clientX:10});
    eq(M.add.tier, at(2),
      "an argument that is not a grade id changes nothing — it cannot select a grade");
  }

  /* -------------------------- 5b6. openAddModal offers the existing groups

     The evidence comes from a second source: state.groups is built here by
     hand, as literals, and compared against what the real fillGroupOptions
     wrote — not against anything the app itself computed. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.state.groups = [{id:"g1", label:"Berlin"}, {id:"g2", label:"Frankfurt"},
                       {id:"g3", label:"London"}];
    M.openAddModal();
    eq(JSON.stringify(M.groupOptions), JSON.stringify(["Berlin","Frankfurt","London"]),
      "opening Add fills the group suggestion list from state.groups, in order — "
      + "got " + JSON.stringify(M.groupOptions));

    /* A second open with a changed roster proves the list is rebuilt from state
       each time, not left over from the first — the same no-memory contract
       fillTierOptions keeps. */
    M.state.groups = [{id:"g4", label:"Munich"}];
    M.openAddModal();
    eq(JSON.stringify(M.groupOptions), JSON.stringify(["Munich"]),
      "…and reopening it rebuilds the list fresh from whatever state.groups holds now");

    /* The Edit dialog's opener offers the same list — not syncEditModal, which
       reruns on every render while the dialog stays open. */
    M.state.groups = [{id:"g5", label:"Zurich"}, {id:"g6", label:"Vienna"}];
    const jane = {id:"jane", name:"Jane", tierId:M.state.tiers[0].id, groupId:null};
    M.state.people = [jane];
    M.openEditModal(jane.id);
    eq(JSON.stringify(M.groupOptions), JSON.stringify(["Zurich","Vienna"]),
      "openEditModal fills the same suggestion list on open");
  }

  /* ---------------------------------------- 5c. the Add people dialog

     One person per Add, and the dialog stays open. The two halves of that are
     asserted separately, because either can regress without the other: what
     lands in the document, and what the four fields look like afterwards. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.dirtyDoc = false;
    const tier = M.state.tiers[2].id;

    M.setAdd({tier:tier, group:"FRA", name:"Ada Lovelace", files:[]});
    /* The answer Add & close acts on. It is a real return value rather than a
       reading of state, because the caller cannot tell "added nobody" from
       "added somebody" by looking: every refusal already left an alert on
       screen, and closing the dialog over it is what this value prevents. */
    eq(await M.addOnePerson(), true, "a successful Add reports that it added somebody");

    eq(countOf(M), 1, "Add creates exactly one person");
    const p = M.state.people[0];
    eq(p.name, "Ada Lovelace", "…carrying the name the dialog held");
    eq(p.tierId, tier, "…in the grade the dialog was set to");
    eq(M.groupLabel(M.state, p), "FRA", "…and the group it was set to");
    eq(p.photo, null, "…and no photo, because none was chosen — Name stays optional too");
    eq(M.history.length, 1, "one added person is exactly one history entry");
    eq(M.dirtyDoc, true, "…and the document is dirty");

    /* the dialog is ready for the next person without being reopened */
    eq(M.add.name, "", "after Add the name is cleared");
    eq(M.add.files.length, 0, "after Add the photo is cleared");
    eq(M.add.tier, tier, "after Add the grade is KEPT for the next person");
    eq(M.add.group, "FRA", "after Add the group is kept too");
    eq(M.focused[M.focused.length - 1], "#addName", "and focus goes back to the name");
    check(M.toasts.some(t => /1 person added/.test(t)), "the existing toast confirms it");
  }

  /* ------------------------------------- 5c1. Role, added alongside Name

     Role is per-person like Name — it identifies who is being added, not a
     property the next person shares — so it reads into the created person and
     then clears, while Grade and Group (which the next person usually
     shares) survive the clear untouched. The placeholder is a second,
     independent claim: it follows whichever grade is currently selected,
     through the very policy (tierRole) syncEditModal already uses for
     #editRole, so switching grades mid-dialog — before anything is typed —
     shows that grade's own name rather than the previous grade's. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const g0 = M.state.tiers[0], g1 = M.state.tiers[1];

    /* (a) the typed role lands on the created person, verbatim */
    M.setAdd({tier:g0.id, group:"FRA", name:"Ada Lovelace", role:"Chief Cartographer"});
    eq(await M.addOnePerson(), true, "the add succeeds");
    eq(countOf(M), 1, "…creating one person");
    eq(M.state.people[0].role, "Chief Cartographer",
      "…carrying exactly the role literal the dialog held — got "
      + JSON.stringify(M.state.people[0] && M.state.people[0].role));

    /* (b) after the add, Role clears with Name while Grade/Group persist */
    eq(M.add.role, "", "after Add the role is cleared, the same as name and photo");
    eq(M.add.group, "FRA", "…while group — the test's own literal — is kept for the next person");
    eq(M.add.tier, g0.id, "…and the grade selection is kept too");

    /* (c) the placeholder follows the grade — two distinct label literals from
       sixGrades(), never read back from the app's own tierRole output, so this
       fails if syncAddRolePlaceholder stops tracking the selection or starts
       answering from something other than the chosen grade's own label. */
    M.setAdd({tier:g0.id});
    M.syncAddRolePlaceholder();
    eq(M.add.rolePlaceholder, g0.label,
      "the placeholder reads grade 0's own label ("+JSON.stringify(g0.label)+")");

    M.setAdd({tier:g1.id});
    M.syncAddRolePlaceholder();
    eq(M.add.rolePlaceholder, g1.label,
      "…and switching the selection to a different grade flips it to THAT "
      + "grade's label ("+JSON.stringify(g1.label)+") — not the first grade's");

    /* zero grades: nothing is selected, so there is nothing to print */
    M.setAdd({tier:""});
    M.syncAddRolePlaceholder();
    eq(M.add.rolePlaceholder, "",
      "…and with no grade selected at all, the placeholder is empty — got "
      + JSON.stringify(M.add.rolePlaceholder));
  }

  {
    /* Five people from one open dialog is five entries — not one batch, and not
       one per keystroke. The fields are read only when Add runs, so typing
       cannot commit; that is what makes this count exact rather than lucky. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const tier = M.state.tiers[0].id;
    for(let i = 0; i < 5; i++){
      M.setAdd({tier:tier, group:"FRA", name:"Person " + i});
      await M.addOnePerson();
    }
    eq(countOf(M), 5, "five Adds create five people");
    eq(M.history.length, 5, "…and five separate history entries");
    check(M.state.people.every(x => x.tierId === tier && M.groupLabel(M.state, x) === "FRA"),
      "…every one of them in the grade and group the dialog held throughout");
    check(M.state.people.map(x => x.name).join(",") === "Person 0,Person 1,Person 2,Person 3,Person 4",
      "…and each with its own name, so no field leaked into the next person");
    M.undo();
    eq(countOf(M), 4, "undo takes back exactly one of them");
  }

  /* ------------------------------------- 5c2. the photo well
                                                 (the choice, not the Add)

     Decoding happens when the photo is CHOSEN. It has to decode to show
     anything at all, so a FileReader preview would pay the same cost, show the
     original rather than the downscaled image that gets stored, and leave every
     refusal arriving one step late, at Add.

     The price is one piece of state between the picker and Add, in a dialog
     that deliberately stays open — and that is the whole risk: left behind, it
     gives the next person the previous person's photo, silently. Everything
     below is written around that single failure. */
  {
    /* The photo goes through processImage — the same function addFiles calls,
       which is where the byte-level JPEG/PNG check, the size limits and the
       re-encode live. There is no second validation path to test, so what is
       asserted here is that this one is reached at the picker, and that a
       refusal leaves nothing behind that a later Add could pick up. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.dirtyDoc = false;
    const choice = M.choosePhoto(file("notes.txt"));
    await tick();
    eq(M.decodes.length, 1, "a chosen photo reaches the shared decoder — at the "
      + "choice, not at Add");
    M.decodes[0].rej(new Error("only JPEG and PNG photos are supported"));
    await choice;
    check(M.alerts.some(x => /only JPEG and PNG/.test(x)),
      "a refused file is reported where the choice was made, in the decoder's "
      + "own words rather than a second phrasing of them");
    check(M.alerts.some(x => /^That photo was not used/.test(x)),
      "…saying the PHOTO was not used: nobody was being added yet, so it must "
      + "not borrow addOnePerson's 'Nobody was added'");
    check(!M.alerts.some(x => /Nobody was added/.test(x)),
      "…and nothing here claims nobody was added, which is a different outcome");
    /* the three views, all of them empty */
    eq(M.pending, null, "a refused file leaves nothing in the well");
    eq(M.add.files.length, 0,
      "…and clears the input, which must not go on naming a file the dialog refused");
    eq(M.add.wellShown, false, "…and shows no preview");
    eq(M.history.length, 0, "choosing a photo writes no history entry");
    eq(M.dirtyDoc, false, "…and no dirty flag — nothing in the document changed");
    eq(countOf(M), 0, "…and adds nobody");

    /* and the person can still be added, without a picture */
    M.setAdd({tier:M.state.tiers[0].id, group:"", name:"Nope"});
    eq(await M.addOnePerson(), true,
      "the person can still be added afterwards, because the refusal was about "
      + "the photo and not about them");
    eq(who(M, 0).photo, null, "…with no photo");
  }

  /* ---------------------------------------- 5b2. the picker fills Name from
     the file name — the courtesy the drop path already gives a batch, now
     given to a photo chosen through the Add dialog too. nameFromFile and
     clampText are the real ones (grabbed above), so this is the drop path's
     own rule, not a second copy of it. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const choice = M.choosePhoto(file("Grace_Hopper.jpg"));
    await tick();
    M.decodes[0].res({data:"data:image/jpeg;base64,BBBB", w:100, h:100});
    await choice;
    eq(M.add.name, "Grace Hopper",
      "a blank Name is filled from the file name — got " + JSON.stringify(M.add.name));
    eq(M.add.pickText, "GH",
      "…and the placeholder circle's initials are synced in the same breath, "
      + "not one render behind it — got " + JSON.stringify(M.add.pickText));
    eq(JSON.stringify(M.pending.frame), JSON.stringify({zoom:1, ox:0, oy:0}),
      "…and the frame is still the default one — filling the name changes "
      + "nothing about the photo itself");
  }
  /* ---------------------------------------- 5b2b. nameFromFile title-cases on
     NON-LETTER boundaries, not ASCII \b — a letter after ä/ö/ü/ß stays as
     typed instead of being pulled uppercase by JS's ASCII-only \b. Driven
     through the same picker path as 5b2, so this is the real function every
     call site uses, not a second copy of its rule. */
  for(const [filename, want, why] of [
    ["müller.jpg", "Müller",
      "a leading letter followed by a non-ASCII letter is title-cased once, "
      + "not letter-by-letter — the ü must not be pulled uppercase by \\b"],
    ["anna_müller.jpg", "Anna Müller",
      "each word gets exactly one capital, umlaut included, after the "
      + "underscore-to-space separator collapse"],
    ["ölberg, anna.png", "Anna Ölberg",
      "the comma swap moves the surname first, and the umlaut starting "
      + "that surname is still title-cased"],
    ["ßler.jpg", "ßler",
      "the ß guard: \"ß\".toUpperCase() is the two-character \"SS\", so it "
      + "must be left alone rather than turning \"ßler\" into \"SSler\""],
    ["grace_hopper.jpg", "Grace Hopper",
      "plain ASCII filenames are title-cased exactly as before"],
  ]){
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const choice = M.choosePhoto(file(filename));
    await tick();
    M.decodes[0].res({data:"data:image/jpeg;base64,BBBB", w:100, h:100});
    await choice;
    eq(M.add.name, want, why + " — file " + JSON.stringify(filename)
      + ", got " + JSON.stringify(M.add.name));
  }
  {
    /* A typed name is never overwritten — choosing a photo (or replacing one)
       must not clobber it, which is why the fill only happens when the field
       is blank. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.setAdd({tier:M.state.tiers[0].id, group:"", name:"Ada Lovelace"});
    const choice = M.choosePhoto(file("Grace_Hopper.jpg"));
    await tick();
    M.decodes[0].res({data:"data:image/jpeg;base64,BBBB", w:100, h:100});
    await choice;
    eq(M.add.name, "Ada Lovelace",
      "a typed Name is untouched by choosing a photo — got " + JSON.stringify(M.add.name));

    /* Replace photo, through the Add framing editor's own [data-fact]
       click — the picker fires again, and the same rule has to hold the
       second time through, with a photo already in the well. */
    M.addClickFact("replace");
    const replace = M.choosePhoto(file("Alan_Turing.jpg"));
    await tick();
    M.decodes[M.decodes.length - 1].res({data:"data:image/jpeg;base64,CCCC", w:100, h:100});
    await replace;
    eq(M.add.name, "Ada Lovelace",
      "…and Replace photo does not touch it either — got " + JSON.stringify(M.add.name));
  }

  {
    /* What the well holds is what the chart will store: processImage's
       downscaled result, cropped by the chart's own rule. A preview computed a
       second way would be a picture of something else. The DOM-level half of
       that claim — that the well's own <img> is placed by frameRect at
       PREVIEW_R — is what syncAddFramePreview does with the SAME frameRect and
       placeFramePreview Edit's own syncFramePreview calls, both grabbed real
       above; this suite's sandbox has no selector-capable DOM to read that
       placement back off (Edit's own preview is untested here for the same
       reason), so what is asserted is the state the shared preview is a
       function of: the decoded bytes and dimensions, and the frame nothing
       has touched yet. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const tier = M.state.tiers[1].id;
    const wide = M.choosePhoto(file("Wide.jpg"));
    await tick();
    M.decodes[0].res({data:"data:image/jpeg;base64,WWWW", w:200, h:120});
    await wide;
    eq(M.add.wellShown, true, "an accepted photo shows the well");
    eq(M.pending.result.data, "data:image/jpeg;base64,WWWW",
      "…holding the DECODED image — the downscaled one that gets stored, not "
      + "the original the user picked");
    check(M.pending && M.pending.result.w === 200,
      "…and the well holds the decoder's own dimensions");
    eq(JSON.stringify(M.pending.frame), JSON.stringify({zoom:1, ox:0, oy:0}),
      "a freshly chosen photo starts at the default frame — nothing has "
      + "touched it yet");

    const tall = M.choosePhoto(file("Ada.jpg"));
    await tick();
    M.decodes[M.decodes.length - 1].res({data:"data:image/jpeg;base64,BBBB", w:100, h:120});
    await tall;
    eq(M.pending.result.data, "data:image/jpeg;base64,BBBB",
      "choosing a second photo replaces the first in the well rather than "
      + "adding to it");
    eq(JSON.stringify(M.pending.frame), JSON.stringify({zoom:1, ox:0, oy:0}),
      "…and the second photo ALSO starts at the default frame, not whatever "
      + "the first one's would have become");

    M.setAdd({tier:tier, group:"BER", name:"Ada"});
    eq(await M.addOnePerson(), true, "an accepted photo reports success");
    eq(countOf(M), 1, "an accepted photo adds the person");
    eq(who(M, 0).photo, "data:image/jpeg;base64,BBBB", "…with the decoded photo");
    eq(who(M, 0).pw, 100, "…and the decoder's width, not the file's claim");
    eq(who(M, 0).ph, 120, "…and its height");
    eq(M.history.length, 1, "…as one history entry");
  }

  {
    /* THE regression this batch exists to prevent. The dialog stays open across
       an Add, so a well that survives one hands the next person a face that is
       not theirs — and nothing on screen would say so. A photo is four fields
       and the layout reads every one of them, so all four are asserted: a tail
       that cleared `photo` alone would leave pw, ph and a frame pointing at a
       picture that is gone. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const tier = M.state.tiers[0].id;

    const choice = M.choosePhoto(file("Ada.jpg"));
    await tick();
    M.decodes[0].res({data:"data:image/jpeg;base64,BBBB", w:100, h:120});
    await choice;
    M.setAdd({tier:tier, group:"FRA", name:"Ada"});
    await M.addOnePerson();

    eq(M.pending, null, "after an Add the well is empty");
    eq(M.add.files.length, 0, "…the input is cleared with it");
    eq(M.add.wellShown, false, "…and the preview is gone");

    /* the second person, added without touching the picker */
    M.setAdd({tier:tier, group:"FRA", name:"Grace"});
    eq(await M.addOnePerson(), true, "a second Add with no photo chosen succeeds");
    eq(countOf(M), 2, "…and adds a second person");
    const two = who(M, 1);
    eq(two.name, "Grace", "…who is the second person");
    eq(two.photo, null, "the second person gets NO photo — not the first person's");
    eq(two.pw, 0, "…and no stored width left over from it");
    eq(two.ph, 0, "…and no height");
    eq(two.frame, null, "…and no framing pointing at a picture that is not theirs");
    eq(who(M, 0).photo, "data:image/jpeg;base64,BBBB",
      "…while the first person keeps the photo that was actually chosen for them");
  }

  {
    /* The same across a close. A dialog closed with a photo in the well would
       reopen holding one the user last saw before deciding against it — and
       would hand it to whoever they added next. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const choice = M.choosePhoto(file("Ada.jpg"));
    await tick();
    M.decodes[0].res({data:"data:image/jpeg;base64,BBBB", w:100, h:120});
    await choice;
    check(M.pending !== null, "a chosen photo is in the well before the close");

    M.closeAddModal();
    eq(M.pending, null, "closing the dialog empties the well");
    eq(M.add.files.length, 0, "…and the input with it");
    eq(M.add.wellShown, false, "…and hides the preview");

    M.openAddModal();
    eq(M.pending, null, "and reopening finds it still empty");
    eq(M.add.wellShown, false, "…with no preview showing");
    /* Open clears on its own account, not because Close already did. Asserted
       against a well that is deliberately full at the moment Open runs: with
       both clears in place either one would satisfy the pair above, so removing
       one of them would go unnoticed. The claim is the same one the #addName
       clear beside it makes — the dialog opens showing what the document says,
       and nothing it was left holding. */
    {
      const again = M.choosePhoto(file("Ada.jpg"));
      await tick();
      /* the newest decode, not decodes[0] — this module has already made one,
         and re-resolving that settled promise would leave `again` pending for
         ever and take the whole suite down with it */
      M.decodes[M.decodes.length - 1].res({data:"data:image/jpeg;base64,BBBB", w:100, h:120});
      await again;
      check(M.pending !== null, "…a photo chosen with the dialog open is in the well");
      M.openAddModal();
      eq(M.pending, null, "…and Open empties it itself, not only because Close did");
      eq(M.add.wellShown, false, "…hiding the preview with it");
      eq(M.add.files.length, 0, "…and clearing the input");
    }
    M.setAdd({tier:M.state.tiers[0].id, name:"Grace", group:""});
    await M.addOnePerson();
    eq(who(M, 0).photo, null,
      "…so the person added after a close-and-reopen has no photo");
  }

  {
    /* Remove photo, through the Add framing editor's own
       [data-fact="remove"] button — driven through the real delegated click
       handler. It changes nothing in the document — the person it would
       have belonged to does not exist yet — so the absence of a history
       entry and of a dirty flag is the assertion, not an afterthought. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const choice = M.choosePhoto(file("Ada.jpg"));
    await tick();
    M.decodes[0].res({data:"data:image/jpeg;base64,BBBB", w:100, h:120});
    await choice;
    M.dirtyDoc = false;
    const entries = M.history.length;

    M.addClickFact("remove");
    eq(M.pending, null, "Remove photo empties the well");
    eq(M.add.files.length, 0, "…and clears the input, so the same file can be chosen again");
    eq(M.add.wellShown, false, "…and hides the preview");
    eq(M.history.length, entries, "…writing no history entry");
    eq(M.dirtyDoc, false, "…and no dirty flag, because no document state changed");
    eq(M.focused[M.focused.length - 1], "#addPhotoPick",
      "…and moves focus into the placeholder section that replaced the framing "
      + "editor — the same rule Edit's own Remove photo follows for its "
      + "rebuilt section, applied here");

    M.setAdd({tier:M.state.tiers[0].id, name:"Ada", group:""});
    await M.addOnePerson();
    eq(who(M, 0).photo, null, "and the person is added with no photo");
  }

  /* ---------------------------------------- 5c2. the Add dialog's own
     framing editor: what does NOT happen

     Add "bekommt alles" — the same pan/zoom/reset framing editor Edit's
     dialog shows, operating on addPending.frame before any person exists.
     The cardinal rule, and the heart of this step: nothing here may touch
     state, history, the dirty flag or the status bar — a framing session in
     Add that left a trace in undo would be a defect no suite before this one
     could catch, because addPending.frame did not exist before this batch. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const choice = M.choosePhoto(file("Ada.jpg"));
    await tick();
    M.decodes[0].res({data:"data:image/jpeg;base64,BBBB", w:200, h:100});
    await choice;
    M.dirtyDoc = false;
    const entries = M.history.length;

    M.addZoom(1.6);
    eq(M.pending.frame.zoom, 1.6, "zooming in the Add dialog writes addPending.frame.zoom");
    eq(M.history.length, entries, "…without writing a history entry — the person does not exist yet");
    eq(M.dirtyDoc, false, "…or setting the dirty flag");

    M.addPanKey("ArrowRight", false);
    check(M.pending.frame.ox > 0,
      "an arrow-key pan step moves addPending.frame.ox — got " + M.pending.frame.ox);
    eq(M.history.length, entries, "…a pan step ALSO writes no history entry");
    eq(M.dirtyDoc, false, "…nor a dirty flag");

    M.addClickFact("reset");
    eq(JSON.stringify(M.pending.frame), JSON.stringify({zoom:1, ox:0, oy:0}),
      "Reset photo puts the frame back to default — got " + JSON.stringify(M.pending.frame));
    eq(M.history.length, entries, "…and reset writes no history entry either");
    eq(M.dirtyDoc, false, "…nor a dirty flag");
  }

  {
    /* A full Add carries the edited frame into the new person — clamped once
       more at commit time through the same clampFrame the framing editor
       itself uses. The expected numbers are literals, not a second call to
       clampFrame: they are worked out by hand against frameLimit's own
       formula (§3958 in tierform_app.html), so the expectation comes from a
       second writer rather than from the app's own answer compared with
       itself. At w:200,h:100,zoom:1.5 the ox/oy clamp is max(0,1.5*2-1)=2 and
       max(0,1.5-1)=0.5 — comfortably clear of the single 0.05 PAN_STEP taken
       in each direction below, so neither pan is clamped. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const tier = M.state.tiers[0].id;
    const choice = M.choosePhoto(file("Ada.jpg"));
    await tick();
    M.decodes[0].res({data:"data:image/jpeg;base64,BBBB", w:200, h:100});
    await choice;

    M.addZoom(1.5);
    M.addPanKey("ArrowRight", false);
    M.addPanKey("ArrowDown", false);
    eq(M.pending.frame.zoom, 1.5, "the well holds the zoomed frame before the Add");
    eq(M.pending.frame.ox, 0.05, "…the panned horizontal offset");
    eq(M.pending.frame.oy, 0.05, "…and the vertical one");

    M.setAdd({tier:tier, group:"", name:"Ada"});
    eq(await M.addOnePerson(), true, "the add succeeds");
    eq(who(M, 0).frame.zoom, 1.5,
      "the new person's frame carries the zoom that was set in the well — "
      + "not photoFields' own default of 1");
    eq(who(M, 0).frame.ox, 0.05, "…the horizontal pan");
    eq(who(M, 0).frame.oy, 0.05, "…and the vertical pan");

    /* Add & continue: the dialog stays open, and the well is what setAddPhoto
       already clears — but the frame lives INSIDE addPending now, not beside
       it, so what has to be proven here is that the NEXT photo chosen starts
       fresh rather than carrying the just-added person's framing forward,
       which would be the "next person gets the previous person's face" bug
       this whole batch exists to prevent, one field further along. */
    const again = M.choosePhoto(file("Grace.jpg"));
    await tick();
    M.decodes[M.decodes.length - 1].res({data:"data:image/jpeg;base64,CCCC", w:100, h:100});
    await again;
    eq(JSON.stringify(M.pending.frame), JSON.stringify({zoom:1, ox:0, oy:0}),
      "the next pending photo starts at the default frame, not the previous "
      + "one's edited values");
  }

  {
    /* The commit-time clamp specifically: a frame that is out of range for
       its own photo (built directly, bypassing the framing handlers — which
       never produce one, since every write of theirs goes through clampFrame
       already) must still come out of addOnePerson clamped, not carried
       through raw. At w:100,h:100,zoom:1.5 frameLimit's own formula gives
       ox/oy <= max(0,1.5-1) = 0.5, so an ox/oy of 5 is expected to land at
       exactly 0.5 — a literal worked out by hand, not a second call to
       clampFrame or frameLimit. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const tier = M.state.tiers[0].id;
    M.setPendingDirectly({result:{data:"data:image/jpeg;base64,DDDD", w:100, h:100},
                          gen:M.docGen, frame:{zoom:1.5, ox:5, oy:5}});
    M.setAdd({tier:tier, group:"", name:"Out Of Range"});
    eq(await M.addOnePerson(), true, "the add succeeds even with an out-of-range frame");
    eq(who(M, 0).frame.ox, 0.5,
      "the committed frame is clamped, not carried through raw — got "
      + who(M, 0).frame.ox);
    eq(who(M, 0).frame.oy, 0.5, "…in both directions — got " + who(M, 0).frame.oy);
  }

  {
    /* Same rule the drop path obeys: an image decoded for a document that has
       since been replaced must not land in the one on screen now. The gap is
       wider than it was — the well can sit across a whole New — so the
       generation the PICKER captured is what Add judges. Checked before
       commit(), so a refusal leaves no snapshot and no dirty flag. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const choice = M.choosePhoto(file("Ada.jpg"));
    await tick();
    M.decodes[0].res({data:"data:image/jpeg;base64,BBBB", w:100, h:120});
    await choice;
    /* awaited, because New asks before it replaces: the whole document has to
       be gone before Add runs, which is the case the generation guard is for */
    await M.newDoc();                 // a whole new document, photo still in the well
    M.dirtyDoc = false;
    /* New ships no grades — this test is about the generation guard on the
       photo, not about grades, so give the fresh document one to add into. */
    M.state.tiers = sixGrades();
    M.setAdd({tier:M.state.tiers[0].id, group:"", name:"Ada"});
    eq(await M.addOnePerson(), false,
      "a photo decoded for a document that has gone reports no add");
    eq(countOf(M), 0, "a photo decoded for a document that has gone adds nobody");
    eq(M.history.length, 0, "…and leaves no history entry behind");
    eq(M.dirtyDoc, false, "…and no dirty flag");
  }

  {
    /* The generation belongs to the moment the decode STARTED, not to the
       moment it finished. New can land while the picker is still decoding, and
       a `gen` read after the await would be the new document's — which would
       let a photo chosen for the old one attach to somebody in the new one. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const choice = M.choosePhoto(file("Ada.jpg"));
    await tick();
    await M.newDoc();                 // a whole new document, mid-decode
    M.decodes[0].res({data:"data:image/jpeg;base64,BBBB", w:100, h:120});
    await choice;
    M.dirtyDoc = false;
    /* New ships no grades — this test is about the generation guard on the
       photo, not about grades, so give the fresh document one to add into. */
    M.state.tiers = sixGrades();
    M.setAdd({tier:M.state.tiers[0].id, group:"", name:"Ada"});
    eq(await M.addOnePerson(), false,
      "a photo whose decode STARTED in a document that has since gone is "
      + "refused — the generation is captured before the await, not after");
    eq(countOf(M), 0, "…adding nobody");
    eq(M.dirtyDoc, false, "…and leaving no dirty flag");
  }

  {
    /* A drop batch decoding in the background planned its photo budget against
       a roster the dialog is about to change. Rather than reason about two
       imports interleaving, the picker takes the same turn addFiles and
       addOnePerson take when they find themselves second — and leaves the well
       empty, so nothing half-chosen is left to add. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.answerImportWith(M.state.tiers[0].id, "");
    const batch = M.addFiles([file("Grace_Hopper.jpg")]);
    await tick();                     // the batch is now parked on its decode
    const before = M.decodes.length;

    /* Not awaited yet, deliberately. A regression here starts a decode nobody
       is going to resolve, and awaiting it would hang the whole run rather than
       fail this section — the same defect as a mutation that throws, minus even
       the error message. Everything is asserted off one tick, then settle()
       drains whatever was started and the promise is safe to await. */
    const blocked = M.choosePhoto(file("Ada.jpg"));
    await tick();
    check(M.toasts.some(t => /Still importing the last batch/.test(t)),
      "choosing a photo mid-import says so, in the same words the drop path and "
      + "Add already use for the same condition");
    eq(M.decodes.length, before,
      "…and does not start a second decode alongside the batch's");
    eq(M.pending, null, "…leaving nothing in the well");
    eq(M.add.files.length, 0, "…and nothing in the input either");
    eq(M.add.wellShown, false, "…and no preview");

    await settle(M); await batch; await blocked;   // let the batch finish, as it would
    M.setAdd({tier:M.state.tiers[0].id, group:"", name:"Ada"});
    await M.addOnePerson();
    eq(who(M, countOf(M) - 1).photo, null,
      "and the person added afterwards has no photo, because none was taken");

    /* The other direction, which is the reason the picker TAKES the flag rather
       than only reading it: a drop that arrives while the dialog is decoding
       would plan its budget against a roster the dialog is about to change. */
    const held = countOf(M);
    const slow = M.choosePhoto(file("Ada.jpg"));
    await tick();
    const seen = M.toasts.length;
    M.answerImportWith(M.state.tiers[0].id, "");
    const late = M.addFiles([file("Alan_Turing.jpg")]);
    await tick();
    check(M.toasts.slice(seen).some(t => /Still importing the last batch/.test(t)),
      "a drop arriving while the picker is decoding is turned away too — the "
      + "picker holds importBusy across its decode, not just across the check");
    /* drained before either is awaited, for the same reason as above: a drop
       that was NOT turned away is parked on a decode nobody will resolve */
    await settle(M); await late; await slow;
    eq(countOf(M), held, "…so the drop imports nobody while the dialog is decoding");
  }

  {
    /* The budget is measured against the roster, which the picker cannot see,
       so it still refuses at Add — and the photo stays in the well. That is
       what makes the refusal recoverable: remove the photo, add the person
       without one. A tail that emptied the well on this path would take away
       the only thing the user can act on. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const tier = M.state.tiers[0].id;
    const big = "data:image/jpeg;base64," + "A".repeat(M.LIMITS.photoBytes - 100);
    /* a roster already most of the way through the budget */
    while(M.encodedPhotoBytes(M.state) + big.length <= M.LIMITS.totalPhotoBytes){
      const p = personIn(M, "Filler");
      p.photo = big; p.pw = 10; p.ph = 10; p.frame = {zoom:1, ox:0, oy:0};
      M.state.people.push(p);
    }
    const filled = countOf(M);
    const choice = M.choosePhoto(file("Ada.jpg"));
    await tick();
    M.decodes[0].res({data:big, w:100, h:120});
    await choice;
    M.dirtyDoc = false;
    M.setAdd({tier:tier, group:"", name:"Ada"});

    eq(await M.addOnePerson(), false, "the aggregate budget still refuses at Add");
    eq(countOf(M), filled, "…adding nobody");
    eq(M.dirtyDoc, false, "…and leaving no dirty flag");
    check(M.alerts.some(x => /Nobody was added/.test(x) && /MB limit/.test(x)),
      "…saying nobody was added, which is what happened");
    check(M.pending !== null,
      "and the photo is STILL in the well, so the refusal can be answered");
    eq(M.add.wellShown, true, "…and still on screen, so there is something to remove");

    M.addClickFact("remove");
    eq(await M.addOnePerson(), true,
      "removing it and adding again works — the way out of a budget refusal");
    eq(countOf(M), filled + 1, "…and the person is added, without a picture");
    eq(who(M, filled).photo, null, "…with no photo");
  }

  {
    /* photoBudgetExceeded is the one decision point addFiles' batch sum and
       #fileSwap's single replacement both defer to, and the two differ only
       in whether an old photo's bytes come out first. Proven at a boundary
       chosen so the subtraction is load-bearing rather than incidental: a
       roster totalling exactly 49,000,000 bytes, replacing a 1,000,000-byte
       photo (O) with a 2,000,000-byte one (N), fits ONLY because O is
       subtracted first —
         49,000,000 - 1,000,000 + 2,000,000 = 50,000,000 <= 50,331,648 (48 MB)
       Withhold the subtraction (removedBytes 0, as a straight add always
       passes) and the identical addition is
         49,000,000 + 2,000,000 = 51,000,000 > 50,331,648
       Both expectations below are that literal arithmetic, typed out — not a
       second call to photoBudgetExceeded, and not encodedPhotoBytes' own
       total re-added by hand, either of which would be the claim and its
       evidence coming from the same place. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const ada = personIn(M, "Ada Lovelace");
    ada.photo = "A".repeat(1000000);       // O: the photo about to be replaced
    const filler = personIn(M, "Filler");
    filler.photo = "A".repeat(48000000);   // brings the roster to 49,000,000 bytes total
    M.state.people.push(ada, filler);

    eq(M.LIMITS.totalPhotoBytes, 50331648,
      "the boundary above is worked out against the shipped limit — got " + M.LIMITS.totalPhotoBytes);
    eq(M.photoBudgetExceeded(M.state, 2000000, 1000000), false,
      "a replacement fits when the old photo's bytes are subtracted first — "
      + "49,000,000 - 1,000,000 + 2,000,000 = 50,000,000, under the limit");
    eq(M.photoBudgetExceeded(M.state, 2000000, 0), true,
      "…and the identical addition refuses if removedBytes is withheld — "
      + "49,000,000 + 2,000,000 = 51,000,000, over the limit: the subtraction actually "
      + "moves the answer, it is not a no-op either call path could drop");
  }

  {
    /* The one-owner rule, driven rather than described: a well written by hand
       is a photo the dialog will add and is not showing. test/dom.js forbids
       the assignment statically; this proves what it would cost. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.setPendingDirectly({result:{data:"data:image/jpeg;base64,BBBB", w:10, h:10},
                          gen:M.docGen});
    eq(M.add.wellShown, false,
      "a hand-written addPending leaves the preview hidden — the well and the "
      + "screen disagree, which is exactly what setAddPhoto exists to prevent");
    M.setAddPhoto(null);
    eq(M.pending, null, "…and the owner is what puts them back in agreement");
  }

  /* ---------------------------------------- 5d. Remove photo goes back to initials

     The route that did not exist: a photo could be added, replaced and
     reframed, but the only way to take one away was to remove the person and
     add them again, which costs their grade, group, role and position.

     Driven through the real [data-fact] click handler rather than by calling
     applyPhoto — the whole risk here is the handler clearing p.photo by hand
     and leaving pw, ph and a stale frame behind, which a suite that called
     applyPhoto itself could never see. A photo is four fields, and every one
     of them is read by the layout. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const tier = M.state.tiers[1].id;

    const before = personIn(M, "Before");
    const ada    = personIn(M, "Ada Lovelace");
    const after  = personIn(M, "After");
    Object.assign(ada, {tierId:tier, groupId: M.resolveGroupId(M.state, "BER"), role:"Head of Thing",
                        photo:"data:image/jpeg;base64,AAAA", pw:400, ph:300,
                        frame:{zoom:1.6, ox:12, oy:-4}});
    M.state.people.push(before, ada, after);
    M.dirtyDoc = false;

    M.clickFact("remove", ada.id);

    /* all four together — this is the assertion the item exists for */
    eq(ada.photo, null, "Remove photo clears the photo");
    eq(ada.pw, 0, "…and the stored pixel width with it");
    eq(ada.ph, 0, "…and the height");
    eq(ada.frame, null, "…and the framing, which would otherwise be left pointing "
      + "at a picture that is gone");

    /* everything the person is, other than their picture */
    eq(ada.name, "Ada Lovelace", "the person keeps their name");
    eq(ada.tierId, tier, "…their grade");
    eq(M.groupLabel(M.state, ada), "BER", "…their group");
    eq(ada.role, "Head of Thing", "…and their role");

    /* What separates this from data-act="del". Read through a name() that
       tolerates a missing slot: a mutation that DID delete the person leaves
       people[2] undefined, and reaching .name off it throws — which abandons
       the rest of this section instead of failing it, and a mutation that
       throws is not a pass. */
    const name = i => (M.state.people[i] || {}).name || "(nobody there)";
    eq(countOf(M), 3, "the person is still in the roster — this is not a delete");
    eq(M.state.people.indexOf(ada), 1, "…in the position they were in");
    eq(name(0), "Before", "…with the people around them undisturbed");
    eq(name(2), "After", "…on both sides");

    eq(M.history.length, 1, "removing a photo is exactly one history entry");
    eq(M.dirtyDoc, true, "…and marks the document dirty");
    /* same reason: no history entry at all must fail this, not throw on it */
    const label = (M.history[0] || {}).label;
    check(/photo/.test(label || ""),
      "…labelled as a photo removal, so the undo entry reads — got "
        + JSON.stringify(label));

    /* one undo, all four back */
    M.undo();
    const back = M.state.people[1] || {};
    eq(back.photo, "data:image/jpeg;base64,AAAA", "undo restores the photo");
    eq(back.pw, 400, "…its width");
    eq(back.ph, 300, "…its height");
    eq(JSON.stringify(back.frame), JSON.stringify({zoom:1.6, ox:12, oy:-4}),
      "…and the framing exactly as it was, not a reset one");
    eq(countOf(M), 3, "…and takes nobody away doing it");
  }

  {
    /* A person with no photo. The button is not rendered for them, but the
       branch must not throw if it is reached anyway — and it must not invent
       a history entry for a change that changes nothing visible. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const bare = personIn(M, "No Picture");
    M.state.people.push(bare);
    M.dirtyDoc = false;
    M.clickFact("remove", bare.id);
    eq(bare.photo, null, "removing the photo of someone who has none leaves them without one");
    eq(bare.name, "No Picture", "…and does not touch anything else about them");
    eq(countOf(M), 1, "…and certainly does not remove the person");
  }


  /* ---------------------------------------- 5e. the Edit person dialog is live

     Editing a person happens through a dialog, and the property edit()
     exists for is what makes it work: a burst of typing is ONE history
     entry, not one per keystroke. Everything here is driven through the
     dialog's real listeners, because the edit() KEY that groups a burst is
     written in those bodies and nowhere else — a suite that called edit()
     itself would choose its own key and go on passing after the app
     changed one. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const jane = personIn(M, "Jane");
    jane.tierId = M.state.tiers[0].id;
    M.state.people.push(jane);
    M.dirtyDoc = false;
    M.openEditModal(jane.id);
    eq(M.editId, jane.id, "the dialog is open on that person");
    eq(M.editFields.name.value, "Jane", "and shows the name they already have");
    /* Resolved fresh every time, never held: undo restores a CLONE, so the
       object this test pushed stops being the one in the document the moment
       anything is undone — and assertions against it would then be about
       nobody. This is the same reason staleWrite compares by identity. */
    const who = () => M.state.people[0] || {};

    /* one field, one burst */
    for(const v of ["J", "Ja", "Jan", "Jane Q"]) M.typeInto("name", v);
    eq(who().name, "Jane Q", "the last keystroke is on the person immediately");
    eq(M.history.length, 1, "…and the whole burst is one history entry");
    eq(M.dirtyDoc, true, "…which marks the document dirty");
    /* No undo here: an undo at this point would end the typing session,
       which would make the NEXT assertion unfalsifiable — group could not
       join the name burst even under a mutation that gave the two handlers
       one edit() key, because there would be no open session left to join.
       The burst is undone in its own scenario below instead. */

    /* A different field is a different session, so it does not join the burst.
       Typed to a value the fixture does NOT already hold — personIn() seeds
       every person with FRA, and typing that back would be an assertion the
       handler could fail and still pass. */
    eq(M.groupLabel(M.state, who()), "FRA", "this person starts with an group");
    for(const v of ["B", "BE", "BER"]) M.typeInto("group", v);
    eq(M.groupLabel(M.state, who()), "BER", "the group field writes to the person too");
    eq(M.history.length, 2, "…as its own entry, because a new field ends the old session");
    /* Jane is the only person in this document, so every keystroke leaves
       whichever group her groupId pointed at with zero members the instant
       it moves off — "FRA" (personIn's starting group), then "B", then
       "BE" are each pruned in turn by the pruneGroups() call inside edit(),
       and only the group her groupId currently names survives. */
    eq(M.state.groups.length, 1, "typing B, BE, BER leaves exactly one group — the transients were pruned");
    eq((M.state.groups[0] || {}).label, "BER",
      "…and it is labelled BER, not one of the letters typed on the way there");
    for(const v of ["H", "Head"]) M.typeInto("role", v);
    eq(who().role, "Head", "and so does the role field");
    eq(M.history.length, 3, "…again as one entry of its own");

    /* the grade is a discrete choice, so it is a commit rather than a session */
    const second = M.state.tiers[1].id;
    M.chooseGrade(second);
    eq(who().tierId, second, "choosing a grade moves the person into it");
    eq(M.history.length, 4, "…in one more history entry — four fields, four entries");
    /* Each entry names its own field, so the undo list reads as a list of
       edits rather than four copies of one word. Read off the labels the app
       wrote, compared against what each handler says it is doing. */
    const labels = M.history.map(h => h.label);
    check(/renamed/.test(labels[0]) && /group/.test(labels[1])
       && /role/.test(labels[2]) && /grade/.test(labels[3]),
      "and each entry names the field it came from — got " + JSON.stringify(labels));

    /* all the way back to the person as they were opened. Undone by exhausting
       canUndo() rather than by counting presses: the first undo after a live
       change spends itself pushing that state as the redo target, so "four
       entries" and "four presses" are not the same number. */
    let guard = 20;
    while(M.canUndo() && guard--) M.undo();
    eq(who().name, "Jane", "undoing every entry restores the name");
    eq(M.groupLabel(M.state, who()), "FRA", "…the group they had");
    eq(who().role || "", "", "…the empty role");
    eq(who().tierId, M.state.tiers[0].id, "…and the grade they started in");
    eq(M.editId, jane.id, "and none of it closed the dialog");
  }

  /* The other half of what edit() is for, on its own so that nothing has ended
     the session before the assertion runs: a burst goes back in ONE press. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const p = personIn(M, "Jane");
    M.state.people.push(p);
    M.openEditModal(p.id);
    for(const v of ["J", "Ja", "Jan", "Jane Q"]) M.typeInto("name", v);
    eq((M.state.people[0] || {}).name, "Jane Q", "four keystrokes, all applied");
    M.undo();
    eq((M.state.people[0] || {}).name, "Jane",
      "one undo puts the whole burst back, not one letter of it");
    eq(M.canUndo(), false, "…and there was only ever one step to undo");
  }

  /* ---- a second person typing the same group (any case) reuses the group,
     never mints a second one. resolveGroupId's own dedupe, driven through the
     real #editGroup listener for a second person this time — the first
     person's group already exists ("BER", case-sensitive) when the second
     one types the lowercase form. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const jane = personIn(M, "Jane");
    const bob  = personIn(M, "Bob");
    M.state.people.push(jane, bob);

    M.openEditModal(jane.id);
    for(const v of ["B", "BE", "BER"]) M.typeInto("group", v);
    M.endEdit();
    const janeGroupId = M.state.people[0].groupId;
    eq(M.groupLabel(M.state, M.state.people[0]), "BER", "Jane's group is BER");

    M.openEditModal(bob.id);
    for(const v of ["b", "be", "ber"]) M.typeInto("group", v);
    M.endEdit();
    const bobGroupId = M.state.people[1].groupId;

    eq(M.groupLabel(M.state, M.state.people[1]), "BER",
      "Bob's lowercase \"ber\" reads back as the same label Jane's typing produced");
    eq(bobGroupId, janeGroupId,
      "…because it is literally the same group, matched case-insensitively — not a second one");
    eq(M.state.groups.length, 1,
      "one group total, not two — got " + JSON.stringify(M.state.groups));
  }

  /* ---- a group's last member leaving prunes it, and undo brings both the
     person's group membership AND the group itself back — packState/
     unpackState round-trip the whole document through history, so this is
     really the same invariant commit()/edit() keep live, checked across an
     undo boundary rather than only immediately after the mutation. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const solo = personIn(M, "Solo");
    M.state.people.push(solo);
    eq(M.state.groups.length, 1, "personIn's FRA group exists, held by its one member");
    eq(M.groupLabel(M.state, solo), "FRA", "…and reads back as FRA");

    M.commit("removed the only member", () => {
      M.state.people = M.state.people.filter(p => p.id !== solo.id);
    });
    eq(M.state.people.length, 0, "the person is gone");
    eq(M.state.groups.length, 0,
      "…and the group they were the only member of is pruned with them — got "
      + JSON.stringify(M.state.groups));

    M.undo();
    eq(M.state.people.length, 1, "undo restores the person");
    eq(M.state.groups.length, 1, "…and the group they belonged to comes back with them");
    eq(M.groupLabel(M.state, M.state.people[0]), "FRA",
      "…still reading back as FRA, the same label it had before the commit");
  }

  /* ---- removing the photo swaps the section, and only the section ---------
     The one thing that must not happen is the dialog going away underneath a
     name half typed into it. Driven through the real [data-fact] handler and
     then through the real renderRoster path, so the swap is the app's own. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const ada = personIn(M, "Ada Lovelace");
    Object.assign(ada, {tierId:M.state.tiers[1].id, groupId: M.resolveGroupId(M.state, "BER"),
                        role:"Head of Thing",
                        photo:"data:image/jpeg;base64,AAAA", pw:400, ph:300,
                        frame:{zoom:1.6, ox:12, oy:-4}});
    M.state.people.push(ada);
    M.openEditModal(ada.id);
    /* the state it opens in: a framing editor, because there is a photo */
    const withPhoto = M.photoSection();
    check(withPhoto.verbs.indexOf("fact:pan") >= 0
       && withPhoto.verbs.indexOf("fact:remove") >= 0,
      "the section opens as the framing editor — got " + JSON.stringify(withPhoto.verbs));
    check(withPhoto.verbs.indexOf("act:photo") < 0,
      "…with no Add photo in it, because there is already one to work on");

    M.clickFact("remove", ada.id);

    eq(M.editId, ada.id, "removing the photo does not close the dialog");
    eq(ada.name, "Ada Lovelace", "the person keeps their name");
    eq(ada.tierId, M.state.tiers[1].id, "…their grade");
    eq(M.groupLabel(M.state, ada), "BER", "…their group");
    eq(ada.role, "Head of Thing", "…and their role");
    eq(countOf(M), 1, "and they are still in the roster — this is not a delete");

    const without = M.photoSection();
    eq(without.verbs.filter(v => v.indexOf("fact:") === 0).length, 0,
      "the framing editor is gone — got " + JSON.stringify(without.verbs));
    eq(without.verbs.filter(v => v === "act:photo").length, 2,
      "…replaced by the two ways to add a photo back — the placeholder circle "
      + "itself and the button beneath it, the same verb on both");
    check(/AL/.test(without.text),
      "…beside the initials, which is what the chart draws for them now — got "
        + JSON.stringify(without.text));
    /* the fields are still showing the person, not emptied by the rebuild */
    eq(M.editFields.name.value, "Ada Lovelace", "the name field is untouched by the swap");
    eq(M.editFields.group.value, "BER", "…and so is the group field");

    /* and it goes back */
    M.undo();
    const back = M.state.people[0] || {};
    eq(back.photo, "data:image/jpeg;base64,AAAA", "undo restores the photo");
    const again = M.photoSection();
    check(again.verbs.indexOf("fact:pan") >= 0,
      "…and the section is the framing editor again — got " + JSON.stringify(again.verbs));
  }

  /* ---- one route out of the document, reached from two places -------------
     The row menu's Remove and the dialog's Remove person are two faces of
     removePerson(). What proves it is not that both call it — it is that the
     document and the history entry they leave behind are the same, compared
     against each other rather than against a string written here. */
  {
    function afterRemoval(via){
      const M = makeModule();
      M.state = M.defaults();
      M.state.tiers = sixGrades();
      const t = M.state.tiers[0].id;
      const before = personIn(M, "Before"); before.tierId = t;
      const jane   = personIn(M, "Jane Doe"); jane.tierId = t;
      const after  = personIn(M, "After");  after.tierId = t;
      M.state.people.push(before, jane, after);
      M.dirtyDoc = false;
      if(via === "menu"){
        M.openMenuOn(jane.id);
        M.clickMenu("del", jane.id);
      }else{
        M.openEditModal(jane.id);
        M.clickRemovePerson();
      }
      return {M: M,
              names: M.state.people.map(p => p.name),
              label: (M.history[0] || {}).label,
              entries: M.history.length,
              toast: M.toasts[M.toasts.length - 1],
              dirty: M.dirtyDoc,
              editId: M.editId};
    }
    const viaMenu   = afterRemoval("menu");
    const viaDialog = afterRemoval("dialog");

    eq(JSON.stringify(viaMenu.names), JSON.stringify(["Before", "After"]),
      "the menu's Remove takes that person out and leaves the others in order");
    eq(JSON.stringify(viaDialog.names), JSON.stringify(viaMenu.names),
      "…and the dialog's Remove person leaves exactly the same roster");
    eq(viaDialog.label, viaMenu.label,
      "…the same history entry — menu says " + JSON.stringify(viaMenu.label)
        + ", dialog says " + JSON.stringify(viaDialog.label));
    check(/^removed Jane/.test(viaMenu.label || ""),
      "…and that entry names the person — got " + JSON.stringify(viaMenu.label));
    eq(viaDialog.entries, 1, "one entry, not two");
    eq(viaMenu.entries, 1, "from either route");
    eq(viaDialog.toast, viaMenu.toast,
      "…and the same toast — got " + JSON.stringify([viaMenu.toast, viaDialog.toast]));
    eq(viaDialog.dirty, true, "either route marks the document dirty");
    /* the one thing the two routes differ in, and it is the right way round */
    eq(viaDialog.editId, null, "removing from the dialog closes it — it was editing nobody");
    viaMenu.M.undo();
    eq(viaMenu.M.state.people.length, 3, "and one undo brings the person back");
  }

  /* ---- Move up and Move down, from the menu -------------------------------
     They were two buttons in the row and they are two items in its menu; the
     behaviour did not move with them. Driven through the menu's real click
     handler, which resolves the label BEFORE the mutation — afterwards the
     person is already in the grade the label is trying to name. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const T = M.state.tiers.map(t => t.id);
    const mk = (name, tier) => { const p = personIn(M, name); p.tierId = tier; return p; };
    const ana = mk("Ana", T[0]), bo = mk("Bo", T[0]), cy = mk("Cy", T[1]);
    M.state.people.push(ana, bo, cy);
    const order = () => M.state.people.map(p => p.name + "@" + T.indexOf(p.tierId));

    /* inside a grade: a plain reorder */
    M.openMenuOn(ana.id);
    M.clickMenu("down", ana.id);
    eq(JSON.stringify(order()), JSON.stringify(["Bo@0", "Ana@0", "Cy@1"]),
      "Move down swaps two people inside their grade");
    eq((M.history[0] || {}).label, "moved Ana",
      "…and says only that, because nothing else about them changed");

    /* across the boundary: the last of a grade goes into the next one */
    M.clickMenu("down", ana.id);
    eq(JSON.stringify(order()), JSON.stringify(["Bo@0", "Ana@1", "Cy@1"]),
      "Move down off the end of a grade moves the person into the next grade");
    eq((M.history[1] || {}).label, "moved Ana to " + M.gradeName(M.state.tiers[1]),
      "…and the entry names the grade they left for, resolved before the move");

    /* and back up again, which is the same rule in reverse */
    M.clickMenu("up", ana.id);
    eq(JSON.stringify(order()), JSON.stringify(["Bo@0", "Ana@0", "Cy@1"]),
      "Move up carries them back across the boundary");
    eq((M.history[2] || {}).label, "moved Ana to " + M.gradeName(M.state.tiers[0]),
      "…naming the grade on the other side");

    /* the ends refuse, and refuse without adding to the history */
    const entries = M.history.length;
    M.clickMenu("up", M.state.people[0].id);
    eq(JSON.stringify(order()), JSON.stringify(["Bo@0", "Ana@0", "Cy@1"]),
      "Move up on the first person in the first grade changes nothing");
    eq(M.history.length, entries + 1,
      "…though the press still records one, exactly as the row's disabled "
      + "button never let it get that far — the guard is on the control, not here");

    /* three undos and the roster is as it started */
    M.undo(); M.undo(); M.undo(); M.undo();
    eq(JSON.stringify(order()), JSON.stringify(["Ana@0", "Bo@0", "Cy@1"]),
      "and undo walks every one of those moves back");
  }

  /* ---------------------------------------------------------- 4. undo history is per-document */

  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.state.people.push(personIn(M, "Original Person"));

    M.snapshot("removed someone");
    M.state.people = [];
    eq(M.canUndo(), true, "there is something to undo before opening another file");

    /* starting a new document must not leave the old one's history behind —
       undoing into it would resurrect people who belong to a different roster */
    M.dirtyDoc = false;
    M.setConfirm(true);
    await M.newDoc();
    eq(M.history.length, 0, "New clears the undo history");
    eq(M.canUndo(), false, "nothing to undo in a brand-new document");
    M.undo();
    eq(countOf(M), 0, "an undo in the new document cannot pull in the old one's people");

    /* resetPerRoster also drops an open framing panel, whose person id is stale */
    M.snapshot("x");
    M.resetPerRoster();
    eq(M.history.length, 0, "resetPerRoster clears history");
  }

  /* ---------------------------------------------------------- 5. Open */

  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.dirtyDoc = true;

    M.setConfirm(false);
    await M.openDoc();
    eq(M.picked, 0, "Open cancelled: the file picker never opens");

    M.setConfirm(true);
    await M.openDoc();
    eq(M.picked, 1, "Open confirmed: the file picker opens");
  }

  /* ------------------------------------------- 6. there is no migration step */

  /* migrate() is gone. It did two jobs: it filled in fields a file omitted, and
     it upgraded two long-dead file shapes. The first was a duplicate —
     parseAndValidateRoster answers for every field independently, and is the
     only door a roster comes through — and the second had no files left to
     upgrade. What has to stay true is that a NEW document states everything
     itself, so nothing downstream is relying on a defaulting pass that no
     longer exists. The file half of this lives in test/import.js. */
  {
    const M = makeModule();
    const d = M.defaults();
    eq(d.layout, "pyramid", "a new document is a pyramid");
    for(const k of ["title","brand","accent","inkOnColour","inkOnWhite","bg","ring",
                    "page","density","angle","layout","showGradeCode",
                    "showGradeName","nameLabelPosition","showPersonName",
                    "showPersonGrade","showPersonGroup","tiers","people","groups"]){
      check(Object.prototype.hasOwnProperty.call(d, k),
        "defaults() states " + k + " itself rather than leaving it to be filled in");
    }
    check(d.tiers.every(t => t.role === undefined),
      "and no default grade carries a title of its own");
    /* groups is an array, and a new document starts with none — checked as a
       shape (Array.isArray + length), not eq(d.groups, [], …), since eq's
       === would fail on any two distinct empty arrays regardless of what
       defaults() actually returns. */
    check(Array.isArray(d.groups) && d.groups.length === 0,
      "a new document starts with no groups either — got " + JSON.stringify(d.groups));
    check(typeof M.migrate === "undefined",
      "migrate() is not merely unused but gone — a dead upgrade path is a trap");
  }

  {
    const M = makeModule();
    /* ---- 6c. switching layout is one ordinary document change.
       The point of the whole feature is that nothing else moves: the angle, the
       attach/share flags and every person stay exactly as they were, so a user
       can look at the same roster both ways and lose nothing. */
    {
      const F = makeModule();
      F.state = F.defaults();
      F.state.tiers = sixGrades();
      F.state.angle = 4;
      F.state.tiers[1].attach = true;
      F.state.tiers[2].merge = true; F.state.tiers[2].attach = true;
      const before = JSON.stringify({tiers:F.state.tiers, angle:F.state.angle});
      const steps = F.history.length;

      F.commit("changed the layout", () => { F.state.layout = "swimlanes"; }, {render:"chart"});
      eq(F.state.layout, "swimlanes", "the layout changed");
      eq(F.dirtyDoc, true, "and the document is dirty");
      eq(F.history.length, steps + 1, "one undo step, not two");
      eq(JSON.stringify({tiers:F.state.tiers, angle:F.state.angle}), before,
         "and nothing else about the document moved — angle, attach and share are untouched");

      F.undo();
      eq(F.state.layout, "pyramid", "undo goes back to the pyramid");
      eq(JSON.stringify({tiers:F.state.tiers, angle:F.state.angle}), before,
         "with the angle and the grade links exactly as they were");
      F.redo();
      eq(F.state.layout, "swimlanes", "redo returns to swimlanes");
      eq(F.state.angle, 4, "and the angle is still stored while lanes are drawn");
      F.undo();
      eq(F.state.angle, 4, "switching back finds the angle the user last chose");
    }

    /* ---- 6c2. changing which part of a name is bold follows the same
       one-commit, one-undo-step shape as every other Design selector — this
       replays what the #nameBold change listener does, not a second path. */
    {
      const F = makeModule();
      F.state = F.defaults();
      F.state.tiers = sixGrades();
      eq(F.state.nameBold, "given", "a new document bolds given names");
      const steps = F.history.length;

      F.commit("changed the name bolding", () => { F.state.nameBold = "family"; }, {render:"chart"});
      eq(F.state.nameBold, "family", "the setting changed");
      eq(F.dirtyDoc, true, "and the document is dirty");
      eq(F.history.length, steps + 1, "one undo step, not two");

      F.undo();
      eq(F.state.nameBold, "given", "undo restores the given-name-bold default");
      F.redo();
      eq(F.state.nameBold, "family", "redo returns to family-name-bold");
    }

    /* ---- 6d. it survives a Save and an Open, which is the only durable
       storage this app has. */
    {
      const F = makeModule();
      F.state = F.defaults();
      F.state.tiers = sixGrades();
      F.commit("changed the layout", () => { F.state.layout = "swimlanes"; }, {render:"chart"});
      F.setPrompt("lanes");
      await F.saveDoc(false);
      const written = JSON.parse((F.written[F.written.length - 1] || {}).text || "{}");
      eq(written.layout, "swimlanes", "a swimlanes roster is saved as swimlanes");
      /* What the file STATES is what re-opening reads; the validator half is
         test/import.js, which drives the real door. */
      eq(JSON.parse(JSON.stringify(written)).layout, "swimlanes",
         "and the file itself says so, so re-opening cannot turn it back into a pyramid");
    }

    /* Save's last-line check. Nothing in the app can produce an unsupported
       layout today; this is the guard for the day something can. One grade,
       so this is about the LAYOUT field and not masked by the empty-grades
       refusal §1 already proves. */
    const st = M.defaults();
    st.tiers = sixGrades();
    eq(M.stateLimitProblem(st), null, "a pyramid document is saveable");
    st.layout = "swimlanes";
    eq(M.stateLimitProblem(st), null, "and so is a swimlanes document");
    st.layout = "mind-map";
    check(/layout/.test(M.stateLimitProblem(st) || ""),
          "Save refuses a document whose layout this build cannot draw");
    delete st.layout;
    eq(M.stateLimitProblem(st), null,
       "but a document with no layout at all is not a limit violation — it is a pyramid");
  }

  /* ---------------------------------------------------------- 7. the real roster file opens */

  /* Reads a committed fixture, not a file that may or may not be sitting in the
     project root. The previous version skipped silently when it was absent, so
     28 assertions could vanish from a run with nothing but a note above the
     summary — the same "green while asserting nothing" trap the harness had. */
  {
    let raw = null;
    try{ raw = readFile(here() + "test/fixtures/current.json"); }catch(e){ raw = null; }
    check(!!raw, "test/fixtures/current.json is readable — the real-file check needs it");
    if(raw){
      const M = makeModule();
      /* Read as written. The fixture is in the shape the app saves, so nothing
         normalises it on the way in — which is exactly what makes it worth
         asserting that the shape is complete. */
      const m = JSON.parse(raw);
      check(Array.isArray(m.people) && m.people.length > 0, "real file: it has people");
      check(Array.isArray(m.tiers) && m.tiers.length > 0, "real file: it has grades");
      for(const p of m.people){
        if(p.photo) check(p.pw > 0 && p.ph > 0, "real file: every photo states pixel dimensions");
        else check(p.frame === null || p.frame === undefined, "real file: photo-less people carry no frame");
      }
    }
  }

  /* ---------------------------------------------------------- 7b. commit() and edit() */

  /* Before this existed, roughly a third of the mutation sites called snapshot()
     and the rest changed the document with no way back. These assertions are the
     reason that cannot quietly happen again. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();

    /* --- commit: one discrete change, one history step */
    M.commit("added someone", () => { M.state.people.push(personIn(M, "One")); });
    eq(countOf(M), 1, "commit applies the mutation");
    eq(M.history.length, 1, "commit records exactly one history entry");
    eq(M.dirtyDoc, true, "commit marks the document dirty");
    check(M.canUndo(), "commit leaves something to undo");

    M.commit("added another", () => { M.state.people.push(personIn(M, "Two")); });
    eq(countOf(M), 2, "a second commit applies");
    eq(M.history.length, 2, "a second commit records a second entry");

    M.undo();
    eq(countOf(M), 1, "undo removes the second person");
    M.undo();
    eq(countOf(M), 0, "undo removes the first person");
    check(!M.canUndo(), "there is nothing left to undo");
    M.redo();
    eq(countOf(M), 1, "redo puts the first person back");
    M.redo();
    eq(countOf(M), 2, "redo puts the second person back");
    check(!M.canRedo(), "there is nothing left to redo");
  }

  {
    /* --- edit: one continuous change, one history step however many events */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.state.people.push(personIn(M, ""));
    const p = M.state.people[0];

    const before = M.history.length;
    for(const ch of ["J","Ja","Jan","Jane"]){
      M.edit("name:" + p.id, "renamed", () => { p.name = ch; });
    }
    eq(p.name, "Jane", "every keystroke in a session is applied");
    eq(M.history.length - before, 1, "four keystrokes make one history entry, not four");

    /* The name handler relabels the row after each of those keystrokes, because
       the row is not re-rendered while it is being typed in. That is a DOM
       repair and not a change to the document: an undo step that visibly does
       nothing is worse than none, and one per keystroke would bury the rename. */
    {
      const steps = M.history.length, idx = M.hIndex, open = M.session;
      const name = p.name;
      for(let i = 0; i < 4; i++) M.syncRowIdentity(p);
      eq(M.history.length, steps, "relabelling adds no history entry, however often it runs");
      eq(M.hIndex, idx, "and does not move the undo position");
      eq(p.name, name, "it changes nothing about the person");
      check(M.session === open, "nor does it disturb the typing session it runs inside");

      /* The flags have to be watched from a document nobody has edited yet.
         Checked mid-session they are already set, so a markDirty() in here
         would change nothing observable and the assertion would pass on a
         function that had quietly made the document unsaved. */
      const F = makeModule();
      F.state = F.defaults();
      F.state.tiers = sixGrades();
      F.state.people.push(personIn(F, "Ada"));
      check(F.historyPending === false && F.dirtyDoc === false, "a fresh document starts clean");
      F.syncRowIdentity(F.state.people[0]);
      eq(F.historyPending, false, "relabelling does not open an uncommitted change");
      eq(F.dirtyDoc, false, "nor mark the document as having unsaved work");
      eq(F.history.length, 0, "and records nothing to undo");
    }
    /* the whole rename is still one entry with the relabels interleaved */
    eq(M.history.length - before, 1, "a rename is one history entry, not two");

    M.undo();
    eq(M.state.people[0].name, "", "undo restores the value from before the session, not one character");

    /* a different field is a different session */
    M.redo();
    M.edit("group:" + p.id, "group", () => { M.state.people[0].groupId = "HAM"; });
    eq(M.history.length, 2, "a different field opens its own session");

    /* and so is the same field after the session was closed */
    M.endEdit();
    M.edit("group:" + p.id, "group again", () => { M.state.people[0].groupId = "BER"; });
    eq(M.history.length, 3, "editing the same field after a pause is a new step");
    M.undo();
    eq(M.state.people[0].groupId, "HAM", "the second group edit undoes on its own");
  }

  {
    /* --- a discrete change must close an open session, or the two would merge */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.state.people.push(personIn(M, ""));
    const p = M.state.people[0];

    M.edit("name:" + p.id, "renamed", () => { p.name = "Jane"; });
    check(M.session !== null, "a session is open while typing");
    M.commit("added a grade", () => { M.state.tiers.push({id:"zz", code:"Z", label:"Zed",
      role:"Zed", fill:"green", attach:false, merge:false, align:"center"}); });
    check(M.session === null, "a commit closes the open typing session");

    /* text -> structure -> undo -> redo, the sequence most likely to interleave */
    eq(M.state.tiers.length, 7, "the grade was added");
    M.undo();
    eq(M.state.tiers.length, 6, "undo removes the grade");
    eq(M.state.people[0].name, "Jane", "and leaves the typed name alone");
    M.undo();
    eq(M.state.people[0].name, "", "the next undo reaches the name");
    M.redo();
    eq(M.state.people[0].name, "Jane", "redo restores the name");
    M.redo();
    eq(M.state.tiers.length, 7, "redo restores the grade");
  }

  {
    /* --- a new change after an undo discards the redo branch */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.commit("one",   () => { M.state.people.push(personIn(M, "One")); });
    M.commit("two",   () => { M.state.people.push(personIn(M, "Two")); });
    M.undo();
    check(M.canRedo(), "there is a redo branch after undoing");
    M.commit("three", () => { M.state.people.push(personIn(M, "Three")); });
    check(!M.canRedo(), "a new change discards the redo branch");
    eq(countOf(M), 2, "the new change built on the undone state");
    eq(M.state.people[1].name, "Three", "and it is the new person, not the discarded one");
  }

  {
    /* --- save then edit then undo: the dirty flag must track the document, not
       the history. Undoing back to a saved state still counts as unsaved work,
       because the file on disk and the editor have diverged and converged again
       without the app being able to prove it. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.setPrompt("roster");
    await M.saveDoc(true);
    eq(M.dirtyDoc, false, "saving clears the dirty flag");
    M.commit("added someone", () => { M.state.people.push(personIn(M, "One")); });
    eq(M.dirtyDoc, true, "an edit after saving marks it dirty again");
    M.undo();
    eq(M.dirtyDoc, true, "undoing back to the saved content still reads as unsaved");
    /* and the status icon reports that flag rather than second-guessing it —
       the icons must not tempt anyone into adding a document comparison */
    M.updateDocLabel();
    eq(M.shown.unsaved, true, "and the status icon still shows unsaved, following the flag");
    eq(M.shown.status, "Unsaved changes", "with the status name to match");
  }

  /* ------------------------------------------- 7b1. the Accent hex field

     <input type="color"> is the operating system's dialog: on Windows it offers
     no hex field at all, and on macOS it is behind a tab. For a tool whose job
     is matching one specific brand colour, that could not be the only way in.

     The field is an addition, and everything below is about it being the SAME
     control as the picker rather than a rival to it: one value, one validator,
     one undo step. Driven through the real listeners, so a rule retyped into
     this suite cannot go on passing after the app stops applying it. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const start = M.state.accent;
    M.setColourFields(start, start);

    /* --- a valid hex sets the accent and repaints */
    const renders = M.history.length;
    M.typeHex("#123456");
    eq(M.state.accent, "#123456", "a valid hex typed into the field sets state.accent");
    eq(M.colour.picker, "#123456", "…and the picker moves to it, so the two halves agree");
    check(M.summaries > 0, "…and the ribbon summary refreshes, which is what repaints the swatch");
    eq(M.history.length - renders, 1, "…as one history entry");

    /* --- the leading # is optional, and what is stored is normalised */
    M.endEdit();
    M.typeHex("046a38");
    eq(M.state.accent, "#046A38",
      "a value typed without the leading # is accepted, and stored as upper-case #RRGGBB");
    eq(M.colour.picker, "#046A38", "…and the picker takes the normalised form too");
    /* the field itself is left alone mid-session: normalising under the caret
       moves it. Blur is where it is tidied. */
    eq(M.colour.hex, "046a38", "the field is NOT rewritten while it is being typed in");
    M.hexBlur();
    eq(M.colour.hex, "#046A38", "leaving the field shows the normalised value");
  }

  {
    /* --- nothing incomplete or invalid may reach the document.
       Typing three of six characters must leave the chart alone rather than
       repaint through five wrong colours on the way to the right one. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const start = M.state.accent;
    M.setColourFields(start, start);
    const steps = M.history.length;

    for(const bad of ["", "#", "#0", "#04", "#046", "#046A", "#046A3",
                      "046A3", "#046A3G", "green", "#0123456", "rgb(0,0,0)",
                      "#046A38;--brand:red"]){
      M.typeHex(bad);
      eq(M.state.accent, start, JSON.stringify(bad) + " does not reach state.accent");
    }
    eq(M.history.length, steps,
      "and none of them took a snapshot — an unusable value is not an undo step");
    eq(M.dirtyDoc, false, "nor marked the document dirty");
    eq(M.colour.picker, start, "nor moved the picker");

    /* the validator is the shared one, not a second rule that could drift */
    eq(M.hexFieldValue("046a38"), "#046A38", "hexFieldValue normalises through validColour");
    eq(M.hexFieldValue("#046A3"), null, "…and answers null for anything validColour refuses");
    eq(M.hexFieldValue("  #046a38  "), "#046A38", "…trimming exactly as validColour does");
    eq(M.validColour("#046a38", null), "#046A38",
      "validColour itself is unchanged — the field adds the optional #, nothing else");
  }

  {
    /* --- picking from the swatch updates the field */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.setColourFields(M.state.accent, M.state.accent);
    M.accentPick("#abcdef");
    eq(M.state.accent, "#abcdef", "the picker still writes state.accent");
    eq(M.colour.hex, "#abcdef", "…and the field follows it, so it never shows a stale colour");
  }

  {
    /* --- one typed value is ONE history entry, and one undo restores it.
       This is the file's existing edit() coalescing under the SAME session key
       the picker uses — not a second mechanism. Typing a colour character by
       character is the case that would otherwise cost seven undos. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const start = M.state.accent;
    M.setColourFields(start, start);
    const steps = M.history.length;

    for(const partial of ["#", "#1", "#12", "#123", "#1234", "#12345", "#123456"]){
      M.typeHex(partial);
    }
    eq(M.state.accent, "#123456", "typing a hex one character at a time arrives at the value");
    eq(M.history.length - steps, 1,
      "…and costs exactly one history entry, not one per keystroke");

    M.undo();
    eq(M.state.accent, start, "one undo restores the previous accent in a single step");
    M.redo();
    eq(M.state.accent, "#123456", "and redo puts the typed one back");

    /* Switching from typing to dragging mid-session stays one change: the two
       halves share the session key, which is the whole reason they share it. */
    const M2 = makeModule();
    M2.state = M2.defaults();
    M2.state.tiers = sixGrades();
    const was = M2.state.accent;
    M2.setColourFields(was, was);
    const s2 = M2.history.length;
    M2.typeHex("#123456");
    M2.accentPick("#654321");
    eq(M2.history.length - s2, 1,
      "typing then dragging is still one change — both halves edit under the same key");
    M2.undo();
    eq(M2.state.accent, was, "…and one undo restores what was there before either");
  }

  {
    /* --- the contrast warning still runs on a value set this way.
       The real checkContrast and the real WCAG arithmetic, so this fails if the
       threshold moves or the handler stops calling it. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.state.inkOnColour = "#FFFFFF";
    M.setColourFields(M.state.accent, M.state.accent);

    M.typeHex("#FFFF00");                    // white on yellow: about 1.07:1
    check(M.warn.shown, "a low-contrast accent typed into the field raises the warning");
    check(/on the accent/.test(M.warn.text), "…naming the pair that is hard to read");
    check(/is below the recommended 4\.5:1 contrast/.test(M.warn.text),
      "…and states the shortfall in the redesigned wording, threshold spelled out as a literal here");
    check(M.warn.badge, "…and the badge on the Text command appears with it");
    check(M.contrastRatio("#FFFF00", "#FFFFFF") < M.CONTRAST_MIN,
      "…because the shipped ratio really is below the shipped threshold");

    M.endEdit();
    M.typeHex("#1A2129");                    // white on near-black: about 15:1
    check(!M.warn.shown, "and a readable one clears it again");
    check(!M.warn.badge, "…badge included");
  }

  {
    /* --- this is the chart's accent, not the app's chrome.
       --brand is fixed: the chart colour is the user's and can be anything,
       including one that would make the white chrome text unreadable. Asserted
       as what the handler wrote, so a line reaching for a CSS variable fails
       here rather than in a screenshot. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.setColourFields(M.state.accent, M.state.accent);
    const before = JSON.parse(JSON.stringify(M.state));

    M.typeHex("#FF00FF");
    const after = M.state;
    const changed = Object.keys(after).filter(k =>
      JSON.stringify(after[k]) !== JSON.stringify(before[k]));
    eq(changed.join(","), "accent",
      "typing a hex changes state.accent and nothing else — got: " + changed.join(","));
    check(!("brand" in after) || after.brand === before.brand,
      "the header's brand text is untouched — a different field with a similar name");
  }

  /* ------------------------------------------- 7b1a. the eight curated accents

     Accent is a menu now, and the eight rows in it are the fast route to a
     colour that works. Each writes TWO document fields, because three of the
     eight need black text on them — an accent applied with the previous
     colour's ink is a curated colour that ships an unreadable chart, which is
     the one thing curating a list is for.

     Driven through the real COMMANDS entry and the real checkContrast, so the
     curation is asserted against the shipped WCAG arithmetic rather than a table
     of ratios retyped into this suite. */
  /* Read out of the markup that draws them rather than retyped here. A list
     copied into this suite would go on certifying eight colours as readable
     after the app started shipping different ones — which is the failure this
     block exists to prevent. test/dom.js is where the eight are pinned by name;
     here they are only whatever the menu actually offers. */
  const SWATCHES = (function(){
    const out = [];
    const re = /<button class="accent-swatch"[^>]*data-accent="(#[0-9A-Fa-f]{6})"[^>]*data-ink="(#[0-9A-Fa-f]{6})"[^>]*>[\s\S]*?<\/span>([^<]+)<\/button>/g;
    let m;
    while((m = re.exec(HTML))) out.push([m[1], m[2], m[3].trim()]);
    return out;
  })();
  eq(SWATCHES.length, 8, "the Accent menu ships eight swatches");

  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const start = M.state.accent, startInk = M.state.inkOnColour;
    M.setColourFields(start, start, startInk);

    /* --- both writes, one history entry */
    const steps = M.history.length;
    M.clickSwatch("#FF4F00", "#000000", "International Orange");
    eq(M.state.accent, "#FF4F00", "a swatch sets state.accent");
    eq(M.state.inkOnColour, "#000000", "…and the ink that has to go on it");
    eq(M.history.length - steps, 1,
      "…as ONE history entry covering both — two would leave a step showing one "
      + "colour wearing the other colour's ink");

    /* --- and one undo restores both, in a single step */
    M.undo();
    eq(M.state.accent, start, "one undo restores the previous accent");
    eq(M.state.inkOnColour, startInk, "…and the previous ink, in the same step");
    M.redo();
    eq(M.state.accent, "#FF4F00", "redo puts the colour back");
    eq(M.state.inkOnColour, "#000000", "…and the ink with it");
  }

  {
    /* --- the three controls showing these two values follow. commit()'s
       render:"chart" repaints the chart and not the ribbon, so the swatch has to
       put them back in step itself; undo goes the other way, through renderAll. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.setColourFields(M.state.accent, M.state.accent, M.state.inkOnColour);
    const before = M.summaries;
    M.clickSwatch("#602F6B", "#FFFFFF", "Imperial Purple");
    eq(M.colour.picker, "#602F6B", "the OS picker moves to the swatch's colour");
    eq(M.colour.hex, "#602F6B", "…the hex field shows it");
    eq(M.colour.ink, "#FFFFFF", "…and the Text editor's On accent well shows the ink");
    check(M.summaries > before,
      "…and the ribbon summary refreshes, which is what repaints the face's swatch");
  }

  {
    /* --- none of the eight raises the contrast warning. That is the whole point
       of a curated list: a colour you have to go and fix after choosing it is
       not a shortcut. */
    const M = makeModule();
    for(const s of SWATCHES){
      M.state = M.defaults();
      M.state.tiers = sixGrades();
      M.setColourFields(M.state.accent, M.state.accent, M.state.inkOnColour);
      M.clickSwatch(s[0], s[1], s[2]);
      eq(M.state.accent, s[0], s[2] + " applies " + s[0]);
      eq(M.state.inkOnColour, s[1], "…with " + s[1] + " on it");
      check(!M.warn.shown, s[2] + " raises no contrast warning");
      check(!M.warn.badge, "…nor the badge on the Text command");
      check(M.contrastRatio(s[0], s[1]) >= M.CONTRAST_MIN,
        "…because the shipped ratio really is at or above the shipped threshold — "
        + M.contrastRatio(s[0], s[1]).toFixed(2) + ":1");
    }
    /* The ink is the swatch, not a decoration on it: every one of the eight is
       unreadable with the other ink. A swatch that wrote only the colour would
       hand three of them white text and five of them black. */
    const wrong = SWATCHES.filter(s =>
      M.contrastRatio(s[0], s[1] === "#000000" ? "#FFFFFF" : "#000000") < M.CONTRAST_MIN);
    eq(wrong.length, 8,
      "all eight would fail with the other ink, which is why a swatch writes both");
  }

  {
    /* --- a typed hex is not a swatch. It sets the accent and leaves the ink
       alone: a typed value is the user's own colour, and the text colour that
       goes on it is theirs too — the Text editor is where they said so. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.state.inkOnColour = "#123456";
    M.setColourFields(M.state.accent, M.state.accent, M.state.inkOnColour);
    M.typeHex("#FF4F00");
    eq(M.state.accent, "#FF4F00", "typing a hex sets the accent");
    eq(M.state.inkOnColour, "#123456", "…and leaves state.inkOnColour exactly where it was");
    eq(M.colour.ink, "#123456", "…so the Text editor's well is untouched as well");
  }

  {
    /* --- a swatch is a discrete choice, so two of them are two undo steps, and
       one after a typed value does not swallow it. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.setColourFields(M.state.accent, M.state.accent, M.state.inkOnColour);
    const steps = M.history.length;
    M.clickSwatch("#003153", "#FFFFFF", "Prussian Blue");
    M.clickSwatch("#801818", "#FFFFFF", "Falu Red");
    eq(M.history.length - steps, 2, "two swatches are two undo steps");
    M.undo();
    eq(M.state.accent, "#003153", "…so one undo goes back to the first, not past both");

    const M2 = makeModule();
    M2.state = M2.defaults();
    M2.state.tiers = sixGrades();
    M2.setColourFields(M2.state.accent, M2.state.accent, M2.state.inkOnColour);
    const s2 = M2.history.length;
    M2.typeHex("#123456");
    M2.clickSwatch("#FADA5E", "#000000", "Naples Yellow");
    eq(M2.history.length - s2, 2,
      "a swatch after a typed value is a second step — commit() closes the open "
      + "session rather than joining it");
    M2.undo();
    eq(M2.state.accent, "#123456", "…and one undo returns to what was typed");
  }

  {
    /* --- a button whose pair does not survive validColour changes nothing.
       The values arrive as data attributes, which are strings like any other,
       and this is the same door the Open path judges a roster file's accent at. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const start = M.state.accent, startInk = M.state.inkOnColour;
    M.setColourFields(start, start, startInk);
    const steps = M.history.length;
    for(const pair of [["", "#FFFFFF"], ["#FF4F00", ""], ["red", "#FFFFFF"],
                       ["#FF4F0", "#FFFFFF"], ["#FF4F00", "black"]]){
      M.clickSwatch(pair[0], pair[1], "broken");
    }
    eq(M.state.accent, start, "an unusable pair reaches neither field");
    eq(M.state.inkOnColour, startInk, "…including the half of it that was fine");
    eq(M.history.length, steps, "…and takes no snapshot");
    eq(M.dirtyDoc, false, "…nor marks the document dirty");
  }

  /* ------------------------------------------- 7b2. attach / share is one rule

     merge implies attach, and the first grade can do neither. The four
     transitions are asserted as the USER performs them — through commit(), so
     each is exactly one undo step — because the bug this rule replaces was
     reachable in two clicks and left a grade sharing a band it was not attached
     to, which the renderers have no meaning for. */
  {
    const M = makeModule();
    const links = () => M.state.tiers.map(t => (t.attach ? "A" : "-") + (t.merge ? "S" : "-"));
    const set = (i, act, on) => {
      const t = M.state.tiers[i];
      M.commit(act + " " + t.label, () => {
        if(act === "attach"){ t.attach = on; if(!on) t.merge = false; }
        else t.merge = on;
        M.normalizeGradeLinks(M.state.tiers);
      });
    };

    M.state = M.defaults();
    M.state.tiers = sixGrades();
    /* the shipped default already obeys the rule */
    eq(M.state.tiers[0].attach, false, "the first grade never attaches");
    eq(M.state.tiers[0].merge,  false, "and never shares");
    const a = M.state.tiers.findIndex(t => t.code === "A");
    eq(M.state.tiers[a].merge,  false, "defaults: A keeps its own band below P");
    eq(M.state.tiers[a].attach, true,  "and defaults: A attaches that band to P");
    const c = M.state.tiers.findIndex(t => t.code === "C");
    eq(M.state.tiers[c].merge,  true,  "defaults: C shares SC's band");
    eq(M.state.tiers[c].attach, true,  "and the rule gives shared C attach to match");

    /* --- the four transitions, on a grade that starts detached --- */
    const i = M.state.tiers.findIndex(t => t.code === "D");
    M.state.tiers[i].attach = false; M.state.tiers[i].merge = false;

    set(i, "attach", true);
    eq(links()[i], "A-", "Attach on: attach only, share untouched");

    set(i, "merge", true);
    eq(links()[i], "AS", "Share on: sets share AND attach");
    const stepsAfterShare = M.hIndex;

    set(i, "merge", false);
    eq(links()[i], "A-", "Share off: clears share, LEAVES attach");

    set(i, "merge", true);                     // back to shared for the next case
    set(i, "attach", false);
    eq(links()[i], "--", "Attach off: clears attach AND share");

    /* --- each transition is ONE undo step, not two --- */
    M.undo();
    eq(links()[i], "AS", "undo restores both flags in one step");
    M.redo();
    eq(links()[i], "--", "and redo takes both away again");

    /* --- turning Share on from nothing is also ONE step ---
       On a fresh module, so the count is not capped by HISTORY_MAX after the
       transitions above. */
    {
      const F = makeModule();
      F.state = F.defaults();
      F.state.tiers = sixGrades();
      const j = 3;
      F.state.tiers[j].attach = false; F.state.tiers[j].merge = false;
      const before = F.hIndex;
      F.commit("share", () => {
        F.state.tiers[j].merge = true;
        F.normalizeGradeLinks(F.state.tiers);
      });
      eq(F.hIndex, before + 1, "sharing from a detached grade is a single history entry");
      eq(F.state.tiers[j].attach, true,  "and it lands attached");
      eq(F.state.tiers[j].merge,  true,  "and shared");
      F.undo();
      eq(F.state.tiers[j].attach, false, "one undo puts attach back");
      eq(F.state.tiers[j].merge,  false, "and share with it");
    }

    /* --- reordering: whoever becomes first cannot keep either flag --- */
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const share = M.state.tiers.findIndex(t => t.merge);
    check(share > 1, "the shared grade starts below the top");
    /* move it up until it is first, the way the panel's Left button does */
    for(let k = share; k > 0; k--){
      const j = k;
      M.commit("moved", () => {
        const t = M.state.tiers.splice(j, 1)[0];
        M.state.tiers.splice(j - 1, 0, t);
        M.normalizeGradeLinks(M.state.tiers);
      });
    }
    eq(links()[0], "--", "a grade moved to the top loses attach and share");
    /* and the grade now second still refers to whatever is above it */
    check(M.state.tiers.length > 1, "there is still a grade below it");
    eq(typeof M.state.tiers[1].merge, "boolean", "the grade below keeps a well-formed share flag");

    /* --- drag-and-drop uses the same rule, in one undoable move --- */
    {
      const F = makeModule();
      F.state = F.defaults();
      F.state.tiers = sixGrades();
      const original = F.state.tiers.map(t => t.id);
      const firstId = original[0], lastId = original[original.length - 1];
      const person = personIn(F, "Stays Assigned");
      person.tierId = lastId;
      F.state.people.push(person);
      const before = F.hIndex;
      eq(F.reorderGrade(lastId, firstId, false), true,
        "dropping the last grade before the first performs a move");
      eq(F.hIndex, before + 1, "the drag is exactly one history entry");
      eq(F.state.tiers[0].id, lastId, "the dropped grade lands in the requested slot");
      eq(F.state.tiers[0].attach, false, "a grade dragged to the top loses attach");
      eq(F.state.tiers[0].merge, false, "and loses share");
      eq(F.state.people[0].tierId, lastId,
        "people stay assigned by grade id while their grade moves");
      F.undo();
      eq(F.state.tiers.map(t => t.id).join(","), original.join(","),
        "one undo restores the complete original grade order");
      F.redo();
      eq(F.state.tiers[0].id, lastId, "and redo reapplies the drag");

      const secondId = F.state.tiers[1].id;
      const noOpHistory = F.hIndex;
      eq(F.reorderGrade(secondId, lastId, true), false,
        "dropping a grade back into its current slot is a no-op");
      eq(F.hIndex, noOpHistory, "a no-op drop creates no undo entry");
      eq(F.reorderGrade("missing", lastId, false), false,
        "a stale dragged id cannot reorder the document");
    }

    /* --- deleting the top grade promotes the next one --- */
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.state.tiers[1].attach = true; M.state.tiers[1].merge = true;
    M.commit("removed", () => {
      M.state.tiers.splice(0, 1);
      M.normalizeGradeLinks(M.state.tiers);
    });
    eq(links()[0], "--", "deleting the top grade clears the promoted grade's flags");

    /* --- the helper itself is idempotent --- */
    const twice = M.defaults();
    M.normalizeGradeLinks(twice.tiers);
    const once = JSON.stringify(twice.tiers);
    M.normalizeGradeLinks(twice.tiers);
    eq(JSON.stringify(twice.tiers), once, "normalizeGradeLinks is idempotent");
    check(stepsAfterShare >= 0, "the history advanced through these transitions");
  }

  /* ---------------------------------------------------------- 7c. photos are not copied per step */

  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();

    const A = "data:image/jpeg;base64,AAAA";
    const B = "data:image/jpeg;base64,BBBB";

    /* two people sharing one picture, one with a different one */
    const p1 = personIn(M, "Shared One"); p1.photo = A; p1.pw = 400; p1.ph = 300;
    const p2 = personIn(M, "Shared Two"); p2.photo = A; p2.pw = 400; p2.ph = 300;
    const p3 = personIn(M, "Other");      p3.photo = B; p3.pw = 400; p3.ph = 300;
    M.state.people.push(p1, p2, p3);

    /* twenty edits that never touch an image */
    for(let i = 0; i < 20; i++){
      M.commit("edit " + i, () => { M.state.title = "Title " + i; });
    }

    eq(M.history.length, 15, "history is capped at HISTORY_MAX steps");
    eq(M.photoStore.size, 2,
       "twenty steps over three photos hold two entries — one per distinct image");

    /* the live document still carries real bytes; only history is by reference */
    eq(M.state.people[0].photo, A, "the live state keeps the actual data URL");
    check(M.state.people[0].photoId === undefined,
          "the live state carries no store id — that is a history-only concept");

    /* a round trip through the boundary is lossless */
    M.state.showGradeCode = false;
    M.state.showGradeName = true;
    M.state.nameLabelPosition = "next";
    M.state.showPersonName = false;
    M.state.showPersonGrade = false;
    M.state.showPersonGroup = true;
    const packed = M.packState(M.state);
    check(packed.people.every(p => p.photo === null), "a packed entry holds no photo bytes");
    check(packed.people.every(p => typeof p.photoId === "string"), "a packed entry holds ids");
    eq(packed.people[0].photoId, packed.people[1].photoId,
       "two people with the same picture share one id");
    check(packed.people[0].photoId !== packed.people[2].photoId,
       "a different picture gets a different id");

    const back = M.unpackState(packed);
    eq(back.people[0].photo, A, "unpacking restores the first photo");
    eq(back.people[1].photo, A, "unpacking restores the shared photo");
    eq(back.people[2].photo, B, "unpacking restores the other photo");
    check(back.people.every(p => p.photoId === undefined),
       "unpacking leaves no store id behind in live state");
    eq(JSON.stringify(back), JSON.stringify(M.state), "pack/unpack is a lossless round trip");
    /* document-level settings cross the boundary untouched — packState copies the
       state wholesale, which is what keeps a new property like this from having
       to be added to a whitelist to survive an undo */
    eq(packed.layout, "pyramid", "the layout crosses into history");
    eq(back.layout, "pyramid", "and comes back out of it");
    eq(packed.showGradeCode, false, "the hidden-code choice crosses into history");
    eq(packed.showGradeName, true, "the shown-name choice crosses into history");
    eq(back.showGradeCode, false, "and the hidden-code choice comes back out");
    eq(back.showGradeName, true, "and the shown-name choice comes back out");
    eq(packed.nameLabelPosition, "next", "the name-label position crosses into history");
    eq(back.nameLabelPosition, "next", "and the name-label position comes back out");
    eq(packed.showPersonName, false, "the hidden person-name choice crosses into history");
    eq(packed.showPersonGrade, false, "the hidden person-grade choice crosses into history");
    eq(packed.showPersonGroup, true, "the shown person-group choice crosses into history");
    eq(back.showPersonName, false, "and the hidden person-name choice comes back out");
    eq(back.showPersonGrade, false, "and the hidden person-grade choice comes back out");
    eq(back.showPersonGroup, true, "and the shown person-group choice comes back out");

    /* undoing across a photo change must bring the picture back */
    M.commit("removed a photo", () => {
      M.state.people[2].photo = null; M.state.people[2].pw = 0;
      M.state.people[2].ph = 0; M.state.people[2].frame = null;
    });
    eq(M.state.people[2].photo, null, "the photo was removed");
    M.undo();
    eq(M.state.people[2].photo, B, "undo restores the actual photo bytes, not just an id");
  }

  {
    /* --- the store must not grow forever: entries no history step references go */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const p = personIn(M, "Serial"); p.photo = "data:image/jpeg;base64,AAAA";
    p.pw = 10; p.ph = 10;
    M.state.people.push(p);

    /* replace the picture more times than the history is deep */
    for(let i = 0; i < 25; i++){
      M.commit("replaced " + i, () => { M.state.people[0].photo = "data:image/jpeg;base64,X" + i; });
    }
    check(M.photoStore.size <= 17,
      "evicted history steps release their photos — store holds " + M.photoStore.size
      + ", expected no more than the 15-step history plus a little slack");

    /* opening another document drops the previous one's photos entirely */
    M.resetPerRoster();
    eq(M.photoStore.size, 0, "a new document starts with an empty photo store");
  }

  /* ------------------------------------------------------- 7d. dialogs, not confirm() */

  /* confirm() and prompt() are gone. They blocked the thread, could not be
     labelled, and in some browsers can be suppressed entirely — a user who
     ticks "don't show me these again" silently loses the unsaved-work guard.
     What matters here is that the guard still guards. */
  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();

    M.dirtyDoc = false;
    const before = M.asked.length;
    eq(await M.confirmDiscard("do a thing"), true, "a clean document is not interrupted");
    eq(M.asked.length, before, "and raises no dialog at all");

    M.dirtyDoc = true;
    M.setConfirm(false);
    eq(await M.confirmDiscard("open another roster"), false, "a dirty document asks, and No means No");
    const q = M.asked[M.asked.length - 1] || {};
    eq(q.kind, "confirm", "it is a confirm dialog");
    check(/unsaved/i.test(q.title || ""), "the dialog says what it is about — got " + JSON.stringify(q.title));
    check((q.message || []).join(" ").indexOf("open another roster") >= 0,
      "the message names the action that would lose the work");
    check(q.label && q.label !== "OK",
      'the confirming button has a real verb, not "OK" — got ' + JSON.stringify(q.label));

    /* New and Open must both go through it, and both must obey a refusal */
    M.setConfirm(false);
    M.state.people.push(personIn(M, "Still Here"));
    const n = countOf(M);
    await M.newDoc();
    eq(countOf(M), n, "a refused New leaves the roster alone");
    const picked = M.picked;
    await M.openDoc();
    eq(M.picked, picked, "a refused Open never reaches the file picker");

    M.setConfirm(true);
    await M.openDoc();
    eq(M.picked, picked + 1, "a confirmed Open opens the picker");
  }

  {
    /* Save As uses a text dialog; cancelling it must change nothing at all */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.docName = "keep-me"; M.dirtyDoc = true;

    M.setPrompt(null);
    eq(await M.saveDoc(true), false, "a cancelled Save As reports that it did not save");
    eq(M.downloads.length, 0, "and writes no file");
    eq(M.docName, "keep-me", "and leaves the document name alone");
    eq(M.dirtyDoc, true, "and leaves the work marked unsaved");

    const q = M.asked[M.asked.length - 1] || {};
    eq(q.kind, "text", "Save As raises a text dialog");
    eq(q.value, "keep-me", "pre-filled with the current name");
  }

  /* ------------------------------------------- 8. async results and a moving document */

  /* Decoding an image is slow enough to outlive the document it was started
     for. Everything below is the same shape: begin an import, change the
     document while a decode is still pending, then let it finish. The result
     must land nowhere — and "nowhere" has to include the undo stack and the
     dirty flag, not just the roster, because an entry saying "2 people added"
     above a roster where nothing appeared is its own kind of data loss. */

  {
    /* the happy path first: with nothing moving, an import still imports.
       Without this, every assertion below would also pass if the guard simply
       refused everything. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.answerImportWith(M.state.tiers[0].id);

    const run = M.addFiles([file("Ada_Lovelace.jpg"), file("Alan_Turing.jpg")]);
    await settle(M);
    await run;

    eq(countOf(M), 2, "an undisturbed batch adds its people");
    eq(M.history.length, 1, "as one undo step");
    eq(M.history[0].label, "2 people added", "labelled with what happened");
    eq(M.dirtyDoc, true, "and the document is dirty, because it changed");
    eq(M.alerts.length, 0, "nothing was reported as a problem");
  }

  {
    /* New, halfway through the batch */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.answerImportWith(M.state.tiers[0].id);
    const gen = M.docGen;

    const run = M.addFiles([file("Ada_Lovelace.jpg"), file("Alan_Turing.jpg")]);
    await tick();
    eq(M.decodes.length, 1, "the batch is mid-decode");

    M.dirtyDoc = false;                 // so New does not stop to ask
    await M.newDoc();
    check(M.docGen !== gen, "New advances the document generation");

    await settle(M);
    await run;

    eq(countOf(M), 0, "the finished batch does not land in the new roster");
    eq(M.history.length, 0, "it leaves no undo step behind");
    eq(M.dirtyDoc, false, "and does not mark the untouched document dirty");
    eq(M.alerts.length, 1, "the user is told, rather than left wondering");
    check(/not imported/.test(M.alerts[0]) && /document changed/.test(M.alerts[0]),
      "and told why — got " + JSON.stringify(M.alerts[0]));
  }

  {
    /* Open, halfway through the batch — the same replacement by a different
       route, so it goes through resetPerRoster() the way #jsonPick does */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.answerImportWith(M.state.tiers[0].id);
    const gen = M.docGen;

    const run = M.addFiles([file("Ada_Lovelace.jpg")]);
    await tick();

    M.state = M.defaults();             // what a successful Open does
    M.state.tiers = sixGrades();
    M.docName = "someone-elses"; M.dirtyDoc = false;
    M.resetPerRoster();
    check(M.docGen !== gen, "a successful Open advances the generation");

    await settle(M);
    await run;

    eq(countOf(M), 0, "the batch does not land in the roster that was opened");
    eq(M.history.length, 0, "and adds nothing to its fresh history");
    eq(M.dirtyDoc, false, "the newly opened document is still unmodified");
  }

  {
    /* Replacing every grade stays inside the same document, so this is the case
       the generation exists to cover deliberately rather than incidentally. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.answerImportWith(M.state.tiers[0].id);

    const tier = M.state.tiers[0].id;
    const run = M.addFiles([file("Ada_Lovelace.jpg")]);
    await tick();

    M.setConfirm(true);
    await M.applyTemplate("big4-green");

    /* Undo brings the original ids back. The tier check would therefore accept
       the old batch; only the generation still proves it belongs to the
       structure that was intentionally replaced. */
    M.undo();
    eq(M.state.tiers[0].id, tier,
      "undoing applyTemplate brings back the batch's destination id");
    const steps = M.history.length;
    M.dirtyDoc = false;

    await settle(M);
    await run;

    eq(countOf(M), 0, "a batch decoding across an applied template does not land");
    eq(M.history.length, steps, "and adds no undo step of its own");
    eq(M.dirtyDoc, false, "and does not mark the document dirty");
    check(/document changed/.test(M.alerts[0] || ""), "the reason names the document change");
  }

  {
    /* Clear roster is the case with no second line of defence at all. It keeps
       every grade, so the batch's destination still exists and staleWrite's
       tierId test is satisfied; the people it would create never existed, so
       the identity test has nothing to say about them either. The generation is
       the only thing standing between a cleared roster and a batch of new
       people appearing in it a second later. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.state.people.push(personIn(M, "Grace Hopper"));
    const tier = M.state.tiers[0].id;
    M.answerImportWith(tier);

    const run = M.addFiles([file("Ada_Lovelace.jpg")]);
    await tick();

    M.setConfirm(true);
    await M.commands.clearRoster();
    /* Read through a default, not off the array: a mutation that made this
       command take the grades with it would throw here and abandon everything
       below, which reads in a report exactly like coverage. */
    eq((M.state.tiers[0] || {}).id, tier,
      "clearing the roster leaves the batch's destination grade standing");
    const steps = M.history.length;
    M.dirtyDoc = false;

    await settle(M);
    await run;

    eq(countOf(M), 0, "a batch decoding across Clear roster does not land");
    eq(M.history.length, steps, "and adds no undo step of its own");
    eq(M.dirtyDoc, false, "and does not mark the document dirty");
    check(/document changed/.test(M.alerts[0] || ""), "the reason names the document change");
  }

  /* All whole-collection actions are undoable, so the order matters: advancing
     the generation after commit would leave a window where an old photo batch
     could still land. applyTemplate is a standalone function, not a COMMANDS
     entry, so it is read out on its own rather than through the cmd loop. */
  {
    const src = /async function applyTemplate\(id\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!src, "applyTemplate is where it is expected to be");
    if(src){
      const g = src[0].indexOf("newGeneration()");
      const c = src[0].indexOf("commit(");
      check(g >= 0, "applyTemplate advances the document generation");
      check(g >= 0 && c >= 0 && g < c, "and does so before applyTemplate commits the change");
    }
  }
  for(const cmd of ["clearGrades", "clearRoster"]){
    const src = new RegExp(cmd + ":\\s*async\\s*\\(\\)\\s*=>\\s*\\{[\\s\\S]*?\\n  \\},").exec(SCRIPT);
    check(!!src, "COMMANDS." + cmd + " is where it is expected to be");
    if(src){
      const g = src[0].indexOf("newGeneration()");
      const c = src[0].indexOf("commit(");
      check(g >= 0, cmd + " advances the document generation");
      check(g >= 0 && c >= 0 && g < c, "and does so before " + cmd + " commits the change");
    }
  }

  {
    /* the destination grade is deleted while the batch decodes */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const doomed = M.state.tiers[0].id;
    M.answerImportWith(doomed);

    const run = M.addFiles([file("Ada_Lovelace.jpg")]);
    await tick();

    M.commit("removed a grade", () => {
      M.state.tiers = M.state.tiers.filter(t => t.id !== doomed);
    });
    const steps = M.history.length;

    await settle(M);
    await run;

    eq(countOf(M), 0, "a new person is not filed under a grade that no longer exists");
    eq(M.history.length, steps, "and no undo step is invented for it");
    check(/grade it was going into no longer exists/.test(M.alerts[0] || ""),
      "the message names the missing grade as the reason — got " + JSON.stringify(M.alerts[0]));
  }

  {
    /* ...but the grade only matters when a new person needs one. A batch that
       is entirely photos for people who already exist must not be thrown away
       because an unrelated grade was deleted. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const doomed = M.state.tiers[0].id;
    M.answerImportWith(doomed);
    const ada = personIn(M, "Ada Lovelace");
    M.state.people.push(ada);

    const run = M.addFiles([file("Ada_Lovelace.jpg")]);
    await tick();
    M.state.tiers = M.state.tiers.filter(t => t.id !== doomed);

    await settle(M);
    await run;

    eq(ada.photo, IMG.data, "a photo for an existing person still attaches");
    eq(M.history.length, 1, "as a normal undo step");
    eq(M.alerts.length, 0, "with nothing reported as discarded");
  }

  {
    /* one person leaves the roster mid-batch; the rest of the batch is fine */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.answerImportWith(M.state.tiers[0].id);
    const ada  = personIn(M, "Ada Lovelace");
    const alan = personIn(M, "Alan Turing");
    M.state.people.push(ada, alan);

    const run = M.addFiles([file("Ada_Lovelace.jpg"), file("Alan_Turing.jpg")]);
    await tick();
    M.state.people = M.state.people.filter(p => p !== ada);

    await settle(M);
    await run;

    eq(ada.photo, null, "the departed person's photo is dropped");
    eq(alan.photo, IMG.data, "and the other one still lands");
    eq(M.history.length, 1, "one undo step, for the part that happened");
    eq(M.history[0].label, "1 photo attached",
      "labelled with what happened, not with what was attempted");
    check(/1 photo was discarded/.test(M.alerts.join(" ")),
      "the dropped photo is reported — got " + JSON.stringify(M.alerts));
  }

  {
    /* Replace photo: the happy path, so the guard below is proved to be
       discriminating rather than simply broken */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const ada = personIn(M, "Ada Lovelace");
    M.state.people.push(ada);
    M.setSwapId(ada.id);

    const run = M.swapChange({target:{files:[file("new.jpg")], value:""}});
    await settle(M);
    await run;

    eq(ada.photo, IMG.data, "an undisturbed replacement replaces the photo");
    eq(M.history.length, 1, "as one undo step");
    eq(M.dirtyDoc, true, "and the document is dirty");
  }

  {
    /* Replace photo: the person is deleted while it decodes */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const ada = personIn(M, "Ada Lovelace");
    M.state.people.push(ada);
    M.setSwapId(ada.id);

    const run = M.swapChange({target:{files:[file("new.jpg")], value:""}});
    await tick();
    M.state.people = M.state.people.filter(p => p !== ada);
    M.dirtyDoc = false;

    await settle(M);
    await run;

    eq(ada.photo, null, "nothing is written onto the orphaned person");
    eq(M.history.length, 0, "no undo step for a change with no visible effect");
    eq(M.dirtyDoc, false, "and the document is not marked dirty");
    check(/no longer in the roster/.test(M.alerts[0] || ""),
      "the reason names the missing person — got " + JSON.stringify(M.alerts[0]));
  }

  {
    /* Replace photo: the whole document is replaced while it decodes */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const ada = personIn(M, "Ada Lovelace");
    M.state.people.push(ada);
    M.setSwapId(ada.id);

    const run = M.swapChange({target:{files:[file("new.jpg")], value:""}});
    await tick();
    M.dirtyDoc = false;
    await M.newDoc();

    await settle(M);
    await run;

    eq(ada.photo, null, "the photo does not follow the person into a new document");
    eq(M.history.length, 0, "and leaves the new document's history empty");
    eq(M.dirtyDoc, false, "and the new document clean");
    check(/document changed/.test(M.alerts[0] || ""),
      "reported as a document change — got " + JSON.stringify(M.alerts[0]));
  }

  {
    /* Replace photo across an undo. The document is the same one, and a person
       with the same id is still there — but it is a different object, because
       undo restores a copy. Writing into the captured one would change nothing
       anybody can see, while still costing an undo step and a dirty flag. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const ada = personIn(M, "Ada Lovelace");
    M.state.people.push(ada);
    M.setSwapId(ada.id);

    const run = M.swapChange({target:{files:[file("new.jpg")], value:""}});
    await tick();

    M.state = JSON.parse(JSON.stringify(M.state));    // what undo() hands back
    const clone = M.state.people.find(p => p.id === ada.id);
    check(!!clone && clone !== ada, "the roster now holds a copy, not the captured object");
    M.dirtyDoc = false;

    await settle(M);
    await run;

    eq(clone.photo, null, "the replacement does not land on the restored person");
    eq(ada.photo, null, "nor on the object it captured");
    eq(M.history.length, 0, "and buys no undo step");
    eq(M.dirtyDoc, false, "and leaves the document clean");
  }

  {
    /* A generation check must not be a generation *guess*: an ordinary edit is
       not a new document, and an import spanning one has to complete. */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    M.answerImportWith(M.state.tiers[0].id);
    const gen = M.docGen;

    const run = M.addFiles([file("Ada_Lovelace.jpg")]);
    await tick();
    M.commit("renamed the chart", () => { M.state.title = "Something else"; });
    eq(M.docGen, gen, "an ordinary edit does not advance the generation");

    await settle(M);
    await run;
    eq(countOf(M), 1, "so an import that spans an edit still lands");
  }

  {
    /* staleWrite() itself, at the boundaries — it is the single decision point
       and every caller trusts its null to mean "go ahead" */
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const t = M.state.tiers[0].id;
    const ada = personIn(M, "Ada Lovelace");
    M.state.people.push(ada);

    eq(M.staleWrite(M.docGen, null), null, "same generation, nothing else asked: allowed");
    eq(M.staleWrite(M.docGen, {tierId:t, person:ada}), null, "targets that still exist: allowed");
    check(M.staleWrite(M.docGen - 1, null), "an older generation is refused");
    check(M.staleWrite(M.docGen, {tierId:"nope"}), "a missing grade is refused");
    check(M.staleWrite(M.docGen, {person: personIn(M, "Ghost")}),
      "a person who is not in the roster is refused");
    /* the generation is checked first: a stale document is the more informative
       reason, and re-checking ids inside a document that is gone is meaningless */
    check(/document changed/.test(M.staleWrite(M.docGen - 1, {tierId:"nope"})),
      "the document check comes before the target checks");
  }

/* ---------------------------------------------------------- 9. no storage left behind */

  {
    /* comments legitimately explain why the storage layer was removed, so this
       has to look at code only or the explanation trips its own check */
    const CODE = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
    const dead = ["sget","sset","sdel","storageLive","persistActive","switchRoster",
                  "createRoster","deleteRoster","renameRoster","renderRosterBar",
                  "K_INDEX","K_ACTIVE","K_ROSTER","teamchart:index","teamchart:roster"];
    for(const name of dead){
      check(!CODE.includes(name), "the storage layer is fully gone: no " + name);
    }
    check(!/window\.storage/.test(CODE), "nothing reaches for window.storage");
    /* migrate() does not exist, for its own reasons — see section 6. What
       must remain is the door: parseAndValidateRoster is the one way a
       roster file comes in. */
    check(!/function migrate\(/.test(SCRIPT), "no migrate() is left behind");
    check(/function parseAndValidateRoster\(/.test(SCRIPT),
      "and parseAndValidateRoster is still the one way a roster file comes in");
  }

/* ---------------------------------------------------------- 9b. the roster panel
   toggle is pure UI state

   toggleRoster is a document-agnostic view preference: no commit(), no
   edit(), no snapshot, no dirty flag, and nothing New or Open would need to
   reset. Read the handler's own source rather than trust the surrounding
   comment — a comment saying "no commit" is not evidence that the function
   agrees with it. */
  {
    const fn = /function toggleRoster\(\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!fn, "toggleRoster has one definition, readable on its own");
    if(fn){
      check(!/\bcommit\(/.test(fn[0]), "toggleRoster calls no commit() — it is not a document change");
      check(!/\bedit\(/.test(fn[0]), "toggleRoster calls no edit() either");
      check(/classList\.toggle\("roster-hidden"\)/.test(fn[0]),
        "it flips a body class — roster-hidden — which is the one truth CSS reads "
        + "for panel-vs-rail visibility at every width");
    }

    /* The verb-tracking half: setCommandDisabled only captures
       dataset.enabledTitle the FIRST time a button passes through it, then
       hands that same captured string back on every later re-enable. If the
       toggle's own sync only ever wrote button.title, a re-enable after the
       verb had changed (Hide -> Show, or back) would restore whatever verb was
       live at boot instead of the current one — a stale tooltip that looks
       right until the state has actually flipped at least once. */
    const sync = /function syncRosterToggle\(\)\{[\s\S]*?\n\}/.exec(SCRIPT);
    check(!!sync, "the roster toggle has one synchronizer for its pressed state and tooltip");
    if(sync){
      check(/dataset\.enabledTitle\s*=/.test(sync[0]),
        "syncRosterToggle writes dataset.enabledTitle itself, not just the live title — "
        + "or a later setCommandDisabled re-enable restores a stale verb from boot");
      check(/aria-pressed/.test(sync[0]),
        "and it re-reads the pressed state onto every toggleRoster button");
      /* The panel's own close button (test/dom.js §4k3) is a plain close
         affordance and ships no aria-pressed in markup — writing the attribute
         unconditionally would announce it as a permanently-pressed toggle. The
         guard has to gate the write itself, not just exist somewhere nearby. */
      check(/if\(b\.hasAttribute\("aria-pressed"\)\)\s*b\.setAttribute\("aria-pressed"/.test(sync[0]),
        "…but only onto buttons that already carry aria-pressed in markup — "
        + "the panel's close button must not be handed the attribute here");
    }
  }

/* ---------------------------------------------------------- 10. two Opens at once

   Opening a roster is asynchronous twice over: the file is read, then every
   photo in it is decoded before anything is adopted. Two Opens can therefore be
   in flight together, and the one that finishes first is whichever has fewer
   photos — not whichever the user asked for last. Without a guard, picking a
   30-photo roster, changing your mind and picking a small one leaves the small
   one on screen for a moment and then replaces it with the roster that was
   rejected.

   The rule is simply "the last file picked wins", and these prove it holds in
   both orders. */

  {
    const M = makeModule();
    const opened = n => ({tiers:[{id:"t" + n, code:"P", label:"P", role:"P",
                                  fill:"green", attach:false, merge:false, align:"center"}],
                          people:[{id:"p" + n, name:"Person " + n, tierId:"t" + n,
                                   groupId:null, role:"", photo:null, pw:0, ph:0, frame:null}],
                          title:"Roster " + n});
    const done = (o, st) => o.res({ok:true, state:st, repaired:[]});

    /* -------- the undisturbed case first: one Open, and it lands */
    {
      const before = M.docGen;
      const A = opened("A");
      M.pick("alpha.json", "{A}");
      eq(M.opens.length, 1, "picking a file starts one open");
      check(M.state !== A, "and adopts nothing before it has finished");
      check(M.opening[M.opening.length - 1].indexOf("alpha.json") >= 0,
        "the status bar names the file being opened — got "
        + JSON.stringify(M.opening[M.opening.length - 1]));

      done(M.opens.shift(), A);
      await tick();
      check(M.state === A, "when it finishes, the roster is adopted");
      eq(M.docName, "alpha", "and the document takes the file's name");
      eq(M.dirtyDoc, false, "a freshly opened document is not dirty");
      eq(M.docGen, before + 1, "opening a different roster advances the generation");
      eq(M.opening[M.opening.length - 1], "", "and the opening status is cleared");
      check(M.toasts.some(t => /Opened alpha\.json/.test(t)), "the open is reported");
      /* The adoption repaints through renderAll(), which is not in this module
         — so drive the label the way renderAll would and check what it shows.
         A just-opened file is saved by definition: it came off disk. */
      M.updateDocLabel();
      eq(M.shown.name, "alpha", "the status shows the opened file's name");
      eq(M.shown.saved, true, "and the saved icon");
      eq(M.shown.unsaved, false, "with the unsaved one hidden");
      eq(M.shown.status, "Saved", "and the Saved status name");
    }

    /* -------- reverse order: the second file finishes first */
    {
      const A = opened("A2"), B = opened("B2");
      M.pick("big.json", "{A}");        // many photos, slow
      M.pick("small.json", "{B}");      // few photos, fast
      eq(M.opens.length, 2, "both opens are in flight");
      const [slow, fast] = M.opens.splice(0, 2);

      done(fast, B);
      await tick();
      check(M.state === B, "the file picked last is adopted when it finishes first");
      eq(M.docName, "small", "and names the document");

      const gen = M.docGen, toasts = M.toasts.length, hist = M.history.length;
      done(slow, A);
      await tick();
      check(M.state === B, "the earlier open does NOT overwrite it when it finishes late");
      eq(M.docName, "small", "and does not rename the document");
      eq(M.docGen, gen, "a discarded open does not advance the generation");
      eq(M.history.length, hist, "and leaves no history entry");
      eq(M.dirtyDoc, false, "and does not mark the document dirty");
      eq(M.toasts.length, toasts, "and says nothing — the user has already moved on");
    }

    /* -------- forward order: the first file finishes first, and still loses */
    {
      const A = opened("A3"), B = opened("B3");
      const was = M.state;
      M.pick("first.json", "{A}");
      M.pick("second.json", "{B}");
      const [first, second] = M.opens.splice(0, 2);

      done(first, A);
      await tick();
      check(M.state === was, "an open superseded by a later pick is dropped even when it wins the race");
      eq(M.docName, "small", "the document is untouched by it");

      done(second, B);
      await tick();
      check(M.state === B, "and the file picked last is adopted whenever it arrives");
      eq(M.docName, "second", "with its name");
    }

    /* -------- a superseded open must not clear the current one's status */
    {
      const A = opened("A4"), B = opened("B4");
      M.pick("stale.json", "{A}");
      M.pick("current.json", "{B}");
      const [stale, current] = M.opens.splice(0, 2);

      done(stale, A);
      await tick();
      const shown = M.opening[M.opening.length - 1];
      check(shown.indexOf("current.json") >= 0,
        "the status bar still names the open that is actually running — got "
        + JSON.stringify(shown));

      /* nor may it report its own failure over the top of a live open */
      const alerts = M.alerts.length;
      done(current, B);
      await tick();
      eq(M.alerts.length, alerts, "a superseded open raises no alert of its own");
      eq(M.opening[M.opening.length - 1], "", "and the running one clears the status when it lands");
    }

    /* -------- a refused file leaves the open document exactly as it was */
    {
      const was = M.state, name = M.docName;
      M.dirtyDoc = true;
      M.pick("junk.json", "{oh dear");
      M.opens.shift().res({ok:false, reason:"the file is not valid JSON"});
      await tick();
      check(M.state === was, "a refused roster does not replace the open one");
      eq(M.docName, name, "and does not rename it");
      eq(M.dirtyDoc, true, "and does not clear its unsaved-changes flag");
      check(M.alerts.some(a => /not valid JSON/.test(a)),
        "the refusal is reported, with the reason — got " + JSON.stringify(M.alerts.slice(-1)));
      eq(M.opening[M.opening.length - 1], "", "and the opening status is cleared");
      M.dirtyDoc = false;
    }

    /* -------- a decode that throws is a refusal, not an unhandled rejection */
    {
      const was = M.state;
      M.pick("throws.json", "{A}");
      M.opens.shift().rej(new Error("decoder exploded"));
      await tick();
      check(M.state === was, "an open that throws leaves the document alone");
      check(M.alerts.some(a => /could not be checked/.test(a)),
        "and says so — got " + JSON.stringify(M.alerts.slice(-1)));
      eq(M.opening[M.opening.length - 1], "", "and clears the status");
    }

    /* -------- and a file that cannot be read at all */
    {
      const was = M.state, opens = M.opens.length;
      M.setReadFails(true);
      M.pick("unreadable.json", "{A}");
      M.setReadFails(false);
      await tick();
      eq(M.opens.length, opens, "a file that cannot be read never reaches the validator");
      check(M.state === was, "and leaves the document alone");
      check(M.alerts.some(a => /could not be read from disk/.test(a)), "and is reported");
      eq(M.opening[M.opening.length - 1], "", "and clears the status");
    }

/* ---------------------------------------------------------- 11. a read that
   fails after a newer Open has started

   POST-AUDIT REGRESSION. The read-failure handler cleared the status only when
   its sequence was still current — and then alerted unconditionally. So
   picking a file on a slow or disconnected volume, giving up and picking
   another one produced a modal about the first file while the second was
   opening perfectly well behind it. The alert belongs to the same guard as the
   status: a superseded read is a failure nobody is waiting to hear about. */

    {
      M.setReadHold(true);

      /* the control: a read that fails while it is still the current one must
         still report, or the fix is "never report anything" */
      {
        const alerts = M.alerts.length, was = M.state;
        const base = M.reads.length;      // every earlier pick left one behind
        M.pick("gone.json", "{A}");
        eq(M.reads.length - base, 1, "the reader was started and is holding");
        M.reads.splice(base, 1)[0].fail();
        await tick();
        eq(M.alerts.length, alerts + 1, "a read that fails while it is current is reported");
        check(/could not be read from disk/.test(M.alerts[M.alerts.length - 1]),
          "with the reason — got " + JSON.stringify(M.alerts[M.alerts.length - 1]));
        eq(M.opening[M.opening.length - 1], "", "and clears its own status");
        check(M.state === was, "and touches nothing else");
      }

      /* and the regression itself */
      {
        const alerts  = M.alerts.length;
        const opens   = M.opens.length;
        const hist    = M.history.length;
        const was     = M.state, name = M.docName;

        const base = M.reads.length;
        M.pick("slow.json", "{A}");        // starts, and is about to fail
        M.pick("quick.json", "{B}");       // supersedes it
        eq(M.reads.length - base, 2, "both reads are in flight");
        const [slow, quick] = M.reads.splice(base, 2);

        const status = M.opening[M.opening.length - 1];
        check(status.indexOf("quick.json") >= 0,
          "the status bar names the newer Open — got " + JSON.stringify(status));

        slow.fail();
        await tick();
        eq(M.alerts.length, alerts,
          "a read superseded before it failed says nothing — got "
          + JSON.stringify(M.alerts.slice(alerts)));
        eq(M.opening[M.opening.length - 1], status,
          "and leaves the status belonging to the newer Open exactly as it was");
        check(M.state === was, "and does not touch the document");
        eq(M.docName, name, "or its name");
        eq(M.history.length, hist, "or its history");
        eq(M.opens.length, opens, "and never reaches the validator");

        /* the newer Open is unaffected by any of it */
        quick.deliver();
        await tick();
        eq(M.opens.length, opens + 1, "the newer read reaches the validator");
        const B = opened("B11");
        M.opens.pop().res({ok:true, state:B, repaired:[]});
        await tick();
        check(M.state === B, "and the newer Open lands normally");
        eq(M.docName, "quick", "with its own name");
        eq(M.opening[M.opening.length - 1], "", "and clears the status itself");
      }

      M.setReadHold(false);
    }

/* ---------------------------------------------------------- 12. a superseded
   Open is told to stop, rather than merely ignored

   openSeq always stopped an older Open ADOPTING its result. It did not stop it
   doing the work: every remaining photo in the abandoned roster went on
   decoding, competing for the main thread with the roster the user actually
   asked for. The listener now hands openRoster a predicate asking the same
   question the guard asks, so the decoding loop can give up between photos. */

    {
      const A = opened("A12"), B = opened("B12");

      M.pick("thirty-photos.json", "{A}");
      const first = M.opens[M.opens.length - 1];
      check(first.options && typeof first.options.cancelled === "function",
        "an Open is given a cancellation predicate, not just a sequence number");
      eq(first.options.cancelled(), false,
        "which answers false while it is still the Open the user is waiting for");

      M.pick("one-photo.json", "{B}");
      const second = M.opens[M.opens.length - 1];
      eq(first.options.cancelled(), true,
        "and turns true the moment a newer Open supersedes it");
      eq(second.options.cancelled(), false, "while the newer one is not cancelled");

      /* what a cancelled openRoster hands back, and what the listener does with
         it: nothing at all. It is deliberately not a refusal — there is nothing
         wrong with the file, so there is nothing to report. */
      const alerts = M.alerts.length, toasts = M.toasts.length;
      const hist   = M.history.length, gen = M.docGen;
      const was    = M.state, name = M.docName;
      M.dirtyDoc = true;

      M.opens.splice(M.opens.indexOf(first), 1);
      first.res({ok:false, cancelled:true});
      await tick();
      eq(M.alerts.length, alerts,
        "a cancelled Open raises no alert — got " + JSON.stringify(M.alerts.slice(alerts)));
      eq(M.toasts.length, toasts, "and no repair toast either");
      check(M.state === was, "it does not touch state");
      eq(M.docName, name, "or the document name");
      eq(M.history.length, hist, "or the history");
      eq(M.docGen, gen, "or the generation");
      eq(M.dirtyDoc, true, "and does not clear the dirty flag it never set");
      check(M.opening[M.opening.length - 1].indexOf("one-photo.json") >= 0,
        "and leaves the status belonging to the Open that is still running — got "
        + JSON.stringify(M.opening[M.opening.length - 1]));

      /* the current Open continues normally */
      M.opens.splice(M.opens.indexOf(second), 1);
      second.res({ok:true, state:B, repaired:[]});
      await tick();
      check(M.state === B, "the current Open still lands");
      eq(M.docName, "one-photo", "and names the document");
      eq(M.dirtyDoc, false, "and a freshly opened document is clean again");
      eq(M.opening[M.opening.length - 1], "", "and the status is cleared by the one that owns it");
      check(M.toasts.some(t => /Opened one-photo\.json/.test(t)), "and it is the one reported");
    }
  }

  /* ---------------------------------------------------------- 13. the roster
     arrows carry people across grade boundaries

     state.people is NOT grouped by grade — renderRoster derives the visible
     order by filtering each tier in turn — so a crossing move is two writes:
     the tierId that decides WHICH group, and the array position that decides
     WHERE in it. Setting only the first leaves the person wherever their old
     index happens to fall among the new group, which is a move to a plausible
     but arbitrary rank. Every case below therefore asserts the filtered order,
     not just the tierId, because the filtered order is what the user sees. */

  {
    const M = makeModule();
    M.state = M.defaults();
    M.state.tiers = sixGrades();
    const T = M.state.tiers;

    /* Three grades' worth of people in deliberately interleaved array order, so
       nothing here can pass by the array happening to be sorted by grade. */
    const mk = (name, ti) => ({id:"p" + name, name:name, tierId:T[ti].id,
                               groupId:null, role:"", photo:null, pw:0, ph:0, frame:null});
    const seed = () => {
      M.state.people = [mk("Ana",0), mk("Cy",1), mk("Bo",0), mk("Di",1)];
    };
    // what the roster actually draws: tiers in order, each filtered from people
    const visible = () => T.map(t => M.state.people.filter(p => p.tierId === t.id)
                                                   .map(p => p.name)).filter(g => g.length);
    const order = () => M.state.people.map(p => p.name).join(",");
    const idOf  = n => M.state.people.find(p => p.name === n).id;
    /* null-safe: a resolver that wrongly returns null is a failure to report,
       not an exception that abandons the rest of the section */
    const kindOf = (n, dir) => { const w = M.moveTarget(idOf(n), dir); return w ? w.kind : null; };
    const tierOf = (n, dir) => { const w = M.moveTarget(idOf(n), dir); return w ? w.tier : null; };

    /* --- the regression: within a group nothing about this changed --- */
    seed();
    const before = M.state.people.slice();
    M.movePerson(idOf("Ana"), 1);
    eq(order(), "Bo,Cy,Ana,Di", "a within-group move still swaps the two array entries in place");
    eq(JSON.stringify(visible()), JSON.stringify([["Bo","Ana"],["Cy","Di"]]),
      "and reorders only inside that grade");
    check(M.state.people.length === before.length
       && before.every(p => M.state.people.indexOf(p) >= 0),
      "the same objects are still in the array — a swap, not a rebuild");
    eq(M.state.people.filter(p => p.tierId === T[0].id).length, 2,
      "and nobody changed grade");

    /* --- down off the end of a grade lands first in the next --- */
    seed();
    eq(kindOf("Bo", 1), "grade", "the last person of a grade has a grade to move down into");
    check(tierOf("Bo", 1) === T[1], "and it is the next tier in state.tiers");
    M.movePerson(idOf("Bo"), 1);
    eq(M.state.people.find(p => p.name === "Bo").tierId, T[1].id, "moving down past the end changes grade");
    eq(JSON.stringify(visible()), JSON.stringify([["Ana"],["Bo","Cy","Di"]]),
      "and lands them FIRST in the new group, not wherever their old index fell");

    /* --- up off the start of a grade lands last in the previous --- */
    seed();
    eq(kindOf("Cy", -1), "grade", "the first person of a grade has a grade to move up into");
    M.movePerson(idOf("Cy"), -1);
    eq(M.state.people.find(p => p.name === "Cy").tierId, T[0].id, "moving up past the start changes grade");
    eq(JSON.stringify(visible()), JSON.stringify([["Ana","Bo","Cy"],["Di"]]),
      "and lands them LAST in the previous group");

    /* --- an empty grade is a destination, not a gap to skip over ---
       This is how a grade that nobody is in yet gets its first member; skipping
       it would make the arrow jump two grades and strand the empty one. */
    seed();
    M.state.people = [mk("Ana",0), mk("Bo",0)];          // T[1] and beyond hold nobody
    eq(visible().length, 1, "only one group is drawn while the others are empty");
    eq(kindOf("Bo", 1), "grade", "the last person can still move down into an empty grade");
    check(tierOf("Bo", 1) === T[1], "into the adjacent one, not the next populated one");
    M.movePerson(idOf("Bo"), 1);
    eq(M.state.people.find(p => p.name === "Bo").tierId, T[1].id, "the empty grade accepts them");
    eq(JSON.stringify(visible()), JSON.stringify([["Ana"],["Bo"]]),
      "and that group now appears in the roster");

    /* --- the disabled rule is about the whole roster, not the group --- */
    seed();
    check(M.moveTarget(idOf("Ana"), -1) === null,
      "the first person of the first grade cannot move up");
    for(const [name, dir] of [["Ana",1],["Bo",-1],["Bo",1],["Cy",-1],["Cy",1],["Di",-1]]){
      check(M.moveTarget(idOf(name), dir) !== null,
        "everyone else keeps both arrows — " + name + " " + (dir < 0 ? "up" : "down"));
    }
    /* What closes Down is the last TIER, not the last populated one: Di is last
       in the last group anyone is in, and still has empty grades below to fill. */
    check(M.moveTarget(idOf("Di"), 1) !== null,
      "the last person of the last populated grade can still move down into the empty grades below");
    M.state.people.push(mk("Zoe", T.length - 1));
    check(M.moveTarget(idOf("Zoe"), 1) === null,
      "only the last person of the last grade in state.tiers cannot move down");
    check(M.moveTarget(idOf("Zoe"), -1) !== null, "though they can still move up");

    /* --- the history entry names the destination only when there is one --- */
    seed();
    eq(M.moveLabel(idOf("Ana"), 1), "moved Ana",
      "a within-group move is recorded as it always was");
    eq(M.moveLabel(idOf("Bo"), 1), "moved Bo to " + M.gradeName(T[1]),
      "a crossing move names the grade it goes to");
    check(/ to /.test(M.moveLabel(idOf("Cy"), -1)), "in both directions");
    /* the label is resolved BEFORE the move — afterwards the person is already
       in the destination and every move would read as a plain reorder */
    M.movePerson(idOf("Bo"), 1);
    eq(M.moveLabel(idOf("Bo"), -1), "moved Bo to " + M.gradeName(T[0]),
      "and still describes the move ahead of it, not the one behind");

    /* --- one undo step, restoring both halves of the write --- */
    seed();
    M.state.tiers[1].label = "";                        // no name: the code stands in
    eq(M.gradeName(T[1]), T[1].code, "a grade with no name is called by its code");
    const steps = M.history.length;
    M.commit(M.moveLabel(idOf("Bo"), 1), () => M.movePerson(idOf("Bo"), 1));
    eq(M.history.length, steps + 1, "a crossing move is one history entry");
    eq(M.state.people.find(p => p.name === "Bo").tierId, T[1].id, "which moved the grade");
    M.undo();
    eq(M.state.people.find(p => p.name === "Bo").tierId, T[0].id,
      "and undo puts the grade back");
    eq(JSON.stringify(visible()), JSON.stringify([["Ana","Bo"],["Cy","Di"]]),
      "together with the position — both halves of the write, or the row lands in the wrong rank");
  }


/* ------------------------------------------------- 13. a drop is a destination

   The arrows above say "one step that way". A drop says "here", and nothing in
   that API can carry it — so reorderPerson resolves the destination and reaches
   it by driving movePerson in ±1 steps. Two properties decide whether that is a
   real answer or a trick: the whole walk has to be ONE undo step, and the walk
   has to stop. Everything else here is the four drops the roster can express. */
{
  const M = makeModule();
  M.state = M.defaults();
  M.state.tiers = sixGrades();
  const T = M.state.tiers;
  const mk = (name, ti) => ({id:"p" + name, name:name, tierId:T[ti].id,
                             groupId:null, role:"", photo:null, pw:0, ph:0, frame:null});
  /* Interleaved on purpose, as §12's seed is: nothing here may pass by
     state.people happening to be sorted by grade. */
  const seed = () => {
    M.state.people = [mk("Ana",0), mk("Cy",1), mk("Bo",0), mk("Di",1), mk("Ed",2)];
    M.dirtyDoc = false;
  };
  const visible = () => T.map(t => M.state.people.filter(p => p.tierId === t.id)
                                                 .map(p => p.name)).filter(g => g.length);
  const idOf = n => (M.state.people.find(p => p.name === n) || {}).id;
  const shown = () => JSON.stringify(visible());

  /* --- a drop between two rows of one grade --- */
  seed();
  eq(shown(), JSON.stringify([["Ana","Bo"],["Cy","Di"],["Ed"]]), "the seeded roster");
  check(M.reorderPerson(idOf("Bo"), idOf("Ana"), false), "dropping Bo above Ana is a move");
  eq(shown(), JSON.stringify([["Bo","Ana"],["Cy","Di"],["Ed"]]),
    "…and it reorders them inside their own grade");
  eq(M.state.people.find(p => p.name === "Bo").tierId, T[0].id, "without changing their grade");

  /* --- a drop into another grade, landing at a named position --- */
  seed();
  check(M.reorderPerson(idOf("Ana"), idOf("Di"), false), "dropping Ana above Di is a move");
  eq(shown(), JSON.stringify([["Bo"],["Cy","Ana","Di"],["Ed"]]),
    "…and she lands between the two she was dropped between, not at an end");
  eq(M.state.people.find(p => p.name === "Ana").tierId, T[1].id, "in the grade she was dropped in");

  /* --- a drop on a heading, which the caller resolves to that grade's last row --- */
  seed();
  check(M.reorderPerson(idOf("Ana"), idOf("Di"), true), "dropping Ana after the last of a grade");
  eq(shown(), JSON.stringify([["Bo"],["Cy","Di","Ana"],["Ed"]]),
    "…puts her at the end of it, which is what a heading means");

  /* --- a drop that changes nothing --- */
  seed();
  const before = M.history.length;
  /* "Returned false" is not the whole claim, and on its own it is not
     falsifiable: a drop that is ATTEMPTED and stalls also returns false, having
     taken a snapshot, added an entry and put the roster back. Deleting both
     refusals left every one of these green for that reason. So each one asserts
     the refusal AND that nothing was spent on it. */
  const refused = (src, tgt, after, msg) => {
    const at = M.history.length;
    check(M.reorderPerson(src, tgt, after) === false && M.history.length === at,
      msg + " — refused outright, with no snapshot spent on the attempt");
  };
  refused(idOf("Ana"), idOf("Ana"), false, "dropping somebody on themselves is refused");
  refused(idOf("Ana"), idOf("Bo"), false, "…and so is a drop into the slot they already occupy");
  refused(idOf("Bo"), idOf("Ana"), true, "…named from the other side, which is the same slot");
  refused(idOf("Ana"), "no-such-person", false, "…and a stale target id from a rebuilt row");
  eq(M.history.length, before, "none of the four left a history entry");
  eq(shown(), JSON.stringify([["Ana","Bo"],["Cy","Di"],["Ed"]]), "or touched the roster");
  eq(M.dirtyDoc, false, "or marked the document dirty");

  /* --- ONE undo step, however many steps the walk took ---
     The property the whole design turns on. A person arriving at their
     destination in five presses of Ctrl+Z would be worse than no drag at all,
     so the count is asserted against the number of ±1 steps the walk actually
     needed — computed from the seeded order rather than written down here. */
  seed();
  const hist = M.history.length;
  const startedAt = M.state.people.findIndex(p => p.name === "Ana");
  check(M.reorderPerson(idOf("Ana"), idOf("Ed"), true), "Ana is dropped two grades away");
  eq(shown(), JSON.stringify([["Bo"],["Cy","Di"],["Ed","Ana"]]),
    "…and lands after Ed at the far end");
  const endedAt = M.state.people.findIndex(p => p.name === "Ana");
  check(Math.abs(endedAt - startedAt) > 1,
    "the walk really did take more than one step — " + startedAt + " to " + endedAt);
  eq(M.history.length, hist + 1, "and the whole walk is ONE history entry");
  M.undo();
  eq(shown(), JSON.stringify([["Ana","Bo"],["Cy","Di"],["Ed"]]),
    "so one undo restores the order the drag started from");
  eq(M.state.people.find(p => p.name === "Ana").tierId, T[0].id, "and the grade with it");

  /* --- the label names where they LANDED, not what they passed through ---
     A directional label names the adjacent grade. Ana crosses two boundaries
     here, so a label built from a direction would name grade 2 while she is
     standing in grade 3. */
  seed();
  M.reorderPerson(idOf("Ana"), idOf("Ed"), true);
  eq((M.history[M.history.length - 1] || {}).label, "moved Ana to " + M.gradeName(T[2]),
    "a drop over two boundaries names the grade it landed in");
  check((M.history[M.history.length - 1] || {}).label.indexOf(M.gradeName(T[1])) < 0,
    "…and not the one it passed through");
  /* and the sentence is the menu's own, from one writer */
  seed();
  eq(M.moveLabelTo(idOf("Bo"), T[1]), M.moveLabel(idOf("Bo"), 1),
    "moveLabel and moveLabelTo produce the same sentence for the same move");
  eq(M.moveLabelTo(idOf("Ana"), T[0]), "moved Ana",
    "and a destination the person is already in is not a crossing");

  /* --- a within-grade drop is not reported as a crossing --- */
  seed();
  M.reorderPerson(idOf("Bo"), idOf("Ana"), false);
  eq((M.history[M.history.length - 1] || {}).label, "moved Bo",
    "a reorder inside one grade says only that");

  /* --- the walk terminates, and a walk that cannot finish changes nothing ---
     movePerson is driven in a loop, so the one way this design fails badly is a
     loop that never ends or one that gives up with the person half-way. The
     bound is proved by breaking the step: a movePerson that refuses everything
     must leave the roster exactly as it was found. */
  {
    const N = makeModule();
    N.state = N.defaults();
    N.state.tiers = sixGrades();
    const TT = N.state.tiers;
    /* Built against N's OWN tiers: mk() above closes over M's, and a person
       carrying another document's tierId is on no grade at all here — which
       would make this section pass by having nothing to move rather than by the
       guard doing its job. */
    const nk = (name, ti) => ({id:"p" + name, name:name, tierId:TT[ti].id,
                               groupId:null, role:"", photo:null, pw:0, ph:0, frame:null});
    N.state.people = [nk("Ana",0), nk("Cy",1), nk("Bo",0)];
    const was = N.state.people.map(p => p.name + "@" + p.tierId).join(",");
    const entries = N.history.length;
    /* A step that achieves nothing, which is what walkOnce is there to notice.
       Driven through the real reorderPerson so the guard, the restore and the
       report are the shipped ones. */
    N.resetSteps();
    N.breakTheStep();
    const done = N.reorderPerson(N.state.people[0].id, N.state.people[2].id, true);
    eq(done, false, "a walk that cannot make progress reports failure");
    /* Both guards stop this walk, and they are not the same guard: the bound
       stops it after the whole roster's worth of spins, the progress check
       stops it on the first step that achieves nothing. Only the step COUNT
       tells them apart — without this the two are one assertion, and deleting
       the progress check goes unnoticed because the bound catches it anyway. */
    eq(N.steps, 1,
      "…on the FIRST step that achieves nothing, not after spending the whole "
      + "bound — got " + N.steps + " steps");
    eq(N.history.length, entries + 1,
      "the attempt is still one entry, so the no-op is one undo away either way");
    check(N.alerts.some(a => /could not be completed/.test(a)),
      "…and it says so rather than failing silently — got " + JSON.stringify(N.alerts));

    /* --- the restore, exercised by a walk that really did move somebody ---
       breakTheStep() above stalls on the first call, so nobody is half-moved
       and the array restore is never what puts the roster back. This lets three
       real steps through and then stalls, which is the state the restore is for. */
    const P = makeModule();
    P.state = P.defaults();
    P.state.tiers = sixGrades();
    const PT = P.state.tiers;
    const pk = (name, ti) => ({id:"q" + name, name:name, tierId:PT[ti].id,
                               groupId:null, role:"", photo:null, pw:0, ph:0, frame:null});
    P.state.people = [pk("Ana",0), pk("Bo",0), pk("Cy",0), pk("Di",2)];
    const orderWas = P.state.people.map(p => p.name + "@" + p.tierId).join(",");
    P.breakTheStepAfter(1);
    const moved = P.reorderPerson("qAna", "qDi", true);
    eq(moved, false, "a walk that stalls part-way reports failure");
    eq(P.state.people.map(p => p.name + "@" + p.tierId).join(","), orderWas,
      "…and puts back BOTH halves — the array order and the tierId — so nobody is "
      + "left standing between two grades");
  }
}

/* ------------------------------------------------- 14. toCSV, the flat-text
   export

   toCSV is a pure function of {people, tiers} — no document scaffolding is
   needed to drive it, so every case below hands it a plain object literal
   built for that one case and compares the result against a LITERAL expected
   string, never against csvField/toCSV logic re-run in the test. That is the
   second source: a test that derived its own expectation by quoting the same
   way the app does would agree with the app no matter what the app did. */
{
  const M = makeModule();

  /* --- two plain people, roster order, header first --- */
  {
    const st = {
      tiers: [{id:"t1", code:"P", label:"Partner"}, {id:"t2", code:"A", label:"Associate"}],
      groups: [{id:"g1", label:"Berlin"}],
      people: [
        {id:"p1", name:"Ada", tierId:"t1", groupId:"g1", role:"Founder"},
        {id:"p2", name:"Bob", tierId:"t2", groupId:null, role:""}
      ]
    };
    eq(M.toCSV(st),
      "Name;Grade;Group;Role\r\nAda;P;Berlin;Founder\r\nBob;A;;",
      "header, then one row per person in roster order, semicolon-delimited");
  }

  /* --- a name holding the delimiter is quoted --- */
  {
    const st = {
      tiers: [{id:"t1", code:"P", label:"Partner"}],
      people: [{id:"p1", name:"Smith; Jr", tierId:"t1", groupId:null, role:""}]
    };
    eq(M.toCSV(st),
      'Name;Grade;Group;Role\r\n"Smith; Jr";P;;',
      "a name containing the ; delimiter is wrapped in quotes");
  }

  /* --- a name holding a double quote is quoted with the quote doubled --- */
  {
    const st = {
      tiers: [{id:"t1", code:"P", label:"Partner"}],
      people: [{id:"p1", name:'Ann "Annie" Lee', tierId:"t1", groupId:null, role:""}]
    };
    eq(M.toCSV(st),
      'Name;Grade;Group;Role\r\n"Ann ""Annie"" Lee";P;;',
      "a name containing a double quote is wrapped in quotes with the inner quote doubled");
  }

  /* --- grade cell: code, then label when code is empty, then "" when the
     person's tierId matches no tier at all --- */
  {
    const st = {
      tiers: [
        {id:"t1", code:"P", label:"Partner"},
        {id:"t2", code:"", label:"Contractor"}
      ],
      people: [
        {id:"p1", name:"Ada", tierId:"t1", groupId:null, role:""},
        {id:"p2", name:"Cy",  tierId:"t2", groupId:null, role:""},
        {id:"p3", name:"Di",  tierId:"gone", groupId:null, role:""}
      ]
    };
    eq(M.toCSV(st),
      "Name;Grade;Group;Role\r\nAda;P;;\r\nCy;Contractor;;\r\nDi;;;",
      "grade is code, falling back to label when code is empty, and empty for "
      + "an unmatched tierId");
  }

  /* --- zero people: an honest header-only file, no trailing newline --- */
  {
    const st = {tiers: [{id:"t1", code:"P", label:"Partner"}], people: []};
    eq(M.toCSV(st), "Name;Grade;Group;Role",
      "zero people is the header line alone, with no trailing newline");
  }

  /* --- a field holding a line break is quoted --- */
  {
    const st = {
      tiers: [{id:"t1", code:"P", label:"Partner"}],
      groups: [{id:"g1", label:"Berlin\nGermany"}],
      people: [{id:"p1", name:"Ada", tierId:"t1", groupId:"g1", role:""}]
    };
    eq(M.toCSV(st),
      'Name;Grade;Group;Role\r\nAda;P;"Berlin\nGermany";',
      "a field containing a line break is wrapped in quotes");
  }
}

/* ------------------------------------------------- 15. Groups: the second
   dimension's one management surface (Structure ▸ Group)

   Reorder, rename-or-merge, and the drop reorderGroupRow answers for. None
   of the three creates or deletes a group — that stays resolveGroupId's and
   pruneGroups' job — so every assertion below is about ORDER, LABEL and
   which person points where, never about an entity's existence. */
{
  const M = makeModule();
  M.state = M.defaults();
  M.state.tiers = sixGrades();
  const T = M.state.tiers;
  /* Three groups built through the real resolveGroupId, with people attached
     the same way Add/Edit/paste attach them — never a hand-built {id,label}
     literal, which would prove nothing about resolveGroupId itself. Counts
     2, 1, 1: Berlin has two people, Munich one, and "Berln" — the phantom
     typo — one, so it stays visible as its own row rather than folding into
     Berlin's count. */
  const berlinId = M.resolveGroupId(M.state, "Berlin");
  const munichId = M.resolveGroupId(M.state, "Munich");
  const berlnId  = M.resolveGroupId(M.state, "Berln");
  const mk = (name, groupId) => ({id:"p"+name, name:name, tierId:T[0].id, groupId:groupId, role:""});
  M.state.people = [mk("Ana", berlinId), mk("Bo", berlinId), mk("Cy", munichId), mk("Di", berlnId)];

  /* --- (a) the list, built by syncGroupModal, read back through groupRows() --- */
  M.syncGroupModal();
  eq(JSON.stringify(M.groupRows().map(r => [r.label, r.count])),
     JSON.stringify([["Berlin","2"],["Munich","1"],["Berln","1"]]),
     "three rows, state.groups order, each carrying its own label and its own "
     + "live count — got " + JSON.stringify(M.groupRows()));
  check(M.groupEmptyHidden === true, "the empty-state sentence is hidden once groups exist");

  /* --- (b) moveGroup: one commit per move, and the disabled edges --- */
  {
    const before = M.history.length;
    check(M.moveGroup(munichId, -1), "Munich moves up, ahead of Berlin");
    eq(M.history.length, before + 1, "…as exactly one commit");
    eq(M.state.groups.map(g => g.label).join(","), "Munich,Berlin,Berln",
      "…and the order after the move");
    M.syncGroupModal();
    const rows = M.groupRows();
    eq(rows[0].upDisabled, true, "the first row's Up is disabled");
    eq(rows[rows.length - 1].downDisabled, true, "the last row's Down is disabled");
    eq(rows[1].upDisabled, false, "…and a middle row's Up is not");
    eq(rows[0].downDisabled, false, "…nor is the first row's Down");

    /* out of range: refused silently, no history spent — commit() always
       snapshots, so a refusal that reached it would still cost one entry */
    const at = M.history.length;
    check(M.moveGroup(munichId, -1) === false, "Munich is already first — moving up is refused");
    check(M.moveGroup(berlnId, 1) === false, "Berln is already last — moving down is refused");
    eq(M.history.length, at, "…neither refusal left a history entry");

    check(M.moveGroup(munichId, 1), "Munich moves back down");
    eq(M.state.groups.map(g => g.label).join(","), "Berlin,Munich,Berln",
      "…restoring the original order");
  }

  /* --- (c) rename: one commit, the label changes, every groupId is untouched
     Renaming Munich (not Berlin — (d) below collides a rename WITH "Berlin",
     and this must not spend that target first) proves the plain-rename path.
     No undo here — (d) is the one the spec asks to prove undo against, with
     more at stake (a merge), and leaving this block undo-free keeps its own
     history.length math simple: nothing before it has ever called undo, so a
     plain +1 is the whole story. */
  {
    const before = M.history.length;
    const cyGroupWas = (M.state.people.find(p => p.name === "Cy") || {}).groupId;
    M.setPrompt("München");
    check(await M.renameGroup(munichId), "renaming Munich to München");
    eq(M.history.length, before + 1, "…is one commit");
    eq((M.state.groups.find(g => g.id === munichId) || {}).label, "München", "…and the label changed");
    eq(M.state.groups.length, 3, "…with no group created or removed");
    eq((M.state.people.find(p => p.name === "Cy") || {}).groupId, cyGroupWas,
      "Cy's groupId is exactly what it was before — identity, not just the label");
  }

  /* --- (d) rename to a case-insensitive match: a merge, not a duplicate ---
     history[i] holds the state right BEFORE its i-th tracked mutation, and
     live state sits one mutation ahead until undo/redo bring it back in sync
     (see the comment above `let historyPending`) — nothing has called undo before this
     block, so the commit below still grows the array by exactly one. */
  {
    const before = M.history.length;
    const berlnMembersWere = M.state.people.filter(p => p.groupId === berlnId).map(p => p.id);
    eq(berlnMembersWere.length, 1, "the typo group starts with its one member — Di");
    M.setPrompt("berlin");
    check(await M.renameGroup(berlnId), "renaming Berln to berlin, which Berlin already is");
    eq(M.history.length, before + 1, "…is one commit");
    eq(M.state.groups.length, 2, "…and the memberless source is swept — one fewer group");
    check(!M.state.groups.some(g => g.id === berlnId),
      "the source entity itself is gone from state.groups — pruneGroups' doing, not a hand-delete");
    eq((M.state.groups.find(g => g.id === berlinId) || {}).label, "Berlin",
      "the survivor keeps its OWN casing — the typed \"berlin\" never lands anywhere");
    eq(M.state.people.filter(p => p.groupId === berlinId).map(p => p.name).sort().join(","),
      "Ana,Bo,Di", "all three people now point at the survivor, including the repointed Di");
    /* position: (b) left Berlin at state.groups[0], and a merge must not move
       it — asserted against the array itself, not a re-derived index */
    eq((M.state.groups[0] || {}).id, berlinId, "the survivor keeps its own position");
    M.undo();
    eq(M.state.groups.length, 3, "undo restores both entities");
    eq((M.state.groups.find(g => g.id === berlnId) || {}).label, "Berln", "…the source, by its own id");
    eq((M.state.people.find(p => p.name === "Di") || {}).groupId, berlnId,
      "…and Di's groupId is back on the source, not left pointing at the survivor");
  }

  /* --- (e) cancelled, empty-after-trim, and textually unchanged all add no commit --- */
  {
    const before = M.history.length;
    M.setPrompt(null);
    check(await M.renameGroup(munichId) === false, "cancelling the dialog is refused");
    M.setPrompt("   ");
    check(await M.renameGroup(munichId) === false, "whitespace-only is refused after trimming");
    M.setPrompt("München");
    check(await M.renameGroup(munichId) === false, "typing back the same text is refused");
    eq(M.history.length, before, "none of the three spent a commit");
  }

  /* --- (f) reorderGroupRow: the drop, mirroring reorderGrade's own refusals ---
     "One commit" is proved here by what a SINGLE undo reverses, not by a raw
     length delta: (d)'s own undo just above leaves live state in sync with
     history[hIndex] (historyPending=false), and the very next commit after any
     undo/redo consolidates into that existing checkpoint instead of growing
     the array — correct behaviour (see the comment above `let historyPending`), and
     exactly why counting entries immediately after an undo would be asking
     the wrong question. The three refusals below are unaffected either way:
     none of them reaches commit(), so they can never touch the array or the
     historyPending flag regardless of what came before. */
  {
    const order = () => M.state.groups.map(g => g.id);
    const [g0, g1, g2] = order();
    const before = M.history.length;
    check(M.reorderGroupRow(g0, g0, false) === false, "dropping a group on itself is refused");
    check(M.reorderGroupRow(g0, g1, false) === false, "…and so is the slot it already occupies");
    check(M.reorderGroupRow("no-such-group", g1, false) === false, "…and a stale source id");
    eq(M.history.length, before, "none of the three left a history entry");
    check(M.reorderGroupRow(g2, g0, false), "a real drop — the last group, dropped before the first");
    eq(order().join(","), [g2, g0, g1].join(","), "…and the order reflects the drop");
    M.undo();
    eq(order().join(","), [g0, g1, g2].join(","),
      "…and ONE undo reverses the whole drop — it was a single commit");
  }
}

}

/* ---------------------------------------------------------- report */

function report(){
  if(failures.length){
    console.log("FAILURES (" + failures.length + "):");
    failures.forEach(f => console.log("  ✗ " + f));
    console.log("\n" + passed + " passed, " + failures.length + " FAILED");
    if(typeof process !== "undefined") process.exit(1);
  }else{
    console.log("all " + passed + " document assertions passed");
  }
}

/* Under osascript, a top-level binding named exactly `run` is treated by the
   JXA layer as AppleScript's `on run` handler and gets invoked a SECOND
   time, automatically, once the script finishes loading — printing its
   return value, a still-pending Promise, as "[object Promise]" on stdout.
   The driver is named runSuite instead of run for exactly that reason:
   renaming it back would reintroduce the stray print, and no amount of
   restructuring the call below would fix it, because the print is not about
   that statement at all. Under node nothing is printed either way, since
   node has no such handler convention. */
const pending = runSuite().then(report, e => {
  /* A throw mid-run is itself a failure, and the assertions collected before it
     are the context that explains where things went wrong — reporting only the
     exception threw that away. JXA stacks are close to useless ("run@"), so the
     message matters more than the trace. */
  failures.push("the suite threw before finishing: " + ((e && e.message) || e));
  report();
});
