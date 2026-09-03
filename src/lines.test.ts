import { describe, expect, it } from "vitest";
import { processLineChunk } from "./lines.js";

describe("processLineChunk", () => {
  it("emits complete lines and carries the remainder", () => {
    const lines: string[] = [];
    let buffer = processLineChunk("", "line-1\nline-2\npart", (line) =>
      lines.push(line),
    );
    expect(lines).toEqual(["line-1", "line-2"]);
    expect(buffer).toBe("part");
    buffer = processLineChunk(buffer, "ial\n", (line) => lines.push(line));
    expect(lines).toEqual(["line-1", "line-2", "partial"]);
    expect(buffer).toBe("");
  });
});
