"""prepare-images.py — 把調查截圖裁切、遮蔽個資、壓成 WebP，放到 site/img/

來源：
  data/raw/screenshots/   ← 桌面 Riot Logs\\Screenshots-2026-11-10.zip 解開的 6 張
  環境變數 FTPM_BIOS_SHOTS 指向更新前的 BIOS 截圖資料夾（選用，沒設就略過那張）

遮蔽：電腦名稱、使用者帳號（msinfo32）；事件檢視器的 Computer 欄位直接裁掉。
需要 Pillow：pip install --user pillow
"""
import os
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "screenshots"
BIOS = Path(os.environ.get("FTPM_BIOS_SHOTS", "")) if os.environ.get("FTPM_BIOS_SHOTS") else None
OUT = ROOT / "site" / "img"
OUT.mkdir(parents=True, exist_ok=True)

MASK = (60, 60, 60)

# (來源, 輸出名, 裁切框 (l, t, r, b) 或 None, 要遮的框（原圖座標）)
JOBS = [
    (RAW / "1_msinfo32_system_summary.png", "msinfo32", (810, 55, 1830, 1005),
     [(1345, 166, 1820, 187), (1345, 607, 1820, 628)]),
    (RAW / "2_tpm_msc_before_reproduction.png", "tpm-before", (0, 0, 2080, 440), []),
    (RAW / "3_tpm_msc_after_reproduction.png", "tpm-after", (0, 0, 2080, 440), []),
    (RAW / "4_event_viewer_TPM_events_10-53-04.png", "eventviewer-tpm", (200, 75, 2080, 1085), []),
    (RAW / "5_event17_details_10-53-04.png", "event17-details", (200, 75, 2080, 860), []),
    (RAW / "6_tpm_msc_failed_0x80284002_before_reboot.png", "tpm-failed", None, []),
    *([(BIOS / "261107001139.png", "bios-1681", None, [])] if BIOS else []),
]

MAX_W = 1600

for src, name, crop, masks in JOBS:
    if not src.exists():
        print(f"skip {name}: {src} not found")
        continue
    im = Image.open(src).convert("RGB")
    d = ImageDraw.Draw(im)
    for box in masks:
        d.rectangle(box, fill=MASK)
    if crop:
        im = im.crop(crop)
    if im.width > MAX_W:
        im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
    out = OUT / f"{name}.webp"
    im.save(out, "WEBP", quality=82, method=6)
    print(f"{out.name:28} {im.size[0]}x{im.size[1]}  {out.stat().st_size // 1024} KB")
