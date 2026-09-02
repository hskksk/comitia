# enginebay

Isolated **bays** for coding-agent CLIs.

enginebay runs a host-installed coding agent (OpenCode, Claude Code, and later Cursor Agent / Gemini CLI) as a library: one process, one workspace, one MCP injection, a canonical event stream. It keeps the engine's **config and session records** out of the user's ordinary install, and **inherits only provider login** from the host.

It is not a product, a session loop, or a sandbox OS. Host applications — Comitia, eval harnesses, other adapters — stay thin.

**Status:** v1 implements **OpenCode** (`openBay`, `doctor`, `env` isolation). `claude-code` is in the catalog but not implemented yet. See [docs/design.md](docs/design.md).

## Why

Each coding CLI stores config, transcripts, and auth in a different place (`~/.claude`, `~/.config/opencode`, XDG, Keychain). Wrapping that knowledge inside every product duplicates the same bugs: polluted `~/.config`, leaked host `GH_TOKEN`, missing login after `HOME` remap, ad-hoc stdout parsers.

enginebay owns that knowledge. A consumer owns *when* to run, *which* prompt, *which* tools, and *what* to do with events.

## What it does

| Concern | enginebay | Consumer (e.g. Comitia) |
| --- | --- | --- |
| Spawn the CLI headless | yes | — |
| Isolate config / session DB | yes | — |
| Inherit provider auth from the host | yes | host login (`opencode auth`, `claude login`) |
| Inject session-scoped MCP | yes | provide the stdio command |
| Canonical events (text, thinking, tools) | yes | map to product traces |
| Workspace directory | uses what you pass | create / destroy |
| Day loop, ticks, personality, board | no | yes |
| GitHub App token minting | no | pass a token via `extraEnv` if needed |
| OS sandbox (Seatbelt, landlock, microVM) | not in v1 | optional later backend |

## Intended use

```ts
import { doctor, openBay } from "enginebay";

const check = await doctor("opencode");
if (!check.ok) throw new Error(check.message);

const bay = await openBay({
  engine: "opencode",
  workDir: "/tmp/work",
  mcp: {
    command: process.execPath,
    args: ["/path/to/mcp-proxy"],
    env: { BOARD_URL: "http://127.0.0.1:8787" },
  },
  instructions: "You are a participant on a consensus board. Tools are the only output that counts.",
  extraEnv: {
    // Optional. Host GH_TOKEN is stripped unless you pass one.
    GH_TOKEN: mintedInstallationToken,
  },
});

for await (const event of bay.run("Read the briefing and set today's goals.")) {
  // event.kind: "text" | "thinking" | "tool_call" | "tool_result" | "tokens" | "diagnostic" | "exit"
}

await bay.close();
```

Each `run()` is a **fresh CLI process**. Conversation continuity is the consumer's job (a redrive prompt), not `--continue` inside the engine.

## Engines

Planned catalog. v1 implements OpenCode first.

| ID | CLI | Notes |
| --- | --- | --- |
| `opencode` | `opencode` | MCP via `OPENCODE_CONFIG_CONTENT`. Auth under `~/.local/share/opencode`. |
| `claude-code` | `claude` | MCP via `--mcp-config --strict-mcp-config`. Auth via host `claude login` / Keychain. |
| `cursor-agent` | later | |
| `gemini` | later | |

The CLI must already be on `PATH`. enginebay does not vendor engine binaries.

## Isolation (v1: `env`)

Default backend remaps XDG (and engine-specific flags such as `OPENCODE_DISABLE_GLOBAL_CONFIG`) to a disposable directory, so host `~/.config/opencode` and `~/AGENTS.md` are neither read nor written. Provider auth is reattached from the host by a **narrow, engine-specific path** (symlink or kept `HOME` for Keychain) — not by exposing the whole home directory.

Host `GH_TOKEN` / `GITHUB_TOKEN` are removed from the child environment unless the consumer puts them in `extraEnv`.

OS-level sandboxes (`jai`, Anthropic `srt`, Docker `sbx`) are **optional backends**, not this package's identity. See [design §6](docs/design.md#6-isolation-backends).

## Package layout

This directory is `packages/enginebay` in the Comitia monorepo so Comitia and (later) other repos can share one implementation. The npm name is the unscoped **`enginebay`**, not `@comitia/enginebay`, so imports stay stable when the package moves to its own repository.

| Now | Later |
| --- | --- |
| `packages/enginebay` in [hskksk/comitia](https://github.com/hskksk/comitia) | `hskksk/enginebay` |
| `"name": "enginebay"` | same |

## Documentation

- [Design](docs/design.md) — goals, API, isolation, events, consumers, extraction.

## License

UNLICENSED while the package lives inside Comitia. License will be chosen when it is extracted.
