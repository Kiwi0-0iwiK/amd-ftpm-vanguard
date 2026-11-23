"""make-og.py — 產生連結預覽圖 site/og.png（1200×630，Discord／LINE／Facebook 貼網址時顯示）

  python scripts/make-og.py

需要 Pillow，以及 Windows 內建的微軟正黑體（C:\\Windows\\Fonts\\msjh*.ttc）與 Segoe UI。
文字改了就重跑一次，再重新部署。
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "site" / "og.png"
FONTS = Path(r"C:\Windows\Fonts")
W, H = 1200, 630
BG, SURF, BORDER = (18, 18, 17), (32, 32, 30), (58, 58, 54)
TEXT, TEXT2, TEXT3 = (240, 239, 236), (195, 194, 183), (141, 140, 132)
ORANGE = (235, 104, 52)


def font(name, size, index=0):
    return ImageFont.truetype(str(FONTS / name), size, index=index)


bold = lambda s: font("msjhbd.ttc", s)
reg = lambda s: font("msjh.ttc", s)
latin = lambda s: font("segoeui.ttf", s)
latin_b = lambda s: font("segoeuib.ttf", s)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# 右上角的橘色光暈
glow = Image.new("RGB", (W, H), BG)
gd = ImageDraw.Draw(glow)
for i in range(60, 0, -1):
    r = i * 11
    c = tuple(int(BG[k] + (ORANGE[k] - BG[k]) * (0.22 * (1 - i / 60))) for k in range(3))
    gd.ellipse((1060 - r, -40 - r, 1060 + r, -40 + r), fill=c)
img = Image.blend(img, glow, 1.0)
d = ImageDraw.Draw(img)

X = 72
d.text((X, 64), "AMD 處理器 ＋ Riot 遊戲的玩家", font=bold(30), fill=ORANGE)


def runs(y, parts, size):
    x = X
    for text, color in parts:
        f = bold(size)
        d.text((x, y), text, font=f, fill=color)
        x += d.textlength(text, font=f)


runs(124, [("你電腦裡的", TEXT), ("安全晶片", ORANGE)], 84)
runs(226, [("可能正在出錯", TEXT)], 84)
d.text((X, 350), "反作弊啟動約 2 分鐘後，AMD 內建的 fTPM 會出錯，", font=reg(32), fill=TEXT2)
d.text((X, 396), "多數人完全不會發現。", font=reg(32), fill=TEXT2)

# 底部：按鈕樣式＋網址
by = 482
label = "1 分鐘檢查我的電腦  →"
f = bold(30)
tw = d.textlength(label, font=f)
d.rounded_rectangle((X, by, X + tw + 56, by + 64), radius=32, fill=TEXT)
d.text((X + 28, by + 12), label, font=f, fill=BG)
d.text((X + tw + 84, by + 16), "amd-ftpm-vanguard.pages.dev", font=latin(28), fill=TEXT3)

d.text((X, 572), "AMD fTPM × Riot Vanguard · check your PC in 1 minute", font=latin_b(22), fill=TEXT3)

# 右側：簡單的晶片圖示
cx, cy, s = 1000, 250, 150
d.rounded_rectangle((cx - s // 2, cy - s // 2, cx + s // 2, cy + s // 2), radius=22, fill=SURF, outline=ORANGE, width=5)
for k in range(5):
    o = -s // 2 + 20 + k * (s - 40) // 4
    for (x1, y1, x2, y2) in ((cx + o, cy - s // 2 - 22, cx + o, cy - s // 2), (cx + o, cy + s // 2, cx + o, cy + s // 2 + 22),
                             (cx - s // 2 - 22, cy + o, cx - s // 2, cy + o), (cx + s // 2, cy + o, cx + s // 2 + 22, cy + o)):
        d.line((x1, y1, x2, y2), fill=BORDER, width=6)
d.text((cx, cy - 8), "TPM", font=latin_b(42), fill=TEXT, anchor="mm")
for a, b in (((-13, 22), (13, 48)), ((13, 22), (-13, 48))):   # 用線畫 ✕（正黑體沒有這個字）
    d.line((cx + a[0], cy + a[1], cx + b[0], cy + b[1]), fill=ORANGE, width=7)

img.save(OUT, optimize=True)
print(f"-> {OUT} ({OUT.stat().st_size // 1024} KB)")
