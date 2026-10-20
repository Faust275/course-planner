#!/usr/bin/env python3
"""把 src/index.template.html + assets 打包为单文件 index.html（CSS/JS 全内联）。

用法: python3 build.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
TPL = ROOT / "src" / "index.template.html"
OUT = ROOT / "index.html"

tpl = TPL.read_text(encoding="utf-8")


def inline_css(m):
    href = m.group(1)
    path = ROOT / href
    if not path.exists():
        sys.exit(f"[build] 缺少样式文件: {href}")
    return "<style>\n" + path.read_text(encoding="utf-8") + "\n</style>"


def inline_js(m):
    src = m.group(1)
    path = ROOT / src
    if not path.exists():
        sys.exit(f"[build] 缺少脚本文件: {src}")
    code = path.read_text(encoding="utf-8")
    if "</script" in code:
        sys.exit(f"[build] {src} 含有 </script> 字面量，需转义")
    return "<script>\n" + code + "\n</script>"


html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', inline_css, tpl)
html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)

if 'href="assets' in html or 'src="assets' in html:
    sys.exit("[build] 仍存在未内联的外部资源引用")

OUT.write_text(html, encoding="utf-8")
print(f"[build] 已生成 {OUT}  ({len(html)/1024:.1f} KB)")
