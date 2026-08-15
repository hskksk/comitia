#!/usr/bin/env node
/**
 * Stdio MCP entry point for @comitia/board (M2).
 *
 * Environment variables:
 *   COMITIA_PARTICIPANT_ID - agent participant UUID (required)
 *   COMITIA_PROJECT_ID     - project UUID (required)
 *   DATABASE_URL           - PostgreSQL connection string (required for stdio; tests use PGlite in-process)
 */
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
    console.error(
      "DATABASE_URL is not set. M2 stdio entry requires a PostgreSQL connection (not wired in M2 tests).",
    );
    process.exit(1);
  }

  // Production PG driver wiring is deferred; factory + in-process tests are the M2 deliverable.
  console.error(
    "DATABASE_URL is set but live Postgres bootstrap is not implemented in M2. Use createBoardMcpServer() with your Db instance.",
  );
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error("comitia-board MCP error:", error);
  process.exit(1);
});
