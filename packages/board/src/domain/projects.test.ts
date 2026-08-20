import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { GateViolation } from "./errors.js";
import { registerParticipant } from "./participants.js";
import {
  createProject,
  parseGithubRepoUrl,
  updateProject,
} from "./projects.js";

describe("parseGithubRepoUrl", () => {
  it("parses a plain github URL", () => {
    expect(parseGithubRepoUrl("https://github.com/hskksk/comitia")).toEqual({
      owner: "hskksk",
      repo: "comitia",
    });
  });

  it("accepts a trailing slash and .git suffix", () => {
    expect(parseGithubRepoUrl("https://github.com/hskksk/comitia.git")).toEqual({
      owner: "hskksk",
      repo: "comitia",
    });
    expect(parseGithubRepoUrl("https://github.com/hskksk/comitia/")).toEqual({
      owner: "hskksk",
      repo: "comitia",
    });
  });

  it("returns null for a non-github URL", () => {
    expect(parseGithubRepoUrl("https://example.com/a/b")).toBeNull();
  });
});

describe("updateProject", () => {
  it("sets repoUrl/githubOwner/githubRepo without touching installation id", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const project = await createProject(db, {
      name: "comitia",
      ownerParticipantId: owner.id,
    });

    const updated = await updateProject(db, {
      projectId: project.id,
      actorId: owner.id,
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
    await updateProject(db, {
      projectId: project.id,
      actorId: owner.id,
      repoUrl: "https://github.com/hskksk/comitia",
    });

    const cleared = await updateProject(db, {
      projectId: project.id,
      actorId: owner.id,
      repoUrl: null,
    });
    expect(cleared.repoUrl).toBeNull();
    expect(cleared.githubOwner).toBeNull();
    expect(cleared.githubRepo).toBeNull();
  });

  it("rejects invalid repo URLs", async () => {
    const owner = await registerParticipant(db, {
      kind: "human",
      displayName: "ハル",
    });
    const project = await createProject(db, {
      name: "comitia",
      ownerParticipantId: owner.id,
    });

    await expect(
      updateProject(db, {
        projectId: project.id,
        actorId: owner.id,
        repoUrl: "https://example.com/a/b",
      }),
    ).rejects.toBeInstanceOf(GateViolation);
  });
});
