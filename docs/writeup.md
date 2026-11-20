# Forge Agent: TrueFoundry Forge-a-thon, Round 1

*Every change reviewed, every choice explained, every failure survived.* Repo: https://github.com/aashwindev/forge-agent · Video: TODO_VIDEO_URL

## 1. Team

TODO: names, college or employer, GitHub handles. Techfest Team ID: TODO.

## 2. Starting point

From scratch (no upstream fork). MIT licence. Third-party code is used only as npm dependencies (section 7).

## 3. Architecture on TrueForge

```
VS Code extension (TypeScript)
 ├─ ForgeClient       trueforge-sdk: sessions, streamed turns, approvals, cancel, fallback
 ├─ Editor MCP server 127.0.0.1:<random port>, Streamable HTTP, per-launch bearer token
 ├─ ContextEngine     @mentions + retrieval + link expansion + 8k budget → Context Receipt
 ├─ ReviewController  per-hunk review, apply accepted hunks only, run journal, undo
 └─ Panel             streaming text, tool feed, Context Receipt, status banner
TrueForge (local) runs the agent loop, calls the model, calls our MCP server
```

**The loop runs in TrueForge.** The extension creates sessions and turns with the SDK and renders the streamed events. It never calls a model provider. Agent definitions are committed as `agent/forge-agent.json` and `agent/forge-inline.json`; the extension registers them through TrueForge's agents API, together with its MCP server `forge-editor`.

| MCP tool | What it does | Gate |
|---|---|---|
| `search_code`, `find_symbol` | ranked search; definitions and references | none |
| `read_file` | reads the live editor buffer | none |
| `propose_edit(path, old_text, new_text, reason)` | writes **only the hunks the user accepted** | TrueForge approval |
| `run_command` | no shell; allowlist pytest/python/flask/read-only git | TrueForge approval |

All tools are jailed to the workspace and refuse `.git` and secrets files.

**TrueForge approval drives the review.** On `tool.approval_required`, a guard checks each edit: `old_text` must occur exactly once, and Python must still parse. The edit then opens as a diff with ✓/✗ on every hunk. If any hunk is accepted we answer `allow`, and TrueForge calls `propose_edit`, which writes only those hunks and reports applied and rejected hunks to the agent. If every hunk is rejected, we `deny` with a reason. Nothing touches disk before a decision. Unknown approval requests are denied (fail closed).

**Harness features.** A mandatory exploration **subagent**, which shows as its own thread in the session. **Deferred tool loading** (`list_tools`/`call_tool`), **compaction** and large-tool-response handling. Code Mode and skills need the sandbox, and our tools must run in the editor, so we did not use them.

**Stop.** Stop aborts the stream, calls `sessions.cancel`, closes pending reviews and rolls back the run's applied hunks from the journal. Measured: 24–72 ms, `git status` clean.

**Fallback.** Triggers on a turn error, no first event within 20 s, or a stream silent for 150 s (time spent reviewing is excluded). Forge retries the primary model after 1 s and 3 s, then `PATCH`es the **same session** to the fallback model and sends a continuation turn. History and accepted edits carry over. If every model fails, the run is rolled back.

## 4. How context is selected

1. **@mentions.** The panel autocompletes files and symbols. A mentioned file is pinned whole; a mentioned symbol is pinned as its full definition. Mentions come first and count against the budget.
2. **Retrieval before turn 1 (works with any model).** Files are scored by saturating term frequency × idf, ×2 when a request term is the file name (`cli` → `cli.py`).
3. **Link expansion.** The top 2 implementation files pull in `tests/test_<module>.py`, `docs/<module>.rst` and the changelog. This is how Task B finds the test, docs and changelog without being told.
4. **8,000-token budget.** Outlines (signatures for code, headings for docs) are packed best first. Anything that does not fit or ranks lower is listed as excluded, with a reason. Task B's pack uses 2,991 / 8,000 tokens: 10 files in, 5 out.
5. **Scout subagent.** It verifies the pack with the search tools and returns ranked files with reasons, so the root agent never sees raw search dumps.
6. **Context Receipt.** The panel shows every row (✓/✗, source, tokens, reason) with a budget meter, and marks files live as the agent reads them.

**Trade-offs.** Lexical scoring is fast, explainable and has no dependencies, but it misses synonyms. Link expansion relies on common naming conventions. Outlines keep the pack small; the agent reads full files itself.

## 5. Model setup

| Role | Model | Where it ran | Approx. cost (from TrueForge usage) |
|---|---|---|---|
| Primary | `openai/gpt-5-4-mini` | OpenAI API via local TrueForge 0.185.1 | Task A ≈ $0.003; Task B $0.06–0.34, typically $0.15 (≈ 85% cache hits) |
| Fallback | `openai/gpt-5-4-nano` (Task C: `gpt-5-4-mini`) | same key | Task A < $0.001 |
| Task C primary | `local-ollama/qwen3-coder`: custom OpenAI-compatible provider at `127.0.0.1:11434/v1`, server not running | unreachable (`ECONNREFUSED`) | $0 |

Prices: $0.75 input, $0.075 cached input, $4.50 output per 1M tokens. All rehearsals together cost a few dollars. To switch models, pick any model in TrueForge **Settings → Models** and set `forge.model` / `forge.fallbackModel`. Nothing in the extension is provider-specific.

## 6. Scorecard

| Row | Time | Claim |
|---|---|---|
| A1 Inline edit | TODO | Task A: select, Cmd/Ctrl+Alt+K, diff with per-hunk ✓ (A) and ✗ (C) |
| A2 Agent mode | TODO | Task B: `cli.py`, `test_cli.py`, `cli.rst` (and usually `CHANGES.rst`) found and edited unprompted |
| A3 Streaming + cancel | TODO | tokens stream live; Stop halts in under 100 ms, accepted hunks rolled back, `git status` clean |
| B1 Context | TODO | Context Receipt in Task B: chosen and excluded files with reasons, 8k budget meter |
| B2 Diff safety | TODO | per-hunk review; Undo (A) and Undo Run (B) restore files, `git status` clean |
| B3 Resilience | TODO | endpoint unreachable → 2 retries → automatic fallback in the same session, no clicks, clean |
| B4 TrueForge | TODO | session: forge-editor MCP calls, approval events, subagent thread |
| C1 Video | — | A → B → C in order, each verified on screen |
| C2 Write-up | — | this document |

## 7. Tools used

VS Code Extension API, TrueForge and `@truefoundry/trueforge-sdk`, `@modelcontextprotocol/sdk`, `zod`, `diff`, esbuild, TypeScript, Node's test runner. Testing: 14 unit tests in CI, plus four end-to-end scripts that drive a real VS Code window against live TrueForge and check `git status`, pytest and the Flask CLI. AI coding assistant: Claude Code (Claude Opus 5.5).

## 8. Known limitations and what you would do with another month

- **The syntax guard covers Python only.** Next: tree-sitter for all languages.
- **Retrieval is lexical.** Next: embeddings combined with BM25, and import-graph links instead of naming conventions.
- **Fallback is client-driven.** The failed turn stays in the session as an error. Next: a TrueForge PR adding native per-agent fallback models.
- **Models sometimes skip tests.** Forge then asks once more to run them; we would enforce this in the agent definition instead.
- **Undo history is lost on restart.** The run journal lives in memory; git is the backstop.
- **One workspace folder only.**
