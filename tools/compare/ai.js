(async () => {
  const out = []; const log = (...a) => out.push(a.join(" "));
  try {
    for (let i = 0; i < 200 && !state.ready; i++) await new Promise(r => setTimeout(r, 20));
    const TZ = "Asia/Tokyo";
    const fmt = i => {
      const w = i.kind === "event" ? (i.allDay ? "終日" + i.dayKey : i.timeUnknown ? i.dayKey + " 時刻未定" + (i.preferWindow ? "@" + i.preferWindow : "") : (i.start ? fmtDT(i.start, TZ) : "?") + (i.end ? "-" + fmtDT(i.end, TZ).slice(-5) : ""))
        : (i.kind === "task" || i.kind === "goal") ? (i.due ? fmtDT(i.due, TZ) + (i.dueIsDeadline ? "まで" : "") + "/" + i.duePrecision : "期限なし") + (i.estimateMin ? " " + i.estimateMin + "分" : "") + (i.preferWindow ? " " + i.preferWindow : "") : "";   // 時間帯も出す（出していなかったので、AIの道で時間帯が消えても差に出なかった・2026-09-29）
      return `${i.status} ${i.kind}「${i.title}」${w}${i.repeat ? "［" + repeatJa(i.repeat) + "］" : ""}${i.whenAlt ? " alt=" + (i.whenAlt.start ? fmtDT(i.whenAlt.start, TZ) : i.whenAlt.dayKey) : ""}`;
    };
    const SHAPES = ["E", "N", "A", "I", "D", "G"];
    for (const [h, mi] of window.__TIMES) {
      const at = zoned(2026, 9, 28, h, mi, TZ).toISOString();
      const tomorrow = addKey(dayKey(new Date(at), TZ), 1);
      for (const text of window.__UTTER) {
        state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
        state.notes = []; state.items = []; state.turns = {}; state.docs = [];
        const note = { id: uid(), text, hash: hash(text), capturedAt: at, source: "talk", sourceName: null, createdAt: at };
        let rops = [];
        try { rops = ruleOps(note); } catch { continue; }
        const built = rops.filter(o => o.op === "add" && o._built && ["task", "event", "goal"].includes(o._built.kind)).map(o => o._built);
        if (!built.length) continue;
        for (const sh of SHAPES) {
          const ops = [];
          for (const it of built) {
            const t = it.start || it.due, timed = !!t && !it.timeUnknown && !it.allDay && (it.kind === "event" || it.duePrecision === "exact");
            const min = timed ? minOfDay(t, TZ) : null;
            const o = { op: "add", kind: it.kind, title: it.title, quote: (it.evidence && it.evidence.text) || text, duePrecision: it.duePrecision || "none",
              dueDate: t ? dayKey(new Date(t), TZ) : null, dueTime: timed ? hhmm(min) : null,
              estimateMin: it.kind === "event" && it.start && it.end ? Math.round((new Date(it.end) - new Date(it.start)) / 60000) : (it.estimateMin || null) };
            if (sh === "N") { if (!timed) continue; o.dueDate = null; }
            if (sh === "A") { if (!timed) continue; o.dueDate = null; o.dueTime = hhmm((min + 720) % 1440); }
            if (sh === "I") { if (timed) continue; o.dueDate = null; o.dueTime = "10:00"; o.duePrecision = "exact"; }
            if (sh === "D") { if (t) continue; o.dueDate = tomorrow; o.dueTime = null; o.duePrecision = "day"; }
            if (sh === "G") { if (!timed) continue; o.kind = "goal"; o.dueDate = null; }
            ops.push(o);
          }
          if (!ops.length) continue;
          state.notes = []; state.items = []; state.turns = {}; state.docs = [];
          await putNote(note);
          let r;
          try { r = await applyOps(ops, note); } catch (e) { log("ERR", sh, text, e.message); continue; }
          log("■", pad2(h) + ":" + pad2(mi), sh, text, "→", state.items.map(fmt).join(" ｜ ") || "（なし）", (r.asks || []).length ? " ?" + r.asks.join("/").slice(0, 90) : "");
        }
      }
    }
  } catch (e) { log("ERR", e.stack); }
  const pre = document.createElement("pre"); pre.id = "OUT"; pre.textContent = out.join("\n"); document.body.appendChild(pre);
})();
