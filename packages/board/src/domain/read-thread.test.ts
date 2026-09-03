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

const PR_URL = "https://github.com/hskksk/comitia/pull/101";

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

  it("includes linked pull requests with the thread body", async () => {
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
    const github = createFakeGitHubClient({
      pullRequests: [
        {
          owner: "hskksk",
          repo: "comitia",
          number: 101,
          url: PR_URL,
          title: "Draft policy",
          state: "open",
        },
      ],
    });
    await linkPullRequest(db, github, {
      threadId: thread.id,
      actorId: owner.id,
      url: PR_URL,
    });

    const view = await readThread(db, thread.id);
    expect(view.pullRequests).toEqual([
      {
        number: 101,
        url: PR_URL,
        title: "Draft policy",
        state: "open",
      },
    ]);
  });
});
