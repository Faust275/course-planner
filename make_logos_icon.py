#!/usr/bin/env python3
"""把角色头像做成 PWA 图标（icon-192 / icon-512 / maskable / apple-touch）。

用法：
    python3 make_logos_icon.py [源图]

源图默认 /tmp/logos/tx.png（180×180 的干员头像）。输出覆盖仓库根目录的
icon-192.png / icon-512.png / icon-512-maskable.png / apple-touch-icon.png。

注意：角色立绘版权归鹰角网络所有，图标仅个人本机使用，不进 Git。
"""
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent
SRC = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path('/tmp/logos/tx.png')
SS = 4                      # 超采样
DARK_TOP = (52, 64, 104)    # 深蓝紫
DARK_BOT = (14, 17, 27)
RING = (108, 140, 255)      # Logos 的蓝


def radial_bg(n):
    """深色径向渐变：中心偏上亮一点，边缘压暗。"""
    y, x = np.mgrid[0:n, 0:n]
    cx, cy = n * 0.5, n * 0.42
    r = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / (n * 0.72)
    r = np.clip(r, 0, 1)[..., None]
    top = np.array(DARK_TOP, dtype=float)
    bot = np.array(DARK_BOT, dtype=float)
    img = top * (1 - r) + bot * r
    return Image.fromarray(img.astype('uint8'), 'RGB').convert('RGBA')


def circle_avatar(src, diameter):
    """把源图正方形缩放到 diameter 并做圆形裁切。"""
    im = src.convert('RGBA').resize((diameter, diameter), Image.LANCZOS)
    # 原图四角带浅色描边，圆形裁切时向内收 1.2% 把它切掉
    pad = max(1, int(diameter * 0.012))
    im = im.crop((pad, pad, diameter - pad, diameter - pad)).resize((diameter, diameter), Image.LANCZOS)
    im = ImageEnhance.Brightness(im).enhance(1.07)
    im = ImageEnhance.Contrast(im).enhance(1.04)
    mask = Image.new('L', (diameter, diameter), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, diameter - 1, diameter - 1), fill=255)
    im.putalpha(mask)
    return im


def compose(size, maskable=False):
    n = size * SS
    canvas = Image.new('RGBA', (n, n), (0, 0, 0, 0))

    # 圆角底（maskable 用满幅方形，避免被系统裁出白边）
    bg = radial_bg(n)
    if maskable:
        canvas.alpha_composite(bg)
        inset = int(n * 0.20)
    else:
        plate = Image.new('RGBA', (n, n), (0, 0, 0, 0))
        ImageDraw.Draw(plate).rounded_rectangle((0, 0, n - 1, n - 1), radius=int(n * 0.235), fill=(255, 255, 255, 255))
        plate.putalpha(plate.split()[3])
        canvas = Image.composite(bg, canvas, plate.split()[3])
        inset = int(n * 0.115)

    box = n - inset * 2
    avatar = circle_avatar(SRC, box)

    # 头像外圈：细亮环
    layer = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    layer.alpha_composite(avatar, (inset, inset))
    ring = ImageDraw.Draw(layer)
    ring.ellipse((inset, inset, inset + box - 1, inset + box - 1), outline=RING, width=max(2, int(n * 0.008)))
    canvas.alpha_composite(layer)

    # 轻微内阴影让头像和底分离
    sh = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((inset - 2, inset - 2, inset + box + 1, inset + box + 1), fill=(0, 0, 0, 90))
    sh = sh.filter(ImageFilter.GaussianBlur(int(n * 0.012)))
    out = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    out.alpha_composite(sh)
    out.alpha_composite(canvas)

    return out.resize((size, size), Image.LANCZOS)


def main():
    global SRC
    if not SRC.exists():
        print(f'[icon] 找不到源图：{SRC}')
        return 1
    SRC = Image.open(SRC)
    outputs = [
        ('icon-192.png', compose(192)),
        ('icon-512.png', compose(512)),
        ('icon-512-maskable.png', compose(512, maskable=True)),
        ('apple-touch-icon.png', compose(180)),
    ]
    for name, img in outputs:
        p = ROOT / name
        img.save(p, 'PNG', optimize=True)
        print(f'[icon] {name}  {p.stat().st_size / 1024:.1f} KB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
