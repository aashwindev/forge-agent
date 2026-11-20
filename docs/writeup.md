# Forge Agent: TrueFoundry Forge-a-thon, Round 1

*Every change reviewed, every choice explained, every failure survived.*
Repo: https://github.com/aashwindev/forge-agent · Video: TODO_VIDEO_URL

## 1. Team

TODO: names, college or employer, GitHub handles. Techfest Team ID: TODO.

## 2. Starting point

From scratch (no upstream fork). MIT licence. Third-party code is used only as npm dependencies (section 7).

## 3. Architecture on TrueForge

```
VS Code extension (TypeScript)
 ├─ ForgeClient       @truefoundry/trueforge-sdk: sessions, streamed turns, approvals, cancel, retry/fallback
 ├─ Editor MCP server 127.0.0.1:<random port>, Streamable HTTP, per-launch bearer token
 ├─ ContextEngine     idf retrieval + link expansion + 8k-token packing → Context Receipt
 ├─ ReviewController  per-hunk diff review, apply accepted hunks only, run journal, undo
 └─ Panel (webview)   streaming text, tool feed, Context Receipt, status/fallback banner
TrueForge (local, :8790) runs the agent loop, calls the model, calls our MCP server
```

**The agent loop runs only in TrueForge.** The extension creates sessions and turns with the SDK and renders the streamed events (`model.message.delta`, `tool.approval_required`, `thread.created`, `turn.done`). It never talks to a model provider. Model names are settings, and TrueForge resolves them. The agent definitions are committed as `agent/forge-agent.json` (agent mode) and `agent/forge-inline.json` (inline edit). The extension registers both through TrueForge's agents API on start-up.

**Editor capabilities are MCP tools.** On activation the extension starts an MCP server and registers it in TrueForge as `forge-editor`:

| Tool | What it does | Gate |
|---|---|---|
| `search_code(query)` | idf-ranked files with matching lines (≤12 files) | none |
| `find_symbol(name)` | definitions + references (≤20) | none |
| `read_file(path, start?, end?)` | reads the live editor buffer (unsaved text included) | none |
| `propose_edit(path, old_text, new_text, reason)` | applies **only the hunks the user accepted** | TrueForge approval |
| `run_command(command, args)` | no shell; allowlist pytest/python/flask/git read-only | TrueForge approval |

Every tool is jailed to the workspace and refuses `.git` and secrets files.

**TrueForge tool approval drives the diff review.** `propose_edit` has `require_approval_for_tools`. When TrueForge pauses with `tool.approval_required`, the extension reads the call arguments, checks the edit with a guard (`old_text` must exist exactly once; Python must still parse), and opens a diff with ✓/✗ CodeLens on every hunk. If at least one hunk is accepted, we send `user.tool_approval: allow`. TrueForge then calls our `propose_edit`, which writes only the accepted hunks and returns "applied [1,3], rejected [2]" to the agent. If every hunk is rejected, we send `deny` with a reason, and nothing touches disk until then. Approvals also unwrap TrueForge's `call_tool` wrapper for deferred tools, and they fail closed on anything unexpected.

**Context-engineering features in use:**

- **Dynamic subagents:** the root agent always starts one exploration subagent, which is visible as its own thread in the TrueForge session.
- **Deferred tool loading:** search tools are discovered with `list_tools` / `call_tool`.
- **Context compaction** and **large-tool-response handling** for long runs.

We did not use Code Mode or skills, because both need the sandbox and the editor tools must run in the editor process.

**Stop and resilience.** Stop aborts the client stream, calls `sessions.cancel`, drops pending proposals, and rolls back this run's applied hunks from the journal. It then shows `git status` as clean (measured 24–72 ms).

A run fails over when a turn errors, when no event arrives within 20 s, or when a running stream goes silent for 150 s; the user's review time does not count. Forge then retries the primary model (1 s, then 3 s backoff) and switches automatically to the fallback model. The switch happens **in the same TrueForge session**: we `PATCH` the session's agent spec to the fallback model and send a continuation turn. The conversation history and the hunks the user already accepted carry over; a test showed the fallback model answering from a message sent during the failed turn. If the session cannot be continued, Forge rolls back this run's writes and starts a new session. If every model fails, the run's writes are rolled back, so the workspace is exactly as before.

## 4. How context is selected

0. **Explicit mentions.** Type `@` in the panel for autocomplete over files and symbols (`@cli.py`, `@get_debug_flag`). A mentioned file is pinned whole, and a mentioned symbol is pinned as its full definition with decorators. Both come first and are charged to the budget. Unknown mentions show in the receipt as "no file or symbol with this name". Inline edit accepts the same mentions.
1. **Automatic retrieval before turn 1 (model-independent).** The request is tokenised (stopwords dropped). Every text file is scored with BM25-style saturating term frequency × idf, ×2 when a request term is the file name (`cli` → `cli.py`).
2. **Link expansion.** The top 2 implementation files are seeds. Each one pulls in `tests/test_<module>.py`, the docs page of the same name (`docs/<module>.rst`), and the project changelog. This is how Task B finds `tests/test_cli.py`, `docs/cli.rst` and `CHANGES.rst` without being told.
3. **Budget packing.** Outlines (signatures for code, headings for docs, newest entries for the changelog), best first, into a fixed **8,000-token budget**. Anything that does not fit, or ranks lower, is listed as **excluded with a reason**. On Task B the pack uses 2,991 / 8,000 tokens and lists 10 included and 5 excluded files.
4. **Scout subagent.** It verifies the pack with `search_code` / `find_symbol` / `read_file` and returns ranked files with reasons, so the root agent never sees raw search dumps.
5. **Context Receipt (panel).** The receipt shows every file with ✓/✗, its source (auto / linked / agent), tokens, the reason, and a budget meter. Rows are marked "read" live as the agent opens files. The receipt is built only from real retrieval results and tool calls.

**Trade-offs.** Lexical scoring is fast, has no dependencies and is explainable, but it can miss synonyms. Link expansion follows the naming conventions most Python projects use. Outlines rather than bodies keep the pack small, and the agent reads full files itself.

## 5. Model setup

| Role | Model | Where it ran | Rough cost (measured from TrueForge usage events) |
|---|---|---|---|
| Primary (Tasks A, B and the cancel proof) | `openai/gpt-5-4-mini` | OpenAI API, called only by local TrueForge 0.185.1 | Task A ≈ 2k input + 0.3k output tokens ≈ **$0.003**. Task B ≈ 0.3–1.7M input tokens (≈ 85% cache hits) + 4–10k output ≈ **$0.06–0.34, typically $0.15** |
| Fallback (Task C) | `openai/gpt-5-4-mini` | same | as Task A |
| Unreachable primary (Task C) | `local-ollama/qwen3-coder`: a custom OpenAI-compatible provider in TrueForge at `http://127.0.0.1:11434/v1`, with no server running | TrueForge → `ECONNREFUSED`, three attempts | $0 |
| Default fallback (everyday use) | `openai/gpt-5-4-nano` | same OpenAI key | cents |
| Small-model check (live re-run) | `openai/gpt-5-4-nano` | same | < $0.001 per Task A |

Prices are gpt-5.4-mini list prices ($0.75 input / $0.075 cached input / $4.50 output per 1M tokens). All development and rehearsal runs together cost a few dollars. Task B's input is large because every tool round re-sends the conversation, and TrueForge's prompt caching absorbs most of it.

To switch models: add or choose a model in TrueForge Settings → Models, then set `forge.model` / `forge.fallbackModel` in VS Code settings. Nothing in the extension is provider-specific.

## 6. Scorecard

| Row | Timestamp | Claim |
|---|---|---|
| A1 Inline edit | TODO | Task A: select, Ctrl/Cmd+Alt+K, diff with per-hunk ✓ (A) and ✗ (C) |
| A2 Agent mode | TODO | Task B: 4 files found and edited unprompted (cli.py, test_cli.py, cli.rst, CHANGES.rst) |
| A3 Streaming + cancel | TODO | tokens stream live; Stop halts in < 100 ms (measured 24–72 ms), `git status` clean |
| B1 Context | TODO | Context Receipt during Task B: @mentions pinned, auto-retrieved files with reasons, exclusions, 8k budget meter |
| B2 Diff safety | TODO | per-hunk review; Forge: Undo (A) and Undo run (B) restore, `git status` clean |
| B3 Resilience | TODO | Task C: endpoint unreachable → retry 1/2 → retry 2/2 → automatic fallback in the same TrueForge session, no clicks, `git status` clean |
| B4 TrueForge | TODO | session view: forge-editor MCP calls, approval events, subagent thread |
| C1 Video | — | A → B → C in order, each verified on screen |
| C2 Write-up | — | this document |

## 7. Tools used

VS Code Extension API; TrueForge (local) and `@truefoundry/trueforge-sdk`; `@modelcontextprotocol/sdk`; `zod`; `diff`; esbuild; TypeScript; Node's built-in test runner. Testing: 14 unit tests, run in CI on every push, plus four end-to-end scenarios (`scripts/e2e.sh`). Each scenario drives a real, isolated VS Code window against live TrueForge and checks the outcome with `git status`, pytest and the Flask CLI. AI coding assistant: Claude Code (Claude Opus 5.5), used for writing and testing the code.

## 8. Known limitations and what you would do with another month

- **Syntax guard is Python-only.** Other languages get only the "`old_text` must exist exactly once" check. Next: tree-sitter for every language.
- **Retrieval is lexical.** Next: local embeddings combined with BM25, and import-graph link expansion instead of naming conventions.
- **Fallback is client-driven.** The extension swaps the session's model and sends a continuation turn, so the failed turn stays in the session as an error. Next: a TrueForge PR for native, per-agent fallback models, so every TrueForge client gets this.
- **The model sometimes needs a second nudge.** If a run applied edits but never ran tests, Forge asks it once more, in the same session, to run them.
- **Undo is in-memory.** The run journal does not survive a VS Code restart. Git is the backstop.
- **One workspace folder.** Multi-root workspaces use the first folder.
