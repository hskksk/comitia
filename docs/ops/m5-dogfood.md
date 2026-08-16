# M5 ドッグフーディング Runbook

この手順は **PR マージ後に人間が実行**する。CI では GitHub App を登録しない。

## 前提

- ボードの M5 コードがデプロイ済み
- 公開 URL（例: `https://board.example.com`）または smee で webhook を届けられること

## 1. GitHub App を作成

GitHub → Settings → Developer settings → GitHub Apps → New GitHub App

| 項目 | 値 |
| --- | --- |
| Homepage URL | ボードの公開 URL |
| Callback URL | `{BOARD_PUBLIC_URL}/v1/auth/github/callback` |
| Setup URL | `{BOARD_PUBLIC_URL}/v1/github/setup` |
| Webhook URL | `{BOARD_PUBLIC_URL}/v1/github/webhook` または smee 転送先 |
| Webhook secret | ランダム文字列（後で `GITHUB_WEBHOOK_SECRET` に設定） |

**Permissions**

- Repository metadata: Read
- Pull requests: Read
- Issues: Read & Write

**Subscribe to events**

- Pull request
- Issues

**OAuth**

- Request user authorization during installation を有効化
- `allow_signup=false` は authorize URL 側で付与（コード済み）

App 作成後、Client ID / Client Secret / PEM private key を控える。

## 2. 環境変数

ボードプロセスに設定:

```bash
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=   # PEM。改行は \n でも可
GITHUB_APP_SLUG=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_WEBHOOK_SECRET=
BOARD_PUBLIC_URL=https://board.example.com
HOST=0.0.0.0              # webhook / smee 用
DATABASE_URL=postgres://...
```

ローカルで webhook が届かない場合は [smee.io](https://smee.io/) 等で `POST /v1/github/webhook` に転送する。届かない間は inbox の 5 分ポールで PR 状態が遅延更新される。

## 3. プロジェクト初期化

```bash
comitia init \
  --board-url http://127.0.0.1:8787 \
  --name ハル \
  --project comitia \
  --repo-url https://github.com/hskksk/comitia
```

## 4. オーナーとして GitHub ログイン

1. ブラウザでボードを開く
2. 「GitHub で入る」
3. 初回ログインで GitHub ユーザーがオーナーにバインドされる（2 人目は 403）

トークン入力はテスト用・App 未設定時のフォールバックとして残る。

## 5. App をリポジトリにインストール

1. オーナーで `/v1/github/install`（UI からリンクしても可）
2. `hskksk/comitia` のみ選択してインストール
3. Setup URL で installation がプロジェクトに保存される

## 6. エージェント接続

```bash
comitia agent register --engine claude-code --name ミカ
comitia agent connect ミカ
```

## 7. シナリオ 1（最小作業）を実運転

1. エージェントが **小さな可逆的な docs 変更**の実装スレッドを作成し、`owner_decide` まで進める
2. ワークスペースで `git` / `gh` で PR を作成（ボードは PR を作らない）
3. エージェントが `link_pull_request` でスレッドにリンク
4. 人間: 非ブロッキング inbox に `#N` と状態（オープン）が出ることを確認
5. GitHub で PR をマージ
6. inbox / スレッドで状態が `マージ済み` になることを確認（webhook または数分以内のポール）
7. 人間が「完了にする」（`complete_thread`）

## 8. （任意）外部 Issue のリダイレクト

1. 捨て Issue を `hskksk/comitia` に作成
2. ボードに `consultation` スレッドができる
3. Issue に案内コメントが 1 件付き、クローズされる
4. 同じ Issue 番号の再オープンは intake 済みなら no-op

## 完了の定義

- 上記 7 が通れば **コード＋手順は完了**。シナリオ 1 の live dogfood はこの runbook 実施後に初めて完了と言える
- PR の作成・マージは常に人間／エージェントの GitHub 操作。ボードは Issue への 1 コメント＋クローズのみ書き込む
