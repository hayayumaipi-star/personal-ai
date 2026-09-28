(async () => {
  const out = []; const log = (...a) => out.push(a.join(" "));
  try {
    for (let i = 0; i < 200 && !state.ready; i++) await new Promise(r => setTimeout(r, 20));
    const TZ = "Asia/Tokyo";
    const fmt = i => {
      const w = i.kind === "event" ? (i.allDay ? "終日" + i.dayKey + (i.spanEndKey ? "〜" + i.spanEndKey : "") : i.timeUnknown ? i.dayKey + " 時刻未定" + (i.preferWindow ? "@" + i.preferWindow : "") : fmtDT(i.start, TZ) + (i.end ? "-" + fmtDT(i.end, TZ).slice(6) : ""))
        : i.kind === "task" ? (i.due ? fmtDT(i.due, TZ) + (i.dueIsDeadline ? "まで" : "") + "/" + i.duePrecision : "期限なし") + (i.estimateMin ? " " + i.estimateMin + "分" : "") + (i.preferWindow ? " " + i.preferWindow : "") + (i.targetDay ? " target" + i.targetDay : "")
        : i.kind === "preference" ? i.preferKey + "=" + JSON.stringify(i.preferValue) + " scope=" + i.scopeDay : i.kind === "condition" ? i.selfReport : "";
      return `${i.status} ${i.kind}「${i.title}」${w}${i.repeat ? "［" + repeatJa(i.repeat) + "］" : ""}${i.whenAlt ? " alt=" + fmtDT(i.whenAlt.start || i.whenAlt.dayKey, TZ) : ""}`;
    };
    for (const [h, mi] of window.__TIMES) {
      state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
      const at = zoned(2026, 9, 28, h, mi, TZ).toISOString();
      for (const text of window.__UTTER) {
        state.notes = []; state.items = []; state.turns = {}; state.docs = [];
        const note = { id: uid(), text, hash: hash(text), capturedAt: at, source: "talk", sourceName: null, createdAt: at };
        await putNote(note);
        let r;
        try { r = await applyOps(ruleOps(note), note); } catch (e) { log("ERR", h + ":" + mi, text, e.message); continue; }
        log("■", pad2(h) + ":" + pad2(mi), text, "→", state.items.map(fmt).join(" ｜ ") || "（なし）", (r.asks || []).length ? " ?" + r.asks.join("/").slice(0, 80) : "");
      }
    }
  } catch (e) { log("ERR", e.stack); }
  const pre = document.createElement("pre"); pre.id = "OUT"; pre.textContent = out.join("\n"); document.body.appendChild(pre);
})();
