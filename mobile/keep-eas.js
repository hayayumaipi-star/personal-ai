/*
  EAS が app.json に書き足す「このアプリの Expo 上の番号」を、git の更新とぶつけずに持ち越す。

  **なぜ要るのか**（2026-09-26・実機で止まった）：
  初めて `eas build` を通すと、Expo は `app.json` に `extra.eas.projectId`（と `owner`）を**書き足す**。
  その後こちらが `app.json` を直して push すると（通知の許可を足した・アイコンの色を変えた）、
  本人のパソコンの `git pull` が「手元の変更が上書きされる」で**止まる**。
  止まると古い中身の APK しか作れない——このプロジェクトでいちばん避けたい壊れ方。

  **番号をリポジトリに入れない理由**：これは**その人の** Expo のプロジェクトの番号で、
  配った相手のものではない（決まり11「その人ひとり専用の仕組みを作らない」）。
  だから手元の `eas.local.json`（`.gitignore` の `*.local.json`）に預けて、更新のたびに戻す。

  **番号を失くさない理由**：番号が消えても Expo は同じ名前のプロジェクトを探し直すが、
  別のプロジェクトとして作り直すと**署名の鍵が変わり**、スマホに上書きで入らない。
  入れ直すにはアプリを消すしかなく、**記録（端末の中だけにある）が消える**。

    node keep-eas.js save     … 番号を預ける。app.json の書き換えが番号だけなら、git の版に戻す
                                （npm が書き換えた package-lock.json も戻す。直後の npm install が作り直す）
    node keep-eas.js restore  … 預けた番号を app.json に戻す（無ければ何もしない）

  **番号以外の書き換えがあるときは、触らない**（終了コード 3）。本人の手の変更を黙って消さない。
*/
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const APP = path.join(__dirname, "app.json");
const KEEP = path.join(__dirname, "eas.local.json");
const ROOT = path.join(__dirname, "..");

const readJSON = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
const writeJSON = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n", "utf8");
const git = (...args) => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// 預けるもの：Expo が書き足すのはこの2つ
function pick(j) {
  const e = (j && j.expo) || {};
  const out = {};
  if (e.extra && e.extra.eas && typeof e.extra.eas === "object") out.eas = e.extra.eas;
  if (typeof e.owner === "string" && e.owner) out.owner = e.owner;
  return out;
}
// 番号を除いた中身（比べるため）
function strip(j) {
  const c = JSON.parse(JSON.stringify(j || {}));
  const e = c.expo || {};
  if (e.extra) { delete e.extra.eas; if (!Object.keys(e.extra).length) delete e.extra; }
  delete e.owner;
  return c;
}
// 並び順の違いは同じとみなす
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.keys(v).sort().reduce((o, k) => (o[k] = canon(v[k]), o), {});
  return v;
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function save() {
  /* **npm install が書き換える package-lock.json も同じ形でぶつかる**（同じ形の例外は全部数える）。
     手で触るファイルではなく、更新のすぐあとの `npm install` が作り直すので、元の版へ戻してよい。 */
  try {
    if (git("status", "--porcelain", "--", "mobile/package-lock.json").trim() !== "") {
      git("checkout", "--", "mobile/package-lock.json");
      console.log("mobile/package-lock.json を元に戻しました（このあとの準備で作り直します）。");
    }
  } catch { /* git が無い・リポジトリでない */ }
  let local;
  try { local = readJSON(APP); } catch (e) { console.log("mobile/app.json を読めませんでした（" + e.message + "）。触らずに進みます。"); return 3; }
  const keep = pick(local);
  if (Object.keys(keep).length) {
    let prev = {};
    try { prev = readJSON(KEEP); } catch { prev = {}; }
    if (!same(prev, keep)) writeJSON(KEEP, keep);
  }
  let changed = false;
  try { changed = git("status", "--porcelain", "--", "mobile/app.json").trim() !== ""; }
  catch { return 0; }                                     // git が無い・リポジトリでない：何もしない
  if (!changed) return 0;
  let head;
  try { head = JSON.parse(git("show", "HEAD:mobile/app.json").replace(/^﻿/, "")); }
  catch { console.log("mobile/app.json の元の版を読めませんでした。触らずに進みます。"); return 3; }
  if (!same(strip(local), strip(head))) {
    console.log("mobile/app.json に、Expo の番号以外の書き換えがあります。消さないように、触らずに進みます。");
    return 3;
  }
  git("checkout", "--", "mobile/app.json");
  if (Object.keys(keep).length) console.log("Expo の番号を mobile/eas.local.json に預けました（更新のあとで戻します）。");
  return 0;
}

function restore() {
  if (!fs.existsSync(KEEP)) return 0;
  let keep, j;
  try { keep = readJSON(KEEP); j = readJSON(APP); } catch (e) { console.log("Expo の番号を戻せませんでした（" + e.message + "）。"); return 3; }
  if (!j.expo || typeof j.expo !== "object") return 3;
  let touched = false;
  if (keep.eas && typeof keep.eas === "object") {
    j.expo.extra = j.expo.extra || {};
    if (!same(j.expo.extra.eas, keep.eas)) { j.expo.extra.eas = keep.eas; touched = true; }
  }
  if (typeof keep.owner === "string" && keep.owner && j.expo.owner !== keep.owner) { j.expo.owner = keep.owner; touched = true; }
  if (touched) { writeJSON(APP, j); console.log("Expo の番号を mobile/app.json に戻しました（同じアプリとして上書きで入ります）。"); }
  return 0;
}

const cmd = process.argv[2];
process.exitCode = cmd === "save" ? save() : cmd === "restore" ? restore() : (console.log("使い方: node keep-eas.js save | restore"), 2);
