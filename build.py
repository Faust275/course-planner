#!/usr/bin/env python3
"""把 src/index.template.html + assets 打包为单文件 index.html（CSS/JS 全内联）。

图标保持外链（icon-192.png / apple-touch-icon.png），不进构建产物——
角色立绘有版权，仓库只放生成脚本，图标由本机自己生成。
用法: python3 build.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
TPL = ROOT / "src" / "index.template.html"
OUT = ROOT / "index.html"

RE_SRC = r'<script src="([^"]+)"></script>'
RE_CSS = r'<link rel="stylesheet" href="([^"]+)">'

tpl = TPL.read_text(encoding="utf-8")

# 预扫描：把模板引用的本地资源一次查完，缺失的整体列出来再退出。
# 旧行为是遇到第一个缺失就 exit，打包漏文件时只报一处，排查要多轮往返。
missing = []
for m in re.finditer(RE_SRC, tpl):
    if not (ROOT / m.group(1)).exists():
        missing.append(m.group(1))
for m in re.finditer(RE_CSS, tpl):
    if not (ROOT / m.group(1)).exists():
        missing.append(m.group(1))

if missing:
    print("[build] 以下被 src/index.template.html 引用的本地文件不存在（是否漏打包？）：")
    for f in sorted(set(missing)):
        print(f"    - {f}")
    sys.exit("[build] 已中止：请先补齐上述文件再构建")


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


html = re.sub(RE_CSS, inline_css, tpl)
html = re.sub(RE_SRC, inline_js, html)

if 'href="assets' in html or 'src="assets' in html:
    sys.exit("[build] 仍存在未内联的外部资源引用")

OUT.write_text(html, encoding="utf-8")
print(f"[build] 已生成 {OUT}  ({len(html)/1024:.1f} KB)")

# ---- 额外产出 dist/：给 Capacitor 打安卓包用 ----
# 只放运行必需的文件。不能把仓库根目录直接当 webDir，
# 否则 node_modules / src / tests / verify_*.mjs 全会塞进 APK。
import shutil

DIST = ROOT / "dist"
# dist/ 仅用于打安卓包；某些环境下会被安全策略/占用锁住。
# 根 index.html 才是单文件交付物，dist 同步失败只告警，不让整次构建失败。
try:
    DIST.mkdir(exist_ok=True)
    (DIST / "index.html").write_text(html, encoding="utf-8")
    for name in ["manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png",
                 "icon-512-maskable.png", "apple-touch-icon.png"]:
        src = ROOT / name
        if src.exists():
            shutil.copy2(src, DIST / name)
        else:
            print(f"[build] 警告: 缺少 {name}，dist/ 里将不含它（不影响单文件使用）")
    print(f"[build] 已同步 dist/ -> {DIST}")
except OSError as e:
    print(f"[build] 警告: dist/ 同步失败（{e}）。根 index.html 已生成，"
          f"打安卓包前请在可写环境重新运行 build.py 更新 dist/。")
