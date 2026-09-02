import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveMcpStdioEntrypoint(fromUrl = import.meta.url): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (;;) {
    const pkgFile = join(dir, "package.json");
    if (existsSync(pkgFile)) {
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as {
        name?: string;
        bin?: Record<string, string>;
      };
      if (pkg.name === "@comitia/agent") {
        const bin = pkg.bin?.["comitia-mcp-proxy"];
        if (typeof bin !== "string") {
          throw new Error(
            "@comitia/agent package.json is missing bin.comitia-mcp-proxy",
          );
        }
        return join(dir, bin);
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("Could not locate @comitia/agent package.json");
    }
    dir = parent;
  }
}
