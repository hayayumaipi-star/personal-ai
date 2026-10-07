/*
  このアプリの Expo 上の番号（projectId）を、Expo のトークンで探す（GitHub Actions の「APKを作る」から呼ぶ・2026-10-07）。

  **なぜ要るのか**：スマホだけで APK を作るとき、本人がやることを Secrets 2つ（EXPO_TOKEN・HITOHI_AI_KEY）だけにしたい。
  番号は本人のパソコンの `mobile/eas.local.json` にしか無く、スマホから見つけて入れるのは手間がかかる。
  Expo はアカウントごとに「@アカウント/slug」で1つのプロジェクトを持つので、トークンの持ち主のアカウントで探せば同じ番号が出る。

  **新しいプロジェクトを作らない**（ここがいちばん大事）：別のプロジェクトで作ると署名の鍵が変わり、
  今のアプリに上書きで入らず、入れ直すと記録（端末の中だけにある）が消える。だから
    - 見つからない・2つ以上見つかる・答えの形が違う → **止める**（Variables に EAS_PROJECT_ID を入れてもらう）
    - `eas init` も、番号の無いままの `eas build` も使わない（作ってしまう道があるため）
  Variables に EAS_PROJECT_ID があれば、それが勝つ（ここは呼ばれない）。

  見つけた番号は秘密ではないのでログに出す（本人が Variables に固定したくなったとき写せるように）。トークンは出さない。

    node find-eas-project.js     … 見つけたら $GITHUB_ENV に EAS_PROJECT_ID と EXPO_OWNER を書く。だめなら終了コード 1
*/
const fs = require("fs");
const path = require("path");

const URL_ = process.env.EXPO_GRAPHQL_URL || "https://api.expo.dev/graphql";   // テストでだけ差し替える
const TOKEN = process.env.EXPO_TOKEN || "";
const OWNER = (process.env.EXPO_OWNER || "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function stop(msg) {
  console.log("::error::" + msg);
  process.exit(1);
}

async function gql(query, variables) {
  let res;
  try {
    res = await fetch(URL_, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + TOKEN },
      body: JSON.stringify({ query, variables: variables || {} }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    stop("Expo につながりませんでした（" + (e && e.message || e) + "）。少し待ってもう一度押してください。");
  }
  let body = null;
  try { body = await res.json(); } catch (e) { /* 下で止める */ }
  if (res.status === 401 || res.status === 403) stop("Expo のトークン（EXPO_TOKEN）が使えません。expo.dev の Access tokens で作り直して、Secrets に入れ直してください。");
  if (!body || typeof body !== "object") stop("Expo の答えが読めませんでした（HTTP " + res.status + "）。");
  return body;
}

const errText = b => (Array.isArray(b.errors) ? b.errors.map(e => String(e && e.message || "")).join(" / ") : "");
const notFound = b => Array.isArray(b.errors) && b.errors.length > 0 && b.errors.every(e => {
  const code = e && e.extensions && e.extensions.errorCode;
  return code === "EXPERIENCE_NOT_FOUND" || /not\s*found|does not exist|could not find/i.test(String(e && e.message || ""));
});

(async () => {
  if (!TOKEN) stop("Secrets に EXPO_TOKEN がありません。");
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, "app.json"), "utf8").replace(/^﻿/, ""));
  const slug = app && app.expo && app.expo.slug;
  if (!slug || !/^[A-Za-z0-9._-]+$/.test(slug)) stop("app.json の slug が読めません。");

  // どのアカウントで探すか：Variables の EXPO_OWNER があればそれだけ、無ければトークンの持ち主が入れるアカウント全部
  let owners = OWNER ? [OWNER] : null;
  if (!owners) {
    const me = await gql("query { meActor { accounts { name } } }");
    const list = me && me.data && me.data.meActor && Array.isArray(me.data.meActor.accounts) ? me.data.meActor.accounts : null;
    if (!list) stop("Expo からアカウントを読めませんでした（" + (errText(me) || "答えの形が違います") + "）。Variables に EAS_PROJECT_ID を入れてください。");
    owners = list.map(a => a && a.name).filter(n => typeof n === "string" && /^[A-Za-z0-9._-]+$/.test(n));
    if (!owners.length) stop("Expo のアカウントが見つかりませんでした。Variables に EAS_PROJECT_ID を入れてください。");
  }

  const found = [];
  for (const owner of owners) {
    const fullName = "@" + owner + "/" + slug;
    const b = await gql("query ($fullName: String!) { app { byFullName(fullName: $fullName) { id } } }", { fullName });
    const id = b && b.data && b.data.app && b.data.app.byFullName && b.data.app.byFullName.id;
    if (typeof id === "string" && UUID.test(id)) { found.push({ owner, id }); continue; }
    if (notFound(b) || (b.data && b.data.app && b.data.app.byFullName === null)) continue;
    stop("Expo で " + fullName + " を探せませんでした（" + (errText(b) || "答えの形が違います") + "）。Variables に EAS_PROJECT_ID を入れてください。");
  }

  if (found.length === 0) {
    stop("Expo に「" + slug + "」のプロジェクトが見つかりません（探したアカウント：" + owners.join("・") + "）。" +
         "新しく作ると署名が変わり、今のアプリに上書きで入らないので、ここで止めます。パソコンの mobile\\eas.local.json の projectId を Variables の EAS_PROJECT_ID に入れてください。");
  }
  if (found.length > 1) {
    stop("「" + slug + "」が2つ以上のアカウントにあります（" + found.map(f => "@" + f.owner).join("・") + "）。どれか分からないので止めます。Variables に EAS_PROJECT_ID と EXPO_OWNER を入れてください。");
  }

  const { owner, id } = found[0];
  console.log("このアプリの番号を見つけました：@" + owner + "/" + slug + " = " + id);
  console.log("（固定したいときは Variables の EAS_PROJECT_ID にこの番号を入れてください）");
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, "EAS_PROJECT_ID=" + id + "\nEXPO_OWNER=" + owner + "\n");
})().catch(e => stop("番号を探す途中で止まりました（" + (e && e.message || e) + "）。"));
