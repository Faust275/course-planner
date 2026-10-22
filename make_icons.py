#!/usr/bin/env python3
"""生成 PWA 图标（icon-192.png / icon-512.png）。

图案与 index.html 里的内联 SVG favicon 一致：靛蓝圆角底 + 白色日历页
+ 深一点的标题栏 + 四个课表格子。用 4 倍超采样再缩，圆角才不会有锯齿。

用法: python3 make_icons.py
"""
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent
SS = 4  # 超采样倍数

BG = (79, 70, 229)      # #4f46e5
BAR = (99, 102, 241)    # #6366f1
WHITE = (255, 255, 255)


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def render(size):
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 背景：16/64 的圆角，留一点内边距让 maskable 裁切也不切到内容
    pad = int(n * 0.02)
    rounded(d, (pad, pad, n - pad, n - pad), int(n * 0.235), BG)

    # 白色日历页：12/64 → 52/64 横向，16/64 → 50/64 纵向
    x0, y0 = int(n * 0.1875), int(n * 0.25)
    x1, y1 = int(n * 0.8125), int(n * 0.781)
    rounded(d, (x0, y0, x1, y1), int(n * 0.078), WHITE)

    # 标题栏（顶部一段，圆角只保留上方）
    bar_h = int(n * 0.14)
    d.rounded_rectangle((x0, y0, x1, y0 + bar_h), radius=int(n * 0.078), fill=BAR)
    d.rectangle((x0, y0 + bar_h - int(n * 0.05), x1, y0 + bar_h), fill=BAR)

    # 四个格子：2 列 × 2 行
    cw, ch = int(n * 0.172), int(n * 0.094)
    gap_x, gap_y = int(n * 0.078), int(n * 0.0625)
    gx = x0 + (x1 - x0 - (cw * 2 + gap_x)) // 2
    gy = y0 + bar_h + int(n * 0.055)
    for row in range(2):
        for col in range(2):
            cx = gx + col * (cw + gap_x)
            cy = gy + row * (ch + gap_y)
            rounded(d, (cx, cy, cx + cw, cy + ch), int(ch * 0.33), BG)

    return img.resize((size, size), Image.LANCZOS)


for s in (192, 512):
    out = ROOT / f"icon-{s}.png"
    render(s).save(out, "PNG", optimize=True)
    print(f"[icons] {out.name}  {out.stat().st_size / 1024:.1f} KB")
