"""build-data.py — 合併事件匯出檔、guard 紀錄、人工整理的里程碑，輸出 site/data/timeline.js

  python scripts/build-data.py

輸入：
  data/raw/events-*.json          export-events.ps1 的輸出（可以有很多份，會去重）
  data/milestones.json            調查歷程（人工整理）
  倒數提示視窗的紀錄（選用）：環境變數 FTPM_GUARD_LOG 指向 log.txt，沒設就略過
輸出：
  site/data/timeline.js           window.TIMELINE = {...}（用 .js 而不是 .json，雙擊開 HTML 也讀得到）

時間一律換成「台北牆上時間當作 UTC」的毫秒數，網頁用 useUTC 顯示，
這樣不管在哪個時區打開，看到的都是台北時間。
去識別化：SSID 只保留類別（手機熱點／CJ／其他），不輸出電腦名稱、帳號、介面 GUID。
"""
import glob
import os
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUARD_LOG = Path(os.environ.get("FTPM_GUARD_LOG", "")) if os.environ.get("FTPM_GUARD_LOG") else None
OUT = ROOT / "site" / "data" / "timeline.js"


def ms(s: str) -> int:
    """ISO 字串（可帶時區）→ 台北牆上時間當 UTC 的毫秒數。"""
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)  # 匯出時就是 +08:00，直接取牆上時間
    return int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000)


def us(s: str) -> float:
    """同上，但回傳微秒，精確到 0.1 微秒（事件記錄的精度是 100 奈秒；舊的匯出檔只有毫秒）。
    fromisoformat 只吃到微秒，所以小數部分自己解析。"""
    m = re.match(r"(.*?\d\d:\d\d:\d\d)(?:\.(\d+))?(.*)$", s)
    whole = datetime.fromisoformat(m.group(1) + m.group(3)).replace(tzinfo=None)
    frac = (m.group(2) or "").ljust(7, "0")[:7]
    sec = int(whole.replace(tzinfo=timezone.utc).timestamp())
    return sec * 1_000_000 + int(frac) / 10


def ssid_kind(ssid: str) -> str:
    s = ssid or ""
    if "iPhone" in s:
        return "手機熱點"
    if s.strip() == "CJ":
        return "CJ（DIR-619L）"
    return "其他網路" if s else "未知"


# ---------- 讀取並合併事件 ----------
events = {}
meta = {"systemLogOldest": None, "wlanLogOldest": None, "exported": None}
for f in sorted(glob.glob(str(ROOT / "data" / "raw" / "events-*.json"))):
    d = json.load(open(f, encoding="utf-8-sig"))
    for k in ("systemLogOldest", "wlanLogOldest"):
        v = ms(d[k])
        meta[k] = v if meta[k] is None else min(meta[k], v)
    meta["exported"] = max(meta["exported"] or 0, ms(d["exported"]))
    for e in d["events"]:
        log = "wlan" if e["kind"] == "wlan" else "system"
        events[(log, e["record"])] = e

ev = sorted(events.values(), key=lambda e: e["t"])
for e in ev:
    e["ms"] = ms(e["t"])


def of(kind, ids=None):
    return [e for e in ev if e["kind"] == kind and (ids is None or e["id"] in ids)]


loads = of("vgk_load")
unloads = of("vgk_unload")
tpm = of("tpm")
wifi = of("wifi_fail")
wlan = of("wlan")
boots = of("boot", {12})
shutdowns = of("boot", {13})
crash = of("boot", {41})
tpm_clear = of("tpm_wmi", {519})


def cluster(items, gap_ms):
    out = []
    for e in items:
        if out and e["ms"] - out[-1][-1]["ms"] <= gap_ms:
            out[-1].append(e)
        else:
            out.append([e])
    return out


tpm_bursts = []
for c in cluster(tpm, 3000):
    tpm_bursts.append({
        "start": c[0]["ms"], "end": c[-1]["ms"], "n": len(c),
        "has17": any(e["id"] == 17 for e in c),
        "ids": sorted({e["id"] for e in c}),
        "ordinal": next((e["data"].get("TpmCommandOrdinal") for e in c if e["id"] == 17), None),
    })

wifi_fails = [{"start": c[0]["ms"], "end": c[-1]["ms"], "n": len(c)} for c in cluster(wifi, 120000)]
boot_ms = [b["ms"] for b in boots]


def last_boot_before(t):
    prev = [b for b in boot_ms if b <= t]
    return prev[-1] if prev else None


# ---------- WLAN 連線區間 ----------
wlan_conn = []   # 連到外部網路
cur = None
for e in wlan:
    if e["id"] == 8001:
        if cur:
            cur["end"] = e["ms"]
            wlan_conn.append(cur)
        cur = {"start": e["ms"], "end": None, "net": ssid_kind(e["data"].get("SSID", ""))}
    elif e["id"] == 8003 and cur:
        cur["end"] = e["ms"]
        wlan_conn.append(cur)
        cur = None
if cur:
    cur["end"] = None
    wlan_conn.append(cur)

ap = []          # Windows 行動熱點（AP 模式）
cur = None
for e in wlan:
    if e["id"] in (8005, 8006) and cur is None:
        cur = {"start": e["ms"], "end": None}
    elif e["id"] == 8008 and cur:
        cur["end"] = e["ms"]
        ap.append(cur)
        cur = None

wlan_fail = [{"t": e["ms"], "net": ssid_kind(e["data"].get("SSID", ""))} for e in wlan if e["id"] == 8002]


def wifi_state(t):
    if meta["wlanLogOldest"] and t < meta["wlanLogOldest"]:
        return "unknown"
    b = last_boot_before(t)
    if any(b is not None and b <= w["start"] < t for w in wifi_fails):
        return "dead"
    if any(a["start"] <= t and (a["end"] is None or t <= a["end"]) for a in ap):
        return "ap"
    for c in wlan_conn:
        if c["start"] <= t and (c["end"] is None or t <= c["end"]):
            return "connected"
    return "disconnected"


# ---------- 每次 vgk 載入的「場次」 ----------
sessions = []
for i, L in enumerate(loads):
    t0 = L["ms"]
    nxt = loads[i + 1]["ms"] if i + 1 < len(loads) else None
    U = next((u["ms"] for u in unloads if u["ms"] > t0 and (nxt is None or u["ms"] <= nxt)), None)
    end = U or nxt or meta["exported"]
    b = next((x for x in tpm_bursts if x["has17"] and t0 < x["start"] <= end), None)
    s = {"load": t0, "unload": U, "tpm": None, "offset": None, "state": None, "outcome": "no_tpm", "wifi": None}
    if b:
        s["tpm"] = b["start"]
        s["offset"] = round((b["start"] - t0) / 1000, 1)
        # 「網卡本來就壞了」看遊戲開始前；連線狀態看 TPM 出錯前一刻
        # （熱點通常是 vgk 載入後才連上；網卡錯誤可能比 TPM 早不到 1 秒，所以往前抓 5 秒）
        s["state"] = "dead" if wifi_state(t0) == "dead" else wifi_state(b["start"] - 5000)
        w = next((w for w in wifi_fails if t0 <= w["start"] <= b["start"] + 120000), None)
        if w:
            s["outcome"] = "broke"
            s["wifi"] = w["start"]
            if w["start"] < b["start"] - 5000:  # 網卡比 TPM 錯誤早很多就掛了（11/6 22:39 那次）
                s["state"] = wifi_state(w["start"] - 5000)
            s["lag"] = round((w["start"] - b["start"]) / 1000, 3)
        elif s["state"] == "dead":
            s["outcome"] = "already_down"
        else:
            s["outcome"] = "survived"
    sessions.append(s)

# 事件記錄看不出來的實驗條件（例如停用裝置），用 milestones.json 的 sessionNotes 補上
ms_raw = json.load(open(ROOT / "data" / "milestones.json", encoding="utf-8"))
notes = {ms(k): (k, v) for k, v in ms_raw.get("sessionNotes", {}).items()}
for s in sessions:
    n = notes.get(s["load"] // 1000 * 1000)
    if n:
        s.update(n[1])
        s["noteKey"] = n[0]  # 網頁翻譯用的 key

session_tpm = {s["tpm"] for s in sessions if s["tpm"]}
for x in tpm_bursts:
    x["inSession"] = x["start"] in session_tpm

# ---------- guard 紀錄 ----------
guard = []
if GUARD_LOG and GUARD_LOG.exists():
    for line in GUARD_LOG.read_text(encoding="utf-8-sig").splitlines():
        m = re.match(r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\s+(.*)", line)
        if not m:
            continue
        text = re.sub(r"WiFi 已連線（[^）]*）", "WiFi 已連線（手機熱點）", m.group(2))
        guard.append({"t": ms(m.group(1).replace(" ", "T")), "text": text})

# ---------- 毫秒放大：每次網卡掛掉前後的原始事件 ----------
zooms = []
for s in sessions:
    if s["outcome"] != "broke" or not s.get("wifi"):
        continue
    a, z = min(s["tpm"], s["wifi"]) - 3000, max(s["tpm"], s["wifi"]) + 3000
    win = [e for e in ev if a <= e["ms"] <= z and e["kind"] in ("tpm", "wifi_fail")]
    base = min(us(e["t"]) for e in win if e["kind"] == "tpm")
    zooms.append({
        "load": s["load"], "tpm": s["tpm"], "wifi": s["wifi"],
        # dt：相對第一筆 TPM 事件的微秒數
        "events": [{"dt": round(us(e["t"]) - base, 1), "k": e["kind"], "id": e["id"], "t": e["ms"]} for e in win],
    })

# ---------- 里程碑 ----------
ms_data = json.load(open(ROOT / "data" / "milestones.json", encoding="utf-8"))
for m in ms_data["milestones"]:
    m["ms"] = ms(m["t"] if "T" in m["t"] else m["t"] + "T12:00")
    if "zoom" in m:
        m["zoom"] = ms(m["zoom"])
for p in ms_data["phases"]:
    p["startMs"] = ms(p["start"] if "T" in p["start"] else p["start"] + "T00:00")
    p["endMs"] = ms(p["end"] if "T" in p["end"] else p["end"] + "T23:59")

# ---------- 統計 ----------
with_tpm = [s for s in sessions if s["tpm"]]
offs = sorted(s["offset"] for s in with_tpm)
by = lambda k: [s for s in with_tpm if s["outcome"] == k]
conn = [s for s in with_tpm if s["state"] == "connected"]
idle = [s for s in with_tpm if s["state"] in ("disconnected", "ap", "off", "disabled")]
stats = {
    "loads": len(loads),
    "withTpm": len(with_tpm),
    "offsetMin": offs[0] if offs else None,
    "offsetMax": offs[-1] if offs else None,
    "offsetMedian": offs[len(offs) // 2] if offs else None,
    "offsetIn105_125": sum(1 for o in offs if 105 <= o <= 125),
    "broke": len(by("broke")),
    "survived": len(by("survived")),
    "alreadyDown": len(by("already_down")),
    "connectedSurvived": sum(1 for s in conn if s["outcome"] == "survived"),
    "connectedTotal": len(conn),
    "idleBroke": sum(1 for s in idle if s["outcome"] == "broke"),
    "idleTotal": len(idle),
    "wifiFailures": len(wifi_fails),
    "wifiFailuresInSession": sum(1 for s in sessions if s["outcome"] == "broke"),
    "tpmBursts": len(tpm_bursts),
    "tpmBurstsOutside": sum(1 for x in tpm_bursts if not x["inSession"]),
    "boots": len(boots),
    "lagMedian": (lambda L: L[len(L) // 2] if L else None)(sorted(s["lag"] for s in by("broke") if "lag" in s)),
}

data = {
    "meta": meta,
    "stats": stats,
    "sessions": sessions,
    "tpmBursts": tpm_bursts,
    "wifiFails": wifi_fails,
    "boots": boot_ms,
    "shutdowns": [e["ms"] for e in shutdowns],
    "crashes": [e["ms"] for e in crash],
    "tpmClear": [e["ms"] for e in tpm_clear],
    "wlanConn": wlan_conn,
    "wlanFail": wlan_fail,
    "ap": ap,
    "guard": guard,
    "zooms": zooms,
    **{k: ms_data[k] for k in ("phases", "milestones", "hypotheses", "workaround")},
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("window.TIMELINE = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
               encoding="utf-8")
print(json.dumps(stats, ensure_ascii=False, indent=1))
print(f"-> {OUT}  ({OUT.stat().st_size // 1024} KB)")
