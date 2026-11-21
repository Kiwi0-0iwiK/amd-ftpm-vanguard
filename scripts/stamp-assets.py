"""stamp-assets.py — 在 index.html 引用的本機檔案後面加上內容指紋（?v=xxxxxxxx）

  python scripts/stamp-assets.py

為什麼：網頁開著沒重新整理、或瀏覽器快取了舊的 app.js／lib/result.js 時，
新版的 index.html 會搭配舊版程式，造成像「分享時少了 Vanguard 版本」這種問題。
加上指紋後，檔案內容一變網址就變，瀏覽器一定會抓新的。部署前跑一次（重跑沒關係）。
"""
import hashlib
import re
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
INDEX = SITE / "index.html"

html = INDEX.read_text(encoding="utf-8")


def stamp(m):
    attr, path = m.group(1), m.group(2)
    f = SITE / path
    if not f.exists():
        return m.group(0)
    v = hashlib.sha256(f.read_bytes()).hexdigest()[:8]
    return f'{attr}="{path}?v={v}"'


# 只處理本機的 .js / .css（不動 Google Fonts、下載連結、圖片）
new = re.sub(r'(src|href)="((?:[\w\-/]+/)?[\w\-.]+\.(?:js|css))(?:\?v=[0-9a-f]+)?"', stamp, html)
INDEX.write_text(new, encoding="utf-8")
for m in re.finditer(r'(?:src|href)="([^"]+\?v=[0-9a-f]+)"', new):
    print(m.group(1))
