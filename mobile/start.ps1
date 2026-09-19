<#
  AI秘書 — スマホで試す（Windows / PowerShell）

  やること：最新に更新する → 足りないものを確かめる → 本体を写す → Expo を起動してQRを出す。
  QRが出たら、スマホの **Expo Go のアプリの中から** 読み取ってください
  （カメラアプリではありません）。

  使い方：
    このフォルダの「スマホで試す.cmd」をダブルクリックするのが一番かんたんです。
    PowerShell から直接なら：
      .\start.ps1              … 同じ Wi-Fi のスマホから開く
      .\start.ps1 -Tunnel      … 別のネットのスマホからでも開く（少し遅い）
#>
param([switch]$Tunnel)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "AI秘書 — スマホで試す" -ForegroundColor Cyan
Write-Host ""

# --- Node があるか ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js が入っていません。" -ForegroundColor Yellow
  Write-Host "  次のどちらかで入れてから、もう一度このファイルを実行してください："
  Write-Host "    winget install OpenJS.NodeJS.LTS"
  Write-Host "    または https://nodejs.org の LTS 版"
  Write-Host ""
  Write-Host "  入れたあとは、開いている窓を一度閉じてから実行してください" -ForegroundColor DarkGray
  Write-Host "  （閉じないと、入れたばかりの node が見つかりません）。" -ForegroundColor DarkGray
  exit 1
}
Write-Host ("Node.js {0}" -f (node --version)) -ForegroundColor DarkGray

# --- 最新に更新する（できなくても止めない）---
# 手元で何か直している途中なら、git は拒む。それは正しいので、そのまま進める。
if (Get-Command git -ErrorAction SilentlyContinue) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  git -C .. pull --ff-only 2>&1 | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
  if ($LASTEXITCODE -ne 0) {
    Write-Host "（更新できませんでした。手元のままで進めます）" -ForegroundColor DarkGray
  }
  $ErrorActionPreference = $prev
}

# --- 初回だけ、要るものを入れる ---
if (-not (Test-Path "node_modules")) {
  Write-Host ""
  Write-Host "初回の準備をしています（数分かかります）…" -ForegroundColor Yellow
  npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "準備でつまずきました。上のメッセージをそのまま貼って相談してください。" -ForegroundColor Red
    exit 1
  }
}

# --- 本体を写す（正は ../app/index.html）---
node sync.js
if ($LASTEXITCODE -ne 0) {
  Write-Host "本体を写せませんでした。app/index.html があるか確かめてください。" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "QRコードが出たら、スマホの Expo Go の中から読み取ってください。" -ForegroundColor Cyan
Write-Host "（カメラアプリではなく、Expo Go のアプリを開いて、その中のスキャナ）"
Write-Host ""
Write-Host "読み取れないときは、QRの少し上に出ている exp://… の文字を" -ForegroundColor DarkGray
Write-Host "Expo Go の入力欄に手で打ち込んでも開けます。" -ForegroundColor DarkGray
Write-Host "何も出ない／赤い字が出たときは、画面の文字をそのまま貼って相談してください。" -ForegroundColor DarkGray
Write-Host "止めるときは Ctrl+C。"
Write-Host ""

if ($Tunnel) { npx expo start --tunnel } else { npx expo start }

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Expo が起動できませんでした。" -ForegroundColor Red
  Write-Host "  同じ Wi-Fi にいないときは、次を試してください：" -ForegroundColor Yellow
  Write-Host "    .\start.ps1 -Tunnel"
  exit 1
}
