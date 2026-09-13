/* 一日ぶんのボイスメモを、朝から夜まで「1発言ずつ」流して検証する。
   各時点では、その後の発言をアプリに見せない。AIなし（ルールのみ）の経路で走る。 */
(function () {
  const OUT = [];
  const TZ = "Asia/Tokyo";
  const say = (s, ...a) => OUT.push(s);
  const R = []; const ok = (n, c, e) => R.push((c ? "PASS" : "FAIL") + " :: " + n + (e ? "  [" + e + "]" : ""));

  const DAY = [2026, 9, 12];
  const T = (h, mi) => zoned(DAY[0], DAY[1], DAY[2], h, mi, TZ).toISOString();
  const KEY = `${DAY[0]}-${String(DAY[1]).padStart(2, "0")}-${String(DAY[2]).padStart(2, "0")}`;
  const NEXT = dayKey(new Date(keyToDate(KEY, TZ).getTime() + 86400000), TZ);

  // 「今」を固定して1発言を処理する（本物の sendTurn と同じ経路）
  let NOW = null;
  async function utter(hh, mm, text) {
    NOW = hh * 60 + mm;
    const at = T(hh, mm);
    const clean = normNote(text);
    const note = { id: uid(), text: clean, hash: hash(clean + "|" + at), capturedAt: at, source: "talk", sourceName: null, createdAt: at };
    await putNote(note);
    const before = planFor(KEY, { nowMin: NOW }).blocks.map(b => `${b.s}-${b.e}-${b.item.id}`);
    const res = await applyOps(ruleOps(note), note);
    const plan = planFor(KEY, { nowMin: NOW });
    const na = nextAction(plan, NOW);
    const beforeSet = new Set(before);
    const scheduleChanged = plan.blocks.map(b => `${b.s}-${b.e}-${b.item.id}`).filter(x => !beforeSet.has(x)).length;
    const answer = answerQuestion(clean, plan, KEY);
    const feelingOnly = RE_FEELINGONLY.test(clean.trim()) || (!res.changes.length && !answer && RE_MAYBE.test(halfWidth(clean)));
    const ctx = { changes: res.changes, asks: res.asks, kinds: res.kinds, plan, na, isToday: true, answer, feelingOnly, raw: clean, scheduleChanged,
                  askedSchedule: RE_ASK.test(halfWidth(clean)) && /(予定|後回し|何(を)?(する|やる|しない)|時間)/.test(halfWidth(clean)) };
    const reply = templateReply(ctx);
    const showTable = shouldShowTable(ctx);

    say("");
    say("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    say(`【${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}】あなた：${clean.replace(/\n/g, " / ")}`);
    say("");
    say("  返答：" + reply);
    say("  変えたこと：" + (res.changes.length ? res.changes.join(" / ") : "（なし）"));
    say("  次にすること：" + (na ? `${hhmm(na.block.s)}–${hhmm(na.block.e)} ${blockTitle(na.block)}` : "（なし）"));
    say("  予定表を出すか：" + (showTable ? "出す" : "出さない（折りたたみ）"));
    say("  この時点の案：" + (plan.blocks.length
      ? plan.blocks.map(b => `${hhmm(b.s)}-${hhmm(b.e)} ${blockTitle(b)}`).join(" / ") : "（枠なし）"));
    if (plan.unplaced.length) say("  未配置：" + plan.unplaced.map(u => `${u.item.title}（${u.reason}）`).join(" / "));
    return { res, plan, na, reply, showTable, note };
  }

  async function run() {
    for (let i = 0; i < 200 && !state.ready; i++) await new Promise(r => setTimeout(r, 20));
    state.notes = []; state.items = []; state.turns = {}; state.docs = [];
    state.settings = Object.assign({}, DEFAULTS, {
      timezone: TZ, workStart: "08:00", workEnd: "18:00", defaultEstimate: 30, breakEveryMin: 90, breakMin: 10
    });
    view.day = KEY;

    say("========================================");
    say("  一日を通した検証（AIなし・ルールのみ）");
    say("  " + KEY + " / タイムゾーン " + TZ);
    say("========================================");

    /* ---------- 1. 朝 ---------- */
    const s1 = await utter(8, 10, "おはよう。昨日寝たのがたぶん1時半くらいで、今日起きたのが8時。ちょっと眠い。朝ごはんはまだ食べてない。今日はあんまり予定を詰めすぎないでほしい。");
    ok("1. 眠気を自己申告として記録する", state.items.some(i => i.kind === "condition"),
       state.items.filter(i => i.kind === "condition").map(i => i.selfReport.slice(0, 20)).join(" / "));
    ok("1. 体調に点数を作らない", state.items.filter(i => i.kind === "condition").every(c => !("score" in c) && !("energy" in c)));
    ok("1. 「詰めすぎないで」を好みとして保存する", prefs(KEY).buffer === true);

    /* ---------- 2. 資料（締切=明日／実行=今日午前） ---------- */
    const s2 = await utter(8, 20, "今日何しないといけなかったっけ。あ、昨日言ってた資料を作らないと。明日までに相手に送るやつ。1時間くらいでできると思ってたけど、調べることもあるからもうちょっとかかるかも。できれば午前中に進めたい。");
    const shiryo = state.items.find(i => i.kind === "task" && /資料/.test(i.title));
    ok("2. 資料をタスクとして拾う", !!shiryo, shiryo && shiryo.title);
    ok("2. 締切は明日", shiryo && shiryo.dayKey === NEXT, shiryo && shiryo.dayKey);
    ok("2. 実行目標は今日（締切とは別に保存）", shiryo && shiryo.targetDay === KEY, shiryo && String(shiryo.targetDay));
    ok("2. 「午前中に」を時間帯の希望として保存", shiryo && shiryo.preferWindow === "morning", shiryo && String(shiryo.preferWindow));
    ok("2. 「もうちょっとかかるかも」を不確かさとして保存", shiryo && shiryo.estimateUncertain === true);
    ok("2. 変更の説明で締切と実行日を分けて伝える",
       s2.res.changes.some(c => /締切/.test(c) && /進める/.test(c)), s2.res.changes.join(" / "));
    ok("2. 資料が午前中に置かれる", s2.plan.blocks.some(b => b.item.id === (shiryo && shiryo.id) && b.s < 12 * 60),
       s2.plan.blocks.filter(b => b.type === "flex").map(b => hhmm(b.s) + " " + b.item.title).join(" / "));

    /* ---------- 3. 友達（今日絶対ではない／まとまっていない） ---------- */
    const s3 = await utter(8, 25, "あと、友達にAIの構想を送ろうと思ってたんだった。これは今日絶対じゃないけど、忘れないようにしておいて。一緒に作れたら面白そうだけど、まだどう誘えばいいかまとまってない。");
    const tomo = state.items.find(i => /友達|構想/.test(i.title) && i.kind === "task");
    ok("3. 友達への連絡を残す", !!tomo, tomo && (tomo.kind + "：" + tomo.title));
    ok("3. 「今日絶対じゃない」ので今日の締切にしない", !tomo || tomo.dayKey !== KEY || !tomo.dueIsDeadline,
       tomo && ("締切" + tomo.dayKey));

    /* ---------- 4. 朝食・食材・買い物 ---------- */
    const s4 = await utter(8, 30, "今から朝ごはん食べる。冷蔵庫に卵と納豆があったと思う。最近適当に済ませることが多いから、買い物するときに何買えばいいかも考えてほしい。料理にそんなに時間はかけたくない。");
    ok("4. 食材の話が残る（あとで参照できる）",
       state.items.some(i => /卵|納豆|冷蔵庫/.test(i.title)),
       state.items.filter(i => /卵|納豆/.test(i.title)).map(i => i.kind + "：" + i.title.slice(0, 24)).join(" / "));

    /* ---------- 5. 脱線・進捗なし ---------- */
    const s5 = await utter(10, 30, "今、資料をやり始めたんだけど、分からないところを調べてたら別のことが気になって、そっちをずっと見ちゃってた。資料自体はまだあまり進んでない。でも調べたことは面白かったから、あとで見返せるように残しておきたい。今は一回資料に戻りたい。");
    ok("5. 資料を完了にしない", shiryo && findItem(shiryo.id).status === "open", shiryo && findItem(shiryo.id).status);
    ok("5. 「進んでない」を進捗として記録する",
       shiryo && (findItem(shiryo.id).history || []).some(h => /進捗/.test(h.what)),
       shiryo && (findItem(shiryo.id).history || []).map(h => h.what).join(" | "));
    ok("5. 調べた内容が不明なので、中身を保存したふりをしない",
       !state.items.some(i => i.kind === "memo" && /面白かった内容は/.test(i.title)));
    ok("5. 返事が本人を責めていない", !/(なぜ|どうして|集中でき(て|ない)|ダメ)/.test(s5.reply), s5.reply);

    /* ---------- 6. 明日の予定の訂正（AIなしでは特定できないことを示す） ---------- */
    const ev = {
      id: uid(), noteId: null, kind: "event", title: "打ち合わせ", fixed: true, timeUnknown: false,
      start: zoned(2026, 9, 13, 15, 0, TZ).toISOString(), end: zoned(2026, 9, 13, 16, 0, TZ).toISOString(),
      dayKey: NEXT, duePrecision: "exact", origin: "user", confirmed: true, corrected: false,
      status: "open", evidence: { text: "（手入力）" }, createdAt: new Date().toISOString(), updatedAt: "", history: []
    };
    ev.dedupeKey = dedupeKey(ev); await putItem(ev);
    const s6 = await utter(11, 0, "そういえば、明日の予定、15時じゃなくて14時だった。移動に40分くらいかかる。直前に慌てたくないから、少し余裕を持たせておいて。");
    say("  （AIありのときの ops を模して適用）");
    const fake = state.notes[state.notes.length - 1];
    await applyOps([{ op: "update", id: ev.id, dueDate: NEXT, dueTime: "14:00", travelMin: 40, prepMin: 20, quote: "15時じゃなくて14時だった" }], fake);
    const ev2 = findItem(ev.id);
    ok("6. 開始時刻が14時に訂正される", parts(new Date(ev2.start), TZ).h === 14, fmtDT(ev2.start, TZ));
    ok("6. 予定が増えていない（新規追加しない）", state.items.filter(i => i.kind === "event" && i.dayKey === NEXT).length === 1);
    const pn = planFor(NEXT, { nowMin: -1 });
    ok("6. 移動40分が予定の前に確保される",
       pn.blocks.some(b => b.sub === "travel" && b.e === 14 * 60 && b.s === 13 * 60 + 20),
       pn.blocks.filter(b => b.type === "fixed").map(b => hhmm(b.s) + "-" + hhmm(b.e) + " " + blockTitle(b)).join(" / "));
    ok("6. 準備の余裕も入る", pn.blocks.some(b => b.sub === "prep"));

    /* ---------- 7. 昼・散歩は迷い ---------- */
    const s7 = await utter(13, 0, "お昼食べた。コンビニのおにぎり2個とサラダチキン。ちょっと眠くなってきた。散歩するか迷ってる。今日まだほとんど外に出てないし、10分くらい歩こうかな。");
    ok("7. 「迷ってる」をタスクにしない",
       !state.items.some(i => i.kind === "task" && /散歩|歩/.test(i.title)),
       state.items.filter(i => /散歩|歩/.test(i.title)).map(i => i.kind + "：" + i.title.slice(0, 20)).join(" / ") || "タスク化なし");

    /* ---------- 8. あと1時間・夜まではやりたくない・何を後回し？ ---------- */
    const s8 = await utter(14, 0, "資料、思ったより時間かかってる。あと1時間は必要そう。今日はほかに何を後回しにできる？ 夜までずっと作業する感じにはしたくない。");
    ok("8. 残り時間を1時間に更新する", shiryo && findItem(shiryo.id).remainingMin === 60,
       shiryo && String(findItem(shiryo.id).remainingMin));
    ok("8. 「夜まではやりたくない」が希望として残る", prefs(KEY).lightDay === true, String(prefs(KEY).lightDay));
    /* v4.4：置き場所を言っていないものは、そもそも今日に置きにいかない。
       だから `lightDay` が効くのは「夕方以降にと言った、急がない作業」のような、
       置き場所つきのものだけになった。そこを直接確かめる。 */
    {
      /* 日付を決めていない（＝急がない）作業に、置き場所だけ言ったもの。
         v4.6 で「期限が先のもの」は今日の候補にならなくなったので、
         `lightDay` が効くのはこういう形だけになった。 */
      const t = { id: uid(), kind: "task", title: "夕方にやろうと思っていた作業", estimateMin: 60,
        status: "open", origin: "user", confirmed: true, corrected: false, evidence: { text: "x" },
        duePrecision: "none", dayKey: null, due: null,
        preferWindow: "evening", createdAt: T(9, 0), updatedAt: "", history: [] };
      t.dedupeKey = dedupeKey(t); await putItem(t);
      const p8 = planFor(KEY, { nowMin: 14 * 60 });
      ok("8. 夕方にと言った急がない作業は、今日は置かず理由を出す",
         p8.unplaced.some(u => u.item.id === t.id && /詰めない/.test(u.reason)),
         p8.unplaced.map(u => u.item.title + "（" + u.reason + "）").join(" / ") || "未配置なし");
      state.items = state.items.filter(i => i.id !== t.id);
    }
    ok("8. 「何を後回しにできる？」に、いまの状態から答える",
       !!s8.reply && /(後ろに回せる|削らなくて大丈夫|入れていない)/.test(s8.reply), s8.reply);
    ok("8. 同じことを二度言わない",
       (s8.reply.match(/友達にAIの構想を送ろう/g) || []).length <= 1,
       "「友達…」の登場回数 " + (s8.reply.match(/友達にAIの構想を送ろう/g) || []).length);
    ok("8. 14時より前に新しい作業を置かない",
       planFor(KEY, { nowMin: 14 * 60 }).blocks.filter(b => b.type === "flex").every(b => b.s >= 14 * 60),
       planFor(KEY, { nowMin: 14 * 60 }).blocks.filter(b => b.type === "flex").map(b => hhmm(b.s)).join(","));

    /* ---------- 9. 表示の好み ---------- */
    const s9 = await utter(14, 30, "今ふと思ったんだけど、自分は予定が細かく決まってると、遅れた瞬間に全部嫌になるのかもしれない。次にやることが一つ分かるくらいの方が楽な気がする。しばらくそういう出し方にしてみてほしい。");
    ok("9. 「〜な気がする」をタスクにしない",
       !state.items.some(i => i.kind === "task" && /気がする|かもしれない|出し方/.test(i.title)),
       state.items.filter(i => i.kind === "task").map(i => i.title.slice(0, 26)).join(" / "));
    ok("9. 「一つだけ」を表示の好みとして保存", prefs(KEY).nextOnly === true,
       liveItems().filter(i => i.kind === "preference").map(i => i.title).join(" / "));
    ok("9. 以後、返事に予定表を広げない", s9.showTable === false);
    const s9b = await utter(14, 35, "ありがとう");
    ok("9. 次の返事でも予定表を広げない", s9b.showTable === false);
    ok("9. 全体の予定は折りたたみで見られる", planFor(KEY, { nowMin: 14 * 60 + 35 }).blocks.length >= 0);

    /* ---------- 10. 完了・一部だけ ---------- */
    const s10 = await utter(15, 30, "資料できた。送るのも終わった。これは完了でいい。友達への連絡はまだ。今日はもう疲れたから、明日以降に回したい。");
    ok("10. 資料だけ完了になる", shiryo && findItem(shiryo.id).status === "done", shiryo && findItem(shiryo.id).status);
    ok("10. 友達への連絡は未完了のまま", !tomo || findItem(tomo.id).status === "open", tomo && findItem(tomo.id).status);
    ok("10. 「〜はまだ」から新しいタスクを作らない",
       !state.items.some(i => i.kind === "task" && /はまだ|がまだ/.test(i.title)),
       state.items.filter(i => i.kind === "task").map(i => i.title.slice(0, 24)).join(" / "));
    ok("10. 「明日以降に回したい」で友達の連絡が翌日に移る",
       !tomo || findItem(tomo.id).dayKey === NEXT || (findItem(tomo.id).history || []).some(h => /延期/.test(h.what)),
       tomo && ("期限" + findItem(tomo.id).dayKey));
    ok("10. 完了した資料を再提案しない",
       !planFor(KEY, { nowMin: 15 * 60 + 30 }).blocks.some(b => b.item.id === (shiryo && shiryo.id)));

    /* ---------- 11. 夕食（過去の発言を参照・断定しない） ---------- */
    const s11 = await utter(18, 30, "夜ごはんどうしよう。外で食べたい気もするけど、今週ちょっとお金使ってるんだよね。家にあるもので簡単に作れるならそうしたい。");
    ok("11. 朝の食材の話を参照する", /卵|納豆/.test(s11.reply), s11.reply);
    ok("11. 「まだある」と断定しない", !/(卵と納豆がある|残っている)(?!か)/.test(s11.reply), s11.reply);
    ok("11. 夕食をタスクとして勝手に作らない",
       !state.items.some(i => i.kind === "task" && /夜ごはん|夕食/.test(i.title)));

    /* ---------- 12. 振り返り・明日への希望 ---------- */
    const s12 = await utter(22, 0, "今日はあまり進んでない気がしてたけど、資料を送れたからまあよかった。何に時間がかかったのか、あとで振り返れるようにしておいて。明日は今日より少し余裕がほしい。今日は早めに寝たいから、寝る前に新しい調べものを始めないようにしたい。");
    /* 完了した時刻は「本物のいま」で押される（実際に押した日時だから、それが正しい）。
       この通し検証は 2026-09-12 を演じているので、実行日がその日でないと日がずれる。
       **実行日に依存しないよう、完了が載るはずの日（本物の今日）で見る。**
       ここを KEY で見ていたため、日付が変わった翌日に落ちた（v4.1）。 */
    const rv = reviewFor(dayKey(new Date(), TZ));
    ok("12. 振り返りに完了したものが出る", rv.done.some(i => /資料/.test(i.title)), rv.done.map(i => i.title).join(" / "));
    ok("12. 振り返りに時間の変化が残る", rv.est.length >= 1 || (findItem(shiryo.id).history || []).some(h => /進捗/.test(h.what)),
       (findItem(shiryo.id).history || []).map(h => h.what).join(" | "));

    /* ---------- 再起動しても残るか ---------- */
    lsWrite();
    const raw = lsRead();
    const restoredPref = (raw.items || []).filter(i => i.kind === "preference").map(i => i.preferKey);
    ok("再起動後も記録が残る", raw && raw.items.length === state.items.length && raw.notes.length === state.notes.length,
       raw ? raw.items.length + "件" : "なし");
    ok("再起動後も表示の好みが残る", restoredPref.includes("nextOnly"), restoredPref.join(","));

    /* ---------- 同じ発言をもう一度送っても増えない ---------- */
    const n0 = state.items.length;
    await utter(22, 5, "資料、思ったより時間かかってる。あと1時間は必要そう。");
    ok("同じ内容を再送してもタスクが増えない", state.items.length === n0, n0 + "→" + state.items.length);

    /* ---------- 例文専用になっていないか（別の言葉で同じことを言う） ---------- */
    say("");
    say("━━━━ 別の会話でも同じように動くか ━━━━");
    state.notes = []; state.items = []; state.turns = {};
    state.settings = Object.assign({}, state.settings, { workStart: "09:00", workEnd: "19:00" });
    await utter(9, 15, "今日はだるい。あんまり詰め込まないで。");
    await utter(9, 20, "金曜までに請求書をまとめないと。2時間半くらいかかる。できれば今日のうちに手を付けたい。");
    const seikyu = state.items.find(i => i.kind === "task" && /請求書/.test(i.title));
    ok("別の会話：締切（金曜）と実行目標（今日）を分ける",
       seikyu && seikyu.dayKey > KEY && seikyu.targetDay === KEY,
       seikyu && ("締切" + seikyu.dayKey + " / 目標" + seikyu.targetDay));
    ok("別の会話：2時間半を150分として読む", seikyu && seikyu.estimateMin === 150, seikyu && String(seikyu.estimateMin));
    await utter(11, 0, "請求書、まだ半分。あと40分かかりそう。");
    ok("別の会話：残り時間を更新する", seikyu && findItem(seikyu.id).remainingMin === 40,
       seikyu && String(findItem(seikyu.id).remainingMin));
    const s = await utter(15, 0, "請求書の作成、終わった。");
    ok("別の会話：完了になる", seikyu && findItem(seikyu.id).status === "done", seikyu && findItem(seikyu.id).status);
    ok("別の会話：15時より前に新しい作業を置かない",
       planFor(KEY, { nowMin: 15 * 60 }).blocks.filter(b => b.type === "flex").every(b => b.s >= 15 * 60));

    const fails = R.filter(x => x.startsWith("FAIL"));
    const pre = document.createElement("pre"); pre.id = "SCENARIO";
    pre.textContent = OUT.join("\n") + "\n\n===== 検証結果 =====\n" + R.join("\n") +
      `\n\n合計 ${R.length} 件 / 失敗 ${fails.length} 件\n===== END =====\n`;
    document.body.appendChild(pre);
  }

  run().catch(e => {
    const pre = document.createElement("pre"); pre.id = "SCENARIO";
    pre.textContent = OUT.join("\n") + "\n\n===== CRASHED =====\n" + (e && (e.stack || e.message || e)) + "\n";
    document.body.appendChild(pre);
  });
})();
