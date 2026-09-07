# [0.9.0](https://github.com/hskksk/comitia/compare/v0.8.0...v0.9.0) (2026-09-07)


### Features

* ログイン画面の刷新と PR プレビュー用 bootstrap トークン ([#128](https://github.com/hskksk/comitia/issues/128)) ([589808b](https://github.com/hskksk/comitia/commit/589808b6aaae5625536bce93834fecd02a9c2be5))

# [0.8.0](https://github.com/hskksk/comitia/compare/v0.7.0...v0.8.0) (2026-09-07)


### Features

* **M26-2:** ダッシュボード活動APIを追加する ([#124](https://github.com/hskksk/comitia/issues/124)) ([397e37a](https://github.com/hskksk/comitia/commit/397e37a2d4092bc753c76c26692ffeb9ac09b632)), closes [#125](https://github.com/hskksk/comitia/issues/125)
* **railway:** board デプロイの watchPatterns に board/web/shared を指定 ([#127](https://github.com/hskksk/comitia/issues/127)) ([7af92da](https://github.com/hskksk/comitia/commit/7af92daeb59c82b2df50997c050deb7a88efcd6b))

# [0.7.0](https://github.com/hskksk/comitia/compare/v0.6.2...v0.7.0) (2026-09-07)


### Features

* **web:** 着手表明と不採用を投稿コンポーザーに統合 ([#126](https://github.com/hskksk/comitia/issues/126)) ([10ef608](https://github.com/hskksk/comitia/commit/10ef60848f0c733c0a8e53670628086b18862339))

## [0.6.2](https://github.com/hskksk/comitia/compare/v0.6.1...v0.6.2) (2026-09-07)


### Bug Fixes

* interrupted セッションでもログが残るようにする ([#120](https://github.com/hskksk/comitia/issues/120)) ([df46556](https://github.com/hskksk/comitia/commit/df46556fe3ad045036b784f106934157eb95a6ef))

## [0.6.1](https://github.com/hskksk/comitia/compare/v0.6.0...v0.6.1) (2026-09-07)


### Bug Fixes

* **web:** スレッドの投稿と案を一つのコンポーザにまとめる ([#117](https://github.com/hskksk/comitia/issues/117)) ([48b95a9](https://github.com/hskksk/comitia/commit/48b95a9b6eb95addc00c02600f91d56d5cbb9ece))

# [0.6.0](https://github.com/hskksk/comitia/compare/v0.5.0...v0.6.0) (2026-09-06)


### Features

* **web:** スレッド操作を上部に集め、先頭・末尾へ飛ぶボタンを足す ([#113](https://github.com/hskksk/comitia/issues/113)) ([5765141](https://github.com/hskksk/comitia/commit/57651413f6ed4dd2c7af7a78395b5fad31f87bd1))

# [0.5.0](https://github.com/hskksk/comitia/compare/v0.4.0...v0.5.0) (2026-09-06)


### Features

* **web:** サイドバーとページナビをスクロールから独立させる ([#111](https://github.com/hskksk/comitia/issues/111)) ([e04dae0](https://github.com/hskksk/comitia/commit/e04dae0aa749307fb45406aa6a5bbca868f99e0d))

# [0.4.0](https://github.com/hskksk/comitia/compare/v0.3.0...v0.4.0) (2026-09-06)


### Features

* **web:** スレッド投稿を投稿日時の降順にする ([#110](https://github.com/hskksk/comitia/issues/110)) ([3d8877a](https://github.com/hskksk/comitia/commit/3d8877a773018af8a6cfef06155a0f2e031e6f4c))

# [0.3.0](https://github.com/hskksk/comitia/compare/v0.2.2...v0.3.0) (2026-09-06)


### Bug Fixes

* **board:** スレッド画面の 500 と、時限合意が止まる原因を直す ([#108](https://github.com/hskksk/comitia/issues/108)) ([6e6c3ea](https://github.com/hskksk/comitia/commit/6e6c3ea061519dfdea93fcffc811567089b2f8af))
* 決定済みの提案・相談とブレストを完了できるようにする ([#107](https://github.com/hskksk/comitia/issues/107)) ([c960f35](https://github.com/hskksk/comitia/commit/c960f35fc29974b0a761e61f90742b98424f5ab4))


### Features

* **web:** 議論中の候補差し替えと不採用をプロジェクトオーナーにも開く ([#109](https://github.com/hskksk/comitia/issues/109)) ([cad34a4](https://github.com/hskksk/comitia/commit/cad34a4b47c1e86c954eb1a8f2646674cabc500f))

## [0.2.2](https://github.com/hskksk/comitia/compare/v0.2.1...v0.2.2) (2026-09-06)


### Bug Fixes

* **agent:** 切断後の再接続とセッション復旧を直す ([#106](https://github.com/hskksk/comitia/issues/106)) ([9635120](https://github.com/hskksk/comitia/commit/96351201849fa7eca78385a4f3dddef726e61fd9))

## [0.2.1](https://github.com/hskksk/comitia/compare/v0.2.0...v0.2.1) (2026-09-06)


### Bug Fixes

* **web:** セッションログ詳細が空に見える問題を直す ([#105](https://github.com/hskksk/comitia/issues/105)) ([5300e01](https://github.com/hskksk/comitia/commit/5300e01ab2cc16fd4fff29f5d13bea4e2c92105f))

# [0.2.0](https://github.com/hskksk/comitia/compare/v0.1.0...v0.2.0) (2026-09-06)


### Features

* **agent:** 非同期待ちで別作業へ切り替える ([#104](https://github.com/hskksk/comitia/issues/104)) ([678e0e8](https://github.com/hskksk/comitia/commit/678e0e86e854de4ae8964f3bf834c12cb8b43926))
* **web:** show last action time on participants list ([#85](https://github.com/hskksk/comitia/issues/85)) ([b8e5f0e](https://github.com/hskksk/comitia/commit/b8e5f0e480f031a33c7394c4545f8c32539f700a))
* エージェントログの人間向け表示を整形する ([#100](https://github.com/hskksk/comitia/issues/100)) ([21c9b75](https://github.com/hskksk/comitia/commit/21c9b755f02806786c00a4be165828763c7eca36))
* スレッド一覧の表示順切替と完了除外 ([#102](https://github.com/hskksk/comitia/issues/102)) ([7c3b365](https://github.com/hskksk/comitia/commit/7c3b365e2706f7b3f0e40b83069826d37c69778a))
