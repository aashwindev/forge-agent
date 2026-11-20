# Forge Agent

*Every change reviewed, every choice explained, every failure survived.*

A VS Code coding agent whose agent loop runs on [TrueForge](https://github.com/truefoundry/trueforge). Built for the TrueFoundry Forge-a-thon (Techfest, IIT Bombay 2026-27).

- **Inline edit:** select code, press **Cmd/Ctrl+Alt+K**, and describe the change. The diff opens with ✓ Accept / ✗ Reject on every hunk.
- **Agent mode:** describe a feature in the Forge panel without naming files. Forge finds the code, tests, docs and changelog, proposes edits to each, and runs the tests.
- **Context Receipt:** every file considered, why it was picked or left out, and its tokens against an 8k budget.
- **Safe by construction:** TrueForge tool approval drives the review, and only accepted hunks are written. **Forge: Undo Last Change / Undo Last Run** restore files.
- **Stop anytime:** the run halts, pending proposals are dropped, and this run's writes are rolled back. `git status` stays clean.
- **Survives model failure:** Forge retries, then switches automatically to a second model, and failed attempts are rolled back.

**Starting point:** from scratch (no upstream fork). MIT licence.

## Setup (from a clean clone)

1. Start TrueForge in local mode:
   ```
   OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]' npx @truefoundry/trueforge@latest
   ```
   It serves http://localhost:8790. The variable lets TrueForge reach the extension's MCP server on loopback (TrueForge blocks private addresses by default). Nothing else is opened up.
2. In TrueForge, go to **Settings → Models** and add your providers and keys. Keys live only in TrueForge, never in this repo. Defaults are `openai/gpt-5-4-mini` (primary) and `anthropic/claude-haiku-5-5` (fallback). Any model TrueForge serves works: set `forge.model` / `forge.fallbackModel` in VS Code settings (see `forge.config.example.json`).
3. Build:
   ```
   npm install && npm run build
   ```
4. Open this folder in VS Code and press **F5**. The Extension Development Host opens `../forge-agent-flask-rehearsal` (edit `.vscode/launch.json` to change it).
5. The Forge panel (activity bar) shows **Connected to TrueForge**. Run **Forge: Doctor** to check TrueForge, the MCP tools and both models.

### Loading the agent definition

The agent definitions are `agent/forge-agent.json` (agent mode) and `agent/forge-inline.json` (inline edit). The extension registers them in TrueForge automatically on start-up and on every request, together with its MCP server `forge-editor`. To load one by hand, for example to inspect it in the TrueForge UI:

```
sed 's/{{MODEL}}/openai\/gpt-5-4-mini/' agent/forge-agent.json \
  | curl -s -X POST -H 'content-type: application/json' --data @- http://localhost:8790/api/v1/agents
```

## How it works

```
VS Code extension (TypeScript)
 ├─ ForgeClient       @truefoundry/trueforge-sdk: sessions, streamed turns, approvals, cancel, retry/fallback
 ├─ Editor MCP server 127.0.0.1:<random port>, Streamable HTTP, per-launch bearer token
 │                    tools: search_code, find_symbol, read_file, propose_edit*, run_command*   (* approval-gated)
 ├─ ContextEngine     tf-idf retrieval + link expansion (module → tests → docs → changelog), 8k-token budget
 ├─ ReviewController  per-hunk diff review, apply accepted hunks only, run journal, undo
 └─ Panel             streaming text, tool feed, Context Receipt, status/fallback banner, Explorer badges
TrueForge (local) runs the agent loop, calls the model, calls the MCP server.
```

The extension never calls a model provider. See [docs/writeup.md](docs/writeup.md) for the architecture, context strategy, model setup and limitations.

## Commands

| Command | Key |
|---|---|
| Forge: Inline Edit Selection | Cmd/Ctrl+Alt+K |
| Forge: Stop | Cmd/Ctrl+Alt+. |
| Forge: Ask Agent (open panel) · Undo Last Change · Undo Last Run · Doctor · Accept/Reject All Hunks | palette |

Settings: `forge.baseUrl`, `forge.model`, `forge.fallbackModel`, `forge.autoApproveCommands` (read-only git commands run without a prompt).

## Tests

```
scripts/e2e.sh taskA  ../forge-agent-flask-rehearsal   # inline edit, accept per hunk, verify False, undo
scripts/e2e.sh taskB  ../forge-agent-flask-rehearsal   # agent mode, 4 files, pytest, masked JSON, undo run
scripts/e2e.sh taskC  ../forge-agent-flask-rehearsal   # broken primary → automatic fallback → reject → clean
scripts/e2e.sh cancel ../forge-agent-flask-rehearsal   # stop mid-stream and after an applied hunk → clean
```

Each test runs in a real, isolated VS Code window against live TrueForge. The workspace is a clone of pallets/flask at 3.1.3 (`22d92470`) with a `.venv` (editable install, pytest 8.4.2).

## Licence

MIT, see [LICENSE](LICENSE).
