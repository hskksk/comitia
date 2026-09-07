export const UPLOAD_RETRY_ATTEMPTS = 3;
export const UPLOAD_RETRY_BASE_MS = 200;

export async function postAuthorized(
  boardUrl: string,
  token: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${boardUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

function shouldRetryUpload(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uploadError(path: string, status: number, detail: string): Error {
  return new Error(
    `POST ${path} failed: ${status}${detail ? ` ${detail.slice(0, 500)}` : ""}`,
  );
}

/** POST with retries so a transient board error does not drop the last log batch. */
export async function postAuthorizedWithRetry(
  boardUrl: string,
  token: string,
  path: string,
  body: unknown,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < UPLOAD_RETRY_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await postAuthorized(boardUrl, token, path, body);
    } catch (error) {
      lastError = error;
      if (attempt === UPLOAD_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      await sleep(UPLOAD_RETRY_BASE_MS * 2 ** attempt);
      continue;
    }
    if (response.ok) {
      return response;
    }
    const detail = await response.text().catch(() => "");
    lastError = uploadError(path, response.status, detail);
    if (
      !shouldRetryUpload(response.status) ||
      attempt === UPLOAD_RETRY_ATTEMPTS - 1
    ) {
      throw lastError;
    }
    await sleep(UPLOAD_RETRY_BASE_MS * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
