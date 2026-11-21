# export-events.ps1 — 把 WiFi 8922AE 調查相關的 Windows 事件匯出成 JSON（唯讀，不改系統）
#
# 用法：powershell -ExecutionPolicy Bypass -File scripts\export-events.ps1
# 輸出：data\raw\events-<日期>.json（含原始欄位，不進版本控制；build-data.py 會去識別化）
#
# 系統記錄上限只有 20 MB，WLAN 記錄 1 MB，舊事件會被覆蓋；
# 每次匯出都另存一份，build-data.py 會把所有匯出檔合併去重。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'data\raw'
New-Item -ItemType Directory -Force $outDir | Out-Null

function Get-Data($e) {
    $h = [ordered]@{}
    $i = 0
    foreach ($d in ([xml]$e.ToXml()).Event.EventData.Data) {
        $name = if ($d.Name) { $d.Name } else { "p$i" }
        $h[$name] = "$($d.'#text')"
        $i++
    }
    $h
}

function Convert-Events($events, [string]$kind) {
    foreach ($e in $events) {
        [ordered]@{
            kind     = $kind
            t        = $e.TimeCreated.ToString('yyyy-MM-ddTHH:mm:ss.fffffffzzz')
            provider = $e.ProviderName
            id       = $e.Id
            record   = $e.RecordId
            data     = Get-Data $e
        }
    }
}

function Query($filter) {
    @(Get-WinEvent -FilterHashtable $filter -ErrorAction SilentlyContinue)
}

$all = New-Object System.Collections.Generic.List[object]

# Vanguard 核心驅動載入（6）／卸載（1）
foreach ($id in 6, 1) {
    $ev = Query @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-FilterManager'; Id = $id } |
        Where-Object { ([xml]$_.ToXml()).Event.EventData.Data | Where-Object { $_.Name -eq 'DeviceName' -and $_.'#text' -eq 'vgk' } }
    $kind = if ($id -eq 6) { 'vgk_load' } else { 'vgk_unload' }
    Convert-Events $ev $kind | ForEach-Object { $all.Add($_) }
}

# TPM 指令失敗
Convert-Events (Query @{ LogName = 'System'; ProviderName = 'TPM'; Id = 14, 15, 17 }) 'tpm' | ForEach-Object { $all.Add($_) }
# TPM 清除／佈建
Convert-Events (Query @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-TPM-WMI'; Id = 519, 1025 }) 'tpm_wmi' | ForEach-Object { $all.Add($_) }
# 網卡驅動錯誤（5002 = CX PLDR）
Convert-Events (Query @{ LogName = 'System'; ProviderName = 'rtwlane711' }) 'wifi_fail' | ForEach-Object { $all.Add($_) }
# 開機／關機／意外斷電
Convert-Events (Query @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Kernel-General'; Id = 12, 13 }) 'boot' | ForEach-Object { $all.Add($_) }
Convert-Events (Query @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Kernel-Power'; Id = 41 }) 'boot' | ForEach-Object { $all.Add($_) }
# WLAN 連線狀態：8001 連上、8003 斷線、8002 連線失敗、8005/8006 熱點啟動、8008 熱點停止
Convert-Events (Query @{ LogName = 'Microsoft-Windows-WLAN-AutoConfig/Operational'; Id = 8001, 8002, 8003, 8005, 8006, 8008 }) 'wlan' | ForEach-Object { $all.Add($_) }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $outDir "events-$stamp.json"
$meta = [ordered]@{
    exported  = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
    systemLogOldest = (Get-WinEvent -LogName System -MaxEvents 1 -Oldest).TimeCreated.ToString('yyyy-MM-ddTHH:mm:sszzz')
    wlanLogOldest   = (Get-WinEvent -LogName 'Microsoft-Windows-WLAN-AutoConfig/Operational' -MaxEvents 1 -Oldest).TimeCreated.ToString('yyyy-MM-ddTHH:mm:sszzz')
    events    = $all
}
[IO.File]::WriteAllText($out, ($meta | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
$all | Group-Object kind | ForEach-Object { '{0,-11} {1,5}' -f $_.Name, $_.Count }
"-> $out"
