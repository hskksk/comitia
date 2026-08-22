import { PROJECT_ID_HEADER } from "@comitia/shared";
import type { ComitiaConfig } from "./config.js";

export const PROJECT_REQUIRED_HINT =
  "現在のプロジェクトを特定できません。`comitia project list` で一覧し、`comitia project use <id>` で選んでください。";

export function ownerAuthHeaders(
  config: Pick<ComitiaConfig, "ownerToken" | "projectId">,
  extra?: Record<string, string>,
): Record<string, string> {
  if (!config.ownerToken) {
    throw new Error(
      "オーナートークンがありません。`comitia init` または `comitia login` を実行してください。",
    );
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.ownerToken}`,
    ...extra,
  };
  if (config.projectId) {
    headers[PROJECT_ID_HEADER] = config.projectId;
  }
  return headers;
}
