import { AGENT_GITHUB_TOKEN_PERMISSIONS } from "./types.js";

export const AGENT_GITHUB_PERMISSIONS_MISSING_ERROR =
  "GitHub App is missing Contents write or Pull requests write, or the installation has not been re-approved after a permission change";

export function sameGithubRepo(
  left: { owner: string; repo: string },
  right: { owner: string; repo: string },
): boolean {
  return (
    left.owner.toLowerCase() === right.owner.toLowerCase() &&
    left.repo.toLowerCase() === right.repo.toLowerCase()
  );
}

export function installationGrantsAgentTokenPermissions(
  permissions: { contents?: string; pull_requests?: string } | null | undefined,
): boolean {
  if (!permissions) {
    return false;
  }
  return (
    permissions.contents === AGENT_GITHUB_TOKEN_PERMISSIONS.contents &&
    permissions.pull_requests === AGENT_GITHUB_TOKEN_PERMISSIONS.pull_requests
  );
}

export function publicMintError(error: unknown): string {
  if (githubStatus(error) === 404) {
    return "GitHub App installation not found";
  }
  const detail = githubErrorDetail(error);
  const lower = detail.toLowerCase();
  if (
    detail === AGENT_GITHUB_PERMISSIONS_MISSING_ERROR ||
    lower.includes("permissions requested are not granted") ||
    lower.includes("not granted to this installation")
  ) {
    return AGENT_GITHUB_PERMISSIONS_MISSING_ERROR;
  }
  if (
    detail.includes("does not include") ||
    detail.includes("invalid GitHub App installation")
  ) {
    return detail;
  }
  if (lower.includes("installation not found")) {
    return "GitHub App installation not found";
  }
  return "failed to mint GitHub credentials";
}

function githubStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return undefined;
  }
  return typeof error.status === "number" ? error.status : undefined;
}

function githubErrorDetail(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "failed to mint GitHub credentials";
  }
  const withResponse = error as {
    message?: unknown;
    response?: { data?: { message?: unknown; errors?: unknown } };
  };
  const apiMessage = withResponse.response?.data?.message;
  if (typeof apiMessage === "string" && apiMessage.length > 0) {
    const apiErrors = withResponse.response?.data?.errors;
    const extra = Array.isArray(apiErrors)
      ? apiErrors
          .filter((item): item is string => typeof item === "string")
          .join("; ")
      : "";
    return extra ? `${apiMessage}: ${extra}` : apiMessage;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "failed to mint GitHub credentials";
}
