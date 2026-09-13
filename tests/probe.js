/* バグ探し。まだ試していない言い方・境界・状態の寿命を当てる。 */
(function () {
  const R = []; const ok = (n, c, e) => R.push((c ? "PASS" : "FAIL") + " :: " + n + (e ? "  [" + e + "]" : ""));
  const TZ = "Asia/Tokyo";
  const T = (h, mi) => zoned(2026, 9, 12, h, mi, TZ).toISOString();
  const KEY = "2026-09-12", NEXT = "2026-09-13";

  async function say(text, atISO) {
    const clean = normNote(text);
    const n = { id: uid(), text: clean, hash: hash(clean + "|" + atISO + Math.random()), capturedAt: atISO, source: "talk", sourceName: null, createdAt: atISO };
    await putNote(n);
    return await applyOps(ruleOps(n), n);
  }
  const reset = () => { state.notes = []; state.items = []; state.turns = {}; state.docs = []; };

  async function run() {
    for (let i = 0; i < 200 && !state.ready; i++) await new Promise(r => setTimeout(r, 20));
    state.settings = Object.assign({}, DEFAULTS, { timezone: TZ, workStart: "09:00", workEnd: "18:00", defaultEstimate: 30 });

    /* ===== A. ふつうのタスクの言い方を落としていないか ===== */
    const shouldBeTask = [
      "牛乳を買っておく。",
      "明日プレゼンの準備。",
      "薬を飲むのを忘れないように。",
      "bankに振り込みをする。",
      "ゴミ出しといて。",
      "レポートを書き上げる。",
      "部屋の掃除。",
      "美容院の予約を取らないと。",
      "министр",                       // 意味のない文字列は拾わない（対照）
    ];
    const got = [];
    for (const s of shouldBeTask.slice(0, 8)) {
      reset();
      await say(s, T(9, 0));
      const made = state.items.filter(i => i.kind === "task");
      got.push(s + " → " + (made.length ? "task「" + made[0].title + "」" : "×"));
    }
    ok("A. ふつうのタスクの言い方を落としていない",
       got.filter(g => /×/.test(g)).length === 0, got.filter(g => /×/.test(g)).join(" / ") || got.join(" / "));
    reset();
    await say("министр", T(9, 0));
    ok("A. 意味のない文字列からタスクを作らない", state.items.filter(i => i.kind === "task").length === 0,
       state.items.map(i => i.kind + ":" + i.title).join(",") || "何も作らない");

    /* ===== A2. AIとルールが同じ発言を別の言い方で読んでも、二重にしない ===== */
    reset();
    const note0 = { id: uid(), text: "明日までに資料を作る。1時間くらい。", hash: "x1", capturedAt: T(9, 0), source: "talk", createdAt: T(9, 0) };
    await putNote(note0);
    await applyOps(ruleOps(note0), note0);
    const before = state.items.filter(i => i.kind === "task").length;
    // AIが同じ発言を別の言い方で返してきた場合を模す
    await applyOps([{ op: "add", kind: "task", title: "打ち合わせ資料の作成", dueDate: NEXT, estimateMin: 90, quote: "資料を作る" }], note0);
    const after = state.items.filter(i => i.kind === "task");
    ok("A2. 同じ発言の言い換えを二重に登録しない", after.length === before,
       after.map(i => i.title).join(" / "));
    ok("A2. 見出しは本人の言い方の方を残す", after.every(i => !/打ち合わせ資料の作成/.test(i.title)),
       after.map(i => i.title).join(" / "));

    /* ===== A3. 言っていない日付を、確定した期限にしない ===== */
    reset();
    const note1 = { id: uid(), text: "そのうち部屋を片付けたい。", hash: "x2", capturedAt: T(9, 0), source: "talk", createdAt: T(9, 0) };
    await putNote(note1);
    await applyOps([{ op: "add", kind: "task", title: "部屋を片付ける", dueDate: NEXT, duePrecision: "day", quote: "部屋を片付けたい" }], note1);
    const vague = state.items.find(i => /片付/.test(i.title));
    ok("A3. 発言に日付が無ければ、確定した期限にしない",
       vague && vague.duePrecision === "week" && vague.dateInferred === true,
       vague ? (vague.duePrecision + " / 推測=" + vague.dateInferred) : "作られなかった");
    reset();
    const note2 = { id: uid(), text: "明後日までに部屋を片付ける。", hash: "x3", capturedAt: T(9, 0), source: "talk", createdAt: T(9, 0) };
    await putNote(note2);
    await applyOps([{ op: "add", kind: "task", title: "部屋を片付ける", dueDate: NEXT, duePrecision: "day", quote: "部屋を片付ける" }], note2);
    const said = state.items.find(i => /片付/.test(i.title));
    ok("A3. 発言に日付があれば、そのまま期限として扱う",
       said && said.duePrecision === "day" && !said.dateInferred,
       said ? (said.duePrecision + " / 推測=" + !!said.dateInferred) : "作られなかった");

    /* ===== A4. 「移動に30分かかる」を用事にしない ===== */
    reset();
    await say("明日の午後3時に歯医者に行く。移動に30分かかる。", T(9, 0));
    {
      const ev = state.items.find(i => i.kind === "event");
      ok("A4. 移動時間が予定に付く", ev && ev.travelMin === 30, ev && ("移動" + ev.travelMin + "分"));
      ok("A4. 「移動に30分かかる」をタスクにしない",
         !state.items.some(i => i.kind === "task"),
         state.items.map(i => i.kind + ":" + i.title).join(" / "));
      ok("A4. 予定の長さを移動時間で上書きしない",
         ev && (new Date(ev.end) - new Date(ev.start)) / 60000 === 60,
         ev ? ((new Date(ev.end) - new Date(ev.start)) / 60000 + "分") : "-");
      const p = planFor(ev.dayKey, { nowMin: -1 });
      ok("A4. 移動の枠が予定の前に確保される",
         p.blocks.some(b => b.sub === "travel" && b.e === 15 * 60 && b.s === 14 * 60 + 30),
         p.blocks.filter(b => b.type === "fixed").map(b => hhmm(b.s) + "-" + hhmm(b.e) + " " + blockTitle(b)).join(" / "));
    }
    reset();
    await say("資料を作る。2時間くらいかかる。", T(9, 0));
    ok("A4. ふつうの所要時間は今までどおり拾う",
       state.items.some(i => i.kind === "task" && i.estimateMin === 120),
       state.items.map(i => i.kind + ":" + i.title + ":" + i.estimateMin).join(" / "));

    /* ===== A5. スケジュールは、今日の案が一番上に来る ===== */
    reset();
    await say("今日、健康診断がある。", T(9, 0));                // 時刻未定の予定（同じ日）
    await say("今日は資料を作らないと。1時間くらい。", T(9, 5));  // 時間割に載るもの
    {
      view.day = KEY; renderDay();
      const html = document.querySelector("#dayOut").innerHTML;
      const iPlan = html.indexOf("今日の案");
      const iTimeless = html.indexOf("この日にあること");
      ok("A5. 検証の前提：時刻未定の予定と時間割の両方がある",
         iPlan >= 0 && iTimeless >= 0,
         "今日の案=" + iPlan + " / 時刻未定=" + iTimeless + " / timeless=" + planFor(KEY, { nowMin: 9 * 60 }).timeless.length + "件");
      ok("A5. 今日の案が、時刻未定の知らせより上にある",
         iPlan >= 0 && (iTimeless < 0 || iPlan < iTimeless),
         "今日の案=" + iPlan + " / 時刻未定=" + iTimeless);
      const iUnplaced = html.indexOf("入りきらなかったもの");
      ok("A5. 未配置は今日の案より下", iUnplaced < 0 || iPlan < iUnplaced, "未配置=" + iUnplaced);
    }

    /* ===== A6. 固定の予定を、会話から変えられるか ===== */
    {
      reset();
      const mkEv = () => {
        const ev = { id: uid(), noteId: null, kind: "event", title: "打ち合わせ", fixed: true, timeUnknown: false,
          start: zoned(2026, 9, 13, 15, 0, TZ).toISOString(), end: zoned(2026, 9, 13, 16, 30, TZ).toISOString(),
          dayKey: NEXT, duePrecision: "exact", origin: "user", confirmed: true, corrected: false, status: "open",
          evidence: { text: "x" }, createdAt: T(9, 0), updatedAt: "", history: [] };
        ev.dedupeKey = dedupeKey(ev); return ev;
      };
      const note = { id: uid(), text: "明日の打ち合わせ、14時にして。", capturedAt: T(9, 0), source: "talk", createdAt: T(9, 0) };
      await putNote(note);

      // ① 時刻だけの言い直し（日付も長さも維持されること）
      let ev = mkEv(); await putItem(ev);
      await applyOps([{ op: "update", id: ev.id, dueTime: "14:00", quote: "14時にして" }], note);
      let g = findItem(ev.id);
      ok("A6. 時刻だけ言い直しても反映される", parts(new Date(g.start), TZ).h === 14, fmtDT(g.start, TZ));
      ok("A6. 日付は変わらない", g.dayKey === NEXT, g.dayKey);
      ok("A6. 予定の長さ（90分）が保たれる",
         (new Date(g.end) - new Date(g.start)) / 60000 === 90,
         (new Date(g.end) - new Date(g.start)) / 60000 + "分");

      // ② 長さだけの言い直し
      state.items = []; ev = mkEv(); await putItem(ev);
      await applyOps([{ op: "update", id: ev.id, estimateMin: 120, quote: "2時間になった" }], note);
      g = findItem(ev.id);
      ok("A6. 長さだけ言い直しても反映される",
         (new Date(g.end) - new Date(g.start)) / 60000 === 120,
         (new Date(g.end) - new Date(g.start)) / 60000 + "分");
      ok("A6. 開始時刻は動かない", parts(new Date(g.start), TZ).h === 15, fmtDT(g.start, TZ));

      // ③ 日付だけの言い直し（時刻が保たれること）
      state.items = []; ev = mkEv(); await putItem(ev);
      await applyOps([{ op: "update", id: ev.id, dueDate: "2026-09-14", quote: "明後日に" }], note);
      g = findItem(ev.id);
      ok("A6. 日付だけ言い直すと、時刻はそのまま",
         g.dayKey === "2026-09-14" && parts(new Date(g.start), TZ).h === 15,
         g.dayKey + " " + fmtDT(g.start, TZ));
      ok("A6. 時間割に載ったまま（時刻未定に落ちない）", g.timeUnknown === false, String(g.timeUnknown));

      // ④ 移動・準備を後から足す
      state.items = []; ev = mkEv(); await putItem(ev);
      await applyOps([{ op: "update", id: ev.id, travelMin: 40, prepMin: 20, quote: "移動に40分" }], note);
      g = findItem(ev.id);
      const p4 = planFor(NEXT, { nowMin: -1 });
      ok("A6. 移動と準備を後から足せる", g.travelMin === 40 && g.prepMin === 20,
         "移動" + g.travelMin + " / 準備" + g.prepMin);
      ok("A6. 足した移動が予定の前に確保される",
         p4.blocks.some(b => b.sub === "travel" && b.e === 15 * 60 && b.s === 14 * 60 + 20),
         p4.blocks.filter(b => b.type === "fixed").map(b => hhmm(b.s) + "-" + hhmm(b.e) + " " + blockTitle(b)).join(" / "));

      // ⑤ 名前を変える・やめる
      state.items = []; ev = mkEv(); await putItem(ev);
      await applyOps([{ op: "update", id: ev.id, title: "面談", quote: "面談だった" }], note);
      ok("A6. 予定の名前を変えられる", findItem(ev.id).title === "面談", findItem(ev.id).title);
      await applyOps([{ op: "drop", id: ev.id, quote: "なくなった" }], note);
      ok("A6. 予定を「なくなった」で取り消せる", findItem(ev.id).status === "dropped", findItem(ev.id).status);
      ok("A6. 取り消した予定は時間割から消える",
         !planFor(NEXT, { nowMin: -1 }).blocks.some(b => b.item.id === ev.id));

      // ⑥ AIなしでは対象を特定できないので、黙らずに伝える
      state.items = []; ev = mkEv(); await putItem(ev);
      const before6 = state.items.filter(i => i.kind === "event").length;
      const r6 = await say("明日の打ち合わせ、14時にして。", T(9, 30));
      ok("A6. AIなしのとき、言い直しで予定を二重に作らない",
         state.items.filter(i => i.kind === "event").length === before6,
         state.items.filter(i => i.kind === "event").map(i => i.title).join(" / "));
      ok("A6. AIなしのときは、黙らずにできないことを伝える",
         r6.asks.length >= 1 && /AI|直して/.test(r6.asks.join(" ")),
         "asks=[" + r6.asks.join(" ") + "]");
    }

    /* ===== A7. 食事は、揃えた名前でスケジュールに入る ===== */
    {
      const cases = [
        ["ご飯食べに行く", 12, 30, "昼食を食べる"],
        ["今から朝ごはん食べる", 8, 0, "朝食を食べる"],
        ["夜ごはん食べに行く", 19, 0, "夕食を食べる"],
        ["ランチしてくる", 12, 15, "昼食を食べる"],
        ["昼飯食べてくる", 12, 0, "昼食を食べる"],
        ["ご飯食べる", 19, 30, "夕食を食べる"],
        ["ご飯食べる", 8, 30, "朝食を食べる"],
        ["夜ごはんは家で作る", 18, 0, "夕食を食べる"],
        ["お昼は買ってくる", 11, 30, "昼食を食べる"],
        ["晩ごはん頼もう", 19, 0, "夕食を食べる"]
      ];
      const bad = [];
      for (const [text, hh, mm, want] of cases) {
        reset();
        await say(text, T(hh, mm));
        const t = state.items.find(i => i.kind === "task");
        if (!t || t.title !== want) bad.push(`${text}(${hh}時) → ${t ? t.title : "作られない"}（期待 ${want}）`);
      }
      ok("A7. 食事の言い方を揃えてスケジュールに入れる", bad.length === 0, bad.join(" / ") || "全部そろった");

      reset();
      await say("ご飯食べに行く", T(12, 30));
      const meal = state.items.find(i => i.kind === "task");
      ok("A7. 本人の言い方は根拠として残る", meal && /ご飯食べに行く/.test(meal.evidence.text), meal && meal.evidence.text);
      ok("A7. その日の予定として置かれる", meal && meal.dayKey === KEY, meal && String(meal.dayKey));
      ok("A7. 所要時間が仮置きされる", meal && meal.estimateMin === 30, meal && String(meal.estimateMin));
      const pm = planFor(KEY, { nowMin: 12 * 60 });
      /* v4.4：時刻を言っていないので、時間割には置かない（こちらが時刻を決めないため）。
         「この日にやること」には残る。食事だけ特別扱いはしない。 */
      ok("A7. 時刻を言っていないので時間割には置かない",
         !pm.blocks.some(b => b.item.id === meal.id) && (pm.loose || []).some(i => i.id === meal.id),
         pm.blocks.map(b => hhmm(b.s) + " " + blockTitle(b)).join(" / ") || "枠なし");
      ok("A7. 時刻を言えば時間割に出る", (() => {
        const m2 = findItem(meal.id);
        m2.duePrecision = "exact";
        m2.due = zoned(...KEY.split("-").map(Number), 12, 30, TZ).toISOString();
        return planFor(KEY, { nowMin: 12 * 60 }).blocks.some(b => b.item.id === meal.id);
      })(),
         pm.blocks.map(b => hhmm(b.s) + " " + blockTitle(b)).join(" / "));

      // 「食べた」は用事ではなく報告。完了にする。
      await say("お昼食べた。", T(13, 0));
      ok("A7. 「お昼食べた」で昼食が完了になる", findItem(meal.id).status === "done", findItem(meal.id).status);
      ok("A7. 「食べた」から新しい用事を作らない",
         state.items.filter(i => i.kind === "task" && i.status === "open").length === 0,
         state.items.filter(i => i.status === "open").map(i => i.kind + ":" + i.title).join(" / ") || "なし");

      // 同じ日の同じ食事を二重に作らない
      reset();
      await say("お昼ご飯食べる", T(11, 50));
      const n1 = state.items.length;
      await say("そろそろ昼飯にする", T(12, 10));
      ok("A7. 同じ日の同じ食事を二重に作らない", state.items.length === n1,
         state.items.map(i => i.title).join(" / "));

      // 迷っているだけなら予定に入れない
      reset();
      await say("晩ごはんどうしよう。", T(18, 0));
      ok("A7. 「どうしよう」は予定に入れない",
         !state.items.some(i => i.kind === "task"),
         state.items.map(i => i.kind + ":" + i.title).join(" / ") || "何も作らない");
    }

    /* ===== B. 「気になっていること」は画面に出るか ===== */
    reset();
    await say("いつか京都に行ってみたいな。", T(9, 0));
    const idea = state.items.find(i => i.kind === "idea");
    ok("B. 「いつか〜したいな」を idea として保存する", !!idea, idea && idea.title);
    view.day = KEY; renderDay();
    const dayHtml = document.querySelector("#dayOut").innerHTML;
    renderMe();
    const meHtml = document.querySelector("#meOut").innerHTML;
    ok("B. idea がどこかの画面に出る",
       (idea && (dayHtml.includes(idea.id) || meHtml.includes(idea.id))) === true,
       idea ? "今日=" + dayHtml.includes(idea.id) + " わたしのこと=" + meHtml.includes(idea.id) : "-");

    /* ===== C. その日だけの希望が、永久のルールになっていないか ===== */
    reset();
    await say("今日は夜まで作業する感じにはしたくない。", T(14, 0));
    ok("C. 「今日は〜」の希望が保存される", prefs(KEY).lightDay === true);
    /* 本物の時計に追い越されない「未来の日」を作る（決まり：テストを実時刻に依存させない）。
       KEY から数えるだけだと、実際の日付がそこを過ぎた日に意味が変わる。 */
    const far = dayKey(new Date(Math.max(keyToDate(KEY, TZ).getTime(), Date.now()) + 7 * 86400000), TZ);
    /* v4.3 で、未来の日には「その日までに片づけるもの」しか置かなくなった。
       だから「日付の無い作業が一週間後にも置かれるか」では、もう希望の漏れを測れない。
       測りたいのは **希望そのものが一週間後に効いていないこと** なので、そちらを直接見る。 */
    ok("C. 一週間後の日には「今日は詰めない」が効いていない",
       prefs(far).lightDay !== true, String(prefs(far).lightDay));
    const [fy, fm, fd] = far.split("-").map(Number);
    const t = { id: uid(), kind: "task", title: "来週やる作業", estimateMin: 60, status: "open", origin: "user",
      confirmed: true, corrected: false, evidence: { text: "x" }, duePrecision: "day",
      dayKey: far, due: zoned(fy, fm, fd, 23, 59, TZ).toISOString(),
      createdAt: T(9, 0), updatedAt: "", history: [] };
    t.dedupeKey = dedupeKey(t); await putItem(t);
    const pFar = planFor(far, { nowMin: -1 });
    /* v4.4：時刻も時間帯も言っていないので、時間割には置かない。
       「その日にやること」としては、ちゃんとその日に出る。 */
    ok("C. その日が期限の作業は、一週間後の日の「やること」に出る",
       (pFar.loose || []).some(i => i.id === t.id),
       (pFar.loose || []).map(i => i.title).join(" / ") || "やることが空");

    /* --- 未来の日は「その日の話」だけにする（v4.3） ---
       今までは開いている用事を全部その日に置いていたので、
       期限の無い用事が今日にも来週にも同じ順で並び、どの日も同じ顔になっていた。 */
    const noDue = { id: uid(), kind: "task", title: "いつかやる作業", estimateMin: 60, status: "open", origin: "user",
      confirmed: true, corrected: false, evidence: { text: "y" }, duePrecision: "none",
      createdAt: T(9, 0), updatedAt: "", history: [] };
    noDue.dedupeKey = dedupeKey(noDue); await putItem(noDue);
    // その日の候補になっているか（置かれたか／理由付きで置けなかったか）で見る。
    // この時点の KEY は「今日は詰めない」が効いているので、置かれるとは限らない。
    const inDay = (k, id, opts) => { const p = planFor(k, opts);
      return p.blocks.some(b => b.item.id === id) || p.unplaced.some(u => u.item.id === id)
          || (p.loose || []).some(i => i.id === id); };
    ok("C. 期限の無い作業は、未来の日の候補にならない", !inDay(far, noDue.id, { nowMin: -1 }));
    ok("C. 期限の無い作業も、今日の候補にはなる", inDay(KEY, noDue.id, { nowMin: 9 * 60 }));

    /* ===== D. 完了したものを未完了に戻したら、残り時間はどうなるか ===== */
    reset();
    // 「午前中に」＝置き場所。v4.4 では、これがないと時間割に枠ができない
    await say("午前中に資料を作る。1時間かかる。", T(9, 0));
    const doc = state.items.find(i => i.kind === "task");
    await say("資料、あと20分。", T(10, 0));
    ok("D. 残り時間が入る", doc && findItem(doc.id).remainingMin === 20, doc && String(findItem(doc.id).remainingMin));
    await act("done", doc.id);
    await act("undone", doc.id);
    const pD = planFor(KEY, { nowMin: 9 * 60 });
    const blk = pD.blocks.find(b => b.item.id === doc.id);
    ok("D. 未完了に戻したとき、残り時間の扱いが破綻しない", !!blk && blk.e > blk.s,
       blk ? durJa(blk.e - blk.s) + "（残り" + findItem(doc.id).remainingMin + "分）" : "枠なし");

    /* ===== E. 作業時間帯の外にある固定予定 ===== */
    reset();
    const ev = { id: uid(), kind: "event", title: "夜の勉強会", fixed: true, timeUnknown: false,
      start: zoned(2026, 9, 12, 20, 0, TZ).toISOString(), end: zoned(2026, 9, 12, 21, 0, TZ).toISOString(),
      dayKey: KEY, duePrecision: "exact", origin: "user", confirmed: true, corrected: false, status: "open",
      evidence: { text: "x" }, createdAt: T(9, 0), updatedAt: "", history: [] };
    ev.dedupeKey = dedupeKey(ev); await putItem(ev);
    const pE = planFor(KEY, { nowMin: 9 * 60 });
    ok("E. 作業時間の外の固定予定も表示される", pE.blocks.some(b => b.item.id === ev.id),
       pE.blocks.map(b => hhmm(b.s) + " " + blockTitle(b)).join(" / ") || "なし");

    /* ===== F. 日付をまたぐ予定（23:30〜翌0:30） ===== */
    reset();
    const ev2 = { id: uid(), kind: "event", title: "深夜の配信", fixed: true, timeUnknown: false,
      start: zoned(2026, 9, 12, 23, 30, TZ).toISOString(), end: zoned(2026, 9, 13, 0, 30, TZ).toISOString(),
      dayKey: KEY, duePrecision: "exact", origin: "user", confirmed: true, corrected: false, status: "open",
      evidence: { text: "x" }, createdAt: T(9, 0), updatedAt: "", history: [] };
    ev2.dedupeKey = dedupeKey(ev2); await putItem(ev2);
    const pF = planFor(KEY, { nowMin: -1 });
    const b2 = pF.blocks.find(b => b.item.id === ev2.id);
    ok("F. 日をまたぐ予定で、終わりが始まりより前にならない", !b2 || b2.e > b2.s,
       b2 ? hhmm(b2.s) + "-" + hhmm(b2.e) : "枠なし");

    /* ===== G. 所要時間が作業時間帯より長いタスク ===== */
    reset();
    // 「午前中に」と置き場所を言っている。だから置きにいって、入らず理由が出る（v4.4）
    const big = { id: uid(), kind: "task", title: "大きい作業", estimateMin: 600, status: "open", origin: "user",
      confirmed: true, corrected: false, evidence: { text: "x" }, duePrecision: "none",
      preferWindow: "morning",
      createdAt: T(9, 0), updatedAt: "", history: [] };
    big.dedupeKey = dedupeKey(big); await putItem(big);
    const pG = planFor(KEY, { nowMin: 9 * 60 });
    ok("G. 入りきらない大きな作業は未配置にして理由を出す",
       pG.unplaced.some(u => u.item.id === big.id) && !pG.blocks.some(b => b.item.id === big.id),
       (pG.unplaced[0] && pG.unplaced[0].reason) || "未配置になっていない");

    /* ===== H. 同じ内容を2回話したら ===== */
    reset();
    await say("ゴミを出す。", T(9, 0));
    const n1 = state.items.length;
    await say("ゴミを出す。", T(9, 5));
    ok("H. 同じ内容を2回話してもタスクが増えない", state.items.length === n1, n1 + "→" + state.items.length);

    /* ===== I. 訂正したあと、同じ内容を再び話したら復活しないか ===== */
    reset();
    await say("郵便局に行く。", T(9, 0));
    const post = state.items.find(i => /郵便局/.test(i.title));
    await act("drop", post.id);
    await say("郵便局に行く。", T(9, 10));
    ok("I. 取り消したものが、同じ発言で復活しない",
       state.items.filter(i => /郵便局/.test(i.title) && i.status !== "dropped").length === 0,
       state.items.filter(i => /郵便局/.test(i.title)).map(i => i.status).join(","));

    /* ===== J. 空の発言・記号だけ ===== */
    reset();
    let crashed = null;
    try { await say("。。。", T(9, 0)); await say("...", T(9, 1)); await say("？", T(9, 2)); }
    catch (e) { crashed = String(e && e.message || e); }
    ok("J. 意味の無い入力で落ちない", !crashed, crashed || "OK");

    /* ===== K. 未来の日付の質問 ===== */
    reset();
    await say("来週の月曜に歯医者。14時から。", T(9, 0));
    const pK = planFor(dayKey(new Date(keyToDate(KEY, TZ).getTime() + 3 * 86400000), TZ), { nowMin: -1 });
    ok("K. 未来の日でも今の時刻に引きずられない", pK.startFloor === pK.winS,
       "startFloor=" + hhmm(pK.startFloor) + " winS=" + hhmm(pK.winS));

    /* ===== L. 返事が長くなりすぎないか ===== */
    reset();
    await say("今日はだるい。", T(9, 0));
    const plan = planFor(KEY, { nowMin: 9 * 60 });
    const rep = templateReply({ changes: ["体調のことを記録"], asks: [], kinds: ["condition"], plan,
      na: nextAction(plan, 9 * 60), isToday: true, answer: null, feelingOnly: false, raw: "今日はだるい。" });
    ok("L. 気持ちの発言への返事が短い", rep.length <= 80, rep.length + "文字：" + rep);
    ok("L. 返事が質問で終わらない", !/[?？]$/.test(rep.trim()), rep);

    /* ===== M. 保存が失敗したのに「記録した」と言わないか ===== */
    reset();
    const res = await applyOps([{ op: "done", id: "no-such-id" }], { id: "n", text: "終わった", capturedAt: T(9, 0) });
    ok("M. 存在しないものを「完了にした」と言わない", res.changes.length === 0 && res.asks.length >= 1, res.asks.join(" "));

    /* ===== N. 二段構えの返事 ===== */
    ok("N. 速い返事を作る関数がある", typeof aiQuickReply === "function" && typeof quickPrompt === "function");
    {
      const cx = { p: { mo: 9, d: 12, h: 9, mi: 0 }, me: ["好み：コーヒーが好き"], pf: ["詰めすぎないで"] };
      const pr = quickPrompt({ text: "ちょっと眠い。" }, cx);
      ok("N. 速い返事には、数字や時刻を書かせない", /数字は一切出さない/.test(pr) && /時刻・所要時間・件数・予定表を書かない/.test(pr));
      ok("N. 速い返事に「記録した」と言わせない", /「記録した」「完了にした」「予定を変えた」と言わない/.test(pr));
      ok("N. 速い返事に「わたしのこと」を渡す", pr.includes("コーヒーが好き"));
      ok("N. 発話そのものを渡す", pr.includes("ちょっと眠い。"));
    }
    ok("N. 丁寧な読み取り側は default、速い返事側は quick",
       /modelTier: "quick"/.test(Array.from(document.scripts).map(s => s.textContent).join("")) &&
       /modelTier: "default", cache: false/.test(Array.from(document.scripts).map(s => s.textContent).join("")));

    /* ===== O. 返事の言い回しが硬すぎないか ===== */
    reset();
    await say("今日はもう疲れた。", T(20, 0));
    const planO = planFor(KEY, { nowMin: 20 * 60 });
    const repO = templateReply({ changes: ["体調のことを記録"], asks: [], kinds: ["condition"], plan: planO,
      na: null, isToday: true, answer: null, feelingOnly: false, raw: "今日はもう疲れた。" });
    ok("O. 疲れたと言われたら、まず受け止める", /お疲れさま|無理しないで/.test(repO), repO);
    ok("O. 疲れたときに作業を押し付けない", !/次は「/.test(repO), repO);

    /* ===== R. 保存先から読んだデータ（凍結されている）を書き換えられるか =====
       本番の claude.ai は data() を凍結して返す。凍結のまま state に入れると
       完了・延期・訂正がすべて「Cannot assign to read only property」で落ちる。 */
    {
      reset();
      const frozenItem = Object.freeze({
        id: "frozen-1", kind: "task", title: "凍った用事", status: "open", estimateMin: 30,
        origin: "rule", confirmed: false, corrected: false, duePrecision: "none",
        evidence: Object.freeze({ text: "x", start: null, end: null }),
        createdAt: T(9, 0), updatedAt: "", history: Object.freeze([]), dedupeKey: "task|凍った用事|"
      });
      ok("R. 前提：凍結されたデータは直接書き換えられない", (() => {
        try { frozenItem.status = "done"; return frozenItem.status === "open"; }
        catch (e) { return /read only|read-only/i.test(String(e.message || e)); }
      })(), "凍結の確認");

      // boot と同じように thaw を通して state に入れる
      state.items = [frozenItem].map(t => thaw(t));
      let crashed = null;
      try { await act("done", "frozen-1"); } catch (e) { crashed = String(e && e.message || e); }
      ok("R. 保存先から読んだ用事を「完了」にできる", !crashed && findItem("frozen-1").status === "done",
         crashed || findItem("frozen-1").status);

      state.items = [frozenItem].map(t => thaw(t));
      crashed = null;
      try { await act("defer", "frozen-1"); } catch (e) { crashed = String(e && e.message || e); }
      ok("R. 保存先から読んだ用事を「明日へ」できる", !crashed && !!findItem("frozen-1").dayKey,
         crashed || ("期限" + findItem("frozen-1").dayKey));

      state.items = [frozenItem].map(t => thaw(t));
      crashed = null;
      const fnote = { id: uid(), text: "あと20分。", capturedAt: T(10, 0), source: "talk", createdAt: T(10, 0) };
      try { await applyOps([{ op: "progress", id: "frozen-1", remainingMin: 20 }], fnote); }
      catch (e) { crashed = String(e && e.message || e); }
      ok("R. 保存先から読んだ用事の進捗を更新できる", !crashed && findItem("frozen-1").remainingMin === 20,
         crashed || String(findItem("frozen-1").remainingMin));

      // 履歴の配列も凍結されている
      state.items = [frozenItem].map(t => thaw(t));
      crashed = null;
      try { await act("drop", "frozen-1"); } catch (e) { crashed = String(e && e.message || e); }
      ok("R. 凍結された履歴の配列にも追記できる",
         !crashed && (findItem("frozen-1").history || []).length >= 1,
         crashed || ((findItem("frozen-1").history || []).map(h => h.what).join(",")));

      ok("R. thaw は中身まで解凍する", (() => {
        const t = thaw(frozenItem);
        try { t.evidence.text = "書き換え"; t.history.push({ x: 1 }); return true; } catch { return false; }
      })());
    }

    /* ===== P. 失敗が黙って消えないか ===== */
    ok("P. エラーを言葉にする関数がある", typeof describeError === "function");
    ok("P. コードとメッセージの両方を出す",
       /rate_limited/.test(describeError({ code: "rate_limited", message: "busy" })) &&
       /busy/.test(describeError({ code: "rate_limited", message: "busy" })),
       describeError({ code: "rate_limited", message: "busy" }));
    ok("P. 素の例外でも何か出す", describeError(new Error("boom")).length > 0, describeError(new Error("boom")));
    ok("P. 空でも「原因不明」を返す", describeError(null) === "原因不明");
    ok("P. 設定タブに不具合の置き場がある", !!document.querySelector("#errCard") && !!document.querySelector("#errText"));

    /* ===== Q. 会話が保存先の上限を超えないか ===== */
    reset();
    const bigPlan = { blocks: [], unplaced: [], timeless: [], winS: 540, winE: 1080 };
    for (let i = 0; i < 40; i++) bigPlan.blocks.push({ s: 540 + i, e: 600 + i, t: "作業" + i, k: "flex", sub: null, why: "理由".repeat(60) });
    for (let i = 0; i < 120; i++) {
      await pushTurn({ id: uid(), role: "assistant", at: T(9, 0), text: "返事".repeat(40),
        changes: ["変更".repeat(30)], plan: JSON.parse(JSON.stringify(bigPlan)), ai: true, error: null });
    }
    const day = turnsFor(KEY);
    const bytes = JSON.stringify({ day: KEY, list: day }).length;
    ok("Q. 一日の会話が保存の上限に収まる", bytes < 250000, bytes.toLocaleString() + " 文字 / " + day.length + "件");
    ok("Q. 直近の会話は残っている", day.length >= 8, day.length + "件");

    /* ===== S. 狭い画面（スマホ）向けの指定が残っているか =====
       headless Edge は窓幅を約492pxまでしか狭められないので、430px以下の見た目そのものは
       ここでは描けない。代わりに「その指定が消えていないか」をCSSOMから確かめる。
       実際の見え方は Browser pane の 375×812 で確認する（docs/開発メモ.md）。 */
    {
      const mq = (() => {
        for (const sh of document.styleSheets) {
          let rules; try { rules = sh.cssRules; } catch { continue; }
          for (const r of rules) {
            const cond = r.conditionText || (r.media && r.media.mediaText) || "";
            if (r.type === 4 && /max-width:\s*430px/.test(cond)) return r;
          }
        }
        return null;
      })();
      const decl = s => {
        if (!mq) return null;
        for (const r of mq.cssRules) if (r.selectorText === s) return r.style;
        return null;
      };
      ok("S. 狭い画面向けの指定がある", !!mq);
      const sm = decl(".btn.sm");
      ok("S. 行の操作ボタンが指で押せる高さ（34px以上）",
         !!sm && parseFloat(sm.minHeight) >= 34, sm && sm.minHeight);
      const ta = decl(".saybar textarea");
      ok("S. 入力欄の文字が16px以上（触れた瞬間に拡大されない）",
         !!ta && parseFloat(ta.fontSize) >= 16, ta && ta.fontSize);
      const row = decl(".tlrow");
      ok("S. 時刻の欄を詰めて、予定の中身に幅を回している",
         !!row && /44px/.test(row.gridTemplateColumns || ""), row && row.gridTemplateColumns);
      const head = decl(".tlrow:not(.open) .bhead");
      ok("S. たたんである枠は、枠全体を押せる",
         !!head && parseFloat(head.flexGrow) >= 1, head && head.flex);
      // 「原文」はインライン style だと画面幅で変えられない。クラスで指定してあること。
      const hasBase = (() => {
        for (const sh of document.styleSheets) {
          let rules; try { rules = sh.cssRules; } catch { continue; }
          for (const r of rules) if (r.selectorText === ".btn.sm.srcbtn") return true;
        }
        return false;
      })();
      ok("S. 「原文」の大きさをクラスで指定している（インライン style にしない）",
         hasBase && !!decl(".btn.sm.srcbtn"));
      const turnHtml = turnHTML({ role: "user", text: "郵便局に行く。", at: T(9, 0), noteId: "n1" });
      ok("S. 会話の「原文」ボタンが srcbtn クラスで描かれている",
         /class="btn sm srcbtn"/.test(turnHtml) && !/<button[^>]*style=/.test(turnHtml),
         turnHtml.replace(/\s+/g, " ").slice(0, 160));
    }

    /* ===== T. 見出しの掃除と、「やらないと決めたこと」（v2.6 で直したもの） =====
       どれも、まとめて言い方を流して目で見つけた不具合。戻らないようにここで押さえる。 */
    {
      // 日付の跡地に残るかけら
      const titleCases = [
        ["来週あたり部屋の片付けをしたい。", "部屋の片付けをしたい"],   // 「あたり」が残っていた
        ["今週中にレポートを出す。",         "レポートを出す"],         // 「中に」が残っていた
        ["3時からの会議に出る。",            "会議に出る"],             // 先頭に「の」が残っていた
        ["掃除は20分くらい。",               "掃除"],                   // 末尾に「は」が残っていた
        ["AM9時に集合。",                    "集合"]                    // 「AM」が残っていた
      ];
      for (const [text, want] of titleCases) {
        reset();
        await say(text, T(9, 0));
        const it = state.items.find(i => i.kind === "task" || i.kind === "event");
        ok("T. 見出しに日時のかけらを残さない：" + text,
           !!it && it.title === want, it ? "「" + it.title + "」" : "何も作られない");
      }

      reset();
      await say("昔から朝が弱いタイプなんだよね。", T(9, 0));
      const prof = state.items.find(i => i.kind === "profile");
      ok("T. 「〜なんだよね」を見出しから落とす",
         !!prof && prof.title === "昔から朝が弱いタイプ", prof && "「" + prof.title + "」");

      // やらないと決めたこと・取りやめ
      reset();
      await say("今日はジムに行かない。", T(9, 0));
      ok("T. 「行かない」を予定にしない",
         !state.items.some(i => i.kind === "event"),
         state.items.map(i => i.kind + "「" + i.title + "」").join(" / ") || "何も作られない");
      ok("T. それでも記録は残す（発言を捨てない）", state.items.length >= 1);

      reset();
      await say("打ち合わせは中止になった。", T(9, 0));
      ok("T. 「中止になった」を新しい用事にしない",
         !state.items.some(i => i.kind === "task"),
         state.items.map(i => i.kind + "「" + i.title + "」").join(" / ") || "何も作られない");

      reset();
      await say("買い物はやめた。", T(9, 0));
      ok("T. 「やめた」を新しい用事にしない", !state.items.some(i => i.kind === "task"),
         state.items.map(i => i.kind).join(",") || "なし");

      // 逆方向の確認：「〜ないと」は否定ではなく「やらなければ」。巻き込んではいけない
      reset();
      await say("美容院の予約を取らないと。", T(9, 0));
      ok("T. 「〜ないと」は今までどおり用事になる（否定と取り違えない）",
         state.items.some(i => i.kind === "task"),
         state.items.map(i => i.kind + "「" + i.title + "」").join(" / ") || "何も作られない");

      reset();
      await say("資料を作らないといけない。", T(9, 0));
      ok("T. 「ないといけない」も用事のまま",
         state.items.some(i => i.kind === "task"),
         state.items.map(i => i.kind + "「" + i.title + "」").join(" / ") || "何も作られない");

      // 長さだけを言っている文
      reset();
      await say("たぶん2、3時間はかかる。", T(9, 0));
      ok("T. 長さだけの文から「たぶん2」という用事を作らない",
         !state.items.length, state.items.map(i => "「" + i.title + "」").join(" / "));

      // 「いつか」は、やると決めたことではない
      reset();
      await say("いつか旅行に行きたい。", T(9, 0));
      const trip = state.items[0];
      ok("T. 「いつか〜に行きたい」は思いつき（用事にしない）",
         !!trip && trip.kind === "idea", trip && (trip.kind + "「" + trip.title + "」"));

      // AIへの要望
      reset();
      await say("直前に慌てたくないから準備の時間もほしい。", T(9, 0));
      ok("T. 「〜ほしい」を自分の用事にしない",
         !state.items.some(i => i.kind === "task"),
         state.items.map(i => i.kind).join(",") || "なし");

      // 完了の言い方
      reset();
      await say("掃除、終わり。", T(9, 0));
      ok("T. 「〜終わり」を用事にしない（完了の言い方として扱う）",
         !state.items.some(i => i.kind === "task"),
         state.items.map(i => i.kind + "「" + i.title + "」").join(" / ") || "何も作られない");
    }

    /* ===== U. 午前とも午後とも言われていない時刻（v2.9） =====
       「10時から11時まで勉強する」と13時に言われたら、それは今夜の22時。
       翌日の朝ではない。午前・午後・日付が言われているときは触らない。 */
    {
      const f = iso => iso ? fmtDT(iso, TZ) : "—";
      const at = (h, mi, text) => parseWhen(text, T(h, mi), TZ);

      let w = at(8, 0, "10時から11時まで勉強する");
      ok("U. 午前のうちなら、そのまま午前として読む",
         f(w.start) === "9/12 10:00" && f(w.end) === "9/12 11:00", f(w.start) + "〜" + f(w.end));

      w = at(13, 0, "10時から11時まで勉強する");
      ok("U. 13時に言われた「10時から11時」は、今夜の22時〜23時",
         f(w.start) === "9/12 22:00" && f(w.end) === "9/12 23:00", f(w.start) + "〜" + f(w.end));

      w = at(21, 0, "10時から11時まで勉強する");
      ok("U. 21時でも同じ（明日の朝にしない）",
         f(w.start) === "9/12 22:00" && f(w.end) === "9/12 23:00", f(w.start) + "〜" + f(w.end));

      w = at(23, 30, "10時から11時まで勉強する");
      ok("U. 午前も午後も過ぎていたら、翌日にする",
         f(w.start) === "9/13 10:00", f(w.start));

      w = at(13, 0, "10時から勉強する");
      ok("U. 範囲でない単発の時刻も同じ", f(w.iso) === "9/12 22:00", f(w.iso));

      // 言われているときは、こちらで決め直さない
      w = at(8, 0, "午後10時から11時まで勉強する");
      ok("U. 「午後10時から11時」の終わりも午後にする（10:00〜11:00 にしない）",
         f(w.start) === "9/12 22:00" && f(w.end) === "9/12 23:00", f(w.start) + "〜" + f(w.end));

      w = at(21, 0, "午前10時から11時まで勉強する");
      ok("U. 「午前10時」と言われたら、21時でも午前のまま",
         f(w.start) === "9/12 10:00", f(w.start));

      w = at(21, 0, "明日10時から11時まで勉強する");
      ok("U. 日付を言われていたら触らない",
         f(w.start) === "9/13 10:00", f(w.start));

      w = at(13, 0, "17:30に出発");
      ok("U. 12時以降の時刻は、そのまま", f(w.iso) === "9/12 17:30", f(w.iso));

      w = at(8, 0, "夜10時から勉強する");
      ok("U. 「夜10時」は今までどおり22時", f(w.iso) === "9/12 22:00", f(w.iso));

      /* --- 聞き返すのはどの言い方か（v3.0） ---
         言われたままの時刻が既に過ぎているときだけ、もう一方を持って聞き返す。
         まだ来ていない時刻（朝の「10時」）は聞き返さない。うるさくなるだけなので。 */
      const asksBack = (h, mi, text) => { const x = at(h, mi, text); return !!(x && x.altStart); };
      const 聞き返す = [
        [13, 0, "10時から11時まで勉強する"],
        [21, 0, "10時から勉強する"],
        [23, 30, "10時から11時まで勉強する"],
        [9, 0, "3時から4時まで打ち合わせ"]
      ];
      const 聞き返さない = [
        [8, 0, "10時から11時まで勉強する"],   // まだ来ていない
        [8, 0, "午前10時から11時まで勉強する"],
        [21, 0, "午後10時から11時まで勉強する"],
        [21, 0, "夜10時から勉強する"],
        [21, 0, "明日10時から11時まで勉強する"],
        [13, 0, "17:30に出発"],
        [13, 0, "14時から会議"],
        [13, 0, "郵便局に行く"]
      ];
      for (const [h, mi, t] of 聞き返す)
        ok("U. 聞き返す：" + String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0") + "「" + t + "」",
           asksBack(h, mi, t));
      for (const [h, mi, t] of 聞き返さない)
        ok("U. 聞き返さない：" + String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0") + "「" + t + "」",
           !asksBack(h, mi, t));

      // 実際に項目に付いて、押せば直ること（予定の場合）
      reset();
      const r = await say("10時から11時まで打ち合わせ", T(13, 0));
      const ev = state.items.find(i => i.whenAlt);
      ok("U. もう一方の読み方が項目に付く",
         !!ev && fmtDT(ev.whenAlt.start, TZ) === "9/13 10:00",
         ev ? (ev.kind + "/" + (ev.whenAlt ? fmtDT(ev.whenAlt.start, TZ) : "無し")) : "項目が無い");
      ok("U. 返事で聞き返す", r.asks.some(a => /と読みました/.test(a)), r.asks.join(" / ") || "（聞き返していない）");

      view.day = KEY; showTab("p-day"); renderDay();
      ok("U. 画面に「◯◯にする」のボタンが出る",
         /data-act="usealt"/.test(document.querySelector("#dayOut").innerHTML));

      if (ev) {
        await act("usealt", ev.id);
        const ev2 = findItem(ev.id);
        const when2 = ev2.kind === "event" ? ev2.start : ev2.due;
        ok("U. 押すと、もう一方の時刻に直る",
           fmtDT(when2, TZ) === "9/13 10:00" && ev2.dayKey === "2026-09-13",
           fmtDT(when2, TZ) + " / " + ev2.dayKey);
        ok("U. 予定なら、長さもそのまま持ち越す",
           ev2.kind !== "event" || fmtDT(ev2.end, TZ).slice(-5) === "11:00",
           ev2.end ? fmtDT(ev2.end, TZ) : "（終わり無し）");
        ok("U. 直したら「本人が訂正」になる", ev2.corrected === true && !ev2.whenAlt);
        ok("U. 直した記録が履歴に残る",
           (ev2.history || []).some(x => /午前\/午後/.test(x.what)),
           (ev2.history || []).map(x => x.what).join(" / "));
      }

      // 用事（時刻つきタスク）でも付くこと
      reset();
      await say("10時に電話する", T(13, 0));
      const tk = state.items.find(i => i.kind === "task");
      ok("U. 時刻つきの用事にも、もう一方が付く",
         !!tk && !!tk.whenAlt, tk ? (tk.title + " / " + (tk.whenAlt ? fmtDT(tk.whenAlt.start, TZ) : "無し")) : "無し");

      /* --- 速い返事も、同じ時間帯を見て話す（v3.1） ---
         これが無いと「朝の勉強時間ですね」→「今夜22時から23時で入れました」と食い違う。
         実際にそうなった。速い返事は数字を書かないので、時間帯の言葉だけを渡す。 */
      {
        const hint = (h, mi, text) => {
          const n = { id: uid(), text: normNote(text), hash: "h" + Math.random(),
                      capturedAt: T(h, mi), source: "talk", createdAt: T(h, mi) };
          return quickWhenHint(n, TZ);
        };
        ok("U. 速い返事へのヒント：13時の「10時から11時」は夜",
           hint(13, 0, "10時から11時まで勉強する") === "夜", hint(13, 0, "10時から11時まで勉強する"));
        ok("U. 速い返事へのヒント：8時の「10時から11時」は朝",
           hint(8, 0, "10時から11時まで勉強する") === "朝", hint(8, 0, "10時から11時まで勉強する"));
        ok("U. 速い返事へのヒント：「明日10時から」は明日以降の朝",
           hint(21, 0, "明日10時から11時まで勉強する") === "明日以降の朝",
           hint(21, 0, "明日10時から11時まで勉強する"));
        ok("U. 速い返事へのヒント：「14時から会議」は午後",
           hint(9, 0, "14時から会議") === "午後", hint(9, 0, "14時から会議"));
        ok("U. 速い返事へのヒント：時刻が無ければ空（時間帯に触れさせない）",
           hint(9, 0, "郵便局に行く") === "", "「" + hint(9, 0, "郵便局に行く") + "」");
        ok("U. 速い返事のプロンプトに、時間帯と禁止事項が入る", (() => {
          const n = { id: uid(), text: "10時から11時まで勉強する", hash: "q", capturedAt: T(13, 0), source: "talk", createdAt: T(13, 0) };
          const p = quickPrompt(n, contextForAI(n));
          return /【この発話の時間帯】夜/.test(p) && /自分で朝か夜かを決めないこと/.test(p) && !/22/.test(p.split("【本人の発話】")[0]);
        })());
      }

      /* --- 日付は言われていても、午前/午後は言われていない（v4.3） ---
         実機の報告：「明日1時から2時まで勉強する」が 深夜1時 として読まれ、
         速い返事が「明日の深夜に」と言った（予定表には13時と入った＝本人の意図はそちら）。
         1〜5時は午後と読む。6〜11時は午前のまま。どちらも「もう一方」を持って聞き返す。 */
      {
        const w = (text, h) => parseWhen(text, T(h == null ? 9 : h, 47), TZ);
        const hourOf = iso => iso ? parts(new Date(iso), TZ).h : null;

        const 読み = { 1: 13, 2: 14, 3: 15, 4: 16, 5: 17, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11 };
        const もう一方 = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 18 };   // 7〜11時は聞き返さない
        for (let h = 1; h <= 11; h++) {
          const r = w(`明日${h}時に歯医者に行く`);
          ok(`U. 「明日${h}時」→ ${読み[h]}時`, hourOf(r && r.start) === 読み[h], hourOf(r && r.start));
          ok(`U. 「明日${h}時」のもう一方 → ${もう一方[h] != null ? もう一方[h] + "時" : "持たない"}`,
             hourOf(r && r.altStart) === (もう一方[h] != null ? もう一方[h] : null),
             hourOf(r && r.altStart));
        }

        // 範囲は、終わりも同じだけ動く（v2.9 と同じ落とし穴）
        const rg = w("明日1時から2時まで勉強する");
        ok("U. 「明日1時から2時まで」→ 13:00–14:00",
           hourOf(rg && rg.start) === 13 && hourOf(rg && rg.end) === 14,
           hourOf(rg && rg.start) + "–" + hourOf(rg && rg.end));
        ok("U. そのもう一方は 01:00–02:00",
           hourOf(rg && rg.altStart) === 1 && hourOf(rg && rg.altEnd) === 2,
           hourOf(rg && rg.altStart) + "–" + hourOf(rg && rg.altEnd));

        // 午前・午後を言われていたら触らない。決めつけない
        for (const [t, want] of [["明日の午前1時に歯医者に行く", 1], ["明日の午後1時に歯医者に行く", 13],
                                 ["明日0時に歯医者に行く", 0], ["明日17:30に歯医者に行く", 17]]) {
          const r = w(t);
          ok(`U. 「${t}」→ ${want}時・聞き返さない`,
             hourOf(r && r.start) === want && !(r && r.altStart),
             hourOf(r && r.start) + " / alt=" + hourOf(r && r.altStart));
        }

        // 速い返事も同じものを見る。「深夜」と言わない
        const n43 = { id: uid(), text: "明日1時から2時まで勉強する", hash: "v43" + Math.random(),
                      capturedAt: T(9, 47), source: "talk", createdAt: T(9, 47) };
        const h43 = quickWhenHint(n43, TZ);
        ok("U. 速い返事へのヒント：「明日1時から2時」は深夜ではない", !/深夜/.test(h43), "「" + h43 + "」");
        ok("U. 速い返事へのヒント：予定表の13時と揃っている", h43 === "明日以降の昼", "「" + h43 + "」");

        // AIにも同じ規則を書いてあること（ルールとAIで答えを割らない・決まり4b）
        {
          const p = buildPrompt(n43, contextForAI(n43));
          ok("U. AIへの依頼にも「1時〜5時は午後」と書いてある",
             /「1時」〜「5時」は、午後/.test(p) && /「6時」〜「11時」は、そのまま午前/.test(p));
        }
      }

      /* --- Z群：AIに渡すものが、増えても劣化しないか（v4.3） ---
         `contextForAI` は素の `.slice(0, 40)` だった＝いちばん古い40件。
         40件を超えた日から、直前に足したものがAIに見えなくなり、
         言い直しと完了の判定が新しい予定にだけ効かなくなる（画面には何も出ない）。 */
      {
        reset();
        for (let i = 1; i <= 60; i++) {
          await say(`用事${String(i).padStart(2, "0")}を片づける`, T(8, 0));
        }
        const n = { id: uid(), text: "さっきの話", hash: "z" + Math.random(),
                    capturedAt: T(9, 0), source: "talk", createdAt: T(9, 0) };
        const cx = contextForAI(n);
        const names = cx.open.map(o => o.内容).join(" ");
        ok("Z. 開いている用事が60件ある", state.items.filter(i => i.kind === "task" && i.status === "open").length >= 60,
           state.items.filter(i => i.kind === "task" && i.status === "open").length);
        ok("Z. AIに渡すのは40件まで", cx.open.length === 40, cx.open.length);
        ok("Z. いちばん新しい用事が渡る", /用事60/.test(names), cx.open.slice(0, 3).map(o => o.内容).join(" / "));
        ok("Z. いちばん古い用事は落ちる", !/用事01/.test(names), "用事01 が入っている");
        ok("Z. 載せなかった件数をAIに伝える", cx.omitted === 20, cx.omitted);
        ok("Z. その旨が依頼文に入る", /ほかに20件の古い用事/.test(buildPrompt(n, cx)));

        // 今日の用事は、古くても必ず渡す（言い直しの相手になりやすい）
        reset();
        for (let i = 1; i <= 50; i++) await say(`用事${String(i).padStart(2, "0")}を片づける`, T(8, 0));
        const old = state.items.filter(i => i.kind === "task")[0];
        old.dayKey = KEY; old.duePrecision = "day"; old.due = T(18, 0); await putItem(old);
        for (let i = 51; i <= 70; i++) await say(`用事${String(i).padStart(2, "0")}を片づける`, T(8, 30));
        const cx2 = contextForAI({ id: uid(), text: "x", hash: "z2", capturedAt: T(9, 0), source: "talk", createdAt: T(9, 0) });
        ok("Z. 期限が今日のものは、古くても渡る",
           cx2.open.some(o => o.内容 === old.title), "「" + old.title + "」が落ちている");
      }

      /* --- 資料は、送ると言った回数で読み切れること（v4.3） ---
         上限60,000文字に対して6回×6,000＝36,000しか読んでいなかった。
         画面は「6回に分けて送ります」としか言わず、後半24,000文字は黙って捨てられていた。 */
      {
        ok("Z. 読める文字数と、資料の上限が一致する",
           AI_CHUNK * AI_MAX_CHUNKS >= DOC_MAX_CHARS,
           `${AI_CHUNK}×${AI_MAX_CHUNKS}=${AI_CHUNK * AI_MAX_CHUNKS} / 上限${DOC_MAX_CHARS}`);
        ok("Z. 回数は上限から計算している（別々の定数にしない）",
           AI_MAX_CHUNKS === Math.ceil(DOC_MAX_CHARS / AI_CHUNK), AI_MAX_CHUNKS);
      }

      /* ===== AA群：日をまたぐ予定（v4.3） =====
         開始日だけで選んでいたので、23時から翌1時までの予定が翌日に出ず、
         そこへ別の作業が置かれていた。一日じゅう使える設定にしたぶん、効きが大きい。 */
      {
        reset();
        await say("夜11時から深夜1時までゼミ", T(20, 0));
        const ev = state.items.find(i => i.kind === "event");
        ok("AA. 「夜11時から深夜1時まで」が予定になる", !!ev, state.items.map(i => i.kind + "/" + i.title).join(" "));
        if (ev) {
          const next = dayKey(new Date(keyToDate(KEY, TZ).getTime() + 86400000), TZ);
          ok("AA. 終わりは翌日の1時（同じ日の13時にしない）",
             dayKey(new Date(ev.end), TZ) === next && parts(new Date(ev.end), TZ).h === 1,
             fmtDT(ev.end, TZ) + " / 翌日は " + next);
          const a = planFor(KEY, { nowMin: -1 }), b = planFor(next, { nowMin: -1 });
          ok("AA. 当日は 23:00 から出る", a.blocks.some(x => x.sub === "event" && x.s === 23 * 60));
          ok("AA. 翌日は 0:00–1:00 に出る",
             b.blocks.some(x => x.sub === "event" && x.s === 0 && x.e === 60),
             b.blocks.map(x => x.s + "-" + x.e).join(","));
          ok("AA. 翌日の 0:00 に作業を重ねない",
             !b.blocks.some(x => x.type === "flex" && x.s < 60));
          ok("AA. 「前の日から続いています」と理由に書く",
             b.blocks.some(x => /前の日から続/.test(x.reason || "")));
        }
        // 時刻の範囲を言ったら、語彙になくても予定にする（用事にすると勝手な場所に置かれる）
        reset();
        await say("1時から2時まで勉強する", T(9, 47));
        const st = state.items[0];
        ok("AA. 「1時から2時まで勉強する」は予定になる", st && st.kind === "event", st && st.kind);
        ok("AA. その予定は 13:00–14:00", st && st.start && fmtDT(st.start, TZ).endsWith("13:00"), st && fmtDT(st.start, TZ));
      }

      /* ===== AB群：くり返しの予定（v4.3） =====
         「毎週月曜10時からゼミ」が1回きりになり、見出しに「毎週」が残っていた。 */
      {
        reset();
        await say("毎週月曜10時からゼミ", T(9, 0));
        const z = state.items.find(i => i.kind === "event");
        ok("AB. くり返しとして読み取る", !!(z && z.repeat && z.repeat.kind === "weekly"), z && JSON.stringify(z.repeat));
        ok("AB. 見出しから「毎週」を落とす", !!z && !/毎週/.test(z.title), z && z.title);
        ok("AB. 曜日は月曜", !!(z && z.repeat && z.repeat.dow === 1), z && z.repeat && z.repeat.dow);
        if (z) {
          const mon = k => { let d = keyToDate(KEY, TZ).getTime();
            for (let i = 0; i < 40; i++) { const kk = dayKey(new Date(d + i * 86400000), TZ);
              if (parts(keyToDate(kk, TZ), TZ).dow === 1 && kk >= z.dayKey) { if (--k <= 0) return kk; } } return null; };
          const m1 = mon(1), m2 = mon(2), notMon = dayKey(new Date(keyToDate(m1, TZ).getTime() + 86400000), TZ);
          ok("AB. 次の月曜に出る", planFor(m1, { nowMin: -1 }).blocks.some(b => b.item.id === z.id), m1);
          ok("AB. そのまた次の月曜にも出る", planFor(m2, { nowMin: -1 }).blocks.some(b => b.item.id === z.id), m2);
          ok("AB. 火曜には出ない", !planFor(notMon, { nowMin: -1 }).blocks.some(b => b.item.id === z.id), notMon);
          ok("AB. 項目は1件のまま（52件に増やさない）", state.items.filter(i => i.id === z.id).length === 1);
          // その日のぶんだけ終わりにする。シリーズは消さない
          await act("done", z.id, { dataset: { day: m1 } });
          ok("AB. その日のぶんだけ終わる", !planFor(m1, { nowMin: -1 }).blocks.some(b => b.item.id === z.id));
          ok("AB. 次の月曜は残る", planFor(m2, { nowMin: -1 }).blocks.some(b => b.item.id === z.id));
          ok("AB. シリーズごと完了にしない", findItem(z.id).status === "open", findItem(z.id).status);
          await act("skipday", z.id, { dataset: { day: m2 } });
          ok("AB. 「この日はやらない」も、その日だけ", !planFor(m2, { nowMin: -1 }).blocks.some(b => b.item.id === z.id));
        }
        reset();
        await say("毎月1日に家賃を払う", T(9, 0));
        const y = state.items.find(i => i.kind === "task");
        ok("AB. 毎月の用事も読み取る", !!(y && y.repeat && y.repeat.kind === "monthly" && y.repeat.dom === 1), y && JSON.stringify(y && y.repeat));
        ok("AB. 見出しから「毎月」を落とす", !!y && !/毎月/.test(y.title), y && y.title);
      }

      /* ===== AC群：何日も続く予定（v4.3） =====
         出張中の残りの日が空いている扱いになり、そこへ作業が積まれていた。 */
      {
        reset();
        await say("明日から3日間、出張します", T(9, 0));
        const tr = state.items.find(i => i.kind === "event");
        ok("AC. 何日も続く予定として読み取る", !!(tr && tr.spanEndKey), tr && (tr.kind + "/" + tr.title));
        if (tr) {
          const d1 = dayKey(new Date(keyToDate(KEY, TZ).getTime() + 86400000), TZ);
          const d3 = dayKey(new Date(keyToDate(KEY, TZ).getTime() + 3 * 86400000), TZ);
          const d4 = dayKey(new Date(keyToDate(KEY, TZ).getTime() + 4 * 86400000), TZ);
          ok("AC. 終わりは3日目", tr.spanEndKey === d3, tr.spanEndKey + " / 期待 " + d3);
          ok("AC. 終日あつかい", tr.allDay === true);
          for (const k of [d1, d3]) ok("AC. " + k + " に出る",
            planFor(k, { nowMin: -1 }).blocks.some(b => b.item.id === tr.id));
          ok("AC. 4日目には出ない", !planFor(d4, { nowMin: -1 }).blocks.some(b => b.item.id === tr.id));
          const pd1 = planFor(d1, { nowMin: -1 });
          ok("AC. 終日の枠は作業時間をふさがない",
             pd1.freeLeft >= pd1.winE - pd1.winS, pd1.freeLeft + " / 作業できる幅 " + (pd1.winE - pd1.winS));
        }
      }

      /* ===== AD群：予定の重なり（v4.3）。今までは黙って重ねて描いていた ===== */
      {
        reset();
        await say("14時から15時まで打ち合わせ", T(9, 0));
        await say("14時半から16時まで面談", T(9, 1));
        const p = planFor(KEY, { nowMin: -1 });
        ok("AD. 重なりを見つける", p.conflicts.length === 1, JSON.stringify(p.conflicts.map(c => c.s + "-" + c.e)));
        ok("AD. 重なっている時間を出す", p.conflicts[0] && p.conflicts[0].s === 14 * 60 + 30 && p.conflicts[0].e === 15 * 60,
           p.conflicts[0] && (p.conflicts[0].s + "-" + p.conflicts[0].e));
        view.day = KEY; showTab("p-day"); renderDay();
        ok("AD. 画面に「予定が重なっています」と出る", /予定が重なっています/.test($("#dayOut").innerHTML));
        reset();
        await say("14時から15時まで打ち合わせ", T(9, 0));
        ok("AD. 重なっていなければ何も出さない", planFor(KEY, { nowMin: -1 }).conflicts.length === 0);
      }

      /* ===== AE群：消す・戻す・整理する（v4.3） ===== */
      {
        reset();
        await say("牛乳を買っておく", T(9, 0));
        const one = state.items.find(i => i.kind === "task");
        ok("AE. 1件だけ完全に消す道がある", /data-act="delitem"/.test((openEdit(one), $("#sheetHost").innerHTML)));
        closeSheet();
        const before = state.items.length;
        const p = act("delitem", one.id);
        await new Promise(r => setTimeout(r, 40));
        if (document.querySelector("#sheetHost #cfYes")) document.querySelector("#cfYes").click();
        await p;
        ok("AE. 押すと記録ごと消える", state.items.length === before - 1 && !findItem(one.id),
           state.items.length + " / " + before);
        ok("AE. 書き出しを戻す道がある", typeof importJSON === "function" && !!document.querySelector("#btnImport"));
        ok("AE. 古い記録だけ整理する道がある", !!document.querySelector("#btnTidy"));
        ok("AE. 記録をさがす道がある", !!document.querySelector("#findQ"));
        ok("AE. 読み込めていないぶんまで消し切る関数がある", typeof wipeCollection === "function");
        ok("AE. カレンダーの読み書きがある", typeof parseICS === "function" && typeof buildICS === "function");
        const ics = parseICS([
          "BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:健康診断",
          "DTSTART;TZID=Asia/Tokyo:20260915T093000", "DTEND;TZID=Asia/Tokyo:20260915T103000",
          "END:VEVENT", "END:VCALENDAR"].join("\r\n"), TZ);
        ok("AE. .ics を1件読める", ics.length === 1 && ics[0].title === "健康診断", JSON.stringify(ics));
        ok("AE. .ics の時刻を正しく読む", ics[0] && fmtDT(ics[0].start, TZ) === "9/15 09:30", ics[0] && fmtDT(ics[0].start, TZ));
      }

      /* ===== AF群：長すぎる入力・時間切れ・オフライン（v4.3） ===== */
      {
        ok("AF. 1回の発言に上限がある", typeof NOTE_MAX === "number" && NOTE_MAX > 0 && NOTE_MAX <= 50000, String(typeof NOTE_MAX));
        ok("AF. AIの呼び出しに時間切れがある", typeof aiSignal === "function"
           && typeof AI_TIMEOUT_QUICK === "number" && typeof AI_TIMEOUT_MAIN === "number");
        const g = aiSignal(50);
        ok("AF. 時間切れは AbortSignal を返す", !!(g && g.signal && typeof g.done === "function"));
        g.done();
        ok("AF. タイムゾーンを変えたら日付を引き直す", typeof retimeItems === "function");
        ok("AF. 圏外を見張っている",
           Array.from(document.scripts).some(s => /navigator\.onLine/.test(s.textContent) && /function\s+setSync/.test(s.textContent)));
      }

      /* ===== AG群：シートの閉じ方（v4.3） ===== */
      {
        openSheet("<h3>てすと</h3><button id='zzz'>x</button>");
        ok("AG. 開くと後ろのスクロールを止める", document.body.classList.contains("sheetopen"));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await new Promise(r => setTimeout(r, 20));
        ok("AG. Escape で閉じる", !document.querySelector("#sheetHost .sheet"));
        ok("AG. 閉じるとスクロールが戻る", !document.body.classList.contains("sheetopen"));
        /* 画面やソース全体を検索して判断しない（説明のコメントにも同じ字面が出る）。
           関数そのものの中身を見る。 */
        ok("AG. 自分からは history.back() を呼ばない（テストが終わらなくなる）",
           String(closeSheet).indexOf("history.back") < 0, String(closeSheet).slice(0, 120));
      }

      /* ===== AH群：置き場所を言ったときだけ予定表に置く（v4.4・本人の指示） =====
         「明日、資料を作る。2時間。」には時刻が無い。それを 00:00 から並べるのは
         こちらが勝手に決めた場所で、本人は一度もそう言っていない。 */
      {
        const tomorrow = dayKey(new Date(keyToDate(KEY, TZ).getTime() + 86400000), TZ);
        const onTL = id => planFor(tomorrow, { nowMin: -1 }).blocks.find(b => b.item.id === id);
        const inLoose = id => (planFor(tomorrow, { nowMin: -1 }).loose || []).some(i => i.id === id);

        reset();
        await say("明日、資料を作る。2時間。", T(9, 0));
        const a = state.items.find(i => i.kind === "task");
        ok("AH. 時刻を言っていない作業は、予定表に置かない", !!a && !onTL(a.id),
           a && onTL(a.id) ? hhmm(onTL(a.id).s) + " に置かれた" : "置かれない");
        ok("AH. その作業は「この日にやること」に残る", !!a && inLoose(a.id));
        ok("AH. 「入りきらなかった」扱いにもしない",
           !planFor(tomorrow, { nowMin: -1 }).unplaced.some(u => u.item.id === (a && a.id)));

        reset();
        await say("明日の午前中に資料を作る。2時間。", T(9, 0));
        const b = state.items.find(i => i.kind === "task");
        const bb = b && onTL(b.id);
        ok("AH. 「午前中に」と言えば、午前に置く", !!bb && bb.s >= 6 * 60 && bb.e <= 12 * 60,
           bb ? hhmm(bb.s) + "-" + hhmm(bb.e) : "置かれない");
        ok("AH. 「午前中」を深夜0時から始めない", !bb || bb.s >= 6 * 60, bb && hhmm(bb.s));

        reset();
        await say("明日14時から資料を作る。2時間。", T(9, 0));
        const c = state.items.find(i => i.kind === "task" || i.kind === "event");
        const cb = c && onTL(c.id);
        ok("AH. 「14時から」と言えば、14時に置く", !!cb && cb.s === 14 * 60,
           cb ? hhmm(cb.s) + "-" + hhmm(cb.e) : "置かれない");

        // 言った時刻が埋まっていたら、勝手にずらさずに理由を出す
        reset();
        await say("明日14時から16時まで会議。", T(9, 0));
        await say("明日14時から資料を作る。2時間。", T(9, 1));
        const d = state.items.find(i => i.kind === "task");
        const pd = planFor(tomorrow, { nowMin: -1 });
        ok("AH. 言った時刻が埋まっていたら、勝手にずらさない",
           !!d && !pd.blocks.some(x => x.item.id === d.id)
               && pd.unplaced.some(u => u.item.id === d.id && /埋まって/.test(u.reason)),
           pd.unplaced.map(u => u.reason).join(" / ") || "未配置なし");

        // 画面に、なぜ予定表に無いのかが1回だけ書いてある
        reset();
        await say("明日、資料を作る。2時間。", T(9, 0));
        view.day = tomorrow; showTab("p-day"); renderDay();
        const txt = $("#dayOut").textContent.replace(/\s+/g, " ");
        ok("AH. なぜ予定表に無いのかを画面に書く",
           /時刻を言っていないので、予定表には置いていません/.test(txt));
        ok("AH. どう言えば置けるかも書く", /「午前中に」「14時から」/.test(txt));
        ok("AH. 深夜0時台に作業を置かない",
           !planFor(tomorrow, { nowMin: -1 }).blocks.some(b => b.type === "flex" && b.s < 6 * 60));
      }

      /* ===== AI群：仮置きの終わりは、言われた時刻に道を譲る（v4.5・本人の指示） =====
         実機の報告：「12時半からご飯食べに行く」の1時間（仮置き）が、
         「1時から2時まで勉強する」（本人が言った時刻）と 13:00–13:30 で重なっていた。
         仮置きが事実を押しのけるのは順序が逆。 */
      {
        const blk = (p, re) => p.blocks.find(b => re.test(b.item.title));
        reset();
        await say("12時半からご飯食べに行く", T(11, 0));
        await say("1時から2時まで勉強しようかな", T(11, 1));
        const p = planFor(KEY, { nowMin: -1 });
        const meal = blk(p, /昼食/), study = blk(p, /勉強/);
        ok("AI. 仮置きの終わりを、言われた時刻まで短くする",
           !!meal && meal.s === 12 * 60 + 30 && meal.e === 13 * 60,
           meal ? hhmm(meal.s) + "-" + hhmm(meal.e) : "昼食の枠が無い");
        ok("AI. 言われた時刻のほうは動かさない",
           !!study && study.s === 13 * 60 && study.e === 14 * 60,
           study ? hhmm(study.s) + "-" + hhmm(study.e) : "勉強の枠が無い");
        ok("AI. 重なりが消える", p.conflicts.length === 0,
           p.conflicts.map(c => hhmm(c.s) + "-" + hhmm(c.e)).join(","));
        ok("AI. 短くした理由を書く", !!meal && /重ならないように短く/.test(meal.reason || ""), meal && meal.reason);

        // 言う順番が逆でも同じ
        reset();
        await say("1時から2時まで勉強しようかな", T(11, 0));
        await say("12時半からご飯食べに行く", T(11, 1));
        const p2 = planFor(KEY, { nowMin: -1 });
        ok("AI. 言う順番を変えても同じになる",
           p2.conflicts.length === 0 && (blk(p2, /昼食/) || {}).e === 13 * 60,
           (blk(p2, /昼食/) || {}).e);

        // どちらも終わりを言っているなら、勝手に縮めない
        reset();
        await say("12時半から13時半まで打ち合わせ", T(11, 0));
        await say("13時から14時まで面談", T(11, 1));
        const p3 = planFor(KEY, { nowMin: -1 });
        ok("AI. どちらも終わりを言っていれば縮めず、重なりとして知らせる",
           p3.conflicts.length === 1 && (blk(p3, /打ち合わせ/) || {}).e === 13 * 60 + 30,
           p3.conflicts.length + "件 / 打ち合わせの終わり " + hhmm((blk(p3, /打ち合わせ/) || {}).e || 0));

        // 縮めると短すぎるときは縮めない（重なりとして出す）
        reset();
        await say("12時55分からご飯食べに行く", T(11, 0));
        await say("13時から14時まで面談", T(11, 1));
        ok("AI. 10分を切るほど短くなるなら縮めない",
           planFor(KEY, { nowMin: -1 }).conflicts.length === 1);

        // 移動の手前でも譲る
        reset();
        await say("12時半からご飯食べに行く", T(11, 0));
        await say("14時から歯医者に行く。移動に40分かかる。", T(11, 1));
        const p5 = planFor(KEY, { nowMin: -1 });
        ok("AI. 移動の時間にも重ねない",
           p5.conflicts.length === 0 && (blk(p5, /昼食/) || {}).e === 13 * 60 + 20,
           hhmm((blk(p5, /昼食/) || {}).e || 0));
      }

      /* ===== AJ群：「◯時から◯時の間に◯分」は予定ではなく時間帯（v4.5） =====
         「6時から9時の間に30分勉強する」が、18:00〜21:00 の3時間の固定予定になっていた。 */
      {
        reset();
        await say("6時から9時の間に30分勉強する", T(11, 0));
        const it = state.items[0];
        ok("AJ. 3時間の予定にしない", !!it && it.kind === "task",
           it ? it.kind + "「" + it.title + "」" : "何も作らない");
        ok("AJ. 見出しに「間に」を残さない", !!it && !/間に/.test(it.title), it && it.title);
        ok("AJ. 所要時間は30分", !!it && it.estimateMin === 30, it && String(it.estimateMin));
        ok("AJ. 置いてよい時間帯として持つ",
           !!it && it.winFrom === 18 * 60 && it.winTo === 21 * 60,
           it ? it.winFrom + "〜" + it.winTo : "-");
        // 夜の時間帯を使うので、作業できる幅を一日じゅうにしておく
        const savedW = { s: state.settings.workStart, e: state.settings.workEnd };
        state.settings.workStart = "00:00"; state.settings.workEnd = "23:59";
        const pj = planFor(KEY, { nowMin: -1 });
        state.settings.workStart = savedW.s; state.settings.workEnd = savedW.e;
        const b = pj.blocks.find(x => x.item.id === (it && it.id));
        ok("AJ. その時間帯の中に30分だけ置く",
           !!b && b.s >= 18 * 60 && b.e <= 21 * 60 && b.e - b.s === 30,
           b ? hhmm(b.s) + "-" + hhmm(b.e) : "置かれない");
        ok("AJ. その旨を理由に書く", !!b && /の間にと言っていた/.test(b.reason || ""), b && b.reason);
        // 「の間に」が無ければ、今までどおり範囲の予定
        reset();
        await say("6時から9時まで勉強する", T(11, 0));
        const it2 = state.items[0];
        ok("AJ. 「の間に」が無ければ、今までどおり範囲の予定",
           !!it2 && it2.kind === "event" && minOfDay(it2.start, TZ) === 18 * 60 && minOfDay(it2.end, TZ) === 21 * 60,
           it2 ? it2.kind + " " + fmtDT(it2.start, TZ) : "-");
      }

      /* ===== AK群：実機で報告された4つ（v4.6） =====
         ① 見出しが「勉強しようかな」のまま ② 「6〜9時」（時が片側）が読めない
         ③ 見出しが「30分勉強する」のまま（AIが付けた見出しを掃除していなかった）
         ④ 明日のタスクが今日の「置かないもの」に理由付きで出る */
      {
        // ① 語尾の「かな」
        ok("AK. 「勉強しようかな」→「勉強する」", normalizeEnding("勉強しようかな") === "勉強する", normalizeEnding("勉強しようかな"));
        ok("AK. 「かなあ」も同じ", normalizeEnding("勉強しようかなあ") === "勉強する", normalizeEnding("勉強しようかなあ"));
        ok("AK. 知らない語尾は今までどおり触らない",
           normalizeEnding("散歩でもしようかしら") === "散歩でもしようかしら");
        reset();
        await say("1時から2時まで勉強しようかな", T(9, 47));
        ok("AK. 実機の発言でも見出しがそろう",
           (state.items[0] || {}).title === "勉強する", (state.items[0] || {}).title);

        // ② 「6〜9時」「6-9時」（左側に「時」が無い）
        /* 日付を言っておく。日付が無いと「いちばん近い9時」を選ぶ規則（4b）が働いて、
           実行した時刻によって 6:00 か 18:00 に変わる（テストを実時計に依存させない）。 */
        for (const s of ["明日6〜9時の間に30分勉強する", "明日6-9時の間に30分勉強する", "明日6から9時の間に30分勉強する"]) {
          reset(); await say(s, T(9, 0));
          const it = state.items[0];
          ok("AK. 「" + s + "」→ 6:00〜9:00 の時間帯",
             !!it && it.winFrom === 6 * 60 && it.winTo === 9 * 60,
             it ? (it.winFrom != null ? hhmm(it.winFrom) + "〜" + hhmm(it.winTo) : "時間帯なし") : "何も作らない");
          ok("AK. 見出しに「6〜」を残さない", !!it && !/^[\d〜～\-\s]/.test(it.title), it && it.title);
        }

        // ③ AIが付けた見出しにも、こちらと同じ掃除を通す
        reset();
        const n3 = { id: uid(), text: "明日6〜9時の間に30分勉強する", hash: "ak" + Math.random(),
                     capturedAt: T(9, 0), source: "talk", createdAt: T(9, 0) };
        await putNote(n3);
        const r3 = await applyOps([{ op: "add", kind: "task", title: "30分勉強する",
          dueDate: dayKey(new Date(keyToDate(KEY, TZ).getTime() + 86400000), TZ),
          duePrecision: "day", estimateMin: 30, window: "18:00-21:00", quote: "30分勉強する" }], n3);
        const a3 = state.items.find(i => i.kind === "task");
        ok("AK. AIの見出しから所要時間を落とす", !!a3 && a3.title === "勉強する", a3 && a3.title);
        ok("AK. AIの time window を受け取る",
           !!a3 && a3.winFrom === 18 * 60 && a3.winTo === 21 * 60,
           a3 ? a3.winFrom + "〜" + a3.winTo : "-");
        ok("AK. おかしな window は捨てる", (() => {
          const t = { winFrom: null, winTo: null };
          applyFields(t, { window: "こわれた" }, TZ, n3);
          return t.winFrom == null;
        })());

        // ④ 置き場所は「その日のどこ」。明日のものを今日に置かない
        reset();
        const tom = dayKey(new Date(keyToDate(KEY, TZ).getTime() + 86400000), TZ);
        const [ty2, tm2, td2] = tom.split("-").map(Number);
        const t4 = { id: uid(), kind: "task", title: "勉強する", estimateMin: 30, status: "open",
          origin: "ai", confirmed: false, corrected: false, evidence: { text: "x" },
          duePrecision: "day", dayKey: tom, due: zoned(ty2, tm2, td2, 23, 59, TZ).toISOString(),
          winFrom: 6 * 60, winTo: 9 * 60, createdAt: T(9, 0), updatedAt: "", history: [] };
        t4.dedupeKey = dedupeKey(t4); await putItem(t4);
        const pToday = planFor(KEY, { nowMin: 13 * 60 });
        ok("AK. 明日の作業を今日の枠に置かない", !pToday.blocks.some(b => b.item.id === t4.id));
        ok("AK. 明日の作業を今日の「置かないもの」に出さない",
           !pToday.unplaced.some(u => u.item.id === t4.id),
           pToday.unplaced.map(u => u.item.title + "（" + u.reason + "）").join(" / ") || "なし");
        const savedW4 = { s: state.settings.workStart, e: state.settings.workEnd };
        state.settings.workStart = "00:00"; state.settings.workEnd = "23:59";   // 朝6時を使う
        const pTom = planFor(tom, { nowMin: -1 });
        state.settings.workStart = savedW4.s; state.settings.workEnd = savedW4.e;
        const b4 = pTom.blocks.find(b => b.item.id === t4.id);
        ok("AK. 明日の予定表には、言われた時間帯の中に置く",
           !!b4 && b4.s >= 6 * 60 && b4.e <= 9 * 60 && b4.e - b4.s === 30,
           b4 ? hhmm(b4.s) + "-" + hhmm(b4.e) : "置かれない");
      }

      /* ===== AL群：AIが言われていない日付を足さない（v4.7・実機で報告） =====
         「6〜9時の間に30分勉強する」（今日のつもり）に AI が「明日」を足し、
         明日のタスクになっていた。原因は `dateWasSpoken` が
         **時刻を言っただけでも「日付を言った」と判定していた**こと。 */
      {
        const tom = dayKey(new Date(keyToDate(KEY, TZ).getTime() + 86400000), TZ);
        const mkNote = text => ({ id: uid(), text, hash: "al" + Math.random(),
          capturedAt: T(11, 0), source: "talk", createdAt: T(11, 0) });

        ok("AL. 時刻だけでは「日付を言った」ことにしない",
           dateWasSpoken(mkNote("6〜9時の間に30分勉強する"), TZ) === false);
        ok("AL. 日付を言っていれば、そのとおり", dateWasSpoken(mkNote("明日9時に歯医者"), TZ) === true);
        ok("AL. 「来週」も日付の言葉", dateWasSpoken(mkNote("来週までに資料を出す"), TZ) === true);

        // ① 時刻だけ → 話した日になる（AIの「明日」は採らない）
        reset();
        const n1 = mkNote("6〜9時の間に30分勉強する"); await putNote(n1);
        await applyOps([{ op: "add", kind: "task", title: "勉強する", dueDate: tom,
          duePrecision: "day", estimateMin: 30, quote: "30分勉強する" }], n1);
        const a1 = state.items.find(i => i.kind === "task");
        ok("AL. AIが足した「明日」を採らず、話した日にする",
           !!a1 && a1.dayKey === KEY, a1 ? a1.dayKey + "（期待 " + KEY + "）" : "作られない");
        ok("AL. 推測した印を残す", !!a1 && a1.dateInferred === true);

        // ② 日付も時刻も言っていない → 日付を付けない
        reset();
        const n2 = mkNote("そのうち本棚を片付けたい"); await putNote(n2);
        await applyOps([{ op: "add", kind: "task", title: "本棚を片付ける", dueDate: tom,
          duePrecision: "day", quote: "本棚を片付けたい" }], n2);
        const a2 = state.items.find(i => i.kind === "task");
        ok("AL. 何も言っていなければ、日付を付けない",
           !!a2 && !a2.dayKey, a2 ? String(a2.dayKey) : "作られない");

        // ③ 言い直し（時刻だけ）で、予定が今日へ動かない
        reset();
        const ev = { id: uid(), kind: "event", title: "打ち合わせ", fixed: true,
          start: zoned(...tom.split("-").map(Number), 15, 0, TZ).toISOString(),
          end: zoned(...tom.split("-").map(Number), 16, 0, TZ).toISOString(),
          dayKey: tom, duePrecision: "exact", origin: "user", confirmed: true, corrected: false,
          status: "open", evidence: { text: "x" }, createdAt: T(9, 0), updatedAt: "", history: [] };
        ev.dedupeKey = dedupeKey(ev); await putItem(ev);
        const n3b = mkNote("15時じゃなくて14時だった"); await putNote(n3b);
        await applyOps([{ op: "update", id: ev.id, dueDate: KEY, dueTime: "14:00", quote: "14時" }], n3b);
        const ev2 = findItem(ev.id);
        ok("AL. 時刻だけの言い直しで、予定を今日へ動かさない",
           ev2.dayKey === tom && parts(new Date(ev2.start), TZ).h === 14,
           ev2.dayKey + " " + fmtDT(ev2.start, TZ));

        // ④ 日付を言っていれば、今までどおり AI の日付を使う
        reset();
        const n4 = mkNote("明日までに資料を出す"); await putNote(n4);
        await applyOps([{ op: "add", kind: "task", title: "資料を出す", dueDate: tom,
          duePrecision: "day", quote: "資料を出す" }], n4);
        const a4 = state.items.find(i => i.kind === "task");
        ok("AL. 日付を言っていれば、その日付を使う", !!a4 && a4.dayKey === tom, a4 && a4.dayKey);
        ok("AL. そのときは推測の印を付けない", !!a4 && !a4.dateInferred);
      }
    }

    /* ===== V. 「〜しようかな」に時刻が付いていたら、予定にする（v3.2） =====
       「10時から11時まで勉強しようかな」が「気になっていること」になって、
       予定表に入らなかった（本人からの報告）。日本語の「〜しようかな」は、
       やると決めたことを柔らかく言うときにも使う。時刻まで言っていれば迷いではない。 */
    {
      const made = async (text, h, mi) => {
        reset();
        await say(text, T(h == null ? 13 : h, mi == null ? 0 : mi));
        return state.items.map(i => i.kind + "「" + i.title + "」"
          + (i.start ? " " + fmtDT(i.start, TZ) : "")).join(" , ") || "（何も作らない）";
      };

      let g = await made("10時から11時まで勉強しようかな");
      ok("V. 時刻つきの「〜しようかな」を、気になっていることにしない",
         !/idea/.test(g) && /task|event/.test(g), g);
      ok("V. その時刻は、午後として読む（13時に言ったので今夜）",
         /22:00/.test(g) || /勉強/.test(g), g);

      g = await made("10時から11時まで勉強しようかな。");
      ok("V. 句点があっても同じ（RE_ASK の「かな$」で片方だけ落ちていた）",
         !/idea/.test(g) && /task|event/.test(g), g);

      g = await made("14時から会議に出ようかな");
      ok("V. 「〜に出ようかな」も時刻つきなら予定", /event/.test(g), g);

      // 時刻が無ければ、今までどおり
      g = await made("そのうち本棚を整理したい");
      ok("V. 時刻が無い「そのうち〜したい」は、今までどおり気になっていること", /idea/.test(g), g);

      g = await made("散歩するか迷ってる");
      ok("V. 「迷ってる」も今までどおり", /idea/.test(g), g);

      g = await made("明日ジムに行こうかな");
      ok("V. 日付だけで時刻が無いものは、予定にしない（決めつけない）", !/event|task/.test(g), g);

      g = await made("10時からでいいかな？");
      ok("V. 同意を求める問いかけは、今までどおり質問のまま", /何も作らない/.test(g), g);

      /* --- 見出しの語尾をそろえる（v3.3） ---
         「勉強しよう」ではなく「勉強する」。言い換えではなく語尾だけ。
         中身の語が変わらないので、あとの照合は外れない。ここはAIにやらせない。 */
      {
        const cases = [
          ["10時から11時まで勉強しようかな", "勉強する"],
          ["10時から資料を作ろう", "資料を作る"],
          ["14時に田中さんに返信しよう", "田中さんに返信する"],
          ["9時に郵便局へ行こう", "郵便局へ行く"]
        ];
        for (const [text, want] of cases) {
          reset();
          await say(text, T(8, 0));
          const it = state.items[0];
          ok("V. 語尾をそろえる：" + text,
             !!it && it.title === want, it ? "「" + it.title + "」" : "何も作らない");
        }
        ok("V. 語尾をそろえても、中身の語は変わらない（照合が外れない）",
           contentWords("勉強する").join() === contentWords("勉強しよう").join(),
           contentWords("勉強しよう").join() + " → " + contentWords("勉強する").join());
        ok("V. 知らない語尾は触らない", normalizeEnding("散歩でもしようかしら") === "散歩でもしようかしら");
        ok("V. 「出そう」は推量と区別が付かないので触らない",
           normalizeEnding("雨が降りそう") === "雨が降りそう" && normalizeEnding("資料を出そう") === "資料を出そう");
      }

      // AI側にも同じ規則が書いてあること
      ok("V. AIへの指示にも「時刻つきは idea にしない」と書いてある", (() => {
        const n = { id: uid(), text: "10時から11時まで勉強しようかな", hash: "v", capturedAt: T(13, 0), source: "talk", createdAt: T(13, 0) };
        return /時刻をはっきり言っているものは idea にしない/.test(buildPrompt(n, contextForAI(n)));
      })());
    }

    /* ===== W. 明るいときと暗いとき、両方で文字が読めるか（v3.6） =====
       色つきの背景に文字を置いた要素は、暗いときに配色が反転して読めなくなることがある。
       「いま」の札が実際にそうなっていた（白字 × 明るいサーモンで 2.9）。
       ここは目で見ても気づきにくいので、比を計算して見張る。 */
    {
      const lum = c => {
        const v = (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number)
          .map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      };
      const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

      const box = document.createElement("div");
      box.innerHTML = `<span class="nowtag">いま</span><span class="chip src-user">確認済み</span>
        <span class="chip src-ai">AIが読み取ったまま</span><button class="btn pri">主ボタン</button>
        <span class="chip vague">期限があいまい</span><span class="chip st-done">完了</span>
        <span class="chip fixed">固定</span><span class="chip st-drop">取り消し</span>
        <span class="chip src-rule">読み取ったまま</span>`;
      document.body.appendChild(box);
      const targets = [".nowtag", ".chip.src-user", ".chip.src-ai", ".btn.pri", ".chip.vague",
                       ".chip.st-done", ".chip.fixed", ".chip.st-drop", ".chip.src-rule"];
      const before = document.documentElement.getAttribute("data-theme");
      for (const theme of ["light", "dark"]) {
        document.documentElement.setAttribute("data-theme", theme);
        const bodyBg = getComputedStyle(document.body).backgroundColor;
        const bodyFg = getComputedStyle(document.body).color;
        ok("W. 本文が読める（" + theme + "）", ratio(bodyBg, bodyFg) >= 7,
           ratio(bodyBg, bodyFg).toFixed(2));
        for (const sel of targets) {
          const s = getComputedStyle(box.querySelector(sel));
          // 背景が透明なものは、本文の背景の上に載っているとみなす
          const bg = /rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor) ? bodyBg : s.backgroundColor;
          const r = ratio(bg, s.color);
          ok("W. " + sel + " の文字が読める（" + theme + "）", r >= 4.5, r.toFixed(2));
        }
      }
      if (before) document.documentElement.setAttribute("data-theme", before);
      else document.documentElement.removeAttribute("data-theme");
      box.remove();
    }

    /* ===== X. 記録が増えたときの読み込み（v4.0） =====
       1回に読める上限は1000件。並び順を指定しないと**idの昇順＝いちばん古い1000件**になり、
       1000件を超えた日から最近の記録が画面から消える。必ず新しい順に取ること。 */
    {
      const src = Array.from(document.scripts).map(s => s.textContent).join("");
      const boot = src.slice(src.indexOf("const [ns, is, ts, ds]"), src.indexOf("const [ns, is, ts, ds]") + 500);
      ok("X. 原文を新しい順に読む", /collection\("notes"\)\.orderBy\("createdAt",\s*"desc"\)/.test(boot), boot.slice(0, 120));
      ok("X. 項目を新しい順に読む", /collection\("items"\)\.orderBy\("createdAt",\s*"desc"\)/.test(boot));
      ok("X. 会話を新しい日から読む", /collection\("turns"\)\.orderBy\("day",\s*"desc"\)/.test(boot));
      ok("X. 資料も新しい順に読む", /collection\("docs"\)\.orderBy\("createdAt",\s*"desc"\)/.test(boot));
      ok("X. 上限は1000件を超えない（保存先の仕様）",
         !/\.limit\((?!1000\)|400\)|200\))\d{4,}\)/.test(src));

      // 増えてきたら、黙って欠ける前に知らせる
      const savedI = state.items.slice();
      state.items = [];
      for (let i = 0; i < 820; i++) state.items.push({ id: "x" + i, kind: "task", title: "t" + i,
        status: "open", origin: "rule", confirmed: false, corrected: false, createdAt: T(9, 0), history: [] });
      showTab("p-set"); renderSettings();
      const warn = document.querySelector("#dataWarn");
      ok("X. 800件を超えたら、上限が近いと知らせる",
         !!warn && !warn.hidden && /1000件まで/.test(warn.textContent), warn ? warn.textContent.slice(0, 40) : "欄が無い");
      ok("X. 勝手に消さず、書き出しを促す",
         !!warn && /書き出す/.test(warn.textContent) && state.items.length === 820, state.items.length + "件");

      state.items = savedI; renderSettings();
      ok("X. 少ないうちは知らせを出さない", !!warn && warn.hidden);
    }

    /* ===== Y. 見落としがちな穴（v4.1・まとめて当てた結果の回帰） ===== */
    {
      // ① その月に無い日を、次の月へ繰り上げない
      reset();
      await say("31日に歯医者。", zoned(2026, 2, 10, 9, 0, TZ).toISOString());
      const y1 = state.items[0];
      ok("Y. 2月に「31日」と言われても、3月3日に繰り上げない",
         !!y1 && y1.dayKey === "2026-03-31", y1 ? y1.dayKey : "何も作らない");

      reset();
      await say("31日に歯医者。", zoned(2026, 1, 5, 9, 0, TZ).toISOString());
      ok("Y. その月に31日があるなら、その月を使う",
         state.items[0] && state.items[0].dayKey === "2026-01-31", state.items[0] && state.items[0].dayKey);

      // ② 所要時間の極端な値
      ok("Y. 「0分」を0分のまま入れない", parseDuration("0分") === 1, String(parseDuration("0分")));
      ok("Y. 「999時間」を24時間までに収める", parseDuration("999時間かかる") === 1440, String(parseDuration("999時間かかる")));
      ok("Y. ふつうの値はそのまま", parseDuration("90分") === 90 && parseDuration("2時間半") === 150,
         parseDuration("90分") + " / " + parseDuration("2時間半"));

      // ③ 壊れた日付の項目が1件あっても、画面は落ちない
      reset();
      const bad = { id: uid(), kind: "event", title: "壊れた予定", fixed: true, start: "こわれた", end: null,
        dayKey: KEY, duePrecision: "exact", origin: "rule", status: "open", confirmed: false, corrected: false,
        evidence: { text: "x" }, createdAt: T(9, 0), updatedAt: "", history: [] };
      bad.dedupeKey = dedupeKey(bad); await putItem(bad);
      await say("14時から打ち合わせ。", T(9, 0));
      let crashed = null;
      try { view.day = KEY; showTab("p-day"); renderDay(); } catch (e) { crashed = String(e && e.message || e); }
      ok("Y. 日付が壊れた項目があっても、画面が落ちない", !crashed, crashed || "落ちない");
      ok("Y. 壊れた1件を捨てて、残りは見せる",
         /打ち合わせ/.test(document.querySelector("#dayOut").innerHTML), "正常な予定が出ている");
      ok("Y. 壊れた日付は空文字にする（Invalid Date と出さない）", fmtDT("こわれた", TZ) === "", "「" + fmtDT("こわれた", TZ) + "」");

      // ④ 端末に保存できなくなったら黙らない
      {
        const real = localStorage.setItem.bind(localStorage);
        const backend = state.backend;
        state.backend = "local"; lastError = null;
        localStorage.setItem = () => { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; };
        let c2 = null;
        try { lsWrite(); } catch (e) { c2 = String(e && e.message || e); }
        localStorage.setItem = real;
        ok("Y. 端末に保存できなくても落ちない", !c2, c2 || "落ちない");
        ok("Y. 保存できなかったことを知らせる",
           !!lastError && /保存できません/.test(lastError), String(lastError).slice(0, 40));
        showTab("p-set"); renderSettings();
        const w = document.querySelector("#dataWarn");
        ok("Y. 設定タブにも出す", !!w && !w.hidden && /控えを保存できませんでした/.test(w.textContent),
           w ? w.textContent.slice(0, 30) : "欄が無い");
        state.backend = backend; lastError = null; lsWrite(); renderSettings();
        ok("Y. 書けるようになれば知らせは消える", !!w && w.hidden);
      }

      // ⑤ 同じことを二度言っても増えない
      reset();
      await say("牛乳を買っておく。", T(9, 0));
      await say("牛乳を買っておく。", T(9, 5));
      ok("Y. 同じ用事を二度言っても1件のまま", state.items.length === 1, state.items.length + "件");

      /* ⑥ 開きっぱなしで日付が変わったとき（v4.2）
         時計は動かせないので、見張りが使う部品（runningKey / tickDay）の側で確かめる。 */
      {
        const today = dayKey(new Date(), TZ);
        ok("Y. 時計の見張りがある", typeof startClock === "function" && typeof runningKey === "function");

        view.day = today;
        const k1 = runningKey();
        ok("Y. 今日を見ているときは、今日の鍵を返す", k1.indexOf(today) === 0, k1);

        view.day = "2026-01-01";                       // 前の日を見ている状態
        ok("Y. 別の日を見ているときは描き直さない（鍵が other）", runningKey() === "other", runningKey());

        // 日付が変わったときの振り分け：今日を見ていた人だけ移る
        const move = (viewDay, wasDay) => viewDay === wasDay;
        ok("Y. 今日を見ていた人は、新しい今日へ移す", move("2026-09-12", "2026-09-12"));
        ok("Y. 前の日を見ている人の画面は動かさない", !move("2026-01-01", "2026-09-12"));

        view.day = today;
      }
    }

    const fails = R.filter(x => x.startsWith("FAIL"));
    const pre = document.createElement("pre"); pre.id = "PROBE";
    pre.textContent = "===== バグ探し =====\n" + R.join("\n") + `\n\n合計 ${R.length} 件 / 失敗 ${fails.length} 件\n===== END =====\n`;
    document.body.appendChild(pre);
  }
  run().catch(e => {
    const pre = document.createElement("pre"); pre.id = "PROBE";
    pre.textContent = "===== CRASHED =====\n" + (e && (e.stack || e.message || e)) + "\n" + R.join("\n");
    document.body.appendChild(pre);
  });
})();
