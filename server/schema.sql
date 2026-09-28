-- 1人1日の回数だけ。話した中身は入れない（決まり18）。uid は Google の番号を元に戻せない形にしたもの。
CREATE TABLE IF NOT EXISTS usage (
  uid TEXT NOT NULL,
  day TEXT NOT NULL,
  n   INTEGER NOT NULL,
  PRIMARY KEY (uid, day)
);
