/* Import validation tests for tierform_app.html.
 *
 * parseAndValidateRoster is the only door an outside roster comes through, so
 * this suite is the guard on that door. It asserts the two halves of the
 * contract separately, because they fail differently:
 *
 *   FATAL    — the file is refused whole and nothing is returned to adopt.
 *              The bug this prevents is a half-applied import.
 *   REPAIRED — the file is accepted with named values normalised. The bug this
 *              prevents is junk reaching the renderers, and silence about it.
 *
 * The oversized cases are built here rather than committed as fixtures: an
 * over-the-limit photo is an 8 MB file, and version control is the wrong place
 * for it.
 *
 * Run:  node test/import.js
 *   or: osascript -l JavaScript test/import.js
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

const ROOT   = here();
const HTML   = readFile(ROOT + "tierform_app.html");
const SCRIPT = /<script>([\s\S]*)<\/script>/.exec(HTML)[1];

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
  if(start < 0) throw new Error("import: function " + name + " not found — was it renamed?");
  let depth = 0;
  for(let j = MASK.indexOf("{", start); j < MASK.length; j++){
    if(MASK[j] === "{") depth++;
    else if(MASK[j] === "}" && !--depth) return SCRIPT.slice(start, j + 1);
  }
  throw new Error("import: unbalanced braces reading " + name);
}
function grabConst(name){
  const m = new RegExp("(^|\\n)const\\s+" + name + "\\s*=").exec(MASK);
  if(!m) throw new Error("import: const " + name + " not found — was it renamed?");
  const start = m.index + (m[1] ? 1 : 0);
  let depth = 0;
  for(let j = start; j < MASK.length; j++){
    const c = MASK[j];
    if("{[(".includes(c)) depth++;
    else if("}])".includes(c)) depth--;
    else if(c === ";" && depth === 0) return SCRIPT.slice(start, j + 1);
  }
  throw new Error("import: unterminated const " + name);
}

const PREAMBLE = `
  let state = null;
  const meas = { font: "", measureText(t){
    const m = /([\\d.]+)px/.exec(this.font);
    return {width: String(t == null ? "" : t).length * (m ? parseFloat(m[1]) : 12) * 0.5};
  }};
  const document = {
    createElement(){ return {width:0, height:0, getContext(){ return meas; }, toDataURL(){ return "data:,"; }}; },
    getElementById(){ return {textContent: ""}; }
  };
  /* decodeImage arms a timeout it always clears; nothing here should ever fire */
  function setTimeout(){ return 0; }
  function clearTimeout(){}

  /* ---- a stand-in for the browser's image decoder --------------------------
     It reads the real bytes out of the data URL and reports the dimensions the
     format itself declares — JPEG SOF, PNG IHDR — or fails. Parsing them for
     real is the whole point: "a jpeg data URL containing a paragraph of text"
     then fails here for exactly the reason it fails in a browser, rather than
     because a lookup table in this file said it should. A stub that answered
     from a list of known-good strings would keep passing after the app stopped
     decoding anything at all. */
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function b64bytes(s){
    const str = String(s).replace(/=+$/, "");
    const out = [];
    let acc = 0, bits = 0;
    for(const ch of str){
      const v = B64.indexOf(ch);
      if(v < 0) return [];
      acc = ((acc << 6) | v) & 0xFFFFFF; bits += 6;
      if(bits >= 8){ bits -= 8; out.push((acc >> bits) & 255); }
    }
    return out;
  }
  function b64of(bytes){
    let out = "";
    for(let i = 0; i < bytes.length; i += 3){
      const a = bytes[i], b = bytes[i+1], c = bytes[i+2];
      const n = (a << 16) | ((b || 0) << 8) | (c || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
           + (b === undefined ? "=" : B64[(n >> 6) & 63])
           + (c === undefined ? "=" : B64[n & 63]);
    }
    return out;
  }
  function jpegSize(b){
    if(b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
    let i = 2;
    while(i < b.length - 1){
      if(b[i] !== 0xFF) return null;
      const m = b[i+1];
      if(m === 0xD8 || m === 0xD9 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)){ i += 2; continue; }
      if(i + 3 >= b.length) return null;
      const len = (b[i+2] << 8) | b[i+3];
      if(m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC){
        if(i + 8 >= b.length) return null;
        const h = (b[i+5] << 8) | b[i+6], w = (b[i+7] << 8) | b[i+8];
        return (w && h) ? {w:w, h:h} : null;
      }
      if(len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  const PNG_SIG = [137,80,78,71,13,10,26,10];
  function pngSize(b){
    if(b.length < 24) return null;
    for(let i = 0; i < 8; i++) if(b[i] !== PNG_SIG[i]) return null;
    if(String.fromCharCode(b[12], b[13], b[14], b[15]) !== "IHDR") return null;
    const be = o => (b[o] * 16777216) + (b[o+1] << 16) + (b[o+2] << 8) + b[o+3];
    const w = be(16), h = be(20);
    return (w && h) ? {w:w, h:h} : null;
  }
  /* A PNG header of any declared size, for the limits: a genuinely decodable
     12000x12000 image is 144 megapixels of fixture, and a browser reads the
     size out of exactly these 24 bytes. */
  function pngDataUrl(w, h){
    const be = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    const bytes = PNG_SIG.concat([0,0,0,13], [73,72,68,82],
      be(w), be(h), [8,6,0,0,0], [0,0,0,0]);
    return "data:image/png;base64," + b64of(bytes);
  }

  /* every string ever handed to a decoder, so the suite can prove what was not */
  const DECODED = [];
  /* Two ways to make the decoder disagree with the header, which is the whole
     subject of §11f: bytes whose header is perfectly well formed and whose
     image data the browser still cannot finish, and bytes that decode to
     something other than the size they declared. Neither can be expressed by
     parsing the header, because parsing the header is what they contradict. */
  const DECODE_REFUSE = [];
  const DECODE_AS     = [];
  function Image(){
    const self = this;
    Object.defineProperty(this, "src", {set(v){
      DECODED.push(v);
      if(DECODE_REFUSE.indexOf(v) >= 0){ self.onerror && self.onerror(); return; }
      const forced = DECODE_AS.filter(e => e.url === v)[0];
      const m = /^data:image\\/(jpeg|png);base64,([\\s\\S]*)$/.exec(v || "");
      const size = forced ? {w:forced.w, h:forced.h}
        : !m ? null
        : m[1] === "jpeg" ? jpegSize(b64bytes(m[2])) : pngSize(b64bytes(m[2]));
      if(!size){ self.onerror && self.onerror(); return; }
      self.naturalWidth = size.w; self.naturalHeight = size.h;
      self.onload && self.onload();
    }});
  }
`;
const M = new Function(PREAMBLE +
  ["FONT","FONTS","PAGES","ANGLES","DENSITY","G","SW","HV","MX","ZOOM_MAX","uid","LIMITS","ENUMS","ANCHORS","HEX6",
   "DECODE_TIMEOUT","FILE_FORMAT",
   /* the preflight's own constants */
   "PHOTO_SCAN_BYTES","B64_ALPHABET","B64_VALUES","PNG_SIGNATURE","JPEG_MAX_SEGMENTS",
   "DECODE_CANCELLED"]
    .map(grabConst).join("\n") + "\n" +
  ["xmlText","xmlAttr","paint","validatePhoto","isPlainObject","clampText","oneOf","validColour",
   "parseAndValidateRoster","splitName","initials","tierOf","tierRole","subline","withAlpha",
   "angleIndex","codeParts","frameRect","frameLimit","clampFrame","normalizeGradeLinks",
   /* computeLayout dispatches on state.layout; pyramid, tornado AND histogram
      geometry all live behind the shared band-stack machinery (buildBandGroups,
      buildBandStack, emitHeaderTexts, emitBandPeople) that computeTriangleLayout
      and computeHistogramLayout both call, so all of it comes with it */
   "computeLayout","gradeHeadingTexts",
   "buildBandGroups","buildBandStack","emitHeaderTexts","emitBandPeople",
   "computeTriangleLayout","computeHistogramLayout",
   "computePyramidLayout","computeTornadoLayout","computeSwimlaneLayout",
   "computeHiveLayout","computeMatrixLayout",
   "nameSegs","ellipsize","fitName","toSVG",
   /* the shared measurement helpers the geometry engines call while sizing
      a person's label and the header text. */
   "personLabelWidth","headNeedWidth","docFont",
   "splitCsvLine","splitPasteRow","matchTierByGrade","parsePasteText","toCSV",
   /* the one factory every CREATE path uses. Extracted here NOT because the
      validator calls it — it deliberately does not — but so §12 can compare the
      shape the validator emits against the shape a fresh grade has. */
   "newTier",
   /* the header preflight, which runs before a decoder is involved */
   "photoBytes","be32","pngHeaderSize","isSofMarker","jpegHeaderSize","photoHeader",
   /* the asynchronous half of the door */
   "photoFields","applyPhoto","decodeImage","photoSizeProblem","sizeMatchesHeader","decodeRosterPhotos","openRoster",
   /* parseAndValidateRoster resolves a stated `groupId` through the fresh-id
      map built from the file's own `groups` array, and prunes memberless
      stated groups through pruneGroups after the person loop. resolveGroupId
      is the free-text on-ramp the Add/Edit/paste/CSV commit paths use
      instead; subline and toCSV both read a person's group back through
      groupLabel. All four are extracted together, since a test that reaches
      one of them usually needs the rest. */
   "newGroup","resolveGroupId","groupLabel","pruneGroups"]
   .map(grabFn).join("\n") + "\n" +
  "return {parseAndValidateRoster, validatePhoto, xmlText, xmlAttr, paint," +
  " splitCsvLine, splitPasteRow, parsePasteText, toCSV," +
  " decodeImage, photoSizeProblem, decodeRosterPhotos, openRoster, pngDataUrl," +
  " groupLabel, resolveGroupId, subline," +
  " photoBytes, photoHeader, pngHeaderSize, jpegHeaderSize, DECODE_CANCELLED," +
  " PHOTO_SCAN_BYTES," +
  " dataUrl(mime, bytes){ return 'data:image/' + mime + ';base64,' + b64of(bytes); }," +
  " refuseDecode(url){ DECODE_REFUSE.push(url); }," +
  " decodeAs(url, w, h){ DECODE_AS.push({url:url, w:w, h:h}); }," +
  " decoded(){ return DECODED.slice(); }," +
  " computeLayout, computePyramidLayout, computeTornadoLayout, computeHistogramLayout, computeSwimlaneLayout, computeHiveLayout, computeMatrixLayout," +
  " toSVG, LIMITS, newTier, setState(s){ state = s; }};")();

let passed = 0;
const failures = [];
const check = (c, m) => { if(c) passed++; else failures.push(m); };
const eq = (a, b, m) => check(a === b, m + " — got " + JSON.stringify(a) + ", want " + JSON.stringify(b));

const fixture = name => readFile(ROOT + "test/fixtures/" + name + ".json");
const parse   = text => M.parseAndValidateRoster(text);
const json    = obj  => JSON.stringify(obj);

/* A real 1x1 JPEG, the same one the fixtures use. */
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL"
  + "DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA"
  + "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

/* minimum viable roster, to be broken one field at a time */
function ok(over){
  const base = {
    title: "Base", brand: "", accent: "#046A38",
    inkOnColour: "#FFFFFF", inkOnWhite: "#1A2129",
    bg: "white", ring: "none", angle: 2,
    page: "landscape", density: "balanced",
    tiers: [{id:"t1", code:"P", label:"Partner", role:"Partner",
             fill:"green", attach:false, merge:false, align:"center"}],
    people: [{id:"p1", name:"Base Person", tierId:"t1", office:"FRA", role:"",
              photo:null, pw:0, ph:0, frame:null}]
  };
  return Object.assign(base, over || {});
}

/* A throw part-way through is itself a failure, and the assertions collected
   before it explain where things went wrong. Reporting only the exception
   threw that away. The async section below has its own guard. */
try{
  /* ---------------------------------------------------------- 1. the good path */

  {
    const r = parse(fixture("current"));
    check(r.ok, "current.json is accepted" + (r.ok ? "" : " — refused: " + r.reason));
    if(r.ok){
      eq(r.state.tiers.length, 9, "current.json keeps all 9 grades");
      eq(r.state.people.length, 26, "current.json keeps all 26 people");
      eq(r.repaired.length, 0, "current.json needs no repairs");
      eq(r.state.title, "Fixture | Current schema", "current.json keeps its title");
      eq(r.state.angle, 2, "current.json keeps its angle");
      check(r.state.people.filter(p => p.photo).length === 5, "current.json keeps its 5 photos");
    }

    /* ---- the format marker is enforced softly ------------------------------
       A file that STATES a foreign format is refused whole — there is no
       upgrade path across formats, only a clear refusal naming both numbers.
       A file that states none opens exactly as before: the marker is new,
       and every roster written before it existed said nothing about it. */
    {
      const foreign = parse(json(ok({format: 2})));
      check(foreign.ok === false, "a document stating format: 2 is refused whole");
      check(!foreign.ok && /format/.test(foreign.reason || ""),
        "…and the reason names the format — got " + JSON.stringify(foreign.reason));
    }
    {
      /* ok() itself never states "format" — this is the same absent-marker
         shape every other ok()-based test in this file already opens under,
         made explicit as its own rule rather than left implicit. */
      const noMarker = parse(json(ok({})));
      check(noMarker.ok, "a file stating no format opens as before"
        + (noMarker.ok ? "" : " — refused: " + noMarker.reason));
    }

    /* ---- every default comes from the validator alone ---------------------
       There is no normalising pass in front of this function: it alone
       answers for every setting a roster file leaves out. A file that
       states nothing but its grades and its people is the whole test: each
       default has to be the documented one, and NOT ONE of them may be
       reported as a repair, because the file was not wrong about anything.
       This list and defaults() must never disagree, or a new document and
       an opened one differ. */
    {
      const bare = parse(json({
        tiers: [{id:"t1", code:"P", label:"Partner"}],
        people: [{id:"p1", name:"Ada", tierId:"t1"}]
      }));
      check(bare.ok, "a roster stating only grades and people opens"
        + (bare.ok ? "" : " — refused: " + bare.reason));
      if(bare.ok){
        for(const [k, want] of [
          ["title", ""], ["brand", ""], ["groupsLabel", ""],
          ["accent", "#003153"], ["inkOnColour", "#FFFFFF"], ["inkOnWhite", "#1A2129"],
          ["bg", "white"], ["ring", "none"],
          ["page", "landscape"], ["density", "balanced"],
          ["angle", 2], ["layout", "pyramid"],
          ["showGradeCode", true], ["showGradeName", false],
          ["nameLabelPosition", "below"], ["nameBold", "given"], ["font", "open-sans"],
          ["showPersonName", true], ["showPersonGrade", true], ["showPersonGroup", true]
        ]){
          eq(bare.state[k], want, "an omitted " + k + " takes its documented default");
        }
        eq(bare.repaired.length, 0,
          "and omitting all of them repairs nothing — got " + JSON.stringify(bare.repaired));
        /* groups is an array, checked as a shape rather than by eq (===
           would fail on any two distinct empty arrays regardless of what
           the validator actually produced) — an omitted groups starts out
           at [], silently, same as an omitted people or tiers array would. */
        check(Array.isArray(bare.state.groups) && bare.state.groups.length === 0,
          "an omitted groups array takes its documented default — got "
          + JSON.stringify(bare.state.groups));
        /* the grade and person halves of the same rule */
        eq(bare.state.tiers[0].fill, "green", "an omitted grade fill defaults");
        eq(bare.state.tiers[0].align, "center", "an omitted grade alignment defaults");
        eq(bare.state.tiers[0].attach, false, "an omitted attach defaults");
        eq(bare.state.tiers[0].merge, false, "an omitted share defaults");
        eq(bare.state.people[0].role, "", "an omitted person role defaults");
        eq(bare.state.people[0].groupId, null, "an omitted groupId defaults to no group");
        eq(bare.state.people[0].photo, null, "and a person with no photo carries none");
      }

      /* The other half of the same rule, and the half a "no repairs" test can
         never reach: a value the file DID state and that had to be changed is
         still reported. Guarding the notes must silence omission, not silence
         the repair machinery. */
      const wrong = parse(json({
        tiers: [{id:"t1", code:"P", label:"Partner", fill:"purple",
                 align:"sideways", attach:"yes", merge:"no"}],
        people: [{id:"p1", name:"Ada", tierId:"t1", groupId:"does-not-exist", role:[]}],
        bg:"chartreuse", layout:"mind-map", density:"roomy", showGradeName:"yes"
      }));
      check(wrong.ok, "a roster full of stated-but-unusable values is repaired, not refused"
        + (wrong.ok ? "" : " — refused: " + wrong.reason));
      if(wrong.ok){
        for(const what of ["band fill", "alignment", "grade options", "person group",
                           "person role", "background", "layout", "spacing",
                           "grade-name label"]){
          check(wrong.repaired.indexOf(what) >= 0,
            'a stated-but-unusable value is still reported: "' + what + '" — got '
            + JSON.stringify(wrong.repaired));
        }
        eq(wrong.state.tiers[0].fill, "green", "and the value itself is normalised");
        eq(wrong.state.layout, "pyramid", "including a layout with no engine behind it");
      }
    }

    const leg = parse(fixture("legacy"));
    check(leg.ok, "legacy.json is accepted" + (leg.ok ? "" : " — refused: " + leg.reason));
    if(leg.ok){
      /* It opens with the grades it states — nothing splits, renames or reorders
         a grade on the way in. What the file says is what opens. */
      eq(leg.state.tiers.length, JSON.parse(fixture("legacy")).tiers.length,
         "legacy.json opens with exactly the grades it states");
      check(leg.state.tiers.every(t => t.style === undefined),
        "and a property this build has no meaning for is dropped, not carried");
      /* the sparse half: it states no fill, attach, merge, align or layout, and
         the validator alone has to answer for all of them */
      check(leg.state.tiers.every(t => t.fill === "green" && t.attach === false),
        "a grade that states no fill or attach gets the documented defaults");
      eq(leg.state.layout, "pyramid", "and legacy.json, which states no layout, opens as a pyramid");
    }

    /* A grade has no title of its own: what gets printed under a person is
       `p.role || t.label`. The validator never reads a stated grade `role`
       at all — it is dropped on the way in, carried onto neither the grade
       nor its people. None of that is a REPAIR: the file was not wrong, it
       just described a document shape this build does not have. */
    {
      const withPerson = (tierRole) => {
        const t = {id:"t1", code:"P", label:"Partner",
                   fill:"green", attach:false, merge:false, align:"center"};
        if(tierRole !== undefined) t.role = tierRole;
        return parse(json(ok({
          tiers: [t],
          people: [{id:"p1", name:"Ada", tierId:"t1", role:"", office:"",
                    photo:null, pw:0, ph:0, frame:null}]
        })));
      };

      for(const r of ["Partner", "", "Partner (Equity)", undefined]){
        const got = withPerson(r);
        check(got.ok, "a roster is accepted whatever it says about a grade role: "
          + JSON.stringify(r) + (got.ok ? "" : " — refused: " + got.reason));
        if(got.ok){
          eq(got.state.tiers[0].role, undefined,
            "the grade carries no role out of validation — in: " + JSON.stringify(r));
          eq(got.repaired.length, 0,
            "and dropping it is never reported as a repair — in: " + JSON.stringify(r));
        }
      }

      /* Whether it repeated the grade's name or not makes no difference: the
         field is not read, so neither form reaches a person. What each of that
         grade's people is titled with is the grade's NAME. */
      for(const r of ["Partner (Equity)", "Partner"]){
        const got = withPerson(r);
        check(got.ok && got.state.people[0].role === "",
          "a grade title is never pushed onto a person — in: " + JSON.stringify(r));
        check(got.ok && got.state.tiers[0].label === "Partner",
          "and that grade titles its people with its own name — in: " + JSON.stringify(r));
      }
    }

    const uni = parse(fixture("unicode"));
    check(uni.ok, "unicode.json is accepted" + (uni.ok ? "" : " — refused: " + uni.reason));
    if(uni.ok){
      check(uni.state.people.some(p => p.name === "山田 太郎"), "unicode names survive intact");
      check(uni.state.people.some(p => p.name === "Ana-María O'Brien & Sons"),
        "an apostrophe and an ampersand survive intact");
    }
  }

  /* ---------------------------------------------------------- 2. fatal refusals */

  /* Each of these must be refused WHOLE. A partially adopted roster is the worst
     outcome available: the document on screen becomes half someone else's. */
  const FATAL = [
    ["not JSON at all",            "{oh dear"],
    ["the truncated fixture",      fixture("malformed")],
    ["a JSON array",               json([1,2,3])],
    ["a JSON string",              json("roster")],
    ["a JSON number",              json(42)],
    ["null",                       json(null)],
    ["no tiers key",               json({people: []})],
    ["no people key",              json({tiers: []})],
    ["tiers not an array",         json({tiers: {}, people: []})],
    ["people not an array",        json({tiers: [{id:"t"}], people: {}})],
    ["zero grades",                json({tiers: [], people: []})],
    ["a grade that is a string",   json({tiers: ["P"], people: []})],
    ["a grade that is null",       json({tiers: [null], people: []})],
    ["a person that is a string",  json(ok({people: ["Jane"]}))],
    ["a person that is null",      json(ok({people: [null]}))],
    ["duplicate grade ids",        fixture("bad-refs")],
    ["a person in no known grade", json(ok({people: [{id:"p", name:"Lost", tierId:"nope"}]}))],
    ["a person with no grade",     json(ok({people: [{id:"p", name:"Lost"}]}))]
  ];
  for(const [label, text] of FATAL){
    const r = parse(text);
    check(!r.ok, "REFUSED: " + label + (r.ok ? " — but it was ACCEPTED" : ""));
    check(!r.ok && typeof r.reason === "string" && r.reason.length > 0,
      "refusing " + label + " gives a reason");
    check(!r.ok && r.state === undefined, "refusing " + label + " returns no state to adopt");
  }

  /* the count limits, built rather than committed */
  {
    const manyTiers = ok({tiers: Array.from({length: M.LIMITS.tiers + 1}, (_, i) =>
      ({id:"t"+i, code:"C"+i, label:"Grade "+i, role:"", fill:"green",
        attach:false, merge:false, align:"center"})), people: []});
    const r1 = parse(json(manyTiers));
    check(!r1.ok, "REFUSED: more grades than the limit");
    check(!r1.ok && /grades/.test(r1.reason), "the grade-count refusal says so: " + (r1.reason||""));

    const manyPeople = ok({people: Array.from({length: M.LIMITS.people + 1}, (_, i) =>
      ({id:"p"+i, name:"Person "+i, tierId:"t1", office:"", role:"", photo:null}))});
    const r2 = parse(json(manyPeople));
    check(!r2.ok, "REFUSED: more people than the limit");
    check(!r2.ok && /people/.test(r2.reason), "the people-count refusal says so: " + (r2.reason||""));

    /* exactly at the limit is fine — an off-by-one here would refuse a legal file */
    const atLimit = ok({people: Array.from({length: M.LIMITS.people}, (_, i) =>
      ({id:"p"+i, name:"Person "+i, tierId:"t1", office:"", role:"", photo:null}))});
    check(parse(json(atLimit)).ok, "a roster exactly at the people limit is accepted");
  }

  /* ---------------------------------------------------------- 3. photos */

  const PHOTO_CASES = [
    ["a jpeg data URL",        JPEG, true],
    ["a png data URL",         "data:image/png;base64,iVBORw0KGgo=", true],
    ["a javascript: URL",      "javascript:alert(1)", false],
    ["an svg data URL",        "data:image/svg+xml;base64,PHN2Zy8+", false],
    ["a plain svg data URL",   "data:image/svg+xml,<svg onload='alert(1)'/>", false],
    ["an https URL",           "https://example.invalid/x.png", false],
    ["a protocol-relative URL","//example.invalid/x.png", false],
    ["an html fragment",       "<img src=x onerror=alert(1)>", false],
    ["a gif data URL",         "data:image/gif;base64,R0lGODlhAQAB", false],
    ["a bare data: URL",       "data:,hello", false],
    ["an empty string",        "", false],
    ["null",                   null, false],
    ["a number",               12345, false],
    ["an object",              {toString(){ return JPEG; }}, false],
    ["base64 with a quote",    'data:image/jpeg;base64,AAAA"onload="alert(1)', false],
    ["base64 with a space",    "data:image/jpeg;base64,AAAA AAAA", false],
    ["a truncated quantum",    "data:image/jpeg;base64,AAAAA", false],
    /* These three are the ones that matter for the charset half of the rule.
       Each is a whole number of base64 quanta, so the length check waves them
       through and only the character class can stop them — without them, widening
       the charset to [\s\S] passed this suite unnoticed. */
    ["a quote at quantum length",   'data:image/jpeg;base64,AA"A', false],
    ["a bracket at quantum length", "data:image/jpeg;base64,AA<A", false],
    ["a newline at quantum length", "data:image/jpeg;base64,AA\nA", false]
  ];
  for(const [label, src, want] of PHOTO_CASES){
    const got = M.validatePhoto(src);
    check(!!got === want, "validatePhoto " + (want ? "accepts " : "rejects ") + label
      + (got ? " — returned " + String(got).slice(0, 40) : ""));
  }
  /* the size limit, built in memory */
  {
    const huge = "data:image/jpeg;base64," + "A".repeat(M.LIMITS.photoBytes);
    check(M.validatePhoto(huge) === null, "validatePhoto rejects a photo over the byte limit");
  }

  /* a bad photo costs that person their picture and nothing else */
  {
    const r = parse(fixture("injection"));
    check(r.ok, "injection.json is accepted after normalisation"
      + (r.ok ? "" : " — refused: " + r.reason));
    if(r.ok){
      const bad = r.state.people.filter(p => /Javascript|Svg|Html|Remote/.test(p.name));
      eq(bad.length, 4, "the four people with unusable photos are still in the roster");
      check(bad.every(p => p.photo === null), "each of them lost only the photo");
      check(bad.every(p => p.pw === 0 && p.ph === 0 && p.frame === null),
        "a dropped photo leaves no orphan dimensions behind");
      const good = r.state.people.find(p => p.name.indexOf("Ünicode") === 0);
      check(good && good.photo === JPEG, "the person with a real photo keeps it");
      check(r.repaired.some(w => /photo of/.test(w)), "each dropped photo is reported");
    }
  }

  /* ---------------------------------------------------------- 4. repairs */

  {
    const r = parse(fixture("bad-values"));
    check(r.ok, "bad-values.json is accepted after normalisation"
      + (r.ok ? "" : " — refused: " + r.reason));
    if(r.ok){
      const s = r.state;
      eq(s.accent, "#003153", "an unparseable accent falls back");
      eq(s.inkOnColour, "#FFFFFF", "a 3-digit hex is not accepted as a colour");
      eq(s.inkOnWhite, "#1A2129", "a non-hex colour falls back");
      eq(s.bg, "white", "an unknown background falls back");
      eq(s.ring, "none", "an unknown ring falls back");
      eq(s.page, "landscape", "an unknown page size falls back");
      eq(s.density, "balanced", "an unknown density falls back");
      check(s.angle >= 0 && s.angle <= 4, "an out-of-range angle is clamped into range");
      eq(s.tiers[0].fill, "green", "an unknown fill falls back");
      eq(s.tiers[0].align, "center", "an unknown alignment falls back");
      eq(typeof s.tiers[0].attach, "boolean", "a truthy string does not become a boolean by accident");
      eq(s.tiers[0].attach, false, '"yes" is not true');
      eq(s.tiers[0].merge, false, "1 is not true, and grade 0 can never share a band");
      for(const p of s.people){
        check(Number.isFinite(p.pw) && Number.isFinite(p.ph), p.name + ": dimensions are finite");
        check(p.pw > 0 && p.ph > 0, p.name + ": dimensions are positive");
        check(p.pw <= M.LIMITS.photoDim && p.ph <= M.LIMITS.photoDim,
          p.name + ": dimensions are within the limit");
        check(p.frame && Number.isFinite(p.frame.zoom) && Number.isFinite(p.frame.ox)
          && Number.isFinite(p.frame.oy), p.name + ": the frame is finite");
        check(p.frame.zoom >= 1 && p.frame.zoom <= 2, p.name + ": the zoom is in range");
      }
      check(r.repaired.length > 0, "the repairs are reported rather than silent");
    }
  }

  /* ---------------------------------------------------------- 4b. square is a real page value */

  /* PAGES gained a third key without ENUMS involved — the validator answers
     "is this a page this build can draw" by hasOwnProperty against PAGES
     itself, so a file naming "square" must be taken at its word exactly the
     way "swimlanes" is taken at its word for layout: kept intact, and not
     reported as a repair, because nothing about it was wrong. */
  {
    const sq = parse(json(ok({page:"square"})));
    check(sq.ok, "a file stating square keeps it");
    if(sq.ok){
      eq(sq.state.page, "square", "and keeps its page");
      check(!sq.repaired.some(w => /page/.test(w)),
            "and is not reported as repaired — got " + json(sq.repaired));
    }
  }

  /* ---------------------------------------------------------- 4c. groups, the second dimension

     `state.groups` is a document property — a light entity carrying only an
     id and a label — and `p.groupId` is how a person points at one. A stated
     `office` on a person is not a group on-ramp: it carries an unrecognised
     field, like any other the validator has no meaning for — dropped
     silently, groupId stays null, nothing is reported. */
  {
    /* ---- new-format round trip: stated groups honoured, order kept, ids
       reminted like every other id, and each person's groupId follows the
       fresh-id map to the right group. */
    const r = parse(json(ok({
      groups: [{id:"gOld1", label:"Frankfurt"}, {id:"gOld2", label:"Berlin"}],
      people: [
        {id:"p1", name:"Ada", tierId:"t1", groupId:"gOld1", role:"", photo:null, pw:0, ph:0, frame:null},
        {id:"p2", name:"Bo",  tierId:"t1", groupId:"gOld2", role:"", photo:null, pw:0, ph:0, frame:null},
        {id:"p3", name:"Cy",  tierId:"t1", groupId:null,    role:"", photo:null, pw:0, ph:0, frame:null}
      ]
    })));
    check(r.ok, "a roster stating the new groups format opens" + (r.ok ? "" : " — refused: " + r.reason));
    if(r.ok){
      eq(r.state.groups.length, 2, "both stated groups are kept");
      eq((r.state.groups[0] || {}).label, "Frankfurt", "…in the order the file stated them");
      eq((r.state.groups[1] || {}).label, "Berlin", "…both of them");
      check(r.state.groups.every(g => g.id !== "gOld1" && g.id !== "gOld2"),
        "group ids are reminted, exactly like every other id out of this validator");
      eq(M.groupLabel(r.state, r.state.people[0]), "Frankfurt",
        "person 0's groupId follows the id map to the right group");
      eq(M.groupLabel(r.state, r.state.people[1]), "Berlin",
        "…and so does person 1's, to the OTHER group");
      eq(r.state.people[2].groupId, null, "a person naming no group opens with none");
      eq(r.repaired.length, 0, "a well-formed new-style file needs no repairs — got " + json(r.repaired));
    }
  }
  {
    /* ---- office is not a group on-ramp: a stated `office` string is just an
       unrecognised field. It is dropped silently — the same stance an
       unknown grade property (`t.style`) already gets — groupId stays null,
       and nothing is reported, because nothing the file said in terms this
       build understands was changed. */
    const r = parse(json(ok({
      people: [
        {id:"p1", name:"Ada", tierId:"t1", office:"FRA", role:"", photo:null, pw:0, ph:0, frame:null},
        {id:"p2", name:"Bo",  tierId:"t1", office:"HAM", role:"", photo:null, pw:0, ph:0, frame:null}
      ]
    })));
    check(r.ok, "a roster stating office (not groupId) still opens" + (r.ok ? "" : " — refused: " + r.reason));
    if(r.ok){
      eq(r.state.groups.length, 0, "a stated office creates no group — the on-ramp is gone");
      check(r.state.people.every(p => p.groupId === null),
        "…and every person opens with no group at all");
      eq(r.repaired.length, 0,
        "…not reported either — office is simply a field this build has no meaning for, got "
        + json(r.repaired));
      M.setState(r.state);
      eq(M.subline(r.state, r.state.people[0]), "Partner",
        "and subline prints no group half — a literal, not a second subline call");
    }
  }
  {
    /* ---- a stated groupId this file's groups array has nothing under is
       repaired to null and reported, the same stance an unresolvable tierId
       reference takes everywhere else in this validator. */
    const r = parse(json(ok({
      people: [{id:"p1", name:"Ada", tierId:"t1", groupId:"does-not-exist", role:"",
                photo:null, pw:0, ph:0, frame:null}]
    })));
    check(r.ok, "…opens" + (r.ok ? "" : " — refused: " + r.reason));
    if(r.ok){
      eq(r.state.people[0].groupId, null, "an unresolvable stated groupId is repaired to null");
      check(r.repaired.some(w => w === "person group"),
        "…and reported — got " + json(r.repaired));
    }
  }
  {
    /* ---- a stated group with zero members is pruned and reported — the
       same invariant commit()/edit() keep live, proven here on the way IN. */
    const r = parse(json(ok({
      groups: [{id:"gA", label:"Nobody Home"}],
      people: [{id:"p1", name:"Ada", tierId:"t1", role:"", photo:null, pw:0, ph:0, frame:null}]
    })));
    check(r.ok, "…opens" + (r.ok ? "" : " — refused: " + r.reason));
    if(r.ok){
      eq(r.state.groups.length, 0, "a stated group with no member is pruned");
      check(r.repaired.some(w => w === "group"), "…and reported — got " + json(r.repaired));
    }
  }
  {
    /* ---- a stated duplicate label (case-insensitive) merges into the
       FIRST kept entry, and is reported — the same stance the tiers array
       takes on a duplicated id, applied here to a duplicated label. */
    const r = parse(json(ok({
      groups: [{id:"gA", label:"Berlin"}, {id:"gB", label:"berlin"}],
      people: [
        {id:"p1", name:"Ada", tierId:"t1", groupId:"gA", role:"", photo:null, pw:0, ph:0, frame:null},
        {id:"p2", name:"Bo",  tierId:"t1", groupId:"gB", role:"", photo:null, pw:0, ph:0, frame:null}
      ]
    })));
    check(r.ok, "…opens" + (r.ok ? "" : " — refused: " + r.reason));
    if(r.ok){
      eq(r.state.groups.length, 1, "a duplicate label (case-insensitive) merges into one group");
      eq((r.state.groups[0] || {}).label, "Berlin", "…keeping the FIRST entry's label");
      eq(r.state.people[0].groupId, r.state.people[1].groupId,
        "…and both people now point at that one entity");
      check(r.repaired.some(w => w === "group"), "…reported — got " + json(r.repaired));
    }
  }
  {
    /* ---- absent groups AND absent groupId together: the doubly-negative
       case, and the one a "no repairs" test over the defaults loop can never
       isolate on its own — absent is not a repair, on both counts at once. */
    const r = parse(json({
      tiers: [{id:"t1", code:"P", label:"Partner"}],
      people: [{id:"p1", name:"Ada", tierId:"t1"}]
    }));
    check(r.ok, "…opens" + (r.ok ? "" : " — refused: " + r.reason));
    if(r.ok){
      eq(r.state.groups.length, 0, "no groups stated, none exist");
      eq(r.state.people[0].groupId, null, "no groupId stated either, so there is nothing to resolve");
      eq(r.repaired.length, 0, "neither absence is a repair — got " + json(r.repaired));
    }
  }

  /* text limits truncate rather than refuse — a long name is careless, not hostile */
  {
    const long = "x".repeat(10000);
    const r = parse(json(ok({
      title: long, brand: long,
      tiers: [{id:"t1", code:long, label:long, role:long, fill:"green",
               attach:false, merge:false, align:"center"}],
      groups: [{id:"g1", label:long}],
      people: [{id:"p1", name:long, tierId:"t1", groupId:"g1", role:long, photo:null}]
    })));
    check(r.ok, "an oversized-text roster is accepted, not refused");
    if(r.ok){
      eq(r.state.title.length, M.LIMITS.title, "the title is truncated to the limit");
      eq(r.state.brand.length, M.LIMITS.title, "the brand label is truncated to the limit");
      eq(r.state.tiers[0].code.length,  M.LIMITS.text, "a grade code is truncated");
      eq(r.state.tiers[0].label.length, M.LIMITS.text, "a grade label is truncated");
      eq(r.state.people[0].name.length, M.LIMITS.text, "a name is truncated");
      eq(M.groupLabel(r.state, r.state.people[0]).length, M.LIMITS.text,
        "a stated group's label is truncated too");
    }
  }

  /* merge on the first grade has nothing above it to merge into */
  {
    const r = parse(json(ok({
      tiers: [{id:"t1", code:"P", label:"Partner", role:"", fill:"green",
               attach:false, merge:true, align:"center"}]
    })));
    check(r.ok, "a first grade claiming to share a band is repaired, not refused");
    if(r.ok){
      eq(r.state.tiers[0].merge, false, "the first grade never shares a band");
      check(r.repaired.some(w => /first grade/.test(w)), "the repair is reported");
      eq(r.state.tiers[0].attach, false, "and it does not attach either");
    }
  }

  /* ---- the layout property, on the way in ----
     Every value the enums accept has a fallback; this one has a renderer behind
     it as well, so accepting a word this build has no geometry for would open a
     chart with no bands rather than a wrong one. */
  {
    /* a file that states no layout at all */
    const older = parse(json(ok({})));
    check(older.ok, "a roster with no layout is accepted");
    if(older.ok){
      eq(older.state.layout, "pyramid", "and a roster that omits layout is a pyramid");
      check(!older.repaired.some(w => /layout/.test(w)),
            "filling in a missing layout is not reported as a repair — nothing was changed");
    }

    const stated = parse(json(ok({layout:"pyramid"})));
    check(stated.ok && stated.state.layout === "pyramid", "a file stating pyramid keeps it");
    if(stated.ok) check(!stated.repaired.some(w => /layout/.test(w)),
                        "and is not reported as repaired");

    /* swimlanes has an engine now, so a file naming it is taken at its word */
    const swim = parse(json(ok({layout:"swimlanes"})));
    check(swim.ok, "a file stating swimlanes is accepted");
    if(swim.ok){
      eq(swim.state.layout, "swimlanes", "and keeps its layout");
      check(!swim.repaired.some(w => /layout/.test(w)),
            "and is not reported as repaired — got " + json(swim.repaired));
      /* and it really draws as lanes, not as a pyramid wearing the name */
      M.setState(swim.state);
      const L = M.computeLayout(swim.state);
      const direct = M.computeSwimlaneLayout(swim.state);
      eq(JSON.stringify(L), JSON.stringify(direct),
         "an opened swimlanes roster is dispatched to the swimlane engine");
    }

    /* tornado is the pyramid flipped and has its own engine too, so a file
       naming it is taken at its word exactly the way swimlanes is above. */
    const tornado = parse(json(ok({layout:"tornado"})));
    check(tornado.ok, "a file stating tornado is accepted");
    if(tornado.ok){
      eq(tornado.state.layout, "tornado", "and keeps its layout");
      check(!tornado.repaired.some(w => /layout/.test(w)),
            "and is not reported as repaired — got " + json(tornado.repaired));
      /* and it really draws as a tornado, not as a pyramid wearing the name */
      M.setState(tornado.state);
      const L = M.computeLayout(tornado.state);
      const direct = M.computeTornadoLayout(tornado.state);
      eq(JSON.stringify(L), JSON.stringify(direct),
         "an opened tornado roster is dispatched to the tornado engine");
      const asPyramid = M.computePyramidLayout(tornado.state);
      check(JSON.stringify(L) !== JSON.stringify(asPyramid),
         "…and it draws differently from the pyramid it shares a solver with");
    }

    /* The one that matters: a layout with no renderer. It must not be taken at
       its word just because a later build might understand it — this is the
       garbage case, and it still repairs to pyramid alongside the "usual
       shapes" sweep just below. */
    const future = parse(json(ok({layout:"mind-map"})));
    check(future.ok, "a file naming an unimplemented layout is repaired, not refused");
    if(future.ok){
      eq(future.state.layout, "pyramid",
         "a layout this build cannot draw falls back to the pyramid");
      check(future.repaired.some(w => /layout/.test(w)),
            "and the repair is reported — got " + json(future.repaired));
    }

    /* the usual shapes an enum has to survive */
    [7, null, true, {}, [], "PYRAMID", " pyramid", "SWIMLANES", "swimlane", "TORNADO", "Tornado",
     "HISTOGRAM", "Histogram", " histogram", "HIVE", "Hive", " hive"].forEach(v => {
      const r = parse(json(ok({layout:v})));
      check(r.ok && r.state.layout === "pyramid",
            "layout " + json(v) + " normalises to pyramid");
    });

    /* A stated, USABLE layout value opens unrepaired — the counterpart to the
       garbage-normalises-to-pyramid loop above. Second source: histogram.state
       (parsed separately) proves the roster really did open as Histogram, not
       merely that the literal string round-tripped. */
    {
      const histogram = ok({layout:"histogram"});
      const r = parse(json(histogram));
      check(r.ok && r.state.layout === "histogram",
            "a file stating layout:\"histogram\" opens as Histogram, unrepaired — got "
            + json(r.ok && r.state.layout));
      check(!r.repaired.some(w => /layout/.test(w)),
            "and layout is not reported as repaired, since the file's own value was kept — got "
            + json(r.repaired));
    }

    /* hive has an engine now too, so a file naming it is taken at its word —
       the same proof swimlanes and tornado get above, dispatched to its own
       engine rather than merely round-tripping the literal string. */
    {
      const hive = ok({layout:"hive"});
      const r = parse(json(hive));
      check(r.ok && r.state.layout === "hive",
            "a file stating layout:\"hive\" opens as Hive, unrepaired — got "
            + json(r.ok && r.state.layout));
      check(!r.repaired.some(w => /layout/.test(w)),
            "and layout is not reported as repaired, since the file's own value was kept — got "
            + json(r.repaired));
      if(r.ok){
        M.setState(r.state);
        const L = M.computeLayout(r.state);
        const direct = M.computeHiveLayout(r.state);
        eq(JSON.stringify(L), JSON.stringify(direct),
           "an opened hive roster is dispatched to the hive engine");
      }
    }

    /* matrix has an engine now too — the sixth, the same proof again, and
       the first one whose own roster carries the second dimension: a
       groups array plus one person naming a group and one naming none, so
       the dispatch is proven on a document that actually exercises the
       row axis, not merely a document that happens to open. */
    {
      const matrix = ok({
        layout: "matrix",
        groups: [{id: "g1", label: "Berlin"}],
        people: [
          {id:"p1", name:"Ada", tierId:"t1", groupId:"g1", role:"", photo:null, pw:0, ph:0, frame:null},
          {id:"p2", name:"Bo",  tierId:"t1", groupId:null, role:"", photo:null, pw:0, ph:0, frame:null}
        ]
      });
      const r = parse(json(matrix));
      check(r.ok && r.state.layout === "matrix",
            "a file stating layout:\"matrix\" opens as Matrix, unrepaired — got "
            + json(r.ok && r.state.layout));
      check(!r.repaired.some(w => /layout/.test(w)),
            "and layout is not reported as repaired, since the file's own value was kept — got "
            + json(r.repaired));
      if(r.ok){
        M.setState(r.state);
        const L = M.computeLayout(r.state);
        const direct = M.computeMatrixLayout(r.state);
        eq(JSON.stringify(L), JSON.stringify(direct),
           "an opened matrix roster is dispatched to the matrix engine");
      }
    }

    /* Pins the list against the engine table. The two must grow together: a
       name accepted here with no engine behind it opens as a blank chart, and
       an engine no file may name is unreachable. */
    const enums = /const ENUMS = \{[\s\S]*?\n\};/.exec(SCRIPT);
    check(!!enums && /layout:\s*\["pyramid","tornado","histogram","swimlanes","hive","matrix"\]/.test(enums[0]),
          "ENUMS.layout lists exactly the layouts this build can draw");
    const table = /const engines = \{([^}]*)\}/.exec(SCRIPT);
    check(!!table && /pyramid:\s*computePyramidLayout/.test(table[1])
                  && /tornado:\s*computeTornadoLayout/.test(table[1])
                  && /histogram:\s*computeHistogramLayout/.test(table[1])
                  && /swimlanes:\s*computeSwimlaneLayout/.test(table[1])
                  && /hive:\s*computeHiveLayout/.test(table[1])
                  && /matrix:\s*computeMatrixLayout/.test(table[1]),
          "and every one of them has an engine in computeLayout");
    const named = (table ? table[1].match(/[a-zA-Z]+\s*:/g) || [] : []).length;
    eq(named, 6, "with no engine the enum does not list");
  }

  /* ---- grade-heading settings default and validate independently ---- */
  {
    const legacy = ok({});
    delete legacy.showGradeCode; delete legacy.showGradeName;
    const old = parse(json(legacy));
    check(old.ok, "a roster missing grade-label controls still opens");
    if(old.ok){
      eq(old.state.showGradeCode, true, "a legacy roster shows codes");
      eq(old.state.showGradeName, false, "and leaves names hidden");
    }
    const chosen = parse(json(ok({showGradeCode:false, showGradeName:true})));
    check(chosen.ok && chosen.state.showGradeCode === false && chosen.state.showGradeName === true,
      "explicit independent grade-label choices survive Open");
    for(const [field, fallback] of [["showGradeCode", true], ["showGradeName", false]]){
      for(const bad of ["yes", 1, null, {}, []]){
        const r = parse(json(ok({[field]:bad})));
        check(r.ok && r.state[field] === fallback,
          field + " " + json(bad) + " is repaired to its default");
        check(r.ok && r.repaired.some(w => /grade-(code|name) label/.test(w)),
          "and the " + field + " repair is reported");
      }
    }
  }

  /* ---- Swimlane person-name position is a validated, defaulting enum ---- */
  {
    const legacy = ok({});
    delete legacy.nameLabelPosition;
    const old = parse(json(legacy));
    check(old.ok && old.state.nameLabelPosition === "below",
      "a roster missing name-label positioning keeps names below photos");
    const chosen = parse(json(ok({nameLabelPosition:"next"})));
    check(chosen.ok && chosen.state.nameLabelPosition === "next",
      "an explicit next-to-photo choice survives Open");
    for(const bad of ["above", "NEXT", " next", 1, null, {}, []]){
      const r = parse(json(ok({nameLabelPosition:bad})));
      check(r.ok && r.state.nameLabelPosition === "below",
        "nameLabelPosition " + json(bad) + " repairs to below");
      check(r.ok && r.repaired.some(w => /name-label position/.test(w)),
        "and that name-label repair is reported");
    }
  }

  /* ---- name-bolding is a validated, four-way enum, and a repaired-vs-absent
     pair like every other document setting ---- */
  {
    const legacy = ok({});
    delete legacy.nameBold;
    const old = parse(json(legacy));
    check(old.ok && old.state.nameBold === "given",
      "a roster missing nameBold keeps drawing given names bold");
    const chosen = parse(json(ok({nameBold:"family"})));
    check(chosen.ok && chosen.state.nameBold === "family",
      "an explicit family-name-bold choice survives Open");
    check(chosen.ok && chosen.repaired.length === 0,
      "and a stated, usable choice is not reported as a repair");
    for(const bad of ["bold", "GIVEN", " given", 1, null, {}, []]){
      const r = parse(json(ok({nameBold:bad})));
      check(r.ok && r.state.nameBold === "given",
        "nameBold " + json(bad) + " repairs to given");
      check(r.ok && r.repaired.some(w => /name bolding/.test(w)),
        "and that name-bolding repair is reported");
    }
  }

  /* ---- font is a validated, five-way enum, and a repaired-vs-absent pair
     like every other document setting ---- */
  {
    const legacy = ok({});
    delete legacy.font;
    const old = parse(json(legacy));
    check(old.ok && old.state.font === "open-sans",
      "a roster missing font keeps drawing the Open Sans stack");
    check(old.ok && old.repaired.length === 0,
      "and an omitted font is not reported as a repair");
    const chosen = parse(json(ok({font:"arial"})));
    check(chosen.ok && chosen.state.font === "arial",
      "an explicit Arial choice survives Open");
    check(chosen.ok && chosen.repaired.length === 0,
      "and a stated, usable choice is not reported as a repair");
    for(const bad of ["comic-sans", "ARIAL", " arial", 1, null, {}, []]){
      const r = parse(json(ok({font:bad})));
      check(r.ok && r.state.font === "open-sans",
        "font " + json(bad) + " repairs to open-sans");
      check(r.ok && r.repaired.some(w => /font/.test(w)),
        "and that font repair is reported");
    }
  }

  /* ---- groupsLabel is a document label like title/brand: a stated
     non-string repairs to the empty string and is reported; a stated
     over-long string clamps to LIMITS.title and is reported too. Absent is
     not a repair — the bare-file pin list above already proves that. ---- */
  {
    for(const bad of [7, null, {}, []]){
      const r = parse(json(ok({groupsLabel: bad})));
      check(r.ok && r.state.groupsLabel === "",
        "groupsLabel " + json(bad) + " repairs to the empty string");
      check(r.ok && r.repaired.some(w => /group-axis label/.test(w)),
        "and that repair is reported — got " + json(r.repaired));
    }
    const long = "x".repeat(250);
    const r = parse(json(ok({groupsLabel: long})));
    check(r.ok, "an oversized groupsLabel is accepted, not refused");
    if(r.ok){
      eq(r.state.groupsLabel.length, M.LIMITS.title, "groupsLabel is truncated to the title limit");
      check(r.repaired.some(w => /group-axis label/.test(w)),
        "and the truncation is reported — got " + json(r.repaired));
    }
  }

  /* ---- person-label visibility is three independent document booleans ---- */
  {
    const legacy = ok({});
    delete legacy.showPersonName; delete legacy.showPersonGrade; delete legacy.showPersonGroup;
    const old = parse(json(legacy));
    check(old.ok, "a roster missing person-label controls still opens");
    if(old.ok){
      eq(old.state.showPersonName, true, "legacy rosters keep person names visible");
      eq(old.state.showPersonGrade, true, "legacy rosters keep person grades visible");
      eq(old.state.showPersonGroup, true, "legacy rosters keep person groups visible");
    }
    const chosen = parse(json(ok({showPersonName:false, showPersonGrade:false, showPersonGroup:false})));
    check(chosen.ok && chosen.state.showPersonName === false
      && chosen.state.showPersonGrade === false && chosen.state.showPersonGroup === false,
      "three explicit hidden choices survive Open");
    for(const field of ["showPersonName","showPersonGrade","showPersonGroup"]){
      for(const bad of ["yes", 1, null, {}, []]){
        const r = parse(json(ok({[field]:bad})));
        check(r.ok && r.state[field] === true,
          field + " " + json(bad) + " is repaired to visible");
        const label = field === "showPersonName" ? "person-name display"
          : (field === "showPersonGrade" ? "person-grade display" : "person-group display");
        check(r.ok && r.repaired.some(w => w.indexOf(label) >= 0),
          "and the " + field + " repair is reported");
      }
    }
  }

  /* ---- merge implies attach, on the way in ----
     A file can state merge:true with attach:false — sharing a band without
     marking the attach that sharing implies. It must open, must come out
     attached, and — the part that makes it safe — must draw exactly as it
     would with attach left false, because layout reads attach only on a
     group's leader and a shared grade is never a leader. */
  {
    const legacyShared = ok({
      tiers: [
        {id:"t1", code:"P",  label:"Partner",   role:"", fill:"green", attach:false, merge:false, align:"center"},
        {id:"t2", code:"SA", label:"Senior",    role:"", fill:"white", attach:true,  merge:false, align:"right"},
        {id:"t3", code:"A",  label:"Assistant", role:"", fill:"white", attach:false, merge:true,  align:"right"}
      ],
      people: [{id:"p1", name:"Ada", tierId:"t3", office:"", role:"", photo:null}]
    });
    const r = parse(json(legacyShared));
    check(r.ok, "a file with merge:true and attach:false still opens");
    if(r.ok){
      eq(r.state.tiers[2].merge,  true, "the shared grade is still shared");
      eq(r.state.tiers[2].attach, true, "and is now attached, because sharing implies it");
      eq(r.state.tiers[1].attach, true, "an attached grade that shares nothing is untouched");
      eq(r.state.tiers[1].merge,  false, "and does not gain a share it never had");
      check(!r.repaired.some(w => /grade options/.test(w)),
        "raising attach is not reported as a repair — it changes nothing the user chose");

      /* the geometry is the whole reason this is safe */
      M.setState(r.state);
      const withRule = M.computeLayout(r.state);
      const asBefore = JSON.parse(JSON.stringify(r.state));
      asBefore.tiers[2].attach = false;          // attach left as the file stated it
      M.setState(asBefore);
      const before = M.computeLayout(asBefore);
      eq(JSON.stringify(withRule.bands), JSON.stringify(before.bands),
        "and the bands come out identical whether or not attach is raised to true");
      /* bands[0] is the header's apex slice, so the count is groups + 1 —
         compared against the same file with the share removed rather than
         against a number, which would only encode today's header. */
      const unshared = JSON.parse(JSON.stringify(r.state));
      unshared.tiers[2].merge = false;
      M.setState(unshared);
      eq(withRule.bands.length, M.computeLayout(unshared).bands.length - 1,
        "the shared grade still collapses into the band above it — one band fewer than "
        + "the same roster with the share removed");
      M.setState(r.state);
    }
  }

  /* ---------------------------------------------------------- 5. ids are regenerated */

  /* This is what makes an imported id harmless: it never reaches the DOM at all.
     It also repairs duplicate person ids for free. */
  {
    const evil = '"><img src=x onerror=alert(1)>';
    const r = parse(json(ok({
      tiers:  [{id:evil, code:"P", label:"Partner", role:"", fill:"green",
                attach:false, merge:false, align:"center"}],
      people: [{id:evil, name:"A", tierId:evil, office:"", role:"", photo:null},
               {id:evil, name:"B", tierId:evil, office:"", role:"", photo:null}]
    })));
    check(r.ok, "a roster with hostile ids is accepted once the ids are replaced");
    if(r.ok){
      const ids = r.state.tiers.map(t => t.id).concat(r.state.people.map(p => p.id));
      check(ids.every(id => /^[a-z0-9]{1,10}$/.test(id)),
        "every id is regenerated in uid() shape — got " + json(ids));
      check(ids.indexOf(evil) < 0, "no imported id survives into the state");
      eq(new Set(ids).size, ids.length, "duplicate ids are resolved by regeneration");
      check(r.state.people.every(p => p.tierId === r.state.tiers[0].id),
        "references are rewritten through the id map");
    }
  }

  /* ---------------------------------------------------------- 6. nothing executes */

  /* The end-to-end question: take the worst fixture, put it through the validator
     and out through the SVG writer, and prove no payload is in a position to run. */
  {
    const r = parse(fixture("injection"));
    check(r.ok, "injection.json reaches the renderer");
    if(r.ok){
      M.setState(r.state);
      const svg = M.toSVG(M.computeLayout(r.state));

      check(!/<script/i.test(svg), "no <script> element in the exported SVG");
      /* Attributes only exist inside tags. An escaped payload sitting in a TEXT
         node is not one: `&lt;img src=x onerror="alert(2)"&gt;` is a grade's name
         being drawn as the characters the file asked for, and the substring
         `onerror=` inside it is not markup — the `<` that would make it markup
         is the thing that got escaped. Testing the whole string instead of the
         tags rejects correct output, and did so the moment a hostile grade NAME
         started reaching the chart in its own right. */
      const tagsOnly = svg.replace(/>[^<]*/g, ">");
      check(!/\son\w+\s*=/i.test(tagsOnly), "no event-handler attribute in the exported SVG");
      check(/&lt;img src=x onerror="alert\(2\)"&gt;/.test(svg),
        "…while that payload is still present, escaped, as text — which is what "
        + "makes the check above meaningful rather than vacuous");
      check(!/javascript:/i.test(svg), "no javascript: URL in the exported SVG");
      check(!/<img\b/i.test(svg), "no injected <img> element in the exported SVG");
      check(!/<foreignObject/i.test(svg), "no foreignObject in the exported SVG");

      /* every href must be one of our own data URLs; a remote one would both leak
         who opened the roster and break the offline promise */
      for(const m of [...svg.matchAll(/(?:xlink:)?href="([^"]*)"/g)]){
        check(/^data:image\/(jpeg|png);base64,/.test(m[1]),
          "SVG href is an embedded image, not a URL — got " + m[1].slice(0, 40));
      }

      /* the payloads must still be VISIBLE, as text — dropping them silently
         would pass every check above while losing the user's data */
      check(svg.indexOf("&lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt;") >= 0
         || svg.indexOf("&lt;script&gt;alert(\"name\")&lt;/script&gt;") >= 0,
        "the hostile name is still rendered, escaped, as text");

      /* The fixture states this hostile fragment — "</td><td>injected" — as a
         group's own label directly (current format: groups + groupId), so
         escaping it is subline's job, not an on-ramp's. Second source: the
         literal string the fixture states, not a value reread off r.state. */
      const hostileGroup = r.state.groups.find(g => g.label === "</td><td>injected");
      check(!!hostileGroup, "the hostile text survives as a group label, verbatim");
      check(!/<td>injected/i.test(svg) && !/<\/td>/i.test(svg),
        "…and no unescaped <td> tag from it reaches the exported SVG");
      check(svg.indexOf("&lt;/td&gt;&lt;td&gt;injected") >= 0,
        "…while the same text is still visible, escaped, as the group's label");
    }
  }

  /* A grade has no title of its own, so a file that states one is stating a
     field this build does not read. Prove it is DROPPED rather than carried:
     not onto the grade, not onto its people, and above all not into the
     SVG — a field nobody reads is also a field nobody escapes. */
  {
    const hostile = "</text><script>alert('role')</script>";
    const r = parse(json(ok({
      tiers: [{id:"t1", code:"P", label:"Partner", role:hostile,
               fill:"green", attach:false, merge:false, align:"center"}],
      people: [{id:"p1", name:"Ada", tierId:"t1", role:"", office:"",
                photo:null, pw:0, ph:0, frame:null}]
    })));
    check(r.ok, "a roster whose grade states a hostile title still opens"
      + (r.ok ? "" : " — refused: " + r.reason));
    if(r.ok){
      eq(r.state.tiers[0].role, undefined, "the grade title is not kept");
      eq(r.state.people[0].role, "", "and it is not pushed onto that grade's people");
      M.setState(r.state);
      const svg = M.toSVG(M.computeLayout(r.state));
      check(svg.indexOf("script") < 0,
        "and it reaches the SVG in no form at all, escaped or otherwise");
      check(svg.indexOf("Partner") >= 0,
        "while the grade's NAME is what its people are titled with");
    }
  }

  /* The same payload where the app DOES read it: a person's own role. This is
     the live path, so here it must arrive — escaped. */
  {
    const hostile = "</text><script>alert('role')</script>";
    const r = parse(json(ok({
      tiers: [{id:"t1", code:"P", label:"Partner",
               fill:"green", attach:false, merge:false, align:"center"}],
      people: [{id:"p1", name:"Ada", tierId:"t1", role:hostile, office:"",
                photo:null, pw:0, ph:0, frame:null}]
    })));
    check(r.ok, "a roster whose PERSON states a hostile role opens"
      + (r.ok ? "" : " — refused: " + r.reason));
    if(r.ok){
      eq(r.state.people[0].role, hostile,
        "the payload really is carried — otherwise the checks below prove nothing");
      M.setState(r.state);
      const svg = M.toSVG(M.computeLayout(r.state));
      check(!/<script/i.test(svg), "it cannot open a <script> in the SVG");
      check(!/<\/text><script/i.test(svg), "nor break out of the text element it is drawn in");
      check(svg.indexOf("&lt;/text&gt;&lt;script&gt;") >= 0,
        "and it is still drawn, escaped, rather than silently dropped");
    }
  }

  /* the escapers themselves */
  {
    eq(M.xmlText("<b>&</b>"), "&lt;b&gt;&amp;&lt;/b&gt;", "xmlText escapes < > &");
    eq(M.xmlText('say "hi"'), 'say "hi"', "xmlText leaves quotes alone — they are legal in text");
    eq(M.xmlAttr('say "hi"'), "say &quot;hi&quot;", "xmlAttr escapes double quotes");
    eq(M.xmlAttr("it's"), "it&apos;s", "xmlAttr escapes single quotes");
    eq(M.xmlText("&amp;"), "&amp;amp;", "xmlText does not double-decode an existing entity");
    eq(M.xmlText("a\u0000b\u0008c"), "abc", "xmlText strips control characters XML cannot carry");
    eq(M.xmlText(null), "", "xmlText turns null into nothing, not \"null\"");
    eq(M.xmlText(undefined), "", "xmlText turns undefined into nothing");

    eq(M.paint("#046A38", "#000000"), "#046A38", "paint accepts a full hex colour");
    eq(M.paint("rgba(4,106,56,0.85)", "#000000"), "rgba(4,106,56,0.85)", "paint accepts withAlpha output");
    eq(M.paint("red", "#000000"), "#000000", "paint rejects a colour keyword");
    eq(M.paint("#FFF", "#000000"), "#000000", "paint rejects a short hex");
    eq(M.paint('#000" onload="alert(1)', "#000000"), "#000000", "paint rejects an attribute breakout");
    eq(M.paint("url(#x)", "#000000"), "#000000", "paint rejects a url() reference");
    eq(M.paint(null, "#000000"), "#000000", "paint rejects null");
  }

  /* ---------------------------------------------------------- 7. the open document is untouched */

  /* The validator must be a pure function of its input. If it mutated anything
     shared, a refused import could still corrupt the roster on screen. */
  {
    const before = ok();
    const snapshot = json(before);
    parse(json(before));
    eq(json(before), snapshot, "validating does not mutate the object it was given");

    const r1 = parse(fixture("current"));
    const r2 = parse(fixture("current"));
    check(r1.ok && r2.ok, "the same file validates twice");
    if(r1.ok && r2.ok){
      check(r1.state !== r2.state, "each import produces its own state");
      check(r1.state.tiers[0].id !== r2.state.tiers[0].id,
        "ids are freshly minted per import, not reused between them");
    }
  }

  /* ---------------------------------------------------------- 8. pasted text */

  /* A pasted list is as untrusted as a file — it usually comes off a clipboard
     from an HR export. The comma case is the tricky one: without correct
     quote-handling, "Doe, Jane" would split into two people, the second
     called "Jane". */
  {
    const csv = (line, want, why) => {
      const got = M.splitCsvLine(line);
      eq(JSON.stringify(got), JSON.stringify(want), why || ("splitCsvLine " + JSON.stringify(line)));
    };

    csv("Jane Doe,FRA,Manager", ["Jane Doe","FRA","Manager"], "a plain comma row splits");
    csv('"Doe, Jane",FRA,M', ["Doe, Jane","FRA","M"], "a quoted field keeps its comma");
    csv('"Doe, Jane","Frankfurt, DE",M', ["Doe, Jane","Frankfurt, DE","M"], "two quoted fields");
    csv('"She said ""hi""",FRA,M', ['She said "hi"',"FRA","M"], "a doubled quote is one literal quote");
    csv('"",FRA,M', ["","FRA","M"], "an empty quoted field stays empty");
    csv("A,,C", ["A","","C"], "an empty middle field is preserved");
    csv("A,B,", ["A","B",""], "a trailing empty field is preserved");
    csv('"Unclosed, quote', ["Unclosed, quote"], "an unterminated quote does not lose the rest of the line");
    csv('Mid"quote,B', ['Mid"quote',"B"], "a quote inside an unquoted field is literal");
    csv("", [""], "an empty line yields one empty field");

    /* Tab alone is still naive — nothing quotes a tab. Semicolon is not, any
       more: TIERFORM's own CSV export quotes a semicolon that turns up inside a
       name or a group, so the import has to be able to read that quoting back
       or it tears its own export apart. An unquoted semicolon row is unaffected
       — the quote-aware reader behaves exactly like the naive split when there
       is nothing to unquote. */
    eq(JSON.stringify(M.splitPasteRow("A\tB,C\tD")), JSON.stringify(["A","B,C","D"]),
       "a tab row is split on tabs, and commas inside are left alone");
    eq(JSON.stringify(M.splitPasteRow("A;B,C;D")), JSON.stringify(["A","B,C","D"]),
       "an unquoted semicolon row still just splits on semicolons");
    eq(JSON.stringify(M.splitPasteRow('"Smith; Jr";SC;Berlin;')),
       JSON.stringify(["Smith; Jr","SC","Berlin",""]),
       "a quoted semicolon field keeps its semicolon instead of breaking the row in two");
    eq(JSON.stringify(M.splitPasteRow('"Say ""hi""; bye";SC')),
       JSON.stringify(['Say "hi"; bye',"SC"]),
       "a doubled quote inside a quoted semicolon field is one literal quote");
    eq(JSON.stringify(M.splitPasteRow('"Doe, Jane",FRA')), JSON.stringify(["Doe, Jane","FRA"]),
       "a comma row goes through the CSV reader");

    /* end to end, through the real parser */
    M.setState({tiers:[{id:"t1", code:"M", label:"Manager", role:"Manager", fill:"green",
                        attach:false, merge:false, align:"center"}], people:[]});
    const rows = M.parsePasteText('"Doe, Jane",Manager,FRA\nSingh, Amrit,M,HAM\n\n"Ó Braonáin, Seán",Manager,DUB', "t1");
    eq(rows.length, 3, "three non-empty lines produce three rows");
    eq(rows[0].name, "Doe, Jane", "the quoted name survives the full parse");
    eq(rows[0].group, "FRA", "the third column is the group");
    eq(rows[0].tierId, "t1", "a grade matching a label is resolved");
    eq(rows[1].name, "Singh", "an unquoted comma still splits — the documented limit");
    eq(rows[2].name, "Ó Braonáin, Seán", "a quoted name with accents survives");
    check(rows.every(r => r.name.length > 0), "no row is produced without a name");

    /* ---- the group column has no fallback ----
       parsePasteText takes only fallbackTierId — the group column has no
       fallback of its own. Three shapes of "said nothing" — an empty cell, a
       cell holding only spaces, and the column missing altogether — all leave
       the group empty; a row that carries one keeps it. */
    {
      const text = 'Explicit,Manager,LON\nBlank,Manager,\nSpaces,Manager,   \nMissing';
      const rows = M.parsePasteText(text, "t1");
      eq(rows.length, 4, "four rows, whatever their group cell holds");
      eq(rows[0].group, "LON", "an explicit group is kept");
      eq(rows[1].group, "", "an empty group cell stays empty — there is no fallback to take");
      eq(rows[2].group, "", "a whitespace-only group cell stays empty too");
      eq(rows[3].group, "", "and so does a row with no group column at all");

      /* the grade fallback is a different argument and is unaffected by any of this */
      check(rows.every(r => r.tierId === "t1"),
        "the grade fallback is unaffected by any of this");
      eq(rows[0].gradeRaw, "Manager", "and the second column is read as the grade");

      /* The preview renders r.group and the commit writes r.group off the SAME
         rows, so what is shown is what is added. Asserted on the source, because
         two readers of one array is the property that makes them agree. */
      /* ---- the grade fallback is a question the paste dialog asks ----
         It replaced a standing control, so what matters is unchanged: a row that
         names its own grade is untouched by it, and only a row that names none
         takes it. parsePasteText's signature and its per-row matching did not
         change — the field simply supplies the argument now. */
      M.setState({tiers:[
        {id:"t1", code:"M",  label:"Manager", fill:"green", attach:false, merge:false, align:"center"},
        {id:"t2", code:"SC", label:"Senior Consultant", fill:"green", attach:false, merge:false, align:"center"}
      ], people:[]});
      {
        const text = "Names Own,SC,FRA\nNames None,,FRA\nNames By Code,M,FRA";
        const toT1 = M.parsePasteText(text, "t1");
        eq(toT1[0].tierId, "t2", "a row naming its own grade by name ignores the fallback");
        eq(toT1[2].tierId, "t1", "a row naming its own grade by code ignores it too");
        eq(toT1[1].tierId, "t1", "a row naming no grade takes the fallback");

        /* the same rows, a different answer: only the row that named nothing moves */
        const toT2 = M.parsePasteText(text, "t2");
        eq(toT2[0].tierId, "t2", "changing the fallback leaves a row that named its grade alone");
        eq(toT2[2].tierId, "t1", "…including one that named it by code");
        eq(toT2[1].tierId, "t2", "…and moves only the row that named none");

        /* the group half of the same question: the group column has no fallback */
        eq(toT1[1].group, "FRA", "a row with a group column keeps it");
        eq(M.parsePasteText("No Group", "t1")[0].group, "",
          "and a row with no group column yields no group at all");
        eq(M.parsePasteText("Name Only,SC", "t1")[0].group, "",
          "…as does a row that stops after the grade");
      }

      /* ---- the column order is Name, Grade, Group ----
         Grade is the load-bearing column — it decides which band someone lands
         in — so it sits beside the name rather than after the optional one.
         Asserted field by field, because "the row parsed" is also true when two
         columns are swapped. */
      {
        const r = M.parsePasteText("Jane Doe\tSC\tFRA", "t1")[0];
        eq(r.name, "Jane Doe", "column one is the name");
        eq(r.gradeRaw, "SC", "column two is the grade");
        eq(r.tierId, "t2", "…and it is matched, not just stored");
        eq(r.group, "FRA", "column three is the group");

        /* A row with grade and group swapped must NOT be quietly understood.
           There is no compatibility path: "FRA" matches no grade, so the row
           takes the fallback and reads the third column as a group — which
           is the honest result for text in the wrong order, and visible in
           the preview as the unmatched warning. */
        const old = M.parsePasteText("Jane Doe\tFRA\tSC", "t1")[0];
        eq(old.gradeRaw, "FRA", "a row with columns swapped offers its group as the grade");
        eq(old.tierId, "t1", "…which matches nothing, so it takes the fallback");
        eq(old.unmatched, true, "…and is flagged unmatched, so the preview warns");
        eq(old.group, "SC", "…and its third column is read as a group");
      }

      /* ---- the fourth column is Role ----
         Optional, and drawn on the chart in place of the grade name — the same
         precedence subline()/tierRole() already give p.role over t.label. */
      {
        const withRole = M.parsePasteText("Jane Doe\tSC\tFRA\tCountry Head", "t1")[0];
        eq(withRole.role, "Country Head", "column four is the role");
        const noRole = M.parsePasteText("Jane Doe\tSC\tFRA", "t1")[0];
        eq(noRole.role, "", "a three-column row has no role at all");
      }

      /* ---- a header row is skipped once, and only when it says what it is ----
         Requiring BOTH the first and second cells to read "Name" and "Grade" is
         what keeps a real person actually called Name from being silently
         dropped: nobody is coincidentally graded "Grade" as well. Checked only
         on the first non-empty line — a data row that happens to read "Name" in
         a later position is not touched by this at all. */
      {
        /* `|| {}` throughout: a mutation that empties the array must fail the
           read that follows instead of throwing and abandoning the rest of
           this block. */
        const skipped = M.parsePasteText("Name;Grade;Group;Role\r\nAda;SC;;", "t1");
        eq(skipped.length, 1, "a Name/Grade header row is skipped, leaving the one data row");
        eq((skipped[0]||{}).name, "Ada", "…and the survivor is the person, not the header read as one");

        /* Our own CSV export prepends a UTF-8 BOM; the header-skip must still
           fire on a file that starts with one, or every re-imported export of
           our own keeps a row called "Name" that matches no grade. */
        const withBom = M.parsePasteText("﻿Name;Grade;Group;Role\r\nAda;SC;;", "t1");
        eq(withBom.length, 1, "a leading BOM does not stop the header from being recognised");
        eq((withBom[0]||{}).name, "Ada", "…and the BOM is stripped, not left glued to the first cell");

        /* The second cell has to say "Grade" too — SC is a real grade, not the
           word, so this line is a person, not a header. */
        const named = M.parsePasteText("Name;SC", "t1");
        eq(named.length, 1, "a first line naming a real grade in its SECOND cell is not a header");
        eq((named[0]||{}).name, "Name", "…so a person actually called Name survives");
        eq((named[0]||{}).tierId, "t2", "…and her grade is read normally, matched by code");
      }

      /* ---- a quoted semicolon survives the paste parser end to end ---- */
      {
        const r = M.parsePasteText('"Smith; Jr";SC;Berlin;', "t1")[0] || {};
        eq(r.name, "Smith; Jr", "a quoted semicolon in the name is not read as a column break");
        eq(r.group, "Berlin", "…and the columns after it still line up");
      }

      /* ---- the round trip: two independent writers of the same statement ----
         toCSV is the app's own export; parsePasteText is the app's own import.
         Hand-build the people, run them through toCSV, then feed that text back
         through parsePasteText, and compare every field against the hand-built
         originals — not against a string either function produced, which would
         only prove the two agree with themselves. The BOM is prepended here the
         way the exportCsv command site prepends it before the download, so the
         case this exercises is the one a real re-import would hit. */
      {
        const t1 = {id:"g1", code:"M",  label:"Manager"};
        const t2 = {id:"g2", code:"SC", label:"Senior Consultant"};
        /* The group TEXT is a literal array here, independent of both the
           group objects below and of toCSV/parsePasteText — the second
           source the round trip is compared against, exactly as the name and
           role literals already were. */
        const groupText = ["Frankfurt; DE", "", "Berlin"];
        const groups = [{id:"o1", label:groupText[0]}, {id:"o2", label:groupText[2]}];
        const people = [
          {id:"p1", name:'Doe, "Ada"',  tierId:"g1", groupId:"o1", role:"Country Head"},
          {id:"p2", name:"Alan Turing", tierId:"g2", groupId:null, role:""},
          {id:"p3", name:"Grace Hopper",tierId:"g2", groupId:"o2", role:"Fellow"}
        ];
        const csvText = "﻿" + M.toCSV({tiers:[t1, t2], groups:groups, people:people});
        /* parsePasteText resolves grade codes against the module's live state,
           not against the object toCSV was handed — so the tiers the import
           reads back against must be these same two, or a correct round trip
           would land on the wrong ids by accident. */
        M.setState({tiers:[t1, t2], groups:groups, people:[]});
        const rows = M.parsePasteText(csvText, "gNEW");
        eq(rows.length, people.length, "the round trip produces exactly as many rows as people went in");
        for(let i = 0; i < people.length; i++){
          eq(rows[i].name, people[i].name, "row " + i + " name round-trips through toCSV/parsePasteText");
          eq(rows[i].group, groupText[i], "row " + i + " group round-trips");
          eq(rows[i].role, people[i].role, "row " + i + " role round-trips");
        }
        eq(rows[0].tierId, "g1", "row 0's grade code (M) is matched back to its own tier");
        eq(rows[1].tierId, "g2", "row 1's grade code (SC) is matched back to its own tier");
        eq(rows[2].tierId, "g2", "row 2's grade code is matched back too, sharing a tier with row 1");
      }

      /* Everywhere the order is STATED has to agree with the one place it is
         read. Four statements in the app, and they drift silently: a preview
         whose headers disagree with its cells is wrong in a way no parse test
         can see. */
      check(/placeholder="Jane Doe&#9;Manager&#9;Berlin&#9;Country Head"/.test(HTML),
        "the placeholder demonstrates Name, Grade, Group, Role");
      check(/<thead><tr><th>Name<\/th><th>Grade<\/th><th>Group<\/th><th>Role<\/th><\/tr><\/thead>/.test(HTML),
        "the preview headers are in that order");
      check(/<b>Name, Grade, Group, Role<\/b>/.test(HTML),
        "the hint text names that order");
      check(/<i>Name, Grade, Group, Role<\/i>/.test(HTML),
        "and so does the Tips document");
      check(!/Name, Group, Grade/.test(HTML),
        "and no differently-ordered statement of the columns appears anywhere — "
        + "a stale sentence is how a user is told to paste text the parser will misread");
      /* ---- one rule over every statement of the column order ----
         The hint, the Tips line, the preview thead and toCSV's own header row
         all have to state the SAME four-column sequence. Each is extracted
         from its own independent source — three straight off the shipped
         markup, the fourth by actually running toCSV — and compared against
         one shared literal, so a class of defect (one statement drifting
         alone, the next site nobody thought to update) has one test guarding
         every site rather than four separate literals that can each go stale
         on their own. */
      {
        const EXPECTED = "Name, Grade, Group, Role";
        const hintMatch = /<b>([^<]+)<\/b>/.exec(HTML.slice(HTML.indexOf("One person per line")));
        eq(hintMatch && hintMatch[1], EXPECTED, "the hint states the column order");
        const tipsMatch = /Paste a list: <i>([^<]+)<\/i>/.exec(HTML);
        eq(tipsMatch && tipsMatch[1], EXPECTED, "the Tips line states the same order");
        const theadMatch = /<thead><tr>((?:<th>[^<]*<\/th>){4})<\/tr><\/thead>/.exec(HTML);
        const theadSeq = theadMatch
          ? [...theadMatch[1].matchAll(/<th>([^<]*)<\/th>/g)].map(m => m[1]).join(", ")
          : null;
        eq(theadSeq, EXPECTED, "the preview thead states the same order");
        const csvHeader = M.toCSV({tiers:[], people:[]}).split(";").join(", ");
        eq(csvHeader, EXPECTED, "toCSV's own header row states the same order");
      }
      /* the preview's CELLS must follow its headers, or the table lies */
      {
        /* the ROW, not the whole builder: gradeCell is declared above the row,
           so an index search over the whole builder would find that
           declaration instead of the cell's real position, silently passing
           on a table whose cells are actually in the wrong order — search
           only the row text so a swapped column can't hide behind an
           unrelated match. */
        const row = /return el\("tr", \{cls:r\.unmatched[\s\S]*?\]\);/.exec(SCRIPT);
        check(!!row, "the preview row builder is readable");
        if(row){
          const name = row[0].indexOf("r.name");
          const grade = row[0].indexOf("gradeCell");
          const group = row[0].indexOf("r.group");
          const role = row[0].indexOf("r.role");
          check(name >= 0 && grade > name && group > grade && role > group,
            "the preview cells are emitted name, grade, group, role — in the order its "
            + "headers promise");
        }
      }

      const prev = /function showPastePreview\(\)[\s\S]*?\n\}/.exec(SCRIPT);
      const conf = /function confirmPaste\(replace\)[\s\S]*?\n\}/.exec(SCRIPT);
      /* parsePasteText takes no group-fallback parameter, so a row with no
         group column simply has none — the honest answer for a row that
         does not say where someone sits. */
      check(prev && /parsePasteText\(\$\("#pasteArea"\)\.value, PASTE_NEW\)/.test(prev[0]),
        "the preview calls parsePasteText with no group fallback — a row with no group column gets none");
      check(prev && !/dropOffice/.test(prev[0]),
        "and the preview reads no standing office default");
      check(prev && /el\("td", \{text:r\.group \|\| "—"\}\)/.test(prev[0]),
        "the preview shows r.group");
      /* r.group is still the raw text parsePasteText put in the row (the
         paste dialog's own shape, untouched); what changed is that
         confirmPaste now resolves it to an entity through the app's one
         text->group policy, resolveGroupId, rather than copying the string
         onto the person directly. */
      check(conf && /groupId:\s*resolveGroupId\(state,\s*r\.group\)/.test(conf[0]),
        "and the commit resolves the same r.group through resolveGroupId, so preview and result agree");
      check(prev && /el\("td", \{text:r\.role\s*\|\| "—"\}\)/.test(prev[0]),
        "the preview shows r.role, its fourth cell");
      check(conf && /role:r\.role/.test(conf[0]),
        "and the commit writes r.role itself, not an empty literal");
      check(conf && !/dropOffice/.test(conf[0]) && !/pasteTier/.test(conf[0]),
        "the commit re-reads no field of its own — it writes the rows the preview built");
    }
  }

}catch(e){
  failures.push("the suite threw before finishing: " + ((e && e.message) || e));
}

/* ---- byte builders. These are the formats, written out. ---- */
const PNG_SIG_BYTES = [137, 80, 78, 71, 13, 10, 26, 10];
const be32bytes = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

/* signature + a 13-byte IHDR carrying the dimensions, which is all a decoder
   needs to know how much to allocate */
function pngBytes(w, h){
  return PNG_SIG_BYTES
    .concat([0, 0, 0, 13])                       // IHDR length
    .concat([0x49, 0x48, 0x44, 0x52])            // "IHDR"
    .concat(be32bytes(w), be32bytes(h))
    .concat([8, 6, 0, 0, 0])                     // depth, colour, compression, filter, interlace
    .concat([0, 0, 0, 0]);                       // CRC
}

/* SOI, a JFIF APP0 the walk has to step over, the frame header, a scan header
   and EOI. `sof` picks the frame marker: 0xC0 baseline, 0xC2 progressive. */
function jpegBytes(w, h, sof){
  const app0 = [0xFF, 0xE0, 0x00, 0x10,
                0x4A, 0x46, 0x49, 0x46, 0x00,    // "JFIF\0"
                0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const frame = [0xFF, sof === undefined ? 0xC0 : sof, 0x00, 0x11, 0x08,
                 (h >> 8) & 255, h & 255,
                 (w >> 8) & 255, w & 255,
                 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const scan = [0xFF, 0xDA, 0x00, 0x0C, 0x03,
                0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3F, 0x00];
  return [0xFF, 0xD8].concat(app0, frame, scan, [0xFF, 0xD9]);
}

/* ---------------------------------------------------------- 9. image limits */

/* processImage decides how much memory a dropped file is allowed to cost.
   Scaling by the short edge alone would let a 20000x400 panorama produce a
   20000px-wide canvas — 32 MB of pixels for one face — so the limit has to
   bind on the long edge instead. Image, FileReader and the canvas are stubs,
   because what is under test is the arithmetic rather than a decoder — but
   the FileReader hands over a REAL PNG declaring the dimensions under test,
   and the module carries the real header preflight, because processImage
   refuses on the header long before it reaches its own scaling. Stubbing
   that preflight out would leave this section asserting a route the app
   does not take.

   This section finishes asynchronously, so it owns the call to report(). */
{
  const IMG = new Function(
    ["PHOTO_SHORT","PHOTO_LONG","PHOTO_MAX_BYTES","PHOTO_MAX_EDGE","LIMITS","HEX6",
     /* what the header preflight reads the bytes with */
     "PHOTO_SCAN_BYTES","B64_ALPHABET","B64_VALUES","PNG_SIGNATURE","JPEG_MAX_SEGMENTS"]
      .map(grabConst).join("\n") + "\n" +
    ["validatePhoto","photoBytes","be32","pngHeaderSize","isSofMarker","jpegHeaderSize",
     "photoHeader","photoSizeProblem","sizeMatchesHeader"].map(grabFn).join("\n") + "\n" +
    "let NEXT = {w:0, h:0, url:''};\n" +
    /* the reader returns the bytes the case is about, so photoHeader parses a
       real IHDR rather than a value this suite made up */
    "function FileReader(){ const self = this;\n" +
    "  this.readAsDataURL = function(){ self.result = NEXT.url; self.onload && self.onload(); };\n" +
    "}\n" +
    "function Image(){ const self = this;\n" +
    "  Object.defineProperty(this, 'src', {set(){\n" +
    "    self.width = NEXT.w; self.height = NEXT.h;\n" +
    "    self.onload && self.onload();\n" +
    "  }});\n" +
    "}\n" +
    "const document = { createElement(){ return {width:0, height:0,\n" +
    "  getContext(){ return {drawImage(){}}; },\n" +
    "  toDataURL(){ return 'data:image/jpeg;base64,' + 'A'.repeat(64); } }; } };\n" +
    grabFn("processImage") + "\n" +
    "return {processImage,\n" +
    "        limits:{PHOTO_SHORT, PHOTO_LONG, PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, LIMITS},\n" +
    "        setSource(w, h, url){ NEXT = {w:w, h:h, url:url}; }};"
  )();

  const L = IMG.limits;
  const results = {};
  /* PNG, and the file says so: the type check picks the parser and the parser
     proves the type, so a mock claiming "image/jpeg" over PNG bytes would be
     refused for lying rather than for the limit under test. */
  function record(label, w, h, size){
    const url = M.dataUrl("png", pngBytes(w, h));
    IMG.setSource(w, h, url);
    return IMG.processImage({type: "image/png", name: label + ".png",
                             size: size === undefined ? 1000 : size})
      .then(r => { results[label] = {ok:true,  r:r}; },
            e => { results[label] = {ok:false, why:(e && e.message) || String(e)}; });
  }

  const ACCEPT = [["portrait",800,1200], ["small",120,90], ["square",1000,1000],
                  /* right at the shape limit, and wide enough that the long edge
                     rather than the short one decides the scale */
                  ["wide",3000,400]];
  /* Each of these has to reach a DIFFERENT rule, which means staying inside
     every limit but the one under test. The dimensions are derived from
     LIMITS — the header preflight is what a real file meets first, and it is
     stricter than processImage's own PHOTO_MAX_* constants — so tightening a
     limit moves these cases with it instead of silently collapsing them all
     onto whichever rule happens to fire first. */
  const D = L.LIMITS.photoDim, AREA = L.LIMITS.photoArea, RATIO = L.LIMITS.photoRatio;
  const REFUSE = [["too wide", D + 1, 100, undefined],
                  /* both edges legal, the product is not */
                  ["too many pixels", D, Math.ceil(AREA / D) + 1, undefined],
                  ["zero size", 0, 0, undefined],
                  ["huge file", 800, 600, L.PHOTO_MAX_BYTES + 1],
                  /* inside every size limit — only the shape guard catches
                     these, and it is the whole point of it */
                  ["panorama", D, Math.floor(D / (RATIO + 1)), undefined],
                  ["tall strip", Math.floor(D / (RATIO + 1)), D, undefined]];

  const runs = ACCEPT.map(([n,w,h]) => record(n,w,h))
    .concat(REFUSE.map(([n,w,h,size]) => record(n,w,h,size)));

  /* held in a binding so the block does not evaluate to a Promise — osascript
     prints a trailing expression value, and "[object Promise]" after a clean run
     reads like an error */
  const pending = Promise.all(runs).catch(e => {
    failures.push("the image-limit section threw: " + ((e && e.message) || e));
  }).then(() => {
    for(const [name] of ACCEPT){
      const r = results[name];
      check(r && r.ok, "processImage accepts a " + name + (r && r.why ? " — rejected: " + r.why : ""));
    }

    /* the point of the whole change: no stored edge may exceed PHOTO_LONG */
    for(const [name] of ACCEPT){
      const out = results[name] && results[name].r;
      if(!out) continue;
      check(Math.max(out.w, out.h) <= L.PHOTO_LONG,
        name + ": the long edge is capped at " + L.PHOTO_LONG + " — got " + out.w + "x" + out.h);
      check(out.w >= 1 && out.h >= 1, name + ": neither edge collapses to zero");
      check(Number.isFinite(out.w) && Number.isFinite(out.h), name + ": both edges are finite");
    }

    /* the long-edge cap is what stops a 3000px source allocating a 3000px canvas */
    const wide = results["wide"] && results["wide"].r;
    check(wide && wide.w === L.PHOTO_LONG,
      "a wide image is scaled by its LONG edge to " + L.PHOTO_LONG + " — got "
      + (wide ? wide.w + "x" + wide.h : "nothing"));
    check(wide && wide.h < L.PHOTO_SHORT,
      "and its short edge ends up under " + L.PHOTO_SHORT + ", proving the long edge decided");

    /* the shape guard, and that it says something actionable */
    check(/long and thin/.test((results["panorama"] || {}).why || ""),
      "a panorama is refused for its shape, not for a size it does not exceed");
    check(/long and thin/.test((results["tall strip"] || {}).why || ""),
      "a tall strip is refused the same way");

    const small = results["small"] && results["small"].r;
    check(small && small.w === 120 && small.h === 90,
      "an image smaller than the target is never upscaled — got "
      + (small ? small.w + "x" + small.h : "nothing"));

    const portrait = results["portrait"] && results["portrait"].r;
    check(portrait && Math.min(portrait.w, portrait.h) === L.PHOTO_SHORT,
      "an ordinary portrait is still scaled by its short edge to " + L.PHOTO_SHORT
      + " — got " + (portrait ? portrait.w + "x" + portrait.h : "nothing"));

    for(const [name] of REFUSE){
      const r = results[name];
      check(r && !r.ok, "processImage refuses " + name);
      check(r && r.why && r.why.length > 0, "refusing " + name + " explains why");
    }
    const why = n => (results[n] || {}).why || "";
    check(new RegExp("about " + Math.round(L.PHOTO_MAX_BYTES / 1e6) + " MB").test(why("huge file")),
      "the file-size refusal names the limit — got " + JSON.stringify(why("huge file")));
    check(new RegExp("over the " + D + " px limit").test(why("too wide")),
      "the absurd-dimension refusal names the bound it broke — got " + JSON.stringify(why("too wide")));
    check(/megapixel/.test(why("too many pixels")),
      "the area refusal names megapixels — got " + JSON.stringify(why("too many pixels")));
    /* A PNG cannot declare a zero edge and still be a PNG: IHDR is read before
       any of the size rules, and it refuses 0×0 as malformed. So the honest
       assertion is that the bytes are rejected as bytes — processImage's own
       `no pixels` branch is unreachable from a real header, and asserting it
       fired would be asserting a route the app does not take. */
    check(/not a valid JPEG or PNG/.test(why("zero size")),
      "a zero-pixel image is refused by the header parser, before any size rule — got "
      + JSON.stringify(why("zero size")));

    /* Why the four dimension cases above are phrased against LIMITS and not
       against PHOTO_MAX_EDGE: the header preflight runs first and is stricter,
       so processImage's own copy never decides anything. If that ever reverses,
       this expectation is wrong and says so. (Area and ratio are read from
       LIMITS.photoArea/photoRatio directly, with no independent
       PHOTO_MAX_AREA/RATIO copy to compare against — PHOTO_MAX_EDGE is the
       one constant still independent of LIMITS, and the one case this check
       still has something to say about.) */
    check(D < L.PHOTO_MAX_EDGE,
      "the header limit is the binding one, which is why it is the limit asserted — "
      + "photoDim " + D + " vs PHOTO_MAX_EDGE " + L.PHOTO_MAX_EDGE);

    /* §10 is asynchronous too, and it owns the report */
    return decodingSection();
  });
}

/* ---------------------------------------------------------- 10. photos are decoded

   validatePhoto can only prove the envelope: a jpeg or png data URL, legal
   base64, inside the byte limit. Two things it cannot see are exactly the two
   that hurt — whether the bytes are an image at all, and how big that image
   really is — and both were taken on trust from the file until openRoster
   started decoding them.

   Everything below runs through the real openRoster against the real Image
   decoder stub, which reads JPEG SOF and PNG IHDR out of the actual bytes. */
async function decodingSection(){
  try{
    const JPEG_URL = JPEG;
    const PNG_URL  = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
                   + "AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    /* the right envelope around bytes that are not an image; the same pair the
       photos.json fixture carries, built here so the unit test does not depend
       on the fixture and vice versa */
    const BAD_JPEG = "data:image/jpeg;base64,dGhpcyBpcyBub3QgYSBKUEVHIGF0IGFsbC4=";
    const BAD_PNG  = "data:image/png;base64,UE5HPyBubyEgZWlnaHQgYnl0ZXMgb2Ygbm90aGluZw==";

    /* -------- 10a. decodeImage tells the truth about the bytes */
    {
      const jpg = await M.decodeImage(JPEG_URL);
      check(jpg && jpg.w === 1 && jpg.h === 1,
        "decodeImage reads a real JPEG's size out of the bytes — got " + json(jpg));
      const png = await M.decodeImage(PNG_URL);
      check(png && png.w === 1 && png.h === 1,
        "decodeImage reads a real PNG's size out of the bytes — got " + json(png));

      eq(await M.decodeImage(BAD_JPEG), null, "a JPEG data URL full of text does not decode");
      eq(await M.decodeImage(BAD_PNG),  null, "a PNG data URL full of text does not decode");
      eq(await M.decodeImage("data:image/jpeg;base64,"
        + "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4="), null,
        "an SVG document wearing a JPEG label does not decode");
      eq(await M.decodeImage(null), null, "decodeImage refuses null without calling a decoder");
      eq(await M.decodeImage("https://example.invalid/x.png"), null,
        "decodeImage refuses a remote URL");
      eq(await M.decodeImage("data:image/svg+xml;base64,PHN2Zy8+"), null,
        "decodeImage refuses an SVG data URL");
    }

    /* -------- 10b. the size limits, at their boundaries */
    {
      const L = M.LIMITS;
      const problem = (w, h) => M.photoSizeProblem(w, h);
      eq(problem(400, 300), null, "an ordinary photo has no size problem");
      eq(problem(L.photoDim, 1000), null, "a photo exactly at the edge limit is accepted");
      check(/over the 8000 px limit/.test(problem(L.photoDim + 1, 1000) || ""),
        "one pixel over the edge limit is refused, and the message names the limit — got "
        + json(problem(L.photoDim + 1, 1000)));
      check(/megapixel/.test(problem(7000, 7000) || ""),
        "49 megapixels inside the edge limit is still refused for area — got "
        + json(problem(7000, 7000)));
      eq(problem(1000, 100), null, "a photo exactly at the shape limit is accepted");
      check(/long and thin/.test(problem(2000, 100) || ""),
        "a 20:1 strip is refused for its shape — got " + json(problem(2000, 100)));
      eq(problem(1, 1), null, "a 1x1 image is legal, if pointless");
    }

    /* -------- 10c. the fixture, end to end */
    {
      const r = await M.openRoster(fixture("photos"));
      check(r.ok, "photos.json is accepted" + (r.ok ? "" : " — refused: " + r.reason));
      if(r.ok){
        const by = n => r.state.people.find(p => p.name === n);
        eq(r.state.people.length, 7, "every person survives, whatever their photo did");

        const jpg = by("Valid Jpeg"), png = by("Valid Png");
        check(jpg && jpg.photo, "a valid JPEG keeps its photo");
        check(jpg && jpg.pw === 1 && jpg.ph === 1,
          "and carries the decoded size — got " + (jpg ? jpg.pw + "x" + jpg.ph : "nothing"));
        check(png && png.photo, "a valid PNG keeps its photo");
        check(png && png.pw === 1 && png.ph === 1,
          "and carries the decoded size — got " + (png ? png.pw + "x" + png.ph : "nothing"));

        for(const name of ["Corrupt Jpeg", "Corrupt Png", "Svg Wearing Jpeg"]){
          const p = by(name);
          check(p, name + " is still in the roster");
          check(p && p.photo === null, name + " loses only the photo");
          check(p && p.pw === 0 && p.ph === 0 && p.frame === null,
            name + " leaves no orphan dimensions or frame behind");
          check(r.repaired.some(w => w.indexOf(name) >= 0 && /not a readable image/.test(w)),
            name + " is named in the report, with the reason");
        }

        const lying = by("Lying Dimensions");
        check(lying && lying.photo, "a real photo with invented dimensions keeps the photo");
        check(lying && lying.pw === 1 && lying.ph === 1,
          "and the decoded size replaces what the file claimed — got "
          + (lying ? lying.pw + "x" + lying.ph : "nothing"));
        check(r.repaired.some(w => /Lying Dimensions/.test(w) && /400×300/.test(w)),
          "the correction is reported, naming both sizes: "
          + json(r.repaired.filter(w => /Lying/.test(w))));
        /* the frame was legal against the claimed 400x300 (pan limit 1.0) and
           is not against the real 1x1 (pan limit 0.5), so a frame still sitting
           at 0.9 means nothing re-clamped it and the crop points outside the
           picture */
        eq(lying && lying.frame && lying.frame.ox, 0.5,
          "and the frame is re-clamped against dimensions that are now real");
        eq(lying && lying.frame && lying.frame.oy, -0.45,
          "while an offset that was legal all along is left alone");

        const none = by("No Photo");
        check(none && none.photo === null && none.frame === null,
          "the person with no photo is untouched");
        check(!r.repaired.some(w => /No Photo/.test(w)),
          "and is not reported as repaired");
      }
    }

    /* -------- 10d. oversized images, built rather than committed */
    {
      const person = (name, photo) => ({id:"x-" + name, name:name, tierId:"t1",
        office:"FRA", role:"", photo:photo, pw:240, ph:240,
        frame:{zoom:1, ox:0, oy:0}});
      const r = await M.openRoster(json(ok({people: [
        person("Too Wide",   M.pngDataUrl(12000, 1000)),
        person("Too Many",   M.pngDataUrl(7000, 7000)),
        person("Too Thin",   M.pngDataUrl(2000, 100)),
        person("Just Right", M.pngDataUrl(1200, 1600))
      ]})));
      check(r.ok, "a roster whose photos are too large is accepted, not refused"
        + (r.ok ? "" : " — refused: " + r.reason));
      if(r.ok){
        const by = n => r.state.people.find(p => p.name === n);
        for(const [name, why] of [["Too Wide", /px limit/], ["Too Many", /megapixel/],
                                  ["Too Thin", /long and thin/]]){
          const p = by(name);
          check(p && p.photo === null, name + ": the oversized photo is dropped");
          check(p && p.pw === 0 && p.ph === 0, name + ": and its dimensions with it");
          check(r.repaired.some(w => w.indexOf(name) >= 0 && why.test(w)),
            name + ": the report says what was wrong with it — "
            + json(r.repaired.filter(w => w.indexOf(name) >= 0)));
        }
        const good = by("Just Right");
        check(good && good.photo, "a large but legal photo is kept");
        check(good && good.pw === 1200 && good.ph === 1600,
          "with its true dimensions, not the 240x240 the file claimed — got "
          + (good ? good.pw + "x" + good.ph : "nothing"));
      }
    }

    /* -------- 10e. structure is still proven first, and refusals are still whole */
    {
      const before = M.decoded().length;
      const bad = await M.openRoster(fixture("malformed"));
      check(!bad.ok, "openRoster still refuses a file that is not JSON");
      check(bad.state === undefined, "and returns no state to adopt");
      eq(M.decoded().length, before,
        "a structurally invalid file is refused before anything is handed to a decoder");

      /* a person pointing at a grade that does not exist is fatal even though
         every photo in the file is perfect — the two halves do not trade off */
      const orphan = await M.openRoster(json(ok({
        people: [{id:"p", name:"Lost", tierId:"nope", photo:JPEG_URL, pw:1, ph:1}]})));
      check(!orphan.ok, "a broken reference is fatal regardless of the photos");
    }

    /* -------- 10f. nothing but our own two formats ever reaches a decoder */
    {
      const all = M.decoded();
      check(all.length > 0, "the decoder was actually exercised — " + all.length + " loads");
      check(all.every(s => /^data:image\/(jpeg|png);base64,/.test(String(s))),
        "every string handed to an image decoder is a jpeg or png data URL");
      check(!all.some(s => /svg/i.test(String(s).slice(0, 40))),
        "no SVG data URL is ever loaded");
      check(!all.some(s => /^https?:|^\/\//i.test(String(s))),
        "no remote URL is ever loaded");
    }

    await preflightSection();
  }catch(e){
    failures.push("the decoding section threw: " + ((e && e.message) || e));
  }
  report();
}

/* ---------------------------------------------------------- 11. the header is
   read before the browser decodes anything

   §10 proved the app learns a photo's real size. It learned it from the
   decoder, which is to say after the decoder had already allocated the pixels
   — and it is the allocation that costs. A PNG header is thirty-three bytes
   and may honestly declare 60000x60000, which is fourteen gigabytes of RGBA
   for a file that fits in a tweet.

   So the format and the size are now read out of the bytes first. Everything
   below is built from real byte structures — signatures, chunk lengths, JPEG
   marker segments — and never from a table of known-good strings: a lookup
   table would keep passing after the app stopped parsing anything at all.

   The assertion that matters most in this whole file is the last one in each
   rejection case: `Image.src` was never assigned. */

/* The byte builders live above §9, which needs them too — §9 runs during the
   file's initial evaluation, and a `const` down here would still be in its
   temporal dead zone by then. */

async function preflightSection(){
  const png  = (w, h)      => M.dataUrl("png",  pngBytes(w, h));
  const jpeg = (w, h, sof) => M.dataUrl("jpeg", jpegBytes(w, h, sof));

  /* Wraps a decode so the assertion "and never touched the decoder" can be made
     about it. The count is taken immediately before, so unrelated decoding
     elsewhere in the suite cannot make a rejection look clean. */
  async function withoutDecoding(label, run){
    const before = M.decoded().length;
    const got = await run();
    return {got: got, touched: M.decoded().length - before, label: label};
  }

  /* -------- 11a. the headers are parsed for real */
  {
    const p = M.photoHeader(png(640, 480));
    check(p && p.w === 640 && p.h === 480,
      "a PNG's dimensions are read out of its IHDR — got " + json(p));
    const b = M.photoHeader(jpeg(1024, 768, 0xC0));
    check(b && b.w === 1024 && b.h === 768,
      "a baseline JPEG's dimensions are read out of its SOF0 — got " + json(b));
    const g = M.photoHeader(jpeg(800, 1200, 0xC2));
    check(g && g.w === 800 && g.h === 1200,
      "a progressive JPEG's dimensions are read out of its SOF2 — got " + json(g));

    /* the other frame markers browsers read, and the three holes in the range
       that are not frames at all */
    for(const sof of [0xC1, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]){
      const r = M.photoHeader(jpeg(300, 200, sof));
      check(r && r.w === 300 && r.h === 200,
        "SOF marker 0x" + sof.toString(16).toUpperCase() + " is recognised as a frame");
    }
    for(const notSof of [0xC4, 0xC8, 0xCC]){
      const r = M.photoHeader(jpeg(300, 200, notSof));
      eq(r, null, "marker 0x" + notSof.toString(16).toUpperCase()
        + " is a table, not a frame — no dimensions are read out of it");
    }

    /* a header that runs past the scan window is not a header we have */
    check(M.PHOTO_SCAN_BYTES > 0 && M.PHOTO_SCAN_BYTES <= 4 * 1024 * 1024,
      "the scan window is bounded — " + M.PHOTO_SCAN_BYTES + " bytes");
  }

  /* -------- 11b. corrupt, truncated and nonsensical bytes */
  {
    const CASES = [
      ["corrupt JPEG bytes", M.dataUrl("jpeg", [0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77])],
      ["corrupt PNG bytes",  M.dataUrl("png",  [0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
                                                0, 0, 0, 13, 1, 2, 3, 4, 0, 0, 1, 0, 0, 0, 1, 0])],
      /* SOI, then an APP0 claiming 0x4000 bytes that are not there */
      ["a truncated JPEG marker segment",
        M.dataUrl("jpeg", [0xFF, 0xD8, 0xFF, 0xE0, 0x40, 0x00, 0x4A, 0x46, 0x49, 0x46])],
      /* SOI and a frame marker with nothing behind it */
      ["a JPEG cut off inside its SOF",
        M.dataUrl("jpeg", [0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x01])],
      ["a truncated PNG IHDR", M.dataUrl("png", pngBytes(640, 480).slice(0, 20))],
      /* the signature and the chunk type are right; the chunk claims a length
         IHDR is not allowed to have */
      ["a PNG whose IHDR is the wrong length",
        M.dataUrl("png", PNG_SIG_BYTES.concat([0, 0, 0, 9], [0x49, 0x48, 0x44, 0x52],
          be32bytes(640), be32bytes(480), [8, 6, 0, 0, 0], [0, 0, 0, 0]))],
      ["a PNG with no IHDR first", M.dataUrl("png",
        PNG_SIG_BYTES.concat([0, 0, 0, 13], [0x73, 0x52, 0x47, 0x42],   // "sRGB"
          be32bytes(640), be32bytes(480), [8, 6, 0, 0, 0], [0, 0, 0, 0]))],
      ["a JPEG with no SOI", M.dataUrl("jpeg", jpegBytes(640, 480).slice(2))],
      ["a JPEG that reaches its scan with no frame", M.dataUrl("jpeg",
        [0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x0C, 3, 1, 0, 2, 17, 3, 17, 0, 63, 0])],
      ["a PNG of zero width",  M.dataUrl("png",  pngBytes(0, 480))],
      ["a PNG of zero height", M.dataUrl("png",  pngBytes(640, 0))],
      ["a JPEG of zero width",  M.dataUrl("jpeg", jpegBytes(0, 480))],
      ["a JPEG of zero height", M.dataUrl("jpeg", jpegBytes(640, 0))],

      /* -------- 11c. the label does not decide which parser runs */
      ["JPEG bytes labelled as PNG", M.dataUrl("png",  jpegBytes(640, 480))],
      ["PNG bytes labelled as JPEG", M.dataUrl("jpeg", pngBytes(640, 480))],
      ["an SVG document labelled as JPEG",
        "data:image/jpeg;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4="],
      ["an SVG document labelled as PNG",
        "data:image/png;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4="],
      ["a paragraph of text labelled as JPEG",
        "data:image/jpeg;base64,dGhpcyBpcyBub3QgYSBKUEVHIGF0IGFsbC4="],
      ["a paragraph of text labelled as PNG",
        "data:image/png;base64,UE5HPyBubyEgZWlnaHQgYnl0ZXMgb2Ygbm90aGluZw=="]
    ];

    for(const [label, url] of CASES){
      eq(M.photoHeader(url), null, "no header is read out of " + label);
      const r = await withoutDecoding(label, () => M.decodeImage(url));
      eq(r.got, null, "decodeImage refuses " + label);
      eq(r.touched, 0, "and " + label + " never reaches Image.src");
    }
  }

  /* -------- 11d. the size limits, applied to the header */
  {
    const L = M.LIMITS;
    const OVER = [
      ["an edge over the limit",  png(L.photoDim + 1, 1000), /px limit/],
      ["a JPEG edge over the limit", jpeg(L.photoDim + 1, 1000), /px limit/],
      ["an area over the limit",  png(7000, 7000),           /megapixel/],
      ["a ratio over the limit",  png(2000, 100),            /long and thin/],
      /* the case the whole change exists for: a header three dozen bytes long
         declaring more pixels than the machine has memory for */
      ["an absurd PNG",           png(60000, 60000),         /px limit/]
    ];
    for(const [label, url, why] of OVER){
      const head = M.photoHeader(url);
      check(head, "the header of " + label + " is still readable — got " + json(head));
      const r = await withoutDecoding(label, () => M.decodeImage(url));
      check(r.got && r.got.problem, "decodeImage refuses " + label
        + " — got " + json(r.got));
      check(r.got && why.test(r.got.problem || ""),
        "and says why, in the words the report uses — got " + json(r.got && r.got.problem));
      eq(r.touched, 0,
        "AND REFUSES IT BEFORE Image.src — " + label + " must never be decoded");
    }

    /* the boundary, so the limit is a limit and not an approximation */
    {
      const at = png(L.photoDim, 1000);
      const r = await withoutDecoding("an edge exactly at the limit", () => M.decodeImage(at));
      check(r.got && r.got.w === L.photoDim, "a photo exactly at the edge limit is accepted"
        + " — got " + json(r.got));
      eq(r.touched, 1, "and IS decoded, because only a refusal skips the decoder");
    }
  }

  /* -------- 11e. and the ordinary path still works */
  {
    for(const [label, url, w, h] of [
      ["a baseline JPEG",    jpeg(1024, 768, 0xC0), 1024, 768],
      ["a progressive JPEG", jpeg(800, 1200, 0xC2), 800, 1200],
      ["a PNG",              png(640, 480),          640, 480]
    ]){
      const r = await withoutDecoding(label, () => M.decodeImage(url));
      check(r.got && r.got.w === w && r.got.h === h,
        label + " decodes to its real dimensions — got " + json(r.got));
      eq(r.touched, 1, "and " + label + " is confirmed by the browser exactly once");
    }
  }

  /* -------- 11f. the decoder still has the last word */
  {
    /* A header can be perfect and the rest of the file still unreadable —
       truncated image data, a corrupt compressed stream. Preflight is a gate,
       not a substitute for decoding. */
    {
      const url = png(400, 300);
      M.refuseDecode(url);
      const r = await withoutDecoding("a valid header the decoder cannot finish",
        () => M.decodeImage(url));
      eq(r.got, null, "a valid header whose image data the browser rejects is still refused");
      eq(r.touched, 1, "and it took a real decode to find that out");
    }

    /* …and a header can lie about the size of the image behind it, which is the
       same trick one level down: pass the limits with a small header, deliver a
       large image. */
    {
      const url = png(401, 300);
      M.decodeAs(url, 9000, 9000);
      const r = await withoutDecoding("a header that disagrees with the decoder",
        () => M.decodeImage(url));
      eq(r.got, null,
        "an image that decodes to dimensions its header did not declare is refused");
    }

    /* the one disagreement that is honest: EXIF orientation transposes a JPEG,
       so the browser reports the SOF dimensions the other way round */
    {
      const url = jpeg(1200, 1600, 0xC0);
      M.decodeAs(url, 1600, 1200);
      const r = await M.decodeImage(url);
      check(r && r.w === 1600 && r.h === 1200,
        "an EXIF-rotated JPEG keeps its photo, at the dimensions the browser produced — got "
        + json(r));
    }
  }

  /* -------- 11g. cancellation, at both of the points it can arrive */
  {
    const never  = () => false;
    const always = () => true;

    {
      const r = await withoutDecoding("a decode cancelled before it starts",
        () => M.decodeImage(png(320, 240), always));
      eq(r.got, M.DECODE_CANCELLED, "a cancelled decode says so, distinctly from a refusal");
      eq(r.touched, 0, "and never touches the decoder");
    }
    {
      const r = await M.decodeImage(png(321, 241), never);
      check(r && r.w === 321, "an uncancelled decode is unaffected — got " + json(r));
    }

    /* between two photos: the roster has three, and the decision to give up is
       taken while the first one is in flight */
    {
      const roster = ok({people: [
        {id:"a", name:"First",  tierId:"t1", office:"", role:"", photo:png(410, 310), pw:410, ph:310},
        {id:"b", name:"Second", tierId:"t1", office:"", role:"", photo:png(510, 410), pw:510, ph:410},
        {id:"c", name:"Third",  tierId:"t1", office:"", role:"", photo:png(610, 510), pw:610, ph:510}
      ]});

      /* "a newer Open arrived while the first photo was in the decoder", said
         exactly: false until one photo has been handed over, true from then on.
         Counting calls to the predicate instead would be counting an
         implementation detail of where the checks happen to sit. */
      /* the same run twice: once through decodeRosterPhotos, to look at what a
         cancellation did to the half-built roster, and once through the whole
         door, to look at the verdict */
      {
        const before = M.decoded().length;
        const built = M.parseAndValidateRoster(json(roster));
        const finished = await M.decodeRosterPhotos(built.state, built.repaired,
          () => M.decoded().length > before);
        eq(finished, false, "decodeRosterPhotos reports that it did not finish");
        eq(M.decoded().length - before, 1, "having decoded one photo of the three");
        /* The photo that was in the decoder when the cancellation landed must
           not be written back. Its answer is about a document nobody is waiting
           for, and `false` from this function is only worth anything if it also
           means "and I changed nothing on the way to saying so" — otherwise a
           later caller that kept the object would find one corrected size, two
           untouched ones, and no way to tell which was which. */
        eq(built.state.people[0].pw, 410,
          "the photo that was mid-decode when the Open was cancelled is left exactly as it was");
        eq(built.state.people[0].ph, 310, "in both dimensions");
        eq(built.state.people[1].pw, 510, "and the photos it never reached are untouched");
        eq(built.repaired.length, 0, "and a cancelled run reports no repairs");
      }

      const before = M.decoded().length;
      const r = await M.openRoster(json(roster), {cancelled: () => M.decoded().length > before});

      eq(M.decoded().length - before, 1,
        "a superseded Open stops after the photo it was already decoding — "
        + (M.decoded().length - before) + " of 3 decoded");
      check(r && r.cancelled === true,
        "and reports cancellation rather than a verdict on the file — got " + json(r));
      eq(r.ok, false, "which is not an acceptance");
      eq(r.reason, undefined,
        "and carries no reason, because there is nothing wrong with the file to report");
      eq(r.state, undefined, "and no state to adopt");
    }

    /* cancelled before a single photo is looked at */
    {
      const roster = ok({people: [
        {id:"a", name:"First", tierId:"t1", office:"", role:"", photo:png(420, 320), pw:420, ph:320}
      ]});
      const before = M.decoded().length;
      const r = await M.openRoster(json(roster), {cancelled: always});
      eq(M.decoded().length - before, 0, "an Open cancelled at the door decodes nothing at all");
      check(r && r.cancelled === true, "and says so — got " + json(r));
    }

    /* structure is still fatal, and a cancellation does not disguise it: a file
       that is not a roster is refused with a reason before cancellation is even
       asked about */
    {
      const r = await M.openRoster("{oh dear", {cancelled: always});
      eq(r.ok, false, "a file that is not JSON is still refused");
      check(typeof r.reason === "string" && r.reason.length > 0,
        "with a reason, not as a cancellation — got " + json(r));
      eq(r.cancelled, undefined, "and is not dressed up as one");
    }

    /* an uncancelled Open is untouched by any of this */
    {
      const roster = ok({people: [
        {id:"a", name:"First",  tierId:"t1", office:"", role:"", photo:png(430, 330), pw:0, ph:0},
        {id:"b", name:"Second", tierId:"t1", office:"", role:"", photo:png(530, 430), pw:0, ph:0}
      ]});
      const before = M.decoded().length;
      const r = await M.openRoster(json(roster), {cancelled: never});
      check(r.ok, "an Open nobody cancelled runs to the end"
        + (r.ok ? "" : " — refused: " + r.reason));
      eq(M.decoded().length - before, 2, "decoding every photo in the file");
      check(r.ok && r.state.people[0].pw === 430 && r.state.people[1].pw === 530,
        "and giving each of them its real size");
      /* the default: no options at all, the way every other caller writes it */
      const plain = await M.openRoster(json(roster));
      check(plain.ok, "and openRoster still works with no options object at all");
    }
  }

  /* -------- 11h. photoBytes on its own */
  {
    eq(M.photoBytes("https://example.invalid/x.png"), null,
      "photoBytes refuses a remote URL — it decodes base64, it never fetches");
    eq(M.photoBytes("data:image/svg+xml;base64,PHN2Zy8+"), null, "and an SVG data URL");
    eq(M.photoBytes(null), null, "and null");
    eq(M.photoBytes("data:image/jpeg;base64,AAAAA"), null, "and a truncated base64 quantum");
    {
      const huge = "data:image/png;base64," + "A".repeat(M.LIMITS.photoBytes);
      eq(M.photoBytes(huge), null,
        "and anything over the encoded-byte limit, before it allocates a thing");
    }
    {
      const got = M.photoBytes(png(640, 480));
      check(got && got.mime === "png", "it reports the declared type — got " + json(got && got.mime));
      check(got && got.bytes && got.bytes.length === pngBytes(640, 480).length,
        "and exactly the bytes that were encoded — got "
        + (got && got.bytes ? got.bytes.length : "nothing")
        + ", want " + pngBytes(640, 480).length);
      const want = pngBytes(640, 480);
      check(got && want.every((b, i) => got.bytes[i] === b),
        "byte for byte");
    }
    /* the window is a ceiling on what is allocated, not on what is accepted */
    {
      const big = pngBytes(640, 480).concat(new Array(M.PHOTO_SCAN_BYTES).fill(0x55));
      const got = M.photoBytes(M.dataUrl("png", big));
      check(got && got.bytes.length === M.PHOTO_SCAN_BYTES,
        "a long file is decoded only as far as the scan window — got "
        + (got ? got.bytes.length : "nothing"));
      const head = M.photoHeader(M.dataUrl("png", big));
      check(head && head.w === 640, "and its header still reads correctly — got " + json(head));
    }
  }

  /* -------- 11i. and the standing invariant, re-checked over the whole run */
  {
    const all = M.decoded();
    check(all.every(s => /^data:image\/(jpeg|png);base64,/.test(String(s))),
      "after everything above, every string ever handed to a decoder is still "
      + "a jpeg or png data URL");
  }
}

/* --------------------------------------------------------- 12. the validator
   is not the grade factory

   Every path that CREATES a grade goes through newTier(). The validator
   deliberately does not: it is judging a grade someone else wrote, and its
   per-field defaults exist to decide what was stated and what has to be reported
   as a repair — which a factory that only knows about defaults cannot answer.
   Sharing a constructor between "make a new thing" and "salvage an untrusted
   thing" is how the second quietly starts accepting whatever the first assumes.

   What still has to hold is that the two agree on the SHAPE, because that shape
   is what an Open puts into the document. Compared against a grade the factory
   actually produces, not against a field list written out here: a literal copied
   from either side would be the same source answering for itself. */
{
  const raw = JSON.stringify({tiers:[{id:"x", code:"P", label:"Partner"}], people:[]});
  const res = M.parseAndValidateRoster(raw);
  check(res && res.ok, "a roster stating nothing but one grade opens");
  const opened = (res && res.state && res.state.tiers[0]) || {};
  const made   = M.newTier("P", "Partner");
  eq(Object.keys(opened).sort().join(","), Object.keys(made).sort().join(","),
    "the validator emits exactly the fields a freshly made grade has — got "
    + Object.keys(opened).sort().join(","));
  check(!("role" in opened), "…and no role on the way in");
  /* And it agrees on the VALUES for the fields the file left out, or an opened
     grade and a new one would draw differently from the same silence. */
  for(const k of ["fill", "attach", "merge", "align"]){
    eq(opened[k], made[k],
      "a grade that states no " + k + " opens with the value a new grade gets");
  }
  /* The repair machinery is what the factory would have taken away: a STATED
     unusable value is still repaired and still reported. */
  const bad = JSON.stringify({tiers:[{id:"x", code:"P", label:"Partner", fill:"chartreuse"}],
                              people:[]});
  const rep = M.parseAndValidateRoster(bad);
  check(rep && rep.ok, "a grade stating an unusable fill still opens");
  eq((rep.state.tiers[0] || {}).fill, made.fill, "…repaired to the ordinary default");
  check((rep.repaired || []).some(c => /fill/i.test(c)),
    "…and reported as a repair, which is the job the factory cannot do — got "
    + JSON.stringify(rep && rep.repaired));
}

/* ---------------------------------------------------------- report */

function report(){
  if(failures.length){
    console.log("FAILURES (" + failures.length + "):");
    failures.forEach(f => console.log("  ✗ " + f));
    console.log("\n" + passed + " passed, " + failures.length + " FAILED");
    if(typeof process !== "undefined") process.exit(1);
  }else{
    console.log("all " + passed + " import assertions passed");
  }
}
