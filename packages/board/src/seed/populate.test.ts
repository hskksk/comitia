import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { threads } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { registerParticipant } from "../domain/participants.js";
import { createProject } from "../domain/projects.js";
import { getProjectSetup } from "../domain/constitution.js";
import { populateSeedProject } from "./populate.js";
import { SEED_PROJECT_NAME } from "./constants.js";

describe("seed populate", () => {
  it("fills a founded project with scenario threads", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const project = await createProject(db, {
      name: SEED_PROJECT_NAME,
      ownerParticipantId: owner.id,
      projectRule: { templateId: "default" },
      threadTemplate: { templateId: "default" },
    });
    expect(SEED_PROJECT_NAME).toBe("test_project");
    expect(project.name).toBe("test_project");
    expect(await getProjectSetup(db, project.id)).toEqual({
      projectRule: true,
      threadTemplate: true,
    });

    const populated = await populateSeedProject(db, {
      projectId: project.id,
      ownerId: owner.id,
    });
    const rows = await db
      .select({ type: threads.type, state: threads.state })
      .from(threads)
      .where(eq(threads.projectId, project.id));
    expect(rows.some((row) => row.type === "implementation")).toBe(true);
    expect(rows.some((row) => row.state === "awaiting_decision")).toBe(true);
    expect(populated.sou.displayName).toBe("ソウ");
  });
});
