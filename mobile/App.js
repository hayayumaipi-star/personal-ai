/* ===========================================================================
   AI秘書 — Android の殻（Expo）

   **この殻は、中身のロジックを1行も持ちません。**
   全部 `app/index.html` の側にあります（このファイルが唯一の正・決まり7e）。
   殻がやるのは3つだけ：

     ① その `index.html` を WebView で開く
     ② AIへの通信を代わりに行う（WebView から直接だと相手の受け入れ設定に止められる）
     ③ 予定の通知を予約する

   **「定時に自分で起きる」仕組みは入れていません。**
   通知は**先に予約しておけばアプリが閉じていても鳴る**ので、要らないからです。
   入れない分だけ、殻は小さく、壊れる場所も少なくなります。
   =========================================================================== */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StatusBar, useColorScheme } from "react-native";
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
import { SchedulableTriggerInputTypes } from "expo-notifications/build/Notifications.types";
import { AndroidImportance } from "expo-notifications/build/NotificationChannelManager.types";
/* アプリ本体。`node sync.js` が app/index.html から作る（直さないこと）。 */
import APP_HTML from "./app-html";

/* 実体のある出どころを与える。`file://` のままだと Android の WebView が
   localStorage を貸してくれないことがあり、**記録がまるごと消えたように見える**。 */
const BASE_URL = "https://hitohi.local";
const CHANNEL = "plan";
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
          await scheduleOne(
            { title: String((n && n.title) || "予定"), body: String((n && n.body) || "") },
            new Date(at)
          );
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
