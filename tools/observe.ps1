# 観測の試作：いま手前にあるウィンドウを、決まった間隔で書き留めるだけのもの。
#
# 方針
#   - 何もインストールしない（Windows に最初から入っているものだけ）。
#   - 取るのは「アプリ名・ウィンドウの題名・時刻・放置していた秒数」だけ。
#     キー入力の中身、画面の絵、通信の中身は取らない。
#   - 書き出し先はこのフォルダの外。生活データをリポジトリに入れない。
#   - 外に送らない。このスクリプトは通信しない。
#
# 使い方
#   .\observe.ps1                      … 1分ごとに観測し、Ctrl+C で止める
#   .\observe.ps1 -IntervalSec 300     … 5分ごと
#   .\observe.ps1 -Samples 5 -IntervalSec 2  … 試しに5回だけ
#   .\observe.ps1 -OutDir "D:\log"     … 書き出し先を変える
#
# 出力： <OutDir>\activity-YYYY-MM-DD.tsv （1行1観測・タブ区切り）

[CmdletBinding()]
param(
  [int]$IntervalSec = 60,
  [int]$Samples = 0,                       # 0 = 止めるまで
  [string]$OutDir = "$env:LOCALAPPDATA\personal-ai-observe"
)

Add-Type -Namespace Win -Name Api -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
[StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
'@

function Get-Foreground {
  $h = [Win.Api]::GetForegroundWindow()
  if ($h -eq [IntPtr]::Zero) { return $null }
  $sb = New-Object System.Text.StringBuilder 512
  [void][Win.Api]::GetWindowTextW($h, $sb, $sb.Capacity)
  # $pid は PowerShell の予約変数なので使えない
  $procId = 0
  [void][Win.Api]::GetWindowThreadProcessId($h, [ref]$procId)
  $name = try { (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { "?" }
  [pscustomobject]@{ App = $name; Title = $sb.ToString() }
}

function Get-IdleSec {
  $i = New-Object Win.Api+LASTINPUTINFO
  $i.cbSize = [uint32][System.Runtime.InteropServices.Marshal]::SizeOf($i)
  if (-not [Win.Api]::GetLastInputInfo([ref]$i)) { return -1 }
  [int](([Environment]::TickCount - [int]$i.dwTime) / 1000)
}

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

$n = 0
while ($true) {
  $f = Get-Foreground
  if ($f) {
    $now  = Get-Date
    $file = Join-Path $OutDir ("activity-" + $now.ToString("yyyy-MM-dd") + ".tsv")
    if (-not (Test-Path $file)) {
      [System.IO.File]::WriteAllText($file, "時刻`tアプリ`tウィンドウの題名`t放置秒`r`n", (New-Object System.Text.UTF8Encoding($false)))
    }
    # タブと改行だけ落とす。題名そのものは加工しない（あとで読み返せるように）
    $title = ($f.Title -replace "[`t`r`n]", " ").Trim()
    $line  = "{0}`t{1}`t{2}`t{3}`r`n" -f $now.ToString("HH:mm:ss"), $f.App, $title, (Get-IdleSec)
    [System.IO.File]::AppendAllText($file, $line, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host ("{0}  {1,-14} {2}" -f $now.ToString("HH:mm:ss"), $f.App, $title)
  }
  $n++
  if ($Samples -gt 0 -and $n -ge $Samples) { break }
  Start-Sleep -Seconds $IntervalSec
}
Write-Host ""
Write-Host ("書き出し先: " + $OutDir)
