"""make-run-warning.py — 雙擊 .bat 時 Windows 跳出的「開啟檔案 - 安全性警告」截圖 → site/img/run-warning-*.webp

  python scripts/make-run-warning.py <英文截圖.png> <繁中截圖.png>

在「執行／Run」按鈕外面加一個橘色框，轉成 WebP。首頁「1 分鐘檢查」第 2 步用。
截圖裡只有下載路徑（D:\\Downloads\\...），沒有電腦名稱或帳號；換截圖時要再確認一次。
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "site" / "img"
ORANGE = (235, 104, 52)
# 「執行／Run」按鈕的位置（截圖是 100% 縮放、466×343 左右）
RUN_BOX = (250, 190, 345, 224)

for src, name in zip(sys.argv[1:3], ("run-warning-en", "run-warning-zh")):
    im = Image.open(src).convert("RGB")
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(RUN_BOX, radius=8, outline=ORANGE, width=3)
    out = OUT / f"{name}.webp"
    im.save(out, "WEBP", quality=90, method=6)
    print(f"-> {out} {im.size} {out.stat().st_size // 1024} KB")
