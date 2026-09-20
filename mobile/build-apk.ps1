<#
  AI秘書 — APK を作る（Windows / PowerShell）

  Expo のサーバーで組み立ててもらい、スマホに直接入れられる APK を作ります。
  作ったあとは **パソコンは要りません**（黒い窓もQRも同じ Wi-Fi も不要）。

  要るもの：Node.js と、Expo の無料アカウント（初回にブラウザが開きます）。
  かかる時間：10〜20分（混んでいるともっと待ちます）。
#>
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "AI秘書 — APK を作る" -ForegroundColor Cyan
Write-Host ""

# --- Node があるか ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js が入っていません。" -ForegroundColor Yellow
  Write-Host "  winget install OpenJS.NodeJS.LTS   または https://nodejs.org の LTS 版"
  Write-Host "  入れたあとは、この窓を一度閉じてから実行してください。" -ForegroundColor DarkGray
  exit 1
}
Write-Host ("Node.js {0}" -f (node --version)) -ForegroundColor DarkGray

# --- 最新に更新する（できなくても止めない）---
if (Get-Command git -ErrorAction SilentlyContinue) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  git -C .. pull --ff-only 2>&1 | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
  $ErrorActionPreference = $prev
}

# --- 初回だけ、要るものを入れる ---
if (-not (Test-Path "node_modules")) {
  Write-Host ""
  Write-Host "初回の準備をしています（数分かかります）…" -ForegroundColor Yellow
  npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host "準備でつまずきました。上のメッセージをそのまま貼って相談してください。" -ForegroundColor Red
    exit 1
  }
}

# --- 本体を写す（正は ../app/index.html）---
# **これを忘れると、古い中身の APK ができる。**
node sync.js
if ($LASTEXITCODE -ne 0) {
  Write-Host "本体を写せませんでした。app/index.html があるか確かめてください。" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "これから Expo のサーバーに組み立てを頼みます。" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ・初回はブラウザが開いて、Expo のログイン（無料の登録）を求められます" -ForegroundColor DarkGray
Write-Host "  ・「Create a project?」のように聞かれたら Y（はい）で進めてください" -ForegroundColor DarkGray
Write-Host "  ・「Generate a new Android Keystore?」も Y で大丈夫です" -ForegroundColor DarkGray
Write-Host "    （アプリに署名する鍵。Expo が預かってくれます）" -ForegroundColor DarkGray
Write-Host "  ・そのあと10〜20分、組み立てを待ちます" -ForegroundColor DarkGray
Write-Host ""
Write-Host "終わると、ダウンロード用のURLとQRが出ます。" -ForegroundColor Cyan
Write-Host "そのQRを**スマホのカメラ**で読んで APK を入れてください" -ForegroundColor Cyan
Write-Host "（ここは Expo Go ではなく、ふつうのカメラで構いません）。"
Write-Host ""

npx eas-cli@latest build -p android --profile preview

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "組み立てを頼めませんでした。" -ForegroundColor Red
  Write-Host "  画面に出ている文字をそのまま貼って相談してください。" -ForegroundColor Yellow
  exit 1
}
