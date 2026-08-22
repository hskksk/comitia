import { describe, expect, it } from "vitest";
import { PROJECT_ID_HEADER } from "@comitia/shared";
import { ownerAuthHeaders } from "./owner-headers.js";

describe("ownerAuthHeaders", () => {
  it("sends the configured project as X-Comitia-Project-Id", () => {
    expect(
      ownerAuthHeaders({
        ownerToken: "comt_owner",
        projectId: "proj-1",
      }),
    ).toEqual({
      authorization: "Bearer comt_owner",
      [PROJECT_ID_HEADER]: "proj-1",
    });
  });

  it("omits the project header when projectId is unset", () => {
    expect(ownerAuthHeaders({ ownerToken: "comt_owner" })).toEqual({
      authorization: "Bearer comt_owner",
    });
  });
});
