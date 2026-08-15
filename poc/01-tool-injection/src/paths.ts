import { fileURLToPath } from "node:url";
import path from "node:path";

/** この PoC パッケージのルートディレクトリ */
export const POC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** board-server.ts の絶対パス */
export const BOARD_SERVER_PATH = path.join(POC_ROOT, "src", "board-server.ts");

/**
 * tsx CLI の絶対パス。
 * エンジンは一時ディレクトリを cwd として MCP サーバを起動するため、
 * `npx tsx` だとローカルの tsx が解決できず npm から都度取得になる。
 * PoC パッケージ内の tsx を node で直接指す。
 */
export const TSX_CLI_PATH = path.join(
  POC_ROOT,
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);

/** チャットログ等の出力先 */
export const OUT_DIR = path.join(POC_ROOT, "out");
