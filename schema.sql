-- 匿名分享的檢查結果。一台電腦（匿名代碼 id）只留一筆，重新分享會覆蓋。
-- data 是伺服器驗證、去識別化後的 JSON（見 server/lib.js 的 normalize）。
CREATE TABLE IF NOT EXISTS results (
  id       TEXT PRIMARY KEY,
  updated  TEXT NOT NULL,
  verdict  TEXT NOT NULL,
  data     TEXT NOT NULL
);

-- 簡單的流量限制：同一個來源（IP 加鹽雜湊，不存原始 IP）每天最多幾次寫入。
CREATE TABLE IF NOT EXISTS rl (
  day  TEXT NOT NULL,
  iph  TEXT NOT NULL,
  n    INTEGER NOT NULL,
  PRIMARY KEY (day, iph)
);

-- 統計快取的版本號：每次分享／刪除就 +1，/api/stats 的快取 key 帶著它，舊快取自然失效
CREATE TABLE IF NOT EXISTS meta (
  k  TEXT PRIMARY KEY,
  v  INTEGER NOT NULL
);
INSERT OR IGNORE INTO meta (k, v) VALUES ('stats_version', 0);
