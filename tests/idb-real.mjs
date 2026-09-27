/* 奥の保存場所（IndexedDB）を、**本物の時計のブラウザで**確かめる（2026-09-27）。
   4つのテストは仮想の時計で走るが、その下では IndexedDB が開かない（開く返事が来ない・実測）。
   だから probe.js の CJ群は偽物で仕組みを見て、本物はここで見る。
   使い方：node tests/idb-real.mjs   （Playwright と Chromium が要る。docs/開発メモ.md） */
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.PW_MODULES || "/opt/node22/lib/node_modules/");
const { chromium } = require("playwright");
const tmp = process.env.TMPDIR_IDB || "/tmp/hitohi-idb";
mkdirSync(tmp, { recursive: true });
const page = join(tmp, "app.html");
writeFileSync(page, readFileSync(process.env.APP_HTML || join(here, "..", "app", "index.html"), "utf8"));
const exe = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const b = await chromium.launch({ executablePath: exe, args: ["--allow-file-access-from-files", "--no-sandbox"] });
const ctx = await b.newContext();
const p = await ctx.newPage();
const R = [];
const ok = (n, c, e) => R.push((c ? "PASS" : "FAIL") + " :: " + n + (e ? "  [" + e + "]" : ""));
try {
  await p.goto("file://" + page);
  await p.waitForFunction(() => typeof state !== "undefined" && state.ready);
  // 1. ふつうに書く → 両方に入る
  const r1 = await p.evaluate(async () => {
    state.items.push({ id: "r1", kind: "task", title: "ふつうに書いた", status: "open", origin: "rule", confirmed: false, corrected: false, history: [], createdAt: new Date().toISOString() });
    await lsWrite();
    const g = await idbGet();
    const v = g.ok && g.v ? JSON.parse(g.v) : null;
    return { idb: !!v && v.items.some(i => i.id === "r1"), ls: (lsRead().items || []).some(i => i.id === "r1"), idbOk };
  });
  ok("本物の IndexedDB に書ける", r1.idb && r1.idbOk === true, JSON.stringify(r1));
  ok("localStorage にも今までどおり書く", r1.ls);
  // 2. localStorage が一杯 → 奥にだけ入る。騒がない
  const r2 = await p.evaluate(async () => {
    const real = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; };
    state.items.push({ id: "r2", kind: "task", title: "一杯のあとに足した", status: "open", origin: "rule", confirmed: false, corrected: false, history: [], createdAt: new Date().toISOString() });
    let pr; try { pr = lsWrite(); } finally { localStorage.setItem = real; }
    await pr;
    return { lsHas: (lsRead().items || []).some(i => i.id === "r2"), lsFailed, lastError };
  });
  ok("一杯のときは localStorage に入らない（再現できている）", !r2.lsHas);
  ok("奥に残ったので「残りません」と騒がない", !r2.lsFailed && !r2.lastError, JSON.stringify(r2));
  // 3. 開き直す → 新しいほう（奥）を読む
  await p.reload();
  await p.waitForFunction(() => typeof state !== "undefined" && state.ready);
  await p.waitForFunction(() => state.items.some(i => i.id === "r2"), null, { timeout: 5000 }).catch(() => {});
  const r3 = await p.evaluate(() => state.items.map(i => i.title));
  ok("開き直すと、一杯のあとに足したものも戻る", r3.includes("一杯のあとに足した") && r3.includes("ふつうに書いた"), r3.join("/"));
  // 4. 全部消す（手前と奥の両方が空になる）→ 開き直しても戻らない
  await p.evaluate(async () => { state.items = []; state.notes = []; state.turns = {}; state.docs = []; await lsWrite(); });
  await p.reload();
  await p.waitForFunction(() => typeof state !== "undefined" && state.ready);
  await new Promise(r => setTimeout(r, 800));
  const r4 = await p.evaluate(() => state.items.length);
  ok("消したものは、奥の保存場所から生き返らない", r4 === 0, r4 + "件");
} catch (e) { R.push("FAIL :: 途中で止まった  [" + (e && e.message) + "]"); }
await b.close();
const fails = R.filter(x => x.startsWith("FAIL"));
console.log(R.join("\n") + `\n\nidb-real: 合計 ${R.length} 件 / 失敗 ${fails.length} 件`);
process.exit(fails.length ? 1 : 0);
