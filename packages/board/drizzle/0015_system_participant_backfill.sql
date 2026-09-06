-- 既に使われているボードに、システム参加者（kind='system'）の行が無いことがある。
-- この行が無いと evaluateTimedConsensus が per-thread ループの手前で NotFoundError を投げ、
-- 時限合意（no_objection / silence）と全会一致の成立が丸ごと止まる。
--
-- 空の DB では何もしない（bootstrapBoard が作る）。既に参加者が居るのに
-- system が欠けている場合だけ補う。再実行しても増えない。
INSERT INTO "participants" ("kind", "display_name")
SELECT 'system', 'Comitia'
WHERE EXISTS (SELECT 1 FROM "participants")
  AND NOT EXISTS (SELECT 1 FROM "participants" WHERE "kind" = 'system');
