---
name: tool-permission-rules
description: Defines the agent's behavior for auto-executing tools vs asking for user permission.
trigger: always_on
---

# ツール実行の承認・許可に関するルール (Tool Execution & Permission Rules)

ユーザーからの指示により、ツールの実行・コマンドの実行時は以下の基準に従って「自動実行（そのままツールを呼び出す）」か「手動承認（実行前にユーザーに確認・許可を求める）」かを判断してください。

## ✅ なるべく自動許可（ユーザーへの事前確認なしで実行してよいもの）
- **読み取り操作**: iew_file, list_dir, grep_search, ind_by_name など、状態を変更しない調査目的のツール。
- **ローカルの安全な編集**: eplace_file_content や write_to_file を使った、安全かつ元に戻しやすいコード編集・追記。
- **テスト・ビルド**: テストやビルドなどのローカル環境でのコマンド実行。
- **Git Commit**: git commit によるローカルへのコミット作成。

## ⚠️ 手動（実行前にユーザーに確認・許可を求めるもの）
以下の操作を行う場合、勝手にツールを実行せず、**事前にユーザーに「〇〇を実行してもよいですか？」と確認し、許可を得てから実行**してください。
- **Git Push**: git push によるリモートへの反映。
- **削除・破壊的操作**: m, del などのファイル削除コマンド、DBの初期化など、破壊的な操作。
- **外部通信/API送信**: curl やスクリプト等を用いた外部サーバーへのデータ送信。