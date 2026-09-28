-- 1人1日の回数だけ。話した中身は入れない（決まり18）。uid は Google の番号を元に戻せない形にしたもの。
CREATE TABLE IF NOT EXISTS usage (
  uid TEXT NOT NULL,
  day TEXT NOT NULL,
  n   INTEGER NOT NULL,
  PRIMARY KEY (uid, day)
);
-- 報告の回数（送りすぎを防ぐだけ・2日で消す）。報告そのものとは結びつけない。
CREATE TABLE IF NOT EXISTS report_count (
  uid TEXT NOT NULL,
  day TEXT NOT NULL,
  n   INTEGER NOT NULL,
  PRIMARY KEY (uid, day)
);
-- 本人が「報告」を押した AI の文と理由だけ。**だれが送ったかは入れない**。90日で消す。
CREATE TABLE IF NOT EXISTS reports (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     TEXT NOT NULL,
  kind   TEXT NOT NULL,
  reason TEXT NOT NULL,
  text   TEXT NOT NULL
);
