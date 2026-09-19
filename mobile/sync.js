/* `app/index.html` を、殻が読める形にして写すだけ。
   **正は常に `app/index.html` ひとつ**（決まり7e）。ここで編集しないこと。

   **なぜ .html のまま置かないか**（v8.3 で作り直した）：
   資産ファイルとして持つと `expo-asset` と `expo-file-system` が要り、
   Metro の設定も足すことになる。**依存が3つ増える。**
   文字列にしてしまえば、どれも要らない——版が上がって API が変わる場所が減る。 */
const fs = require("fs"), path = require("path");
const src = path.join(__dirname, "..", "app", "index.html");
const dst = path.join(__dirname, "app-html.js");
const html = fs.readFileSync(src, "utf8");
fs.writeFileSync(dst,
  "/* 自動生成。直さないこと。正は app/index.html で、`node sync.js` が写す。 */\n"
  + "export default " + JSON.stringify(html) + ";\n", "utf8");
console.log(`写しました: app/index.html → mobile/app-html.js (${html.length.toLocaleString()}文字)`);
