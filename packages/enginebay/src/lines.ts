/**
 * Append `chunk` to a pending line `buffer`, invoke `onLine` for every
 * complete line, and return the new remainder.
 */
export function processLineChunk(
  buffer: string,
  chunk: string,
  onLine: (line: string) => void,
): string {
  const combined = buffer + chunk;
  const lines = combined.split("\n");
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    onLine(line);
  }
  return remainder;
}
