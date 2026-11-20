# LedgerForge

[![ci](https://github.com/aashwindev/ledgerforge/actions/workflows/ci.yml/badge.svg)](https://github.com/aashwindev/ledgerforge/actions/workflows/ci.yml) ![licence MIT](https://img.shields.io/badge/licence-MIT-blue)

*Every change reviewed, every choice explained, every failure survived.*

A VS Code coding agent whose agent loop runs on [TrueForge](https://github.com/truefoundry/trueforge). Built for the TrueFoundry Forge-a-thon (Techfest, IIT Bombay 2026-27).

- **Inline edit:** select code, press **Cmd/Ctrl+Alt+K**, and describe the change. The diff opens with ✓ Accept / ✗ Reject on every hunk.
- **Agent mode:** describe a feature in the LedgerForge panel without naming files. LedgerForge finds the code, tests, docs and changelog, proposes edits to each, and runs the tests.
- **Context you can see:** type `@` to pin files or symbols. LedgerForge also retrieves on its own, and the **Context Receipt** shows every file considered, why it was picked or left out, and its tokens against an 8k budget.
- **Safe by construction:** TrueForge tool approval drives the review, and only accepted hunks are written. **LedgerForge: Undo Last Change / Undo Last Run** restore files.
- **Stop anytime:** the run halts, pending proposals are dropped, and this run's writes are rolled back. `git status` stays clean.
- **Survives model failure:** LedgerForge retries with backoff, then switches automatically to a second model in the **same TrueForge session**, so history and accepted edits are kept. If everything fails, the run is rolled back.

**Starting point:** from scratch (no upstream fork). MIT licence.

## Rubric → where to see it

| Criterion | What LedgerForge does | Proof in this repo |
|---|---|---|
| A1 Inline edit | Select, **Cmd/Ctrl+Alt+K**, plain-language instruction. Diff opens with ✓/✗ on **each hunk** | `src/review.ts`, `src/hunks.ts`; e2e `taskA` (2 hunks, `False`); also passes on `gpt-5-4-nano` |
| A2 Agent mode | One request in the panel → TrueForge tool loop → **4 files found and edited unprompted** in Task B | e2e `taskB`: 3/3 runs change `cli.py`, `test_cli.py`, `cli.rst`, `CHANGES.rst`; pytest green; masked JSON |
| A3 Streaming + cancel | Tokens stream from `model.message.delta`. Stop aborts, cancels the session, drops proposals, **rolls back applied hunks** | e2e `cancel`: mid-stream stop 24–30 ms; stop after an accepted edit 44–72 ms, `git status` clean |
| B1 Context | `@file`/`@symbol` + tf-idf retrieval + link expansion (code → tests → docs → changelog), **8k budget**, Context Receipt with reasons and exclusions | `src/context.ts`, `src/mentions.ts`; unit tests; [write-up §4](docs/writeup.md) |
| B2 Diff safety | Nothing is written until a hunk is accepted. Edit guard (unique `old_text`, Python must parse). **Undo Last Change / Undo Last Run** | e2e `taskA` (undo → clean), `taskB` (undo run → clean); unit tests |
| B3 Resilience | Retry 1 s / 3 s → **automatic fallback** in the same session, plus a stall watchdog; workspace unchanged | e2e `taskC`: model endpoint unreachable → 3 attempts → fallback → reject → `git status` clean |
| B4 TrueForge | Editor tools are **MCP tools**. **TrueForge tool approval drives the review**. Exploration **subagent**, deferred tool loading, compaction | `src/mcpServer.ts`, `agent/*.json`, `src/forge.ts`; ↗ Open in TrueForge link on every run |
| C1/C2 | Video and write-up | [docs/writeup.md](docs/writeup.md), [docs/RECORDING.md](docs/RECORDING.md) |

## Setup (from a clean clone)

1. Start TrueForge in local mode:
   ```
   OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]' npx @truefoundry/trueforge@latest
   ```
   It serves http://localhost:8790. The variable lets TrueForge reach the extension's MCP server on loopback (TrueForge blocks private addresses by default). Nothing else is opened up.
2. In TrueForge, go to **Settings → Models** and add a provider and key. Keys live only in TrueForge, never in this repo. Defaults are `openai/gpt-5-4-mini` (primary) and `openai/gpt-5-4-nano` (fallback), so one OpenAI key is enough. Any model TrueForge serves works: set `ledgerforge.model` / `ledgerforge.fallbackModel` in VS Code settings (see `ledgerforge.config.example.json`), e.g. a local model behind an OpenAI-compatible endpoint.
3. Build:
   ```
   npm install && npm run build
   ```
4. Open this folder in VS Code and press **F5**. The Extension Development Host opens `../forge-agent-flask-rehearsal` (edit `.vscode/launch.json` to change it).
5. The LedgerForge panel (activity bar) shows **Connected to TrueForge**. Run **LedgerForge: Doctor** to check TrueForge, the MCP tools and both models.

### Loading the agent definition

The agent definitions are `agent/ledgerforge-agent.json` (agent mode) and `agent/ledgerforge-inline.json` (inline edit). The extension registers them in TrueForge automatically on start-up and on every request, together with its MCP server `ledgerforge-editor`. To load one by hand, for example to inspect it in the TrueForge UI:

```
sed 's/{{MODEL}}/openai\/gpt-5-4-mini/' agent/ledgerforge-agent.json \
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
| LedgerForge: Inline Edit Selection | Cmd/Ctrl+Alt+K |
| LedgerForge: Stop | Cmd/Ctrl+Alt+. |
| LedgerForge: Ask Agent (open panel) · Undo Last Change · Undo Last Run · Doctor · Accept/Reject All Hunks | palette |

In the panel, type `@` to pin a file or symbol (autocomplete). Every run shows **↗ Open in TrueForge** for its session.

Settings: `ledgerforge.baseUrl`, `ledgerforge.model`, `ledgerforge.fallbackModel`, `ledgerforge.autoApproveCommands` (read-only git commands run without a prompt).

## Tests

```
npm test            # 14 unit tests (workspace jail, edit guard, command allowlist, retrieval, budget, @mentions, hunks); runs in CI
```

End to end, each in a real, isolated VS Code window against live TrueForge:

```
scripts/e2e.sh taskA  ../forge-agent-flask-rehearsal   # inline edit, accept per hunk, verify False, undo
scripts/e2e.sh taskB  ../forge-agent-flask-rehearsal   # agent mode, 4 files, pytest, masked JSON, undo run
scripts/e2e.sh taskC  ../forge-agent-flask-rehearsal   # broken primary → automatic fallback → reject → clean
scripts/e2e.sh cancel ../forge-agent-flask-rehearsal   # stop mid-stream and after an applied hunk → clean
```

Each test runs in a real, isolated VS Code window against live TrueForge. The workspace is a clone of pallets/flask at 3.1.3 (`22d92470`) with a `.venv` (editable install, pytest 8.4.2).

## Licence

MIT, see [LICENSE](LICENSE).
