"""Modern Typewriter (Lukas Krakora, non-commercial, no redistribution) has no `…`: add it
as three of its own periods. Its `{ }` are drawn as round parentheses, and players must type
real braces for {giver}/{receiver}, so unmap them (the browser falls back to the next font).
Then subset to a Latin woff2 for public/type/.
Usage: python3 -I modern-typewriter-build.py <in.ttf> <out.woff2>"""
import sys
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent
from fontTools import subset

f = TTFont(sys.argv[1])
glyf, hmtx = f['glyf'], f['hmtx']
dot = f.getBestCmap()[ord('.')]
adv = hmtx[dot][0]
g = Glyph(); g.numberOfContours = -1; g.components = []
for i in range(3):
    c = GlyphComponent(); c.glyphName, c.x, c.y, c.flags = dot, i * round(adv * 0.8), 0, 0x4
    g.components.append(c)
glyf['ellipsis'] = g
g.recalcBounds(glyf)
hmtx['ellipsis'] = (round(adv * 2.6), g.xMin)
order = list(dict.fromkeys(f.getGlyphOrder() + ['ellipsis']))  # glyf may have appended it already
f.setGlyphOrder(order); glyf.glyphOrder = order
for t in f['cmap'].tables:
    if t.isUnicode():
        t.cmap[0x2026] = 'ellipsis'
        for u in (0x7B, 0x7D):
            t.cmap.pop(u, None)
for t in ('hdmx', 'LTSH'):  # per-glyph hinting caches sized to the old glyph count
    if t in f: del f[t]
opts = subset.Options(); opts.flavor = 'woff2'; opts.layout_features = ['*']
s = subset.Subsetter(opts)
s.populate(unicodes=list(range(0x20, 0x100)) + [0x131, 0x152, 0x153, 0x2C6, 0x2DC] + list(range(0x2000, 0x2070)) + [0x20AC, 0x2122])
s.subset(f)
subset.save_font(f, sys.argv[2], opts)
