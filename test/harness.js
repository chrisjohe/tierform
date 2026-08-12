/* Headless harness for tierform_app.html.
 *
 * Extracts computeLayout and its dependencies straight out of the HTML, stubs
 * the canvas text-measurement context, and asserts real invariants. Syntax
 * checking is NOT enough here: the known failure mode is NaN geometry in a
 * file that parses perfectly, which shows up as a blank chart.
 *
 * Run:  node test/harness.js
 *   or: osascript -l JavaScript test/harness.js     (macOS, no node needed)
 */

/* ---------------------------------------------------------- file loading */

function readFile(path){
  if(typeof require !== "undefined"){                 // node
    return require("fs").readFileSync(path, "utf8");
  }
  ObjC.import("Foundation");                          // JavaScriptCore / JXA
  return $.NSString.stringWithContentsOfFileEncodingError(
    path, $.NSUTF8StringEncoding, null).js;
}
function here(){
  if(typeof __dirname !== "undefined") return __dirname + "/../";
  ObjC.import("Foundation");
  const cwd = $.NSFileManager.defaultManager.currentDirectoryPath.js;
  return cwd + "/";
}

const HTML = readFile(here() + "tierform_app.html");
const SCRIPT = /<script>([\s\S]*)<\/script>/.exec(HTML)[1];

/* ---------------------------------------------------------- extraction */

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

/* pull `function name(...){...}` out of the source by brace matching */
function grabFn(name){
  const start = MASK.search(new RegExp("(^|\\n)(async\\s+)?function\\s+" + name + "\\s*\\("));
  if(start < 0) throw new Error("harness: function " + name + " not found — was it renamed?");
  let i = MASK.indexOf("{", start), depth = 0;
  for(let j = i; j < MASK.length; j++){
    const c = MASK[j];
    if(c === "{") depth++;
    else if(c === "}"){ depth--; if(!depth) return SCRIPT.slice(start, j + 1); }
  }
  throw new Error("harness: unbalanced braces reading " + name);
}
/* pull `const NAME = ...;` up to the semicolon that closes it */
function grabConst(name){
  const re = new RegExp("(^|\\n)const\\s+" + name + "\\s*=");
  const m = re.exec(MASK);
  if(!m) throw new Error("harness: const " + name + " not found — was it renamed?");
  const start = m.index + (m[1] ? 1 : 0);
  let depth = 0;
  for(let j = start; j < MASK.length; j++){
    const c = MASK[j];
    if("{[(".includes(c)) depth++;
    else if("}])".includes(c)) depth--;
    else if(c === ";" && depth === 0) return SCRIPT.slice(start, j + 1);
  }
  throw new Error("harness: unterminated const " + name);
}

const CONSTS = ["FONT","FONTS","PAGES","ANGLES","DENSITY","G","SW","HV","MX","ZOOM_MAX","uid",
                "LIMITS","ANCHORS","HEX6"];
/* Both renderers now sanitise on the way out — xmlText/xmlAttr for the SVG
   string, paint() for every colour, validatePhoto() for every image href — so
   those come along or toSVG/toCanvas cannot be extracted at all. */
const FNS = ["xmlText","xmlAttr","paint","validatePhoto","oneOf","canvasBlob","toPDF",
             "splitName","initials","tierOf","tierRole","subline",
             "withAlpha","angleIndex","codeParts","frameRect","frameLimit",
             /* computeLayout is now a dispatcher on state.layout; the pyramid,
                tornado and histogram geometry all live behind the shared
                band-stack machinery (buildBandGroups, buildBandStack,
                emitHeaderTexts, emitBandPeople) that computeTriangleLayout and
                computeHistogramLayout both call, so all of it comes along or
                the dispatcher calls a function that is not here. */
             "clampFrame","computeLayout","gradeHeadingTexts",
             "buildBandGroups","buildBandStack","emitHeaderTexts","emitBandPeople",
             "computeTriangleLayout","computeHistogramLayout",
             "computePyramidLayout","computeTornadoLayout","computeSwimlaneLayout",
             "computeHiveLayout","computeMatrixLayout",
             /* nameSegs is the one place a name's Bold weighting is chosen;
                the geometry engines and fitName call it, so it comes along
                with them or they cannot be extracted at all. */
             "nameSegs","ellipsize","fitName","toSVG","toCanvas",
             /* the shared measurement helpers the geometry engines call
                while sizing a person's label and the header text. */
             "personLabelWidth","headNeedWidth",
             /* the one function that turns state.font into a drawable stack;
                personLabelWidth, headNeedWidth, gradeHeadingTexts and both
                geometry engines all call it. */
             "docFont",
             "normalizeGradeLinks",
             /* subline reads a person's group through groupLabel, which reads
                state.groups through the same id-matching policy resolveGroupId
                writes with (and pruneGroups garbage-collects). All four come
                along together or subline cannot be extracted at all. */
             "newGroup","resolveGroupId","groupLabel","pruneGroups","clampText"];

/* Stubs stand in for the browser. measureText is the important one: every
   width in the layout is driven by it, so it must return finite numbers. Its
   width MODEL is length-only — length * px * 0.5 — and does not react to the
   weight token in meas.font at all, so it cannot tell a 600 from a 400: two
   settings that measure the same characters always come out the same width
   here no matter which weight either engine actually used. MEAS_LOG exists
   because of that gap. It is not a second width model — it changes nothing
   about what measureText returns — it is a record of every (font, text) pair
   actually passed to it, which is what lets a test read the WEIGHT a measure
   site used back out, instead of trying to infer it from a width the stub
   cannot vary. */
const PREAMBLE = `
  let state = null;
  const MEAS_LOG = [];
  const meas = {
    font: "",
    measureText(t){
      const px = parseFloat(/([\\d.]+)px/.exec(this.font) ? /([\\d.]+)px/.exec(this.font)[1] : 12);
      MEAS_LOG.push({font: this.font, text: String(t == null ? "" : t)});
      return {width: String(t == null ? "" : t).length * px * 0.5};
    }
  };
  const fontsReady = Promise.resolve();
  const DRAWN = [];                       // every drawImage the canvas renderer makes
  function loadImg(src){ return Promise.resolve({__img: src}); }
  /* JPEG_BYTES stands in for the encoder output: toPDF only has to embed it
     verbatim and get the byte offsets right, which is exactly what breaks. */
  const JPEG_BYTES = new Uint8Array([0xFF,0xD8,0xFF,0xE0,0,16,74,70,73,70,0,1,1,0,0,1,0,1,0,0,0xFF,0xD9]);
  /* JavaScriptCore has no TextEncoder; toPDF only ever encodes ASCII PDF
     syntax, so a byte-per-char encoder is exactly equivalent here. */
  function TextEncoder(){
    this.encode = function(str){
      const out = new Uint8Array(str.length);
      for(let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
      return out;
    };
  }
  function Blob(parts, opts){
    this.parts = parts; this.type = (opts && opts.type) || "";
    this.arrayBuffer = function(){ return Promise.resolve(JPEG_BYTES.buffer); };
  }
  const document = {
    createElement(){ return {
      width: 0, height: 0,
      getContext(){ return CTX; },
      toDataURL(){ return "data:,"; },
      toBlob(cb, type, q){ cb(new Blob([JPEG_BYTES], {type: type})); }
    }; },
    getElementById(){ return {textContent: ""}; }
  };
  const CTX = {
    font: "", textAlign: "", textBaseline: "", fillStyle: "", strokeStyle: "", lineWidth: 0,
    save(){}, restore(){}, scale(){}, translate(){},
    beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, arc(){}, rect(){}, roundRect(){},
    clip(){}, fill(){}, stroke(){}, fillRect(){}, fillText(){},
    measureText(t){ return meas.measureText(t); },
    drawImage(img, x, y, w, h){ DRAWN.push({src: img && img.__img, x: x, y: y, w: w, h: h}); }
  };
`;

const MODULE = new Function(
  PREAMBLE +
  CONSTS.map(grabConst).join("\n") + "\n" +
  FNS.map(grabFn).join("\n") + "\n" +
  "return {computeLayout, computePyramidLayout, computeTornadoLayout, computeHistogramLayout, computeSwimlaneLayout, computeHiveLayout, computeMatrixLayout, ellipsize," +
  " nameSegs, fitName," +
  " toSVG, toCanvas, toPDF, frameRect, frameLimit, clampFrame," +
  " newGroup, resolveGroupId, groupLabel, pruneGroups, subline," +
  " ZOOM_MAX, PAGES, G, SW, HV, DRAWN, MEAS_LOG, JPEG_BYTES, setState(s){ state = s; }};"
)();

/* ---------------------------------------------------------- assertions */

let passed = 0;
const failures = [];
function check(cond, msg){
  if(cond) passed++;
  else failures.push(msg);
}
function eq(a, b, msg){ check(a === b, msg + " — got " + a + ", want " + b); }
function near(a, b, msg, tol){
  tol = tol || 1e-9;
  check(Math.abs(a - b) <= tol, msg + " — got " + a + ", want " + b);
}

/* walk anything and flag a non-finite number, wherever it hides */
function allFinite(node, path, out){
  if(typeof node === "number"){ if(!isFinite(node)) out.push(path); return; }
  if(Array.isArray(node)){ node.forEach((v, i) => allFinite(v, path + "[" + i + "]", out)); return; }
  if(node && typeof node === "object"){
    for(const k of Object.keys(node)){
      if(k === "src" || k === "data") continue;             // data URLs, not geometry
      allFinite(node[k], path + "." + k, out);
    }
  }
}

/* ---------------------------------------------------------- fixtures */

/* A real 1x1 JPEG. Both renderers now refuse any src that is not one of the
   two data-URL formats the app itself writes, so a bare placeholder would be
   dropped before it reached drawImage and the agreement test below would
   have nothing to compare. Every photo fixture shares this one value: the
   assertions compare geometry, never source identity. */
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL"
  + "DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA"
  + "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let idn = 0;
const nid = () => "id" + (++idn);
function tier(code, label, o){
  o = o || {};
  return {id: nid(), code: code, label: label, role: o.role || label,
          fill: o.fill || "green", attach: !!o.attach, merge: !!o.merge,
          align: o.align || "center"};
}
function person(tierId, o){
  o = o || {};
  return {id: nid(), name: o.name || "Test Person", tierId: tierId,
          office: o.office || "FRA", role: "",
          photo: o.photo === undefined ? null : o.photo,
          pw: o.pw || 0, ph: o.ph || 0,
          frame: o.frame === undefined ? null : o.frame};
}
function baseState(tiers, people){
  const st = {title: "Test", brand: "Brand", accent: "#046A38",
          inkOnColour: "#FFFFFF", inkOnWhite: "#1A2129", bg: "white", ring: "none",
          angle: 2, page: "landscape", density: "balanced",
          showGradeCode: true, showGradeName: false,
          nameLabelPosition: "below",
          showPersonName: true, showPersonGrade: true, showPersonGroup: true,
          /* the whole sweep below runs through the named layout, so the
             dispatcher is on the path of every one of these assertions rather
             than only of the fallback */
          layout: "pyramid",
          tiers: tiers, people: people, groups: []};
  /* person() stages a free-text `.office` on each person, the shape every
     call site below already writes. Converting it here, once, through the
     app's OWN resolveGroupId is what keeps a harness fixture and a real Add
     building the identical entity — the alternative, a second hand-rolled
     text->entity policy living only in this file, is exactly the kind of
     second writer that drifts from the one the app runs. */
  st.people.forEach(p => {
    if(Object.prototype.hasOwnProperty.call(p, "office")){
      p.groupId = MODULE.resolveGroupId(st, p.office);
      delete p.office;
    }
  });
  return st;
}
function layout(st){ MODULE.setState(st); return MODULE.computeLayout(st); }

/* ---------------------------------------------------------- 1. NaN sweep */

const t1 = tier("P", "Partner");
const t2 = tier("SA", "Senior Assistant", {fill: "white", attach: true, align: "right"});
const t3 = tier("A", "Assistant", {fill: "white", merge: true, align: "right"});
const t4 = tier("C", "Consultant");

const CASES = {
  "empty roster": baseState([t1, t2, t3, t4], []),
  "no grades at all": baseState([], []),
  "single grade": baseState([t1], [person(t1.id, {name: "Solo One"})]),
  "empty merged grade": baseState([t1, t2, t3], [person(t1.id), person(t2.id)]),
  "all grades merged": baseState(
    [t1, Object.assign({}, t2, {merge: true}), Object.assign({}, t3, {merge: true})],
    [person(t1.id), person(t2.id), person(t3.id)]),
  "merged grade holding everyone": baseState([t1, t3], [person(t3.id), person(t3.id)]),
  "very long name": baseState([t1], [person(t1.id, {name: "Maximiliane Katharina von Habsburg-Lothringen"})]),
  "empty name": baseState([t1], [person(t1.id, {name: ""})]),
  "crowded band": baseState([t1], Array.from({length: 14}, () => person(t1.id))),
  "photos of every shape": baseState([t1], [
    person(t1.id, {photo: JPEG, pw: 240, ph: 240, frame: {zoom: 1, ox: 0, oy: 0}}),
    person(t1.id, {photo: JPEG, pw: 400, ph: 300, frame: {zoom: 1, ox: 0, oy: 0}}),
    person(t1.id, {photo: JPEG, pw: 300, ph: 400, frame: {zoom: 2, ox: 0.7, oy: -0.4}}),
    person(t1.id, {photo: JPEG, pw: 1200, ph: 400, frame: {zoom: 1.5, ox: -3, oy: 3}})
  ])
};

const DENSITIES = ["tight", "balanced", "airy"];
for(const label of Object.keys(CASES)){
  for(const d of DENSITIES){
    for(let angle = 0; angle <= 4; angle++){
      for(const page of ["landscape", "portrait", "square"]){
        const st = JSON.parse(JSON.stringify(CASES[label]));
        st.density = d; st.angle = angle; st.page = page;
        const L = layout(st);
        const bad = [];
        allFinite(L, "L", bad);
        check(bad.length === 0,
          "finite geometry: " + label + " / " + d + " / angle " + angle + " / " + page +
          (bad.length ? " — NaN at " + bad.slice(0, 3).join(", ") : ""));
      }
    }
  }
}

/* The same sweep in Tornado — the pyramid flipped, sharing computeTriangleLayout
   with dir=-1. The angle IS part of this one, exactly as for the pyramid, since
   Tornado reads state.angle through the same shared solver. */
for(const label of Object.keys(CASES)){
  for(const d of DENSITIES){
    for(let angle = 0; angle <= 4; angle++){
      for(const page of ["landscape", "portrait", "square"]){
        const st = JSON.parse(JSON.stringify(CASES[label]));
        st.layout = "tornado"; st.density = d; st.angle = angle; st.page = page;
        const L = layout(st);
        const bad = [];
        allFinite(L, "L", bad);
        check(bad.length === 0,
          "finite tornado geometry: " + label + " / " + d + " / angle " + angle + " / " + page +
          (bad.length ? " — NaN at " + bad.slice(0, 3).join(", ") : ""));
      }
    }
  }
}

/* The same sweep in swimlanes. The angle is not part of it — it belongs to the
   pyramid and the lane engine never reads it — so the loop is cases × spacing ×
   page, and one extra pass with a nonsense angle to prove it really is ignored
   rather than merely unused by accident. */
for(const label of Object.keys(CASES)){
  for(const d of DENSITIES){
    for(const page of ["landscape", "portrait", "square"]){
      const st = JSON.parse(JSON.stringify(CASES[label]));
      st.layout = "swimlanes"; st.density = d; st.page = page;
      const L = layout(st);
      const bad = [];
      allFinite(L, "L", bad);
      check(bad.length === 0,
        "finite swimlane geometry: " + label + " / " + d + " / " + page +
        (bad.length ? " — NaN at " + bad.slice(0, 3).join(", ") : ""));
    }
  }
}

/* The same sweep in Histogram — the third 1D engine, sharing the band-stack
   machinery with the two triangle engines but answering width per band
   instead of with an apex solve. The angle axis is run here too, exactly as
   for Pyramid and Tornado (never skipped, the way the swimlane sweep skips
   it), because Histogram must survive every stored angle value without
   producing NaN — it simply must not let that value change anything, which
   is proven separately below. */
for(const label of Object.keys(CASES)){
  for(const d of DENSITIES){
    for(let angle = 0; angle <= 4; angle++){
      for(const page of ["landscape", "portrait", "square"]){
        const st = JSON.parse(JSON.stringify(CASES[label]));
        st.layout = "histogram"; st.density = d; st.angle = angle; st.page = page;
        const L = layout(st);
        const bad = [];
        allFinite(L, "L", bad);
        check(bad.length === 0,
          "finite histogram geometry: " + label + " / " + d + " / angle " + angle + " / " + page +
          (bad.length ? " — NaN at " + bad.slice(0, 3).join(", ") : ""));
      }
    }
  }
}

/* The same sweep in Hive — the fourth 1D engine, mirroring Swimlanes'
   skeleton (grouping, empty-drop, attach) rather than the band-stack
   machinery. The angle is not part of it, exactly as for Swimlanes and for
   the same reason: it belongs to the triangle solver and Hive never reads
   it, proven separately below. */
for(const label of Object.keys(CASES)){
  for(const d of DENSITIES){
    for(const page of ["landscape", "portrait", "square"]){
      const st = JSON.parse(JSON.stringify(CASES[label]));
      st.layout = "hive"; st.density = d; st.page = page;
      const L = layout(st);
      const bad = [];
      allFinite(L, "L", bad);
      check(bad.length === 0,
        "finite hive geometry: " + label + " / " + d + " / " + page +
        (bad.length ? " — NaN at " + bad.slice(0, 3).join(", ") : ""));
    }
  }
}

/* ---------------------------------------------------------- 1c. Histogram: its own width policy */

/* Histogram shares buildBandGroups/buildBandStack/emitBandPeople with the
   triangle engines — that sharing is proven by the finite sweep above and by
   the golden-unchanged comparison run outside this suite. What is unique to
   Histogram is the width policy itself: a band takes exactly its own
   content's width, and t.align places that band on the page rather than
   positioning people within a wider one. Every assertion below is answered
   by a second source — avatar spacing for the person pitch (never the app's
   own personW formula), the header band's own drawn corners for natW (never
   the L.natW field), and MODULE.G's real constants for what an empty band's
   label lane costs (never the width formula under test). */
{
  /* state.angle (the angle) must never be read: two runs that differ only
     in the stored angle must produce byte-identical output. Two people per
     group, so a group whose column width DID vary with angle (the triangle
     engines' own k*y term) would visibly shift here — one person alone could
     stay put by coincidence. */
  const angleCase = baseState(
    [tier("P", "Partner"), tier("C", "Consultant", {align:"right"})],
    []);
  angleCase.layout = "histogram";
  angleCase.people = [
    person(angleCase.tiers[0].id), person(angleCase.tiers[0].id),
    person(angleCase.tiers[1].id), person(angleCase.tiers[1].id)
  ];
  const shapes = [0, 2, 4].map(ang => {
    const st = JSON.parse(JSON.stringify(angleCase)); st.angle = ang;
    return JSON.stringify(layout(st));
  });
  check(shapes.every(s => s === shapes[0]),
    "Histogram output is identical across every stored angle — state.angle is never read");

  /* Six bands exercising every reading of t.align, two headcounts on each of
     left and right so a width difference can be measured, and one empty
     group to prove a band with nobody in it still fits its heading. */
  const hL1 = tier("L1", "Left One",   {align:"left"});
  const hL2 = tier("L2", "Left Two",   {align:"left"});
  const hR1 = tier("R1", "Right One",  {align:"right"});
  const hR2 = tier("R2", "Right Two",  {align:"right"});
  const hC  = tier("C1", "Centre One", {align:"center"});
  const hE  = tier("E1", "Empty One",  {align:"center"});
  const counts = {[hL1.id]:3, [hL2.id]:7, [hR1.id]:4, [hR2.id]:9, [hC.id]:5, [hE.id]:0};
  const people = [];
  for(const t of [hL1, hL2, hR1, hR2, hC, hE])
    for(let i = 0; i < counts[t.id]; i++) people.push(person(t.id));
  const hst = baseState([hL1, hL2, hR1, hR2, hC, hE], people);
  hst.layout = "histogram";
  const hL = layout(hst);

  /* band i (1-indexed, header is bands[0]) belongs to tiers[i-1] in the same
     order — computeHistogramLayout never reorders groups. */
  const bandW = i => hL.bands[i + 1].pts[1][0] - hL.bands[i + 1].pts[0][0];
  const bandX0 = i => hL.bands[i + 1].pts[0][0];

  check(bandW(1) > bandW(0), "the 7-person left band is wider than the 3-person left band");
  check(bandW(3) > bandW(2), "the 9-person right band is wider than the 4-person right band");

  /* the person pitch, read off two adjacent avatars in the widest band — a
     second source, never MODULE's own personW formula. Group order in
     hL.avatars matches people order above: 3 + 7 + 4 + 9 + 5 + 0. */
  const l2Avatars = hL.avatars.slice(3, 10);
  eq(l2Avatars.length, 7, "the second left group contributed exactly 7 avatars at the expected offset");
  const pitch = l2Avatars[1].cx - l2Avatars[0].cx;
  check(pitch > 0, "adjacent avatars in the same band are spaced apart");
  near(bandW(1) - bandW(0), (counts[hL2.id] - counts[hL1.id]) * pitch,
    "the width difference between two same-align bands equals their headcount "
    + "difference times the avatar pitch — never the app's own personW formula");
  near(bandW(3) - bandW(2), (counts[hR2.id] - counts[hR1.id]) * pitch,
    "…and the same holds on the right");

  check(Math.abs(bandX0(0)) < 1e-9 && Math.abs(bandX0(1)) < 1e-9,
    "align:\"left\" puts both left bands' LEFT edges at equal x (0) despite their different widths");
  /* the header band's own drawn corners are the second source for natW —
     never the L.natW field the same function also writes. */
  const natWFromHeader = hL.bands[0].pts[1][0] - hL.bands[0].pts[0][0];
  near(bandX0(2) + bandW(2), natWFromHeader,
    "align:\"right\" puts the first right band's RIGHT edge at natW");
  near(bandX0(3) + bandW(3), natWFromHeader,
    "…and the second right band's RIGHT edge at the same natW despite its different width");

  const centreX = bandX0(4) + bandW(4) / 2;
  near(centreX, natWFromHeader / 2,
    "align:\"center\" (the default) centres the band within natW, read off the header's own corners");

  /* An empty grade is still on the chart: its band exists and is wide enough
     to hold its own heading, never collapsed to zero. MODULE.G's own labelW
     and padRight are a second source — the real named constants the width
     policy is built from, not a re-derivation of the width formula itself. */
  near(bandW(5), MODULE.G.labelW + MODULE.G.padRight,
    "an empty grade's band still fits exactly its own heading lane and padding, nothing else");
}

/* ---------------------------------------------------------- 2. legacy photos render identically */

/* A photo with the default identity frame (zoom 1, no pan) must draw as a
   plain (cx-r, cy-r, 2r, 2r) circle, matching the frame-free case exactly.
   240x240 square photos are the shape used to cover this — the highest-risk
   case for a silent regression in the framed path. */
{
  const st = baseState([t1], [
    person(t1.id, {name: "Legacy One", photo: JPEG, pw: 240, ph: 240, frame: {zoom: 1, ox: 0, oy: 0}}),
    person(t1.id, {name: "Legacy Two", photo: JPEG, pw: 240, ph: 240, frame: {zoom: 1, ox: 0, oy: 0}})
  ]);
  const L = layout(st);
  L.avatars.forEach((a, i) => {
    near(a.img.x, a.cx - a.r, "legacy photo " + i + " x == cx-r");
    near(a.img.y, a.cy - a.r, "legacy photo " + i + " y == cy-r");
    near(a.img.w, a.r * 2,    "legacy photo " + i + " w == 2r");
    near(a.img.h, a.r * 2,    "legacy photo " + i + " h == 2r");
  });
  /* a legacy photo has zero pan slack, so a stray offset must not move it */
  const drift = MODULE.frameRect(100, 100, 34, 240, 240, {zoom: 1, ox: 5, oy: -5});
  near(drift.x, 66, "legacy photo cannot be panned off-centre (x)");
  near(drift.y, 66, "legacy photo cannot be panned off-centre (y)");
}

/* ---------------------------------------------------------- 3. cover + clamp invariants */

const SHAPES = [[240,240],[400,300],[300,400],[1200,400],[400,1200],[401,400],[400,401]];
const ZOOMS = [1, 1.01, 1.25, 1.5, 1.99, 2];
const PANS = [0, 0.5, -0.5, 3, -3, 99, -99];
for(const [pw, ph] of SHAPES){
  for(const z of ZOOMS){
    for(const ox of PANS){
      for(const oy of PANS){
        const r = 34, cx = 500, cy = 300;
        const q = MODULE.frameRect(cx, cy, r, pw, ph, {zoom: z, ox: ox, oy: oy});
        const tag = pw + "x" + ph + " z" + z + " pan(" + ox + "," + oy + ")";
        check(isFinite(q.x) && isFinite(q.y) && isFinite(q.w) && isFinite(q.h),
              "finite rect " + tag);
        /* the image must always cover the circle — any gap is a visible notch */
        check(q.x <= cx - r + 1e-9, "covers left " + tag);
        check(q.y <= cy - r + 1e-9, "covers top " + tag);
        check(q.x + q.w >= cx + r - 1e-9, "covers right " + tag);
        check(q.y + q.h >= cy + r - 1e-9, "covers bottom " + tag);
        /* and it must keep the source aspect ratio, or faces go oval */
        near(q.w / q.h, pw / ph, "aspect preserved " + tag, 1e-9);
      }
    }
  }
}
/* zoom is clamped to the slider's range even if state says otherwise */
{
  const a = MODULE.frameRect(0, 0, 34, 400, 300, {zoom: 9, ox: 0, oy: 0});
  const b = MODULE.frameRect(0, 0, 34, 400, 300, {zoom: MODULE.ZOOM_MAX, ox: 0, oy: 0});
  near(a.w, b.w, "zoom above ZOOM_MAX is clamped");
  const c = MODULE.frameRect(0, 0, 34, 400, 300, {zoom: 0.1, ox: 0, oy: 0});
  const d = MODULE.frameRect(0, 0, 34, 400, 300, {zoom: 1, ox: 0, oy: 0});
  near(c.w, d.w, "zoom below 1 is clamped up to cover");
}
/* The editor previews at r=80 and the chart draws at r=34. The visible crop
   must be identical or the PNG will not match what the user framed, so the
   rect has to be scale-invariant once normalised to the circle box. */
for(const [pw, ph] of SHAPES){
  for(const z of ZOOMS){
    for(const ox of [0, 0.4, -1.3, 9]){
      const big   = MODULE.frameRect(80, 80, 80, pw, ph, {zoom: z, ox: ox, oy: -ox});
      const small = MODULE.frameRect(34, 34, 34, pw, ph, {zoom: z, ox: ox, oy: -ox});
      const tag = pw + "x" + ph + " z" + z + " ox" + ox;
      /* normalise: position of the image box relative to the circle box, in radii */
      near((big.x - 0) / 80, (small.x - 0) / 34, "preview and chart crop agree, x " + tag, 1e-9);
      near((big.y - 0) / 80, (small.y - 0) / 34, "preview and chart crop agree, y " + tag, 1e-9);
      near(big.w / 80,       small.w / 34,       "preview and chart crop agree, w " + tag, 1e-9);
      near(big.h / 80,       small.h / 34,       "preview and chart crop agree, h " + tag, 1e-9);
    }
  }
}

/* a missing/garbage frame degrades to the centred default, never NaN */
for(const bad of [null, undefined, {}, {zoom: NaN, ox: NaN, oy: NaN}, {zoom: "x", ox: "y", oy: "z"}]){
  const q = MODULE.frameRect(100, 100, 34, 240, 240, bad);
  check(isFinite(q.x) && isFinite(q.y) && isFinite(q.w) && isFinite(q.h),
        "garbage frame degrades safely: " + JSON.stringify(bad));
  near(q.x, 66, "garbage frame centres x: " + JSON.stringify(bad));
}
/* people with no photo carry no rect and must not synthesise one */
{
  const st = baseState([t1], [person(t1.id, {name: "No Photo"})]);
  const L = layout(st);
  eq(L.avatars[0].img, null, "person without a photo has no image rect");
  eq(L.avatars[0].src, null, "person without a photo has no src");
}

/* ------------------------------------------------ 3b. the full-circle photo */

/* A photo whose dimensions a file does not state falls back to the identity
   frame (zoom 1, no pan) and draws as a plain full circle — the same rect,
   the same pixels as any other identity-framed photo. That is exactly what
   parseAndValidateRoster falls back to; 240x240 is simply the shape used to
   exercise it here. */
{
  const squareTier = tier("P", "Partner");
  const square = {
    title: "Old Roster", brand: "", accent: "#046A38", angle: 2,
    page: "landscape", density: "balanced", bg: "white", ring: "none",
    tiers: [squareTier],
    people: [
      {id:"old1", name:"Ingo Alt", tierId:squareTier.id, office:"FRA", role:"",
       photo:JPEG, pw:240, ph:240, frame:{zoom:1, ox:0, oy:0}},
      {id:"old2", name:"No Picture", tierId:squareTier.id, office:"FRA", role:"",
       photo:null, pw:0, ph:0, frame:null}
    ]
  };
  const L = layout(square);
  const a = L.avatars.find(av => av.src);
  near(a.img.x, a.cx - a.r, "a square photo at zoom 1 draws at cx-r");
  near(a.img.y, a.cy - a.r, "a square photo at zoom 1 draws at cy-r");
  near(a.img.w, a.r * 2,    "a square photo at zoom 1 draws 2r wide");
  near(a.img.h, a.r * 2,    "a square photo at zoom 1 draws 2r tall");

  /* clampFrame is what keeps a hand-edited frame inside the circle. It is the
     same clamp the editor applies to a drag and the validator applies on open,
     so a wild zoom or pan can never reach the geometry above. */
  const wild = {photo:JPEG, pw:400, ph:400, frame:{zoom:17, ox:40, oy:40}};
  MODULE.clampFrame(wild);
  eq(wild.frame.zoom, MODULE.ZOOM_MAX, "clampFrame pulls a wild zoom back to the max");
  near(wild.frame.ox, MODULE.frameLimit(400, 400, MODULE.ZOOM_MAX).ox,
       "and a wild pan back to the edge of what the circle can show");

  /* a frame already inside the limits is left exactly as it was */
  const real = {photo:JPEG, pw:533, ph:400, frame:{zoom:1.6, ox:0.4, oy:-0.2}};
  MODULE.clampFrame(real);
  near(real.frame.zoom, 1.6, "clampFrame leaves a real zoom alone");
  near(real.frame.ox, 0.4, "and a real pan alone");
}

/* ---------------------------------------------------------- 3c. the real roster */

/* A full-size roster with the real grade layout — merges, attaches, 26 people
   across 9 grades. If migration or layout breaks on anything, it should break
   here.

   The fixture is read from disk and its absence is treated as an error, not
   a silent skip: a suite that quietly ran 110 fewer assertions because a
   fixture was missing would still print green, and a green run that proves
   nothing is worse than a red one. A missing fixture is a broken checkout,
   not a reason to test less. */
{
  let raw = null;
  try{ raw = readFile(here() + "test/fixtures/current.json"); }catch(e){ raw = null; }
  check(!!raw, "test/fixtures/current.json is readable — the real-roster check needs it");
  if(raw){
    /* Read as it is on disk. The fixture is written in the shape the app saves,
       so nothing has to be normalised in front of the geometry — and asserting
       that shape here is what keeps a regenerated fixture from quietly arriving
       without the dimensions every avatar rect is computed from. */
    const real = JSON.parse(raw);
    check(Array.isArray(real.people) && real.people.length > 0, "real roster: it has people");
    real.people.forEach((p, i) => {
      if(p.photo){
        check(p.pw > 0 && p.ph > 0, "real roster: person " + i + " states pixel dimensions");
        check(!!p.frame, "real roster: person " + i + " states a frame");
      }else{
        check(p.frame === null || p.frame === undefined,
          "real roster: photo-less person " + i + " has no frame");
      }
    });
    for(const d of DENSITIES){
      for(let angle = 0; angle <= 4; angle++){
        const st = JSON.parse(JSON.stringify(real));
        st.density = d; st.angle = angle;
        const L = layout(st);
        const bad = [];
        allFinite(L, "L", bad);
        check(bad.length === 0, "real roster geometry finite / " + d + " / angle " + angle +
              (bad.length ? " — NaN at " + bad.slice(0, 3).join(", ") : ""));
        check(L.bands.length > 0, "real roster draws bands / " + d + " / angle " + angle);
      }
    }
    /* now give every one of them a photo of a different shape and re-check —
       this is what "paste the list, then drop the photo folder" produces */
    const shot = JSON.parse(JSON.stringify(real));
    shot.people.forEach((p, i) => {
      const dims = SHAPES[i % SHAPES.length];
      p.photo = "data:fake"; p.pw = dims[0]; p.ph = dims[1];
      p.frame = {zoom: 1 + (i % 5) * 0.25, ox: (i % 7) - 3, oy: 3 - (i % 5)};
    });
    const L2 = layout(shot);
    const bad2 = [];
    allFinite(L2, "L", bad2);
    check(bad2.length === 0, "real roster with photos of every shape stays finite" +
          (bad2.length ? " — NaN at " + bad2.slice(0, 3).join(", ") : ""));
    L2.avatars.forEach((a, i) => {
      check(a.img.x <= a.cx - a.r + 1e-9 && a.img.x + a.img.w >= a.cx + a.r - 1e-9,
            "real roster avatar " + i + " covers its circle horizontally");
      check(a.img.y <= a.cy - a.r + 1e-9 && a.img.y + a.img.h >= a.cy + a.r - 1e-9,
            "real roster avatar " + i + " covers its circle vertically");
    });
  }
}

/* ---------------------------------------------------------- 4. the two renderers agree */

/* toSVG writes the rect into <image>; toCanvas passes it to drawImage. They
   must land on the same numbers or the PNG will not match the screen. */
async function rendererAgreement(){
  /* Both layouts, because the parity that matters is between the two renderers
     and it has to hold for whatever geometry they are handed. The pyramid case
     runs first and keeps every assertion it always had. */
  await rendererAgreementFor("pyramid");
  await rendererAgreementFor("tornado");
  await rendererAgreementFor("swimlanes");
  await rendererAgreementFor("hive");
}

async function rendererAgreementFor(kind){
  const st = baseState([t1, t4], [
    person(t1.id, {name: "Square Legacy", photo: JPEG, pw: 240, ph: 240, frame: {zoom: 1, ox: 0, oy: 0}}),
    person(t1.id, {name: "Wide Shot",     photo: JPEG, pw: 1200, ph: 400, frame: {zoom: 1, ox: 0, oy: 0}}),
    person(t4.id, {name: "Tall Shot",     photo: JPEG, pw: 300, ph: 400, frame: {zoom: 1.4, ox: 0.3, oy: -0.6}}),
    person(t4.id, {name: "Zoomed Max",    photo: JPEG, pw: 640, ph: 480, frame: {zoom: 2, ox: -9, oy: 9}}),
    person(t4.id, {name: "No Photo Here"})
  ]);
  st.layout = kind;
  const L = layout(st);

  const svg = MODULE.toSVG(L);
  const imgs = [...svg.matchAll(/<image\b[^>]*?x="([-\d.]+)"[^>]*?y="([-\d.]+)"[^>]*?width="([-\d.]+)"[^>]*?height="([-\d.]+)"/g)]
    .map(m => ({x: +m[1], y: +m[2], w: +m[3], h: +m[4]}));

  MODULE.DRAWN.length = 0;
  await MODULE.toCanvas(L, 300);
  const drawn = MODULE.DRAWN.slice();

  eq(imgs.length, 4, kind + ": SVG emits one <image> per photo (not for the photo-less person)");
  eq(drawn.length, 4, kind + ": canvas draws one image per photo");

  for(let i = 0; i < imgs.length; i++){
    /* SVG rounds to 2dp for file size; that is the only permitted difference */
    near(imgs[i].x, drawn[i].x, kind + ": renderers agree on image " + i + " x", 0.005);
    near(imgs[i].y, drawn[i].y, kind + ": renderers agree on image " + i + " y", 0.005);
    near(imgs[i].w, drawn[i].w, kind + ": renderers agree on image " + i + " w", 0.005);
    near(imgs[i].h, drawn[i].h, kind + ": renderers agree on image " + i + " h", 0.005);
  }
  /* and both must agree with the layout itself */
  const withPhoto = L.avatars.filter(a => a.src);
  withPhoto.forEach((a, i) => {
    near(drawn[i].x, a.img.x, kind + ": canvas image " + i + " matches layout x");
    near(drawn[i].w, a.img.w, kind + ": canvas image " + i + " matches layout w");
  });

  /* stretching is what makes <image> match drawImage; anything else re-fits */
  check(/preserveAspectRatio="none"/.test(svg),
        kind + ': SVG <image> uses preserveAspectRatio="none"');
  check(!/xMidYMid slice/.test(svg),
        kind + ": SVG <image> never uses xMidYMid slice fitting");

  /* the legacy square must still land on the identity-frame rect
     (cx-r, cy-r, 2r, 2r) in both */
  const legacy = withPhoto[0];
  near(drawn[0].x, legacy.cx - legacy.r, kind + ": legacy square draws at cx-r in canvas");
  near(drawn[0].w, legacy.r * 2,         kind + ": legacy square draws 2r wide in canvas");
  near(imgs[0].x, +(legacy.cx - legacy.r).toFixed(2), kind + ": legacy square draws at cx-r in SVG");
}

/* ---------------------------------------------------------- 5. clampFrame */

{
  const p = {pw: 1200, ph: 400, frame: {zoom: 5, ox: 99, oy: 99}};
  MODULE.clampFrame(p);
  eq(p.frame.zoom, MODULE.ZOOM_MAX, "clampFrame caps zoom at ZOOM_MAX");
  const lim = MODULE.frameLimit(1200, 400, MODULE.ZOOM_MAX);
  near(p.frame.ox, lim.ox, "clampFrame caps ox at the slack limit");
  near(p.frame.oy, lim.oy, "clampFrame caps oy at the slack limit");
  /* a wide photo is pinned vertically at zoom 1 and only gains slack as it zooms */
  near(MODULE.frameLimit(1200, 400, 1).oy, 0, "wide photo has no vertical slack at zoom 1");
  near(MODULE.frameLimit(1200, 400, 2).oy, 1, "wide photo gains 1r of vertical slack at zoom 2");
  near(MODULE.frameLimit(1200, 400, 1).ox, 2, "wide photo has 2r of horizontal slack at zoom 1");

  /* the stored clamp and the render clamp must agree, or the preview drifts */
  for(const [pw, ph] of SHAPES){
    for(const z of ZOOMS){
      const q = {pw: pw, ph: ph, frame: {zoom: z, ox: 99, oy: -99}};
      MODULE.clampFrame(q);
      const viaClamp = MODULE.frameRect(0, 0, 34, pw, ph, q.frame);
      const viaRect  = MODULE.frameRect(0, 0, 34, pw, ph, {zoom: z, ox: 99, oy: -99});
      near(viaClamp.x, viaRect.x, "clampFrame agrees with frameRect x " + pw + "x" + ph + " z" + z);
      near(viaClamp.y, viaRect.y, "clampFrame agrees with frameRect y " + pw + "x" + ph + " z" + z);
    }
  }
}

/* ---------------------------------------------------------- 6. layout dispatch

   computeLayout is now two things: a dispatcher on state.layout, and the
   pyramid engine it dispatches to. The whole app — preview, both renderers,
   every export command, all five suites — goes on calling computeLayout, so
   what has to be proved is that the indirection is transparent: the same state
   still yields the same geometry, byte for byte, whichever way the property is
   set. */

{
  const engine = MODULE.computePyramidLayout;
  check(typeof engine === "function",
        "computePyramidLayout exists — the pyramid geometry has a name of its own");

  const shapes = [
    ["populated", baseState([t1, t2, t3, t4],
      [person(t1.id, {name: "Dispatch One"}), person(t2.id), person(t3.id), person(t4.id, {name: "Dispatch Four"})])],
    ["empty", baseState([t1, t2], [])],
    ["no grades", baseState([], [])],
    ["with a photo", baseState([t1],
      [person(t1.id, {photo: JPEG, pw: 400, ph: 300, frame: {zoom: 1.5, ox: 0.4, oy: -0.2}})])]
  ];

  for(const [label, base] of shapes){
    const via = st => { MODULE.setState(st); return JSON.stringify(MODULE.computeLayout(st)); };
    const direct = st => { MODULE.setState(st); return JSON.stringify(engine(st)); };
    const clone = () => JSON.parse(JSON.stringify(base));

    const named = clone(); named.layout = "pyramid";
    eq(via(named), direct(clone()),
       "dispatch: layout pyramid gives exactly what computePyramidLayout gives — " + label);

    /* Documents in memory from before this build, and any state a test or a
       future code path hands over without the property, are pyramids. */
    const missing = clone(); delete missing.layout;
    eq(via(missing), direct(clone()),
       "dispatch: a state with no layout draws the pyramid — " + label);

    /* The validator refuses an unknown layout on the way in, so this can only
       be an internal bug — and a drawn chart beats a blank page. "mind-map" is
       deliberately a name no engine answers to; "swimlanes" is a real layout
       now and has its own section below. */
    const unknown = clone(); unknown.layout = "mind-map";
    eq(via(unknown), direct(clone()),
       "dispatch: an unrecognised layout falls back to the pyramid rather than drawing nothing — " + label);

    /* the dispatcher must pass the state through untouched, not a copy it
       edited on the way past */
    const nulled = clone(); nulled.layout = null;
    eq(via(nulled), direct(clone()),
       "dispatch: a null layout is the pyramid too — " + label);
  }

  /* And the renderers see no difference either: the SVG is the one output that
     leaves the app as text, so compare it rather than only the geometry. Clip
     ids come from uid() and are unique per call, so they are renumbered first. */
  {
    const st = baseState([t1, t2, t3], [person(t1.id, {name: "Svg One"}), person(t3.id)]);
    st.layout = "pyramid";
    MODULE.setState(st);
    const norm = s => { let i = 0; return s.replace(/c[a-z0-9]{4,}/g, () => "cID" + (i++)); };
    const a = norm(MODULE.toSVG(MODULE.computeLayout(st)));
    const b = norm(MODULE.toSVG(MODULE.computePyramidLayout(st)));
    eq(a, b, "dispatch: the exported SVG is identical through the dispatcher");
    check(a.indexOf("<polygon") > 0, "and it is a real chart, not an empty document");
  }
}

/* ---------------------------------------------------------- 6b. tornado — the pyramid flipped

   computeTornadoLayout shares computeTriangleLayout with the pyramid; the only
   difference is dir (-1 instead of +1). Finite-geometry coverage is the NaN
   sweep above (section 1); dispatch transparency mirrors section 6. What is
   unique to this section is DISTINGUISHING the two engines' shapes from a
   state the test itself builds — every expectation below is read off the
   layout's own drawn band corners (bands[i].pts) rather than off natW/L0/R0,
   the values under test, so a sign error or a dropped edge-flip shows up here
   even though the geometry stays perfectly finite. */
{
  check(typeof MODULE.computeTornadoLayout === "function",
        "computeTornadoLayout exists — the tornado geometry has a name of its own");

  /* dispatch transparency, the same proof section 6 gives the pyramid */
  {
    const engine = MODULE.computeTornadoLayout;
    const shapes = [
      ["populated", baseState([t1, t2, t3, t4],
        [person(t1.id, {name: "Tornado One"}), person(t2.id), person(t3.id), person(t4.id, {name: "Tornado Four"})])],
      ["empty", baseState([t1, t2], [])],
      ["no grades", baseState([], [])]
    ];
    for(const [label, base] of shapes){
      const via = st => { MODULE.setState(st); return JSON.stringify(MODULE.computeLayout(st)); };
      const direct = st => { MODULE.setState(st); return JSON.stringify(engine(st)); };
      const named = JSON.parse(JSON.stringify(base)); named.layout = "tornado";
      eq(via(named), direct(JSON.parse(JSON.stringify(base))),
         "dispatch: layout tornado gives exactly what computeTornadoLayout gives — " + label);
    }
  }

  /* a roster with two bands of different headcounts, so the top and bottom
     edges genuinely differ in width — flat headcounts would make the
     sign-only difference the point below is checking for invisible */
  const wide = tier("W1", "Shape One");
  /* align:"right" (not the default centre) is what makes this band's
     placement actually depend on WHICH edge L0/R0 is measured against:
     centred content stays centred on cx regardless of which of the two
     symmetric edges supplies the span, but right-packed content sits flush
     against R0 itself — so a mutation that measures R0 off the wrong
     (wider) edge visibly pushes these avatars past the band's true narrow
     edge instead of leaving them harmlessly inside it. */
  const grow = tier("W2", "Shape Two", {align: "right"});
  const shapeBase = baseState([wide, grow],
    [person(wide.id, {name: "Shape A"})].concat(
      Array.from({length: 6}, (_, i) => person(grow.id, {name: "Shape B" + i}))));
  shapeBase.angle = 3;

  /* one band's own trapezoid, read off its DRAWN corners —
     [[cx-w0,y0],[cx+w0,y0],[cx+w1,y1],[cx-w1,y1]] — never off natW or halfW,
     which is the code under test. bands[0] is always the header slice. */
  const bandEdges = (L, i) => {
    const pts = L.bands[i + 1].pts;
    return {topW: pts[1][0] - pts[0][0], botW: pts[2][0] - pts[3][0]};
  };
  const drawAs = kind => {
    const st = JSON.parse(JSON.stringify(shapeBase));
    st.layout = kind;
    MODULE.setState(st);
    return MODULE.computeLayout(st);
  };
  const P = drawAs("pyramid"), T = drawAs("tornado");

  const pFirstTop = bandEdges(P, 0).topW, pLastBot = bandEdges(P, P.bands.length - 2).botW;
  check(pFirstTop < pLastBot,
    "pyramid: the first band's top edge is narrower than the last band's bottom edge — got "
    + pFirstTop + " vs " + pLastBot);

  const tFirstTop = bandEdges(T, 0).topW, tLastBot = bandEdges(T, T.bands.length - 2).botW;
  check(tFirstTop > tLastBot,
    "tornado: the same comparison is reversed — the first band's top edge is WIDER than the "
    + "last band's bottom edge — got " + tFirstTop + " vs " + tLastBot);

  /* natW: the widest point of a tornado chart is its own top edge (y=0),
     read independently off the header slice's own corners, never off natW's
     own formula — this is what M5 (dropping the narrow-edge flip) breaks,
     since natW would still be a positive finite number either way. */
  const headerPts = T.bands[0].pts;
  const topHalfWidth = (headerPts[1][0] - headerPts[0][0]) / 2;
  near(T.natW, 2 * topHalfWidth,
    "tornado: natW equals twice the solved top half-width, read off the header slice's own "
    + "corners rather than off natW's own formula");

  /* usable span: every avatar drawn in a band has to fit inside that band's
     own NARROW edge — the bottom, for tornado — read off the band's own
     trapezoid corners rather than off L0/R0 (the thing under test). "grow"
     (six people) is the content-driving band, so this is a tight fit: with
     the narrow-edge flip dropped (M5), people would be laid out against the
     WIDE (top) edge instead and spill past the true bottom edge here. */
  const cx = (headerPts[0][0] + headerPts[1][0]) / 2;
  const growBotHalf = bandEdges(T, 1).botW / 2;
  const growAvatars = T.avatars.slice(1);            // avatars[0] is "wide"'s one person
  eq(growAvatars.length, 6, "the six-person band drew six avatars");
  check(growAvatars.every(av => Math.abs(av.cx - cx) + av.r <= growBotHalf + 1e-6),
    "tornado: every avatar in the content-driving band fits inside that band's own bottom "
    + "(narrow) edge — got " + JSON.stringify(growAvatars.map(av => av.cx)) + ", half-width "
    + growBotHalf + ", centre " + cx);

  /* The check above is an inequality, and the margin built into personW/
     padRight is wide enough that a small mistake in WHICH edge R0 is
     measured against (a handful of px, at most k*G.bandH) can hide inside
     that margin without ever tripping "fits inside". This is the precise
     version: "grow" is align:"right", which cancels leftInset/peopleL out
     of x0 algebraically (x0 = R0 - G.padRight - n*personW), so R0 is
     recoverable EXACTLY from the rightmost avatar's own drawn position —
     personW itself read off the measured spacing between two consecutive
     avatars in the same band, never off the app's internal formula for it.
     Comparing that recovered R0 against cx+growBotHalf (independently read
     off the band's own bottom trapezoid corners) is what M5 actually
     breaks: dropping the narrow-edge flip moves R0 by exactly k*G.bandH,
     which this equality catches at any angle, not just the steepest one. */
  const personW = growAvatars[1].cx - growAvatars[0].cx;
  check(personW > 0, "tornado: the content-driving band's people have a measurable, positive spacing");
  const recoveredR0 = growAvatars[5].cx + MODULE.G.padRight + personW / 2;
  near(recoveredR0, cx + growBotHalf,
    "tornado: R0 (recovered from the right-aligned band's own rightmost avatar) equals "
    + "cx + the band's own bottom-edge half-width",
    1e-6);
}

/* ---------------------------------------------------------- 7. swimlanes

   One vertical lane per non-empty grade, left to right; people top to bottom in
   roster order; equal widths. Everything below reads the layout object rather
   than the source, so it fails if the geometry stops meaning what it says. */

{
  const swim = st => { st.layout = "swimlanes"; MODULE.setState(st); return MODULE.computeLayout(st); };
  const lanesOf = L => L.bands.slice(1);      // bands[0] is the title bar
  /* a lane's heading texts are the two centred on its own centre line */
  const headingsOf = (L, band) => {
    const cx = (band.pts[0][0] + band.pts[1][0])/2;
    return L.texts.filter(t => t.anchor === "middle" && Math.abs(t.x - cx) < 0.001
                               && t.baseline === "middle");
  };

  const a = tier("P",  "Partner");
  const b = tier("SA", "Senior Assistant", {fill: "white"});
  const c = tier("C",  "Consultant");

  /* ---- order, width, and who is in which lane */
  {
    const st = baseState([a, b, c], [
      person(a.id, {name: "Ada One"}),
      person(c.id, {name: "Cee One"}),
      person(a.id, {name: "Ada Two"}),
      person(b.id, {name: "Bee One"}),
      person(c.id, {name: "Cee Two"})
    ]);
    st.showGradeName = true;
    const L = swim(st);
    const lanes = lanesOf(L);
    eq(lanes.length, 3, "one lane per grade");

    /* left to right in state.tiers order */
    const xs = lanes.map(l => l.pts[0][0]);
    check(xs.every((x, i) => i === 0 || x > xs[i-1]),
          "lanes run left to right in grade order — got " + JSON.stringify(xs));
    eq(headingsOf(L, lanes[0])[0].segs[0].t, "P",  "the first lane is the first grade");
    eq(headingsOf(L, lanes[1])[0].segs[0].t, "SA", "the second lane is the second grade");
    eq(headingsOf(L, lanes[2])[0].segs[0].t, "C",  "the third lane is the third grade");
    /* the heading carries the code AND the full grade name */
    eq(headingsOf(L, lanes[1])[1].segs[0].t, "Senior Assistant",
       "the heading shows the full grade name under the code");

    /* equal widths */
    const ws = lanes.map(l => l.pts[1][0] - l.pts[0][0]);
    check(ws.every(w => Math.abs(w - ws[0]) < 1e-9),
          "every lane is the same width — got " + JSON.stringify(ws));
    check(ws[0] > 0, "and that width is positive");
    /* equal gaps, so the grid is regular rather than merely ordered */
    const gaps = xs.slice(1).map((x, i) => x - (xs[i] + ws[i]));
    check(gaps.every(g => Math.abs(g - gaps[0]) < 1e-9), "the gaps between lanes are equal");

    /* people top to bottom in state.people order, inside their own lane */
    const laneX = lanes.map(l => (l.pts[0][0] + l.pts[1][0])/2);
    const inLane = i => L.avatars.filter(av => Math.abs(av.cx - laneX[i]) < 0.001);
    eq(inLane(0).length, 2, "the first lane holds its two people");
    eq(inLane(1).length, 1, "the second lane holds its one person");
    eq(inLane(2).length, 2, "the third lane holds its two people");
    [0,1,2].forEach(i => {
      const ys = inLane(i).map(av => av.cy);
      check(ys.every((y, k) => k === 0 || y > ys[k-1]),
            "lane " + i + " stacks its people top to bottom");
    });
    /* Roster order, NOT alphabetical. The two have to disagree or this proves
       nothing, so the lane below holds Zoe before Aaron: an engine that sorted
       would put Aaron on top. */
    const order = baseState([a], [
      person(a.id, {name: "Zoe First"}),
      person(a.id, {name: "Aaron Second"}),
      person(a.id, {name: "Mid Third"})
    ]);
    const OL = swim(order);
    const stack = OL.avatars.slice().sort((p, q) => p.cy - q.cy);
    eq(stack.map(av => av.ini).join(","), "ZF,AS,MT",
       "a lane keeps state.people order top to bottom, in defiance of the alphabet");

    /* people are centred in their lane */
    L.avatars.forEach((av, i) => {
      const near0 = laneX.some(x => Math.abs(av.cx - x) < 1e-9);
      check(near0, "avatar " + i + " is centred in its lane");
    });
    /* every person's name and subline sit on the same centre line */
    const centred = L.texts.filter(t => t.baseline === "alphabetic");
    eq(centred.length, 10, "each person has a name and a subline");
    check(centred.every(t => t.anchor === "middle"), "and both are centred");
    check(centred.every(t => laneX.some(x => Math.abs(t.x - x) < 1e-9)),
          "on their lane's centre line");
  }

  /* ---- the shared grade-heading policy, driven through two representative engines */
  {
    for(const kind of ["pyramid", "swimlanes"]){
      const headings = (codeOn, nameOn) => {
        const st = baseState([a], [person(a.id)]);
        st.layout = kind; st.showGradeCode = codeOn; st.showGradeName = nameOn;
        const L = layout(st);
        return L.texts.filter(t => t.anchor === "middle" && t.baseline === "middle");
      };
      const code = headings(true, false);
      eq(code.length, 1, kind + ": code-only produces one grade heading");
      eq(code[0].segs[0].t, "P", kind + ": that heading is the code");
      const name = headings(false, true);
      eq(name.length, 1, kind + ": name-only produces one grade heading");
      eq(name[0].segs[0].t, "Partner", kind + ": that heading is the name");
      const both = headings(true, true);
      eq(both.length, 2, kind + ": both options produce two lines");
      check(both[0].x === both[1].x && both.every(t => t.anchor === "middle"),
        kind + ": code and name are centred on the same line");
      check(both[0].y < both[1].y, kind + ": code is above the name");
      eq(headings(false, false).length, 0,
        kind + ": turning both options off removes grade headings completely");
    }
  }

  /* ---- person-name position belongs to Swimlanes only */
  {
    const st = baseState([a], [person(a.id, {name:"Ada Example"})]);
    st.nameLabelPosition = "below";
    const below = swim(st);
    const belowBand = lanesOf(below)[0];
    const belowCx = (belowBand.pts[0][0] + belowBand.pts[1][0])/2;
    const belowAvatar = below.avatars[0];
    const belowLines = below.texts.filter(t => t.baseline === "alphabetic");
    near(belowAvatar.cx, belowCx, "below-photo mode centres the avatar in its lane");
    check(belowLines.every(t => t.anchor === "middle" && Math.abs(t.x - belowCx) < 0.001),
      "below-photo mode centres both name lines under the avatar");
    check(belowLines.every(t => t.y > belowAvatar.cy + belowAvatar.r),
      "below-photo mode puts both baselines below the photo");

    const nextState = JSON.parse(JSON.stringify(st));
    nextState.nameLabelPosition = "next";
    const next = swim(nextState);
    const nextBand = lanesOf(next)[0];
    const nextCx = (nextBand.pts[0][0] + nextBand.pts[1][0])/2;
    const nextAvatar = next.avatars[0];
    const nextLines = next.texts.filter(t => t.baseline === "alphabetic");
    check(nextAvatar.cx < nextCx, "next-to-photo mode moves the avatar to the lane's left side");
    check(nextLines.every(t => t.anchor === "start" && t.x > nextAvatar.cx + nextAvatar.r),
      "next-to-photo mode left-aligns both name lines to the photo's right");
    check(nextLines[0].y < nextAvatar.cy && nextLines[1].y > nextAvatar.cy,
      "next-to-photo mode vertically straddles the photo centre");
    check(next.natH < below.natH,
      "next-to-photo mode removes the unused below-photo height");
    eq(nextState.nameLabelPosition, "next", "drawing never rewrites the saved preference");

    /* ---- Pyramid honours the same preference ---------------------------
       Below-photo centres the photo in its column and hangs both lines under
       it, which needs room between the bands; next-to-photo keeps the photo
       and both lines beside each other. The photos themselves do not change
       size, and neither does the band height. */
    const pyBelow = JSON.parse(JSON.stringify(st)); pyBelow.layout = "pyramid";
    pyBelow.nameLabelPosition = "below";
    const pyNext = JSON.parse(JSON.stringify(pyBelow)); pyNext.nameLabelPosition = "next";
    const pb = layout(pyBelow), pn = layout(pyNext);
    check(JSON.stringify(pb) !== JSON.stringify(pn),
      "Pyramid draws below-photo and next-to-photo output differently");

    const pbAva = pb.avatars[0], pnAva = pn.avatars[0];
    eq(pbAva.r, pnAva.r, "the photo is the same size in both positions");
    eq(pbAva.cy, pnAva.cy, "and sits on the same band centre line");
    const pbLines = pb.texts.filter(t => t.baseline === "alphabetic");
    const pnLines = pn.texts.filter(t => t.baseline === "alphabetic");
    check(pbLines.length === 2 && pnLines.length === 2, "both draw a name and a subline");
    check(pbLines.every(t => t.anchor === "middle" && t.x === pbAva.cx),
      "below-photo centres both lines on the photo");
    check(pbLines.every(t => t.y > pbAva.cy + pbAva.r),
      "and hangs them under it, clear of the photo");
    check(pnLines.every(t => t.anchor === "start" && t.x > pnAva.cx + pnAva.r),
      "beside-photo keeps both lines to the photo's right");
    /* the band itself is untouched — only the space around it moved */
    const bandH = (bnd) => bnd.pts[3][1] - bnd.pts[0][1];
    eq(bandH(pb.bands[1]), bandH(pn.bands[1]), "the band height is the same in both");
    check(pb.natH > pn.natH,
      "below-photo is taller overall, because the gaps hold the labels");
    /* the last band's labels must be inside the page the fit is solved against */
    const lastLine = Math.max(...pbLines.map(t => t.y));
    check(lastLine < pb.natH,
      "and the lowest label is inside natH rather than cropped off the bottom");
    eq(pyBelow.nameLabelPosition, "below", "drawing never rewrites the saved preference");

    /* ---- a label takes the ink of what it is drawn ON --------------------
       Beside the photo a label is inside its own band, so it uses that band's
       ink. Below the photo it is under the band: normally on the page, which
       takes the on-white pair — but on an ATTACHED grade there is no gap, so it
       lands on that grade's band and must take that band's ink instead. Getting
       this wrong is invisible with the default palette and unreadable with a
       custom one, so the two inks here are deliberately far apart. */
    {
      const ON_COLOUR = "#FFFFFF", ON_WHITE = "#1A2129";
      const build = (fills, attaches) => {
        const tiers = fills.map((f, i) =>
          tier("G" + i, "Grade " + i, {fill: f, attach: !!attaches[i]}));
        const st2 = {
          title:"T", brand:"", accent:"#046A38",
          inkOnColour:ON_COLOUR, inkOnWhite:ON_WHITE,
          bg:"white", ring:"none", page:"landscape", density:"balanced",
          angle: 2, layout:"pyramid", nameLabelPosition:"below",
          showGradeCode:true, showGradeName:false,
          showPersonName:true, showPersonGrade:true, showPersonGroup:true,
          tiers: tiers,
          people: tiers.map((t, i) => ({id:"c"+i, name:"Ada Example", tierId:t.id,
            office:"FRA", role:"", photo:null, pw:0, ph:0, frame:null}))
        };
        return st2;
      };
      /* the name line belonging to band i, in band order */
      const namesOf = (L) => {
        const rows = L.texts.filter(t => t.baseline === "alphabetic" && t.size === 15);
        return rows.sort((a, b) => a.y - b.y);
      };
      /* The subline is a SECOND colour — the same ink at a lower alpha — and it
         is written from its own variable, so it can be left behind on the band
         pair while the name above it moves. Checked separately for that reason. */
      const subsOf = (L) => {
        const rows = L.texts.filter(t => t.baseline === "alphabetic" && t.size === 11);
        return rows.sort((a, b) => a.y - b.y);
      };
      const alpha = (c) => {
        const m = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(c);
        return m ? Number(m[1]) : null;
      };
      const rgbOf = (c) => {
        const m = /rgba\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
        return m ? m.slice(1, 4).map(Number) : null;
      };
      /* #1A2129 and #FFFFFF as the renderer writes them once alpha is applied */
      const WHITE_RGB = [255, 255, 255], DARK_RGB = [26, 33, 41];

      /* band 0 green with a gap after it -> its label is on the page */
      {
        const L = layout(build(["green","green","green"], [false,false,false]));
        const n = namesOf(L), s = subsOf(L);
        eq(n.length, 3, "one name line per band");
        eq(s.length, 3, "and one subline per band");
        for(let i = 0; i < 3; i++){
          eq(n[i].color, ON_WHITE,
            "below-photo label " + i + " sits on the page and takes the on-white ink");
          eq(JSON.stringify(rgbOf(s[i].color)), JSON.stringify(DARK_RGB),
            "and its subline is the same on-white ink, not the band's — " + s[i].color);
          eq(alpha(s[i].color), 0.62,
            "at the on-white alpha the swimlane engine uses for people on the page");
        }
      }
      /* the same bands beside the photo are INSIDE them, so they keep band ink */
      {
        const st2 = build(["green","white","green"], [false,false,false]);
        st2.nameLabelPosition = "next";
        const n = namesOf(layout(st2));
        eq(n[0].color, ON_COLOUR, "beside-photo on a green band keeps the on-colour ink");
        eq(n[1].color, ON_WHITE,  "beside-photo on a white band keeps the on-white ink");
        eq(n[2].color, ON_COLOUR, "and the third band likewise");
      }
      /* band 1 attached: band 0's label lands ON band 1 and takes ITS ink */
      {
        const L = layout(build(["green","green","green"], [false,true,false]));
        const n = namesOf(L), s = subsOf(L);
        eq(n[0].color, ON_COLOUR,
          "a label over an attached GREEN band takes the on-colour ink, not the page's");
        eq(JSON.stringify(rgbOf(s[0].color)), JSON.stringify(WHITE_RGB),
          "and so does its subline — " + s[0].color);
        eq(alpha(s[0].color), 0.85, "at the on-colour alpha");
        eq(n[1].color, ON_WHITE,
          "while the attached band's own label still falls in a gap, on the page");
      }
      {
        const n = namesOf(layout(build(["green","white","green"], [false,true,false])));
        eq(n[0].color, ON_WHITE,
          "and over an attached WHITE band it takes the on-white ink");
      }
      /* the last band has nothing under it at all */
      {
        const n = namesOf(layout(build(["white","white","white"], [false,false,false])));
        eq(n[2].color, ON_WHITE, "the last band's label is on the page");
      }
      /* the grade heading is inside the band whatever the labels do */
      {
        const L = layout(build(["green","green","green"], [false,false,false]));
        const heads = L.texts.filter(t => t.baseline === "middle" && t.size === 24);
        check(heads.length > 0 && heads.every(t => t.color === ON_COLOUR),
          "the grade heading stays inside its band and keeps the band's ink");
      }
    }

    /* ---- the clearance rule, at every density ---------------------------
       A label hanging below its photo must not run into the band underneath,
       and must not merely touch it either — the gap has to still read as a gap.
       Tight is the density that had to grow to manage it; the looser two
       already had the room and must NOT have been changed. An attached grade is
       excluded on purpose: it asked for no gap and gets none, so its labels do
       reach into the band below. */
    {
      const many = {
        title:"T", brand:"", accent:"#046A38", inkOnColour:"#FFFFFF",
        inkOnWhite:"#1A2129", bg:"white", ring:"none", page:"landscape",
        angle: 2, layout:"pyramid", nameLabelPosition:"below",
        /* no grade headings, so the label lane and the right padding are both
           G.padRight and the people block is centred on the band's own centre —
           which is what makes the per-column centring check below exact */
        showGradeCode:false, showGradeName:false,
        showPersonName:true, showPersonGrade:true, showPersonGroup:true,
        tiers:[tier("P","Partner"), tier("D","Director"), tier("M","Manager")],
        people:[]
      };
      /* two per band, or the column-centring check has nothing to measure a
         column width against and silently asserts nothing */
      many.tiers.forEach((t,i)=>{
        many.people.push({id:"x"+i+"a", name:"Ada Example", tierId:t.id, office:"FRA",
                          role:"", photo:null, pw:0, ph:0, frame:null});
        /* Two comfortably-wider-than-the-photo names, ADJACENT. One wide label
           beside a narrow one leaves slack that hides a missing column padding,
           and a column sized to the photo alone still fits a short label — so
           the pair has to be wide on both sides for either rule to bite. */
        many.people.push({id:"x"+i+"b", name:"Alexandra Wingfield-Beaumont",
                          tierId:t.id, office:"BER",
                          role:"", photo:null, pw:0, ph:0, frame:null});
        many.people.push({id:"x"+i+"c", name:"Bartholomew Fitzwilliam-Hayes",
                          tierId:t.id, office:"HAM",
                          role:"", photo:null, pw:0, ph:0, frame:null});
      });
      for(const d of ["tight","balanced","airy"]){
        const wide = JSON.parse(JSON.stringify(many)); wide.density = d;
        const beside = JSON.parse(JSON.stringify(wide)); beside.nameLabelPosition = "next";
        const Lb = layout(wide), Ln = layout(beside);
        const topsOf = (L) => L.bands.slice(1).map(b => b.pts[0][1]);
        const tops = topsOf(Lb);
        const lines = Lb.texts.filter(t => t.baseline === "alphabetic");
        for(let i = 0; i + 1 < tops.length; i++){
          const bandBottom = tops[i] + 58;
          const mine = lines.filter(t => t.y > tops[i] && t.y < tops[i+1]);
          check(mine.length > 0, d + ": band " + i + " has labels in the gap below it");
          const lowest = Math.max(...mine.map(t => t.y));
          check(lowest > bandBottom,
            d + ": band " + i + "'s labels really are below the band, not inside it");
          check(tops[i+1] - lowest >= 20,
            d + ": a clear run is left between those labels and the next band — got "
            + (tops[i+1] - lowest).toFixed(1));
        }
        /* A below-photo label is centred ON the photo, so the photo has to be
           centred IN its column or the label spills over the neighbour beside
           it. With no grade headings the label lane and the right padding are
           both 26, so the people block is centred on the band's own centre and
           the first photo sits exactly half a column in from its left edge. */
        {
          const band = Lb.bands[1];
          const bcx = (band.pts[0][0] + band.pts[1][0]) / 2;
          const row = Lb.avatars.filter(a => a.cy === (band.pts[0][1] + 29));
          if(row.length > 1){
            const spacing = row[1].cx - row[0].cx;
            near(row[0].cx, bcx - (row.length - 1) * spacing / 2,
              d + ": each photo is centred in its own column, not leaning left in it");
          }
        }

        /* A centred label is only safe if its column is at least as wide as it
           is. The stub's measureText is deterministic — length * px * 0.5, and
           the segs hold exactly the characters that were measured — so the drawn
           width can be recomputed here and two neighbours checked for overlap.
           This is what a column sized to the photo alone would break. */
        {
          const wOf = (t) =>
            t.segs.reduce((n, s) => n + String(s.t).length, 0) * t.size * 0.5;
          const rows = {};
          for(const t of Lb.texts){
            if(t.baseline !== "alphabetic" || t.anchor !== "middle") continue;
            (rows[t.y] = rows[t.y] || []).push(t);
          }
          let compared = 0;
          for(const y of Object.keys(rows)){
            const line = rows[y].slice().sort((a, b) => a.x - b.x);
            for(let i = 0; i + 1 < line.length; i++){
              compared++;
              /* A clear run, not merely "does not overlap": two labels touching
                 edge to edge read as one word, and the whole point of the
                 column padding is that they do not. */
              const clear = (line[i+1].x - wOf(line[i+1])/2)
                          - (line[i].x + wOf(line[i])/2);
              check(clear >= 8,
                d + ": two below-photo labels on one band stay clearly apart — "
                + JSON.stringify(line[i].segs.map(s => s.t).join("")) + " and "
                + JSON.stringify(line[i+1].segs.map(s => s.t).join(""))
                + " are " + clear.toFixed(1) + " apart");
            }
          }
          check(compared > 0, d + ": there were neighbouring labels to compare at all");
        }

        /* the loose densities were already roomy enough to be left alone */
        if(d !== "tight"){
          eq(JSON.stringify(topsOf(Lb)), JSON.stringify(topsOf(Ln)),
            d + ": the band positions are untouched — it already had the room");
        }else{
          check(topsOf(Lb)[1] > topsOf(Ln)[1],
            "tight: the one density that had to open up, did");
        }
      }
    }
  }

  /* ---- attached bands with matching grids do not collide -------------------
     Two attached bands share one column grid (same personW, zero gap). Equal
     headcounts under the same alignment put their people at IDENTICAL x, which
     overlaps beside-photo circles and, below the photo, drops the upper band's
     label block onto the lower band's photos. computePyramidLayout answers
     this with a collision-driven phase offset that only ever moves the whole
     people block of a CENTRE-aligned attached band — left/right is the user's
     explicit anchor and stays flush even when it collides.

     Every state built here is a bare two- or three-grade pyramid: no grade
     headings (so leftInset === G.padRight, keeping the geometry legible), and
     short synthetic names so `personW` stays small and predictable. */
  {
    const twoGrade = (n0, n1, opts) => {
      opts = opts || {};
      const t0 = tier("A", "GradeA", {align: opts.align0 || opts.align || "center"});
      const t1 = tier("B", "GradeB",
        {align: opts.align1 || opts.align || "center", attach: opts.attach !== false});
      const st = baseState([t0, t1], []);
      st.brand = "";
      st.nameLabelPosition = opts.below ? "below" : "next";
      st.showGradeCode = false; st.showGradeName = false;
      if(opts.density) st.density = opts.density;
      if(opts.title) st.title = opts.title;
      for(let i = 0; i < n0; i++) st.people.push(person(t0.id, {name: "AA" + i}));
      for(let i = 0; i < n1; i++) st.people.push(person(t1.id, {name: "BB" + i}));
      return st;
    };
    /* A title wide enough that the header, not either band's own content, sets
       the pyramid's half-width — which is what keeps a two-person band's slack
       generous enough for the shift to land on its true, unclamped optimum
       instead of being cut short by the band's own edges. */
    const WIDE_TITLE = "A very extremely long chart title to force lots of extra width here";

    /* the row of avatar centres on one band, read off the layout's own output —
       never by recomputing x0 from state */
    const rowAt = (L, bandIndex) => {
      const y = (L.bands[bandIndex] && L.bands[bandIndex].pts[0][1] + 29) ?? null;
      if(y === null) return [];
      return L.avatars.filter(a => Math.abs(a.cy - y) < 0.01)
                       .sort((p, q) => p.cx - q.cx).map(a => a.cx);
    };
    /* personW measured from two ADJACENT avatars actually drawn in a band —
       the second writer every case below leans on instead of re-running the
       app's own personW arithmetic */
    const personWOf = row => (row.length > 1 ? row[1] - row[0] : null);
    const dmin = (phi, pw) => Math.min(phi, pw - phi);
    const phiOf = (x0a, x0b, pw) => (((x0b - x0a) % pw) + pw) % pw;
    /* row-list equality with floating-point tolerance — JSON.stringify would
       fail two lists that agree to 1e-11 but differ in their last printed
       digit, which is not the thing any of these checks mean to assert */
    const rowsClose = (r1, r2, msg) => {
      check(r1.length === r2.length && r1.every((v, j) => Math.abs(v - r2[j]) < 1e-6), msg);
    };

    /* ---- T1: cross-writer no-op — headcounts already stagger the grids
       past clearance, so attach must not move anything at all */
    {
      const st = twoGrade(2, 5, {below: false});
      const withAttach = layout(st);
      const r1a = rowAt(withAttach, 2);
      st.tiers[1].attach = false;
      const noAttach = layout(st);
      const r1b = rowAt(noAttach, 2);
      check(r1a.length === 5 && r1b.length === 5, "T1: both runs draw all five lower-band people");
      rowsClose(r1a, r1b,
        "T1: with grids already clear, attach changes none of the lower band's x positions");
    }

    /* ---- T2: cross-writer collision — equal counts under centre alignment
       naturally land on the same grid; attach must move the lower one */
    {
      const st = twoGrade(2, 2, {below: true, title: WIDE_TITLE});
      const withAttach = layout(st);
      st.tiers[1].attach = false;
      const noAttach = layout(st);
      const r0 = rowAt(withAttach, 1), r1t = rowAt(withAttach, 2);
      const r1f = rowAt(noAttach, 2);
      const pw = personWOf(r0);
      check(pw > 0, "T2: personW measured off adjacent avatars");
      rowsClose(rowAt(noAttach, 1), r1f,
        "T2: unattached, equal counts under centre alignment naturally share one grid (the collision this feature exists for)");
      const shiftS = r1t.map((cx, j) => cx - r1f[j]);
      check(shiftS.every(s => Math.abs(s - shiftS[0]) < 1e-6),
        "T2: attach moves every lower-band avatar by one shared amount, not some of them");
      check(Math.abs(shiftS[0]) > 1,
        "T2: and that shared amount is not zero — attach actually did something");
      const x0a = r0[0] - pw/2, x0b = r1t[0] - pw/2;
      const d = dmin(phiOf(x0a, x0b, pw), pw);
      near(d, pw/2, "T2: the shifted grid lands at its farthest possible point from the one above — got " + d, 0.01);
    }

    /* ---- T3: clearance sweep, centre-aligned attached bands only, across
       both label modes and all three densities */
    {
      const BESIDE_CLEAR = 36; // literal: ceil(sqrt((2*34)**2 - 58**2)) — do not derive this from G here
      for(const below of [false, true]){
        for(const d of DENSITIES){
          const st = twoGrade(2, 2, {below, density: d, title: WIDE_TITLE});
          const L = layout(st);
          const r0 = rowAt(L, 1), r1 = rowAt(L, 2);
          const pw = personWOf(r0);
          check(pw > 0, "T3 " + (below?"below":"beside") + "/" + d + ": personW measured");
          const x0a = r0[0] - (below ? pw/2 : MODULE.G.avaR + 4);
          const x0b = r1[0] - (below ? pw/2 : MODULE.G.avaR + 4);
          const got = dmin(phiOf(x0a, x0b, pw), pw);
          if(below){
            /* Below the photo a label may be as wide as the person column
               itself, so there is no fixed clearance to demand: two attached
               bands share one grid of pitch personW, and two such grids stand
               farthest apart at half a pitch — which is the phase the shift
               moves to, and past which they walk back into step. The
               achievable optimum IS the requirement here. */
            near(got, pw/2, "T3 below/" + d + ": clearance reaches the achievable optimum — got " + got, 0.01);
          }else{
            check(got >= BESIDE_CLEAR - 1,
              "T3 beside/" + d + ": clearance is at least the literal floor — got " + got);
          }
        }
      }
    }

    /* ---- T4: clamp — a band too full to reach the ideal shift moves only as
       far as its own edges allow, and never off the band. A flat pyramid
       (angle 0) minimises the slack a centred, equal-count attached band gets
       for free, which is what makes the clamp bind here instead of the shift
       quietly reaching its unclamped optimum. */
    {
      const st = twoGrade(2, 2, {below: false, density: "tight"});
      st.angle = 0;
      const L = layout(st);
      const band1 = L.bands?.[2];
      const L0 = band1?.pts?.[0]?.[0] ?? -Infinity, R0 = band1?.pts?.[1]?.[0] ?? Infinity;
      const r1 = rowAt(L, 2);
      check(r1.length === 2, "T4: both lower-band people are drawn");
      check(r1.every(cx => cx >= L0 - 0.01 && cx <= R0 + 0.01),
        "T4: every clamped avatar stays within its own band's top-edge span");
      const bad = [];
      allFinite(L, "L", bad);
      eq(bad.length, 0, "T4: the clamped layout stays entirely finite");
      /* and the clamp really is binding here, or this proves nothing about
         the clamp at all */
      const r0 = rowAt(L, 1);
      const pw = personWOf(r0);
      const x0a = r0[0] - (MODULE.G.avaR + 4), x0b = r1[0] - (MODULE.G.avaR + 4);
      const got = dmin(phiOf(x0a, x0b, pw), pw);
      check(got < pw/2 - 1,
        "T4: this fixture genuinely runs out of slack before reaching the ideal — got " + got + " of " + (pw/2));
    }

    /* ---- T5: chain — a shift cascades off the PREVIOUS band's real, final
       (post-shift) position, not its untouched one */
    {
      const t0 = tier("A", "GradeA"), t1 = tier("B", "GradeB", {attach: true}),
            t2 = tier("C", "GradeC", {attach: true});
      const st = baseState([t0, t1, t2], []);
      st.brand = ""; st.title = WIDE_TITLE;
      st.nameLabelPosition = "next";
      st.showGradeCode = false; st.showGradeName = false;
      for(let i = 0; i < 2; i++) st.people.push(person(t0.id, {name: "AA" + i}));
      for(let i = 0; i < 2; i++) st.people.push(person(t1.id, {name: "BB" + i}));
      for(let i = 0; i < 2; i++) st.people.push(person(t2.id, {name: "CC" + i}));
      const L = layout(st);
      const r0 = rowAt(L, 1), r1 = rowAt(L, 2), r2 = rowAt(L, 3);
      check(r0.length === 2 && r1.length === 2 && r2.length === 2, "T5: all three bands drawn");
      const pw = personWOf(r0);
      const x0 = row => row[0] - (MODULE.G.avaR + 4);
      const d01 = dmin(phiOf(x0(r0), x0(r1), pw), pw);
      const d12 = dmin(phiOf(x0(r1), x0(r2), pw), pw);
      check(d01 >= 36 - 1, "T5: band 0-1 clears — got " + d01);
      check(d12 >= 36 - 1,
        "T5: band 1-2 clears too, using band 1's ACTUAL shifted position — got " + d12);
    }

    /* ---- T6: degenerate — an attached band with nobody in it, whose
       predecessor also has nobody in it, shifts nothing and stays finite */
    {
      const t0 = tier("A", "GradeA"), t1 = tier("B", "GradeB", {attach: true}),
            t2 = tier("C", "GradeC");
      const st = baseState([t0, t1, t2], [person(t2.id, {name: "Solo One"}), person(t2.id, {name: "Solo Two"})]);
      st.brand = ""; st.showGradeCode = false; st.showGradeName = false;
      const L = layout(st);
      const bad = [];
      allFinite(L, "L", bad);
      eq(bad.length, 0, "T6: an empty attached band and an empty predecessor leave a finite chart");
      eq(rowAt(L, 3).length, 2, "T6: the only populated grade still draws its people");
    }

    /* ---- T7: an explicit anchor beats the automatic offset — left/right
       stay flush even when their grids collide */
    {
      /* left: kept as a direct regression guard on the promised behaviour,
         though mutation-testing this step's own new code (removing the
         align==="center" guard, or the clamp) could not turn it red here —
         a left-aligned block's own x0 already equals its clamp's lower bound
         (lo = peopleL - x0 = 0 by construction of the "left" formula itself),
         and the pyramid widens monotonically going down (L0 = k*(natH-y0),
         strictly decreasing in y0), so the correction this feature would want
         to make for a left-aligned collision always points further left than
         flush-left already sits. That pins x0Final === x0 for any two-band
         left-aligned pair independent of whether the new exemption exists at
         all. See T7 right below for the case that does discriminate the
         exemption by mutation. */
      {
        const st = twoGrade(3, 3, {align: "left"});
        const withAttach = layout(st);
        const r1a = rowAt(withAttach, 2);
        st.tiers[1].attach = false;
        const r1b = rowAt(layout(st), 2);
        rowsClose(r1a, r1b,
          "T7 left: flush-left stays flush — attach changes none of the lower band's x positions");
      }
      /* right: the mirror-image edge (R0) is NOT independent of the gap above
         it — it moves with the whole pyramid's natural height regardless of
         alignment, which is a pre-existing, unrelated property of the last
         band's own width solve, not something this feature touches. So the
         invariant checked here is the one the design actually promises —
         "flush stays flush" — read directly off this band's own R0 rather
         than off a second run. */
      {
        const st = twoGrade(4, 4, {align: "right"});
        st.angle = 3;
        const L = layout(st);
        const band1 = L.bands[2];
        const R0 = band1.pts[1][0];
        const r1 = rowAt(L, 2);
        const pw = personWOf(r1);
        const expectedX0 = R0 - MODULE.G.padRight - 4*pw;
        const expectedFirstCx = expectedX0 + MODULE.G.avaR + 4;
        near(r1[0], expectedFirstCx,
          "T7 right: flush-right stays flush against this band's own right edge — got "
          + r1[0] + ", want " + expectedFirstCx, 0.01);
      }
    }
  }

  /* ---- person labels are three independent choices shared by every engine */
  {
    const words = t => t.segs.map(s => s.t).join("");
    for(const kind of ["pyramid", "swimlanes"]){
      const draw = changes => {
        const st = baseState([a], [person(a.id, {name:"Ada Example", office:"FRA"})]);
        st.layout = kind;
        Object.assign(st, changes || {});
        return layout(st);
      };
      const all = draw();
      const allLines = all.texts.filter(t => t.baseline === "alphabetic").map(words);
      check(allLines.some(s => /Ada/.test(s) && /Example/.test(s)), kind + ": Display name draws the person name");
      check(allLines.some(s => /Partner\s+\|\s+FRA/.test(s)),
        kind + ": Display grade and Display office draw one combined subline");

      const noName = draw({showPersonName:false});
      const noNameLines = noName.texts.filter(t => t.baseline === "alphabetic").map(words);
      check(!noNameLines.some(s => /Ada|Example/.test(s)), kind + ": hiding names removes only the name line");
      check(noNameLines.some(s => /Partner\s+\|\s+FRA/.test(s)), kind + ": the grade and office remain");

      const officeOnly = draw({showPersonName:false, showPersonGrade:false});
      const officeLines = officeOnly.texts.filter(t => t.baseline === "alphabetic").map(words);
      eq(officeLines.length, 1, kind + ": office-only produces one person line");
      eq(officeLines[0], "FRA", kind + ": that one line is the office");

      const gradeOnly = draw({showPersonName:false, showPersonGroup:false});
      const gradeLines = gradeOnly.texts.filter(t => t.baseline === "alphabetic").map(words);
      eq(gradeLines.length, 1, kind + ": grade-only produces one person line");
      eq(gradeLines[0], "Partner", kind + ": that one line is the grade");

      const none = draw({showPersonName:false, showPersonGrade:false, showPersonGroup:false,
                         showGradeCode:false, showGradeName:false});
      eq(none.texts.filter(t => t.baseline === "alphabetic").length, 0,
        kind + ": disabling all three removes every person-label line");
      const band = none.bands[1], bandCx = (band.pts[0][0] + band.pts[1][0])/2;
      near(none.avatars[0].cx, bandCx,
        kind + ": with no person labels the remaining photo is centred, not left-leaning");
      const bad = []; allFinite(none, "L", bad);
      eq(bad.length, 0, kind + ": every hidden-label combination remains finite");
    }
  }

  /* ---- empty grades are left out, but an empty ROSTER still shows its lanes */
  {
    const st = baseState([a, b, c], [person(a.id), person(c.id)]);
    const L = swim(st);
    eq(lanesOf(L).length, 2, "a grade with nobody in it is not drawn");
    eq(headingsOf(L, lanesOf(L)[1])[0].segs[0].t, "C",
       "and the lanes after it close up rather than leaving a hole");
    eq(L.empty, false, "the chart is not empty");

    const none = swim(baseState([a, b, c], []));
    eq(lanesOf(none).length, 3,
       "with nobody on the chart at all, every lane is still shown — an empty page would be a lie");
    eq(none.empty, false, "and that is not the empty chart either");

    const noGrades = swim(baseState([], []));
    eq(noGrades.empty, true, "no grades at all IS the empty chart");
    const bad = [];
    allFinite(noGrades, "L", bad);
    eq(bad.length, 0, "and it is still finite");
  }

  /* ---- attach closes a lane gap; share combines lanes; state is untouched */
  {
    const linked = [
      tier("P", "Partner"),
      Object.assign({}, tier("SA", "Senior Assistant"), {attach: true}),
      Object.assign({}, tier("A", "Assistant"), {attach: true, merge: true})
    ];
    const st = baseState(linked, [
      person(linked[0].id, {name:"Partner Person"}),
      /* Deliberately put A before SA in the roster: concatenating tier-by-tier
         would reverse these two inside the shared lane. */
      person(linked[2].id, {name:"Alpha First"}),
      person(linked[1].id, {name:"Senior Second"})
    ]);
    const before = JSON.stringify(st.tiers);
    const L = swim(st);
    eq(lanesOf(L).length, 2,
       "a shared grade joins the lane immediately before it");
    const linkedLanes = lanesOf(L);
    near(linkedLanes[1].pts[0][0] - linkedLanes[0].pts[1][0], 0,
      "an attached shared lane closes the gap to the lane before it");
    eq(headingsOf(L, linkedLanes[1])[0].segs[0].t, "SA / A",
      "a shared lane combines both grade codes in its heading");
    const sharedX = (linkedLanes[1].pts[0][0] + linkedLanes[1].pts[1][0])/2;
    const sharedPeople = L.avatars.filter(av => Math.abs(av.cx - sharedX) < 1e-9)
      .sort((p, q) => p.cy - q.cy);
    eq(sharedPeople.length, 2,
      "a shared lane contains people from both grades");
    eq(sharedPeople.map(av => av.ini).join(","), "AF,SS",
      "people from shared grades retain their global roster order");
    eq(JSON.stringify(st.tiers), before,
       "and the swimlane engine writes nothing back to attach or merge");

    /* Clearing the flags restores ordinary lane gaps. */
    const plain = JSON.parse(JSON.stringify(st));
    plain.tiers.forEach(t => { t.attach = false; t.merge = false; });
    const plainLanes = lanesOf(swim(plain));
    const plainGaps = plainLanes.slice(1).map((lane, i) =>
      lane.pts[0][0] - plainLanes[i].pts[1][0]);
    const ordinaryGap = plainGaps[0];
    check(ordinaryGap > 0 && plainGaps.every(g => Math.abs(g - ordinaryGap) < 1e-9),
      "unattached swimlanes retain the standard lane gap");

    /* An attached lane never skips across a hidden empty predecessor and binds
       itself to the wrong visible grade. */
    const hidden = [tier("P", "Partner"),
      Object.assign({}, tier("SA", "Senior Assistant"), {attach:true}),
      Object.assign({}, tier("A", "Assistant"), {attach:true})];
    const hiddenState = baseState(hidden,
      [person(hidden[0].id), person(hidden[2].id)]);
    const hiddenLanes = lanesOf(swim(hiddenState));
    near(hiddenLanes[1].pts[0][0] - hiddenLanes[0].pts[1][0], ordinaryGap,
      "an attached grade does not jump across a hidden grade");
  }

  /* ---- the pyramid angle is not read, and is not disturbed */
  {
    /* two people in one lane, so the person-to-person gap is actually exercised
       — with one person per lane an engine could read the angle and nothing
       would move */
    const st = baseState([a, c], [person(a.id), person(a.id), person(c.id), person(c.id)]);
    const shapes = [0, 2, 4].map(ang => {
      const s2 = JSON.parse(JSON.stringify(st)); s2.angle = ang;
      return JSON.stringify(swim(s2));
    });
    check(shapes.every(s => s === shapes[0]), "the pyramid angle does not change a swimlane chart");
    const kept = JSON.parse(JSON.stringify(st)); kept.angle = 4;
    swim(kept);
    eq(kept.angle, 4, "and the stored angle survives being drawn as lanes");
  }

  /* ---- long text: the lane is capped and the heading is cut deterministically */
  {
    const longTier = tier("VERY LONG CODE INDEED",
      "A Grade Name Far Too Long For Any Lane To Hold Without Help");
    const st = baseState([longTier], [
      person(longTier.id, {name: "Maximiliane Katharina von Habsburg-Lothringen"})
    ]);
    st.showGradeName = true;
    const L = swim(st);
    const w = lanesOf(L)[0].pts[1][0] - lanesOf(L)[0].pts[0][0];
    check(w <= 300, "a very long name cannot widen a lane past its cap — got " + w);
    const name = headingsOf(L, lanesOf(L)[0])[1].segs[0].t;
    check(name.length < longTier.label.length && /…$/.test(name),
          "the grade name is cut to fit and ends in an ellipsis — got " + name);
    /* deterministic: the same input twice gives the same string */
    eq(headingsOf(L, lanesOf(L)[0])[1].segs[0].t,
       headingsOf(swim(JSON.parse(JSON.stringify(st))), lanesOf(L)[0])[1].segs[0].t,
       "and it is cut the same way every time");
    /* FOUND IN THE BROWSER, not by a test: a name wider than the lane ran
       straight across its neighbour. The pyramid widens its person column
       instead, which a grid of equal lanes cannot do — so the name is cut to
       the lane like the heading. Both lines of every person are checked here,
       against the lane they are actually in. */
    {
      const wide = tier("W", "Wide");
      const stW = baseState([wide], [
        person(wide.id, {name: "Maximiliane Katharina von Habsburg-Lothringen",
                         office: "A Very Long Office Name Indeed That Will Not Fit"}),
        person(wide.id, {name: "Shortname"})
      ]);
      const LW = swim(stW);
      const band = lanesOf(LW)[0];
      const inner = (band.pts[1][0] - band.pts[0][0]) - 2*14;   // SW.padX either side
      LW.texts.filter(t => t.baseline === "alphabetic").forEach((t, i) => {
        /* the same measurement the layout used, from the same stub */
        let w = 0;
        t.segs.forEach(g => { w += String(g.t).length * (i % 2 ? 11 : 15) * 0.5; });
        check(w <= inner + 0.001,
              "person line " + i + " fits inside its lane — " + w.toFixed(1) + " vs " + inner.toFixed(1));
      });
      const longest = LW.texts.filter(t => t.baseline === "alphabetic")[0];
      check(longest.segs.map(g => g.t).join("").indexOf("…") >= 0,
            "and the one that did not fit says so with an ellipsis");
      /* the surname survives: a lane is scanned by surname, so that is the last
         thing to be cut */
      check(/Maximiliane/.test(longest.segs[0].t),
            "the surname is kept and the given names are what get cut");
      /* a name that fits is left completely alone */
      const shortLine = LW.texts.filter(t => t.baseline === "alphabetic")[2];
      eq(shortLine.segs.map(g => g.t).join(""), "Shortname",
         "a name that fits is untouched");
    }

    eq(MODULE.ellipsize("short", 1000, "400 12px sans"), "short",
       "ellipsize leaves text that already fits alone");
    eq(MODULE.ellipsize("", 10, "400 12px sans"), "", "and an empty string stays empty");
    check(/…/.test(MODULE.ellipsize("abcdefghijklmnop", 12, "400 12px sans")),
          "and marks what it removed");
  }

  /* ---- the fit still puts the drawing on the page, at every page and spacing */
  {
    for(const page of ["landscape", "portrait", "square"]){
      for(const d of DENSITIES){
        const st = baseState([a, b, c], Array.from({length: 9}, (_, i) => person([a,b,c][i%3].id)));
        st.page = page; st.density = d;
        const L = swim(st);
        check(L.fit.s > 0, "swimlanes scale is positive: " + page + " / " + d);
        check(L.natW > 0 && L.natH > 0, "and the natural size is positive: " + page + " / " + d);
        check(L.natW*L.fit.s <= L.page.w - 2*MODULE.G.margin + 0.001
           && L.natH*L.fit.s <= L.page.h - 2*MODULE.G.margin + 0.001,
              "and the drawing fits inside the page margins: " + page + " / " + d);
      }
    }
    /* spacing is the control it claims to be: airy is taller than tight */
    const tall = d => {
      const st = baseState([a], [person(a.id), person(a.id), person(a.id)]);
      st.density = d; return swim(st).natH;
    };
    check(tall("airy") > tall("balanced") && tall("balanced") > tall("tight"),
          "spacing changes the distance between people in a lane");
  }

  /* ---- Bold policy: nameSegs is the single place a name's weight is chosen.
     Every site that measures or draws a name has to agree with it, and the
     drift this step exists to prevent is exactly a measure site that keeps
     using a fixed 600/400 while the draw site follows nameBold — so the
     measure evidence and the draw evidence are checked separately, both
     against one literal weight table fixed here, never against each other or
     against a value the code under test produced itself.

     The stub's measureText is length-only (see the PREAMBLE comment above
     MEAS_LOG) and does not react to the weight token in meas.font at all, so
     comparing pixel WIDTHS across nameBold settings would pass no matter
     which weight either engine actually measured with — it would prove
     nothing about this drift. The evidence instead comes from MEAS_LOG: the
     literal (font, text) pairs a measure site actually pushed through
     meas.measureText, read back and checked against the same literal table
     the drawn segs are checked against. */
  {
    const WANT = {given: [600, 400], family: [400, 600], all: [600], none: [400]};
    const NAME = "Zora Quillfeather";

    /* "15px" is used nowhere else in either engine or in fitName (grep the
       app: it is the grade code, the title and the subline that use other
       sizes) — with exactly one person on the chart, every 15px call in the
       log is about this one name, so the FIRST segs.length of them are
       whichever segments the earliest measure site actually walked. A
       lookup keyed by text alone would miss a mutation that changes the
       number or shape of the segments measured (e.g. "all"'s one segment
       replaced by "given"'s two) as long as neither of the substituted
       segments happens to collide with a real one; comparing the whole
       ordered prefix does not have that gap. */
    const firstSegCalls = (log, n) => log.filter(m => /15px/.test(m.font)).slice(0, n);
    const weightOf = (call) => { const m = call && /^(\d+)/.exec(call.font); return m ? parseInt(m[1], 10) : null; };

    for(const nameBold of Object.keys(WANT)){
      /* (a) the helper itself, against the literal table */
      const segs = MODULE.nameSegs({nameBold}, NAME);
      eq(segs.map(s => s.w).join(","), WANT[nameBold].join(","),
        "nameSegs(" + nameBold + ") assigns weights " + JSON.stringify(WANT[nameBold]));
      eq(segs.map(s => s.t).join(""), NAME,
        "nameSegs(" + nameBold + ") still draws the whole name — got "
        + JSON.stringify(segs.map(s => s.t).join("")));

      /* (b) Pyramid: the drawn segs, and the font each segment was actually
         measured with while sizing the person column */
      {
        const g = tier("P", "Partner");
        const st = baseState([g], [person(g.id, {name: NAME})]);
        st.nameBold = nameBold;
        st.showPersonGrade = false; st.showPersonGroup = false;
        MODULE.MEAS_LOG.length = 0;
        const L = layout(st);
        const line = L.texts.find(t => t.baseline === "alphabetic"
          && t.segs.map(s => s.t).join("") === NAME);
        check(!!line, "pyramid " + nameBold + ": the name line is drawn");
        if(line){
          eq(line.segs.map(s => s.w).join(","), WANT[nameBold].join(","),
            "pyramid " + nameBold + ": drawn segs carry the weights nameSegs chose");
        }
        const firstCalls = firstSegCalls(MODULE.MEAS_LOG, segs.length);
        eq(firstCalls.map(c => c.text).join("|"), segs.map(s => s.t).join("|"),
          "pyramid " + nameBold + ": the measure phase reads the name in the segments nameSegs chose");
        eq(firstCalls.map(weightOf).join(","), segs.map(s => s.w).join(","),
          "pyramid " + nameBold + ": and measures each of them at the weight nameSegs chose");
      }

      /* (c) Swimlanes: the same pair of checks, through the lane-width
         measure loop and through fitName on the way to the drawn segs */
      {
        const g = tier("P", "Partner");
        const st = baseState([g], [person(g.id, {name: NAME})]);
        st.nameBold = nameBold;
        st.showPersonGrade = false; st.showPersonGroup = false;
        MODULE.MEAS_LOG.length = 0;
        const L = swim(st);
        const line = L.texts.find(t => t.baseline === "alphabetic"
          && t.segs.map(s => s.t).join("") === NAME);
        check(!!line, "swimlanes " + nameBold + ": the name line is drawn");
        if(line){
          eq(line.segs.map(s => s.w).join(","), WANT[nameBold].join(","),
            "swimlanes " + nameBold + ": fitName preserved the weights nameSegs chose");
        }
        const firstCalls = firstSegCalls(MODULE.MEAS_LOG, segs.length);
        eq(firstCalls.map(c => c.text).join("|"), segs.map(s => s.t).join("|"),
          "swimlanes " + nameBold + ": the lane-width measure phase reads the name in the segments nameSegs chose");
        eq(firstCalls.map(weightOf).join(","), segs.map(s => s.w).join(","),
          "swimlanes " + nameBold + ": and measures each of them at the weight nameSegs chose");
      }
    }

    /* ---- fitName keeps the weight assignment while it cuts. A narrow width
       forces the SECOND segment to give way first no matter the policy; under
       "family" that second segment is the bold one, so this is the case a
       cut that always shrinks segs[1] at a hardcoded weight would get wrong. */
    {
      const long = MODULE.nameSegs({nameBold: "family"}, "Zora Quillfeatherstein");
      const cut = MODULE.fitName(long, 60);
      eq(cut.length, 2, "fitName(family) still returns two segments while cutting");
      eq(cut[0].t, long[0].t, "fitName(family) leaves the given-name segment whole");
      eq(cut[0].w, 400, "fitName(family) keeps the given-name segment at its assigned weight");
      eq(cut[1].w, 600, "fitName(family) keeps the family-name segment's weight while shortening it");
      check(cut[1].t.length < long[1].t.length,
        "fitName(family) actually shortened the family-name segment, not the given-name one");
      check(/…/.test(cut[1].t), "fitName(family) ellipsizes the segment it shortened");
    }
  }
}

/* ---------------------------------------------------------- 7b. hive

   One hexagon per GRADE GROUP, not per person — a group's heading and its
   own people sit TOGETHER inside its hex, as one centred stack, so there is
   no separate heading band the way a Swimlanes lane has one (only the title
   bar at the very top is banded). This mirrors Swimlanes' skeleton
   (grouping, empty-drop, attach) rather than the band-stack machinery.
   Every assertion here is answered by a second source — the emitted
   polygon's own bounding box for "is an avatar (or a heading) inside its
   group's hex" (never the R formula), the output's own avatar spacing for
   the row-offset pitch (never HV recomputed), CJ's own grid-dimension table
   written out as a literal (never Math.ceil(Math.sqrt(N)) recomputed), and
   a THIRD state's own measured gap for what an unattached hex-to-hex gap is
   (never an HV literal). */
{
  const hiveOf = st => { st.layout = "hive"; return layout(st); };
  const hexBandsOf   = L => L.bands.filter(b => b.pts.length === 6);
  const titleBandsOf = L => L.bands.filter(b => b.pts.length === 4);
  const headingsOf   = L => L.texts.filter(t => t.baseline === "middle" && t.anchor === "middle");
  const bbox = pts => {
    const xs = (pts || []).map(p => p[0]), ys = (pts || []).map(p => p[1]);
    return {minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys)};
  };
  const cx = b => { const bx = bbox(b?.pts); return (bx.minX+bx.maxX)/2; };
  const cy = b => { const bx = bbox(b?.pts); return (bx.minY+bx.maxY)/2; };

  /* ---- band census: exactly one four-point title rect, plus one six-point
     hex per drawn group, with the heading drawn inside the hex rather than
     as its own band */
  {
    const tiers = Array.from({length:3}, (_, i) => tier("G"+i, "Grade "+i));
    const st = baseState(tiers, tiers.map(t => person(t.id)));
    const L = hiveOf(st);
    eq(titleBandsOf(L).length, 1, "band census: exactly one four-point band, the title bar");
    eq(hexBandsOf(L).length, 3, "band census: one six-point hex per drawn group, and nothing else");
    eq(L.bands.length, 4, "band census: no other band shape appears");
  }

  /* ---- state.angle (the angle) must never be read */
  {
    const g1 = tier("P", "Partner"), g2 = tier("C", "Consultant", {fill: "white"});
    const st = baseState([g1, g2], [
      person(g1.id), person(g1.id), person(g2.id)
    ]);
    const shapes = [0, 2, 4].map(ang => {
      const st2 = JSON.parse(JSON.stringify(st)); st2.angle = ang;
      return JSON.stringify(hiveOf(st2));
    });
    check(shapes.every(s => s === shapes[0]),
      "Hive output is identical across every stored angle — state.angle is never read");
  }

  /* ---- one hexagon per DRAWN GROUP (not per person), and every drawn
     person's avatar sits inside their own group's hex */
  {
    const g1 = tier("P", "Partner"), g2 = tier("C", "Consultant", {fill: "white"});
    const people = [
      person(g1.id), person(g1.id), person(g1.id),
      person(g2.id), person(g2.id)
    ];
    const st = baseState([g1, g2], people);
    const L = hiveOf(st);
    const hexes = hexBandsOf(L);
    eq(hexes.length, 2, "one hexagon band per drawn GROUP, not per person");
    eq(L.avatars.length, people.length, "and still one avatar per drawn person");

    const g1box = bbox(hexes[0]?.pts), g2box = bbox(hexes[1]?.pts);
    L.avatars.slice(0, 3).forEach((av, i) => {
      check(av.cx >= g1box.minX - 1e-9 && av.cx <= g1box.maxX + 1e-9
         && av.cy >= g1box.minY - 1e-9 && av.cy <= g1box.maxY + 1e-9,
        "Partner avatar " + i + " lies inside its own group's hex bounding box");
    });
    L.avatars.slice(3).forEach((av, i) => {
      check(av.cx >= g2box.minX - 1e-9 && av.cx <= g2box.maxX + 1e-9
         && av.cy >= g2box.minY - 1e-9 && av.cy <= g2box.maxY + 1e-9,
        "Consultant avatar " + i + " lies inside its own group's hex bounding box");
    });

    /* ---- uniform size: both hexes (different headcounts) are identical */
    const w1 = g1box.maxX - g1box.minX, h1 = g1box.maxY - g1box.minY;
    const w2 = g2box.maxX - g2box.minX, h2 = g2box.maxY - g2box.minY;
    near(w1, w2, "every hex in the chart is the same width, whatever its own headcount", 1e-9);
    near(h1, h2, "and the same height", 1e-9);

    /* ---- pointy-top: a shape property of one hex, independent of R */
    near(w1/h1, Math.sqrt(3)/2, "a hive hex is pointy-top: (maxX-minX)/(maxY-minY) = sqrt(3)/2", 1e-6);

    /* ---- heading-in-cell: the heading text sits ON its own group's hex,
       centred horizontally on it, above the people and inside the hex */
    const heads = headingsOf(L).sort((a, b) => a.x - b.x);
    eq(heads.length, 2, "one heading per drawn group");
    near(heads[0].x, cx(hexes[0]), "the Partner heading is centred on its own hex's centre x", 1e-6);
    near(heads[1].x, cx(hexes[1]), "the Consultant heading is centred on its own hex's centre x", 1e-6);
    check(heads[0].y >= g1box.minY - 1e-9 && heads[0].y <= g1box.maxY + 1e-9,
      "the Partner heading's y sits inside its own hex's vertical span");
    check(heads[0].y < L.avatars[0].cy,
      "the Partner heading sits above the first avatar row's centre");
  }

  /* ---- symmetry: a 5-person cell reads 3 over 2, and every row is
     independently centred on the hex's own centre x */
  {
    const g1 = tier("P", "Partner");
    const st = baseState([g1], Array.from({length:5}, () => person(g1.id)));
    const L = hiveOf(st);
    const hexes = hexBandsOf(L);
    eq(hexes.length, 1, "one hex for one drawn group");
    eq(L.avatars.length, 5, "five avatars for a five-person cell");
    const hcx = cx(hexes[0]);
    const rowsByY = new Map();
    L.avatars.forEach(av => {
      const key = Math.round(av.cy*1000)/1000;
      if(!rowsByY.has(key)) rowsByY.set(key, []);
      rowsByY.get(key).push(av);
    });
    const rowSizes = [...rowsByY.values()].map(r => r.length).sort((a,b) => b-a);
    eq(rowSizes.join(","), "3,2", "a five-person cell reads 3 over 2, row sizes differing by at most one");
    for(const row of rowsByY.values()){
      const centroidX = row.reduce((s, av) => s + av.cx, 0)/row.length;
      near(centroidX, hcx, "each row's avatar centroid x equals the hex's own centre x", 1e-6);
    }
  }

  /* ---- grid dimensions: CJ's own table, a literal in the test, never
     Math.ceil(Math.sqrt(N)) recomputed here */
  {
    const table = {1:[1,1], 2:[2,1], 3:[2,2], 4:[2,2], 5:[3,2], 6:[3,2], 7:[3,3]};
    for(const nStr of Object.keys(table)){
      const n = Number(nStr);
      const [wantCols, wantRows] = table[nStr];
      const tiers = Array.from({length:n}, (_, i) => tier("G"+i, "Grade "+i));
      const st = baseState(tiers, tiers.map(t => person(t.id)));
      const L = hiveOf(st);
      const hexes = hexBandsOf(L);
      eq(hexes.length, n, "grid-dims fixture for N=" + n + " draws " + n + " hexes");
      /* columns: count how many distinct row-0 y-centres exist by grouping
         hex centres into rows via their own y, then count the biggest row */
      const centres = hexes.map(b => ({cx: cx(b), cy: cy(b)}));
      const rowYs = [...new Set(centres.map(c => Math.round(c.cy*1000)/1000))];
      const gotRows = rowYs.length;
      const gotCols = Math.max(...rowYs.map(y =>
        centres.filter(c => Math.round(c.cy*1000)/1000 === y).length));
      eq(gotCols, wantCols, "N=" + n + ": columns match CJ's table (" + wantCols + "x" + wantRows + ")");
      eq(gotRows, wantRows, "N=" + n + ": rows match CJ's table (" + wantCols + "x" + wantRows + ")");
    }
  }

  /* ---- offset rows: row 1 is shifted half the row-0 pitch */
  {
    /* 5 groups -> cols=3, rows=2 (row 0 holds 3, row 1 holds 2), both rows'
       first hex is column 0 */
    const tiers = Array.from({length:5}, (_, i) => tier("G"+i, "Grade "+i));
    const st = baseState(tiers, tiers.map(t => person(t.id)));
    const L = hiveOf(st);
    const hexes = hexBandsOf(L);
    eq(hexes.length, 5, "five hexes for five drawn groups");
    const byRow = hexes.slice().sort((a,b) => cy(a) - cy(b) || cx(a) - cx(b));
    const row0 = byRow.filter(b => Math.abs(cy(b) - cy(byRow[0])) < 1e-6).sort((a,b)=>cx(a)-cx(b));
    const row1 = byRow.filter(b => Math.abs(cy(b) - cy(byRow[0])) >= 1e-6).sort((a,b)=>cx(a)-cx(b));
    eq(row0.length, 3, "row 0 holds three hexes");
    eq(row1.length, 2, "row 1 holds two hexes");
    const D = cx(row0[1]) - cx(row0[0]);          // measured pitch, row 0
    check(D > 0, "row 0's own two hexes measure a positive pitch");
    near(cx(row1[0]) - cx(row0[0]), D/2,
      "row 1's first hex is offset by half the measured pitch from row 0's first hex", 1e-6);
  }

  /* ---- attach closes the gap to the hex immediately LEFT IN THE SAME ROW */
  {
    const build = (attachSecond) => {
      const g1 = tier("P", "Partner"), g2 = tier("C", "Consultant", {attach: attachSecond});
      return baseState([g1, g2], [person(g1.id), person(g1.id), person(g2.id)]);
    };
    const gapOf = L => {
      const hexes = hexBandsOf(L);
      return bbox(hexes[1]?.pts).minX - bbox(hexes[0]?.pts).maxX; // second hex's left minus first hex's right
    };
    const attachedGap   = gapOf(hiveOf(build(true)));
    const unattachedGap = gapOf(hiveOf(build(false)));
    near(attachedGap, 0, "an attached hex sits flush against its left neighbour's edge");
    check(unattachedGap > attachedGap + 1e-6,
      "an unattached hex's gap is measurably larger than an attached one's");

    /* the unattached gap's value comes from a THIRD, unrelated state — never
       from an HV literal — so this proves the gap is a genuine constant of
       the engine rather than an artefact of this one fixture */
    const g3a = tier("X", "Ex", {fill: "white"}), g3b = tier("Y", "Why");
    const thirdState = baseState([g3a, g3b], [
      person(g3a.id), person(g3b.id), person(g3b.id), person(g3b.id)
    ]);
    const thirdGap = gapOf(hiveOf(thirdState));
    near(unattachedGap, thirdGap,
      "the unattached gap agrees with the same measurement taken on an unrelated state", 1e-6);

    /* attach is ignored for the first hex of a row — three groups, cols=2,
       so the third group starts row 1. Comparing the SAME state with only
       its attach flag flipped proves the flag has literally no effect on a
       row-starting hex's position, rather than merely "not touching". */
    const g4a = tier("A1", "A1"), g4b = tier("A2", "A2");
    const build4 = (attachThird) => {
      const g4c = tier("A3", "A3", {attach: attachThird});
      return baseState([g4a, g4b, g4c], [person(g4a.id), person(g4b.id), person(g4c.id)]);
    };
    const withAttach = hexBandsOf(hiveOf(build4(true)))[2];
    const without     = hexBandsOf(hiveOf(build4(false)))[2];
    near(cx(withAttach), cx(without),
      "attach on the first hex of a new row changes nothing about its x position", 1e-9);
    near(cy(withAttach), cy(without),
      "...nor its y position", 1e-9);
  }

  /* ---- ink rule: both a hive heading and a hive person label take the ink
     of the hex they sit ON, never the on-white pair Swimlanes uses for
     people who sit on the page */
  {
    const ON_COLOUR = "#ABCDEF", ON_WHITE = "#123456";
    const g1 = tier("P", "Partner", {fill: "green"});
    const g2 = tier("C", "Consultant", {fill: "white"});
    const st = baseState([g1, g2], [person(g1.id, {name: "Ada Example"}), person(g2.id, {name: "Bo Example"})]);
    st.inkOnColour = ON_COLOUR; st.inkOnWhite = ON_WHITE;
    const L = hiveOf(st);
    const heads = headingsOf(L).sort((a, b) => a.x - b.x);
    const names = L.texts.filter(t => t.baseline === "alphabetic" && t.size === 15)
      .sort((a, b) => a.x - b.x || a.y - b.y);
    const subs  = L.texts.filter(t => t.baseline === "alphabetic" && t.size === 11)
      .sort((a, b) => a.x - b.x || a.y - b.y);
    eq(heads.length, 2, "one heading per group");
    eq(names.length, 2, "one name per person");
    eq(subs.length, 2, "one subline per person");
    const rgbOf = (c) => { const m = /rgba\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? m.slice(1,4).map(Number) : null; };
    const alphaOf = (c) => { const m = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(c); return m ? Number(m[1]) : null; };
    const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h); const v = parseInt(m[1],16); return [(v>>16)&255,(v>>8)&255,v&255]; };
    /* g1 (green, filled) is drawn first and sits left of g2 (white) */
    eq(heads[0].color, ON_COLOUR, "the heading on the filled (green) hex takes the on-colour ink");
    eq(heads[1].color, ON_WHITE,  "the heading on the white hex takes the on-white ink");
    eq(names[0].color, ON_COLOUR, "the person on the filled (green) hex takes the on-colour ink");
    eq(names[1].color, ON_WHITE,  "the person on the white hex takes the on-white ink");
    eq(JSON.stringify(rgbOf(subs[0].color)), JSON.stringify(hex(ON_COLOUR)),
      "and that person's subline is the same on-colour ink");
    eq(alphaOf(subs[0].color), 0.62, "at 0.62 alpha");
    eq(JSON.stringify(rgbOf(subs[1].color)), JSON.stringify(hex(ON_WHITE)),
      "the white-hex person's subline is the on-white ink");
    eq(alphaOf(subs[1].color), 0.62, "at 0.62 alpha too");
  }

  /* ---- empty-drop, and the all-empty exception */
  {
    const g1 = tier("P", "Partner"), g2 = tier("C", "Consultant");
    /* one person total: the empty grade's heading (and hex) is dropped */
    {
      const st = baseState([g1, g2], [person(g1.id)]);
      const L = hiveOf(st);
      eq(headingsOf(L).length, 1, "with one person total, only the occupied group draws a heading");
      eq(hexBandsOf(L).length, 1, "and only the occupied group draws a hex");
    }
    /* nobody at all: every grade still shows its heading and an empty hex */
    {
      const st = baseState([g1, g2], []);
      const L = hiveOf(st);
      eq(headingsOf(L).length, 2,
        "with nobody on the chart, both group headings are still drawn");
      eq(hexBandsOf(L).length, 2,
        "and both groups still draw an (empty) hex");
    }
  }
}

/* ---------------------------------------------------------- 7c. matrix

   Swimlanes crossed with a second axis: the same lanes (columns) proven in
   1/7a above, plus rows — state.groups in order, then one more row, LAST,
   for whoever's groupId names no group the document still has. 7c is only
   about that second axis; the lane geometry itself is not re-proven here.
   Every assertion below is answered by a second source — one person's own
   cy compared against another's (never a rowY formula recomputed), a plain
   count of gutter texts filtered by their own drawn shape (never the row
   list's own length), and, for the zero-groups case, computeSwimlaneLayout
   itself, called on the identical state and compared as JSON — the proof
   that Matrix with nothing on its second axis draws the Swimlanes picture,
   not merely something shaped like it. A companion static check (source
   text, never behaviour) keeps that comparison honest: computeMatrixLayout
   must never call computeSwimlaneLayout, or the equality would hold no
   matter what either engine's own formula said. */
{
  const matrixOf = st => { st.layout = "matrix"; return layout(st); };
  const GUTTER_SIZE = 14;   // the size a gutter row label is drawn at — unique among matrix's own texts

  /* person()'s own office default ("FRA" whenever the field is falsy) means
     an empty string can never reach a null groupId through baseState's own
     resolveGroupId conversion — a fixture that wants "no group" has to null
     groupId directly, after baseState() has already run its real, once-only
     conversion for everyone else sharing the same fixture. */
  function clearGroup(st, ...indexes){
    indexes.forEach(i => { st.people[i].groupId = null; });
    return st;
  }
  function noGroups(st){
    st.groups = [];
    st.people.forEach(p => { p.groupId = null; });
    return st;
  }

  /* ---- finite geometry: zero groups, a null-group person alongside named
     ones, a group whose people are all in one lane, every density, both
     label positions, and every person-text field off. */
  {
    const g1 = tier("P", "Partner"), g2 = tier("C", "Consultant");
    const FIX = {
      "zero groups": noGroups(baseState([g1, g2], [
        person(g1.id), person(g2.id)
      ])),
      "two groups plus a null-group person": clearGroup(baseState([g1, g2], [
        person(g1.id, {office: "Berlin"}), person(g2.id, {office: "Munich"}),
        person(g2.id, {office: "Munich"})
      ]), 2),
      "a group whose people are all in one lane": baseState([g1, g2], [
        person(g1.id, {office: "Berlin"}), person(g1.id, {office: "Berlin"}),
        person(g1.id, {office: "Berlin"})
      ])
    };
    for(const label of Object.keys(FIX)){
      for(const d of DENSITIES){
        for(const nlp of ["below", "next"]){
          const st = JSON.parse(JSON.stringify(FIX[label]));
          st.density = d; st.nameLabelPosition = nlp;
          const L = matrixOf(st);
          const bad = [];
          allFinite(L, "L", bad);
          check(bad.length === 0,
            "finite matrix geometry: " + label + " / " + d + " / " + nlp +
            (bad.length ? " — NaN at " + bad.slice(0, 3).join(", ") : ""));
        }
      }
    }
    /* every person-text field off at once — the case that collapses every label */
    {
      const st = JSON.parse(JSON.stringify(FIX["two groups plus a null-group person"]));
      st.showPersonName = false; st.showPersonGrade = false; st.showPersonGroup = false;
      const L = matrixOf(st);
      const bad = [];
      allFinite(L, "L", bad);
      check(bad.length === 0, "finite matrix geometry with every person label off" +
        (bad.length ? " — NaN at " + bad.slice(0, 3).join(", ") : ""));
    }
  }

  /* ---- state.angle (the angle) must never be read */
  {
    const g1 = tier("P", "Partner"), g2 = tier("C", "Consultant");
    const st = baseState([g1, g2], [
      person(g1.id, {office: "Berlin"}), person(g2.id, {office: "Munich"})
    ]);
    const shapes = [0, 2, 4].map(ang => {
      const st2 = JSON.parse(JSON.stringify(st)); st2.angle = ang;
      return JSON.stringify(matrixOf(st2));
    });
    check(shapes.every(s => s === shapes[0]),
      "Matrix output is identical across every stored angle — state.angle is never read");
  }

  /* ---- shared row height: a row is as tall as its own deepest cell
     across the lanes it crosses, never one height shared by every row.
     Lane A holds 3 people in row 1; lane B holds 1 in row 1 and 1 in row
     2 — lane B's row-2 avatar must sit below lane A's third row-1 avatar,
     which it only does if row 1's height came from lane A's headcount
     (3), not lane B's (1). */
  {
    const g1 = tier("A", "Lane A"), g2 = tier("B", "Lane B");
    const st = baseState([g1, g2], [
      person(g1.id, {office: "Row1"}), person(g1.id, {office: "Row1"}), person(g1.id, {office: "Row1"}),
      person(g2.id, {office: "Row1"}),
      person(g2.id, {office: "Row2"})
    ]);
    const L = matrixOf(st);
    eq(L.avatars.length, 5, "five avatars for five people spread across two lanes");
    const laneARow1Third = L.avatars[2];   // lane A drawn first: its three row-1 people, in order
    const laneBRow2      = L.avatars[4];   // lane B drawn second: its row-1 person, then its row-2 person
    check(laneBRow2.cy > laneARow1Third.cy,
      "lane B's row-2 avatar sits below lane A's third row-1 avatar — got cy " +
      laneBRow2.cy + " vs " + laneARow1Third.cy);
  }

  /* ---- null row last: whoever's groupId names no group the document
     still has ends up strictly below every named row's own people,
     because the catch-all row is always the last one drawn. Each person
     gets a distinctive name so their avatar can be found by its own `ini`
     (initials()) — a content-based identity, not a raw push-order index,
     which is the only way this can actually distinguish "the catch-all
     row's own person" from "whichever person happened to be pushed last". */
  {
    const g1 = tier("P", "Partner"), g2 = tier("C", "Consultant");
    const st = clearGroup(baseState([g1, g2], [
      person(g1.id, {name: "Alpha Aa", office: "Alpha"}),
      person(g2.id, {name: "Beta Bb", office: "Beta"}),
      person(g2.id, {name: "Ghost Gg", office: "Beta"})     // nulled below -> the catch-all row
    ]), 2);
    const L = matrixOf(st);
    eq(L.avatars.length, 3, "three avatars total");
    const alphaAv = L.avatars.find(av => av.ini === "AA");
    const betaAv  = L.avatars.find(av => av.ini === "BB");
    const ghostAv = L.avatars.find(av => av.ini === "GG");
    check(!!alphaAv && !!betaAv && !!ghostAv,
      "all three avatars are identifiable by their own initials");
    check(!!ghostAv && ghostAv.cy > alphaAv.cy && ghostAv.cy > betaAv.cy,
      "the catch-all row's avatar (the nulled person) sits below every named row's avatar");
  }

  /* ---- nobody vanishes: a person whose groupId names no group at all
     (a stale id, matching nothing in state.groups) still gets drawn, in
     the catch-all row, exactly like a person with no groupId at all. */
  {
    const g1 = tier("P", "Partner");
    const st = baseState([g1], [person(g1.id, {office: "Real"})]);
    st.people.push({id: "stale1", name: "Ghost Person", tierId: g1.id, groupId: "no-such-group",
                     role: "", photo: null, pw: 0, ph: 0, frame: null});
    const L = matrixOf(st);
    eq(L.avatars.length, 2,
      "avatar count equals the people count of the one drawn lane, including the stale-groupId person");
  }

  /* ---- gutter: one label per drawn NAMED row, none for the catch-all
     row, and none at all with zero groups. */
  {
    const g1 = tier("P", "Partner");
    const st = clearGroup(baseState([g1], [
      person(g1.id, {office: "Named"}),
      person(g1.id, {office: "Named"})
    ]), 1);
    const L = matrixOf(st);
    const gutterTexts = L.texts.filter(t => t.size === GUTTER_SIZE && t.anchor === "end");
    eq(gutterTexts.length, 1,
      "one gutter label for the one drawn named row — the catch-all row adds none");
    check(gutterTexts.every(t => t.color === st.inkOnWhite),
      "and it is coloured with st.inkOnWhite");
  }
  {
    const g1 = tier("P", "Partner");
    const st = noGroups(baseState([g1], [person(g1.id)]));   // zero groups
    const L = matrixOf(st);
    const gutterTexts = L.texts.filter(t => t.size === GUTTER_SIZE && t.anchor === "end");
    eq(gutterTexts.length, 0, "with zero groups there are zero gutter texts");
  }

  /* ---- SECOND SOURCE: a zero-groups state draws byte-identical to
     computeSwimlaneLayout on the same state — the proof that Matrix with
     nothing on its second axis really is the Swimlanes picture. */
  {
    const g1 = tier("P", "Partner"), g2 = tier("C", "Consultant", {fill: "white"});
    const st = noGroups(baseState([g1, g2], [
      person(g1.id), person(g1.id), person(g2.id)
    ]));
    const viaMatrix = JSON.stringify(matrixOf(JSON.parse(JSON.stringify(st))));
    const st2 = JSON.parse(JSON.stringify(st)); st2.layout = "swimlanes";
    const viaSwimlanes = JSON.stringify(layout(st2));
    eq(viaMatrix, viaSwimlanes,
      "a zero-groups state draws byte-identical to computeSwimlaneLayout on the same state");
  }
  /* the static pin that keeps the comparison above honest: computeMatrixLayout's
     own source must never call computeSwimlaneLayout, or the equality just
     proved would hold no matter what either engine's own formula said */
  {
    const src = grabFn("computeMatrixLayout");
    check(!/computeSwimlaneLayout/.test(src),
      "computeMatrixLayout's own source never calls computeSwimlaneLayout — " +
      "the zero-groups equality above would be circular if it did");
  }
}

/* ---------------------------------------------------------- 8. personLabelWidth / headNeedWidth

   The extraction step that pulled these two helpers out of both geometry
   engines ran a mutation battery against every suite above and found three
   gaps: none of the sweeps happens to exercise a person whose SUBLINE, not
   name, is the wider half of their label; a header whose BRAND term is what
   makes natW grow; or a swimlanes sizing pass whose own 15px measurements
   are distinguishable from the draw phase's. A helper that silently dropped
   any of the three passed every existing assertion. These three blocks close
   that, each verified red under the mutation that exposed it. */

{
  /* ---- gap 1: a subline decisively wider than the name. Stub model (see
     the PREAMBLE comment above MEAS_LOG): width = text.length * px * 0.5.
     "Al Bo" -> nameSegs(given) = [{"Al",600},{" Bo",400}], 5 chars at 15px =
     37.5px. The subline "Partner" + the "  |  " separator + a 26-character
     office is 7+5+26 = 38 chars at 11px = 209px — over 5x the name, so
     Math.max(nameW, subW) can only read as subW-driven here. */
  const office = "Frankfurt Central Building";
  eq(office.length, 26, "the office string below is the length the arithmetic in the comment assumes");
  const nameW = ("Al".length + " Bo".length) * 15 * 0.5;
  const subW  = ("Partner".length + "  |  ".length + office.length) * 11 * 0.5;
  check(subW > nameW * 5,
    "the subline is decisively wider than the name under the stub's width model — sub " + subW + " vs name " + nameW);

  const t = tier("P", "Partner");
  const withOffice = baseState([t], [person(t.id, {name: "Al Bo", office})]);
  withOffice.nameLabelPosition = "next";    // beside-photo: no below-photo padding/gap terms to reason about
  const withoutOffice = JSON.parse(JSON.stringify(withOffice));
  withoutOffice.people[0].groupId = null;   // baseState already resolved office -> groupId; clear the reference itself

  /* the width of the one grade band/lane, read off the engine's own returned
     geometry — never a value recomputed by a second copy of its formula */
  const colWidth = L => L.bands[1].pts[1][0] - L.bands[1].pts[0][0];

  for(const kind of ["pyramid", "swimlanes"]){
    const a = JSON.parse(JSON.stringify(withOffice));    a.layout = kind;
    const b = JSON.parse(JSON.stringify(withoutOffice)); b.layout = kind;
    const wide = colWidth(layout(a)), narrow = colWidth(layout(b));
    check(wide > narrow,
      kind + ": a person column/lane widens for a long office even though the name is unchanged and short — "
      + wide + " vs " + narrow + " with the office emptied");
  }
}

{
  /* ---- gap 2: the header's brand term. A one-person, no-heading, no-label
     chart keeps the grid/pyramid content pinned at its floor (SW.laneMin in
     swimlanes, the 232px person-column floor in pyramid) regardless of
     brand, so natW can only move if headNeedWidth's own brand term does.
     Two runs — brand set, brand blank — compared directly. */
  const t = tier("P", "Partner");
  const base = baseState([t], [person(t.id, {name: "X"})]);
  Object.assign(base, {
    title: "Header Width Test", brand: "",
    showPersonName: false, showPersonGrade: false, showPersonGroup: false,
    showGradeCode: false, showGradeName: false
  });
  const withBrand = JSON.parse(JSON.stringify(base));
  withBrand.brand = "BrandCo";

  for(const kind of ["pyramid", "swimlanes"]){
    const a = JSON.parse(JSON.stringify(base));      a.layout = kind;
    const b = JSON.parse(JSON.stringify(withBrand));  b.layout = kind;
    const blank = layout(a).natW, branded = layout(b).natW;
    check(branded > blank,
      kind + ": natW grows once a brand is set, with nothing else in the state changed — "
      + branded + " vs " + blank + " blank");
  }
}

{
  /* ---- gap 3: swimlanes' own SIZING-phase measurement. The Bold-policy
     ordered-prefix check above (MEAS_LOG, "first N /15px/ matches") can be
     satisfied by the DRAW phase alone: fitName always measures each
     segment's FULL, untruncated text as its first move, before it ever
     considers ellipsizing — so its (font, text) pairs are indistinguishable
     from personLabelWidth's sizing-loop pairs by content or weight, only by
     WHEN they were logged, and "first N" stops looking as soon as it has
     found N of either source (confirmed by hand against fitName's source: an
     ellipsizing name does not change this, because the pre-ellipsis check
     still measures the full segment first). A one-person, one-lane chart
     instead gives a known, literal total: its lane floors at SW.laneMin,
     comfortably wider than the name, so fitName never ellipsizes and BOTH
     its calls land on the full segments too — personLabelWidth logs 2 (one
     measureText per segment) and fitName logs 2 more (its unconditional
     full-text check), 4 in total. A sizing phase that never calls
     personLabelWidth leaves only fitName's 2. */
  const NAME = "Zora Quillfeather";
  const t = tier("P", "Partner");
  const st = baseState([t], [person(t.id, {name: NAME})]);
  st.layout = "swimlanes";
  st.showPersonGrade = false; st.showPersonGroup = false;
  const segs = MODULE.nameSegs(st, NAME);
  eq(segs.length, 2, "'given' nameBold splits this name into the two segments the count below assumes");

  MODULE.MEAS_LOG.length = 0;
  const L = layout(st);
  const drawn = L.texts.find(tx => tx.baseline === "alphabetic"
    && tx.segs.map(s => s.t).join("") === NAME);
  check(!!drawn, "the full, untruncated name is what gets drawn — the lane is not so narrow that fitName ellipsizes it");

  const matches = MODULE.MEAS_LOG.filter(m => /15px/.test(m.font) && segs.some(s => s.t === m.text));
  eq(matches.length, 4,
    "the name's two segments are measured at 15px four times — twice sizing the lane in personLabelWidth, "
    + "twice checking the fit in fitName while drawing");
}

/* ---------------------------------------------------------- 9. state.font reaches L.font

   docFont(st) is the one function that turns a document's font choice into the
   stack measurement and drawing actually use. Both engines copy its result
   into the layout object exactly where they copy accent, so a chart drawn with
   one font is never measured with another. The expectations are written as
   LITERALS rather than read back out of FONTS — the second-source rule — so a
   docFont bug and a matching test bug cannot agree with each other by
   construction. */
{
  const t = tier("P", "Partner");
  const arialState = baseState([t], [person(t.id, {name: "Arial Tester"})]);
  arialState.font = "arial";
  const defaultState = baseState([t], [person(t.id, {name: "Default Tester"})]);
  // baseState states no font at all — the same "a file that omits it" case
  // parseAndValidateRoster answers for, exercised here at the engine directly.

  for(const kind of ["pyramid", "swimlanes"]){
    const a = JSON.parse(JSON.stringify(arialState));   a.layout = kind;
    const d = JSON.parse(JSON.stringify(defaultState)); d.layout = kind;
    eq(layout(a).font, "Arial,Helvetica,system-ui,sans-serif",
      kind + ": state.font:\"arial\" reaches L.font as the Arial stack");
    eq(layout(d).font, "'Open Sans','Segoe UI',system-ui,Roboto,Helvetica,Arial,sans-serif",
      kind + ": an unstated font reaches L.font as the default Open Sans stack");
  }
}

/* ---------------------------------------------------------- PDF structure */

/* toPDF hand-writes a PDF: a header, five objects, a cross-reference table of
   byte offsets, and a trailer. The xref offsets are the fragile part — get one
   wrong and Acrobat refuses the file while Preview often still opens it, so a
   visual check does not catch it. The JPEG bytes arrive via toBlob +
   arrayBuffer, so every offset after the image depends on that path, and
   this is the assertion that proves it. */
function pdfStructure(){
  const st = baseState([t1, t4], [
    person(t1.id, {name: "Pdf One", photo: JPEG, pw: 400, ph: 300, frame: {zoom: 1, ox: 0, oy: 0}}),
    person(t4.id, {name: "Pdf Two"})
  ]);
  const L = layout(st);

  return MODULE.toPDF(L).then(blob => {
    /* the stub Blob keeps its parts, so the bytes can be read back out */
    const parts = blob.parts;
    check(parts.length === 1 && parts[0] instanceof Uint8Array,
      "toPDF produces a single byte array");
    eq(blob.type, "application/pdf", "toPDF labels the blob as a PDF");

    const bytes = parts[0];
    let text = "";
    for(let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);

    check(text.indexOf("%PDF-1.4") === 0, "the file starts with a PDF header");
    check(text.slice(-6) === "%%EOF\n", "the file ends with %%EOF");
    for(const obj of ["1 0 obj", "2 0 obj", "3 0 obj", "4 0 obj", "5 0 obj"]){
      check(text.includes(obj), "object " + obj + " is present");
    }
    check(/\/Filter\/DCTDecode/.test(text), "the image is embedded as DCTDecode (JPEG)");

    /* the declared image length must match the bytes actually written */
    const len = /\/Length (\d+)>>\nstream\n/.exec(text);
    check(!!len, "the image stream declares a length");
    if(len) eq(+len[1], MODULE.JPEG_BYTES.length,
      "the declared image length matches the JPEG written");

    /* the JPEG must appear verbatim, starting at its stream offset */
    const streamAt = text.indexOf("stream\n", text.indexOf("4 0 obj")) + 7;
    let verbatim = true;
    for(let i = 0; i < MODULE.JPEG_BYTES.length; i++){
      if(bytes[streamAt + i] !== MODULE.JPEG_BYTES[i]) verbatim = false;
    }
    check(verbatim, "the JPEG bytes are embedded verbatim, not re-encoded");

    /* and every xref offset must land exactly on its object header */
    const xref = /xref\n0 6\n0000000000 65535 f \n([\s\S]*?)trailer/.exec(text);
    check(!!xref, "the cross-reference table is present");
    if(xref){
      const offsets = xref[1].trim().split("\n").map(l => parseInt(l.slice(0, 10), 10));
      eq(offsets.length, 5, "the xref table has one entry per object");
      offsets.forEach((off, i) => {
        check(text.startsWith((i + 1) + " 0 obj", off),
          "xref offset " + i + " points at object " + (i + 1) + " — found "
          + JSON.stringify(text.slice(off, off + 10)));
      });
    }
    const startxref = /startxref\n(\d+)\n%%EOF/.exec(text);
    check(!!startxref, "startxref is present");
    check(startxref && text.startsWith("xref", +startxref[1]),
      "startxref points at the xref table");
  });
}

/* ---------------------------------------------------------- report */

function report(){
  if(failures.length){
    console.log("FAILURES (" + failures.length + "):");
    failures.slice(0, 40).forEach(f => console.log("  ✗ " + f));
    if(failures.length > 40) console.log("  … and " + (failures.length - 40) + " more");
    console.log("\n" + passed + " passed, " + failures.length + " FAILED");
    if(typeof process !== "undefined") process.exit(1);
    throw new Error(failures.length + " assertion(s) failed");
  }
  console.log("all " + passed + " assertions passed");
}

/* JavaScriptCore drains microtasks when the script finishes, so the async
   renderer comparison still reports; node awaits it the same way. */
rendererAgreement().then(pdfStructure).then(report).catch(e => {
  console.log("harness error: " + (e && e.message || e));
  if(typeof process !== "undefined") process.exit(1);
});
undefined;
