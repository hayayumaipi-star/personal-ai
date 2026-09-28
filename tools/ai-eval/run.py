#!/usr/bin/env python3
"""AI の質を、本物の Gemini で比べる（2026-09-28・本人の指示「質が落ちてないか調べつくして」）。

使い方：
    GEMINI_API_KEY=... python3 tools/ai-eval/run.py            # 全部の比べ方
    python3 tools/ai-eval/run.py --configs rules               # 鍵なし（ルールだけ）で道具を確かめる

やること：
  1. 本体（app/index.html）の sendTurn をそのまま動かして、AI に送る依頼文を記録する
     （今の並び＝new と、並べ替える前の 2026-09-27 の版＝old の両方）。
  2. 同じ依頼文を Gemini に送る。考える深さ（low / medium / 指定なし）を変えて比べる。
     かかった量（送った・使い回した・考えた・返ってきた）と時間も記録する。
  3. 返ってきた答えで、もう一度 sendTurn を流し、できた予定・用事を正解（cases.json）と照らして採点する。

鍵はファイルに書かない（環境変数から読むだけ）。結果は一時フォルダに書く（リポジトリには書かない）。
話す文は作り物で、本人の生活データは入っていない。
"""
import argparse, json, os, re, subprocess, sys, tempfile, time, html, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OLD_REV = "b366e4d"   # 並べ替え・考える深さを変える前（2026-09-27）

CONFIGS = {
    # 名前: (依頼文の並び, 読み取りの深さ, 受け止めの一言も呼ぶか)
    "rules":      (None, None, False),        # AI なし（ルールだけ）
    "new-low":    ("new", "low", True),       # 今（2026-09-28 から）
    "new-medium": ("new", "medium", False),   # 並びは今・深さは前の意図
    "old-medium": ("old", "medium", False),   # 並べ替える前・前の意図
    "new-none":   ("new", None, True),        # 深さの指定なし＝9/27 まで実際に動いていた形（指定の場所が違って毎回断られ、素の形で送っていた）
}


def chrome_path():
    for p in [os.environ.get("CHROME", ""), "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
              "/usr/bin/chromium", "/usr/bin/google-chrome"]:
        if p and os.path.exists(p):
            return p
    sys.exit("Chrome が見つかりません。環境変数 CHROME に場所を入れてください。")


def run_page(app_html, data_js, work):
    page = os.path.join(work, "page.html")
    with open(page, "w", encoding="utf-8") as f:
        f.write('<!doctype html><html><head><meta charset="utf-8"></head><body>')
        f.write(app_html)
        f.write("<script>" + data_js + "\n" + open(os.path.join(HERE, "page.js"), encoding="utf-8").read() + "</script></body></html>")
    prof = tempfile.mkdtemp(prefix="aieval-prof-", dir=work)
    r = subprocess.run([chrome_path(), "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
                        "--force-prefers-reduced-motion", "--user-data-dir=" + prof, "--allow-file-access-from-files",
                        "--virtual-time-budget=600000", "--dump-dom", "file://" + page],
                       capture_output=True, text=True, timeout=900)
    m = re.search(r'<pre id="OUT">(.*?)</pre>', r.stdout, re.S)
    if not m:
        sys.exit("ページから結果が返りませんでした。")
    out = json.loads(html.unescape(m.group(1)))
    if out.get("fatal"):
        sys.exit("ページで止まりました：" + out["fatal"])
    return out


def gemini(key, model, prompt, level, want_json, timeout=120):
    body = {"contents": [{"parts": [{"text": prompt}]}]}
    if level:
        g = {"thinkingConfig": {"thinkingLevel": level}}
        if want_json:
            g["responseMimeType"] = "application/json"
        body["generationConfig"] = g
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(body).encode("utf-8"),
        headers={"content-type": "application/json", "x-goog-api-key": key}, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.loads(r.read().decode("utf-8"))
            status = r.status
    except urllib.error.HTTPError as e:
        return {"status": e.code, "err": e.read().decode("utf-8", "replace")[:300], "ms": int((time.time() - t0) * 1000)}
    except Exception as e:  # つながらない
        return {"status": 0, "err": str(e)[:300], "ms": int((time.time() - t0) * 1000)}
    parts = (((d.get("candidates") or [{}])[0].get("content") or {}).get("parts")) or []
    return {"status": status, "text": "".join(p.get("text", "") for p in parts if isinstance(p, dict)),
            "usage": d.get("usageMetadata", {}), "ms": int((time.time() - t0) * 1000)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--configs", default=",".join(CONFIGS))
    ap.add_argument("--model", default="gemini-3.5-flash-lite")
    ap.add_argument("--rpm", type=float, default=10, help="1分あたりの呼び出し回数の上限（無料の枠に合わせる）")
    ap.add_argument("--price-in", type=float, default=0.30, help="100万トークンあたりの送る量の値段（ドル）")
    ap.add_argument("--price-out", type=float, default=2.50, help="100万トークンあたりの返ってくる量の値段（ドル・考えた量を含む）")
    ap.add_argument("--out", default=os.path.join(tempfile.gettempdir(), "hitohi-ai-eval"))
    ap.add_argument("--only", default="", help="この id で始まる発言だけ（カンマ区切り・例：r）")
    ap.add_argument("--reuse", default="", help="前に流した --out の返事（responses.json）で採点だけやり直す（AI を呼ばない）")
    a = ap.parse_args()
    cfgs = [c.strip() for c in a.configs.split(",") if c.strip()]
    for c in cfgs:
        if c not in CONFIGS:
            sys.exit(f"知らない比べ方：{c}（使えるもの：{', '.join(CONFIGS)}）")
    key = os.environ.get("GEMINI_API_KEY", "")
    if any(CONFIGS[c][0] for c in cfgs) and not key and not a.reuse:
        sys.exit("環境変数 GEMINI_API_KEY がありません（鍵なしで試すなら --configs rules）。")
    a.out = os.path.abspath(a.out)   # file:// には絶対の場所が要る
    os.makedirs(a.out, exist_ok=True)
    cases = json.load(open(os.path.join(HERE, "cases.json"), encoding="utf-8"))
    if a.only:
        cases = [x for x in cases if any(x["id"].startswith(p.strip()) for p in a.only.split(",") if p.strip())]
        if not cases:
            sys.exit("--only に当たる発言がありません。")
    cases_js = "window.__CASES=" + json.dumps(cases, ensure_ascii=False) + ";"
    new_html = open(os.path.join(REPO, "app", "index.html"), encoding="utf-8").read()

    # 1. 依頼文を記録する
    prompts = {}
    orders = sorted({CONFIGS[c][0] for c in cfgs if CONFIGS[c][0]})
    for order in orders:
        app = new_html if order == "new" else subprocess.run(["git", "-C", REPO, "show", f"{OLD_REV}:app/index.html"],
                                                             capture_output=True, text=True, check=True).stdout
        cap = run_page(app, cases_js + 'window.__MODE="capture";', a.out)
        prompts[order] = {r["id"]: r for r in cap["results"]}
        print(f"依頼文を記録しました（{order}）：{len(prompts[order])}件")

    # 2. Gemini に送る
    resp, calls = {}, []
    if a.reuse:
        old = json.load(open(os.path.join(a.reuse, "responses.json"), encoding="utf-8"))
        resp, calls = old["responses"], old["calls"]
        resp = {c: {k: v for k, v in resp.get(c, {}).items() if any(x["id"] == k for x in cases)} for c in cfgs}
        calls = [x for x in calls if x["cfg"] in cfgs and any(k["id"] == x["id"] for k in cases)]
    gap = 60.0 / max(a.rpm, 0.1)
    for c in cfgs:
        order, level, with_quick = CONFIGS[c]
        if a.reuse:
            continue
        resp[c] = {}
        if not order:
            continue
        for case in cases:
            p = prompts[order][case["id"]]
            r = {}
            if p.get("main"):
                g = gemini(key, a.model, p["main"], level, True)
                calls.append(dict(g, cfg=c, kind="main", id=case["id"])); time.sleep(gap)
                r["main"] = g.get("text") if g.get("status") == 200 else None
                if g.get("status") != 200:
                    r["err"] = f'{g.get("status")} {g.get("err", "")[:120]}'
            if with_quick and p.get("quick"):
                q = gemini(key, a.model, p["quick"], "low" if level else None, False)
                calls.append(dict(q, cfg=c, kind="quick", id=case["id"])); time.sleep(gap)
                r["quick"] = q.get("text") if q.get("status") == 200 else None
            resp[c][case["id"]] = r
            print(f"  {c} {case['id']} " + ("ok" if r.get("main") is not None else "×" + r.get("err", "")[:60]), flush=True)

    # 返事を先に残す（採点で止まっても、呼んだぶんを失わない）
    with open(os.path.join(a.out, "responses.json"), "w", encoding="utf-8") as f:
        json.dump({"responses": resp, "calls": [{k: v for k, v in x.items() if k != "text"} for x in calls]}, f, ensure_ascii=False, indent=1)

    # 3. 返事で流して採点する
    preids = {c: {i: r.get("preIds") for i, r in prompts[CONFIGS[c][0]].items()} for c in cfgs if CONFIGS[c][0] and CONFIGS[c][0] in prompts}
    graded = run_page(new_html, cases_js + 'window.__MODE="apply";window.__RESP=' + json.dumps(resp, ensure_ascii=False)
                      + ";window.__PREIDS=" + json.dumps(preids) + ";", a.out)
    by = {}
    for r in graded["results"]:
        by.setdefault(r["cfg"], []).append(r)

    # まとめ
    lines = [f"モデル：{a.model} ／ 発言 {len(cases)} 件", ""]
    lines.append("比べ方        正解    読み取り(平均)            送った  使い回し  考えた  返事   1回の費用(円・読み取り)")
    for c in cfgs:
        rs = by.get(c, [])
        ok = sum(1 for r in rs if r.get("ok"))
        mc = [x for x in calls if x["cfg"] == c and x["kind"] == "main" and x.get("status") == 200]
        avg = lambda k: (sum((x.get("usage") or {}).get(k, 0) or 0 for x in mc) / len(mc)) if mc else 0
        ms = (sum(x["ms"] for x in mc) / len(mc)) if mc else 0
        yen = ((avg("promptTokenCount") - avg("cachedContentTokenCount") * 0.75) * a.price_in
               + (avg("candidatesTokenCount") + avg("thoughtsTokenCount")) * a.price_out) / 1e6 * 150
        lines.append(f"{c:12s} {ok:2d}/{len(rs):2d}   {ms/1000:5.1f}秒{'':14s} {avg('promptTokenCount'):6.0f}  {avg('cachedContentTokenCount'):6.0f}  "
                     f"{avg('thoughtsTokenCount'):6.0f}  {avg('candidatesTokenCount'):5.0f}   {yen:.3f}" if mc else f"{c:12s} {ok:2d}/{len(rs):2d}   （AI なし）")
    for c in cfgs:
        if CONFIGS[c][0]:
            fb = [r["id"] for r in by.get(c, []) if not r.get("usedAI")]
            if fb:
                lines.append(f"（{c}：AI の返事が使えずルールに戻ったもの {len(fb)}件＝{', '.join(fb)}。この正解は AI の力ではない）")
    qc = [x for x in calls if x["kind"] == "quick" and x.get("status") == 200]
    for c in cfgs:
        q = [x for x in qc if x["cfg"] == c]
        if q:
            lines.append(f"受け止めの一言（{c}）：平均 {sum(x['ms'] for x in q)/len(q)/1000:.1f}秒・考えた量 "
                         f"{sum((x.get('usage') or {}).get('thoughtsTokenCount', 0) or 0 for x in q)/len(q):.0f}")
    lines.append("")
    lines.append("外れたもの：")
    for c in cfgs:
        for r in by.get(c, []):
            if not r.get("ok"):
                lines.append(f"  [{c}] {r['id']} {next(x['t'] for x in cases if x['id'] == r['id'])} → {r.get('why', '')}")
    report = "\n".join(lines)
    print("\n" + report)
    with open(os.path.join(a.out, "report.txt"), "w", encoding="utf-8") as f:
        f.write(report)
    with open(os.path.join(a.out, "detail.json"), "w", encoding="utf-8") as f:
        json.dump({"graded": graded["results"], "calls": [{k: v for k, v in x.items() if k != "text"} for x in calls],
                   "responses": resp}, f, ensure_ascii=False, indent=1)
    print(f"\n記録：{a.out}")


if __name__ == "__main__":
    main()
