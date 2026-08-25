#!/usr/bin/env node
import {
  createRailwayContext,
  graphToEnvironmentConfig,
  project,
  projectDefinitionToGraph,
} from "railway/iac";
import defineRailwayProject from "../.railway/railway.ts";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const context = { environment: "production", projectName: "comitia" };
const definition = await defineRailwayProject(
  createRailwayContext(context),
  project,
);
const graph = projectDefinitionToGraph(definition);
const desiredConfig = graphToEnvironmentConfig(graph, { context });

const board = desiredConfig?.services?.board;
if (!board) {
  fail("expected desiredConfig.services.board");
}

if (board.build?.builder !== "DOCKERFILE") {
  fail(`expected DOCKERFILE builder, got ${board.build?.builder}`);
}
if (board.build?.dockerfilePath !== "Dockerfile") {
  fail(`expected dockerfilePath Dockerfile, got ${board.build?.dockerfilePath}`);
}
if (board.deploy?.healthcheckPath !== "/healthz") {
  fail(`expected healthcheck /healthz, got ${board.deploy?.healthcheckPath}`);
}
if (board.deploy?.healthcheckTimeout !== 300) {
  fail(`expected healthcheckTimeout 300, got ${board.deploy?.healthcheckTimeout}`);
}
if (board.deploy?.numReplicas !== 1) {
  fail(`expected 1 replica, got ${board.deploy?.numReplicas}`);
}
if (board.source?.checkSuites !== true) {
  fail("expected GitHub checkSuites (Wait for CI)");
}
if (board.variables?.HOST?.value !== "::") {
  fail(`expected HOST=::, got ${JSON.stringify(board.variables?.HOST)}`);
}
if (board.variables?.DATABASE_URL?.value !== "${{Postgres.DATABASE_URL}}") {
  fail(
    `expected private Postgres DATABASE_URL ref, got ${JSON.stringify(board.variables?.DATABASE_URL)}`,
  );
}
if (board.variables?.BOARD_PUBLIC_URL?.value !== "https://${{RAILWAY_PUBLIC_DOMAIN}}") {
  fail(
    `expected BOARD_PUBLIC_URL from RAILWAY_PUBLIC_DOMAIN, got ${JSON.stringify(board.variables?.BOARD_PUBLIC_URL)}`,
  );
}

const graphBoard = graph?.resources?.find((resource) => resource.name === "board");
if (graphBoard?.source?.repo !== "hskksk/comitia") {
  fail(`expected github.com/hskksk/comitia, got ${graphBoard?.source?.repo}`);
}

console.log("railway iac graph ok");
