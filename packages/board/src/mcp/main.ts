#!/usr/bin/env node
/**
 * Stdio MCP entry point for @comitia/board.
 *
 * Environment variables:
 *   COMITIA_PARTICIPANT_ID - agent participant UUID (required)
 *   COMITIA_PROJECT_ID     - optional legacy project UUID (unused; membership is the source of truth)
 *   DATABASE_URL           - PostgreSQL connection string (required)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPostgresDb } from "../db/postgres.js";
import { createBoardMcpServer } from "./create-server.js";

async function main(): Promise<void> {
  const participantId = process.env.COMITIA_PARTICIPANT_ID;
  const databaseUrl = process.env.DATABASE_URL;

  if (!participantId) {
    console.error("COMITIA_PARTICIPANT_ID must be set.");
    process.exit(1);
  }

  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const { db } = createPostgresDb(databaseUrl);
  const { server } = createBoardMcpServer({ db, participantId });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("comitia-board MCP error:", error);
  process.exit(1);
});
