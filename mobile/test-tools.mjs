/*
  GitHub Actions の「APKを作る」が使う2つの道具を、偽の Expo・偽の AI の提供元で確かめる（2026-10-07）。
    node mobile/test-tools.mjs
  見るのは：
    find-eas-project.js … 見つかったときだけ番号を渡す。見つからない・2つ以上・形が違う・トークンが使えない → 止める（新しく作らない）
    check-ai-key.js     … 使えるキーだけ通す。使えない・モデルが無い・混んでいる → 止める
    どちらも：キーとトークンをログに出さない
*/
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = "expo-token-SECRET-1234567890";
const KEY = "AIza-SECRET-key-abcdefghijk9876";
const ID1 = "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e";
const ID2 = "11111111-2222-4333-8444-555555555555";

let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log("NG", name, extra || ""); } };

/* 偽の Expo：scene ごとに答えを変える */
let scene = {};
let calls = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    calls.push({ url: req.url, auth: req.headers.authorization || "", goog: req.headers["x-goog-api-key"] || "", xkey: req.headers["x-api-key"] || "", body });
    const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.url === "/graphql") {
      if (scene.expoStatus) return send(scene.expoStatus, { errors: [{ message: "unauthorized" }] });
      const q = JSON.parse(body);
      if (/meActor/.test(q.query)) return send(200, scene.me || { data: { meActor: { accounts: [{ name: "me" }, { name: "team" }] } } });
      const full = q.variables.fullName;
      const hit = (scene.apps || {})[full];
      if (hit === "weird") return send(200, { errors: [{ message: "Cannot query field byFullName", extensions: { errorCode: "GRAPHQL_VALIDATION_FAILED" } }] });
      if (hit === "badid") return send(200, { data: { app: { byFullName: { id: "not-a-uuid" } } } });
      if (hit) return send(200, { data: { app: { byFullName: { id: hit } } } });
      return send(200, { errors: [{ message: `Experience with id '${full}' does not exist.`, extensions: { errorCode: "EXPERIENCE_NOT_FOUND" } }], data: null });
    }
    if (req.url.startsWith("/gemini/") || req.url.startsWith("/claude/")) {
      const a = scene.ai || { status: 200, body: { name: "models/x" } };
      return send(a.status, a.body);
    }
    send(404, {});
  });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* 偽のサーバーは同じプロセスにいるので、子は待たずに（非同期で）動かす。spawnSync だと互いに待って止まる */
function run(file, env) {
  const ghenv = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "apk-")), "env");
  fs.writeFileSync(ghenv, "");
  return new Promise(resolve => {
    const ch = spawn(process.execPath, [path.join(DIR, file)], {
      env: { PATH: process.env.PATH, GITHUB_ENV: ghenv, EXPO_GRAPHQL_URL: BASE + "/graphql",
             GEMINI_CHECK_URL: BASE + "/gemini", CLAUDE_CHECK_URL: BASE + "/claude", ...env },
    });
    let out = "";
    ch.stdout.on("data", d => out += d);
    ch.stderr.on("data", d => out += d);
    const t = setTimeout(() => ch.kill(), 30000);
    ch.on("close", code => { clearTimeout(t); resolve({ code, out, env: fs.readFileSync(ghenv, "utf8") }); });
  });
}
const findP = async (s, env) => { scene = s; calls = []; return run("find-eas-project.js", { EXPO_TOKEN: TOKEN, ...env }); };
const checkK = async (s, env) => { scene = s; calls = []; return run("check-ai-key.js", { HITOHI_AI_KEY: KEY, HITOHI_AI_PROVIDER: "gemini", HITOHI_AI_MODEL: "gemini-3.5-flash-lite", ...env }); };
const noLeak = (r, name) => ok(!r.out.includes(TOKEN) && !r.out.includes(KEY) && !r.env.includes(TOKEN) && !r.env.includes(KEY), name + "：キーもトークンも出さない", r.out);

/* ---- find-eas-project.js ---- */
let r = await findP({ apps: { "@me/hitohi": ID1 } });
ok(r.code === 0, "見つかれば通る", r.out);
ok(r.env.includes("EAS_PROJECT_ID=" + ID1 + "\n") && r.env.includes("EXPO_OWNER=me\n"), "見つけた番号と持ち主を渡す", r.env);
ok(r.out.includes(ID1), "見つけた番号はログに出す（固定したいとき写せるように）");
ok(calls.every(c => c.auth === "Bearer " + TOKEN), "トークンはヘッダーで送る");
noLeak(r, "見つかったとき");

r = await findP({ apps: {} });
ok(r.code === 1 && r.env === "", "見つからなければ止める（何も渡さない）", r.out);
ok(/新しく作ると署名が変わり/.test(r.out) && /EAS_PROJECT_ID/.test(r.out), "見つからないときは理由と直し方を言う", r.out);
ok(calls.every(c => !/mutation/i.test(c.body)), "プロジェクトを作る問い合わせを1つも送らない");
noLeak(r, "見つからないとき");

r = await findP({ apps: { "@me/hitohi": ID1, "@team/hitohi": ID2 } });
ok(r.code === 1 && r.env === "", "2つのアカウントにあれば止める", r.out);

r = await findP({ apps: { "@team/hitohi": ID2 } });
ok(r.code === 0 && r.env.includes("EAS_PROJECT_ID=" + ID2) && r.env.includes("EXPO_OWNER=team"), "組織のアカウントにあればそれを使う", r.out + r.env);

r = await findP({ apps: { "@team/hitohi": ID2, "@me/hitohi": ID1 } }, { EXPO_OWNER: "team" });
ok(r.code === 0 && r.env.includes("EAS_PROJECT_ID=" + ID2), "EXPO_OWNER があればそのアカウントだけ探す", r.out);
ok(!calls.some(c => /meActor/.test(c.body)), "EXPO_OWNER があればアカウントの一覧を聞かない");

r = await findP({ expoStatus: 401 });
ok(r.code === 1 && /EXPO_TOKEN/.test(r.out) && r.env === "", "トークンが使えなければ止める", r.out);
noLeak(r, "トークンが使えないとき");

r = await findP({ apps: { "@me/hitohi": "weird" } });
ok(r.code === 1 && r.env === "", "知らない誤りが返れば止める（見つからないと読まない）", r.out);

r = await findP({ apps: { "@me/hitohi": "weird", "@team/hitohi": ID2 } });
ok(r.code === 1 && r.env === "" && /探せませんでした/.test(r.out), "1つのアカウントで探せなければ、ほかで見つかっても止める（どちらか分からない）", r.out + r.env);

r = await findP({ apps: { "@me/hitohi": "badid" } });
ok(r.code === 1 && r.env === "", "番号の形が違えば止める", r.out);

r = await findP({ me: { data: { meActor: null } } });
ok(r.code === 1 && r.env === "", "アカウントが読めなければ止める", r.out);

r = await findP({ me: { data: { meActor: { accounts: [{ name: "a\nEAS_PROJECT_ID=evil" }] } } }, apps: { "@a\nEAS_PROJECT_ID=evil/hitohi": ID1 } });
ok(r.code === 1 && !r.env.includes("evil"), "変な名前のアカウントは使わない（GITHUB_ENV に書き込ませない）", r.out + r.env);

r = await run("find-eas-project.js", { EXPO_TOKEN: TOKEN, EXPO_GRAPHQL_URL: "http://127.0.0.1:9/graphql" });
ok(r.code === 1 && r.env === "", "Expo につながらなければ止める", r.out);

r = await run("find-eas-project.js", {});
ok(r.code === 1 && r.env === "", "トークンが無ければ止める", r.out);

/* ---- check-ai-key.js ---- */
r = await checkK({ ai: { status: 200, body: { name: "models/gemini-3.5-flash-lite" } } });
ok(r.code === 0 && /\*\*\*\*9876/.test(r.out), "使えるキーは通す（末尾4文字だけ見せる）", r.out);
ok(calls.length === 1 && calls[0].goog === KEY && !calls[0].url.includes(KEY), "Gemini のキーはヘッダーで送り、URL に入れない", JSON.stringify(calls));
ok(calls[0].url === "/gemini/models/gemini-3.5-flash-lite", "モデルの情報を読むだけ（文章を作らせない）", calls[0].url);
noLeak(r, "使えるとき");

r = await checkK({ ai: { status: 400, body: { error: { message: "API key not valid. Please pass a valid API key. (" + KEY + ")" } } } });
ok(r.code === 1 && /HITOHI_AI_KEY を入れ直して/.test(r.out), "使えないキーは止める", r.out);
noLeak(r, "使えないキー（相手がキーを書き返しても）");

r = await checkK({ ai: { status: 404, body: { error: { message: "models/x is not found" } } } });
ok(r.code === 1 && /モデル「gemini-3.5-flash-lite」が見つかりません/.test(r.out), "モデルが無ければそう言って止める", r.out);

r = await checkK({ ai: { status: 429, body: {} } });
ok(r.code === 1 && /混んで/.test(r.out), "混んでいれば止める", r.out);

r = await checkK({ ai: { status: 500, body: {} } });
ok(r.code === 1, "分からない失敗も止める", r.out);

r = await checkK({ ai: { status: 401, body: { error: { message: "invalid x-api-key" } } } }, { HITOHI_AI_PROVIDER: "claude", HITOHI_AI_MODEL: "some-model" });
ok(r.code === 1 && calls[0].xkey === KEY && calls[0].url === "/claude/models/some-model", "Claude のキーも同じに確かめる", r.out + JSON.stringify(calls));
noLeak(r, "Claude");

r = await checkK({}, { HITOHI_AI_PROVIDER: "openai" });
ok(r.code === 1 && calls.length === 0, "知らない提供元は問い合わせずに止める", r.out);

r = await checkK({}, { HITOHI_AI_MODEL: "x/../../y" });
ok(r.code === 1 && calls.length === 0, "モデル名の形が違えば問い合わせずに止める", r.out);

r = await checkK({}, { HITOHI_AI_KEY: "" });
ok(r.code === 1 && calls.length === 0, "キーが無ければ止める", r.out);

r = await run("check-ai-key.js", { HITOHI_AI_KEY: KEY, HITOHI_AI_PROVIDER: "gemini", GEMINI_CHECK_URL: "http://127.0.0.1:9" });
ok(r.code === 1, "提供元につながらなければ止める", r.out);
noLeak(r, "つながらないとき");

server.close();
console.log(`APKを作る道具：成功 ${pass} / 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
