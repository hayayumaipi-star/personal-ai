<#
  AI秘書 — APK を作る（Windows / PowerShell）

  Expo のサーバーで組み立ててもらい、スマホに直接入れられる APK を作ります。
  作ったあとは **パソコンは要りません**（黒い窓もQRも同じ Wi-Fi も不要）。

  要るもの：Node.js と、Expo の無料アカウント（https://expo.dev/signup ・Google でも可）。
  ログインしていなければ、このファイルが `eas login` を呼びます（ブラウザが開きます）。
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

# --- 最新に更新する ---
# **ここで失敗したら、黙って古い中身の APK ができる。**
# 前は灰色の小さい字で流すだけだったので気づけなかった。このプロジェクトで
# いちばん避けたい壊れ方＝「直したのにスマホが古いまま」そのもの。
# だから ①うまくいったか見る ②駄目なら赤で言って、続けるか聞く
#        ③**この台本自身が新しくなったら、作らずに終わって「もう一度」と言う**。
# ③が要るのは、PowerShell が**始めにファイルを全部読んでから**動くため——
# `git pull` で新しくなっても、**いま動いているのは古いほうのまま**。
# 気づかないと「聞かれるはずのAPIキーを聞かれない」まま、古い手順で作ってしまう。
$selfPath = $PSCommandPath
$selfBefore = ""
if ($selfPath -and (Test-Path $selfPath)) { $selfBefore = (Get-FileHash $selfPath -Algorithm SHA256).Hash }

if (Get-Command git -ErrorAction SilentlyContinue) {
  Write-Host "最新に更新しています..." -ForegroundColor DarkGray
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $pullOut = (git -C .. pull --ff-only 2>&1 | Out-String)
  $pullOk = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = $prev
  if ($pullOut.Trim() -ne "") { Write-Host $pullOut.Trim() -ForegroundColor DarkGray }
  if (-not $pullOk) {
    Write-Host ""
    Write-Host "最新に更新できませんでした。" -ForegroundColor Red
    Write-Host "  このまま進めると、古い中身の APK ができます。" -ForegroundColor Yellow
    Write-Host "  上の英語をそのまま貼って相談するのが確実です。" -ForegroundColor Yellow
    Write-Host ""
    $go = Read-Host "  それでも古いままで作りますか？ (y = 作る / それ以外 = やめる)"
    if ($go -ne "y") { Write-Host "  やめました。" -ForegroundColor Yellow; exit 1 }
  }
} else {
  Write-Host ""
  Write-Host "git が入っていないので、最新かどうか確かめられませんでした。" -ForegroundColor Yellow
  Write-Host "  いまパソコンにあるファイルで作ります（古いかもしれません）。" -ForegroundColor Yellow
}

# この台本自身が更新されたら、古い手順のまま作らない
if ($selfBefore -ne "" -and (Test-Path $selfPath)) {
  $selfAfter = (Get-FileHash $selfPath -Algorithm SHA256).Hash
  if ($selfBefore -ne $selfAfter) {
    Write-Host ""
    Write-Host "作り方そのものが新しくなりました。" -ForegroundColor Cyan
    Write-Host "  いま動いているのは古い手順なので、ここで止めます。" -ForegroundColor Cyan
    Write-Host "  もう一度 APKを作る.cmd を実行してください（次は新しい手順で進みます）。" -ForegroundColor Green
    Write-Host ""
    exit 0
  }
}

# --- 要るものを入れる ---
# **「node_modules が有るか」で判断しないこと**（2026-09-20）。
# 依存を1つ足したとき、フォルダは既に有るので飛ばされ、**足したものだけ入らない**。
# `npm install` は、揃っていれば数秒で終わる。毎回通すほうが安全。
#
# **裸の `{ ... }` で囲まないこと**（2026-09-21・実際に走らせて見つけた）。
# PowerShell では「ただの塊（ScriptBlock）」になり、**中身が実行されず画面に印字されるだけ**。
# つまり `npm install` は一度も走っていなかった。いま動いているのは、
# 前に手で入れた `node_modules` が残っているからにすぎない。
# 依存を足した日に「足したものだけ入らない」で転ぶ——上の注意書きが効いていなかった。
if (-not (Test-Path "node_modules")) {
  Write-Host ""
  Write-Host "初回の準備をしています（数分かかります）…" -ForegroundColor Yellow
} else {
  Write-Host "要るものが揃っているか確かめています…" -ForegroundColor DarkGray
}
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
  Write-Host "準備でつまずきました。上のメッセージをそのまま貼って相談してください。" -ForegroundColor Red
  exit 1
}

# --- APIキー（決まり13b）---
# **ここで聞いて、ここで書く。** ファイルを自分で作らせない——
# 「secret.example.json をコピーして名前を変えて…」は、いちばん躓きやすい所だった。
# 1回入れたら `secret.json` に残るので、**次からは何も聞かない**。
$secretPath = Join-Path $PSScriptRoot "secret.json"
if (Test-Path $secretPath) {
  Write-Host ""
  $cur = ""
  try { $cur = (Get-Content $secretPath -Raw | ConvertFrom-Json).provider } catch {}
  Write-Host ("APIキーは mobile\secret.json に入っています（{0}・このまま焼き込みます）。" -f $cur) -ForegroundColor DarkGray
  Write-Host "  変えたい・やめたいときは、そのファイルを消してからもう一度実行してください。" -ForegroundColor DarkGray
  Write-Host "  ※ アプリの画面からは入れ替えられません（設定タブのAIの欄は外しました）。" -ForegroundColor DarkGray
} else {
  Write-Host ""
  Write-Host "APIキーを焼き込みますか？" -ForegroundColor Cyan
  Write-Host "  貼り付けて Enter … このAPKの中でAIが使えるようになります。"
  Write-Host "  何も入れずに Enter … キー無しで作ります（AIは動かず、ルールだけで動きます）。"
  Write-Host "  ※ このAPKを人に渡すと、キーも一緒に渡ります。" -ForegroundColor Yellow
  # **`-AsSecureString` は使わない**（2026-09-21・実際に走らせて決めた）。
  # ①対話でない窓では例外で止まる ②こちらでは試せない
  # ③**どうせ `secret.json` に素のまま書く**ので、打つ所だけ隠しても得が無い。
  # 素の `Read-Host` なら、どの版でも動き、こちらで通しに確かめられる。
  $plainKey = (Read-Host "  APIキー")
  if ($null -eq $plainKey) { $plainKey = "" }
  $plainKey = $plainKey.Trim()
  if ($plainKey -ne "") {
    # **提供元は、当てずに聞く**（2026-09-21・実機で外した）。
    # 前はキーの見た目だけで決めていた（`AIza…` なら Gemini）。実機で
    # **Gemini のキーが Claude として焼き込まれ**、api.anthropic.com へ送って
    # 全部断られた。見た目は提供元が変えるので、当て推量の土台にしない。
    # **画面から入れ替える道はもう無い**（設定タブのAIの欄を外した）ので、
    # ここで間違えると、APKを作り直すまで直せない。だから必ず確かめる。
    $guess = "claude"
    if ($plainKey.StartsWith("AIza")) { $guess = "gemini" }
    $guessNo = @{ claude = "1"; gemini = "2" }[$guess]
    $guessName = @{ claude = "Claude（Anthropic）"; gemini = "Gemini（Google）" }[$guess]
    Write-Host ""
    Write-Host "  どこのAIのキーですか？" -ForegroundColor Cyan
    Write-Host "    1 … Claude（Anthropic）— console.anthropic.com で作ったもの"
    Write-Host "    2 … Gemini（Google）— aistudio.google.com で作ったもの"
    Write-Host ("    そのまま Enter … {0}（キーの形から推測）" -f $guessName) -ForegroundColor DarkGray
    $pick = (Read-Host "  1 か 2")
    if ($null -eq $pick) { $pick = "" }
    $pick = $pick.Trim()
    if ($pick -eq "") { $pick = $guessNo }
    $prov = if ($pick -eq "2") { "gemini" } elseif ($pick -eq "1") { "claude" } else { $guess }
    $obj = [ordered]@{ provider = $prov; key = $plainKey; model = "" }
    # **BOM を付けずに書く。** 付くと Node の JSON.parse が落ちる（sync.js 側でも外しているが、両方で守る）
    [IO.File]::WriteAllText($secretPath, ($obj | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
    $provName = @{ claude = "Claude（Anthropic）"; gemini = "Gemini（Google）" }[$prov]
    Write-Host ("  保存しました（mobile\secret.json・{0}）。次からは聞きません。" -f $provName) -ForegroundColor Green
    Write-Host "  違っていたら、そのファイルを消してもう一度実行してください。" -ForegroundColor DarkGray
  } else {
    Write-Host "  キー無しで作ります。" -ForegroundColor Yellow
  }
}

# --- 本体を写す（正は ../app/index.html）---
# **これを忘れると、古い中身の APK ができる。**
node sync.js
if ($LASTEXITCODE -ne 0) {
  Write-Host "本体を写せませんでした。app/index.html があるか確かめてください。" -ForegroundColor Red
  exit 1
}

# --- Expo の道具を、先に取り寄せておく ---
# **ここを黙ってやらせない**（2026-09-25・実機で止まった）。
# 下の whoami は出力を `Out-String` で捕まえるので、**画面には1文字も出ない**。
# ところが `npx eas-cli@latest` は初回に 100MB 近くを取り寄せるうえ、
# npm が「入れていいか」を聞いてくる——**その問いかけごと隠れる**ので、
# 「Expo にログインしているか確かめます…」のまま、待っても永久に進まない。
# だから ①`--yes` で二度と聞かせない ②**取り寄せだけ先に、画面に出しながら**やる。
# ここを通ったあとの whoami は一瞬で終わるので、隠れていても止まらない。
Write-Host ""
Write-Host "Expo の道具（eas-cli）を用意します。初回は数分かかります…" -ForegroundColor DarkGray
Write-Host "  （下に npm の進み具合が出ます。止まって見えても、待ってください）" -ForegroundColor DarkGray
npx --yes eas-cli@latest --version
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Expo の道具を取り寄せられませんでした。" -ForegroundColor Red
  Write-Host "  ネットにつながっているか確かめて、もう一度実行してください。" -ForegroundColor DarkGray
  exit 1
}

# --- 先にログインを確かめる ---
# **ブラウザは開かない。**この窓の中でユーザー名とパスワードを聞かれる。
# 登録を済ませていないと「Your username, email, or password was incorrect.」で
# 落ちるので、**組み立てを頼む前に**ここで止めて、先に登録へ案内する。
Write-Host ""
Write-Host "Expo にログインしているか確かめます…" -ForegroundColor DarkGray
$who = ""
try { $who = (npx --yes eas-cli@latest whoami 2>&1 | Out-String).Trim() } catch { $who = "" }
if ($LASTEXITCODE -ne 0 -or $who -match "Not logged in" -or $who -eq "") {
  Write-Host ""
  Write-Host "Expo にログインしていないので、先にログインします。" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  ブラウザが開きます。**Google で登録した人は「Continue with Google」**を押してください。" -ForegroundColor Cyan
  Write-Host "  （eas login は既定でブラウザを使います。確認済み: eas-cli 24.7.0）" -ForegroundColor DarkGray
  Write-Host ""
  npx --yes eas-cli@latest login
  $who = ""
  try { $who = (npx --yes eas-cli@latest whoami 2>&1 | Out-String).Trim() } catch { $who = "" }
  if ($LASTEXITCODE -ne 0 -or $who -match "Not logged in" -or $who -eq "") {
    Write-Host ""
    Write-Host "ログインできませんでした。" -ForegroundColor Red
    Write-Host ""
    Write-Host "  ブラウザでうまくいかないときは、**合い言葉（トークン）**を使う道があります："
    Write-Host "    ① https://expo.dev/settings/access-tokens を開く" -ForegroundColor Cyan
    Write-Host "    ② 「Create token」で作り、出てきた文字をコピー（一度しか出ません）"
    Write-Host "    ③ この窓で：" 
    Write-Host "         set EXPO_TOKEN=コピーした文字" -ForegroundColor Cyan
    Write-Host "    ④ そのあと、もう一度このファイルを実行"
    Write-Host ""
    Write-Host "  これは Google で登録した人でも必ず通ります" -ForegroundColor DarkGray
    Write-Host "  （パスワードを使わないため）。" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  ※ トークンは**この窓を閉じると消えます**。毎回入れ直すか、" -ForegroundColor DarkGray
    Write-Host "    ブラウザでのログインが通るなら、そちらのほうが楽です。" -ForegroundColor DarkGray
    Write-Host ""
    exit 1
  }
}
Write-Host ("Expo: {0}" -f $who) -ForegroundColor DarkGray

Write-Host ""
Write-Host "これから Expo のサーバーに組み立てを頼みます。" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ・「Create a project?」のように聞かれたら Y（はい）で進めてください" -ForegroundColor DarkGray
Write-Host "  ・「Generate a new Android Keystore?」も Y で大丈夫です" -ForegroundColor DarkGray
Write-Host "    （アプリに署名する鍵。Expo が預かってくれます）" -ForegroundColor DarkGray
Write-Host "  ・そのあと10〜20分、組み立てを待ちます" -ForegroundColor DarkGray
Write-Host ""
Write-Host "終わると、ダウンロード用のURLとQRが出ます。" -ForegroundColor Cyan
Write-Host "そのQRを**スマホのカメラ**で読んで APK を入れてください" -ForegroundColor Cyan
Write-Host "（ここは Expo Go ではなく、ふつうのカメラで構いません）。"
Write-Host ""

npx --yes eas-cli@latest build -p android --profile preview

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "組み立てを頼めませんでした。" -ForegroundColor Red
  Write-Host "  「username, email, or password was incorrect」なら、ログインのやり直しです："
  Write-Host "     npx --yes eas-cli@latest login" -ForegroundColor Cyan
  Write-Host "  （Google で登録した人はパスワードが無いので、ブラウザの側で入ること）" -ForegroundColor DarkGray
  Write-Host "  それ以外なら、画面に出ている文字をそのまま貼って相談してください。" -ForegroundColor Yellow
  exit 1
}
