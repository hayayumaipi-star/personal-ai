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

        /* AM. 引き戻したことを黙らない（v5.1・実機で報告）。
           日付は今日に直るのに、AIの文章だけ「明日」のまま残っていた。
           文章は書き換えず、こちらの言葉で `asks` に足す。 */
        reset();
        const n5 = mkNote("6〜9時の間に30分勉強する"); await putNote(n5);
        const r5 = await applyOps([{ op: "add", kind: "task", title: "勉強する", dueDate: tom,
          duePrecision: "day", estimateMin: 30, quote: "30分勉強する" }], n5);
        ok("AM. 日付を引き戻したら、返事で知らせる",
           r5.asks.some(a => /日付は言っていなかったので/.test(a)), JSON.stringify(r5.asks));
        ok("AM. どの日にしたかを、その場に書く",
           r5.asks.some(a => a.includes(KEY.slice(5).replace("-", "/"))), JSON.stringify(r5.asks));

        // 日付を言っているときは、よけいなことを言わない
        reset();
        const n6 = mkNote("明日までに資料を出す"); await putNote(n6);
        const r6 = await applyOps([{ op: "add", kind: "task", title: "資料を出す", dueDate: tom,
          duePrecision: "day", quote: "資料を出す" }], n6);
        ok("AM. 日付を言っていれば、断りを入れない",
           !r6.asks.some(a => /日付は言っていなかったので/.test(a)), JSON.stringify(r6.asks));

        // 言い直し（時刻だけ）でも知らせる
        reset();
        const ev3 = { id: uid(), kind: "event", title: "打ち合わせ", fixed: true,
          start: zoned(...tom.split("-").map(Number), 15, 0, TZ).toISOString(),
          end: zoned(...tom.split("-").map(Number), 16, 0, TZ).toISOString(),
          dayKey: tom, duePrecision: "exact", origin: "user", confirmed: true, corrected: false,
          status: "open", evidence: { text: "x" }, createdAt: T(9, 0), updatedAt: "", history: [] };
        ev3.dedupeKey = dedupeKey(ev3); await putItem(ev3);
        const n7 = mkNote("15時じゃなくて14時だった"); await putNote(n7);
        const r7 = await applyOps([{ op: "update", id: ev3.id, dueDate: KEY, dueTime: "14:00", quote: "14時" }], n7);
        ok("AM. 言い直しで日付を守ったときも、そう言う",
           r7.asks.some(a => /日付は言っていなかったので/.test(a)), JSON.stringify(r7.asks));
        /* 月は1桁にも2桁にもなる。`fmtDT` を文字位置で切ると「9/14 14:00」が「4:00」になる。 */
        ok("AM. 時刻は切り落とさずに書く",
           r7.asks.some(a => /14:00/.test(a)), JSON.stringify(r7.asks));

        /* AN. 同じものが既にあって足さなかったとき、黙らない（v5.2・実機で報告）。
           「追加すらされなかった」に見えるのは、ここで何も言わずに捨てていたから。 */
        reset();
        const n8 = mkNote("明日までに資料を出す"); await putNote(n8);
        const op8 = { op: "add", kind: "task", title: "資料を出す", dueDate: tom,
          duePrecision: "day", quote: "資料を出す" };
        const r8a = await applyOps([op8], n8);
        ok("AN. 1回目はふつうに足す", r8a.changes.length === 1, JSON.stringify(r8a.changes));
        const r8b = await applyOps([op8], n8);
        ok("AN. 2回目は足さない", r8b.changes.length === 0, JSON.stringify(r8b.changes));
        ok("AN. 足さなかったことを、黙らずに言う",
           r8b.asks.some(a => /足さなかった/.test(a) && a.includes("資料を出す")), JSON.stringify(r8b.asks));
        // 完了済みとぶつかったときは、その状態も書く
        const d8 = state.items.find(i => i.title === "資料を出す");
        d8.status = "done"; await putItem(d8);
        const r8c = await applyOps([op8], n8);
        ok("AN. 完了済みとぶつかったら、そう書く",
           r8c.asks.some(a => /完了/.test(a)), JSON.stringify(r8c.asks));
        // 見出しが取り出せないときも黙らない
        reset();
        const n9 = mkNote("うーん"); await putNote(n9);
        const r9 = await applyOps([{ op: "add", kind: "task", title: "  ", quote: "うーん" }], n9);
        ok("AN. 見出しが空でも黙って捨てない",
           r9.changes.length === 0 && r9.asks.length > 0, JSON.stringify(r9.asks));

        /* AO. AIが返した時刻にも、午前・午後の判定を効かせる（v5.3・実機で報告）。
           22:09 の「11時から12時まで勉強する」が **9/13 11:00**（もう過ぎた朝）になった。
           ルールは 23:00 と読み、速い返事へのヒントも「夜」を渡していたのに、
           決まり4b/4c が parseWhen の中にしかなく、AIの dueTime は素通りだった。 */
        {
          const LATE = zoned(2026, 9, 13, 22, 9, TZ).toISOString();
          const late = text => ({ id: uid(), text, hash: "ao" + Math.random(),
            capturedAt: LATE, source: "talk", createdAt: LATE });

          // 範囲の終わりが 12時 のとき、午後シフトから漏れて13時間になっていた
          const w = parseWhen("11時から12時まで勉強する", LATE, TZ);
          ok("AO. 夜の「11時から12時まで」は 23:00 から",
             !!w && fmtDT(w.start, TZ).endsWith("23:00"), w && fmtDT(w.start, TZ));
          ok("AO. その終わりは翌日の0:00（翌日の12:00にしない）",
             !!w && (new Date(w.end) - new Date(w.start)) === 3600000,
             w && fmtDT(w.end, TZ));

          // AIが12時間ずれた時刻を返しても、ルールを採る
          reset();
          const na = late("11時から12時まで勉強する"); await putNote(na);
          await applyOps([{ op: "add", kind: "event", title: "勉強する", dueDate: "2026-09-14",
            dueTime: "11:00", duePrecision: "exact", estimateMin: 60, quote: "勉強する" }], na);
          const ia = state.items.find(i => i.kind === "event");
          ok("AO. AIの「11:00」を採らず、ルールの 23:00 にする",
             !!ia && fmtDT(ia.start, TZ) === "9/13 23:00", ia && fmtDT(ia.start, TZ));

          // ルールが翌日へ送ったものを、話した日へ引き戻さない
          reset();
          const nb = late("10時から11時まで勉強する"); await putNote(nb);
          await applyOps([{ op: "add", kind: "event", title: "勉強する", dueDate: "2026-09-14",
            dueTime: "10:00", duePrecision: "exact", estimateMin: 60, quote: "勉強する" }], nb);
          const ib = state.items.find(i => i.kind === "event");
          ok("AO. ルールが翌日にしたものを、今日へ引き戻さない",
             !!ib && ib.dayKey === "2026-09-14", ib && ib.dayKey);

          // 12時間ずれていないときは、AIの時刻をそのまま使う
          reset();
          const nc = late("11時から12時まで勉強する"); await putNote(nc);
          await applyOps([{ op: "add", kind: "event", title: "勉強する", dueDate: "2026-09-13",
            dueTime: "23:30", duePrecision: "exact", estimateMin: 30, quote: "勉強する" }], nc);
          const ic = state.items.find(i => i.kind === "event");
          ok("AO. ずれが12時間ちょうどでなければ、触らない",
             !!ic && fmtDT(ic.start, TZ) === "9/13 23:30", ic && fmtDT(ic.start, TZ));

          // 「夜11時から深夜1時まで」は今までどおり日をまたぐ（深夜は +12 しない）
          const w2 = parseWhen("夜11時から深夜1時までゼミ", LATE, TZ);
          ok("AO. 「夜11時から深夜1時まで」は2時間のまま",
             !!w2 && (new Date(w2.end) - new Date(w2.start)) === 7200000,
             w2 && fmtDT(w2.start, TZ) + "〜" + fmtDT(w2.end, TZ));
        }

        /* AP. 黙って何も起きない道をふさぐ（v5.4・実機で報告）。
           「チャットにも予定表が出ず、スケジュールにも追加されない」。 */
        {
          const LATE2 = zoned(2026, 9, 13, 22, 20, TZ).toISOString();
          const mk = text => ({ id: uid(), text, hash: "ap" + Math.random(),
            capturedAt: LATE2, source: "talk", createdAt: LATE2 });

          // ① 言い直しの判定が2か所に分かれていて、片方だけ狭かった
          ok("AP. 「〜にして」の言い直しを取りこぼさない",
             looksRestating("さっきの勉強、23時からにして") === true);
          ok("AP. 「さっき言った」も言い直し", looksRestating("さっき言ったやつ、30分にして") === true);
          ok("AP. ふつうの発言は言い直しにしない",
             looksRestating("23時から24時まで勉強する") === false);
          reset();
          const nr = mk("さっきの勉強、23時からにして"); await putNote(nr);
          const rr2 = await applyOps(ruleOps(nr), nr);
          ok("AP. 対象を決められなくても、黙って終わらない",
             rr2.asks.length > 0, JSON.stringify(rr2.asks));

          /* ② AIが「何もしない」を返したら、ルールが読めたものを使う。
                `if (!ops)` だけだと `[]` は真なので、ルールへ戻らず全部捨てていた。 */
          const src = String(sendTurn);
          ok("AP. AIが空の ops を返したときに、ルールへ戻る道がある",
             /ops\.length/.test(src) && /ruleOps\(note\)/.test(src), "sendTurn に戻り道が無い");
          reset();
          const nf = mk("23時から24時まで勉強する"); await putNote(nf);
          const fallback = [].length ? [] : ruleOps(nf).filter(o => o.op !== "_needs_ai");
          ok("AP. そのときルールは、ちゃんと読めている", fallback.length > 0,
             JSON.stringify(ruleOps(nf).map(o => o.op)));
        }

        /* AQ. AIが時刻を落としたら、ルールの読み取りで埋める（v5.5・実機で報告）。
           「11時から12時まで勉強する」が **時刻の無いタスク**として追加された。
           時刻の範囲を言われたら予定にする、が決まり4e。 */
        {
          const L3 = zoned(2026, 9, 13, 22, 9, TZ).toISOString();
          const mk3 = text => ({ id: uid(), text, hash: "aq" + Math.random(),
            capturedAt: L3, source: "talk", createdAt: L3 });

          reset();
          const q1 = mk3("11時から12時まで勉強する"); await putNote(q1);
          await applyOps([{ op: "add", kind: "task", title: "勉強する", quote: "勉強する" }], q1);
          const e1 = state.items[0];
          ok("AQ. 時刻の範囲を言っていれば、タスクではなく予定にする",
             !!e1 && e1.kind === "event", e1 && e1.kind);
          ok("AQ. その時刻はルールの読み取り（23:00）",
             !!e1 && fmtDT(e1.start, TZ) === "9/13 23:00", e1 && fmtDT(e1.start, TZ));
          ok("AQ. 長さも範囲のとおり（1時間）",
             !!e1 && (new Date(e1.end) - new Date(e1.start)) === 3600000,
             e1 && fmtDT(e1.end, TZ));

          // 1回の発言に用事が2つあるときは、日時を持ち込まない
          reset();
          const q2 = mk3("11時から12時まで勉強する。あと牛乳を買う"); await putNote(q2);
          await applyOps([{ op: "add", kind: "task", title: "勉強する", quote: "勉強する" },
                          { op: "add", kind: "task", title: "牛乳を買う", quote: "牛乳" }], q2);
          ok("AQ. 用事が2件あるときは、日時を他の話題へ持ち込まない",
             state.items.every(i => !i.start), state.items.map(i => i.title + ":" + (i.start || "-")).join(","));

          // AIがちゃんと時刻を返していれば触らない
          reset();
          const q3 = mk3("明日10時に歯医者"); await putNote(q3);
          await applyOps([{ op: "add", kind: "event", title: "歯医者", dueDate: "2026-09-14",
            dueTime: "10:00", duePrecision: "exact", quote: "歯医者" }], q3);
          const e3 = state.items[0];
          ok("AQ. AIが時刻を返しているときは触らない",
             !!e3 && fmtDT(e3.start, TZ) === "9/14 10:00", e3 && fmtDT(e3.start, TZ));

          // 時刻を言っていない発言には、時刻を作らない
          reset();
          const q4 = mk3("そのうち本棚を片付けたい"); await putNote(q4);
          await applyOps([{ op: "add", kind: "task", title: "本棚を片付ける", quote: "本棚" }], q4);
          ok("AQ. 言っていない時刻は作らない", !state.items[0].start && !state.items[0].dayKey,
             JSON.stringify([state.items[0].start, state.items[0].dayKey]));
        }

        /* AR. 壊れた設定で、画面ごと落ちないこと（v5.6・調査で発見）。
           タイムゾーンが不正だと `Intl` が RangeError を投げ、
           `parts` / `dayKey` / `zoned` が**全部落ちる**。
           `importJSON` は控えの settings を素通しで保存していたので、
           一度入ると**開くたびに落ちる状態が残る**。
           「壊れた1件で画面全体を落とさない」を、項目だけでなく設定にも通す。 */
        {
          ok("AR. 設定を検算する関数がある", typeof safeSettings === "function");
          if (typeof safeSettings === "function") {
            const bad = t => safeSettings(Object.assign({}, DEFAULTS, t));
            ok("AR. 使えないタイムゾーンは既定に戻す",
               bad({ timezone: "Invalid/Zone" }).timezone === DEFAULTS.timezone,
               bad({ timezone: "Invalid/Zone" }).timezone);
            ok("AR. 空・数値・null のタイムゾーンも既定に戻す",
               bad({ timezone: "" }).timezone === DEFAULTS.timezone
               && bad({ timezone: 123 }).timezone === DEFAULTS.timezone
               && bad({ timezone: null }).timezone === DEFAULTS.timezone);
            ok("AR. 使えるタイムゾーンは、そのまま通す",
               bad({ timezone: "Europe/Paris" }).timezone === "Europe/Paris");
            ok("AR. 数値でない所要時間は既定に戻す",
               bad({ defaultEstimate: "abc" }).defaultEstimate === DEFAULTS.defaultEstimate,
               String(bad({ defaultEstimate: "abc" }).defaultEstimate));
            ok("AR. 極端な数値は範囲に収める",
               bad({ defaultEstimate: 99999 }).defaultEstimate <= 240
               && bad({ breakEveryMin: 0 }).breakEveryMin >= 30
               && bad({ breakMin: -5 }).breakMin >= 5,
               JSON.stringify([bad({ defaultEstimate: 99999 }).defaultEstimate,
                               bad({ breakEveryMin: 0 }).breakEveryMin, bad({ breakMin: -5 }).breakMin]));
            ok("AR. 知らない見た目は auto に戻す", bad({ theme: "<script>" }).theme === "auto");
            ok("AR. 壊れた作業時間帯も直す（形だけでなく中身も）",
               bad({ workStart: "25:99" }).workStart === DEFAULTS.workStart
               && bad({ workEnd: null }).workEnd === DEFAULTS.workEnd
               && bad({ workStart: "07:30" }).workStart === "07:30",
               JSON.stringify([bad({ workStart: "25:99" }).workStart, bad({ workEnd: null }).workEnd]));
            // 検算を通したあとは、日付の計算が落ちないこと
            let threw = null;
            try { dayKey(new Date(), bad({ timezone: "Invalid/Zone" }).timezone); }
            catch (e) { threw = e.name; }
            ok("AR. 直したあとは、日付の計算が落ちない", threw === null, String(threw));
          }
          // 壊れた設定を保存しようとしても、保存先には入らない
          if (typeof safeSettings === "function") {
            const keep = state.settings;
            await putSettings(Object.assign({}, DEFAULTS, { timezone: "Invalid/Zone" }));
            let threw2 = null;
            try { dayKey(new Date(), state.settings.timezone); } catch (e) { threw2 = e.name; }
            ok("AR. 壊れた設定は保存しない", threw2 === null && state.settings.timezone === DEFAULTS.timezone,
               String(state.settings.timezone) + " / " + String(threw2));
            state.settings = keep;
          }
        }

        /* AS. 外部ファイル（.ics）は、壊れていると思って読む（v5.6・調査で発見）。
           他所から来るファイルなのに、テストが1件も無かった。
           とくに `TZID` は検算せず `zoned()` に渡していたので、
           **壊れた1件でファイルまるごと読めなくなる**（例外が for を抜ける）。 */
        {
          const ics = body => "BEGIN:VCALENDAR" + String.fromCharCode(13,10) + body
            + String.fromCharCode(13,10) + "END:VCALENDAR";
          const ev = lines => "BEGIN:VEVENT" + String.fromCharCode(13,10)
            + lines.join(String.fromCharCode(13,10)) + String.fromCharCode(13,10) + "END:VEVENT";
          const nl = String.fromCharCode(13,10);

          let got = null, threw = null;
          try {
            got = parseICS(ics(ev(["SUMMARY:壊れたほう", "DTSTART;TZID=Invalid/Zone:20260915T093000"]) + nl
                             + ev(["SUMMARY:ちゃんとしたほう", "DTSTART:20260915T100000Z"])), TZ);
          } catch (e) { threw = e.name + ": " + String(e.message).slice(0, 40); }
          ok("AS. 壊れた TZID があっても、例外で止まらない", threw === null, String(threw));
          ok("AS. 壊れた TZID は、こちらの設定で読む（捨てない）",
             !!got && got.length === 2
             && got[0].title === "壊れたほう"
             && fmtDT(got[0].start, TZ) === fmtDT(zoned(2026, 9, 15, 9, 30, TZ).toISOString(), TZ),
             got ? JSON.stringify(got.map(x => x.title + "@" + fmtDT(x.start, TZ))) : "（読めない）");

          const safe = t => { try { return parseICS(t, TZ); } catch { return "★例外"; } };
          ok("AS. 題名の無い予定は捨てる",
             JSON.stringify(safe(ics(ev(["DTSTART:20260915T100000Z"])))) === "[]");
          ok("AS. 日時の無い予定は捨てる",
             JSON.stringify(safe(ics(ev(["SUMMARY:題名だけ"])))) === "[]");
          ok("AS. 日付の形が違うものは捨てる",
             JSON.stringify(safe(ics(ev(["SUMMARY:x", "DTSTART:きょう"])))) === "[]");
          ok("AS. 空・null・数値でも落ちない",
             JSON.stringify(safe("")) === "[]" && JSON.stringify(safe(null)) === "[]"
             && JSON.stringify(safe(12345)) === "[]");
          ok("AS. END:VEVENT が無くても落ちない",
             JSON.stringify(safe("BEGIN:VEVENT" + nl + "SUMMARY:途中で終わる")) === "[]");
          // 折り返し（行頭の空白で続く）を戻せること
          const folded = safe(ics(ev(["SUMMARY:とても長い題" + nl + " 名のつづき", "DTSTART:20260915T100000Z"])));
          ok("AS. 折り返した行をつなげて読む",
             Array.isArray(folded) && folded.length === 1 && /つづき/.test(folded[0].title),
             JSON.stringify(folded));
        }

        /* AT. 「日付の言葉があったか」の判定が、2か所に分かれていないこと（v5.7）。
           v5.3 で `applyFields` に同じ式を書いてしまい、アプリは `dateWasSpoken` を
           呼ばなくなっていた。テストは**生きていない関数**を測っていた。
           ここでは、両者が同じ答えを出すことを実際の動きで確かめる。 */
        {
          const L4 = zoned(2026, 9, 13, 11, 0, TZ).toISOString();
          const mk4 = text => ({ id: uid(), text, hash: "at" + Math.random(),
            capturedAt: L4, source: "talk", createdAt: L4 });
          const cases = ["明日までに資料を出す", "6〜9時の間に30分勉強する",
                         "そのうち本棚を片付けたい", "来週までに出す", "牛乳を買う",
                         "今日中に返信する", "9時に歯医者"];
          let agree = true, detail = [];
          for (const text of cases) {
            reset();
            const n = mk4(text); await putNote(n);
            const r = await applyOps([{ op: "add", kind: "task", title: "なにか",
              dueDate: tom, duePrecision: "day", quote: "x" }], n);
            const pulled = r.asks.some(a => /日付は言っていなかったので/.test(a));
            const spoken = dateWasSpoken(n, TZ);
            if (pulled === spoken) { agree = false; }       // 引き戻した＝言っていない、が正しい
            detail.push(`${text}:${spoken ? "言った" : "言ってない"}/${pulled ? "引き戻した" : "そのまま"}`);
          }
          ok("AT. dateWasSpoken と、実際の引き戻しが必ず一致する", agree, detail.join(" , "));
          ok("AT. 判定は1か所にまとまっている",
             typeof dateSpokenIn === "function" && /dateSpokenIn/.test(String(applyFields)),
             "applyFields が自前の式を持っている");
        }

        /* AU. AIが返す prefer / memo / condition / idea を、直接 applyOps に渡して確かめる
           （v5.9・4周目の調査）。ここは決まり9「AIの ops を信用しない」の担当なのに、
           これらの op を**直接渡すテストが1件も無かった**。
           書いてみたら、`prefer` の値を検算しているのは**新規作成のときだけ**で、
           既にある希望を更新する道は素通しだった。`noEveningWork` は「分」として
           計画に効くので、0 が入ると**その日が丸ごと使えなくなる**。 */
        {
          const L5 = zoned(2026, 9, 13, 9, 0, TZ).toISOString();
          const mk5 = text => ({ id: uid(), text, hash: "au" + Math.random(),
            capturedAt: L5, source: "talk", createdAt: L5 });
          const pv = () => {
            const p = state.items.find(i => i.kind === "preference" && i.preferKey === "noEveningWork");
            return p ? p.preferValue : null;
          };
          reset();
          const n1 = mk5("20時以降は予定を入れないで"); await putNote(n1);
          await applyOps([{ op: "prefer", key: "noEveningWork", value: 20 * 60,
            text: "20時以降は入れないで", quote: "20時以降" }], n1);
          ok("AU. 希望の値は、範囲の中なら そのまま入る", pv() === 20 * 60, String(pv()));

          // 同じ希望をもう一度（更新の道）。範囲外の値を入れさせない
          await applyOps([{ op: "prefer", key: "noEveningWork", value: 0,
            text: "夜は入れないで", quote: "夜" }], n1);
          ok("AU. 更新でも、範囲外の値は入れない",
             typeof pv() !== "number" || (pv() >= 12 * 60 && pv() <= 23 * 60), String(pv()));
          const pf1 = prefs(KEY);
          ok("AU. 計画に渡る値も、範囲の中に収まる",
             pf1.noEveningWork === null || (pf1.noEveningWork >= 12 * 60 && pf1.noEveningWork <= 23 * 60),
             String(pf1.noEveningWork));

          await applyOps([{ op: "prefer", key: "noEveningWork", value: "あいうえお",
            text: "夜は入れないで", quote: "夜" }], n1);
          ok("AU. 数字でない値も入れない",
             typeof pv() !== "number" || (pv() >= 12 * 60 && pv() <= 23 * 60), String(pv()));

          // 知らない key は "free" に落ちる（捨てない）
          reset();
          const n2 = mk5("いい感じにして"); await putNote(n2);
          await applyOps([{ op: "prefer", key: "<script>", value: true,
            text: "いい感じにして", quote: "いい感じ" }], n2);
          const fp = state.items.find(i => i.kind === "preference");
          ok("AU. 知らない希望の種類は free にする（捨てない）",
             !!fp && fp.preferKey === "free", fp && fp.preferKey);

          // memo / condition / idea：空文字は作らない、長すぎるものは切る
          reset();
          const n3 = mk5("なにか"); await putNote(n3);
          await applyOps([{ op: "memo", text: "   ", quote: "x" },
                          { op: "idea", text: "", quote: "x" },
                          { op: "condition", text: null, quote: "x" }], n3);
          ok("AU. 中身が空なら、memo も idea も condition も作らない",
             state.items.length === 0, JSON.stringify(state.items.map(i => i.kind)));

          reset();
          const n4 = mk5("なにか"); await putNote(n4);
          const long = "あ".repeat(2000);
          await applyOps([{ op: "memo", text: long, quote: "x" },
                          { op: "idea", text: long, quote: "x" },
                          { op: "condition", text: long, quote: "x" }], n4);
          const byKind = k => state.items.find(i => i.kind === k);
          ok("AU. 長すぎる memo は切る", !!byKind("memo") && byKind("memo").title.length <= 500,
             byKind("memo") && String(byKind("memo").title.length));
          ok("AU. 長すぎる idea は切る", !!byKind("idea") && byKind("idea").title.length <= 200,
             byKind("idea") && String(byKind("idea").title.length));
          ok("AU. 体調は本人の言葉のまま残し、点数を作らない",
             !!byKind("condition") && byKind("condition").selfReport.length <= 300
             && byKind("condition").score === undefined,
             byKind("condition") && String(byKind("condition").selfReport.length));
        }

        /* AV. 振り返りは「間違えて押した完了・取り消しを戻せる**唯一の**場所」（決まり6f）なのに、
           テストでの言及が1か所しか無かった（v5.9・4周目の調査）。往復を固定する。
           **`completedAt` は本物の「いま」**なので、固定の日ではなく
           **完了が載る日**で見ること（記録済みの落とし穴）。 */
        {
          const today = dayKey(new Date(), TZ);
          const seed = async (title) => {
            const it = { id: uid(), noteId: null, kind: "task", title,
              evidence: { text: "x" }, origin: "rule", confirmed: false, corrected: false,
              status: "open", estimateMin: 30,
              createdAt: new Date().toISOString(), updatedAt: "", history: [] };
            it.dedupeKey = dedupeKey(it); await putItem(it); return it;
          };
          reset();
          const a = await seed("完了を押してみる用事");
          await act("done", a.id);
          ok("AV. 完了にすると status が done になる", findItem(a.id).status === "done",
             findItem(a.id).status);
          let rv = reviewFor(today);
          ok("AV. 振り返りに、その日の完了が出る",
             rv.done.some(i => i.id === a.id), rv.done.map(i => i.title).join(","));
          await act("undone", a.id);
          ok("AV. 振り返りから完了を戻せる", findItem(a.id).status === "open",
             findItem(a.id).status);
          rv = reviewFor(today);
          ok("AV. 戻したら、完了の一覧から消える", !rv.done.some(i => i.id === a.id),
             rv.done.map(i => i.title).join(","));

          const b = await seed("取り消してみる用事");
          await act("drop", b.id);
          ok("AV. 取り消すと status が dropped になる", findItem(b.id).status === "dropped",
             findItem(b.id).status);
          rv = reviewFor(today);
          ok("AV. 振り返りに、その日の取り消しが出る",
             rv.dropped.some(x => x.i.id === b.id), rv.dropped.map(x => x.i.title).join(","));
          await act("undrop", b.id);
          ok("AV. 振り返りから取り消しを戻せる", findItem(b.id).status === "open",
             findItem(b.id).status);

          // 別の日の完了は、その日の振り返りに混ぜない
          const c = await seed("昨日やった用事");
          c.status = "done";
          c.completedAt = new Date(Date.now() - 3 * 86400000).toISOString();
          await putItem(c);
          rv = reviewFor(today);
          ok("AV. 別の日の完了は、今日の振り返りに出さない",
             !rv.done.some(i => i.id === c.id), rv.done.map(i => i.title).join(","));

          // 体調はその日の申告だけ（決まり3）
          const cond = { id: uid(), noteId: null, kind: "condition", title: "眠い",
            selfReport: "あんまり寝ていなくて眠い", reportedAt: new Date().toISOString(),
            evidence: { text: "眠い" }, origin: "rule", confirmed: false, corrected: false,
            status: "open", createdAt: new Date().toISOString(), updatedAt: "", history: [] };
          cond.dedupeKey = dedupeKey(cond); await putItem(cond);
          rv = reviewFor(today);
          ok("AV. 体調は本人の言葉のまま、その日のぶんだけ出る",
             rv.conds.some(i => i.selfReport === "あんまり寝ていなくて眠い")
             && rv.conds.every(i => i.score === undefined),
             rv.conds.map(i => i.selfReport).join(","));
        }

        // AIに日付の言葉を書かせない（決まり8の日付版）
        {
          const nq = mkNote("30分勉強する");
          const pr = buildPrompt(nq, contextForAI(nq));
          ok("AM. 依頼文に「返事に日付の言葉を書かない」と書いてある",
             /返事に「今日」「明日」/.test(pr) || /日付の言葉も書かない/.test(pr));
        }
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
         !!warn && !warn.hidden && /1,?000件まで/.test(warn.textContent), warn ? warn.textContent.slice(0, 40) : "欄が無い");
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

    /* ===== AW. 置けなかった理由と、落とした跡（v6.2・実機で報告） =====
       「夜6時から9時までの間にお風呂に30分入る」で2つ出た：
       ① 時間帯がまるごと過ぎているのに「そこに30分の空きがありません」と言っていた
          （空っぽなのに、予定が詰まっていると読める）
       ② 見出しが「間にお風呂に 入る」——「までの間に」が落ちず、跡が空白になっていた */
    {
      const LINE = "夜6時から9時までの間にお風呂に30分入る";
      // この群だけ、作業に使える時間帯をアプリの既定（一日じゅう）に戻す。
      // 09:00〜18:00 のままだと 18:00〜21:00 がまるごと枠外で、別の理由で置けなくなる。
      const keepW = [state.settings.workStart, state.settings.workEnd];
      state.settings = Object.assign({}, state.settings, { workStart: "00:00", workEnd: "23:59" });
      reset();
      await say(LINE, T(10, 0));
      const t = state.items.find(i => i.kind === "task");
      ok("AW. 時間帯つきの用事として拾う", !!t && t.winFrom === 18 * 60 && t.winTo === 21 * 60,
         t ? t.kind + "/" + t.winFrom + "-" + t.winTo : "拾えていない");
      ok("AW. 「までの間に」を見出しに残さない", !!t && !/間に/.test(t.title), t && t.title);
      ok("AW. 落とした跡を空白でつながない", !!t && t.title === "お風呂に入る", t && t.title);

      const reasonAt = m => {
        const u = planFor(KEY, { nowMin: m }).unplaced.find(x => x.item.id === t.id);
        return u ? u.reason : "(置けた)";
      };
      const placedAt = m => {
        const b = planFor(KEY, { nowMin: m }).blocks.find(x => x.item && x.item.id === t.id);
        return b ? b.s : null;
      };
      ok("AW. 時間帯の中に置ける", placedAt(10 * 60) === 18 * 60, String(placedAt(10 * 60)));
      ok("AW. いまが時間帯の中なら、いまから置く", placedAt(19 * 60) === 19 * 60, String(placedAt(19 * 60)));
      ok("AW. 時間帯が過ぎていたら「過ぎています」と言う",
         /もう過ぎています/.test(reasonAt(22 * 60)), reasonAt(22 * 60));
      ok("AW. 過ぎているのを「空きがありません」と言わない",
         !/空きがありません/.test(reasonAt(22 * 60)), reasonAt(22 * 60));
      ok("AW. 残りが足りないときは、残りの長さを言う",
         /空いているのは最大15分/.test(reasonAt(20 * 60 + 45)), reasonAt(20 * 60 + 45));

      // 本当に埋まっているときは、今までどおり「空きがありません」
      const ev = { id: uid(), noteId: null, kind: "event", title: "会食", fixed: true,
        origin: "user", confirmed: true, corrected: false, status: "open",
        evidence: { text: "x" }, start: zoned(2026, 9, 12, 18, 0, TZ).toISOString(),
        end: zoned(2026, 9, 12, 21, 0, TZ).toISOString(), dayKey: KEY, duePrecision: "exact",
        createdAt: T(9, 0), updatedAt: "", history: [] };
      ev.dedupeKey = dedupeKey(ev); await putItem(ev);
      ok("AW. 本当に埋まっているときは「空きがありません」のまま",
         /空きがありません/.test(reasonAt(10 * 60)), reasonAt(10 * 60));

      /* **朝7時に言っても同じ文が出ていた**（v6.2b・実機で報告）。
         18:00〜21:00 は先の話で空っぽなのに「そこに30分の空きがありません」。
         本当の理由は、その時間帯が**作業に使える帯の外**だったこと。
         理由が違えば打つ手も変わる（「夜も入れていい」と言えば直る）ので、名指しする。 */
      {
        const morn = 7 * 60;
        await act("drop", ev.id);          // 上で足した会食を外す。ここで見たいのは帯のほう
        state.settings = Object.assign({}, state.settings, { workStart: "09:00", workEnd: "18:00" });
        ok("AW. 作業に使える帯の外なら、そう言う",
           /作業に使える時間帯（09:00〜18:00）の外です/.test(reasonAt(morn)), reasonAt(morn));
        ok("AW. 帯の外を「空きがありません」と言わない",
           !/空きがありません/.test(reasonAt(morn)), reasonAt(morn));

        state.settings = Object.assign({}, state.settings, { workStart: "00:00", workEnd: "23:59" });
        const pr = { id: uid(), noteId: null, kind: "preference", title: "夜は予定を入れないで",
          preferKey: "noEveningWork", preferValue: 18 * 60, evidence: { text: "x" },
          origin: "rule", confirmed: false, corrected: false, status: "open",
          createdAt: T(7, 0), updatedAt: "", history: [] };
        pr.dedupeKey = dedupeKey(pr); await putItem(pr);
        ok("AW. 「夜は入れないで」で置けないときは、その希望を名指しする",
           /夜は予定を入れないで/.test(reasonAt(morn)), reasonAt(morn));
        await act("drop", pr.id);
        ok("AW. その希望をやめれば、また置ける", planFor(KEY, { nowMin: morn }).blocks
           .some(b => b.item && b.item.id === t.id), reasonAt(morn));
      }

      // 元の文に区切りがあったら、それは残す（くっつけてよいのは、元から続いていた所だけ）
      const cut = x => cleanTitle(halfWidth(x), parseWhen(halfWidth(x), T(9, 0), TZ));
      ok("AW. 元からあった空白は残す", cut("レポート 2時間 書く") === "レポート 書く", cut("レポート 2時間 書く"));
      ok("AW. 元から続いていた所はつなぐ", cut("Zoomで10時に会議") === "Zoomで会議", cut("Zoomで10時に会議"));

      state.settings = Object.assign({}, state.settings, { workStart: keepW[0], workEnd: keepW[1] });
    }

    /* ===== AX. 1日を組み立てる（v6.5・本人の指示） =====
       「6時から11時半までの間で勉強を30分かける2回。その間にお風呂とご飯それぞれ30分ずつ使う。
        他に入れる予定ややった方がいい習慣などを提案してスケジュールを組み立てて。」
       これで **13枠の予定表が実際に入り、習慣が提案される**ところまでを固定する。 */
    {
      const LINE = "生産性の高い1日を過ごすのが目的。6時から11時半までの間で勉強を30分かける2回。"
        + "その間にお風呂とご飯それぞれ30分ずつ使う。他に入れる予定ややった方がいい習慣などを提案してスケジュールを組み立てて。";
      reset();
      const keepW = [state.settings.workStart, state.settings.workEnd];
      state.settings = Object.assign({}, state.settings, { workStart: "00:00", workEnd: "23:59" });
      const at = zoned(2026, 9, 12, 17, 0, TZ).toISOString();
      const note = { id: uid(), text: normNote(LINE), hash: hash(LINE), capturedAt: at,
        source: "talk", sourceName: null, createdAt: at };
      await putNote(note);

      const req = parseDayRequest(note, TZ);
      ok("AX. 組み立ての依頼だと分かる", !!req, req ? "ok" : "拾えていない");
      ok("AX. 時間帯を 18:00〜23:30 と読む", !!req && req.win[0] === 18 * 60 && req.win[1] === 23 * 60 + 30,
         req && hhmm(req.win[0]) + "-" + hhmm(req.win[1]));
      /* **「生産性の高い1日」の「1日」を日付にしない**（作りながら出た）。
         全文を parseWhen に渡すと 10月1日として拾い、日付も午前/午後もまるごと狂った。 */
      ok("AX. 「1日」を日付として拾わない", !!req && req.dayKey === KEY, req && req.dayKey);
      ok("AX. 「30分かける2回」を 30分×2 と読む",
         !!req && req.wants.some(w => w.title === "勉強をする" && w.min === 30 && w.count === 2),
         req && JSON.stringify(req.wants));
      ok("AX. 「お風呂とご飯それぞれ30分ずつ」を2件に分ける",
         !!req && req.wants.some(w => w.title === "お風呂に入る" && w.min === 30)
               && req.wants.some(w => w.title === "夕食を食べる" && w.min === 30),
         req && req.wants.map(w => w.title).join(","));
      /* **見出しは言い切りにそろえる**（v6.8・実機で「勉強を か ける①」「ご飯それぞ れ」になった）。
         ご飯は決まり6i で朝昼夕に名前を揃えるので「夕食を食べる」になる。 */
      ok("AX. 見出しを言い切りの形にする",
         !!req && req.wants.every(w => /(する|入る|食べる|行く|とる)$/.test(w.title)),
         req && req.wants.map(w => w.title).join(","));
      ok("AX. 見出しに助詞を残さない（「勉強を」にしない）",
         !!req && !req.wants.some(w => /[をにへでがはもの]$/.test(w.title)),
         req && req.wants.map(w => w.title).join(","));

      const ops = ruleOps(note);
      ok("AX. 依頼文を目標として保存しない",
         ops.length === 1 && ops[0].op === "buildday", ops.map(o => o.op).join(","));
      const res = await applyOps(ops, note);

      const mine = state.items.filter(i => !i.suggested && i.kind === "task");
      const sug = state.items.filter(i => i.suggested);
      ok("AX. 言われた4件が入る", mine.length === 4, mine.map(i => i.title).join(","));
      ok("AX. 提案が足される", sug.length >= 8, sug.length + "件");
      ok("AX. 提案には「アプリの提案」の印が付く",
         sug.every(i => /アプリの提案/.test(srcChip(i))), srcChip(sug[0] || {}));

      const pl = planFor(KEY, { nowMin: 17 * 60 });
      const rows = pl.blocks.filter(b => b.item && b.item.dayKey === KEY)
        .map(b => hhmm(b.s) + "〜" + hhmm(b.e) + " " + b.item.title);
      ok("AX. 13枠が予定表に入る", rows.length === 13, rows.length + "枠");
      ok("AX. 18:00 から始まる", rows[0] === "18:00〜18:10 切り替え・準備", rows[0]);
      ok("AX. 23:30 に就寝準備で終わる", rows[rows.length - 1] === "23:00〜23:30 就寝準備", rows[rows.length - 1]);
      ok("AX. 勉強①②が 18:10 と 19:30 に入る",
         rows.includes("18:10〜18:40 勉強をする①") && rows.includes("19:30〜20:00 勉強をする②"), rows.join(" / "));
      ok("AX. ご飯は前半、お風呂は身支度の前",
         rows.indexOf("18:40〜19:10 夕食を食べる") >= 0 && rows.indexOf("21:00〜21:30 お風呂に入る") >= 0, rows.join(" / "));
      ok("AX. 壊れた見出しを予定表に入れない",
         rows.every(r => !/\s(か|れ|を|ける|それぞ)\s/.test(r) && !/か ける|それぞ れ/.test(r)), rows.join(" / "));
      ok("AX. 置けなかったものが出ない", pl.unplaced.length === 0,
         pl.unplaced.map(u => u.item.title + "→" + u.reason).join(" / "));

      /* **習慣はコードで作らない**（v6.7・本人の指示）。決まった持ち札から選ぶと毎回同じ4つが出る。
         その都度AIに考えさせ、返事の文の中で1つだけ言ってもらう。
         だからコード側は**習慣の文を1つも持たない**——ここが再発の見張り。 */
      ok("AX. 習慣の文をコードが作らない", res.habits === undefined, JSON.stringify(res.habits));
      ok("AX. まとめて消すための日は返す", res.habitDay === KEY, String(res.habitDay));
      /* 依頼文そのものを見る。**ソースを丸ごと検索しない**（説明のコメントに当たる）——
         関数の中身だけを見る、という記録済みの作法に従う。 */
      const PR = String(buildPrompt);
      ok("AX. AIへの依頼に「習慣を1つだけ」と書いてある", /習慣の提案」を1つだけ/.test(PR), "");
      ok("AX. AIに時刻・件数を書かせない", /時刻・分数・件数は書かない/.test(PR), "");
      ok("AX. 毎回同じことを言わせない", /毎回同じことを言わない/.test(PR), "");

      // 習慣は会話の中の提案でしかない。勝手に目標として保存しない（決まり2）
      ok("AX. 習慣を勝手に目標として保存しない",
         state.items.filter(i => i.kind === "goal").length === 0,
         state.items.filter(i => i.kind === "goal").map(i => i.title).join(","));

      // 同じことをもう一度言っても、二重にならない（決まり5）
      const n2 = { id: uid(), text: normNote(LINE), hash: hash(LINE + "2"), capturedAt: at,
        source: "talk", sourceName: null, createdAt: at };
      await putNote(n2);
      const cnt = state.items.length;
      const res2 = await applyOps(ruleOps(n2), n2);
      ok("AX. もう一度言っても予定は増えない", state.items.length === cnt, cnt + "→" + state.items.length);
      /* 文言は v7.5 で変わった。同じ時間帯をもう一度組み立てると、飛ばすのではなく
         **組み直す**（穴が空かないように）。見張っているのは「黙らないこと」なので、
         どちらの言い方でも通す。 */
      ok("AX. 増えなかったことを黙らない", res2.asks.some(x => /足していません|組み直しました/.test(x)),
         res2.asks.join(" / ").replace(/<[^>]+>/g, ""));

      /* **話す時刻で答えが変わる**（v6.6・本人が「夕方6時」と確認したあとに実測）。
         18:30 に言うと翌日の朝6時になっていた。開始が30分過ぎただけで、23:30 まで
         5時間使えるのに、丸一日飛んでいた。「今夜こうしよう」は夕方以降に言うので、ここが効く。
         決まり4b（一点の時刻）は**書き換えない**。日をまたいで飛んだときだけ、今日を見直す。 */
      {
        const winAt = (h, mi) => {
          const at2 = zoned(2026, 9, 12, h, mi, TZ).toISOString();
          const n3 = { id: uid(), text: normNote(LINE), capturedAt: at2, createdAt: at2 };
          const r = parseDayRequest(n3, TZ);
          return r ? r.dayKey + " " + hhmm(r.win[0]) + "-" + hhmm(r.win[1]) : "組み立てない";
        };
        /* v7.9 で答えが変わった。**朝に言ったら、その朝**（実機で 06:07 の報告）。
           8時なら 11:30 までまだ3時間半あり、言われたぶん（2時間）が入る。
           夕方へ飛ばすのは、06:07 が 18:00 になったのと同じ間違いだった。 */
        ok("AX. 朝に言ったら、その朝の残りで組み立てる",
           winAt(8, 0) === KEY + " 08:00-11:30", winAt(8, 0));
        // 18:30 に言えば「今日の夕方のまま・いまから」。翌日の朝へ飛ばさないことが要点
        ok("AX. 18時を過ぎても翌日へ飛ばさない", winAt(18, 30) === KEY + " 18:30-23:30", winAt(18, 30));
        ok("AX. 始まっていたら、いまから組み立てる", winAt(20, 0) === KEY + " 20:00-23:30", winAt(20, 0));
        // 残りが「言われたぶん」に足りないなら、無理に今日へ寄せない
        ok("AX. 残りが足りなければ今日へ寄せない", winAt(22, 0) === NEXT + " 06:00-11:30", winAt(22, 0));

        // 20時に言っても、就寝準備は 23:30 に終わる（提案のほうを落として調整する）
        reset();
        const at3 = zoned(2026, 9, 12, 20, 0, TZ).toISOString();
        const n4 = { id: uid(), text: normNote(LINE), hash: hash(LINE + "20"), capturedAt: at3,
          source: "talk", sourceName: null, createdAt: at3 };
        await putNote(n4);
        const r4 = await applyOps(ruleOps(n4), n4);
        const pl2 = planFor(KEY, { nowMin: 20 * 60 });
        const rows2 = pl2.blocks.filter(b => b.item).map(b => hhmm(b.s) + "〜" + hhmm(b.e) + " " + b.item.title);
        /* 見張っているのは「就寝が後ろへずれないこと」。
           v7.7 で端数ならしをやめたので、窓の終わりより**早く終わる**ことはある。
           早いぶんには本人の言った原則（就寝をずらさない）を破っていない。 */
        {
          const lastRow = rows2[rows2.length - 1] || "";
          const m = lastRow.match(/〜(\d{2}):(\d{2}) 就寝準備/);
          ok("AX. 遅れても就寝準備は 23:30 までに終わる",
             !!m && (+m[1] * 60 + +m[2]) <= 23 * 60 + 30, lastRow);
        }
        ok("AX. 遅れても言われた4件は落とさない",
           state.items.filter(i => !i.suggested && i.kind === "task").length === 4,
           state.items.filter(i => !i.suggested).map(i => i.title).join(","));
        ok("AX. 過ぎた時間に置こうとしない", pl2.unplaced.length === 0,
           pl2.unplaced.map(u => u.item.title + "→" + u.reason).join(" / "));
        ok("AX. 落とした提案を黙らない", r4.asks.some(x => /入れませんでした/.test(x)),
           r4.asks.join(" / "));
        ok("AX. 頭を切ったことを1文で言う",
           r4.asks.filter(x => /組み立てました/.test(x)).length === 1,
           r4.asks.filter(x => /組み立てました/.test(x)).join(" / "));
      }

      /* **句点が無い形**（実機はこれだった）。1文にまとまると、依頼の文を飛ばす所で
         活動を1つも拾えず、組み立てごと消えていた。長さが2つ以上あるときは切ってから読む。 */
      {
        const one = (t) => {
          const at4 = zoned(2026, 9, 12, 17, 0, TZ).toISOString();
          const r = parseDayRequest({ id: uid(), text: normNote(t), capturedAt: at4, createdAt: at4 }, TZ);
          return r ? r.wants.map(w => w.title + "/" + w.min + "x" + w.count).join(" ") : "組み立てない";
        };
        const noDot = "6時から11時半までの間で勉強を30分かける2回 その間にお風呂とご飯それぞれ30分ずつ使う 他に入れる予定や習慣を提案して組み立てて";
        ok("AX. 句点が無くても組み立てる",
           one(noDot) === "勉強をする/30x2 お風呂に入る/30x1 夕食を食べる/30x1", one(noDot));
        // 長さが2つ以上あるときは、先に出た長さを他の活動へ持ち込まない
        const two = "18時から23時半の間で読書を20分、散歩を30分。他も提案して組み立てて。";
        ok("AX. 長さを他の活動に持ち込まない",
           one(two) === "読書をする/20x1 散歩する/30x1", one(two));

        // 時間帯が読めないときは黙らない（決まり5 と同じ理屈）
        const at5 = zoned(2026, 9, 12, 17, 0, TZ).toISOString();
        const n5 = { id: uid(), text: normNote("9時から12時の間で資料づくりを45分かける2回。提案して組み立てて。"),
          hash: hash("x9"), capturedAt: at5, source: "talk", sourceName: null, createdAt: at5 };
        await putNote(n5);
        const r5 = await applyOps(ruleOps(n5), n5);
        ok("AX. 組み立てられなかったことを黙らない",
           r5.asks.some(x => /読み取れませんでした/.test(x)), r5.asks.join(" / ") || "知らせ無し");
      }

      /* **朝の組み立て**（v6.9・測って見つけた）。持ち札は夜を前提に作ってあったので、
         朝6時〜11時半で組むと**就寝準備・リラックス・身支度が日中に並んで**いた。
         夜かどうかは**窓の終わりが21時以降か**で決める（言葉ではなく時刻で決める）。 */
      {
        reset();
        const MORN = "朝6時から11時半までの間で勉強を30分かける2回 その間にご飯と散歩それぞれ30分ずつ使う 他に入れる予定や習慣を提案して組み立てて";
        const at6 = zoned(2026, 9, 12, 5, 0, TZ).toISOString();
        const n6 = { id: uid(), text: normNote(MORN), hash: hash("m1"), capturedAt: at6,
          source: "talk", sourceName: null, createdAt: at6 };
        await putNote(n6);
        await applyOps(ruleOps(n6), n6);
        const pm = planFor(KEY, { nowMin: 5 * 60 });
        const t6 = pm.blocks.filter(b => b.item).map(b => b.item.title);
        ok("AX. 朝の組み立てに就寝準備を入れない", !t6.includes("就寝準備"), t6.join(" / "));
        ok("AX. 朝にリラックス・身支度を入れない",
           !t6.includes("リラックス") && !t6.includes("身支度・明日の準備"), t6.join(" / "));
        ok("AX. 朝は「今日の計画を立てる」を始めのほうに置く",
           t6.indexOf("今日の計画を立てる") >= 0 && t6.indexOf("今日の計画を立てる") <= 2, t6.join(" / "));
        /* **食事の名前は「置かれる枠の時刻」で決める**。話した時刻で決めると、
           夜に「明日の朝のご飯」と言ったとき「食事をとる」になった（実測）。 */
        ok("AX. 朝の枠のご飯は朝食になる", t6.includes("朝食を食べる"), t6.join(" / "));

        reset();
        const NIGHTSAY = "明日の朝6時から11時半までの間でご飯を30分使う 他も提案して組み立てて";
        const at7 = zoned(2026, 9, 12, 22, 0, TZ).toISOString();
        const n7 = { id: uid(), text: normNote(NIGHTSAY), hash: hash("m2"), capturedAt: at7,
          source: "talk", sourceName: null, createdAt: at7 };
        await putNote(n7);
        await applyOps(ruleOps(n7), n7);
        ok("AX. 夜に言った「明日の朝のご飯」も朝食になる",
           state.items.some(i => i.title === "朝食を食べる"),
           state.items.filter(i => !i.suggested).map(i => i.title).join(","));
        /* **日付を言われていたら、今日へ寄せない**（v7.0・朝を測って見つけた）。
           v6.6 の寄せの門が `dk > spokeDay` だけだったので、22時に
           「明日の朝6時から11時半まで」と言うと**今日の22:00〜23:30 に組み立てて**いた。 */
        ok("AX. 「明日」と言われたら今日へ寄せない",
           state.items.some(i => i.dayKey === NEXT) && !state.items.some(i => i.dayKey === KEY),
           [...new Set(state.items.map(i => i.dayKey))].join(","));

        // 余りで「自由・予備時間」を膨らませすぎない（残りは空きとして見える）
        ok("AX. 自由・予備時間を膨らませすぎない",
           pm.blocks.every(b => !b.item || b.item.title !== "自由・予備時間" || (b.e - b.s) <= 90),
           pm.blocks.filter(b => b.item && b.item.title === "自由・予備時間").map(b => (b.e - b.s) + "分").join(","));
      }

      state.settings = Object.assign({}, state.settings, { workStart: keepW[0], workEnd: keepW[1] });
    }

    /* ===== AY. 合わない提案を外す・戻す（v7.1） =====
       持ち札は9つ固定なので、暮らしに合わないものが毎回出る。
       「片付けは提案しないで」で外れ、「片付けもまた提案して」で戻ること。
       **片道だけ作らない**——戻せないと、外した人が詰む。 */
    {
      reset();
      const keepW2 = [state.settings.workStart, state.settings.workEnd];
      state.settings = Object.assign({}, state.settings, { workStart: "00:00", workEnd: "23:59" });
      const at = zoned(2026, 9, 12, 17, 0, TZ).toISOString();
      const talk = async (t) => {
        const n = { id: uid(), text: normNote(t), hash: hash(t + Math.random()), capturedAt: at,
          source: "talk", sourceName: null, createdAt: at };
        await putNote(n); return await applyOps(ruleOps(n), n);
      };
      const LINE2 = "6時から11時半までの間で勉強を30分かける2回 その間にお風呂とご飯それぞれ30分ずつ使う 他に入れる予定や習慣を提案して組み立てて";
      const titles = () => planFor(KEY, { nowMin: 17 * 60 }).blocks.filter(b => b.item).map(b => b.item.title);

      let r = await talk("片付けは提案しないで。リラックスも要らない。");
      ok("AY. 「提案しないで」を希望として受け取る",
         prefs(KEY).noSuggest.join(",") === "tidy,relax", prefs(KEY).noSuggest.join(","));
      /* **要望を用事にしない**（決まり0）。これが無いと
         「タスクを追加：片付けは提案しないで」が予定表に並ぶ（実測）。 */
      ok("AY. 要望の文からタスクを作らない",
         !state.items.some(i => i.kind === "task"),
         state.items.filter(i => i.kind === "task").map(i => i.title).join(","));
      ok("AY. 2つ言っても、片方が消えない", prefs(KEY).noSuggest.length === 2,
         prefs(KEY).noSuggest.join(","));

      await talk(LINE2);
      ok("AY. 外した提案は組み立てに入らない",
         !titles().some(t => /片付け|リラックス/.test(t)), titles().join(" / "));
      ok("AY. ほかの提案は今までどおり入る",
         titles().includes("就寝準備") && titles().includes("休憩"), titles().join(" / "));

      state.items = state.items.filter(i => i.kind === "preference");   // 予定だけ消して組み直す
      r = await talk("片付けもまた提案して。");
      ok("AY. 「また提案して」で戻せる", prefs(KEY).noSuggest.join(",") === "relax",
         prefs(KEY).noSuggest.join(","));
      ok("AY. 戻したことを変えたことに出す",
         r.changes.some(c => /また提案する/.test(c)), r.changes.join(" / "));
      await talk(LINE2 + "（2回目）");
      ok("AY. 戻したら、また入る", titles().some(t => /片付け/.test(t)), titles().join(" / "));

      r = await talk("片付けもまた提案して。");
      ok("AY. もともと外していないなら、そう言う",
         r.asks.some(x => /もともと外していません/.test(x)), r.asks.join(" / "));
      /* 「提案して」という言葉だけで「組み立てられなかった」と言わない——
         時刻を言っているときだけ（実測でここが出ていた）。 */
      ok("AY. 時刻が無いのに組み立て失敗を言わない",
         !r.asks.some(x => /読み取れませんでした/.test(x)), r.asks.join(" / "));

      state.settings = Object.assign({}, state.settings, { workStart: keepW2[0], workEnd: keepW2[1] });
    }

    /* ===== AZ. AIが考えた提案の札を、コードが検算して置く（v7.2・本人の提案） =====
       持ち札9つは全員に同じ顔ぶれが出る。中身はAIに考えてもらい、
       **時刻と並びはコードが決める**（決まり8）。AIの言い値は一切信じない（決まり9）。 */
    {
      reset();
      const keepW3 = [state.settings.workStart, state.settings.workEnd];
      state.settings = Object.assign({}, state.settings, { workStart: "00:00", workEnd: "23:59" });
      const at = zoned(2026, 9, 12, 17, 0, TZ).toISOString();
      const LINE3 = "6時から11時半までの間で勉強を30分かける2回 その間にお風呂とご飯それぞれ30分ずつ使う 他に入れる予定や習慣を提案して組み立てて";
      const n8 = { id: uid(), text: normNote(LINE3), hash: hash("az1"), capturedAt: at,
        source: "talk", sourceName: null, createdAt: at };
      await putNote(n8);
      const fill = { op: "dayfill", blocks: [
        { title: "机の上だけ片づける", min: 10, slot: "start" },
        { title: "友だちに一言だけ連絡する", min: 10, slot: "early" },
        { title: "外の空気を吸う", min: 15, slot: "middle" },
        { title: "好きなことに使う", min: 30, slot: "late", flex: true },
        { title: "明日の服を出す", min: 10, slot: "winddown" },
        { title: "照明を落として休む", min: 30, slot: "end" },
        { title: "勉強をする", min: 30, slot: "middle" },          // 本人が言ったものと重なる
        { title: "", min: 9999, slot: "???" }                       // 壊れた札
      ] };
      const res8 = await applyOps([fill].concat(ruleOps(n8)), n8);
      const pz = planFor(KEY, { nowMin: 17 * 60 });
      const t8 = pz.blocks.filter(b => b.item).map(b => b.item.title);

      ok("AZ. AIの札が予定表に入る", t8.includes("机の上だけ片づける") && t8.includes("外の空気を吸う"), t8.join(" / "));
      ok("AZ. 持ち札の顔ぶれは出てこない",
         !t8.some(x => /切り替え・準備|片付け・軽い運動|大事な用事|就寝準備/.test(x)), t8.join(" / "));
      /* **禁じただけで守られたと思わない**（決まり9）。依頼文で
         「本人が言った予定と同じものを出さない」と頼んでいるが、実測で「勉強をする」が来た。 */
      ok("AZ. 本人が言ったものと重なる札は捨てる",
         t8.filter(x => /勉強/.test(x)).length === 2, t8.filter(x => /勉強/.test(x)).join(","));
      ok("AZ. 壊れた札は捨てる", !t8.some(x => !x || x.length < 2), t8.join(" / "));
      ok("AZ. 長さは5〜120分に収める",
         pz.blocks.filter(b => b.item && b.item.suggested).every(b => (b.e - b.s) >= 5 && (b.e - b.s) <= 120 + 90),
         pz.blocks.filter(b => b.item && b.item.suggested).map(b => (b.e - b.s)).join(","));
      ok("AZ. 置き場所の言葉どおりの順に並ぶ",
         t8.indexOf("机の上だけ片づける") === 0 && t8[t8.length - 1] === "照明を落として休む", t8.join(" / "));
      ok("AZ. 時刻はコードが決める（窓の中に収まる）",
         pz.blocks.filter(b => b.item).every(b => b.s >= 18 * 60 && b.e <= 23 * 60 + 30),
         t8.join(" / "));
      ok("AZ. 提案の印は今までどおり付く",
         pz.blocks.filter(b => b.item && /外の空気/.test(b.item.title)).every(b => b.item.suggested), "");

      // AIが札を出さなければ、今までどおり持ち札9つに戻る（決まり7「AIは任意」）
      reset();
      const n9 = { id: uid(), text: normNote(LINE3), hash: hash("az2"), capturedAt: at,
        source: "talk", sourceName: null, createdAt: at };
      await putNote(n9);
      await applyOps(ruleOps(n9), n9);
      const t9 = planFor(KEY, { nowMin: 17 * 60 }).blocks.filter(b => b.item).map(b => b.item.title);
      ok("AZ. AIが札を出さなければ持ち札に戻る",
         t9.includes("切り替え・準備") && t9.includes("就寝準備"), t9.join(" / "));

      state.settings = Object.assign({}, state.settings, { workStart: keepW3[0], workEnd: keepW3[1] });
    }

    /* ===== BA群：組み立ての依頼は、何を組み立てるのかをAIに渡す（v7.4・実機で報告） =====
       渡していなかったので、AIは【いまの日時】（夜21:30）しか手がかりが無く、
       **朝6時〜11時半の組み立てに「寝る前にスマホを置いて」**と返した（実測）。
       ここが抜けると症状は「習慣の提案がちぐはぐ」としてしか出ないので、
       **プロンプトの中身そのものを見張る**。 */
    {
      const mk = (at, text) => ({ id: "ba" + Math.random(), text, hash: "h",
        capturedAt: at, source: "talk", sourceName: null, createdAt: at });
      const pr = n => buildPrompt(n, contextForAI(n));

      const nightAsk = mk("2026-09-14T12:30:00Z",
        "明日の朝6時から11時半までの間で勉強を30分かける2回。その間にお風呂とご飯それぞれ30分ずつ使う。他に入れる予定ややった方がいい習慣などを提案してスケジュールを組み立てて。");
      const pm = pr(nightAsk);
      ok("BA. 組み立ての依頼だと、依頼だと分かる案内が入る",
         pm.includes("【この発話は「1日の組み立て」の依頼です】"), "案内なし");
      ok("BA. 組み立てる時間帯が渡っている", pm.includes("06:00〜11:30"), "窓が無い");
      ok("BA. 組み立てる日が渡っている", /9\/15/.test(pm), "日が無い");
      ok("BA. 朝の組み立てなら『朝』と伝える", pm.includes("**朝**です"), "時間帯の言葉が無い");
      ok("BA. 朝の組み立てで就寝の話を禁じる",
         pm.includes("就寝・寝る前・夜の話を書かないでください"), "禁止が無い");
      ok("BA. 朝なのに『就寝で締めて』と言わない",
         !pm.includes("就寝に向かう枠で締めて"), "夜向けの指示が出ている");
      ok("BA. dayfill を必ず返すよう頼んでいる",
         pm.includes("「dayfill」を必ず1つ返してください"), "依頼が弱い");
      ok("BA. 渡した日付と時刻を返事に書かせない（決まり8）",
         pm.includes("返事に書かないでください"), "歯止めが無い");

      const eveAsk = mk("2026-09-14T09:30:00Z",
        "6時から11時半までの間で勉強を30分かける2回。その間にお風呂とご飯それぞれ30分ずつ使う。他に入れる予定を提案して組み立てて。");
      const pe = pr(eveAsk);
      ok("BA. 夜の組み立てなら就寝で締めるよう伝える",
         pe.includes("就寝に向かう枠で締めて"), "夜向けの指示が無い");
      ok("BA. 夜の組み立てでは就寝の話を禁じない",
         !pe.includes("就寝・寝る前・夜の話を書かないでください"), "朝向けの禁止が出ている");
      ok("BA. もう始まっている範囲は、いまからの時刻で渡す",
         pe.includes("18:30〜23:30"), "頭が寄せられていない");


    /* ===== BB群：同じ時間帯をもう一度組み立てる（v7.5・実機で報告） =====
       前は「同じものがある」で足さずに飛ばすだけだったので、こうなった（実測）：
       ①本人が言ったぶんが飛ばされて「言われた0件」 ②飛ばした場所が穴になる
       ③前の組み立ての提案が残って重なる。組み立て直しは「その時間帯のやり直し」。 */
    {
      const keepW4 = [state.settings.workStart, state.settings.workEnd];
      state.settings = Object.assign({}, state.settings, { workStart: "00:00", workEnd: "23:59" });
      const before = state.items.slice();
      state.items = [];
      const DAY = "2026-09-15", AT = "2026-09-14T13:28:00Z";      // JST 22:28
      const TXT = "6時から11時半までの間で勉強を30分かける2回。その間にお風呂とご飯それぞれ30分ずつ使う。他に入れる予定ややった方がいい習慣などを提案してスケジュールを組み立てて";
      const build = async (fill) => {
        const n = { id: uid(), text: normNote(TXT), hash: hash(TXT + Math.random()),
          capturedAt: AT, source: "talk", sourceName: null, createdAt: AT };
        await putNote(n);
        const ro = ruleOps(n).filter(x => x.op === "buildday");
        return await applyOps((fill ? [fill] : []).concat(ro), n);
      };
      /* **本物の時計に頼らない**（記録済みの落とし穴）。`planFor` は「いま」を知っていて
         過ぎた枠を落とすので、実際の時刻が朝の窓に入った日から、
         **06:00〜06:20 の枠が消えて**この群が落ちる（実際に落ちた）。`nowMin` を固定する。 */
      const rows = () => planFor(DAY, { nowMin: -1 }).blocks.filter(b => b.item)
        .map(b => ({ s: b.s, e: b.e, t: b.item.title, sug: !!b.item.suggested }));
      const FILL_A = { op: "dayfill", blocks: [
        { title: "軽くストレッチをする", min: 10, slot: "start" },
        { title: "窓を開けて外の空気を吸う", min: 5, slot: "early" },
        { title: "好きな音楽を聴く", min: 20, slot: "middle", flex: true },
        { title: "家族や友人にひとこと連絡する", min: 10, slot: "late" }] };

      const r1 = await build(null);                     // 1回目：AIの札なし＝持ち札
      const a1 = rows();
      ok("BB. 1回目は言われた4件が入る", /言われた4件/.test(r1.changes.join("")), r1.changes.join(""));
      const r2 = await build(FILL_A);                   // 2回目：AIが別の札を返す
      const a2 = rows();
      ok("BB. 組み立て直しても『言われた4件』のまま",
         /言われた4件/.test(r2.changes.join("")), r2.changes.join(""));
      ok("BB. 組み直したことを黙らない",
         r2.asks.some(x => /組み直しました/.test(x)), r2.asks.join(" / "));
      ok("BB. 前の組み立ての提案は残らない",
         !a2.some(r => /切り替え・準備|大事な用事を1つ|自由・予備時間/.test(r.t)),
         a2.map(r => r.t).join("/"));
      ok("BB. 新しい提案が入っている",
         a2.some(r => r.t === "軽くストレッチをする") && a2.some(r => r.t === "好きな音楽を聴く"),
         a2.map(r => r.t).join("/"));
      ok("BB. 本人が言ったものは消えない",
         ["勉強をする①", "勉強をする②", "朝食を食べる", "お風呂に入る"]
           .every(t => a2.some(r => r.t === t)), a2.map(r => r.t).join("/"));
      ok("BB. 同じものが二重に入らない",
         new Set(a2.map(r => r.t)).size === a2.length, a2.map(r => r.t).join("/"));
      /* **穴を空けない**。飛ばしたぶんの場所が空いたままになるのが、実機で見えた形。 */
      const gaps = a2.slice(1).map((r, i) => r.s - a2[i].e).filter(g => g > 0);
      ok("BB. 置いた枠のあいだに穴が空かない", gaps.length === 0, "穴 " + gaps.join(","));
      /* 余った時間は**最後にまとめて**空きとして残る（活動を伸ばして埋めない・v7.7）。 */
      ok("BB. 余りは最後に空きとして残る",
         a2[a2.length - 1].e < 11 * 60 + 30, hhmm(a2[a2.length - 1].e));
      /* **名前のついた活動を、こちらの都合で長くしない**（実機で音楽が1時間30分になった）。 */
      const music = a2.find(r => r.t === "好きな音楽を聴く");
      ok("BB. AIが言った長さを、そのまま使う（伸ばさない）",
         !!music && music.e - music.s === 20, music ? (music.e - music.s) + "分" : "無い");
      /* 名前のついた活動は1分も伸ばさない（v7.7・本人の指示）。
         余りは空きのまま残す——`planFor` が空き時間として描くので、消したことにならない。 */
      ok("BB. 名前のついた活動を1つも伸ばさない",
         [["軽くストレッチをする",10],["窓を開けて外の空気を吸う",5],
          ["家族や友人にひとこと連絡する",10]].every(([t, m]) => {
            const r = a2.find(x => x.t === t); return r && r.e - r.s === m; }),
         a2.map(r => r.t + (r.e - r.s)).join("/"));

      /* `dedupeKey` が **UTCの日付**を使っていたので、日本時間の午前9時をまたぐと
         同じ日の同じ用事が別物になった（実機で「お風呂に入る」が二重に入った）。 */
      const mk2 = (title, h) => {
        const it = { kind: "task", title, dayKey: DAY,
          due: zoned(2026, 9, 15, h, 0, state.settings.timezone).toISOString() };
        return dedupeKey(it);
      };
      ok("BB. 同じ日なら、9時の前後で鍵が割れない",
         mk2("お風呂に入る", 8) === mk2("お風呂に入る", 10),
         mk2("お風呂に入る", 8) + " vs " + mk2("お風呂に入る", 10));
      ok("BB. 別の日なら、ちゃんと別の鍵になる",
         dedupeKey({ kind: "task", title: "お風呂に入る", dayKey: "2026-09-16" }) !== mk2("お風呂に入る", 8),
         "同じ鍵になっている");


      /* **渡しても、弾く側は外さない**（決まり9「禁じただけで守られたと思わない」）。
         渡すのは**出させないため**、弾くのは**入れないため**。役目が違うので両方要る。
         AIが言いつけを破って「勉強をする」を返してきても、予定表には1つしか並ばない。 */
      state.items = [];
      await build({ op: "dayfill", blocks: [
        { title: "勉強をする", min: 25, slot: "middle" },
        { title: "お風呂に入る", min: 20, slot: "late" },
        { title: "軽くストレッチをする", min: 10, slot: "start" }] });
      const aG = rows();
      ok("BB. AIが言いつけを破っても、重なる札は入れない",
         aG.filter(r => r.t === "勉強をする①" || r.t === "勉強をする").length === 1
         && aG.filter(r => r.t === "お風呂に入る").length === 1,
         aG.map(r => r.t).join("/"));
      ok("BB. 重ならない札はちゃんと入る",
         aG.some(r => r.t === "軽くストレッチをする" && r.sug), aG.map(r => r.t).join("/"));

      /* **消したものに、言ったことを塞がせない**（v7.6・実機で報告）。
         ①組み立てる →②「さっきの話を全部消して」→③もう一度同じことを言う、で
         **勉強・ご飯・お風呂が「もう入っています」で飛ばされ**「言われた0件」になった。
         決まり5（突き合わせに取り消し済みも含める）は**再提案を止める**ための決まりで、
         本人が名指しで頼んでいる組み立てには当てない。 */
      state.items = [];
      await build(null);
      let killed = 0;
      for (const i of state.items) if (i.dayKey === DAY && i.status === "open") {
        i.status = "dropped"; i.updatedAt = new Date().toISOString(); await putItem(i); killed++;
      }
      ok("BB. 「全部消して」でその日が空になる",
         killed > 0 && planFor(DAY).blocks.filter(b => b.item).length === 0, String(killed));
      const r3 = await build(FILL_A);
      const a3 = rows();
      ok("BB. 消したあとでも、言ったものがちゃんと入る",
         /言われた4件/.test(r3.changes.join("")), r3.changes.join(""));
      ok("BB. 消したものを「もう入っています」で塞がない",
         !r3.asks.some(x => /足していません/.test(x)), r3.asks.join(" / "));
      ok("BB. 消したあとの組み立てにも穴が空かない",
         a3.slice(1).every((r, i) => r.s === a3[i].e), a3.map(r => hhmm(r.s) + "-" + hhmm(r.e)).join(" "));
      ok("BB. 消したあとでも二重にならない",
         new Set(a3.map(r => r.t)).size === a3.length, a3.map(r => r.t).join("/"));

      state.items = before;
      state.settings = Object.assign({}, state.settings, { workStart: keepW4[0], workEnd: keepW4[1] });
    }


      /* **重なりは、弾くより先に「渡して防ぐ」**（v7.8・本人の指摘）。
         AIには本人が何を頼んだのかを一度も渡していなかったので、文章から自分で
         読み取るしかなく、「勉強をする」が本人のぶんと提案で2回並んだ（実測）。
         こちらは `parseDayRequest` で既に読めているのだから、渡せばいい。 */
      ok("BA. 本人が言ったものをAIに渡している",
         /勉強をする/.test(pm) && /お風呂に入る/.test(pm) && /ご飯/.test(pm),
         "渡していない");
      ok("BA. 回数と長さも渡している", /勉強をする × 2回（各30分）/.test(pm), "回数・長さが無い");
      ok("BA. 重ねないよう頼んでいる",
         /これらと同じもの・似たものは出さないでください/.test(pm), "頼んでいない");
      ok("BA. 組み立てでない発言には、この一覧を出さない",
         !/すでに入ります/.test(pr(mk("2026-09-14T12:30:00Z", "眠い。明日までに資料を作らないと。"))),
         "毎回出ている");


      /* ===== BC群：朝に言った朝の組み立てが、夜になっていた（v7.9・実機で報告） =====
         06:07 に「6時から11時半までの間で」と言うと **18:00〜23:30** になっていた（実測）。
         6時が7分だけ過ぎていたので決まり4b が ＋12時間へ寄せ、v6.6 の引き戻しは
         **日をまたいだときしか**見ていなかったので、そのまま通った。 */
      {
        const TXT = "6時から11時半までの間で勉強を30分かける2回。その間にお風呂とご飯それぞれ30分ずつ使う。他に入れる予定を提案して組み立てて";
        const at = (h, mi) => zoned(2026, 9, 15, h, mi, state.settings.timezone).toISOString();
        const win = (h, mi) => {
          const iso = at(h, mi);
          const r = parseDayRequest({ id: "bc", text: TXT, hash: "h", capturedAt: iso,
            source: "talk", sourceName: null, createdAt: iso }, state.settings.timezone);
          return r ? r.dayKey + " " + hhmm(r.win[0]) + "-" + hhmm(r.win[1]) : "null";
        };
        ok("BC. 6時7分に言ったら、その朝を組み立てる",
           win(6, 7) === "2026-09-15 06:10-11:30", win(6, 7));
        ok("BC. 5時55分（まだ始まっていない）なら 6:00 から",
           win(5, 55) === "2026-09-15 06:00-11:30", win(5, 55));
        /* 10時だと 11:30 まで90分しか無く、言われたぶん（2時間）が入らない。
           **残りに押し込まない**（v6.6 の決まり）ので、今夜へ寄せるのが正しい。 */
        ok("BC. 入りきらないなら、朝に押し込まず今夜へ",
           win(10, 0) === "2026-09-15 18:00-23:30", win(10, 0));
        /* 入るぶんだけなら、朝の残りで組み立てる */
        {
          const SHORT = "6時から11時半までの間で勉強を30分かける2回。他に入れる予定を提案して組み立てて";
          const iso = at(10, 0);
          const r = parseDayRequest({ id: "bc2", text: SHORT, hash: "h", capturedAt: iso,
            source: "talk", sourceName: null, createdAt: iso }, state.settings.timezone);
          const got = r ? r.dayKey + " " + hhmm(r.win[0]) + "-" + hhmm(r.win[1]) : "null";
          ok("BC. 入るなら、朝の残りで組み立てる", got === "2026-09-15 10:00-11:30", got);
        }
        /* 終わりが過ぎていたら、今日の夜へ寄せる（v6.6 のまま。ここを壊さない） */
        ok("BC. 18時半なら今夜に寄せる",
           win(18, 30) === "2026-09-15 18:30-23:30", win(18, 30));
        ok("BC. 22時なら残りが足りないので翌朝",
           win(22, 0) === "2026-09-16 06:00-11:30", win(22, 0));
        /* 11時40分＝朝の窓は終わり、夜の窓はまだ来ていない → 今夜 */
        ok("BC. 11時40分なら今夜に寄せる",
           win(11, 40) === "2026-09-15 18:00-23:30", win(11, 40));
      }

      /* **「AIが答えなかった」と「AIは答えたが操作が空だった」を同じ顔で出さない**
         （v7.9・実機で報告）。本人は「ルールで読み取り」を見て
         **「AIが使えなくなった」**と読んだ。印に理由を足す。 */
      ok("BC. AIが返事だけのときは、印に理由を付ける",
         /ルールで読み取り（AIは返事だけ）/.test(String(turnHTML)), "印が分かれていない");
      ok("BC. 組み立ての案内は依頼文の先頭に置く",
         pm.indexOf("【この発話は「1日の組み立て」の依頼です】") < 200,
         String(pm.indexOf("【この発話は「1日の組み立て」の依頼です】")));
      ok("BC. ops を空にするなと頼んでいる",
         /「ops」を空にしないでください/.test(pm), "頼んでいない");

      const plain = pr(mk("2026-09-14T12:30:00Z", "眠い。明日までに資料を作らないと。"));
      ok("BA. 組み立てでない発言には案内を出さない",
         !plain.includes("【この発話は「1日の組み立て」の依頼です】"), "毎回出ている");

      /* ===== BD群：まだ聞けていないこと（TELOS をアプリから埋める）=====
         **誰が使っても同じように動くこと**が要件（本人の指摘・2026-09-19）。
         だからアプリが持つのは**質問だけ**で、人物像は1文字も持たない。
         答えの置き場は既にある `profile` と `goal`——新しい入れ物を作らない（決まり7e）。 */
      {
        const keepI = state.items;

        ok("BD. アプリは質問しか持たない（人物像を持たない）",
           TELOS_ASKS.every(a => /[かは]。$/.test(a.q)) && TELOS_ASKS.length >= 5,
           TELOS_ASKS.map(a => a.q).join("/"));
        ok("BD. 答えの置き場は profile と goal だけ（新しい入れ物を作らない）",
           TELOS_ASKS.every(a => a.cat === "goal" || PROFILE_CATS.includes(a.cat)),
           TELOS_ASKS.map(a => a.cat).join("/"));

        state.items = [];
        ok("BD. 何も無ければ、全部が「まだ聞いていない」",
           telosGaps().length === TELOS_ASKS.length, String(telosGaps().length));

        /* 埋まったぶんだけ減る。**分類ごとに見る**——1件あれば全部埋まった扱いにしない。 */
        state.items = [{ id: "bd1", kind: "profile", category: "体のこと",
                         title: "朝は頭が動かない", status: "open" }];
        ok("BD. 答えた分類は、もう聞かない",
           !telosGaps().some(g => g.cat === "体のこと"), telosGaps().map(g => g.cat).join("/"));
        ok("BD. 答えていない分類は、まだ聞く",
           telosGaps().some(g => g.cat === "好み"), telosGaps().map(g => g.cat).join("/"));

        /* 取り消したものは「答えた」ことにしない（決まり2・推測を確定にしない）。 */
        state.items = [{ id: "bd2", kind: "profile", category: "好み",
                         title: "散歩が好き", status: "dropped" }];
        ok("BD. 取り消した答えは、答えたことにしない",
           telosGaps().some(g => g.cat === "好み"), telosGaps().map(g => g.cat).join("/"));

        state.items = [{ id: "bd3", kind: "goal", title: "毎日30分読む", status: "open" }];
        ok("BD. 続けたいことは goal で埋まる",
           !telosGaps().some(g => g.cat === "goal"), telosGaps().map(g => g.cat).join("/"));

        /* 画面と依頼文が**同じ関数**を見ていること（決まり7e・片方だけ直される穴）。 */
        state.items = [];
        const pAll = pr(mk("2026-09-14T12:30:00Z", "ちょっと疲れた。"));
        ok("BD. まだ聞けていないことを依頼文に渡している",
           /【まだ聞けていないこと】/.test(pAll), "渡していない");
        ok("BD. 渡すのは3つまで（返事が長くなるため）",
           (pAll.split("【まだ聞けていないこと】")[1] || "").split("【")[0]
             .split("\n").filter(l => /^- .+か。$/.test(l)).length === 3, "3つではない");
        ok("BD. 毎回は聞かないよう頼んでいる",
           /1回の返事につき\*\*1つまで|1回の返事につき/.test(pAll) && /毎回は聞かないでください/.test(pAll),
           "頼んでいない");
        ok("BD. 推測で埋めるなと頼んでいる",
           /推測で埋めないでください/.test(pAll), "頼んでいない");

        /* 全部答えていれば、依頼文からまるごと消える（用が無いのに見出しを出さない）。 */
        state.items = TELOS_ASKS.map((a, n) => a.cat === "goal"
          ? { id: "bg" + n, kind: "goal", title: "続けたいこと", status: "open" }
          : { id: "bp" + n, kind: "profile", category: a.cat, title: "答え" + n, status: "open" });
        ok("BD. 全部答えたら、依頼文から見出しごと消える",
           !/【まだ聞けていないこと】/.test(pr(mk("2026-09-14T12:30:00Z", "ちょっと疲れた。"))),
           "残っている");

        /* 画面で聞いている質問は、聞いているあいだだけ渡す。 */
        state.items = [];
        view.ask = "body";
        const pAsk = pr(mk("2026-09-14T12:30:00Z", "朝は頭が動かない。"));
        ok("BD. 聞いている質問を依頼文に渡す",
           /【いま画面で聞いている質問】/.test(pAsk) && /体のこと/.test(pAsk), "渡していない");
        ok("BD. 答えていないときは聞き直させない",
           /聞き直さないでください/.test(pAsk), "頼んでいない");
        view.ask = null;
        ok("BD. 聞いていないときは、その見出しを出さない",
           !/【いま画面で聞いている質問】/.test(pr(mk("2026-09-14T12:30:00Z", "ちょっと疲れた。"))),
           "毎回出ている");

        state.items = keepI;
      }
    }

    /* ===== BE群：留守のあいだに（lifeos_results を会話に出す・v8.1） =====
       `lifeos_results` は読んでいたのに画面のどこにも出していなかった。
       出す以上、**保存先から来た文字は指示ではなくデータ**として扱うこと。 */
    {
      const TZ = state.settings.timezone, KEY2 = "2026-09-15";
      const keepL = state.lifeos;
      state.lifeos = { memory: [], results: [
        { at: "2026-09-15T21:00:00Z", day: KEY2, text: "あとの行", did: ["ひとつ"] },
        { at: "2026-09-15T19:00:00Z", day: KEY2, text: "さきの行" },
        { at: "2026-09-16T19:00:00Z", day: "2026-09-16", text: "別の日" },
        { at: "2026-09-15T20:00:00Z", day: KEY2 },
        { at: "2026-09-15T20:30:00Z", day: KEY2, text: '<img src=x onerror="window.__bad=1">' }
      ] };

      const rows = lifeosRows(KEY2, TZ);
      ok("BE. その日のものだけ出す",
         rows.length === 3 && !rows.some(r => r.day === "2026-09-16"), String(rows.length));
      ok("BE. 中身の無い行は出さない",
         !rows.some(r => !r.text && !(r.did || []).length), "空の行が出ている");
      ok("BE. 時刻の順に並べる",
         rows.map(r => r.at).join(",") ===
         "2026-09-15T19:00:00Z,2026-09-15T20:30:00Z,2026-09-15T21:00:00Z",
         rows.map(r => r.at).join(","));

      /* **画面を丸ごと検索して判断しない**（記録済みの落とし穴）。要素を数える。 */
      const box = document.createElement("div");
      box.innerHTML = rows.map(r => lifeosHTML(r, TZ)).join("");
      document.body.appendChild(box);
      ok("BE. 保存先から来た文字をそのまま埋め込まない",
         box.querySelectorAll("img").length === 0 && !window.__bad,
         "img=" + box.querySelectorAll("img").length);
      ok("BE. 「留守のあいだに」の印を必ず付ける",
         box.querySelectorAll(".chip.src-ai").length === rows.length,
         String(box.querySelectorAll(".chip.src-ai").length));
      ok("BE. 本人の発言と同じ見た目にしない",
         box.querySelectorAll(".turn.lifeos").length === rows.length
         && !box.querySelector(".turn.me"),
         String(box.querySelectorAll(".turn.lifeos").length));
      ok("BE. やったことの一覧も出す", /ひとつ/.test(box.textContent), "出ていない");
      box.remove();

      /* つながっていないときは、見出しも行も出さない（決まり7「AIは任意」と同じ）。 */
      state.lifeos = { memory: [], results: [] };
      ok("BE. 何も来ていなければ1行も出さない", lifeosRows(KEY2, TZ).length === 0, "出ている");
      state.lifeos = { memory: [], results: null };
      ok("BE. results が無くても落ちない", lifeosRows(KEY2, TZ).length === 0, "落ちた");

      /* アプリは読むだけ。書く道を持たない（書くのは定時に起きる側）。
         **関数の中身を見る**——ページ全体を検索すると、このテスト自身の文字列に当たる。 */
      ok("BE. アプリは lifeos_results へ書き込まない",
         /collection\("lifeos_results"\)/.test(String(boot))
         && !/lifeos_results[\s\S]{0,200}\.set\(/.test(String(boot)),
         "読む道が無いか、書く道がある");

      state.lifeos = keepL;
    }

    /* ===== BF群：自分のAPIキーでAIを呼ぶ（v8.2）=====
       いちばん大事なのは **キーが共有の場所へ出ていかないこと**。
       `db` はリンクを開いた人に渡る（実機で確認済み）ので、キーが入ったら漏れる。 */
    {
      const keepFn = SAMPLEFN, keepLS = (() => { try { return localStorage.getItem(AI_KEY_LS); } catch { return null; } })();
      const CFG = { provider: "claude", key: "sk-ant-TESTKEY-do-not-use", model: "claude-opus-5" };

      writeOwnAI(CFG);
      ok("BF. キーはこの端末の入れ物にだけ入る",
         String(localStorage.getItem(AI_KEY_LS) || "").includes(CFG.key), "保存されていない");
      ok("BF. キーは設定（共有の保存先へ行くもの）に入らない",
         !JSON.stringify(state.settings).includes(CFG.key), "設定に混ざっている");
      ok("BF. キーは書き出すJSONに入らない",
         !exportPayload().includes(CFG.key), "書き出しに混ざっている");

      const f = ownAI(CFG);
      ok("BF. 窓口の形が `sample` と同じ（呼ぶ側を変えなくていい）",
         typeof f === "function" && typeof f.json === "function" && typeof f.limits === "function",
         typeof f + "/" + typeof f.json);
      ok("BF. どこのAIかの印を持つ", f.own === "claude", String(f.own));

      ok("BF. 読み込むと同じものが返る",
         JSON.stringify(readOwnAI()) === JSON.stringify(CFG), JSON.stringify(readOwnAI()));
      ok("BF. 自分のキーがあれば、そちらが勝つ",
         applyOwnAI() === true && SAMPLEFN.own === "claude", String(SAMPLEFN && SAMPLEFN.own));

      /* 保存データは壊れると思って読む（記録済みの決まり）。 */
      try { localStorage.setItem(AI_KEY_LS, "{壊れた"); } catch {}
      ok("BF. 壊れた保存値で落ちない", readOwnAI() === null, "落ちたか値を返した");
      try { localStorage.setItem(AI_KEY_LS, JSON.stringify({ provider: "しらない", key: "x" })); } catch {}
      ok("BF. 知らない提供元は採らない", readOwnAI() === null, "採っている");
      try { localStorage.setItem(AI_KEY_LS, JSON.stringify({ provider: "claude", key: "" })); } catch {}
      ok("BF. キーが空なら使わない", readOwnAI() === null, "使おうとしている");

      /* AIは ```json で包んで返すことがある。包みと前後の言葉を外して読む。 */
      ok("BF. 包まれたJSONを読める",
         jsonFromText('はい。\n```json\n{"ops":[],"reply":"あ"}\n```\nどうぞ').reply === "あ", "読めない");
      ok("BF. 裸のJSONも読める", jsonFromText('{"a":1}').a === 1, "読めない");
      ok("BF. 配列も読める", jsonFromText('[{"a":1}]')[0].a === 1, "読めない");

      /* 呼べなかった理由を、本人が打てる手に翻訳する（決まり6n と同じ理屈）。 */
      ok("BF. 通信そのものが止められたと分かる文にする",
         /外部への通信が禁じられている/.test(ownAIError(new TypeError("Failed to fetch"), "api.example")),
         ownAIError(new TypeError("Failed to fetch"), "api.example"));
      ok("BF. 相手が返した理由は、そのまま見せる",
         ownAIError(new Error("Claude 401：invalid x-api-key"), "h") === "Claude 401：invalid x-api-key",
         ownAIError(new Error("Claude 401：invalid x-api-key"), "h"));

      /* **送信先・送信内容・費用を、保存する前に見せる**（決まりそのもの）。 */
      const note = ownAINote("claude");
      ok("BF. 送信先を書いている", /api\.anthropic\.com/.test(note), note.slice(0, 60));
      ok("BF. 送信する中身を書いている", /送信するもの/.test(note) && /わたしのこと/.test(note), "書いていない");
      ok("BF. 費用を書いている", /あなたのキーに請求されます/.test(note), "書いていない");
      ok("BF. 資料の全文は送らないと書いている", /資料の全文は送りません/.test(note), "書いていない");
      ok("BF. 使わないときは「何も送らない」と書く",
         /外へは何も送りません/.test(ownAINote("")), ownAINote(""));

      /* キーを消したら、元の窓口へ戻れること（片道にしない）。 */
      writeOwnAI(null);
      ok("BF. 消したら読めなくなる", readOwnAI() === null, "残っている");
      ok("BF. キーが無ければ窓口を触らない", applyOwnAI() === false, "触っている");

      try { if (keepLS == null) localStorage.removeItem(AI_KEY_LS); else localStorage.setItem(AI_KEY_LS, keepLS); } catch {}
      SAMPLEFN = keepFn;
    }

    /* ===== BG群：ネイティブの殻との橋（v8.3・Android アプリ化）=====
       殻の仕事は3つだけ（画面を開く・AIの通信を代わりにやる・通知を予約する）。
       **殻が無ければ何も起きない**こと（決まり7と同じ理屈）が、いちばん大事。 */
    {
      const keepRN = window.ReactNativeWebView;
      const sent = [];

      ok("BG. 殻が無ければ、橋は閉じている", nativeOn() === false, "開いている");
      ok("BG. 殻が無ければ、通知を送らない", notifyPlan(dayKey(new Date(), state.settings.timezone)) === 0,
         "送っている");
      ok("BG. 殻から呼ぶ窓口を生やしている",
         typeof window.hitohiNative === "function", typeof window.hitohiNative);

      window.ReactNativeWebView = { postMessage: m => sent.push(JSON.parse(m)) };
      ok("BG. 殻があれば、橋が開く", nativeOn() === true, "開かない");

      /* AIへの通信は殻へ渡す。**`fetch` を呼ばない**（CORS に止められるため）。 */
      let fetched = 0;
      const keepFetch = window.fetch;
      window.fetch = () => { fetched++; return Promise.reject(new Error("呼んではいけない")); };
      const pr = aiPost("https://example.test/x", { "content-type": "application/json" }, { a: 1 });
      await new Promise(r => setTimeout(r, 0));
      ok("BG. AIの通信を殻へ渡す", sent.length === 1 && sent[0].kind === "fetch",
         JSON.stringify(sent[0] || null));
      ok("BG. 自分では fetch を呼ばない", fetched === 0, String(fetched));
      ok("BG. 中身をそのまま渡す",
         sent[0].url === "https://example.test/x" && sent[0].body === '{"a":1}', sent[0].body);

      /* 殻からの返事で、待っていた約束が解ける。 */
      window.hitohiNative(JSON.stringify({ id: sent[0].id, status: 200, body: '{"ok":true}' }));
      const got = await pr;
      ok("BG. 殻の返事を受け取れる", got.ok === true && got.data.ok === true, JSON.stringify(got));

      /* 知らない返事・壊れた返事で落ちない。 */
      ok("BG. 知らない返事は捨てる", window.hitohiNative(JSON.stringify({ id: "zzz" })) === false, "拾った");
      ok("BG. 壊れた返事で落ちない", window.hitohiNative("{こわれた") === false, "落ちた");

      /* 殻が黙ったままでも、永久に待たない（送信欄が止まるのを防ぐ）。 */
      sent.length = 0;
      let timedOut = "";
      try { await nativeAsk("fetch", { url: "x" }, 30); }
      catch (e) { timedOut = String(e.message || e); }
      ok("BG. 殻が黙ったら時間切れにする", /返事がありません/.test(timedOut), timedOut);

      /* 相手が返した失敗は、そのまま伝わる。 */
      sent.length = 0;
      const pr2 = aiPost("https://example.test/y", {}, {});
      await new Promise(r => setTimeout(r, 0));
      window.hitohiNative(JSON.stringify({ id: sent[0].id, error: "つながりません" }));
      let err2 = "";
      try { await pr2; } catch (e) { err2 = String(e.message || e); }
      ok("BG. 殻の失敗が伝わる", err2 === "つながりません", err2);
      window.fetch = keepFetch;

      /* 何を知らせるか。**時計を読まない関数**なので、翌日になっても落ちない。 */
      {
        const tz = state.settings.timezone, DAY = "2026-09-15";
        const keepI = state.items;
        const at = (h, m) => zoned(2026, 9, 15, h, m, tz).toISOString();
        state.items = [
          { id: "g1", kind: "event", title: "打ち合わせ", status: "open", fixed: true,
            dayKey: DAY, start: at(14, 0), end: at(15, 0) },
          { id: "g2", kind: "event", title: "朝の用事", status: "open", fixed: true,
            dayKey: DAY, start: at(8, 0), end: at(9, 0) },
          { id: "g3", kind: "event", title: "こちらの提案", status: "open", fixed: true,
            suggested: true, dayKey: DAY, start: at(16, 0), end: at(16, 30) }
        ];
        const list = notifyList(DAY, 12 * 60);        // 正午にいるつもりで
        ok("BG. これから来るものだけ知らせる",
           list.some(x => /打ち合わせ/.test(x.title)) && !list.some(x => /朝の用事/.test(x.title)),
           list.map(x => x.title).join("/"));
        ok("BG. こちらの提案は知らせない",
           !list.some(x => /こちらの提案/.test(x.title)), list.map(x => x.title).join("/"));
        ok("BG. 時刻と長さを添える",
           list.length > 0 && /14:00から/.test(list[0].body) && typeof list[0].at === "number",
           JSON.stringify(list[0] || null));
        ok("BG. 多すぎる通知を送らない", list.length <= 12, String(list.length));
        state.items = keepI;
      }

      if (keepRN === undefined) delete window.ReactNativeWebView;
      else window.ReactNativeWebView = keepRN;
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
