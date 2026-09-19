# Android の殻（Expo）

`app/index.html` を、そのまま Android アプリの中で動かすための**殻**です。

**中身のロジックは1行もここにありません。** 正は `app/index.html` だけ。
殻がやるのは3つだけです。

| 殻の仕事 | なぜ |
|---|---|
| `index.html` を WebView で開く | 5,500行と896件のテストを、そのまま使うため |
| AIへの通信を代わりに行う | WebView から直接呼ぶと、相手の受け入れ設定（CORS）に止められることがある |
| 予定の通知を予約する | **これが Android にする唯一の理由。** ブラウザではできない |

**「定時に自分で起きる」仕組みは入れていません。** 通知は先に予約しておけば
アプリが閉じていても鳴るので、要らないからです。入れない分だけ殻は小さく、壊れる場所も少ない。

## まだ実機で動かしていません

このフォルダのコードは**書いただけで、まだ一度も端末で動かしていません**
（このリポジトリの決まり：測っていないことを測ったように言わない）。
最初に動かす人は、下の「最初に確かめること」を順に見てください。

## 作り方

Node と Android の開発環境（または Expo のクラウドビルド）が要ります。

```bash
# 1. この mobile/ の中で、Expo の枠組みを作る
cd mobile
npx create-expo-app@latest . --template blank
# → App.js / metro.config.js を上書きするか聞かれたら、このリポジトリのものを残すこと
#   （git status で差分を見て、消えていたら git checkout で戻す）

# 2. 要るものを入れる（**版はここで決めない。expo に決めさせる**）
npx expo install react-native-webview expo-asset expo-file-system expo-notifications

# 3. アプリ本体を写す
node sync.js

# 4. 動かす
npx expo start        # 開発中（Expo Go で読み取る）
# 端末に入れる APK を作るなら：
npx eas build -p android --profile preview
```

`package.json` の `scripts` に足しておくと楽です。

```json
"scripts": {
  "sync": "node sync.js",
  "start": "node sync.js && expo start",
  "build": "node sync.js && eas build -p android --profile preview"
}
```

**本体を直したら、必ず `node sync.js` を先に走らせること。**
忘れると古いアプリをビルドします。

## app.json に足すもの

`create-expo-app` が作った `app.json` の `expo` の中へ：

```json
"android": {
  "package": "star.hayayumaipi.hitohi",
  "permissions": ["POST_NOTIFICATIONS", "SCHEDULE_EXACT_ALARM"]
},
"plugins": ["expo-notifications"]
```

## 最初に確かめること（順番に）

ここが通らないと先へ進めない、という順に並べています。

1. **画面が出るか。** 出なければ `mobile/assets/app.html` が無い（`node sync.js`）。
2. **記録が残るか。** 何か話しかけて、アプリを閉じて開き直す。消えていたら
   WebView が localStorage を貸していません。`App.js` の `BASE_URL` を疑うこと
   （`file://` だと貸してくれないことがあるので、実体のある出どころを与えています）。
3. **AIが動くか。** 設定タブで APIキーを入れて「つながるか試す」。
   ここで初めて、殻ごしの通信が確かめられます。
4. **通知が鳴るか。** 数分先に予定を入れて、アプリを閉じて待つ。
   鳴らなければ、Android の通知の許可と、通知チャンネル（`plan`）を疑うこと。
   **Android 13 以降は明示的な許可が要ります。**

## 分かっている落とし穴

- **通知の予約の書き方は expo-notifications の版で変わります。**
  `App.js` の `scheduleOne` が新しい形と古い形を順に試すのは、そのためです。
  それでも駄目なら、その版の書き方を調べて1つ足してください。
- **Android は機種によってバックグラウンドを積極的に止めます。**
  通知は「予約しておいて鳴らす」形なので影響は小さいはずですが、
  省電力設定の強い端末では遅れることがあります。
- **テストは殻を見ません。** 896件は `app/index.html` の中身だけを測ります。
  殻（通知・通信・保存）は**手で確かめるしかありません**。上の4つがその手順です。

## 直すときの決まり

- **`mobile/assets/app.html` を直接編集しない。** あれは写しです。`app/index.html` を直す
- 殻に「判断」を足さない。予定の組み立ても、読み取りも、全部 `index.html` の側
- 殻を増やしたくなったら、まず「それは `index.html` 側でできないか」を考える
