export function activeWorkClaimantNames(
  claims: ReadonlyArray<{ participantId: string; displayName: string }>,
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const claim of claims) {
    if (seen.has(claim.participantId)) {
      continue;
    }
    seen.add(claim.participantId);
    names.push(claim.displayName);
  }
  return names;
}
