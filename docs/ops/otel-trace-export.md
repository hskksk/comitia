# M20-4 OpenTelemetry trace export

`comitia agent connect` は、環境変数を設定したときだけセッション中の `TraceEvent` を OTLP でエクスポートします。未設定時は **noop**（ボードへの chat-log / structured trace 書き込みは従来どおり）。

## 前提

- M20-2/3 がデプロイ済み（structured trace と `@json` chat-log）
- OTLP を受け付けるコレクタまたは SaaS（Jaeger OTLP、Grafana Cloud、Honeycomb 等）

## 環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `COMITIA_OTEL_ENDPOINT` | はい（export 時） | OTLP/HTTP trace エンドポイント URL。例: `http://127.0.0.1:4318/v1/traces` |
| `COMITIA_OTEL_SERVICE_NAME` | いいえ | リソース属性 `service.name`。既定: `comitia-agent` |

## 送出される span

| TraceEvent | Span |
| --- | --- |
| `run_start` | `comitia.run`（親: `comitia.session`） |
| `run_end` | run span を終了 |
| `tool_call` | `gen_ai.execute_tool`（`gen_ai.tool.name` 等） |
| `tool_result` | tool span を OK / ERROR で終了 |

thinking / text / adapter_note は export しません（GenAI 運用向けの run・tool 境界のみ）。

## ローカル確認（Jaeger）

```bash
docker run --rm -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest
export COMITIA_OTEL_ENDPOINT=http://127.0.0.1:4318/v1/traces
export COMITIA_OTEL_SERVICE_NAME=comitia-agent-local
pnpm comitia agent connect mika
```

Jaeger UI: http://127.0.0.1:16686 — Service `comitia-agent-local` で run / tool span を確認。

## 注意

- OTLP には **agent token や GitHub token を載せない**。属性は session id・run 番号・tool 名に限定。
- `COMITIA_TRACE_REDACT=tool_metadata` でも OTel 側に args/result 本文は載せない（M20-4 時点）。
- export 失敗はセッションループを止めない。コレクタ側の可用性は別途監視する。

## 関連

- [設計 10: エージェント可観測性（M20）](../design/10-agent-observability.md) §4.9 / M20-4
- [設計 02: エージェント接続](../design/02-agent-connection.md) §6 item 7
