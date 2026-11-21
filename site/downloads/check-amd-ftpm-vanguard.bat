<# : batch launcher (this block is ignored by PowerShell)
@echo off
title AMD fTPM / Vanguard check
set "FTPM_DIR=%~dp0"
set FTPM_FROM_BAT=1
powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([ScriptBlock]::Create([IO.File]::ReadAllText('%~f0', [Text.Encoding]::UTF8))) %*"
echo.
pause
exit /b
#>
# check-amd-ftpm-vanguard.ps1
# Read-only check (result format v2): does Riot Vanguard (VALORANT / League of Legends / TFT / 2XKO) make the AMD firmware TPM (fTPM) fail on this PC?
# 唯讀檢查：Riot Vanguard（特戰英豪／英雄聯盟）是否讓這台電腦的 AMD fTPM 出錯？
#
# What it looks for / 檢查內容:
#   - Vanguard kernel driver loads (System log, FilterManager event 6, DeviceName = vgk)
#   - TPM event 17 ("The TPM hardware failed to execute a TPM command") shortly after each load
#     (on the reporter's PC: ~108-123 s after vgk loads, TPM2_GetCapability, response 0xC000000D)
#   - Other error/warning events within 3 s of each TPM failure (other hardware that may break at the same moment)
#   - Whether the TPM still works right now
#
# It changes no settings and sends nothing anywhere. The only thing it writes is one result file,
# ftpm-check-result.txt, next to this script. Neither the screen output nor the file contains your
# computer name or user name. You can drop the file on https://amd-ftpm-vanguard.pages.dev to see charts.
# 不會改任何設定、不會上傳任何資料。唯一會寫的是放在腳本旁邊的結果檔 ftpm-check-result.txt。
# 畫面輸出和結果檔都不含電腦名稱和使用者名稱。可以把結果檔拖到上面的網站看圖表。
#
# Usage / 用法（不需要系統管理員身分 / administrator is not required）:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\check-amd-ftpm-vanguard.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\check-amd-ftpm-vanguard.ps1 -Days 60

param([int]$Days = 30)

# 腳本版本：改了判定或輸出就更新日期（結果檔的格式版本 v 只有在 JSON 結構改變時才升）
$ScriptVersion = '2026.11.22'

$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$since = (Get-Date).AddDays(-$Days)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

function Write-Section([string]$t) { Write-Host ''; Write-Host "=== $t ===" -ForegroundColor Cyan }
function Data($e, [string]$name) { (([xml]$e.ToXml()).Event.EventData.Data | Where-Object { $_.Name -eq $name }).'#text' }

# ---------------------------------------------------------------- system
# TBS（TPM Base Services）：一般使用者也能送的 TPM 指令，不需要系統管理員
Add-Type -Namespace ChkTpm -Name Tbs -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct CTX { public uint version; public uint flags; }
[DllImport("tbs.dll")] public static extern uint Tbsi_Context_Create(ref CTX p, out IntPtr h);
[DllImport("tbs.dll")] public static extern uint Tbsip_Submit_Command(IntPtr h, uint loc, uint pri, byte[] cmd, uint cmdLen, byte[] res, ref uint resLen);
[DllImport("tbs.dll")] public static extern uint Tbsip_Context_Close(IntPtr h);
'@
function Invoke-TpmCommand([byte[]]$cmd) {
    $ctx = New-Object ChkTpm.Tbs+CTX; $ctx.version = 2; $ctx.flags = 4; $h = [IntPtr]::Zero
    $rc = [ChkTpm.Tbs]::Tbsi_Context_Create([ref]$ctx, [ref]$h)
    if ($rc -ne 0) { return @{ open = $false; rc = $rc } }
    $buf = New-Object byte[] 512; [uint32]$len = 512
    $rc2 = [ChkTpm.Tbs]::Tbsip_Submit_Command($h, 0, 200, $cmd, $cmd.Length, $buf, [ref]$len)
    [void][ChkTpm.Tbs]::Tbsip_Context_Close($h)
    @{ open = $true; rc = $rc2; buf = $buf; len = $len }
}
function Get-U32([byte[]]$b, [int]$o) { ([uint32]$b[$o] -shl 24) -bor ([uint32]$b[$o + 1] -shl 16) -bor ([uint32]$b[$o + 2] -shl 8) -bor [uint32]$b[$o + 3] }
# TPM2_GetCapability(TPM_CAP_TPM_PROPERTIES, TPM_PT_MANUFACTURER 0x105, 8 項) → 製造商與韌體版本
function Get-TpmInfoTbs {
    $r = Invoke-TpmCommand ([byte[]](0x80, 0x01, 0, 0, 0, 0x16, 0, 0, 0x01, 0x7A, 0, 0, 0, 0x06, 0, 0, 0x01, 0x05, 0, 0, 0, 0x08))
    if (-not $r.open -or $r.rc -ne 0 -or $r.len -lt 19 -or (Get-U32 $r.buf 6) -ne 0) { return $null }
    $p = @{}
    $n = Get-U32 $r.buf 15
    for ($i = 0; $i -lt $n -and (19 + 8 * $i + 8) -le $r.len; $i++) { $o = 19 + 8 * $i; $p[[int](Get-U32 $r.buf $o)] = [uint32](Get-U32 $r.buf ($o + 4)) }
    if (-not $p.ContainsKey(0x105)) { return $null }
    $mf = (-join ([BitConverter]::GetBytes([uint32]$p[0x105])[3..0] | ForEach-Object { [char]$_ })) -replace '[^\x21-\x7e]', ''
    $ver = if ($p.ContainsKey(0x10B) -and $p.ContainsKey(0x10C)) { '{0}.{1}.{2}.{3}' -f ($p[0x10B] -shr 16), ($p[0x10B] -band 0xFFFF), ($p[0x10C] -shr 16), ($p[0x10C] -band 0xFFFF) } else { '' }
    @{ mf = $mf; ver = $ver }
}

# ---------------------------------------------------------------- system
Write-Section ('System / 系統   (script {0})' -f $ScriptVersion)
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name.Trim()
$board = Get-CimInstance Win32_BaseBoard
$bios = Get-CimInstance Win32_BIOS
$os = Get-CimInstance Win32_OperatingSystem
# TPM 製造商與版本：先用 WMI（要系統管理員），讀不到就改用 TBS（一般使用者也可以）
$tpmMf = $null; $tpmVer = $null; $tpmSrc = $null
$tpm = Get-CimInstance -Namespace root/cimv2/security/microsofttpm -ClassName Win32_Tpm
if ($tpm) { $tpmMf = "$($tpm.ManufacturerIdTxt)".Trim(); $tpmVer = "$($tpm.ManufacturerVersion)".Trim(); $tpmSrc = 'wmi' }
else { $ti = Get-TpmInfoTbs; if ($ti) { $tpmMf = $ti.mf; $tpmVer = $ti.ver; $tpmSrc = 'tbs' } }
Write-Host ("  CPU        : {0}" -f $cpu)
Write-Host ("  Board/BIOS : {0} {1} / {2}" -f $board.Manufacturer, $board.Product, $bios.SMBIOSBIOSVersion)
Write-Host ("  Windows    : {0} build {1}" -f $os.Caption, $os.BuildNumber)
if ($tpmMf) { Write-Host ("  TPM        : {0} {1}" -f $tpmMf, $tpmVer) }
else { Write-Host '  TPM        : unknown (could not read) / 讀不到 TPM 資訊' -ForegroundColor Yellow }
$vg = Get-Service vgk
Write-Host ("  Vanguard   : {0}" -f $(if ($vg) { 'installed / 已安裝' } else { 'not installed / 沒有安裝' }))
$amd = $cpu -match 'AMD'
# 讀不到 TPM 資訊時是「不知道」，不是「沒有 fTPM」
$ftpm = if ($tpmMf) { [bool]($tpmMf -match 'AMD') } else { $null }
if (-not $amd) { Write-Host '  Note: not an AMD CPU. This check is meant for AMD fTPM. / 不是 AMD CPU，這個檢查主要針對 AMD fTPM。' -ForegroundColor Yellow }

# ---------------------------------------------------------------- events
Write-Section "Event log, last $Days days / 事件紀錄（最近 $Days 天）"
$loads = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-FilterManager'; Id = 6; StartTime = $since } |
    Where-Object { (Data $_ 'DeviceName') -eq 'vgk' } | Sort-Object TimeCreated)
$unloads = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-FilterManager'; Id = 1; StartTime = $since } |
    Where-Object { (Data $_ 'DeviceName') -eq 'vgk' } | Sort-Object TimeCreated)
$tpm17 = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'TPM'; Id = 17; StartTime = $since } | Sort-Object TimeCreated)
$tpm14 = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'TPM'; Id = 14, 15; StartTime = $since })
Write-Host ("  Vanguard (vgk) loads / Vanguard 載入次數        : {0}" -f $loads.Count)
Write-Host ("  TPM event 17 (command failed) / TPM 指令失敗    : {0}" -f $tpm17.Count)
Write-Host ("  TPM event 14/15 (non-recoverable) / 無法復原錯誤 : {0}" -f $tpm14.Count)
$ordMap = [ordered]@{}
if ($tpm17.Count) {
    $ords = $tpm17 | Group-Object { '{0} (0x{1:X})' -f (Data $_ 'TpmCommandOrdinal'), [int](Data $_ 'TpmCommandOrdinal') } | Sort-Object Count -Descending
    Write-Host ('  Failed command(s) / 失敗的指令 : ' + (($ords | ForEach-Object { "$($_.Name) x$($_.Count)" }) -join ', ') + '   (378 = 0x17A = TPM2_GetCapability)')
    $tpm17 | Group-Object { [string](Data $_ 'TpmCommandOrdinal') } | ForEach-Object { $ordMap[$_.Name] = $_.Count }
}

# ---------------------------------------------------------------- per Vanguard session
# 不假設固定秒數：每次載入後，到 vgk 卸載為止（最多 30 分鐘），找第一個 TPM 事件 17。
# 不同電腦出錯的時間點可能不同（有的約 110 秒，有的 100～160 秒），結果會列出這台的分布。
$WINDOW = 1800
Write-Section 'Each Vanguard load / 每次 Vanguard 載入'
$sessions = @(); $records = New-Object System.Collections.Generic.List[object]; $windows = @(); $eligible = 0
for ($i = 0; $i -lt $loads.Count; $i++) {
    $L = $loads[$i].TimeCreated
    # vgk 的建置時間（FilterManager 事件 6 的 DeviceTime），用來分辨是哪一版 Vanguard
    $build = ([string](Data $loads[$i] 'DeviceTime')) -replace '\.\d+Z$', 'Z'
    $next = if ($i + 1 -lt $loads.Count) { $loads[$i + 1].TimeCreated } else { $null }
    $u = $unloads | Where-Object { $_.TimeCreated -gt $L -and ($null -eq $next -or $_.TimeCreated -le $next) } | Select-Object -First 1
    $end = if ($u) { $u.TimeCreated } elseif ($next) { $next } else { Get-Date }
    if ($next -and ($next - $L).TotalSeconds -lt 60 -and -not $u) { continue }   # 遊戲啟動時的快速重載，算下一次
    $winEnd = if (($end - $L).TotalSeconds -gt $WINDOW) { $L.AddSeconds($WINDOW) } else { $end }
    $windows += , @($L, $winEnd)
    $dur = [math]::Round(($end - $L).TotalSeconds)
    $f = $tpm17 | Where-Object { $_.TimeCreated -ge $L -and $_.TimeCreated -lt $winEnd } | Select-Object -First 1
    if ($f) {
        $sec = ($f.TimeCreated - $L).TotalSeconds
        $eligible++
        $near = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Level = 1, 2, 3; StartTime = $f.TimeCreated.AddSeconds(-3); EndTime = $f.TimeCreated.AddSeconds(3) } |
            Where-Object { $_.ProviderName -ne 'TPM' } | Group-Object ProviderName, Id | ForEach-Object { "$($_.Name)" })
        $nearTxt = if ($near) { '  others: ' + ($near -join '; ') } else { '' }
        Write-Host ("  {0:yyyy-MM-dd HH:mm:ss}  TPM failed +{1,6:N1}s{2}" -f $L, $sec, $nearTxt) -ForegroundColor Yellow
        $sessions += $sec
        $records.Add([ordered]@{ t = $L.ToString('yyyy-MM-dd HH:mm'); off = [math]::Round($sec, 1); dur = $dur; ended = [bool]$u; vgk = $build; others = [string[]]$near })
    } else {
        if ($dur -ge 600) { $eligible++ }   # 開了 10 分鐘以上都沒出錯，才算「確定沒出錯」
        $note = if ($dur -lt 600) { "(closed after {0:N0}s, too short to tell / {0:N0} 秒就關了，太短無法判斷)" -f $dur } else { "no TPM failure ({0:N0} min) / 沒有 TPM 錯誤（{0:N0} 分鐘）" -f ($dur / 60) }
        Write-Host ("  {0:yyyy-MM-dd HH:mm:ss}  {1}" -f $L, $note) -ForegroundColor DarkGray
        $records.Add([ordered]@{ t = $L.ToString('yyyy-MM-dd HH:mm'); off = $null; dur = $dur; ended = [bool]$u; vgk = $build; others = [string[]]@() })
    }
}
if (-not $loads.Count) { Write-Host '  (no Vanguard loads in this period / 這段期間沒有 Vanguard 載入紀錄)' -ForegroundColor DarkGray }

# 依 Vanguard 版本：能判斷的場次裡有幾場出錯（能判斷＝有出錯，或開了 10 分鐘以上）
if ($records.Count) {
    Write-Host ''
    Write-Host '  By Vanguard build / 依 Vanguard 版本（vgk build time, UTC）:'
    $records | Where-Object { $null -ne $_.off -or $_.dur -ge 600 } | Group-Object { $_.vgk } | Sort-Object Name | ForEach-Object {
        $nf = @($_.Group | Where-Object { $null -ne $_.off }).Count
        Write-Host ('    {0}  failed {1} / {2}' -f $(if ($_.Name) { $_.Name } else { 'unknown' }), $nf, $_.Count) -ForegroundColor $(if ($nf) { 'Yellow' } else { 'Green' })
    }
}

# 不在任何一次「載入後 30 分鐘內」的 TPM 錯誤（例如 TPM 卡住期間 Windows 自己的 TPM 工作也跟著失敗）
$other = @($tpm17 | Where-Object { $t = $_.TimeCreated; -not ($windows | Where-Object { $t -ge $_[0] -and $t -lt $_[1] }) } |
    Group-Object { $_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss') })
if ($other.Count) {
    Write-Host ''
    Write-Host ("  TPM failures outside a Vanguard start (TPM may have stayed broken until reboot): {0} times" -f $other.Count) -ForegroundColor Yellow
    Write-Host ('  不在 Vanguard 啟動時的 TPM 錯誤（TPM 可能一直壞到重開機）：{0} 次' -f $other.Count) -ForegroundColor Yellow
}

# ---------------------------------------------------------------- TPM right now
Write-Section 'TPM right now / TPM 目前狀態'
$tpmNow = 'unknown'
$r = Invoke-TpmCommand ([byte[]](0x80, 0x01, 0, 0, 0, 0x0C, 0, 0, 0x01, 0x7B, 0, 8))   # TPM2_GetRandom(8), harmless
if (-not $r.open) { Write-Host ("  Cannot open TPM (0x{0:X}) / 無法連到 TPM" -f $r.rc) -ForegroundColor Yellow; $tpmNow = ('noopen 0x{0:X}' -f $r.rc) }
elseif ($r.rc -eq 0) { Write-Host '  TPM answers commands normally / TPM 目前正常回應' -ForegroundColor Green; $tpmNow = 'ok' }
else { Write-Host ("  TPM does NOT answer (0x{0:X}) - broken until reboot? / TPM 沒有回應，可能要重開機才會恢復" -f $r.rc) -ForegroundColor Red; $tpmNow = ('fail 0x{0:X}' -f $r.rc) }

# ---------------------------------------------------------------- verdict
# 符合：至少 2 場「載入後出錯」，而且佔「能判斷的場次」一半以上（能判斷＝有出錯，或開了 10 分鐘以上）
Write-Section 'Result / 結果'
$verdict = 'NODATA'
$fails = $sessions.Count
if ($fails) {
    $sorted = @($sessions | Sort-Object)
    $med = $sorted[[int][math]::Floor(($sorted.Count - 1) / 2)]
    $timing = '{0:N0}-{1:N0} s, median {2:N0} s' -f $sorted[0], $sorted[-1], $med
}
if ($fails -ge 2 -and $eligible -gt 0 -and ($fails / $eligible) -ge 0.5) {
    $verdict = 'MATCH'
    Write-Host ("  MATCH: in {0} of {1} Vanguard sessions the TPM failed after vgk loaded ({2})." -f $fails, $eligible, $timing) -ForegroundColor Red
    Write-Host ("  符合：{0} 場裡有 {1} 場在 Vanguard 載入後 TPM 指令失敗（這台的時間：{2}）。" -f $eligible, $fails, $timing) -ForegroundColor Red
    Write-Host  '  Check what else broke at those moments (the "others" column above), e.g. Wi-Fi, Windows Hello, BitLocker.'
    Write-Host  '  看看上面「others」欄位，同一時間還有什麼東西出錯（例如 WiFi、Windows Hello、BitLocker）。'
} elseif ($fails -ge 1) {
    $verdict = 'POSSIBLE'
    Write-Host ("  POSSIBLE: TPM failed after {0} of {1} Vanguard sessions ({2}); not consistent enough to be sure. / 可能符合：{1} 場裡有 {0} 場出錯，還不夠一致。" -f $fails, $eligible, $timing) -ForegroundColor Yellow
} elseif ($eligible -ge 2) {
    $verdict = 'NOMATCH'
    Write-Host '  NO MATCH: Vanguard loaded, but the TPM did not fail afterwards. / 不符合：Vanguard 有載入，但 TPM 沒有出錯。' -ForegroundColor Green
} else {
    Write-Host '  NOT ENOUGH DATA: launch a Riot game that uses Vanguard (VALORANT, League of Legends, TFT, 2XKO), keep it open for 10 minutes, then run this again.' -ForegroundColor DarkGray
    Write-Host '  資料不足：開一款用 Vanguard 的 Riot 遊戲（特戰英豪、英雄聯盟、聯盟戰棋、2XKO），開著 10 分鐘後再執行一次。' -ForegroundColor DarkGray
}

# ---------------------------------------------------------------- result file
# 匿名代碼：由主機板與 CPU 的硬體識別碼加上固定字串算 SHA-256，只取前 16 碼。
# 無法反推硬體序號，只用來讓同一台電腦重複分享時覆蓋舊資料，不會重複計算。
$prod = Get-CimInstance Win32_ComputerSystemProduct
$seed = 'amd-ftpm-vanguard|' + $prod.UUID + '|' + $board.SerialNumber + '|' + (Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId
$sha = [Security.Cryptography.SHA256]::Create()
$anonId = (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($seed)) | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 16)

$result = [ordered]@{
    v        = 2
    sv       = $ScriptVersion
    id       = $anonId
    created  = (Get-Date).ToString('yyyy-MM-dd')
    days     = $Days
    admin    = [bool]$isAdmin
    cpu      = $cpu
    board    = ('{0} {1}' -f $board.Manufacturer, $board.Product).Trim()
    bios     = "$($bios.SMBIOSBIOSVersion)"
    biosDate = $(if ($bios.ReleaseDate) { $bios.ReleaseDate.ToString('yyyy-MM-dd') } else { $null })
    os       = ('{0} build {1}' -f $os.Caption, $os.BuildNumber)
    tpm      = $(if ($tpmMf) { ('{0} {1}' -f $tpmMf, $tpmVer).Trim() } else { $null })
    tpmSrc   = $tpmSrc
    amd      = [bool]$amd
    ftpm     = $ftpm
    eligible = $eligible
    vanguard = [bool]$vg
    loads    = $loads.Count
    tpm17    = $tpm17.Count
    tpm14    = $tpm14.Count
    ordinals = $ordMap
    outside  = $other.Count
    tpmNow   = $tpmNow
    verdict  = $verdict
    sessions = $records.ToArray()
}
$json = $result | ConvertTo-Json -Depth 5

$outDir = if ($env:FTPM_DIR) { $env:FTPM_DIR } elseif ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$outFile = Join-Path $outDir 'ftpm-check-result.txt'
$text = @"
AMD fTPM / Vanguard check result
Created: $($result.created)   Script: $ScriptVersion   Verdict: $verdict   Vanguard loads: $($loads.Count)   TPM failures after load: $($sessions.Count)

To see charts of this result, open https://amd-ftpm-vanguard.pages.dev and drop this file on the page.
Nothing is uploaded unless you press "Share anonymously" there.
想看圖表：打開 https://amd-ftpm-vanguard.pages.dev ，把這個檔案拖進網頁。除非你在網頁上按「匿名分享」，否則不會上傳。

-----BEGIN FTPM-CHECK-----
$json
-----END FTPM-CHECK-----
"@
try {
    [IO.File]::WriteAllText($outFile, $text, (New-Object Text.UTF8Encoding($false)))
    Write-Section 'Result file / 結果檔'
    Write-Host ("  Saved / 已儲存：{0}" -f $outFile) -ForegroundColor Green
    Write-Host  '  Drop it on https://amd-ftpm-vanguard.pages.dev to see charts. / 拖到網站上就能看圖表。'
    if ($env:FTPM_FROM_BAT) { Start-Process explorer.exe -ArgumentList ('/select,"{0}"' -f $outFile) }
} catch {
    Write-Host ("  Could not save the result file / 無法儲存結果檔：{0}" -f $_.Exception.Message) -ForegroundColor Yellow
}
Write-Host ''
