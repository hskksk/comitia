import { fileURLToPath } from "node:url";
import path from "node:path";

/** この PoC パッケージのルートディレクトリ */
export const POC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** board-server.ts の絶対パス */
export const BOARD_SERVER_PATH = path.join(POC_ROOT, "src", "board-server.ts");

/** PoC パッケージ内 tsx CLI（MCP 子プロセス起動用） */
export const TSX_CLI_PATH = path.join(
  POC_ROOT,
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);

/** チャットログ等の出力先 */
export const OUT_DIR = path.join(POC_ROOT, "out");

/** サンプル作業用 docs（typo 修正シナリオ） */
export const FIXTURES_DIR = path.join(POC_ROOT, "fixtures");
