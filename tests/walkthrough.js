/* ユーザーが触るもの全部を、実際にクリックして確かめる。
   本番と同じ条件：保存先(db)から読んだデータは凍結されている。 */
(function () {
  const R = [], ERR = [];
  let current = "(準備)";
  window.addEventListener("error", e => ERR.push(current + " → " + (e.message || e)));
  window.addEventListener("unhandledrejection", e => ERR.push(current + " → " + ((e.reason && (e.reason.message || e.reason.code)) || e.reason)));

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const $$ = s => document.querySelector(s);
  const has = s => !!document.querySelector(s);

  async function step(name, fn) {
    current = name;
    lastError = null;
    const before = ERR.length;
    try {
      await fn();
      await wait(40);
      const newErr = ERR.slice(before);
      if (lastError) R.push(`FAIL :: ${name}  [アプリが記録したエラー: ${lastError}]`);
      else if (newErr.length) R.push(`FAIL :: ${name}  [${newErr.join(" / ")}]`);
      else R.push(`PASS :: ${name}`);
    } catch (e) {
      R.push(`FAIL :: ${name}  [${(e && (e.message || e)) || "不明"}]`);
    }
  }

  async function click(sel, label) {
    const el = typeof sel === "string" ? $$(sel) : sel;
    if (!el) throw new Error("押すものが見つからない: " + (label || sel));
    el.click(); await wait(90);
  }
  function type(sel, v) {
    const el = $$(sel); if (!el) throw new Error("入力欄が無い: " + sel);
    el.value = v; el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // FileReader の完了は時間で待たない。入るまで待つ。
  async function waitFor(fn, ms) {
    const end = Date.now() + (ms || 3000);
    while (Date.now() < end) { if (fn()) return true; await wait(50); }
    return false;
  }
  async function sheetYes() { if (has("#cfYes")) { await click("#cfYes"); } }
  const firstAct = (panel, act) => document.querySelector(`${panel} [data-act="${act}"]`);

  async function run() {
    for (let i = 0; i < 300 && !state.ready; i++) await wait(20);
    for (let i = 0; i < 200 && state.backend !== "db"; i++) await wait(20);
    R.push(`（保存先=${state.backend} / AI=${SAMPLEFN ? "あり" : "なし"}）`);

    /* ===== タブ ===== */
    await step("タブ「スケジュール」を開く", () => click('nav.tabs [data-tab="p-day"]'));
    await step("タブ「わたしのこと」を開く", () => click('nav.tabs [data-tab="p-me"]'));
    await step("タブ「設定」を開く", () => click('nav.tabs [data-tab="p-set"]'));
    await step("タブ「チャット」を開く", () => click('nav.tabs [data-tab="p-chat"]'));

    /* ===== 話す ===== */
    await step("「例を入れてみる」を押す", async () => {
      if (!has("#btnSample")) throw new Error("空の状態の案内が出ていない");
      await click("#btnSample");
      if (!$$("#say").value) throw new Error("例文が入らない");
    });
    await step("話しかけて送る（例文）", async () => {
      await click("#btnSend");
      await wait(400);
      if ($$("#say").value) throw new Error("送信後に入力欄が空になっていない");
      if (!turnsFor(view.day).length) throw new Error("会話が残っていない");
    });
    await step("自分で打って送る", async () => {
      type("#say", "明日の午後３時に歯医者に行く。移動に30分かかる。");
      await click("#btnSend"); await wait(400);
    });
    await step("もう一度話しかける（言い直し）", async () => {
      type("#say", "資料を作らないと。明日までに。2時間くらい。できれば午前中に。");
      await click("#btnSend"); await wait(400);
    });
    await step("自分の発言の「原文」を開く", async () => {
      const b = firstAct("#p-chat", "shownote");
      if (!b) throw new Error("「原文」ボタンが無い");
      await click(b);
      if (!has("#sheetHost .sheet")) throw new Error("シートが開かない");
      await click("[data-close]");
    });
    await step("Ctrl+Enter で送る", async () => {
      type("#say", "牛乳を買っておく。");
      $$("#say").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
      await wait(400);
      if ($$("#say").value) throw new Error("Ctrl+Enterで送れていない");
    });
    await step("空のまま送ろうとする（注意が出る）", async () => {
      type("#say", "");
      await click("#btnSend");
      if (!/何か話しかけて/.test($$("#sayNote").textContent)) throw new Error("注意が出ない");
      type("#say", "");
    });
    await step("テキストファイルを取り込む", async () => {
      const dt = new DataTransfer();
      dt.items.add(new File(["来週の水曜に美容院の予約。"], "memo.txt", { type: "text/plain" }));
      $$("#file").files = dt.files;
      $$("#file").dispatchEvent(new Event("change", { bubbles: true }));
      if (!await waitFor(() => $$("#say").value)) throw new Error("ファイルの中身が入らない");
      await click("#btnSend"); await wait(400);
    });

    /* ===== 今日 ===== */
    await step("タブ「スケジュール」に移る", () => click('nav.tabs [data-tab="p-day"]'));
    await step("前の日へ", () => click("#dPrev"));
    await step("今日へ戻る", () => click("#dToday"));
    /* 「明日の午前中に」と言った作業は、明日の予定表に必ず置かれる（v4.4）。
       今日の側で探すと、実行した時刻が午後だった日に午前の枠が無く、落ちる日と落ちない日が出る。
       **本物の時計に依存させない**ため、明日を見て押す。 */
    await step("次の日へ", () => click("#dNext"));
    await step("作業枠の「所要時間を直す」→ 45分", async () => {
      const b = firstAct("#p-day", "est");
      if (!b) throw new Error("「所要時間を直す」が無い");
      await click(b);
      const m = document.querySelector('[data-act="setest"][data-min="45"]');
      if (!m) throw new Error("時間の選択肢が無い");
      await click(m);
      if (has("#sheetHost .sheet")) throw new Error("シートが閉じない");
      await click("#dToday");     // このあとの操作は「今日」の画面で行う
    });
    await step("「根拠」を開いて閉じる", async () => {
      const b = firstAct("#p-day", "evid");
      if (!b) throw new Error("「根拠」が無い");
      await click(b);
      if (!/根拠をたしかめる/.test($$("#sheetHost").textContent)) throw new Error("根拠が出ない");
      await click("[data-close]");
    });
    await step("「訂正」を開いて内容を直して保存", async () => {
      const b = firstAct("#p-day", "edit");
      if (!b) throw new Error("「訂正」が無い");
      await click(b);
      if (!has("#eT")) throw new Error("訂正の欄が出ない");
      type("#eT", "直したあとの用事");
      type("#eE", "40");
      await click('[data-act="save"]');
      if (has("#sheetHost .sheet")) throw new Error("シートが閉じない");
      if (!state.items.some(i => i.title === "直したあとの用事")) throw new Error("直した内容が保存されていない");
    });
    await step("「明日へ」を押す", async () => {
      const b = firstAct("#p-day", "defer");
      if (!b) throw new Error("「明日へ」が無い");
      await click(b);
    });
    await step("「完了」を押す", async () => {
      const b = firstAct("#p-day", "done");
      if (!b) throw new Error("「完了」が無い");
      const id = b.dataset.id;
      await click(b);
      if (findItem(id).status !== "done") throw new Error("完了になっていない");
    });
    await step("振り返りの「未完了に戻す」を押す（折りたたみの中）", async () => {
      document.querySelectorAll("#p-day details").forEach(d => d.open = true);
      const b = firstAct("#p-day", "undone");
      if (!b) throw new Error("「未完了に戻す」が無い（振り返りに出ていない）");
      const id = b.dataset.id;
      await click(b);
      if (findItem(id).status !== "open") throw new Error("戻っていない");
    });
    await step("「取り消す」→「戻す」", async () => {
      const b = firstAct("#p-day", "drop");
      if (!b) throw new Error("「取り消す」が無い");
      const id = b.dataset.id;
      await click(b);
      if (findItem(id).status !== "dropped") throw new Error("取り消しになっていない");
      const u = document.querySelector(`#p-day [data-act="undrop"][data-id="${id}"]`);
      if (!u) throw new Error("「戻す」が出ない");
      await click(u);
      if (findItem(id).status !== "open") throw new Error("戻せていない");
    });
    await step("設定：見た目（ダークモード）", async () => {
      showTab("p-set");
      if (!has("#theme")) throw new Error("見た目の欄が出ない");
      const before = document.documentElement.getAttribute("data-theme");
      $("#theme").value = "dark";
      $("#theme").dispatchEvent(new Event("change", { bubbles: true }));
      if (document.documentElement.getAttribute("data-theme") !== "dark") throw new Error("選んでも暗くならない");
      if (!await waitFor(() => state.settings.theme === "dark")) throw new Error("暗くが保存されない（保存ボタンは無い）");
      $("#theme").value = "light";
      $("#theme").dispatchEvent(new Event("change", { bubbles: true }));
      if (document.documentElement.getAttribute("data-theme") !== "light") throw new Error("明るくに戻せない");
      $("#theme").value = "auto";
      $("#theme").dispatchEvent(new Event("change", { bubbles: true }));
      if (document.documentElement.getAttribute("data-theme") !== before) throw new Error("端末に合わせるに戻らない");
      if (!await waitFor(() => state.settings.theme === "auto")) throw new Error("端末に合わせるが保存されない");
    });
    await step("「＋ 自分で足す」", async () => {
      await click("#btnManual");
      if (!has("#mT")) throw new Error("手入力の欄が出ない");
      type("#mT", "手で足した打ち合わせ");
      type("#mH", "16:00");
      type("#mE", "45");
      await click('[data-act="addmanual"]');
      if (!state.items.some(i => i.title === "手で足した打ち合わせ")) throw new Error("追加されていない");
    });


    /* ===== スケジュールの整理を確かめる ===== */
    await step("スケジュールに「次にすること」の札が無い", async () => {
      await click('nav.tabs [data-tab="p-day"]');
      const html = $$("#dayOut").innerHTML;
      if (/次にすること/.test(html)) throw new Error("まだ出ている");
      if (!/TIMELINE|今日の案/.test(html)) throw new Error("肝心の予定表が無い");
    });
    await step("タブの名前がスケジュールになっている", async () => {
      const b = document.querySelector('nav.tabs [data-tab="p-day"]');
      if (!/スケジュール/.test(b.textContent)) throw new Error("名前が変わっていない: " + b.textContent);
    });
    await step("目標・気になっていること・メモ・要望が「わたしのこと」にある", async () => {
      await click('nav.tabs [data-tab="p-me"]');
      const html = $$("#meOut").innerHTML;
      const day = (await (async () => { await click('nav.tabs [data-tab="p-day"]'); return $$("#dayOut").innerHTML; })());
      const kinds = ["goal", "idea", "memo", "preference"].filter(k => state.items.some(i => i.kind === k && i.status === "open"));
      for (const k of kinds) {
        const it = state.items.find(i => i.kind === k && i.status === "open");
        if (!html.includes(it.id)) throw new Error(k + " が「わたしのこと」に出ていない");
        if (day.includes(it.id)) throw new Error(k + " がスケジュールに残っている");
      }
      if (!kinds.length) R.push("（目標・メモ等が無いので照合は省略）");
    });
    /* ===== わたしのこと ===== */
    await step("タブ「わたしのこと」に移る", () => click('nav.tabs [data-tab="p-me"]'));
    await step("自分について貼り付けて「読み取って足す」", async () => {
      type("#docTitle", "自己紹介");
      type("#docText", "私は研究をしています。統計の解析が得意ですが、人前で発表するのは昔から苦手です。\nコーヒーが好きで、朝はいつもブラックを飲みます。");
      await click("#btnDocAdd");
      await wait(300);
      await sheetYes();            // AIにも読ませますか？ → はい
      await wait(400);
      if (!state.docs.length) throw new Error("資料が保存されていない");
    });
    await step("資料の「全文を見る」", async () => {
      await click(firstAct("#p-me", "docopen"));
      if (!/渡した資料|自己紹介/.test($$("#sheetHost").textContent)) throw new Error("全文が出ない");
      await click("[data-close]");
    });
    await step("資料の「読み取ったものを見る」", async () => {
      await click(firstAct("#p-me", "docitems"));
      if (!/読み取ったもの/.test($$("#sheetHost").textContent)) throw new Error("一覧が出ない");
      await click("[data-close]");
    });
    await step("「すべて合ってる」にする", async () => {
      const b = firstAct("#p-me", "confirmprof");
      if (!b) { R.push("（未確認が無いので confirmprof は省略）"); return; }
      await click(b);
      if (state.items.some(i => i.kind === "profile" && !i.confirmed && !i.corrected)) throw new Error("確認済みになっていない");
    });
    await step("わたしのことを1件「訂正」する", async () => {
      const b = firstAct("#p-me", "edit");
      if (!b) throw new Error("「訂正」が無い");
      await click(b);
      type("#eT", "朝は弱い");
      await click('[data-act="save"]');
      if (!state.items.some(i => i.title === "朝は弱い")) throw new Error("直っていない");
    });
    await step("ファイルから資料を渡す", async () => {
      const dt = new DataTransfer();
      dt.items.add(new File(["締め切りが近くないと動けない性格です。"], "me.txt", { type: "text/plain" }));
      $$("#docFile").files = dt.files;
      $$("#docFile").dispatchEvent(new Event("change", { bubbles: true }));
      if (!await waitFor(() => $$("#docText").value)) throw new Error("ファイルの中身が入らない");
      await click("#btnDocAdd"); await wait(300); await sheetYes(); await wait(400);
    });
    await step("資料を消す（確認シート → 消す）", async () => {
      const n = state.docs.length;
      await click(firstAct("#p-me", "docdel"));
      if (!has("#cfYes")) throw new Error("確認シートが出ない");
      await click("#cfYes"); await wait(200);
      if (state.docs.length !== n - 1) throw new Error("消えていない");
    });

    /* ===== 設定 ===== */
    await step("タブ「設定」に移る", () => click('nav.tabs [data-tab="p-set"]'));
    await step("設定は触ったその場で保存される（保存ボタンは無い）", async () => {
      if (has("#btnSaveSet")) throw new Error("保存ボタンが残っている");
      if (has("#wStart")) throw new Error("作業時間帯の欄が残っている");
      type("#defEst", "45"); type("#breakEvery", "60");
      $$("#defEst").dispatchEvent(new Event("change", { bubbles: true }));
      if (!await waitFor(() => state.settings.defaultEstimate === 45)) throw new Error("その場で保存されない");
    });
    await step("AIをオフにする", async () => {
      $$("#useAI").checked = false;
      $$("#useAI").dispatchEvent(new Event("change", { bubbles: true }));
      if (!await waitFor(() => state.settings.useAI === false)) throw new Error("オフになっていない");
    });
    await step("AIオフのまま話しかける", async () => {
      await click('nav.tabs [data-tab="p-chat"]');
      type("#say", "明後日の10時から面談。");
      await click("#btnSend"); await wait(300);
      await click('nav.tabs [data-tab="p-set"]');
    });
    await step("AIをオンに戻す", async () => {
      $$("#useAI").checked = true;
      $$("#useAI").dispatchEvent(new Event("change", { bubbles: true }));
      if (!await waitFor(() => state.settings.useAI === true)) throw new Error("オンに戻らない");
    });
    await step("「書き出す（JSON）」", async () => {
      await click("#btnExport"); await wait(300);
      if (!/書き出しました|コピーして/.test($$("#expOut").textContent)) throw new Error("書き出しの反応が無い");
    });
    /* 1件消す道も、消せたか確かめてから言うこと（v5.6）。
       `dbTrouble` は呼んでいたが、**先に手元から消して**「消しました」と言っていた。
       保存先に残っているのに画面からは消えるので、開き直すと戻ってくる。 */
    await step("原文を消せないときは「消しました」と言わない", async () => {
      const db = await window.claude.use("db");
      const origDoc = db.doc;
      db.doc = function (p) {
        const r = origDoc.call(db, p);
        r.delete = () => Promise.reject({ code: "permission_denied", message: "テスト用に失敗させた" });
        return r;
      };
      lastError = null;
      const before = state.notes.length;
      try {
        const b = firstAct("#p-set", "delnote");
        if (!b) throw new Error("「この原文を消す」が無い");
        await click(b);
        if (!has("#cfYes")) throw new Error("確認シートが出ない");
        await click("#cfYes");
        if (!await waitFor(() => !has("#cfYes"), 6000)) throw new Error("シートが閉じない");
        await wait(250);
        if (state.notes.length !== before) throw new Error("保存先から消せていないのに、手元だけ消した");
      } finally { db.doc = origDoc; }
      if (!lastError) throw new Error("不具合として記録されない");
      lastError = null;
    });

    await step("原文を開いて1件消す", async () => {
      const b = firstAct("#p-set", "delnote");
      if (!b) throw new Error("「この原文を消す」が無い");
      const n = state.notes.length;
      await click(b);
      if (!has("#cfYes")) throw new Error("確認シートが出ない");
      await click("#cfYes"); await wait(200);
      if (state.notes.length !== n - 1) throw new Error("消えていない");
    });
    await step("原文を消そうとして「やめる」", async () => {
      const b = firstAct("#p-set", "delnote");
      if (!b) { R.push("（原文が残っていないので省略）"); return; }
      const n = state.notes.length;
      await click(b); await click("#cfNo"); await wait(150);
      if (state.notes.length !== n) throw new Error("やめたのに消えた");
    });
    await step("不具合の記録を消す", async () => {
      lastError = "テスト用のエラー"; renderSettings();
      if ($$("#errCard").hidden) throw new Error("不具合欄が出ない");
      await click("#btnErrClear");
      if (!$$("#errCard").hidden) throw new Error("消えていない");
    });

    /* 保存先に**書き込めない**ときに、黙って「この端末のみ」にしない（v5.0・実機で報告）。
       リンクから開いた画面では `db` は渡るのに書き込みだけ拒まれる。
       今までは右上のバッジが変わるだけで、理由は `title` にしか出ず、スマホでは読めなかった。 */
    await step("保存先に書き込めないとき、理由が画面に残る", async () => {
      const db = await window.claude.use("db");
      const origDoc = db.doc;
      db.doc = function (p) {
        const r = origDoc.call(db, p);
        r.set = () => Promise.reject({ code: "permission_denied", message: "テスト用に書き込みを拒否" });
        return r;
      };
      lastError = null; syncKind = "ok"; setSync("ok");
      try {
        await putSettings(Object.assign({}, state.settings));
      } finally { db.doc = origDoc; }
      if ($$("#sync").textContent !== "この端末のみ") throw new Error("右上が変わらない");
      if (!lastError) throw new Error("理由が残らない");
      if (!/読むだけ/.test(lastError)) throw new Error("理由が「読むだけ」と分かる文になっていない");
      await click('nav.tabs [data-tab="p-set"]');
      if ($$("#errCard").hidden) throw new Error("設定タブに不具合欄が出ない");
      if (!/permission_denied/.test($$("#errText").value)) throw new Error("伝えられる中身になっていない");
      lastError = null; syncKind = "ok"; setSync("ok"); renderSettings();
    });

    /* 「古い記録を整理する」も、消せたかどうかを確かめてから言うこと（v5.6）。
       「全部消す」は v4.8 で直したのに、こちらは `catch {}` で握りつぶし、
       **先に手元を空にしてから**保存先を触り、無条件に「整理しました」と言っていた。
       押した人には消えたように見えて、開き直すと全部戻ってくる。
       それまでのテストは `#btnTidy` が**在るか**しか見ていなかった。 */
    async function seedOldDone(tag) {
      const long = 200 * 86400000;
      const old = new Date(Date.now() - long).toISOString();
      const it = {
        id: "tidy-" + tag, noteId: null, kind: "task", title: "ずっと前に終えた用事" + tag,
        evidence: { text: "x" }, origin: "user", confirmed: true, corrected: false,
        status: "done", completedAt: old, createdAt: old, updatedAt: old, history: []
      };
      it.dedupeKey = dedupeKey(it);
      await putItem(it);
      return it;
    }

    await step("整理で保存先から消せないときは「整理しました」と言わない", async () => {
      const it = await seedOldDone("a");
      const db = await window.claude.use("db");
      const origDoc = db.doc;
      db.doc = function (p) {
        const r = origDoc.call(db, p);
        r.delete = () => Promise.reject({ code: "permission_denied", message: "テスト用に失敗させた" });
        return r;
      };
      lastError = null;
      try {
        await click('nav.tabs [data-tab="p-set"]');
        await click("#btnTidy");
        if (!has("#cfYes")) throw new Error("確認シートが出ない");
        await click("#cfYes");
        if (!await waitFor(() => !has("#cfYes"), 6000)) throw new Error("シートが閉じない");
        await wait(300);
        if (!findItem(it.id)) throw new Error("保存先から消せていないのに、手元だけ空にした");
      } finally { db.doc = origDoc; }
      if (!lastError) throw new Error("不具合として記録されない");
      lastError = null;
    });

    await step("整理（消せるときは、保存先からも消える）", async () => {
      const it = findItem("tidy-a") || await seedOldDone("a");
      const db = await window.claude.use("db");
      await click('nav.tabs [data-tab="p-set"]');
      await click("#btnTidy");
      if (!has("#cfYes")) throw new Error("確認シートが出ない");
      await click("#cfYes");
      if (!await waitFor(() => !findItem(it.id), 6000)) throw new Error("手元から消えない");
      const left = (await db.collection("items").get()).docs.filter(d => d.id === it.id).length;
      if (left) throw new Error("保存先に残っている");
    });

    /* 資料を消す道にも、同じ穴があった（v5.7・2周目の調査で発見）。
       消す道は4つだと思っていたが、`delDoc`（資料）を入れて**5つ**だった。
       `act()` は確認シートの返事を待つので、**await で呼ぶと止まる**。押しっぱなしにして待つ。 */
    async function docdelAndConfirm(id) {
      const p = act("docdel", id);                       // await しない（確認待ちで止まるため）
      if (!await waitFor(() => has("#cfYes"), 4000)) throw new Error("確認シートが出ない");
      await click("#cfYes");
      await p;
    }
    await step("資料を消せないときは「消しました」と言わない", async () => {
      const d = { id: "doc-x", title: "検査用の資料", text: "なかみ", hash: "h-doc-x",
                  chars: 3, truncated: false, source: "paste", sourceName: null,
                  aiRead: false, createdAt: new Date().toISOString() };
      await putDoc(d);
      const db = await window.claude.use("db");
      const origDoc = db.doc;
      db.doc = function (p) {
        const r = origDoc.call(db, p);
        r.delete = () => Promise.reject({ code: "permission_denied", message: "テスト用に失敗させた" });
        return r;
      };
      lastError = null;
      try {
        await docdelAndConfirm(d.id);
        if (!state.docs.some(x => x.id === d.id))
          throw new Error("保存先から消せていないのに、手元だけ消した");
      } finally { db.doc = origDoc; }
      if (!lastError) throw new Error("不具合として記録されない");
      lastError = null;
      // 後始末：ちゃんと消せる状態で消しておく
      await docdelAndConfirm(d.id);
      if (state.docs.some(x => x.id === d.id)) throw new Error("消せるはずのものが消えない");
    });

    /* 3周目の調査で、`act()` の23の操作のうち **3つが一度も叩かれていなかった**
       （`blk` / `confirm` / `docai`）。ここでは前の2つを覆う。 */
    await step("「確認済みにする」が効く（決まり2の中核）", async () => {
      await click('nav.tabs [data-tab="p-day"]');
      const t = state.items.find(i => i.status === "open" && !i.confirmed && i.kind !== "profile");
      if (!t) { R.push("（未確認の項目が無いので省略）"); return; }
      const before = (t.history || []).length;
      await act("confirm", t.id);
      const after = findItem(t.id);
      if (!after.confirmed) throw new Error("確認済みにならない");
      if ((after.history || []).length !== before + 1) throw new Error("履歴に残らない");
      renderDay();
      const html = $$("#dayOut").innerHTML + $$("#meOut").innerHTML;
      if (!/確認済み/.test(html)) throw new Error("画面に「確認済み」の印が出ない");
    });

    await step("予定の枠を開いて、たたむ", async () => {
      await click('nav.tabs [data-tab="p-day"]');
      const head = document.querySelector('#dayOut .tlrow [data-act="blk"]');
      if (!head) { R.push("（今日の予定表に枠が無いので省略）"); return; }
      const row = head.closest(".tlrow");
      const wasOpen = row.classList.contains("open");
      await click(head);
      if (row.classList.contains("open") === wasOpen) throw new Error("開閉が切り替わらない");
      if (head.getAttribute("aria-expanded") !== String(!wasOpen))
        throw new Error("aria-expanded が合っていない: " + head.getAttribute("aria-expanded"));
      await click(head);
      if (row.classList.contains("open") !== wasOpen) throw new Error("元に戻らない");
    });

    /* 毎分の見張りが、何も変わっていないのに描き直さないこと（v4.2）。
       描き直すと `.tlrow.open`（本人が開いた枠）が勝手に閉じる。 */
    await step("何も変わらなければ、描き直しの合図も変わらない", async () => {
      const a = runningKey(), b = runningKey();
      if (a !== b) throw new Error(`同じ条件で違う値が出る: ${a} / ${b}`);
      if (typeof a !== "string") throw new Error("文字列が返らない: " + typeof a);
    });

    /* 「AIにも読ませる」は**全文を外へ送る**操作なのに、確認が無かった（v5.8・3周目の調査）。
       保存直後の経路にだけ確認が付いていて、資料カードのボタンには無い。
       `runDocAI` にはテストも1件も無かった。 */
    await step("「AIにも読ませる」は、送る前に必ず確認を出す", async () => {
      const d = { id: "doc-ai", title: "検査用の長い資料", text: "人前で発表するのは昔から苦手です。".repeat(40),
                  hash: "h-doc-ai", chars: 40 * 17, truncated: false, source: "paste",
                  sourceName: null, aiRead: false, createdAt: new Date().toISOString() };
      await putDoc(d);
      const p1 = act("docai", d.id);                       // await しない（確認待ちで止まる）
      if (!await waitFor(() => has("#cfYes"), 4000)) throw new Error("確認シートが出ない（黙って送っている）");
      const body = $$(".sheet .inner").textContent;
      if (!/回に分けて/.test(body)) throw new Error("何回送るかを言っていない: " + body.slice(0, 80));
      if (!/利用枠/.test(body)) throw new Error("誰の枠を使うかを言っていない");
      await click("#cfNo");
      await p1;
      if (state.docs.find(x => x.id === d.id).aiRead) throw new Error("やめたのに送っている");

      const p2 = act("docai", d.id);
      if (!await waitFor(() => has("#cfYes"), 4000)) throw new Error("2回目の確認が出ない");
      await click("#cfYes");
      await p2;
      if (!await waitFor(() => state.docs.find(x => x.id === d.id).aiRead, 6000))
        throw new Error("読ませたのに、読んだ印が付かない");
    });

    await step("見つからない資料をAIに読ませようとしても、黙って終わらない", async () => {
      const n = (R.filter(x => /^PASS|^FAIL/.test(x)) || []).length;
      await runDocAI("no-such-doc");                        // 例外を投げず、黙りもしないこと
      if (!/見つかりません/.test($$("#toast").textContent || "")) throw new Error("理由が出ない");
    });

    /* ===== 再読み込みしても残るか（凍結データからの復帰） ===== */
    await step("保存先から読み直しても壊れない", async () => {
      const n = state.items.length;
      state.items = []; state.notes = []; state.turns = {}; state.docs = [];
      await boot();
      await wait(300);
      if (state.items.length !== n) throw new Error(`件数が合わない ${n} → ${state.items.length}`);
      const t = state.items.find(i => i.kind === "task" && i.status === "open");
      if (t) { await act("done", t.id); if (findItem(t.id).status !== "done") throw new Error("読み直したあと完了にできない"); }
    });

    /* ===== 最後に全消し =====
       **消えたかどうかは、保存先を読み直して確かめること**（v4.8・実機で報告）。
       ここは state だけを見ていたので、保存先に1件も届いていなくても通っていた。
       `delete()` は存在しない文書でも成功するので、呼べた回数は証拠にならない。 */
    await step("保存先を消せないときは「消しました」と言わない", async () => {
      const db = await window.claude.use("db");
      const origDoc = db.doc;
      db.doc = function (p) {
        const r = origDoc.call(db, p);
        r.delete = () => Promise.reject({ code: "invalid_argument", message: "テスト用に失敗させた" });
        return r;
      };
      const before = state.items.length;
      try {
        await click('nav.tabs [data-tab="p-set"]');
        await click("#btnWipe");
        if (!has("#cfYes")) throw new Error("確認シートが出ない");
        await click("#cfYes");
        if (!await waitFor(() => /消せませんでした/.test($$("#expOut").textContent), 6000))
          throw new Error("消せていないのに、そう言わない");
        if (state.items.length !== before) throw new Error("保存先が消せていないのに、手元だけ空にした");
      } finally { db.doc = origDoc; }
      if (!lastError) throw new Error("不具合として記録されない");
      lastError = null;              // わざと起こした失敗なので、ここで消す
    });
    await step("「全部消す」（確認 → 消す）", async () => {
      await click('nav.tabs [data-tab="p-set"]');
      await click("#btnWipe");
      if (!has("#cfYes")) throw new Error("確認シートが出ない");
      await click("#cfYes"); await wait(400);
      if (state.items.length || state.notes.length || state.docs.length) throw new Error("消えていない");
      // **保存先も読み直す。**ここを見ていなかったので v4.8 の穴を見逃していた
      const db = await window.claude.use("db");
      for (const c of ["notes", "items", "turns", "docs"]) {
        const n = (await db.collection(c).get()).docs.length;
        if (n) throw new Error(`保存先の ${c} が ${n}件 残っている`);
      }
    });
    await step("空になったあとも画面が出る", async () => {
      await click('nav.tabs [data-tab="p-day"]');
      if (!$$("#dayOut").innerHTML.trim()) throw new Error("今日タブが空白");
      await click('nav.tabs [data-tab="p-me"]');
      if (!$$("#meOut").innerHTML.trim()) throw new Error("わたしのことタブが空白");
      await click('nav.tabs [data-tab="p-chat"]');
      if (!$$("#chatOut").innerHTML.trim()) throw new Error("話すタブが空白");
    });
    /* .ics の取り込みは、本物のカレンダーだと**何年ぶんも**入っている。
       足す前に件数を出し、「この先1年ぶんだけ」という逃げ道があること、
       そして**しぼったら本当にしぼられている**ことを確かめる。 */
    await step(".ics の取り込み：この先1年ぶんだけを選べる", async () => {
      const tz = state.settings.timezone, P = parts(new Date(), tz);
      const st = (y, mo, d) => `${y}${String(mo).padStart(2, "0")}${String(d).padStart(2, "0")}T100000Z`;
      const ev = (t, v) => ["BEGIN:VEVENT", "SUMMARY:" + t, "DTSTART:" + v, "END:VEVENT"].join("\r\n");
      const text = ["BEGIN:VCALENDAR",
        ev("ずっと前の会議", st(P.y - 2, 5, 10)),
        ev("来月の面談", st(P.y, P.mo, P.d).replace(/T.*/, "T100000Z")),
        ev("2年先の式典", st(P.y + 2, P.mo, P.d)),
        "END:VCALENDAR"].join("\r\n");
      const before = state.items.length;
      const pr = importICS(text, "test.ics");
      if (!await waitFor(() => has("#cfYes"), 3000)) throw new Error("確認シートが出ない");
      if (!has("#cfAlt")) throw new Error("「この先1年ぶんだけ」の道が出ない");
      if (!/1年ぶんだけ（1件）/.test($$("#cfAlt").textContent)) throw new Error("しぼったときの件数が出ない: " + $$("#cfAlt").textContent);
      await click("#cfAlt"); await pr; await wait(200);
      const added = state.items.length - before;
      if (added !== 1) throw new Error("しぼったのに " + added + "件 入った");
      if (state.items.some(i => i.title === "ずっと前の会議" || i.title === "2年先の式典"))
        throw new Error("しぼった範囲の外まで入っている");
      if (!/足していません/.test($$("#expOut").textContent)) throw new Error("残りを足していないことを言わない");
    });
    await step(".ics の取り込み：上限を超えるときは、足す前に言う", async () => {
      const tz = state.settings.timezone, P = parts(new Date(), tz);
      const ev = (t, v) => ["BEGIN:VEVENT", "SUMMARY:" + t, "DTSTART:" + v, "END:VEVENT"].join("\r\n");
      const text = ["BEGIN:VCALENDAR",
        ev("上限ためし", `${P.y + 1}0301T100000Z`), "END:VCALENDAR"].join("\r\n");
      const keep = state.notes;
      state.notes = new Array(READ_LIMIT).fill(0).map((_, i) => ({ id: "x" + i }));   // 保存はしない。数えるところだけ演じる
      const before = state.items.length;
      try {
        const pr = importICS(text, "big.ics");
        if (!await waitFor(() => has("#cfYes"), 3000)) throw new Error("確認シートが出ない");
        const body = $$("#sheetHost").textContent;
        if (!/超えます/.test(body)) throw new Error("上限を超えることを言わない: " + body);
        if (!/画面に出なくなります/.test(body)) throw new Error("超えると何が起きるかを言わない");
        await click("#cfNo"); await pr; await wait(120);
      } finally { state.notes = keep; }
      if (state.items.length !== before) throw new Error("やめたのに入っている");
    });
    /* 作業に使える時間帯が狭いまま保存されていると、その外に何も置けない。
       設定欄は外してあるので、**押して直せること**をここで確かめる（v6.3・実機で報告）。 */
    await step("作業に使える時間帯が狭いと知らせ、押すと一日じゅうに戻る", async () => {
      await putSettings(Object.assign({}, state.settings, { workStart: "05:00", workEnd: "11:00" }));
      await click('nav.tabs [data-tab="p-set"]');
      const w = $$("#windowWarn");
      if (!w || w.hidden) throw new Error("狭いことを知らせない");
      if (!/05:00〜11:00/.test(w.textContent)) throw new Error("いまの値を出さない: " + w.textContent);
      if (!/作業に使える時間帯：05:00〜11:00/.test($$("#dataState").textContent))
        throw new Error("データ欄にも出ていない: " + $$("#dataState").textContent);
      await click("#btnWholeDay");
      if (state.settings.workStart !== "00:00" || state.settings.workEnd !== "23:59")
        throw new Error("押しても戻らない: " + state.settings.workStart + "〜" + state.settings.workEnd);
      // **保存先まで読み直して確かめる**（画面だけ変わって保存できていない、を防ぐ）
      const db = await window.claude.use("db");
      const got = await db.doc("meta/settings").get();
      if (!got.exists || got.data().workEnd !== "23:59")
        throw new Error("保存先に残っていない: " + (got.exists ? got.data().workEnd : "無し"));
      if (!$$("#windowWarn").hidden) throw new Error("戻したのに知らせが残る");
    });
    /* 1日の組み立て（v6.5）。**AIがオンの本番と同じ条件**で、
       発言 → 13枠が予定表に入る → 習慣を取り入れる → 提案だけ全部消す、まで実際に押す。 */
    await step("「1日を組み立てて」で、予定表に入る（AIオンのまま）", async () => {
      await putSettings(Object.assign({}, state.settings, { workStart: "00:00", workEnd: "23:59" }));
      await click('nav.tabs [data-tab="p-chat"]');
      /* **本物の時計に依存させない**（記録済みの落とし穴。実際に踏んだ）。
         「6時から11時半」だと、**テストを回した時刻が18時を過ぎている日は窓が切り詰められ**、
         提案が9件→6件に減って落ちる（21:54 に走らせて実際にそうなった）。
         「明日の朝」と日付を明示すれば、いつ走らせても窓が丸ごと使える
         （v7.0 で「日付を言われたら今日へ寄せない」を入れてある）。 */
      type("#say", "明日の朝6時から11時半までの間で勉強を30分かける2回。その間にご飯と散歩それぞれ30分ずつ使う。"
        + "他に入れる予定ややった方がいい習慣などを提案してスケジュールを組み立てて。");
      await click("#btnSend");
      if (!await waitFor(() => state.items.filter(i => i.suggested).length >= 5, 8000))
        throw new Error("提案が入らない（AIオンだとコードの組み立てが消えている）："
          + state.items.length + "件 / 提案" + state.items.filter(i => i.suggested).length + "件");
      if (state.items.filter(i => !i.suggested && i.kind === "task").length < 4)
        throw new Error("本人が言った4件が入っていない：" +
          state.items.filter(i => !i.suggested).map(i => i.title).join(","));
      // **習慣のための欄は作らない**（v6.7・本人の指示）。提案はAIの返事の文の中だけ
      if (document.querySelector('#chatOut [data-act="habit"]'))
        throw new Error("習慣の欄が残っている（返事の文の中だけにする）");
      if (/このような習慣はどうですか/.test($$("#chatOut").textContent))
        throw new Error("コードが習慣の見出しを出している");
    });
    await step("「提案した予定を全部消す」で、提案だけ消える", async () => {
      const b = document.querySelector('#chatOut [data-act="clearsug"]');
      if (!b) throw new Error("まとめて消す道が無い");
      const mine = state.items.filter(i => !i.suggested && i.kind === "task").length;
      const pr = act("clearsug", b.dataset.id);
      if (!await waitFor(() => has("#cfYes"), 3000)) throw new Error("確認シートが出ない");
      await click("#cfYes"); await pr; await wait(200);
      if (state.items.some(i => i.suggested && i.status === "open")) throw new Error("提案が残っている");
      if (state.items.filter(i => !i.suggested && i.kind === "task" && i.status === "open").length !== mine)
        throw new Error("本人が言った予定まで消した");
    });
    await step("空の状態から、また話しかけられる", async () => {
      type("#say", "明日の11時に打ち合わせ。");
      await click("#btnSend"); await wait(400);
      if (!state.items.length) throw new Error("何も作られない");
    });

    const fails = R.filter(x => x.startsWith("FAIL"));
    const pre = document.createElement("pre"); pre.id = "WALK";
    pre.textContent = "===== 操作の総点検 =====\n" + R.join("\n") +
      `\n\n合計 ${R.filter(x => /^(PASS|FAIL)/.test(x)).length} 操作 / 失敗 ${fails.length} 件\n` +
      (ERR.length ? "\n［拾ったエラー全部］\n" + ERR.join("\n") : "") + "\n===== END =====\n";
    document.body.appendChild(pre);
  }

  run().catch(e => {
    const pre = document.createElement("pre"); pre.id = "WALK";
    pre.textContent = R.join("\n") + "\n\n===== 途中で落ちた =====\n" + (e && (e.stack || e.message || e));
    document.body.appendChild(pre);
  });
})();
