#!/usr/bin/env python3
"""studio-mark.py: build the opening-titles studio mark and splice it into public/index.html.

"Cyberspace7.org" set in La Boutier (fontspace freeware, non-commercial; only outlines are shipped,
never the font file), turned into SVG paths, then the devil heart (img/brand/heart-ink.png) placed in the
same coordinate space: sized off the lettering's cap height and set after the last letter, so the two
scale together on every screen. Both are drawn in one ink colour (the heart is recoloured by an
SVG filter); the glow is CSS on the whole mark.

The mark is emitted complete and the intro fades it in from black.
The heart still sits under its original stroke mask (#hmm), with every stroke fully drawn, because
that mask is what trims the PNG's scan edges.

  python3 tools/studio-mark.py        # rewrites the <div class="sig-row"> block in index.html
"""

import os
import re
import subprocess
import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
FONT = os.environ.get("WOM_MARK_FONT") or subprocess.run(["fc-match", "-f", "%{file}", "La Boutier"], capture_output=True, text=True).stdout
TEXT = "Cyberspace7.org"
INK = "#d2042d"           # the one colour for name and heart: the brand cherry (--ww-cherry)
HEART_H = 1.25            # heart height (horns to tail) as a multiple of the cap height
HEART_DROP = 0.22         # how far the heart's bottom sits below the baseline, × cap height
PAD = 0.12                # viewBox padding, × cap height (room for the glow)


def kerning(font):
    """{(left, right): xAdvance adjustment} from GPOS 'kern' PairPos lookups (formats 1 and 2)."""
    out = {}
    gpos = font["GPOS"].table if "GPOS" in font else None
    if not gpos:
        return out
    order = font.getGlyphOrder()
    for fr in gpos.FeatureList.FeatureRecord:
        if fr.FeatureTag != "kern":
            continue
        for li in fr.Feature.LookupListIndex:
            lk = gpos.LookupList.Lookup[li]
            subs = lk.SubTable
            if lk.LookupType == 9:
                subs = [s.ExtSubTable for s in subs]
            for st in subs:
                if getattr(st, "LookupType", 2) != 2 and st.__class__.__name__ != "PairPos":
                    continue
                cov = st.Coverage.glyphs
                if st.Format == 1:
                    for g1, ps in zip(cov, st.PairSet):
                        for pv in ps.PairValueRecord:
                            v = getattr(pv.Value1, "XAdvance", 0) or 0
                            out.setdefault((g1, pv.SecondGlyph), v)
                elif st.Format == 2:
                    c1 = st.ClassDef1.classDefs
                    c2 = st.ClassDef2.classDefs
                    for g1 in cov:
                        row = st.Class1Record[c1.get(g1, 0)]
                        for g2 in order:
                            v = getattr(row.Class2Record[c2.get(g2, 0)].Value1, "XAdvance", 0) or 0
                            if v:
                                out.setdefault((g1, g2), v)
    return out


def heart_mask():
    """The heart's stroke mask (#hmm) from index.html, with the draw-on timing stripped."""
    html = (ROOT / "public/index.html").read_text()
    m = re.search(r'<mask id="hmm".*?</mask>', html, re.S)
    if not m:
        sys.exit("heart mask #hmm not found in index.html")
    return re.sub(r' (class="sig-stroke"|style="--l:[^"]*")', "", m.group(0))


def main():
    font = TTFont(FONT)
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    kern = kerning(font)
    names = [cmap[ord(c)] for c in TEXT]

    bp = BoundsPen(gs)
    gs["W"].draw(bp)
    cap = bp.bounds[3]  # top of the W ~ cap height

    # lay out the glyphs
    x = 0
    glyphs = []
    for i, g in enumerate(names):
        pen = SVGPathPen(gs)
        gs[g].draw(pen)
        b = BoundsPen(gs)
        gs[g].draw(b)
        glyphs.append((g, x, pen.getCommands(), b.bounds))
        x += gs[g].width + (kern.get((g, names[i + 1]), 0) if i + 1 < len(names) else 0)

    inked = [(g, gx, d, bb) for g, gx, d, bb in glyphs if bb]
    x0 = min(gx + bb[0] for _, gx, _, bb in inked)
    x1 = max(gx + bb[2] for _, gx, _, bb in inked)
    ytop = max(bb[3] for *_, bb in inked)
    ybot = min(bb[1] for *_, bb in inked)

    # heart: 512-unit art, ink bbox ~ (0..480, 0..507); size off the cap height
    hk = cap * HEART_H / 507
    hx = x1 + cap * 0.08
    hy_bottom = -cap * HEART_DROP           # in font y-up units
    hy_top = hy_bottom + 507 * hk
    pad = cap * PAD
    vx0, vx1 = x0 - pad, hx + 480 * hk + pad
    top = max(ytop, hy_top) + pad            # y-up
    bot = min(ybot, hy_bottom) - pad
    W, H = vx1 - vx0, top - bot
    # SVG y-down: y_svg = top - y_font
    sy = lambda yf: top - yf

    paths = [f'<path transform="translate({gx - vx0:.0f} {top:.0f}) scale(1 -1)" d="{d}"/>'
             for g, gx, d, bb in glyphs if bb]
    hmask = heart_mask()

    hx_svg, hy_svg = hx - vx0, sy(hy_top)
    r, g_, b = (int(INK[i:i + 2], 16) / 255 for i in (1, 3, 5))
    svg = f'''<svg class="studio-mark" viewBox="0 0 {W:.0f} {H:.0f}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>{hmask}<filter id="inkf" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 {r:.3f} 0 0 0 0 {g_:.3f} 0 0 0 0 {b:.3f} 0 0 0 1 0"/></filter></defs><g class="sig-name" fill="{INK}">{"".join(paths)}</g><g transform="translate({hx_svg:.0f} {hy_svg:.0f}) scale({hk:.4f})"><image class="sig-heart" href="img/brand/heart-ink.png" x="0" y="0" width="512" height="512" filter="url(#inkf)" mask="url(#hmm)"/></g></svg>'''

    p = ROOT / "public/index.html"
    html = p.read_text()
    a = html.index('<div class="sig-row">')
    b = html.index('<p class="presents">', a)
    html = html[:a] + f'<div class="sig-row">\n<!-- built by tools/studio-mark.py (static; the intro fades it in) -->\n{svg}\n    </div>\n    ' + html[b:]
    p.write_text(html)
    print(f"viewBox {W:.0f}x{H:.0f}, cap {cap:.0f}, heart scale {hk:.3f}")


if __name__ == "__main__":
    main()
