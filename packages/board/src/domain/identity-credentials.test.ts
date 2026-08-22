import "../test/helpers.js";
import { describe, expect, it } from "vitest";
import { db } from "../test/helpers.js";
import { bootstrapBoard } from "./bootstrap.js";
import { issueIdentityToken } from "./accounts.js";
import { authenticateToken } from "./credentials.js";
import {
  listIdentityCredentials,
  revokeIdentityCredential,
} from "./identity-credentials.js";

describe("identity credentials", () => {
  it("lists and revokes human identity credentials", async () => {
    const bootstrapped = await bootstrapBoard(db, {
      ownerDisplayName: "ハル",
      projectName: "comitia",
    });
    const webToken = await issueIdentityToken(db, bootstrapped.owner.id, "web");
    const cliToken = await issueIdentityToken(db, bootstrapped.owner.id, "cli");

    const webAuth = await authenticateToken(db, webToken);
    const items = await listIdentityCredentials(
      db,
      bootstrapped.owner.id,
      webAuth?.credentialId,
    );
    expect(items).toHaveLength(3);
    expect(items.find((item) => item.clientLabel === "init")).toBeTruthy();
    expect(items.find((item) => item.clientLabel === "web")?.current).toBe(true);
    expect(items.find((item) => item.clientLabel === "cli")?.current).toBe(false);

    const cliAuth = await authenticateToken(db, cliToken);
    const cliCredential = items.find((item) => item.clientLabel === "cli");
    expect(cliCredential).toBeTruthy();
    await revokeIdentityCredential(db, {
      participantId: bootstrapped.owner.id,
      credentialId: cliCredential!.id,
    });

    expect(await authenticateToken(db, cliToken)).toBeNull();
    expect(await authenticateToken(db, webToken)).toBeTruthy();

    const afterRevoke = await listIdentityCredentials(
      db,
      bootstrapped.owner.id,
      cliAuth?.credentialId,
    );
    expect(afterRevoke).toHaveLength(2);
  });
});
