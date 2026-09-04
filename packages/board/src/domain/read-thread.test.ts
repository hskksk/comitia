import "../test/helpers.js";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { projects } from "../db/schema.js";
import { db } from "../test/helpers.js";
import { createFakeGitHubClient } from "../github/fake-client.js";
import { seedOwnerAgentProject } from "../test/human-fixtures.js";
import { linkPullRequest } from "./pull-requests.js";
import { readThread } from "./read-thread.js";
import { createThread } from "./threads.js";

const PR_A = {
  owner: "hskksk",
  repo: "comitia",
  number: 101,
  url: "https://github.com/hskksk/comitia/pull/101",
  title: "Draft A",
  state: "open" as const,
};
const PR_B = {
  owner: "hskksk",
  repo: "comitia",
  number: 102,
  url: "https://github.com/hskksk/comitia/pull/102",
  title: "Draft B",
  state: "open" as const,
};

async function connectProject(projectId: string) {
  await db
    .update(projects)
    .set({
      githubInstallationId: "inst-1",
      githubOwner: "hskksk",
      githubRepo: "comitia",
      repoUrl: "https://github.com/hskksk/comitia",
    })
    .where(eq(projects.id, projectId));
}

async function linkPrs(
  threadId: string,
  actorId: string,
  prs: Array<typeof PR_A>,
) {
  const github = createFakeGitHubClient({ pullRequests: prs });
  for (const pr of prs) {
    await linkPullRequest(db, github, {
      threadId,
      actorId,
      url: pr.url,
    });
  }
}

describe("readThread linked artifacts", () => {
  it("returns an empty pullRequests list when none are linked", async () => {
    const { owner, project } = await seedOwnerAgentProject(db);
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: owner.id,
      type: "consultation",
      title: "相談",
      trigger: "確認",
      duplicateSearchQuery: "consult",
      conflictCitationsChecked: true,
    });

    const view = await readThread(db, thread.id);
    expect(view.pullRequests).toEqual([]);
  });

  it("puts pullRequests before posts so MCP JSON surfaces artifacts first", async () => {
    const { owner, project } = await seedOwnerAgentProject(db);
    await connectProject(project.id);
    const thread = await createThread(db, {
      projectId: project.id,
      ownerId: owner.id,
      type: "proposal",
      title: "方針案",
      trigger: "具体物を付けて議論する",
      duplicateSearchQuery: "policy artifact",
      target: "repo_artifact",
      conflictCitationsChecked: true,
    });
    await linkPrs(thread.id, owner.id, [PR_A, PR_B]);

    const view = await readThread(db, thread.id);
    expect(view.pullRequests).toEqual([
      {
        number: PR_A.number,
        url: PR_A.url,
        title: PR_A.title,
        state: PR_A.state,
      },
      {
        number: PR_B.number,
        url: PR_B.url,
        title: PR_B.title,
        state: PR_B.state,
      },
    ]);
    const keys = Object.keys(JSON.parse(JSON.stringify(view)) as object);
    expect(keys.indexOf("pullRequests")).toBeGreaterThan(
      keys.indexOf("candidate_proposal"),
    );
    expect(keys.indexOf("pullRequests")).toBeLessThan(keys.indexOf("posts"));
  });
});
