/* 中継サーバーのテスト（決まり18）。`node server/test.mjs`
   - **本物の署名**で確かめる：RSA の鍵を作り、Google の形の ID トークンに署名して、JWKS として渡す。
   - **本物の SQL** で数える：Node の SQLite に D1 と同じ形の口を付ける（`INSERT … ON CONFLICT … RETURNING` をそのまま流す）。
   - Gemini は偽物（届いた中身を覚えておく）。 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handle, verifyIdToken, resetJwksCache, resetSweep, privacyHTML, cleanRequest, cleanReport, dayOf } from "./src/index.js";

const R = [];
const ok = (name, cond, extra) => R.push((cond ? "PASS" : "FAIL") + " :: " + name + (extra != null && !cond ? "  [" + extra + "]" : ""));

/* D1 と同じ形の口（prepare → bind → first / run） */
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  return {
    raw: db,
    prepare(sql) {
      const st = db.prepare(sql.replace(/\?(\d+)/g, "?"));
      const order = [...sql.matchAll(/\?(\d+)/g)].map(m => +m[1] - 1);
      let args = [];
      const api = {
        bind(...a) { args = order.map(i => a[i]); return api; },
        async first() { return st.get(...args) || null; },
        async run() { st.run(...args); return { success: true }; }
      };
      return api;
    }
  };
}
const enc = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const keyPair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const otherPair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pubJwk = Object.assign(await crypto.subtle.exportKey("jwk", keyPair.publicKey), { kid: "k1", alg: "RS256", use: "sig" });
async function token(claims, { kid = "k1", pair = keyPair } = {}) {
  const h = enc({ alg: "RS256", kid, typ: "JWT" }), p = enc(claims);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(h + "." + p)));
  return h + "." + p + "." + Buffer.from(sig).toString("base64url");
}
const NOW = Date.UTC(2026, 8, 28, 3, 0, 0);          // 2026-09-28 12:00 JST
const nowSec = Math.floor(NOW / 1000);
const AUD = "web-123.apps.googleusercontent.com";
const good = (sub = "u1", extra = {}) => Object.assign({ iss: "https://accounts.google.com", aud: AUD, sub, exp: nowSec + 3600, iat: nowSec, email: sub + "@example.com" }, extra);

const sent = [];
let geminiStatus = 200;
let jwksCalls = 0;
const fetchImpl = async (url, init) => {
  if (String(url).includes("oauth2/v3/certs")) { jwksCalls++; return new Response(JSON.stringify({ keys: [pubJwk] }), { headers: { "cache-control": "public, max-age=20000" } }); }
  if (String(url).startsWith("https://generativelanguage.googleapis.com/")) {
    sent.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(geminiStatus === 200 ? { candidates: [{ content: { parts: [{ text: "こんにちは" }] } }] } : { error: { message: "busy" } }), { status: geminiStatus });
  }
  return new Response("?", { status: 404 });
};
const env = () => ({ DB: D1, GEMINI_KEY: "SECRET-KEY-xyz", GOOGLE_CLIENT_ID: AUD, GEMINI_MODEL: "gemini-3.5-flash-lite", GEMINI_TIER: "free", DAILY_LIMIT: "40", DAY_OFFSET_MIN: "540", CONTACT_EMAIL: "me@example.com" });
let D1 = fakeD1();
const req = (path, { method = "POST", tok, body } = {}) => new Request("https://hitohi.example" + path, {
  method, headers: Object.assign({ "content-type": "application/json" }, tok ? { authorization: "Bearer " + tok } : {}),
  body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body || { tier: "deep", body: { contents: [{ parts: [{ text: "明日10時に会議" }] }], generationConfig: { responseMimeType: "application/json" } } })) : undefined
});
const call = (path, o) => handle(req(path, o), env(), fetchImpl, NOW);

// ① 本人確認
{
  const t = await token(good());
  const c = await verifyIdToken(t, env(), fetchImpl, nowSec);
  ok("本物の署名・宛先・期限が合っていれば通す", typeof c === "object" && c.sub === "u1", c);
  const bad = [
    ["宛先が違う", await token(good("u1", { aud: "other.apps.googleusercontent.com" }))],
    ["期限切れ", await token(good("u1", { exp: nowSec - 3600 }))],
    ["発行元が違う", await token(good("u1", { iss: "https://evil.example" }))],
    ["署名が合わない", await token(good(), { pair: otherPair })],
    ["鍵が見つからない", await token(good(), { kid: "nope" })]
  ];
  for (const [why, tk] of bad) { const r = await verifyIdToken(tk, env(), fetchImpl, nowSec); ok("通さない：" + why, r === why, r); }
  const forged = t.split(".").slice(0, 2).join(".") + "." + Buffer.from("x").toString("base64url");
  ok("通さない：署名を差し替えたもの", (await verifyIdToken(forged, env(), fetchImpl, nowSec)) === "署名が合わない");
  const noLogin = await call("/v1/generate", {});
  ok("ログインしていなければ 401（login_required）", noLogin.status === 401 && (await noLogin.json()).error.code === "login_required");
  const wrongAud = await call("/v1/generate", { tok: bad[0][1] });
  ok("宛先の違うトークンでは使えない（401）", wrongAud.status === 401);
  ok("宛先（GOOGLE_CLIENT_ID）が未設定なら、だれも通さない", (await verifyIdToken(t, Object.assign(env(), { GOOGLE_CLIENT_ID: "" }), fetchImpl, nowSec)) === "宛先が違う");
  resetJwksCache(); jwksCalls = 0;
  for (let i = 0; i < 3; i++) await verifyIdToken(t, env(), fetchImpl, nowSec);
  ok("Google の鍵は取り置く（毎回取りに行かない）", jwksCalls === 1, jwksCalls);
}

// ② 中継：キーはここだけ・モデルはここが決める・送る中身を絞る
{
  D1 = fakeD1(); sent.length = 0;
  const t = await token(good());
  const r = await call("/v1/generate", { tok: t, body: { tier: "quick", model: "gemini-9-ultra", body: {
    contents: [{ parts: [{ text: "明日10時に会議" }] }], generationConfig: { thinkingConfig: { thinkingLevel: "low" } }, tools: [{ googleSearch: {} }], systemInstruction: { parts: [{ text: "x" }] } } } });
  const d = await r.json();
  ok("中継して、Gemini の返事をそのまま返す", r.status === 200 && d.candidates[0].content.parts[0].text === "こんにちは", r.status);
  const s = sent[0];
  ok("キーはサーバーが付ける（x-goog-api-key）", !!s && s.headers["x-goog-api-key"] === "SECRET-KEY-xyz");
  ok("モデルはサーバーが決める（アプリから選ばせない）", !!s && /models\/gemini-3\.5-flash-lite:generateContent$/.test(s.url) && !/ultra/.test(s.url), s && s.url);
  ok("送るのは contents と generationConfig だけ（tools などは落とす）", !!s && Object.keys(s.body).sort().join() === "contents,generationConfig", s && Object.keys(s.body).join());
  ok("返事に今日の残りの回数を付ける", r.headers.get("x-hitohi-remaining") === "39", r.headers.get("x-hitohi-remaining"));
  ok("キーを返事に出さない", !JSON.stringify(d).includes("SECRET-KEY"));
  const big = await call("/v1/generate", { tok: t, body: "x".repeat(300000) });
  ok("大きすぎる中身は受け取らない（413）", big.status === 413);
  const empty = await call("/v1/generate", { tok: t, body: { tier: "deep", body: { contents: [] } } });
  ok("中身が無ければ 400", empty.status === 400);
  const junk = await call("/v1/generate", { tok: t, body: "{not json" });
  ok("読めない中身は 400", junk.status === 400);
  ok("中身を絞る関数：contents が無ければ null", cleanRequest({ body: {} }) === null && cleanRequest(null) === null);
}

// ③ 1人1日40回（本物の SQL）
{
  D1 = fakeD1(); sent.length = 0;
  const t1 = await token(good("u1")), t2 = await token(good("u2"));
  let last;
  for (let i = 0; i < 40; i++) last = await call("/v1/generate", { tok: t1 });
  ok("40回までは使える", last.status === 200 && last.headers.get("x-hitohi-remaining") === "0", last.status);
  const over = await call("/v1/generate", { tok: t1 });
  const od = await over.json();
  ok("41回目は 429（daily_limit）で、Gemini を呼ばない", over.status === 429 && od.error.code === "daily_limit" && sent.length === 40, sent.length);
  ok("断っても回数は増やさない（40のまま）", D1.raw.prepare("SELECT n FROM usage").all().map(r => r.n).join() === "40");
  const other = await call("/v1/generate", { tok: t2 });
  ok("ほかの人は別に数える", other.status === 200);
  const st = await (await call("/v1/status", { method: "GET", tok: t1 })).json();
  ok("残りの回数を聞ける（/v1/status）", st.limit === 40 && st.used === 40 && st.remaining === 0 && st.tier === "free", JSON.stringify(st));
  const next = await handle(req("/v1/generate", { tok: await token(Object.assign(good("u1"), { exp: nowSec + 90000 })) }), env(), fetchImpl, NOW + 86400000);
  ok("次の日（日本時間）はまた使える", next.status === 200, next.status);
  ok("「1日」は日本時間で区切る（UTCの15時が次の日）", dayOf(env(), Date.UTC(2026, 8, 28, 14, 59)) === "2026-09-28" && dayOf(env(), Date.UTC(2026, 8, 28, 15, 0)) === "2026-09-29");
}

// ④ 中身を残さない
{
  const rows = D1.raw.prepare("SELECT * FROM usage").all();
  const dump = JSON.stringify(rows);
  ok("記録は「だれか（元に戻せない形）・日・回数」だけ", rows.every(r => Object.keys(r).sort().join() === "day,n,uid" && /^[0-9a-f]{64}$/.test(r.uid)), dump.slice(0, 120));
  ok("メールアドレスも Google の番号も話した中身も、記録に無い", !/example\.com|u1|u2|会議/.test(dump));
  const src = readFileSync(new URL("./src/index.js", import.meta.url), "utf8");
  ok("サーバーは console に何も書かない（中身をログに出さない）", !/console\.(log|info|warn|error|debug)/.test(src));
  const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
  ok("ログの保存（observability）を切ってある", /\[observability\]\s*\nenabled = false/.test(toml));
  ok("wrangler.toml にキーを書いていない", !/GEMINI_KEY\s*=/.test(toml));
  ok("ブラウザから直接呼ばせない（CORS の許可を出さない）", !/access-control-allow-origin/i.test(src));
}

// ⑤ 古い回数は消す
{
  D1 = fakeD1();
  D1.raw.prepare("INSERT INTO usage VALUES ('a','2026-09-20',3)").run();
  D1.raw.prepare("INSERT INTO usage VALUES ('b','2026-09-27',3)").run();
  resetSweep();
  const later = await handle(req("/v1/generate", { tok: await token(good("u9", { exp: nowSec + 9 * 86400 })) }), env(), fetchImpl, NOW + 86400000);   // 次の日にして sweep を走らせる
  const days = D1.raw.prepare("SELECT day FROM usage ORDER BY day").all().map(r => r.day);
  ok("2日より古い回数の記録は消す（新しいものは残す）", later.status === 200 && !days.includes("2026-09-20") && days.includes("2026-09-27"), later.status + " " + days.join());
}

// ⑥ プライバシーポリシー
{
  const free = privacyHTML(env()), paid = privacyHTML(Object.assign(env(), { GEMINI_TIER: "paid" }));
  ok("無料枠なら「Google が改善に使い、担当者が読むことがある」と書く", /改善に使うことがあり/.test(free) && /読むことがあります/.test(free));
  ok("有料なら「改善には使わない」と書く（無料の文は出さない）", /改善には使わない/.test(paid) && !/読むことがあります/.test(paid));
  ok("記録はスマホの中・サーバーは中身を保存しない・カレンダーはサーバーを通らない、と書く",
    /スマホの中にだけ保存/.test(free) && /中身を保存しません/.test(free) && /運営者のサーバーは通りません/.test(free));
  ok("問い合わせ先を出す（文字は逃がす）", /me@example\.com/.test(free) && !/<script/.test(privacyHTML(Object.assign(env(), { CONTACT_EMAIL: "<script>x</script>" }))));
  const r = await handle(new Request("https://hitohi.example/privacy"), env(), fetchImpl, NOW);
  ok("/privacy で開ける（ログイン無し）", r.status === 200 && /text\/html/.test(r.headers.get("content-type")));
}

// ⑦ Gemini が混んでいるときは、その番号を返す（アプリが1回だけ待って入れ直す）
{
  D1 = fakeD1(); geminiStatus = 503;
  const t5 = await token(good("u5"));
  const r = await call("/v1/generate", { tok: t5 });
  ok("Gemini の 503 はそのまま返す", r.status === 503);
  const cnt = () => { const x = D1.raw.prepare("SELECT n FROM usage").get(); return x ? x.n : 0; };
  ok("向こうの都合（503）で失敗した1回は、数えない", cnt() === 0 && r.headers.get("x-hitohi-remaining") === "40", cnt());
  geminiStatus = 429;
  await call("/v1/generate", { tok: t5 });
  ok("Gemini が混んでいた（429）1回も、数えない", cnt() === 0, cnt());
  geminiStatus = 400;
  await call("/v1/generate", { tok: t5 });
  ok("送り方の間違い（400）は数える（ただで何度も試させない）", cnt() === 1, cnt());
  geminiStatus = 200;
  await call("/v1/generate", { tok: t5 });
  ok("うまくいった1回は数える", cnt() === 2, cnt());
  const down = await handle(req("/v1/generate", { tok: t5 }), env(), async u => { if (String(u).includes("certs")) return fetchImpl(u); throw new Error("net"); }, NOW);
  ok("Gemini へつながらなかった1回は、数えない（502）", down.status === 502 && cnt() === 2, down.status + " / " + cnt());
}

// ⑧ AI の文の報告（Google Play の AI 生成コンテンツのポリシー）
{
  D1 = fakeD1(); sent.length = 0; resetSweep();
  const t8 = await token(good("u8"));
  const rp = (body, tok = t8, now = NOW) => handle(req("/v1/report", { tok, body }), env(), fetchImpl, now);
  const r1 = await rp({ kind: "chat", reason: "offensive", text: "  不快な返事の例  " });
  const rows = () => D1.raw.prepare("SELECT * FROM reports ORDER BY id").all();
  ok("報告を受け取って残す（AI の文と理由だけ）", r1.status === 200 && rows().length === 1 && rows()[0].text === "不快な返事の例" && rows()[0].reason === "offensive" && rows()[0].kind === "chat", r1.status);
  ok("報告には、だれが送ったかを入れない（列は id・at・kind・reason・text だけ）", Object.keys(rows()[0]).sort().join() === "at,id,kind,reason,text", Object.keys(rows()[0]).join());
  ok("報告しても、Gemini は呼ばない・AI の回数は減らない", sent.length === 0 && D1.raw.prepare("SELECT COUNT(*) AS c FROM usage").get().c === 0);
  ok("ログインしていなければ報告できない（401）", (await handle(req("/v1/report", { body: { kind: "chat", reason: "other", text: "x" } }), env(), fetchImpl, NOW)).status === 401);
  ok("知らない理由は受け取らない（400）", (await rp({ kind: "chat", reason: "hack", text: "x" })).status === 400);
  ok("知らない種類は受け取らない（400）", (await rp({ kind: "user_note", reason: "other", text: "x" })).status === 400);
  ok("空の文・長すぎる文は受け取らない（400）", (await rp({ kind: "chat", reason: "other", text: "   " })).status === 400 && (await rp({ kind: "chat", reason: "other", text: "あ".repeat(2001) })).status === 400);
  ok("報告の中身を絞る関数：余計な項目は落とす", JSON.stringify(cleanReport({ kind: "insight", reason: "wrong", text: "t", uid: "x", note: "私の話" })) === '{"kind":"insight","reason":"wrong","text":"t"}');
  for (let i = 0; i < 19; i++) await rp({ kind: "chat", reason: "wrong", text: "例" + i });
  const over = await rp({ kind: "chat", reason: "wrong", text: "21件目" });
  ok("1人1日20件まで。超えたら 429（report_limit）で残さない", over.status === 429 && (await over.json()).error.code === "report_limit" && rows().length === 20, rows().length);
  const dump = JSON.stringify(D1.raw.prepare("SELECT * FROM reports").all()) + JSON.stringify(D1.raw.prepare("SELECT * FROM report_count").all());
  ok("報告の記録に、メールアドレスも Google の番号も無い", !/example\.com|u8/.test(dump));
  // 90日たった報告は消す・新しいものは残す。報告の回数は2日で消す
  D1.raw.prepare("INSERT INTO reports (at, kind, reason, text) VALUES ('2026-06-01T00:00:00.000Z','chat','other','古い報告')").run();
  D1.raw.prepare("INSERT INTO report_count VALUES ('old','2026-09-20',3)").run();
  resetSweep();
  const later = await rp({ kind: "chat", reason: "other", text: "次の日の報告" }, await token(good("u9", { exp: nowSec + 9 * 86400 })), NOW + 86400000);
  const texts = rows().map(r => r.text);
  ok("90日より古い報告は消す（新しいものは残す）", later.status === 200 && !texts.includes("古い報告") && texts.includes("例0") && texts.includes("次の日の報告"), later.status + " " + texts.length);
  ok("報告の回数の記録は2日で消す", !D1.raw.prepare("SELECT uid FROM report_count").all().some(r => r.uid === "old"));
  const pv = privacyHTML(env());
  ok("プライバシーポリシーに、報告で残すもの・だれが送ったかを入れないこと・90日で消すことを書く",
    /AI の文を報告したとき/.test(pv) && /その AI の文と、選んだ理由だけ/.test(pv) && /だれが送ったかを入れません/.test(pv) && /90日たつと消えます/.test(pv));
}

const fails = R.filter(x => x.startsWith("FAIL"));
console.log(R.join("\n") + `\n\nserver: 合計 ${R.length} 件 / 失敗 ${fails.length} 件`);
process.exitCode = fails.length ? 1 : 0;
