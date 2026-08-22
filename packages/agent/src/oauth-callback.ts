import { createServer, type Server } from "node:http";

export interface OAuthCallbackServer {
  callbackOrigin: string;
  waitForToken(): Promise<string>;
  close(): void;
}

export interface StartOAuthCallbackServerOptions {
  port?: number;
  timeoutMs?: number;
  pathname?: string;
}

const SUCCESS_HTML = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>Comitia ログイン完了</title>
  </head>
  <body>
    <p>ログインしました。このタブを閉じてターミナルに戻ってください。</p>
  </body>
</html>`;

const ERROR_HTML = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>Comitia ログイン失敗</title>
  </head>
  <body>
    <p>ログインに失敗しました。ターミナルのメッセージを確認してください。</p>
  </body>
</html>`;

function readCallbackToken(
  requestUrl: URL,
  pathname: string,
): string | null {
  if (requestUrl.pathname !== pathname) {
    return null;
  }
  const token = requestUrl.searchParams.get("token")?.trim();
  return token ? token : null;
}

export function startOAuthCallbackServer(
  options: StartOAuthCallbackServerOptions = {},
): Promise<OAuthCallbackServer> {
  const pathname = options.pathname ?? "/login/callback";
  const timeoutMs = options.timeoutMs ?? 120_000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let resolveToken: ((token: string) => void) | undefined;
    let rejectToken: ((error: Error) => void) | undefined;
    const tokenPromise = new Promise<string>((resolveInner, rejectInner) => {
      resolveToken = resolveInner;
      rejectToken = rejectInner;
    });

    const server = createServer((req, res) => {
      try {
        const host = req.headers.host ?? "127.0.0.1";
        const requestUrl = new URL(req.url ?? "/", `http://${host}`);
        const token = readCallbackToken(requestUrl, pathname);
        if (!token) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }

        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(SUCCESS_HTML);
        settled = true;
        clearTimeout(timer);
        resolveToken?.(token);
      } catch (error) {
        res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
        res.end(ERROR_HTML);
        settled = true;
        clearTimeout(timer);
        rejectToken?.(
          error instanceof Error
            ? error
            : new Error("コールバック処理中にエラーが発生しました"),
        );
      }
    });

    const finishStartup = (error?: Error, callbackServer?: OAuthCallbackServer) => {
      if (error) {
        server.close();
        reject(error);
        return;
      }
      resolve(callbackServer!);
    };

    server.on("error", (error) => {
      finishStartup(error);
    });

    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address ? address.port : options.port;
      if (!port) {
        finishStartup(new Error("コールバックサーバーのポートを取得できませんでした"));
        return;
      }

      timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        server.close();
        rejectToken?.(
          new Error("GitHub ログインがタイムアウトしました。もう一度お試しください。"),
        );
      }, timeoutMs);

      finishStartup(undefined, {
        callbackOrigin: `http://127.0.0.1:${port}`,
        waitForToken: () => tokenPromise,
        close: () => {
          clearTimeout(timer);
          server.close();
        },
      });
    });
  });
}

export function buildOAuthStartUrl(boardUrl: string, callbackOrigin: string): string {
  const url = new URL("/v1/auth/github", boardUrl);
  url.searchParams.set("return_origin", callbackOrigin);
  return url.toString();
}
