import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClientFactory } from "@a2a-js/sdk/client";
import { buildRelayWsUrl, createAdapter } from "./adapter.js";
import { createGateway } from "./gateway.js";
import { createRelay } from "./relay.js";
import { printResultsTable, type StepResult } from "./results.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 空行・コメントを除いた行数を数える */
function countCodeLines(filePath: string): number {
  const content = readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("//");
    }).length;
}

/** adapter.ts のトンネル中継部の行数 */
function countTunnelRelayLines(adapterPath: string): number {
  const content = readFileSync(adapterPath, "utf-8");
  const lines = content.split("\n");
  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("@@TUNNEL_RELAY_BEGIN@@")) {
      startIdx = i;
    }
    if (lines[i].includes("@@TUNNEL_RELAY_END@@")) {
      endIdx = i;
    }
  }
  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
    return 0;
  }
  return lines
    .slice(startIdx + 1, endIdx)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("//");
    }).length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const results: StepResult[] = [];
  const agentId = "mika";
  const sentTickIds: string[] = [];

  const gatewayRef: { flush?: (agentId: string) => Promise<void> } = {};

  const relay = await createRelay({
    onConnect: ({ agentId: connectedId }) => {
      console.log(`[poc2] アダプタ接続: ${connectedId}`);
      void gatewayRef.flush?.(connectedId);
    },
    onDisconnect: ({ agentId: disconnectedId }) => {
      console.log(`[poc2] アダプタ切断: ${disconnectedId}`);
    },
  });

  const gateway = createGateway({ relayBaseUrl: relay.baseUrl });
  gatewayRef.flush = gateway.flushMailbox.bind(gateway);

  const adapter = await createAdapter({ agentId, relayBaseUrl: relay.baseUrl });

  try {
    // 1. 接続
    const wsUrl = buildRelayWsUrl(relay.baseUrl, agentId);
    await adapter.connect(wsUrl);
    await sleep(100);

    results.push({
      name: "1. リレー接続",
      pass: adapter.isConnected(),
      detail: adapter.isConnected() ? "WebSocket OPEN" : "未接続",
    });

    // 2. Agent Card 取得（トンネル越し）
    let agentCardName: string | undefined;
    try {
      const factory = new ClientFactory();
      const client = await factory.createFromUrl(
        `${relay.baseUrl}/agents/${agentId}/`,
      );
      const card = await client.getAgentCard();
      agentCardName = card.name;
      results.push({
        name: "2. Agent Card 取得",
        pass: card.name.includes(agentId) || card.name.includes("comitia"),
        detail: card.name,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        name: "2. Agent Card 取得",
        pass: false,
        detail: message,
      });
    }

    // 3. tick #1 session.start
    const tick1 = await gateway.sendTick(agentId, "session.start");
    sentTickIds.push(tick1.tickId);
    await sleep(300);

    const idsAfterTick1 = adapter.getReceivedTickIds();
    results.push({
      name: "3. tick #1 (session.start)",
      pass:
        tick1.status === "delivered" &&
        idsAfterTick1.includes(tick1.tickId),
      detail: `status=${tick1.status} id=${tick1.tickId}`,
    });

    // 4. 切断
    adapter.disconnect();
    await sleep(100);
    results.push({
      name: "4. アダプタ切断",
      pass: !adapter.isConnected() && !relay.isConnected(agentId),
      detail: "WS 切断シミュレーション",
    });

    // 5. tick #2, #3 をメールボックスへ
    const tick2 = await gateway.sendTick(agentId, "nudge");
    const tick3 = await gateway.sendTick(agentId, "session.end_warning");
    sentTickIds.push(tick2.tickId, tick3.tickId);

    const mailboxOk =
      tick2.status === "queued" &&
      tick3.status === "queued" &&
      gateway.getMailboxSize(agentId) === 2;
    results.push({
      name: "5. tick #2/#3 メールボックス",
      pass: mailboxOk,
      detail: `tick2=${tick2.status} tick3=${tick3.status} mailbox=${gateway.getMailboxSize(agentId)}`,
    });

    // 6. 再接続 → キャッチアップ
    await adapter.connect(wsUrl);
    await sleep(500);

    const idsAfterReconnect = adapter.getReceivedTickIds();
    const catchUpOk =
      idsAfterReconnect.includes(tick2.tickId) &&
      idsAfterReconnect.includes(tick3.tickId);
    results.push({
      name: "6. 再接続キャッチアップ",
      pass: catchUpOk && gateway.getMailboxSize(agentId) === 0,
      detail: `受信=${idsAfterReconnect.join(", ")}`,
    });

    // 7. tick id 列の完全一致（順序・欠落・重複なし）
    const receivedIds = adapter.getReceivedTickIds();
    const orderOk =
      receivedIds.length === sentTickIds.length &&
      receivedIds.every((id, i) => id === sentTickIds[i]);
    const noDup =
      new Set(receivedIds).size === receivedIds.length;
    results.push({
      name: "7. tick id 一致",
      pass: orderOk && noDup,
      detail: `送信=[${sentTickIds.join(", ")}] 受信=[${receivedIds.join(", ")}]`,
    });

    // 8. リレー実装量
    const relayPath = join(__dirname, "relay.ts");
    const adapterPath = join(__dirname, "adapter.ts");
    const relayLines = countCodeLines(relayPath);
    const tunnelLines = countTunnelRelayLines(adapterPath);
    const totalRelayLines = relayLines + tunnelLines;

    console.log("\n=== リレー実装量（空行・コメント除く）===");
    console.log(`relay.ts:           ${relayLines} 行`);
    console.log(`adapter.ts 中継部:  ${tunnelLines} 行`);
    console.log(`合計:               ${totalRelayLines} 行`);

    results.push({
      name: "8. リレー実装量",
      pass: totalRelayLines < 1000,
      detail: `合計 ${totalRelayLines} 行（設計 03 見積: 数百行）`,
    });

    printResultsTable("PoC-2 tick 配送検証", results);

    const allPass = results.every((r) => r.pass);
    if (!allPass) {
      process.exit(1);
    }
  } finally {
    await adapter.close();
    await relay.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
