import { and, desc, eq } from "drizzle-orm";
import { agreements, events, proposalVersions } from "../db/schema.js";
import type { Db } from "../db/test-setup.js";
import { getProposalVersion, getThreadRow } from "./helpers.js";

export type DecisionView = {
  diff: string | null;
  previousAgreement: { id: string; summaryDiff: string } | null;
  activitySpent: number;
};

const DECIDED_STATES = new Set(["decided", "completed", "rejected"]);

/** 2つのテキストの行単位の差分を +/-/空白 の3行形式で返す。LCSベースの単純な実装。 */
export function renderUnifiedDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const n = oldLines.length;
  const m = newLines.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        oldLines[i] === newLines[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      out.push(`  ${oldLines[i]}`);
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push(`- ${oldLines[i]}`);
      i += 1;
    } else {
      out.push(`+ ${newLines[j]}`);
      j += 1;
    }
  }
  while (i < n) {
    out.push(`- ${oldLines[i]}`);
    i += 1;
  }
  while (j < m) {
    out.push(`+ ${newLines[j]}`);
    j += 1;
  }
  return out.join("\n");
}

export async function getDecisionView(
  db: Db,
  threadId: string,
): Promise<DecisionView | null> {
  const thread = await getThreadRow(db, threadId);
  if (!DECIDED_STATES.has(thread.state)) {
    return null;
  }

  let diff: string | null = null;
  if (thread.candidateProposalVersionId) {
    const { version, proposal } = await getProposalVersion(
      db,
      thread.candidateProposalVersionId,
    );
    if (version.versionNumber > 1) {
      const [prevVersion] = await db
        .select()
        .from(proposalVersions)
        .where(
          and(
            eq(proposalVersions.proposalId, proposal.id),
            eq(proposalVersions.versionNumber, version.versionNumber - 1),
          ),
        );
      if (prevVersion) {
        diff = renderUnifiedDiff(prevVersion.content, version.content);
      }
    }
  }

  const [agreement] = await db
    .select()
    .from(agreements)
    .where(eq(agreements.threadId, threadId))
    .orderBy(desc(agreements.createdAt))
    .limit(1);

  let previousAgreement: DecisionView["previousAgreement"] = null;
  if (agreement) {
    const [prev] = await db
      .select()
      .from(agreements)
      .where(eq(agreements.supersededByAgreementId, agreement.id));
    if (prev) {
      previousAgreement = {
        id: prev.id,
        summaryDiff: renderUnifiedDiff(prev.summary, agreement.summary),
      };
    }
  }

  const eventRows = await db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.threadId, threadId), eq(events.kind, "budget_spent")));
  const activitySpent = eventRows.reduce((sum, row) => {
    const cost = (row.payload as { cost?: unknown }).cost;
    return sum + (typeof cost === "number" ? cost : 0);
  }, 0);

  return { diff, previousAgreement, activitySpent };
}
