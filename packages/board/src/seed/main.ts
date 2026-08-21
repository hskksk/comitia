import { eq } from "drizzle-orm";
import { createPostgresDb } from "../db/postgres.js";
import { participants, projects } from "../db/schema.js";
import { createProject } from "../domain/projects.js";
import { populateSeedProject } from "./populate.js";
import { deleteProjectTree } from "./reset.js";
import { SEED_PROJECT_NAME } from "./constants.js";

function parseArgs(argv: string[]) {
  return { reset: argv.includes("--reset") };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL がありません");
    process.exit(1);
  }
  const { reset } = parseArgs(process.argv.slice(2));
  const { db, close } = createPostgresDb(databaseUrl);
  try {
    const [owner] = await db
      .select()
      .from(participants)
      .where(eq(participants.kind, "human"))
      .limit(1);
    if (!owner) {
      console.error(
        "人間アカウントがありません。先にボードへ登録してから pnpm seed してください。",
      );
      process.exit(1);
    }

    const [existing] = await db
      .select()
      .from(projects)
      .where(eq(projects.name, SEED_PROJECT_NAME))
      .limit(1);
    if (existing && !reset) {
      console.log(
        `プロジェクト ${SEED_PROJECT_NAME} は既にあります (${existing.id}). 入れ直すときは pnpm seed --reset`,
      );
      return;
    }
    if (existing && reset) {
      await deleteProjectTree(db, existing.id);
      console.log(`既存の ${SEED_PROJECT_NAME} を削除しました`);
    }

    const project = await createProject(db, {
      name: SEED_PROJECT_NAME,
      ownerParticipantId: owner.id,
      projectRule: { templateId: "default" },
      threadTemplate: { templateId: "default" },
    });
    const populated = await populateSeedProject(db, {
      projectId: project.id,
      ownerId: owner.id,
    });
    console.log(
      `seed 完了: ${SEED_PROJECT_NAME} (${project.id}) owner=${owner.displayName} threads=${Object.keys(populated.threads).length + 2}`,
    );
  } finally {
    await close();
  }
}

await main();
