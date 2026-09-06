export function sortThreadPostsByCreatedAtDesc<
  T extends { id: string; createdAt: string },
>(posts: readonly T[]): T[] {
  return [...posts].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}
