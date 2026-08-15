export function assignSessionStartMinute(existingCount: number): number {
  return (existingCount * 15) % 1440;
}
