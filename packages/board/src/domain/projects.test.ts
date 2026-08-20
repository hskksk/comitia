import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { GateViolation } from "./errors.js";
import { registerParticipant } from "./participants.js";
import {
  createProject,
  parseProjectRepoUrl,
  updateProjectRepo,
} from "./projects.js";

describe("parseProjectRepoUrl", () => {
  it("parses a plain github URL", () => {
    expect(parseProjectRepoUrl("https://github.com/hskksk/comitia")).toEqual({
      owner: "hskksk",
      repo: "comitia",
    });
  });

  it("accepts a trailing slash and .git suffix", () => {
    expect(
      parseProjectRepoUrl("https://github.com/hskksk/comitia.git"),
    ).toEqual({ owner: "hskksk", repo: "comitia" });
    expect(
      parseProjectRepoUrl("https://github.com/hskksk/comitia/"),
    ).toEqual({ owner: "hskksk", repo: "comitia" });
  });

  it("rejects a non-github URL", () => {
    expect(() => parseProjectRepoUrl("https://example.com/a/b")).toThrow(
      GateViolation,
    );
  });
});

describe("updateProjectRepo", () => {
  it("sets repoUrl/githubOwner/githubRepo without touching installation id", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const project = await createProject(db, {
      name: "comitia",
      ownerParticipantId: owner.id,
    });

    const updated = await updateProjectRepo(db, {
      projectId: project.id,
      repoUrl: "https://github.com/hskksk/comitia",
    });
    expect(updated.repoUrl).toBe("https://github.com/hskksk/comitia");
    expect(updated.githubOwner).toBe("hskksk");
    expect(updated.githubRepo).toBe("comitia");
    expect(updated.githubInstallationId).toBeNull();
  });

  it("clears all three fields when repoUrl is null", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const project = await createProject(db, {
      name: "comitia",
      ownerParticipantId: owner.id,
      repoUrl: "https://github.com/hskksk/comitia",
    });
    await updateProjectRepo(db, {
      projectId: project.id,
      repoUrl: "https://github.com/hskksk/comitia",
    });

    const cleared = await updateProjectRepo(db, {
      projectId: project.id,
      repoUrl: null,
    });
    expect(cleared.repoUrl).toBeNull();
    expect(cleared.githubOwner).toBeNull();
    expect(cleared.githubRepo).toBeNull();
  });
});
