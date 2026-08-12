#!/usr/bin/env python3
"""Generates test/fixtures/*.json for TIERFORM.

Kept as a script so the fixtures can be regenerated and diffed rather than
hand-maintained. Everything here is synthetic: no real roster data.
"""
import base64, json, os, sys

OUT = sys.argv[1]

# A real, decodable 1x1 JPEG. Fixtures need photos that actually survive an
# image decode, but not photos that cost 200 KB each.
JPEG_1PX = ("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJ"
            "CQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/"
            "wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAA"
            "AAD/2gAIAQEAAD8AKp//2Q==")

# A real, decodable 1x1 PNG. The second format the app accepts, so the decode
# path has to be proven on both: a PNG header is nothing like a JPEG one.
PNG_1PX = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
           "AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


def b64(prefix, payload):
    """A syntactically perfect data URL wrapping bytes that are not an image.

    The point of these is that they get PAST the envelope check — right prefix,
    whole base64 quanta, well under the byte limit — so the only thing left that
    can refuse them is an actual decode.
    """
    return prefix + base64.b64encode(payload).decode("ascii")

FIRST = ["Alex","Bea","Cem","Dara","Emil","Fay","Gus","Hana","Ivo","Jules",
         "Kai","Lena","Mira","Nils","Otto","Pia","Quinn","Rosa","Sven","Tara",
         "Uwe","Vera","Wim","Xenia","Yann","Zoe"]
LAST  = ["Adler","Brandt","Conti","Dahl","Engel","Fischer","Graf","Huber",
         "Ibsen","Jung","Kranz","Lorenz","Mohr","Neumann","Ostrom","Pfeiffer",
         "Quandt","Richter","Stein","Thiel","Ulrich","Voigt","Wagner","Xu",
         "Yilmaz","Zeller"]

TIERS = [
    ("P",  "Partner",          dict(align="left")),
    ("SA", "Senior Assistant", dict(fill="white", attach=True, align="right")),
    ("A",  "Assistant",        dict(fill="white", merge=True,  align="right")),
    ("D",  "Director",         {}),
    ("SM", "Senior Manager",   {}),
    ("M",  "Manager",          {}),
    ("SC", "Senior Consultant",{}),
    ("C",  "Consultant",       {}),
    ("JS", "Junior Staff",     {}),
]
OFFICES = ["FRA","HAM","BER","MUC","DUS"]


def tier(i, code, label, o):
    return {"id": "t%02d0000" % i, "code": code, "label": label,
            "role": o.get("role", label), "fill": o.get("fill", "green"),
            "attach": o.get("attach", False), "merge": o.get("merge", False),
            "align": o.get("align", "center")}


def write(name, obj, raw=False):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(obj if raw else json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    print("%-20s %8d bytes" % (name, os.path.getsize(path)))


# ---------------------------------------------------------------- current
# Written in the CURRENT (post second-dimension) schema: a stated `groups`
# array plus a per-person `groupId` reference — never the pre-groups free-text
# `office` string. legacy.json (and several of the fixtures below) still carry
# a stray `office` field on purpose: the format pivot (2026.9) dropped the
# validator's on-ramp for it, so it is now coverage for an unrecognised
# property being dropped silently, same as any other.
tiers = [tier(i, c, l, o) for i, (c, l, o) in enumerate(TIERS)]
groups = [{"id": "g%02d0000" % i, "label": name} for i, name in enumerate(OFFICES)]
people = []
# 26 people spread over the grades, a handful carrying a photo and a frame
spread = [0,0,1,1,2,2,3,3,3,4,4,4,4,5,5,5,5,5,6,6,6,7,7,7,8,8]
for i, ti in enumerate(spread):
    p = {"id": "p%03d0000" % i, "name": FIRST[i] + " " + LAST[i],
         "tierId": tiers[ti]["id"], "groupId": groups[i % 5]["id"], "role": "",
         "photo": None, "pw": 0, "ph": 0, "frame": None}
    if i % 6 == 0:                       # every sixth person has a picture
        p.update(photo=JPEG_1PX, pw=400, ph=300,
                 frame={"zoom": 1.0 + (i % 3) * 0.25, "ox": 0.1, "oy": -0.2})
    people.append(p)
current = {"title": "Fixture | Current schema", "brand": "ACME",
           "accent": "#046A38", "inkOnColour": "#FFFFFF", "inkOnWhite": "#1A2129",
           "bg": "white", "ring": "none", "angle": 2, "page": "landscape",
           "density": "balanced", "tiers": tiers, "groups": groups, "people": people}
write("current.json", current)

# ---------------------------------------------------------------- legacy
# What a pre-framing build wrote: {style} instead of {fill,attach}, a string
# angle, one combined "SA / A" grade, square photos with no pw/ph/frame, and
# no role/merge/align/bg/ink fields at all. Its people also carry a stray
# `office` string — an unrecognised property since the format pivot dropped
# the on-ramp for it — rather than a groupId.
legacy_tiers = [
    {"id": "L1", "code": "P",      "label": "Partner",           "style": "solid"},
    {"id": "L2", "code": "SA / A", "label": "(Senior) Assistant", "style": "outline"},
    {"id": "L3", "code": "M",      "label": "Manager",           "style": "solid"},
    {"id": "L4", "code": "C",      "label": "Consultant",        "style": "solid"},
]
legacy_people = [
    {"id": "LP1", "name": "Alex Adler",  "tierId": "L1", "office": "FRA", "role": "", "photo": None},
    {"id": "LP2", "name": "Bea Brandt",  "tierId": "L2", "office": "HAM",
     "role": "(Senior) Assistant", "photo": JPEG_1PX},
    {"id": "LP3", "name": "Cem Conti",   "tierId": "L3", "office": "BER", "role": "", "photo": JPEG_1PX},
    {"id": "LP4", "name": "Dara Dahl",   "tierId": "L4", "office": "MUC", "role": "", "photo": None},
]
write("legacy.json", {"title": "Fixture | Legacy schema", "brand": "",
                      "accent": "#046A38", "ring": "none", "angle": "subtle",
                      "tiers": legacy_tiers, "people": legacy_people})

# ---------------------------------------------------------------- pyramid zero
# The regression this exists for: `st.angle || "subtle"` rewrites a legitimate
# 0 to 2. A flat pyramid must survive save -> open unchanged.
zero = json.loads(json.dumps(current))
zero["title"] = "Fixture | Flat pyramid"
zero["angle"] = 0
write("pyramid-zero.json", zero)

# ---------------------------------------------------------------- malformed
write("malformed.json", '{"title":"Fixture | Truncated","tiers":[{"id":"t1",',
      raw=True)

# ---------------------------------------------------------------- bad refs
write("bad-refs.json", {
    "title": "Fixture | Broken references",
    "accent": "#046A38", "angle": 2, "page": "landscape", "density": "balanced",
    "tiers": [
        # merge on the FIRST grade has nothing to merge into
        {"id": "dup", "code": "P", "label": "Partner", "role": "Partner",
         "fill": "green", "attach": False, "merge": True, "align": "center"},
        # a second grade reusing the same id
        {"id": "dup", "code": "M", "label": "Manager", "role": "Manager",
         "fill": "green", "attach": False, "merge": False, "align": "center"},
        {"id": "ok", "code": "C", "label": "Consultant", "role": "Consultant",
         "fill": "white", "attach": True, "merge": False, "align": "left"},
    ],
    "people": [
        {"id": "same", "name": "Points At Nothing", "tierId": "does-not-exist",
         "office": "FRA", "role": "", "photo": None},
        {"id": "same", "name": "Duplicate Id", "tierId": "ok",
         "office": "FRA", "role": "", "photo": None},
        {"id": "p3", "name": "Ambiguous Tier", "tierId": "dup",
         "office": "HAM", "role": "", "photo": None},
        {"id": "p4", "name": "No Tier At All", "office": "BER", "role": "", "photo": None},
    ]})

# ---------------------------------------------------------------- bad values
write("bad-values.json", {
    "title": "Fixture | Bad enums and colours",
    "brand": "",
    "accent": "red",                 # not a full #rrggbb
    "inkOnColour": "#FFF",           # short hex
    "inkOnWhite": "#GGGGGG",         # not hex at all
    "bg": "chartreuse",              # unknown enum
    "ring": "sparkle",               # unknown enum
    "angle": 42,                     # out of range
    "page": "a0-square",             # not in PAGES
    "density": "extremely-airy",     # not in DENSITY
    "tiers": [
        {"id": "t1", "code": "P", "label": "Partner", "role": "Partner",
         "fill": "rainbow", "attach": "yes", "merge": 1, "align": "middle"},
        {"id": "t2", "code": "M", "label": "Manager", "role": "Manager",
         "fill": "green", "attach": None, "merge": None, "align": "center"},
    ],
    "people": [
        {"id": "p1", "name": "Nan Dimensions", "tierId": "t1", "office": "FRA",
         "role": "", "photo": JPEG_1PX, "pw": "wide", "ph": -5,
         "frame": {"zoom": 99, "ox": "left", "oy": None}},
        {"id": "p2", "name": "Infinite Frame", "tierId": "t2", "office": "HAM",
         "role": "", "photo": JPEG_1PX, "pw": 1e12, "ph": 0,
         "frame": {"zoom": -3, "ox": 1e9, "oy": 1e9}},
    ]})

# ---------------------------------------------------------------- injection
# Every payload here is inert as text and dangerous only if some render path
# treats it as markup. That is exactly what Phase 1 has to guarantee.
BREAKOUT = '"><img src=x onerror=alert(1)>'
write("injection.json", {
    "title": '</script><script>alert("title")</script>',
    "brand": "<b>bold?</b> & <em>italic?</em>",
    "accent": '#046A38" onload="alert(1)',
    "inkOnColour": "#FFFFFF", "inkOnWhite": "#1A2129",
    "bg": "white", "ring": "none", "angle": 2,
    "page": "landscape", "density": "balanced",
    "tiers": [
        {"id": BREAKOUT, "code": "</text><script>x</script>",
         "label": '<img src=x onerror="alert(2)">', "role": "&lt;already escaped&gt;",
         "fill": "green", "attach": False, "merge": False, "align": "center"},
        {"id": "t-ok", "code": "M", "label": 'Quote " and apostrophe \' and & amp',
         "role": "Manager", "fill": "white", "attach": False, "merge": False,
         "align": "center"},
    ],
    # One group whose label is the same hostile fragment the free-text
    # `office` on-ramp used to carry, back when that was how the payload
    # reached a group label. The current-format route is groups + groupId.
    "groups": [{"id": "g-hostile", "label": "</td><td>injected"}],
    "people": [
        {"id": BREAKOUT, "name": '<script>alert("name")</script>',
         "tierId": BREAKOUT, "groupId": "g-hostile", "role": "",
         "photo": None, "pw": 0, "ph": 0, "frame": None},
        {"id": "p-js", "name": "Javascript Url", "tierId": "t-ok",
         "role": "", "photo": "javascript:alert(3)", "pw": 100, "ph": 100,
         "frame": {"zoom": 1, "ox": 0, "oy": 0}},
        {"id": "p-svg", "name": "Svg Data Url", "tierId": "t-ok",
         "role": "", "photo": ("data:image/svg+xml;base64,"
             "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIG9ubG9hZD0iYWxlcnQoNCkiLz4="),
         "pw": 100, "ph": 100, "frame": {"zoom": 1, "ox": 0, "oy": 0}},
        {"id": "p-html", "name": "Html Fragment Photo", "tierId": "t-ok",
         "role": "", "photo": '<img src=x onerror=alert(5)>',
         "pw": 100, "ph": 100, "frame": {"zoom": 1, "ox": 0, "oy": 0}},
        {"id": "p-remote", "name": "Remote Url", "tierId": "t-ok",
         "role": "", "photo": "https://example.invalid/tracker.png",
         "pw": 100, "ph": 100, "frame": {"zoom": 1, "ox": 0, "oy": 0}},
        {"id": "p-good", "name": "Ünicode Ǆ 名前 🙂", "tierId": "t-ok",
         "role": "Rôle", "photo": JPEG_1PX, "pw": 400, "ph": 300,
         "frame": {"zoom": 1, "ox": 0, "oy": 0}},
    ]})

# ---------------------------------------------------------------- photos
# For the decoding half of the door. Every photo here is a well-formed data URL
# with an accepted prefix and legal base64 — validatePhoto lets all of them
# through — so what separates them is only what the bytes turn out to be once a
# decoder looks at them, and what size that decoder reports.
#
# The stored pw/ph are the interesting part: a roster file is free to claim any
# dimensions it likes, and until the photo is decoded the app has no way to know
# it is being lied to.
write("photos.json", {
    "title": "Fixture | Photos to decode",
    "brand": "", "accent": "#046A38", "inkOnColour": "#FFFFFF",
    "inkOnWhite": "#1A2129", "bg": "white", "ring": "none", "angle": 2,
    "page": "landscape", "density": "balanced",
    "tiers": [tier(0, "P", "Partner", {}), tier(1, "M", "Manager", {})],
    "people": [
        # honest: a real image, and the stored size is the size it really is
        {"id": "ph-jpeg", "name": "Valid Jpeg", "tierId": "t000000", "office": "FRA",
         "role": "", "photo": JPEG_1PX, "pw": 1, "ph": 1,
         "frame": {"zoom": 1, "ox": 0, "oy": 0}},
        {"id": "ph-png", "name": "Valid Png", "tierId": "t000000", "office": "HAM",
         "role": "", "photo": PNG_1PX, "pw": 1, "ph": 1,
         "frame": {"zoom": 1, "ox": 0, "oy": 0}},
        # the right envelope around bytes that are not an image
        {"id": "ph-badjpeg", "name": "Corrupt Jpeg", "tierId": "t000000", "office": "BER",
         "role": "", "photo": b64("data:image/jpeg;base64,", b"this is not a JPEG at all."),
         "pw": 240, "ph": 240, "frame": {"zoom": 1, "ox": 0, "oy": 0}},
        {"id": "ph-badpng", "name": "Corrupt Png", "tierId": "t010000", "office": "MUC",
         "role": "", "photo": b64("data:image/png;base64,", b"PNG? no. eight bytes of nothing"),
         "pw": 240, "ph": 240, "frame": {"zoom": 1, "ox": 0, "oy": 0}},
        # an SVG — the format that carries script — wearing a JPEG label
        {"id": "ph-svg", "name": "Svg Wearing Jpeg", "tierId": "t010000", "office": "DUS",
         "role": "", "photo": b64("data:image/jpeg;base64,",
                                  b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"),
         "pw": 100, "ph": 100, "frame": {"zoom": 1, "ox": 0, "oy": 0}},
        # A real image whose stored dimensions are a fiction. The frame is legal
        # against the claim and illegal against the truth: at 400x300 and 1.5x
        # the pan limit is 1.0, at the real 1x1 it is 0.5. So an ox of 0.9 is
        # only reachable by believing the file, and something has to move it
        # back once the decoder disagrees.
        {"id": "ph-lying", "name": "Lying Dimensions", "tierId": "t010000", "office": "FRA",
         "role": "", "photo": JPEG_1PX, "pw": 400, "ph": 300,
         "frame": {"zoom": 1.5, "ox": 0.9, "oy": -0.45}},
        # the control: nothing to decode, nothing to repair
        {"id": "ph-none", "name": "No Photo", "tierId": "t010000", "office": "BER",
         "role": "", "photo": None, "pw": 0, "ph": 0, "frame": None},
    ]})

# ---------------------------------------------------------------- unicode/text
# Not an attack, just the characters that break naive escaping and measurement.
write("unicode.json", {
    "title": "Ünicode & Sonderzeichen — <Test>",
    "brand": "\"Quoted\" & 'single'",
    "accent": "#046A38", "inkOnColour": "#FFFFFF", "inkOnWhite": "#1A2129",
    "bg": "transparent", "ring": "accent", "angle": 4,
    "page": "portrait", "density": "airy",
    "tiers": [
        {"id": "u1", "code": "P & Q", "label": "Partner <& Co>", "role": "Partner",
         "fill": "green", "attach": False, "merge": False, "align": "center"},
        {"id": "u2", "code": "M/D", "label": "Manager \"Senior\"", "role": "",
         "fill": "white", "attach": False, "merge": True, "align": "center"},
    ],
    "people": [
        {"id": "u-p1", "name": "Ærøskøbing Þórsdóttir", "tierId": "u1",
         "office": "KØB", "role": "", "photo": None, "pw": 0, "ph": 0, "frame": None},
        {"id": "u-p2", "name": "山田 太郎", "tierId": "u1", "office": "TYO",
         "role": "パートナー", "photo": None, "pw": 0, "ph": 0, "frame": None},
        {"id": "u-p3", "name": "Ana-María O'Brien & Sons", "tierId": "u2",
         "office": "MAD", "role": "", "photo": None, "pw": 0, "ph": 0, "frame": None},
        {"id": "u-p4", "name": "🙂 Emoji Person", "tierId": "u2", "office": "FRA",
         "role": "", "photo": None, "pw": 0, "ph": 0, "frame": None},
    ]})
