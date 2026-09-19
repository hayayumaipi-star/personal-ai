/* `app/index.html` を、殻が読む場所へ写すだけ。
   **正は常に `app/index.html` ひとつ**（決まり7e）。ここで編集しないこと。 */
const fs = require("fs"), path = require("path");
const src = path.join(__dirname, "..", "app", "index.html");
const dst = path.join(__dirname, "assets", "app.html");
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
const n = fs.statSync(dst).size;
console.log(`写しました: app/index.html → mobile/assets/app.html (${n.toLocaleString()} バイト)`);
