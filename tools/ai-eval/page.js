/* AI の質を本物の Gemini で比べる道具（tools/ai-eval）の、ページ側。
   本体（app/index.html）の sendTurn をそのまま通し、AI の返事だけを差し替える。
   __MODE = "capture"：AI に送る依頼文を記録する（返事は空）
   __MODE = "apply"  ：記録しておいた AI の返事で sendTurn を流し、できた予定・用事を採点する
   pre（前に話したこと）があるものは、それをルールだけで先に流してから、確かめる発言を送る
   （どの比べ方でも同じ状態から始めるため）。 */
(async () => {
  const out = { mode: window.__MODE, results: [] };
  try {
    for (let i = 0; i < 300 && !state.ready; i++) await new Promise(r => setTimeout(r, 20));
    const TZ = "Asia/Tokyo";
    const RealDate = Date; let FIX = 0;
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIX); } static now() { return FIX; } }
    window.Date = FakeDate;
    // 項目の id を毎回同じにする（記録したときと採点するときで、AI が指す id がずれないように）
    let seed = 1;
    Math.random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const seedOf = s => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
    const hm = x => { const p = parts(new RealDate(x), TZ); return pad2(p.h) + ":" + pad2(p.mi); };
    const setAt = at => {
      const [d, t] = at.split("T"); const [y, mo, da] = d.split("-").map(Number); const [h, mi] = t.split(":").map(Number);
      FIX = zoned(y, mo, da, h, mi, TZ).getTime();
      view.day = view.chatDay = dayKey(new RealDate(FIX), TZ);
    };
    const settle = async () => { for (let k = 0; k < 10; k++) await new Promise(r => setTimeout(r, 5)); };
    const configs = window.__MODE === "capture" ? ["capture"] : Object.keys(window.__RESP || {});
    for (const cfg of configs) {
      for (const c of window.__CASES) {
        state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
        state.notes = []; state.items = []; state.turns = {}; state.docs = [];
        seed = seedOf(c.id);
        const rec = { id: c.id, cfg };
        SAMPLEFN = null;
        for (const p of c.pre || []) {
          setAt(p.at);
          try { await sendTurn(p.t); } catch (e) { rec.error = "前の発言で止まった：" + String(e && e.message || e); }
          await settle();
        }
        rec.preIds = state.items.map(i => i.id);
        setAt(c.at);
        if (window.__MODE === "capture") {
          const f = (prompt, opts) => { rec.quick = prompt; return Promise.resolve({ text: "うん。" }); };
          f.json = (prompt, opts) => { rec.main = prompt; return Promise.resolve({ ops: [], habit: "" }); };
          SAMPLEFN = f;
        } else if (cfg !== "rules") {
          const r = Object.assign({}, (window.__RESP[cfg] || {})[c.id] || {});
          // 依頼文を記録した版で id がずれていたら、作った順で付け替える（並べ替える前の版と比べるとき）
          const cap = ((window.__PREIDS || {})[cfg] || {})[c.id];
          if (cap && r.main != null) {
            if (cap.length !== rec.preIds.length) rec.error = `前の発言でできた数が違う（記録 ${cap.length}・採点 ${rec.preIds.length}）`;
            else cap.forEach((id, k) => { if (id !== rec.preIds[k]) r.main = String(r.main).split(id).join(rec.preIds[k]); });
          }
          const f = () => r.quick == null ? Promise.reject(new Error("quick なし")) : Promise.resolve({ text: String(r.quick) });
          f.json = () => r.main == null ? Promise.reject(Object.assign(new Error("AIの返事なし：" + (r.err || "")), { code: "none" }))
            : Promise.resolve().then(() => jsonFromText(String(r.main)));
          SAMPLEFN = f;
        }
        try { await sendTurn(c.t); } catch (e) { rec.error = String(e && e.message || e); }
        await settle();
        if (window.__MODE === "apply") {
          const items = state.items.filter(i => (i.kind === "task" || i.kind === "event") && i.status === "open");
          const when = i => {
            const day = i.dayKey || null;
            let time = null;
            if (i.kind === "event" && i.start && !i.timeUnknown && !i.allDay) time = hm(i.start);
            if (i.kind === "task" && i.due && i.duePrecision === "exact") { const x = hm(i.due); if (x !== "23:59") time = x; }
            return { day, time };
          };
          const used = new Set(), miss = [];
          for (const e of c.expect) {
            const it = items.find(i => !used.has(i.id) && i.title.includes(e.w));
            if (!it) { miss.push(`「${e.w}」が無い`); continue; }
            used.add(it.id);
            const w = when(it);
            if (e.day !== undefined && w.day !== e.day) miss.push(`「${e.w}」の日 ${w.day || "なし"}（正：${e.day || "なし"}）`);
            if (e.time !== undefined && w.time !== e.time) miss.push(`「${e.w}」の時刻 ${w.time || "なし"}（正：${e.time || "なし"}）`);
          }
          const extra = items.filter(i => !used.has(i.id)).map(i => `余計「${i.title}」`);
          if (rec.error) miss.unshift(rec.error);
          rec.ok = miss.length === 0 && extra.length === 0;
          rec.why = miss.concat(extra).join(" / ");
          const last = Object.values(state.turns).flat().filter(x => x.role === "assistant").pop();
          rec.reply = last ? last.text : "";
          rec.usedAI = !!(last && last.ai);
          rec.items = items.map(i => `${i.kind}「${i.title}」${when(i).day || "日付なし"} ${when(i).time || ""}`);
        }
        out.results.push(rec);
      }
    }
    window.Date = RealDate;
  } catch (e) { out.fatal = String(e && e.stack || e); }
  const pre = document.createElement("pre"); pre.id = "OUT"; pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
})();
