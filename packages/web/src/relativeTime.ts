const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Japanese relative time (e.g. 「3時間前」). Pair with absolute ISO in title. */
export function formatRelativeTimeJa(
  iso: string,
  now: Date = new Date(),
): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) {
    return iso;
  }
  const diff = now.getTime() - then.getTime();
  if (diff < 0) {
    return then.toLocaleString("ja-JP");
  }
  if (diff < MINUTE) {
    return "たった今";
  }
  if (diff < HOUR) {
    return `${Math.floor(diff / MINUTE)}分前`;
  }
  if (diff < DAY) {
    return `${Math.floor(diff / HOUR)}時間前`;
  }
  if (diff < 30 * DAY) {
    return `${Math.floor(diff / DAY)}日前`;
  }
  return then.toLocaleDateString("ja-JP");
}
