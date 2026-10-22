#!/usr/bin/env python3
# ④ 统一 CSS 命名空间：给所有 app 类加 cp- 前缀。
# 策略：CSS 选择器静态加前缀；el() 运行时给 class 加前缀（覆盖全部 class: 调用，
#       含动态三元/变量）；$ / $$ / querySelector / classList / className /
#       setAttribute('class') / 内联 class="..." 静态加前缀。pet.js 与打印文档除外。
import re, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent
CSS = ROOT / "assets" / "css" / "style.css"
JS = ROOT / "assets" / "js"
TPL = ROOT / "src" / "index.template.html"
KEEP = ("cp-", "gp-", "pet-")


def pfx(name):
    for p in KEEP:
        if name.startswith(p):
            return name
    return "cp-" + name


def pref_tokens(s):
    return re.sub(r"[^\s]+", lambda m: pfx(m.group(0)), s)


# ---------------- CSS：只处理选择器前导（{ 之前的文本），跳过声明块 ----------------
def prefix_selector(sel):
    out = []
    i, n = 0, len(sel)
    q = None
    br = 0
    while i < n:
        c = sel[i]
        if q:
            out.append(c)
            if c == q:
                q = None
            i += 1
            continue
        if c == "/" and i + 1 < n and sel[i + 1] == "*":       # 注释原样保留
            j = sel.find("*/", i + 2)
            if j < 0:
                out.append(sel[i:]); break
            out.append(sel[i:j + 2]); i = j + 2; continue
        if c in "\"'":
            q = c; out.append(c); i += 1; continue
        if c == "[":
            br += 1; out.append(c); i += 1; continue
        if c == "]":
            br = max(0, br - 1); out.append(c); i += 1; continue
        if c == "." and br == 0:
            j = i + 1
            if j < n and (sel[j].isalpha() or sel[j] in "_-"):
                k = j
                while k < n and (sel[k].isalnum() or sel[k] in "_-"):
                    k += 1
                out.append("." + pfx(sel[j:k])); i = k; continue
        out.append(c); i += 1
    return "".join(out)


def prefix_css(css):
    out = []
    seg = []
    i, n = 0, len(css)
    q = None
    while i < n:
        c = css[i]
        if q:
            seg.append(c)
            if c == q:
                q = None
            i += 1; continue
        if c == "/" and i + 1 < n and css[i + 1] == "*":
            j = css.find("*/", i + 2)
            if j < 0:
                seg.append(css[i:]); break
            seg.append(css[i:j + 2]); i = j + 2; continue
        if c in "\"'":
            q = c; seg.append(c); i += 1; continue
        if c == "{":
            prelude = "".join(seg)
            if prelude.strip().startswith("@"):
                out.append(prelude)                       # @media/@keyframes 等原样
            else:
                out.append(prefix_selector(prelude))
            out.append("{")
            seg = []; i += 1; continue
        if c == "}":
            out.append("".join(seg)); out.append("}")
            seg = []; i += 1; continue
        seg.append(c); i += 1
    out.append("".join(seg))
    return "".join(out)


# ---------------- JS 静态改写 ----------------
# 选择器调用 $ / $$ / querySelector(All) 的首个字符串实参
SEL_CALL = re.compile(r"(?:querySelectorAll|querySelector|\$\$|\$)\s*\(\s*")


def prefix_selector_calls(text):
    out = []
    pos = 0
    for m in SEL_CALL.finditer(text):
        qpos = m.end()
        if qpos >= len(text) or text[qpos] not in "\"'`":
            continue
        q = text[qpos]
        i = qpos + 1
        j = i
        while j < len(text):
            if text[j] == "\\":
                j += 2; continue
            if text[j] == q:
                break
            j += 1
        if j >= len(text):
            continue
        lit = text[i:j]
        out.append(text[pos:qpos + 1])
        out.append(prefix_selector(lit))
        pos = j
    out.append(text[pos:])
    return "".join(out)


def rewrite_js(text, fname):
    # 打印成绩单文档：自成一个独立窗口 + 自带样式，整体保持原样
    exclude = None
    ti = text.find("'<title>成绩单</title>")
    if ti >= 0:
        fs = text.rfind("\n  function ", 0, ti)
        he = text.find("</html>", ti)
        if fs >= 0 and he >= 0:
            q = text.find("'", he)
            exclude = (fs, q + 1 if q >= 0 else he)

    # 1) 内联 class="..."（打印文档除外）
    def repl_class_attr(m):
        if exclude and exclude[0] <= m.start() < exclude[1]:
            return m.group(0)
        return 'class="' + pref_tokens(m.group(1)) + '"'
    text = re.sub(r'class="([^"]*)"', repl_class_attr, text)

    # 2) classList.add/remove/toggle/contains('literal')
    def repl_cl(m):
        return m.group(1) + m.group(2) + pref_tokens(m.group(3)) + m.group(2)
    text = re.sub(r"(classList\.(?:add|remove|toggle|contains)\(\s*)(['\"])([^'\"]*)\2", repl_cl, text)

    # 3) setAttribute('class', 'literal')
    def repl_sa(m):
        return m.group(1) + m.group(2) + pref_tokens(m.group(3)) + m.group(2)
    text = re.sub(r"(setAttribute\(\s*['\"]class['\"]\s*,\s*)(['\"])([^'\"]*)\2", repl_sa, text)

    # 4) className 赋值 / 比较 / includes / indexOf
    def repl_cn(m):
        return m.group(1) + m.group(2) + pref_tokens(m.group(3)) + m.group(2)
    text = re.sub(r"(\.className\s*(?:===?|!=)\s*)(['\"])([^'\"]*)\2", repl_cn, text)
    text = re.sub(r"(\.className\s*=\s*)(['\"])([^'\"]*)\2", repl_cn, text)
    text = re.sub(r"(\.className\.(?:indexOf|includes)\(\s*)(['\"])([^'\"]*)\2", repl_cn, text)

    # 5) $ / $$ / querySelector(All) 选择器字面量里的 .class
    text = prefix_selector_calls(text)
    return text


def main():
    # CSS
    css = CSS.read_text(encoding="utf-8")
    new_css = prefix_css(css)
    CSS.write_text(new_css, encoding="utf-8")
    print("[cp] CSS 选择器已加 cp- 前缀")

    # JS（pet.js 跳过）
    for f in sorted(JS.rglob("*.js")):
        if f.name == "pet.js":
            continue
        s = f.read_text(encoding="utf-8")
        ns = rewrite_js(s, f.name)
        if ns != s:
            f.write_text(ns, encoding="utf-8")
            print(f"[cp] 改写 {f.relative_to(ROOT)}")

    # el() 运行时给 class 加前缀（唯一入口，覆盖所有 class: 调用）
    ui = JS / "ui.js"
    u = ui.read_text(encoding="utf-8")
    u2 = u.replace(
        "if (k === 'class') node.className = v;",
        "if (k === 'class') node.className = String(v).split(/\\s+/).filter(Boolean).map(function(c){return /^(cp-|gp-|pet-)/.test(c)?c:'cp-'+c;}).join(' ');",
    )
    # 动态 classList.add(cls)（lv1/lv2/all）
    u2 = u2.replace(
        "if (cls) node.classList.add(cls);",
        "if (cls) node.classList.add(/^(cp-|gp-|pet-)/.test(cls)?cls:'cp-'+cls);",
    )
    if u2 == u:
        print("[cp] ⚠ ui.js 未找到 el() 改写锚点")
    else:
        ui.write_text(u2, encoding="utf-8")
        print("[cp] ui.js: el() 已加运行时前缀")

    # 模板 body 壳的 class="..."
    tpl = TPL.read_text(encoding="utf-8")
    tpl2 = re.sub(r'class="([^"]*)"', lambda m: 'class="' + pref_tokens(m.group(1)) + '"', tpl)
    TPL.write_text(tpl2, encoding="utf-8")
    print("[cp] template body 已加前缀")
    print("[cp] 完成。下一步 python3 build.py")


if __name__ == "__main__":
    main()
