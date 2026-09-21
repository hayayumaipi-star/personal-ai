/* `app/index.html` を、殻が読める形にして写すだけ。
   **正は常に `app/index.html` ひとつ**（決まり7e）。ここで編集しないこと。

   **なぜ .html のまま置かないか**（v8.3 で作り直した）：
   資産ファイルとして持つと `expo-asset` と `expo-file-system` が要り、
   Metro の設定も足すことになる。**依存が3つ増える。**
   文字列にしてしまえば、どれも要らない——版が上がって API が変わる場所が減る。

   **ここだけが、APIキーを焼き込む**（v8.7・本人の指示
   「APKでもAIを使えるようAPIを埋め込みたい」・決まり13b）。
   APK には claude.ai の窓口（`sample`）が無いので、キーが無いとAIがまったく動かない。
   毎回スマホで貼り付けるのは現実的でないので、作るときに入れておく。

   **キーは `app/index.html` に持たせない。** あちらは git に入るファイルで、
   入れた瞬間に履歴へ残って取り消せない。ここで**写しにだけ**足す
   （`app-html.js` は `.gitignore` に入っている）。
   キーの出どころは `mobile/secret.json`（これも `.gitignore`）か、環境変数。
   **どちらも無ければ、今までと1バイトも変わらない**（決まり7「AIは任意」）。 */
const fs = require("fs"), path = require("path");
const src = path.join(__dirname, "..", "app", "index.html");
const dst = path.join(__dirname, "app-html.js");
let html = fs.readFileSync(src, "utf8");

/* 焼き込むキーを探す。ファイルが先、無ければ環境変数。 */
function findKey() {
  const f = path.join(__dirname, "secret.json");
  if (fs.existsSync(f)) {
    try { return JSON.parse(fs.readFileSync(f, "utf8")); }
    catch (e) { throw new Error("mobile/secret.json を読めませんでした（JSONの形を確かめてください）: " + e.message); }
  }
  if (process.env.HITOHI_AI_KEY) {
    return { provider: process.env.HITOHI_AI_PROVIDER || "claude",
             key: process.env.HITOHI_AI_KEY, model: process.env.HITOHI_AI_MODEL || "" };
  }
  return null;
}

const cfg = findKey();
if (cfg) {
  if (!cfg.key || !["claude", "gemini"].includes(cfg.provider)) {
    throw new Error('焼き込むキーの形が違います。{"provider":"claude|gemini","key":"...","model":"..."} にしてください。');
  }
  /* **入れる場所を決め打ちにせず、目印で探して、無ければ止まる。**
     黙って入らないと「キーを入れたのにAIが動かない」になり、原因が画面から見えない。 */
  const anchor = "<title>AI秘書</title>";
  const at = html.indexOf(anchor);
  if (at < 0 || html.indexOf(anchor, at + 1) >= 0) {
    throw new Error("焼き込む場所（" + anchor + "）が1つ見つかりませんでした。app/index.html を確かめてください。");
  }
  const json = JSON.stringify({ provider: cfg.provider, key: String(cfg.key),
    model: String(cfg.model || "") }).replace(/</g, "\\u003c");
  html = html.slice(0, at + anchor.length)
    + "\n<script>window.HITOHI_AI=" + json + ";</script>"
    + html.slice(at + anchor.length);
}

fs.writeFileSync(dst,
  "/* 自動生成。直さないこと。正は app/index.html で、`node sync.js` が写す。 */\n"
  + "export default " + JSON.stringify(html) + ";\n", "utf8");
console.log(`写しました: app/index.html → mobile/app-html.js (${html.length.toLocaleString()}文字)`);
/* **キーそのものは絶対に出さない。** 出どころと末尾4文字だけ出して、
   「入ったかどうか」を確かめられるようにする。 */
if (cfg) {
  console.log(`APIキーを焼き込みました: ${cfg.provider} / ****${String(cfg.key).slice(-4)}`
    + (cfg.model ? ` / ${cfg.model}` : ""));
  console.log("※ この APK を人に渡すと、そのキーも一緒に渡ります（中身は取り出せます）。");
} else {
  console.log("APIキーは焼き込んでいません（mobile/secret.json も HITOHI_AI_KEY もありません）。");
}
