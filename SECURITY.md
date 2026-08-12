# Security

## Reporting a vulnerability

Open a [private security advisory](https://github.com/chrisjohe/tierform/security/advisories/new)
on GitHub — the **Security** tab, then **Report a vulnerability**. The report
stays private between you and the maintainer until a fix is published, and it
needs no email address from either of us.

Please do not open a public issue for a vulnerability.

Please include what you did, what happened, and which browser and version you
used. A roster file that reproduces the problem is the most useful thing you can
attach — but **strip any real names and photos first**, since a roster file is
personal data.

Do not expect an acknowledgement immediately. This is a small project maintained
by one person, so please allow a reasonable time to fix before disclosing
publicly.

Reports are welcome even if you are not sure the behaviour is a bug.

## What is in scope

TIERFORM is a single HTML file that runs locally with no server and no network
access. That rules out most of the usual categories and concentrates the risk in
one place: **the files it opens.**

In scope, and taken seriously:

- **A roster file that executes script**, or reaches the page as markup rather
  than as data, whether on screen or in an exported SVG.
- **A roster file that reads or exfiltrates anything** — for example by getting
  the app to load a remote URL, which would leak the fact and time of opening.
- **A roster file that corrupts the document you already have open**, or that
  silently loses data (a person dropped from the roster without being reported).
- **A dropped image** that escapes the size and shape limits and exhausts
  memory, or that ends up embedded unvalidated.
- **An export that leaks more than it shows** — data present in the file but not
  visible in the chart.

Out of scope:

- The app not working when it is modified, minified, or served with the script
  extracted.
- Anything requiring the attacker to already be able to run code on the machine
  or edit the HTML file.
- Denial of service by opening an absurdly large file: limits exist, and the
  worst case is a browser tab that has to be closed.
- Missing security headers on a copy you host yourself — see below.

## How untrusted input is handled

The one untrusted input is a roster file. Everything about it goes through
`openRoster` — structure through `parseAndValidateRoster`, then every photo
through `decodeRosterPhotos` — and nothing downstream assumes anything it did
not check:

- Structure is proven **before any property of the file is read**. Immediately
  after `JSON.parse`, `parseAndValidateRoster` refuses anything that is not a
  roster object holding two arrays, whose grades and people are every one of
  them plain objects and within the count limits. Everything after that point
  reads properties off those objects, so a hostile file is refused rather than
  making one of those reads throw in the middle of an import. Nothing runs ahead
  of this check: there is no normalising or upgrade pass in front of the
  validator, and it is the only door a roster file comes through.
- Files are refused **whole**, and nothing is adopted until the photos have
  decoded as well. A half-applied import would leave the document on screen part
  someone else's, which is worse than refusing.
- **Identifiers are regenerated on import.** Nothing from the file can reach an
  HTML attribute, and duplicate identifiers stop mattering.
- **Photos must be `data:image/jpeg` or `data:image/png` base64** within a size
  limit. URLs, SVG data URLs and HTML fragments are dropped, and the affected
  person is named in the report.
- **The bytes are read before the browser decodes them.** The prefix only
  describes the bytes; it does not constrain them, and it is the browser's
  decoder that allocates the pixels. So the header is parsed first, from the
  bytes themselves: the PNG signature and IHDR, or the JPEG SOI and the first
  SOF marker, found by walking segment lengths under strict bounds. See
  "What the image preflight does and does not prove" below.
- **The declared type must match the actual bytes.** PNG data labelled
  `image/jpeg`, an SVG document inside either envelope, and arbitrary text
  inside either envelope are all refused at that point — before `new Image()`
  exists to be handed them. The label no longer decides which parser runs.
- **Stored dimensions are not believed.** `pw` and `ph` are numbers a file
  states about itself, and every avatar rect is computed from them. The size the
  header declares is checked against the pixel, area and shape limits *before*
  any decoding; a photo that is over them is dropped without being decoded at
  all. A file claiming 240×240 for a 12000×12000 image would otherwise cost more
  than a gigabyte of pixels on the first draw, and a thirty-three-byte PNG
  header may honestly declare 60000×60000.
- **And they must still actually decode.** Preflight is a gate, not a substitute
  for decoding: after it passes, the image is decoded to confirm the rest of the
  file is readable, and the decoded dimensions must match the header's (a
  transposition is accepted, because browsers apply EXIF orientation). Anything
  else is refused. The decoded size then replaces `pw`/`ph` and the crop is
  re-clamped against it. `decodeImage` is the only place a string from a file is
  handed to a loader, and `validatePhoto` gates it again there.
- **An unusable photo costs only the photo.** Every image failure above is a
  repair, not a refusal: the person stays in the roster with their name, group
  and grade, the rest of the roster is unaffected, and the reason is named in the
  report shown after the file opens. Structural problems are still fatal and
  still refuse the file whole.
- The UI is built from DOM elements with `.textContent` and `.value`. The only
  `innerHTML` assignment in the app parses an SVG the app generated itself.
- The SVG export escapes text and attributes separately, pins every enum, and
  re-checks every image reference at the point of writing.

The test suites are part of this. `test/import.js` asserts what is refused and
what is repaired, decodes the photos in `test/fixtures/photos.json` with a reader
that parses real JPEG and PNG headers, and drives the preflight with byte
structures built in the suite — valid baseline and progressive JPEGs, valid
PNGs, truncated marker segments, a short IHDR, mislabelled formats, zero
dimensions and each of the three size limits — asserting in every rejection case
that `Image.src` was never assigned. `test/dom.js` fails the build if a `.src` is
assigned anything but a validated value, if the header read or the size check
moves after `img.src`, if a second `innerHTML` assignment appears, if a network
API appears, or if one of the escaping guards is removed.
`test/fixtures/injection.json` is a roster file built to attack the app, and it
is opened on every run.

## What the image preflight does and does not prove

It proves three things:

- the bytes **begin as the format the data URL claims**, so the label cannot
  choose which parser the browser runs;
- the **dimensions the file declares are inside the limits**, checked before the
  decoder is asked for anything, so an enormous image is refused rather than
  decoded in order to discover that it is enormous;
- the **decoder produced the dimensions the header declared** (or their
  transposition, which is EXIF orientation), so a small header cannot smuggle a
  large image past the limits.

It does **not** sandbox image decoding, and it makes no claim to. A malicious
JPEG that exploits a bug in the browser's own decoder is reachable from any
image on any web page, and nothing a page can do changes that. Parsing is
bounded rather than exhaustive: only the leading 512 KB of a photo is decoded
from base64 and scanned, JPEG marker walking stops after 512 segments, and no
CRC, chunk ordering or entropy-coded data is verified. A JPEG whose frame header
genuinely lies beyond that window loses its photo and says so.

What the preflight removes is the realistic case for a roster someone was
emailed: a file that is trivial to write and ruinous to open.

## Opening rosters from other people

During the internal beta the guidance was to open **only rosters TIERFORM itself
wrote, or ones supplied by a trusted team member.** Photos written by the app
have already been through `processImage`, which resizes and re-encodes every
image through a canvas — so they are known-good bytes by construction, and
nothing checked them again.

With the preflight above in place, a roster from an untrusted source no longer
reaches the browser's image decoder without its structure and declared size
having been read from the bytes first. The rest of the file was already
validated. Treat a roster file as personal data regardless of where it came
from.

## Hosting a copy

The local file makes no network requests, so a Content Security Policy adds
nothing there — and a policy strict enough to matter would have to permit
`'unsafe-inline'` for both script and style, since the app is one inline script
and one inline stylesheet. It is deliberately not shipped in the file.

If you host TIERFORM, extract the script and stylesheet into separate files and
serve this policy:

```
Content-Security-Policy:
  default-src 'none';
  script-src 'self';
  style-src 'self';
  img-src 'self' data:;
  font-src 'self';
  connect-src 'none';
  form-action 'none';
  frame-ancestors 'none';
  base-uri 'none';
```

`img-src data:` is required — every photo is a data URL. `connect-src 'none'`
is the one that matters most: it turns the no-network promise into something the
browser enforces rather than something you take on trust.

Serve it over HTTPS, and note that hosting it re-enables **Copy PNG**, which
browsers withhold from pages opened as files.
