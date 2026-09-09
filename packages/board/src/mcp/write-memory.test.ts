import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { createBoardMcpServer } from "./create-server.js";
import { seedOwnerAgentProject } from "../test/human-fixtures.js";

describe("MCP write_memory layer", () => {
  it("defaults to episodic and puts norms only in briefing.norms", async () => {
    const { agent, project } = await seedOwnerAgentProject(db);
    const { callTool, parseJsonContent } = createBoardMcpServer({
      db,
      participantId: agent.id,
      projectId: project.id,
    });

    const episodic = parseJsonContent(
      await callTool("write_memory", { body: "個別の気づき" }),
    );
    expect(episodic.layer).toBe("episodic");

    const norm = parseJsonContent(
      await callTool("write_memory", {
        body: "対立する案を残す",
        layer: "norm",
      }),
    );
    expect(norm.layer).toBe("norm");

    const cross = await callTool("write_memory", {
      body: "層をまたぐ",
      layer: "norm",
      supersede_id: episodic.memory_id,
    });
    expect(cross.isError).toBe(true);
    expect(cross.content[0]?.text).toContain("層をまたいだ置き換えはできません");

    const briefing = parseJsonContent(await callTool("get_briefing"));
    expect(briefing.memory).toBe("個別の気づき");
    expect(briefing.norms).toBe("対立する案を残す");
    const you = briefing.you as { retro_due: boolean };
    expect(you.retro_due).toBe(false);
  });
});
