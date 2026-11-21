"""build-offline.py — 把 site/ 打包成一個可以雙擊開啟的 HTML（不需要網路）

  python scripts/build-offline.py

CSS、ECharts、資料、語言包、app.js 全部內嵌；截圖轉成 base64 放進 window.TIMELINE_IMAGES；
檢查腳本（.ps1、.bat）轉成 data: URL 放進 window.TIMELINE_FILES（下載按鈕用）；
Google Fonts 那段拿掉（改用系統字型）。
輸出：dist/wifi-8922ae-timeline.html
"""
import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
OUT = ROOT / "dist" / "wifi-8922ae-timeline.html"


def js(path: Path) -> str:
    # 內嵌的程式碼裡不能出現 </script，否則 HTML 解析會提早結束
    return path.read_text(encoding="utf-8").replace("</script", "<\\/script")


html = (SITE / "index.html").read_text(encoding="utf-8")
html = re.sub(r"\s*<!-- FONTS:BEGIN -->.*?<!-- FONTS:END -->", "", html, flags=re.S)
html = re.sub(r'(src|href)="([^"]+?)\?v=[0-9a-f]+"', lambda m: f'{m.group(1)}="{m.group(2)}"', html)   # 拿掉 stamp-assets.py 加的指紋
html = html.replace('<link rel="stylesheet" href="style.css">',
                    "<style>\n" + (SITE / "style.css").read_text(encoding="utf-8") + "</style>")

images = {p.stem: "data:image/webp;base64," + base64.b64encode(p.read_bytes()).decode()
          for p in sorted((SITE / "img").glob("*.webp"))}
files = {ext: "data:application/octet-stream;base64," +
         base64.b64encode((SITE / "downloads" / f"check-amd-ftpm-vanguard.{ext}").read_bytes()).decode()
         for ext in ("ps1", "bat")}

srcs = re.findall(r'<script src="([^"]+)"></script>', html)
for src in srcs:
    body = js(SITE / src)
    if src == "app.js":
        body = ("window.TIMELINE_IMAGES = " + json.dumps(images) + ";\n"
                "window.TIMELINE_FILES = " + json.dumps(files) + ";\n" + body)
    # 用 lambda 避免 body 裡的反斜線被 re 當成跳脫字元
    html = re.sub(r'<script src="' + re.escape(src) + r'"></script>', lambda _m, b=body: "<script>\n" + b + "\n</script>", html, count=1)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8")
print(f"-> {OUT}  ({OUT.stat().st_size / 1024 / 1024:.2f} MB, {len(images)} images, {len(srcs)} scripts inlined)")
