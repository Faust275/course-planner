#!/usr/bin/env python3
"""把 src/index.template.html + assets 打包为 index.html（CSS/JS 内联）。

用法:
    python3 build.py            默认：诗词语料外置，产出 index.html + quotes-data.js（两个文件放一起）
    python3 build.py --inline   全部内联，回到「一个 html 走天下」的老形态（首屏多 800KB）

为什么要外置：quotes-data.js 有 800KB，占单文件三分之一，而它只有「每日一句 / 每日一词」
用得上，不是首屏必需。外置后 index.html 从 2.2MB 降到 1.4MB 左右，首屏内置的
quotes-mini.js 只有 15KB，够卡片先显示出来，完整语料随用随取。

图标保持外链（icon-192.png / apple-touch-icon.png），不进构建产物——
角色立绘有版权，仓库只放生成脚本，图标由本机自己生成。
"""
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent
TPL = ROOT / "src" / "index.template.html"
OUT = ROOT / "index.html"

# 这份语料默认不内联，改为同目录的独立文件
QUOTES_SRC = ROOT / "assets" / "js" / "quotes-data.js"
QUOTES_OUT = ROOT / "quotes-data.js"

INLINE_ALL = "--inline" in sys.argv
if any(a not in ("--inline",) for a in sys.argv[1:]):
    sys.exit("[build] 未知参数。用法: python3 build.py [--inline]")

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

if not QUOTES_SRC.exists():
    sys.exit(f"[build] 缺少语料文件: {QUOTES_SRC}")


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

# ---- 诗词语料：默认外置；--inline 时塞回 </body> 前 ----
quotes_code = QUOTES_SRC.read_text(encoding="utf-8")
if "</script" in quotes_code:
    sys.exit("[build] quotes-data.js 含有 </script> 字面量，需转义")

if INLINE_ALL:
    i = html.rindex("</body>")
    html = html[:i] + "<script>\n" + quotes_code + "\n</script>\n" + html[i:]
else:
    # 二进制复制，保证根目录这份与源文件逐字节相同（换行符也一致），diff 才干净
    QUOTES_OUT.write_bytes(QUOTES_SRC.read_bytes())

if 'href="assets' in html or 'src="assets' in html:
    sys.exit("[build] 仍存在未内联的外部资源引用")

OUT.write_text(html, encoding="utf-8")
# 报字节数而不是字符数：中文一个字三字节，只报 len(html) 会让人以为文件比实际小三分之一
print(f"[build] 已生成 {OUT}  ({len(html.encode('utf-8'))/1024:.1f} KB)")
if INLINE_ALL:
    print("[build] 语料已内联（单文件形态，首屏含 800KB 诗词语料）")
else:
    print(f"[build] 语料已外置 -> {QUOTES_OUT.name} "
          f"({len(quotes_code.encode('utf-8'))/1024:.1f} KB)，"
          f"分发时请与 index.html 放在同一目录")

# ---- 额外产出 dist/：给 Capacitor 打安卓包用 ----
# 只放运行必需的文件。不能把仓库根目录直接当 webDir，
# 否则 node_modules / src / tests / verify_*.mjs 全会塞进 APK。
DIST = ROOT / "dist"
extra = [] if INLINE_ALL else ["quotes-data.js"]
# dist/ 仅用于打安卓包；某些环境下会被安全策略/占用锁住。
# 根 index.html 才是单文件交付物，dist 同步失败只告警，不让整次构建失败。
try:
    DIST.mkdir(exist_ok=True)
    (DIST / "index.html").write_text(html, encoding="utf-8")
    for name in ["manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png",
                 "icon-512-maskable.png", "apple-touch-icon.png"] + extra:
        src = ROOT / name
        if src.exists():
            shutil.copy2(src, DIST / name)
        else:
            print(f"[build] 警告: 缺少 {name}，dist/ 里将不含它（不影响单文件使用）")
    print(f"[build] 已同步 dist/ -> {DIST}")
except OSError as e:
    print(f"[build] 警告: dist/ 同步失败（{e}）。根 index.html 已生成，"
          f"打安卓包前请在可写环境重新运行 build.py 更新 dist/。")
