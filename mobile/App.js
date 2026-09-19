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

import React, { useCallback, useEffect, useRef } from "react";
import { Platform, StatusBar, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import * as Notifications from "expo-notifications";
/* アプリ本体。`node sync.js` が app/index.html から作る（直さないこと）。 */
import APP_HTML from "./app-html";

/* 実体のある出どころを与える。`file://` のままだと Android の WebView が
   localStorage を貸してくれないことがあり、**記録がまるごと消えたように見える**。 */
const BASE_URL = "https://hitohi.local";
const CHANNEL = "plan";

Notifications.setNotificationHandler({
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
  if (Notifications.SchedulableTriggerInputTypes) {
    tryTriggers.push({ type: Notifications.SchedulableTriggerInputTypes.DATE, date,
                       channelId: CHANNEL });
  }
  tryTriggers.push({ date, channelId: CHANNEL });
  tryTriggers.push(date);
  let last = null;
  for (const trigger of tryTriggers) {
    try { await Notifications.scheduleNotificationAsync({ content, trigger }); return true; }
    catch (e) { last = e; }
  }
  console.warn("通知を予約できませんでした", last);
  return false;
}

export default function App() {
  const web = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync(CHANNEL, {
            name: "予定の知らせ",
            importance: Notifications.AndroidImportance.DEFAULT
          });
        }
        const cur = await Notifications.getPermissionsAsync();
        if (cur.status !== "granted") await Notifications.requestPermissionsAsync();
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

    if (m.kind === "notify") {
      try {
        await Notifications.cancelAllScheduledNotificationsAsync();
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

  return (
    <View style={s.fill}>
      <StatusBar barStyle="default" />
      <WebView
        ref={web}
        source={{ html: APP_HTML, baseUrl: BASE_URL }}
        originWhitelist={["*"]}
        onMessage={onMessage}
        domStorageEnabled
        javaScriptEnabled
        allowFileAccess
        setSupportMultipleWindows={false}
        // 画面のいちばん下のボタンが隠れないようにする
        style={s.fill}
      />
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#F2F4F3" }
});
