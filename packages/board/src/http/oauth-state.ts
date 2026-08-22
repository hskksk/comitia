import { randomBytes } from "node:crypto";
import {
  normalizeIdentityClientLabel,
  type IdentityClientLabel,
} from "../domain/identity-credentials.js";

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export type OauthStatePayload = {
  returnOrigin: string | null;
  clientLabel: IdentityClientLabel;
};

export function sanitizeLoginOrigin(
  candidate: string | null | undefined,
  publicBaseUrl?: string,
): string | null {
  if (!candidate) {
    return null;
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (publicBaseUrl && url.origin === new URL(publicBaseUrl).origin) {
      return url.origin;
    }
    if (LOCAL_DEV_HOSTS.has(url.hostname)) {
      return url.origin;
    }
    return null;
  } catch {
    return null;
  }
}

export function encodeOauthState(
  returnOrigin: string | null,
  clientLabel: IdentityClientLabel = "web",
): string {
  const nonce = randomBytes(24).toString("hex");
  if (!returnOrigin && clientLabel === "web") {
    return nonce;
  }
  const payload: OauthStatePayload = {
    returnOrigin,
    clientLabel: normalizeIdentityClientLabel(clientLabel),
  };
  return `${nonce}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

export function decodeOauthState(state: string): OauthStatePayload {
  const separator = state.indexOf(".");
  if (separator === -1) {
    return { returnOrigin: null, clientLabel: "web" };
  }
  try {
    const raw = Buffer.from(state.slice(separator + 1), "base64url").toString(
      "utf8",
    );
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw) as Partial<OauthStatePayload>;
      return {
        returnOrigin: parsed.returnOrigin ?? null,
        clientLabel: normalizeIdentityClientLabel(parsed.clientLabel),
      };
    }
    return {
      returnOrigin: raw || null,
      clientLabel: "web",
    };
  } catch {
    return { returnOrigin: null, clientLabel: "web" };
  }
}

export function decodeOauthReturnOrigin(state: string): string | null {
  return decodeOauthState(state).returnOrigin;
}
