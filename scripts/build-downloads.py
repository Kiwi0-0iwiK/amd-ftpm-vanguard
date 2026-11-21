"""build-downloads.py — 從 .ps1 產生可以雙擊執行的 .bat，並算出兩個檔的 SHA-256

  python scripts/build-downloads.py

來源：site/downloads/check-amd-ftpm-vanguard.ps1（改腳本就改這個）
輸出：site/downloads/check-amd-ftpm-vanguard.bat
      site/data/downloads.js   window.DOWNLOADS = { ps1: {sha256, size}, bat: {...} }

.bat 是「cmd／PowerShell 雙語檔」：
  - cmd 看到第一行 `<# :` 會當成標籤略過，執行 @echo off 之後的幾行，
    叫 PowerShell 讀取這個檔案自己、當成腳本執行，最後 pause 讓視窗停住，再 exit /b。
  - PowerShell 讀到的內容裡，開頭那段 <# ... #> 只是區塊註解，後面就是原本的 .ps1。
所以只要一個檔，雙擊就會跑，不用開終端機。
注意：.bat 必須是「沒有 BOM 的 UTF-8」，否則第一行會被 cmd 讀錯；換行用 CRLF。
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DL = ROOT / "site" / "downloads"
PS1 = DL / "check-amd-ftpm-vanguard.ps1"
BAT = DL / "check-amd-ftpm-vanguard.bat"
OUT = ROOT / "site" / "data" / "downloads.js"

HEADER = (
    "<# : batch launcher (this block is ignored by PowerShell)\r\n"
    "@echo off\r\n"
    "title AMD fTPM / Vanguard check\r\n"
    "set \"FTPM_DIR=%~dp0\"\r\n"
    "set FTPM_FROM_BAT=1\r\n"
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"& ([ScriptBlock]::Create([IO.File]::ReadAllText('%~f0', [Text.Encoding]::UTF8))) %*\"\r\n"
    "echo.\r\n"
    "pause\r\n"
    "exit /b\r\n"
    "#>\r\n"
)

body = PS1.read_text(encoding="utf-8-sig")              # 去掉 .ps1 的 BOM
body = body.replace("\r\n", "\n").replace("\n", "\r\n")
BAT.write_bytes((HEADER + body).encode("utf-8"))         # 沒有 BOM

info = {}
for key, p in (("ps1", PS1), ("bat", BAT)):
    data = p.read_bytes()
    info[key] = {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}
OUT.write_text("window.DOWNLOADS = " + json.dumps(info) + ";\n", encoding="utf-8")
for k, v in info.items():
    print(f"{k}: {v['size']} bytes  sha256 {v['sha256']}")
