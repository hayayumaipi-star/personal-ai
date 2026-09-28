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

  /* 保存を待つ。**固定の時間で待たない**（遅い日に落ちる）。 */
  async function waitUntil(fn, ms) {
    const end = Date.now() + (ms || 800);
    while (Date.now() < end) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); }
    return !!fn();
  }
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
      /* 2026-09-27 から、当たる予定が1つだけで時刻を言い直したなら、AIが無くてもその予定を直す（決まり7「ルールだけで訂正が成立する」）。
         前は「できません」と伝えるだけだった。当たるものが2つ以上なら今までどおり伝える（下の A6b） */
      const ev6 = state.items.find(i => i.id === ev.id);
      ok("A6. AIなしでも、当たる予定が1つなら言い直しを反映する",
         !!ev6 && hhmm(minOfDay(ev6.start, TZ)) === "14:00" && r6.changes.some(c => /14:00/.test(c)),
         (ev6 ? fmtDT(ev6.start, TZ) : "なし") + " asks=[" + r6.asks.join(" ") + "]");
      state.items = []; ev = mkEv(); await putItem(ev);
      const ev2 = Object.assign(mkEv(), { id: uid() }); ev2.start = zoned(2026, 9, 13, 16, 0, TZ).toISOString(); ev2.end = zoned(2026, 9, 13, 17, 0, TZ).toISOString(); await putItem(ev2);
      const r6b = await say("明日の打ち合わせ、14時にして。", T(9, 31));
      ok("A6b. 当たる予定が2つあれば、黙らずにできないことを伝える",
         r6b.asks.length >= 1 && /AI|直して/.test(r6b.asks.join(" ")),
         "asks=[" + r6b.asks.join(" ") + "]");
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
        ["夜ごはんは家で作る", 18, 0, "夕食を作る"],          // 作る話は「作る」（2026-09-28・DF群）
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
      ok("N. 速い返事に「記録した」と言わせない", /「記録した」「完了にした」「予定を変えた」「覚えておく」と言わない/.test(pr));
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
      /* **`var(--fs-in)` を `parseFloat` に渡さない**（2026-09-24）。
         文字の大きさを rem のトークンへ移した瞬間に NaN になって落ちた。
         書いてある値をそのまま読むのではなく、**いま効いている px** に直してから見る。 */
      const pxOf = v => {
        v = String(v || "").trim();
        const m = /^var\((--[\w-]+)\)$/.exec(v);
        if (m) v = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
        if (/rem$/.test(v)) return parseFloat(v) * parseFloat(getComputedStyle(document.documentElement).fontSize);
        return parseFloat(v);
      };
      ok("S. 狭い画面向けの指定がある", !!mq);
      const sm = decl(".btn.sm");
      /* **44px**（2026-09-24・案E）。iOS は44pt、Android は48dp が最小。
         前は36pxで8px足りなかった。**高さだけでなく幅も**——「…」や ◀ ▶ は
         文字が短いので、高さだけ上げると縦長の細い的になる（実測36px幅）。 */
      ok("S. 行の操作ボタンが指で押せる高さ（44px以上）",
         !!sm && parseFloat(sm.minHeight) >= 44, sm && sm.minHeight);
      ok("S. 文字の短いボタンも、幅が44px以上",
         !!sm && parseFloat(sm.minWidth) >= 44, sm && sm.minWidth);
      const bg = decl(".btn");
      ok("S. ふつうのボタンも44px以上", !!bg && parseFloat(bg.minHeight) >= 44, bg && bg.minHeight);
      const src = decl(".btn.sm.srcbtn");
      ok("S. 会話の「原文」だけは小さいまま（本文の邪魔をしない）",
         !!src && /auto/.test(src.minWidth || ""), src && src.minWidth);
      const ta = decl(".saybar textarea");
      ok("S. 入力欄の文字が16px以上（触れた瞬間に拡大されない）",
         !!ta && pxOf(ta.fontSize) >= 16, ta && ta.fontSize + "＝" + (ta && pxOf(ta.fontSize)) + "px");
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
        ["来週あたり部屋の片付けをしたい。", "部屋の片付けをする"],   // 「あたり」が残っていた（「したい」は言い切りにそろえる・2026-09-26）
        ["今週中にレポートを出す。",         "レポートを出す"],         // 「中に」が残っていた
        ["3時からの会議に出る。",            "会議に出る"],             // 先頭に「の」が残っていた
        ["掃除は20分くらい。",               "掃除"],                   // 末尾に「は」が残っていた
        ["AM9時に集合。",                    "集合"],                   // 「AM」が残っていた
        /* 時間帯の言葉（2026-09-21・本人の指摘）。**「午前中」だけ落ちて、
           「夕方」「午後」「昼過ぎ」「夜に」は残っていた**——読み取る側（`parseIntent`）と
           落とす側（`cleanTitle`）で語の一覧が違っていた（決まり7e）。
           項目にはチップで別に出るので、見出しに残すと二度書きになる。 */
        ["夕方に資料を作る。1時間。",        "資料を作る"],
        ["午後に資料を作る。1時間。",        "資料を作る"],
        ["昼過ぎに銀行へ行く。",             "銀行へ行く"],
        ["夜に資料を出す。",                 "資料を出す"],
        ["午前中に資料を作る。1時間。",      "資料を作る"],
        ["夕方以降に資料を作る。",           "資料を作る"],
        ["朝のうちに洗濯する。",             "洗濯する"]
      ];
      for (const [text, want] of titleCases) {
        reset();
        await say(text, T(9, 0));
        const it = state.items.find(i => i.kind === "task" || i.kind === "event");
        ok("T. 見出しに日時のかけらを残さない：" + text,
           !!it && it.title === want, it ? "「" + it.title + "」" : "何も作られない");
      }

      reset();
      /* **落としすぎない。** 時間帯の言葉が「いつやるか」ではなく**内容そのもの**のことがある。
         食事の名前（夕食）や、体調・わたしのことの文は、そのまま残すこと。 */
      for (const [text, word] of [["夕食の買い出しをする。", "夕食"],
                                  ["夜はいつも頭が痛くなる。", "夜"],
                                  ["夕方になると集中が切れる。", "夕方"]]) {
        reset();
        await say(text, T(9, 0));
        const kept = state.items[0];
        ok("T. 内容そのものの時間帯は消さない：" + text,
           !!kept && kept.title.includes(word), kept ? "「" + kept.title + "」" : "何も作られない");
      }
      /* **読み取る側と落とす側で、同じ一覧を使うこと**（決まり7e）。
         片方に語を足して、もう片方に足し忘れる——それが今回の原因だった。 */
      ok("T. 時間帯の言い方は1か所にまとめてある",
         /RE_WIN_MORNING/.test(String(parseIntent)) && /RE_CUT_WINDOW/.test(String(cleanTitle)),
         "どちらかが自前の正規表現を持っている");

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
      /* 2026-09-27：過ぎた「午前10時」は翌朝の10時（言った瞬間に過ぎた予定にしない）。午前のままなのは変わらない */
      ok("U. 「午前10時」と言われたら、21時でも午前のまま（過ぎているので翌朝）",
         f(w.start) === "9/13 10:00", f(w.start));

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
        ok("AE. 読み込めていないぶんまで消し切る関数がある", typeof wipeCollection === "function");
        /* 2026-09-28 本人の指示で「記録をさがす」と .ics の読み書きを外した（Googleカレンダーと自動で同期するので .ics は役目が重なった）。
           **書き出す・読み込むは残す**（記録はスマホの中にしか無く、なくしたときに戻せる道はここだけ）。 */
        ok("AE. 「記録をさがす」と .ics の読み書きは外した（戻っていない）",
           !document.querySelector("#findQ") && !document.querySelector("#btnIcsIn") && !document.querySelector("#btnIcsOut") && !document.querySelector("#icsFile")
           && typeof parseICS === "undefined" && typeof importICS === "undefined");
        const dataCard = document.querySelector("#btnExport") && document.querySelector("#btnExport").closest(".card");
        ok("AE. 記録の置き場所・件数の注意は「持ち出す・持ち込む」の欄へ、作業時間の直し方は設定の欄へ引っ越した（知らせを捨てていない）",
           !!dataCard && !!dataCard.querySelector("#whereNote") && !!dataCard.querySelector("#dataWarn")
           && !!document.querySelector("#windowWarn") && !!document.querySelector("#windowWarn").closest(".card") && !!document.querySelector("#windowWarn").closest(".card").querySelector("#theme"));
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
        /* 右上のバッジは外した（2026-09-26）。見張るのは**知らせる道**のほう——
           圏外に入った／戻ったときの受け口（保存先があるときにトーストを出す）。 */
        ok("AF. 圏外を見張っている",
           Array.from(document.scripts).some(s => /addEventListener\("offline"/.test(s.textContent) && /function\s+setSync/.test(s.textContent)));
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

        /* AM. 引き戻しは今までどおり効く。ただし**返事では知らせない**
           （2026-09-21・本人の指示「日付は言っていなかったので〜の文章はいらない」）。
           消したのは文章だけで、日付を直す動き（決まり7d）はそのまま。
           直った日付は項目の行に出ていて、そこから直せる。 */
        reset();
        const n5 = mkNote("6〜9時の間に30分勉強する"); await putNote(n5);
        const r5 = await applyOps([{ op: "add", kind: "task", title: "勉強する", dueDate: tom,
          duePrecision: "day", estimateMin: 30, quote: "30分勉強する" }], n5);
        const a5 = state.items.find(i => i.kind === "task");
        ok("AM. 日付は今までどおり引き戻す", !!a5 && a5.dayKey === KEY, a5 && a5.dayKey);
        ok("AM. 引き戻した印は残す", !!a5 && a5.dateInferred === true, a5 && String(a5.dateInferred));
        ok("AM. 引き戻したことを、返事には書かない",
           !r5.asks.some(a => /日付は言っていなかったので/.test(a)), JSON.stringify(r5.asks));

        // 日付を言っているときも、もちろん何も言わない
        reset();
        const n6 = mkNote("明日までに資料を出す"); await putNote(n6);
        const r6 = await applyOps([{ op: "add", kind: "task", title: "資料を出す", dueDate: tom,
          duePrecision: "day", quote: "資料を出す" }], n6);
        ok("AM. 日付を言っていれば、断りを入れない",
           !r6.asks.some(a => /日付は言っていなかったので/.test(a)), JSON.stringify(r6.asks));

        // 言い直し（時刻だけ）でも、日付は守るが文章は出さない
        reset();
        const ev3 = { id: uid(), kind: "event", title: "打ち合わせ", fixed: true,
          start: zoned(...tom.split("-").map(Number), 15, 0, TZ).toISOString(),
          end: zoned(...tom.split("-").map(Number), 16, 0, TZ).toISOString(),
          dayKey: tom, duePrecision: "exact", origin: "user", confirmed: true, corrected: false,
          status: "open", evidence: { text: "x" }, createdAt: T(9, 0), updatedAt: "", history: [] };
        ev3.dedupeKey = dedupeKey(ev3); await putItem(ev3);
        const n7 = mkNote("15時じゃなくて14時だった"); await putNote(n7);
        const r7 = await applyOps([{ op: "update", id: ev3.id, dueDate: KEY, dueTime: "14:00", quote: "14時" }], n7);
        const e7 = findItem(ev3.id);
        ok("AM. 言い直しでは日付を守り、時刻だけ直す",
           !!e7 && e7.dayKey === tom && parts(new Date(e7.start), TZ).h === 14,
           e7 && (e7.dayKey + " " + fmtDT(e7.start, TZ)));
        ok("AM. そのときも返事には書かない",
           !r7.asks.some(a => /日付は言っていなかったので/.test(a)), JSON.stringify(r7.asks));
        /* 消した文章が、どこかで生き返っていないこと（ソース全文は検索しない＝決まり）。
           関数ごと消したので、名前が残っていないかを見る。 */
        ok("AM. 断り文を作る関数は、もう無い",
           typeof pulledBackAsk === "undefined"
           && !/日付は言っていなかったので/.test(String(applyOps) + String(applyFields)),
           "まだ残っている");

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

          /* 12時間ずれていない、**言っていない時刻**（23:30）。前は「12時間ちょうどでなければ触らない」でそのまま入っていた。
             2026-09-28 に本人の指示（前からの弱点を直して）で変えた：言っていない時刻は採らず、**言った時刻（23:00）**にする（wordCheck ②）。 */
          reset();
          const nc = late("11時から12時まで勉強する"); await putNote(nc);
          await applyOps([{ op: "add", kind: "event", title: "勉強する", dueDate: "2026-09-13",
            dueTime: "23:30", duePrecision: "exact", estimateMin: 30, quote: "勉強する" }], nc);
          const ic = state.items.find(i => i.kind === "event");
          ok("AO. 12時間ちょうどでないずれでも、言っていない時刻（23:30）は採らず、言った時刻（23:00）にする",
             !!ic && fmtDT(ic.start, TZ) === "9/13 23:00", ic && fmtDT(ic.start, TZ));

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
            /* 観測するのは**実際の引き戻し**。断りの文章は 2026-09-21 に本人の指示で
               消したので、目印には使えない。
               **「日付が tom から動いたか」で見てはいけない**——引き戻した先が
               たまたま tom になることがある（「6〜9時の間に」を11時に言うと、
               決まり4b が翌日へ送る）。実際それで2件すべった。
               引き戻したかどうかは `dateInferred` が持っている。
               ここの op は `dueTime` を渡していないので、
               12時間ズレの直し（あれも `dateInferred` を立てる）とは混ざらない。 */
            const made = state.items.find(i => i.title === "なにか");
            const pulled = !!made && made.dateInferred === true;
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
        <span class="chip st-drop">取り消し</span>
        <span class="chip src-rule">読み取ったまま</span>`;
      document.body.appendChild(box);
      const targets = [".nowtag", ".chip.src-user", ".chip.src-ai", ".btn.pri", ".chip.vague",
                       ".chip.st-done", ".chip.st-drop", ".chip.src-rule"];
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
      /* 1000件は claude.ai の保存先から1回に読める上限。**保存先につながっているときだけ**の話（2026-09-27） */
      const keepDBx = DB;
      DB = DB || {};
      showTab("p-set"); renderSettings();
      const warn = document.querySelector("#dataWarn");
      ok("X. 800件を超えたら、上限が近いと知らせる",
         !!warn && !warn.hidden && /1,?000件まで/.test(warn.textContent), warn ? warn.textContent.slice(0, 40) : "欄が無い");
      ok("X. 勝手に消さず、書き出しを促す",
         !!warn && /書き出す/.test(warn.textContent) && state.items.length === 820, state.items.length + "件");
      DB = null; renderSettings();
      ok("X. 端末の中だけ（APK）では、1000件の知らせを出さない（その上限は無い）",
         !!warn && (warn.hidden || !/1,?000件まで/.test(warn.textContent)), warn ? warn.textContent.slice(0, 40) : "欄が無い");
      DB = keepDBx;

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
         **「AIが使えなくなった」**と読んだ。v7.9 では印に理由を足したが、
         **2026-09-26 に印そのものを外した**（本人の指示「余計な部分をそぎ落として」）。
         印が無ければ、取り違える元も無い。見張るのは「印が戻っていないこと」。 */
      {
        const html = turnHTML({ role: "assistant", text: "はい", at: "2026-09-14T03:00:00Z",
                                ai: false, aiQuiet: true, plan: null });
        ok("BC. 返事に読み取り方の印を出さない",
           !/読み取り/.test(html.replace(/<[^>]+>/g, "")), html.replace(/<[^>]+>/g, "").trim().slice(-30));
      }
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
        /* **AIからは聞かせない**（2026-09-21・本人の指示
           「まだ聞けていないことの問いかけの機能を消して」）。
           聞く場所は「わたしのこと」タブの欄だけ——押すかどうかは本人が決める。
           `telosGaps()` はその欄が今までどおり使うので、上の判定は生きている。 */
        ok("BD. まだ聞けていないことを、AIには渡さない",
           !/【まだ聞けていないこと】/.test(pAll), "まだ渡している");
        ok("BD. AIから質問させない", /こちらから質問をしないでください/.test(pAll), "頼んでいない");
        ok("BD. 返す形に「ask」を残していない", !/"ask"/.test(pAll), "まだ求めている");
        /* **欄そのものは残っている。**消したのは「AIが聞いてくること」だけ。 */
        state.items = [];
        showTab("p-me"); renderMe();
        const meTxt = $("#meOut").textContent.replace(/\s+/g, " ");
        /* ボタンの文言は「話す」に縮めた（2026-09-26・1枚の中に行で並べる形）。
           **文言ではなく、押せるボタンがあることを見る**（決まり15b「目印は、いまも画面に出るものへ」）。 */
        ok("BD. 「まだ聞いていないこと」の欄は残す",
           /まだ聞いていないこと/.test(meTxt) && !!$('#meOut [data-act="telosask"]'), meTxt.slice(0, 80));
        ok("BD. 質問は1枚の中に行で並ぶ（1問1枚にしない）",
           document.querySelectorAll('#meOut .qlist .qrow').length === telosGaps().length
             && document.querySelectorAll('#meOut .qlist').length === 1,
           document.querySelectorAll('#meOut .qrow').length + "行 / "
             + document.querySelectorAll('#meOut .qlist').length + "枚");

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

    /* ===== BF群：AIを呼ぶ道（v8.2 → 2026-09-21 に画面を外した）=====
       いちばん大事なのは **キーが共有の場所へ出ていかないこと**。
       `db` はリンクを開いた人に渡る（実機で確認済み）ので、キーが入ったら漏れる。
       **設定タブのAIの欄は、本人の指示でまるごと外した**（2026-09-21・
       「キーを埋め込みたい。そしてAIに関する項目ごと消したい」）。
       だから **入口は焼き込み（`window.HITOHI_AI`）だけ**で、
       画面から貼る道・消す道・モデル名を直す道は、どれも無い。
       **消したものは、消えたままだと確かめること**——12b で欄を外したときと同じで、
       次のセッションが「親切のつもりで」戻すのを、ここで止める。 */
    {
      const keepFn = SAMPLEFN, had = window.HITOHI_AI;

      /* ① 画面から消えたものが、生き返っていないこと */
      for (const [id, name] of [["aiProv", "どこのAI"], ["aiModel", "モデル名"],
                                ["aiKey", "APIキーの入力欄"], ["aiState", "AIの状態"],
                                ["aiSendNote", "送信の説明"], ["btnAiTest", "つながるか試す"],
                                ["btnAiSave", "保存する"], ["btnAiClear", "消す"]])
        ok("BF. 設定タブに「" + name + "」は無い", !document.getElementById(id), "まだ画面にある");
      ok("BF. パスワード欄（キーの貼り付け先）がどこにも無い",
         document.querySelectorAll('input[type=password]').length === 0,
         String(document.querySelectorAll('input[type=password]').length));

      /* ② 焼き込んだキーは、設定にも書き出しにも混ざらない */
      window.HITOHI_AI = { provider: "claude", key: "sk-ant-TESTKEY-do-not-use", model: "claude-opus-5" };
      ok("BF. キーは設定（共有の保存先へ行くもの）に入らない",
         !JSON.stringify(state.settings).includes("sk-ant-TESTKEY"), "設定に混ざっている");
      ok("BF. キーは書き出すJSONに入らない",
         !exportPayload().includes("sk-ant-TESTKEY"), "書き出しに混ざっている");

      /* ③ 窓口の形は `sample` と同じ（呼ぶ側の3か所を変えなくていい） */
      const f = ownAI({ provider: "claude", key: "k", model: "m", builtIn: true });
      ok("BF. 窓口の形が `sample` と同じ（呼ぶ側を変えなくていい）",
         typeof f === "function" && typeof f.json === "function" && typeof f.limits === "function",
         typeof f + "/" + typeof f.json);
      ok("BF. どこのAIかの印を持つ", f.own === "claude", String(f.own));
      ok("BF. 焼き込みかどうかの印を持つ", f.builtIn === true, String(f.builtIn));

      ok("BF. 焼き込んだキーがあれば、それで動く",
         applyOwnAI() === true && SAMPLEFN.own === "claude", String(SAMPLEFN && SAMPLEFN.own));
      delete window.HITOHI_AI;
      SAMPLEFN = null;
      ok("BF. キーが無ければ窓口を触らない", applyOwnAI() === false, "触っている");

      /* AIは ```json で包んで返すことがある。包みと前後の言葉を外して読む。 */
      ok("BF. 包まれたJSONを読める",
         jsonFromText('はい。\n```json\n{"ops":[],"reply":"あ"}\n```\nどうぞ').reply === "あ", "読めない");
      ok("BF. 裸のJSONも読める", jsonFromText('{"a":1}').a === 1, "読めない");
      ok("BF. 配列も読める", jsonFromText('[{"a":1}]')[0].a === 1, "読めない");
      /* **読めなかったときは、何が返ってきたのかを書く**（2026-09-21・実機の調査中）。
         素の JSON.parse の文だけでは「空が返った」と「文章が返った」を区別できない。 */
      const parseFail = s => { try { jsonFromText(s); return ""; } catch (e) { return String(e.message || e); } };
      ok("BF. 空が返ったときは、空だったと言う",
         /空っぽ/.test(parseFail("")), parseFail(""));
      ok("BF. 文章が返ったときは、その文章を見せる",
         /ごめんなさい/.test(parseFail("ごめんなさい、それはできません")), parseFail("ごめんなさい、それはできません"));
      ok("BF. 読めなかった理由そのものも残す",
         /JSON/.test(parseFail("ごめんなさい")), parseFail("ごめんなさい"));

      /* 呼べなかった理由を、本人が打てる手に翻訳する（決まり6n と同じ理屈）。
         **画面にAIの欄が無くなったぶん、ここが理由を読める唯一の場所**になった
         （チャットの吹き出しに出る）。だから文言を薄くしないこと。 */
      ok("BF. 通信そのものが止められたと分かる文にする",
         /外部への通信が禁じられている/.test(ownAIError(new TypeError("Failed to fetch"), "api.example")),
         ownAIError(new TypeError("Failed to fetch"), "api.example"));
      ok("BF. 相手が返した理由は、そのまま見せる",
         ownAIError(new Error("Claude 401：invalid x-api-key"), "h") === "Claude 401：invalid x-api-key",
         ownAIError(new Error("Claude 401：invalid x-api-key"), "h"));

      /* **理由が、画面まで届くこと**（2026-09-21・実機で報告）。
         `ownAICall` は `code` を持たない素の `Error` を投げるので、
         `AI_ERR[e.code]` は必ず空振りする。そこで定型文に置き換えていたため、
         `Gemini 400：API key not valid` が**捨てられていた**。
         決まり13c で画面の欄を外した以上、**ここが唯一の読み口**。 */
      ok("BF. 知っている理由は、やさしい文に訳す",
         aiFailNote({ code: "rate_limited" }) === AI_ERR.rate_limited, aiFailNote({ code: "rate_limited" }));
      ok("BF. 相手が返した理由を、定型文で塗りつぶさない",
         /Gemini 400/.test(aiFailNote(new Error("Gemini 400：API key not valid"))),
         aiFailNote(new Error("Gemini 400：API key not valid")));
      ok("BF. 外部通信が禁じられている理由も、そのまま出す",
         /外部への通信が禁じられている/.test(aiFailNote(new Error(ownAIError(new TypeError("Failed to fetch"), "api.example")))),
         aiFailNote(new Error(ownAIError(new TypeError("Failed to fetch"), "api.example"))));
      ok("BF. 何も分からないときだけ、既定の文にする",
         /接続できなかった/.test(aiFailNote(new Error(""))), aiFailNote(new Error("")));
      ok("BF. 発話の処理が、その訳を実際に使っている",
         /aiFailNote/.test(String(sendTurn)), "定型文のままかもしれない");

      /* **混み合っているだけのときは、そう言う**（2026-09-21・実機で 503 が出た）。
         本人のせいではないし、打つ手も違う（待てばよい）。
         見分けるのは**番号**で、文字ではない——提供元が文言を変えても効くように。 */
      const busy503 = Object.assign(new Error("Gemini 503：This model is currently experiencing high demand."), { status: 503 });
      ok("BF. 混雑は、日本語で「待てばよい」と伝える",
         /時間をおいて/.test(aiFailNote(busy503)), aiFailNote(busy503));
      ok("BF. 混雑でも、相手の言葉は捨てない",
         /Gemini 503/.test(aiFailNote(busy503)), aiFailNote(busy503));
      ok("BF. 429 も同じ扱い",
         /時間をおいて/.test(aiFailNote(Object.assign(new Error("Claude 429：rate limit"), { status: 429 }))), "扱えていない");
      ok("BF. ほかの番号は、混雑あつかいにしない",
         !/時間をおいて/.test(aiFailNote(Object.assign(new Error("Gemini 400：bad key"), { status: 400 }))),
         aiFailNote(Object.assign(new Error("Gemini 400：bad key"), { status: 400 })));
      ok("BF. 混み合ったときは、1回だけ入れ直す",
         /ownAICallOnce/.test(String(ownAICall)) && /isBusy/.test(String(ownAICall)), "やり直していない");
      ok("BF. 入れ直すのは1回だけ（何度も試さない）",
         (String(ownAICall).match(/ownAICallOnce/g) || []).length === 2, "回数がおかしい");

      /* **モデルに合わせた調整が、本当に送られていること**（2026-09-24・本人の指示
         「モデルが新しく高性能になったので最適化して」）。
         決まり7b の「1〜2秒で受け止める」は、**Claude の側にしか効いていなかった**
         ——`quick` を計算しているのに、Gemini へ送る中身には1つも入っていなかった。
         だから見るのは関数の字面ではなく、**実際に出ていく中身**。
         `aiPost` を差し替えて捕まえる。 */
      {
        const keepPost = aiPost, keepPlain = geminiPlain, keepQL = geminiQuickLow;
        const good = { ok: true, status: 200,
                       data: { candidates: [{ content: { parts: [{ text: '{"ops":[]}' }] } }] } };
        let sent = [];
        aiPost = async (url, head, body) => { sent.push(body); return good; };
        const g = ownAI({ provider: "gemini", key: "k", model: "gemini-3.5-flash-lite" });

        geminiPlain = false; geminiQuickLow = false; sent = [];
        await g("やあ", { modelTier: "quick" });
        ok("BF. 速い返事には、軽く考える指示を渡す",
           sent.length === 1 && sent[0].generationConfig && sent[0].generationConfig.thinkingConfig
             && sent[0].generationConfig.thinkingConfig.thinkingLevel === GEMINI_THINK.quick,
           JSON.stringify(sent[0] && sent[0].generationConfig));
        /* 深さは thinkingConfig の中に書く（Gemini の決まり）。直下に書くと毎回 400 で断られ、素の形に落ちていた（2026-09-28） */
        ok("BF. 考える深さは thinkingConfig の中に書く（generationConfig の直下に書かない）",
           !("thinkingLevel" in (sent[0].generationConfig || {})), JSON.stringify(sent[0] && sent[0].generationConfig));
        ok("BF. 受け止めの一言は minimal（考えない・2026-09-28 本人「最小を採用する」）",
           ((sent[0].generationConfig || {}).thinkingConfig || {}).thinkingLevel === "minimal", JSON.stringify(sent[0] && sent[0].generationConfig));
        ok("BF. 速い返事に、JSONで返せとは言わない",
           !(sent[0].generationConfig || {}).responseMimeType, "言っている");

        sent = [];
        await g.json("読み取って", { modelTier: "default" });
        ok("BF. 読み取りにも、深く考えさせない（low・2026-09-28 本人の指示。考えた量も料金に入る）",
           ((sent[0].generationConfig || {}).thinkingConfig || {}).thinkingLevel === "low",
           JSON.stringify(sent[0].generationConfig));
        ok("BF. 読み取りのときだけ、JSONで返せと言う",
           (sent[0].generationConfig || {}).responseMimeType === "application/json",
           JSON.stringify(sent[0].generationConfig));
        ok("BF. どちらにも medium・high（深く考える）を渡さない",
           !["medium", "high"].includes(GEMINI_THINK.quick) && !["medium", "high"].includes(GEMINI_THINK.deep), JSON.stringify(GEMINI_THINK));

        /* **400（送り方が違う）なら、調整をやめて1回だけ入れ直す。**
           受け取る名前はモデルで違うので、名前を1つ間違えただけで
           AIがまるごと死ぬ状態にしてはいけない（画面から直す道が無い・決まり13c）。 */
        geminiPlain = false; geminiQuickLow = false; sent = [];
        let n = 0;
        aiPost = async (url, head, body) => {
          sent.push(body); n++;
          return n === 1
            ? { ok: false, status: 400, data: { error: { message: "Unknown name" } } }
            : good;
        };
        let got = null, why = "";
        try { got = await g.json("読み取って", { modelTier: "default" }); }
        catch (e) { why = String(e.message || e); }
        ok("BF. 送り方を断られたら、素の形で入れ直して通す",
           !!got && Array.isArray(got.ops), why || JSON.stringify(got));
        ok("BF. 入れ直す2回目は、調整を外して送る",
           sent.length === 2 && !sent[1].generationConfig,
           sent.length + "回 " + JSON.stringify(sent[1]));
        sent = []; n = 9;
        try { await g.json("もう一度", { modelTier: "default" }); } catch {}
        ok("BF. 一度断られたら、その後は最初から素で送る（毎回2回呼ばない）",
           sent.length === 1 && !sent[0].generationConfig, JSON.stringify(sent[0]));

        /* **minimal を断られたら、素ではなく low へ一段だけ戻す**（2026-09-28）。素（モデル任せの深さ）に落ちると、
           受け止めの一言がかえって重くなり、読み取りまで素になる——minimal を避けていた理由はこれだった。 */
        geminiPlain = false; geminiQuickLow = false; sent = []; n = 0;
        aiPost = async (url, head, body) => {
          sent.push(body); n++;
          const lv = ((body.generationConfig || {}).thinkingConfig || {}).thinkingLevel;
          return lv === "minimal" ? { ok: false, status: 400, data: { error: { message: "minimal is not supported" } } } : good;
        };
        let q1 = null, q1err = ""; try { q1 = await g("やあ", { modelTier: "quick" }); } catch (e) { q1err = String(e.message || e); }
        const lvOf = b => ((b && b.generationConfig || {}).thinkingConfig || {}).thinkingLevel || "素";
        ok("BF. minimal を断られたら、low で1回だけ入れ直して通す（素に落とさない）",
           !!q1 && !q1err && sent.length === 2 && lvOf(sent[1]) === "low" && geminiPlain === false,
           sent.map(lvOf).join("→") + " / " + (q1err || JSON.stringify(q1)));
        sent = [];
        await g("もう一度", { modelTier: "quick" });
        await g.json("読み取って", { modelTier: "default" });
        ok("BF. そのあとの受け止めの一言は最初から low・読み取りは low のまま（巻き込まない・毎回2回呼ばない）",
           sent.length === 2 && lvOf(sent[0]) === "low" && lvOf(sent[1]) === "low", sent.map(lvOf).join(" / "));
        // low まで断られるモデルなら、そのときは今までどおり素へ
        sent = []; n = 0;
        aiPost = async (url, head, body) => { sent.push(body); return body.generationConfig ? { ok: false, status: 400, data: { error: { message: "Unknown name" } } } : good; };
        await g("やあ", { modelTier: "quick" });
        ok("BF. low まで断られたら、素の形で入れ直す", sent.length === 2 && lvOf(sent[1]) === "素" && geminiPlain === true, sent.map(lvOf).join("→"));

        /* 400 以外は「送り方」の話ではない。入れ直さず、理由をそのまま出す。 */
        geminiPlain = false; geminiQuickLow = false; sent = [];
        aiPost = async (url, head, body) => { sent.push(body);
          return { ok: false, status: 401, data: { error: { message: "API key not valid" } } }; };
        let msg = "";
        try { await g("やあ", { modelTier: "quick" }); } catch (e) { msg = String(e.message || e); }
        ok("BF. 401 は入れ直さない（送り方の話ではない）", sent.length === 1, sent.length + "回");
        ok("BF. 401 の理由は、そのまま残る", /Gemini 401/.test(msg), msg);

        aiPost = keepPost; geminiPlain = keepPlain; geminiQuickLow = keepQL;
      }

      /* 既定のモデルは、**1日に使える回数が多いほう**（2026-09-24・実機の使用状況で判明）。
         無印の Flash は1日20回。1発言につき2回呼ぶので**1日10発言で止まる**。
         Lite は1日500回。速さや賢さより先に、**その日じゅう使えること**。 */
      ok("BF. Gemini の既定は、1日に多く使えるモデル",
         /-lite$/.test(AI_PROVIDERS.gemini.model), AI_PROVIDERS.gemini.model);

      if (had === undefined) delete window.HITOHI_AI; else window.HITOHI_AI = had;
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

      /* 背景色を殻へ伝える（v8.4・実機で報告）。上下のシステムバーの裏に敷く色。
         **殻が無ければ何も起きない**・**形を確かめてから送る**の2つを固定する。 */
      {
        const keepTheme = state.settings.theme;
        /* **色の値をここに直書きしない**（決まり7e）。書くと配色を変えるたびに
           テストだけが古くなる（実際、黒と白にしたときにここだけ緑のままで落ちた）。
           確かめるのは「本体の `--paper` がそのまま届くか」と「暗いときは本当に暗いか」。 */
        const paperNow = () => String(getComputedStyle(document.documentElement)
          .getPropertyValue("--paper") || "").trim().toLowerCase();
        const lumOf = h => { const n = parseInt(h.slice(1), 16);
          return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
        sent.length = 0;
        applyTheme("dark");
        const dk = sent.find(m => m && m.kind === "chrome");
        ok("BG. 明暗を変えたら背景色を殻へ伝える", !!dk, JSON.stringify(sent));
        ok("BG. 伝えるのは色として読める形だけ",
           !!dk && /^#[0-9a-fA-F]{6}$/.test(dk.bg), dk && dk.bg);
        ok("BG. 暗いときは、本体の背景色をそのまま伝える",
           !!dk && dk.bg.toLowerCase() === paperNow(), (dk && dk.bg) + " / 本体 " + paperNow());
        ok("BG. 暗いときは本当に暗い色になっている",
           !!dk && lumOf(dk.bg) < 90, dk && dk.bg + " 明るさ" + (dk ? Math.round(lumOf(dk.bg)) : "-"));

        sent.length = 0;
        applyTheme("light");
        const lt = sent.find(m => m && m.kind === "chrome");
        ok("BG. 明るいときは、本体の背景色をそのまま伝える",
           !!lt && lt.bg.toLowerCase() === paperNow(), (lt && lt.bg) + " / 本体 " + paperNow());
        ok("BG. 明るいときは本当に明るい色になっている",
           !!lt && lumOf(lt.bg) > 160, lt && lt.bg + " 明るさ" + (lt ? Math.round(lumOf(lt.bg)) : "-"));

        /* 殻が無いときは、1件も送らない（ブラウザで動かしている人には何も起きない）。 */
        const keepRN2 = window.ReactNativeWebView;
        window.ReactNativeWebView = undefined;
        ok("BG. 殻が無ければ背景色を送らない", tellNativeTheme() === false, "送った");
        window.ReactNativeWebView = keepRN2;

        applyTheme(keepTheme);
      }

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

        /* ④ 通知から「完了」を押したときの道（2026-09-24・案⑦）。
           **殻は運ぶだけで、決めるのはこちら。**だから来た値は全部疑う。 */
        ok("BG. どの用事のことかを通知に持たせる",
           list.length > 0 && list[0].id === "g1" && list[0].day === DAY,
           JSON.stringify({ id: list[0] && list[0].id, day: list[0] && list[0].day }));

        const gone = () => (findItem("g1") || {}).status;
        ok("BG. 知らない操作は受け取らない",
           notifyAction({ kind: "notifyaction", action: "delete", id: "g1", day: DAY }) === false
           && gone() === "open", "受け取った");
        ok("BG. 知らない用事は受け取らない",
           notifyAction({ kind: "notifyaction", action: "done", id: "zzz", day: DAY }) === false,
           "受け取った");
        ok("BG. 中身が空でも落ちない",
           notifyAction({}) === false && notifyAction(null) === false, "落ちた");
        /* **本当に完了になるところまで見る**（在ることの確認では代用できない）。 */
        ok("BG. 通知の「完了」で、その用事が終わりになる",
           notifyAction({ kind: "notifyaction", action: "done", id: "g1", day: DAY }) === true,
           "受け取らなかった");
        await waitUntil(() => gone() === "done", 800);
        ok("BG. 押したあと、状態が done になっている", gone() === "done", String(gone()));
        /* 画面で先に終わらせていたら、二度目は何も言わない（同じ知らせを2回出さない）。 */
        ok("BG. もう終わっているものは、黙って何もしない",
           notifyAction({ kind: "notifyaction", action: "done", id: "g1", day: DAY }) === false,
           "二度受け取った");
        /* 殻からの生の文字（JSON）でも同じ道に入る。 */
        state.items.find(i => i.id === "g1").status = "open";
        ok("BG. 殻から来た生の文字でも受け取る",
           window.hitohiNative(JSON.stringify(
             { kind: "notifyaction", action: "done", id: "g1", day: DAY })) === true,
           "受け取らなかった");
        await waitUntil(() => gone() === "done", 800);
        ok("BG. 生の文字からでも、終わりになる", gone() === "done", String(gone()));
        hideToast();
        state.items = keepI;
      }

      if (keepRN === undefined) delete window.ReactNativeWebView;
      else window.ReactNativeWebView = keepRN;
    }

    /* ===== BH群：記録の置き場所を、開き方から書く（2026-09-20・APKを本物にした日）=====
       Android アプリには `db` が無い。**固定の文を置くと、片方では必ず嘘になる**——
       実際、設定タブには「このページを共有している間は、記録も共有されます」が
       固定で書いてあり、APK では**共有の場所そのものが無い**のに出ていた。 */
    {
      const keepDB = DB;
      /* **画面を丸ごと検索しないこと**（記録済みの穴）。`innerHTML` にはこのテスト自身の
         文字列も入るので、同じ regex が必ず当たる（実際、最初それで誤検知した）。
         見るのは**関数の中身**と、**描いたあとの本文**。 */
      ok("BH. 置き場所の文は、関数が書いている（固定で埋め込まない）",
         /whereNote/.test(String(renderWhere)) && /DB\s*\n?\s*\?/.test(String(renderWhere)),
         "renderWhere が分岐していない");

      // 端末の中だけ（＝Android アプリ・独立したサイト）
      DB = null; renderWhere();
      const local = $("#whereNote").textContent;
      ok("BH. つながっていなければ、設定タブに「共有」の話が出ない",
         !/共有の場所/.test($("#p-set").textContent), "共有の話が残っている");
      /* **端末の中だけのときは、何も出さない**（2026-09-26・本人の指示
         「この端末のみという表示はいらない」）。端末に記録を置くのはアプリとしてふつうのことで、
         知らせる事実が無い。**文を空にするだけでなく、欄ごと隠れていること**——
         `.note` は枠と地の色を持つので、中身が空でも灰色の箱が残る。 */
      ok("BH. つながっていなければ、置き場所の欄ごと出さない",
         $("#whereNote").hidden === true, "hidden=" + $("#whereNote").hidden);
      ok("BH. 「この端末のみ」「この端末の中だけ」と書かない",
         !/この端末(のみ|の中だけ)/.test(local), local.slice(0, 40));
      ok("BH. 共有していると言わない", !/リンクを開いた人/.test(local), local.slice(0, 40));
      /* **控えの取り方は、文ではなくボタンで示す**（2026-09-25）。
         そのボタンは同じタブのすぐ下に見えている（決まり15b「目印は、いまも画面に出るものへ」）。 */
      {
        /* **見えているかを測るなら、先にそのタブを開くこと。**
           開かずに測ると高さが 0 になり、**ボタンがあっても「無い」と出る**
           （決まり15d の「入力バーは会話タブでしか描かれない」と同じ穴を踏んだ）。 */
        const keepT = view.tab;
        showTab("p-set");
        const b = Array.from($("#p-set").querySelectorAll("button"))
          .find(x => /書き出す/.test(x.textContent));
        ok("BH. 控えを取る道が、同じ画面にボタンとして出ている",
           !!b && b.getBoundingClientRect().height > 1,
           b ? "高さ" + Math.round(b.getBoundingClientRect().height) + "px" : "ボタンが無い");
        showTab(keepT);
      }

      // 共有の保存先につながっているとき（＝Artifact）
      DB = { doc: () => ({}) }; renderWhere();
      const shared = $("#whereNote").textContent;
      /* **事実と条件は残す。助言は消した**（2026-09-25）。
         「共有されている」という事実だけでなく、**「見られて困るものを入れない」という
         条件も画面に残すこと**——共有したままにする判断は、その条件つきで
         本人が決めたもので、条件が消えたら判断ごと壊れる（CLAUDE.md）。
         「本当の予定は Android アプリのほうへ」は**助言**なので消した。
         どちらを本物にするかは決まっていて、毎回読ませる必要が無い。
         **消したものを見張り続けない**（決まり15b）ので、その1件はここから外した。 */
      ok("BH. つながっていれば、置き場所の欄を出す", $("#whereNote").hidden === false, "隠れている");
      /* **2026-09-26 に本人が共有をやめた。** 「リンクを開いた人に見えるので、見られて困ることは
         入れないでください」は共有しているときの条件で、いまは嘘になる。共有しているかどうかは
         ページからは分からないので、**どちらでも本当の1文**（共有すると見える）にした。 */
      ok("BH. つながっていれば、共有したら記録も見えることを言う", /共有すると/.test(shared) && /開いた人にも/.test(shared), shared.slice(0, 50));
      ok("BH. いま共有している、と決めつけない（本人が共有をやめた）",
         !/見えるので|入れないでください|リンクを開いた人に見え/.test(shared), shared.slice(0, 60));
      ok("BH. ただし助言までは書かない（短く保つ）",
         shared.length <= 60, shared.length + "字：" + shared.slice(0, 70));

      DB = keepDB; renderWhere();
    }

    /* ===== BI. iOS の配色と、飾りの文字（2026-09-20・本人の指示） =====
       「白と黒というのは却下」。iOS を参考にした配色に戻した（決まり15）。
       **色の値をここに直書きしない**（決まり7e・BG群で一度それをやって落ちた）。
       確かめるのは「どの色か」ではなく、**iOS の配色が満たすべき性質**：
       ① accent に色みがある（灰色に戻っていない） ② accent は青系
       ③ 意味の色（accent / warn / done / alert）が互いに別の色
       ④ **「-ink」は必ず「-soft」の上で読める**——W群 はチップしか見ていないので、
          `.note.bad` や `.btn` のような**地の広い場所**はここで見張る。 */
    {
      const lum = c => {
        const m = /^#([0-9a-fA-F]{6})$/.exec(String(c).trim());
        if (!m) return -1;
        const n = parseInt(m[1], 16);
        const v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
          .map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      };
      const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
      const rgb = c => { const n = parseInt(String(c).trim().slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
      const chroma = c => { const [r, g, b] = rgb(c); return Math.max(r, g, b) - Math.min(r, g, b); };
      // 色相（0〜360）。色みが無いものは -1（比べる意味が無い）
      const hue = c => {
        const [r, g, b] = rgb(c).map(x => x / 255);
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        if (d < 0.02) return -1;
        let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h *= 60; return h < 0 ? h + 360 : h;
      };
      const apart = (a, b) => { const d = Math.abs(hue(a) - hue(b)); return Math.min(d, 360 - d); };

      const before = document.documentElement.getAttribute("data-theme");
      for (const theme of ["light", "dark"]) {
        document.documentElement.setAttribute("data-theme", theme);
        const cs = getComputedStyle(document.documentElement);
        const V = k => String(cs.getPropertyValue(k) || "").trim();

        ok("BI. accent に色みがある（灰色に戻っていない・" + theme + "）",
           chroma(V("--accent")) >= 40, V("--accent") + " 色み" + chroma(V("--accent")));
        /* **accent はこのアプリの緑（青緑）**（2026-09-21・本人の指示「配色はやっぱり緑にして」）。
           一度 iOS の systemBlue にしたが、戻した。色相の帯で見る——
           どの緑かは決めない（明暗で値が違うし、微調整も入る）。 */
        const h = hue(V("--accent"));
        ok("BI. accent は緑系（青緑・色相140〜200度）（" + theme + "）",
           h >= 140 && h <= 200, V("--accent") + " 色相" + Math.round(h));
        // 意味の色が近すぎると、見分けが付かない
        const pairs = [["--accent", "--warn"], ["--accent", "--done"], ["--accent", "--alert"],
                       ["--warn", "--done"], ["--warn", "--alert"], ["--done", "--alert"]];
        const near = pairs.filter(([a, b]) => apart(V(a), V(b)) < 25);
        ok("BI. 意味の色は互いに別の色（" + theme + "）", near.length === 0,
           near.map(([a, b]) => a + "×" + b + "=" + Math.round(apart(V(a), V(b))) + "度").join(" / ") || "全部離れている");

        /* **「-ink」は「-soft」の上で読めること。**
           色を戻した以上、ここが崩れると「色は付いたが読めない」になる。 */
        for (const k of ["accent", "warn", "done", "alert"]) {
          const r = ratio(V("--" + k + "-ink"), V("--" + k + "-soft"));
          ok("BI. --" + k + "-ink が --" + k + "-soft の上で読める（" + theme + "）",
             r >= 4.5, r.toFixed(2));
        }
        // ふつうのボタン（灰色の塗り × accent の文字）。W群 はチップしか見ていない
        const rb = ratio(V("--accent-ink"), V("--surface-2"));
        ok("BI. ボタンの文字が読める（" + theme + "）", rb >= 4.5, rb.toFixed(2));
      }
      if (before) document.documentElement.setAttribute("data-theme", before);
      else document.documentElement.removeAttribute("data-theme");

      /* 飾りの英語ラベル（TIMELINE / TASKS / ABOUT YOU …）は外した。
         日本語の見出しがすぐ下にあるので、同じことを2回書いていた。
         **意味を持つ日本語のラベル**（変えたこと・次にすること等）は `.eyebrow` のまま残す。 */
      const src = Array.from(document.scripts).map(x => x.textContent).join("")
        + document.documentElement.innerHTML;
      const strays = (src.match(/<span class="eyebrow">[A-Z][A-Z ]*<\/span>/g) || []);
      ok("BI. 飾りの英語ラベルを画面に出さない", strays.length === 0, strays.join(" / "));
      /* 「変えたこと」の欄は 2026-09-21 に本人の指示で返信から外した（保存は続けている）。
         目印は**いまも画面に出るラベル**に付け替える——消えたものを見張ってもしかたない。 */
      ok("BI. 意味のある日本語のラベルは残っている",
         /<span class="eyebrow">この時間に置いた理由<\/span>/.test(src)
         && /<span class="eyebrow">訂正の履歴<\/span>/.test(src), "日本語のラベルが消えている");

      /* 「データ」1枚に8操作だったのを3つに割った。**消す操作は折りたたみの中**。 */
      showTab("p-set");
      const wipe = document.querySelector("#btnWipe");
      const fold = wipe && wipe.closest("details");
      ok("BI. 「全部消す」は折りたたみの中にある", !!fold, wipe ? "たたまれていない" : "ボタンが無い");
      ok("BI. 折りたたみは閉じた状態から始まる", !!fold && !fold.open);
      ok("BI. 消す道は1つも塞いでいない",
         !!document.querySelector("#btnWipe") && !!document.querySelector("#btnTidy"));
      ok("BI. 「書き出す」が「全部消す」より上にある",
         !!wipe && document.querySelector("#btnExport").compareDocumentPosition(wipe)
           === Node.DOCUMENT_POSITION_FOLLOWING);
    }

    /* ===== BJ. 長く打ったときの入力欄（2026-09-21・実機で報告） =====
       **「枠で文字が隠れて見づらい」。原因は2つあった。**
       ① 角丸を **カプセル（999px）** にしていた。`border-radius` は**高さの半分まで育つ**ので、
          欄が150pxまで伸びると角丸が75pxになり、**1行目と最終行の左右の文字を食う**
          （実測：左から21.9px 食い込み、文字が始まる13pxより内側）。
       ② 会話の下の余白が **190px 固定**だった。入力バーは伸びて206pxになるので、
          **末尾が63px 裏に隠れていた**（実測）。
       **どちらも「1行のときだけ見て決めた値」が、伸びたときに破れた形。**
       だからここでは**伸ばしてから測る**。 */
    {
      /* **入力バーは会話タブでしか描かれない**（`body.talking` が付いたときだけ）。
         開かずに測ると高さが 0 になり、角丸の計算も 0 になって**素通りする**。
         実際そうなって、直っていないのに3件 PASS した（2026-09-21）。
         **測れていないのに通る形を残さないこと**——先に開く。 */
      const keepTab = view.tab;
      showTab("p-chat");
      const say = $("#say");
      const keepH = say.style.height;
      say.style.height = "150px";                       // 上限まで伸ばした状態で見る
      ok("BJ. 入力欄が実際に描かれている（測れていないのに通さない）",
         say.getBoundingClientRect().height > 40,
         "高さ" + Math.round(say.getBoundingClientRect().height) + "px");
      const cs = getComputedStyle(say);
      const r = say.getBoundingClientRect();
      // 角丸は「高さの半分・幅の半分」で頭打ちになる。実際に効く値で測ること
      const rad = Math.min(parseFloat(cs.borderTopLeftRadius), r.height / 2, r.width / 2);
      const padL = parseFloat(cs.paddingLeft), padT = parseFloat(cs.paddingTop);
      const lh = parseFloat(cs.lineHeight);
      // 角丸の円が、上から y の高さで左辺からどれだけ内側へ食い込むか
      const inset = y => (y >= rad ? 0 : rad - Math.sqrt(Math.max(0, rad * rad - (rad - y) * (rad - y))));
      /* **下の角丸は「下の辺からの距離」で測ること。**
         上端からの距離で測ると、欄が伸びたとき必ず `y >= rad` になって
         **壊れていても通る**（わざとカプセルへ戻して確かめたら、実際に通った）。 */
      const padB = parseFloat(cs.paddingBottom);
      const top = inset(padT + lh / 2);                 // 1行目の真ん中（上の辺から）
      const bot = inset(padB + lh / 2);                 // 最終行の真ん中（下の辺から）
      ok("BJ. 欄が伸びても、角丸が1行目の文字に食い込まない",
         top <= padL, "食い込み" + top.toFixed(1) + "px / 左余白" + padL + "px（角丸" + rad + "px）");
      ok("BJ. 欄が伸びても、角丸が最終行の文字に食い込まない",
         bot <= padL, "食い込み" + bot.toFixed(1) + "px / 左余白" + padL + "px");
      ok("BJ. 角丸をカプセル（999px）にしていない",
         parseFloat(cs.borderTopLeftRadius) <= 40, cs.borderTopLeftRadius);
      say.style.height = keepH;

      /* 下の余白は**固定値で書かない**。入力バーの高さから出すこと。 */
      const src = Array.from(document.scripts).map(x => x.textContent).join("");
      ok("BJ. 下の余白は入力バーの高さから出している",
         /--saybar/.test(src) && typeof fitSaybar === "function", "fitSaybar が無い");
      let rule = null;
      for (const sh of document.styleSheets) {
        let rules; try { rules = sh.cssRules; } catch { continue; }
        for (const x of rules) if (x.selectorText === "body.talking .wrap") rule = x.style;
      }
      ok("BJ. 会話タブの下余白が固定値になっていない",
         !!rule && /var\(--saybar/.test(rule.paddingBottom || ""), rule && rule.paddingBottom);

      // 上へ流れた文字があるときだけ、つまみを出す
      const keepV = say.value;
      say.value = "あ".repeat(400); say.dispatchEvent(new Event("input", { bubbles: true }));
      ok("BJ. いっぱいのときは、続きがあることを隠さない", say.classList.contains("more"),
         "scrollHeight " + say.scrollHeight + " / clientHeight " + say.clientHeight);
      say.value = "あ"; say.dispatchEvent(new Event("input", { bubbles: true }));
      ok("BJ. ふだんは、つまみを出さない", !say.classList.contains("more"));
      say.value = keepV; say.dispatchEvent(new Event("input", { bubbles: true }));
      showTab(keepTab);
    }

    /* ===== BL. 2つめのAIからは、文章を受け取らない（2026-09-21・本人の指摘） =====
       「2回目のAIが1回目と同じようなことを話す」。実際そうで、本体AIの3文は
       速い返事と「変えたこと」5件の言い換えだった。直し方は**注意書きではなく、返す形**——
       本体から受け取るのを habit（習慣の提案）と ask（まだ聞けていないこと）だけにする。 */
    {
      const nb = { id: uid(), text: "30分勉強する", hash: "bl", capturedAt: T(9, 0),
                   source: "talk", sourceName: null, createdAt: T(9, 0) };
      const pr = buildPrompt(nb, contextForAI(nb));
      ok("BL. 依頼文が求める形は ops / habit だけ",
         /\{"ops":\[ \.\.\. \],"habit":""\}/.test(pr), "");
      ok("BL. 依頼文が「reply」を返すなと言っている", /「reply」は返さないでください/.test(pr));
      ok("BL. 依頼文が「文章は書くな」と言っている", /文章（reply）は書かないでください/.test(pr));
      const AT = String(aiTurn);
      ok("BL. 受け取るのは ops / habit だけ（reply も ask も読まない）",
         /out\.habit/.test(AT) && !/out\.ask/.test(AT) && !/out\.reply/.test(AT), "");

      /* **形だけ見て終わらせない。実際に1回流す。**（決まり14・道具が本当に見ているか）
         AIを差し替えて、本体が文章を返してきても使われないことを確かめる。 */
      const keepAI = SAMPLEFN, keepView = view.day, keepChat = view.chatDay;
      const QUICK = "受け止めの一言。", BODY = "本体が書いた文章。郵便局の件、記録しました。";
      const HABIT = "寝る前に白湯を一杯飲んでみるのはどうですか？";
      const stub = () => Promise.resolve({ text: QUICK });
      stub.json = () => Promise.resolve({
        ops: [{ op: "add", kind: "task", title: "郵便局に行く", dueDate: null,
                duePrecision: "none", quote: "郵便局に行く" }],
        reply: BODY, habit: HABIT, ask: "" });
      SAMPLEFN = stub;
      reset();
      await sendTurn("郵便局に行く。");
      const today = dayKey(new Date(), state.settings.timezone);
      const turn = (state.turns[today] || []).filter(t => t.role === "assistant").pop();
      SAMPLEFN = keepAI; view.day = keepView; view.chatDay = keepChat;

      ok("BL. 返事がある", !!turn, "会話に何も入っていない");
      const txt = turn ? turn.text : "";
      ok("BL. 本体AIの文章は使わない", !txt.includes(BODY), txt.slice(0, 60));
      ok("BL. 受け止めは、速い返事の一言", txt.startsWith(QUICK), txt.slice(0, 40));
      ok("BL. 習慣の提案は、本体AIのものを出す", txt.includes(HABIT), txt.slice(0, 80));
      /* **ここが本題**：「変えたこと」は吹き出しの下の欄が出すので、文には書かない。 */
      const first = (turn && turn.changes && turn.changes[0]) || "";
      ok("BL. 変えたことを、文にも書いていない（欄と二重にならない）",
         !!first && !txt.includes(first), first + " / " + txt.slice(0, 60));
      ok("BL. 「変えたこと」の欄そのものは残っている",
         !!turn && (turn.changes || []).length > 0, "");

      /* **返信から外した文**（2026-09-21・本人の指示）。どちらも画面の別の場所にある：
         「◯◯は今日に入らなかった（理由）」→ スケジュールの項目の行の「置けない理由：」
         （`tests/harness.js` が5か所で見張っている）。
         「締切は◯日にしたよ」→ 同じ行の「9/22 まで」。
         「今日の作業時間はもう過ぎてる」だけは行き場が無かったが、本人が要らないと決めた。
         これで `planNotes` は返すものが無くなったので、**関数ごと消した**
         （「使われていないものを消すときの決まり」）。 */
      ok("BL. 返信に足す文は、もう作っていない（planNotes は消した）",
         typeof planNotes === "undefined", "まだ残っている");
      for (const [name, re] of [["置けなかった理由", /今日に入らなかった/],
                                ["締切の言い方", /締切は.*にしたよ/],
                                ["作業時間が過ぎている", /もう過ぎてる/]]) {
        ok("BL. 返信に「" + name + "」を書かない",
           !re.test(txt), txt.replace(/\n/g, " ⏎ ").slice(0, 120));
      }

      /* **返信に「変えたこと」の一覧は出さない**（2026-09-21・本人の指示）。
         数えるのも保存するのも今までどおりで、**出さないだけ**。
         結果はスケジュールのタブと「タスク」に出ている。 */
      const th = turnHTML({ role: "assistant", text: "うん。", at: T(9, 0),
        changes: ["タスクを追加：郵便局に行く"], plan: null, ai: true });
      ok("BL. 返信に「変えたこと」の一覧を出さない",
         !/変えたこと/.test(th) && !/郵便局に行く/.test(th), th.replace(/\s+/g, " ").slice(0, 160));
      ok("BL. 数えるのはやめていない（会話には残す）",
         !!turn && (turn.changes || []).length > 0, "changes が空");
      /* **そこにしか入口が無いものを、先に引っ越すこと。**
         「提案した予定を全部消す」は、この欄の中にしか無かった（決まり10）。 */
      const th2 = turnHTML({ role: "assistant", text: "うん。", at: T(9, 0),
        changes: ["x"], plan: null, ai: true, habitDay: KEY });
      ok("BL. 「提案した予定を全部消す」の道は塞がない",
         /data-act="clearsug"/.test(th2), th2.replace(/\s+/g, " ").slice(0, 160));
    }

    /* ===== BM. 「この日にやる」と言った日があるなら、枠はその日だけ（2026-09-21・実機で報告） =====
       「明日までの資料を、できれば今日の午前中に進めたい」で、**今日・明日・明後日の3日**に
       1時間ずつ入っていた。本人が作業すると言ったのは1日だけ。
       **この群は本物の時計を見る**——`planFor` の `todayKey` が実際の今日だから
       （`T()` の演じている日付では、この分岐そのものに入らない）。
       日付は「今日から何日後」で作るので、日をまたいでも壊れない。
       時計の時刻には寄りかからない（`nowMin: -1` で「いま」を無視する）。 */
    {
      const tzm = state.settings.timezone;
      const dk = n => dayKey(new Date(Date.now() + n * 86400000), tzm);
      const d0 = dk(0), d1 = dk(1), d2 = dk(2);
      const keepDay = view.day, keepTab2 = view.tab;

      reset();
      await say("明日までに資料を作る。1時間くらい。できれば午前中に進めたい。", new Date().toISOString());
      const it = state.items.find(i => i.kind === "task");
      ok("BM. 締切は明日・進めたいのは今日、と読める",
         !!it && it.dayKey === d1 && it.targetDay === d0,
         it ? `dayKey=${it.dayKey} targetDay=${it.targetDay}` : "用事が作られない");
      const has = k => !!it && (planFor(k, { nowMin: -1 }).blocks || [])
        .some(b => b.item && b.item.id === it.id);
      ok("BM. 進めると言った日には枠がある", has(d0));
      ok("BM. 締切の日には枠を作らない（1時間の仕事を2日ぶんにしない）", !has(d1));
      ok("BM. その先の日にも枠を作らない", !has(d2));
      ok("BM. 枠を置かない日でも、忘れないように残す",
         !!it && (planFor(d1, { nowMin: -1 }).elsewhere || []).some(i => i.id === it.id),
         "elsewhere に入っていない");

      /* **理由を取り違えない**（決まり6n）。「時刻を言っていないので」は、
         時刻も時間帯も言っていないものにだけ当てはまる。この用事は「午前中に」と言っている。 */
      view.day = d1; showTab("p-day"); renderDay();
      const txt = $("#dayOut").textContent.replace(/\s+/g, " ");
      ok("BM. 置いていない理由を、その用事のものにする",
         /に進めると言っていたので、その日の予定表に入れています/.test(txt),
         txt.slice(txt.indexOf("この日にやること"), txt.indexOf("この日にやること") + 90));
      ok("BM. 「時刻を言っていないので」を、言っているものに当てない",
         !/時刻を言っていないので、予定表には置いていません/.test(txt), "当ててしまっている");

      /* **やり損ねたものは、置き直す。** そうしないと二度と予定に戻らない。
         **「できれば」を落とさないこと。** 無いと `targetDay` が付かず、
         この分岐に入らないまま**壊れていても PASS する**（実際そうなった。決まり14）。 */
      reset();
      await say("明後日までに書類を出す。1時間。できれば午前中に進めたい。",
                new Date(Date.now() - 2 * 86400000).toISOString());
      const it2 = state.items.find(i => i.kind === "task");
      ok("BM. 進めると言った日が、過ぎている用事を作れている",
         !!it2 && !!it2.targetDay && it2.targetDay < d0,
         it2 ? `targetDay=${it2.targetDay}` : "用事が作られない");
      ok("BM. 進める日が過ぎても終わっていないものは、今日に置き直す",
         !!it2 && (planFor(d0, { nowMin: -1 }).blocks || []).some(b => b.item && b.item.id === it2.id),
         it2 ? `dayKey=${it2.dayKey} targetDay=${it2.targetDay}` : "用事が作られない");

      /* **「◯日の予定に入れたよ」は、本当にその日に置かれたときだけ**（2026-09-21・実機で報告）。
         上の直し（枠はその日だけ）で締切の日に枠を作らなくなったぶん、
         **日付だけ見て書いていたこの1文が、はっきり嘘になった**。
         どの日も「明日」なので、実際の時計に左右されない（今日の空き具合を見ない）。 */
      const replyOf = async text => {
        reset();
        await sendTurn(text);
        const t = (state.turns[d0] || []).filter(x => x.role === "assistant").pop();
        return (t && t.text) || "";
      };
      const r1 = await replyOf("明日の15時から歯医者。");
      ok("BM. その日に置いたのなら「予定に入れた」と言う",
         /の予定に入れたよ/.test(r1) && !/締切は/.test(r1), r1.replace(/\n/g, " ⏎ "));
      const r2 = await replyOf("明日までに資料を作る。1時間。できれば午前中に進めたい。");
      ok("BM. 置いていない日を「予定に入れた」と言わない",
         !/の予定に入れたよ/.test(r2), r2.replace(/\n/g, " ⏎ "));
      /* 「締切は◯日にしたよ」も 2026-09-21 に本人の指示で外した。
         **置いていない日については、何も言わない**——締切は項目の行の「9/22 まで」で読む。 */
      ok("BM. 置いていない日について、日付の文を足さない",
         !/にしたよ|の予定に入れたよ/.test(r2), r2.replace(/\n/g, " ⏎ "));
      const r3 = await replyOf("明日、資料を作る。2時間。");
      ok("BM. 時刻を言っていない用事も「予定に入れた」とは言わない",
         !/の予定に入れたよ/.test(r3), r3.replace(/\n/g, " ⏎ "));

      view.day = keepDay; showTab(keepTab2);
    }

    /* ===== BK. 指で触ったときの手ざわりと、文字の大きさの段数（2026-09-21） =====
       見るのは「性質」であって「値」ではない（決まり15）。
       配色のときと同じで、px の値を書き写すと、直すたびにテストだけが古くなる。 */
    {
      const sheets = Array.from(document.styleSheets);
      const flat = [];
      /* **`if (r.cssRules)` で枝分かれさせないこと。** いまのブラウザは入れ子のCSSに対応したので、
         ふつうの規則（CSSStyleRule）にも空の `cssRules` が生えている。そこで分けると
         **1件も集まらないまま、テストが全部 PASS する**（実際にそうなった）。
         見分けるのは `style` と `selectorText` を持っているかどうか。 */
      const walk = (rules, cond) => {
        for (const r of rules) {
          if (r.style && r.selectorText !== undefined)
            flat.push({ sel: r.selectorText || "", css: r.cssText || "", cond, style: r.style });
          if (r.cssRules && r.cssRules.length) walk(r.cssRules, cond + " " + (r.conditionText || ""));
        }
      };
      for (const sh of sheets) { let rs; try { rs = sh.cssRules; } catch { continue; } walk(rs, ""); }
      const all = flat.map(r => r.css).join("\n");

      // ① 画面の幅を端末に合わせる。これが無いと Android の WebView は 980px の紙として描き、
      //    430px 以下の指定がまるごと効かない（スマホ向けの調整が全部むだになる）。
      const vp = document.querySelector('meta[name="viewport"]');
      ok("BK. 画面の幅を端末に合わせる指定がある",
         !!vp && /width\s*=\s*device-width/.test(vp.content), vp ? vp.content : "meta が無い");
      // env(safe-area-inset-*) は viewport-fit=cover が無いと必ず 0 を返す。
      ok("BK. 端の余白（safe-area）を測れる指定になっている",
         !!vp && /viewport-fit\s*=\s*cover/.test(vp.content) && /env\(safe-area-inset/.test(all),
         vp ? vp.content : "meta が無い");

      // ② 開くたびに外へ取りに行くものを持たない（電波が無いと画面が出ない・記録は端末から出さない約束）
      const ext = Array.from(document.querySelectorAll('link[rel="stylesheet"],link[rel="preconnect"]'))
        .map(l => l.getAttribute("href") || "").filter(h => /^https?:/.test(h));
      ok("BK. 外から読み込むフォント・スタイルを持たない", ext.length === 0, ext.join(" / "));

      // ③ タップの灰色の点滅を消す（Android で押すたびに四角く光る）
      ok("BK. タップの灰色の点滅を消している", /tap-highlight-color\s*:\s*transparent/.test(all));
      // ④ 押した手ごたえ。:hover はマウスのある画面だけ——
      //    スマホでは押したあと hover が貼りついて、押しっぱなしに見える。
      const hovers = flat.filter(r => /:hover/.test(r.sel));
      ok("BK. 押した手ごたえ（:active）がある", flat.some(r => /:active/.test(r.sel)));
      ok("BK. :hover はマウスのある画面の中だけ",
         hovers.length > 0 && hovers.every(r => /hover\s*:\s*hover/.test(r.cond)),
         hovers.map(r => r.sel + " ← " + (r.cond.trim() || "（囲いなし）")).join(" / "));
      // ⑤ 引ききったときに、後ろの画面ごと動かない
      ok("BK. 端まで引いても全体が動かない（overscroll-behavior）", /overscroll-behavior/.test(all));

      // ⑥ 入力欄は16px以上。下回ると、触れた瞬間に画面を拡大する端末がある。
      const small = [];
      for (const el of document.querySelectorAll("textarea,input,select")) {
        if (el.type === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 20) continue;   // 目に見えない欄（.sr）は触れないので数えない
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 16) small.push((el.id || el.tagName.toLowerCase()) + " " + fs + "px");
      }
      ok("BK. 入力欄の文字が16px以上（触れた瞬間に拡大されない）", small.length === 0, small.join(" / "));

      /* ⑥b 横へのはみ出し。**画面ごとに見ること**——タブを1つ開いただけでは見つからない
         （実際、目に見えない `.sr` の欄が幅いっぱいに広がって、わたしのこと／設定だけ
         35px 横へずれていた）。スクリーンショットの右端が切れるのとは別の話で、
         確かめるのは `scrollWidth <= clientWidth`（記録済みの落とし穴）。 */
      {
        const keep2 = view.tab, wide = [];
        for (const t of ["p-chat", "p-day", "p-me", "p-set"]) {
          showTab(t);
          const de = document.documentElement;
          if (de.scrollWidth > de.clientWidth) wide.push(t + " " + de.scrollWidth + ">" + de.clientWidth);
        }
        showTab(keep2);
        ok("BK. どの画面も横へはみ出していない", wide.length === 0, wide.join(" / "));
      }

      /* ⑦ 文字の大きさの段数。多いほど散らかって見える。
         段数だけを見る——どの大きさにするかは決めない（配色を帯で見るのと同じ理屈）。
         **`/px$/` で絞らないこと**（2026-09-24）。rem のトークンへ移した瞬間に
         **1件も集まらなくなり、0 ≦ 8 で通ってしまう**——数えていないのに通る形。 */
      const sizes = new Set();
      // 「min(var(--fs-1), 13px)」は同じ段に上限を付けただけ（タブの名前・2026-09-27）。段としては --fs-1
      for (const r of flat) { const v = r.style && r.style.fontSize; if (v) sizes.add(v.replace(/^min\((var\(--fs-\d\)),.*\)$/, "$1")); }
      ok("BK. 文字の大きさが8段以内にそろっている", sizes.size <= 8,
         Array.from(sizes).sort().join(" "));
      ok("BK. 段を数えられている（測れていないのに通さない）", sizes.size >= 3, "集まった段 " + sizes.size);

      /* ⑦b **端末の文字の大きさに追従する**（2026-09-24・案⑥）。
         px で書くと、既定の文字を大きくしている人に何も効かない。
         見るのは3つ：px を直接書いていない／段を rem で持っている／
         **根を大きくしたら本当に付いていく**。3つ目が本体で、前2つはその理由。 */
      const pxFs = flat.filter(r => r.style && /px$/.test(r.style.fontSize || ""));
      ok("BK. 文字の大きさに px を直接書いていない", pxFs.length === 0,
         pxFs.map(r => r.sel + " " + r.style.fontSize).join(" / "));
      const rootCS = getComputedStyle(document.documentElement);
      const steps = [];
      for (let i = 1; i <= 6; i++) steps.push(rootCS.getPropertyValue("--fs-" + i).trim());
      steps.push(rootCS.getPropertyValue("--fs-in").trim());
      ok("BK. 段は rem で持っている（根に付いていく）",
         steps.length === 7 && steps.every(v => /rem$/.test(v)), steps.join(" "));
      ok("BK. 根に px の大きさを固定していない",
         !/(^|\})\s*html\s*\{[^}]*font-size\s*:\s*[0-9.]+px/.test(all), "html に px の font-size がある");
      {
        const probe = $("#say") || document.body;
        const before = parseFloat(getComputedStyle(probe).fontSize);
        document.documentElement.style.fontSize = "20px";       // 端末で文字を大きくした状態
        const after = parseFloat(getComputedStyle(probe).fontSize);
        const wide2 = [];
        const keep3 = view.tab;
        for (const t of ["p-chat", "p-day", "p-me", "p-set"]) {
          showTab(t);
          const de = document.documentElement;
          if (de.scrollWidth > de.clientWidth) wide2.push(t + " " + de.scrollWidth + ">" + de.clientWidth);
        }
        showTab(keep3);
        document.documentElement.style.fontSize = "";
        ok("BK. 根を大きくすると、文字も大きくなる", after > before + 1,
           before + "px → " + after + "px");
        ok("BK. 文字を大きくしても、横へはみ出さない", wide2.length === 0, wide2.join(" / "));
      }
      // ⑧ 大きさをインライン style で書かない（画面幅で変えられなくなる）
      const inl = Array.from(document.querySelectorAll('[style*="font-size"]')).map(e => e.tagName.toLowerCase());
      ok("BK. 文字の大きさをインライン style で書いていない", inl.length === 0, inl.join(" / "));

      // ⑨ 端末の部品（選択の一覧・日付の選択・スクロールバー）も明暗に合わせる
      const keepTheme = document.documentElement.getAttribute("data-theme");
      const scheme = {};
      for (const t of ["light", "dark"]) {
        applyTheme(t);
        scheme[t] = getComputedStyle(document.documentElement).colorScheme;
      }
      if (keepTheme) document.documentElement.setAttribute("data-theme", keepTheme);
      else document.documentElement.removeAttribute("data-theme");
      ok("BK. 端末の部品の明暗を、設定と合わせている",
         /light/.test(scheme.light) && /dark/.test(scheme.dark),
         "light→" + scheme.light + " / dark→" + scheme.dark);
    }

    /* ===== BN. 「◯時から◯時まで◯◯して、◯時から◯時まで予定を埋めて」（v8.6・実機で報告）=====
       16:08 に「5時から7時まで勉強して8時から10まで適当に予定を埋めて」と言うと、
       **後半がまるごと消えていた**（実測）。原因は3つ重なっていた：
       ①「埋めて」が組み立ての言葉に入っていない
       ②範囲の右側で「時」を省くと読めない（左は省けるのに**非対称**だった）
       ③消したことを何も言っていない（決まり5「捨てるなら、言う」）。 */
    {
      const AT = zoned(2026, 9, 21, 16, 8, TZ).toISOString();
      const mk = t => ({ id: uid(), text: normNote(t), hash: "bn" + Math.random(),
        capturedAt: AT, source: "talk", createdAt: AT });
      const feed = async t => { reset(); const n = mk(t); await putNote(n); return await applyOps(ruleOps(n), n); };

      // ① 終わりの「時」を省いた範囲を読む
      const w1 = parseWhen("8時から10まで適当に予定を埋めて", AT, TZ);
      ok("BN. 「8時から10まで」を範囲として読む",
         !!w1 && !!w1.end && fmtDT(w1.start, TZ).endsWith("20:00") && fmtDT(w1.end, TZ).endsWith("22:00"),
         w1 ? fmtDT(w1.start, TZ) + "–" + fmtDT(w1.end, TZ) : "読めない");
      // **左にも「時」が無いものは、時刻にしない**（ページ数・個数と区別できない）
      ok("BN. 「3から5個」を時刻にしない", !parseWhen("3から5個買う", AT, TZ), "時刻として読んでしまった");
      const w2 = parseWhen("5から7まで読む", AT, TZ);
      ok("BN. 「5から7まで」を範囲にしない", !w2 || !w2.end, w2 ? JSON.stringify(w2.end) : "読まない");

      // ② 「予定を埋めて」が組み立ての依頼になる
      ok("BN. 「予定を埋めて」は組み立ての依頼", RE_BUILD_DAY.test("適当に予定を埋めて"), "拾えていない");
      ok("BN. ただの「埋めて」では組み立てない", !RE_BUILD_DAY.test("穴を埋めて"), "拾いすぎ");

      // ③ 前半は予定、後半は埋める時間帯。**どちらも消さない**
      reset();
      const r3 = await feed("5時から7時まで勉強して8時から10まで適当に予定を埋めて");
      const ev = state.items.find(i => i.kind === "event");
      ok("BN. 前半は、言われた時刻の予定として残る",
         !!ev && fmtDT(ev.start, TZ).endsWith("17:00") && fmtDT(ev.end, TZ).endsWith("19:00"),
         ev ? ev.title + " " + fmtDT(ev.start, TZ) + "–" + fmtDT(ev.end, TZ) : "作られなかった");
      ok("BN. 前半の見出しが壊れていない", !!ev && ev.title === "勉強する", ev && ev.title);
      const filled = state.items.filter(i => i.kind === "task" && i.suggested);
      const inWin = filled.every(i => minOfDay(i.due, TZ) >= 20 * 60 && minOfDay(i.due, TZ) < 22 * 60);
      ok("BN. 後半は、その時間帯を提案で埋める", filled.length > 0 && inWin,
         filled.map(i => hhmm(minOfDay(i.due, TZ)) + " " + i.title).join(" / ") || "1件も埋めていない");
      ok("BN. 依頼の言葉そのものを用事にしない",
         !state.items.some(i => /埋めて/.test(i.title)),
         state.items.map(i => i.title).join(" / "));
      ok("BN. 組み立てたことを返事に書く",
         r3.changes.some(c => /20:00〜22:00/.test(c)), JSON.stringify(r3.changes));

      // ④ 日付を言われていたら、今日へ寄せない（前の範囲を伏せるときに落としやすい）
      reset();
      await feed("明日8時から10時まで適当に予定を埋めて");
      const tomo = dayKey(new Date(keyToDate("2026-09-21", TZ).getTime() + 86400000), TZ);
      const made4 = state.items.filter(i => i.kind === "task");
      ok("BN. 「明日」と言われたら明日に組み立てる",
         made4.length > 0 && made4.every(i => i.dayKey === tomo), made4.map(i => i.dayKey).join(","));
      ok("BN. 「明日8時」は午前のまま（今夜20時に寄せない）",
         made4.length > 0 && minOfDay(made4[0].due, TZ) < 12 * 60,
         made4.length ? hhmm(minOfDay(made4[0].due, TZ)) : "なし");

      // ⑤ 範囲を2つ言われたのに1つしか使えなかったら、黙らない
      reset();
      const r5 = await feed("5時から7時まで勉強して8時から10まで散歩する");
      /* 2026-09-26：1行に時刻つきの話が2つあれば、話題を分けて**両方入れる**ようにした（splitLines）。
         前は1つしか使えず、黙らないよう知らせていた（決まり4l）。いまは知らせる必要が無い。 */
      ok("BN. 1行に範囲が2つあっても、両方とも予定になる（知らせるまでもない）",
         state.items.filter(i => i.kind === "event").length === 2 && !r5.asks.some(a => /時刻の範囲を2つ/.test(a)),
         state.items.map(i => i.title).join(" / ") + " " + JSON.stringify(r5.asks));
      // 行を分けたときは、両方とも入る（知らせの文が案内しているとおり）
      reset();
      await feed("5時から7時まで勉強する\n8時から10時まで散歩する");
      ok("BN. 行を分ければ、両方とも入る", state.items.filter(i => i.kind === "event").length === 2,
         state.items.map(i => i.title).join(" / "));

      // ⑥ 「〜して」で止まった見出しを、言い切りにそろえる
      ok("BN. 「勉強して」→「勉強する」", cleanTitle("勉強して", null) === "勉強する", cleanTitle("勉強して", null));
      ok("BN. 「部屋の片付けをして」→「〜をする」",
         cleanTitle("部屋の片付けをして", null) === "部屋の片付けをする", cleanTitle("部屋の片付けをして", null));
      ok("BN. 「探して」は「探する」にしない", !/探する/.test(cleanTitle("資料を探して", null)), cleanTitle("資料を探して", null));
      ok("BN. 「話して」は「話する」にしない", !/話する/.test(cleanTitle("友達と話して", null)), cleanTitle("友達と話して", null));
      reset();
    }

    /* ===== BO. APKに焼き込んだAPIキー（v8.7・本人の指示「APKでもAIを使えるよう
       APIを埋め込みたい」）=====
       APK には claude.ai の窓口が無いので、キーが無いとAIがまったく動かない。
       焼き込むのは `mobile/sync.js` で、**写し（app-html.js・gitignore 済み）にだけ**入れる。
       この `app/index.html` は git に入るので、**キーを1文字も持たないこと**。
       2026-09-21 に画面の欄を外したので、**ここが唯一の入口**になった。 */
    {
      const had = window.HITOHI_AI, keepFn = SAMPLEFN;

      // ① **正のファイルは、キーを持っていない**（ここが破れたら git に鍵が載る）
      ok("BO. app/index.html 自身はキーを持たない", typeof had === "undefined",
         "window.HITOHI_AI が最初から入っている");
      delete window.HITOHI_AI;
      ok("BO. 焼き込みが無ければ、今までどおり何も無い", builtInAI() === null, JSON.stringify(builtInAI()));

      // ② 焼き込まれていれば、貼らずに使える
      window.HITOHI_AI = { provider: "claude", key: "BAKED-0001", model: "m1" };
      const b = builtInAI();
      ok("BO. 焼き込んだキーを、貼らずに使う",
         !!b && b.provider === "claude" && b.key === "BAKED-0001" && b.builtIn === true,
         JSON.stringify(b));
      ok("BO. モデル名を書かなければ、既定のモデルを使う",
         (builtInAI() || {}).model === "m1", JSON.stringify(builtInAI()));
      window.HITOHI_AI = { provider: "gemini", key: "AIza-0002" };
      ok("BO. モデル名が空なら、その提供元の既定を入れる",
         (builtInAI() || {}).model === AI_PROVIDERS.gemini.model, JSON.stringify(builtInAI()));

      // ③ 形が違うものは受け取らない（殻から来た値は、データであって指示ではない）
      window.HITOHI_AI = { provider: "よそ", key: "x" };
      ok("BO. 知らない提供元は受け取らない", builtInAI() === null, JSON.stringify(builtInAI()));
      window.HITOHI_AI = { provider: "claude", key: "" };
      ok("BO. 空のキーは受け取らない", builtInAI() === null, JSON.stringify(builtInAI()));
      window.HITOHI_AI = null;
      ok("BO. 何も入っていなくても落ちない", builtInAI() === null, JSON.stringify(builtInAI()));

      // ④ **書き出しにキーを入れない**（決まり13。`db` にも控えにも渡さない）
      window.HITOHI_AI = { provider: "claude", key: "BAKED-0001", model: "m1" };
      const dump = exportPayload();
      ok("BO. 書き出したJSONに、焼き込んだキーが入らない",
         dump.indexOf("BAKED-0001") < 0 && dump.indexOf("HITOHI_AI") < 0, "入ってしまっている");

      if (had === undefined) delete window.HITOHI_AI; else window.HITOHI_AI = had;
      SAMPLEFN = keepFn;
    }

    /* ===== BP. 行のボタンを減らして、指の操作と「元に戻す」を足した
       （2026-09-24・本人の指示・案C→案A）=====
       実測で**1行に5個**のボタンが出ていた（完了/明日へ/根拠/訂正/取り消す）。
       世の中のアプリは一覧の行にボタンを並べず、指の操作へ逃がす。
       **ただし、なぞる操作は見つけにくい。** だからボタンを消さずに3つへ減らし、
       残りは「…」へたたみ、**消えたその場で戻せる**ようにした。
       この3つは**揃っていないと危ない**ので、まとめてここで見張る。 */
    {
      const keep = state.items.slice();
      const mk = (over) => Object.assign({
        id: "bp-" + Math.random().toString(36).slice(2, 7), kind: "task", title: "資料を作る",
        origin: "rule", confirmed: false, corrected: false, status: "open",
        evidence: { text: "資料を作る" }, createdAt: T(9, 0), updatedAt: T(9, 0), history: []
      }, over || {});

      /* ① 行に並ぶボタンを数える。**5個には戻さない。** */
      const btns = h => (h.match(/data-act="/g) || []).length;
      const task = mk({});
      const rowTask = itemHTML(task);
      ok("BP. 行のボタンは3つまで", btns(rowTask) <= 3, btns(rowTask) + "個");
      ok("BP. 行に残すのは「完了」「明日へ」「…」",
         /data-act="done"/.test(rowTask) && /data-act="defer"/.test(rowTask) && /data-act="more"/.test(rowTask),
         rowTask.replace(/\s+/g, " ").slice(0, 200));
      ok("BP. 根拠・訂正・取り消すは行に並べない",
         !/data-act="evid"/.test(rowTask) && !/data-act="edit"/.test(rowTask) && !/data-act="drop"/.test(rowTask));

      /* ② 「…」の中に、**行から消したものが全部ある**（道を1つも塞がない）。 */
      state.items = keep.concat(task);
      openMore(task);
      const more = $("#sheetHost").innerHTML;
      closeSheet();
      for (const [a, ja] of [["evid", "根拠"], ["edit", "訂正"], ["drop", "取り消す"]])
        ok("BP. 「…」の中に「" + ja + "」がある", more.indexOf('data-act="' + a + '"') >= 0, "無い");
      ok("BP. 「…」のボタンは指で押せる大きさ（48px）",
         (() => { for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules; } catch { continue; }
           for (const r of rs) if (r.style && r.selectorText === ".morelist .btn")
             return parseFloat(r.style.minHeight) >= 44; } return false; })(), "指定が無い");

      /* ③ なぞったときに何が起きるか。**判定は `swipeActs` ひとつ**（決まり7e）。 */
      const sa = t => swipeActs(t);
      ok("BP. 開いている用事は、右で完了・左で明日へ",
         sa(mk({})).right === "done" && sa(mk({})).left === "defer");
      ok("BP. 予定（event）は、右で終わり・左は無し（明日へは用事だけ）",
         sa(mk({ kind: "event" })).right === "done" && sa(mk({ kind: "event" })).left === null);
      ok("BP. 終わったもの・取り消したものは、なぞっても何も起きない",
         !sa(mk({ status: "done" })).right && !sa(mk({ status: "done" })).left
         && !sa(mk({ status: "dropped" })).right);
      ok("BP. 目標やメモは、なぞる対象にしない",
         !sa(mk({ kind: "goal" })).right && !sa(mk({ kind: "memo" })).right);

      /* ④ **できるものだけ包む。** 包んでおいて何も起きないと、壊れて見える。 */
      ok("BP. なぞれる行だけ、なぞる下地を持つ",
         /class="swipe"/.test(itemHTML(mk({}), { swipe: true })));
      ok("BP. なぞれないものは包まない",
         !/class="swipe"/.test(itemHTML(mk({ status: "done" }), { swipe: true })));
      ok("BP. 頼まれていない一覧は包まない（今までどおり）",
         !/class="swipe"/.test(itemHTML(mk({}))));
      ok("BP. 下地に、何が起きるかが書いてある",
         /完了/.test(itemHTML(mk({}), { swipe: true })) && /明日へ/.test(itemHTML(mk({}), { swipe: true })));
      ok("BP. 縦スクロールを奪わない（touch-action)",
         (() => { for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules; } catch { continue; }
           for (const r of rs) if (r.style && r.selectorText === ".swipe")
             return /pan-y/.test(r.style.touchAction || ""); } return false; })(), "指定が無い");

      /* ⑤ トーストの「元に戻す」。**渡されたときだけ**出る（決まり7「無くても動く」）。 */
      toast("完了にしました：資料を作る", { label: "元に戻す", run: async () => {} });
      const tEl = $("#toast");
      ok("BP. 戻す道を渡したら、トーストにボタンが出る",
         !!tEl.querySelector('[data-act="toastundo"]'), tEl.innerHTML.slice(0, 120));
      ok("BP. 戻すボタンがあるときは、読む時間を長くする", TOAST_UNDO_MS > TOAST_MS,
         TOAST_UNDO_MS + " / " + TOAST_MS);
      toast("ふつうの知らせ");
      ok("BP. 渡さなければ、今までどおりボタンは出ない",
         !$("#toast").querySelector('[data-act="toastundo"]'));
      ok("BP. トーストの文は必ず escape する（保存先から来た文字が入る）",
         (() => { toast('<img src=x onerror="/*!*/">'); const n = $("#toast").querySelectorAll("img").length;
                  hideToast(); return n === 0; })(), "要素として入ってしまった");

      /* ⑥ 戻したときに、**起きたことの記録を消さない**。
         「完了にした」と「元に戻した」の両方が残らないと、何が起きたか読めなくなる。 */
      ok("BP. 戻しても history は消えない",
         /history = hist/.test(String(restoreItems)), "履歴を上書きしているかもしれない");
      ok("BP. 戻すのは、保存に成功した件数で数える",
         /putItem\(cur\); n\+\+/.test(String(restoreItems)), "数え方がおかしい");

      /* ⑦ 振動は「あれば使う」。**無い環境で落とさない**（決まり7と同じ理屈）。 */
      const hadV = navigator.vibrate;
      try { delete navigator.vibrate; } catch {}
      let threw = false;
      try { buzz(); } catch { threw = true; }
      ok("BP. 振動が使えない端末でも、落ちない", !threw);
      if (hadV) { try { navigator.vibrate = hadV; } catch {} }

      hideToast();
      state.items = keep; lsWrite();
    }

    /* ===== BQ. 知らせ（トースト）の幅（2026-09-24・実機で報告） =====
       「アプリ内通知が見づらい」。実機の写真では
       **「完了にし／ました：／資料を作／る」と4行に折れ**、
       黒い楕円が文字を食っていた。原因は2つで、どちらも決まり15d の再発。
       ① `left:50%` だけを書いていたので、**幅の自動計算に使えるのは残りの 50vw だけ**
          （実測：500px の窓で 250px）。そこへ「元に戻す」が入ると文字の取り分が 127px。
          **`max-width:92vw` は 50vw より広いので、一度も効いていなかった。**
       ② 角丸が `999px`。`border-radius` は**高さの半分まで育つ**ので、
          折り返すほど大きな楕円になる（実測：写真の形で 31.8px）。
          **ここでは文字を食うところまでは行っていなかった**（食い込み 3.9px ＜ 左余白 15px）。
          見づらさの主因は①で、②は決まり15d と同じ**先回り**。ただし見出しの長い用事なら
          本当に食う（実測：200字で角丸 78px・食い込み 25px）ので、**長い文で測ること**。
       **ここは「伸ばしてから」測る。** 短い文で測ると、壊れていても通る。 */
    {
      const keepItems = state.items;
      /* **この窓幅なら測れる**ことを先に言う。窓が広すぎると 50vw が max-width を超えて、
         **壊れていても通ってしまう**（決まり14・道具が本当に見ているか）。 */
      /* **幅は `innerWidth` ではなく `clientWidth` で見ること。**
         `left:50%` が割るのは**スクロールバーを除いた幅**なので、`innerWidth` と比べると
         中心が 7px ずれて落ちる（実測：780 の窓で中心 383）。 */
      const vw = document.documentElement.clientWidth;
      ok("BQ. この窓幅なら、幅の頭打ちを見分けられる",
         vw / 2 < 440, "窓" + vw + "px（半分が 440px 以上だと見分けられない）");

      const el = $("#toast");
      const geom = () => {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        const m = el.querySelector(".tmsg");
        const lh = parseFloat(getComputedStyle(m || el).lineHeight) || 16;
        // 角丸は「高さの半分・幅の半分」で頭打ちになる。実際に効く値で測る（BJ群と同じ）
        const rad = Math.min(parseFloat(cs.borderTopLeftRadius), r.height / 2, r.width / 2);
        const inset = y => (y >= rad ? 0 : rad - Math.sqrt(Math.max(0, rad * rad - (rad - y) * (rad - y))));
        return { r, cs, rad, padL: parseFloat(cs.paddingLeft),
                 top: inset(parseFloat(cs.paddingTop) + lh / 2),
                 bot: inset(parseFloat(cs.paddingBottom) + lh / 2) };
      };

      // ① 実際に描かれていること（測れていないのに通さない）
      toast("完了にしました：資料を作る", { label: "元に戻す", run: () => {} });
      ok("BQ. 知らせが実際に描かれている（測れていないのに通さない）",
         !el.hidden && geom().r.height > 10, "高さ" + geom().r.height.toFixed(0) + "px");
      ok("BQ. 「元に戻す」のボタンが出ている", !!el.querySelector(".tundo"));

      // ② 長い文 ＋「元に戻す」で伸ばす。ここで 50vw の頭打ちが出る
      toast("完了にしました：" + "あ".repeat(40), { label: "元に戻す", run: () => {} });
      const g = geom();
      ok("BQ. 幅が「left:50% の残り」で頭打ちになっていない",
         g.r.width > vw / 2 + 1,
         "幅" + g.r.width.toFixed(0) + "px / 残り" + (vw / 2).toFixed(0) + "px");
      ok("BQ. それでも画面からはみ出さない",
         g.r.left >= -1 && g.r.right <= vw + 1,
         g.r.left.toFixed(0) + "〜" + g.r.right.toFixed(0) + " / " + vw);
      ok("BQ. 真ん中に出る",
         Math.abs((g.r.left + g.r.right) / 2 - vw / 2) < 2,
         "中心" + ((g.r.left + g.r.right) / 2).toFixed(0));

      /* ③ **何行にも折れたときに、角丸が文字を食わないこと**（決まり15d）。
         `border-radius` は**高さの半分まで育つ**ので、2行くらいでは差が出ない
         （実測：2行なら 999px にしても食い込みは 2.1px で、左余白 15px に届かない）。
         **短い文で測ると、カプセルに戻しても通ってしまう。**
         用事の見出しは長くなりうるので、ここは**長い文で**測る。 */
      toast("完了にしました：" + "あ".repeat(200), { label: "元に戻す", run: () => {} });
      const gl = geom();
      ok("BQ. 何行にも折れている（測れていないのに通さない）",
         gl.r.height > 100, "高さ" + gl.r.height.toFixed(0) + "px");
      ok("BQ. 折り返しても、角丸が1行目の文字に食い込まない",
         gl.top <= gl.padL, "食い込み" + gl.top.toFixed(1) + "px / 左余白" + gl.padL + "px（角丸" + gl.rad.toFixed(1) + "px）");
      ok("BQ. 折り返しても、角丸が最終行の文字に食い込まない",
         gl.bot <= gl.padL, "食い込み" + gl.bot.toFixed(1) + "px / 左余白" + gl.padL + "px");
      ok("BQ. 角丸をカプセル（999px）にしていない",
         parseFloat(gl.cs.borderTopLeftRadius) <= 40, gl.cs.borderTopLeftRadius);

      // ④ 「元に戻す」は縮まない／文のほうが折り返す
      const undoCS = getComputedStyle(el.querySelector(".tundo"));
      ok("BQ. 「元に戻す」は縮ませない", undoCS.flexShrink === "0", "flex-shrink " + undoCS.flexShrink);
      const msgCS = getComputedStyle(el.querySelector(".tmsg"));
      ok("BQ. 折り返す側は縮められる（min-width:0）", parseFloat(msgCS.minWidth) === 0, msgCS.minWidth);

      // ⑤ ふだんの短い知らせは、1行のまま小さく出る
      toast("記録しました");
      const g2 = geom();
      ok("BQ. 短い知らせは、中身のぶんだけの幅で収まる",
         g2.r.width < vw / 2, "幅" + g2.r.width.toFixed(0) + "px");

      hideToast();
      state.items = keepItems;
    }

    /* ===== BR. 説明を減らす（2026-09-25・本人の指示「もっとスマートに」）=====
       4つの画面を測ったら、**出ている文字のほぼ半分が説明文**だった（28か所・845字）。
       減らし方は4つで、**どれも「消す」ではない**：
       ① `hidden` なのに出ていたものを、本当に消す（これは説明ではなく不具合）
       ② 使い方の案内は、**使えたら消す**（数えて消すと、まだ使っていない人から消える）
       ③ 見出しと重なっている部分だけ削る（**見出しに無い中身は残す**）
       ④ 状態は文ではなく行にする。残すものは短くする（**事実は落とさない**）。 */
    {
      const keepItems = state.items, keepTab = view.tab, keepNotes = state.notes;
      /* **見本の画面（原文0件）で測らないこと**（2026-09-26）。見本では行が1つも無いので、
         なぞる案内は**指す先が無い**——そこで出ていたのが直したかった不具合そのもの。 */
      state.notes = [{ id: "brn", text: "見本ではない", capturedAt: new Date().toISOString() }];

      /* ① `hidden` を付けたら、本当に消えること。
         **クラス側の `display` に負ける**のが落とし穴で、実際
         設定タブの「最後に起きた不具合」が 214px 出たままだった（実測）。 */
      showTab("p-set");
      const err = $("#errCard");
      ok("BR. 不具合が無いとき、その欄は出ていない",
         !!err && err.hidden && err.getBoundingClientRect().height < 1,
         err ? "高さ" + Math.round(err.getBoundingClientRect().height) + "px" : "#errCard が無い");
      /* **1か所で守られていること**を見る（`#toast` だけ守る形に戻さない）。
         作ったばかりの要素でも消えるなら、規則は全体に効いている。 */
      {
        const probe = document.createElement("div");
        probe.className = "card stack"; probe.hidden = true;
        probe.textContent = "見えてはいけない";
        document.body.appendChild(probe);
        const h = probe.getBoundingClientRect().height;
        probe.remove();
        ok("BR. クラスで display を書いてある要素でも、hidden なら消える", h < 1, "高さ" + Math.round(h) + "px");
      }

      /* ② 使い方の案内は、覚えたら消える。**片道にしないこと**——
         覚えを消したらまた出る（戻せない道を作らない・決まり7.1）。 */
      const tz2 = state.settings.timezone, day2 = dayKey(new Date(), tz2);
      const at2 = (h, m) => { const p = parts(new Date(), tz2); return zoned(p.y, p.mo, p.d, h, m, tz2).toISOString(); };
      state.items = [
        { id: "br1", kind: "event", title: "打ち合わせ", status: "open", origin: "rule", fixed: true,
          dayKey: day2, duePrecision: "exact", start: at2(14, 0), end: at2(15, 0), history: [], evidence: {} },
        { id: "br2", kind: "task", title: "資料を作る", status: "open", origin: "rule",
          dayKey: day2, duePrecision: "none", estimateMin: 60, history: [], evidence: {} }];
      const keepDay = view.day; view.day = day2;
      const forget = () => { try { localStorage.removeItem("hitohi.tips"); } catch {} };
      const dayText = () => { renderDay(); return $("#p-day").textContent; };
      forget();
      ok("BR. まだ使っていない人には、なぞる案内が出る", /なぞると完了/.test(dayText()), "出ない");
      /* 「枠を押すと、理由と操作が出ます」は、使う前から出さない（2026-09-26・本人の指示・決まり15s）。 */
      ok("BR. 枠の案内は、まだ使っていない人にも出さない", !/枠を押すと/.test(dayText()), "出ている");
      markTip("swipe");
      ok("BR. 一度なぞれたら、なぞる案内は消える", !/なぞると完了/.test(dayText()), "残っている");
      forget();
      ok("BR. 覚えを消したら、また出る（片道を作らない）", /なぞると完了/.test(dayText()), "戻らない");
      /* **覚えは「この端末の中の、消えても困らないもの」**（決まり）。
         読めない端末では、**案内を出したままにする**ほうへ倒す。 */
      ok("BR. 覚えが読めなくても落ちない・案内は出したままにする",
         /return false/.test(String(tipDone)) && /catch/.test(String(tipDone)),
         "読めないときの逃げ道が無い");
      ok("BR. 覚えを書けなくても落ちない", /catch/.test(String(markTip)), "try が無い");

      /* ===== BS群：指す先の無い説明を出さない（2026-09-26・本人の指示「余計な部分をそぎ落として」）=====
         凡例・「枠を押すと」・なぞる案内は、**その日の画面に指す先があるときだけ**出す。
         空の日は、空の欄が1つ「まだ予定はありません」と言えば足りる。 */
      {
        const keepI = state.items;
        forget();
        state.items = [];
        let t = dayText();
        ok("BS. 枠が無い日に、凡例を出さない", !$("#p-day .legend") || /夜は空けています/.test($("#p-day .legend").textContent), $("#p-day .legend") && $("#p-day .legend").textContent);

        ok("BS. なぞれる行が無い日に、なぞる案内を出さない", !/なぞると完了/.test(t), "出ている");
        ok("BS. 空の日の知らせは1つだけ（上に重ねない）",
           !/この日に置ける予定・作業がありません/.test(t) && /まだ予定はありません/.test(t), t.slice(0, 80));
        /* 凡例は置かない（2026-09-26・決まり15s）。AIが読み取った枠の点は残し、
           何の点かは**枠を開いたところ**（由来の印）で読める。 */
        state.items = [Object.assign({}, keepI.find(i => i.id === "br1"), { origin: "ai", confirmed: false, corrected: false })];
        dayText();
        const aiRow = $("#p-day .bdot") && $("#p-day .bdot").closest(".tlrow");
        ok("BS. AIが読み取った枠には点が残り、開いた中にその説明がある",
           !!aiRow && /AIが読み取ったまま/.test((aiRow.querySelector(".bdetail") || {}).textContent || ""), aiRow ? "説明が無い" : "点が無い");
        // タスクの欄の行に「タスク」の印を付けない。由来の印は残す（決まり2）
        state.items = keepI;
        dayText();
        const row = $('#p-day [data-swipe="br2"] .item') || $('#p-day .item');
        const chips = row ? Array.from(row.querySelectorAll(".chip")).map(c => c.textContent) : [];
        ok("BS. 「タスク」の欄の行に、見出しと同じ種類の印を付けない", row && !chips.includes("タスク"), chips.join("/"));
        ok("BS. 由来の印は外さない（決まり2）", chips.some(c => /読み取ったまま|本人が訂正|確認済み/.test(c)), chips.join("/"));
        state.items = keepI;
      }
      {
        /* タブのアイコンは線の絵（2026-09-26）。文字の記号（◗◷◍⚙）は端末のフォントで形が変わり、
           「◗」は吹き出しに見えなかった。**4つとも絵で、文字の記号が戻っていないこと。** */
        const tabs = Array.from(document.querySelectorAll("nav.tabs button"));
        ok("BS. タブの4つとも、アイコンが絵（svg）になっている",
           tabs.length === 4 && tabs.every(b => b.querySelector(".ic svg")), tabs.length + "個");
        ok("BS. 文字の記号のアイコンが戻っていない",
           !tabs.some(b => /[◗◷◍⚙]/.test(b.textContent)), "戻っている");
        ok("BS. アイコンは読み上げない（名前は文字で読む）",
           tabs.every(b => (b.querySelector(".ic svg") || {}).getAttribute
             && b.querySelector(".ic svg").getAttribute("aria-hidden") === "true"), "読み上げられる");
        /* 「AIに送るのは…」は、AIを使っているときだけ（使っていないなら送るもの自体が無い）。 */
        const keepS2 = SAMPLEFN;
        SAMPLEFN = null; renderMe();
        ok("BS. AIを使っていないとき、「AIに送るのは」を出さない", !/AIに送るのは/.test($("#meOut").textContent), "出ている");
        SAMPLEFN = keepS2 || (() => {}); renderMe();
        ok("BS. AIを使っているとき、何を送るかは消さない（外部送信の決まり）",
           /AIに送るのは/.test($("#meOut").textContent), "消えている");
        SAMPLEFN = keepS2; renderMe();
      }
      {
        /* **画面から物を動かしたら、それを指している文を全部合わせる**（決まり6p・15j・15l）。
           「訂正」は 2026-09-24 に「…」の中へ移ったのに、それを指す文が4か所古いまま残っていた。
           「AIをオンに」は 2026-09-20 に設定から外したのに、案内だけ残っていた。
           見るのは**関数の中身**（画面を丸ごと検索しない・決まり）。 */
        const srcs = [applyOps, renderDay, renderMe, act].map(String).join("\n");
        ok("BS. 「訂正」を指す文は、「…」を通って指している",
           !/(?<!→)「訂正」(から|で)/.test(srcs), (srcs.match(/.{0,20}(?<!→)「訂正」(から|で).{0,10}/) || [""])[0]);
        ok("BS. もう無い設定（AIの入切）を案内しない", !/設定でAIをオン/.test(srcs), "残っている");
        ok("BS. 打っている間に「この端末に自動保存」と出さない", !/自動保存/.test(String(saveDraft)), "残っている");
      }
      /* 覚えるのは**実際に使えたときだけ**。できない項目をなぞっても覚えない。 */
      ok("BR. なぞれたときだけ覚える（できない項目では覚えない）",
         String(runSwipe).indexOf('if (!op) return false;') < String(runSwipe).indexOf('markTip'),
         "できない項目でも覚えてしまう");
      forget();

      /* ③ 見出しと重なっていた説明が、戻っていないこと。
         **未確認の知らせは、未確認が1件も無いと描かれない。**
         そのまま測ると「古い案内が無い」が**いつでも通ってしまう**ので
         （わざと古い文に戻しても落ちなかった・決まり14）、先に1件置く。 */
      state.items = state.items.concat([{ id: "br3", kind: "profile", title: "朝は弱い",
        status: "open", origin: "rule", category: "体のこと",
        confirmed: false, corrected: false, history: [], evidence: {} }]);
      showTab("p-me");
      const me = $("#p-me").textContent;
      ok("BR. 未確認の知らせが、実際に描かれている（測れていないのに通さない）",
         /件が未確認です/.test(me), "知らせが出ていない");
      const dup = [
        "自己紹介でも、昔の日記でも構いません。読み取って下の一覧に足します。",
        "あなたが渡した資料そのものです。",
        "日付が無いので、スケジュールには置いていません。"
      ].filter(t => me.includes(t));
      ok("BR. 見出しと同じことを、下でもう一度言っていない", dup.length === 0, dup.join(" / "));
      /* 「資料」の印の説明は、**印の付いた資料があるときだけ**出す（2026-09-26）。
         資料が0件なら指す先が無い。1件あれば出る——消しすぎていないことも見る。 */
      {
        const keepDocs = state.docs;
        state.docs = [];
        renderMe();
        ok("BR. 資料が無いときは、「資料」の印の説明を出さない",
           !/「資料」の印/.test($("#p-me").textContent), "出ている");
        state.docs = [{ id: "brd", title: "見本", text: "朝は弱い", hash: "x", chars: 4,
                        source: "paste", createdAt: new Date().toISOString() }];
        renderMe();
        ok("BR. 見出しに無い中身は残っている（資料があれば「資料」の印の話が出る）",
           /「資料」の印/.test($("#p-me").textContent), "消しすぎた");
        state.docs = keepDocs;
        renderMe();
      }
      /* 行のボタンは 2026-09-24 に「…」へ移した。**案内の文が古いまま残らないこと。** */
      ok("BR. 未確認の知らせが、いまのボタンの場所を指している",
         !/「訂正」か「取り消す」で直してください/.test(me), "古い案内が残っている");

      /* ④ **件数と置き場所の行は外した**（2026-09-26・本人の指示「この端末のみという表示はいらない」）。
         会話・原文・項目の件数は作る側の目安で、使う人が読んで打つ手が無い。
         **作業に使える時間帯は、狭いときだけ名指しする**（決まり6n）——そのときは
         `#windowWarn` が数字ごと出す。一日じゅうなら何も出さない。 */
      showTab("p-set");
      const setText = $("#p-set").textContent;
      ok("BR. 設定に、内部の件数を出さない",
         !$("#dataState") && !/原文\s*\d+件|項目\s*\d+件/.test(setText), "件数が残っている");
      ok("BR. 設定に「この端末のみ」を出さない（Android アプリの形）",
         DB || !/この端末のみ/.test(setText), "残っている");
      {
        const keepS = state.settings;
        state.settings = Object.assign({}, keepS, { workStart: "00:00", workEnd: "23:59" });
        renderSettings();
        // innerText は隠れた欄を読まない（textContent は読む）。タブは上で開いてある。
        ok("BR. 一日じゅうなら、時間帯の話を出さない",
           $("#windowWarn").hidden && !/作業に使える時間帯/.test($("#p-set").innerText), "出ている");
        state.settings = Object.assign({}, keepS, { workStart: "05:00", workEnd: "11:00" });
        renderSettings();
        ok("BR. 狭いときは、数字ごと名指しする（決まり6n）",
           !$("#windowWarn").hidden && /05:00〜11:00/.test($("#windowWarn").textContent),
           $("#windowWarn").textContent.slice(0, 60));
        state.settings = keepS; renderSettings();
      }

      state.items = keepItems; state.notes = keepNotes; view.day = keepDay; showTab(keepTab);
    }

    /* ===== BT群：読み取りの3つ（2026-09-26・本人の指示「読み取りの３つも直して」）=====
       15l の最後に「気づいたが直していないこと」として挙げた3つ。
       ① 目標の見出しから「毎日30分」を落とさない（くり返しと長さが目標の中身そのもの）
       ② 同じ行の別の文の「今日」を、目標の期限に持ち込まない
       ③ 「今日は少し頭が痛い。」を体調として拾う（前は何も記録されなかった）
       **③は広げすぎない**：「頭が痛いから病院に行かないと」は用事、
       「夜はいつも頭が痛くなる」は変わらないこと（わたしのこと）のまま。 */
    {
      const keepItems = state.items, keepNotes = state.notes, keepTurns = state.turns, keepDocs = state.docs;
      const by = k => state.items.filter(i => i.kind === k);

      reset();
      await say("毎日30分は歩きたい。", T(9, 0));
      const g1 = by("goal")[0];
      ok("BT. 目標の見出しに「毎日30分」が残る",
         !!g1 && /毎日/.test(g1.title) && /30分/.test(g1.title), g1 ? g1.title : "目標が無い");

      reset();
      await say("今日は少し頭が痛い。夜は予定を入れないで。毎日30分は歩きたい。", T(9, 0));
      const g2 = by("goal")[0];
      ok("BT. 別の文の「今日」を、目標の期限にしない",
         !!g2 && !g2.dayKey && g2.duePrecision !== "day",
         g2 ? (g2.dayKey || "-") + " / " + g2.duePrecision : "目標が無い");
      /* 上の行は体調も拾うので `single` が偽になり、行の日付はもともと渡らない。
         **③を直したせいで②が見えなくなる**ので、目標しか拾わない行でも測る。 */
      reset();
      await say("今日は雨で出かけられなかった。毎日30分は歩きたい。", T(9, 0));
      const g3 = by("goal")[0];
      ok("BT. 目標しか拾わない行でも、別の文の「今日」を期限にしない",
         !!g3 && state.items.length === 1 && !g3.dayKey && g3.duePrecision !== "day",
         JSON.stringify(state.items.map(i => i.kind + ":" + i.title + "/" + (i.dayKey || "-"))));
      reset();
      await say("今日は少し頭が痛い。夜は予定を入れないで。毎日30分は歩きたい。", T(9, 0));
      const c2 = by("condition")[0];
      ok("BT. 同じ行の体調は、その文だけを本人の言葉として残す",
         !!c2 && c2.selfReport === "今日は少し頭が痛い。", c2 ? c2.selfReport : "体調が無い");
      ok("BT. 同じ行の要望は、要望のまま",
         by("preference").length === 1, JSON.stringify(state.items.map(i => i.kind)));

      reset();
      await say("今日は少し頭が痛い。", T(9, 0));
      ok("BT. 「今日は少し頭が痛い」を体調として拾う",
         by("condition").length === 1 && state.items.length === 1,
         JSON.stringify(state.items.map(i => i.kind + ":" + i.title)));

      reset();
      await say("お腹が痛い。明日までに資料を作らないと。", T(9, 0));
      ok("BT. 体調と用事が同じ行でも、両方拾う",
         by("condition").length === 1 && by("task").length === 1,
         JSON.stringify(state.items.map(i => i.kind + ":" + i.title)));

      reset();
      await say("頭が痛いから病院に行かないと", T(9, 0));
      ok("BT. 「痛いから病院に行かないと」は用事のまま",
         by("condition").length === 0 && (by("task").length + by("event").length) === 1,
         JSON.stringify(state.items.map(i => i.kind + ":" + i.title)));

      reset();
      await say("歯が痛いので歯医者に行く", T(9, 0));
      ok("BT. 「痛いので歯医者に行く」は体調にしない",
         by("condition").length === 0 && (by("task").length + by("event").length) === 1,
         JSON.stringify(state.items.map(i => i.kind + ":" + i.title)));

      reset();
      await say("夜はいつも頭が痛くなる", T(9, 0));
      ok("BT. 「いつも頭が痛くなる」は変わらないこと（体調にしない・決まり3b）",
         by("condition").length === 0 && by("profile").length === 1,
         JSON.stringify(state.items.map(i => i.kind + ":" + i.title)));

      state.items = keepItems; state.notes = keepNotes; state.turns = keepTurns; state.docs = keepDocs;
    }

    /* ===== BU群：使っていて気持ちがいい瞬間（2026-09-26・本人の指示「全て取り入れて」）=====
       A 終わったときに気持ちいい／B 分かってくれている／C 開いた瞬間にほっとする／D 見た目。
       **本物の時計に寄りかからない**（決まり6p の BM群と同じ）：時刻に左右される「次は」の枠は
       ここでは見ず、時刻の無い用事と、完了したものだけで測る。 */
    {
      const keepItems = state.items, keepNotes = state.notes, keepTurns = state.turns, keepDocs = state.docs;
      const keepChatDay = view.chatDay, keepDay = view.day, keepTab = view.tab;
      const tz = state.settings.timezone, today = dayKey(new Date(), tz);
      const nowISO = new Date().toISOString();
      const mkTask = (title, extra) => Object.assign({ id: uid(), noteId: "n-bu", kind: "task", title, origin: "rule",
        confirmed: false, status: "open", history: [], evidence: { text: title, start: 0, end: title.length },
        dayKey: today, duePrecision: "day", due: nowISO, estimateMin: 15, createdAt: nowISO, dedupeKey: "bu-" + title }, extra || {});

      // --- B：置いた理由は、本人の言葉を指すものだけ ---
      ok("BU. 本人の言葉を指す理由は出す", saidWhy({ reason: "14:00からと言っていました" }) === "14:00からと言っていました");
      ok("BU. こちらが数えた理由は出さない", saidWhy({ reason: "期限まであと4日" }) === "" && saidWhy({}) === "");
      {
        const b = { s: 600, e: 660, type: "flex", reason: "今日中にと言っていたので前倒しです", item: { id: "x", title: "資料を作る", kind: "task" } };
        const sn = planSnapshot({ blocks: [b], unplaced: [], timeless: [], winS: 0, winE: 1440, pref: {} }, { block: b, nowMin: 500 });
        ok("BU. 返事の「次にすること」に、本人の言葉の理由が載る", sn.next && sn.next.why === "今日中にと言っていたので前倒しです");
        const h = turnHTML({ role: "assistant", text: "了解", at: nowISO, plan: sn, changes: [] });
        ok("BU. 吹き出しの下に、その1行が出る", /class="nw">今日中にと言っていたので前倒しです/.test(h));
      }
      // --- B：覚えたことを、本人の言葉のまま返す ---
      {
        state.items = [];
        const n = { id: "n-bu" };
        const pf = { id: uid(), noteId: "n-bu", kind: "profile", title: "昔から朝のほうが集中できるタイプ", status: "open" };
        const gl = { id: uid(), noteId: "n-bu", kind: "goal", title: "毎日30分は歩きたい", status: "open" };
        const cd = { id: uid(), noteId: "n-bu", kind: "condition", title: "頭が痛い", status: "open" };
        state.items = [pf, gl, cd];
        ok("BU. わたしのことは、本人の言葉で「覚えておくね」", learnedLine(n, [pf.id]) === "「昔から朝のほうが集中できるタイプ」、覚えておくね。");
        ok("BU. 続けたいことは、そうと言って覚える", learnedLine(n, [gl.id]) === "「毎日30分は歩きたい」、続けたいこととして覚えておくね。");
        ok("BU. 体調は「覚えた」に入れない（決まり3・その日の話）", learnedLine(n, [cd.id]) === "");
        ok("BU. 別の発言のものは言わない", learnedLine({ id: "other" }, [pf.id]) === "");
        const pr = quickPrompt({ text: "眠い" }, { p: { mo: 9, d: 26, h: 9, mi: 0 }, me: ["性格・傾向：朝型"], pf: [] });
        ok("BU. 速い返事は「覚えておく」と言わない（言うのはコード）", /「覚えておく」と言わない/.test(pr));
        ok("BU. 速い返事は、関係するときだけ前の話に触れてよい", /前に〜と言っていましたね/.test(pr) && /関係が薄ければ触れない/.test(pr));
      }
      /* **形だけ見て終わらせない。速い返事がある道を、実際に1回流す**（決まり14）。
         `learnedLine` が正しくても、吹き出しへ入れる1行を消したら画面には出ない。 */
      {
        const keepAI = SAMPLEFN, keepView = view.day, keepChat = view.chatDay;
        const stub = () => Promise.resolve({ text: "そうなんだね。" });
        stub.json = () => Promise.resolve({ ops: [], habit: "" });   // 本体AIは何も返さない → ルールが読む（決まり7）
        SAMPLEFN = stub; reset();
        await sendTurn("昔から朝のほうが集中できるタイプ。");
        const turn = (state.turns[today] || []).filter(t => t.role === "assistant").pop();
        SAMPLEFN = keepAI; view.day = keepView; view.chatDay = keepChat;
        const txt = turn ? turn.text : "";
        ok("BU. AIがあっても、覚えたことを本人の言葉で返す",
           /「昔から朝のほうが集中できるタイプ」、覚えておくね/.test(txt) && txt.startsWith("そうなんだね。"), txt.slice(0, 80));
      }
      // --- C／A：会話の下のカード ---
      state.notes = [{ id: "n-bu", text: "x", hash: "bu", capturedAt: nowISO, source: "talk", createdAt: nowISO }];
      state.turns = {}; view.chatDay = today;
      {
        state.items = [mkTask("請求書を送る")];
        const h = nowCardHTML();
        ok("BU. 時刻の無い今日の用事が残っていれば、カードが件数を言う", /id="nowCard"/.test(h) && /1件/.test(h) && /data-act="openday"/.test(h), h.slice(0, 120));
        ok("BU. 残っているうちは「全部です」と言わない", finishedLine(today) === "" && leftToday(planFor(today)) === 1);
        state.items = [mkTask("請求書を送る", { status: "done", completedAt: nowISO })];
        const f = nowCardHTML();
        ok("BU. 全部終えたら、今日できたことを1枚にまとめる", /class="nowcard fin"/.test(f) && /請求書を送る/.test(f) && /これで全部です/.test(f), f.slice(0, 160));
        ok("BU. 最後の1つのあとなら「全部です」と言う", /これで全部です/.test(finishedLine(today)));
        view.chatDay = "2000-01-01";
        ok("BU. 前の日の会話を見ているときは、今日のカードを出さない", nowCardHTML() === "");
        view.chatDay = today;
        const keepN = state.notes; state.notes = [];
        ok("BU. 見本の画面では出さない", nowCardHTML() === "");
        state.notes = keepN;
        state.items = [];
        ok("BU. 何も無い日は、カードを出さない", nowCardHTML() === "");
      }
      // --- A：完了したとき、最後の1つならそう言う（実際に act を通す） ---
      {
        const t1 = mkTask("メールを返す"), t2 = mkTask("牛乳を買う");
        state.items = [t1, t2];
        await act("done", t1.id, null);
        const m1 = ($("#toast") && $("#toast").textContent) || "";
        ok("BU. 1つ目の完了では「全部です」と言わない", /完了にしました：メールを返す/.test(m1) && !/これで全部/.test(m1), m1.slice(0, 60));
        await act("done", t2.id, null);
        const m2 = ($("#toast") && $("#toast").textContent) || "";
        ok("BU. 最後の1つを完了すると「これで全部です」", /完了にしました：牛乳を買う。今日の予定は、これで全部です/.test(m2), m2.slice(0, 80));
        ok("BU. 「元に戻す」は残っている（押し間違いから戻れる）", !!document.querySelector("#toast button"));
        const t3 = mkTask("来週の資料", { dayKey: "2099-01-01", due: "2099-01-01T00:00:00.000Z" });
        state.items = [t3];
        await act("done", t3.id, null);
        ok("BU. 今日の用事でないものを終えても「全部です」と言わない", !/これで全部/.test(($("#toast") && $("#toast").textContent) || ""));
      }
      // --- A：動きを減らす設定なら、待たずに描き直す ---
      {
        const row = document.createElement("div"); row.className = "item"; document.body.appendChild(row);
        const btn = document.createElement("button"); row.appendChild(btn);
        const t0 = Date.now(); await celebrate(btn, null);
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        ok("BU. 動きを減らす設定では、光らせずにすぐ進む", reduce && !row.classList.contains("celebrate") && Date.now() - t0 < 200, String(reduce));
        row.remove();
        let css = ""; for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) css += r.cssText + "\n"; } catch {} }
        ok("BU. 完了の光り方が定義されている", /\.celebrate/.test(css) && /donepop/.test(css));
      }
      // --- D：予定表の行に、アイコンと同じ「時間軸の上の丸」 ---
      {
        const h = timelineHTML(demoPlan(), null, true);
        // 予定も作業も同じ丸（2026-09-26・決まり15s）
        ok("BU. 予定と作業の行は、同じ塗った丸", (h.match(/class="tlrow b d-main/g) || []).length >= 2 && !/d-fix|d-flex/.test(h));
        ok("BU. 空き時間の行には丸を付けない", !/tlrow gaprow b/.test(h) && !/class="tlrow b[^"]*gaprow/.test(h));
      }
      state.items = keepItems; state.notes = keepNotes; state.turns = keepTurns; state.docs = keepDocs;
      view.chatDay = keepChatDay; view.day = keepDay; hideToast(); showTab(keepTab);
    }

    /* ===== BV群：読点のあとの付け足しで、用事が消えない（2026-09-26・本人の指示「読点の不具合も直して」）=====
       「資料を作る、1時間。」が**何も記録されず**「予定はそのままにしてある」と返っていた。
       用事かどうかは文の終わりの動詞で見ているので、「、1時間」で終わると用事と判定されなかった。
       **句点で区切れば拾えていた**——読点1つで結果が変わっていた。 */
    {
      const keepItems = state.items, keepNotes = state.notes, keepTurns = state.turns, keepDocs = state.docs;
      const read = async t => { reset(); await say(t, T(9, 0)); return state.items.map(i => i); };
      let got;
      got = await read("資料を作る、1時間。");
      ok("BV. 「資料を作る、1時間。」が用事になる", got.length === 1 && got[0].kind === "task" && got[0].title === "資料を作る" && got[0].estimateMin === 60,
         JSON.stringify(got.map(i => [i.kind, i.title, i.estimateMin])));
      got = await read("牛乳を買う、あとで。");
      ok("BV. 「、あとで」を見出しに残さない", got.length === 1 && got[0].title === "牛乳を買う", JSON.stringify(got.map(i => i.title)));
      got = await read("資料を作る1時間。");
      ok("BV. 読点が無くても、動詞のすぐあとの所要時間で消えない", got.length === 1 && got[0].kind === "task" && got[0].estimateMin === 60,
         JSON.stringify(got.map(i => [i.kind, i.title, i.estimateMin])));
      got = await read("明日までにレポートを書く、2時間。");
      ok("BV. 期限と所要時間の両方が残る", got.length === 1 && got[0].dayKey === NEXT && got[0].estimateMin === 120,
         JSON.stringify(got.map(i => [i.title, i.dayKey, i.estimateMin])));
      got = await read("資料を作る、2時間くらいかかりそう。");
      ok("BV. 「、2時間くらいかかりそう」でも用事になる", got.length === 1 && got[0].kind === "task" && got[0].estimateMin === 120,
         JSON.stringify(got.map(i => [i.kind, i.title, i.estimateMin])));
      got = await read("散歩しようかな、30分。");
      ok("BV. 外すと問いかけになる形は、前のまま（気になっていること）", got.length === 1 && got[0].kind === "idea",
         JSON.stringify(got.map(i => [i.kind, i.title])));
      got = await read("毎日歩く、30分。");
      ok("BV. 続けたいことでは「30分」を見出しから落とさない（決まり3d）", got.length === 1 && got[0].kind === "goal" && /30分/.test(got[0].title),
         JSON.stringify(got.map(i => [i.kind, i.title])));
      got = await read("打ち合わせ、10時から。");
      ok("BV. 予定は予定のまま", got.length === 1 && got[0].kind === "event" && got[0].title === "打ち合わせ",
         JSON.stringify(got.map(i => [i.kind, i.title])));
      state.items = keepItems; state.notes = keepNotes; state.turns = keepTurns; state.docs = keepDocs;
    }

    /* ===== BW群：「わたしのこと」を、働く場所にする（2026-09-26・本人の指示「何のためにあるのか、機能しているのか」）=====
       調べて分かったこと：①続けたいことは並ぶだけで予定にも記録にもつながっていなかった
       ②気になっていることは「…」→「訂正」→種類を変える、の3手でしかやることにできなかった
       ③「朝のほうが集中できるタイプ。」が体調として記録され、翌日には効かなかった
       ④いちばん効いている「こうしてほしい」がタブのいちばん下にあった。 */
    {
      const keepItems = state.items, keepNotes = state.notes, keepTurns = state.turns, keepDocs = state.docs, keepTab = view.tab;
      const tz = state.settings.timezone, today = dayKey(new Date(), tz);
      const kinds = async t => { reset(); await say(t, T(9, 0)); return state.items.map(i => i.kind).join(","); };
      ok("BW. 「〜なタイプ」で言い切る文は、わたしのこと", await kinds("朝のほうが集中できるタイプ。") === "profile");
      ok("BW. 「〜な体質なんだよね」も、わたしのこと", await kinds("夜型の体質なんだよね") === "profile");
      ok("BW. 途中に「タイプ」があるだけの用事は、用事のまま", await kinds("Aタイプの資料を作る") === "task");
      ok("BW. 今日の話は、体調のまま（決まり3b）", await kinds("今日は集中できない") === "condition");
      ok("BW. 「〜になりたい」は体調ではなく、続けたいこと", await kinds("集中できるタイプになりたい") === "goal");

      ok("BW. 予定の名前の候補：「毎日30分は歩きたい」→「歩く」", goalActTitle("毎日30分は歩きたい") === "歩く");
      ok("BW. 予定の名前の候補：「英語を勉強したい」→「英語を勉強する」", goalActTitle("英語を勉強したい") === "英語を勉強する");

      // --- 続けたいこと → 予定（実際に act を通す） ---
      reset();
      await say("毎日30分は歩きたい。", T(9, 0));
      const g = state.items.find(i => i.kind === "goal");
      ok("BW. 予定にしていない目標には「予定にする」が出る", !!g && /data-act="goalplan"/.test(itemHTML(g)));
      await act("goalplan", g.id, null);
      ok("BW. 押すと、時刻を聞く画面が開く", !!$("#gpH") && $("#gpT").value === "歩く" && +$("#gpM").value === 30,
         ($("#gpT") || {}).value + " / " + ($("#gpM") || {}).value);
      $("#gpH").value = "";
      await act("goalplansave", g.id, null);
      ok("BW. 時刻を選ばずに押しても、こちらで決めない（決まり6a）",
         !state.items.some(i => i.goalId === g.id) && /時刻を選んで/.test($("#gpMsg").textContent));
      $("#gpH").value = "07:00";
      await act("goalplansave", g.id, null);
      const ev = state.items.find(i => i.goalId === g.id);
      ok("BW. 毎日7時からの、くり返しの予定が1件だけできる（決まり4f）",
         !!ev && ev.kind === "event" && ev.repeat && ev.repeat.kind === "daily" && fmtDT(ev.start, tz).slice(-5) === "07:00"
         && Math.round((new Date(ev.end) - new Date(ev.start)) / 60000) === 30 && state.items.filter(i => i.goalId === g.id).length === 1,
         ev ? JSON.stringify([ev.kind, ev.repeat, fmtDT(ev.start, tz), ev.end]) : "無い");
      ok("BW. 目標と予定がつながる", g.planId === (ev || {}).id && goalPlan(g) === ev);
      ok("BW. 予定にしたら、ボタンの代わりに予定と回数を書く",
         !/data-act="goalplan"/.test(itemHTML(g)) && /毎日 07:00から30分の予定にしています/.test(goalNote(g)), goalNote(g));
      ev.doneDays = [today];
      ok("BW. 続いた回数は、押した記録から数える（点数にしない）", /この7日で1回（予定は1日）/.test(goalNote(g)), goalNote(g));
      ok("BW. 始まる前の日は、予定のあった日に数えない", goalCount(ev, today, tz).due === 1);
      const undo = document.querySelector("#toast button");
      ok("BW. 「元に戻す」が出る", !!undo);
      if (undo) { undo.click(); await waitUntil(() => !g.planId, 1500); }
      ok("BW. 元に戻すと、予定は取り消し・目標は予定前に戻る",
         !g.planId && (findItem(ev.id) || {}).status === "dropped", JSON.stringify([g.planId, (findItem(ev.id) || {}).status]));
      closeSheet();

      // --- 気になっていること → やること ---
      reset();
      await say("いつか陶芸をやってみたいかも。", T(9, 0));
      const idea = state.items.find(i => i.kind === "idea");
      ok("BW. 気になっていることには「やることにする」が出る", !!idea && /data-act="ideatask"/.test(itemHTML(idea)));
      ok("BW. 気になっていることは、いつ言ったかを出す（見直しどき）", !!idea && /に言っていたこと/.test(itemHTML(idea)));
      await act("ideatask", idea.id, null);
      ok("BW. 1回で、やることになる", idea.kind === "task" && idea.status === "open" && (idea.history || []).some(h => /やることにした/.test(h.what)));
      const u2 = document.querySelector("#toast button");
      if (u2) { u2.click(); await waitUntil(() => idea.kind === "idea", 1500); }
      ok("BW. 元に戻すと、気になっていることへ戻る", idea.kind === "idea");

      // --- 並び：いま効いているものから ---
      reset();
      state.notes = [{ id: "n-bw", text: "x", hash: "bw", capturedAt: T(9, 0), source: "talk", createdAt: T(9, 0) }];
      for (const t of ["毎日30分は歩きたい。", "夜は予定を入れないで。", "朝のほうが集中できるタイプ。", "いつか陶芸をやってみたいかも。"]) await say(t, T(9, 0));
      showTab("p-me");
      const tx = $("#p-me").textContent;
      const at = w => tx.indexOf(w);
      ok("BW. 並びは 続けたいこと → こうしてほしい → 会話から集まったこと → 気になっていること → 自分で渡したもの",
         at("続けたいこと") >= 0 && at("続けたいこと") < at("こうしてほしい、と言ったこと")
         && at("こうしてほしい、と言ったこと") < at("会話から集まったこと") && at("会話から集まったこと") < at("気になっていること")
         && at("気になっていること") < at("自分で渡したもの"),
         ["続けたいこと", "こうしてほしい、と言ったこと", "会話から集まったこと", "気になっていること", "自分で渡したもの"].map(at).join(","));
      ok("BW. 古い案内（「…」→「訂正」で種類を変える）が戻っていない", !/種類を「タスク」に変えて/.test(tx));

      state.items = keepItems; state.notes = keepNotes; state.turns = keepTurns; state.docs = keepDocs; hideToast(); showTab(keepTab);
    }

    /* ===== BX群：体のこと・週に1回の見直し・古いことの聞き直し・今週の気づき（2026-09-26・本人の指示）===== */
    {
      const keepItems = state.items, keepNotes = state.notes, keepTurns = state.turns, keepDocs = state.docs;
      const keepSet = state.settings, keepAI = SAMPLEFN, keepTab = view.tab, keepChat = view.chatDay;
      const tz = state.settings.timezone, nowISO = new Date().toISOString(), today = dayKey(new Date(), tz);
      const mkNote = (text, at) => ({ id: uid(), text, hash: "bx" + Math.random(), capturedAt: at || nowISO, source: "talk", createdAt: at || nowISO });

      // --- 体のことをAIに渡す ---
      reset();
      const n1 = mkNote("今日は少し頭が痛い。"); await putNote(n1); await applyOps(ruleOps(n1), n1);
      state.items.push({ id: uid(), kind: "profile", category: "体のこと", title: "季節の変わり目に体調を崩しやすい", status: "open", createdAt: nowISO });
      const cx = contextForAI(mkNote("何しよう"));
      ok("BX. その日の体調（本人の申告）をAIに渡す", (cx.body || []).some(x => /頭が痛い/.test(x)), JSON.stringify(cx.body));
      ok("BX. 体のことのわたしのことも、別の欄で渡す（先頭8件で切られない）", (cx.body || []).some(x => /季節の変わり目/.test(x)));
      const bp = buildPrompt(mkNote("何しよう"), cx), qp = quickPrompt(mkNote("何しよう"), cx);
      ok("BX. 本体の依頼文に体のことが入り、診断しないと書いてある", /【体のこと/.test(bp) && /頭が痛い/.test(bp) && /診断しない/.test(bp));
      ok("BX. 速い返事の依頼文にも体のことが入る", /【体のこと/.test(qp) && /頭が痛い/.test(qp) && /診断しない/.test(qp));

      // --- 設定：週に1回の見直し ---
      ok("BX. 見直しの曜日は -1〜6 に収める", safeSettings({ reviewDow: 9 }).reviewDow === 6 && safeSettings({ reviewDow: -1 }).reviewDow === -1
         && safeSettings({ reviewDow: "x" }).reviewDow === 0 && safeSettings({ reviewHour: 30 }).reviewHour === 23);
      state.settings = Object.assign({}, keepSet, { reviewDow: 6, reviewHour: 20 });   // 2026-09-26 は土曜
      const at = (d, h) => zoned(2026, 9, d, h, 0, tz);
      ok("BX. 次の見直し：土曜10時なら、その日の20時", nextReviewAt(at(26, 10)).getTime() === at(26, 20).getTime());
      ok("BX. 次の見直し：土曜21時なら、翌週の土曜20時", nextReviewAt(at(26, 21)).getTime() === zoned(2026, 10, 3, 20, 0, tz).getTime());
      ok("BX. 見直しの日の、その時刻より後だけ「見直しの日」", reviewNow(at(26, 20)) && !reviewNow(at(26, 19)) && !reviewNow(at(25, 21)));
      state.settings = Object.assign({}, keepSet, { reviewDow: -1 });
      ok("BX. 「知らせない」なら、次の見直しも通知も無い", nextReviewAt(at(26, 10)) === null && reviewNotice(at(26, 10)) === null);

      // --- 見直しの通知（押すと「わたしのこと」が開く） ---
      state.settings = Object.assign({}, keepSet, { reviewDow: parts(new Date(), tz).dow, reviewHour: 23 });
      reset(); state.items = [{ id: uid(), kind: "idea", title: "陶芸", status: "open", createdAt: nowISO }];
      const rv = reviewNotice(new Date(Date.now() - 1000 * 60 * 60 * 48));
      ok("BX. 見直しの知らせは「完了」ボタンなし・開く画面つき・件数を言う",
         !!rv && rv.plain === true && rv.tab === "p-me" && /気になっていること1件/.test(rv.body), JSON.stringify(rv));
      showTab("p-chat");
      nativeReply(JSON.stringify({ kind: "notifyopen", tab: "p-me" }));
      ok("BX. 見直しの通知を押すと「わたしのこと」が開く", view.tab === "p-me");
      showTab("p-chat");
      nativeReply(JSON.stringify({ kind: "notifyopen", tab: "p-set" }));
      ok("BX. 知らない画面の名前は受け取らない（来た値は疑う・決まり14）", view.tab === "p-chat");

      // --- 会話の下のカードに、見直しの日の1行 ---
      state.notes = [mkNote("x")]; view.chatDay = today;
      state.settings = Object.assign({}, keepSet, { reviewDow: parts(new Date(), tz).dow, reviewHour: 0 });
      ok("BX. 見直しの日は、会話の下に「見直す」が出る", /今日は見直しの日：気になっていること1件/.test(nowCardHTML()) && /data-act="openme"/.test(nowCardHTML()), nowCardHTML().slice(0, 200));
      state.settings = Object.assign({}, keepSet, { reviewDow: -1 });
      ok("BX. 知らせない設定なら、その1行も出さない", !/見直しの日/.test(nowCardHTML()));

      // --- 古くなったかもしれないこと ---
      state.settings = keepSet;
      reset();
      const old = new Date(Date.now() - 120 * 86400000).toISOString();
      const pOld = { id: uid(), kind: "profile", category: "性格・傾向", title: "朝型", status: "open", statedAt: old, createdAt: old, history: [] };
      const pNew = { id: uid(), kind: "profile", category: "好み", title: "コーヒーが好き", status: "open", statedAt: nowISO, createdAt: nowISO, history: [] };
      state.items = [pOld, pNew];
      ok("BX. 90日たったものだけ「まだ合っていますか」の対象", staleProfiles(new Date()).map(p => p.id).join() === pOld.id);
      showTab("p-me");
      ok("BX. 「わたしのこと」のいちばん上で聞く", $("#p-me").textContent.indexOf("まだ合っていますか") >= 0
         && $("#p-me").textContent.indexOf("まだ合っていますか") < $("#p-me").textContent.indexOf("会話から集まったこと"));
      await act("stillok", pOld.id, null);
      ok("BX. 「まだ合っている」を押すと、しばらく聞かない", !staleProfiles(new Date()).length && !!pOld.checkedAt && pOld.status === "open");
      const u = document.querySelector("#toast button"); if (u) { u.click(); await waitUntil(() => !pOld.checkedAt, 1500); }
      ok("BX. 元に戻すと、また聞く", staleProfiles(new Date()).length === 1);
      ok("BX. 1回に聞くのは2件まで（時々）", (() => { state.items = [0,1,2,3].map(k => Object.assign({}, pOld, { id: uid(), title: "古い" + k })); renderMe();
        return document.querySelectorAll('#p-me [data-act="stillok"]').length === 2; })());

      // --- 今週の気づき ---
      reset();
      for (const t of ["夜ふかしすると次の日ぜんぜん進まない", "いつか陶芸をやってみたいかも", "今日は少し頭が痛い", "散歩すると気分が軽くなる"]) state.notes.push(mkNote(t));
      const good = checkInsights({ insights: [
        { text: "夜の過ごし方が、次の日に響いているようです", quotes: ["夜ふかしすると次の日ぜんぜん進まない"] },
        { text: "言い換えた引用しか無い気づきかもしれません", quotes: ["夜更かしで翌日だめ"] },
        { text: "うつ傾向があるかもしれません", quotes: ["頭が痛い"] },
        { text: "夜型です", quotes: ["夜ふかし"] },
        { text: "8割の日に疲れているようです", quotes: ["頭が痛い"] } ] }, new Date());
      ok("BX. 通るのは、推測の形で・原文どおりの根拠がある気づきだけ", good.length === 1 && /響いているようです/.test(good[0].text), JSON.stringify(good));
      SAMPLEFN = null;
      ok("BX. AIが無ければ「今週の気づきを作る」は出さない", !canMakeInsight(new Date()));
      const stub = () => Promise.resolve({ text: "うん" });
      stub.json = () => Promise.resolve({ insights: [{ text: "体を動かすと、気持ちが軽くなるようです", quotes: ["散歩すると気分が軽くなる"] }] });
      SAMPLEFN = stub;
      ok("BX. 発言が3つ以上あり、AIがあれば作れる", canMakeInsight(new Date()));
      const made = await makeInsights();
      const ins = state.items.find(i => i.kind === "insight");
      ok("BX. 気づきは根拠の引用つきで保存される", made === 1 && !!ins && ins.origin === "ai" && ins.confirmed === false && ins.quotes[0] === "散歩すると気分が軽くなる");
      ok("BX. 作ったあと6日は、もう一度作れない（週に1回）", !canMakeInsight(new Date()));
      ok("BX. 「合ってる」を押すまで、気づきはAIに渡さない（推測を確定にしない）", !contextForAI(mkNote("x")).me.some(x => /気持ちが軽く/.test(x)));
      showTab("p-me");
      ok("BX. 画面に「AIの気づき（推測）」の印と引用が出る", /AIの気づき（推測）/.test($("#p-me").textContent) && /「散歩すると気分が軽くなる」/.test($("#p-me").textContent));
      await act("insightyes", ins.id, null);
      ok("BX. 「合ってる」でわたしのことに入り、AIにも渡るようになる",
         ins.status === "done" && state.items.some(i => i.kind === "profile" && i.fromInsight === ins.id && i.confirmed)
         && contextForAI(mkNote("x")).me.some(x => /気持ちが軽く/.test(x)));
      reset(); for (const t of ["a1", "a2", "a3"]) state.notes.push(mkNote(t));
      const g2 = { id: uid(), kind: "insight", title: "x のようです", quotes: ["a1"], status: "open", origin: "ai", createdAt: nowISO, history: [] };
      state.items = [g2];
      await act("insightno", g2.id, null);
      ok("BX. 「違う」で外れる（わたしのことには入らない）", g2.status === "dropped" && !state.items.some(i => i.kind === "profile"));

      state.items = keepItems; state.notes = keepNotes; state.turns = keepTurns; state.docs = keepDocs;
      state.settings = keepSet; SAMPLEFN = keepAI; view.chatDay = keepChat; hideToast(); showTab(keepTab);
    }

    /* ===== BY群：訂正する（2026-09-26・本人の指示「訂正するのところのUIとUXを」）=====
       測って出てきた不具合2つ：わたしのことを直すと黙ってタスクになる／予定を保存すると長さが1時間に戻る。 */
    {
      const keepItems = state.items, keepNotes = state.notes, keepTab = view.tab;
      const tz = state.settings.timezone, nowISO = new Date().toISOString();
      const vis = sel => { const el = document.querySelector(`#sheetHost [data-for="${sel}"]`); return !!el && !el.hidden; };
      const save = async it => { await act("save", it.id, null); };

      reset();
      const pf = { id: uid(), kind: "profile", category: "性格・傾向", title: "朝型", status: "open", origin: "rule", confirmed: false, history: [], createdAt: nowISO, evidence: { text: "昔から朝型" } };
      state.items = [pf];
      openEdit(pf);
      ok("BY. わたしのことを開くと、種類は「わたしのこと」のまま", $("#eK").value === "profile");
      ok("BY. わたしのことには分類だけ出す（日付・時間の欄は出さない）", vis("cat") && !vis("when") && !vis("est") && !vis("len"));
      ok("BY. 元の言葉を見せる", /元の言葉：「昔から朝型」/.test($("#sheetHost").textContent));
      $("#eT").value = "朝は強い"; $("#eC").value = "体のこと";
      await save(pf);
      ok("BY. 名前と分類を直しても、種類は変わらない", pf.kind === "profile" && pf.title === "朝は強い" && pf.category === "体のこと" && pf.corrected);

      // 予定：長さを保つ
      const st = zoned(2026, 9, 12, 20, 0, tz);
      const ev = { id: uid(), kind: "event", title: "電話", status: "open", origin: "rule", history: [], createdAt: nowISO,
        start: st.toISOString(), end: new Date(st.getTime() + 120 * 60000).toISOString(), dayKey: "2026-09-12", duePrecision: "exact", fixed: true };
      state.items = [ev];
      openEdit(ev);
      ok("BY. 予定には長さの欄（いまの長さ）を出し、かかる時間の欄は出さない", vis("len") && !vis("est") && +$("#eL").value === 120);
      await save(ev);
      ok("BY. 何も変えずに保存しても、予定の長さは変わらない（前は1時間に戻っていた）",
         Math.round((new Date(ev.end) - new Date(ev.start)) / 60000) === 120, ev.end);
      ok("BY. 何も変えずに保存したら「確かめた」だけ（本人が訂正の印は付けない）", ev.confirmed === true && !ev.corrected);
      openEdit(ev); $("#eL").value = "45"; await save(ev);
      ok("BY. 長さを直せる", Math.round((new Date(ev.end) - new Date(ev.start)) / 60000) === 45 && ev.corrected);

      // 用事：確かさは入れたものから決まる
      const tk = { id: uid(), kind: "task", title: "資料", status: "open", origin: "rule", history: [], createdAt: nowISO, duePrecision: "none" };
      state.items = [tk];
      openEdit(tk);
      ok("BY. 用事には日付・はっきりしない・かかる時間を出す", vis("when") && vis("vague") && vis("est") && !vis("len") && !vis("cat"));
      $("#eD").value = "2026-09-20"; await save(tk);
      ok("BY. 日付だけ入れたら「その日まで」", tk.duePrecision === "day" && tk.dayKey === "2026-09-20");
      openEdit(tk); $("#eH").value = "14:00"; await save(tk);
      ok("BY. 時刻も入れたら「日時まで」", tk.duePrecision === "exact" && fmtDT(tk.due, tz).slice(-5) === "14:00");
      openEdit(tk); $("#eH").value = ""; $("#eV").checked = true; await save(tk);
      ok("BY. 「はっきりしない」に印を付けたら、あいまいな期限", tk.duePrecision === "week");
      openEdit(tk); $("#eD").value = ""; await save(tk);
      ok("BY. 日付を消したら「期限なし」", tk.duePrecision === "none" && !tk.due && !tk.dayKey);

      // 種類を変える／消す操作はたたむ
      openEdit(tk); $("#eK").value = "goal"; $("#eK").dispatchEvent(new Event("change"));
      ok("BY. 種類を変えると、欄がその種類のものに変わる", vis("when") && !vis("est") && !vis("vague"));
      $("#eK").value = "condition"; $("#eK").dispatchEvent(new Event("change")); await save(tk);
      ok("BY. 体調に変えたら、本人の言葉と日時を持つ", tk.kind === "condition" && tk.selfReport === "資料" && !!tk.reportedAt);
      openEdit(tk);
      const dz = document.querySelector("#sheetHost details.dz");
      ok("BY. 取り消す・消すは、たたんだ中（保存の真下に並べない）", !!dz && !dz.open && !!dz.querySelector('[data-act="drop"]') && !!dz.querySelector('[data-act="delitem"]')
         && !document.querySelector('#sheetHost .foot [data-act="drop"]'));
      ok("BY. 空の内容では保存しない", await (async () => { $("#eT").value = " "; await save(tk); return tk.title === "資料" && /内容を入れて/.test($("#eMsg").textContent); })());
      closeSheet();
      state.items = keepItems; state.notes = keepNotes; hideToast(); showTab(keepTab);
    }

    /* ===== BZ群：ふだんの言い方をまとめて流して見つけた読み違い（2026-09-26・本人の指示「もっとよりよいアプリに」）=====
       42通りの言い方を流し、13か所でつまずいた。どれも本人がふつうに言いそうな形。 */
    {
      const keepItems = state.items, keepNotes = state.notes, keepTurns = state.turns, keepDocs = state.docs;
      const read = async t => { reset(); const r = await say(t, T(9, 0)); return { items: state.items.slice(), asks: r.asks || [] }; };
      const sig = r => r.items.map(i => i.kind + ":" + i.title).join(" / ");
      let r;
      r = await read("10時に歯医者、そのあと買い物");
      ok("BZ. 「10時に歯医者、そのあと買い物」は予定と用事の2つ", sig(r) === "event:歯医者 / task:買い物", sig(r));
      r = await read("10時から12時まで勉強して、13時から15時まで散歩");
      ok("BZ. 時刻の範囲が2つあれば、予定も2つ", r.items.filter(i => i.kind === "event").length === 2
         && r.items.some(i => i.title === "勉強する") && r.items.some(i => i.title === "散歩"), sig(r));
      r = await read("9時に歯医者。そのあと11時から会議。");
      ok("BZ. 句点で分けても、同じ行の2つの予定が両方入る", r.items.filter(i => i.kind === "event").length === 2, sig(r));
      r = await read("明日の午後5時に歯医者に行く。今日は資料を作らないと。2時間くらい。");
      ok("BZ. 時刻の無い言い足し（2時間くらい）は、今までどおり前の話に付く", (r.items.find(i => i.kind === "task") || {}).estimateMin === 120, sig(r));
      r = await read("10時から、12時まで勉強");
      ok("BZ. 範囲が読点をまたいでも、1つの予定のまま", r.items.filter(i => i.kind === "event").length === 1, sig(r));
      r = await read("3時間目の授業に出る");
      ok("BZ. 「3時間目」は所要時間ではない（見出しも欠けない）", r.items.length === 1 && /3時間目/.test(r.items[0].title) && r.items[0].estimateMin == null, sig(r));
      r = await read("10分前に着くようにする");
      ok("BZ. 「10分前」は所要時間ではない", r.items.length === 1 && /10分前/.test(r.items[0].title) && r.items[0].estimateMin == null, sig(r));
      ok("BZ. 所要時間の読み取り：「30分後」「1時間おき」は長さではなく、「2時間半」は長さ",
         parseDuration("30分後に出る") == null && parseDuration("1時間おきに休む") == null && parseDuration("2時間半かかる") === 150);
      r = await read("30分だけ昼寝する");
      ok("BZ. 「30分だけ」の「だけ」を見出しに残さない", sig(r) === "task:昼寝する" && r.items[0].estimateMin === 30, sig(r));
      r = await read("さっきジム行ってきた");
      ok("BZ. 「行ってきた」は済んだ報告で、やることにしない", r.items.length === 0, sig(r));
      r = await read("打ち合わせ15時からに変更");
      ok("BZ. 「に変更」を見出しに残さない", sig(r) === "event:打ち合わせ", sig(r));
      r = await read("毎朝ストレッチを10分やりたい");
      ok("BZ. 「毎朝〜したい」は続けたいこと", r.items.length === 1 && r.items[0].kind === "goal", sig(r));
      r = await read("23時には寝たい");
      ok("BZ. 「23時には寝たい」は体調ではなく、23時に寝る", sig(r) === "task:寝る" && fmtDT(r.items[0].due, TZ).slice(-5) === "23:00", sig(r));
      r = await read("今日は寝不足で眠い");
      ok("BZ. 時刻の無い眠気は、今までどおり体調", r.items.length === 1 && r.items[0].kind === "condition", sig(r));
      r = await read("今週中に部屋を片付けたい");
      ok("BZ. 「〜たい」の用事は言い切りにそろえる", r.items.length === 1 && r.items[0].title === "部屋を片付ける", sig(r));
      r = await read("明日の会議の資料まだ");
      ok("BZ. 「〜まだ」は予定にしない（未完了の報告・決まり0）", !r.items.some(i => i.kind === "event"), sig(r));
      r = await read("明日12時に友達とランチ");
      ok("BZ. 「明日12時に友達とランチ」は昼食の予定", r.items.length === 1 && r.items[0].title === "昼食を食べる", sig(r));
      r = await read("夜ごはんのあと、21時からお風呂");
      ok("BZ. 「夜ごはんのあと」は夕食の予定にしない", !r.items.some(i => /夕食/.test(i.title)), sig(r));
      r = await read("朝9時に起きて、10時に家を出る");
      ok("BZ. 「9時に起きて、10時に家を出る」は2つとも入る", sig(r) === "task:起きる / task:家を出る", sig(r));
      r = await read("19時から飲み会、終わったら帰って寝る");
      ok("BZ. 「終わったら」は報告ではない（どれが終わったのか、と聞かない）", !r.asks.some(a => /どれが終わった/.test(a)), JSON.stringify(r.asks));
      r = await read("お昼は友達とランチ");
      ok("BZ. 「お昼は友達とランチ」（時刻なし）も昼食の予定", r.items.length === 1 && r.items[0].title === "昼食を食べる", sig(r));
      r = await read("昨日の夜は友達とディナー");
      ok("BZ. 「昨日の夜は〜ディナー」は済んだ話で、予定にしない", !r.items.some(i => /夕食/.test(i.title)), sig(r));
      r = await read("資料が終わったら先生に連絡する");
      ok("BZ. 「〜が終わったら◯◯する」の◯◯を、済んだ報告として捨てない", r.items.length === 1 && r.items[0].kind === "task", sig(r));
      r = await read("レポートができたら提出する");
      ok("BZ. 「〜ができたら」は条件で、迷い（気になっていること）ではない", r.items.length === 1 && r.items[0].kind === "task", sig(r));
      r = await read("できたら明日ジムに行きたい");
      ok("BZ. 「できたら〜したい」は今までどおり迷い", r.items.length === 1 && r.items[0].kind === "idea", sig(r));
      r = await read("今日は10時から12時まで会議で、そのあと資料を作る。2時間くらい。");
      ok("BZ. 「会議で、そのあと…」の見出しは「会議」", r.items.some(i => i.kind === "event" && i.title === "会議")
         && (r.items.find(i => i.kind === "task") || {}).estimateMin === 120, sig(r));
      state.items = keepItems; state.notes = keepNotes; state.turns = keepTurns; state.docs = keepDocs;
    }

    /* ===== CA群：まだ読めていなかった言い方（2026-09-26・本人の指示「まだ読めていないものも直して」）=====
       ①その日のあり方（在宅・2限はオンライン）②その日を空けたい（週末は何もしたくない）
       ③同じ行の時刻は言った順に並ぶ ④前の話の日付は、同じ行のあとの話にも効く */
    {
      const keepItems = state.items, keepNotes = state.notes, keepTurns = state.turns, keepDocs = state.docs;
      const read = async (t, at) => { reset(); const r = await say(t, at || T(9, 0)); return { items: state.items.slice(), asks: r.asks || [] }; };
      const sig = r => r.items.map(i => i.kind + ":" + i.title).join(" / ");
      const hm = iso => fmtDT(iso, TZ);
      const ev = (r, t) => r.items.find(i => i.title === t) || {};
      let r;
      r = await read("明日は在宅勤務");
      ok("CA. 「明日は在宅勤務」は明日の終日の予定", r.items.length === 1 && r.items[0].kind === "event" && r.items[0].title === "在宅勤務"
         && r.items[0].allDay === true && r.items[0].dayKey === NEXT, sig(r));
      r = await read("明日の2限はオンライン");
      ok("CA. 「明日の2限はオンライン」は明日の時刻未定の予定（終日にしない）", r.items.length === 1 && r.items[0].kind === "event"
         && r.items[0].timeUnknown === true && !r.items[0].allDay && r.items[0].dayKey === NEXT, sig(r));
      r = await read("明日は在宅だけど、10時から会議");
      ok("CA. 「在宅だけど、10時から会議」は終日の在宅と、明日10時の会議の2つ", sig(r) === "event:在宅 / event:会議"
         && ev(r, "在宅").allDay === true && hm(ev(r, "会議").start) === "9/13 10:00", sig(r) + " " + hm(ev(r, "会議").start));
      r = await read("明日は9時に集合、17時に解散");
      ok("CA. 前の話の「明日」は、あとの話（17時に解散）にも効く", hm(ev(r, "解散").start) === "9/13 17:00", sig(r) + " " + hm(ev(r, "解散").start));
      r = await read("明日は10時に歯医者、そのあと買い物");
      ok("CA. 「そのあと買い物」も、前に言った日（明日）の用事", ev(r, "買い物").dayKey === NEXT, sig(r));
      r = await read("10時に歯医者、そのあと買い物");
      ok("CA. 日付を言っていないなら、あとの話に日付を作らない", ev(r, "買い物").kind === "task" && !ev(r, "買い物").dayKey, sig(r));
      r = await read("明日は1時から会議、そのあと3時から面談");
      ok("CA. 渡した日付では、午前・午後も「日付を言われたとき」の読み方（1時・3時は午後）",
         hm(ev(r, "会議").start) === "9/13 13:00" && hm(ev(r, "面談").start) === "9/13 15:00", sig(r));
      r = await read("週末は何もしたくない");
      const wk = r.items.find(i => i.kind === "preference") || {};
      ok("CA. 「週末は何もしたくない」は土日を空けたいという希望（ほかの項目を作らない）", r.items.length === 1 && wk.preferKey === "restDay"
         && wk.scopeDay === "2026-09-12" && wk.scopeEnd === "2026-09-13", JSON.stringify([wk.preferKey, wk.scopeDay, wk.scopeEnd]) + sig(r));
      ok("CA. 空けたい日にだけ効く（土日は効き、月曜は効かない）", prefs("2026-09-12").restDay && prefs("2026-09-13").restDay && !prefs("2026-09-14").restDay);
      ok("CA. 続く日の希望は、その日付で出す（「この日だけ」と出さない）", /9\/12〜9\/13/.test(itemHTML(wk)) && !/この日だけ/.test(itemHTML(wk)));
      r = await read("明日は予定を入れないで");
      ok("CA. 「明日は予定を入れないで」は明日1日だけ", r.items.length === 1 && r.items[0].preferKey === "restDay"
         && r.items[0].scopeDay === NEXT && !r.items[0].scopeEnd, sig(r));
      r = await read("何もしたくない");
      ok("CA. 日付の無い「何もしたくない」は気分の話で、空ける日を作らない", !r.items.some(i => i.preferKey === "restDay"), sig(r));
      r = await read("夜は予定を入れないで");
      ok("CA. 「夜は予定を入れないで」は今までどおり夜の希望（一日を空けない）", r.items.some(i => i.preferKey === "noEveningWork")
         && !r.items.some(i => i.preferKey === "restDay"), sig(r));
      r = await read("明日は何もしないで過ごす");
      ok("CA. 空けたいと言った文から、用事（何もしないで過ごす）を作らない", r.items.length === 1 && r.items[0].preferKey === "restDay", sig(r));
      r = await read("明日の夜は予定を入れないで");
      ok("CA. 「明日の夜は予定を入れないで」は明日の夜だけ（一日を空けない・毎晩にもしない）", r.items.length === 1 && r.items[0].preferKey === "noEveningWork"
         && r.items[0].scopeDay === NEXT, JSON.stringify(r.items.map(i => [i.preferKey, i.scopeDay])));
      r = await read("明日から夜は予定を入れないで");
      ok("CA. 「明日から夜は〜」は明日だけにしない（今までどおりずっとの希望）", r.items.length === 1 && r.items[0].preferKey === "noEveningWork" && !r.items[0].scopeDay,
         JSON.stringify(r.items.map(i => [i.preferKey, i.scopeDay])));
      r = await read("今日は疲れたから何もしたくない");
      ok("CA. 要望の文の中の体調（疲れた）も残す", r.items.some(i => i.kind === "condition") && r.items.some(i => i.preferKey === "restDay"), sig(r));
      reset();
      await say("急がないので午前中に資料を作る。1時間。", T(9, 0));   // 期限の無い用事（急がない）。「午前中に」だけだと今日の用事になる（決まり0l）
      await say("明日は予定を入れないで", T(9, 1));
      const pn = planFor(NEXT, { nowMin: -1 });
      const un = (pn.unplaced || []).find(u => /資料を作る$/.test(u.item.title));
      ok("CA. 空けたい日には急がないものを置かず、その希望を理由に名指しする", !!un && /予定を入れたくないと言っていた/.test(un.reason),
         un ? un.reason : JSON.stringify((pn.blocks || []).map(b => b.item && b.item.title)));
      reset();
      const nx = { id: uid(), text: "x", capturedAt: T(9, 0) };
      let ax = await applyOps([{ op: "prefer", key: "restDay", text: "いつか休みたい", quote: "x" }], nx);
      ok("CA. 日付の無い restDay は受け取らず、言う（決まり9）", !state.items.length && ax.asks.some(a => /どの日を空けて/.test(a)), JSON.stringify(ax.asks));
      ax = await applyOps([{ op: "prefer", key: "restDay", scopeDay: NEXT, scopeEnd: "2027-01-30", text: "しばらく休む", quote: "x" }], nx);
      ok("CA. 31日を超える終わりは受け取らない（その日だけにする）", state.items.length === 1 && state.items[0].scopeDay === NEXT && !state.items[0].scopeEnd,
         JSON.stringify(state.items.map(i => [i.scopeDay, i.scopeEnd])));
      ok("CA. AIへの依頼文に restDay の形を書いている", /"key":"restDay"/.test(String(buildPrompt)));

      r = await read("10時から12時まで勉強して、13時から15時まで散歩", T(14, 0));
      ok("CA. 14時に「10時から12時まで勉強して、13時から15時まで散歩」——勉強は13時より前の朝10時（夜22時にしない）",
         hm(ev(r, "勉強する").start) === "9/12 10:00" && hm(ev(r, "散歩").start) === "9/12 13:00", sig(r) + " " + hm(ev(r, "勉強する").start));
      ok("CA. 並べ直しても黙って確定させない（夜22時のほうを聞き返す）", ev(r, "勉強する").whenAlt && hm(ev(r, "勉強する").whenAlt.start) === "9/12 22:00"
         && r.asks.some(a => /22:00/.test(a)), JSON.stringify(r.asks));
      {
        reset();
        const n = { id: uid(), text: "10時から12時まで勉強して、13時から15時まで散歩", hash: "ca" + Math.random(), capturedAt: T(14, 0), source: "talk", createdAt: T(14, 0) };
        ok("CA. 速い返事に渡す時間帯も夜にしない（ルールと同じ根拠・決まり7b）", !/夜/.test(quickWhenHint(n, TZ)), quickWhenHint(n, TZ));
        await putNote(n);
        await applyOps([{ op: "add", kind: "event", title: "勉強する", dueDate: KEY, dueTime: "22:00", estimateMin: 120, quote: "10時から12時まで勉強して" },
                        { op: "add", kind: "event", title: "散歩", dueDate: KEY, dueTime: "13:00", estimateMin: 120, quote: "13時から15時まで散歩" }], n);
        ok("CA. AIが勉強を22時と返しても、ルールの並べ方（10時）に揃える（決まり4i）", hm((state.items.find(i => i.title === "勉強する") || {}).start) === "9/12 10:00"
           && hm((state.items.find(i => i.title === "散歩") || {}).start) === "9/12 13:00", JSON.stringify(state.items.map(i => [i.title, hm(i.start)])));
        reset();
        const n2 = Object.assign({}, n, { id: uid(), hash: "cb" + Math.random() });
        await putNote(n2);
        await applyOps([{ op: "add", kind: "event", title: "勉強する", dueDate: KEY, dueTime: "10:00", estimateMin: 120, quote: "10時から12時まで勉強して" }], n2);
        ok("CA. AIが正しく10時と返したら、そのまま使う（前は22時に戻していた）", hm((state.items[0] || {}).start) === "9/12 10:00", hm((state.items[0] || {}).start));
        reset();
        const n3 = { id: uid(), text: "朝10時に会議、夜10時に電話する", hash: "cc" + Math.random(), capturedAt: T(8, 0), source: "talk", createdAt: T(8, 0) };
        await putNote(n3);
        await applyOps([{ op: "add", kind: "task", title: "電話する", dueDate: KEY, dueTime: "22:00", quote: "夜10時に電話する" }], n3);
        ok("CA. AIの時刻がルールのどれかと同じなら、別の話の時刻（12時間ずれ）へ動かさない", hm((state.items[0] || {}).due) === "9/12 22:00", hm((state.items[0] || {}).due));
      }
      r = await read("10時から12時まで勉強して、13時から15時まで散歩", T(8, 0));
      ok("CA. 朝8時なら、今までどおり10時（聞き返さない）", hm(ev(r, "勉強する").start) === "9/12 10:00" && !ev(r, "勉強する").whenAlt, sig(r));
      r = await read("10時から12時まで勉強する", T(14, 0));
      ok("CA. 時刻が1つだけなら、今までどおり夜22時（決まり4b）", hm(ev(r, "勉強する").start) === "9/12 22:00", hm(ev(r, "勉強する").start));
      r = await read("10時から12時まで勉強して\n13時から15時まで散歩", T(14, 0));
      ok("CA. 改行で分けた別の行どうしは並べ直さない", hm(ev(r, "勉強する").start) === "9/12 22:00", hm(ev(r, "勉強する").start));
      r = await read("13時から散歩、そのあと4時から勉強", T(3, 0));
      ok("CA. 夜中3時の「13時から散歩、そのあと4時から勉強」——勉強は散歩のあとの16時", hm(ev(r, "散歩").start) === "9/12 13:00"
         && hm(ev(r, "勉強").start) === "9/12 16:00", sig(r) + " " + hm(ev(r, "勉強").start));
      r = await read("夜9時からテレビ");
      ok("CA. 「夜9時からテレビ」（始まりの時刻＋名詞）は予定", r.items.length === 1 && r.items[0].kind === "event" && r.items[0].title === "テレビ"
         && hm(r.items[0].start) === "9/12 21:00", sig(r));
      r = await read("3時から大雨");
      ok("CA. 「3時から大雨」（天気）は予定にしない", !r.items.length, sig(r));
      state.items = keepItems; state.notes = keepNotes; state.turns = keepTurns; state.docs = keepDocs;
    }

    /* ===== CB群：どの画面も同じ頭で始まる・アイコンと同じ形と色（2026-09-26・本人の指示）=====
       「AI秘書やこの端末のみを消した影響でレイアウトに違和感」「アプリアイコンのデザインと親和性が高いものに」。 */
    {
      const heads = ["p-chat", "p-day", "p-me", "p-set"].map(id => document.querySelector("#" + id + " > .phead"));
      ok("CB. 4つの画面とも、頭（印＋画面の名前）で始まる", heads.every(h => h && h === h.parentElement.firstElementChild && h.querySelector(".mark") && h.querySelector("h1")),
         heads.map(h => h ? h.textContent.trim().slice(0, 8) : "無し").join("/"));
      ok("CB. 画面の名前はタブの名前と同じ", heads.map(h => h && h.querySelector("h1").textContent).join("/") === "チャット/スケジュール/わたしのこと/設定",
         heads.map(h => h && h.querySelector("h1").textContent).join("/"));
      ok("CB. アプリの名前を画面の上に戻していない（決まり15l）", !heads.some(h => h && /AI秘書/.test(h.textContent)) && !document.querySelector("header.top"));
      const mk = getComputedStyle(document.querySelector(".phead .mark")).backgroundImage;
      ok("CB. 印はアイコンと同じ3色（青緑・黄・赤）で、外から読み込まない", /data:image\/svg\+xml/.test(mk) && /0E6F6B/i.test(mk) && /F2A541/i.test(mk) && /E8705E/i.test(mk), mk.slice(0, 60));
      const cs = getComputedStyle(document.documentElement);
      const hex = v => cs.getPropertyValue(v).trim().toUpperCase();
      ok("CB. 地・注意・警告の色はアイコンから取っている（明るいとき）", document.documentElement.getAttribute("data-theme") === "dark"
         || (hex("--paper") === "#F1F6F5" && hex("--warn") === "#F2A541" && hex("--alert") === "#E8705E"), [hex("--paper"), hex("--warn"), hex("--alert")].join(" "));
      const keepC = state.turns, keepI2 = state.items, keepN2 = state.notes;
      const keepCD = view.chatDay, tk = dayKey(new Date(), TZ);
      state.turns = { [tk]: [{ id: "cb1", role: "user", text: "こんにちは", at: new Date().toISOString() },
                             { id: "cb2", role: "assistant", text: "うん、聞いたよ。", at: new Date().toISOString() }] };
      view.chatDay = tk; showTab("p-chat"); renderChat();
      const ai = document.querySelector("#chatOut .turn.ai");
      ok("CB. 返事の頭にアイコンと同じ印が付く", !!ai && /data:image\/svg\+xml/.test(getComputedStyle(ai, "::before").backgroundImage), ai ? "印が無い" : "返事が無い");
      showTab("p-day");
      ok("CB. 日付バーの ◀ ▶ は絵（文字の記号に戻していない）", !!document.querySelector("#dPrev svg") && !!document.querySelector("#dNext svg") && !/[◀▶]/.test(document.querySelector(".datebar").textContent));
      state.turns = keepC; state.items = keepI2; state.notes = keepN2; view.chatDay = keepCD; showTab("p-chat");
    }

    /* ===== CC群：暗いときの作り（2026-09-26・本人の指示「評価の高いアプリのダークモードと比べて完成版に」・決まり15r）=====
       見るのは性質であって値ではない（決まり15）。明るいときは前と1pxも変えていないことも見る。 */
    {
      const root = document.documentElement, before = root.getAttribute("data-theme");
      const rgb = h => { h = h.trim(); const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
      const L = h => { const c = rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
      const cr = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const v = n => getComputedStyle(root).getPropertyValue(n).trim();
      const read = theme => { root.setAttribute("data-theme", theme);
        const o = {}; for (const n of ["--paper","--surface","--surface-up","--ink","--accent","--me-bub","--me-ink","--toast-bg","--toast-ink","--toast-btn","--toast-btn-ink","--focus","--accent-line","--shadow"]) o[n] = v(n); return o; };
      const lt = read("light"), dk = read("dark");
      if (before) root.setAttribute("data-theme", before); else root.removeAttribute("data-theme");
      ok("CC. 暗いとき、自分の吹き出しは深い色（画面でいちばん明るい面にしない）", L(dk["--me-bub"]) < .15 && L(dk["--me-bub"]) < L(dk["--ink"]) / 4, dk["--me-bub"]);
      ok("CC. 吹き出しの文字は両方のテーマで読める（4.5以上）", cr(lt["--me-bub"], lt["--me-ink"]) >= 4.5 && cr(dk["--me-bub"], dk["--me-ink"]) >= 4.5,
         cr(lt["--me-bub"], lt["--me-ink"]).toFixed(2) + " / " + cr(dk["--me-bub"], dk["--me-ink"]).toFixed(2));
      ok("CC. 暗いとき、高さは面の明るさで出す（地 < カード < 浮くもの）", L(dk["--paper"]) < L(dk["--surface"]) && L(dk["--surface"]) < L(dk["--surface-up"]),
         [dk["--paper"], dk["--surface"], dk["--surface-up"]].join(" < "));
      ok("CC. 暗いとき、トーストを白く反転させない", L(dk["--toast-bg"]) < .1, dk["--toast-bg"]);
      ok("CC. トーストの文字と「元に戻す」は両方のテーマで読める", [lt, dk].every(t => cr(t["--toast-bg"], t["--toast-ink"]) >= 4.5 && cr(t["--toast-btn"], t["--toast-btn-ink"]) >= 4.5));
      ok("CC. 暗いとき、文字を純白にしない（にじみを避ける）", dk["--ink"].toUpperCase() !== "#FFFFFF" && cr(dk["--paper"], dk["--ink"]) >= 12, dk["--ink"]);
      ok("CC. 暗いとき、枠やフォーカスの線を鮮やかな差し色で光らせない", L(dk["--accent-line"]) < L(dk["--accent"]) && L(dk["--focus"]) < L(dk["--accent"])
         && cr(dk["--paper"], dk["--focus"]) >= 3, [dk["--accent-line"], dk["--focus"], dk["--accent"]].join(" "));
      ok("CC. 暗いとき、影ではなく細い明るい縁で浮かせる", /rgba\(255,\s*255,\s*255/.test(dk["--shadow"]), dk["--shadow"]);
      ok("CC. 明るいときは前と同じ（吹き出し＝差し色・トースト＝文字の色・縁なし）", lt["--me-bub"].toUpperCase() === lt["--accent"].toUpperCase()
         && lt["--toast-bg"].toUpperCase() === lt["--ink"].toUpperCase() && lt["--surface-up"].toUpperCase() === lt["--surface"].toUpperCase(),
         [lt["--me-bub"], lt["--accent"], lt["--toast-bg"], lt["--ink"]].join(" "));
      const bubRule = [...document.styleSheets].flatMap(ss => { try { return [...ss.cssRules]; } catch { return []; } })
        .find(r => r.selectorText === ".turn.me .bub");
      ok("CC. 吹き出し・トーストは明暗の役目の色を使う（直に差し色を塗らない）", !!bubRule && /--me-bub/.test(bubRule.style.background || bubRule.cssText)
         && /--toast-bg/.test(String([...document.styleSheets].flatMap(ss => { try { return [...ss.cssRules]; } catch { return []; } }).find(r => r.selectorText === "#toast")?.cssText)));
    }

    /* ===== CD群：予定と作業を、画面で区分しない（2026-09-26・本人の指示
       「動かさない予定／動かせる作業…そもそも区分して表記しなくていい。なのでこの文章もいらない」・決まり15s）=====
       区分は予定づくりの内側（planFor）にだけ残す。見るのは「画面に出ていないこと」と「同じ見た目であること」。 */
    {
      const keepN = state.notes, keepTab = view.tab;
      try { localStorage.removeItem("hitohi.tips"); } catch {}
      state.notes = [];                                   // 見本の日：予定と作業の両方が並ぶ
      showTab("p-day");
      const t = $("#p-day").textContent;
      ok("CD. 「動かさない予定」「動かせる作業」の区分を書かない", !/動かさない予定|動かせる作業|作業枠/.test(t), (t.match(/動かさない予定|動かせる作業|作業枠/) || [""])[0]);
      ok("CD. 「枠を押すと、理由と操作が出ます」を書かない", !/枠を押すと/.test(t));
      ok("CD. 予定と作業の枠が両方ある日で測っている（測れていないのに通さない）",
         !!$("#p-day .blk.fixed") && !!$("#p-day .blk.flex"));
      const cs = sel => { const el = $("#p-day " + sel); return el ? getComputedStyle(el) : null; };
      const f = cs(".blk.fixed"), x = cs(".blk.flex");
      ok("CD. 予定と作業の枠は同じ見た目（地・左の帯の線・色）", !!f && !!x
         && f.backgroundColor === x.backgroundColor && f.borderLeftStyle === x.borderLeftStyle
         && f.borderLeftColor === x.borderLeftColor && f.borderTopColor === x.borderTopColor
         && getComputedStyle($("#p-day .blk.fixed"), "::before").backgroundColor === getComputedStyle($("#p-day .blk.flex"), "::before").backgroundColor,
         f && x ? [f.backgroundColor, x.backgroundColor, f.borderLeftStyle, x.borderLeftStyle].join(" / ") : "枠が無い");
      const rows = [...document.querySelectorAll("#p-day .tlrow.b:not(.d-thin)")];
      const dots = new Set(rows.map(r => getComputedStyle(r, "::before").backgroundColor));
      ok("CD. 時間軸の丸も、予定と作業で同じ", rows.length >= 2 && dots.size === 1, [...dots].join(" / "));
      state.notes = keepN;
      ok("CD. 予定の行に「固定」の印を付けない",
         !/固定/.test(itemHTML({ id: "cd1", kind: "event", title: "会議", status: "open", origin: "rule",
           start: new Date().toISOString(), end: new Date(Date.now() + 3600000).toISOString(), history: [], evidence: {} })));
      const mp = miniplanHTML(planSnapshot(demoPlan(), null));
      ok("CD. 会話に添える予定表でも、予定だけを太字にしない", !/class="fx"/.test(mp) && /研究計画書/.test(mp));
      openManual();
      const mk = ($("#mK") || {}).textContent || "";
      ok("CD. 手で足すときの選択肢にも区分の説明を書かない", /予定/.test(mk) && !/固定|動かさない|動かせる|作業枠/.test(mk), mk);
      closeSheet(); showTab(keepTab);
    }

    /* ===== CE群：予定の枠の見た目（2026-09-27・本人の指示「スケジュールの予定の枠の見た目をもっと吟味して」・決まり15t）=====
       見るのは性質：帯はまっすぐな内側の棒／枠は白い面で枠線なし／文字は帯と重ならない／空きに破線なし／
       いまの枠は帯も赤／時刻は等幅の字（コードの字）にしない。 */
    {
      const keepN = state.notes, keepTab = view.tab;
      state.notes = []; showTab("p-day");                 // 見本の日：予定と作業が並ぶ
      const b = $("#p-day .blk.fixed"), cs = b && getComputedStyle(b), bar = b && getComputedStyle(b, "::before");
      ok("CE. 左の帯は枠の内側のまっすぐな棒（角丸に沿って曲がる太い左の線にしない）",
         !!cs && cs.borderLeftWidth === cs.borderTopWidth && parseFloat(bar.width) >= 2 && bar.backgroundColor !== "rgba(0, 0, 0, 0)",
         cs ? cs.borderLeftWidth + " / " + cs.borderTopWidth + " / 棒 " + bar.width : "枠が無い");
      const card = document.createElement("div"); card.className = "card"; $("#p-day").appendChild(card);
      const light = document.documentElement.getAttribute("data-theme");
      document.documentElement.setAttribute("data-theme", "light");
      ok("CE. 枠はほかのカードと同じ面で、枠線を引かない（明るいとき）",
         getComputedStyle(b).backgroundColor === getComputedStyle(card).backgroundColor && getComputedStyle(b).borderTopColor === "rgba(0, 0, 0, 0)",
         getComputedStyle(b).backgroundColor + " / " + getComputedStyle(b).borderTopColor);
      if (light) document.documentElement.setAttribute("data-theme", light); else document.documentElement.removeAttribute("data-theme");
      card.remove();
      const t = b && b.querySelector(".bttl"), gap = b && t ? t.getBoundingClientRect().left - b.getBoundingClientRect().left : 0;
      ok("CE. 見出しの文字は帯と重ならない", gap >= parseFloat(bar.left) + parseFloat(bar.width) + 4, Math.round(gap) + "px");
      /* テストの窓は広いので、**スマホ幅（430px以下）の指定は描かれない**。そこで .blk の左の余白を
         狭めると、実機でだけ文字が帯に重なる（壊して確かめたら、上の1件はすり抜けた）。指定そのものを読む。 */
      const narrow = [];
      for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules; } catch { continue; }
        for (const r of rs) if (r.media && /max-width:\s*430px/.test(r.media.mediaText))
          for (const x of r.cssRules) if (x.selectorText === ".blk" || x.selectorText === ".blk.thin") narrow.push(x); }
      const need = parseFloat(bar.left) + parseFloat(bar.width) + 4;
      ok("CE. スマホ幅でも、見出しの文字は帯と重ならない（左の余白）",
         narrow.length >= 1 && narrow.every(x => !x.style.paddingLeft || parseFloat(x.style.paddingLeft) >= need),
         narrow.map(x => x.selectorText + " " + (x.style.paddingLeft || "（指定なし）")).join(" / ") || "指定が見つからない");
      const gl = $("#p-day .gapline");
      ok("CE. 空き時間を破線で囲まない", !!gl && getComputedStyle(gl).borderTopStyle === "none" && getComputedStyle(gl).borderBottomStyle === "none", gl ? getComputedStyle(gl).borderTopStyle : "空きが無い");
      const tt = $("#p-day .tltime");
      ok("CE. 時刻と長さを等幅の字（コードの字）にしない", !!tt && !/mono/i.test(getComputedStyle(tt).fontFamily)
         && !/mono/i.test(getComputedStyle($("#p-day .bdur")).fontFamily), tt ? getComputedStyle(tt).fontFamily.slice(0, 40) : "");
      state.notes = keepN;
      // いまの枠：帯も赤
      const box = document.createElement("div"); $("#p-day").appendChild(box);
      const dp = demoPlan(); dp.nowMin = 700;             // 11:40＝ゼミ（11:00〜12:30）の最中
      box.innerHTML = timelineHTML(dp, null, true);
      const run = box.querySelector(".blk.running");
      ok("CE. いまの枠は、帯も赤（枠の色と帯の色を合わせる）", !!run
         && getComputedStyle(run, "::before").backgroundColor === getComputedStyle(run).borderTopColor, run ? getComputedStyle(run, "::before").backgroundColor : "いまの枠が無い");
      box.remove(); showTab(keepTab);
    }

    /* ===== CF群：マットにする（2026-09-27・本人の指示「もう少しUI、UXをマットにして」・決まり15u）=====
       光って見えるもの（ぼかした影・すりガラス・鮮やかな差し色・角丸に沿って曲がる太い線）を置かない。
       見るのは性質であって値ではない（決まり15）。 */
    {
      const root = document.documentElement, before = root.getAttribute("data-theme");
      const sat = h => { h = h.trim(); const n = parseInt(h.slice(1), 16);
        const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(x => x / 255);
        const mx = Math.max(...c), mn = Math.min(...c), l = (mx + mn) / 2;
        return mx === mn ? 0 : (mx - mn) / (l > .5 ? 2 - mx - mn : mx + mn); };
      // 影の3つ目の長さ＝ぼかし。色（rgba(...) や #...）を除いてから数を読む（「0」には px が付かない）
      const blurred = sh => String(sh).split(/,(?![^(]*\))/).some(part => {
        const n = part.replace(/rgba?\([^)]*\)|#[0-9a-f]+|inset|[a-z-]+\([^)]*\)/gi, " ").trim().split(/\s+/).map(parseFloat).filter(x => !isNaN(x));
        return (n[2] || 0) > 0; });
      const got = {};
      for (const theme of ["light", "dark"]) {
        root.setAttribute("data-theme", theme);
        const cs = getComputedStyle(root), v = k => cs.getPropertyValue(k).trim();
        got[theme] = { sh: v("--shadow"), acc: v("--accent"), done: v("--done") };
      }
      if (before) root.setAttribute("data-theme", before); else root.removeAttribute("data-theme");
      ok("CF. 浮くものを、ぼかした影で浮かせない（細い線1本・両方のテーマ）", !blurred(got.light.sh) && !blurred(got.dark.sh),
         got.light.sh + " / " + got.dark.sh);
      ok("CF. 差し色と「済んだ」の緑は、彩度を抑える（両方のテーマ）",
         ["light", "dark"].every(t => sat(got[t].acc) <= .45 && sat(got[t].done) <= .45),
         ["light", "dark"].map(t => t + " " + got[t].acc + "=" + sat(got[t].acc).toFixed(2) + " " + got[t].done + "=" + sat(got[t].done).toFixed(2)).join(" / "));
      const nav = getComputedStyle(document.querySelector("nav.tabs"));
      const bf = nav.backdropFilter || nav.webkitBackdropFilter || "none";
      ok("CF. タブバーをすりガラスにしない（無地の面）", bf === "none" && !/rgba\(.*,\s*0?\.\d+\)$/.test(nav.backgroundColor), bf + " / " + nav.backgroundColor);
      openSheet("<p>cf</p>");
      const inner = document.querySelector(".sheet .inner");
      const ish = inner ? getComputedStyle(inner).boxShadow : "シートが無い";
      closeSheet();
      ok("CF. シートを影で浮かせない（後ろの暗がりで分かる）", ish === "none", ish);
      const tmp = document.createElement("div"); tmp.className = "next"; document.body.appendChild(tmp);
      const nc = getComputedStyle(tmp);
      ok("CF. 「次にすること」の上に太い線を引かない（角丸に沿って曲がる）", nc.borderTopWidth === nc.borderLeftWidth, nc.borderTopWidth + " / " + nc.borderLeftWidth);
      tmp.remove();
    }

    /* ===== CG群：端の余白を二重に取らない（2026-09-27・実機で報告「上に謎の空間ある」）=====
       殻の SafeAreaView が上下の余白を取るので、殻の中ではページ側の env(safe-area-inset-*) を0にする。
       headless では env() がいつも0なので、見た目ではなく「余白の出どころが1か所で、殻の中では0になるか」を見る。 */
    {
      const rules = [...document.styleSheets].flatMap(ss => { try { return [...ss.cssRules]; } catch { return []; } })
        .flatMap(r => r.cssRules && r.cssRules.length && !r.style ? [...r.cssRules] : [r]);
      const raw = rules.filter(r => r.style && /env\(safe-area-inset/.test(r.cssText) && r.selectorText !== ":root");
      ok("CG. 端の余白（env）を読むのは :root の1か所だけ", raw.length === 0, raw.map(r => r.selectorText).join(" / ") || "1か所");
      const used = rules.filter(r => r.style && /var\(--sa-(top|bottom)\)/.test(r.cssText)).length;
      ok("CG. 上下の余白を使う指定は、変数を通している（数えられている）", used >= 5, used + "か所");
      const root = document.documentElement, had = root.classList.contains("in-shell");
      root.classList.add("in-shell");
      const cs = getComputedStyle(root);
      const inTop = cs.getPropertyValue("--sa-top").trim(), inBot = cs.getPropertyValue("--sa-bottom").trim();
      if (!had) root.classList.remove("in-shell");
      // 計算後の値は headless では env() も 0px になって見分けられないので、書いてある指定を読む
      const rootDecl = rules.filter(r => r.selectorText === ":root").map(r => r.style.getPropertyValue("--sa-top")).join(" ");
      const outTop = (had ? "殻の印が付いている " : "") + rootDecl.trim();
      // headless では env() も 0px なので、計算後の値だけでは見分けられない。殻の中の指定そのものも読む
      const shellRule = rules.find(r => r.selectorText === ":root.in-shell");
      const sTop = shellRule ? shellRule.style.getPropertyValue("--sa-top").trim() : "", sBot = shellRule ? shellRule.style.getPropertyValue("--sa-bottom").trim() : "";
      ok("CG. 殻の中では、ページ側の上下の余白は0（殻の SafeAreaView と二重にしない）",
         inTop === "0px" && inBot === "0px" && sTop === "0px" && sBot === "0px", [inTop, inBot, sTop || "指定なし", sBot || "指定なし"].join(" / "));
      ok("CG. ブラウザでは、今までどおり端末の余白を読む（殻の印が付いていない）", !had && /env\(safe-area-inset-top/.test(rootDecl), outTop);
      const first = [...document.scripts].find(sc => /ReactNativeWebView/.test(sc.textContent));
      ok("CG. 殻の中かどうかは、本体より先（描く前）に決める", !!first && /in-shell/.test(first.textContent) && first.textContent.length < 400,
         first ? first.textContent.length + "字" : "無い");
      ok("CG. 取りこぼしたときの控えを boot にも置く", /in-shell/.test(String(boot)));
    }

    /* ===== CH群：「今から◯時まで」を組み立ての時間帯として読む（2026-09-27・実機で報告）=====
       12:39 に「今から午後6時ぐらいまでの予定を組み立てて勉強は4時間以上したい」と言うと、
       時間帯が読めず、勉強が 18:00〜22:00 に入って「18:00からと言っていました」と出た。 */
    {
      const TZc = state.settings.timezone;
      const req = (h, mi, text) => { const iso = zoned(2026, 9, 15, h, mi, TZc).toISOString();
        return parseDayRequest({ id: "ch", text, hash: "h", capturedAt: iso, source: "talk", sourceName: null, createdAt: iso }, TZc); };
      const win = r => r ? r.dayKey + " " + hhmm(r.win[0]) + "-" + hhmm(r.win[1]) : "null";
      const REAL = "おはよう今日は起きるのが遅かった今から午後6時ぐらいまでの予定を組み立てて勉強は4時間以上したい";
      const r1 = req(12, 39, REAL);
      ok("CH. 「今から午後6時ぐらいまで」は、いまから18時までの時間帯", win(r1) === "2026-09-15 12:40-18:00", win(r1));
      const study = r1 && r1.wants.find(x => /勉強/.test(x.title));
      ok("CH. 「勉強は4時間以上」は、勉強を4時間（伸ばさず、落とさず）", !!study && study.min === 240, study ? study.title + " " + study.min : "勉強が無い");
      ok("CH. 時間帯より前の「おはよう、起きるのが遅かった」は、ふつうの読み取りへ回す",
         !!r1 && r1.headLen === REAL.indexOf("今から"), r1 ? String(r1.headLen) : "null");
      const r2 = req(12, 39, "今から6時まで予定を組み立てて");
      ok("CH. 午前か午後を言っていなければ、これから来るほう（12時半の「6時」は18時）", win(r2) === "2026-09-15 12:40-18:00", win(r2));
      const r3 = req(7, 0, "今から10時まで予定を埋めて。読書30分");
      ok("CH. 朝の「今から10時まで」は、その朝（夜へ飛ばさない）", win(r3) === "2026-09-15 07:00-10:00", win(r3));
      const r4 = req(14, 10, "これから18:00まで予定を組み立てて、散歩30分と勉強1時間");
      const mins = r4 ? r4.wants.map(x => x.title + x.min).join(" ") : "null";
      ok("CH. 「散歩30分と勉強1時間」は、それぞれの長さ（先に出た長さを両方に付けない）",
         !!r4 && /散歩する30/.test(mins) && /勉強をする60/.test(mins), mins);
      ok("CH. 残りが15分を切るなら組み立てない", req(17, 50, "今から6時まで予定を組み立てて") === null);
      ok("CH. 組み立てを頼んでいなければ、時間帯として読まない", req(12, 39, "今から6時まで勉強する") === null);
      ok("CH. 「◯時から◯時まで」の読み方は変えていない", win(req(9, 0, "13時から17時までの間で勉強を30分かける2回。予定を組み立てて")) === "2026-09-15 13:00-17:00",
         win(req(9, 0, "13時から17時までの間で勉強を30分かける2回。予定を組み立てて")));
    }

    /* ===== CI群：言い方の組み合わせ検査（2026-09-27・本人の指示「そもそもこのようなことが起きない仕組みを」・決まり6q）=====
       1つずつ報告を待って直すのをやめる。**言い方の部品を掛け合わせて何千通りも流し、
       どの言い方でも守られるべきこと（不変の約束）を確かめる。**
       約束は4つ：
       A. 「今から◯時まで…組み立てて」は、いまから◯時までの時間帯になる（言い方を変えても）
       B. 「◯時までに」の用事は、◯時から始めない（締切の後ろに置かない）
       C. AIが「まで」の時刻を始まりにしても、出口で直る
       D. 置いた理由の文が「◯時からと言っていました」と書くなら、本人は本当に◯時から（に）と言っている */
    {
      const TZc = state.settings.timezone;
      const keepS = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      // 前の群が作業時間の帯を変えたまま残していることがある。ここでは一日じゅう使える既定で測る
      state.settings = Object.assign({}, state.settings, { workStart: "00:00", workEnd: "23:59" });
      const fmtFail = (arr) => arr.length ? arr.length + "件 例：" + arr.slice(0, 3).join(" ／ ") : "全部守られた";

      /* ---- A. 組み立ての依頼（2,592通り） ---- */
      {
        const at = zoned(2026, 9, 15, 12, 39, TZc).toISOString();
        const heads = ["", "おはよう今日は起きるのが遅かった"];
        const starts = ["今から", "いまから", "これから"];
        const ends = [["6時", 1080], ["午後6時", 1080], ["18時", 1080], ["18:00", 1080], ["夕方6時", 1080], ["6時半", 1110]];
        const approx = ["", "ぐらい"];
        const untils = ["まで", "までの"];
        const reqs = ["予定を組み立てて", "スケジュールを作って", "予定を埋めて"];
        const contents = [["", null], ["勉強は4時間以上したい", { 勉強: 240 }], ["勉強2時間と散歩30分", { 勉強: 120, 散歩: 30 }]];
        const seps = ["", "、"];
        let n = 0; const badWin = [], badWant = [], badHead = [];
        for (const h of heads) for (const st of starts) for (const [e, eMin] of ends) for (const ap of approx)
        for (const u of untils) for (const rq of reqs) for (const [c, want] of contents) for (const sp of seps) {
          if (!c && sp) continue;
          const text = h + st + e + ap + u + rq + (c ? sp + c : "");
          n++;
          let r = null;
          try { r = parseDayRequest({ id: "ci", text, hash: "h", capturedAt: at, source: "talk", sourceName: null, createdAt: at }, TZc); } catch (err) { r = null; }
          if (!r || r.dayKey !== "2026-09-15" || r.win[0] !== 760 || r.win[1] !== eMin) { badWin.push(text + "→" + (r ? r.dayKey + " " + hhmm(r.win[0]) + "-" + hhmm(r.win[1]) : "組み立てない")); continue; }
          if (want) for (const [k, m] of Object.entries(want)) {
            const w = r.wants.find(x => x.title.includes(k));
            if (!w || w.min !== m) badWant.push(text + "→" + k + (w ? w.min : "無し"));
          }
          if (h && r.headLen !== text.indexOf(st)) badHead.push(text);
        }
        ok("CI.A 「今から◯時まで…組み立てて」は、どの言い方でも いまから◯時まで（" + n + "通り）", badWin.length === 0, fmtFail(badWin));
        ok("CI.A 言った活動と長さを、どの言い方でも取りこぼさない", badWant.length === 0, fmtFail(badWant));
        ok("CI.A 前置き（おはよう…）は、どの言い方でも ふつうの読み取りへ回す", badHead.length === 0, fmtFail(badHead));
        ok("CI.A 組み合わせの数が足りている（測れていないのに通さない）", n >= 2000, n + "通り");
      }

      /* ---- B・D. 締切の言い方（ルールの道・ほんとうに足して計画まで作る） ---- */
      const reasonLies = [];
      const checkReasons = (plan, text) => {
        for (const b of plan.blocks || []) {
          const m = /(\d{2}):(\d{2})からと言っていました/.exec(b.reason || "");
          if (m && timeRoleOf(text, +m[1] * 60 + +m[2]) !== "start") reasonLies.push(text + "→" + m[0]);
        }
      };
      {
        const today = dayKey(new Date(), TZc);
        const [y, mo, d] = today.split("-").map(Number);
        const at = zoned(y, mo, d, 10, 0, TZc).toISOString();
        const days = ["", "今日"];
        const times = [["18時", 1080], ["午後6時", 1080], ["18:00", 1080], ["夕方6時", 1080], ["6時", 1080]];
        const approx = ["", "ぐらい"];
        const untils = ["までに", "まで"];
        const acts = ["資料を作る", "レポートを書く", "部屋を片付ける", "勉強を2時間する", "洗濯する"];
        let n = 0; const startAt = [], after = [], notDl = [], notPlaced = [];
        for (const dy of days) for (const [tm, dl] of times) for (const ap of approx) for (const u of untils) for (const a of acts) {
          const text = dy + tm + ap + u + a;
          n++;
          reset();
          const note = { id: "cib" + n, text, hash: "h" + n, capturedAt: at, source: "talk", sourceName: null, createdAt: at };
          const items = [];
          for (const o of ruleOps(note)) if (o.op === "add" && o._built) { wordCheck(o._built, note, TZc, "add"); items.push(o._built); }
          state.items = items;
          const it = items.find(i => i.kind === "task" || i.kind === "event");
          if (!it) { startAt.push(text + "→読み取れない"); continue; }
          if (it.kind !== "task" || !it.dueIsDeadline) notDl.push(text + "→" + it.kind + (it.dueIsDeadline ? "" : "（締切ではない）"));
          const plan = planFor(today, { nowMin: 600 });
          if (!plan.blocks.some(b => b.item && b.item.id === it.id)) notPlaced.push(text + "→置かれない");
          for (const b of plan.blocks.filter(b => b.item && b.item.id === it.id)) {
            if (b.s === dl) startAt.push(text + "→" + hhmm(b.s) + "から");
            if (b.e > dl) after.push(text + "→" + hhmm(b.s) + "-" + hhmm(b.e));
          }
          checkReasons(plan, text);
        }
        ok("CI.B 「◯時までに」は、どの言い方でも ◯時から始めない（" + n + "通り）", startAt.length === 0, fmtFail(startAt));
        ok("CI.B 締切を過ぎて終わる枠を作らない", after.length === 0, fmtFail(after));
        ok("CI.B 「まで」の時刻は、どの言い方でも締切として持つ", notDl.length === 0, fmtFail(notDl));
        ok("CI.B 締切までに空きがあれば、締切の前に置く（締切を理由に置き忘れない）", notPlaced.length === 0, fmtFail(notPlaced));

        /* 直しすぎない：「から」「に」は始まりのまま、その時刻に置く */
        const starts = ["18時から資料を作る", "18時に資料を作る", "午後6時から勉強を1時間する", "18:00から洗濯する", "今日18時に部屋を片付ける"];
        const moved = [];
        for (const text of starts) {
          reset();
          const note = { id: "cis", text, hash: "hs", capturedAt: at, source: "talk", sourceName: null, createdAt: at };
          const items = [];
          for (const o of ruleOps(note)) if (o.op === "add" && o._built) { wordCheck(o._built, note, TZc, "add"); items.push(o._built); }
          state.items = items;
          const it = items.find(i => i.kind === "task" || i.kind === "event");
          const plan = planFor(today, { nowMin: 600 });
          const b = it && plan.blocks.find(b => b.item && b.item.id === it.id);
          if (!b || b.s !== 1080) moved.push(text + "→" + (b ? hhmm(b.s) : "置かれない（" + (it ? it.kind + " " + it.due + " " + ((plan.unplaced || []).map(u => u.reason).join("/") || (plan.loose || []).length + "件loose") : "項目なし") + "）"));
          checkReasons(plan, text);
        }
        ok("CI.B 直しすぎない：「18時から」「18時に」は18:00に置く", moved.length === 0, fmtFail(moved));
      }

      /* ---- C・D. AIが「まで」の時刻を始まりにした（出口で直るか） ---- */
      {
        const today = dayKey(new Date(), TZc);
        const [y, mo, d] = today.split("-").map(Number);
        const at = zoned(y, mo, d, 12, 39, TZc).toISOString();
        const phr = ["午後6時ぐらいまで勉強は4時間以上したい", "18時まで勉強4時間", "6時までに勉強を4時間やりたい",
                     "夕方6時頃までに勉強4時間", "18:00までに4時間は勉強したい", "今日は午後6時まで勉強する、4時間"];
        const bad = [], silent = [];
        let n = 0;
        for (const text of phr) for (const kind of ["event", "task"]) {
          n++;
          reset();
          const note = { id: "cic" + n, text, hash: "hc" + n, capturedAt: at, source: "talk", sourceName: null, createdAt: at };
          await putNote(note);
          const r = await applyOps([{ op: "add", kind, title: "勉強", dueDate: today, dueTime: "18:00", estimateMin: 240, duePrecision: "exact", quote: text }], note);
          const it = state.items.find(i => i.title === "勉強");
          if (!it) { bad.push(text + "（" + kind + "）→入らない"); continue; }
          if (it.kind === "event" || !it.dueIsDeadline) bad.push(text + "（" + kind + "）→" + it.kind + (it.dueIsDeadline ? "" : "・締切でない"));
          const plan = planFor(today, { nowMin: 760 });
          const b = plan.blocks.find(b => b.item && b.item.id === it.id);
          if (!b) bad.push(text + "（" + kind + "）→置かれない");
          if (b && (b.s >= 1080 || b.e > 1080)) bad.push(text + "（" + kind + "）→" + hhmm(b.s) + "-" + hhmm(b.e));
          if (kind === "event" && !r.asks.some(a => /までに終える/.test(a))) silent.push(text);
          checkReasons(plan, text);
        }
        ok("CI.C AIが「まで」の時刻を始まりにしても、出口で締切に直る（" + n + "通り）", bad.length === 0, fmtFail(bad));
        ok("CI.C 直したことを黙らない（予定を締切に変えたら、そう言う）", silent.length === 0, fmtFail(silent));
      }
      ok("CI.D 置いた理由の「◯時からと言っていました」は、本人が本当に◯時から（に）と言ったときだけ", reasonLies.length === 0, fmtFail(reasonLies));

      /* ---- E. AIが、本人の言っていない時刻を足した（出口で外れるか・直しすぎないか） ---- */
      {
        const today = dayKey(new Date(), TZc);
        const [y, mo, d] = today.split("-").map(Number);
        const tmr = dayKey(new Date(zoned(y, mo, d, 12, 0, TZc).getTime() + 86400000), TZc);
        const at = zoned(y, mo, d, 10, 0, TZc).toISOString();
        const run1 = async (text, op) => {
          reset();
          const note = { id: "cie", text, hash: "he", capturedAt: at, source: "talk", sourceName: null, createdAt: at };
          await putNote(note);
          await applyOps([Object.assign({ op: "add", quote: text }, op)], note);
          return state.items.find(i => i.title === op.title);
        };
        const invented = [], kept = [];
        // 時刻を言っていない → AIの時刻は採らない
        let it = await run1("資料を作らないと", { kind: "task", title: "資料を作る", dueDate: today, dueTime: "15:00", duePrecision: "exact", estimateMin: 60 });
        if (!it || it.duePrecision === "exact") invented.push("資料を作らないと→" + (it ? it.duePrecision + " " + it.due : "入らない"));
        else { const pl = planFor(today, { nowMin: 600 }); if (pl.blocks.some(b => b.item && b.item.id === it.id && b.s === 900)) invented.push("資料を作らないと→15:00に置いた"); }
        it = await run1("歯医者に行く", { kind: "event", title: "歯医者に行く", dueDate: today, dueTime: "15:00", duePrecision: "exact" });
        // 日付も言っていないので、AIの日付ごと外れる（決まり7d）。どちらでも、時刻が残らなければよい
        const noClock = it => !!it && (it.kind === "event" ? (!it.start || it.timeUnknown) : it.duePrecision !== "exact");
        if (!noClock(it)) invented.push("歯医者に行く→" + (it ? "時刻 " + it.start : "入らない"));
        it = await run1("明日歯医者", { kind: "event", title: "歯医者", dueDate: tmr, dueTime: "10:00", duePrecision: "exact" });
        if (!it || !it.timeUnknown || it.dayKey !== tmr) invented.push("明日歯医者→" + (it ? (it.timeUnknown ? "" : "時刻 " + it.start + " ") + it.dayKey : "入らない"));
        it = await run1("午後に資料を作る", { kind: "task", title: "資料を作る", dueDate: today, dueTime: "15:00", duePrecision: "exact", estimateMin: 60 });
        if (!noClock(it)) invented.push("午後に資料を作る→" + (it ? it.duePrecision + " " + it.due : "入らない"));
        // 日付を言っていれば日付は残り、時間帯が置き場所になる
        it = await run1("今日の午後に資料を作る", { kind: "task", title: "資料を作る", dueDate: today, dueTime: "15:00", duePrecision: "exact", estimateMin: 60 });
        if (!noClock(it) || it.dayKey !== today || it.preferWindow !== "afternoon") invented.push("今日の午後に資料を作る→" + (it ? it.duePrecision + " " + it.dayKey + " " + it.preferWindow : "入らない"));
        // 時間帯も、言っていなければ採らない（「夕方6時」の「夕方」は時刻の一部）
        it = await run1("今日の夕方6時までに資料を作る", { kind: "task", title: "資料を作る", dueDate: today, dueTime: "18:00", duePrecision: "exact", estimateMin: 120, preferWindow: "evening" });
        if (!it || it.preferWindow) invented.push("今日の夕方6時までに資料を作る→時間帯 " + (it ? it.preferWindow : "入らない"));
        it = await run1("今日の夕方に資料を作る", { kind: "task", title: "資料を作る", dueDate: today, duePrecision: "day", estimateMin: 60, preferWindow: "evening" });
        if (!it || it.preferWindow !== "evening") kept.push("今日の夕方に資料を作る→時間帯 " + (it ? it.preferWindow : "入らない"));
        it = await run1("明日の朝ランニングする", { kind: "task", title: "ランニングする", dueDate: tmr, duePrecision: "day", estimateMin: 30, preferWindow: "morning" });
        if (!it || it.preferWindow !== "morning") kept.push("明日の朝ランニングする→時間帯 " + (it ? it.preferWindow : "入らない"));
        // 直しすぎない：言った時刻はそのまま
        it = await run1("15時に歯医者", { kind: "event", title: "歯医者", dueDate: today, dueTime: "15:00", duePrecision: "exact" });
        if (!it || it.timeUnknown || minOfDay(it.start, TZc) !== 900) kept.push("15時に歯医者→" + (it ? it.start : "入らない"));
        it = await run1("3時から歯医者", { kind: "event", title: "歯医者", dueDate: today, dueTime: "15:00", duePrecision: "exact" });
        if (!it || it.timeUnknown || minOfDay(it.start, TZc) !== 900) kept.push("3時から歯医者→" + (it ? it.start : "入らない"));
        it = await run1("14時から資料を作る", { kind: "task", title: "資料を作る", dueDate: today, dueTime: "14:00", duePrecision: "exact", estimateMin: 60 });
        if (!it || it.duePrecision !== "exact" || it.dueIsDeadline) kept.push("14時から資料を作る→" + (it ? it.duePrecision + (it.dueIsDeadline ? "・締切" : "") : "入らない"));
        ok("CI.E AIが足した時刻（本人は言っていない）は、出口で外れる", invented.length === 0, fmtFail(invented));
        ok("CI.E 直しすぎない：本人が言った時刻はそのまま", kept.length === 0, fmtFail(kept));
      }

      /* ---- G. 時刻の役目の読み分け（表で固定する） ---- */
      {
        const table = [
          ["10時から12時まで勉強", [["from", 600], ["until", 720]]],
          ["10時〜12時 会議", [["from", 600], ["until", 720]]],
          ["14時-16時 資料作り", [["from", 840], ["until", 960]]],
          ["10時から、12時まで", [["from", 600], ["until", 720]]],
          ["18時までに資料", [["until", 1080]]],
          ["午後6時ぐらいまで", [["until", 1080]]],
          ["18時から資料", [["from", 1080]]],
          ["18時に歯医者", [["at", 1080]]],
          ["18:00まで", [["until", 1080]]],
          ["夕方6時頃までに", [["until", 1080]]],
        ];
        const wrong = [];
        for (const [text, want] of table) {
          const got = timeRoles(text);
          const okk = got.length === want.length && want.every(([role, m], i) => got[i].role === role && got[i].mins.includes(m));
          if (!okk) wrong.push(text + "→" + got.map(g => g.role + ":" + g.mins.map(hhmm).join("|")).join(" "));
        }
        ok("CI.G 時刻の役目（から・まで・に）を、言い方の表どおりに読み分ける（" + table.length + "通り）", wrong.length === 0, fmtFail(wrong));
      }

      /* ---- H. 「今日」と言った6〜11時：午前がもう過ぎていれば午後（聞き返しつき）・まだなら午前のまま ---- */
      {
        const at = (h, m) => zoned(2026, 9, 15, h, m, TZc).toISOString();
        const table = [
          [at(10, 0), "今日6時までに資料を作る", "18:00", true],
          [at(10, 0), "今日9時に歯医者に行く", "21:00", true],
          [at(8, 0), "今日9時に歯医者に行く", "09:00", false],
          [at(10, 0), "今日3時に歯医者に行く", "15:00", true],
          [at(10, 0), "明日6時に起きる", "06:00", false],      // 起きる・家を出るは朝のこと。18時かと聞き返さない（2026-09-27）
          [at(10, 0), "明日9時に歯医者に行く", "09:00", false],
          [at(22, 30), "今日9時に歯医者に行く", "09:00", false],
          [at(10, 0), "今日の午前9時に歯医者", "09:00", false],
        ];
        const wrong = [];
        for (const [base, text, hm, alt] of table) {
          const w = parseWhen(text, base, TZc);
          const got = w ? hhmm(minOfDay(w.iso, TZc)) : "読めない";
          if (got !== hm || !!(w && w.altStart) !== alt) wrong.push(text + "（" + base.slice(11, 16) + "Z）→" + got + (w && w.altStart ? "・聞き返す" : ""));
        }
        ok("CI.H 「今日」の6〜11時は、午前が過ぎていれば午後と読む（言われていれば触らない）", wrong.length === 0, fmtFail(wrong));
      }

      /* ---- I. 同じ決まりを、AIへの依頼文にも書いてある（ルールとAIで答えが割れないように・決まり4c） ---- */
      {
        const nb = { id: "cii", text: "18時までに資料を作る", hash: "hi", capturedAt: T(10, 0), source: "talk", sourceName: null, createdAt: T(10, 0) };
        const pr = buildPrompt(nb, contextForAI(nb));
        ok("CI.I 依頼文：「まで」の時刻は始まりではなく締切", /「まで」「18時までに」の時刻は、始まりではなく締切/.test(pr) || /始まりではなく締切/.test(pr));
        ok("CI.I 依頼文：言っていない時刻・時間帯は入れない", /本人が言っていない時刻・時間帯は入れない/.test(pr));
        ok("CI.I 依頼文：「今日」の過ぎた朝は午後", /「今日」と言っていて、午前のほうがもう過ぎていれば午後/.test(pr));
      }

      /* ---- F. 組み立ての時間帯が読めなかったことを、AIの道でも黙らない（実際に1回流す） ---- */
      {
        const keepAI = SAMPLEFN, keepView = view.day, keepChat = view.chatDay;
        const stub = () => Promise.resolve({ text: "受け止めの一言。" });
        stub.json = () => Promise.resolve({ ops: [{ op: "add", kind: "task", title: "勉強をする", dueDate: null,
          duePrecision: "none", quote: "勉強" }], habit: "" });
        SAMPLEFN = stub;
        reset();
        let turn = null;
        try {
          await sendTurn("6時に予定を組み立てて、勉強もしたい");
          const tdy = dayKey(new Date(), state.settings.timezone);
          turn = (state.turns[tdy] || []).filter(t => t.role === "assistant").pop();
        } finally { SAMPLEFN = keepAI; view.day = keepView; view.chatDay = keepChat; }
        const txt = turn ? turn.text : "";
        ok("CI.F AIがオンでも「どの時間帯かを読み取れませんでした」と言う", /どの時間帯かを読み取れませんでした/.test(txt), txt.slice(0, 80));
        ok("CI.F そのときもAIが読んだ用事は入る（知らせるだけで捨てない）", state.items.some(i => i.title === "勉強をする"), state.items.map(i => i.title).join("/"));
      }

      state.notes = keepS.notes; state.items = keepS.items; state.turns = keepS.turns; state.docs = keepS.docs; state.settings = keepS.settings;
    }

    /* ===== CK. ふだんの言い方を、黙って捨てない・壊さない（2026-09-27・本人の指示「ほかにも最適化できないか模索して」） =====
       ふだんの言い方50文をAIなしで流すと、7文が**何も記録されず**、6文の見出しが壊れていた
       （「来月の3日は母の誕生日」→なし、「企画書を出さなきゃ」→「企画書を出さ」、「毎朝7時に」→「毎ジョギングする」）。
       **日付・時刻を言った文は、どの種類にも当たらなくても予定として受ける**（datedLeftover）。1文ずつではなく組み合わせで見る。 */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const fmtFail = (arr) => arr.length ? arr.length + "件 例：" + arr.slice(0, 3).join(" ／ ") : "全部守られた";
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const at = (h, m) => zoned(2026, 9, 15, h, m, TZ).toISOString();     // 火曜
      const read = (text, h = 10, m = 0) => {
        reset();
        const note = { id: uid(), text, hash: "ck" + text, capturedAt: at(h, m), source: "talk", sourceName: null, createdAt: at(h, m) };
        const ops = ruleOps(note);
        return { items: ops.filter(o => o.op === "add" && o._built).map(o => o._built), ops };
      };
      // ① 日付＋名詞は、どの組み合わせでも記録する（日付は言ったとおり・見出しに日付のかけらを残さない）
      const dates = [["明日", "2026-09-16"], ["明後日", "2026-09-17"], ["来週の水曜", "2026-09-23"], ["次の土曜", "2026-09-19"],
                     ["今度の日曜", "2026-09-20"], ["この土曜", "2026-09-19"], ["来月の3日", "2026-10-03"], ["10月5日", "2026-10-05"]];
      const nouns = ["母の誕生日", "友達と映画", "お茶の約束", "花火大会", "同窓会", "保護者会"];
      const seps = ["は", "に", "、"];
      let n = 0; const lost = [], badDay = [], badTitle = [];
      for (const [d, dk] of dates) for (const nn of nouns) for (const sp of seps) {
        const text = d + sp + nn; n++;
        const r = read(text);
        const it = r.items.find(i => i.kind === "event" || i.kind === "task");
        if (!it) { lost.push(text); continue; }
        if (it.dayKey !== dk) badDay.push(text + "→" + it.dayKey);
        if (it.title !== nn) badTitle.push(text + "→「" + it.title + "」");
      }
      ok("CK. 日付＋名詞は、どの言い方でも記録する（" + n + "通り）", lost.length === 0, fmtFail(lost));
      ok("CK. 日付は言ったとおり", badDay.length === 0, fmtFail(badDay));
      ok("CK. 見出しに日付のかけら（次・こ・毎・中）を残さない", badTitle.length === 0, fmtFail(badTitle));
      // 時刻つきも同じ
      const clocks = [["3時に", 900], ["15時から", 900], ["午後3時に", 900], ["15:00に", 900]];
      const lostT = [];
      for (const [c, m] of clocks) for (const nn of nouns) {
        const r = read(c + nn);
        const it = r.items.find(i => i.kind === "event");
        if (!it || it.timeUnknown || minOfDay(it.start, TZ) !== m) lostT.push(c + nn + "→" + (it ? (it.timeUnknown ? "時刻未定" : hhmm(minOfDay(it.start, TZ))) : "なし"));
      }
      ok("CK. 時刻＋名詞も、その時刻の予定にする（" + clocks.length * nouns.length + "通り）", lostT.length === 0, fmtFail(lostT));
      // 締め切りは用事（締切つき）
      const dl = read("レポートの締め切りは明後日").items[0];
      ok("CK. 「◯◯の締め切りは明後日」は、締切つきの用事", !!dl && dl.kind === "task" && dl.dayKey === "2026-09-17" && dl.dueIsDeadline, dl ? dl.kind + " " + dl.dayKey : "なし");

      // ② 拾いすぎない：気持ち・様子・過去・天気・問いかけ・頼み・言い直しは、予定にしない
      const not = ["明日は忙しい", "来週は楽しみ", "明日は休みたいなあ", "昨日は母の誕生日だった", "先週の土曜は友達と映画",
                   "明日は雨", "たぶん明日は晴れ", "明日の予定どうしよう", "来週の水曜は空いてる？", "明日は予定を入れないで",
                   "金曜の夜は空けておいて", "明日の予定、15時じゃなくて14時だった", "明日は同窓会かもしれない", "明日の予定", "明日はゆっくり休みたい", "今夜は早く寝たい",
                   "来週の旅行が楽しみだ", "明日は部長が不在です", "明日の同窓会、15時じゃなくて16時だった"];
      const over = [];
      for (const text of not) {
        const r = read(text);
        const it = r.items.find(i => i.kind === "event" || i.kind === "task");
        if (it) over.push(text + "→" + it.kind + "「" + it.title + "」");
      }
      ok("CK. 気持ち・過去・天気・問いかけ・頼み・言い直しを、予定にしない（" + not.length + "通り）", over.length === 0, fmtFail(over));

      // ③ 見出しの言い切り
      const titles = [["金曜までに企画書を出さなきゃ", "企画書を出す"], ["明日までに銀行に行かなきゃ", "銀行に行く"],
                      ["レポートを書かなくちゃ", "レポートを書く"], ["明日は早く出かけなきゃ", "早く出かける"],
                      ["明日引っ越したい", "引っ越す"], ["明日英語を勉強したい", "英語を勉強する"], ["明日先生と話したい", "先生と話す"], ["明日勉強したい", "勉強する"],
                      ["毎朝7時にジョギングしたい", "ジョギングする"], ["図書館で本を返す、今週中", "図書館で本を返す"],
                      ["来週の水曜に面接がある", "面接"], ["今から買い物に行く", "買い物に行く"], ["来週のどこかで部屋を片付ける", "部屋を片付ける"],
                      ["明日の朝一でメールを返す", "メールを返す"]];
      const badT = [];
      for (const [text, want] of titles) {
        const it = read(text).items.find(i => i.kind === "event" || i.kind === "task");
        if (!it || it.title !== want) badT.push(text + "→「" + (it ? it.title : "なし") + "」");
      }
      ok("CK. 見出しは言い切り・日時のかけらを残さない（" + titles.length + "通り）", badT.length === 0, fmtFail(badT));

      // ④ 予約を「取る」は用事、名詞止めは予定
      const bk = [["今週中に歯医者の予約を取る", "task"], ["美容院の予約を入れないと", "task"], ["明日病院の予約をする", "task"], ["14時に歯医者の予約", "event"]];
      const badB = bk.filter(([t, k]) => { const it = read(t).items[0]; return !it || it.kind !== k; }).map(([t, k]) => t + "→" + k + "でない");
      ok("CK. 「予約を取る」は予約するという用事・「14時に歯医者の予約」は予定", badB.length === 0, fmtFail(badB));

      // ⑤ 「30分後に」は、話した時刻から数える
      const rel = [["30分後に電話する", 10, 0, 630], ["1時間後に家を出る", 10, 0, 660], ["1時間半後に出発", 10, 0, 690], ["30分後に電話する", 23, 50, 20], ["30分後に電話する", 0, 30, 60]];
      const badR = [];
      for (const [t, h, m, want] of rel) {
        const it = read(t, h, m).items.find(i => i.kind === "event" || i.kind === "task");
        const got = it ? minOfDay(it.kind === "event" ? it.start : it.due, TZ) : null;
        if (got !== want || (it && it.whenAlt)) badR.push(t + "（" + h + ":" + m + "）→" + (got == null ? "なし" : hhmm(got)) + (it && it.whenAlt ? "・聞き返す" : ""));
      }
      const wrap = read("30分後に電話する", 23, 50).items[0];
      ok("CK. 「30分後」「1時間半後」は話した時刻から数える（日をまたいでも・午前午後を聞き返さない）", badR.length === 0 && !!wrap && wrap.dayKey === "2026-09-16", fmtFail(badR) + (wrap ? " " + wrap.dayKey : ""));

      // ⑥ 夜の希望：「◯時以降は」「夜は空けておいて」
      const pf = t => (read(t).ops.find(o => o.op === "prefer" && o.key === "noEveningWork") || null);
      const p1 = pf("18時以降は予定を入れないで"), p2 = pf("9時以降は作業しない"), p3 = pf("水曜の夜は空けておいて"), p4 = pf("午後8時半以降は何もしたくない");
      ok("CK. 「18時以降は予定を入れないで」は、18:00からの夜の希望（予定は作らない）",
         !!p1 && p1.value === 1080 && !read("18時以降は予定を入れないで").items.some(i => i.kind === "event" || i.kind === "task"), p1 ? String(p1.value) : "なし");
      ok("CK. 午前午後を言っていない「9時以降は」は夜の21時・「午後8時半以降」は20:30", !!p2 && p2.value === 1260 && !!p4 && p4.value === 1230, (p2 ? p2.value : "なし") + " / " + (p4 ? p4.value : "なし"));
      ok("CK. 「水曜の夜は空けておいて」は、その水曜の夜だけ", !!p3 && p3.scopeDay === "2026-09-16", p3 ? String(p3.scopeDay) : "なし");

      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== CL. まだ読めていなかった4つ（2026-09-27・本人の指示「まだ読めてないものも直して」） =====
       ①「来月」だけ（日にちなし）②曜日が2つ ③「〜から…水曜に帰る」の何日も続く予定 ④朝の用事（起きる・家を出る）を夜と読む */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const at = (h, m) => zoned(2026, 9, 15, h, m, TZ).toISOString();     // 火曜
      const read = (text, h = 10, m = 0) => {
        reset();
        const note = { id: uid(), text, hash: "cl" + text + h, capturedAt: at(h, m), source: "talk", sourceName: null, createdAt: at(h, m) };
        return ruleOps(note).filter(o => o.op === "add" && o._built).map(o => o._built);
      };
      const hm = iso => hhmm(minOfDay(iso, TZ));
      const bad = (label, cond, got) => cond ? null : label + "→" + got;
      const show = its => its.map(i => i.kind + "「" + i.title + "」" + (i.dayKey || "") + (i.spanEndKey ? "〜" + i.spanEndKey : "") + "/" + (i.duePrecision || "")).join(" ｜ ");
      // ① 日にちの無い月・年
      const month = [["来月引っ越したい", "引っ越す", "2026-10-31", "week"], ["今月中に歯医者", "歯医者", "2026-09-30", "week"],
                     ["再来月に旅行", "旅行", "2026-11-30", "week"], ["来月末までに書類を出す", "書類を出す", "2026-10-31", "day"],
                     ["来年は資格を取る", "資格を取る", "2027-12-31", "week"]];
      const m1 = month.map(([t, title, dk, prec]) => { const its = read(t); const it = its[0];
        return bad(t, its.length === 1 && it.kind === "task" && it.title === title && it.dayKey === dk && it.duePrecision === prec, show(its)); }).filter(Boolean);
      const d3 = read("来月の3日は母の誕生日")[0];
      if (!d3 || d3.dayKey !== "2026-10-03" || d3.kind !== "event") m1.push("来月の3日→" + (d3 ? show([d3]) : "なし"));
      ok("CL. 「来月」「今月中」「来年」は、その月・年の終わりまでのあいまいな用事（最後の日の予定にしない・見出しに残さない）", m1.length === 0, m1.join(" ／ "));
      // ② 曜日が2つ
      const y = read("月曜と木曜の19時からヨガ");
      ok("CL. 「月曜と木曜の19時からヨガ」は、月曜と木曜の2件",
         y.length === 2 && y.every(i => i.kind === "event" && i.title === "ヨガ" && hm(i.start) === "19:00") && y.map(i => i.dayKey).sort().join() === "2026-09-17,2026-09-21", show(y));
      const g = read("毎週火曜と金曜の7時にジム");
      ok("CL. 「毎週火曜と金曜の7時にジム」は、毎週の2件（火曜・金曜の朝7時）",
         g.length === 2 && g.every(i => i.repeat && i.repeat.kind === "weekly" && hm(i.start) === "07:00") && g.map(i => i.repeat.dow).sort().join() === "2,5", show(g) + " " + g.map(i => i.start && hm(i.start)).join());
      // 同じ発言の2件を、1件にまとめない（ほんとうに足して確かめる）
      reset();
      { const note = { id: uid(), text: "月曜と木曜の19時からヨガ", hash: "cly", capturedAt: at(10, 0), source: "talk", sourceName: null, createdAt: at(10, 0) };
        await putNote(note); await applyOps(ruleOps(note), note); }
      ok("CL. 足しても2件のまま（同じ発言だからと1件にまとめない）", state.items.filter(i => i.title === "ヨガ").length === 2, state.items.map(i => i.title + i.dayKey).join("/"));
      // ③ 何日も続く
      const span = [["来週月曜から出張で水曜に帰る", "出張", "2026-09-21", "2026-09-23"], ["14日から旅行で16日に戻る", "旅行", "2026-10-14", "2026-10-16"],
                    ["月曜から水曜まで研修", "研修", "2026-09-21", "2026-09-23"], ["14日から16日まで旅行", "旅行", "2026-10-14", "2026-10-16"]];
      const m3 = span.map(([t, title, a, b]) => { const it = read(t)[0];
        return bad(t, !!it && it.kind === "event" && it.title === title && it.allDay && it.dayKey === a && it.spanEndKey === b, it ? show([it]) : "なし"); }).filter(Boolean);
      ok("CL. 「〜から…水曜に帰る」「月曜から水曜まで」は、その日から終わりの日まで続く予定", m3.length === 0, m3.join(" ／ "));
      // ④ 朝の用事は、午前が過ぎていれば翌朝（夜を持って聞き返す）
      const w = read("8時に起きて9時に家を出る");
      ok("CL. 10時の「8時に起きて9時に家を出る」は翌朝の8時・9時（夜ではない）",
         w.length === 2 && w[0].dayKey === "2026-09-16" && hm(w[0].due) === "08:00" && hm(w[1].due) === "09:00" && !!w[0].whenAlt, show(w) + " " + w.map(i => i.due && hm(i.due)).join());
      const early = read("7時に起きる", 6, 0)[0];
      ok("CL. 朝6時の「7時に起きる」はその朝のまま（聞き返さない）", !!early && early.dayKey === "2026-09-15" && hm(early.due) === "07:00" && !early.whenAlt, early ? show([early]) : "なし");
      const mtg = read("9時に会議")[0];
      ok("CL. 朝の用事でなければ今までどおり（10時の「9時に会議」は夜）", !!mtg && hm(mtg.start) === "21:00", mtg ? hm(mtg.start) : "なし");
      const wk = read("毎週火曜の7時にジム")[0];
      ok("CL. 「今日」と言っていない曜日の時刻は、過ぎていても午後にしない（毎週火曜の7時＝朝）", !!wk && hm(wk.start) === "07:00", wk ? hm(wk.start) : "なし");
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== CM. 残りの2つ（2026-09-27・本人の指示「残りの2つも直して」） =====
       ①「月曜と木曜はジムが混む」のような場所の様子を、ジムの予定にしない ②「来年の春に」の「春に」を見出しに残さない（季節を期限として読む）。
       ついでに見つけた穴：「ジムが混むから10時に行く」の「から」（理由）を範囲と読み、10時を締切にしていた。 */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const at = (h, m) => zoned(2026, 9, 15, h, m, TZ).toISOString();     // 火曜
      const read = (text, h = 10, m = 0) => {
        reset();
        const note = { id: uid(), text, hash: "cm" + text + h, capturedAt: at(h, m), source: "talk", sourceName: null, createdAt: at(h, m) };
        return ruleOps(note).filter(o => o.op === "add" && o._built).map(o => o._built);
      };
      const hm = iso => hhmm(minOfDay(iso, TZ));
      const show = its => its.map(i => i.kind + "「" + i.title + "」" + (i.dayKey || "") + "/" + (i.duePrecision || "")).join(" ｜ ");
      // ① 場所の様子は、予定にも用事にもしない
      const scene = ["月曜と木曜はジムが混む", "日曜は銀行が休み", "駅前のカフェは空いてる", "10時はジムが混む", "土曜はスーパーがすごく混んでる", "来週はジムが休業らしい"];
      const s1 = scene.map(t => { const its = read(t); return its.length ? t + "→" + show(its) : null; }).filter(Boolean);
      ok("CM. 「月曜と木曜はジムが混む」のような場所の様子は、予定にしない", s1.length === 0, s1.join(" ／ "));
      // 拾いすぎない：その日のあり方・行く話・予約は今までどおり
      const keepOk = [["明日は休み", i => i.kind === "event" && i.allDay && i.dayKey === "2026-09-16"],
                      ["明日ジムに行く", i => i.kind === "event" && i.dayKey === "2026-09-16"],
                      ["混んでるけど明日ジムに行く", i => i.kind === "event" && i.dayKey === "2026-09-16"],
                      ["日曜は休み", i => i.kind === "event" && i.allDay && i.dayKey === "2026-09-20"]];
      const s2 = keepOk.map(([t, f]) => { const its = read(t); return its.length === 1 && f(its[0]) ? null : t + "→" + (show(its) || "なし"); }).filter(Boolean);
      ok("CM. 「明日は休み」「日曜は休み」（その日のあり方）や「ジムに行く」は、今までどおり予定", s2.length === 0, s2.join(" ／ "));
      // ② 季節は、その季節の終わりまでのあいまいな期限（見出しに残さない）
      const season = [["来年の春に引っ越したい", "引っ越す", "2027-05-31"], ["夏に旅行したい", "旅行する", "2027-08-31"],
                      ["秋に資格試験", "資格試験", "2026-11-30"], ["冬にスキーに行く", "スキーに行く", "2027-02-28"],
                      ["再来年の夏に留学", "留学", "2028-08-31"], ["今年の冬は北海道", "北海道", "2027-02-28"]];
      const s3 = season.map(([t, title, dk]) => { const its = read(t); const it = its[0];
        return its.length === 1 && it.title === title && it.dayKey === dk && it.duePrecision === "week" && it.kind === "task" ? null : t + "→" + (show(its) || "なし"); }).filter(Boolean);
      ok("CM. 「来年の春に」「夏に」は、その季節の終わりまでのあいまいな用事（「春に」を見出しに残さない・過ぎた季節は来年）", s3.length === 0, s3.join(" ／ "));
      const winterJan = (() => { reset(); const note = { id: uid(), text: "冬に温泉に行く", hash: "cmj", capturedAt: zoned(2027, 1, 10, 10, 0, TZ).toISOString(), source: "talk", sourceName: null, createdAt: zoned(2027, 1, 10, 10, 0, TZ).toISOString() };
        return ruleOps(note).filter(o => o.op === "add" && o._built).map(o => o._built)[0]; })();
      ok("CM. 1月に言った「冬に」は、いまの冬（2月末）", !!winterJan && winterJan.dayKey === "2027-02-28", winterJan ? show([winterJan]) : "なし");
      const words = [["青春を楽しむ", "青春を楽しむ"], ["秋葉原に行く", "秋葉原に行く"]];
      const s4 = words.map(([t, title]) => { const it = read(t)[0]; return it && it.title === title && !it.dayKey ? null : t + "→" + (it ? show([it]) : "なし"); }).filter(Boolean);
      ok("CM. 「青春」「秋葉原」の春・秋は季節ではない（日付を付けない・見出しを削らない）", s4.length === 0, s4.join(" ／ "));
      // ③ 理由の「から」は範囲ではない
      ok("CM. 「ジムが混むから10時に行く」の10時は始まり（締切ではない）", timeRoleOf("ジムが混むから10時に行く", 600) === "start"
         && timeRoleOf("10時から12時", 720) === "until" && timeRoleOf("9時半から11時", 660) === "until" && timeRoleOf("10〜12時に勉強", 720) === "until",
         [timeRoleOf("ジムが混むから10時に行く", 600), timeRoleOf("10時から12時", 720), timeRoleOf("9時半から11時", 660), timeRoleOf("10〜12時に勉強", 720)].join());
      reset();
      { const note = { id: uid(), text: "ジムが混むから10時に行く", hash: "cmg", capturedAt: at(8, 0), source: "talk", sourceName: null, createdAt: at(8, 0) };
        await putNote(note); const r = await applyOps(ruleOps(note), note);
        const it = state.items.find(i => i.noteId === note.id);
        ok("CM. 足しても、10時に始まる予定のまま（締切に直したと言わない）", !!it && it.kind === "event" && hm(it.start) === "10:00" && !(r.asks || []).some(a => /締切|まで/.test(a)),
           (it ? it.kind + " " + (it.start && hm(it.start)) : "なし") + " " + (r.asks || []).join("/")); }
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== CN. 時期の言い方（2026-09-27・本人の指示「まだ読めてないものも直して」） =====
       ①「春から新しい仕事」が 5/31 までの用事になっていた（始まりなのに締切）②「今年の冬は北海道」が「2/28 ごろ」と出て、冬の話だと読めなかった
       ③「4月に旅行」「12月に引っ越す」「6月までにレポート」「3か月後に試験」が何も記録されない・日付が付かない。 */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const at = (h, m) => zoned(2026, 9, 15, h, m, TZ).toISOString();     // 火曜
      const mkNote = (text, h = 10) => ({ id: uid(), text, hash: "cn" + text + h, capturedAt: at(h, 0), source: "talk", sourceName: null, createdAt: at(h, 0) });
      const read = text => { reset(); return ruleOps(mkNote(text)).filter(o => o.op === "add" && o._built).map(o => o._built); };
      const show = its => its.map(i => i.kind + "「" + i.title + "」" + (i.dayKey || "") + "/" + (i.duePrecision || "") + (i.dueIsDeadline ? "まで" : "") + describeWhen(i, TZ)).join(" ｜ ");
      const chk = (rows, f) => rows.map(r => { const its = read(r[0]); return its.length === 1 && f(its[0], r) ? null : r[0] + "→" + (show(its) || "なし"); }).filter(Boolean);
      // ① 「〜から」は始まり
      const from = [["春から新しい仕事", "新しい仕事", "2027-03-01", "（春から）"], ["来月から新しい仕事", "新しい仕事", "2026-10-01", "（来月から）"],
                    ["4月から新しい部署", "新しい部署", "2027-04-01", "（4月から）"], ["来年から英語を勉強する", "英語を勉強する", "2027-01-01", "（来年から）"],
                    ["来月からジムに通う", "ジムに通う", "2026-10-01", "（来月から）"]];
      const f1 = chk(from, (it, r) => it.kind === "task" && it.title === r[1] && it.dayKey === r[2] && it.duePrecision === "week" && !it.dueIsDeadline && it.periodFrom && describeWhen(it, TZ) === r[3]);
      ok("CN. 「春から」「来月から」「4月から」は、その時期の始まり（締切にしない・「春から」と出す）", f1.length === 0, f1.join(" ／ "));
      const now = parseWhen("今月から走る", at(10, 0), TZ);
      ok("CN. 「今月から」の始まりは、過ぎた月初めではなく今日", !!now && now.dayKey === "2026-09-15" && now.periodFrom, now ? now.dayKey : "なし");
      // ② 時期の言い方をそのまま出す
      const per = [["今年の冬は北海道", "北海道", "2027-02-28", "（今年の冬ごろ）"], ["来月引っ越したい", "引っ越す", "2026-10-31", "（来月ごろ）"],
                   ["夏に旅行したい", "旅行する", "2027-08-31", "（夏ごろ）"], ["来年の春に引っ越したい", "引っ越す", "2027-05-31", "（来年の春ごろ）"]];
      const f2 = chk(per, (it, r) => it.title === r[1] && it.dayKey === r[2] && it.duePrecision === "week" && !it.periodFrom && describeWhen(it, TZ) === r[3]);
      ok("CN. 「今年の冬は北海道」は「今年の冬ごろ」と出す（「2/28 ごろ」では冬の話と読めない）", f2.length === 0, f2.join(" ／ "));
      // ③ 月だけ・◯か月後
      const mon = [["4月に旅行", "旅行", "2027-04-30", "week"], ["12月に引っ越す", "引っ越す", "2026-12-31", "week"],
                   ["6月までにレポートを出す", "レポートを出す", "2027-06-30", "day"], ["3か月後に試験", "試験", "2026-12-15", "week"],
                   ["春ごろ引っ越す", "引っ越す", "2027-05-31", "week"]];
      const f3 = chk(mon, (it, r) => it.title === r[1] && it.dayKey === r[2] && it.duePrecision === r[3]);
      ok("CN. 「4月に」「12月に引っ越す」「6月までに」「3か月後に」を読む（日付を付け、見出しに残さない）", f3.length === 0, f3.join(" ／ "));
      const dl = read("6月までにレポートを出す")[0];
      ok("CN. 「6月までに」はその月末が締切（あいまいにしない）", !!dl && dl.dueIsDeadline && !dl.period, dl ? show([dl]) : "なし");
      const neg = ["4月は忙しい", "3か月かかる"].map(t => { const its = read(t); return its.some(i => i.dayKey) ? t + "→" + show(its) : null; }).filter(Boolean);
      const keepD = [["12月25日にパーティー", "2026-12-25"], ["来月末までに書類を出す", "2026-10-31"]].map(([t, dk]) => { const i = read(t)[0]; return i && i.dayKey === dk && !i.period ? null : t + "→" + (i ? show([i]) : "なし"); }).filter(Boolean);
      ok("CN. 拾いすぎない（「4月は忙しい」「3か月かかる」）・日付を言ったものは日付のまま", neg.length === 0 && keepD.length === 0, neg.concat(keepD).join(" ／ "));
      // 画面：時期の言い方と「時期があいまい」の印
      const it0 = read("春から新しい仕事")[0];
      const h0 = it0 ? itemHTML(it0) : "";
      ok("CN. 一覧の行に「春から」と「時期があいまい」が出る（「期限があいまい」と言わない）", /春から/.test(h0) && /時期があいまい/.test(h0) && !/期限があいまい/.test(h0), h0.replace(/\s+/g, " ").slice(0, 160));
      const it1 = read("来月引っ越したい")[0];
      ok("CN. 日付を直したら、時期の言い方ではなく日付を出す", !!it1 && (() => { const x = Object.assign({}, it1, { duePrecision: "day" }); return !periodText(x) && periodText(it1) === "来月ごろ"; })(), it1 ? periodText(it1) : "なし");
      reset();
      { const note = mkNote("来月から新しい仕事"); await putNote(note); await applyOps(ruleOps(note), note);
        const it = state.items.find(i => i.noteId === note.id);
        if (it) await act("defer", it.id, null);
        ok("CN. 「明日へ」で日を動かしたら、「来月から」とは出さない", !!it && !it.period && !periodText(it) && it.dayKey === "2026-10-02", it ? show([it]) : "なし"); }
      // AIの道も同じに読む（時期しか言っていないとき）
      reset();
      { const note = mkNote("春から新しい仕事"); await putNote(note);
        await applyOps([{ op: "add", kind: "event", title: "新しい仕事", dueDate: "2027-05-31", dueTime: null, duePrecision: "day", quote: "春から新しい仕事" }], note);
        const it = state.items.find(i => i.noteId === note.id);
        ok("CN. AIが「5/31 の予定」と返しても、ルールと同じく「春から」の用事にそろえる", !!it && it.kind === "task" && it.dayKey === "2027-03-01" && it.periodFrom && !it.dueIsDeadline && it.period === "春から", it ? show([it]) : "なし");
        const cx = contextForAI(note), row = (cx.open || []).find(b => b.内容 === "新しい仕事");
        ok("CN. AIに渡す一覧でも、締切ではなく「始まる時期」と書く", !!row && /春から/.test(row.始まる時期 || "") && !row.期限, JSON.stringify(row)); }
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== CO. ふだんの言い方80文で見つけた読み違い（2026-09-27・本人の指示「ほかにも読めてないものがないか探して直して」） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const at = (h, m) => zoned(2026, 9, 15, h, m, TZ).toISOString();     // 火曜 10:00
      const mkNote = (text, h = 10) => ({ id: uid(), text, hash: "co" + text + h + Math.random(), capturedAt: at(h, 0), source: "talk", sourceName: null, createdAt: at(h, 0) });
      const read = text => { reset(); return ruleOps(mkNote(text)).filter(o => o.op === "add" && o._built).map(o => o._built); };
      const hm = iso => hhmm(minOfDay(iso, TZ));
      const show = its => its.map(i => i.kind + "「" + i.title + "」" + (i.dayKey || "") + (i.spanEndKey ? "〜" + i.spanEndKey : "") + "/" + (i.duePrecision || "") + (i.start && !i.timeUnknown && !i.allDay ? " " + hm(i.start) : "")).join(" ｜ ");
      const one = (rows, f) => rows.map(r => { const its = read(r[0]); return its.length === 1 && f(its[0], r) ? null : r[0] + "→" + (show(its) || "なし"); }).filter(Boolean);
      // ① 時期・日付の言葉
      const when = [["週明けに企画書を出す", "企画書を出す", "2026-09-21", "（週明けごろ）"], ["月初めに家賃を払う", "家賃を払う", "2026-10-05", "（月初めごろ）"],
                    ["年末に大掃除", "大掃除", "2026-12-31", "（年末ごろ）"], ["年明けに初詣", "初詣", "2027-01-10", "（年明けごろ）"],
                    ["ゴールデンウィークに旅行", "旅行", "2027-05-06", "（ゴールデンウィークごろ）"], ["お盆に帰省する", "帰省する", "2027-08-16", "（お盆ごろ）"]];
      const f1 = one(when, (it, r) => it.title === r[1] && it.dayKey === r[2] && describeWhen(it, TZ) === r[3]);
      ok("CO. 「週明け」「月初め」「年末」「年明け」「ゴールデンウィーク」「お盆」を時期として読む", f1.length === 0, f1.join(" ／ "));
      const rel = [["3日後に締め切り", "締め切り", "2026-09-18"], ["1週間後に結果発表", "結果発表", "2026-09-22"], ["2週間後に試験", "試験", "2026-09-29"],
                   ["12/24にクリスマスパーティー", "クリスマスパーティー", "2026-12-24"], ["8月15日に帰省", "帰省", "2027-08-15"],
                   ["今夜中にメールを返す", "メールを返す", "2026-09-15"], ["今日のうちに資料をまとめる", "資料をまとめる", "2026-09-15"]];
      const f2 = one(rel, (it, r) => it.title === r[1] && it.dayKey === r[2]);
      ok("CO. 「3日後」「1週間後」「12/24」「今夜中に」「今日のうちに」を読む・2週間より前に過ぎた日付は来年", f2.length === 0, f2.join(" ／ "));
      const ban = read("今晩8時に電話する")[0];
      ok("CO. 「今晩8時に」は今日の20時（見出しに「今」を残さない）", !!ban && ban.title === "電話する" && ban.dayKey === "2026-09-15" && hm(ban.due) === "20:00", ban ? show([ban]) : "なし");
      const dd = read("今週の金曜までにレポート")[0];
      ok("CO. 「金曜までにレポート」は締切のある用事（予定にしない）", !!dd && dd.kind === "task" && dd.dueIsDeadline && dd.dayKey === "2026-09-18", dd ? show([dd]) : "なし");
      const ws = read("土日は実家に帰る")[0];
      ok("CO. 「土日は実家に帰る」は土曜から日曜まで続く予定", !!ws && ws.kind === "event" && ws.allDay && ws.dayKey === "2026-09-19" && ws.spanEndKey === "2026-09-20" && ws.title === "実家に帰る", ws ? show([ws]) : "なし");
      // ② 「あと◯時間で」
      const soon = read("あと2時間で出発")[0];
      ok("CO. 「あと2時間で出発」は2時間後の予定（2時間を長さにしない・言い直しと聞き返さない）", !!soon && soon.kind === "event" && hm(soon.start) === "12:00" && soon.title === "出発"
         && !ruleOps(mkNote("あと2時間で出発")).some(o => o.op === "_needs_ai"), soon ? show([soon]) : "なし");
      ok("CO. 「あと1時間で終わる」は残り時間であって、いつかの話ではない", !relTime("レポート、あと1時間で終わる") && !!relTime("あと30分で着く") && RE_PROGRESS.test("レポート、あと1時間で終わる"), "");
      // ③ 言い直し
      const rs = read("明日の会議、10時じゃなくて11時だった")[0];
      ok("CO. 「10時じゃなくて11時」は11時（見出しに「じゃなくて」を残さない）", !!rs && rs.title === "会議" && hm(rs.start) === "11:00" && rs.dayKey === "2026-09-16", rs ? show([rs]) : "なし");
      const ch = read("打ち合わせを14時に変更")[0];
      ok("CO. 「打ち合わせを14時に変更」の見出しは「打ち合わせ」", !!ch && ch.title === "打ち合わせ", ch ? show([ch]) : "なし");
      // ④ 食事の名前
      const meals = [["お昼休みに銀行に行く", i => i.title === "お昼休みに銀行に行く" && !i.isMeal], ["金曜の夜は友達とご飯", i => i.title === "夕食を食べる"],
                     ["日曜の昼にランチ", i => i.title === "昼食を食べる"]];
      const f4 = one(meals, (it, r) => r[1](it));
      ok("CO. 「お昼休み」は食事ではない・「夜は友達とご飯」は夕食（話した時刻で決めない）", f4.length === 0, f4.join(" ／ "));
      const nine = mealTitle("19時にご飯を食べる", at(10, 0), TZ);
      ok("CO. 「19時にご飯」は言った時刻で夕食", nine === "夕食を食べる", nine);
      // ⑤ 名詞だけの用事・いつか・続けたいこと・体調・その日のあり方
      const kinds = [["パスポートの更新", "task"], ["車検", "task"], ["ゴミ出し", "task"], ["暇なときに部屋の模様替え", "idea"],
                     ["平日の朝はジョギング", "goal"], ["昨日あんまり寝れなかった", "condition"], ["明日は一日中家にいる", "event"],
                     ["来週のどこかで髪を切りたい", "task"], ["もうすぐ会議", "task"]];
      const f5 = kinds.map(([t, k]) => { reset(); const ops = ruleOps(mkNote(t)); const got = ops.filter(o => o.op === "add").map(o => o._built.kind).concat(ops.filter(o => o.op === "condition").map(() => "condition"));
        return got.length === 1 && got[0] === k ? null : t + "→" + got.join(",") || "なし"; }).filter(Boolean);
      ok("CO. 「車検」「ゴミ出し」は用事・「暇なときに」は気になっていること・「平日の朝は」は続けたいこと・「寝れなかった」は体調・「一日中家にいる」は終日", f5.length === 0, f5.join(" ／ "));
      const home = read("明日は一日中家にいる")[0], mo = read("もうすぐ会議")[0];
      ok("CO. 見出しに「もうすぐ」を残さない・「家にいる」は終日の予定", !!home && home.allDay && !!mo && mo.title === "会議", show([home, mo].filter(Boolean)));
      // ⑥ 曜日を続けて書く
      const mwf = read("来週の月水金に英会話");
      ok("CO. 「来週の月水金に英会話」は月・水・金の3件", mwf.length === 3 && mwf.every(i => i.title === "英会話") && mwf.map(i => i.dayKey).sort().join() === "2026-09-21,2026-09-23,2026-09-25", show(mwf));
      const noSplit = ["今月水曜に歯医者", "土日にジム"].map(t => { const its = read(t); return its.length === 1 ? null : t + "→" + show(its); }).filter(Boolean);
      ok("CO. 「今月水曜」「土日」は分けない", noSplit.length === 0, noSplit.join(" ／ "));
      // ⑦ 済んだ報告（開いている用事と照合できたときだけ）
      reset();
      { const n1 = mkNote("牛乳を買う"); await putNote(n1); await applyOps(ruleOps(n1), n1);
        const n2 = mkNote("牛乳買った", 11); await putNote(n2); const ops = ruleOps(n2);
        const it = state.items.find(i => i.title === "牛乳を買う");
        ok("CO. 「牛乳買った」で「牛乳を買う」が完了になる", !!it && ops.some(o => o.op === "done" && o.id === it.id), JSON.stringify(ops.map(o => o.op)));
        const o3 = ruleOps(mkNote("昨日映画を見た", 12));
        ok("CO. 照合できない過去の話（「映画を見た」）で、どれが終わったのかと聞き返さない", !o3.some(o => o.op === "_ambiguous_done"), JSON.stringify(o3.map(o => o.op))); }
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== CP. まだ読めていなかった言い方の処理（2026-09-27・本人の指示「まだ読めてないものの処理方法を模索して」・決まり0l） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const at = (h, m) => zoned(2026, 9, 15, h, m, TZ).toISOString();     // 火曜 10:00
      const mkNote = (text, h = 10) => ({ id: uid(), text, hash: "cp" + text + h + Math.random(), capturedAt: at(h, 0), source: "talk", sourceName: null, createdAt: at(h, 0) });
      const read = (text, h = 10) => { reset(); return ruleOps(mkNote(text, h)).filter(o => o.op === "add" && o._built).map(o => o._built); };
      const hm = iso => hhmm(minOfDay(iso, TZ));
      const show = its => its.map(i => i.kind + "「" + i.title + "」" + (i.dayKey || "") + "/" + (i.duePrecision || "") + (i.dueIsDeadline ? "まで" : "") + (i.duePrecision === "exact" && i.due ? " " + hm(i.due) : "") + (i.due && i.kind === "goal" ? " 期限" : "")).join(" ｜ ");
      const one = (rows, f, h) => rows.map(r => { const its = read(r[0], h); return its.length === 1 && f(its[0], r) ? null : r[0] + "→" + (show(its) || "なし"); }).filter(Boolean);
      // ① 暦から出せる日
      const hol = jpHolidays(2026);
      ok("CP. 祝日を暦から出す（秋分・振替休日・国民の休日）",
         hol.has("2026-09-23") && hol.has("2026-09-21") && hol.has("2026-09-22") && hol.has("2026-05-06") && !hol.has("2026-09-24") && namedDay("春分の日", 2027) === "2027-03-21",
         [...hol].sort().join(","));
      const named = [["母の日にカーネーションを贈る", "2027-05-09"], ["父の日にプレゼントを買う", "2027-06-20"], ["敬老の日に祖母に電話する", "2026-09-21"],
                     ["クリスマスにケーキを予約する", "2026-12-25"], ["大晦日に大掃除する", "2026-12-31"], ["子供の日に鯉のぼりを出す", "2027-05-05"],
                     ["クリスマスの夜は友達と食事", "2026-12-25"]];
      const f1 = one(named, (it, r) => it.dayKey === r[1] && it.duePrecision === "day" && !it.dueIsDeadline);
      ok("CP. 「母の日に」「敬老の日に」「クリスマスに」をこれから来るその日として読む（締切にしない）", f1.length === 0, f1.join(" ／ "));
      const keepT = read("母の日にカーネーションを贈る")[0];
      ok("CP. 名前の日は見出しから落とさない（何のための用事かを言っている）", !!keepT && keepT.title === "母の日にカーネーションを贈る", keepT ? keepT.title : "なし");
      const dl = [["母の日のプレゼントを買う", "2027-05-09"], ["クリスマスまでに部屋を片付ける", "2026-12-25"], ["クリスマス前に大掃除する", "2026-12-24"]];
      const f2 = one(dl, (it, r) => it.dayKey === r[1] && it.dueIsDeadline);
      ok("CP. 「〜の準備・プレゼント」「〜までに」はその日まで、「〜前に」は前日までの締切", f2.length === 0, f2.join(" ／ "));
      const noNamed = ["クリスマスケーキを予約する", "上海の日本料理店に行く", "元日本代表の講演を聞く", "七夕祭りに行く", "誕生日プレゼントを考える", "仙台七夕に行く"]
        .map(t => { const its = read(t); return its.some(i => i.dayKey) ? t + "→" + show(its) : null; }).filter(Boolean);
      ok("CP. 名前の一部に見えるだけの語（クリスマスケーキ・元日本代表・仙台七夕＝8月）は日付にしない", noNamed.length === 0, noNamed.join(" ／ "));
      const eve = read("クリスマスイブは友達とディナー");
      ok("CP. 動詞の無い「クリスマスイブは友達とディナー」も、その日の予定として受ける", eve.length === 1 && eve[0].kind === "event" && eve[0].dayKey === "2026-12-24", show(eve));
      // ② 連休
      const lw = read("連休中に部屋を片付けたい")[0];
      ok("CP. 「連休中に」＝次の3日以上続く休み（9/19〜23）までのあいまいな期限", !!lw && lw.dayKey === "2026-09-23" && lw.duePrecision === "week" && lw.period === "連休中" && lw.title === "部屋を片付ける", lw ? show([lw]) + " " + lw.period : "なし");
      { const w = parseWhen("次の連休は旅行に行く", zoned(2026, 9, 20, 10, 0, TZ).toISOString(), TZ);
        const w2 = parseWhen("連休中に本を読む", zoned(2026, 9, 20, 10, 0, TZ).toISOString(), TZ);
        ok("CP. 連休の途中なら「連休中」はいまの連休、「次の連休」はその次（10/10〜12）", !!w && w.dayKey === "2026-10-12" && !!w2 && w2.dayKey === "2026-09-23", (w && w.dayKey) + " / " + (w2 && w2.dayKey)); }
      // ③ 入っている予定から借りる
      const seq = async (texts, h = 10) => { reset(); const out = [];
        for (const t of texts) { const n = mkNote(t, h); await putNote(n); const before = new Set(state.items.map(i => i.id)); await applyOps(ruleOps(n), n); out.push(state.items.filter(i => !before.has(i.id))); }
        return out; };
      { const r = await seq(["10月3日は母の誕生日", "誕生日にケーキを買う", "母の誕生日にプレゼントを渡す", "父の誕生日にネクタイを贈る"]);
        const [, a, b, c] = r.map(x => x[0]);
        ok("CP. 「誕生日に」は入っている予定（母の誕生日）の日を借りる。見出しは言葉のまま", !!a && a.dayKey === "2026-10-03" && a.title === "誕生日にケーキを買う" && !!b && b.dayKey === "2026-10-03", show([a, b].filter(Boolean)));
        ok("CP. 「父の誕生日に」は「母の誕生日」を借りない（日付なしのまま）", !!c && !c.dayKey, c ? show([c]) : "なし"); }
      { const r = await seq(["来週の金曜から旅行", "旅行の前に荷物をまとめる", "旅行の前日に洗濯する"]);
        const a = r[1][0], b = r[2][0];
        ok("CP. 「旅行の前に」は前日までの締切、「旅行の前日に」は前日（さっき借りた用事からまた借りない）",
           !!a && a.dayKey === "2026-09-24" && a.dueIsDeadline && !!b && b.dayKey === "2026-09-24" && !b.dueIsDeadline, show([a, b].filter(Boolean))); }
      { const r = await seq(["明日10時から会議", "会議までに資料を作る"]);
        const a = r[1][0];
        ok("CP. 「会議までに」は会議の始まり（10:00）までの締切の用事（会議の予定を作らない）", !!a && a.kind === "task" && a.dueIsDeadline && a.duePrecision === "exact" && hm(a.due) === "10:00" && a.dayKey === "2026-09-16", a ? show([a]) : "なし"); }
      { const r = await seq(["今日は結婚式", "結婚式の前日に美容院に行く"]);
        const a = r[1][0];
        ok("CP. 借りた日が過ぎた日（今日の予定の前日）なら借りない", !!a && !(a.dayKey && a.dayKey < "2026-09-15"), a ? show([a]) : "なし"); }
      { const r = await seq(["誕生日にケーキを買う"]);
        ok("CP. 借りる予定が無ければ、今までどおり日付なし", !!r[0][0] && !r[0][0].dayKey, show(r[0])); }
      // ④ 帰りに・寝る前に・起きたら
      const rt = [["帰りに牛乳を買う", "2026-09-15", "帰りに牛乳を買う"], ["寝る前にストレッチする", "2026-09-15", "寝る前にストレッチする"],
                  ["起きたら洗濯する", "2026-09-16", "起きたら洗濯する"], ["仕事終わりにジムに行く", "2026-09-15", "仕事終わりにジムに行く"]];
      const f3 = one(rt, (it, r) => it.kind === "task" && it.dayKey === r[1] && it.title === r[2] && it.duePrecision === "day");
      ok("CP. 「帰りに」「寝る前に」「仕事終わりに」は今日、「起きたら」は次に起きたとき（見出しは言葉のまま・用事）", f3.length === 0, f3.join(" ／ "));
      const early = read("起きたら洗濯する", 3)[0];
      ok("CP. 夜中の3時の「起きたら」は、その朝（今日）", !!early && early.dayKey === "2026-09-15", early ? show([early]) : "なし");
      // ⑤ 夕方に・午後に
      const wd = [["夕方に歯医者", "2026-09-15", "evening"], ["午後に銀行に行く", "2026-09-15", "afternoon"], ["朝にランニングする", "2026-09-15", "morning"]];
      const f4 = one(wd, (it, r) => it.kind === "task" && it.dayKey === r[1] && it.preferWindow === r[2]);
      ok("CP. 「夕方に」「午後に」は今日のその時間帯の用事（時刻未定の予定にしない）", f4.length === 0, f4.join(" ／ "));
      const late = read("夕方に歯医者", 20)[0], lateAM = read("午前中に資料を作る", 14)[0];
      ok("CP. その時間帯がもう過ぎていれば明日", !!late && late.dayKey === "2026-09-16" && !!lateAM && lateAM.dayKey === "2026-09-16", show([late, lateAM].filter(Boolean)));
      // ⑥ 拾いすぎない
      const noDate = ["毎日寝る前にストレッチする", "毎週寝る前に日記を書く", "毎朝ランニングする", "朝ごはんを作る"].map(t => { const its = read(t); return its.some(i => i.dayKey && i.dayKey !== "2026-09-15" || (/毎/.test(t) && i.dayKey)) ? t + "→" + show(its) : null; }).filter(Boolean);
      ok("CP. くり返しの話（毎日・毎週・毎朝）には今日の日付を付けない", noDate.length === 0, noDate.join(" ／ "));
      const g = read("寝る前に読書する習慣をつけたい")[0];
      ok("CP. 続けたいこと（寝る前に読書する習慣）に今日の期限を付けない", !!g && g.kind === "goal" && !g.due, g ? show([g]) : "なし");
      reset();
      const pv = ruleOps(mkNote("夜は予定を入れないで")).find(o => o.op === "prefer" && o.key === "noEveningWork");
      ok("CP. 「夜は予定を入れないで」は今までどおりずっとの希望（今日だけにしない）", !!pv && !pv.scopeDay, pv ? JSON.stringify([pv.key, pv.scopeDay]) : "なし");
      { const w = parseWhen("帰りに牛乳を買う", at(10, 0), TZ);
        ok("CP. 「帰りに」は日付を言ったことにしない（AIが足した日付を引き戻す基準・決まり7d）", !!w && w.timeOnly && !dateSpokenIn(w), JSON.stringify(w && { t: w.timeOnly })); }
      const sg = read("来年のクリスマスは海外で過ごしたい")[0];
      ok("CP. 「過ごしたい」を「過ごする」にしない", !!sg && /過ごす$/.test(sg.title) && sg.dayKey === "2027-12-25", sg ? show([sg]) : "なし");
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== CQ. テスターとして見つけた読み違い（2026-09-27・本人の指示「アプリのテスターを徹底的にして」・決まり0m） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const at = (h, m) => zoned(2026, 9, 15, h, m, TZ).toISOString();     // 火曜
      const mkNote = (text, h = 10, m = 0) => ({ id: uid(), text, hash: "cq" + text + h + m + Math.random(), capturedAt: at(h, m), source: "talk", sourceName: null, createdAt: at(h, m) });
      const read = (text, h = 10) => { reset(); return ruleOps(mkNote(text, h)).filter(o => o.op === "add" && o._built).map(o => o._built); };
      const opsOf = (text, h = 10) => { reset(); return ruleOps(mkNote(text, h)); };
      const hm = iso => hhmm(minOfDay(iso, TZ));
      const show = its => its.map(i => i.kind + "「" + i.title + "」" + (i.dayKey || "") + "/" + (i.duePrecision || "") + (i.dueIsDeadline ? "まで" : "")
        + (i.start && !i.timeUnknown ? " " + hm(i.start) : i.duePrecision === "exact" && i.due ? " " + hm(i.due) : "")).join(" ｜ ");
      const seq = async (pairs) => { reset(); const out = [];
        for (const [t, h, m] of pairs) { const n = mkNote(t, h, m || 0); await putNote(n); const before = new Set(state.items.map(i => i.id));
          const ops = ruleOps(n); const r = await applyOps(ops, n); out.push({ ops, r, added: state.items.filter(i => !before.has(i.id)) }); }
        return out; };
      // ① 夜中の時刻
      { const a = read("深夜1時まで作業", 22)[0], b = read("午前0時に寝る", 22)[0];
        ok("CQ. 22時の「深夜1時まで作業」は翌日1時までの締切・見出しは「作業」（「夜1時」を13時にしない）",
           !!a && a.title === "作業" && a.dayKey === "2026-09-16" && a.dueIsDeadline && hm(a.due) === "01:00", a ? show([a]) : "なし");
        ok("CQ. 22時の「午前0時に寝る」は、これから来る0時（過ぎた今日の0時にしない）", !!b && b.dayKey === "2026-09-16" && hm(b.due) === "00:00", b ? show([b]) : "なし"); }
      // ② 朝の話の続き
      { const its = read("7時に起きて8時に家を出て9時から仕事", 10); const w = its.find(i => /仕事/.test(i.title));
        ok("CQ. 「7時に起きて8時に家を出て9時から仕事」の仕事も翌朝9時（今夜21時にしない）", !!w && w.dayKey === "2026-09-16" && hm(w.start) === "09:00", show(its)); }
      // ③ 日付でないもの・読めていなかった日付
      { const a = read("テスト勉強を1日2時間する")[0], b = read("年内に大掃除を終わらせたい")[0], c = read("来年の3月に資格試験がある")[0], d = read("2月30日に提出")[0];
        ok("CQ. 「1日2時間」の「1日」は10月1日ではない（見出しにも残さない）", !!a && !a.dayKey && a.title === "テスト勉強をする" && a.estimateMin === 120, a ? show([a]) : "なし");
        ok("CQ. 「年内に」は今年の暮れまで", !!b && b.dayKey === "2026-12-31" && b.duePrecision === "week", b ? show([b]) : "なし");
        ok("CQ. 「来年の3月に」は見出しに「来年の」を残さず、「来年の3月ごろ」と出す", !!c && c.title === "資格試験" && c.dayKey === "2027-03-31" && c.period === "来年の3月ごろ", c ? show([c]) + " " + c.period : "なし");
        ok("CQ. 「2月30日」は3月2日ではなく2月の末日", !!d && d.dayKey === "2027-02-28", d ? show([d]) : "なし"); }
      // ④ 用事にしないもの
      { const o1 = opsOf("午前中は集中したいから会議を入れないで");
        ok("CQ. 「〜を入れないで」は用事ではなく「こうしてほしい」に残す", !o1.some(o => o.op === "add") && o1.some(o => o.op === "prefer" && o.key === "free"), JSON.stringify(o1.map(o => o.op + ":" + (o.key || o.kind || ""))));
        const none = ["今日はいい天気", "打ち合わせは30分で終わる", "今日起きたのが8時"].map(t => { const its = read(t); return its.length ? t + "→" + show(its) : null; }).filter(Boolean);
        ok("CQ. 天気・長さの話・済んだ話を予定にしない", none.length === 0, none.join(" ／ "));
        const o2 = opsOf("冷蔵庫に卵と豆腐がある");
        ok("CQ. 冷蔵庫の話はメモだけ（用事を一緒に作らない）", !o2.some(o => o.op === "add") && o2.some(o => o.op === "memo"), JSON.stringify(o2.map(o => o.op))); }
      // ⑤ 種類
      { const conds = ["なんか頭がぼーっとする", "熱が38度ある"].map(t => { const o = opsOf(t); return o.some(x => x.op === "condition") && !o.some(x => x.op === "add") ? null : t + "→" + JSON.stringify(o.map(x => x.op)); }).filter(Boolean);
        ok("CQ. 「頭がぼーっとする」「熱が38度ある」は体調（用事にしない）", conds.length === 0, conds.join(" ／ "));
        const kinds = [["3ヶ月で5キロ痩せたい", "goal"], ["スマホの機種変更をしたい", "task"],
                       ["急ぎじゃないけど本棚を組み立てる", "task"], ["2限の授業のレポートを金曜までに出す", "task"], ["17時締めの報告書", "task"], ["子どもの迎えが16時", "event"]]
          .map(([t, k]) => { const its = read(t); return its.length === 1 && its[0].kind === k ? null : t + "→" + (show(its) || "なし"); }).filter(Boolean);
        ok("CQ. 体調・続けたいこと・「〜をしたい」・「組み立てる」・締切の話・時刻つきの名詞を、それぞれの種類で読む", kinds.length === 0, kinds.join(" ／ "));
        const r = read("17時締めの報告書")[0], k = read("子どもの迎えが16時")[0], b = read("急ぎじゃないけど本棚を組み立てる")[0];
        ok("CQ. 「17時締め」は17時の締切・見出しは「報告書」", !!r && r.title === "報告書" && r.dueIsDeadline && hm(r.due) === "17:00", r ? show([r]) : "なし");
        ok("CQ. 「子どもの迎えが16時」は16時の予定「子どもの迎え」", !!k && k.title === "子どもの迎え" && hm(k.start) === "16:00", k ? show([k]) : "なし");
        ok("CQ. 「急ぎじゃないけど」は見出しに残さず、今日の期限にもしない", !!b && b.title === "本棚を組み立てる" && !b.dayKey, b ? show([b]) : "なし"); }
      // ⑥ 1行に話が2つ・3つ
      { const a = read("明日の10時と14時に面接"), b = read("明日10時から12時まで会議。明後日14時から歯医者。来週の月曜に面接。");
        ok("CQ. 「10時と14時に面接」は2件", a.length === 2 && a.map(i => hm(i.start)).join() === "10:00,14:00", show(a));
        ok("CQ. 句点で3つの予定を言えば3件（3つ目を黙って捨てない）", b.length === 3 && b.some(i => /面接/.test(i.title) && i.dayKey === "2026-09-21"), show(b));
        const c = read("資料を作らないと。明日までに相手に送るやつ。");
        ok("CQ. 続きの言い足し（「明日までに相手に送るやつ」）は分けず、締切を明日のまま持つ", c.length === 1 && c[0].dayKey === "2026-09-16", show(c)); }
      // ⑦ 見出し
      { const titles = [["電気代を払い忘れてた、今日中に払う", "電気代を払う"], ["病院の予約、木曜の11時に取れた", "病院"], ["美容院は来月でいいや", "美容院"],
                        ["お母さんに電話するの忘れないようにしておいて", "お母さんに電話する"], ["あ、そういえば傘を返さなきゃ", "傘を返す"], ["夫の誕生日が来週の火曜", "夫の誕生日"],
                        ["明日の朝ゴミ出し", "ゴミ出し"], ["明日の朝イチで先生にメールする", "先生にメールする"], ["明後日の夜は友達と焼肉", "友達と焼肉"],
                        ["明日は6時起き", "起きる"], ["今日の会議、15時から16時に変わった", "会議"], ["明日の夜景を見に行く", "夜景を見に行く"]]
          .map(([t, want]) => { const its = read(t); return its.length === 1 && its[0].title === want ? null : t + "→" + (show(its) || "なし"); }).filter(Boolean);
        ok("CQ. 見出しに言い方の付け足し（忘れてた・取れた・でいいや・そういえば・が・朝・変わった）を残さない", titles.length === 0, titles.join(" ／ "));
        const w = read("明日は6時起き")[0];
        ok("CQ. 「6時起き」は朝6時で、18時かと聞き返さない", !!w && hm(w.start || w.due) === "06:00" && !w.whenAlt, w ? show([w]) : "なし"); }
      // ⑧ 言い直し・取り消し・進み具合を、ルールでも反映する（決まり7）
      { let r = await seq([["14時から会議", 9], ["会議、15時からに変更", 10]]);
        let ev = state.items.filter(i => i.kind === "event" && i.status === "open");
        ok("CQ. 「会議、15時からに変更」は同じ予定を15時に動かす（新しく作らない）", ev.length === 1 && hm(ev[0].start) === "15:00", show(ev));
        r = await seq([["英語の勉強をする", 9], ["英語の勉強、明日にする", 20]]);
        let tk = state.items.filter(i => i.kind === "task");
        ok("CQ. 「英語の勉強、明日にする」は同じ用事を明日へ（締切にしない・二重にしない）", tk.length === 1 && tk[0].dayKey === "2026-09-16" && !tk[0].dueIsDeadline, show(tk));
        r = await seq([["明日10時に面接", 9], ["面接の時間、11時だった", 10]]);
        ev = state.items.filter(i => i.kind === "event");
        ok("CQ. 「面接の時間、11時だった」は明日の面接を11時に（今日に別の予定を作らない）", ev.length === 1 && ev[0].dayKey === "2026-09-16" && hm(ev[0].start) === "11:00", show(ev));
        r = await seq([["来週の火曜に打ち合わせ", 9], ["来週の火曜の打ち合わせ、水曜に変更になった", 10]]);
        ev = state.items.filter(i => i.kind === "event");
        ok("CQ. 「火曜の打ち合わせ、水曜に変更になった」は同じ週の水曜へ", ev.length === 1 && ev[0].dayKey === "2026-09-23", show(ev));
        r = await seq([["10時から歯医者", 8], ["歯医者キャンセルになった", 9]]);
        ok("CQ. 「歯医者キャンセルになった」は当たる予定を取り消す", state.items.some(i => i.kind === "event" && i.status === "dropped"), show(state.items));
        r = await seq([["明日の飲み会", 9], ["明日の飲み会は行かないことにした", 10]]);
        ok("CQ. 「行かないことにした」も取り消し（何も記録されないまま、にしない）", state.items.some(i => i.kind === "event" && i.status === "dropped") && state.items.some(i => i.kind === "memo"), show(state.items));
        r = await seq([["部屋の片付けをする", 9], ["片付け半分終わった", 12]]);
        ok("CQ. 「半分終わった」は完了にしない", state.items.some(i => i.kind === "task" && i.status === "open"), show(state.items));
        r = await seq([["明日レポートを書く", 9], ["レポート、あと1時間で終わりそう", 20]]);
        ok("CQ. 進み具合を反映できたら「反映できません」と言わない", r[1].ops.some(o => o.op === "progress") && !r[1].ops.some(o => o.op === "_needs_ai"), JSON.stringify(r[1].ops.map(o => o.op)));
        r = await seq([["10時から12時まで資料を作る", 8], ["資料できた", 12]]);
        ok("CQ. 時刻の範囲で入れた「資料を作る」（予定）も「資料できた」で完了", state.items.some(i => i.kind === "event" && i.status === "done"), show(state.items));
        r = await seq([["毎週月曜10時からゼミ", 8], ["ゼミ終わった", 12]]);
        ok("CQ. くり返しの予定は、会話の「終わった」で丸ごと完了にしない", state.items.every(i => i.status === "open"), show(state.items)); }
      // ⑨ 質問に答える・置いた理由の文
      { reset();
        const keepAI = SAMPLEFN, keepView = view.day, keepChat = view.chatDay; SAMPLEFN = null;
        const today = dayKey(new Date(), TZ), tmr = addKey(today, 1);
        const mk = (title, k, extra) => { const it = Object.assign({ id: uid(), noteId: null, kind: k, title, status: "open", origin: "user", confirmed: true, corrected: false,
          evidence: { text: title }, createdAt: new Date().toISOString(), updatedAt: "", history: [] }, extra); it.dedupeKey = dedupeKey(it); return it; };
        await putItem(mk("歯医者", "event", { fixed: true, timeUnknown: false, dayKey: tmr, duePrecision: "exact",
          start: zoned(...tmr.split("-").map(Number), 9, 0, TZ).toISOString(), end: zoned(...tmr.split("-").map(Number), 10, 0, TZ).toISOString() }));
        await putItem(mk("牛乳を買う", "task", { dayKey: today, duePrecision: "day", due: zoned(...today.split("-").map(Number), 23, 59, TZ).toISOString(), preferWindow: "evening", estimateMin: 30 }));
        await sendTurn("明日の予定は？");
        const t1 = (state.turns[today] || []).filter(t => t.role === "assistant").pop();
        ok("CQ. 「明日の予定は？」に明日の予定表で答える（今日の用事を混ぜない）", !!t1 && /明日は/.test(t1.text) && /歯医者/.test(t1.text) && !/やることに入れているのは「牛乳/.test(t1.text), t1 ? t1.text.slice(0, 120) : "なし");
        await sendTurn("今日何するんだっけ");
        const t2 = (state.turns[today] || []).filter(t => t.role === "assistant").pop();
        ok("CQ. 「今日何するんだっけ」（〜っけ）にも答える", !!t2 && /牛乳を買う/.test(t2.text) && !/予定はそのままにしてある/.test(t2.text), t2 ? t2.text.slice(0, 120) : "なし");
        SAMPLEFN = keepAI; view.day = keepView; view.chatDay = keepChat;
        reset();
        const a = read("夕方に買い物に行く", 10)[0];
        if (a) { await putItem(a); }
        const pl = planFor("2026-09-15", { nowMin: 600 });
        const b = pl.blocks.find(x => x.item && x.item.id === (a && a.id));
        ok("CQ. 日付を言っていない「夕方に買い物」の理由に「今日と言っていました」と書かない", !!b && /今日のことだと読みました/.test(b.reason) && !/今日と言って/.test(b.reason), b ? b.reason : "置かれていない"); }
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== CR. まだ直していなかったことの対処（2026-09-27・本人の指示「まだ直してないことの対処を模索して」・決まり0n） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const at = (h, m) => zoned(2026, 9, 15, h, m, TZ).toISOString();     // 火曜
      const mkNote = (text, h = 10, m = 0) => ({ id: uid(), text, hash: "cr" + text + h + m + Math.random(), capturedAt: at(h, m), source: "talk", sourceName: null, createdAt: at(h, m) });
      const opsOf = (text, h = 10, m = 0) => { reset(); return ruleOps(mkNote(text, h, m)); };
      const read = (text, h = 10, m = 0) => opsOf(text, h, m).filter(o => o.op === "add" && o._built).map(o => o._built);
      const hm = iso => hhmm(minOfDay(iso, TZ));
      const show = its => its.map(i => i.kind + "「" + i.title + "」" + (i.dayKey || "") + (i.repeat ? "［" + repeatJa(i.repeat) + "］" : "")
        + (i.start && !i.timeUnknown ? " " + hm(i.start) + (i.end ? "-" + hm(i.end) : "") : i.duePrecision === "exact" && i.due ? " " + hm(i.due) : "") + (i.dueIsDeadline ? "まで" : "")).join(" ｜ ");
      // ① 1限
      { const a = read("明日は1限から");
        ok("CR. 「明日は1限から」は明日の時刻未定の予定（何も記録されないまま、にしない）", a.length === 1 && a[0].kind === "event" && a[0].dayKey === "2026-09-16" && a[0].timeUnknown && /1限/.test(a[0].title), show(a)); }
      // ② 毎週決まっている日
      { const a = read("ゴミの日は火曜と金曜"), b = read("来週の燃えるゴミの日は火曜"), c = read("ジムの定休日は水曜");
        ok("CR. 「ゴミの日は火曜と金曜」は毎週火曜・毎週金曜", a.length === 2 && a.every(i => i.repeat && i.repeat.kind === "weekly") && a.map(i => i.repeat.dow).join() === "2,5", show(a));
        ok("CR. 週を言った「来週の燃えるゴミの日は火曜」は1回きり・来週の火曜（離れた「来週」と「火曜」を一緒に読む）", b.length === 1 && !b[0].repeat && b[0].dayKey === "2026-09-22" && b[0].title === "燃えるゴミの日", show(b));
        ok("CR. 「定休日は水曜」も毎週", c.length === 1 && c[0].repeat && c[0].repeat.dow === 3, show(c)); }
      // ③ 今から
      { const a = read("今からお風呂", 10, 3), b = read("今から10時まで勉強", 8), c = read("今から6時まで勉強", 13), d = read("今から朝ごはん食べる", 8);
        ok("CR. 「今からお風呂」は、いま（5分刻み）から始まる予定", a.length === 1 && a[0].kind === "event" && a[0].title === "お風呂" && hm(a[0].start) === "10:05", show(a));
        ok("CR. 「今から10時まで勉強」は、いまから10時までの予定（10時までの締切にしない）", b.length === 1 && b[0].kind === "event" && hm(b[0].start) === "08:00" && hm(b[0].end) === "10:00" && !b[0].dueIsDeadline, show(b));
        ok("CR. 13時の「今から6時まで」は18時まで・聞き返さない", c.length === 1 && hm(c[0].end) === "18:00" && !c[0].whenAlt, show(c));
        ok("CR. 「今から朝ごはん食べる」は今までどおり食事の用事", d.length === 1 && d[0].kind === "task" && d[0].title === "朝食を食べる", show(d));
        const e = opsOf("今から6時までの予定を組み立てて", 13);
        ok("CR. 「今から◯時までの予定を組み立てて」は今までどおり組み立て（決まり4m）", e.some(o => o.op === "buildday"), JSON.stringify(e.map(o => o.op))); }
      // ④ 朝型・夜型
      { const a = read("朝型の人間だと思う"), b = read("夜型なんです");
        ok("CR. 「朝型の人間だと思う」「夜型なんです」はわたしのこと（見出しは「朝型の人間」「夜型」）",
           a.length === 1 && a[0].kind === "profile" && a[0].title === "朝型の人間" && b.length === 1 && b[0].kind === "profile" && b[0].title === "夜型", show(a.concat(b))); }
      // ⑤ あり得ない時刻・25時
      { const o = opsOf("10時60分に集合"), it = (o.find(x => x.op === "add") || {})._built;
        ok("CR. 「10時60分」は所要60分にせず、読めなかったと言う", !!it && it.estimateMin == null && o.some(x => x.op === "_bad_clock"), JSON.stringify(o.map(x => x.op)) + " " + (it ? show([it]) + " " + it.estimateMin : ""));
        const r = await applyOps(o, mkNote("10時60分に集合"));
        ok("CR. 読めなかった時刻を、返事でそのまま名指しする", r.asks.some(x => /「10時60分」は時刻として読めなかった/.test(x)), r.asks.join(" / "));
        const a = read("25時に寝る", 22)[0], b = read("26時まで作業", 22)[0];
        ok("CR. 22時の「25時に寝る」は今夜の1時（翌日1:00）・聞き返さない", !!a && a.dayKey === "2026-09-16" && hm(a.due) === "01:00" && !a.whenAlt, a ? show([a]) : "なし");
        ok("CR. 「26時まで作業」は翌日2時までの締切", !!b && b.dayKey === "2026-09-16" && hm(b.due) === "02:00" && b.dueIsDeadline, b ? show([b]) : "なし");
        ok("CR. 「32時」も読めなかったと言う", opsOf("32時に寝る").some(x => x.op === "_bad_clock")); }
      // ⑥ 見出しの理由
      { const t = [["雨が降りそうだから洗濯物を取り込む", "洗濯物を取り込む"], ["時間があるから本を読む", "本を読む"], ["買ってから行く", "買ってから行く"],
                   ["10時から会議", "会議"], ["明日は早いから今日は早く寝る", "早く寝る"]]
          .map(([s, want]) => { const its = read(s); return its.some(i => i.title === want) ? null : s + "→" + (show(its) || "なし"); }).filter(Boolean);
        ok("CR. 見出しから理由（〜だから・〜ので）を落とす（「〜てから」「10時から」は残す）", t.length === 0, t.join(" ／ "));
        const e = read("明日は早いから今日は早く寝る").find(i => /寝る/.test(i.title));
        ok("CR. 理由の中の日付（明日）より、言っていることの日付（今日）", !!e && e.dayKey === "2026-09-15", e ? show([e]) : "なし"); }
      // ⑦ 次にすることを、直前の返事と同じなら出さない
      { const mkT = (title, s) => ({ id: uid(), role: "assistant", text: "a", at: new Date().toISOString(), plan: { isToday: true, next: { t: title, s, e: s + 60 }, blocks: [] } });
        const t1 = mkT("資料を作る", 600), t2 = mkT("資料を作る", 600), t3 = mkT("買い物", 720);
        ok("CR. 直前の返事と同じ「次にすること」は、返事の下に出さない", /class="next"/.test(turnHTML(t1, null)) && !/class="next"/.test(turnHTML(t2, t1)) && /class="next"/.test(turnHTML(t3, t2)));
        const na = { block: { s: 600, e: 660, type: "flex", item: { title: "資料を作る" } } };
        const base = { changes: [], asks: [], kinds: [], plan: { pref: {}, blocks: [] }, na, isToday: true, answer: null, feelingOnly: false, raw: "x" };
        ok("CR. 同じなら「次は◯◯から」の文も言わない", /次は「資料を作る」から/.test(templateReply(Object.assign({}, base, { sameNext: false })))
           && !/次は「資料を作る」から/.test(templateReply(Object.assign({}, base, { sameNext: true }))));
        // 会話の下のカード：直前の返事が省いていたら、カードのほうで出す
        const keepNA = window.nextAction, keepTurns = state.turns, keepNotes = state.notes, keepChat = view.chatDay;
        const today = dayKey(new Date(), TZ);
        state.notes = [{ id: "n", text: "x" }]; view.chatDay = today;
        window.nextAction = () => ({ block: { s: 600, e: 660, type: "flex", item: { title: "資料を作る" }, reason: "" }, nowMin: 540 });
        state.turns = { [today]: [t1, t2] };
        const shownByCard = /class="nct"/.test(nowCardHTML());
        state.turns = { [today]: [t3, t1] };
        const hiddenByCard = !/class="nct"/.test(nowCardHTML());
        window.nextAction = keepNA; state.turns = keepTurns; state.notes = keepNotes; view.chatDay = keepChat;
        ok("CR. 直前の返事が省いたときは会話の下のカードが出し、返事が出したときはカードが省く", shownByCard && hiddenByCard, "card出す=" + shownByCard + " card省く=" + hiddenByCard); }
      // ⑧ 確かめ直して見つけた言い方（2026-09-27）：返事の文に、画面で出さない区分を書かない・くり返しを言う
      { reset(); const n = mkNote("ゴミの日は火曜と金曜"); const r = await applyOps(ruleOps(n), n);
        ok("CR. くり返しの予定を足したと言うときは「毎週火」も言う（1回きりに見せない）", r.changes.some(c => /ゴミの日（毎週火）/.test(c)) && r.changes.some(c => /ゴミの日（毎週金）/.test(c)), r.changes.join(" / "));
        reset(); const m = mkNote("15時に歯医者に行く"); await applyOps(ruleOps(m), m);
        const ans = answerQuestion("今日何するんだっけ", planFor("2026-09-15"), "2026-09-15");
        ok("CR. 「今日何する？」の答えに「固定の予定」と書かない（区分を画面に出さない・決まり15s）", /予定は「歯医者/.test(ans || "") && !/固定/.test(ans || ""), ans); }
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== CS. テスター2周目（2026-09-27・本人の指示「アプリのテスターを徹底的に幅広く多くのパターンを想定して模索して」・決まり0o） =====
       言い方300文あまり・会話の流れ・時計と暦の境目・AIの変な返事・本物の画面・持ち込むファイルを流して見つけたものの見張り。 */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const at = (h, m = 0, d = 15) => zoned(2026, 9, d, h, m, TZ).toISOString();
      const mkNote = (text, h = 10, m = 0, d = 15) => ({ id: uid(), text, hash: "cs" + text + h + m + d + Math.random(), capturedAt: at(h, m, d), source: "talk", sourceName: null, createdAt: at(h, m, d) });
      const opsOf = (text, h, m, d) => { reset(); return ruleOps(mkNote(text, h, m, d)); };
      const read = (text, h, m, d) => opsOf(text, h, m, d).filter(o => o.op === "add" && o._built).map(o => o._built);
      const hm = iso => hhmm(minOfDay(iso, TZ));
      const show = its => its.map(i => i.kind + "「" + i.title + "」" + (i.dayKey || "") + (i.repeat ? "［" + repeatJa(i.repeat) + "］" : "")
        + (i.start && !i.timeUnknown ? " " + hm(i.start) + (i.end ? "-" + hm(i.end) : "") : i.duePrecision === "exact" && i.due ? " " + hm(i.due) : "")).join(" ｜ ");
      const one = (text, h, m, d) => { const a = read(text, h, m, d); return a.length === 1 ? a[0] : null; };
      const seq = async (pairs) => { reset(); let r = null; for (const [t, h, m, d] of pairs) { const n = mkNote(t, h, m, d); await putNote(n); r = await applyOps(ruleOps(n), n); } return r; };
      // ① 漢数字・3pm（根拠は元の文を指す）
      { const a = one("三時に歯医者"), b = one("十月五日に引っ越し"), c = one("3pmにcall"), d = one("三時十分に電話する");
        ok("CS. 漢数字と3pmを時刻・日付として読む（三時・十月五日・3pm・三時十分）",
          !!a && a.title === "歯医者" && hm(a.start) === "15:00" && !!b && b.dayKey === "2026-10-05" && !!c && hm(c.start) === "15:00" && !!d && hm(d.start || d.due) === "15:10", show([a, b, c, d].filter(Boolean)));
        ok("CS. 漢数字を直して読んでも、根拠は本人の言葉のまま（位置も元の文）", !!a && a.evidence.text === "三時に歯医者" && a.evidence.start === 0 && a.evidence.end === 6, a ? JSON.stringify(a.evidence) : "なし");
        const e = read("一時的に保留する"), f = read("十分気をつけて帰る");
        ok("CS. 「一時的」「十分気をつけて」は数ではない", e.every(i => !i.start && !i.due) && f.every(i => !i.start && !i.due), show(e.concat(f))); }
      // ② 日付の言い方
      { const cases = [["しあさってに歯医者", "2026-09-18"], ["明々後日に面談", "2026-09-18"], ["明朝6時に出発", "2026-09-16"], ["10月の第2月曜に健康診断", "2026-10-12"],
                       ["月末の金曜に飲み会", "2026-09-25"], ["2026/10/05に健康診断", "2026-10-05"], ["2026年10月5日に健康診断", "2026-10-05"], ["年度末までに書類を出す", "2027-03-31"]]
          .map(([t, k]) => { const x = one(t); return x && x.dayKey === k ? null : t + "→" + (x ? show([x]) : "なし"); }).filter(Boolean);
        ok("CS. しあさって・明朝・第2月曜・月末の金曜・年つきの日付・年度末を、その日として読む", cases.length === 0, cases.join(" ／ "));
        const g = read("1日おきにランニング").concat(read("1日3食食べる"), read("3日に1回洗濯"));
        ok("CS. 「1日おき」「1日3食」「3日に1回」は日付（1日・3日）ではない", g.length === 3 && g.every(i => !i.dayKey), show(g));
        const pw = t => parseWhen(t, at(10), TZ);
        ok("CS. 日付の読み取りそのものが「1日おき」「3日に1回」を日付にしない", !pw("1日おきにランニング") && !pw("3日に1回洗濯"), JSON.stringify([pw("1日おきにランニング"), pw("3日に1回洗濯")].map(w => w && w.dayKey)));
        const mc = one("明朝6時に出発", 5);
        ok("CS. 5時の「明朝6時」も明日の朝（今日の6時にしない）", !!mc && mc.dayKey === "2026-09-16", mc ? show([mc]) : "なし");
        const st = one("3時に面接が入った", 13);
        ok("CS. 「面接が入った」は決まったこと（済んだ話として捨てない・13時の「3時」は15時）", !!st && st.kind === "event" && hm(st.start) === "15:00", st ? show([st]) : "なし");
        const h = one("昨日の続きをやる");
        ok("CS. 「昨日の続きをやる」は昨日が期限ではない（言った瞬間に期限切れにしない）", !!h && !h.dayKey, h ? show([h]) : "なし"); }
      // ③ 時刻の言い方
      { const a = one("明日は9時5時で仕事"), b = one("9時から17時まで仕事"), c = one("7時15分前に家を出る", 22);
        ok("CS. 「9時5時で仕事」は9:00〜17:00（9:05にしない）・見出しは「仕事」", !!a && a.title === "仕事" && hm(a.start) === "09:00" && hm(a.end) === "17:00", a ? show([a]) : "なし");
        ok("CS. 10時の「9時から17時まで」は今日の9〜17時（21時から翌17時の20時間にしない）", !!b && b.dayKey === "2026-09-15" && hm(b.start) === "09:00" && hm(b.end) === "17:00", b ? show([b]) : "なし");
        ok("CS. 「7時15分前」は6:45・見出しに「前に」を残さない", !!c && hm(c.due || c.start) === "06:45" && c.title === "家を出る", c ? show([c]) : "なし");
        const d = one("朝7時に起きる", 23, 59);
        ok("CS. 23:59の「朝7時に起きる」は翌朝（言った瞬間に過ぎた時刻にしない）", !!d && d.dayKey === "2026-09-16" && hm(d.due || d.start) === "07:00", d ? show([d]) : "なし");
        const e = read("毎週月水金の7時にジョギング");
        ok("CS. 「毎週月水金」は曜日ごとに毎週（1件にまとめない）", e.length === 3 && e.map(i => i.repeat && i.repeat.dow).sort().join() === "1,3,5" && e.every(i => hm(i.start) === "07:00"), show(e)); }
      // ④ 夜中の「明日」
      { const n = mkNote("明日10時に会議", 0, 30, 16); reset(); const r = await applyOps(ruleOps(n), n); const it = state.items[0];
        ok("CS. 0時半の「明日10時」は寝て起きた日（暦の今日）。暦の明日を持って聞き返す",
          !!it && it.dayKey === "2026-09-16" && it.whenAlt && it.whenAlt.dayKey === "2026-09-17" && r.asks.some(x => /9\/17/.test(x)), it ? show([it]) + " " + r.asks.join("/") : "なし");
        const k = one("明日10時に会議", 4, 30, 16);
        ok("CS. 4時半を過ぎたら「明日」は暦の明日", !!k && k.dayKey === "2026-09-17" && !k.whenAlt, k ? show([k]) : "なし"); }
      // ⑤ 済んだ話・様子・決まったこと
      { const none = ["7時に起きた", "昨日歯医者行った", "会議が長引いた", "明日はバタバタ", "明後日は余裕がある", "明日の面接が不安", "10時に会議があった"]
          .map(t => { const x = read(t); return x.length ? t + "→" + show(x) : null; }).filter(Boolean);
        ok("CS. 済んだ話・その日の様子を、予定や用事にしない（7通り）", none.length === 0, none.join(" ／ "));
        const a = one("歯医者の予約を明日の10時に入れた"), b = one("来週出張することになった"), c = read("明日会議じゃなかった");
        ok("CS. 「明日の10時に予約を入れた」「出張することになった」はこれからのこと（見出しは「歯医者」「出張」——予約が取れたのは歯医者の予定・DF群とそろえた 2026-09-28）",
          !!a && a.kind === "event" && a.title === "歯医者" && hm(a.start) === "10:00" && !!b && b.title === "出張", show([a, b].filter(Boolean)));
        ok("CS. 「明日会議じゃなかった」は予定にしない", c.every(i => i.kind !== "event"), show(c));
        ok("CS. 「今日は疲れた」は今までどおり体調（済んだ言い方でも）", opsOf("今日は疲れた").some(o => o.op === "condition")); }
      // ⑥ 会話の流れ
      { await seq([["明日14時から会議", 9], ["会議は明後日になった", 9, 10]]);
        let ev = state.items.filter(i => i.kind === "event" && i.status === "open");
        ok("CS. 「会議は明後日になった」は同じ会議を明後日へ（2件にしない・時刻はそのまま）", ev.length === 1 && ev[0].dayKey === "2026-09-17" && hm(ev[0].start) === "14:00", show(ev));
        await seq([["毎週月曜10時からゼミ", 9], ["来週のゼミは休み", 11]]);
        ev = state.items.filter(i => i.kind === "event");
        ok("CS. 「来週のゼミは休み」はその回だけ外す（シリーズは残す）", ev.length === 1 && ev[0].status === "open" && (ev[0].skipDays || []).includes("2026-09-21"), show(ev) + " skip=" + (ev[0] && ev[0].skipDays));
        await seq([["夜は予定を入れないで", 9], ["夜も入れていいよ", 9, 5]]);
        ok("CS. 「夜も入れていいよ」で夜の希望を外せる（片道にしない）", !state.items.some(i => i.kind === "preference" && i.status === "open" && i.preferKey === "noEveningWork"));
        const p = opsOf("早く寝る", 20).find(o => o.op === "prefer");
        ok("CS. 「早く寝る」だけなら今夜の希望（ずっとの希望にしない）", !!p && p.scopeDay === "2026-09-15", JSON.stringify(p));
        await seq([["片付けをする", 9], ["片付け、30分くらいかかる", 9, 1]]);
        const tk = state.items.filter(i => i.kind === "task");
        ok("CS. 「片付け、30分くらいかかる」は前の用事の長さを直す（2件にしない）", tk.length === 1 && tk[0].estimateMin === 30, show(tk));
        await seq([["牛乳を買う", 9]]);
        const ans = answerQuestion("今日何するんだっけ", planFor("2026-09-15"), "2026-09-15");
        ok("CS. 「今日何する？」に日付を決めていない用事も添える", /牛乳を買う/.test(ans || ""), ans); }
      // ⑦ 敬語・関西・名詞だけ・体調・迷い・URL
      { const want = [["資料を作成いたします", "task", "資料を作成する"], ["明日の午後にお伺いします", "task", "お伺いする"], ["資料作らんと", "task", "資料作る"],
                      ["洗濯せなあかん", "task", "洗濯する"], ["明日バイトやねん", "event", "バイト"], ["母に電話", "task", "母に電話"], ["犬の散歩", "task", "犬の散歩"],
                      ["1万円おろす", "task", "1万円おろす"], ["余裕があれば英語の勉強", "idea", null], ["本日15時より会議です", "event", "会議"]]
          .map(([t, k, ttl]) => { const x = one(t); return x && x.kind === k && (!ttl || x.title === ttl) ? null : t + "→" + (x ? show([x]) : "なし"); }).filter(Boolean);
        ok("CS. 敬語・関西の言い方・名詞だけの用事・金額・「余裕があれば」を読む（10通り）", want.length === 0, want.join(" ／ "));
        ok("CS. 「眠すぎて無理」「やる気でない」は体調", ["眠すぎて無理", "やる気でない"].every(t => opsOf(t).some(o => o.op === "condition")));
        const u = one("https://example.com/very/long/url/without/any/break/points/abcdefghijklmnopqrstuvwxyz0123456789 を見る");
        ok("CS. URLの入った長い用事も捨てない", !!u && u.kind === "task", u ? show([u]) : "なし"); }
      // ⑧ 見出しの跡
      { const titles = [["正午に待ち合わせ", "待ち合わせ"], ["10時過ぎに電話する", "電話する"], ["20時以降に電話する", "電話する"], ["5日(月)に打ち合わせ", "打ち合わせ"],
                        ["来週の頭に資料を出す", "資料を出す"], ["TODO 請求書", "請求書"], ["明日10時に会議ｗ", "会議"], ["・牛乳を買う", "牛乳を買う"], ["1. 牛乳を買う", "牛乳を買う"],
                        ["明日歯医者😭", "歯医者"], ["近々引っ越す", "引っ越す"], ["明日締め切りのレポート", "レポート"], ["レポートは明日が締め切り", "レポート"], ["絶対に明日10時に病院", "病院"]]
          .map(([t, want]) => { const x = one(t); return x && x.title === want ? null : t + "→" + (x ? show([x]) : "なし"); }).filter(Boolean);
        ok("CS. 見出しに言い方の跡（正午に・過ぎに・(月)・頭に・TODO・ｗ・箇条書きの印・絵文字・近々・締め切りの・絶対に）を残さない", titles.length === 0, titles.join(" ／ ")); }
      // ⑨ AIの ops（取り込むカレンダー＝.ics は 2026-09-28 に外した）
      {
        reset(); let threw = null; const n = mkNote("明日10時に会議");
        try { await applyOps({ op: "add", kind: "task", title: "牛乳を買う" }, n); } catch (e) { threw = e.message; }
        ok("CS. AIの ops が1件の物でも落ちない", !threw && state.items.length === 1, threw || "");
        reset(); await applyOps([{ op: "add", kind: "event", title: "会議", dueDate: "9999-12-31", dueTime: "10:00" }], n);
        ok("CS. AIの日付がありえない年なら採らない", state.items.length === 1 && !/^9999/.test(state.items[0].dayKey || ""), show(state.items)); }
      // ⑪ 0o で「まだ読めていない」と書いたもの（時間帯で分ける・時刻2つ・ことにした・¥）
      { const a = read("今日は午前中に掃除、午後から買い物、夜は映画");
        ok("CS. 「午前中に掃除、午後から買い物、夜は映画」は時間帯ごとに3つ", a.length === 3 && a.map(i => i.title).join() === "掃除,買い物,映画" && a[0].preferWindow === "morning" && a[1].preferWindow === "afternoon", show(a));
        const b = read("明日は午前中に病院、午後は仕事");
        ok("CS. 分けたあとの話にも、前で言った日付が効く（明日の病院・明日の仕事）", b.length === 2 && b.every(i => i.dayKey === "2026-09-16"), show(b));
        const c = read("夜はいつも頭が痛くなる"), d = read("明日は、午前中に病院に行く");
        const c2 = read("毎日、朝に散歩する"), c3 = read("資料を作って、夜は休む");
        ok("CS. 時間帯の言葉で始まっても、前に時間帯が無ければ分けない（明日は、午前中に病院／毎日、朝に散歩／資料を作って、夜は休む）",
          c.length <= 1 && d.length === 1 && d[0].title === "病院に行く" && d[0].dayKey === "2026-09-16" && c2.length === 1 && c2[0].kind === "goal" && c3.length === 1, show(c.concat(d, c2, c3)));
        const e = read("8時と20時に薬を飲む");
        ok("CS. 「8時と20時に」は2件・8時は朝（もう一方が13時以降なら午前）", e.length === 2 && e.map(i => hm(i.due || i.start)).sort().join() === "08:00,20:00", show(e));
        const f = one("飲み会に行くことにした");
        ok("CS. 「〜に行くことにした」は決めたこと（済んだ話として捨てない）", !!f && f.title === "飲み会に行く", f ? show([f]) : "なし");
        const g = one("¥1,000払う"), h = one("立て替えた¥500を返す");
        ok("CS. 「¥1,000払う」「¥500を返す」はお金の用事", !!g && g.kind === "task" && !!h && h.kind === "task", show([g, h].filter(Boolean))); }
      // ⑩ 画面：長い英数字・大きな文字・横向き
      { const sheetRules = []; for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; } for (const r of rules) sheetRules.push(r); }
        const bodyRule = sheetRules.find(r => r.selectorText === "body" && r.style && r.style.overflowWrap);
        ok("CS. 切れ目の無い長い文字でも画面の幅を越えない（body に overflow-wrap:anywhere）", !!bodyRule && bodyRule.style.overflowWrap === "anywhere");
        const tabRule = sheetRules.find(r => r.selectorText === "nav.tabs button" && r.style);
        ok("CS. タブの名前は折り返さず、文字を大きくしても13pxで止める", !!tabRule && tabRule.style.whiteSpace === "nowrap" && /min\(/.test(tabRule.style.fontSize), tabRule ? tabRule.style.cssText.slice(0, 120) : "なし");
        const coarse = sheetRules.find(r => r.media && /pointer:\s*coarse/.test(r.media.mediaText));
        const cb = coarse && [...coarse.cssRules].find(r => r.selectorText === ".btn.sm");
        ok("CS. 指で触る画面なら横向きでも押しどころは44px", !!cb && cb.style.minHeight === "44px" && cb.style.minWidth === "44px"); }
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== CT. 用事のくり返し（2026-09-27・本人の指示「毎月25日に家賃を払う」のような、用事のくり返しを作れるようにしたい） =====
       読み取り（毎月末・毎月第2水曜・毎年・誕生日）／払い忘れた回を翌日に消さない／会話の「払った」はその回だけ／
       くり返しの日付を「明日へ」で動かさない／AIの道でもくり返しを付ける／日にちが無ければ黙らない。 */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const at = (h, m = 0, d = 15, mo = 9) => zoned(2026, mo, d, h, m, TZ).toISOString();
      const mkNote = (text, h = 10, d = 15, mo = 9) => ({ id: uid(), text, hash: "ct" + text + h + d + mo + Math.random(), capturedAt: at(h, 0, d, mo), source: "talk", sourceName: null, createdAt: at(h, 0, d, mo) });
      const read = (text) => { reset(); return ruleOps(mkNote(text)).filter(o => o.op === "add" && o._built).map(o => o._built); };
      const one = t => { const a = read(t); return a.length === 1 ? a[0] : null; };
      const rj = i => i ? i.kind + "「" + i.title + "」" + (i.dayKey || "") + "［" + repeatJa(i.repeat) + "］" : "なし";
      // ① 読み取り
      { const want = [["毎月25日に家賃を払う", "task", "家賃を払う", "毎月25日", "2026-09-25"], ["毎月末に家賃を払う", "task", "家賃を払う", "毎月末", "2026-09-30"],
                      ["毎月第2水曜に燃えないゴミ", null, "燃えないゴミ", "毎月第2水曜", "2026-10-14"], ["毎月最終金曜に飲み会", null, "飲み会", "毎月最終金曜", "2026-09-25"],
                      ["毎年10月3日は母の誕生日", null, "母の誕生日", "毎年10月3日", "2026-10-03"], ["10月3日は母の誕生日", null, "母の誕生日", "毎年", "2026-10-03"],
                      ["母の誕生日は10月3日", null, "母の誕生日", "毎年", "2026-10-03"], ["平日は毎朝7時に起きる", null, "起きる", "平日", null],
                      ["毎月31日に積立を確認する", "task", "積立を確認する", "毎月31日", "2026-09-30"], ["毎月二十五日に家賃を払う", "task", "家賃を払う", "毎月25日", "2026-09-25"]]
          .map(([t, k, ttl, rp, dk]) => { const x = one(t); return x && (!k || x.kind === k) && x.title === ttl && repeatJa(x.repeat) === rp && (!dk || x.dayKey === dk) ? null : t + "→" + rj(x); }).filter(Boolean);
        ok("CT. 毎月・毎月末・毎月第2水曜・毎月最終金曜・毎年・誕生日・平日の朝・31日の無い月・漢数字を、くり返しとして読む（10通り）", want.length === 0, want.join(" ／ "));
        const no = ["10月3日は母の誕生日会", "2027年10月3日は母の誕生日", "来月25日に家賃を払う"].map(t => [t, one(t)]).filter(([, x]) => !x || x.repeat).map(([t, x]) => t + "→" + rj(x));
        ok("CT. 誕生日会・年を言った誕生日・1回きりの日付は、くり返しにしない", no.length === 0, no.join(" ／ ")); }
      // ② くり返しの形（暦の境目）
      { const H = (r, k, dk) => repeatHits({ repeat: r, dayKey: dk || "2026-01-01" }, k, TZ);
        const cases = [[{ kind: "monthly", dom: 31 }, "2026-11-30", true], [{ kind: "monthly", dom: 31 }, "2026-11-29", false], [{ kind: "monthly", dom: -1 }, "2027-02-28", true],
                       [{ kind: "monthly", nth: 2, dow: 3 }, "2026-10-14", true], [{ kind: "monthly", nth: 2, dow: 3 }, "2026-10-07", false],
                       [{ kind: "monthly", nth: -1, dow: 5 }, "2026-10-30", true], [{ kind: "monthly", nth: -1, dow: 5 }, "2026-10-23", false],
                       [{ kind: "yearly", month: 2, dom: 29 }, "2027-02-28", true], [{ kind: "yearly", month: 2, dom: 29 }, "2028-02-28", false], [{ kind: "yearly", month: 2, dom: 29 }, "2028-02-29", true],
                       [{ kind: "yearly", month: 10, dom: 3 }, "2027-10-03", true]]
          .filter(([r, k, want]) => H(r, k) !== want).map(([r, k, want]) => repeatJa(r) + " " + k + " は " + want + " のはず");
        ok("CT. 31日の無い月は月の終わり・第2水曜・最終金曜・うるう年の2/29を、正しい日に当てる（11通り）", cases.length === 0, cases.join(" ／ ")); }
      // ③ 払い忘れた回を翌日に消さない（毎月・毎年だけ）
      { const rent = { id: "ct-rent", kind: "task", title: "家賃を払う", status: "open", repeat: { kind: "monthly", dom: 25 }, dayKey: "2026-09-25", doneDays: [] };
        const trash = { id: "ct-trash", kind: "task", title: "ゴミを出す", status: "open", repeat: { kind: "weekly", dow: 1 }, dayKey: "2026-09-21", doneDays: [] };
        ok("CT. 25日の家賃を払っていなければ、26日にも「まだの回」として残る（10/2 でも）", owedDay(rent, "2026-09-26", TZ) === "2026-09-25" && owedDay(rent, "2026-10-02", TZ) === "2026-09-25", owedDay(rent, "2026-09-26", TZ) + " / " + owedDay(rent, "2026-10-02", TZ));
        ok("CT. 払った回・始まる前は残らない。毎週のゴミは翌日へ持ち越さない", owedDay(Object.assign({}, rent, { doneDays: ["2026-09-25"] }), "2026-09-26", TZ) === null
          && owedDay(rent, "2026-09-20", TZ) === null && owedDay(trash, "2026-09-22", TZ) === null);
        ok("CT. 「払った」がどの回か：今日の回→払い忘れた回→2週間以内の次の回（先に払った）", occurFor(rent, "2026-09-25", TZ) === "2026-09-25" && occurFor(rent, "2026-10-02", TZ) === "2026-09-25"
          && occurFor(rent, "2026-09-23", TZ) === "2026-09-25" && occurFor(Object.assign({}, rent, { doneDays: ["2026-09-25"] }), "2026-10-02", TZ) === null,
          [occurFor(rent, "2026-09-25", TZ), occurFor(rent, "2026-10-02", TZ), occurFor(rent, "2026-09-23", TZ)].join()); }
      // ④ 予定表：今日は払い忘れた回を期限切れとして出す（planFor は本物の今日を見るので、今日から数える）
      { const tk = dayKey(new Date(), TZ), past = addKey(tk, -3), dom = +past.slice(8);
        reset();
        const rent = { id: uid(), noteId: "x", kind: "task", title: "家賃を払う", origin: "rule", status: "open", confirmed: false, repeat: { kind: "monthly", dom }, dayKey: past,
          due: zoned(...past.split("-").map(Number), 23, 59, TZ).toISOString(), duePrecision: "day", doneDays: [], history: [], evidence: { text: "毎月", start: 0, end: 2 } };
        state.items.push(rent);
        const found = pl => pl.blocks.concat(pl.loose || [], pl.unplaced || []).map(b => b.item || b).find(i => i && i.id === rent.id);
        const p1 = planFor(tk), f1 = found(p1);
        ok("CT. 今日の予定表に、3日前に払い忘れた家賃が「その日の回」として出る（完了を押すとその日が終わる）", !!f1 && f1.occurDay === past, f1 ? f1.occurDay : "出ていない");
        ok("CT. 残っているものの数にも入る（「今日の予定は全部です」と言わない）", leftToday(p1) >= 1);
        rent.doneDays = [past];
        ok("CT. 払ったら今日の予定表から消える", !found(planFor(tk)));
        rent.doneDays = [];
        ok("CT. 明日の予定表には持ち越さない（持ち越すのは今日だけ）", !found(planFor(addKey(tk, 1))));
        await putItem(rent); await act("done", rent.id, { dataset: { day: tk } });
        ok("CT. くり返しの日でない日から「完了」を押したら、払い忘れた回を終わりにする（今日の日付にしない）", (rent.doneDays || []).join() === past && rent.status === "open", (rent.doneDays || []).join() + " " + rent.status);
        state.items = state.items.filter(i => i.id !== rent.id); }
      // ⑤ 会話：「家賃払った」はその回だけ・「明日にする」で日付を動かさない
      { const seqT = async pairs => { reset(); const rs = []; for (const [t, d, mo] of pairs) { const n = mkNote(t, 10, d, mo); await putNote(n); rs.push(await applyOps(ruleOps(n), n)); } return rs; };
        await seqT([["毎月25日に家賃を払う", 15], ["家賃払った", 2, 10]]);
        const r = state.items.find(i => i.title === "家賃を払う");
        ok("CT. 10/2 の「家賃払った」は 9/25 の回だけ終わりにする（くり返しごと完了にしない）", !!r && r.status === "open" && (r.doneDays || []).join() === "2026-09-25", r ? r.status + " " + (r.doneDays || []).join() : "なし");
        await seqT([["毎月25日に家賃を払う", 15], ["家賃払った", 23]]);
        const r2 = state.items.find(i => i.title === "家賃を払う");
        ok("CT. 9/23 に先に払ったら、9/25 の回を終わりにする", !!r2 && (r2.doneDays || []).join() === "2026-09-25", r2 ? (r2.doneDays || []).join() : "なし");
        const rs = await seqT([["毎月25日に家賃を払う", 15]]);
        const r3 = state.items.find(i => i.title === "家賃を払う"); const n = mkNote("家賃は明日にする", 10, 25);
        const out = await applyOps([{ op: "defer", id: r3.id }], n);
        ok("CT. くり返しの用事は「明日へ」で日付を動かさず、そう言う", r3.dayKey === "2026-09-25" && out.asks.some(a => /くり返し/.test(a)), r3.dayKey + " " + out.asks.join("/"));
        ok("CT. くり返しの用事には「明日へ」のボタンも左へなぞる操作も出さない", swipeActs(r3).left === null && !/data-act="defer"/.test(itemHTML(r3)) && swipeActs(Object.assign({}, r3, { repeat: null })).left === "defer"); }
      // ⑤b 「この先の予定とタスク」には、次の回の日で出す（最初の回を過ぎても消えない）
      { reset(); const n0 = mkNote("毎月25日に家賃を払う"); state.notes.push(n0);
        state.items.push({ id: uid(), noteId: n0.id, kind: "task", title: "家賃を払う", origin: "rule", status: "open", confirmed: false, repeat: { kind: "monthly", dom: 25 },
          dayKey: "2026-09-25", due: zoned(2026, 9, 25, 23, 59, TZ).toISOString(), duePrecision: "day", doneDays: ["2026-09-25"], history: [], evidence: { text: "毎月", start: 0, end: 2 } });
        const keepDay = view.day; view.day = "2026-10-01"; renderDay();
        const ap = [...document.querySelectorAll("#dayOut details.allplan")].find(d => /この先の予定/.test(d.textContent));
        view.day = keepDay;
        ok("CT. 最初の回を過ぎても「この先の予定とタスク」に次の回（10/25）で出る", !!ap && /家賃を払う/.test(ap.textContent) && /10\/25/.test(ap.textContent), ap ? ap.textContent.replace(/\s+/g, " ").slice(0, 120) : "欄が無い"); }
      // ⑥ AIの道・日にちが無いとき・誕生日から借りる
      { reset(); const n = mkNote("毎月25日に家賃を払う"); await putNote(n);
        await applyOps([{ op: "add", kind: "task", title: "家賃を払う", dueDate: "2026-09-25", quote: "毎月25日に家賃を払う" }], n);
        const a = state.items[0];
        ok("CT. AIの道でも「毎月25日」はくり返しになる", !!a && repeatJa(a.repeat) === "毎月25日", rj(a));
        reset(); const n2 = mkNote("毎月美容院に行く"); await putNote(n2); const out = await applyOps(ruleOps(n2), n2);
        ok("CT. 「毎月美容院に行く」は何日か分からないと言う（黙って1回きりにしない）", out.asks.some(a => /何日か/.test(a)) && state.items.length === 1, out.asks.join("/"));
        reset(); for (const t of ["10月3日は母の誕生日", "毎年誕生日にケーキを買う"]) { const x = mkNote(t); await putNote(x); await applyOps(ruleOps(x), x); }
        const cake = state.items.find(i => /ケーキ/.test(i.title));
        ok("CT. 「毎年誕生日にケーキを買う」は、毎年の誕生日の日を借りて毎年の用事になる", !!cake && cake.dayKey === "2026-10-03" && repeatJa(cake.repeat) === "毎年", rj(cake)); }
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== CU. 状態を変える処理は1か所（2026-09-27・本人の指示「１と３を実行して」） =====
       完了・未完了・取り消し・取り消しを戻す・延期・その日はやらない は `setItemState` だけが変える。
       ボタン（act）と会話（applyOps）で同じ結果になること・どちらも自分で書き換えていないことを見る。 */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      reset();
      const tk = dayKey(new Date(), TZ);
      const mk = (extra) => { const it = Object.assign({ id: uid(), noteId: "x", kind: "task", title: "資料を作る", origin: "rule", status: "open", confirmed: false,
        dayKey: tk, due: zoned(...tk.split("-").map(Number), 23, 59, TZ).toISOString(), duePrecision: "day", history: [], evidence: { text: "資料", start: 0, end: 2 } }, extra || {});
        state.items.push(it); return it; };
      const talkNote = { id: uid(), text: "話した", hash: "cu" + Math.random(), capturedAt: new Date().toISOString(), source: "talk", createdAt: new Date().toISOString() };
      const pick = i => JSON.stringify({ status: i.status, confirmed: !!i.confirmed, done: !!i.completedAt, dayKey: i.dayKey, targetDay: i.targetDay || null,
        period: i.period || null, doneDays: i.doneDays || [], skipDays: i.skipDays || [], due: i.due });
      // ① 構造：ボタンと会話は、自分で状態を書き換えない
      const actSrc = String(act), opsSrc = String(applyOps);
      ok("CU. ボタン（act）も会話（applyOps）も、状態を変えるのは setItemState だけ",
        /setItemState\(it, a,/.test(actSrc) && /setItemState\(target, o\.op,/.test(opsSrc)
        && !/it\.status = "(done|dropped|open)"|it\[f\] =|it\.dayKey = nxt/.test(actSrc)
        && !/target\.status = |target\.doneDays =|target\.skipDays =|target\.dayKey = to/.test(opsSrc));
      // ② 同じ操作は、ボタンでも会話でも同じ結果になる
      const pairs = [];
      for (const [a, extra] of [["done", {}], ["drop", {}], ["defer", { targetDay: tk, period: "来月ごろ" }]]) {
        const x = mk(extra), y = mk(extra);
        await act(a, x.id, null);
        await applyOps([{ op: a, id: y.id }], talkNote);
        if (pick(x) !== pick(y)) pairs.push(a + "：ボタン " + pick(x) + " ／ 会話 " + pick(y));
      }
      ok("CU. 完了・取り消し・延期は、ボタンでも会話でも同じ状態になる", pairs.length === 0, pairs.join(" ｜ "));
      const dx = state.items.filter(i => i.title === "資料を作る" && i.dayKey === addKey(tk, 1));
      ok("CU. 延期は、ボタンでも「この日にやる」と時期の言い方を外す（前はボタンだけ残していた）", dx.length === 2 && dx.every(i => !i.targetDay && !i.period), dx.map(pick).join(" ／ "));
      ok("CU. 完了は、ボタンでも確認済みになる（前は会話だけだった）", state.items.filter(i => i.status === "done").every(i => i.confirmed));
      // ③ くり返し：その回だけ・どちらからでも同じ
      const past = addKey(tk, -2), dom = +past.slice(8);
      const rx = mk({ repeat: { kind: "monthly", dom }, dayKey: past }), ry = mk({ repeat: { kind: "monthly", dom }, dayKey: past });
      await act("done", rx.id, { dataset: { day: tk } });
      await applyOps([{ op: "done", id: ry.id }], talkNote);
      ok("CU. くり返しの完了は、ボタンでも会話でもその回だけ（シリーズは開いたまま）", pick(rx) === pick(ry) && rx.status === "open" && (rx.doneDays || []).join() === past, pick(rx) + " ／ " + pick(ry));
      const wk = mk({ repeat: { kind: "daily" }, dayKey: tk, title: "日記を書く" });
      await applyOps([{ op: "skipday", id: wk.id, day: addKey(tk, 1) }], talkNote);
      await act("skipday", wk.id, { dataset: { day: addKey(tk, 2) } });
      ok("CU. その日はやらない：会話もボタンも、その日だけ外す", (wk.skipDays || []).join() === [addKey(tk, 1), addKey(tk, 2)].join() && wk.status === "open", (wk.skipDays || []).join());
      // ④ 戻す：未完了・取り消しを戻す
      const u = mk(); await act("done", u.id, null); await act("undone", u.id, null);
      const v = mk(); await act("drop", v.id, null); await act("undrop", v.id, null);
      ok("CU. 未完了に戻す・取り消しを戻すで open に戻り、履歴に両方残る", u.status === "open" && !u.completedAt && v.status === "open"
        && u.history.some(h => h.what === "完了にした") && u.history.some(h => h.what === "未完了に戻した") && v.history.some(h => h.what === "取り消しを戻した"));
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== CV. Googleカレンダーと同期（2026-09-27・本人の指示「メインで双方向」・決まり17） =====
       偽の殻と偽の Google（メインのカレンダー）で、読む・書く・両方向の変更・消す・守り・くり返し・送らないもの・欄を見る。
       **本物の Google とは通していない**（このテストは中身の決まりだけを見る）。 */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const keepRN = window.ReactNativeWebView, keepCap = gcalCap, keepAC = window.askConfirm;
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const tk = dayKey(new Date(), TZ), tmr = addKey(tk, 1);
      const iso = (k, h, m = 0) => zoned(...k.split("-").map(Number), h, m, TZ).toISOString();
      const hm = x => hhmm(minOfDay(x, TZ));
      // 話したのは本物の「いま」（「明日」が本物の明日になる）。時刻は朝8時に固定して、午前午後の読み分けに寄りかからない
      const mkNoteCV = text => { const at = iso(tk, 8); return { id: uid(), text, hash: "cv" + text + Math.random(), capturedAt: at, source: "talk", sourceName: null, createdAt: at }; };
      const say = async text => { const n = mkNoteCV(text); await putNote(n); await applyOps(ruleOps(n), n); };
      // 偽の Google（メインのカレンダーだけ）。updated は書くたびに進む
      const G = { ev: [], calls: [], seq: 0, clock: 0, empty: false };
      const up = () => new Date(Date.UTC(2026, 0, 1) + (++G.clock) * 1000).toISOString();
      const list = () => G.empty ? [] : G.ev.flatMap(e => e.recurrence
        ? [{ id: e.id + "_1", recurringEventId: e.id, summary: e.summary, start: e.start, end: e.end, updated: e.updated }] : [e]);
      const reply = o => setTimeout(() => nativeReply(JSON.stringify(o)), 0);
      const route = m => {
        const path = String(m.path || ""), body = m.body ? JSON.parse(m.body) : null, meth = m.method;
        G.calls.push(meth + " " + path);
        const ok = (d, st = 200) => reply({ id: m.id, status: st, body: d == null ? "" : JSON.stringify(d) });
        if (path === "calendars/primary/events") {
          if (meth === "GET") { if (G.onGet) { const f = G.onGet; G.onGet = null; f(); } return ok({ items: list() }); }
          if (meth === "POST") { const ev = Object.assign({}, body, { id: "e" + (++G.seq), updated: up() }); G.ev.push(ev); return ok(ev); }
        }
        const mm = /^calendars\/primary\/events\/([^/]+)$/.exec(path);
        if (!mm) return ok({ error: { message: "bad" } }, 400);
        const i = G.ev.findIndex(e => e.id === decodeURIComponent(mm[1]));
        if (i < 0) return ok({ error: { message: "Not Found" } }, 404);
        if (meth === "GET") return ok(G.ev[i]);
        if (meth === "PATCH") { if (G.onWrite) { const f = G.onWrite; G.onWrite = null; f(); } G.ev[i] = Object.assign({}, G.ev[i], body, { updated: up() }); return ok(G.ev[i]); }
        if (meth === "DELETE") { G.ev.splice(i, 1); return ok(null, 204); }
        return ok(null, 400);
      };
      const shell = { postMessage: raw => { const m = JSON.parse(raw);
        if (m.kind === "gauth") return reply({ id: m.id, ok: true, email: "me@example.com" });
        if (m.kind === "gcal") return route(m); } };
      const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 5)); };
      const gev = id => G.ev.find(e => e.id === id);
      const byRef = ref => state.items.find(i => i.gcalRef === ref);
      try {
        // ⓪ 殻が無い（Artifact）：欄を出さない・何もしない
        delete window.ReactNativeWebView; gcalCap = null; localStorage.removeItem(GCAL_LS);
        showTab("p-set"); renderSettings();
        ok("CV. 殻が無い（Artifact）ときは、Googleカレンダーの欄を出さない", $("#gcalCard").hidden === true);
        ok("CV. 殻が無ければ、合わせても何も起きない", (await gcalSync()) === null);
        // ① 殻がある：つなぐ前の欄（両方向であること・送るもの・費用を先に書く）
        window.ReactNativeWebView = shell; gcalCap = null; reset();
        await gcalProbe(); renderSettings();
        const card = $("#gcalCard");
        ok("CV. Android アプリでは欄が出て、両方向に映ること・取り消すと Google でも消えること・送るもの・費用を書いてから「Google と同期する」を出す",
          !card.hidden && /どちらで変えても/.test(card.textContent) && /取り消すと Google でも/.test(card.textContent) && /送るのは/.test(card.textContent)
          && /費用はかかりません/.test(card.textContent) && /アプリの提案・タスクは送りません/.test(card.textContent) && !!$("#gcalSwitch") && !$("#gcalSwitch").checked, card.textContent.replace(/\s+/g, " ").slice(0, 160));
        // ② Google → ここ
        G.ev = [
          { id: "g1", summary: "歯医者", updated: up(), start: { dateTime: iso(tmr, 10) }, end: { dateTime: iso(tmr, 11) } },
          { id: "g2", summary: "旅行", updated: up(), start: { date: addKey(tk, 3) }, end: { date: addKey(tk, 5) } },
          { id: "g3", summary: "断った会議", updated: up(), start: { dateTime: iso(tmr, 13) }, end: { dateTime: iso(tmr, 14) }, attendees: [{ self: true, responseStatus: "declined" }] },
          { id: "g4", summary: "取り消された", status: "cancelled", updated: up(), start: { dateTime: iso(tmr, 15) }, end: { dateTime: iso(tmr, 16) } }
        ];
        $("#gcalSwitch").click(); await settle();
        const gi = () => state.items.filter(i => i.origin === "google" && i.status === "open");
        const den = byRef("g1"), trip = byRef("g2");
        ok("CV. 「Google と同期する」で、Google の予定を予定表に出す（断った・取り消されたものは出さない）",
          gcalGet().on === true && gi().length === 2 && !!den && hm(den.start) === "10:00" && den.dayKey === tmr, gi().map(i => i.title).join("・"));
        ok("CV. 何日も続く終日は全部の日に（Google の終わりは次の日を指す）", !!trip && trip.allDay && trip.spanEndKey === addKey(tk, 4), trip ? trip.dayKey + "〜" + trip.spanEndKey : "なし");
        ok("CV. Google から来た予定には「Googleカレンダー」の印・予定表に出る", /Googleカレンダー/.test(srcChip(den)) && planFor(tmr).blocks.some(b => b.item && b.item.id === den.id));
        ok("CV. 読んだだけでは、Google に何も書かない", !G.calls.some(c => /^(POST|PATCH|DELETE)/.test(c)), G.calls.join(" | "));
        Object.assign(gev("g1"), { summary: "歯医者（変更）", updated: up(), start: { dateTime: iso(tmr, 11) }, end: { dateTime: iso(tmr, 12) } });
        G.ev = G.ev.filter(e => e.id !== "g2");
        await gcalSync();
        ok("CV. Google で変わった予定は、ここでも変わる", byRef("g1").title === "歯医者（変更）" && hm(byRef("g1").start) === "11:00", byRef("g1").title);
        const tripNow = state.items.find(i => i.title === "旅行");
        ok("CV. Google で消えた予定は、ここでも取り消しになる（履歴に残る）", !!tripNow && tripNow.status === "dropped" && tripNow.history.some(h => /Googleカレンダーで消された/.test(h.what)));
        // ③ ここ → Google（Google から来た予定をここで直す）
        const d1 = byRef("g1"); d1.start = iso(tmr, 16); d1.end = iso(tmr, 17); d1.corrected = true; await putItem(d1);
        G.calls = []; await gcalSync();
        ok("CV. ここで Google の予定の時刻を直したら、Google でも変わる（名前・日時だけ送る）", G.calls.includes("PATCH calendars/primary/events/g1") && gev("g1").start.dateTime === d1.start
          && gev("g1").summary === "歯医者（変更）" && !("attendees" in (JSON.parse(JSON.stringify(gcalBody(d1, TZ))))), gev("g1").start.dateTime);
        // ④ 両方で変わったら、あとから変えたほう
        d1.title = "歯医者A"; await putItem(d1); d1.updatedAt = "2026-01-01T00:00:00.000Z";
        Object.assign(gev("g1"), { summary: "歯医者B", updated: "2030-01-01T00:00:00.000Z" });
        await gcalSync();
        ok("CV. 両方で変わったら、あとから変えたほう（Google が後）", byRef("g1").title === "歯医者B" && gev("g1").summary === "歯医者B", byRef("g1").title + " / " + gev("g1").summary);
        d1.title = "歯医者C"; await putItem(d1); d1.updatedAt = "2031-01-01T00:00:00.000Z";
        Object.assign(gev("g1"), { summary: "歯医者D", updated: "2030-06-01T00:00:00.000Z" });
        await gcalSync();
        ok("CV. 両方で変わったら、あとから変えたほう（ここが後）", byRef("g1").title === "歯医者C" && gev("g1").summary === "歯医者C", byRef("g1").title + " / " + gev("g1").summary);
        // ⑤ 話した予定はメインに入る。提案・タスクは送らない
        await say("明日15時から16時まで会議");
        const meet = state.items.find(i => i.title === "会議");
        state.items.push({ id: uid(), noteId: "x", kind: "event", title: "アプリの提案の散歩", suggested: true, origin: "rule", status: "open", fixed: false,
          start: iso(tmr, 18), end: iso(tmr, 19), dayKey: tmr, duePrecision: "exact", history: [], evidence: { text: "", start: 0, end: 0 } });
        await say("明日までに資料を作る");
        { const old = { id: uid(), noteId: "x", kind: "event", title: "10日前の打ち合わせ", origin: "rule", status: "open", fixed: true,
            start: iso(addKey(tk, -10), 10), end: iso(addKey(tk, -10), 11), dayKey: addKey(tk, -10), duePrecision: "exact", history: [], evidence: { text: "", start: 0, end: 0 } };
          old.dedupeKey = dedupeKey(old); state.items.push(old); }
        G.calls = []; await gcalSync();
        const gm = G.ev.find(e => e.summary === "会議");
        ok("CV. 1週間より前の予定は、あとから Google に送らない", !G.ev.some(e => /10日前/.test(e.summary || "")));
        ok("CV. 話した予定は Google のメインに入る（こちらの印つき・つながる）", !!gm && gcalHid(gm) === meet.id && meet.gcalRef === gm.id, JSON.stringify(G.ev.map(e => e.summary)));
        ok("CV. アプリの提案・タスクは Google に送らない", !G.ev.some(e => /提案|資料/.test(e.summary || "")));
        G.calls = []; await gcalSync();
        ok("CV. 変わっていなければ、書き直さない（同じ予定を二重に作らない）", !G.calls.some(c => /^(PATCH|POST)/.test(c)) && G.ev.filter(e => e.summary === "会議").length === 1, G.calls.join(" | "));
        // ⑥ ここで取り消す → Google からも消す。元に戻す → 入れ直す（消えたと読まない）
        await act("drop", meet.id, null); await gcalSync();
        ok("CV. ここで取り消したら、Google からも消す", !G.ev.some(e => e.summary === "会議") && !meet.gcalRef);
        const snap = JSON.parse(JSON.stringify(Object.assign({}, meet, { status: "open", gcalRef: gm.id })));
        Object.assign(meet, snap); await putItem(meet); await gcalSync();
        ok("CV. 取り消しを元に戻したら、Google に入れ直す（Google で消えたとは読まない）", meet.status === "open" && G.ev.filter(e => e.summary === "会議").length === 1 && !!meet.gcalRef, meet.status);
        // ⑦ 完全に消す → その1件だけ Google からも消す
        window.askConfirm = async () => true;
        await act("delitem", meet.id, null); await settle();
        ok("CV. 記録ごと消したら、その1件だけ Google からも消す", !G.ev.some(e => e.summary === "会議") && !state.items.some(i => i.id === meet.id));
        // ⑧ ここで話したばかりの同じ予定が Google にもある：二重に作らず、つなぐ
        await say("明後日12時から13時まで昼会");
        const hiru = state.items.find(i => i.title === "昼会");
        G.ev.push({ id: "g9", summary: "昼会", updated: up(), start: { dateTime: hiru.start }, end: { dateTime: hiru.end } });
        G.calls = []; await gcalSync();
        ok("CV. 同じ予定が Google にもあれば、二重に作らずにつなぐ", hiru.gcalRef === "g9" && G.ev.filter(e => e.summary === "昼会").length === 1
          && state.items.filter(i => i.title === "昼会").length === 1, G.calls.join(" | "));
        // ⑨ 守り：消しすぎない／1件も返らないときは消えたと読まない
        const many = [];
        for (let i = 0; i < 12; i++) { const it = { id: uid(), noteId: "x", kind: "event", title: "消す予定" + i, origin: "rule", status: "open", fixed: true,
          start: iso(addKey(tk, 2), 6 + i), end: iso(addKey(tk, 2), 6 + i, 30), dayKey: addKey(tk, 2), duePrecision: "exact", history: [], evidence: { text: "", start: 0, end: 0 } };
          it.dedupeKey = dedupeKey(it); state.items.push(it); many.push(it); }
        await gcalSync();
        for (const it of many) { it.status = "dropped"; await putItem(it); }
        await gcalSync();
        ok("CV. 1回に消すのは10件まで。超えたら止めて言う", G.ev.filter(e => /消す予定/.test(e.summary)).length === 2 && /多すぎる/.test(gcalGet().lastError || ""), gcalGet().lastError);
        await gcalSync();
        ok("CV. 残りは次に合わせたときに消す", G.ev.filter(e => /消す予定/.test(e.summary)).length === 0);
        await say("明後日9時から10時まで朝会"); await say("明後日17時から18時まで面談"); await gcalSync();
        const linkedBefore = state.items.filter(i => i.gcalRef && i.status === "open").length;
        G.empty = true; await gcalSync(); G.empty = false;
        ok("CV. Google から1件も返らないときは、消えたと読まない（こちらは何も取り消さない）", linkedBefore >= 3
          && state.items.filter(i => i.gcalRef && i.status === "open").length === linkedBefore && /念のため/.test(gcalGet().lastError || ""), String(linkedBefore));
        // ⑩ くり返し：くり返しとして1件で書き、その1回ぶんを別の予定として取り込まない
        await say("毎週月曜10時からゼミ");
        const zemi = state.items.find(i => i.title === "ゼミ");
        await gcalSync();
        const gz = G.ev.find(e => e.summary === "ゼミ");
        ok("CV. くり返しの予定は、くり返し（RRULE）として1件だけ書く", !!gz && /RRULE:FREQ=WEEKLY;BYDAY=MO/.test((gz.recurrence || [])[0] || "") && zemi.gcalRef === gz.id, gz ? JSON.stringify(gz.recurrence) : "なし");
        await gcalSync();
        ok("CV. Google から返る「その1回ぶん」を、別の予定として取り込まない", state.items.filter(i => /ゼミ/.test(i.title)).length === 1);
        G.ev = G.ev.filter(e => e.id !== gz.id); await gcalSync();
        ok("CV. Google でくり返しごと消されたら、ここでも取り消し", zemi.status === "dropped", zemi.status);
        // ⑪ くり返しを RRULE に写す（決まり0p と同じ日に当たる）
        const base = { id: "r", title: "家賃", kind: "event", origin: "rule", start: iso("2026-09-25", 10), end: iso("2026-09-25", 11), dayKey: "2026-09-25" };
        const RR = r => gcalRRule(Object.assign({}, base, { repeat: r }), TZ);
        const table = [[{ kind: "monthly", dom: 25 }, "RRULE:FREQ=MONTHLY;BYMONTHDAY=25"], [{ kind: "monthly", dom: 31 }, "RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1"],
          [{ kind: "monthly", dom: -1 }, "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1"], [{ kind: "monthly", nth: 2, dow: 3 }, "RRULE:FREQ=MONTHLY;BYDAY=2WE"],
          [{ kind: "monthly", nth: -1, dow: 5 }, "RRULE:FREQ=MONTHLY;BYDAY=-1FR"], [{ kind: "yearly", month: 2, dom: 29 }, "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1"],
          [{ kind: "weekday" }, "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"], [{ kind: "weekly", dow: 1 }, "RRULE:FREQ=WEEKLY;BYDAY=MO"], [{ kind: "biweekly" }, "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR"]]
          .filter(([r, want]) => RR(r) !== want).map(([r, want]) => repeatJa(r) + "→" + RR(r));
        ok("CV. くり返しを Google のくり返し（RRULE）に、このアプリと同じ日に当たるよう写す（9通り）", table.length === 0, table.join(" ／ "));
        const bx = gcalBody(Object.assign({}, base, { repeat: { kind: "monthly", dom: 25 }, skipDays: ["2026-10-25"] }), TZ);
        ok("CV. 「この日はやらない」は、その回を外す（EXDATE）", (bx.recurrence || []).some(x => x === "EXDATE;TZID=" + TZ + ":20261025T100000"), JSON.stringify(bx.recurrence));
        const ad = gcalBody(Object.assign({}, base, { allDay: true, spanEndKey: "2026-09-27" }), TZ);
        ok("CV. 何日も続く終日は、Google の形（終わりは次の日）で書く", ad.start.date === "2026-09-25" && ad.end.date === "2026-09-28", JSON.stringify([ad.start, ad.end]));
        // ⑫ 話したら、呼ばなくても少し待って合わせる／前に出てきたら合わせ直す
        await say("明後日19時から20時まで夕食会"); await new Promise(r => setTimeout(r, 4600)); await settle();
        ok("CV. 話したら、呼ばなくても少し待って Google に入れる", G.ev.some(e => e.summary === "夕食会"), JSON.stringify(G.ev.map(e => e.summary)));
        { const g = gcalGet(); g.lastSync = new Date(Date.now() - 3600000).toISOString(); gcalPut(g); gcalTried = 0; }
        Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
        G.calls = []; document.dispatchEvent(new Event("visibilitychange"));
        await new Promise(r => setTimeout(r, 800)); await settle();
        delete document.visibilityState;
        ok("CV. アプリが前に出てきたら（30秒以上たっていれば）Google と合わせ直す", G.calls.some(c => /^GET calendars\/primary\/events/.test(c)), G.calls.join(" | "));
        // ⑬ 記録は端末の中：書き出し・設定に入れない。鍵はページに来ない
        const ex = exportPayload();
        ok("CV. つないでいるアカウントは、書き出しにも設定にも入れない（端末の中だけ）", !/me@example\.com/.test(ex) && !/gcal|google/i.test(JSON.stringify(state.settings)));
        const src = [gcalReq, gcalSync, gcalTwoWay, gcalConnect].map(String).join("\n");
        ok("CV. ページは鍵（アクセストークン）を扱わない（殻が付ける）", !/accessToken|Bearer|Authorization/.test(src));
        // ⑭ 同期をやめる → Google の予定はそのまま・Google から来た予定はここから外す。つなぎ直したら、こちらの印で見つけ直す
        const nEv = G.ev.length;
        await gcalDisconnect(); await settle();
        ok("CV. 同期をやめても Google の予定は消さない。Google から来た予定はここから外す・話した予定は残る",
          G.ev.length === nEv && !state.items.some(i => i.origin === "google") && state.items.some(i => i.title === "夕食会" && !i.gcalRef), String(G.ev.length));
        // 同期をやめている間に、ここで時刻を直した（名前と時刻では見つけられない）
        const yu = state.items.find(i => i.title === "夕食会");
        yu.start = iso(addKey(tk, 2), 20); yu.end = iso(addKey(tk, 2), 21); await putItem(yu);
        G.calls = []; await gcalConnect(); await settle();
        ok("CV. つなぎ直したら、こちらの印で見つけ直す（時刻を直していても、同じ予定を2つ作らない・直した時刻を送る）",
          !!yu.gcalRef && G.ev.filter(e => e.summary === "夕食会").length === 1 && !G.calls.some(c => /^POST/.test(c))
          && G.ev.find(e => e.summary === "夕食会").start.dateTime === yu.start && state.items.filter(i => i.title === "夕食会").length === 1, G.calls.join(" | "));
        /* ⑯ **足した・直した予定は、自動で合わせる**（2026-09-28・本人「予定を追加編集したら自動で同期してほしい」）。
           ふだんは4秒後（`gcalSoon`）。**合わせている最中に足した予定も取りこぼさない**（前は次のきっかけまで Google に行かなかった）。
           本当に4秒待つとテストの持ち時間を超えるので、「頼んだ回数」を数えて、頼まれたら自分で合わせる。 */
        const origSoon = gcalSoon; let asked = 0;
        clearTimeout(gcalTimer); gcalSoon = () => { asked++; };
        try {
          for (let i = 0; i < 100 && gcalBusy; i++) await settle();          // つなぎ直しの同期が終わってから
          asked = 0; await say("明後日9時から10時まで歯科検診");
          const asa = state.items.find(i => i.title === "歯科検診");
          const a1 = asked; if (a1) await gcalSync();
          ok("CV. 話して足した予定は、何も押さなくても Google に入る（合わせるのを自分で頼む）", a1 > 0 && !!asa && !!asa.gcalRef && G.ev.some(e => e.summary === "歯科検診"), a1 + "回");
          asked = 0; asa.start = iso(addKey(tk, 2), 9, 30); asa.end = iso(addKey(tk, 2), 10, 30); asa.corrected = true; await putItem(asa);
          const a2 = asked; if (a2) await gcalSync();
          ok("CV. 直した予定も、何も押さなくても Google で変わる", a2 > 0 && (G.ev.find(e => e.summary === "歯科検診") || { start: {} }).start.dateTime === asa.start, a2 + "回");
          // 合わせている最中（こちらの変更を Google に書いている間）に話した。書く番はもう始まっているので、この回では送られない
          asa.title = "歯科検診（場所変更）"; asa.corrected = true; await putItem(asa);
          G.onWrite = () => { say("明後日17時から18時まで書類の相談"); };
          asked = 0; await gcalSync(); await settle();
          const men = state.items.find(i => i.title === "書類の相談"), a3 = asked, sentMid = !!(men && men.gcalRef);
          if (a3) await gcalSync();
          ok("CV. 合わせている最中に足した予定も、終わったあと自動でもう1回合わせて Google に入れる",
            a3 > 0 && !!men && !!men.gcalRef && G.ev.some(e => e.summary === "書類の相談"), a3 + "回 / " + (sentMid ? "1回目で入った" : "1回目では入らず"));
          asked = 0; G.calls = []; await gcalSync(); await settle();
          ok("CV. 変わっていなければ、自動では合わせ続けない（回り続けない）", asked === 0 && !G.calls.some(c => /^(POST|PATCH|DELETE)/.test(c)), asked + "回 / " + G.calls.join(" | "));
        } finally { gcalSoon = origSoon; clearTimeout(gcalTimer); }
        /* ⑰ **設定の欄は「同期する／しない」だけ・合わせるのは全部自動**（2026-09-28・本人「今合わせるを押さないと同期されない。同期するかどうかの項目以外いらない」） */
        for (let i = 0; i < 100 && gcalBusy; i++) await settle();
        { const g0 = gcalGet(); delete g0.lastError; gcalPut(g0); }
        showTab("p-set"); renderSettings();
        const gc = $("#gcalCard");
        ok("CV. つないでいるときの欄は「Googleカレンダーと同期する」のスイッチ（オン）だけ（いま合わせる・最後に合わせた・つなぎ直すは出さない）",
          !!$("#gcalSwitch") && $("#gcalSwitch").checked && !$("#btnGcalSync") && !$("#btnGcalRe") && !/最後に合わせた|いま合わせる/.test(gc.textContent) && gc.querySelectorAll("button").length === 0,
          gc.textContent.replace(/\s+/g, " ").slice(0, 120));
        { const g0 = gcalGet(); g0.lastError = "Google のログインが切れています。「つなぎ直す」を押してください。"; gcalPut(g0); renderSettings(); }
        ok("CV. 自動では直せないとき（ログインが切れた）だけ、理由と「つなぎ直す」を出す", !!$("#btnGcalRe") && /ログインが切れています/.test($("#gcalCard").textContent));
        { const g0 = gcalGet(); delete g0.lastError; gcalPut(g0); }
        const origSoon2 = gcalSoon; let asked2 = 0; gcalSoon = () => { asked2++; };
        try {
          const setLast = ms => { const g0 = gcalGet(); g0.lastSync = new Date(Date.now() - ms).toISOString(); gcalPut(g0); gcalTried = 0; };
          const due = (ago, ms) => { setLast(ago); asked2 = 0; const r = gcalDue(ms); return r && asked2 === 1; };
          ok("CV. 前に出てきたら、30秒たっていれば Googleカレンダーの変更を取りに行く（Google 側で入れて戻ってきたとき）",
            document.visibilityState !== "hidden" && due(40000, GCAL_FRONT_MS) && !due(10000, GCAL_FRONT_MS), document.visibilityState);
          ok("CV. 開いたままでも、5分たてば取りに行く（5分以内は行かない）", due(6 * 60000, GCAL_EVERY_MS) && !due(4 * 60000, GCAL_EVERY_MS));
          setLast(60 * 60000); gcalTried = Date.now(); asked2 = 0;
          ok("CV. うまくいかなかった直後は、同じ間隔が過ぎるまで叩き直さない（試した時刻で数える）", !gcalDue(GCAL_FRONT_MS) && asked2 === 0);
          asked2 = 0; document.dispatchEvent(new Event("visibilitychange")); setLast(0);
          setLast(40000); asked2 = 0; document.dispatchEvent(new Event("visibilitychange"));
          ok("CV. 前に出てきた合図（visibilitychange）で、実際に取りに行く", asked2 === 1, asked2 + "回");
        } finally { gcalSoon = origSoon2; gcalTried = 0; clearTimeout(gcalTimer); }
        ok("CV. 開いたままの間も、1分ごとの時計が「5分たったか」を見て取りに行く（時計の中身を見る）", /gcalDue\(GCAL_EVERY_MS\)/.test(String(startClock)));
        // スイッチを切って「やめますか？」で「やめない」→ スイッチはオンに戻る・同期は続く
        window.askConfirm = async () => false;
        $("#gcalSwitch").click(); await settle();
        ok("CV. スイッチを切っても「やめない」を選んだら、スイッチはオンに戻り、同期は続く", gcalGet().on === true && !!$("#gcalSwitch") && $("#gcalSwitch").checked);
        // スイッチを切る → やめてよいか聞いてから、同期をやめる
        window.askConfirm = async () => true;
        $("#gcalSwitch").click(); await settle();
        ok("CV. スイッチを切ると、同期をやめる（スイッチはオフに戻り、送るもの・費用の説明が出る）", gcalGet().on !== true && !!$("#gcalSwitch") && !$("#gcalSwitch").checked && /費用はかかりません/.test($("#gcalCard").textContent));
        // ⑮ 古い APK（Google を知らない殻）：返事が無い → 使えないと言う
        window.ReactNativeWebView = { postMessage: () => {} }; gcalCap = null;
        await gcalProbe(); renderSettings();
        ok("CV. 古い APK では「作り直すと使える」と言う（黙って固まらない）", gcalCap === false && /作り直す/.test($("#gcalCard").textContent));
      } finally {
        clearTimeout(gcalTimer); localStorage.removeItem(GCAL_LS); gcalCap = keepCap; window.askConfirm = keepAC;
        if (keepRN) window.ReactNativeWebView = keepRN; else delete window.ReactNativeWebView;
        state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
        showTab("p-chat");
      }
    }

    /* ===== CW. 配る版：Google でログインした人が、中継サーバー経由で AI を使う（2026-09-28・本人の指示「人に配る準備をしたい。サーバーを使う方向で」・決まり18） =====
       偽の殻（ログイン・中継サーバー）で、ログインしていない／した／使い切った／ログインが切れた／ログアウト、を見る。
       **本物のサーバー・本物の Google とは通していない**（サーバーの中身は server/test.mjs）。 */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const keepRN = window.ReactNativeWebView, keepCap = gcalCap, keepAC = window.askConfirm, keepFn = SAMPLEFN, keepPlain = geminiPlain;
      const keepView = view.day, keepChat = view.chatDay, had = window.HITOHI_AI;
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const S = { signed: false, email: "user@example.com", calls: [], raw: [], gen: [], used: 2, tier: "free", mode: "ok", reports: [], reportFull: false, habit: "" };
      const reply = o => setTimeout(() => nativeReply(JSON.stringify(o)), 0);
      const shell = { postMessage: raw => { const m = JSON.parse(raw); S.calls.push(m.kind + ":" + (m.action || m.op || m.method || "")); S.raw.push(raw);
        if (m.kind === "gauth") {
          if (m.action === "signin") { S.signed = true; return reply({ id: m.id, ok: true, email: S.email }); }
          if (m.action === "signout") { S.signed = false; return reply({ id: m.id, ok: true }); }
          if (m.action === "calendar") return reply({ id: m.id, ok: S.signed });
          return reply({ id: m.id, ok: S.signed, email: S.signed ? S.email : "", calendar: true, server: true });
        }
        if (m.kind === "gcal") return reply({ id: m.id, status: 200, body: JSON.stringify(m.method === "GET" ? { items: [] } : { id: "e" + S.calls.length, updated: new Date().toISOString() }) });
        if (m.kind !== "aiserver") return;
        if (m.op === "privacy") return reply({ id: m.id, ok: true });
        const out = (st, d) => reply({ id: m.id, status: st, body: JSON.stringify(d) });
        if (!S.signed) return out(401, { error: { code: "login_required", message: "Google でのログインが必要です" } });
        if (m.op === "status") return out(200, { limit: 40, used: S.used, remaining: 40 - S.used, tier: S.tier, day: "x" });
        if (m.op === "report") { S.reports.push(JSON.parse(m.body));
          return S.reportFull ? out(429, { error: { code: "report_limit", message: "今日はこれ以上報告できません（1日20件まで）" } }) : out(200, { ok: true }); }
        const b = JSON.parse(m.body); S.gen.push(b);
        if (S.mode === "limit") return out(429, { error: { code: "daily_limit", message: "今日のAIの回数（40回）を使い切りました。明日また使えます" } });
        if (S.mode === "expired") { S.signed = false; return out(401, { error: { code: "login_required", message: "ログインを確かめられませんでした" } }); }
        if (S.mode === "g400" && b.body.generationConfig) return out(400, { error: { code: 400, message: "Invalid JSON payload received. Unknown name" } });
        if (S.mode === "g400min" && ((b.body.generationConfig || {}).thinkingConfig || {}).thinkingLevel === "minimal") return out(400, { error: { code: 400, message: "thinking level minimal is not supported" } });
        if (S.mode === "bad") return out(400, { error: { code: "bad_request", message: "送る中身が足りません" } });
        S.used++;
        const text = b.tier === "quick" ? "受け止めました。" : JSON.stringify({ ops: [{ op: "add", kind: "task", title: "郵便局に行く", dueDate: null, duePrecision: "none", quote: "郵便局に行く" }], habit: S.habit || "" });
        return out(200, { candidates: [{ content: { parts: [{ text }] } }] });
      } };
      const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 5)); };
      const today = () => dayKey(new Date(), state.settings.timezone);
      const lastTurn = () => (state.turns[today()] || []).filter(t => t.role === "assistant").pop() || {};
      const card = () => $("#gcalCard"), txt = () => card().textContent.replace(/\s+/g, " ");
      try {
        window.ReactNativeWebView = shell; gcalCap = null; localStorage.removeItem(GCAL_LS);
        window.HITOHI_AI = { provider: "server" };
        acctHinted = false; aiOutDay = ""; aiUse = null; aiUseAt = 0; geminiPlain = false; acct.ok = false; acct.email = "";
        // ① 配る版の焼き込みは「サーバー」だけ（キーを持たない）
        const b = builtInAI();
        ok("CW. 配る版の焼き込みは、キーを持たない「サーバー」として受け取る", !!b && b.provider === "server" && b.key === "" && aiViaServer(), JSON.stringify(b));
        applyOwnAI();
        ok("CW. 起動したときは、AI の窓口を開けておく（ログインを確かめる前）", !!SAMPLEFN);
        // ② ログインしていない：窓口を閉じる・欄は「Google アカウント」
        reset(); await gcalProbe(); showTab("p-set"); renderSettings();
        ok("CW. ログインしていなければ、AI の窓口を閉じる（毎回サーバーへ頼まない）", SAMPLEFN === null && acct.ok === false);
        ok("CW. 設定の欄は「Google アカウント」で、ログインのボタン・プライバシーポリシーを出す（カレンダーの欄はまだ出さない）",
          !card().hidden && $("#gcalTtl").textContent === "Google アカウント" && !!$("#btnAcctIn") && !!$("#btnPrivacy") && !$("#gcalSub") && !$("#btnAcctOut"), txt().slice(0, 120));
        ok("CW. ログインする前に、送るもの・送り先（中継サーバー・Gemini）・保存しないこと・費用を書く",
          /中継サーバー/.test(txt()) && /Gemini/.test(txt()) && /保存しません/.test(txt()) && /費用はかかりません/.test(txt()) && /ルールだけで読み取ります/.test(txt()), txt().slice(0, 200));
        ok("CW. 無料か有料か分かる前は、無料の枠の注意を出す（担当者が読むことがある）",
          /運営者が無料の枠を使っているあいだは/.test(txt()) && /担当者が読むことがあります/.test(txt()), txt().slice(0, 300));
        // ③ ログインしていないまま話す：サーバーへ頼まない・理由は最初の1回だけ
        S.calls = [];
        await sendTurn("郵便局に行く。");
        const t1 = lastTurn();
        ok("CW. ログインしていないまま話しても、サーバーへ頼まない（ルールで読む）", !S.calls.some(c => /^aiserver:generate/.test(c)) && state.items.some(i => /郵便局/.test(i.title)), S.calls.join(" | "));
        ok("CW. ログインしていないことは、最初の1回だけ言う（打つ手つき）", /Google アカウント/.test(t1.error || "") && /ログイン/.test(t1.error || ""), t1.error);
        await sendTurn("銀行に行く。");
        ok("CW. 2回目からは毎回は言わない", !lastTurn().error, lastTurn().error);
        // ④ プライバシーポリシーは殻に開いてもらう
        S.calls = []; $("#btnPrivacy").click(); await settle();
        ok("CW. 「プライバシーポリシー」はサーバーのページを開く（殻に頼む）", S.calls.includes("aiserver:privacy"), S.calls.join(" | "));
        // ⑤ ログインする：窓口が開き、今日の残り・アカウント・カレンダーの欄が出る
        $("#btnAcctIn").click(); await settle(); await settle();
        ok("CW. ログインしたら、AI の窓口を開ける", acct.ok === true && !!SAMPLEFN && SAMPLEFN.own === "server");
        ok("CW. ログインしたら、アカウント・今日の残り（サーバーに聞いた数を、話しかけの回数に直して）・ログアウト・カレンダーの欄を出す",
          /user@example\.com/.test(txt()) && /あと19回ほど話せます（1日20回まで）/.test(txt()) && /AI を使って話せるのは1日20回まで/.test(txt()) && !!$("#btnAcctOut") && !!$("#gcalSub") && !!$("#gcalSwitch"), txt().slice(0, 200));
        ok("CW. 無料の枠だと分かったら「いまは無料の枠」と書く", /いまは無料の枠を使っているため/.test(txt()), txt().slice(0, 300));
        S.tier = "paid"; await aiUsage(true); await settle();
        ok("CW. 有料の枠なら、無料の注意は出さない", !/担当者が読む/.test(txt()) && /費用はかかりません/.test(txt()), txt().slice(0, 300));
        S.signed = false; await aiUsage(true); await settle();
        ok("CW. 残りを聞いたときにログインが切れていたら（401）、窓口を閉じてログインのボタンに戻す", acct.ok === false && SAMPLEFN === null && !!$("#btnAcctIn"), txt().slice(0, 80));
        $("#btnAcctIn").click(); await settle(); await settle();
        // ⑥ AI を使う：送る中身は Gemini と同じ形・キーも証明もページは持たない
        S.calls = []; S.raw = []; S.gen = []; S.mode = "ok"; S.habit = "寝る前に白湯を一杯飲んでみるのはどうですか？";
        reset(); await sendTurn("郵便局に行く。"); S.habit = "";
        ok("CW. ログインしていれば、中継サーバー経由で AI を使う（受け止め＋読み取りの2回）", S.gen.length === 2 && S.gen.some(g => g.tier === "quick") && S.gen.some(g => g.tier === "deep") && lastTurn().ai === true, S.gen.map(g => g.tier).join(","));
        ok("CW. 送る中身は Gemini と同じ形（contents・考える深さは thinkingConfig の中）",
          S.gen.every(g => Array.isArray(g.body.contents) && g.body.generationConfig && g.body.generationConfig.thinkingConfig), JSON.stringify(S.gen.map(g => g.body.generationConfig)));
        ok("CW. ページはキーもログインの証明も送らない（殻が証明を付け、サーバーがキーを付ける）",
          !S.raw.some(r => /Bearer|x-goog-api-key|AIza|idToken|"key"/.test(r)), "");
        // ⑥b AI の文を報告する（Google Play の AI 生成コンテンツのポリシー・本人「サーバーにする」）
        {
          const tAI = lastTurn();
          ok("CW. 返事には、AI が書いた部分（受け止めの一言・習慣の提案）だけを分けて持つ",
            Array.isArray(tAI.aiText) && tAI.aiText.length === 2 && tAI.aiText[0] === "受け止めました。" && /白湯/.test(tAI.aiText[1]) && /白湯/.test(tAI.text), JSON.stringify(tAI.aiText) + " / " + tAI.text);
          // AI を使わなかった返事（前からある返事も同じ＝aiText を持たない）
          await pushTurn({ id: "cw-rule", role: "assistant", text: "ルールだけで書いた返事", at: new Date().toISOString(), changes: [], plan: null, ai: false, error: null });
          view.chatDay = today(); showTab("p-chat"); renderChat();
          const btn = $(`#p-chat [data-act="aireport"][data-id="${tAI.id}"]`);
          ok("CW. AI を使わなかった返事・前からある返事（AI の部分を持たない）には「報告」を出さない",
            !!$('#p-chat .turn.ai') && !$('#p-chat [data-act="aireport"][data-id="cw-rule"]') && /ルールだけで書いた返事/.test($("#p-chat").textContent));
          const ruleTurns = (state.turns[today()] || []).filter(t => t.role === "assistant" && !(t.aiText || []).length);
          ok("CW. AI が書いた返事には「報告」を出す（AI を使わなかった返事には出さない）",
            !!btn && document.querySelectorAll('#p-chat [data-act="aireport"]').length === (state.turns[today()] || []).filter(t => t.role === "assistant" && (t.aiText || []).length).length,
            document.querySelectorAll('#p-chat [data-act="aireport"]').length + " / ルールだけの返事 " + ruleTurns.length);
          S.reports = [];
          if (btn) btn.click(); await settle();
          const sh = $("#sheetHost");
          ok("CW. 「報告」を押すと、送る文と、送るもの・送らないもの・残す日数を先に見せる",
            /受け止めました。/.test(sh.textContent) && /この AI の文と、選んだ理由だけ/.test(sh.textContent) && /話した内容・記録・アカウントは送りません/.test(sh.textContent) && /90日/.test(sh.textContent)
            && sh.querySelectorAll("[data-reason]").length === 4 && !sh.querySelector("textarea,input[type=text]"), sh.textContent.slice(0, 120));
          ok("CW. 理由を選ぶまでは送らない", S.reports.length === 0);
          const rb = sh.querySelector('[data-reason="offensive"]'); if (rb) rb.click(); await settle();
          const rpt = S.reports[0] || {};
          ok("CW. 理由を選ぶと、AI の文と理由だけを送る（話した内容・コードが書いた文は送らない）",
            S.reports.length === 1 && rpt.kind === "chat" && rpt.reason === "offensive" && rpt.text === "受け止めました。\n寝る前に白湯を一杯飲んでみるのはどうですか？" && Object.keys(rpt).sort().join() === "kind,reason,text"
            && !/郵便局/.test(JSON.stringify(rpt)), JSON.stringify(rpt));
          ok("CW. 送れたら知らせ、シートを閉じる", /報告しました/.test($("#toast").textContent) && !$("#sheetHost").firstChild, $("#toast").textContent);
          // やめる：送らない
          S.reports = []; $(`#p-chat [data-act="aireport"][data-id="${tAI.id}"]`).click(); await settle();
          $("#rpNo").click(); await settle();
          ok("CW. 「やめる」なら送らない", S.reports.length === 0 && !$("#sheetHost").firstChild);
          // 上限：理由を言う
          S.reportFull = true; $(`#p-chat [data-act="aireport"][data-id="${tAI.id}"]`).click(); await settle();
          $('#sheetHost [data-reason="wrong"]').click(); await settle();
          ok("CW. 送れなかったら、サーバーの理由をそのまま言う（黙らない）", /報告を送れませんでした/.test($("#toast").textContent) && /1日20件まで/.test($("#toast").textContent), $("#toast").textContent);
          S.reportFull = false;
          // 気づき（AI の推測）も報告できる。本人の言葉（引用）は送らない
          const ins = { id: "cw-ins", kind: "insight", title: "夜に予定を詰めがちかもしれない", quotes: ["夜は疲れる"], status: "open", origin: "ai",
            confirmed: false, corrected: false, history: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          state.items.push(ins); showTab("p-me"); renderMe();
          S.reports = []; const ib = $('#p-me [data-act="insightreport"][data-id="cw-ins"]');
          if (ib) ib.click(); await settle();
          const r2b = $('#sheetHost [data-reason="wrong"]'); if (r2b) r2b.click(); await settle();
          ok("CW. 気づき（AI の推測）も報告できる。送るのは気づきの文だけで、本人の言葉（引用）は送らない",
            !!ib && S.reports.length === 1 && S.reports[0].kind === "insight" && S.reports[0].text === ins.title && !/夜は疲れる/.test(JSON.stringify(S.reports[0])), JSON.stringify(S.reports));
          state.items = state.items.filter(i => i.id !== "cw-ins");
          showTab("p-set"); renderSettings();
          ok("CW. 設定の欄に、「報告」を押した AI の文だけはサーバーに残ると書く", /「報告」を押した AI の文だけは90日残ります/.test(txt()), txt().slice(0, 200));
        }
        // ⑦ 今日の回数を使い切った：入れ直さない・その日はもう頼まない・言うのは1回
        S.gen = []; S.mode = "limit";
        await sendTurn("図書館に行く。");
        ok("CW. 使い切ったら（429 daily_limit）、混雑と違って入れ直さない", S.gen.length === 2, S.gen.length + "回");
        ok("CW. 使い切ったことを、明日また使えると言う", /今日のAIの回数を使い切りました/.test(lastTurn().error || "") && /明日/.test(lastTurn().error || ""), lastTurn().error);
        S.gen = [];
        await sendTurn("薬局に行く。");
        ok("CW. 使い切った日は、そのあとサーバーへ頼まない（毎回言わない）", S.gen.length === 0 && !lastTurn().error && state.items.some(i => /薬局/.test(i.title)), S.gen.length + "回 / " + lastTurn().error);
        aiOutDay = "2000-01-01";
        ok("CW. 日が変われば、また頼む", aiOutToday() === false);
        aiOutDay = "";
        // ⑧ Gemini が送り方を断った（数字の 400）ときだけ素で入れ直す。サーバー自身の断り（文字の code）は入れ直さない
        S.mode = "g400"; S.gen = []; geminiPlain = false; geminiQuickLow = false;
        let got = null, why0 = "";
        try { got = await ownAICall(builtInAI(), "やあ", { modelTier: "default" }); } catch (e) { why0 = String(e.message); }
        ok("CW. Gemini が送り方を断ったら（400）、素の形で1回だけ入れ直す", typeof got === "string" && /郵便局/.test(got) && S.gen.length === 2 && !S.gen[1].body.generationConfig, S.gen.length + "回 / " + why0);
        S.mode = "g400min"; S.gen = []; geminiPlain = false; geminiQuickLow = false; got = null;
        try { got = await ownAICall(builtInAI(), "やあ", { modelTier: "quick" }); } catch (e) { why0 = String(e.message); }
        ok("CW. 受け止めの一言（minimal）を断られたら、中継サーバーの道でも low で1回だけ入れ直す",
          got === "受け止めました。" && S.gen.length === 2 && ((S.gen[1].body.generationConfig || {}).thinkingConfig || {}).thinkingLevel === "low", S.gen.length + "回 / " + why0);
        S.mode = "bad"; S.gen = []; geminiPlain = false; geminiQuickLow = false;
        let why = ""; try { await ownAICall(builtInAI(), "やあ", { modelTier: "quick" }); } catch (e) { why = String(e.message); }
        ok("CW. サーバー自身の断り（bad_request）は入れ直さない・理由を言う", S.gen.length === 1 && /AIのサーバー 400/.test(why) && /送る中身が足りません/.test(why), S.gen.length + "回 / " + why);
        geminiPlain = false; geminiQuickLow = false;
        // ⑨ カレンダー：ログイン済みならログインし直さない・同期をやめても AI のログインは残す
        window.askConfirm = async () => true;
        S.calls = []; await gcalConnect(); await settle();
        ok("CW. ログイン済みなら、カレンダーの許可だけ頼む（ログインし直さない）", gcalGet().on === true && S.calls.includes("gauth:calendar") && !S.calls.includes("gauth:signin"), S.calls.join(" | "));
        S.calls = []; await gcalDisconnect(); await settle();
        ok("CW. カレンダーの同期をやめても、AI のためのログインは残す", !gcalGet().on && !S.calls.includes("gauth:signout") && acct.ok === true && !!SAMPLEFN, S.calls.join(" | "));
        // ⑩ ログアウト：カレンダーも止める・窓口を閉じる・欄はログイン前に戻る
        await gcalConnect(); await settle();
        S.calls = []; showTab("p-set"); renderSettings(); $("#btnAcctOut").click(); await settle();
        ok("CW. ログアウトしたら、カレンダーの同期も止めて Google からログアウトする", !gcalGet().on && S.calls.includes("gauth:signout"), S.calls.join(" | "));
        ok("CW. ログアウトしたら、AI の窓口を閉じ、欄はログインのボタンに戻る", acct.ok === false && SAMPLEFN === null && !!$("#btnAcctIn") && !$("#btnAcctOut"), txt().slice(0, 80));
        // ⑪ 使っている途中でログインが切れた：窓口を閉じて、打つ手を言う
        $("#btnAcctIn").click(); await settle(); await settle();
        S.mode = "expired"; S.gen = []; acctHinted = false;
        await sendTurn("本屋に行く。");
        ok("CW. 途中でログインが切れたら、窓口を閉じて「ログインして」と言う", acct.ok === false && SAMPLEFN === null && /ログイン/.test(lastTurn().error || ""), lastTurn().error);
        // ⑫ 記録は端末の中：書き出しにアカウントを入れない
        ok("CW. 書き出しに、ログインしているアカウントを入れない", exportPayload().indexOf("user@example.com") < 0);
        // ⑬ 自分用（キーを焼き込んだ版）は今までどおり：ログインの状態で窓口を閉じない
        window.HITOHI_AI = { provider: "gemini", key: "AIza-TEST" }; applyOwnAI();
        acctSet(false);
        ok("CW. 自分用（キーを焼き込んだ版）では、ログインしていなくても AI の窓口を閉じない", !!SAMPLEFN && SAMPLEFN.own === "gemini");
        view.chatDay = today(); showTab("p-chat"); renderChat();
        ok("CW. 自分用・claude.ai の版では「報告」を出さない（届け先のサーバーが無い）", !$('#p-chat [data-act="aireport"]') && (state.turns[today()] || []).some(t => (t.aiText || []).length));
      } finally {
        clearTimeout(gcalTimer); localStorage.removeItem(GCAL_LS); gcalCap = keepCap; window.askConfirm = keepAC;
        if (keepRN) window.ReactNativeWebView = keepRN; else delete window.ReactNativeWebView;
        if (had === undefined) delete window.HITOHI_AI; else window.HITOHI_AI = had;
        SAMPLEFN = keepFn; geminiPlain = keepPlain; acctHinted = false; aiOutDay = ""; aiUse = null; acct.ok = false; acct.email = "";
        view.day = keepView; view.chatDay = keepChat;
        state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
        showTab("p-chat");
      }
    }

    /* ===== CX. AIが「時刻だけ・日付は空」で返しても、ルールと同じ日時に入れる（2026-09-28・実機で報告） =====
       16:58 の「8時から30分勉強する」で、AI は依頼文どおり dueDate を null・dueTime だけで返した。アプリは時刻ごと捨て、
       **何も予定に入らなかった**（日時なしの用事になった）。あわせて、AIの道では午前・午後の聞き返し（whenAlt）が一度も出ていなかった。
       見るのは「AIの道の結果が、同じ発言をルールで読んだ結果と同じになるか」（決まり7d・4b・7e）。AIは言われた数字をそのまま時刻にする素朴な形で返す。 */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const cases = [
        [16, 58, "8時から30分勉強する", "08:00"],
        [16, 58, "8時から30分勉強する", "20:00"],
        [22, 30, "10時から勉強する", "10:00"],
        [9, 0, "8時から勉強する", "08:00"],
        [7, 0, "8時から勉強する", "08:00"],
        [10, 0, "3時に歯医者", "03:00"],
        [13, 0, "18時までに資料を送る", "18:00"],
        [9, 0, "11時から12時まで会議", "11:00"],
        [23, 50, "9時に病院", "09:00"],
      ];
      const bad = [], alts = [];
      for (const [h, mi, text, aiTime] of cases) {
        const at = zoned(2026, 9, 28, h, mi, TZ).toISOString();
        const mk = () => ({ id: uid(), text, hash: "cx" + text + Math.random(), capturedAt: at, source: "talk", sourceName: null, createdAt: at });
        reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
        const n1 = mk(); await putNote(n1); await applyOps(ruleOps(n1), n1);
        const r = state.items.find(i => i.noteId === n1.id && (i.kind === "task" || i.kind === "event"));
        if (!r) { bad.push(text + "：ルールで読めない"); continue; }
        const dur = r.kind === "event" && r.start && r.end ? Math.round((new Date(r.end) - new Date(r.start)) / 60000) : (r.estimateMin || null);
        reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
        const n2 = mk(); await putNote(n2);
        const res = await applyOps([{ op: "add", kind: r.kind, title: r.title, dueDate: null, dueTime: aiTime, duePrecision: "exact",
          estimateMin: dur, estimateUncertain: false, targetDate: null, preferWindow: null, window: null, travelMin: null, prepMin: null, quote: text }], n2);
        const a = state.items.find(i => i.noteId === n2.id);
        const w = x => x ? (x.dayKey + " " + (x.start || x.due ? fmtDT(x.start || x.due, TZ).slice(-5) : "—")) : "なし";
        const same = !!a && a.dayKey === r.dayKey && (a.start || a.due) === (r.start || r.due) && !!a.whenAlt === !!r.whenAlt
          && (!a.whenAlt || a.whenAlt.start === r.whenAlt.start);
        if (!same) bad.push(`${pad2(h)}:${pad2(mi)}「${text}」AI=${aiTime} → ルール ${w(r)}${r.whenAlt ? "（もう一方あり）" : ""} ／ AIの道 ${w(a)}${a && a.whenAlt ? "（もう一方あり）" : ""}`);
        if (a && a.whenAlt) alts.push(res.asks.some(x => /のことなら、項目の/.test(x)));
      }
      ok("CX. AIが時刻だけ（日付は空）で返しても、ルールと同じ日時に入れる・午前午後の「もう一方」も同じに持つ（9通り）", bad.length === 0, bad.join(" ／ "));
      ok("CX. AIの道でも、もう一方があれば聞き返す（「〜のことなら、項目の…を押してください」）", alts.length > 0 && alts.every(Boolean), JSON.stringify(alts));
      /* 旧版と比べて見つけた悪化（2026-09-28）：AIが**言っていない時刻を足した**とき・**続けたいこと**で返したときに、日付を作っていた。
         日付は「ルールがその用事を読んだ日」から借りる。ルールが期限なしなら、期限なしのまま。 */
      const bad2 = [];
      for (const [h, mi, text, aiTime, kind] of [
        [10, 0, "牛乳を買う", "10:00", null], [10, 0, "郵便局に行く", "15:00", null],
        [10, 0, "10kg痩せたい", "10:00", "goal"], [10, 0, "10時から11時まで打ち合わせ", "10:00", "goal"],
        [10, 0, "あと、友達にAIの構想を送ろうと思ってたんだった。これは今日絶対じゃないけど、忘れないようにしておいて。", "10:00", null],
        [10, 0, "毎月31日に積立を確認する", "10:00", null], [10, 0, "明日までに資料を作る", "10:00", null], [10, 0, "10/5に歯医者", "10:00", null]]) {
        const at = zoned(2026, 9, 28, h, mi, TZ).toISOString();
        const mk = () => ({ id: uid(), text, hash: "cx2" + text + Math.random(), capturedAt: at, source: "talk", sourceName: null, createdAt: at });
        reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
        const n1 = mk(); await putNote(n1); await applyOps(ruleOps(n1), n1);
        const r = state.items.find(i => i.noteId === n1.id && (i.kind === "task" || i.kind === "event" || i.kind === "goal"));
        if (!r) { bad2.push(text + "：ルールで読めない"); continue; }
        reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
        const n2 = mk(); await putNote(n2);
        await applyOps([{ op: "add", kind: kind || r.kind, title: r.title, dueDate: null, dueTime: aiTime, duePrecision: "exact", quote: text }], n2);
        const a2 = state.items.find(i => i.noteId === n2.id);
        const want = kind === "goal" ? null : (r.dayKey || null);
        if (!a2 || (a2.dayKey || null) !== want) bad2.push(`「${text}」AI=${aiTime}${kind ? "・" + kind : ""} → ${a2 ? a2.dayKey || "日付なし" : "なし"}（あるべき：${want || "日付なし"}）`);
      }
      ok("CX. AIが言っていない時刻を足しても・続けたいことで返しても、ルールが読んだ日のまま（無ければ日付を作らない）（8通り）", bad2.length === 0, bad2.join(" ／ "));
      // 用事が2つある発言：話題の合わない AI の用事に、ほかの用事の日付を持ち込まない（決まり「1行に複数の話題…日時を他の話題に持ち込まない」）
      {
        const at = zoned(2026, 9, 28, 10, 0, TZ).toISOString(), text = "明日牛乳を買う。あと部屋を片付ける";
        reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
        const n = { id: uid(), text, hash: "cx3" + Math.random(), capturedAt: at, source: "talk", sourceName: null, createdAt: at };
        await putNote(n);
        await applyOps([{ op: "add", kind: "task", title: "牛乳を買う", dueDate: null, dueTime: "15:00", duePrecision: "exact", quote: "明日牛乳を買う" },
                        { op: "add", kind: "task", title: "掃除する", dueDate: null, dueTime: "15:00", duePrecision: "exact", quote: "部屋を片付ける" }], n);
        const milk = state.items.find(i => i.title === "牛乳を買う"), clean = state.items.find(i => i.title === "掃除する");
        ok("CX. 用事が2つの発言で、話題の合わない AI の用事に、ほかの用事の日付を持ち込まない", !!milk && milk.dayKey === "2026-09-29" && !!clean && !clean.dayKey,
          (milk ? milk.dayKey : "牛乳なし") + " / " + (clean ? clean.dayKey || "日付なし" : "掃除なし"));
      }
      // 言い直し（いまの日付を持っている項目）は、時刻だけ言われても日付を動かさない（今までどおり）
      reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const at0 = zoned(2026, 9, 28, 9, 0, TZ).toISOString();
      const base = { id: "cx-up", noteId: null, kind: "event", title: "会議", status: "open", origin: "rule", confirmed: false, corrected: false, history: [],
        createdAt: at0, updatedAt: at0, dayKey: "2026-09-30", start: zoned(2026, 9, 30, 10, 0, TZ).toISOString(), end: zoned(2026, 9, 30, 11, 0, TZ).toISOString(), fixed: true, duePrecision: "exact" };
      base.dedupeKey = dedupeKey(base); state.items.push(base);
      const n3 = { id: uid(), text: "会議は14時にして", hash: "cx-up", capturedAt: at0, source: "talk", sourceName: null, createdAt: at0 };
      await putNote(n3); await applyOps([{ op: "update", id: "cx-up", dueTime: "14:00", quote: "会議は14時にして" }], n3);
      ok("CX. 言い直しで時刻だけ言われたら、その項目の日付のまま（今日へ動かさない）", base.dayKey === "2026-09-30" && fmtDT(base.start, TZ).slice(-5) === "14:00", base.dayKey + " " + fmtDT(base.start, TZ));
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== CY. 依頼文は「毎回同じ前半」→「毎回変わる後半」（2026-09-28・本人の指示「毎回同じ前半の文を、先頭にまとめる」） =====
       Gemini・OpenAI は、前と同じ書き出しを使い回して安く読む。書き出しに【いまの日時】や予定の案が混ざると、一度も使い回せない。
       見るのは：区切り（PROMPT_TAIL_MARK）より前が、発言・日時・記録・設定を変えても1文字も変わらないこと／毎回変わる欄が全部うしろにあること。 */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const mkN = (text, y, mo, d, h, mi) => { const at = zoned(y, mo, d, h, mi, TZ).toISOString(); return { id: uid(), text, hash: "cy" + Math.random(), capturedAt: at, source: "talk", sourceName: null, createdAt: at }; };
      const prompts = [];
      reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const n1 = mkN("牛乳を買う", 2026, 9, 28, 9, 0);
      prompts.push(buildPrompt(n1, contextForAI(n1)));
      // 記録・わたしのこと・体調・会話・設定を変えて、別の日時・別の発言で
      await putNote(n1); await applyOps(ruleOps(n1), n1);
      const n2 = mkN("昔から朝のほうが集中できるタイプ。今日は頭が痛い", 2026, 9, 29, 21, 30);
      await putNote(n2); await applyOps(ruleOps(n2), n2);
      await pushTurn({ id: uid(), role: "assistant", text: "覚えておくね", at: n2.capturedAt, changes: [], plan: null, ai: false, error: null });
      state.settings = Object.assign({}, state.settings, { workStart: "08:00", workEnd: "22:00" });
      const n3 = mkN("金曜までに資料を作る。明日10時から会議", 2026, 10, 3, 14, 5);
      prompts.push(buildPrompt(n3, contextForAI(n3)));
      const n4 = mkN("8時から30分勉強する", 2027, 1, 1, 0, 30);
      prompts.push(buildPrompt(n4, contextForAI(n4)));
      // 直前のやりとりがある日（会話が載っている日に話す）
      const n5 = mkN("やっぱり11時からにする", 2026, 9, 29, 22, 0);
      const cx5 = contextForAI(n5);
      prompts.push(buildPrompt(n5, cx5));
      const heads = prompts.map(p => p.indexOf(PROMPT_TAIL_MARK) >= 0 ? p.slice(0, p.indexOf(PROMPT_TAIL_MARK)) : null);
      ok("CY. 区切りより前は、発言・日時・記録・設定・直前のやりとりを変えても1文字も変わらない（使い回せる前半）",
        !!cx5.recent && heads.every(h => h !== null) && heads.every(h => h === heads[0]), (cx5.recent ? "" : "直前のやりとりが空（見張りになっていない） ") + heads.map(h => h ? h.length : "区切りなし").join(" / "));
      ok("CY. 依頼文の大半は、毎回同じ前半にある（記録が少ないときで7割以上）", heads[0] && heads[0].length / prompts[0].length >= 0.7,
        heads[0] ? Math.round(100 * heads[0].length / prompts[0].length) + "%（前半" + heads[0].length + "字 / 全体" + prompts[0].length + "字）" : "");
      const DYN = ["【いまの日時】", "【作業に使える時間帯】", "【いまの予定案】", "【本人が前に言った「こうしてほしい」】", "【この人について分かっていること（変わらないこと）】",
        "【体のこと（本人の言葉そのまま", "【いま開いている用事", "【直前のやりとり】", "【本人の発話】"];
      const p3 = prompts[1], mk = p3.indexOf(PROMPT_TAIL_MARK);
      // 見出しは行の頭にあるものだけ数える（前半の「下の【いまの日時】を基準に」は見出しではない）
      const misplaced = DYN.map(x => "\n" + x).filter(x => !(p3.indexOf(x) > mk) || p3.indexOf(x) !== p3.lastIndexOf(x)).map(x => x.trim());
      ok("CY. 毎回変わる欄（いまの日時・予定の案・わたしのこと・体のこと・開いている用事・直前のやりとり・発話）は、全部うしろに1回ずつ", misplaced.length === 0, misplaced.join("・"));
      ok("CY. 本人の発話と、いまの日時は、うしろに入っている", p3.indexOf("金曜までに資料を作る") > mk && /【いまの日時】2026年10月3日\(土\) 14:05/.test(p3.slice(mk)), p3.slice(mk, mk + 120));
      const STATIC = ["【厳守】", "【返すJSON（これだけ返す）】", "opsに使える形：", "【体のこと】の欄の扱い：", "下の【いまの日時】を基準に"];
      ok("CY. 説明は1つも落とさず、前半に1回ずつ", STATIC.every(x => heads[0].indexOf(x) >= 0 && p3.indexOf(x) === p3.lastIndexOf(x)), STATIC.filter(x => heads[0].indexOf(x) < 0).join("・"));
      // 組み立ての依頼：案内はいちばん上のまま（決まり10）。案内のあとは、ふだんと同じ前半
      const nb = mkN("18時から22時まで予定を組み立てて", 2026, 9, 28, 12, 0);
      const pb = buildPrompt(nb, contextForAI(nb));
      const intro = heads[0].slice(0, heads[0].indexOf("「今日」「明日」「あとで」は"));
      const restB = pb.slice(pb.indexOf("「今日」「明日」「あとで」は"), pb.indexOf(PROMPT_TAIL_MARK));
      ok("CY. 組み立ての依頼は、案内がいちばん上のまま・そのあとの説明はふだんと同じ", pb.indexOf("【この発話は「1日の組み立て」の依頼です】") < 200
        && restB === heads[0].slice(intro.length), String(pb.indexOf("【この発話は「1日の組み立て」の依頼です】")));
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== CZ. 前からあった弱点を直した（2026-09-28・本人の指示「前からある弱点を直して」） =====
       ① 句点のあとの時刻だけの文（「来週の月曜に歯医者。14時から。」）をルールが読めなかった
       ② 発言にほかの時刻があると、AIの言っていない時刻をそのまま通した（wordCheck ② ③ は「時刻が1つも無い」ときだけ効いた）
       ③ 「あと2時間で出発」の AI の時刻を、言っていない時刻として消していた
       ④ 何日も続く予定（出張）が、AIの道では1日になっていた */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const at10 = zoned(2026, 9, 28, 10, 0, TZ).toISOString();
      const mkZ = (text, at = at10) => ({ id: uid(), text, hash: "cz" + text + Math.random(), capturedAt: at, source: "talk", sourceName: null, createdAt: at });
      const fresh = () => { reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ }); };
      const ruleOf = async text => { fresh(); const n = mkZ(text); await putNote(n); await applyOps(ruleOps(n), n); return state.items.filter(i => i.noteId === n.id && (i.kind === "event" || i.kind === "task")); };
      const aiOf = async (text, ops) => { fresh(); const n = mkZ(text); await putNote(n); const r = await applyOps(ops, n); return { items: state.items.filter(i => i.noteId === n.id), asks: r.asks }; };
      const when = i => i ? (i.allDay ? "終日" + i.dayKey + (i.spanEndKey ? "〜" + i.spanEndKey : "") : i.kind === "event" ? (i.timeUnknown ? i.dayKey + " 時刻未定" : fmtDT(i.start, TZ)) : (i.due ? fmtDT(i.due, TZ) + (i.dueIsDeadline ? "まで" : "") : "期限なし")) : "なし";
      // ①
      const r1 = await ruleOf("来週の月曜に歯医者。14時から。"), r2 = await ruleOf("明日歯医者。午後3時から。"), r3 = await ruleOf("明日病院。前回は10時だった");
      ok("CZ. 句点のあとの時刻だけの文も、同じ予定の時刻として読む（「来週の月曜に歯医者。14時から。」「明日歯医者。午後3時から。」）",
        when(r1[0]) === "10/05 14:00" && when(r2[0]) === "9/29 15:00", when(r1[0]) + " / " + when(r2[0]));
      ok("CZ. 時刻だけでない文（「前回は10時だった」）の時刻は、今回の予定に付けない", r3.length === 1 && when(r3[0]) === "2026-09-29 時刻未定", when(r3[0]));
      // ②
      const a1 = await aiOf("来週の月曜に歯医者。14時から。", [{ op: "add", kind: "event", title: "歯医者", dueDate: "2026-10-05", dueTime: "10:00", duePrecision: "exact", estimateMin: 60, quote: "来週の月曜に歯医者" }]);
      const a2 = await aiOf("明日の15時までに書類を出す", [{ op: "add", kind: "task", title: "書類を出す", dueDate: "2026-09-29", dueTime: "10:00", duePrecision: "exact", quote: "明日の15時までに書類を出す" }]);
      const a3 = await aiOf("明日会議。場所は3階。資料は10部", [{ op: "add", kind: "event", title: "会議", dueDate: "2026-09-29", dueTime: "10:00", duePrecision: "exact", quote: "明日会議" }]);
      ok("CZ. 発言にほかの時刻があっても、AIの言っていない時刻（10時）は採らず、言った時刻（14時・15時まで）にする",
        when(a1.items[0]) === "10/05 14:00" && when(a2.items[0]) === "9/29 15:00まで", when(a1.items[0]) + " / " + when(a2.items[0]));
      ok("CZ. 言った時刻がどこにも無ければ、時刻未定にする（「資料は10部」の10は時刻ではない）", when(a3.items[0]) === "2026-09-29 時刻未定", when(a3.items[0]));
      // ③
      const a4 = await aiOf("あと2時間で出発", [{ op: "add", kind: "event", title: "出発", dueDate: "2026-09-28", dueTime: "12:00", duePrecision: "exact", quote: "あと2時間で出発" }]);
      const a5 = await aiOf("あと2時間で出発", [{ op: "add", kind: "event", title: "出発", dueDate: "2026-09-28", dueTime: "12:30", duePrecision: "exact", quote: "あと2時間で出発" }]);
      ok("CZ. 「あと2時間で」の時刻（ルールも計算する12:00）は、AIの道でも消さない・ずれていればルールの12:00にする",
        when(a4.items[0]) === "9/28 12:00" && when(a5.items[0]) === "9/28 12:00", when(a4.items[0]) + " / " + when(a5.items[0]));
      // AIが名前を言い換えても（「出発」→「出かける」・同じ話題と分からない）、ルールがこの発言から読んだ時刻なら「言った時刻」
      const a4b = await aiOf("あと2時間で出発", [{ op: "add", kind: "event", title: "出かける", dueDate: "2026-09-28", dueTime: "12:00", duePrecision: "exact", quote: "あと2時間で出発" }]);
      ok("CZ. AIが名前を言い換えても、ルールがこの発言から読んだ時刻（12:00）は言った時刻として残す", when(a4b.items[0]) === "9/28 12:00", when(a4b.items[0]));
      // ④
      const a6 = await aiOf("明日から3日間、出張します", [{ op: "add", kind: "event", title: "出張する", dueDate: "2026-09-29", dueTime: null, duePrecision: "day", quote: "明日から3日間、出張します" }]);
      const trip = a6.items[0];
      ok("CZ. 何日も続く予定は、AIの道でもルールと同じ終日の3日間にし、3日とも予定表に出す",
        when(trip) === "終日2026-09-29〜2026-10-01" && ["2026-09-29", "2026-09-30", "2026-10-01"].every(k => planFor(k).blocks.some(b => b.item && b.item.id === trip.id)), when(trip));
      // 言った時刻は今までどおり残す（直しすぎていないこと）
      const a7 = await aiOf("11時から12時まで企画会議、そのあと13時から歯医者", [
        { op: "add", kind: "event", title: "企画会議", dueDate: null, dueTime: "11:00", duePrecision: "exact", estimateMin: 60, quote: "11時から12時まで企画会議" },
        { op: "add", kind: "event", title: "歯医者", dueDate: null, dueTime: "13:00", duePrecision: "exact", estimateMin: 60, quote: "そのあと13時から歯医者" }]);
      const kk = a7.items.find(i => i.title === "企画会議"), hh = a7.items.find(i => i.title === "歯医者");
      ok("CZ. 言った時刻（11時・13時）は、そのまま残す", when(kk) === "9/28 11:00" && when(hh) === "9/28 13:00", when(kk) + " / " + when(hh));
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== DA. 本物の Gemini で比べて見つけた、AIの道で落としていた2つ（2026-09-28・本人の指示「キーです。試してください」） =====
       AI の答えは正しかったのに、アプリが受け取るところで落としていた（tools/ai-eval・4通りの比べ方すべてで同じ3件）。
       ① 「午後に郵便局に行く」「夕方にジムに行く」：AIは今日の日付を返したが、「午後」「夕方」は日付の言葉ではないので外し、
          時刻も無いので戻す先が無く、日付なしになっていた（ルールは今日の用事・決まり0l の E）
       ② 「今日の19時から友達とご飯」：AIが予定（event）で返すと、食事の名前を揃えていなかった（ルールは予定でも揃える・決まり6i） */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const at10 = zoned(2026, 9, 28, 10, 0, TZ).toISOString();
      const mkA = (text, at = at10) => ({ id: uid(), text, hash: "da" + text + Math.random(), capturedAt: at, source: "talk", sourceName: null, createdAt: at });
      const fresh = () => { reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ }); };
      const bad = [];
      for (const [text, kind, aiDate, win] of [
        ["午後に郵便局に行く", "task", "2026-09-28", "afternoon"], ["午後に郵便局に行く", "task", null, "afternoon"],
        ["夕方にジムに行く", "event", "2026-09-28", "evening"], ["夕方にジムに行く", "task", null, "evening"],
        ["帰りに牛乳を買う", "task", null, null], ["帰りに牛乳を買う", "task", "2026-09-29", null]]) {
        fresh(); const n1 = mkA(text); await putNote(n1); await applyOps(ruleOps(n1), n1);
        const r = state.items.find(i => i.noteId === n1.id && (i.kind === "task" || i.kind === "event"));
        fresh(); const n2 = mkA(text); await putNote(n2);
        await applyOps([{ op: "add", kind, title: r ? r.title : text, dueDate: aiDate, dueTime: null, duePrecision: aiDate ? "day" : null, preferWindow: win, quote: text }], n2);
        const a = state.items.find(i => i.noteId === n2.id);
        const okDay = !!r && !!r.dayKey && !!a && a.dayKey === r.dayKey;
        const okDeadline = !a || a.kind !== "task" || !!a.dueIsDeadline === !!r.dueIsDeadline;
        const okWin = !win || !a || a.kind !== "task" || a.preferWindow === win;
        const okPrec = !a || a.kind !== "task" || a.duePrecision === r.duePrecision;   // 「日付だけ」を 23:59 の時刻にしない
        if (!okDay || !okDeadline || !okWin || !okPrec) bad.push(`「${text}」AI=${kind}・${aiDate || "日付なし"} → ルール ${r ? r.dayKey || "日付なし" : "なし"}${r && r.dueIsDeadline ? "まで" : ""} ／ AIの道 ${a ? a.dayKey || "日付なし" : "なし"}${a && a.dueIsDeadline ? "まで" : ""}${a && a.preferWindow ? "・" + a.preferWindow : ""}${a && a.kind === "task" ? "・" + a.duePrecision : ""}`);
      }
      ok("DA. 「午後に」「夕方に」「帰りに」は、AIの道でもルールと同じ日（今日）・締切にしない・時間帯を持つ（6通り）", bad.length === 0, bad.join(" ／ "));
      // 直しすぎていない：ルールが期限なしと読むものは、AIが日付を付けても・付けなくても期限なし（決まり7d）
      const bad2 = [];
      for (const [text, kind, aiDate] of [["牛乳を買う", "task", "2026-09-28"], ["牛乳を買う", "task", null], ["そのうち本棚を整理したい", "task", "2026-09-28"], ["毎朝ストレッチを続けたい", "goal", "2026-09-28"]]) {
        fresh(); const n = mkA(text); await putNote(n);
        await applyOps([{ op: "add", kind, title: text.replace(/(したい|を続けたい)$/, "する"), dueDate: aiDate, dueTime: null, duePrecision: aiDate ? "day" : null, quote: text }], n);
        const a = state.items.find(i => i.noteId === n.id);
        if (!a || a.dayKey) bad2.push(`「${text}」AI=${kind}・${aiDate || "日付なし"} → ${a ? a.dayKey : "なし"}`);
      }
      ok("DA. 日付も時間帯も言っていない用事・続けたいことは、今までどおり期限なし（4通り）", bad2.length === 0, bad2.join(" ／ "));
      // ② 食事の予定
      fresh();
      const n3 = mkA("今日の19時から友達とご飯"); await putNote(n3);
      await applyOps([{ op: "add", kind: "event", title: "友達とご飯", dueDate: "2026-09-28", dueTime: "19:00", duePrecision: "exact", quote: "今日の19時から友達とご飯" }], n3);
      const meal = state.items.find(i => i.noteId === n3.id);
      ok("DA. AIが食事を予定で返しても、名前を揃える（「友達とご飯」→「夕食を食べる」・19:00の予定のまま・本人の言葉は根拠に残る）",
        !!meal && meal.title === "夕食を食べる" && meal.kind === "event" && fmtDT(meal.start, TZ) === "9/28 19:00" && /友達とご飯/.test(meal.evidence && meal.evidence.text || ""),
        meal ? `${meal.kind}「${meal.title}」${fmtDT(meal.start, TZ)} 根拠:${meal.evidence && meal.evidence.text}` : "なし");
      const n4 = mkA("夕食食べた", zoned(2026, 9, 28, 21, 0, TZ).toISOString()); await putNote(n4);
      await applyOps(ruleOps(n4), n4);
      ok("DA. 揃えた食事の予定は、「夕食食べた」で完了にできる", !!meal && meal.status === "done", meal ? meal.status : "なし");
      fresh();
      const n5 = mkA("今日の19時から友達と映画"); await putNote(n5);
      await applyOps([{ op: "add", kind: "event", title: "友達と映画", dueDate: "2026-09-28", dueTime: "19:00", duePrecision: "exact", quote: "今日の19時から友達と映画" }], n5);
      const mov = state.items.find(i => i.noteId === n5.id);
      ok("DA. 食事でない予定の名前は、そのまま（「友達と映画」）", !!mov && mov.title === "友達と映画", mov ? mov.title : "なし");
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== DB. 時刻を言った作業が、一日の終わりで1分はみ出して置けなかった（2026-09-28・実機で報告「埋まってないのに」） =====
       21:30 に「22:00〜23:00 勉強」「23:00 からゲーム1時間」。ゲームが「23:00からと言っていましたが、そこは別の予定で埋まっています」。
       既定の「一日じゅう」は 00:00〜23:59 なので、23:00＋1時間＝24:00 が1分はみ出していた。理由も取り違えていた（決まり6n）。 */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const K = "2026-09-28";
      const mkT = (title, h, mi, min) => { const at = zoned(2026, 9, 28, h, mi, TZ).toISOString();
        const it = { id: uid(), noteId: null, kind: "task", title, status: "open", origin: "user", confirmed: false, corrected: false, history: [],
          createdAt: zoned(2026, 9, 28, 9, 0, TZ).toISOString(), updatedAt: "", evidence: { text: title }, dayKey: K, due: at, duePrecision: "exact",
          dueIsDeadline: false, estimateMin: min, fixed: false };
        it.dedupeKey = dedupeKey(it); state.items.push(it); return it; };
      const fresh = (ws, we) => { reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ, workStart: ws || "00:00", workEnd: we || "23:59" }); };
      const where = (it, now) => { const p = planFor(K, { nowMin: now }); const b = p.blocks.find(x => x.item && x.item.id === it.id);
        if (b) return hhmm(b.s) + "〜" + hhmm(b.e); const u = p.unplaced.find(x => x.item.id === it.id); return u ? "置けない：" + u.reason : "なし"; };
      const NOW = 21 * 60 + 30;
      fresh(); mkT("勉強する", 22, 0, 60); const game = mkT("ゲーム", 23, 0, 60);
      const gb = planFor(K, { nowMin: NOW }).blocks.find(x => x.item && x.item.id === game.id);
      ok("DB. 22:00〜23:00 のあと、23:00 から1時間の作業を置ける（一日の終わりは 24:00）", !!gb && gb.s === 23 * 60 && gb.e === 24 * 60, where(game, NOW));
      fresh(); const g2 = mkT("ゲーム", 23, 30, 60);
      ok("DB. 日付をまたぐ長さなら、そう言う（「埋まっています」と言わない）", /日付をまたぐ/.test(where(g2, NOW)) && !/埋まって/.test(where(g2, NOW)), where(g2, NOW));
      fresh("09:00", "21:00"); const g3 = mkT("ゲーム", 22, 0, 60);
      ok("DB. 作業に使える時間帯の外なら、そう言う", /作業に使える時間帯（09:00〜21:00）の外です/.test(where(g3, 10 * 60)), where(g3, 10 * 60));
      fresh("09:00", "21:00"); const g5 = mkT("ゲーム", 20, 30, 60);
      ok("DB. 帯の終わりを1分でもはみ出すなら、帯の外と言う（23:59 のときだけ 24:00 まで）", /の外です/.test(where(g5, 10 * 60)), where(g5, 10 * 60));
      fresh(); mkT("会議の準備", 23, 0, 30); const g4 = mkT("ゲーム", 23, 0, 60);
      ok("DB. 本当に別の枠があるときは、今までどおり「埋まっています」", /別の予定で埋まっています/.test(where(g4, NOW)), where(g4, NOW));
      fresh(); const g6 = mkT("ゲーム", 21, 0, 60);
      ok("DB. 過ぎた時刻は「過ぎています」のまま", /21:00は過ぎています/.test(where(g6, NOW)), where(g6, NOW));
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== DC. 予定の通知を何分前に鳴らすか・アプリの版（2026-09-28・本人の指示「通知を何分前に鳴らすかとアプリのバージョンを取り入れて」） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const keepRN = window.ReactNativeWebView, keepB = window.HITOHI_BUILD;
      const K = "2026-09-28";
      reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const at10 = zoned(2026, 9, 28, 10, 0, TZ).toISOString();
      const t = { id: uid(), noteId: null, kind: "task", title: "歯医者に電話", status: "open", origin: "user", confirmed: false, corrected: false, history: [],
        createdAt: zoned(2026, 9, 28, 8, 0, TZ).toISOString(), updatedAt: "", evidence: { text: "x" }, dayKey: K, due: at10, duePrecision: "exact", dueIsDeadline: false, estimateMin: 30, fixed: false };
      t.dedupeKey = dedupeKey(t); state.items.push(t);
      const whenOf = (lead, now) => { state.settings = Object.assign({}, state.settings, { notifyBefore: lead });
        const n = notifyList(K, now).find(x => x.id === t.id); return n ? hhmm(minOfDay(new Date(n.at).toISOString(), TZ)) : "なし"; };
      ok("DC. 「始まる時刻」なら今までどおり10:00に鳴らす", whenOf(0, 9 * 60) === "10:00", whenOf(0, 9 * 60));
      ok("DC. 「10分前」なら9:50、「1時間前」なら9:00に鳴らす", whenOf(10, 8 * 60) === "09:50" && whenOf(60, 8 * 60) === "09:00", whenOf(10, 8 * 60) + " / " + whenOf(60, 8 * 60));
      ok("DC. 鳴らす時刻がもう過ぎていれば予約しない（9:55に「10分前」）・始まる時刻なら予約する", whenOf(10, 9 * 60 + 55) === "なし" && whenOf(0, 9 * 60 + 55) === "10:00", whenOf(10, 9 * 60 + 55));
      { state.settings = Object.assign({}, state.settings, { notifyBefore: 30 }); const n = notifyList(K, 8 * 60).find(x => x.id === t.id);
        ok("DC. 何分前に鳴っても、本文は始まりの時刻（10:00から）", !!n && /^10:00から/.test(n.body), n && n.body); }
      ok("DC. 選べない値は受け付けない（7分・壊れた値は「始まる時刻」に・\"30\" は30分）",
        safeSettings(Object.assign({}, DEFAULTS, { notifyBefore: 7 })).notifyBefore === 0 && safeSettings(Object.assign({}, DEFAULTS, { notifyBefore: "x" })).notifyBefore === 0
        && safeSettings(Object.assign({}, DEFAULTS, { notifyBefore: "30" })).notifyBefore === 30);
      // 欄は Android アプリの中だけ・変えたらその場で予約を取り直す
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      delete window.ReactNativeWebView; showTab("p-set"); renderSettings();
      ok("DC. Artifact（殻が無い）では「予定の通知」の欄を出さない（効かない設定を置かない）", $("#notifyRow").hidden === true);
      const sent = []; window.ReactNativeWebView = { postMessage: raw => { try { const m = JSON.parse(raw); if (m.kind === "notify") sent.push(m); } catch {} } };
      renderSettings();
      ok("DC. Android アプリでは「予定の通知」の欄を出す（既定は「始まる時刻」）", $("#notifyRow").hidden === false && $("#notifyBefore").value === "0");
      // 別の日を見ていても（描き直しは今日の予約に触らない）、設定を変えたら今日の予約を取り直す
      const keepDay = view.day; view.day = "2026-01-01"; sent.length = 0;
      $("#notifyBefore").value = "15"; $("#notifyBefore").dispatchEvent(new Event("change"));
      for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 5));
      const sentN = sent.length; view.day = keepDay;
      ok("DC. 選んだら保存し、今日の通知の予約をその場で取り直す（別の日を見ていても）", state.settings.notifyBefore === 15 && sentN > 0, state.settings.notifyBefore + " / 送った" + sentN + "回");
      // 版
      window.HITOHI_BUILD = { at: "2026-09-28T13:07:04.768Z", commit: "d71ee94" }; renderSettings();
      ok("DC. 設定のいちばん下に、APK を作った日時とコミットを出す", /2026年9月28日 22:07 に作った版（d71ee94）/.test($("#appVer").textContent), $("#appVer").textContent);
      window.HITOHI_BUILD = { at: "2026-09-28T13:07:04.768Z", commit: "<img src=x onerror=alert(1)>" }; renderSettings();
      ok("DC. 版の値は外から来たものとして読む（形が違うコミットは出さない・要素を作らない）", !/img/.test($("#appVer").textContent) && !$("#appVer").querySelector("img"));
      delete window.HITOHI_BUILD; renderSettings();
      ok("DC. 版が書き込まれていない（Artifact）なら「開発用」と言う", /開発用の画面/.test($("#appVer").textContent), $("#appVer").textContent);
      if (keepRN) window.ReactNativeWebView = keepRN; else delete window.ReactNativeWebView;
      if (keepB) window.HITOHI_BUILD = keepB; else delete window.HITOHI_BUILD;
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
      showTab("p-chat");
    }

    /* ===== DD. ルールだけで読めていなかった6つ（2026-09-28・本人の指示「開発を進める」） =====
       本物の Gemini で比べたとき、AIなし（ルールだけ）の道は 42件中36件だった。落としていたのは：
       ① 「勉強おわった」（ひらがな）で完了にならない ② 「面接は14時から」で時刻が足されず別の予定ができる
       ③ 「資料は木曜までにしたい」で「資料はする」という別の用事ができる ④ 「面談は午後にずらして14時から」で別の予定ができる
       ⑤ 「明日は9時に病院、午後は買い物」「明日10時から会議、牛乳も買わないと」が1件にまとまる */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const at = (d, h, mi) => zoned(2026, 9, d, h, mi, TZ).toISOString();   // 9/15 は火曜
      const fresh = () => { reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ }); };
      const open = () => state.items.filter(i => i.status === "open" && (i.kind === "task" || i.kind === "event"));
      const hmOf = x => x ? hhmm(minOfDay(x, TZ)) : "なし";
      const show = () => state.items.map(i => `${i.status} ${i.kind}「${i.title}」${i.dayKey || ""} ${i.start && !i.timeUnknown ? hmOf(i.start) : i.due && i.duePrecision === "exact" ? hmOf(i.due) : ""}${i.dueIsDeadline ? "まで" : ""}`).join(" ／ ");
      // ① ひらがなの「おわった」
      for (const done of ["勉強おわった", "勉強終わりました", "勉強おわりました"]) {
        fresh(); await say("8時から30分勉強する", at(15, 16, 58)); await say(done, at(15, 20, 40));
        const st = state.items.filter(i => i.kind === "task" || i.kind === "event");
        ok(`DD. 「${done}」で完了にする（新しい用事を作らない）`, st.length === 1 && st[0].status === "done", show());
      }
      fresh(); await say("8時から30分勉強する", at(15, 16, 58)); await say("勉強おわったら連絡する", at(15, 17, 0));
      ok("DD. 「勉強おわったら連絡する」は条件で、勉強を完了にしない", state.items.some(i => i.title === "勉強する" && i.status === "open") && !state.items.some(i => i.status === "done"), show());
      fresh(); await say("歯医者の予約おわり", at(15, 11, 0)); await say("出張の準備おわり", at(15, 11, 1));
      ok("DD. 「歯医者の予約おわり」「出張の準備おわり」（ひらがな）は報告で、用事にしない", open().length === 0, show());
      // ② 話題（「〜は」）に時刻を言い足す
      fresh(); await say("来週の火曜に面接", at(15, 9, 0)); await say("面接は14時から", at(15, 9, 5));
      ok("DD. 「来週の火曜に面接」→「面接は14時から」は、同じ面接に時刻を足す（1件・9/22 14:00）",
         open().length === 1 && open()[0].dayKey === "2026-09-22" && hmOf(open()[0].start) === "14:00" && !open()[0].timeUnknown, show());
      fresh(); await say("明日の会議", at(15, 9, 0)); await say("明日の会議は10時から", at(15, 9, 5));
      ok("DD. 「明日の会議」→「明日の会議は10時から」も1件のまま時刻を足す", open().length === 1 && hmOf(open()[0].start) === "10:00", show());
      // ③ 締切を前へ
      fresh(); await say("金曜までに資料を作る", at(15, 9, 0));
      const r3 = await say("資料は木曜までにしたい", at(15, 9, 5));
      ok("DD. 「資料は木曜までにしたい」は、同じ用事の締切を木曜（9/17）へ（別の用事を作らない）",
         open().length === 1 && open()[0].title === "資料を作る" && open()[0].dayKey === "2026-09-17" && !!open()[0].dueIsDeadline, show());
      ok("DD. 締切を前へ動かしたら「前へ」と言う（「後ろへ」「以降」と言わない）",
         (r3.changes || []).some(c => /^前へ：資料を作る（09\/17 に）/.test(c)) && !(r3.changes || []).some(c => /後ろへ|以降/.test(c)), (r3.changes || []).join(" ／ "));
      // ④ ずらして
      fresh(); await say("明日10時から会議", at(15, 9, 0)); await say("明後日10時から面談", at(15, 9, 1)); await say("面談は午後にずらして14時から", at(15, 9, 5));
      const men = open().filter(i => i.title === "面談"), kai = open().filter(i => i.title === "会議");
      ok("DD. 「面談は午後にずらして14時から」は、面談だけを14時へ（会議は動かさない・新しい予定を作らない）",
         open().length === 2 && men.length === 1 && men[0].dayKey === "2026-09-17" && hmOf(men[0].start) === "14:00" && kai.length === 1 && hmOf(kai[0].start) === "10:00", show());
      fresh(); await say("明後日10時から面談", at(15, 9, 0)); await say("面談を14時にずらして", at(15, 9, 5));
      ok("DD. 「面談を14時にずらして」（「は」なし）も、面談を14時へ（新しい予定を作らない）",
         open().length === 1 && open()[0].dayKey === "2026-09-17" && hmOf(open()[0].start) === "14:00", show());
      // ⑤ 1行に2つ
      fresh(); await say("明日は9時に病院、午後は買い物", at(15, 10, 0));
      const byo = open().find(i => i.title === "病院"), kau = open().find(i => i.title === "買い物");
      ok("DD. 「明日は9時に病院、午後は買い物」は2件（病院 9/16 9:00・買い物 9/16）",
         open().length === 2 && !!byo && byo.dayKey === "2026-09-16" && hmOf(byo.start) === "09:00" && !!kau && kau.dayKey === "2026-09-16", show());
      fresh(); await say("明日10時から会議、牛乳も買わないと", at(15, 10, 0));
      ok("DD. 「明日10時から会議、牛乳も買わないと」は2件（会議の時刻を牛乳に持ち込まない）",
         open().length === 2 && open().some(i => i.kind === "event" && i.title === "会議" && hmOf(i.start) === "10:00") && open().some(i => i.kind === "task" && /牛乳/.test(i.title) && !i.start), show());
      fresh(); await say("明日10時に歯医者、遅れないようにしないと", at(15, 9, 0));
      ok("DD. 「明日10時に歯医者、遅れないようにしないと」は分けない（用事の言葉が両方にある・前は1件）", open().length === 1, show());
      // ⑥ 日付の無い用事に時刻を言い足す＝始まりの時刻（締切にしない）
      fresh(); await say("勉強する", at(14, 9, 0)); await say("勉強は10時から", at(15, 9, 0));
      const ben = open();
      ok("DD. 日付の無い「勉強する」に「勉強は10時から」＝今日の10時から（1件・締切にしない）",
         ben.length === 1 && ben[0].dayKey === "2026-09-15" && ben[0].duePrecision === "exact" && hmOf(ben[0].due) === "10:00" && !ben[0].dueIsDeadline, show());
      // 言い足しに当てないもの（前と同じく新しく足す／何も動かさない）
      fresh(); await say("毎週月曜10時からゼミ", at(15, 9, 0)); await say("ゼミは14時から", at(15, 9, 5));
      const zemi = state.items.find(i => i.repeat);
      ok("DD. くり返しの予定は、言い足しで時刻を書き換えない（毎週月曜10時のまま）", !!zemi && hmOf(zemi.start) === "10:00", show());
      fresh(); await say("明日10時から会議", at(15, 9, 0)); await say("明後日14時から会議", at(15, 9, 1)); await say("会議は15時から", at(15, 9, 5));
      ok("DD. 同じ名前が2つあるときは、どちらも書き換えない", open().filter(i => i.title === "会議").some(i => i.dayKey === "2026-09-16" && hmOf(i.start) === "10:00")
         && open().some(i => i.dayKey === "2026-09-17" && hmOf(i.start) === "14:00"), show());
      fresh(); await say("明日10時から会議", at(15, 9, 0)); await say("会議は明後日10時から", at(15, 9, 5));
      ok("DD. 違う日を言ったら、前の予定を動かさない（明日の会議は明日のまま）", open().some(i => i.dayKey === "2026-09-16" && hmOf(i.start) === "10:00"), show());
      fresh(); await say("今日10時から会議", at(14, 9, 0)); await say("会議は14時から", at(15, 9, 5));
      ok("DD. もう過ぎた日の予定は、言い足しで動かさない（昨日の会議は昨日のまま）", open().some(i => i.dayKey === "2026-09-14" && hmOf(i.start) === "10:00"), show());
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== DE. 残っていた弱点の対策（2026-09-28・本人の指示「まだ残っている弱点の対策を模索して」） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings, fn: SAMPLEFN };
      const at = (d, h, mi) => zoned(2026, 9, d, h, mi, TZ).toISOString();   // 9/15 は火曜
      const fresh = () => { reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ }); };
      const open = () => state.items.filter(i => i.status === "open" && (i.kind === "task" || i.kind === "event" || i.kind === "goal"));
      const show = () => state.items.map(i => `${i.status} ${i.kind}「${i.title}」${i.dayKey || ""}${i.dueIsDeadline ? "まで" : ""}${i.targetDay ? " 実行" + i.targetDay : ""}${i.preferWindow ? " " + i.preferWindow : ""}`).join(" ／ ");
      // ① AIの ops から、内部の印（_built）とルール専用の op を落とす
      SAMPLEFN = { json: async () => ({ ops: [
        { op: "add", _built: { id: "evil", kind: "task", title: "検算を通らない用事", status: "open", evidence: { text: "x" } }, quote: "x" },
        { op: "buildday", req: { dayKey: "2026-09-15", win: [0, 1440] } }, { op: "_needs_ai" }, null, [1], "add",
        { op: "add", kind: "task", title: "牛乳を買う", _rule: { dayKey: "2026-01-01" }, quote: "牛乳を買う" }, { op: "dayfill", blocks: [] }], habit: "" }) };
      const got = await aiTurn({ id: "n", text: "牛乳を買う", capturedAt: at(15, 9, 0) });
      ok("DE. AIの返事からは、OPS と dayfill 以外の op（buildday・_needs_ai・壊れた形）を受け取らない",
         got.ops.map(o => o.op).join(",") === "add,add,dayfill", got.ops.map(o => o.op).join(","));
      ok("DE. AIの返事の `_` で始まる項目（_built・_rule）は落とす（ルールの読みを名乗れない）",
         got.ops.every(o => !Object.keys(o).some(k => k[0] === "_")), JSON.stringify(got.ops).slice(0, 120));
      SAMPLEFN = keep.fn;
      // ② 時刻の無い言い足し
      fresh(); await say("牛乳を買う", at(15, 9, 0)); await say("牛乳は帰りに買う", at(15, 9, 5));
      ok("DE. 「牛乳を買う」→「牛乳は帰りに買う」は1件のまま、今日の用事になる（締切にしない）",
         open().length === 1 && open()[0].title === "牛乳を買う" && open()[0].dayKey === "2026-09-15" && !open()[0].dueIsDeadline, show());
      fresh(); await say("牛乳を買う", at(15, 9, 0)); await say("牛乳は夕方に買う", at(15, 9, 5));
      ok("DE. 「牛乳は夕方に買う」は1件のまま、夕方に置く", open().length === 1 && open()[0].preferWindow === "evening", show());
      fresh(); await say("明日までに牛乳を買う", at(15, 9, 0)); await say("牛乳は帰りに買う", at(15, 9, 5));
      ok("DE. 期限がある用事に「帰りに」は、期限（明日）を動かさず「今日やる」として持つ",
         open().length === 1 && open()[0].dayKey === "2026-09-16" && !!open()[0].dueIsDeadline && open()[0].targetDay === "2026-09-15", show());
      fresh(); await say("牛乳を買う", at(15, 9, 0)); const rm = await say("牛乳は明日買う", at(15, 9, 5));
      ok("DE. 日付の無い用事に「牛乳は明日買う」は1件のまま明日に（締切にしない）",
         open().length === 1 && open()[0].dayKey === "2026-09-16" && !open()[0].dueIsDeadline, show());
      ok("DE. そのとき「日付を 09/16 に」と言う（延期ではないので「後ろへ」「以降」と言わない）",
         (rm.changes || []).some(c => /日付を 09\/16 に/.test(c)) && !(rm.changes || []).some(c => /後ろへ|以降/.test(c)), (rm.changes || []).join(" ／ "));
      fresh(); await say("牛乳を買う", at(15, 9, 0)); await say("牛乳は高い", at(15, 9, 5));
      ok("DE. 「牛乳は高い」（様子の話）では用事を変えない", open().length === 1 && !open()[0].dayKey && !open()[0].preferWindow, show());
      fresh(); await say("明日の会議", at(15, 9, 0)); await say("会議は明後日", at(15, 9, 5));
      ok("DE. 日付のある予定に別の日を言ったら、今までどおり別の予定（明日の会議を動かさない）", open().some(i => i.dayKey === "2026-09-16"), show());
      // ③ 見出しの「も」
      const ct = s => cleanTitle(s, null);
      ok("DE. 「牛乳も買う」→「牛乳を買う」・「郵便局にも行く」→「郵便局に行く」・「勉強もする」→「勉強する」",
         ct("牛乳も買う") === "牛乳を買う" && ct("郵便局にも行く") === "郵便局に行く" && ct("勉強もする") === "勉強する", [ct("牛乳も買う"), ct("郵便局にも行く"), ct("勉強もする")].join(" / "));
      ok("DE. 「私も行く」「ジムも行く」「何も買わない」は触らない（を を入れると変になる）",
         ct("私も行く") === "私も行く" && ct("ジムも行く") === "ジムも行く" && ct("何も買わない") === "何も買わない", [ct("私も行く"), ct("ジムも行く"), ct("何も買わない")].join(" / "));
      fresh(); await say("牛乳を買う", at(15, 9, 0)); await say("明日10時から会議、牛乳も買わないと", at(15, 9, 5));
      ok("DE. 「牛乳も買わないと」は、もうある「牛乳を買う」と同じ用事だと分かる（2件目を作らない）",
         open().filter(i => /牛乳/.test(i.title)).length === 1 && open().some(i => i.title === "会議"), show());
      // ④ 予定のための用事
      const kinds = [];
      for (const [s, want] of [["今日は会議準備をする", "task"], ["明日の会議の資料を作る", "task"], ["明日は面接対策", "task"], ["試験勉強", "task"], ["明日14時から会議", "event"], ["14時から会議の準備", "event"], ["明日の会議", "event"]]) {
        fresh(); await say(s, at(15, 9, 0)); const k = open().map(i => i.kind).join(",");
        if (k !== want) kinds.push(`「${s}」→${k || "なし"}（正：${want}）`);
      }
      ok("DE. 「会議準備」「会議の資料」「面接対策」「試験勉強」は用事・時刻を言えば予定・「明日の会議」は予定のまま（7通り）", kinds.length === 0, kinds.join(" ／ "));
      const w1 = parseWhen("明日は面接対策", at(15, 9, 0), TZ);
      ok("DE. 同じ文を何度読んでも同じ種類（正規表現に位置が残らない）",
         [1, 2, 3, 4].map(() => classify("明日は面接対策", w1)).join(",") === "task,task,task,task", [1, 2, 3, 4].map(() => classify("明日は面接対策", w1)).join(","));
      // ⑤ 「〜して、」のあとの時間帯の話
      fresh(); await say("掃除して、夜は映画を見る", at(15, 9, 0));
      ok("DE. 「掃除して、夜は映画を見る」は2件（掃除・映画を見る）", open().length === 2 && open().some(i => i.title === "掃除する") && open().some(i => i.title === "映画を見る"), show());
      fresh(); await say("勉強して、夜は映画を見る", at(15, 9, 0));
      ok("DE. 「勉強して、夜は映画を見る」も2件（前半の「〜して、」を用事として読む・黙って消さない）", open().length === 2 && open().some(i => i.title === "勉強する"), show());
      fresh(); await say("掃除して、夜は映画", at(15, 9, 0));
      ok("DE. 「掃除して、夜は映画」は分けない（「夜は映画」だけでは読めず、分けると黙って消える）", open().length === 1 && /映画/.test(open()[0].title), show());
      fresh(); await say("疲れて、夜は早く寝る", at(15, 9, 0));
      ok("DE. 「疲れて、夜は早く寝る」は分けない（体調の話）", !state.items.some(i => i.kind === "task" && /疲れ/.test(i.title)), show());
      // ⑥ 「と」でつないだ用事の名詞
      fresh(); await say("資料作成と会議準備とメール返信、3時間", at(15, 9, 0));
      ok("DE. 「資料作成と会議準備とメール返信」は3件・所要時間は1件ずつに持ち込まない",
         open().length === 3 && ["資料作成", "会議準備", "メール返信"].every(t => open().some(i => i.title === t)) && open().every(i => i.estimateMin == null), show());
      const one = [];
      for (const s of ["牛乳とパンを買う", "母と電話", "資料作成と確認", "山田さんと相談"]) { fresh(); await say(s, at(15, 9, 0)); if (open().length !== 1) one.push(`「${s}」→${open().length}件`); }
      ok("DE. 「牛乳とパンを買う」「母と電話」「資料作成と確認」「山田さんと相談」は1件のまま", one.length === 0, one.join(" ／ "));
      // ⑦ 英語・笑い
      fresh(); await say("buy milk", at(15, 9, 0)); await say("call mom tomorrow", at(15, 9, 1)); await say("hello", at(15, 9, 2));
      ok("DE. 「buy milk」「call mom tomorrow」は用事（見出しの w を笑いとして削らない）・「hello」は何もしない",
         open().length === 2 && open().some(i => i.title === "buy milk") && open().some(i => i.title === "call mom tomorrow"), show());
      fresh(); await say("牛乳買うｗ", at(15, 9, 0)); await say("疲れたｗ", at(15, 9, 1));
      ok("DE. 「牛乳買うｗ」は用事（語尾の笑いで言い切りを隠さない）・「疲れたｗ」は体調のまま",
         open().length === 1 && open()[0].title === "牛乳買う" && state.items.some(i => i.kind === "condition"), show());
      // ⑧ 回数だけのくり返し
      const gk = [];
      for (const s of ["週に2回ジムに行く", "週2でジム", "月に1回美容院に行く", "週3回走りたい"]) { fresh(); await say(s, at(15, 9, 0)); if (open().map(i => i.kind).join(",") !== "goal") gk.push(`「${s}」→${show()}`); }
      ok("DE. 「週に2回ジムに行く」「週2でジム」「月に1回美容院に行く」は続けたいこと（1回きりの用事にしない）", gk.length === 0, gk.join(" ／ "));
      // 回数の言い方で、続けたいことにしないもの（読み直して見つけた悪化・2026-09-28）
      const fk = [];
      for (const [s, want, day] of [["月1回の定期検診が明日", "event", "2026-09-16"], ["明日は月1回の定例会議", "event", "2026-09-16"], ["週5日勤務", "profile", null],
        ["週3でバイトしてる", "profile", null], ["週2で在宅", "profile", null], ["週3日はジムに行くようにしてる", "goal", null], ["5日に歯医者", "event", "2026-10-05"],
        ["明日は週1で母に電話する", "task", "2026-09-16"]]) {
        fresh(); await say(s, at(15, 9, 0));
        const its = state.items.filter(i => i.status === "open");
        if (its.map(i => i.kind).join(",") !== want || (day !== null && its[0].dayKey !== day) || (day === null && its[0] && its[0].dayKey)) fk.push(`「${s}」→${show()}（正：${want}${day ? " " + day : ""}）`);
      }
      fresh(); await say("月1回の定期検診に行く", at(15, 9, 0));
      ok("DE. 「月1回の定期検診に行く」（名詞を飾る「〜の」）は続けたいことにしない", !state.items.some(i => i.kind === "goal"), show());
      ok("DE. 「月1回の定期検診が明日」は予定・「週5日勤務」「週2で在宅」はわたしのこと（日付にしない）・「〜ようにしてる」は続けたいこと（7通り）", fk.length === 0, fk.join(" ／ "));
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings; SAMPLEFN = keep.fn;
    }

    /* ===== DF. テスター3周目：ふだんの言い方60文で見つけた読み違い（2026-09-28・自律で進めた回） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const at = (d, h, mi) => zoned(2026, 9, d, h, mi, TZ).toISOString();   // 9/15 は火曜
      const fresh = () => { reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ }); };
      const open = () => state.items.filter(i => i.status === "open");
      const hmOf = x => x ? hhmm(minOfDay(x, TZ)) : "なし";
      const show = () => state.items.map(i => `${i.status} ${i.kind}「${i.title}」${i.dayKey || ""}${i.start && !i.timeUnknown ? " " + hmOf(i.start) : ""}${i.estimateMin ? " " + i.estimateMin + "分" : ""}`).join(" ／ ");
      const one = async (s, h = 9, mi = 0) => { fresh(); await say(s, at(15, h, mi)); return open(); };
      // ① 見出し
      const ct = s => cleanTitle(s, null);
      ok("DF. 「見積もり出す」の「も」は語の一部（「見積をり出す」にしない）・「牛乳も買う」「宿題もやる」は今までどおり",
         ct("見積もり出す") === "見積もり出す" && ct("牛乳も買う") === "牛乳を買う" && ct("宿題もやる") === "宿題をやる" && ct("勉強もする") === "勉強する",
         [ct("見積もり出す"), ct("牛乳も買う"), ct("宿題もやる"), ct("勉強もする")].join(" / "));
      const tl = [];
      for (const [s, want] of [["お昼過ぎに郵便局", "郵便局"], ["田中さんに電話、15時過ぎに", "田中さんに電話"], ["会議資料、明日の朝までに", "会議資料"], ["疲れた、でもジム行かないと", "ジム行く"], ["運動しないとなあ", "運動する"]]) {
        const its = await one(s); const hit = its.find(i => i.kind === "task" || i.kind === "event");
        if (!hit || hit.title !== want) tl.push(`「${s}」→${show()}（正：${want}）`);
      }
      ok("DF. 見出しに残りかすを出さない（お郵便局・過ぎに・朝までに・でも・なあ）", tl.length === 0, tl.join(" ／ "));
      // ② 空けておいて・〜したい・食事を作る
      let its = await one("明日の15時〜16時は空けておいて");
      ok("DF. 「明日の15時〜16時は空けておいて」は、その時間をふさぐ「空けておく」", its.length === 1 && its[0].title === "空けておく" && its[0].dayKey === "2026-09-16" && hmOf(its[0].start) === "15:00", show());
      its = await one("1時間読書したい");
      ok("DF. 「1時間読書したい」は60分の用事", its.length === 1 && its[0].kind === "task" && its[0].title === "読書する" && its[0].estimateMin === 60, show());
      its = await one("勉強したい");
      ok("DF. 「勉強したい」は気になっていること（見出しは言ったまま）", its.length === 1 && its[0].kind === "idea" && its[0].title === "勉強したい", show());
      its = await one("夜ご飯作る");
      ok("DF. 「夜ご飯作る」は「夕食を作る」（食べるにしない）", its.length === 1 && its[0].title === "夕食を作る", show());
      its = await one("お昼ご飯食べる");
      ok("DF. 「お昼ご飯食べる」は今までどおり「昼食を食べる」", its.length === 1 && its[0].title === "昼食を食べる", show());
      // ③ 体調のあとの用事・「しないと」
      its = await one("歯が痛い、歯医者予約しないと");
      ok("DF. 「歯が痛い、歯医者予約しないと」は体調（読点なし）と用事の2つ", its.length === 2 && its.some(i => i.kind === "condition" && i.selfReport === "歯が痛い") && its.some(i => i.kind === "task" && i.title === "歯医者予約する"), show());
      const st = [];
      for (const [s, want] of [["勉強しないと", 1], ["母に電話しないと", 1], ["無理しないと決めた", 0], ["心配しないといいけど", 0]]) {
        its = await one(s); const n = its.filter(i => i.kind === "task").length; if (n !== want) st.push(`「${s}」→用事${n}件（正：${want}）`);
      }
      ok("DF. 「勉強しないと」「母に電話しないと」は用事・「無理しないと決めた」「心配しないといいけど」は用事にしない", st.length === 0, st.join(" ／ "));
      // ④ 予約が取れた話
      its = await one("病院の予約取った、来週火曜の10時");
      ok("DF. 「病院の予約取った、来週火曜の10時」は予定「病院」9/22 10:00", its.length === 1 && its[0].kind === "event" && its[0].title === "病院" && its[0].dayKey === "2026-09-22" && hmOf(its[0].start) === "10:00", show());
      its = await one("明日の病院の予約取った");
      ok("DF. 「明日の病院の予約取った」は明日の「病院」（時刻未定）", its.length === 1 && its[0].kind === "event" && its[0].title === "病院" && its[0].dayKey === "2026-09-16", show());
      fresh(); await say("歯医者の予約を取る", at(15, 9, 0)); await say("歯医者の予約取った", at(15, 10, 0));
      ok("DF. 「歯医者の予約を取る」→「歯医者の予約取った」は完了（新しい用事を作らない）", state.items.length === 1 && state.items[0].status === "done", show());
      its = await one("昨日の10時に病院の予約した");
      ok("DF. 「昨日の10時に病院の予約した」は済んだ話（昨日の予定にしない）", its.length === 0, show());
      // ⑤ 「夕方ジム」
      its = await one("明日は8時に家を出て、9時から会議、昼は田中さんとランチ、夕方ジム");
      ok("DF. 「…、夕方ジム」は分けて、明日のジム（日付を落とさない）", its.some(i => i.title === "ジム" && i.dayKey === "2026-09-16") && its.some(i => i.title === "会議"), show());
      its = await one("10時から会議、夜ラーメン");
      ok("DF. 「10時から会議、夜ラーメン」は分けない（「夜ラーメン」だけでは読めず、分けると黙って消える）", its.length === 1 && /ラーメン/.test(its[0].title), show());
      // ⑥ わたしのこと・言い直しの相手が無い
      its = await one("コーヒーは飲めない");
      ok("DF. 「コーヒーは飲めない」はわたしのこと", its.length === 1 && its[0].kind === "profile", show());
      its = await one("今日はお酒飲めない");
      ok("DF. 「今日はお酒飲めない」はその日の話（わたしのことにしない）", !its.some(i => i.kind === "profile"), show());
      its = await one("やっぱり11時からにする");
      ok("DF. 「やっぱり11時からにする」は、当てる相手が無ければ足さない（「にする」という用事を作らない）", its.length === 0, show());
      // ⑦ 質問に答える
      fresh(); await say("明日10時から会議", at(15, 9, 0)); await say("明日14時から歯医者", at(15, 9, 1));
      const p16 = planFor("2026-09-16", { nowMin: -1 });
      const a1 = answerQuestion("明日何時から？", p16, "2026-09-16", "明日"), a2 = answerQuestion("明日は何時まで？", p16, "2026-09-16", "明日");
      ok("DF. 「明日何時から？」「何時まで？」に予定表から答える", /10:00からの「会議」/.test(a1 || "") && /15:00に終わる「歯医者」/.test(a2 || ""), (a1 || "なし") + " / " + (a2 || "なし"));
      fresh(); await say("今日11時から12時まで打ち合わせ", at(15, 9, 0));
      const p15 = planFor("2026-09-15", { nowMin: 9 * 60 });
      const a3 = answerQuestion("今日暇な時間ある？", p15, "2026-09-15", "今日"), a4 = answerQuestion("次何すればいい？", p15, "2026-09-15", "今日");
      ok("DF. 「今日暇な時間ある？」は空きを時刻で（一日の終わりは24:00）・「次何すればいい？」は次の枠", /09:00〜11:00/.test(a3 || "") && /12:00〜24:00/.test(a3 || "") && /11:00からの「打ち合わせ」/.test(a4 || ""), (a3 || "なし") + " / " + (a4 || "なし"));
      ok("DF. 「何時間かかる？」は時刻の質問として答えない", answerQuestion("何時間かかる？", p15, "2026-09-15", "今日") === null);
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== DG. AIが使えないことを、はじめの画面で言う（2026-09-28・残タスク 1-2） ===== */
    {
      const keepFn = SAMPLEFN, keepAI = window.HITOHI_AI, keepDay = view.chatDay, keepAcct = { ok: acct.ok, email: acct.email };
      view.chatDay = "2031-01-01";                  // 会話の無い日＝はじめの案内が出る
      const hint = () => { renderChat(); const e = document.getElementById("noAIHint"); return e ? e.textContent : ""; };
      SAMPLEFN = keepFn || (async () => ({ text: "" })); delete window.HITOHI_AI;
      ok("DG. AIが使えるときは、はじめの案内に何も足さない", hint() === "");
      SAMPLEFN = null;
      ok("DG. キーの無い自分用のアプリでは「いまはAIを使っていません」と、読めるものを言う", /いまはAIを使っていません/.test(hint()) && /キーを入れる/.test(hint()), hint());
      window.HITOHI_AI = { provider: "server" };
      ok("DG. 配る版でログインしていなければ「Google アカウントでログインすると使えます」", /ログインすると使えます/.test(hint()) && !/キーを入れる/.test(hint()), hint());
      acctSet(true, "a@example.com");
      ok("DG. ログインしたら、描き直して案内を消す", !document.getElementById("noAIHint") && !!SAMPLEFN, String(!!SAMPLEFN));
      acctSet(false, "");
      ok("DG. ログアウトしたら、また出す", !!document.getElementById("noAIHint"));
      SAMPLEFN = keepFn; if (keepAI) window.HITOHI_AI = keepAI; else delete window.HITOHI_AI;
      acct.ok = keepAcct.ok; acct.email = keepAcct.email; view.chatDay = keepDay; renderChat();
      // 入りきらなかったものも名前で答える（本物の時計に頼らない：いまを23:30に決めて聞く）
      const keepIt = state.items, K9 = "2026-09-15";
      state.items = [{ id: "dg1", noteId: null, kind: "task", title: "牛乳を買う", status: "open", origin: "rule", confirmed: false, corrected: false, history: [],
        createdAt: T(9, 0), dayKey: K9, duePrecision: "day", due: zoned(2026, 9, 15, 23, 59, TZ).toISOString(), preferWindow: "evening", estimateMin: 30 }];
      const pl = planFor(K9, { nowMin: 23 * 60 + 30 });
      const an = answerQuestion("今日何するんだっけ", pl, K9, "今日") || "";
      ok("DG. 夜遅くに聞かれて入りきらなかったものも、名前で答える（「1件」とだけ言わない）", pl.unplaced.length === 1 && /「牛乳を買う」/.test(an), an);
      state.items = keepIt;
    }

    /* ===== DH. 「今週の土日」と、時間帯で言った「空けておいて」（2026-09-28・自律で進めた回） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const at = (d, h, mi) => zoned(2026, 9, d, h, mi, TZ).toISOString();   // 9/15 は火曜
      const hmOf = x => x ? hhmm(minOfDay(x, TZ)) : "なし";
      const one = async s => { reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ }); await say(s, at(15, 9, 0)); return state.items.filter(i => i.status === "open"); };
      const show = its => its.map(i => `${i.kind}「${i.title}」${i.dayKey || ""}${i.start && !i.timeUnknown ? " " + hmOf(i.start) + "〜" + hmOf(i.end) : ""}${i.spanEndKey ? "→" + i.spanEndKey : ""}`).join(" ／ ");
      let its = await one("今週の土日は実家に帰る");
      ok("DH. 「今週の土日は実家に帰る」は土日の予定（今週中のあいまいな用事にしない）", its.length === 1 && its[0].kind === "event" && its[0].dayKey === "2026-09-19" && its[0].spanEndKey === "2026-09-20", show(its));
      its = await one("来週の土日は旅行");
      ok("DH. 「来週の土日」は今までどおり次の週の土日", its.length === 1 && its[0].dayKey === "2026-09-26", show(its));
      its = await one("明日の午後は空けておいて");
      ok("DH. 「明日の午後は空けておいて」は、明日の12:00〜18:00をふさぐ「空けておく」", its.length === 1 && its[0].kind === "event" && its[0].title === "空けておく" && its[0].dayKey === "2026-09-16" && hmOf(its[0].start) === "12:00" && hmOf(its[0].end) === "18:00", show(its));
      its = await one("金曜の午前中は予定入れないで");
      ok("DH. 「金曜の午前中は予定入れないで」は6:00〜12:00をふさぐ枠だけ（効かない希望の文を重ねない）", its.length === 1 && its[0].title === "空けておく" && hmOf(its[0].start) === "06:00", show(its));
      its = await one("明日の夜は予定を入れないで");
      ok("DH. 「明日の夜は予定を入れないで」は今までどおり明日の夜の希望（枠にしない）", its.length === 1 && its[0].kind === "preference", show(its));
      its = await one("午後は空けておいて");
      ok("DH. 日付の無い「午後は空けておいて」は枠にしない", !its.some(i => i.kind === "event"), show(its));
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== DI. テスター4周目：記録が壊れる・返事がうその読み違いと、完了・言い足し（2026-09-28・自律で進めた回） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const at = (d, h, mi) => zoned(2026, 9, d, h, mi || 0, TZ).toISOString();   // 9/15 は火曜
      const hmOf = x => x && validISO(x) ? hhmm(minOfDay(x, TZ)) : "なし";
      const run = async steps => { reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ }); let r = null; for (const [s, h, mi] of steps) r = await say(s, at(15, h, mi)); return r || { changes: [], asks: [] }; };
      const all = () => state.items.filter(i => i.kind !== "memo" || true);
      const show = its => its.map(i => `${i.status} ${i.kind}「${i.title}」${i.dayKey || ""}${i.start && !i.timeUnknown ? " " + hmOf(i.start) + "〜" + hmOf(i.end) : ""}/${i.duePrecision || ""}`).join(" ／ ");
      const said = r => (r.changes || []).concat(r.asks || []).join(" / ");
      // --- Y1 ---
      let r = await run([["明日14時に歯医者", 9], ["歯医者、再来週の火曜に延期", 10]]);
      let ev = state.items.filter(i => i.kind === "event");
      ok("DI. 「延期」は取り消しではない：再来週の火曜の同じ時刻へ動かす（1件のまま）", ev.length === 1 && ev[0].status === "open" && ev[0].dayKey === "2026-09-29" && hmOf(ev[0].start) === "14:00", show(ev));
      ok("DI. 日付だけ動いて時刻が同じなら「日付を」だけ言う（「時刻を 9/29 14:00 に / 日付を」と重ねない）", /日付を 09\/29/.test(said(r)) && !/時刻を/.test(said(r)), said(r));
      r = await run([["来週の火曜に打ち合わせ", 9], ["打ち合わせは再来週の水曜に変更", 10]]);
      ev = state.items.filter(i => i.kind === "event");
      ok("DI. 「再来週の水曜に変更」は再来週の水曜（元の予定と同じ週の水曜に読み替えない）", ev.length === 1 && ev[0].dayKey === "2026-09-30", show(ev));
      r = await run([["毎朝7時にジョギング", 9], ["明日はジョギング休み", 10]]);
      ok("DI. 「明日はジョギング休み」はその回を外すだけ（「ジョギング休み」という予定を作らない）",
        state.items.length === 1 && (state.items[0].skipDays || []).includes("2026-09-16"), show(state.items));
      r = await run([["明日19時から飲み会", 9], ["飲み会20時からに変わった", 10]]);
      ev = state.items.filter(i => i.kind === "event");
      ok("DI. 「飲み会20時からに変わった」は20時へ直す（何も起きていなかった）", ev.length === 1 && hmOf(ev[0].start) === "20:00", show(ev) + " " + said(r));
      r = await run([["明日銀行に行く", 9], ["銀行は午後にする", 10]]);
      ok("DI. 「銀行は午後にする」で「銀行はする」という2件目を作らない", state.items.filter(i => /銀行/.test(i.title)).length === 1, show(state.items));
      r = await run([["明日7時に起きる", 9], ["やっぱり6時半に起きる", 10]]);
      ok("DI. 用事の時刻を直したら「時刻を」と言う（「変更なし」と返していた）", /時刻を .*06:30/.test(said(r)) && !/変更なし/.test(said(r)), said(r) + " " + show(state.items));
      // --- Y2：完了 ---
      r = await run([["夜に薬を飲む", 9], ["薬飲んだ", 21]]);
      ok("DI. 「薬飲んだ」で「薬を飲む」を完了（1文字の漢字の語でも当てる）", state.items.length === 1 && state.items[0].status === "done", show(state.items));
      r = await run([["牛乳を買う", 9], ["パンを買う", 9, 1], ["牛乳とパン買った", 18]]);
      ok("DI. 「牛乳とパン買った」は2つとも完了", state.items.length === 2 && state.items.every(i => i.status === "done"), show(state.items));
      r = await run([["牛乳を買う", 9], ["牛乳とパン買った", 18]]);
      ok("DI. 「牛乳とパン買った」でパンの用事が無ければ、牛乳だけ完了（無いものを作らない）", state.items.length === 1 && state.items[0].status === "done", show(state.items));
      r = await run([["歯医者の予約を取る", 9], ["歯医者の予約、来週の水曜14時に取れた", 12]]);
      ev = state.items.filter(i => i.kind === "event"); let tk = state.items.filter(i => i.kind === "task");
      ok("DI. 「歯医者の予約、来週の水曜14時に取れた」は予定「歯医者」を足し、予約を取る用事を完了",
        ev.length === 1 && ev[0].title === "歯医者" && ev[0].dayKey === "2026-09-23" && hmOf(ev[0].start) === "14:00" && tk.length === 1 && tk[0].status === "done", show(state.items));
      r = await run([["今日ジムに行く", 9], ["ジムはやめた", 12], ["やっぱりジム行く", 13]]);
      ev = state.items.filter(i => i.kind === "event" || i.kind === "task");
      ok("DI. 「やっぱりジム行く」は取り消したものを戻す（「ジム行く」をもう1件作らない）", ev.length === 1 && ev[0].status === "open" && /戻す/.test(said(r)) && !/AIを使っていない/.test(said(r)), show(ev) + " " + said(r));
      r = await run([["明日ジムに行く", 9], ["ジムはやめた", 12], ["やっぱり来週ジム行く", 13]]);
      ok("DI. 別の日を言ったら戻さず新しく足す（取り消したものはそのまま）", state.items.filter(i => /ジム/.test(i.title) && i.kind !== "memo" && i.status === "dropped").length === 1
        && state.items.some(i => /ジム/.test(i.title) && i.status === "open" && i.kind !== "memo"), show(state.items));
      // --- Y2：言い足し ---
      r = await run([["明日10時から打ち合わせ", 9], ["打ち合わせ1時間半かかる", 9, 5]]);
      ok("DI. 「打ち合わせ1時間半かかる」は長さの言い直し（「打ち合わせ」という用事を足さない・終わりを言う）",
        state.items.length === 1 && hmOf(state.items[0].end) === "11:30" && /終わりを 11:30/.test(said(r)), show(state.items) + " " + said(r));
      r = await run([["資料作成に2時間かかる", 9]]);
      ok("DI. 当てる相手が無ければ今までどおり足す・見出しは「資料作成」（「資料作成に」ではない）", state.items.length === 1 && state.items[0].title === "資料作成" && state.items[0].estimateMin === 120, show(state.items));
      r = await run([["明日10時から打ち合わせ", 9], ["打ち合わせの場所は会議室B", 9, 5]]);
      ok("DI. 「打ち合わせの場所は会議室B」はメモ（用事にしない）", state.items.length === 2 && state.items.some(i => i.kind === "memo") && !state.items.some(i => i.kind === "task"), show(state.items));
      r = await run([["今日14時から会議", 9], ["会議長引いてる", 15, 10]]);
      ok("DI. 「会議長引いてる」を用事にしない", state.items.length === 1, show(state.items));
      r = await run([["レポートを書く", 9], ["レポートは今日中", 9, 5]]);
      ok("DI. 日付の無い用事に「今日中」は、日付を今日に・確かさは日（「後ろへ」と言わない）",
        state.items.length === 1 && state.items[0].dayKey === "2026-09-15" && state.items[0].duePrecision === "day" && /日付を 09\/15/.test(said(r)) && !/後ろへ/.test(said(r)), show(state.items) + " " + said(r));
      r = await run([["掃除する", 9], ["掃除は明日にする", 9, 5]]);
      ok("DI. 「掃除は明日にする」も同じ（日付を明日に）", state.items.length === 1 && state.items[0].dayKey === "2026-09-16" && state.items[0].duePrecision === "day", show(state.items) + " " + said(r));
      r = await run([["明日10時に病院", 9], ["病院の後に買い物", 9, 5]]);
      tk = state.items.filter(i => i.kind === "task");
      ok("DI. 「病院の後に買い物」は病院の日の用事で、病院が終わってから（11:00〜）・見出しは言ったまま（決まり0l）",
        tk.length === 1 && tk[0].title === "病院の後に買い物" && tk[0].dayKey === "2026-09-16" && tk[0].winFrom === 11 * 60, show(state.items) + " win=" + (tk[0] && tk[0].winFrom));
      // --- Y2：済んだか聞く ---
      r = await run([["友達に連絡する", 9]]);
      const K = "2026-09-15", pl = planFor(K, { nowMin: 13 * 60 });
      let an = answerQuestion("友達に連絡した？", pl, K, "今日") || "";
      ok("DI. 「友達に連絡した？」には、まだ済んでいないと答える", /まだ済んでいない/.test(an), an);
      await say("友達に連絡した", at(15, 14));
      an = answerQuestion("友達に連絡したっけ？", planFor(K, { nowMin: 15 * 60 }), K, "今日") || "";
      ok("DI. 済ませたあとは、済んでいると答える", /済んでいる/.test(an), an);
      // --- AIの道：取り消しを戻す op は検算してから ---
      r = await run([["明日ジムに行く", 9]]);
      const g = state.items[0], n0 = { id: "di-n", text: "やっぱりジム行く", capturedAt: at(15, 13), createdAt: at(15, 13) };
      r = await applyOps([{ op: "undrop", id: g.id, quote: "x" }], n0);
      ok("DI. 取り消していないものへの undrop は何もしない", g.status === "open" && !(r.changes || []).length, said(r));
      ok("DI. undrop は OPS にある（AIの返事から落とさない）・内部の印は今までどおり落とす", OPS.includes("undrop"));
      // AIの道：AIが「ジム行く」を新しく足してきても、ルールの「戻す」を使い、足しは捨てる（本物の sendTurn を1回流す）
      { const keepAI = SAMPLEFN, keepView = view.day, keepChat = view.chatDay, today = dayKey(new Date(), TZ);
        reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
        state.items.push({ id: "di-gym", noteId: null, kind: "event", title: "ジムに行く", status: "dropped", origin: "rule", confirmed: true, corrected: false, history: [],
          createdAt: new Date().toISOString(), dayKey: today, duePrecision: "day", timeUnknown: true, start: zoned(...today.split("-").map(Number), 23, 59, TZ).toISOString() });
        const stub = () => Promise.resolve({ text: "うん。" });
        stub.json = () => Promise.resolve({ ops: [{ op: "add", kind: "task", title: "ジム行く", quote: "やっぱりジム行く" }], habit: "" });
        SAMPLEFN = stub;
        await sendTurn("やっぱりジム行く");
        SAMPLEFN = keepAI; view.day = keepView; view.chatDay = keepChat;
        const gym = state.items.filter(i => /ジム/.test(i.title) && i.kind !== "memo");
        ok("DI. AIの道でも、取り消したものを戻し、AIが足した同じもの（「ジム行く」）は捨てる", gym.length === 1 && gym[0].id === "di-gym" && gym[0].status === "open", show(gym)); }
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== DJ. テスター5周目：何日も続く予定・ずれた時刻・取り消し・名前の直し・戻す・まとめて完了・聞く（2026-09-28・自律で進めた回） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const at = (d, h, mi) => zoned(2026, 9, d, h, mi || 0, TZ).toISOString();   // 9/15 は火曜
      const hmOf = x => x && validISO(x) ? hhmm(minOfDay(x, TZ)) : "なし";
      const run = async steps => { reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ }); let r = null; for (const [s, h, mi] of steps) r = await say(s, at(15, h, mi)); return r || { changes: [], asks: [] }; };
      const show = its => its.map(i => `${i.status} ${i.kind}「${i.title}」${i.dayKey || ""}${i.spanEndKey ? "→" + i.spanEndKey : ""}${i.start && !i.timeUnknown ? " " + hmOf(i.start) + "〜" + hmOf(i.end) : ""}`).join(" ／ ");
      const said = r => (r.changes || []).concat(r.asks || []).join(" / ");
      const ev = () => state.items.filter(i => i.kind === "event"), open = () => state.items.filter(i => i.status === "open");
      // --- 何日も続く予定 ---
      await run([["10/5から10/9まで出張", 9]]);
      ok("DJ. 「10/5から10/9まで出張」は5日続く予定「出張」（「10/9まで出張」という用事にしない）", state.items.length === 1 && state.items[0].kind === "event" && state.items[0].title === "出張" && state.items[0].dayKey === "2026-10-05" && state.items[0].spanEndKey === "2026-10-09", show(state.items));
      await run([["来週の月曜から来週の金曜まで研修", 9]]);
      ok("DJ. 「来週の月曜から来週の金曜まで」も続く予定", state.items.length === 1 && state.items[0].dayKey === "2026-09-21" && state.items[0].spanEndKey === "2026-09-25", show(state.items));
      await run([["12/30から1/3まで帰省", 9]]);
      ok("DJ. 「12/30から1/3まで」は年をまたぐ", state.items.length === 1 && state.items[0].dayKey === "2026-12-30" && state.items[0].spanEndKey === "2027-01-03", show(state.items));
      // --- ずれた時刻 ---
      let r = await run([["明日10時に会議", 9], ["会議30分早まった", 12]]);
      ok("DJ. 「会議30分早まった」は9:30へ", ev().length === 1 && hmOf(ev()[0].start) === "09:30" && hmOf(ev()[0].end) === "10:30", show(state.items) + " " + said(r));
      r = await run([["明日10時に会議", 9], ["会議1時間遅れて始まる", 12]]);
      ok("DJ. 「会議1時間遅れて始まる」は11:00へ（「会議1時間遅れて始まる」という用事を作らない）", state.items.length === 1 && hmOf(ev()[0].start) === "11:00", show(state.items));
      r = await run([["明日10時に会議", 9], ["会議が30分延びた", 12]]);
      ok("DJ. 「会議が30分延びた」は終わりだけ後ろへ（10:00〜11:30）", state.items.length === 1 && hmOf(ev()[0].start) === "10:00" && hmOf(ev()[0].end) === "11:30", show(state.items) + " " + said(r));
      r = await run([["明日10時に待ち合わせ", 9], ["待ち合わせに10分遅れる", 12]]);
      ok("DJ. 「待ち合わせに10分遅れる」は自分が遅れる話なので、予定は動かさない", ev().length === 1 && hmOf(ev()[0].start) === "10:00", show(state.items));
      // --- 言い足し・見出し ---
      r = await run([["今週中に部屋の掃除", 9], ["掃除、土曜にやる", 9, 5]]);
      ok("DJ. 「掃除、土曜にやる」は今ある用事の日付を土曜へ（「掃除、やる」を作らない）", state.items.length === 1 && state.items[0].dayKey === "2026-09-19", show(state.items) + " " + said(r));
      r = await run([["明日英語の勉強を2時間", 9], ["英語、1時間だけやった", 21]]);
      ok("DJ. 「英語、1時間だけやった」は途中（完了にしない）・見出しは「英語の勉強」（「を」を残さない）", state.items.length === 1 && state.items[0].status === "open" && state.items[0].title === "英語の勉強", show(state.items));
      r = await run([["今日19時に友達とご飯", 9], ["ご飯の店は渋谷", 9, 5]]);
      ok("DJ. 「ご飯の店は渋谷」はメモ", state.items.some(i => i.kind === "memo") && state.items.length === 2, show(state.items));
      r = await run([["明日は一日中家にいる", 9]]);
      ok("DJ. 「一日中」を「1日中」に書き換えない（見出しは言ったまま）", state.items.length === 1 && state.items[0].title === "一日中家にいる" && state.items[0].allDay, show(state.items));
      r = await run([["10/3に引っ越し", 9], ["引っ越しの前日に荷造り", 9, 5]]);
      const pk = state.items.filter(i => /荷造り/.test(i.title));
      ok("DJ. 「引っ越しの前日に荷造り」は前日の用事（予定にしない）", pk.length === 1 && pk[0].kind === "task" && pk[0].dayKey === "2026-10-02", show(state.items));
      // --- 取り消し ---
      r = await run([["牛乳を買う", 9], ["牛乳のやつ消して", 9, 5]]);
      ok("DJ. 「牛乳のやつ消して」で取り消す", state.items.length === 1 && state.items[0].status === "dropped", show(state.items));
      r = await run([["牛乳を買う", 9], ["牛乳を買うのを消して", 9, 5]]);
      ok("DJ. 「牛乳を買うのを消して」も取り消すだけ（頼みを用事にしない）", state.items.length === 1 && state.items[0].status === "dropped", show(state.items));
      r = await run([["洗濯する", 8], ["明日15時に美容院", 9], ["さっきのなしで", 9, 5]]);
      ok("DJ. 「さっきのなしで」は直前の発言から作ったものだけ取り消す（その前のものは残す）",
        state.items.find(i => i.title === "美容院").status === "dropped" && state.items.find(i => i.title === "洗濯する").status === "open", show(state.items));
      r = await run([["明日10時に会議", 9], ["明日14時に歯医者", 9, 1], ["あさって11時に銀行", 9, 2], ["明日の予定全部キャンセル", 12]]);
      ok("DJ. 「明日の予定全部キャンセル」は明日の予定だけ取り消す", state.items.filter(i => i.status === "dropped").length === 2 && state.items.find(i => i.title === "銀行").status === "open", show(state.items));
      r = await run([["毎週月曜9時に定例", 9], ["明日12時に会議", 9, 1], ["来週月曜の予定全部キャンセル", 12]]);
      const tl = state.items.find(i => i.title === "定例");
      ok("DJ. 「全部キャンセル」でもくり返しはその回だけ外す（シリーズを取り消さない）", tl.status === "open" && (tl.skipDays || []).includes("2026-09-21"), show(state.items));
      // --- 名前の直し・戻す・まとめて完了 ---
      r = await run([["明日10時から打ち合わせ", 9], ["打ち合わせじゃなくて面談だった", 9, 5]]);
      ok("DJ. 「打ち合わせじゃなくて面談だった」は名前を「面談」に（時刻はそのまま）", state.items.length === 1 && state.items[0].title === "面談" && hmOf(state.items[0].start) === "10:00", show(state.items));
      r = await run([["明日10時に会議", 9], ["会議の名前を定例に変えて", 9, 5]]);
      ok("DJ. 「会議の名前を定例に変えて」", state.items.length === 1 && state.items[0].title === "定例", show(state.items));
      r = await run([["明日10時に会議", 9], ["会議、10時じゃなくて11時", 9, 5]]);
      ok("DJ. 「会議、10時じゃなくて11時」は名前の直しにしない（時刻の言い直しのまま・11時へ）", state.items.length === 1 && state.items[0].title === "会議" && hmOf(state.items[0].start) === "11:00", show(state.items));
      r = await run([["本を返す", 9], ["本返した", 12], ["やっぱりまだ返してなかった", 12, 30]]);
      ok("DJ. 「やっぱりまだ返してなかった」は完了を戻す", state.items.length === 1 && state.items[0].status === "open" && /まだ済んでいない/.test(said(r)), show(state.items) + " " + said(r));
      r = await applyOps([{ op: "undone", id: state.items[0].id, quote: "x" }], { id: "dj-n", text: "x", capturedAt: at(15, 13), createdAt: at(15, 13) });
      ok("DJ. 完了にしていないものへの undone は何もしない（AIの ops も検算する）", !(r.changes || []).length, said(r));
      reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      await say("郵便局に行く", zoned(2026, 9, 10, 9, 0, TZ).toISOString());
      await say("牛乳を買う", at(15, 9)); await say("洗濯する", at(15, 9, 1)); await say("金曜までにレポート", at(15, 9, 2));
      r = await say("今日の分は全部終わった", at(15, 20));
      const st = t => (state.items.find(i => i.title.includes(t)) || {}).status;
      ok("DJ. 「今日の分は全部終わった」は今日言った用事を完了（前から溜まっているもの・先の締切は残す）",
        st("牛乳") === "done" && st("洗濯") === "done" && st("レポート") === "open" && st("郵便局") === "open", show(state.items));
      // --- 聞く ---
      await run([["来週の火曜10時に歯医者", 9], ["来週の金曜までに書類を出す", 9, 1], ["明日9時に会議", 9, 2]]);
      const K = "2026-09-15", pl = planFor(K, { nowMin: 12 * 60 });
      let an = answerQuestion("来週何がある？", pl, K, "今日") || "";
      ok("DJ. 「来週何がある？」は来週の予定と期限を答える（今週のものは入れない）", /歯医者/.test(an) && /書類/.test(an) && !/会議/.test(an), an);
      await run([["牛乳を買う", 9], ["今日15時に銀行", 9, 1]]);
      an = answerQuestion("今日あと何件？", planFor(K, { nowMin: 12 * 60 }), K, "今日") || "";
      ok("DJ. 「今日あと何件？」は残りの数と、日付の無い用事の数を答える", /残っているのは1件/.test(an) && /日付を決めていないタスクが1件/.test(an), an);
      await run([["毎週月曜9時に定例", 9], ["定例、来週は火曜になった", 10]]);
      const t2 = state.items.filter(i => i.title === "定例");
      ok("DJ. 「定例、来週は火曜になった」は来週の月曜の回を外し、火曜に1回きりを足す",
        t2.length === 2 && (t2.find(i => i.repeat).skipDays || []).includes("2026-09-21") && t2.some(i => !i.repeat && i.dayKey === "2026-09-22" && hmOf(i.start) === "09:00"), show(t2));
      // --- AIの道：「さっきのなしで」はルールの取り消しだけ使う ---
      { const keepAI = SAMPLEFN, keepView = view.day, keepChat = view.chatDay;
        reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
        const stub = () => Promise.resolve({ text: "うん。" });
        stub.json = () => Promise.resolve({ ops: [], habit: "" });
        SAMPLEFN = null; await sendTurn("明日15時に美容院");
        stub.json = () => Promise.resolve({ ops: [{ op: "memo", text: "さっきのなしで", quote: "さっきのなしで" }], habit: "" });
        SAMPLEFN = stub; await sendTurn("さっきのなしで");
        SAMPLEFN = keepAI; view.day = keepView; view.chatDay = keepChat;
        ok("DJ. AIの道でも「さっきのなしで」は直前のものを取り消し、AIのメモは足さない",
          state.items.filter(i => i.title === "美容院" && i.status === "dropped").length === 1 && !state.items.some(i => i.kind === "memo"), show(state.items)); }
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== DK. テスター6周目：名前を言わない言い直し・箇条書きの見出し・締切2つ・メモ・くり返しの休み（2026-09-28・自律で進めた回） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const at = (d, h, mi) => zoned(2026, 9, d, h, mi || 0, TZ).toISOString();   // 9/15 は火曜
      const hmOf = x => x && validISO(x) ? hhmm(minOfDay(x, TZ)) : "なし";
      const run = async steps => { reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ }); let r = null; for (const [s, h, mi] of steps) r = await say(s, at(15, h, mi)); return r || { changes: [], asks: [] }; };
      const show = its => its.map(i => `${i.status} ${i.kind}「${i.title}」${i.dayKey || ""}${i.start && !i.timeUnknown ? " " + hmOf(i.start) : ""}${i.due && i.kind === "task" && i.duePrecision === "exact" ? " " + hmOf(i.due) : ""}${i.remainingMin != null ? " 残" + i.remainingMin : ""}`).join(" ／ ");
      // --- 名前を言わない言い直し ---
      await run([["明日10時に会議", 9], ["11時にして", 9, 5], ["やっぱり10時半", 9, 6]]);
      ok("DK. 「11時にして」「やっぱり10時半」は直前に話した予定へ（何も作らなかった発言は飛ばしてさかのぼる）", state.items.length === 1 && hmOf(state.items[0].start) === "10:30", show(state.items));
      await run([["明日の朝7時に起きる", 22], ["7時半にする", 22, 5]]);
      ok("DK. 「7時半にする」は起きる時刻の言い直し（「する」という用事を作らない）", state.items.length === 1 && hmOf(state.items[0].due) === "07:30", show(state.items));
      await run([["明日10時に会議、14時に歯医者", 9], ["15時にして", 9, 5]]);
      ok("DK. 直前の発言で2つ作っていたら、どれか分からないので動かさない", state.items.every(i => ["10:00", "14:00"].includes(hmOf(i.start))), show(state.items));
      await run([["明日10時に会議", 9], ["11時にして", 13, 5]]);
      ok("DK. 3時間より前の発言には当てない", hmOf(state.items[0].start) === "10:00", show(state.items));
      await run([["片付けをする", 9], ["片付け、30分くらいかかる", 9, 1], ["あと10分で終わる", 9, 30]]);
      ok("DK. 名前の無い「あと10分で終わる」は直前の用事の残り時間（長さの言い直しにしない）", state.items.length === 1 && state.items[0].remainingMin === 10 && state.items[0].estimateMin === 30, show(state.items));
      // --- 箇条書きの見出し・締切2つ・見出しの跡 ---
      await run([["明日やること\n・銀行\n・母に電話\nそれと本を返す", 21]]);
      const dk = t => (state.items.find(i => i.title.includes(t)) || {}).dayKey;
      ok("DK. 「明日やること」の下の箇条書きに明日の日付を渡す（箇条書きが途切れたら渡さない）", dk("銀行") === "2026-09-16" && dk("母に電話") === "2026-09-16" && !dk("本を返す"), show(state.items));
      await run([["水曜までに企画書、金曜までに見積もり", 9]]);
      ok("DK. 「水曜までに企画書、金曜までに見積もり」は締切の違う2件", state.items.length === 2 && dk("企画書") === "2026-09-16" && dk("見積もり") === "2026-09-18", show(state.items));
      await run([["明日の会議の資料、今日中に作る", 9]]);
      ok("DK. 見出しの真ん中に「、今日中に」を残さない", state.items.length === 1 && !/今日中/.test(state.items[0].title), show(state.items));
      await run([["プレゼンの準備を3日前から始める", 9]]);
      ok("DK. 「3日前から」は3日の日付ではない", state.items.length === 1 && state.items[0].dayKey !== "2026-10-03" && state.items[0].title === "プレゼンの準備を3日前から始める", show(state.items));
      await run([["明日10時に病院に行って、そのあと11時半に薬局", 9]]);
      ok("DK. 分けた前半の「病院に行って」は「病院に行く」", state.items.some(i => i.title === "病院に行く"), show(state.items));
      // --- メモ・希望・くり返しの休み ---
      await run([["来月10日に健康診断", 9], ["健康診断の前日は21時以降食べない", 9, 5]]);
      ok("DK. メモは言ったまま（「21時以降」を消さない）", state.items.some(i => i.kind === "memo" && i.title === "健康診断の前日は21時以降食べない"), show(state.items));
      await run([["明日は午前中に集中したい", 21]]);
      ok("DK. 「明日は午前中に集中したい」は明日だけの希望（「集中する」という用事にしない）",
        state.items.length === 1 && state.items[0].kind === "preference" && state.items[0].scopeDay === "2026-09-16", show(state.items) + " " + (state.items[0] && state.items[0].scopeDay));
      await run([["毎週火曜と木曜の19時からヨガ", 9], ["今週の木曜のヨガは休む", 9, 5]]);
      const yg = state.items.filter(i => /ヨガ/.test(i.title));
      ok("DK. 「今週の木曜のヨガは休む」は木曜の回だけ外す（同じ名前の火曜は触らない・「ヨガは休む」を作らない）",
        yg.length === 2 && yg.some(i => (i.skipDays || []).includes("2026-09-17")) && yg.every(i => !(i.skipDays || []).includes("2026-09-15") && !(i.skipDays || []).includes("2026-09-22")), show(yg));
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== DL. テスター7周目：続けたいことの「できた」・旬・何日も続く予定を延ばす・あいさつ・並べた用事（2026-09-28・自律で進めた回） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const at = (d, h, mi) => zoned(2026, 9, d, h, mi || 0, TZ).toISOString();   // 9/15 は火曜
      const run = async steps => { reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ }); let r = null; for (const [s, h, mi] of steps) r = await say(s, at(15, h, mi)); return r || { changes: [], asks: [] }; };
      const show = its => its.map(i => `${i.status} ${i.kind}「${i.title}」${i.dayKey || ""}${i.spanEndKey ? "→" + i.spanEndKey : ""}${i.doneDays ? " done:" + i.doneDays.join(",") : ""}${i.preferWindow ? " " + i.preferWindow : ""}${i.estimateMin ? " " + i.estimateMin + "分" : ""}`).join(" ／ ");
      // --- 続けたいことの「できた」 ---
      await run([["英語を毎日30分勉強したい", 9], ["今日は英語30分やった", 21], ["英語やった", 22]]);
      const g = state.items.find(i => i.kind === "goal");
      ok("DL. 「今日は英語30分やった」は続けたいことのその日を1回数える（同じ日に2回言っても1回）", g && JSON.stringify(g.doneDays) === '["2026-09-15"]' && g.status === "open", show(state.items));
      ok("DL. 数えた日は「この7日で◯回」に乗る（予定と結びついていなくても・点数にしない）", goalCount({ doneDays: g.doneDays }, "2026-09-16", TZ).done === 1);
      await run([["週に2回ジムに行く", 9], ["昨日ジムに行った", 9, 5]]);
      ok("DL. 「昨日ジムに行った」は昨日を数える", (state.items.find(i => i.kind === "goal").doneDays || []).includes("2026-09-14"), show(state.items));
      await run([["英語を毎日30分勉強したい", 9], ["英語の宿題を出す", 9, 1], ["英語の宿題出した", 21]]);
      ok("DL. 当たる用事があれば用事の完了（続けたいことは数えない）", state.items.find(i => i.kind === "task").status === "done" && !(state.items.find(i => i.kind === "goal").doneDays || []).length, show(state.items));
      ok("DL. 「できた」の op はルールだけ（OPS に無い＝AIの返事からは落ちる）", !OPS.includes("goalhit"));
      await run([["牛乳を毎日飲みたい", 9], ["牛乳を買う", 9, 1], ["パンを買う", 9, 2], ["牛乳とパン買った", 18]]);
      ok("DL. 「牛乳とパン買った」で用事を完了にした文では、続けたいこと（牛乳を飲む）は数えない",
        state.items.filter(i => i.kind === "task").every(i => i.status === "done") && !(state.items.find(i => i.kind === "goal").doneDays || []).length, show(state.items));
      ok("DL. 予定と結びついた続けたいことも、会話で数えた日を同じ日なら1回として足す",
        goalCount({ doneDays: ["2026-09-14"], repeat: null }, "2026-09-16", TZ, ["2026-09-15", "2026-09-14"]).done === 2);
      // --- 旬 ---
      await run([["10月中旬に旅行", 9]]);
      ok("DL. 「10月中旬」は10/20ごろのあいまいな期限", state.items.length === 1 && state.items[0].dayKey === "2026-10-20" && state.items[0].duePrecision === "week", show(state.items));
      await run([["来月上旬に引っ越し", 9]]);
      ok("DL. 「来月上旬」は10/10ごろ", state.items.length === 1 && state.items[0].dayKey === "2026-10-10", show(state.items));
      await run([["今月下旬に面談", 9]]);
      ok("DL. 「今月下旬」は月末ごろ", state.items.length === 1 && state.items[0].dayKey === "2026-09-30", show(state.items));
      // --- 何日も続く予定を延ばす ---
      let r = await run([["明日から3日間出張", 9], ["出張は1日延びた", 9, 5]]);
      ok("DL. 「出張は1日延びた」は終わりの日を1日後ろへ（「出張は延びた」を作らない・1日を日付にしない）",
        state.items.length === 1 && state.items[0].spanEndKey === "2026-09-19" && /終わりの日を 09\/19/.test((r.changes || []).join()), show(state.items) + " " + (r.changes || []).join());
      r = await run([["金曜までにレポート", 9], ["レポートの締切が1日延びた", 9, 5]]);
      ok("DL. 「レポートの締切が1日延びた」は締切を1日後ろへ（1日を1日の日付にしない）", state.items.length === 1 && state.items[0].dayKey === "2026-09-19", show(state.items));
      await run([["打ち合わせが1日延びた", 9]]);
      ok("DL. 当てる相手が無い「1日延びた」で、1日の予定を作らない", !state.items.some(i => i.dayKey === "2026-10-01"), show(state.items));
      // --- あいさつ・並べた用事・天気しだい・URL ---
      await run([["明日10時から会議です。よろしくお願いします。", 9]]);
      ok("DL. 「よろしくお願いします」を用事にしない", state.items.length === 1 && state.items[0].title === "会議", show(state.items));
      await run([["今日のタスク：洗濯、掃除、買い物", 9]]);
      ok("DL. 「今日のタスク：洗濯、掃除、買い物」は今日の用事3件", state.items.length === 3 && state.items.every(i => i.dayKey === "2026-09-15") && state.items.map(i => i.title).join() === "洗濯,掃除,買い物", show(state.items));
      await run([["明日雨なら洗濯は明後日", 9]]);
      ok("DL. 天気しだいの話はメモ", state.items.length === 1 && state.items[0].kind === "memo", show(state.items));
      await run([["明後日10時からオンライン会議、URLはあとで送られてくる", 9]]);
      ok("DL. 予定のあとの「URLは〜」は分けてメモ（予定の見出しに混ぜない）", state.items.some(i => i.kind === "event" && i.title === "オンライン会議") && state.items.some(i => i.kind === "memo" && /URL/.test(i.title)), show(state.items));
      await run([["夜ジョギング30分", 9]]);
      ok("DL. 「夜ジョギング30分」は夜の用事「ジョギング」30分", state.items.length === 1 && state.items[0].title === "ジョギング" && state.items[0].estimateMin === 30 && state.items[0].preferWindow === "evening", show(state.items));
      await run([["勉強2時間", 9]]);
      ok("DL. 「勉強2時間」も用事", state.items.length === 1 && state.items[0].kind === "task" && state.items[0].estimateMin === 120, show(state.items));
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== DM. テスター8周目：ずらす・時間変更・名前を言って聞く・昨日何した・「〜たい」・見出し（2026-09-28・自律で進めた回） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const at = (d, h, mi) => zoned(2026, 9, d, h, mi || 0, TZ).toISOString();   // 9/15 は火曜
      const hmOf = x => x && validISO(x) ? hhmm(minOfDay(x, TZ)) : "なし";
      const run = async steps => { reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ }); let r = null; for (const [s, d, h, mi] of steps) r = await say(s, at(d, h, mi)); return r || { changes: [], asks: [] }; };
      const show = its => its.map(i => `${i.status} ${i.kind}「${i.title}」${i.dayKey || ""}${i.start && !i.timeUnknown ? " " + hmOf(i.start) : ""}${i.kind === "task" && i.duePrecision === "exact" ? " " + hmOf(i.due) : ""}${i.allDay ? " 終日" : ""}${i.estimateMin ? " " + i.estimateMin + "分" : ""}`).join(" ／ ");
      const ev1 = () => state.items.filter(i => i.kind === "event");
      // --- ずらす・時間変更（明日の会議を、今日の昼に言い直す） ---
      const shift = async (s, want) => { await run([["明日10時に会議", 15, 9], [s, 15, 12]]); return state.items.length === 1 && ev1()[0].dayKey === "2026-09-16" && hmOf(ev1()[0].start) === want; };
      ok("DM. 「会議を30分後ろにずらして」は同じ日の10:30（「30分後」をいまからの時刻にしない）", await shift("会議を30分後ろにずらして", "10:30"), show(state.items));
      ok("DM. 「会議1時間早めて」は9:00（「会議1時間早めて」という用事を作らない）", await shift("会議1時間早めて", "09:00"), show(state.items));
      ok("DM. 「会議を1時間前にずらして」は9:00", await shift("会議を1時間前にずらして", "09:00"), show(state.items));
      ok("DM. 昼の「会議の時間変更、11時から」は明日の11:00（今日の23時の予定を作らない）", await shift("会議の時間変更、11時から", "11:00"), show(state.items));
      ok("DM. 昼の「会議は3時からになった」は明日の15:00（1〜5時は午後・決まり4c）", await shift("会議は3時からになった", "15:00"), show(state.items));
      ok("DM. 「会議は夜8時からになった」は20:00（夜と言っていれば読んだとおり）", await shift("会議は夜8時からになった", "20:00"), show(state.items));
      await run([["今日18時に会議", 15, 9], ["会議は8時からになった", 15, 12]]);
      ok("DM. 今日の予定で朝8時が過ぎていれば「8時」は20:00", hmOf(ev1()[0].start) === "20:00", show(state.items));
      await run([["30分後に電話する", 15, 9]]);
      ok("DM. 「30分後に電話する」は今までどおり9:30", hmOf(state.items[0].due) === "09:30", show(state.items));
      // --- 聞く ---
      await run([["牛乳を買う", 14, 9], ["牛乳買った", 14, 18]]);
      const K = "2026-09-14";
      let an = answerQuestion("昨日何した？", planFor(K, { nowMin: 0 }), K, "昨日") || "";
      ok("DM. 「昨日何した？」は、会話で完了にした日（言った日）で答える", /昨日済ませたのは「牛乳を買う」/.test(an), an);
      ok("DM. 会話で完了にしたときの完了の時刻は、言ったとき", state.items[0].completedAt === at(14, 18), state.items[0].completedAt);
      await run([["明日10時に会議", 15, 9]]);
      an = answerQuestion("会議って何時からだっけ", planFor("2026-09-15", { nowMin: 12 * 60 }), "2026-09-15", "今日") || "";
      ok("DM. 「会議って何時からだっけ」は名前で探して日時を答える（今日の予定で答えない）", /「会議」は9\/16\(水\) 10:00から/.test(an), an);
      an = answerQuestion("明日は何がある？", planFor("2026-09-16", { nowMin: -1 }), "2026-09-16", "明日") || "";
      ok("DM. 「明日は何がある？」に答える", /会議/.test(an), an);
      // --- 読み取り ---
      await run([["明日10時に会議", 15, 9], ["明日の会議の前に資料を印刷", 15, 9, 1]]);
      const pr = state.items.find(i => /印刷/.test(i.title));
      ok("DM. 「明日の会議の前に資料を印刷」は会議の始まりが締切の用事（予定にしない）", pr && pr.kind === "task" && hmOf(pr.due) === "10:00" && pr.dayKey === "2026-09-16", show(state.items));
      await run([["資料作成", 15, 9], ["資料作成は2時間", 15, 9, 5]]);
      ok("DM. 「資料作成」だけでも用事・「資料作成は2時間」は長さの言い足し", state.items.length === 1 && state.items[0].kind === "task" && state.items[0].estimateMin === 120, show(state.items));
      await run([["午前中いっぱい作業", 15, 9]]);
      ok("DM. 「午前中いっぱい作業」は用事にしない（「作業」だけは広すぎる）", !state.items.length, show(state.items));
      await run([["本を読みたい", 15, 9], ["早く帰りたい", 15, 9, 1], ["明日映画を見たい", 15, 9, 2]]);
      ok("DM. 日付の無い「本を読みたい」は気になっていること・「早く帰りたい」は記録しない・日付を言えば用事",
        state.items.some(i => i.kind === "idea" && i.title === "本を読みたい") && !state.items.some(i => /帰り/.test(i.title)) && state.items.some(i => i.kind === "task" && i.dayKey === "2026-09-16"), show(state.items));
      await run([["今日は夜まで作業する感じにはしたくない", 15, 9]]);
      ok("DM. 「〜したくない」を用事にしない（夜の希望だけ）", !state.items.some(i => i.kind === "task"), show(state.items));
      // --- 見出し ---
      const title1 = async s => { await run([[s, 15, 9]]); return state.items.map(i => i.title).join(); };
      ok("DM. 「今月の目標は5冊読むこと」の見出しは「5冊読む」", await title1("今月の目標は5冊読むこと") === "5冊読む", show(state.items));
      ok("DM. 「明日の朝までにメール」の見出しは「メール」", await title1("明日の朝までにメール") === "メール", show(state.items));
      ok("DM. 「来週月曜に提出、レポート」の見出しは「レポート提出」", await title1("来週月曜に提出、レポート") === "レポート提出", show(state.items));
      ok("DM. 「映画は土曜に見る」の見出しは「映画を見る」", await title1("映画は土曜に見る") === "映画を見る", show(state.items));
      ok("DM. 「来週の月曜、朝は早く出る」の「朝は」は時のことなので「を」にしない", !/朝を/.test(await title1("来週の月曜、朝は早く出る")), show(state.items));
      await run([["木曜は1日中外出", 15, 9]]);
      ok("DM. 「木曜は1日中外出」は終日の予定", state.items.length === 1 && state.items[0].allDay, show(state.items));
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== DN. テスター9周目：一日の会話を通して——複合語の完了・聞くだけの文・日付ごとに並べた予定・同じ名前の2件・予約の時刻（2026-09-28・自律で進めた回） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const at = (d, h, mi) => zoned(2026, 9, d, h, mi || 0, TZ).toISOString();   // 9/15 は火曜
      const hmOf = x => x && validISO(x) ? hhmm(minOfDay(x, TZ)) : "なし";
      const run = async steps => { reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ }); let r = null; for (const [s, h, mi] of steps) r = await say(s, at(15, h, mi)); return r || { changes: [], asks: [] }; };
      const show = its => its.map(i => `${i.status} ${i.kind}「${i.title}」${i.dayKey || ""}${i.start && !i.timeUnknown ? " " + hmOf(i.start) : ""}`).join(" ／ ");
      const said = r => (r.changes || []).concat(r.asks || []).join(" / ");
      let r = await run([["午後は資料作成", 9], ["資料終わった", 15]]);
      ok("DN. 「資料終わった」で「資料作成」を完了（1語になった複合語の芯で当てる）", state.items[0].status === "done", show(state.items));
      r = await run([["明日病院行く", 9], ["病院の予約10時に取れた", 12]]);
      ok("DN. 「病院の予約10時に取れた」は明日の「病院行く」に10時を入れる", state.items.length === 1 && hmOf(state.items[0].start) === "10:00" && state.items[0].dayKey === "2026-09-16", show(state.items) + " " + said(r));
      r = await run([["牛乳を買う", 9], ["今日何が終わった？", 21]]);
      ok("DN. 「今日何が終わった？」は聞いているだけ（「特定できません」を言わない・完了にしない）", !/特定できません/.test(said(r)) && state.items[0].status === "open", said(r));
      r = await run([["資料作成", 9], ["資料終わった？", 12]]);
      ok("DN. 「資料終わった？」と聞いただけで完了にしない", state.items[0].status === "open", show(state.items));
      r = await run([["今週の予定：月曜会議、水曜歯医者、金曜飲み会", 8]]);
      ok("DN. 「今週の予定：月曜会議、水曜歯医者、金曜飲み会」は日付ごとに3件",
        state.items.length === 3 && state.items.map(i => i.title + i.dayKey).join() === "会議2026-09-14,歯医者2026-09-16,飲み会2026-09-18", show(state.items));
      r = await run([["明日は会議、明後日は歯医者", 8]]);
      ok("DN. 「明日は会議、明後日は歯医者」は2件", state.items.length === 2 && state.items[1].dayKey === "2026-09-17", show(state.items));
      r = await run([["明日、明後日と2日間出張", 8]]);
      ok("DN. 「明日、明後日と2日間出張」は分けない（前の話が日付だけ・始まりは明日のまま）", state.items.length === 1 && state.items[0].dayKey === "2026-09-16", show(state.items));
      r = await run([["明日の会議の資料、今日中に作る", 8]]);
      ok("DN. 「〜、今日中に作る」の「今日中」は締切の付け足しなので分けない", state.items.length === 1, show(state.items));
      r = await run([["明日10時と15時に打ち合わせ", 9], ["15時の打ち合わせはなしになった", 12]]);
      const ev = state.items.filter(i => i.kind === "event");
      ok("DN. 「15時の打ち合わせはなしになった」は15時のほうだけ取り消す（同じ名前が2つでも時刻で当てる）",
        ev.length === 2 && ev.find(i => hmOf(i.start) === "15:00").status === "dropped" && ev.find(i => hmOf(i.start) === "10:00").status === "open", show(state.items));
      r = await run([["来週の水曜に飲み会", 9], ["飲み会の場所決まった、渋谷の居酒屋", 12]]);
      ok("DN. 「飲み会の場所決まった、〜」はメモ", !state.items.some(i => i.kind === "task") && state.items.some(i => i.kind === "memo"), show(state.items));
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== DO. テスター10周目：順番で指す・くり返しの時刻を変える・その週だけ変える・「明日と2日間」（2026-09-28・自律で進めた回） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const at = (d, h, mi) => zoned(2026, 9, d, h, mi || 0, TZ).toISOString();   // 9/15 は火曜
      const hmOf = x => x && validISO(x) ? hhmm(minOfDay(x, TZ)) : "なし";
      const run = async steps => { reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ }); let r = null; for (const [s, h, mi] of steps) r = await say(s, at(15, h, mi)); return r || { changes: [], asks: [] }; };
      const show = its => its.map(i => `${i.status} ${i.kind}「${i.title}」${i.dayKey || ""}${i.start && !i.timeUnknown ? " " + hmOf(i.start) : ""}${i.repeat ? " くり返し" : ""}${(i.skipDays || []).length ? " 外す" + i.skipDays.join("/") : ""}`).join(" ／ ");
      const evs = () => state.items.filter(i => i.kind === "event");
      // --- 順番で指す ---
      await run([["明日10時と15時に打ち合わせ", 9], ["2つ目の打ち合わせ、16時にして", 12]]);
      ok("DO. 「2つ目の打ち合わせ、16時にして」は15時のほうを16時へ（同じ名前が2つでも順番で当てる）",
        evs().length === 2 && evs().map(i => hmOf(i.start)).sort().join() === "10:00,16:00", show(state.items));
      await run([["明日10時と15時に打ち合わせ", 9], ["最初の打ち合わせはなしになった", 12]]);
      ok("DO. 「最初の打ち合わせはなしになった」は10時のほうだけ取り消す",
        evs().find(i => hmOf(i.start) === "10:00").status === "dropped" && evs().find(i => hmOf(i.start) === "15:00").status === "open", show(state.items));
      await run([["明日10時と15時に打ち合わせ", 9], ["最後の打ち合わせは17時にして", 12]]);
      ok("DO. 「最後の打ち合わせは17時にして」は15時のほうを17時へ", evs().map(i => hmOf(i.start)).sort().join() === "10:00,17:00", show(state.items));
      // --- くり返しの時刻を変える ---
      await run([["毎週月曜9時に朝礼", 9], ["朝礼は10時からになった", 12]]);
      ok("DO. 「朝礼は10時からになった」はくり返しの時刻を10:00に（1回きりの予定を足さない）",
        evs().length === 1 && evs()[0].repeat && hmOf(evs()[0].start) === "10:00" && !(evs()[0].skipDays || []).length, show(state.items));
      await run([["毎週月曜9時に朝礼", 9], ["来週の朝礼は10時からになった", 12]]);
      const rep = evs().find(i => i.repeat), one = evs().find(i => !i.repeat);
      ok("DO. 「来週の朝礼は10時からになった」は来週の回だけを外して、その日の10:00に1回きりを足す（くり返しは9時のまま）",
        evs().length === 2 && hmOf(rep.start) === "09:00" && (rep.skipDays || []).join() === "2026-09-21" && one && one.dayKey === "2026-09-21" && hmOf(one.start) === "10:00", show(state.items));
      // --- 見出し ---
      await run([["明日、明後日と2日間出張", 8]]);
      ok("DO. 「明日、明後日と2日間出張」の見出しは「出張」", state.items.length === 1 && state.items[0].title === "出張", show(state.items));
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== DP. テスター11周目：学生・子育て・仕事の言い方と、続けたいことの「走った」（2026-09-28・自律で進めた回） ===== */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      const at = (h, mi) => zoned(2026, 9, 15, h, mi || 0, TZ).toISOString();   // 9/15 は火曜
      const hmOf = x => x && validISO(x) ? hhmm(minOfDay(x, TZ)) : "なし";
      const run = async steps => { reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ }); for (const [s, h, mi] of steps) await say(s, at(h, mi)); };
      const show = its => its.map(i => `${i.status} ${i.kind}「${i.title}」${i.dayKey || ""}${i.start && !i.timeUnknown ? " " + hmOf(i.start) : ""}${i.repeat ? " くり返し" : ""}${(i.doneDays || []).length ? " できた" + i.doneDays.join("/") : ""}`).join(" ／ ");
      const one = (k, t) => state.items.find(i => i.kind === k && (!t || i.title === t));
      // --- 続けたいこと ---
      await run([["毎朝ランニング", 7]]);
      ok("DP. 「毎朝ランニング」の見出しは「毎朝ランニング」（朝を時間帯として落とさない）", state.items.length === 1 && state.items[0].title === "毎朝ランニング", show(state.items));
      await run([["毎朝ランニング", 7], ["5km走ってきた", 8]]);
      ok("DP. 「毎朝ランニング」に「5km走ってきた」で、その日を数える（運動の名前と動詞）", (one("goal").doneDays || []).join() === "2026-09-15", show(state.items));
      await run([["毎朝走りたい", 7], ["5km走った", 8]]);
      ok("DP. 「毎朝走りたい」に「5km走った」で、その日を数える（見出しの最後の動詞）", (one("goal").doneDays || []).join() === "2026-09-15", show(state.items));
      await run([["毎日早く寝たい", 7], ["昨日は遅く寝た", 8]]);
      ok("DP. 「毎日早く寝たい」は続けたいこと（体調にしない）", !!one("goal", "毎日早く寝たい") && !state.items.some(i => i.kind === "condition" && /早く寝たい/.test(i.title)), show(state.items));
      ok("DP. 「遅く寝た」は「早く寝たい」に数えない", !(one("goal").doneDays || []).length, show(state.items));
      await run([["毎日早く寝たい", 7], ["昨日は早く寝た", 8]]);
      ok("DP. 「毎日早く寝たい」に「昨日は早く寝た」で、昨日を数える（送りがなの無い「寝たい」）", (one("goal").doneDays || []).join() === "2026-09-14", show(state.items));
      await run([["今日はジョギング休み", 7]]);
      ok("DP. 「今日はジョギング休み」を終日の予定にしない", !state.items.some(i => i.kind === "event"), show(state.items));
      await run([["今日はジョギング休み、代わりに散歩する", 7]]);
      ok("DP. 「〜休み、代わりに散歩する」は今日の用事「散歩する」", state.items.length === 1 && state.items[0].title === "散歩する" && state.items[0].dayKey === "2026-09-15", show(state.items));
      await run([["朝ヨガ", 6]]);
      ok("DP. 「朝ヨガ」は朝の用事「ヨガ」", state.items.length === 1 && state.items[0].kind === "task" && state.items[0].title === "ヨガ" && state.items[0].preferWindow === "morning", show(state.items));
      await run([["皿洗い", 9]]);
      ok("DP. 「皿洗い」だけでも用事", state.items.length === 1 && state.items[0].kind === "task", show(state.items));
      // --- 1行に2つ ---
      await run([["明日1限から英語、2限は休講", 21]]);
      ok("DP. 「明日1限から英語、2限は休講」は、どちらも明日の2件", state.items.length === 2 && state.items.every(i => i.dayKey === "2026-09-16"), show(state.items));
      await run([["来週の水曜にテスト、それまでに単語100個覚える", 10]]);
      const tt = one("task");
      ok("DP. 「来週の水曜にテスト、それまでに単語100個覚える」は予定「テスト」と、その日までの用事",
        state.items.length === 2 && one("event", "テスト") && tt && tt.title === "単語100個覚える" && tt.dayKey === "2026-09-23", show(state.items));
      await run([["明日は保育園の遠足、お弁当作らないと", 20]]);
      ok("DP. 「明日は保育園の遠足、お弁当作らないと」は予定「保育園の遠足」と、明日の用事",
        state.items.length === 2 && one("event", "保育園の遠足") && one("task") && one("task").dayKey === "2026-09-16", show(state.items));
      await run([["明日のプレゼン資料、作り直さないと", 10]]);
      ok("DP. 「明日のプレゼン資料、作り直さないと」は分けない（後ろに名詞が無い）", state.items.length === 1 && state.items[0].kind === "task", show(state.items));
      await run([["明日10時に会議、その前に資料印刷", 10]]);
      ok("DP. 「〜会議、その前に資料印刷」は明日の用事「資料印刷」も", state.items.length === 2 && one("task", "資料印刷") && one("task", "資料印刷").dayKey === "2026-09-16", show(state.items));
      // --- 見出し・日付 ---
      await run([["娘の誕生日プレゼント買わなきゃ、誕生日は10月15日", 10]]);
      ok("DP. 「娘の誕生日プレゼント買わなきゃ、誕生日は10月15日」は、その日までの用事（毎年にしない・見出しに「、誕生日」を残さない）",
        state.items.length === 1 && state.items[0].kind === "task" && !state.items[0].repeat && state.items[0].title === "娘の誕生日プレゼント買う" && state.items[0].dayKey === "2026-10-15", show(state.items));
      await run([["母の誕生日は10月15日", 10]]);
      ok("DP. 「母の誕生日は10月15日」は今までどおり毎年", state.items.length === 1 && state.items[0].repeat && state.items[0].repeat.kind === "yearly", show(state.items));
      await run([["経費精算、今月中", 10]]);
      ok("DP. 「今月中」は「9/30 ごろ」ではなく「今月中」と出す", periodText(state.items[0]) === "今月中", periodText(state.items[0]));
      await run([["明日10じに会議", 9]]);
      ok("DP. 「明日10じに会議」（変換しないで打った時刻）は明日の10:00の「会議」", state.items.length === 1 && state.items[0].title === "会議" && hmOf(state.items[0].start) === "10:00", show(state.items));
      await run([["3じかん勉強する", 9]]);
      ok("DP. 「3じかん勉強する」は3時間", state.items[0] && state.items[0].estimateMin === 180, show(state.items));
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
    }

    /* ===== CJ. 速さと保存の仕組み（2026-09-27・本人の指示「ほかにも最適化できないか模索して」） =====
       3か月ぶんの記録で測ると、予定表の計算が1回140ミリ秒・1発言が19ミリ秒かかっていた。
       原因は ①日付を読むたびに書式の道具（Intl）を作り直していた ②項目を1つ足すたびに記録をまるごと書き直していた。
       そして APK の唯一の保存先（localStorage）は約524万文字で一杯になり、そこから先は何も残らなかった。 */
    {
      const keep = { notes: state.notes, items: state.items, turns: state.turns, docs: state.docs, settings: state.settings };
      // ① 書式の道具は使い回す。使えないタイムゾーンは、今までどおり毎回例外を投げる（失敗を覚えない）
      ok("CJ. 日付の書式の道具を、タイムゾーンごとに使い回す",
         dtf("parts", "Asia/Tokyo") === dtf("parts", "Asia/Tokyo") && dtf("off", "Asia/Tokyo") !== dtf("parts", "Asia/Tokyo"));
      let thrown = 0;
      for (let i = 0; i < 2; i++) { try { parts(new Date(), "Not/AZone"); } catch { thrown++; } }
      ok("CJ. 使えないタイムゾーンは、使い回さず毎回知らせる（安全の決まりを変えない）", thrown === 2, thrown + "回");
      ok("CJ. 使い回しても、タイムゾーンごとの答えは変わらない",
         dayKey(new Date("2026-09-27T20:00:00Z"), "Asia/Tokyo") === "2026-09-28"
         && dayKey(new Date("2026-09-27T20:00:00Z"), "America/New_York") === "2026-09-27"
         && dayKey(new Date("2026-09-27T20:00:00Z"), "Asia/Tokyo") === "2026-09-28");
      // 速さ：200件の項目で予定表を20回作る
      reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      for (let i = 0; i < 200; i++) state.items.push({ id: "cj" + i, kind: i % 3 ? "task" : "event", title: "用事" + i, status: "open",
        origin: "rule", confirmed: false, corrected: false, history: [], createdAt: T(9, 0),
        dayKey: KEY, duePrecision: i % 3 ? "day" : "exact", due: T(23, 59), start: T(9 + (i % 10), 0), end: T(10 + (i % 10), 0), fixed: !(i % 3), estimateMin: 30 });
      /* 時間では測らない（テストの時計は仮想で、計算の重さでは進まない）。**作り直した回数**を数える。 */
      planFor(KEY);
      const RealDTF = Intl.DateTimeFormat; let made = 0;
      Intl.DateTimeFormat = function (...a) { made++; return new RealDTF(...a); };
      Intl.DateTimeFormat.prototype = RealDTF.prototype;
      try { for (let i = 0; i < 5; i++) planFor(KEY); } finally { Intl.DateTimeFormat = RealDTF; }
      ok("CJ. 200件の記録で予定表を作っても、書式の道具を1つも作り直さない", made === 0, made + "回");

      // ② 保存はまとめて1回。原文だけはすぐ書く
      const realSet = localStorage.setItem.bind(localStorage);
      let writes = 0;
      localStorage.setItem = (k, v) => { if (k === "hitohi.v1") writes++; return realSet(k, v); };
      try {
        reset();
        const nn = { id: uid(), text: "牛乳を買う\n郵便局に行く\n資料を作る\n部屋を片付ける", hash: "cj", capturedAt: T(9, 0), source: "talk", sourceName: null, createdAt: T(9, 0) };
        writes = 0;
        await putNote(nn);
        ok("CJ. 原文は、その場で端末に書く（AIより先・決まり7）", writes === 1 && (lsRead().notes || []).some(n => n.id === nn.id), writes + "回");
        writes = 0;
        const r = await applyOps(ruleOps(nn), nn);
        const added = r.changes.length;
        await new Promise(res => setTimeout(res, 30));
        ok("CJ. 項目を何件足しても、端末への書き込みは1回にまとまる", added >= 3 && writes === 1, added + "件で" + writes + "回");
        ok("CJ. まとめた書き込みにも、足した項目が全部入っている", (lsRead().items || []).length === state.items.length);
        // 閉じる前に書き切る
        writes = 0;
        await putItem(Object.assign({}, state.items[0], { title: "閉じる直前に直した" }));
        lsFlush();
        ok("CJ. 閉じる・裏へ回るときは、予約した保存を待たずに書く", writes === 1 && (lsRead().items || []).some(i => i.title === "閉じる直前に直した"), writes + "回");
        await new Promise(res => setTimeout(res, 30));
        ok("CJ. 書き切ったあとに、同じものをもう一度書かない", writes === 1, writes + "回");
        // 本当に「閉じる」「裏へ回る」の合図で書くか（関数があるだけでは足りない）
        await putItem(Object.assign({}, state.items[0], { title: "閉じる合図の直前" }));
        window.dispatchEvent(new Event("pagehide"));
        ok("CJ. 閉じる合図（pagehide）で書き切る", (lsRead().items || []).some(i => i.title === "閉じる合図の直前"));
        await putItem(Object.assign({}, state.items[0], { title: "裏へ回る直前" }));
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        delete document.visibilityState;
        ok("CJ. 裏へ回る合図（visibilitychange）で書き切る", (lsRead().items || []).some(i => i.title === "裏へ回る直前"));
      } finally { localStorage.setItem = realSet; }

      /* ③ 奥の保存場所（IndexedDB）。**テストの仮想時計の下では本物が開かない**（開く返事が来ない・実測）ので、
         ここでは同じ形の偽物を差し込んで仕組みを見る。本物は tests/idb-real.mjs（本物の時計の Playwright）で確かめる。 */
      const store = new Map();
      const fakeDb = { transaction() {
        const tx = {};
        const later = (r, f) => { setTimeout(() => { f(); if (r.onsuccess) r.onsuccess(); if (tx.oncomplete) tx.oncomplete(); }, 0); return r; };
        tx.objectStore = () => ({ put: (v, k) => { const r = {}; return later(r, () => store.set(k, v)); },
                                  get: k => { const r = {}; return later(r, () => { r.result = store.get(k); }); } });
        return tx;
      } };
      const keepIdbP = idbP;
      idbP = Promise.resolve(fakeDb);
      {
        reset(); state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
        state.items.push({ id: "cj-a", kind: "task", title: "奥に書いた", status: "open", origin: "rule", confirmed: false, corrected: false, history: [], createdAt: T(9, 0) });
        await lsWrite();          // 仮想の時計では待たない。書き終わりそのものを待つ（決まり15i）
        let got = await idbGet();
        let v = got.ok && got.v ? JSON.parse(got.v) : null;
        ok("CJ. 端末に書くとき、同じ中身を奥の保存場所にも書く", !!v && v.items.length === 1 && v.items[0].title === "奥に書いた" && v.savedAt > 0);

        // localStorage が一杯でも、奥に残る。残っていれば騒がない
        const keepBackend = state.backend; state.backend = "local"; lastError = null;
        localStorage.setItem = () => { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; };
        state.items.push({ id: "cj-b", kind: "task", title: "一杯のあとに足した", status: "open", origin: "rule", confirmed: false, corrected: false, history: [], createdAt: T(9, 0) });
        let pw;
        try { pw = lsWrite(); } finally { localStorage.setItem = realSet; }
        await pw;
        got = await idbGet(); v = got.ok && got.v ? JSON.parse(got.v) : null;
        ok("CJ. localStorage が一杯でも、記録は奥の保存場所に残る", !!v && v.items.some(i => i.title === "一杯のあとに足した"));
        ok("CJ. 奥に残っているなら「残りません」と騒がない", !lsFailed && !lastError, String(lsFailed) + " / " + String(lastError));

        // 起動したら、新しいほうを読む
        realSet("hitohi.v1", JSON.stringify({ savedAt: 1, notes: [], items: [{ id: "cj-a", kind: "task", title: "奥に書いた", status: "open", history: [] }], turns: {}, docs: [], settings: state.settings }));
        state.items = []; state.notes = [];
        await boot();
        ok("CJ. 起動したら、新しいほう（奥の保存場所）を読む", state.items.some(i => i.title === "一杯のあとに足した"), state.items.map(i => i.title).join("/"));
        // 古いほうが奥にあるときは、localStorage を採る
        realSet("hitohi.v1", JSON.stringify({ savedAt: Date.now() + 60000, notes: [], items: [{ id: "cj-c", kind: "task", title: "手前が新しい", status: "open", history: [] }], turns: {}, docs: [], settings: state.settings }));
        await boot();
        ok("CJ. 手前（localStorage）のほうが新しければ、そちらを読む", state.items.length === 1 && state.items[0].title === "手前が新しい", state.items.map(i => i.title).join("/"));
        state.backend = keepBackend;

        // 設定タブの知らせ：APK で奥に書けないときだけ、大きさで知らせる
        const keepDB = DB, keepOk = idbOk, keepLen = lsSnapLen;
        DB = null; idbOk = false; lsSnapLen = Math.round(LS_CAP * 0.8); lsFailed = null;
        showTab("p-set"); renderSettings();
        const w = document.querySelector("#dataWarn");
        ok("CJ. 端末の中だけで奥に書けず、一杯に近ければ知らせる", !!w && !w.hidden && /保存場所を 80% 使っています/.test(w.textContent), w ? w.textContent.slice(0, 40) : "");
        idbOk = true; renderSettings();
        ok("CJ. 奥に書けていれば、大きさの知らせは出さない（実質の上限が無い）", !!w && w.hidden);
        DB = keepDB; idbOk = keepOk; lsSnapLen = keepLen;
      }
      // 開く返事が来ない場所で、待ち続けない（保存のたびに写しが残ってメモリが増えないように）
      {
        idbP = null;
        const pending = { open: () => ({}) };
        let replaced = false;
        try { Object.defineProperty(window, "indexedDB", { value: pending, configurable: true }); replaced = true; } catch {}
        const r = await Promise.race([idbPut("x").then(v => "返った:" + v.ok), new Promise(res => setTimeout(() => res("待ち続けた"), 8000))]);
        ok("CJ. 開く返事が来なければ3秒で見切って、保存を待たせない", replaced && r === "返った:false", replaced ? r : "差し替えられない");
        ok("CJ. 見切ったあとは、次の保存でもう一度開きにいく", idbP === null);
        if (replaced) delete window.indexedDB;
      }
      idbP = keepIdbP;
      state.notes = keep.notes; state.items = keep.items; state.turns = keep.turns; state.docs = keep.docs; state.settings = keep.settings;
      lsWrite();
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
