/* ===========================================================================
   AI秘書 — AI の中継サーバー（Cloudflare Workers）  2026-09-28・決まり18

   **配ったアプリに、AIのキーを入れないため**のサーバーです。
   アプリ（の殻）は「Google でログインした証明（ID トークン）」を付けて頼み、
   ここがそれを確かめてから、**ここだけが持つキー**で Gemini を呼びます。

   守っていること：
   - **話した中身を残さない。** 記録するのは「だれか（Google の番号を元に戻せない形に変えたもの）が、
     その日に何回使ったか」だけ。中身は Gemini へ渡して返すだけで、ここには書かない・ログにも出さない。
   - **1人1日 DAILY_LIMIT 回まで**（既定 40）。超えたら 429 と `daily_limit` を返す（アプリは入れ直さない）。
   - **使うモデルはここが決める**（GEMINI_MODEL）。アプリから高いモデルを選ばせない。
   - **送れる中身を絞る**：`contents` と `generationConfig` だけを Gemini へ渡す。大きさにも上限。
   - **ブラウザから直接呼ばせない**（CORS の許可を出さない）。呼ぶのは Android アプリの殻だけ。
   - **AI の文の報告**（Google Play の AI 生成コンテンツのポリシー）：本人が「報告」を押した **AI の文と理由だけ**を
     `reports` に残す（**だれが送ったかは入れない**）。90日で消す。1人1日 REPORT_LIMIT 件まで（数えるのは別の表で2日だけ）。

   設定（wrangler.toml の [vars] と secret）：
     GEMINI_KEY        … Gemini の API キー（`wrangler secret put GEMINI_KEY`・**ファイルに書かない**）
     GOOGLE_CLIENT_ID  … Google Cloud の「ウェブ アプリケーション」のクライアント ID（ID トークンの宛先）
     GEMINI_MODEL      … 使うモデル
     GEMINI_TIER       … "free" か "paid"。**プライバシーポリシーの文が変わる**（無料枠は Google が中身を改善に使う）
     DAILY_LIMIT       … 1人1日の上限（回）
     DAY_OFFSET_MIN    … 「1日」の区切りの時差（分・既定 540＝日本時間）
     CONTACT_EMAIL     … 問い合わせ先（プライバシーポリシーに出る）
     APP_NAME          … アプリの名前
   D1（DB）… usage(uid, day, n)・report_count(uid, day, n)・reports(id, at, kind, reason, text)。schema.sql。
   =========================================================================== */

const GEMINI_HOST = "https://generativelanguage.googleapis.com";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const MAX_BODY = 250000;          // 1回に受け取る大きさ（文字）
const KEEP_DAYS = 2;              // 回数の記録を残す日数（それより古いものは消す）
const REPORT_KEEP_DAYS = 90;      // 報告を残す日数
const REPORT_LIMIT = 20;          // 1人1日の報告の上限
const REPORT_MAX_CHARS = 2000;    // 報告する文の長さの上限
export const REPORT_REASONS = ["offensive", "harmful", "wrong", "other"];
const REPORT_KINDS = ["chat", "insight"];

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status, headers: Object.assign({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, extra)
});
const fail = (status, code, message) => json({ error: { code, message } }, status);

/* ---------- Google の ID トークンを確かめる ---------- */
let jwksCache = { at: 0, ttl: 0, keys: [] };
export function resetJwksCache() { jwksCache = { at: 0, ttl: 0, keys: [] }; }
async function jwks(fetchImpl) {
  const now = Date.now();
  if (jwksCache.keys.length && now - jwksCache.at < jwksCache.ttl) return jwksCache.keys;
  const r = await fetchImpl(JWKS_URL);
  if (!r.ok) throw new Error("jwks " + r.status);
  const d = await r.json();
  const m = /max-age=(\d+)/.exec(r.headers.get("cache-control") || "");
  jwksCache = { at: now, ttl: Math.min(m ? +m[1] * 1000 : 3600000, 6 * 3600000), keys: d.keys || [] };
  return jwksCache.keys;
}
const b64u = s => {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
};
const b64uJSON = s => JSON.parse(new TextDecoder().decode(b64u(s)));
/* 返すのは claims（中身）か、確かめられなかった理由（文字）。**例外は投げない**（理由を言うため）。 */
export async function verifyIdToken(token, env, fetchImpl = fetch, nowSec = Math.floor(Date.now() / 1000)) {
  const p = String(token || "").split(".");
  if (p.length !== 3) return "形が違う";
  let head, claims;
  try { head = b64uJSON(p[0]); claims = b64uJSON(p[1]); } catch { return "読めない"; }
  if (head.alg !== "RS256" || !head.kid) return "署名の種類が違う";
  const keys = await jwks(fetchImpl);
  let jwk = keys.find(k => k.kid === head.kid);
  if (!jwk) { resetJwksCache(); jwk = (await jwks(fetchImpl)).find(k => k.kid === head.kid); }   // Google が鍵を替えた直後
  if (!jwk) return "鍵が見つからない";
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(p[2]), new TextEncoder().encode(p[0] + "." + p[1]));
  if (!ok) return "署名が合わない";
  if (!ISSUERS.includes(claims.iss)) return "発行元が違う";
  const auds = String(env.GOOGLE_CLIENT_ID || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!auds.length || !auds.includes(claims.aud)) return "宛先が違う";
  if (!(claims.exp > nowSec - 60)) return "期限切れ";
  if (!claims.sub) return "だれか分からない";
  return claims;
}
/* 利用者の番号は、**元に戻せない形**にしてから使う（メールアドレスも Google の番号も残さない）。 */
export async function userKey(claims) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("hitohi:" + claims.iss + ":" + claims.sub));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- 1日の回数 ---------- */
export function dayOf(env, nowMs = Date.now()) {
  const off = Number.isFinite(+env.DAY_OFFSET_MIN) ? +env.DAY_OFFSET_MIN : 540;
  return new Date(nowMs + off * 60000).toISOString().slice(0, 10);
}
const limitOf = env => { const n = parseInt(env.DAILY_LIMIT, 10); return n > 0 ? n : 40; };
async function usedToday(env, uid, day) {
  const r = await env.DB.prepare("SELECT n FROM usage WHERE uid = ?1 AND day = ?2").bind(uid, day).first();
  return r ? r.n : 0;
}
/* 数えてから呼ぶ。**上限を超えていたら数えない**（1回ぶん損させない）。 */
async function takeOne(env, uid, day, limit) {
  const r = await env.DB.prepare(
    "INSERT INTO usage (uid, day, n) VALUES (?1, ?2, 1) ON CONFLICT(uid, day) DO UPDATE SET n = n + 1 WHERE n < ?3 RETURNING n"
  ).bind(uid, day, limit).first();
  return r ? r.n : null;          // null＝もう上限（更新されなかった）
}
/* **向こうの都合で失敗した1回は、返す**（Gemini が混んでいる 429・向こうの故障 5xx・つながらない）。
   全員で1つのキーを使うので、混雑は起きやすい。アプリは混雑のとき1回だけ入れ直すので、返さないと2回ぶん損をする。
   送り方の間違い（400 など）は返さない（何度でもただで試せてしまう）。 */
async function giveBack(env, uid, day) {
  await env.DB.prepare("UPDATE usage SET n = n - 1 WHERE uid = ?1 AND day = ?2 AND n > 0").bind(uid, day).run();
}
const notTheirFault = st => st === 429 || st >= 500;
let lastSweep = "";
export function resetSweep() { lastSweep = ""; }   // テスト用（同じ日に2回消しに行かないための覚えを戻す）
async function sweep(env, day) {
  if (lastSweep === day) return;
  lastSweep = day;
  const base = Date.parse(day + "T00:00:00Z");
  const old = new Date(base - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  await env.DB.prepare("DELETE FROM usage WHERE day < ?1").bind(old).run();
  await env.DB.prepare("DELETE FROM report_count WHERE day < ?1").bind(old).run();
  await env.DB.prepare("DELETE FROM reports WHERE at < ?1").bind(new Date(base - REPORT_KEEP_DAYS * 86400000).toISOString()).run();
}

/* ---------- AI の文の報告 ---------- */
/* 受け取るのは { kind, reason, text } だけ。**知らない理由・種類・長すぎる文は受け取らない**（来た文字はデータ）。 */
export function cleanReport(input) {
  if (!input || typeof input !== "object") return null;
  const kind = String(input.kind || ""), reason = String(input.reason || "");
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!REPORT_KINDS.includes(kind) || !REPORT_REASONS.includes(reason)) return null;
  if (!text || text.length > REPORT_MAX_CHARS) return null;
  return { kind, reason, text };
}
async function takeReport(env, uid, day) {
  const r = await env.DB.prepare(
    "INSERT INTO report_count (uid, day, n) VALUES (?1, ?2, 1) ON CONFLICT(uid, day) DO UPDATE SET n = n + 1 WHERE n < ?3 RETURNING n"
  ).bind(uid, day, REPORT_LIMIT).first();
  return r ? r.n : null;
}

/* ---------- Gemini へ ---------- */
/* 送ってよい中身だけを残す。`contents`（本文）と `generationConfig`（考える深さ・JSON で返す）だけ。 */
export function cleanRequest(input) {
  const b = input && typeof input === "object" ? input.body : null;
  if (!b || !Array.isArray(b.contents) || !b.contents.length) return null;
  const out = { contents: b.contents };
  if (b.generationConfig && typeof b.generationConfig === "object" && !Array.isArray(b.generationConfig)) out.generationConfig = b.generationConfig;
  return out;
}
async function callGemini(env, body, fetchImpl) {
  const model = String(env.GEMINI_MODEL || "gemini-3.5-flash-lite");
  return fetchImpl(`${GEMINI_HOST}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": String(env.GEMINI_KEY || "") },
    body: JSON.stringify(body)
  });
}

/* ---------- プライバシーポリシー ---------- */
export function privacyHTML(env) {
  const app = esc(env.APP_NAME || "AI秘書"), contact = esc(env.CONTACT_EMAIL || "（未設定）");
  const paid = String(env.GEMINI_TIER || "free") === "paid";
  const gem = paid
    ? "Google は、有料で使っている API に送られた内容を、自社の製品の改善には使わないとしています。"
    : "<strong>いまは Gemini API の無料枠を使っているため、Google は送られた内容と返事を自社の製品の改善に使うことがあり、Google の担当者がそれを読むことがあります。</strong>見られて困ることは話さないでください。";
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${app} プライバシーポリシー</title><style>body{font:16px/1.8 system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px 16px;color:#1b2422;background:#fbfdfc}h1{font-size:22px}h2{font-size:18px;margin-top:28px}</style></head><body>
<h1>${app} プライバシーポリシー</h1>
<h2>記録はあなたのスマホの中にあります</h2>
<p>話した内容・予定・タスク・体調・「わたしのこと」は、あなたのスマホの中にだけ保存されます。運営者のサーバーには保存しません。</p>
<h2>AI を使うときに送るもの</h2>
<p>話した内容を読み取るために、AI（Google の Gemini）を使います。そのとき、話した内容と、読み取りに必要なこれまでの予定などの要約が、運営者の中継サーバーを通って Google に送られます。</p>
<p>中継サーバーは中身を保存しません（下の「報告」を除く）。記録するのは「その日に何回 AI を使ったか」だけで、あなたを特定できない形（Google アカウントの番号を元に戻せない形に変えたもの）で、${KEEP_DAYS}日たつと消えます。</p>
<p>${gem}</p>
<h2>AI の文を報告したとき</h2>
<p>AI の返事に「報告」を押すと、<strong>その AI の文と、選んだ理由だけ</strong>が運営者のサーバーに保存されます。あなたの話した内容・記録・アカウントは一緒に送りません。報告の記録には、だれが送ったかを入れません（送りすぎを防ぐために、1日の報告の回数だけを${KEEP_DAYS}日間数えます）。</p>
<p>報告は運営者が読み、AI の使い方を直すために使います。${REPORT_KEEP_DAYS}日たつと消えます。</p>
<h2>Google でのログイン</h2>
<p>AI を使うには Google でログインします。ログインで受け取るのは、あなたが本人であることの証明だけで、中継サーバーはメールアドレスを保存しません。</p>
<h2>Google カレンダーとの同期（選んだ人だけ）</h2>
<p>設定で同期を選ぶと、あなたの Google カレンダー（メイン）の予定を読み、アプリで話した予定を書き込みます。この通信はあなたのスマホと Google の間で直接行われ、運営者のサーバーは通りません。同期はいつでもやめられます。</p>
<h2>消したいとき</h2>
<p>アプリの設定の「記録を消す」で、スマホの中の記録を消せます。アプリを消すと、スマホの中の記録もすべて消えます。中継サーバーの回数の記録は${KEEP_DAYS}日、報告は${REPORT_KEEP_DAYS}日で自動的に消えます（報告にはだれが送ったかが入っていないので、1件ずつ選んで消すことはできません）。</p>
<h2>問い合わせ</h2>
<p>${contact}</p>
</body></html>`;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- 入口 ---------- */
export async function handle(request, env, fetchImpl = fetch, nowMs = Date.now()) {
  const url = new URL(request.url);
  if (request.method === "GET" && (url.pathname === "/privacy" || url.pathname === "/privacy/")) {
    return new Response(privacyHTML(env), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (request.method === "GET" && url.pathname === "/") return new Response((env.APP_NAME || "AI秘書") + " のサーバーです。", { headers: { "content-type": "text/plain; charset=utf-8" } });
  if (!["/v1/generate", "/v1/status", "/v1/report"].includes(url.pathname)) return fail(404, "not_found", "ありません");

  const auth = request.headers.get("authorization") || "";
  const tok = /^Bearer\s+(.+)$/i.exec(auth);
  if (!tok) return fail(401, "login_required", "Google でのログインが必要です");
  let claims;
  try { claims = await verifyIdToken(tok[1], env, fetchImpl, Math.floor(nowMs / 1000)); }
  catch { return fail(503, "auth_unavailable", "ログインを確かめられませんでした。少し時間をおいてください"); }
  if (typeof claims === "string") return fail(401, "login_required", "ログインを確かめられませんでした（" + claims + "）");
  const uid = await userKey(claims), day = dayOf(env, nowMs), limit = limitOf(env);

  if (url.pathname === "/v1/status") {
    if (request.method !== "GET") return fail(405, "method", "GET だけです");
    const used = await usedToday(env, uid, day);
    return json({ limit, used, remaining: Math.max(0, limit - used), tier: String(env.GEMINI_TIER || "free"), day });
  }
  if (request.method !== "POST") return fail(405, "method", "POST だけです");
  if (url.pathname === "/v1/report") {
    const rawR = await request.text();
    if (rawR.length > REPORT_MAX_CHARS * 4) return fail(413, "too_large", "報告する文が長すぎます");
    let inR; try { inR = JSON.parse(rawR); } catch { return fail(400, "bad_json", "送る中身が読めません"); }
    const rep = cleanReport(inR);
    if (!rep) return fail(400, "bad_request", "報告の中身が足りないか、形が違います");
    if ((await takeReport(env, uid, day)) == null) return fail(429, "report_limit", `今日はこれ以上報告できません（1日${REPORT_LIMIT}件まで）`);
    await env.DB.prepare("INSERT INTO reports (at, kind, reason, text) VALUES (?1, ?2, ?3, ?4)")
      .bind(new Date(nowMs).toISOString(), rep.kind, rep.reason, rep.text).run();
    try { await sweep(env, day); } catch {}
    return json({ ok: true });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY) return fail(413, "too_large", "送る中身が大きすぎます");
  let input; try { input = JSON.parse(raw); } catch { return fail(400, "bad_json", "送る中身が読めません"); }
  const body = cleanRequest(input);
  if (!body) return fail(400, "bad_request", "送る中身が足りません");

  const n = await takeOne(env, uid, day, limit);
  if (n == null) return fail(429, "daily_limit", `今日のAIの回数（${limit}回）を使い切りました。明日また使えます`);
  try { await sweep(env, day); } catch {}
  let r, used = n;
  try { r = await callGemini(env, body, fetchImpl); }
  catch { try { await giveBack(env, uid, day); } catch {} return fail(502, "upstream", "AI（Gemini）へつながりませんでした"); }
  if (notTheirFault(r.status)) { try { await giveBack(env, uid, day); used = n - 1; } catch {} }
  const text = await r.text();
  /* Gemini の返事はそのまま返す（中身はアプリが読む）。**ここでは読まない・残さない。** */
  return new Response(text, { status: r.status, headers: { "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store", "x-hitohi-remaining": String(Math.max(0, limit - used)) } });
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch { return fail(500, "server", "サーバーでつまずきました"); }   // 中身はログに出さない
  }
};
