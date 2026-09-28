(async () => { const out=[]; try {
 for (let i = 0; i < 200 && !state.ready; i++) await new Promise(r => setTimeout(r, 20));
 const RealDate = Date; let FIX = 0;
 class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIX); } static now() { return FIX; } }
 window.Date = FakeDate;
 const TZ="Asia/Tokyo"; state.settings = Object.assign({}, DEFAULTS, { timezone: TZ });
 const base = window.__BASE || [2026,9,15];
 for (const seq of window.__SEQ) {
   state.notes = []; state.items = []; state.turns = {}; state.docs = [];
   out.push("■ " + seq.map(x=>x[0]+"@"+x[1]).join(" ｜ "));
   for (const [text, hm] of seq) {
     let [d, t] = hm.includes(" ") ? hm.split(" ") : [null, hm];
     const [h,m] = t.split(":").map(Number);
     const dd = d ? d.split("/").map(Number) : base;
     FIX = zoned(dd[0], dd[1], dd[2], h, m, TZ).getTime();
     view.day = view.chatDay = dayKey(new RealDate(FIX), TZ);
     try { await sendTurn(text); } catch (e) { out.push("  ERR " + e.message); }
     for (let k = 0; k < 20; k++) await new Promise(r => setTimeout(r, 5));
     const turns = Object.values(state.turns).flat();
     const last = turns.filter(x => x.role === "assistant").pop();
     out.push("  > " + text + " @" + hm);
     out.push("     reply: " + (last ? last.text.replace(/\s+/g, " ") : "(none)"));
     for (const i of state.items) out.push("     " + i.status + " " + i.kind + "「" + i.title + "」 " + (i.start ? (i.timeUnknown ? i.dayKey + " 時刻未定" : fmtDT(i.start,TZ) + (i.end?"〜"+fmtDT(i.end,TZ).slice(-5):"")) : i.due ? fmtDT(i.due,TZ) + (i.dueIsDeadline?"まで":"") + "/" + i.duePrecision : "") + (i.repeat ? "［" + repeatJa(i.repeat) + "］" : "") + (i.estimateMin?" "+i.estimateMin+"分":"") + (i.remainingMin?" 残"+i.remainingMin:"") + ((i.doneDays||[]).length ? " done:" + i.doneDays.join(",") : "") + ((i.skipDays||[]).length ? " skip:" + i.skipDays.join(",") : ""));
   }
 }
 window.Date = RealDate;
 } catch(e){out.push(e.stack)}
 const pre=document.createElement("pre"); pre.id="OUT"; pre.textContent=out.join("\n"); document.body.appendChild(pre); })();
