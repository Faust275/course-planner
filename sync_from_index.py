#!/usr/bin/env python3
# 从当前单文件 index.html 抽取模块化源码到 assets/，并重建 src/index.template.html。
# 不依赖 stale 的 scaffold 内容，完全以当前 index.html 为唯一事实来源。
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC = pathlib.Path("/workspace/index.html")
TEMPLATE = ROOT / "src" / "index.template.html"
CSS = ROOT / "assets" / "css" / "style.css"
JS = ROOT / "assets" / "js"

txt = SRC.read_text(encoding="utf-8")

# ---------- 1) 抽取主 <style> ----------
m = re.search(r"<style[^>]*>(.*?)</style>", txt, re.S)
if not m:
    sys.exit("[sync] 找不到主 <style>")
style = m.group(1)

# ---------- 2) 抽取真实 <script> 块 ----------
raw = re.findall(r"<script([^>]*)>(.*?)</script>", txt, re.S)
blocks = []
for attrs, body in raw:
    if "src=" in attrs:                 # 头部 inject.js
        continue
    blocks.append(body)
print(f"[sync] 真实脚本块数量: {len(blocks)}")

# ---------- 3) 从 app 块中切出 window.Pet IIFE -> pet.js ----------
def find_pet(body):
    m = re.search(r'window\.Pet\s*=\s*\(function[\s\S]*?\}\s*\)\s*\([^;]*\)\s*;', body)
    if not m:
        return None, body
    pet = m.group(0)
    rest = body[:m.start()] + body[m.end():]
    return pet, rest

pet_code = None
for k in range(len(blocks)):
    pc, rb = find_pet(blocks[k])
    if pc:
        pet_code = pc
        blocks[k] = rb
        print(f"[sync] 已从块 #{k+1} 切出 window.Pet IIFE")
        break

# ---------- 4) 语义命名（以内容为准；视图用唯一的 view-<name> id 识别） ----------
def classify(b):
    if "serviceWorker" in b or "function boot" in b: return "assets/js/app.js"
    if "window.AK_OPS =" in b:                       return "assets/js/ak_ops.js"
    if "window.FOOD_DB =" in b or "FOOD_CATS" in b:  return "assets/js/foods.js"
    if "var Persist" in b:                           return "assets/js/store.js"
    if "DOM 助手" in b:                              return "assets/js/ui.js"
    # 各视图：注册元素 id 唯一，如 id:'view-schedule'（须先于文本启发式）
    m = re.search(r"""id\s*:\s*['"]view-([a-z0-9-]+)['"]""", b)
    if m: return f"assets/js/views/{m.group(1)}.js"
    if "var POEMS" in b:                             return "assets/js/quotes-data.js"
    if "新手教程" in b:                              return "assets/js/onboard.js"
    if "每日一句" in b or "古诗" in b:                return "assets/js/quotes.js"
    if "语音输入" in b:                              return "assets/js/speech.js"
    if "预设主题" in b or "颜色工具" in b:            return "assets/js/theme.js"
    if "global.QrSync =" in b:                       return "assets/js/qr-sync.js"
    if "OTSU" in b and "图片缩放" in b:              return "assets/js/ocr.js"
    if "选图" in b and "识别中" in b:                return "assets/js/views/ocr-dialog.js"
    if "干员元数据" in b or "OP_META" in b:          return "assets/js/views/gacha.js"
    return None

named = []          # (path, code) 非 app 部分，按文档序
app_code = None
used = set()
for idx, b in enumerate(blocks, 1):
    name = classify(b)
    if name is None or name in used:
        name = f"assets/js/views/part_{idx:02d}.js"
    orig, n = name, 2
    while name in used:                      # 仍撞名则加 -2/-3 后缀
        name = re.sub(r'\.js$', f'-{n}.js', orig); n += 1
    used.add(name)
    if name.endswith('app.js'):
        app_code = b
    else:
        named.append((name, b))

if app_code is None:
    sys.exit("[sync] 未找到 app 块（含 serviceWorker/boot），中止")

# pet 放在 app 之前（app 本身在文档序最后）
if pet_code:
    named.append(("assets/js/pet.js", pet_code))
named.append(("assets/js/app.js", app_code))

# ---------- 5) 写出 CSS / JS ----------
def clean(s):
    # 内联进 HTML 时，JS 字符串里的 </script> 会提前闭合标签，转义之
    return s.replace("</script>", "<\\/script>")

CSS.parent.mkdir(parents=True, exist_ok=True)
CSS.write_text(style, encoding="utf-8")
print(f"[sync] 写出 CSS: {CSS.relative_to(ROOT)} ({len(style)}B)")

JS.mkdir(parents=True, exist_ok=True)
for d in (JS, JS / "views"):
    d.mkdir(parents=True, exist_ok=True)
written = []
for path, code in named:
    fp = ROOT / path
    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(clean(code), encoding="utf-8")
    written.append(path)
    print(f"[sync] 写出 JS : {path} ({len(code)}B)")

# ---------- 6) 重建 template（head + body 壳来自当前 index.html，去除生成器噪声） ----------
_head_end = txt.index("</head>") + len("</head>")
head = txt[txt.index("<head"):_head_end]
head = re.sub(r"<style[^>]*>.*?</style>", "", head, flags=re.S)   # 样式统一走 assets/css + <link>
head = re.sub(r'\sdata-page-node-id="[^"]*"', "", head)
head = re.sub(r'\sdata-pnid-children="[^"]*"', "", head)
head = re.sub(r'<script[^>]*src="/page/page_comm/inject\.js"[^>]*></script>', "", head)
head = re.sub(r"\s+>", ">", head).strip() + "\n</head>"

body_start = _head_end
body_end = txt.index("<script", body_start)
body = txt[body_start:body_end]
# 样式块在源文件中位于 <body> 内（而非 head），必须整体剥离，
# 否则 build.py 内联 assets/css 时会重复注入（产物 +120KB）。
body = re.sub(r"<style[^>]*>.*?</style>", "", body, flags=re.S)
body = re.sub(r'\sdata-page-node-id="[^"]*"', "", body)
body = re.sub(r"\sdata-pnid-children=\"[^\"]*\"", "", body)
body = re.sub(r"<!--pnid:[^>]*-->", "", body)
body = re.sub(r"\n{3,}", "\n\n", body)
body = body.strip()

link = '<link rel="stylesheet" href="assets/css/style.css">'
scripts = "\n".join(f'<script src="{p}"></script>' for p in written)
tail = link + "\n" + scripts

template = f"""<!DOCTYPE html>
<html lang="zh-CN">
{head}
{body}

{tail}
</body>
</html>
"""

TEMPLATE.parent.mkdir(parents=True, exist_ok=True)
TEMPLATE.write_text(template, encoding="utf-8")
print(f"[sync] 重建 template: {TEMPLATE.relative_to(ROOT)}")
print("[sync] 完成。下一步运行 build.py")
