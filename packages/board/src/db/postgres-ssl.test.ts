import { describe, expect, it } from "vitest";
import { hostedPostgresNeedsTls, postgresSslOption } from "./postgres-ssl.js";

describe("hostedPostgresNeedsTls", () => {
  it("skips TLS for localhost and compose db", () => {
    expect(
      hostedPostgresNeedsTls("postgres://comitia:comitia@localhost:5432/comitia"),
    ).toBe(false);
    expect(
      hostedPostgresNeedsTls("postgres://comitia:comitia@127.0.0.1:5432/comitia"),
    ).toBe(false);
    expect(
      hostedPostgresNeedsTls("postgres://comitia:comitia@db:5432/comitia"),
    ).toBe(false);
  });

  it("skips TLS for Railway private hostname", () => {
    expect(
      hostedPostgresNeedsTls(
        "postgresql://postgres:pass@postgres.railway.internal:5432/railway",
      ),
    ).toBe(false);
  });

  it("requires TLS for public hosts", () => {
    expect(
      hostedPostgresNeedsTls(
        "postgresql://postgres:pass@roundhouse.proxy.rlwy.net:1234/railway",
      ),
    ).toBe(true);
    expect(
      postgresSslOption(
        "postgresql://postgres:pass@roundhouse.proxy.rlwy.net:1234/railway",
      ),
    ).toEqual({ rejectUnauthorized: false });
  });
});
