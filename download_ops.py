import re, os, subprocess

SRC = "/workspace/assets/js/ak_ops.js"
BASE = "/workspace/android-app/app/src/main/assets/public/ops/"

with open(SRC, encoding="utf-8") as f:
    txt = f.read()

urls = list(dict.fromkeys(re.findall(r'https://media\.prts\.wiki/thumb/[^\"]+', txt)))
print("去重后 URL 数量:", len(urls))

os.makedirs(BASE, exist_ok=True)

ok = 0
failed = []
for i, url in enumerate(urls):
    path = url.replace('https://media.prts.wiki/', '', 1)
    local = BASE + path
    os.makedirs(os.path.dirname(local), exist_ok=True)
    def dl():
        subprocess.run(['curl','-s','--max-time','40','-o',local,url])
    dl()
    if not (os.path.exists(local) and os.path.getsize(local) > 400):
        dl()  # retry once
    if os.path.exists(local) and os.path.getsize(local) > 400:
        ok += 1
    else:
        failed.append(url)
    if (i+1) % 50 == 0:
        print(f"进度 {i+1}/{len(urls)} 成功 {ok} 失败 {len(failed)}")

print("成功:", ok)
print("失败:", len(failed))
for u in failed[:20]:
    print("  FAIL", u)
