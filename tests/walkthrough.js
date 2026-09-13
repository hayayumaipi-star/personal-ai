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
