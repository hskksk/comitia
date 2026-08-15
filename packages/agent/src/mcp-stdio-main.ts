#!/usr/bin/env node

import { startMcpProxyStdio } from "./mcp-proxy.js";

const boardUrl = process.env.COMITIA_BOARD_URL;
const agentToken = process.env.COMITIA_AGENT_TOKEN;

if (!boardUrl || !agentToken) {
  console.error("COMITIA_BOARD_URL and COMITIA_AGENT_TOKEN are required");
  process.exitCode = 1;
} else {
  startMcpProxyStdio({ boardUrl, agentToken }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
