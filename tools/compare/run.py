#!/usr/bin/env python3
"""前の版と、同じ入力で比べる（2026-09-28・CLAUDE.md「大きく変えたら、変える前の版と同じ入力で比べる」）。

    python3 tools/compare/run.py                    # いまの app/index.html と HEAD を比べる
    python3 tools/compare/run.py --old HEAD~3       # 3つ前のコミットと比べる
    python3 tools/compare/run.py --only rules,seq   # 比べるものをしぼる

比べるもの（どれもルールの読み取りだけ・AIは呼ばない・お金はかからない）：
  rules … ふだんの言い方（corpus.json）を、5つの時刻（1:30・7:00・10:00・16:58・22:30）に1文ずつ読ませる
  seq   … 会話の流れ（seqs.json・128本）を1発言ずつ流す。返事と、残った項目
  ai    … ルールが読んだ項目を「AIが返しそうな形」6通りに崩して applyOps に通す（3つの時刻）

差が出た文を、1件ずつ「良くなった／悪くなった／前からの弱点」に分けること。
**テストが全部通っても、悪化は比べて初めて見つかる**（決まりの経緯 2026-09-28）。

結果はリポジトリの外（一時フォルダ）に書く。本人の生活データは入れない（入力は corpus.json と seqs.json だけ）。
"""
import argparse, concurrent.futures as cf, difflib, glob, html, json, os, pathlib, re, shutil, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
RULE_TIMES = [[1, 30], [7, 0], [10, 0], [16, 58], [22, 30]]
AI_TIMES = [[10, 0], [16, 58], [22, 30]]


def find_chrome(given):
    for c in [given, os.environ.get("CHROME")]:
        if c and pathlib.Path(c).exists():
            return c
    cands = sorted(glob.glob("/opt/pw-browsers/chromium*/chrome-linux/chrome"), reverse=True) + [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    for c in cands:
        if pathlib.Path(c).exists():
            return c
    for n in ["chromium", "chromium-browser", "google-chrome", "msedge"]:
        p = shutil.which(n)
        if p:
            return p
    sys.exit("ブラウザ（Chromium か Edge）が見つかりません。--chrome で場所を渡してください。")


def app_html(ref):
    """ref が 'WORKTREE' ならいまのファイル、ほかは git の版（HEAD・HEAD~1・コミット）"""
    if ref == "WORKTREE":
        return (ROOT / "app" / "index.html").read_text(encoding="utf-8")
    r = subprocess.run(["git", "-C", str(ROOT), "show", f"{ref}:app/index.html"], capture_output=True)
    if r.returncode:
        sys.exit(f"{ref} の app/index.html が読めません：{r.stderr.decode('utf-8', 'replace').strip()}")
    return r.stdout.decode("utf-8")


def run_page(chrome, out, name, app, pre, runner, budget):
    page = out / f"{name}.html"
    page.write_text('<!doctype html><html><head><meta charset="utf-8"></head><body>' + app
                    + "<script>" + pre + "\n" + runner + "</script></body></html>", encoding="utf-8")
    prof = out / f"prof-{name}"
    shutil.rmtree(prof, ignore_errors=True)
    r = subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
                        "--force-prefers-reduced-motion", f"--user-data-dir={prof}", "--allow-file-access-from-files",
                        f"--virtual-time-budget={budget}", "--dump-dom", page.as_uri()],
                       capture_output=True, timeout=1800)
    m = re.search(r'<pre id="OUT">(.*?)</pre>', r.stdout.decode("utf-8", "replace"), re.S)
    text = html.unescape(m.group(1)) if m else "NO OUTPUT"
    (out / f"{name}.out").write_text(text, encoding="utf-8")
    shutil.rmtree(prof, ignore_errors=True)
    return name, text


def main():
    ap = argparse.ArgumentParser(description="前の版と同じ入力で比べる")
    ap.add_argument("--old", default="HEAD", help="比べる前の版（git の ref・既定 HEAD）")
    ap.add_argument("--new", default="WORKTREE", help="比べる後の版（既定はいまの app/index.html）")
    ap.add_argument("--only", default="rules,seq,ai", help="rules,seq,ai から選ぶ")
    ap.add_argument("--out", default=str(pathlib.Path(tempfile.gettempdir()) / "hitohi-compare"), help="結果を書く場所（リポジトリの外）")
    ap.add_argument("--chrome", default=None, help="Chromium か Edge の場所")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--show", type=int, default=40, help="画面に出す差の行数（全部は --out の .diff に）")
    a = ap.parse_args()
    chrome = find_chrome(a.chrome)
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    only = [x.strip() for x in a.only.split(",") if x.strip()]
    apps = {"old": app_html(a.old), "new": app_html(a.new)}
    corpus = json.loads((HERE / "corpus.json").read_text(encoding="utf-8"))
    seqs = json.loads((HERE / "seqs.json").read_text(encoding="utf-8"))
    runners = {k: (HERE / f"{k}.js").read_text(encoding="utf-8") for k in ["rules", "seq", "ai"]}
    jobs = []
    for v in ["old", "new"]:
        if "rules" in only:
            for h, mi in RULE_TIMES:
                jobs.append((f"rules-{h:02d}{mi:02d}-{v}", apps[v], f"window.__TIMES={json.dumps([[h, mi]])};window.__UTTER={json.dumps(corpus, ensure_ascii=False)};", runners["rules"], 600000))
        if "ai" in only:
            for h, mi in AI_TIMES:
                jobs.append((f"ai-{h:02d}{mi:02d}-{v}", apps[v], f"window.__TIMES={json.dumps([[h, mi]])};window.__UTTER={json.dumps(corpus, ensure_ascii=False)};", runners["ai"], 900000))
        if "seq" in only:
            jobs.append((f"seq-{v}", apps[v], f"window.__SEQ={json.dumps(seqs, ensure_ascii=False)};", runners["seq"], 600000))
    print(f"{a.old} と {'いまのファイル' if a.new == 'WORKTREE' else a.new} を比べます（{len(jobs)} 回ブラウザを開く・{out}）", flush=True)
    res = {}
    with cf.ThreadPoolExecutor(a.jobs) as ex:
        for name, text in ex.map(lambda j: run_page(chrome, out, *j), jobs):
            res[name] = text
    total = 0
    for base in sorted({n.rsplit("-", 1)[0] for n in res}):
        o, n = res.get(base + "-old", ""), res.get(base + "-new", "")
        if "NO OUTPUT" in (o, n):
            print(f"== {base}：結果が取れませんでした（ブラウザが途中で止まった）"); total += 1; continue
        d = [l for l in difflib.unified_diff(o.splitlines(), n.splitlines(), "old", "new", lineterm="", n=0) if l[:1] in "+-" and l[:3] not in ("---", "+++")]
        (out / f"{base}.diff").write_text("\n".join(d), encoding="utf-8")
        print(f"== {base}：{len(o.splitlines())} 行のうち、差 {len([l for l in d if l.startswith('+')])} 行")
        for l in d[:a.show]:
            print("   " + l[:220])
        total += len(d)
    print("差なし" if not total else f"差あり（全部は {out}/*.diff）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
