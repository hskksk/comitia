import { describe, expect, it } from "vitest";
import { GateViolation } from "../domain/errors.js";
import { parsePullRequestUrl } from "./parse-pr-url.js";

describe("parsePullRequestUrl", () => {
  it("parses a standard PR URL", () => {
    expect(
      parsePullRequestUrl("https://github.com/hskksk/comitia/pull/101"),
    ).toEqual({ owner: "hskksk", repo: "comitia", number: 101 });
  });

  it("allows a trailing slash", () => {
    expect(
      parsePullRequestUrl("https://github.com/hskksk/comitia/pull/101/"),
    ).toEqual({ owner: "hskksk", repo: "comitia", number: 101 });
  });

  it("rejects issue URLs", () => {
    expect(() =>
      parsePullRequestUrl("https://github.com/hskksk/comitia/issues/101"),
    ).toThrow(GateViolation);
  });

  it("rejects compare URLs", () => {
    expect(() =>
      parsePullRequestUrl("https://github.com/hskksk/comitia/compare/main...fix"),
    ).toThrow(GateViolation);
  });
});
