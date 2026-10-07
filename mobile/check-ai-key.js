/*
  焼き込む AI のキーが本当に使えるかを、組み立てる前に確かめる（GitHub Actions の「APKを作る」から呼ぶ・2026-10-07）。

  **なぜ要るのか**：使えないキーを焼き込んだ APK を入れると、更新したとたん AI が使えなくなる（チャットで渡されたキーが
  「API key not valid」だったことが実際にあった）。組み立ては10〜20分かかるので、先に1回だけ確かめて止める。

  確かめ方は**お金のかからない問い合わせ**だけ（モデルの情報を読む。文章は作らせない）：
    gemini … GET https://generativelanguage.googleapis.com/v1beta/models/{model}   （キーはヘッダー x-goog-api-key）
    claude … GET https://api.anthropic.com/v1/models/{model}                       （キーはヘッダー x-api-key）
  キーは URL にもログにも出さない。出すのは提供元・モデル・キーの末尾4文字・HTTP の状態だけ。

    node check-ai-key.js   … HITOHI_AI_KEY / HITOHI_AI_PROVIDER / HITOHI_AI_MODEL を読む。だめなら終了コード 1
*/
const KEY = process.env.HITOHI_AI_KEY || "";
const PROVIDER = (process.env.HITOHI_AI_PROVIDER || "claude").trim();
const MODEL = (process.env.HITOHI_AI_MODEL || "").trim();
const BASE = {                                       // テストでだけ差し替える
  gemini: process.env.GEMINI_CHECK_URL || "https://generativelanguage.googleapis.com/v1beta",
  claude: process.env.CLAUDE_CHECK_URL || "https://api.anthropic.com/v1",
};

function stop(msg) {
  console.log("::error::" + msg);
  process.exit(1);
}

(async () => {
  if (!KEY) stop("Secrets に HITOHI_AI_KEY がありません。");
  if (!BASE[PROVIDER]) stop("HITOHI_AI_PROVIDER は gemini か claude にしてください（いまは「" + PROVIDER + "」）。");
  if (MODEL && !/^[A-Za-z0-9._-]+$/.test(MODEL)) stop("HITOHI_AI_MODEL の形が違います（「" + MODEL + "」）。");

  const url = PROVIDER === "gemini"
    ? BASE.gemini + (MODEL ? "/models/" + MODEL : "/models?pageSize=1")
    : BASE.claude + (MODEL ? "/models/" + MODEL : "/models?limit=1");
  const headers = PROVIDER === "gemini"
    ? { "x-goog-api-key": KEY }
    : { "x-api-key": KEY, "anthropic-version": "2023-06-01" };

  let res;
  try { res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) }); }
  catch (e) { stop("AI の提供元につながりませんでした（" + (e && e.message || e) + "）。少し待ってもう一度押してください。"); }

  let why = "";
  try {
    const b = await res.json();
    why = String((b && b.error && b.error.message) || "").replace(new RegExp(KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "****");
  } catch (e) { /* 理由が読めなくても状態で分ける */ }

  const who = PROVIDER + (MODEL ? " / " + MODEL : "") + " / ****" + KEY.slice(-4);
  if (res.ok) { console.log("AI のキーは使えます（" + who + "）。"); return; }
  if (res.status === 404 && MODEL) stop("モデル「" + MODEL + "」が見つかりません（" + who + "）。Variables の HITOHI_AI_MODEL を確かめてください。" + (why ? "（" + why + "）" : ""));
  if ([400, 401, 403].includes(res.status)) stop("AI のキーが使えません（" + who + "・HTTP " + res.status + "）。Secrets の HITOHI_AI_KEY を入れ直してください。" + (why ? "（" + why + "）" : ""));
  if (res.status === 429) stop("AI の提供元が混んでいるか、使える量を超えています（HTTP 429）。少し待ってもう一度押してください。");
  stop("AI のキーを確かめられませんでした（HTTP " + res.status + "）。少し待ってもう一度押してください。" + (why ? "（" + why + "）" : ""));
})().catch(e => stop("キーを確かめる途中で止まりました（" + (e && e.message || e) + "）。"));
