# LifeOS との関係（実測にもとづく現状）

最終更新: 2026-09-19

## 結論：**LifeOS 本体は入れていません。構造だけ借りました。**

本人の判断（2026-09-19・「②で進めて」）。理由は下の「入れなかった理由」。

## 何を借りたか

`danielmiessler/LifeOS`（MIT・TypeScript）を取り寄せて中身を読み、
**ファイルの形だけ**を借りました。コードは1行も使っていません。

| 借りたもの | このリポジトリでの置き場 |
|---|---|
| `USER/TELOS/TELOS.md` の見出し構成（Current State → Ideal State → Mission → Problems → Goals → Challenges → Strategies → Projects → Wisdom） | `lifeos/TELOS.md` |
| `LIFEOS/USER_TEMPLATES/Identity.md` の見出し（Quick facts / Worldview / Direction / Stance） | `lifeos/IDENTITY.md` |
| 「変わらないこと」と「起きたこと」を分ける考え方 | `lifeos/MEMORY.md` |

## 入れなかった理由（測った結果）

導入の手前まで実際に進めました。

```
取り寄せ        ✅ 51MB・今日も更新されている
前提            ✅ Ubuntu 24.04 / claude-code 検出 / bun 1.3.11 / git 2.43.0
衝突            ✅ ゼロ（skillCollisions 0）
置く計画        ✅ blockers ゼロ・failures ゼロ
実際に置く      ⛔ ハーネスの安全装置が拒否（第三者コードの実行・環境変更）
```

**そもそも入れても記憶が残らない**、という構造の問題もありました。
LifeOS は `~/.claude` にデータを置きますが、**ここは使われないと消えるコンテナ**です。
だから `USER/` を外へ出す作業がどのみち必要で、それなら最初から外に置くほうが早い。

なお `/root/.claude/LIFEOS` は存在せず、**何も書き込まれていません**。

## いまの仕組み

**git が唯一の正。db はそこから作る写し。**
同じものを2か所で編集しない（片方だけ直される、を避ける）。

```
lifeos/TELOS.md      目標と方針   ← 人が編集する。ここが正
lifeos/IDENTITY.md   変わらないこと
lifeos/MEMORY.md     起きたこと
        │
        │ LifeOS側（Claude Code のセッション）が写す
        ↓
db: lifeos_memory/*      アプリが起動時に読む
    lifeos_requests/*    アプリ → LifeOS側（発言）
    lifeos_results/*     LifeOS側 → アプリ（結果）
        │
        ↓
アプリの依頼文【LifeOSが覚えていること】に載る → 次の会話で使われる
```

### 実測（2026-09-19）

```
依頼文に載ったか: はい
【LifeOSが覚えていること】
- AI秘書を「LifeOSを中核として動く、自分専用AIへの会話窓口」にする
- アプリ独自の予定判断・日本語解析は減らす。記憶・個人情報・スキル・行動方針は
  アプリ側に重複して作らない
```

この2件は `lifeos/TELOS.md` の Strategies / Projects から写したもので、
**どちらも本人が実際に言った言葉の引用つき**です。

### つながっていないときも動く

`lifeos_memory` が無い／読めないときは、アプリはこれまでどおり動き、
依頼文に余計な見出しも出ません。テスト837件は失敗0のまま。

## まだできていないこと

- **アプリからの発言が自動で `lifeos_requests` に入る**仕組み。いまは手で書いている
- **定時に自分で起きて処理する**仕組み（Routine）。手段はあるが未設定
- **57個のスキル**は使えない（本体を入れていないため）
- **アプリから外部への通信**が可能かは未測定（この構成では不要）

## 決まり

- `TELOS.md` / `IDENTITY.md` に書くのは、**本人が実際に言ったことだけ**。
  推測で人物像を作らない。書くときは**引用を必ず添える**
- db は写し。**直すときは git のほうを直す**
