<#
  AI秘書 — スマホで試す（Windows / PowerShell）

  やること：足りないものを確かめる → 本体を写す → Expo を起動してQRを出す。
  QRが出たら、スマホの **Expo Go のアプリの中から** 読み取ってください
  （カメラアプリではありません）。

  使い方：
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
  exit 1
}
Write-Host ("Node.js {0}" -f (node --version)) -ForegroundColor DarkGray

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
Write-Host "止めるときは Ctrl+C。"
Write-Host ""

if ($Tunnel) { npx expo start --tunnel } else { npx expo start }
