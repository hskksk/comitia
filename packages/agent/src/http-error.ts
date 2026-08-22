import { PROJECT_REQUIRED_HINT } from "./owner-headers.js";

export async function formatHttpError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error === "project required") {
      return `${response.status} project required\n${PROJECT_REQUIRED_HINT}`;
    }
    if (body.error) {
      return `${response.status} ${body.error}`;
    }
  } catch {
    // Fall through to status text.
  }
  return `${response.status} ${response.statusText}`;
}
