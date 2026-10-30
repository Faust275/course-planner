#!/usr/bin/env python3
"""把 src/index.template.html + assets 打包为 index.html（CSS/JS 内联 + 自动压缩 + 未压缩调试版 + SW 哈希 + 安卓同步）。

用法:
    python3 build.py                默认：语料外置 + terser/CSS 压缩（保留函数名便于排错）+ 输出 dist/index.debug.html 未压缩版 + 更新 sw.js 缓存哈希 + 同步 dist/ 与 android/
    python3 build.py --inline       全部内联（含 800KB 诗词语料）
    python3 build.py --no-minify    跳过 JS/CSS 压缩（index.html 直接输出未压缩版）
"""
import hashlib
import pathlib
import re
import shutil
import subprocess
import sys

# Windows 控制台默认 GBK，遇到特殊符号会直接抛 UnicodeEncodeError；统一转 UTF-8
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parent
TPL = ROOT / "src" / "index.template.html"
OUT = ROOT / "index.html"
SW_PATH = ROOT / "sw.js"

# 这份语料默认不内联，改为同目录的独立文件
QUOTES_SRC = ROOT / "assets" / "js" / "quotes-data.js"
QUOTES_OUT = ROOT / "quotes-data.js"

ALLOWED_FLAGS = {"--inline", "--no-minify", "--release", "--external-js"}
if any(a not in ALLOWED_FLAGS for a in sys.argv[1:]):
    sys.exit("[build] 未知参数。用法: python3 build.py [--inline] [--no-minify] [--release]")

INLINE_ALL = "--inline" in sys.argv
MINIFY = "--no-minify" not in sys.argv
# --external-js：不内联，产出 index.html + assets/js/*.js（每个文件单独压缩）。
# 给 APK / PWA 用：浏览器可以边下载边解析，骨架屏更早出现；代价是丢掉单文件分发。
EXTERNAL = "--external-js" in sys.argv
# --release：不往 dist/ 落未压缩调试版。webDir=dist，cap sync 会把 dist 整个拷进 APK，
# 那份 2.8MB 的 index.debug.html 会白搭进去（CHANGELOG v1.4 声称移除的就是它）。
RELEASE = "--release" in sys.argv

RE_SRC = r'<script src="([^"]+)"></script>'
RE_CSS = r'<link rel="stylesheet" href="([^"]+)">'

tpl = TPL.read_text(encoding="utf-8")

# 预扫描：把模板引用的本地资源一次查完，缺失的整体列出来再退出。
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


def minify_css(css_text: str) -> str:
    """安全压缩 CSS：剥离注释与多余空白，保留 calc() 内的 + / - 两侧空格。"""
    out = re.sub(r"/\*[\s\S]*?\*/", "", css_text)
    out = re.sub(r"\s+", " ", out)
    out = re.sub(r"\s*([{};:,>])\s*", r"\1", out)
    out = out.replace(";}", "}").strip()
    return out


def minify_js(js_text: str) -> str:
    """单个 JS 文件压缩（--external-js 用）：失败就原样返回，不阻塞构建。"""
    if not TERSER_BIN:
        return js_text
    cmd = (TERSER_BIN if isinstance(TERSER_BIN, list) else [TERSER_BIN]) + [
        "--compress", "--mangle", "--keep-fnames"
    ]
    try:
        res = subprocess.run(cmd, input=js_text.encode("utf-8"), capture_output=True)
        if res.returncode == 0 and res.stdout:
            return res.stdout.decode("utf-8").replace("</script", "<\\/script")
    except Exception as e:
        print(f"[build] 警告: 单文件压缩失败（{e}）")
    return js_text


def find_terser():
    # 优先走 node 直接执行 JS 入口，彻底解决 Windows 下调用 .bin/terser bash 脚本抛 WinError 193 崩溃
    node_bin = shutil.which("node")
    js_entry = ROOT / "node_modules" / "terser" / "bin" / "terser"
    if js_entry.exists() and node_bin:
        return [node_bin, str(js_entry)]
    local_cmd = ROOT / "node_modules" / ".bin" / "terser.cmd"
    if local_cmd.exists():
        return [str(local_cmd)]
    local_bin = ROOT / "node_modules" / ".bin" / "terser"
    if local_bin.exists() and sys.platform != "win32":
        return [str(local_bin)]
    sys_bin = shutil.which("terser")
    if sys_bin:
        return [sys_bin]
    return None


TERSER_BIN = find_terser() if MINIFY else None
if MINIFY and not TERSER_BIN:
    sys.exit(
        "[build] 找不到 terser，拒绝产出未压缩包（会让 index.html 从 1.6MB 涨到 2.9MB 并塞进 APK）。\n"
        "        先执行 npm install；确实要未压缩调试版请显式加 --no-minify。"
    )


def inline_css_raw(m):
    href = m.group(1)
    path = ROOT / href
    if not path.exists():
        sys.exit(f"[build] 缺少样式文件: {href}")
    return "<style>\n" + path.read_text(encoding="utf-8") + "\n</style>"


def inline_css_min(m):
    href = m.group(1)
    path = ROOT / href
    if not path.exists():
        sys.exit(f"[build] 缺少样式文件: {href}")
    raw_css = path.read_text(encoding="utf-8")
    return "<style>\n" + (minify_css(raw_css) if MINIFY else raw_css) + "\n</style>"


# 收集所有内联脚本源码
script_matches_tpl = list(re.finditer(RE_SRC, tpl))
raw_scripts = []
for m in script_matches_tpl:
    src = m.group(1)
    path = ROOT / src
    if not path.exists():
        sys.exit(f"[build] 缺少脚本文件: {src}")
    code = path.read_text(encoding="utf-8")
    if "</script" in code:
        sys.exit(f"[build] {src} 含有 </script> 字面量，需转义")
    raw_scripts.append((src, code))


def build_unminified_html(quotes_inline_code=None) -> str:
    """生成带源文件标记的未压缩单文件 HTML，供线上排错或 --no-minify 使用。"""
    h = re.sub(RE_CSS, inline_css_raw, tpl)
    s_matches = list(re.finditer(RE_SRC, h))
    for m_obj, (src, code) in zip(reversed(s_matches), reversed(raw_scripts)):
        banner = f"/* === [source] {src} === */\n"
        h = h[:m_obj.start()] + "<script>\n" + banner + code + "\n</script>" + h[m_obj.end():]
    if quotes_inline_code is not None:
        idx = h.rindex("</body>")
        h = h[:idx] + "<script>\n" + quotes_inline_code + "\n</script>\n" + h[idx:]
    return h


quotes_code = QUOTES_SRC.read_text(encoding="utf-8")
if "</script" in quotes_code:
    sys.exit("[build] quotes-data.js 含有 </script> 字面量，需转义")

# 始终构造一份未压缩 HTML（供 dist/index.debug.html 留存排错，或 --no-minify 直接输出）
debug_html = build_unminified_html(quotes_code if INLINE_ALL else None)

if MINIFY:
    html = re.sub(RE_CSS, inline_css_min, tpl)
    script_matches = list(re.finditer(RE_SRC, html))
    if TERSER_BIN and script_matches:
        combined_js = "\n;\n".join(code for _, code in raw_scripts)
        cmd = (TERSER_BIN if isinstance(TERSER_BIN, list) else [TERSER_BIN]) + [
            "--compress", "--mangle", "--keep-fnames"
        ]
        res = subprocess.run(
            cmd,
            input=combined_js.encode("utf-8"),
            capture_output=True,
        )
        if res.returncode == 0 and res.stdout:
            minified_js = res.stdout.decode("utf-8")
            if "</script" in minified_js:
                minified_js = minified_js.replace("</script", "<\\/script")
            first_start = script_matches[0].start()
            last_end = script_matches[-1].end()
            html = html[:first_start] + "<script>\n" + minified_js + "\n</script>" + html[last_end:]
        else:
            err_msg = res.stderr.decode("utf-8", errors="replace")[:300]
            print(f"[build] 警告: terser 压缩失败，回退未压缩内联 ({err_msg})")
            for m_obj, (_, code) in zip(reversed(script_matches), reversed(raw_scripts)):
                html = html[:m_obj.start()] + "<script>\n" + code + "\n</script>" + html[m_obj.end():]
    else:
        for m_obj, (_, code) in zip(reversed(script_matches), reversed(raw_scripts)):
            html = html[:m_obj.start()] + "<script>\n" + code + "\n</script>" + html[m_obj.end():]

    if INLINE_ALL:
        i = html.rindex("</body>")
        html = html[:i] + "<script>\n" + quotes_code + "\n</script>\n" + html[i:]
else:
    html = debug_html

if EXTERNAL:
    # 外部脚本模式：index.html 保留 <script src>，脚本按文件压缩后放到 dist/assets/js
    if not TERSER_BIN:
        sys.exit("[build] --external-js 需要 terser，请先 npm install")
    html = tpl

if not INLINE_ALL:
    QUOTES_OUT.write_bytes(QUOTES_SRC.read_bytes())

if not EXTERNAL and ('href="assets' in html or 'src="assets' in html):
    sys.exit("[build] 仍存在未内联的外部资源引用")

OUT.write_text(html, encoding="utf-8")
size_kb = len(html.encode("utf-8")) / 1024
mode_tag = "minified (keep-fnames)" if (MINIFY and TERSER_BIN) else "unminified"
print(f"[build] 已生成 {OUT}  ({size_kb:.1f} KB, {mode_tag})")
if INLINE_ALL:
    print("[build] 语料已内联（单文件形态，首屏含 800KB 诗词语料）")
else:
    print(f"[build] 语料已外置 -> {QUOTES_OUT.name} "
          f"({len(quotes_code.encode('utf-8'))/1024:.1f} KB)，"
          f"分发时请与 index.html 放在同一目录")

# ---- 自动更新 sw.js 缓存哈希（解决 cp-app-v4 永不过期导致 quotes-data.js 不更新的问题） ----
build_hash = hashlib.sha256(
    html.encode("utf-8") + quotes_code.encode("utf-8")
).hexdigest()[:8]
cache_name = f"cp-app-{build_hash}"
if SW_PATH.exists():
    sw_text = SW_PATH.read_text(encoding="utf-8")
    new_sw_text = re.sub(r"const CACHE = '[^']*';", f"const CACHE = '{cache_name}';", sw_text, count=1)
    if new_sw_text != sw_text:
        SW_PATH.write_text(new_sw_text, encoding="utf-8")
    print(f"[build] 已更新 sw.js 缓存版本 -> {cache_name}")

# ---- 同步 dist/ 与 android/app/src/main/assets/public/ ----
DIST = ROOT / "dist"
ANDROID_PUBLIC = ROOT / "android" / "app" / "src" / "main" / "assets" / "public"
extra = [] if INLINE_ALL else ["quotes-data.js"]
bundle_files = [
    "manifest.webmanifest", "sw.js",
    "icon-192.png", "icon-512.png", "icon-512-maskable.png", "apple-touch-icon.png"
] + extra

for target_dir in (DIST, ANDROID_PUBLIC):
    try:
        if target_dir == ANDROID_PUBLIC and not (ROOT / "android").exists():
            continue
        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / "index.html").write_text(html, encoding="utf-8")
        if target_dir == DIST:
            dbg = target_dir / "index.debug.html"
            if RELEASE:
                # 发布模式：清掉上一次留下的调试版，避免 cap sync 把它拷进 APK
                if dbg.exists():
                    try:
                        dbg.unlink()
                        print("[build] release 模式：已移除 dist/index.debug.html（不进 APK）")
                    except OSError as e:
                        print(f"[build] 警告: 移除 {dbg} 失败（{e}）")
            else:
                dbg.write_text(debug_html, encoding="utf-8")
                dbg_kb = len(debug_html.encode("utf-8")) / 1024
                print(f"[build] 已输出未压缩调试版 -> {dbg} ({dbg_kb:.1f} KB)")
        for name in bundle_files:
            src = ROOT / name
            if src.exists():
                shutil.copy2(src, target_dir / name)
        if EXTERNAL:
            css_dir = target_dir / "assets" / "css"
            css_dir.mkdir(parents=True, exist_ok=True)
            (css_dir / "style.css").write_text(
                minify_css((ROOT / "assets" / "css" / "style.css").read_text(encoding="utf-8")),
                encoding="utf-8"
            )
            for rel, code in raw_scripts:
                out_path = target_dir / rel
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_text(minify_js(code), encoding="utf-8")
            print(f"[build] 已输出外部脚本 -> {target_dir / 'assets' / 'js'}（{len(raw_scripts)} 个文件）")
        else:
            # 上一次若是 --external-js 构建，清掉残留的 assets 目录，别把它塞进 APK
            stale = target_dir / "assets"
            if stale.exists():
                shutil.rmtree(stale, ignore_errors=True)
        print(f"[build] 已同步资源目录 -> {target_dir}")
    except OSError as e:
        print(f"[build] 警告: {target_dir} 同步失败（{e}）")
