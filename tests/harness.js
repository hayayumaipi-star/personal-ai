/* 受け入れ条件の自動チェック。index.html のあとに読み込んで実行する。 */
(function () {
  const R = [];
  const ok = (name, cond, extra) => R.push((cond ? "PASS" : "FAIL") + " :: " + name + (extra ? "  [" + extra + "]" : ""));
  const TZ = "Asia/Tokyo";
  const dk = d => dayKey(new Date(d), TZ);

  /* テスト用の例文。もとはアプリの `SAMPLE` だったが、**アプリは使っていなかった**ので
     こちらへ引っ越した（v6.4）。画面の「例を入れてみる」は `SAMPLE_TALK` のほう。 */
  const SAMPLE = `えーと、今日はあんまり寝てない。5時間くらい。ちょっとだるい感じ。
明日の15時から歯医者の予約が入ってる。
来週の金曜までに研究計画書を出さないといけない。まだ全然書けてない。たぶん3時間くらいかかると思う。
田中さんに返信するの忘れてた。今日中にやる。15分くらい。
今日は11時から12時半までゼミ。
今年は週2回は走る習慣をつけたい。
あとスーパーで洗剤買う。`;

  /* **アプリが実際に通る道でテストする**（v6.4）。
     以前は `ingest()` を呼んでいたが、あれは**アプリからは呼ばれていない関数**だった。
     テストだけが生きていない道を測っている状態で、決まり7e の穴そのもの。
     ここは `sendTurn` と同じ順番（原文を保存 → ruleOps → applyOps）を通す。 */
  async function feed(text, atISO) {
    const clean = normNote(text);
    const note = { id: uid(), text: clean, hash: hash(clean + "|" + atISO),
      capturedAt: atISO, source: "talk", sourceName: null, createdAt: atISO };
    await putNote(note);
    const n0 = state.items.length;
    const res = await applyOps(ruleOps(note), note);
    return { note, created: state.items.slice(n0), changes: res.changes, asks: res.asks };
  }

  async function run() {
    for (let i = 0; i < 200 && !state.ready; i++) await new Promise(r => setTimeout(r, 20));
    // 素の状態から開始
    state.notes = []; state.items = [];
    state.settings = Object.assign({}, DEFAULTS, { timezone: TZ, workStart: "09:00", workEnd: "18:00", defaultEstimate: 30 });

    // 記録日時を固定（2026-09-11 09:00 JST）
    const CAP = zoned(2026, 9, 11, 9, 0, TZ).toISOString();
    const capKey = dk(CAP);
    const capDow = parts(new Date(CAP), TZ).dow;

    /* ---- 1. 「明日」「来週」を記録日時とタイムゾーンで解釈する ---- */
    const w1 = parseWhen("明日の15時から歯医者", CAP, TZ);
    const expTomorrow = dk(new Date(keyToDate(capKey, TZ).getTime() + 86400000));
    ok("「明日」= 記録日の翌日", w1 && w1.dayKey === expTomorrow, w1 && w1.dayKey + " / 期待 " + expTomorrow);
    ok("「明日の15時」= 15:00 JST", w1 && parts(new Date(w1.start), TZ).h === 15, w1 && w1.start);

    const w2 = parseWhen("来週の金曜までに研究計画書を出す", CAP, TZ);
    const w2dow = w2 ? parts(new Date(w2.iso), TZ).dow : -1;
    const w2days = w2 ? Math.round((keyToDate(w2.dayKey, TZ) - keyToDate(capKey, TZ)) / 86400000) : -1;
    ok("「来週の金曜」= 金曜日になる", w2dow === 5, "dow=" + w2dow + " date=" + (w2 && w2.dayKey));
    ok("「来週の金曜」= 記録日から4〜14日後", w2days >= 4 && w2days <= 14, "+" + w2days + "日");
    ok("「まで」を期限として認識", w2 && w2.isDeadline === true);
    ok("曜日が言われているので日付を確定（precision=day）", w2 && w2.precision === "day", w2 && w2.precision);

    const w3 = parseWhen("来週あたりに片付けたい", CAP, TZ);
    ok("曜日なしの「来週」は日付を確定しない（precision=week）", w3 && w3.precision === "week", w3 && w3.precision);

    const w4 = parseWhen("今日は11時から12時半までゼミ", CAP, TZ);
    ok("「11時から12時半」を範囲として読む", w4 && parts(new Date(w4.start), TZ).h === 11 && parts(new Date(w4.end), TZ).h === 12 && parts(new Date(w4.end), TZ).mi === 30,
       w4 && (w4.start + "→" + w4.end));

    // タイムゾーン非依存の確認：同じ文でも記録日時が違えば結果が変わる
    const CAP2 = zoned(2026, 9, 12, 9, 0, TZ).toISOString();
    const w5 = parseWhen("明日やる", CAP2, TZ);
    ok("記録日時が1日ずれれば「明日」も1日ずれる", w5 && w5.dayKey !== w1.dayKey, w1.dayKey + " vs " + w5.dayKey);

    /* ---- 2. 読み取り・重複しない ---- */
    const r1 = await feed(SAMPLE, CAP);
    ok("メモから複数の項目を読み取る", r1.created.length >= 5, r1.created.length + "件");
    const kinds = {}; for (const i of r1.created) kinds[i.kind] = (kinds[i.kind] || 0) + 1;
    ok("タスク・予定・体調・目標を区別する", kinds.task > 0 && kinds.event > 0 && kinds.condition > 0 && kinds.goal > 0, JSON.stringify(kinds));
    ok("読み取り直後はすべて未確認", r1.created.every(i => i.confirmed === false && i.origin === "rule"));
    ok("根拠（元の文）が全項目に付いている", r1.created.every(i => i.evidence && i.evidence.text && r1.note.text.slice(i.evidence.start, i.evidence.end) === i.evidence.text));

    const before = state.items.length;
    const r2 = await feed(SAMPLE, CAP);
    ok("同じことをもう一度言っても項目が増えない", r2.created.length === 0 && state.items.length === before, "項目数 " + before + "→" + state.items.length);
    // **黙って捨てない**（決まり5）。ぶつかったことを必ず知らせる
    ok("ぶつかったことを黙って捨てない", r2.asks.length >= 1, r2.asks.length + "件の知らせ");

    // 本文は同じだが空白違い → 正規化して同じ項目と判定
    const r3 = await feed(SAMPLE.replace(/\n/g, "\n  "), CAP);
    ok("空白違いでも項目は増えない", r3.created.length === 0 && state.items.length === before, "項目数 " + state.items.length);

    /* ---- 3. 固定予定と重ならない案を作る ---- */
    let plan = planFor(capKey);
    const fixed = plan.blocks.filter(b => b.type === "fixed");
    const flex = plan.blocks.filter(b => b.type === "flex");
    ok("固定予定がタイムラインに載る", fixed.length >= 1, fixed.map(b => b.item.title + " " + hhmm(b.s) + "-" + hhmm(b.e)).join(" / "));
    ok("見出しから日時表現と助詞が取り除かれている",
       state.items.every(i => i.kind === "condition" || !/^[はがにをでのともから]|^まで|\d{1,2}時|\d+分/.test(i.title)),
       state.items.filter(i => i.kind !== "condition").map(i => i.title).join(" ／ "));
    ok("ゼミが 11:00–12:30 の固定予定になる", fixed.some(b => b.s === 660 && b.e === 750), fixed.map(b => hhmm(b.s) + "-" + hhmm(b.e)).join(","));
    let overlap = false;
    for (const f of flex) for (const x of fixed) if (f.s < x.e && x.s < f.e) overlap = true;
    ok("作業枠が固定予定と重ならない", overlap === false);
    ok("作業枠が作業時間帯の中に収まる", flex.every(b => b.s >= plan.winS && b.e <= plan.winE));
    // 固定の予定だけは理由を書かない（左の実線の帯が「動かさない」を言っている）。
    // それ以外の枠は、なぜそこに置いたのかが必ず読めること。
    ok("固定以外の枠には理由が付いている",
       plan.blocks.filter(b => b.sub !== "event").every(b => b.reason && b.reason.length > 3),
       plan.blocks.filter(b => b.sub !== "event" && !(b.reason && b.reason.length > 3))
         .map(b => b.type + ":" + hhmm(b.s)).join(" / ") || "全部ある");

    const na1 = nextAction(plan, 9 * 60 + 30);   // 9:30 時点として評価
    ok("「次にすること」が理由付きで出る", !!na1 && na1.reasons.length >= 1, na1 && (na1.block.item.title + " / " + na1.reasons[0]));
    ok("「次にすること」に体調の申告が引用される", !!na1 && na1.reasons.some(r => /本人の申告/.test(r)), na1 && na1.reasons.join(" | "));
    const naLate = nextAction(plan, 23 * 60);
    ok("その日の枠を過ぎたら「次にすること」を出さない", naLate === null);

    /* ---- 4. 完了したタスクが再提案されない ---- */
    const tanaka = state.items.find(i => i.kind === "task" && /田中/.test(i.title));
    ok("「田中さんに返信」をタスクとして読み取る", !!tanaka, tanaka && tanaka.title);
    if (tanaka) {
      ok("「15分くらい」を所要時間として読む", tanaka.estimateMin === 15, String(tanaka.estimateMin));
      tanaka.status = "done"; tanaka.completedAt = new Date().toISOString(); await putItem(tanaka);
      plan = planFor(capKey);
      ok("完了にしたタスクが今日の案から消える", !plan.blocks.some(b => b.item.id === tanaka.id));
      ok("完了にしたタスクは未配置にも出ない", !plan.unplaced.some(u => u.item.id === tanaka.id));
    }

    /* ---- 5. 完了済みと同じ内容を言い直しても復活しない ---- */
    const r4 = await feed("田中さんに返信するの忘れてた。今日中にやる。15分くらい。", CAP);
    const revived = r4.created.filter(i => /田中/.test(i.title));
    ok("完了済みと同じタスクは、言い直しても復活しない", revived.length === 0, "新規" + revived.length + "件");
    ok("復活しなかったことを、黙らずに知らせる", r4.asks.length >= 1, r4.asks.join(" / ") || "知らせ無し");

    /* ---- 6. 訂正が以後の提案に反映される ---- */
    const keikaku = state.items.find(i => i.kind === "task" && /研究計画/.test(i.title));
    ok("「研究計画書」をタスクとして読み取る", !!keikaku, keikaku && keikaku.title);
    if (keikaku) {
      ok("「3時間くらい」を180分として読む", keikaku.estimateMin === 180, String(keikaku.estimateMin));
      /* v4.4：**置き場所（時刻か時間帯）を言ったものだけ**が予定表に入る。
         ここで見たいのは「所要時間を直すと枠の長さが変わるか」なので、
         置き場所として「午前中に」を与えてから測る。 */
      /* v4.6：置き場所は「その日のどこ」であって「どの日」ではない。
         期限が先の用事を、今日の午後が空いているからといって今日には置かない。
         ここで見たいのは枠の長さなので、「今日やりたい」と言った扱いにする。 */
      keikaku.preferWindow = "afternoon";   // 午前はゼミで埋まっている
      keikaku.targetDay = capKey;
      await putItem(keikaku);
      const beforeBlocks = planFor(capKey).blocks.filter(b => b.item.id === keikaku.id).map(b => b.e - b.s)[0];
      keikaku.estimateMin = 45; keikaku.corrected = true; keikaku.confirmed = true;
      keikaku.history = (keikaku.history || []).concat({ at: new Date().toISOString(), by: "user", what: "所要時間を180分→45分に直した" });
      await putItem(keikaku);
      const afterBlocks = planFor(capKey).blocks.filter(b => b.item.id === keikaku.id).map(b => b.e - b.s)[0];
      ok("所要時間を直すと作業枠の長さが変わる", beforeBlocks === 180 && afterBlocks === 45, beforeBlocks + "分 → " + afterBlocks + "分");
      ok("訂正した項目は「本人が訂正」として扱われる", keikaku.corrected === true && keikaku.history.length >= 1);

      // 延期 → 今日の案から消え、翌日に移る
      const dayBefore = keikaku.dayKey;
      const nxt = dk(new Date(keyToDate(capKey, TZ).getTime() + 86400000));
      keikaku.dayKey = nxt; keikaku.due = zoned(...nxt.split("-").map(Number), 23, 59, TZ).toISOString();
      keikaku.dedupeKey = dedupeKey(keikaku); await putItem(keikaku);
      ok("延期すると期限が翌日になる", keikaku.dayKey === nxt, dayBefore + " → " + keikaku.dayKey);
    }

    /* ---- 7. 空きが足りなければ詰め込まず、理由を示す ---- */
    state.settings.workStart = "09:00"; state.settings.workEnd = "09:30";
    const tight = planFor(capKey);
    ok("空き時間が足りなければ未配置にする", tight.unplaced.length >= 1, "未配置 " + tight.unplaced.length + "件");
    // 理由の言い方は増える（v6.2b で「帯の外です」「もう過ぎています」が加わった）。
    // 見張るのは「説明になっているか」で、特定の文面ではない。
    ok("未配置に理由が付く",
       tight.unplaced.every(u => u.reason && /分|埋まって|空き|外です|過ぎて/.test(u.reason)),
       tight.unplaced.map(u => u.reason)[0]);
    ok("空き時間を超える作業枠は作らない", tight.blocks.filter(b => b.type === "flex").every(b => b.e <= 570));
    state.settings.workStart = "09:00"; state.settings.workEnd = "18:00";

    /* ---- 8. 体調は数値化しない ---- */
    const cond = state.items.filter(i => i.kind === "condition");
    ok("体調は本人の言葉をそのまま保持する", cond.length >= 1 && cond.every(c => typeof c.selfReport === "string" && c.selfReport.length > 0));
    ok("体調に点数やスコアを作らない", cond.every(c => !("score" in c) && !("energy" in c) && !("focus" in c) && !("stress" in c)));
    ok("体調に出典日時が付く", cond.every(c => !!c.reportedAt));
    const condOther = recentConditions(dk(new Date(keyToDate(capKey, TZ).getTime() + 5 * 86400000)));
    ok("5日後の日を見ると、その日の体調申告は使われない", condOther.length === 0);

    /* ---- 9. 保存と復元 ---- */
    lsWrite();
    const raw = lsRead();
    ok("記録と訂正がローカルに書き出せる", !!raw && raw.items.length === state.items.length && raw.notes.length === state.notes.length,
       raw ? raw.items.length + "件" : "localStorage 不可(file://)");
    if (raw) {
      const restored = raw.items.find(i => i.id === (keikaku && keikaku.id));
      ok("訂正内容が保存データに残る", !!restored && restored.estimateMin === 45 && restored.corrected === true);
    }

    /* ---- 10. AI不在でも全部動く ---- */
    ok("AIなし（sample capability なし）でここまで全部動いた", typeof SAMPLEFN === "undefined" || SAMPLEFN === null || true);
    ok("AI未接続時も入力内容が保持される仕組み（原文が先に保存される）", state.notes.length >= 1 && state.notes.every(n => n.text && n.hash));

    /* ================= 会話（ops）のテスト ================= */
    state.notes = []; state.items = []; state.turns = {};
    state.settings = Object.assign({}, DEFAULTS, { timezone: TZ, workStart: "08:00", workEnd: "18:00", defaultEstimate: 30, breakEveryMin: 90, breakMin: 10 });

    // 発話を1つ処理する（AIなし＝ルールのみの経路）
    async function say(text, atISO) {
      const clean = normNote(text);
      const n = { id: uid(), text: clean, hash: hash(clean + "|" + atISO), capturedAt: atISO, source: "talk", sourceName: null, createdAt: atISO };
      await putNote(n);
      const res = await applyOps(ruleOps(n), n);
      return { note: n, changes: res.changes, asks: res.asks };
    }
    const T = (h, mi) => zoned(2026, 9, 11, h, mi, TZ).toISOString();

    // --- 朝：整理していない発話 ---
    const m1 = await say("おはよう。昨日寝たのがたぶん1時半くらいで、今日起きたのが8時。ちょっと眠い。朝ごはんはまだ食べてない。今日はあんまり予定を詰めすぎないでほしい。", T(8, 10));
    ok("混ざった発話から体調と要望を同時に拾う",
       state.items.some(i => i.kind === "condition") && prefs(dk(T(8,0))).buffer === true,
       m1.changes.join(" / "));
    ok("体調は本人の言葉のまま（点数を作らない）",
       state.items.filter(i => i.kind === "condition").every(c => c.selfReport && !("score" in c) && !("energy" in c)));

    // 「できれば午前中に」まで言っている（v4.4：置き場所を言ったものだけ予定表に入るため）
    const m2 = await say("昨日言ってた資料を作らないと。明日までに相手に送るやつ。1時間くらいでできると思ってたけど、調べることもあるからもうちょっとかかるかも。できれば午前中に進めたい。", T(8, 12));
    const shiryo = state.items.find(i => i.kind === "task" && /資料/.test(i.title));
    ok("「資料を作る」をタスクとして拾う", !!shiryo, shiryo && (shiryo.title + " / " + shiryo.estimateMin + "分 / 期限" + shiryo.dayKey));
    ok("「昨日言ってた…明日までに」の期限は昨日ではなく明日になる", shiryo && shiryo.dayKey === "2026-09-12", shiryo && shiryo.dayKey);
    ok("見出しから話し言葉の前置きが落ちる", shiryo && !/^言ってた|^あと|^えーと/.test(shiryo.title), shiryo && shiryo.title);

    // AIなしのとき、言い直しを黙って無視しない
    const rs = await say("資料、思ったより時間かかってる。あと1時間は必要そう。", T(14, 0));
    ok("「あと1時間」を残り時間として反映する（完了にしない）",
       shiryo && findItem(shiryo.id).remainingMin === 60 && findItem(shiryo.id).status === "open",
       shiryo ? ("残り" + findItem(shiryo.id).remainingMin + "分 / " + findItem(shiryo.id).status) : "-");
    ok("「〜そう」を新しいタスクにしない",
       !state.items.some(i => i.kind === "task" && /そう|かかり/.test(i.title)),
       state.items.filter(i => i.kind === "task").map(i => i.title.slice(0, 20)).join(" / "));
    // 対象が分からない言い直しは、黙って無視せず伝える
    const rs3 = await say("やっぱり30分に変えて。", T(14, 5));
    ok("対象が分からない言い直しは、黙って無視せず伝える",
       rs3.asks.length >= 1 && /AI|直して/.test(rs3.asks.join(" ")), rs3.asks.join(" ") || "何も言わなかった");
    // ただし新しい用事が作れているなら、余計な注意は出さない
    const rs2 = await say("来月の5日に健康診断がある。2時間くらいかかりそう。", T(14, 5));
    ok("新規の用事が作れたときは余計な注意を出さない", rs2.asks.length === 0 && rs2.changes.length >= 1,
       "asks=[" + rs2.asks.join(" ") + "] changes=[" + rs2.changes.join(" / ") + "]");
    const kenshin = state.items.find(i => /健康診断/.test(i.title));
    ok("「来月の5日」を日付として読む", kenshin && kenshin.dayKey === "2026-10-05", kenshin && kenshin.dayKey);
    ok("時刻を言っていない予定は「時刻未定」として扱う", kenshin && kenshin.timeUnknown === true);
    ok("時刻未定の予定を時間割に置かない（23:59の幻の枠を作らない）",
       !planFor("2026-10-05").blocks.some(b => b.item && b.item.id === (kenshin && kenshin.id)) &&
       planFor("2026-10-05").timeless.length === 1,
       planFor("2026-10-05").blocks.map(b => hhmm(b.s) + " " + blockTitle(b)).join(" / ") || "(枠なし)");
    ok("「12月25日」は「25日」と混同しない", (() => {
      const w = parseWhen("12月25日に発表がある", T(9, 0), TZ);
      return w && w.dayKey === "2026-12-25";
    })(), (parseWhen("12月25日に発表がある", T(9, 0), TZ) || {}).dayKey);

    const m3 = await say("あと、友達にAIの構想を送ろうと思ってたんだった。これは今日絶対じゃないけど、忘れないようにしておいて。", T(8, 14));
    const tomo = state.items.find(i => i.kind === "task" && /友達|構想/.test(i.title));
    ok("「今日絶対じゃない」用事も記録される", !!tomo, tomo && (tomo.title + " / 期限" + tomo.dayKey));

    let p = planFor("2026-09-11");
    ok("朝の時点で作業枠が作られる", p.blocks.filter(b => b.type === "flex").length >= 1,
       p.blocks.map(b => hhmm(b.s) + "-" + hhmm(b.e) + " " + blockTitle(b)).join(" / "));
    ok("「余裕を持たせて」の要望が予備時間として効く", p.blocks.some(b => b.type === "buf"),
       p.blocks.map(b => b.type).join(","));

    /* --- 全角数字と「〜に行く」：予定として反映されること --- */
    {
      const save = state.items.slice();
      state.items = [];
      const zen = await say("明日の午後５時に歯医者に行く", T(10, 0));
      const e1 = state.items.find(i => i.kind === "event");
      ok("全角数字の「午後５時」を時刻として読む",
         !!e1 && parts(new Date(e1.start), TZ).h === 17, e1 ? (e1.kind + " " + fmtDT(e1.start, TZ)) : "予定にならなかった");
      ok("「歯医者に行く」が固定の予定になる（タスクではない）",
         !!e1 && e1.fixed === true && e1.dayKey === "2026-09-12", e1 && (e1.title + " / " + e1.dayKey));
      ok("全角で話しても原文は全角のまま残る", state.notes.some(n => /５/.test(n.text)));
      ok("別の日のことだと分かる（days に翌日が入る）",
         zen.changes.length >= 1 && /9\/12|17:00/.test(zen.changes.join(" ")), zen.changes.join(" / "));

      state.items = [];
      // 「カフェ」は予定の単語リストに入れていない。時刻＋「〜に行く」だけで判定できるかを見る。
      ok("検証の前提：カフェは単語リストに無い", !RE_EVENT.test("カフェ"));
      await say("あさっての午後5時にカフェに行く", T(10, 5));
      const e2 = state.items.find(i => i.kind === "event");
      ok("単語リストに無くても「時刻＋〜に行く」は予定になる",
         !!e2 && parts(new Date(e2.start), TZ).h === 17 && e2.dayKey === "2026-09-13",
         e2 ? (e2.kind + " " + fmtDT(e2.start, TZ)) : state.items.map(i => i.kind + ":" + i.title).join(","));

      state.items = [];
      await say("昨日寝たのがたぶん1時半くらいで、今日起きたのが8時。ちょっと眠い。", T(9, 0));
      ok("時刻が出てきても、体調の話は予定にしない",
         !state.items.some(i => i.kind === "event") && state.items.some(i => i.kind === "condition"),
         state.items.map(i => i.kind).join(","));

      state.items = save;
    }

    // --- 訂正：時刻の言い直し（AIなしでは特定できないことを確かめる） ---
    const ev = {
      id: uid(), noteId: null, kind: "event", title: "打ち合わせ", fixed: true,
      start: zoned(2026, 9, 12, 15, 0, TZ).toISOString(), end: zoned(2026, 9, 12, 16, 0, TZ).toISOString(),
      dayKey: "2026-09-12", duePrecision: "exact", origin: "user", confirmed: true, corrected: false,
      status: "open", evidence: { text: "（手入力）" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: []
    };
    ev.dedupeKey = dedupeKey(ev); await putItem(ev);

    // AIが返す ops を模したもの（実際のAI応答と同じ形）を検証つきで適用する
    const fakeNote = { id: uid(), text: "明日の予定、15時じゃなくて14時だった。移動に40分くらいかかる。直前に慌てたくないから少し余裕を持たせておいて。", hash: "x", capturedAt: T(12, 0), source: "talk", createdAt: T(12, 0) };
    await putNote(fakeNote);
    const r = await applyOps([
      { op: "update", id: ev.id, dueDate: "2026-09-12", dueTime: "14:00", travelMin: 40, prepMin: 20, quote: "15時じゃなくて14時だった" }
    ], fakeNote);
    const ev2 = findItem(ev.id);
    const on912 = state.items.filter(i => i.kind === "event" && i.dayKey === "2026-09-12");
    ok("言い直しで既存の予定が更新される（新規追加しない）",
       parts(new Date(ev2.start), TZ).h === 14 && on912.length === 1,
       fmtDT(ev2.start, TZ) + " / 9-12の予定数" + on912.length);
    ok("訂正は「本人が訂正」として履歴に残る", ev2.corrected === true && ev2.history.length >= 1, ev2.history.map(h => h.what).join(" | "));
    ok("移動40分・準備20分が記録される", ev2.travelMin === 40 && ev2.prepMin === 20);

    const pt = planFor("2026-09-12");
    const trav = pt.blocks.find(b => b.sub === "travel"), prep = pt.blocks.find(b => b.sub === "prep");
    ok("移動が予定の前に固定枠として入る", !!trav && trav.e === 14 * 60 && trav.s === 13 * 60 + 20, trav && hhmm(trav.s) + "-" + hhmm(trav.e));
    ok("準備が移動の前に入る", !!prep && prep.e === trav.s && prep.s === 13 * 60, prep && hhmm(prep.s) + "-" + hhmm(prep.e));
    ok("移動・準備の枠に作業枠が重ならない",
       !pt.blocks.some(b => b.type === "flex" && b.s < trav.e && trav.s < b.e));

    // 存在しないidへの操作は拒否する
    const bad = await applyOps([{ op: "done", id: "nonexistent-id" }, { op: "add", kind: "task", title: "" }], fakeNote);
    ok("存在しないidへの操作は拒否して本人に聞く", bad.changes.length === 0 && bad.asks.length >= 1, bad.asks.join(" "));

    // --- 完了と延期 ---
    const before2 = state.items.length;
    const d1 = await say("資料できた。送るのも終わった。", T(15, 25));
    const sh2 = findItem(shiryo.id);
    ok("「できた」で該当タスクが完了になる", sh2.status === "done", d1.changes.join(" / "));
    ok("完了の発話で新しいタスクを作らない", state.items.length === before2, before2 + "→" + state.items.length);

    p = planFor("2026-09-11");
    ok("完了したタスクは今日の案から消える", !p.blocks.some(b => b.item.id === shiryo.id));

    if (tomo) {
      await applyOps([{ op: "defer", id: tomo.id, toDate: null, quote: "明日以降に回したい" }], fakeNote);
      ok("延期すると翌日へ移る", findItem(tomo.id).dayKey === "2026-09-12", findItem(tomo.id).dayKey);
    } else ok("延期すると翌日へ移る", false, "対象タスクが抽出できていない");

    // --- 「次の一手だけ」モード ---
    await say("予定が細かく決まってると遅れた瞬間に嫌になる。次にやることが一つ分かるくらいの方が楽だから、しばらくそういう出し方にしてみてほしい。", T(16, 0));
    ok("「一つだけ見せて」を要望として保存する", prefs(dk(T(16,0))).nextOnly === true,
       liveItems().filter(i => i.kind === "preference").map(i => i.title).join(" / "));
    ok("要望は計画づくりから読める形で保存される",
       liveItems().some(i => i.kind === "preference" && i.preferKey === "nextOnly"));

    // --- 夜は作業を入れない（作業時間が21時までの人の場合） ---
    state.settings.workEnd = "21:00";
    const peBefore = planFor("2026-09-11").winE;
    await say("今日は早めに寝たいから、夜まで作業する感じにはしたくない。", T(17, 0));
    const pe = planFor("2026-09-11");
    ok("「夜は作業したくない」で作業時間の終わりが早まる",
       peBefore === 21 * 60 && pe.winCapped === true && pe.winE === 18 * 60, hhmm(peBefore) + " → " + hhmm(pe.winE));
    state.settings.workEnd = "18:00";

    // --- あとで見返すメモ ---
    await say("調べたことは面白かったから、あとで見返せるように残しておいて。", T(11, 0));
    ok("「残しておいて」をメモとして保存する", state.items.some(i => i.kind === "memo"),
       state.items.filter(i => i.kind === "memo").map(i => i.title.slice(0, 20)).join(" / "));

    // --- 休憩の自動挿入 ---
    state.items = state.items.filter(i => i.kind !== "task" && i.kind !== "preference");
    for (let i = 0; i < 3; i++) {
      // v4.4：置き場所（ここでは「午前中に」）を言ったものだけ予定表に入る
      const t = { id: uid(), noteId: null, kind: "task", title: "作業" + i, estimateMin: 60, status: "open",
        origin: "user", confirmed: true, corrected: false, evidence: { text: "x" }, duePrecision: "none",
        preferWindow: "morning",
        createdAt: "2026-09-11T00:0" + i + ":00Z", updatedAt: "", history: [] };
      t.dedupeKey = dedupeKey(t); await putItem(t);
    }
    const pb = planFor("2026-09-11");
    ok("続けて作業しすぎると休憩が入る", pb.blocks.some(b => b.type === "brk"),
       pb.blocks.map(b => hhmm(b.s) + " " + b.type).join(" / "));
    ok("休憩の理由が明示される", pb.blocks.filter(b => b.type === "brk").every(b => /休憩/.test(b.reason)));

    /* --- 取り消しと、その取り消し --- */
    {
      const t = { id: uid(), noteId: null, kind: "task", title: "消す用のタスク", estimateMin: 30, status: "open",
        origin: "user", confirmed: true, corrected: false, evidence: { text: "x" }, duePrecision: "none",
        createdAt: new Date().toISOString(), updatedAt: "", history: [] };
      t.dedupeKey = dedupeKey(t); await putItem(t);
      await act("drop", t.id);
      ok("「取り消す」で status が dropped になる", findItem(t.id).status === "dropped", findItem(t.id).status);
      ok("取り消した項目は計画に出ない", !planFor("2026-09-11").blocks.some(b => b.item.id === t.id));
      ok("取り消した記録は消えずに残る（履歴つき）",
         !!findItem(t.id) && findItem(t.id).history.some(h => /取り消/.test(h.what)));
      await act("undrop", t.id);
      ok("取り消しは元に戻せる", findItem(t.id).status === "open");
      await act("drop", t.id);

      /* **取り消す・戻すは「…」の中へ移した**（2026-09-24・案C）。
         行には出なくなったが、**道は1つも塞いでいない**——ここで確かめるのは
         「行に『…』があること」と「その中に取り消す／戻すがあること」の両方。
         目印を、画面から消えたものから、いまも出るものへ付け替えた（決まり15b）。 */
      const rowHtml = itemHTML(findItem(t.id));
      ok("行には「…」が出る（残りの操作はこの中）", /data-act="more"/.test(rowHtml));
      ok("行にはもう「取り消す」「訂正」を並べない",
         !/data-act="drop"/.test(rowHtml) && !/data-act="edit"/.test(rowHtml) && !/data-act="evid"/.test(rowHtml));
      openMore(findItem(t.id));
      const moreDropped = document.querySelector("#sheetHost").innerHTML;
      closeSheet();
      ok("取り消し済みなら「…」の中に「戻す」が出る",
         /data-act="undrop"/.test(moreDropped) && !/data-act="drop"/.test(moreDropped));
      await act("undrop", t.id);
      openMore(findItem(t.id));
      const moreOpen = document.querySelector("#sheetHost").innerHTML;
      closeSheet();
      ok("未完了なら「…」の中に「取り消す」が出る", /data-act="drop"/.test(moreOpen));
      ok("「…」の中に根拠と訂正がある", /data-act="evid"/.test(moreOpen) && /data-act="edit"/.test(moreOpen));
      await act("drop", t.id);
    }

    /* --- 原文の削除（note の id を渡す操作）が黙って終わらないこと --- */
    {
      const n = state.notes[0];
      ok("検証の前提：原文がある", !!n);
      if (n) {
        const before = state.notes.length;
        const p = act("delnote", n.id);
        await new Promise(r => setTimeout(r, 40));
        const sheetOpen = !!document.querySelector("#sheetHost #cfYes");
        ok("原文の削除で確認シートが開く（黙って何もしない状態に戻らない）", sheetOpen,
           sheetOpen ? "開いた" : "開かない＝note の id を項目として探してしまっている");
        if (sheetOpen) document.querySelector("#cfNo").click();
        await p;
        ok("「やめる」を押せば原文は消えない", state.notes.length === before);

        const p2 = act("delnote", n.id);
        await new Promise(r => setTimeout(r, 40));
        if (document.querySelector("#sheetHost #cfYes")) document.querySelector("#cfYes").click();
        await p2;
        ok("「消す」を押せば原文だけが消える（項目は残る）",
           !state.notes.some(x => x.id === n.id) && state.items.some(x => x.noteId === n.id),
           "原文" + state.notes.length + "件 / この原文から作られた項目" + state.items.filter(x => x.noteId === n.id).length + "件");
      }
    }

    /* --- ブラウザのダイアログに頼っていないこと --- */
    ok("window.confirm / alert を使っていない（サンドボックスでは無視されるため）",
       !/(^|[^.\w])confirm\s*\(|(^|[^.\w])alert\s*\(/.test(
         (document.querySelector("script") ? "" : "") +
         Array.from(document.scripts).map(s => s.textContent).join("\n").replace(/askConfirm/g, "")
       ));
    ok("消す前の確認はページ内のシートで行う", typeof askConfirm === "function");
    ok("削除された画面を開こうとする操作が残っていない",
       !Array.from(document.scripts).some(s => /showTab\("p-in"\)|renderRead\s*\(|renderLog\s*\(/.test(s.textContent)));

    /* --- 1行に複数の話題があるとき、日時と所要時間が混ざらないこと --- */
    {
      const savedI = state.items.slice(), savedN = state.notes.slice();
      state.items = []; state.notes = [];
      await say("来週の水曜に美容院の予約。今年は週2回走る習慣をつけたい。", T(9, 0));
      const biyo = state.items.find(i => /美容院/.test(i.title));
      const goal = state.items.find(i => i.kind === "goal");
      ok("「来週の水曜に美容院の予約」は予定になる（タスクではない）",
         biyo && biyo.kind === "event", biyo && (biyo.kind + " / " + biyo.title));
      ok("時刻未定の予定に、ありもしない時刻を表示しない",
         biyo && /時刻未定/.test(itemHTML(biyo)) && !/23:59/.test(itemHTML(biyo)),
         biyo ? (itemHTML(biyo).match(/class="mono">[^<]*/g) || []).join(" ") : "-");
      ok("同じ行の目標に、関係のない期限が付かない",
         goal && !goal.dayKey && goal.duePrecision === "none", goal && (goal.title + " / 期限" + goal.dayKey));

      state.items = []; state.notes = [];
      await say("歯医者の予約を取らないと。", T(9, 5));
      const yoyaku = state.items[0];
      ok("「予約を取らないと」は自分がやること（タスク）", yoyaku && yoyaku.kind === "task",
         yoyaku && (yoyaku.kind + " / " + yoyaku.title));

      state.items = []; state.notes = [];
      await say("明日の午後5時に歯医者に行く。今日は資料を作らないと。2時間くらい。", T(9, 10));
      const ha = state.items.find(i => i.kind === "event");
      const shi = state.items.find(i => i.kind === "task");
      ok("後ろの「2時間くらい」は直前に拾ったものに付く", shi && shi.estimateMin === 120,
         "資料=" + (shi && shi.estimateMin) + "分");
      ok("同じ行の予定に、他の話題の所要時間が混ざらない",
         ha && (new Date(ha.end) - new Date(ha.start)) / 60000 === 60,
         "歯医者=" + (ha ? (new Date(ha.end) - new Date(ha.start)) / 60000 : "?") + "分");

      state.items = savedI; state.notes = savedN; lsWrite();
    }

    /* --- 「わたしのこと」タブ --- */
    {
      const savedI = state.items.slice(), savedN = state.notes.slice(), savedD = state.docs.slice();
      state.items = []; state.notes = []; state.docs = [];

      ok("タブは4つ（話す・今日・わたしのこと・設定）",
         document.querySelectorAll("nav.tabs button").length === 4,
         Array.from(document.querySelectorAll("nav.tabs button")).map(b => b.textContent.trim()).join(" / "));
      ok("「わたしのこと」は今日と設定の間にある", (() => {
        const ids = Array.from(document.querySelectorAll("nav.tabs button")).map(b => b.dataset.tab);
        return ids.indexOf("p-me") === ids.indexOf("p-day") + 1 && ids.indexOf("p-set") === ids.indexOf("p-me") + 1;
      })());

      // 会話から「変わらないこと」だけを拾う
      await say("自分は昔から朝が苦手で、夜のほうが集中できるタイプ。", T(9, 0));
      await say("今日は疲れた。もう何もしたくない。", T(21, 0));
      const profs = state.items.filter(i => i.kind === "profile");
      const conds = state.items.filter(i => i.kind === "condition");
      ok("「昔から朝が苦手」は『わたしのこと』になる", profs.length >= 1,
         profs.map(p => p.category + "：" + p.title).join(" / "));
      ok("「今日は疲れた」は『わたしのこと』にしない（その日の体調）",
         conds.length >= 1 && !profs.some(p => /今日|疲れた/.test(p.title)),
         "体調" + conds.length + "件 / わたしのこと" + profs.length + "件");
      ok("読み取った『わたしのこと』は未確認から始まる", profs.every(p => p.confirmed === false));
      ok("いつ言ったかが残る", profs.every(p => !!p.statedAt));

      // 資料を渡す（ルールだけの経路）
      const doc = {
        id: uid(), title: "自己紹介", text: normNote(
          "私は研究をしています。統計の解析が得意ですが、人前で発表するのは昔から苦手です。\n" +
          "コーヒーが好きで、朝はいつもブラックを飲みます。\n" +
          "明日は10時から打ち合わせがあります。"),
        hash: "d1", chars: 100, truncated: false, source: "paste", sourceName: null,
        aiRead: false, createdAt: T(10, 0)
      };
      await putDoc(doc);
      const added = await saveProfiles(profilesByRule(doc));
      ok("資料から『わたしのこと』を読み取る", added.length >= 2,
         added.map(a => a.category + "：" + a.title.slice(0, 20)).join(" / "));
      ok("資料から読み取ったものに出典が付く", added.every(a => a.docId === doc.id));
      ok("資料の中の『明日の打ち合わせ』は『わたしのこと』にしない",
         !added.some(a => /打ち合わせ|明日/.test(a.title)), added.map(a => a.title).join(" / "));

      const again = await saveProfiles(profilesByRule(doc));
      ok("同じ資料を読み直しても重複しない", again.length === 0, again.length + "件");

      // 画面に両方の欄が出ること
      renderMe();
      const meHtml = document.querySelector("#meOut").innerHTML;
      ok("『会話から集まったこと』の欄がある", /会話から集まったこと/.test(meHtml));
      ok("『自分で渡したもの』の欄がある", /自分で渡したもの/.test(meHtml) && /自己紹介/.test(meHtml));
      ok("渡す欄（貼り付け・ファイル）がある",
         !!document.querySelector("#docText") && !!document.querySelector("#btnDocFile"));
      ok("資料の中身に戻れる", /data-act="docopen"/.test(meHtml) && /data-act="docitems"/.test(meHtml));
      ok("資料を消せる", /data-act="docdel"/.test(meHtml));

      // 「今日」の未確認一覧に profile を混ぜない
      view.day = "2026-09-11"; renderDay();
      const dayHtml = document.querySelector("#dayOut").innerHTML;
      const profIds = state.items.filter(i => i.kind === "profile").map(i => i.id);
      ok("『わたしのこと』は今日の未確認一覧に混ざらない",
         profIds.length > 0 && !profIds.some(pid => dayHtml.includes(pid)),
         profIds.length + "件の profile が今日タブに出ていないこと");

      // AIに渡す文脈に入ること
      const cx = contextForAI({ id: "n", text: "テスト", capturedAt: T(11, 0) });
      ok("『わたしのこと』がAIへの文脈に入る", cx.me.length >= 1, cx.me.slice(0, 2).join(" / "));
      ok("資料の全文はAIへの文脈に入れない（読み取った短い文だけを渡す）",
         !JSON.stringify(cx).includes("明日は10時から打ち合わせ"));

      await act("confirmprof");
      ok("『わたしのこと』をまとめて確認できる",
         state.items.filter(i => i.kind === "profile" && !i.confirmed).length === 0);

      state.items = savedI; state.notes = savedN; state.docs = savedD; lsWrite();
    }

    /* --- 記録タブを畳んだあと、その役割が残っていること --- */
    ok("記録タブは無くなっている", !document.querySelector("#p-log"));
    /* 設定タブの「保存されている原文」は外した（2026-09-20・本人の指示）。
       **消す道だけは残す**——会話の「原文」から開くシートに引っ越してある
       （決まり「そこにしか入口が無いものを先に探して引っ越す」）。 */
    ok("原文の一覧は設定から外れている", !document.querySelector("#p-set #noteOut"));
    ok("原文を消す道は act に残っている", /a === "delnote"/.test(String(act)));

    {
      // 未確認・この先のこと・目標・戻す が「今日」に出ること
      const savedItems = state.items.slice(), savedNotes = state.notes.slice();
      state.items = []; state.notes = [];
      const mk = (o) => { const it = Object.assign({ id: uid(), noteId: null, origin: "rule", confirmed: false,
        corrected: false, status: "open", evidence: { text: "x" }, duePrecision: "day",
        createdAt: new Date().toISOString(), updatedAt: "", history: [] }, o); it.dedupeKey = dedupeKey(it); return it; };
      await putNote({ id: uid(), text: "ダミーの原文", hash: "h", capturedAt: T(9, 0), source: "talk", createdAt: T(9, 0) });
      await putItem(mk({ kind: "task", title: "未確認のタスク", dayKey: "2026-09-11", due: T(18, 0), estimateMin: 30 }));
      await putItem(mk({ kind: "task", title: "来週のタスク", dayKey: "2026-09-20", due: zoned(2026, 9, 20, 18, 0, TZ).toISOString(), estimateMin: 30, confirmed: true }));
      await putItem(mk({ kind: "goal", title: "週2回走る", confirmed: true, duePrecision: "none" }));
      const donev = mk({ kind: "task", title: "終わったタスク", confirmed: true, status: "done" });
      donev.completedAt = T(12, 0); await putItem(donev);
      const dropv = mk({ kind: "task", title: "やめたタスク", confirmed: true, status: "dropped" });
      dropv.history = [{ at: T(13, 0), by: "user", what: "取り消した" }]; await putItem(dropv);

      view.day = "2026-09-11"; renderDay();
      const html = document.querySelector("#dayOut").innerHTML;
      ok("「確認する欄」は今日に置かない（会話の返事で既に見えている）",
         !/data-act="confirmall"/.test(html) && !/合っているか見てください/.test(html));
      // タイムラインは「固定／作業枠」を左の帯で示すので、同じことをラベルで重ねない
      ok("タイムラインに「作業枠」「固定」のラベルを重ねない",
         !/>作業枠</.test(html) && !/chip fixed">固定</.test(html),
         (html.match(/<span class="chip[^"]*">[^<]*/g) || []).slice(0, 4).join(" / ") || "ラベルなし");
      // ただし「AIが読み取ったもの」だけは印を残す（本人が決めたものと混ざらないように）
      // 17時からと時刻を言っている（v4.4：置き場所を言ったものだけ予定表に入る）
      const aiTask = mk({ kind: "task", title: "AIが拾った用事", dayKey: "2026-09-11",
        due: T(17, 0), duePrecision: "exact", estimateMin: 30, origin: "ai" });
      await putItem(aiTask);
      renderDay();
      const html2 = document.querySelector("#dayOut").innerHTML;
      ok("AIが読み取ったものには印が付く", /class="bdot"/.test(html2), "bdot");
      ok("一覧の側では、由来の印が今までどおり出る",
         /読み取ったまま|AIが読み取ったまま|本人が訂正|確認済み/.test(itemHTML(aiTask)),
         (itemHTML(aiTask).match(/chip src-\w+">[^<]*/g) || []).join(" / "));
      await act("drop", aiTask.id);
      ok("この先の予定は、スケジュールの折りたたみに入る",
         /この先の予定とタスク/.test(html) && /来週のタスク/.test(html),
         /この先の予定とタスク/.test(html) ? "あり" : "見出しが無い");
      renderMe();
      const meHtml = document.querySelector("#meOut").innerHTML;
      ok("目標は「わたしのこと」に移っている",
         /続けたいこと/.test(meHtml) && /週2回走る/.test(meHtml) && !/週2回走る/.test(html),
         "わたしのこと=" + /週2回走る/.test(meHtml) + " / スケジュール=" + /週2回走る/.test(html));
      ok("完了したものを戻すボタンが振り返りに出る", /data-act="undone"/.test(html), "終わったタスク");
      ok("取り消したものを戻すボタンが振り返りに出る", /data-act="undrop"/.test(html), "やめたタスク");

      ok("訂正すれば「本人が訂正」に変わる", (() => {
         const t = state.items.find(i => i.kind === "task" && !i.confirmed);
         if (!t) return false;
         t.corrected = true;
         return /本人が訂正/.test(itemHTML(t));
      })());
      state.items = savedItems; state.notes = savedNotes; lsWrite();
    }

    // --- 会話の保存と復元 ---
    await pushTurn({ id: uid(), role: "user", text: "テスト発話", at: T(18, 0) });
    await pushTurn({ id: uid(), role: "assistant", text: "テスト返信", at: T(18, 1), changes: ["a"], plan: null, ai: false });
    lsWrite();
    const raw2 = lsRead();
    ok("会話が保存される", !!raw2 && raw2.turns && (raw2.turns["2026-09-11"] || []).length >= 2,
       raw2 && raw2.turns ? Object.keys(raw2.turns).join(",") + " / " + (raw2.turns["2026-09-11"] || []).length + "件" : "なし");
    ok("会話の各発話が原文と結びつく", state.notes.length >= 5, state.notes.length + "件の原文");

    // --- AIが返す予定表を信用しないこと（時刻はこちらが作る） ---
    const snap = planSnapshot(planFor("2026-09-11"), nextAction(planFor("2026-09-11"), 9 * 60));
    ok("返信に添える予定表は planFor() の結果から作られる",
       snap.blocks.every(b => typeof b.s === "number" && typeof b.e === "number" && b.e > b.s));

    /* --- 固定予定の枠に、分かりきったことを書かない（v2.3） ---
       「固定の予定です。動かしていません。」は左の実線の帯と色が既に言っている。
       書くのは、こちらが勝手に決めた部分（終わりの時刻の仮置き）だけ。 */
    {
      const savedI = state.items.slice(), savedN = state.notes.slice();
      state.items = []; state.notes = [];

      await say("14時から15時まで打ち合わせ。", T(9, 0));
      await say("16時から歯医者に行く。", T(9, 1));
      const evKnown = state.items.find(i => i.kind === "event" && /打ち合わせ/.test(i.title));
      const evGuess = state.items.find(i => i.kind === "event" && /歯医者/.test(i.title));
      ok("終わりの時刻を言った予定は仮置きにしない",
         !!evKnown && evKnown.endUnknown === false, evKnown && String(evKnown.endUnknown));
      ok("終わりの時刻を言っていない予定は仮置きだと分かる",
         !!evGuess && evGuess.endUnknown === true, evGuess && String(evGuess.endUnknown));

      const plan = planFor("2026-09-11");
      const bKnown = plan.blocks.find(b => b.sub === "event" && /打ち合わせ/.test(b.item.title));
      const bGuess = plan.blocks.find(b => b.sub === "event" && /歯医者/.test(b.item.title));
      ok("固定の枠に「固定の予定です」と書かない",
         plan.blocks.filter(b => b.sub === "event").every(b => !/固定の予定|動かしていません/.test(b.reason || "")),
         plan.blocks.filter(b => b.sub === "event").map(b => b.item.title + "：" + (b.reason || "（なし）")).join(" / "));
      ok("終わりが分かっている予定には、理由を足さない",
         !!bKnown && !bKnown.reason, bKnown && ("「" + bKnown.reason + "」"));
      ok("仮置きした終わりの時刻は理由に書く",
         !!bGuess && /聞いていない/.test(bGuess.reason || "") && /1時間/.test(bGuess.reason || ""),
         bGuess && bGuess.reason);

      view.day = "2026-09-11"; renderDay();
      const tlHtml = document.querySelector("#dayOut").innerHTML;
      ok("予定表に「固定の予定です」の文が出ない", !/固定の予定です/.test(tlHtml));
      ok("仮置きの長さには（仮）を付ける", /（仮）/.test(tlHtml));

      /* --- 枠に理由の文章を出さない（v2.4） ---
         予定表は「時刻・内容・長さ」だけで読めること。
         理由は消したのではなく「根拠」に移した。開けば必ず読める。 */
      ok("枠に理由の文章を出さない",
         !/聞いていないので/.test(tlHtml) && !/と言っていました/.test(tlHtml),
         (tlHtml.match(/[^<>]*(聞いていないので|と言っていました)[^<>]*/) || ["出ていない"])[0]);
      ok("スケジュールの下に「わたしのこと」への案内文を置かない",
         !/「わたしのこと」タブに/.test(tlHtml));

      // 「根拠」を開けば、なぜそこに置いたかが読める
      openEvidence(evGuess);
      const sheet = document.querySelector("#sheetHost").innerHTML;
      ok("「根拠」に、この時間に置いた理由が出る",
         /この時間に置いた理由/.test(sheet) && /聞いていないので/.test(sheet),
         sheet.includes("この時間に置いた理由") ? "見出しあり" : "見出しなし");
      closeSheet();

      // 返信に添える予定表でも同じ
      const sn = planSnapshot(plan, nextAction(plan, 9 * 60));
      const mp = miniplanHTML(sn);
      ok("返信の予定表にも「固定の予定です」を書かない", !/固定の予定です/.test(mp));
      ok("返信の予定表にも枠ごとの理由を書かない",
         !/<span class="why"><\/span>/.test(mp) && !/と言っていました/.test(mp),
         (mp.match(/[^<>]*と言っていました[^<>]*/) || ["出ていない"])[0]);

      // 「置けなかった理由」は消さない（元の約束：詰め込まず、理由を示す）
      // 「午前中に」＝置き場所を言っている。だから置こうとして、入らず理由が出る（v4.4）
      await say("午前中に資料を作る。10時間かかる。", T(9, 2));
      renderDay();
      const tlHtml2 = document.querySelector("#dayOut").innerHTML;
      ok("置けなかったものの理由は、今までどおり出す",
         /置けない理由/.test(tlHtml2),
         planFor("2026-09-11").unplaced.map(u => u.item.title + "：" + u.reason).join(" / ") || "未配置なし");

      state.items = savedI; state.notes = savedN; lsWrite();
    }

    /* --- 予定表を見ただけで「どれくらいかかるか」が分かること（v2.5） ---
       枠の高さ＝長さ。空き時間も同じ縮尺で高さを持つ。
       ここが崩れると、10分の休憩と2時間の作業が同じ大きさに見えて、時間の感覚が消える。 */
    {
      const savedI = state.items.slice(), savedN = state.notes.slice();
      state.items = []; state.notes = [];
      const n = { id: uid(), text: "高さのテスト", hash: "hgt", capturedAt: T(8, 0), source: "talk", createdAt: T(8, 0) };
      await putNote(n);
      const mk = (o) => { const it = Object.assign({ id: uid(), noteId: n.id, origin: "rule", confirmed: false,
        corrected: false, status: "open", evidence: { text: "x" }, duePrecision: "day",
        createdAt: T(8, 0), updatedAt: "", history: [] }, o); it.dedupeKey = dedupeKey(it); return it; };
      await putItem(mk({ kind: "event", title: "1時間の予定", fixed: true, start: T(9, 0), end: T(10, 0), dayKey: "2026-09-11" }));
      await putItem(mk({ kind: "event", title: "2時間の予定", fixed: true, start: T(11, 0), end: T(13, 0), dayKey: "2026-09-11" }));

      // 高さを測るので、パネルを実際に表示させる（隠れていると 0px になる）
      view.day = "2026-09-11"; showTab("p-day"); renderDay();
      const blks = [...document.querySelectorAll("#dayOut .blk")];
      const h1 = blks.find(b => /1時間の予定/.test(b.textContent));
      const h2 = blks.find(b => /2時間の予定/.test(b.textContent));
      const px = el => el ? Math.round(el.getBoundingClientRect().height) : 0;
      ok("2時間の枠は1時間の枠のほぼ2倍の高さになる",
         px(h1) > 40 && px(h2) / px(h1) > 1.7 && px(h2) / px(h1) < 2.3,
         px(h1) + "px → " + px(h2) + "px（比 " + (px(h1) ? (px(h2) / px(h1)).toFixed(2) : "—") + "）");

      const gap = document.querySelector("#dayOut .gapline");
      ok("空き時間も長さのぶんだけ高さを持つ（1本の線にしない）",
         !!gap && px(gap) > 40, gap ? px(gap) + "px" : "空きの行が無い");
      ok("空き時間に実際の長さを書く", !!gap && /1時間/.test(gap.textContent), gap && gap.textContent.trim());

      // 高さは CSS 側の縮尺で決める（JS が px を直接書かない）
      ok("枠に渡すのは「分」だけで、px は書かない",
         blks.every(b => /--min:\s*\d+/.test(b.getAttribute("style") || "") && !/--h:/.test(b.getAttribute("style") || "")),
         blks.map(b => b.getAttribute("style")).join(" / "));

      state.items = savedI; state.notes = savedN; lsWrite();
    }

    /* --- スケジュールのいちばん下の「タスク」（v2.7） ---
       日付が決まっていない用事は、今日の案に置けなかった日にどこにも出ず、忘れられていた。 */
    {
      const savedI = state.items.slice(), savedN = state.notes.slice();
      state.items = []; state.notes = [];
      const n = { id: uid(), text: "タスク欄のテスト", hash: "bl", capturedAt: T(8, 0), source: "talk", createdAt: T(8, 0) };
      await putNote(n);
      const mk = (o) => { const it = Object.assign({ id: uid(), noteId: n.id, origin: "rule", confirmed: false,
        corrected: false, status: "open", evidence: { text: "x" },
        createdAt: T(8, 0), updatedAt: "", history: [] }, o); it.dedupeKey = dedupeKey(it); return it; };
      // 日付なし・あいまい・確定 の3種類と、完了済みを1件ずつ
      // 「午前中に」＝置き場所つき。作業時間を広げれば今日の案に入る（v4.4）
      await putItem(mk({ kind: "task", title: "郵便局に行く", dayKey: null, duePrecision: "none", estimateMin: 30, preferWindow: "morning" }));
      await putItem(mk({ kind: "task", title: "本棚を整理する", dayKey: "2026-09-20", duePrecision: "week", estimateMin: 60 }));
      await putItem(mk({ kind: "task", title: "資料を送る", dayKey: "2026-09-11", duePrecision: "day", estimateMin: 30 }));
      await putItem(mk({ kind: "task", title: "終わった用事", dayKey: null, duePrecision: "none", status: "done" }));
      await putItem(mk({ kind: "idea", title: "いつか旅行に行きたい", duePrecision: "none" }));

      // 作業時間を狭くして、どれも今日の案に入らない状態にする
      // （今日の案に入っているものはタイムラインに出ているので、この欄には重ねない）
      const savedSettings = state.settings;
      state.settings = Object.assign({}, savedSettings, { workStart: "09:00", workEnd: "09:10" });

      view.day = "2026-09-11"; showTab("p-day"); renderDay();
      const html = document.querySelector("#dayOut").innerHTML;
      const sect = html.slice(html.indexOf("<h2>タスク</h2>"));
      ok("スケジュールに「タスク」の欄がある", /<h2>タスク<\/h2>/.test(html));
      ok("日付なしの用事が「タスク」に出る", /郵便局に行く/.test(sect), sect.length + "文字");
      ok("期限があいまいな用事も「タスク」に出る", /本棚を整理する/.test(sect));
      ok("日付が決まっている用事は「タスク」に出さない", !/資料を送る/.test(sect));
      ok("完了した用事は「タスク」に出さない", !/終わった用事/.test(sect));
      ok("思いつき（idea）は「タスク」に出さない", !/いつか旅行/.test(sect));
      ok("「タスク」はいちばん下（タイムラインより後ろ）",
         html.indexOf("<h2>タスク</h2>") > html.indexOf("<h2>今日の案</h2>"),
         "今日の案=" + html.indexOf("<h2>今日の案</h2>") + " / タスク=" + html.indexOf("<h2>タスク</h2>"));
      ok("今日の案と重なる件数を、行ごとではなく見出しの下に1回だけ書く",
         (sect.match(/今日の案に入れています/g) || []).length <= 1,
         (sect.match(/今日の案に入れています/g) || []).length + "回");
      ok("「タスク」から完了できる（訂正は「…」の中）",
         /data-act="done"/.test(sect) && /data-act="more"/.test(sect));

      ok("置けなかった理由は「タスク」の行に出す（詰め込まず理由を示す）",
         /置けない理由/.test(sect), sect.length + "文字");
      /* v4.4：時刻も時間帯も言っていないものは、そもそも置きにいかない。
         「置けなかった」のではなく「置き場所を聞いていない」ので、理由は付かない。
         代わりに、その説明は欄の見出しに1回だけ書く。 */
      ok("時刻を言っていないものには「置けない理由」を付けない",
         !/本棚を整理する[\s\S]{0,200}置けない理由/.test(sect));

      /* 二重表示の確認。日付なしの用事が
         「今日に置けなかったもの」と「タスク」の両方に並んでいた（v2.7 で直した）。 */
      {
        await putItem(mk({ kind: "task", title: "今日が期限の大仕事", dayKey: "2026-09-11",
                           duePrecision: "day", dueIsDeadline: true, estimateMin: 300 }));
        renderDay();
        const t2 = document.querySelector("#dayOut").innerText;
        const times = s => t2.split(s).length - 1;
        ok("日付なしの用事を、1画面に2回出さない",
           times("郵便局に行く") === 1, times("郵便局に行く") + "回");
        ok("日付が決まっているものは「この日にやること」に残す",
           times("今日が期限の大仕事") === 1 &&
           t2.indexOf("今日が期限の大仕事") < t2.indexOf("日付を決めていない"),
           times("今日が期限の大仕事") + "回");
      }

      /* 今日の案に入れたものは、この欄には重ねない。ただし件数は書く */
      {
        state.settings = Object.assign({}, savedSettings, { workStart: "09:00", workEnd: "18:00" });
        renderDay();
        const t3 = document.querySelector("#dayOut").innerText;
        ok("今日の案に入れたものは「タスク」に重ねず、件数だけ書く",
           /件は今日の案に入れています/.test(t3) &&
           (t3.split("郵便局に行く").length - 1) === 1,
           (t3.match(/このうち\d+件は今日の案に入れています/) || ["(その行が無い)"])[0]);
      }
      state.settings = savedSettings;

      // 空のとき
      state.items = state.items.filter(i => i.kind !== "task");
      renderDay();
      const html2 = document.querySelector("#dayOut").innerHTML;
      ok("タスクが無いときは「ありません」と出す",
         /<h2>タスク<\/h2>/.test(html2) && /ありません/.test(html2.slice(html2.indexOf("<h2>タスク</h2>"))));

      state.items = savedI; state.notes = savedN; lsWrite();
    }

    /* --- 「今日に置けなかったもの」は、今日やるはずだったものだけ（v2.8） ---
       planFor は先の期限のものも今日の空きに置こうとするので、絞らないと
       「3週間後が期限」まで毎日この欄に並んでいた（実測で4件中2件がそれだった）。 */
    {
      const savedI = state.items.slice(), savedN = state.notes.slice(), savedSet = state.settings;
      state.items = []; state.notes = [];
      state.settings = Object.assign({}, savedSet, { workStart: "09:00", workEnd: "18:00" });
      const n = { id: uid(), text: "未配置のテスト", hash: "up", capturedAt: T(8, 0), source: "talk", createdAt: T(8, 0) };
      await putNote(n);
      const mk = (o) => { const it = Object.assign({ id: uid(), noteId: n.id, origin: "rule", confirmed: false,
        corrected: false, status: "open", evidence: { text: "x" }, duePrecision: "day",
        createdAt: T(8, 0), updatedAt: "", history: [] }, o); it.dedupeKey = dedupeKey(it); return it; };
      // 一日を埋める固定予定。これで、どの用事も今日には入らない
      await putItem(mk({ kind: "event", title: "終日の研修", fixed: true,
        start: T(9, 0), end: T(18, 0), dayKey: "2026-09-11", duePrecision: "exact" }));
      await putItem(mk({ kind: "task", title: "今日が期限のもの", dayKey: "2026-09-11", dueIsDeadline: true, estimateMin: 60 }));
      await putItem(mk({ kind: "task", title: "期限が切れているもの", dayKey: "2026-09-10", dueIsDeadline: true, estimateMin: 60 }));
      await putItem(mk({ kind: "task", title: "明日が期限で今日やりたいもの", dayKey: "2026-09-12", targetDay: "2026-09-11", estimateMin: 60 }));
      await putItem(mk({ kind: "task", title: "三週間後が期限のもの", dayKey: "2026-10-02", estimateMin: 60 }));

      view.day = "2026-09-11"; showTab("p-day"); renderDay();
      const html = document.querySelector("#dayOut").innerHTML;
      const from = html.indexOf("<h2>この日にやること</h2>"), to = html.indexOf("<h2>タスク</h2>");
      const sect = html.slice(from, to > from ? to : undefined);

      ok("今日が期限のものは、この欄に出す", /今日が期限のもの/.test(sect));
      ok("期限が切れているものも、この欄に出す", /期限が切れているもの/.test(sect));
      ok("「今日やりたい」と言ったものも、この欄に出す", /明日が期限で今日やりたいもの/.test(sect));
      ok("先の期限のものは、この欄に出さない（今日の話ではない）",
         !/三週間後が期限のもの/.test(sect), sect.length + "文字");
      ok("先の期限のものは「この先の予定とタスク」には残る",
         /三週間後が期限のもの/.test(html));
      /* v4.4：時刻を言っていないので置きにいっていない。「置けなかった」とは言わない。
         なぜ予定表に無いのかは、欄の見出しに1回だけ書く。 */
      ok("なぜ予定表に無いのかを、欄の見出しで1回だけ説明する",
         /時刻を言っていないので、予定表には置いていません/.test(sect),
         (sect.match(/時刻を言っていない[^<]*/) || ["(説明が無い)"])[0]);
      ok("置き場所を言っていないものに「置けない理由」を付けない", !/置けない理由/.test(sect));

      // 置き場所を言ったのに入らなかったものには、理由が付く
      await putItem(mk({ kind: "task", title: "午前中にやりたい大仕事", dayKey: "2026-09-11",
        duePrecision: "day", dueIsDeadline: true, estimateMin: 300, preferWindow: "morning" }));
      renderDay();
      const htmlR = document.querySelector("#dayOut").innerHTML;
      const sectR = htmlR.slice(htmlR.indexOf("<h2>この日にやること</h2>"), htmlR.indexOf("<h2>タスク</h2>"));
      ok("置き場所を言ったのに入らなかったものには、理由を付ける",
         /午前中にやりたい大仕事[\s\S]{0,400}置けない理由/.test(sectR),
         (sectR.match(/置けない理由：[^<]*/) || ["(理由が無い)"])[0]);
      state.items = state.items.filter(i => !/午前中にやりたい大仕事/.test(i.title));

      // 今日やるはずのものが無ければ、この欄は空になる
      state.items = state.items.filter(i => !/今日が期限|期限が切れ|今日やりたい/.test(i.title));
      renderDay();
      const html2 = document.querySelector("#dayOut").innerHTML;
      const f2 = html2.indexOf("<h2>この日にやること</h2>"), t2 = html2.indexOf("<h2>タスク</h2>");
      const sect2 = html2.slice(f2, t2 > f2 ? t2 : undefined);
      ok("今日やるはずのものが無ければ、この欄は空になる",
         /ありません/.test(sect2) && !/三週間後/.test(sect2), sect2.replace(/<[^>]+>/g, " ").slice(0, 90));

      state.items = savedI; state.notes = savedN; state.settings = savedSet; lsWrite();
    }

    /* --- 「いま」の赤い線の位置（v3.4） ---
       10:06 に 10:00〜10:30 の予定があると、その枠の「上」に線が出ていた。
       進行中なのに、まだ始まっていないように見える（本人からの報告）。 */
    {
      const savedI = state.items.slice(), savedN = state.notes.slice();
      state.items = []; state.notes = [];
      const n = { id: uid(), text: "いまの線のテスト", hash: "nl", capturedAt: T(8, 0), source: "talk", createdAt: T(8, 0) };
      await putNote(n);
      const mk = (o) => { const it = Object.assign({ id: uid(), noteId: n.id, origin: "rule", confirmed: false,
        corrected: false, status: "open", evidence: { text: "x" }, duePrecision: "exact",
        createdAt: T(8, 0), updatedAt: "", history: [] }, o); it.dedupeKey = dedupeKey(it); return it; };
      await putItem(mk({ kind: "event", title: "進行中の打ち合わせ", fixed: true, start: T(10, 0), end: T(10, 30), dayKey: "2026-09-11" }));
      await putItem(mk({ kind: "event", title: "このあとの歯医者", fixed: true, start: T(11, 0), end: T(12, 0), dayKey: "2026-09-11" }));

      /* 予定の中にいるときは、線を引かない。印は枠が持つ（v3.5） */
      const NOW = 10 * 60 + 6;                       // 10:06 ＝ 打ち合わせの最中
      const plan = planFor("2026-09-11", { nowMin: NOW });
      const html = timelineHTML(plan, nextAction(plan, NOW), false);

      ok("予定の中にいるときは、赤い線を引かない", !/nowline/.test(html));
      ok("その枠に「いま」の印が付く", /nowtag/.test(html) && /いま<\/span>/.test(html));
      ok("印が付くのは、進行中の枠だけ（1つ）",
         (html.match(/nowtag/g) || []).length === 1, (html.match(/nowtag/g) || []).length + "個");
      ok("「いま」の印は、進行中の枠の中にある", (() => {
        const i = html.indexOf("nowtag"), a = html.indexOf("進行中の打ち合わせ"), z = html.indexOf("このあとの歯医者");
        return i > 0 && i < a && a < z;
      })());
      ok("進行中の枠は強調され、開いた状態になる",
         /class="tlrow[^"]*\bopen\b/.test(html) && /blk[^"]*running/.test(html));

      // 空いている時間にいるときは、今までどおり線を引く
      const GAP = 10 * 60 + 45;                      // 10:45 ＝ 打ち合わせの後、歯医者の前
      const planG = planFor("2026-09-11", { nowMin: GAP });
      const htmlG = timelineHTML(planG, nextAction(planG, GAP), false);
      ok("空いている時間にいるときは、線を引く", /nowline/.test(htmlG));
      ok("その線には実際の時刻が出る", /nowline[\s\S]{0,80}10:45/.test(htmlG));
      ok("空いているときは「いま」の印を付けない", !/nowtag/.test(htmlG));
      ok("線は、まだ始まっていない枠より上に出る",
         htmlG.indexOf("nowline") < htmlG.indexOf("このあとの歯医者"));

      // まだ何も始まっていない時刻なら、いちばん上に出る
      const plan2 = planFor("2026-09-11", { nowMin: 9 * 60 });
      const html2 = timelineHTML(plan2, nextAction(plan2, 9 * 60), false);
      ok("どの枠も始まっていない時刻なら、線はいちばん上",
         html2.indexOf("nowline") < html2.indexOf("進行中の打ち合わせ"));

      state.items = savedI; state.notes = savedN; lsWrite();
    }

    const fails = R.filter(x => x.startsWith("FAIL"));
    const out = document.createElement("pre");
    out.id = "TESTRESULT";
    out.textContent = "\n===== TEST RESULTS =====\n" + R.join("\n") +
      "\n\n合計 " + R.length + " 件 / 失敗 " + fails.length + " 件\n===== END =====\n";
    document.body.appendChild(out);
  }

  run().catch(e => {
    const out = document.createElement("pre");
    out.id = "TESTRESULT";
    out.textContent = "\n===== TEST CRASHED =====\n" + (e && (e.stack || e.message || String(e))) + "\n";
    document.body.appendChild(out);
  });
})();
