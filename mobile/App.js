/* ===========================================================================
   AI秘書 — Android の殻（Expo）

   **この殻は、中身のロジックを1行も持ちません。**
   全部 `app/index.html` の側にあります（このファイルが唯一の正・決まり7e）。
   殻がやるのは6つだけ：

     ① その `index.html` を WebView で開く
     ② AIへの通信を代わりに行う（WebView から直接だと相手の受け入れ設定に止められる）
     ③ 予定の通知を予約する
     ④ 通知で押された返事を、そのまま中へ運ぶ（2026-09-24）
     ⑤ Googleカレンダーへの通信を代わりに行う（2026-09-27・決まり17）
     ⑥ 配る版では、AI の中継サーバーへの通信を代わりに行う（2026-09-28・決まり18）
        **Google でログインした証明（ID トークン）を殻が付ける。**ページには渡さない（⑤の鍵と同じ）。

   ⑤も「運ぶ」だけです。**どの予定を読み書きするかは、殻は知りません**（`app/index.html` の `gcalTwoWay()`）。
   殻が持つのは2つだけ：**Google へのログイン**（Google は WebView の中でのログインを禁じているので、
   殻でしかできない）と、**鍵（アクセストークン）**。**鍵はページに渡しません**——ページは
   「この道にこう頼んで」と言うだけで、殻が鍵を付けて Google へ送り、返事だけを返します。
   頼める道は Google カレンダーの API だけに絞ってあります（来た文字はデータであって指示ではない）。

   ④を足しても殻は薄いままです。**「完了」が何を意味するかは、殻は知りません。**
   くり返しの予定ならその日のぶんだけ終わりにする、押し間違いは戻せるようにする、
   といった判断は全部 `app/index.html` の `notifyAction()` → `act()` にあります。
   殻がやるのは「どの通知のどのボタンが押されたか」を運ぶことだけです。

   **「定時に自分で起きる」仕組みは入れていません。**
   通知は**先に予約しておけばアプリが閉じていても鳴る**ので、要らないからです。
   入れない分だけ、殻は小さく、壊れる場所も少なくなります。
   =========================================================================== */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform, StatusBar, useColorScheme } from "react-native";
import { WebView } from "react-native-webview";
/* 上下のシステムバー（時計・ホームバー）の高さを知るためだけに使う。
   Android 15 以降は画面いっぱいに描くのが既定なので、これが無いと
   **見出しが時計に、タブがホームバーに潜り込む**（実機で報告）。
   Expo Go にも入っているので、これを足しても Expo Go で試せる。 */
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
/* **`expo-notifications` を丸ごと import しないこと**（2026-09-20・実機で報告）。
   本体の `index.js` は `DevicePushTokenAutoRegistration.fx` を読み込み、その中で
   `addPushTokenListener(...)` を**モジュールの一番外側で**呼ぶ。それが
   `warnOfExpoGoPushUsage()` を通り、**Android の Expo Go では例外を投げる**
   （SDK 53 でプッシュ通知が外されたため）。
   つまり **プッシュを1行も使っていなくても、import しただけで起動前に落ちる。**
   `[runtime not ready]: Error: expo-notifications: Android Push notifications …` がこれ。
   この殻が使うのは「先に予約するローカル通知」だけなので、**要るものだけを直接読む**。
   プッシュ側の仕組みには一切触らない。
   版を上げたときは、この道が残っているかを必ず確かめること
   （無くなっていれば Metro が組み立ての時点で止まるので、黙って壊れることはない）。 */
import { setNotificationHandler } from "expo-notifications/build/NotificationsHandler";
import { scheduleNotificationAsync } from "expo-notifications/build/scheduleNotificationAsync";
import { cancelAllScheduledNotificationsAsync }
  from "expo-notifications/build/cancelAllScheduledNotificationsAsync";
import { getPermissionsAsync, requestPermissionsAsync }
  from "expo-notifications/build/NotificationPermissions";
import { setNotificationChannelAsync }
  from "expo-notifications/build/setNotificationChannelAsync";
/* 通知に「完了」のボタンを付けて、押されたら受け取るためだけに使う（2026-09-24・④）。
   どちらも push の仕組みには触らないので、上の「丸ごと import しない」に反しない
   （中身を読んで確かめた：`NotificationsEmitter` も `setNotificationCategoryAsync` も
   `DevicePushTokenAutoRegistration.fx` を読み込まない）。 */
import { setNotificationCategoryAsync }
  from "expo-notifications/build/setNotificationCategoryAsync";
import { addNotificationResponseReceivedListener, getLastNotificationResponseAsync,
         DEFAULT_ACTION_IDENTIFIER } from "expo-notifications/build/NotificationsEmitter";
import { SchedulableTriggerInputTypes } from "expo-notifications/build/Notifications.types";
import { AndroidImportance } from "expo-notifications/build/NotificationChannelManager.types";
/* ⑤ Google でログインするためだけに使う（2026-09-27）。**Expo Go には入っていない**ので、
   読み込めなければ何もしない（EAS で作った APK でだけ動く）。ここで落とすとアプリ全体が開かなくなる。 */
let GS = null;
try { GS = require("@react-native-google-signin/google-signin").GoogleSignin; } catch (e) { GS = null; }
/* 頼む権限は**1つだけ**：予定を見て編集する（`calendar.events`）。メインのカレンダーと同期するため（本人の指示・決まり17）。
   カレンダーそのものを作る・消す・共有する権限（`calendar`）は頼まない。決めるのは殻（ページからは広げられない）。
   **ログインのときには頼まない**（2026-09-28・決まり18）。配る版では AI を使うためだけにログインする人がいるので、
   カレンダーの権限は「Google と同期する」を押したときに足す（`addScopes`）。 */
const GCAL_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events"
];
const GCAL_BASE = "https://www.googleapis.com/calendar/v3/";
let gsReady = false;
function gsSetup() {
  if (!GS || gsReady) return !!GS;
  /* ウェブのクライアント ID を渡すと、ログインの証明（ID トークン）がもらえる。中継サーバーはそれで本人を確かめる。 */
  const opts = { scopes: [] };
  if (APP_CFG && APP_CFG.webClientId) opts.webClientId = String(APP_CFG.webClientId);
  try { GS.configure(opts); gsReady = true; } catch (e) { console.warn("Googleの準備でつまずきました", e); }
  return gsReady;
}
function gsError(e) {
  const code = e && e.code != null ? String(e.code) : "";
  return (code ? code + "：" : "") + String((e && e.message) || e);
}
/* 配る版の設定（中継サーバーの場所と、Google のウェブのクライアント ID）。`node sync.js` が毎回書く（直さないこと）。
   **秘密は入っていない**（どちらも APK を開けば見える種類の値）。自分用の APK では空。 */
import APP_CFG from "./app-config";
/* アプリ本体。`node sync.js` が app/index.html から作る（直さないこと）。 */
import APP_HTML from "./app-html";

/* 実体のある出どころを与える。`file://` のままだと Android の WebView が
   localStorage を貸してくれないことがあり、**記録がまるごと消えたように見える**。 */
const BASE_URL = "https://hitohi.local";
const CHANNEL = "plan";
/* 通知に付けるボタンの組。**`:` と `-` を入れないこと**——
   expo-notifications の注意書きにそう書いてある（入れると効かないことがある）。 */
const CATEGORY = "hitohiplan";
/* 画面が出るまでのあいだ敷いておく色。`app/index.html` の `--paper` と同じ。
   **ここは「最初の一瞬」だけ**で、読み込めたらページが本当の色を教えてくる
   （`kind:"chrome"`）。2か所に持っているように見えるが、こちらは待っている間の
   仮置きで、決めているのは向こう側だけ（決まり7e）。 */
const PAPER_LIGHT = "#F2F4F3";
const PAPER_DARK  = "#101615";
/* その色の上で、時計の文字が読めるほうを選ぶ。 */
function inkOn(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || ""));
  if (!m) return "default";
  const n = parseInt(m[1], 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 140 ? "light-content" : "dark-content";
}

setNotificationHandler({
  handleNotification: async () => ({
    // 新しい名前と古い名前の両方を渡す（知らない鍵は無視される）
    shouldShowBanner: true, shouldShowList: true,
    shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false
  })
});

/* 予約の書き方は版によって違う。**新しい形を試して、駄目なら古い形**。
   ここで落とすと通知が1つも鳴らないので、黙って諦めないこと。 */
async function scheduleOne(content, date) {
  const tryTriggers = [];
  if (SchedulableTriggerInputTypes) {
    tryTriggers.push({ type: SchedulableTriggerInputTypes.DATE, date,
                       channelId: CHANNEL });
  }
  tryTriggers.push({ date, channelId: CHANNEL });
  tryTriggers.push(date);
  let last = null;
  for (const trigger of tryTriggers) {
    try { await scheduleNotificationAsync({ content, trigger }); return true; }
    catch (e) { last = e; }
  }
  console.warn("通知を予約できませんでした", last);
  return false;
}

export default function App() {
  const web = useRef(null);
  /* システムバーの裏に敷く色。ページが `chrome` で教えてくるまでは端末の設定に合わせる。 */
  const scheme = useColorScheme();
  const [paper, setPaper] = useState(scheme === "dark" ? PAPER_DARK : PAPER_LIGHT);

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === "android") {
          await setNotificationChannelAsync(CHANNEL, {
            name: "予定の知らせ",
            importance: AndroidImportance.DEFAULT
          });
        }
        /* 通知に出すボタン。**アプリを前に出す**ことにしている（2026-09-24）。
           出さない設定（opensAppToForeground:false）にすると、アプリが完全に終わって
           いるときの返事を受け取る道が無く、**押しても何も起きない**。
           開くぶん一手間だが、押したことが必ず届くほうを採った。 */
        await setNotificationCategoryAsync(CATEGORY, [
          { identifier: "done", buttonTitle: "完了",
            options: { opensAppToForeground: true } }
        ]);
        const cur = await getPermissionsAsync();
        if (cur.status !== "granted") await requestPermissionsAsync();
      } catch (e) { console.warn("通知の準備でつまずきました", e); }
    })();
  }, []);

  /* WebView へ返す。**必ず二重に JSON にすること**——
     文字列として渡さないと、引用符で壊れる。 */
  const post = useCallback(obj => {
    if (!web.current) return;
    web.current.injectJavaScript(
      "window.hitohiNative && window.hitohiNative(" + JSON.stringify(JSON.stringify(obj)) + ");true;"
    );
  }, []);

  /* ④ 通知のボタンが押されたときの返事を運ぶ（2026-09-24）。
     道は2つある。**両方いる**：
       ・アプリが動いているとき … その場で届く（listener）
       ・アプリが終わっていたとき … 起動してから聞きに行く（getLastNotificationResponseAsync）
     2つあるので、**同じ返事を2回運ばない**よう、最後に運んだ通知の id を覚えておく。
     ページが読み込まれる前に届くこともあるので、**読み込みが終わるまで持っておく**。 */
  const seen = useRef(new Set());
  const ready = useRef(false);
  const pending = useRef([]);

  const relay = useCallback(resp => {
    try {
      if (!resp) return;
      const req = resp.notification && resp.notification.request;
      const data = (req && req.content && req.content.data) || {};
      /* 本体を押しただけなら、ふつうは何もしない（アプリが開くだけ）。
         見直しの通知だけは「どの画面を開くか」を運ぶ（2026-09-26）。**どの画面にするかは本体が決める。** */
      const plainTap = resp.actionIdentifier === DEFAULT_ACTION_IDENTIFIER;
      if (plainTap && !data.tab) return;
      const key = (req && req.identifier) + "/" + resp.actionIdentifier;
      if (seen.current.has(key)) return;
      seen.current.add(key);
      const msg = plainTap
        ? { kind: "notifyopen", tab: String(data.tab || "") }
        : { kind: "notifyaction", action: String(resp.actionIdentifier || ""),
            id: String(data.id || ""), day: String(data.day || "") };
      if (ready.current) post(msg); else pending.current.push(msg);
    } catch (e) { console.warn("通知の返事を運べませんでした", e); }
  }, [post]);

  useEffect(() => {
    const sub = addNotificationResponseReceivedListener(relay);
    getLastNotificationResponseAsync().then(relay).catch(() => {});
    return () => { try { sub && sub.remove && sub.remove(); } catch {} };
  }, [relay]);

  const onMessage = useCallback(async e => {
    let m = null;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (!m || !m.kind) return;

    if (m.kind === "fetch") {
      try {
        const r = await fetch(String(m.url), {
          method: "POST", headers: m.headers || {}, body: m.body
        });
        post({ id: m.id, status: r.status, body: await r.text() });
      } catch (e2) {
        post({ id: m.id, error: String((e2 && e2.message) || e2) });
      }
      return;
    }

    /* ⑤ Google へのログイン（2026-09-27）。status＝いまログインしているか／signin＝ログインする／signout＝外す。 */
    if (m.kind === "gauth") {
      if (!GS || !gsSetup()) { post({ id: m.id, error: "nosupport" }); return; }
      try {
        if (m.action === "signin") {
          await GS.hasPlayServices({ showPlayServicesUpdateDialog: true });
          const r = await GS.signIn();
          if (!r || r.type !== "success") { post({ id: m.id, ok: false, cancelled: true }); return; }
          post({ id: m.id, ok: true, email: String((r.data && r.data.user && r.data.user.email) || "") });
        } else if (m.action === "calendar") {
          /* カレンダーの権限を足す（ログイン済みのとき）。断られたら ok:false。 */
          const r = await GS.addScopes({ scopes: GCAL_SCOPES });
          post({ id: m.id, ok: !!(r && r.type === "success") });
        } else if (m.action === "signout") {
          try { await GS.revokeAccess(); } catch (e0) { /* もう外れていれば、そのまま */ }
          try { await GS.signOut(); } catch (e0) {}
          post({ id: m.id, ok: true });
        } else {
          const r = await GS.signInSilently();
          const ok = !!(r && r.type === "success");
          const granted = ok && r.data && Array.isArray(r.data.scopes) ? r.data.scopes : [];
          post({ id: m.id, ok, email: ok ? String((r.data && r.data.user && r.data.user.email) || "") : "",
                 calendar: GCAL_SCOPES.every(sc => granted.includes(sc)), server: !!(APP_CFG && APP_CFG.serverUrl) });
        }
      } catch (e2) { post({ id: m.id, error: gsError(e2) }); }
      return;
    }

    /* ⑤ Google カレンダーへの1回の通信。**鍵は殻が付けて、ページには渡さない。**
       頼める道はカレンダーの API（calendars/… と users/me/calendarList）だけ・やり方は5つだけ。 */
    if (m.kind === "gcal") {
      if (!GS || !gsSetup()) { post({ id: m.id, error: "nosupport" }); return; }
      const method = String(m.method || "GET").toUpperCase();
      const pth = String(m.path || "");
      if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)
          || !/^(calendars|users\/me\/calendarList)(\/[A-Za-z0-9@._%\-]+)*$/.test(pth)
          || /(^|\/)\.+(\/|$)/.test(pth)) {             // 「..」で道の外へ出さない
        post({ id: m.id, error: "badpath" }); return;
      }
      const url = GCAL_BASE + pth + (m.query ? "?" + String(m.query) : "");
      try {
        let tok = (await GS.getTokens()).accessToken;
        const send = t => fetch(url, { method, headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
          body: method === "GET" || method === "DELETE" ? undefined : String(m.body || "") });
        let r = await send(tok);
        if (r.status === 401) {                 // 鍵が古い。1回だけ作り直して入れ直す
          try { await GS.clearCachedAccessToken(tok); } catch (e0) {}
          tok = (await GS.getTokens()).accessToken;
          r = await send(tok);
        }
        post({ id: m.id, status: r.status, body: await r.text() });
      } catch (e2) { post({ id: m.id, error: gsError(e2) }); }
      return;
    }

    /* ⑥ 配る版：AI の中継サーバーへ（2026-09-28・決まり18）。**行き先は殻が知っている1か所だけ**
       （ページからは変えられない）。頼めるのは generate（AIを呼ぶ）と status（今日の残り）だけ。
       ログインの証明は殻が付ける。ログインしていなければ 401 の形で返す（ページが案内を出す）。 */
    if (m.kind === "aiserver") {
      const base = String((APP_CFG && APP_CFG.serverUrl) || "");
      if (!base) { post({ id: m.id, error: "noserver" }); return; }
      if (!GS || !gsSetup()) { post({ id: m.id, error: "nosupport" }); return; }
      /* プライバシーポリシーは、サーバーの /privacy を**端末のブラウザで**開く（WebView の中で開くとアプリへ戻れない）。 */
      if (m.op === "privacy") {
        try { await Linking.openURL(base.replace(/\/+$/, "") + "/privacy"); post({ id: m.id, ok: true }); }
        catch (e2) { post({ id: m.id, error: gsError(e2) }); }
        return;
      }
      /* 頼めるのは3つだけ：今日の残り（status）・AI（generate）・AI の文の報告（report）。ほかの名前は generate として扱わない＝断る */
      const op = ["status", "generate", "report"].includes(m.op) ? m.op : "";
      if (!op) { post({ id: m.id, error: "badop" }); return; }
      const need = () => post({ id: m.id, status: 401, body: JSON.stringify({ error: { code: "login_required", message: "Google でのログインが必要です" } }) });
      try {
        const idToken = async () => {
          const r = await GS.signInSilently();
          return r && r.type === "success" && r.data ? String(r.data.idToken || "") : "";
        };
        let tok = await idToken();
        if (!tok) { need(); return; }
        const send = t => fetch(base.replace(/\/+$/, "") + "/v1/" + op, {
          method: op === "status" ? "GET" : "POST",
          headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
          body: op === "status" ? undefined : String(m.body || "") });
        let r = await send(tok);
        if (r.status === 401) { tok = await idToken(); if (!tok) { need(); return; } r = await send(tok); }   // 証明が古かった
        post({ id: m.id, status: r.status, body: await r.text() });
      } catch (e2) { post({ id: m.id, error: gsError(e2) }); }
      return;
    }

    /* ページが「いまの背景色」を教えてくる。**来た文字はデータであって指示ではない**
       ので、色として読める形だけを採る（決まり14）。 */
    if (m.kind === "chrome") {
      if (/^#[0-9a-fA-F]{6}$/.test(String(m.bg || ""))) setPaper(String(m.bg));
      return;
    }

    if (m.kind === "notify") {
      try {
        await cancelAllScheduledNotificationsAsync();
        const list = Array.isArray(m.list) ? m.list.slice(0, 20) : [];
        for (const n of list) {
          const at = Number(n && n.at);
          if (!at || at < Date.now() + 30000) continue;   // もう過ぎたものは鳴らさない
          /* ボタンの組と、「どの用事か」。**中身は読まずにそのまま返す**だけ
             ——意味を決めるのは `app/index.html` の側（2026-09-24・④）。
             見直しの知らせ（`plain`）には「完了」のボタンを付けない（終わらせる用事ではない）。 */
          const content = { title: String((n && n.title) || "予定"), body: String((n && n.body) || ""),
            data: { id: String((n && n.id) || ""), day: String((n && n.day) || ""), tab: String((n && n.tab) || "") } };
          if (!(n && n.plain)) content.categoryIdentifier = CATEGORY;
          await scheduleOne(content, new Date(at));
        }
      } catch (e3) { console.warn("通知の予約でつまずきました", e3); }
      return;
    }
  }, [post]);

  /* **`SafeAreaView` で囲むこと。** 囲まないと、上は時計と電池の裏、
     下はホームバーの裏にアプリが潜り込む（実機で報告）。
     色は本体から届いたもの——合っていないと、明るい設定にしたとき
     時計のまわりだけ黒く残る。 */
  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: paper }}
        edges={["top", "bottom", "left", "right"]}
      >
        <StatusBar barStyle={inkOn(paper)} />
        <WebView
          ref={web}
          source={{ html: APP_HTML, baseUrl: BASE_URL }}
          originWhitelist={["*"]}
          onMessage={onMessage}
          onLoadEnd={() => {
            ready.current = true;
            const q = pending.current; pending.current = [];
            for (const msg of q) post(msg);
          }}
          domStorageEnabled
          javaScriptEnabled
          allowFileAccess
          setSupportMultipleWindows={false}
          style={{ flex: 1, backgroundColor: paper }}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
