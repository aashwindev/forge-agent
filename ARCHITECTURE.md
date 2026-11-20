# Architecture

TrueForge runs the agent loop and calls the model. The extension is a TrueForge client, an MCP server for the editor, and the review UI. Nothing here calls a model provider.

## One request, end to end

1. **Panel or inline edit** (`src/panel.ts`, `src/extension.ts`). The user's text goes to `Runner.start`. Inline edit adds the selected lines and any `@mentions`.
2. **Context pack** (`src/context.ts`, `src/mentions.ts`). This step is agent mode only. `@file`/`@symbol` mentions are pinned first. tf-idf retrieval then picks seed files, link expansion adds their tests, docs page and changelog, and outlines are packed into 8k tokens. The panel's Context Receipt shows every row with its reason.
3. **TrueForge session** (`src/forge.ts`). `sessions.create` uses the agent spec from `agent/forge-agent.json` or `agent/forge-inline.json` with the configured model, then `createTurnStream`. Text deltas stream into the panel.
4. **Tool calls.** TrueForge calls our MCP server (`src/mcpServer.ts`, Streamable HTTP on 127.0.0.1 with a per-launch bearer token). Tools live in `src/tools.ts`, and every path goes through `Workspace.resolve`, the jail in `src/workspace.ts`.
5. **Approval pause.** `propose_edit` and `run_command` require approval. TrueForge emits `tool.approval_required` and the turn pauses. `Runner.approve`:
   - checks each edit with `validateEdit`, the guard;
   - opens `ReviewController.review` (`src/review.ts`, `src/hunks.ts`): a diff editor with ✓/✗ CodeLens per hunk;
   - answers with `user.tool_approval` (allow if any hunk was accepted, deny with a reason otherwise);
   - resumes with `subscribeToTurn`.
6. **Apply.** TrueForge calls `propose_edit`, and `ReviewController.apply` writes only the accepted hunks (WorkspaceEdit + save). The pre-image goes to the run journal, and the agent is told which hunks were applied or rejected.
7. **Finish.** If the run wrote files but never ran tests, the runner sends one follow-up turn asking for them. The status banner shows "Done". Explorer badges (`src/badges.ts`) show 👁 read, ✎ proposed and ✓ applied.

## Failure paths

| Event | What happens | Code |
|---|---|---|
| Stop pressed | abort the stream → `sessions.cancel` → close reviews → undo the run's journal entries → `git status` check | `Runner.stop` |
| Turn error / no first event in 20 s / silent stream for 150 s | retry the primary model (1 s, 3 s) → `PATCH` the session to the fallback model → continuation turn in the same session | `Runner.start`, `Runner.attempt` |
| Session cannot be continued | roll back the run's writes, then start a new session with the original input | `Runner.start` |
| All models fail | roll back everything the run wrote; error banner | `Runner.start` |
| Edit references missing or duplicated text, or breaks Python | denied before review, and the reason goes back to the agent | `validateEdit` |
| Command not approved by the user | the MCP handler refuses it, even if the model calls it directly | `Runner.commandAllowed` |
| Approval for an unknown tool | denied (fail closed); `call_tool` wrappers are unwrapped first | `ForgeClient.runTurn`, `Runner.approve` |

## Files

| File | Responsibility |
|---|---|
| `src/extension.ts` | activation, wiring, commands, MCP + agent registration |
| `src/forge.ts` | TrueForge SDK/HTTP client: agents, MCP registration, turns, approvals, cancel, session PATCH |
| `src/mcpServer.ts` | MCP server over Streamable HTTP |
| `src/tools.ts` | `search_code`, `find_symbol`, `read_file`, `propose_edit`, `run_command`, edit guard |
| `src/workspace.ts` | path jail, secrets filter, live editor buffers |
| `src/context.ts` | retrieval, link expansion, budget packing, receipt rows |
| `src/mentions.ts` | `@file`/`@symbol` resolution and autocomplete |
| `src/review.ts`, `src/hunks.ts` | per-hunk diff review, apply, journal, undo |
| `src/runner.ts` | run lifecycle: retry, fallback, watchdogs, stop, rollback, approvals |
| `src/panel.ts` | webview: stream, feed, Context Receipt, @ autocomplete, banner |
| `src/badges.ts` | Explorer footprint badges |
| `agent/*.json` | TrueForge agent definitions (model is a placeholder filled from settings) |
| `test/unit.test.ts` | unit tests (`npm test`, CI) |
| `test/e2e/*.ts`, `scripts/e2e.sh` | end-to-end tasks in a real VS Code window against live TrueForge |
