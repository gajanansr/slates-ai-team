"""Generate the Slates mark and icon SVGs. Run: python3 brand/generate.py
Then rasterise with the icon renderer (see README / HANDOFF)."""
import re

HW, HH, T = 28, 14, 4.2          # rhombus half-width, half-height, slab thickness
CYS = [34, 48, 62]               # top, middle, bottom slab centres
P = lambda pts: ' '.join(f'{x:g},{y:g}' for x, y in pts)

def slab(cy, top, left, right, edge=None):
    x0, x1, cx = 50 - HW, 50 + HW, 50
    out = [
        f'<polygon points="{P([(x0,cy),(cx,cy+HH),(cx,cy+HH+T),(x0,cy+T)])}" fill="{left}"/>',
        f'<polygon points="{P([(cx,cy+HH),(x1,cy),(x1,cy+T),(cx,cy+HH+T)])}" fill="{right}"/>',
        f'<polygon points="{P([(x0,cy),(cx,cy-HH),(x1,cy),(cx,cy+HH)])}" fill="{top}"/>',
    ]
    if edge:
        out.append(f'<polyline points="{P([(x0+0.6,cy),(cx,cy+HH-0.3),(x1-0.6,cy)])}" fill="none" stroke="{edge}" stroke-width="0.7" stroke-linejoin="round"/>')
    return '\n    '.join(out)

DEFS = '''<defs>
    <linearGradient id="s-t1" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#f3fbc4"/><stop offset="0.5" stop-color="#e1f48a"/><stop offset="1" stop-color="#c8de60"/></linearGradient>
    <linearGradient id="s-t2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9cfba"/><stop offset="1" stop-color="#99a28b"/></linearGradient>
    <linearGradient id="s-t3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#58635d"/><stop offset="1" stop-color="#3d4742"/></linearGradient>
    <radialGradient id="s-bg" cx="0.5" cy="0.15" r="1"><stop offset="0" stop-color="#2d3a34"/><stop offset="0.6" stop-color="#1f2a26"/><stop offset="1" stop-color="#161e1b"/></radialGradient>
    <radialGradient id="s-glow" cx="0.5" cy="0.4" r="0.42"><stop offset="0" stop-color="#e1f48a" stop-opacity="0.14"/><stop offset="1" stop-color="#e1f48a" stop-opacity="0"/></radialGradient>
  </defs>'''

MARK = '\n    '.join([
    slab(CYS[2], 'url(#s-t3)', '#323b37', '#29312d'),
    slab(CYS[1], 'url(#s-t2)', '#7a836d', '#636b58', edge='rgba(255,255,255,0.35)'),
    slab(CYS[0], 'url(#s-t1)', '#a7bb4c', '#8ea03b', edge='rgba(255,255,255,0.85)'),
])

def icon(tile, scale):
    g = f'<g transform="translate(50 50) scale({scale}) translate(-50 -50)">\n    {MARK}\n  </g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  {DEFS}\n  {tile}\n  <rect width="100" height="100" fill="url(#s-glow)"/>\n  {g}\n</svg>\n'

FULL = '<rect width="100" height="100" fill="url(#s-bg)"/>'
ROUNDED = '<rect x="0.5" y="0.5" width="99" height="99" rx="23" fill="url(#s-bg)" stroke="#ffffff" stroke-opacity="0.08"/>'

open('brand/app-icon.svg', 'w').write(icon(FULL, 1.12))      # iOS / Android "any" (full bleed)
open('brand/maskable.svg', 'w').write(icon(FULL, 0.78))      # inside the maskable safe zone
open('public/icon.svg', 'w').write(icon(ROUNDED, 1.06))      # favicon + in-app logo tile
open('brand/mark.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 18 100 66">\n  {DEFS}\n  {MARK}\n</svg>\n')

# Notification badge: white silhouette (alpha only).
polys = re.findall(r'<polygon points="([^"]+)"', MARK)
ops = [0.45] * 3 + [0.7] * 3 + [1] * 3
body = '\n  '.join(f'<polygon points="{p}" fill="#fff" fill-opacity="{o}"/>' for p, o in zip(polys, ops))
open('brand/badge.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="14 14 72 72">\n  {body}\n</svg>\n')
print('brand svgs written')
