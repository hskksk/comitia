#!/usr/bin/env node
/**
 * Stdio MCP entry point for @comitia/board.
 *
 * Environment variables:
 *   COMITIA_PARTICIPANT_ID - agent participant UUID (required)
 *   COMITIA_PROJECT_ID     - project UUID (required)
 *   DATABASE_URL           - PostgreSQL connection string (required)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPostgresDb } from "../db/postgres.js";
import { createBoardMcpServer } from "./create-server.js";

async function main(): Promise<void> {
  const participantId = process.env.COMITIA_PARTICIPANT_ID;
  const projectId = process.env.COMITIA_PROJECT_ID;
  const databaseUrl = process.env.DATABASE_URL;

  if (!participantId || !projectId) {
    console.error(
      "COMITIA_PARTICIPANT_ID and COMITIA_PROJECT_ID must be set.",
    );
    process.exit(1);
  }

  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const { db } = createPostgresDb(databaseUrl);
  const { server } = createBoardMcpServer({ db, participantId, projectId });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("comitia-board MCP error:", error);
  process.exit(1);
});
