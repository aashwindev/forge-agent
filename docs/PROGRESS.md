# Progress

Source of truth: [PRD.md](PRD.md) §6 (build order). Tick an item only when its gate has been verified. Commit + push after each ticked step.

## Build order

- [x] **1. Unblock.** Primary model streams through TrueForge, Forge: Ask works end to end.
  - Verified: bundled `dist/extension.js` (VS Code API stubbed) streamed "Hello from me." via `openai/gpt-5-4-mini`, `[turn done]`.
  - Models: primary `openai/gpt-5-4-mini` (works), fallback `anthropic/claude-haiku-5-5`. **Open:** the Anthropic key in TrueForge returns `401 invalid x-api-key` and must be replaced before step 5.
- [x] **2. MCP server + tools + registration + agent upsert.** (Doctor moves into step 3's extension wiring.) Gate: TrueForge session shows `read_file` called on our server.
  - [x] `src/workspace.ts`: path jail, blocks `.git` and secrets files, editor-buffer overlay
  - [x] `src/tools.ts`: search_code, find_symbol, read_file, propose_edit (+ guard: unique old_text, Python still parses), run_command (allowlist, no shell, venv-aware)
  - [x] `src/mcpServer.ts`: Streamable HTTP on 127.0.0.1, per-launch bearer token
  - [x] `agent/forge-agent.json`, `agent/forge-inline.json`
  - [x] `src/forge.ts`: register MCP in TrueForge, upsert agents, run turn with approval pauses, cancel (written, not yet run live)
  - [x] `scripts/smoke.ts`: headless harness (real TrueForge + MCP + workspace)
  - [x] smoke test against live TrueForge + Flask clone. Verified: TrueForge listed all 5 tools; agent called `read_file` on our server and answered correctly (session `01m7vm21bk7m719tke0vn80j8d`). Approval pause verified: Task A instruction made TrueForge pause on `propose_edit`; deny returned; `git status` clean.
  - Needs `OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]'` on TrueForge (SSRF guard blocks loopback by default). README updated.
  - Fix noted: after a deny the inline model claimed it had updated the file; instructions now require it to say nothing changed.
- [ ] **3. Approval-driven review + inline edit (Task A) + undo.** Gate: `False` printed; Ctrl+Z restores; `git status` clean.
- [ ] **4. Cancel + journal rollback.** Gate: Stop mid-run leaves `git status` clean.
- [ ] **5. Retry/fallback (Task C).** Gate: invalid key, then auto fallback diff, then reject, then clean.
- [ ] **6. ContextEngine + receipt + scout instructions + run_command (Task B).** Gate: 3 of 3 rehearsals touch ≥3 files, pytest green, masked JSON, subagent visible in session.
- [ ] **7. Extras 1–3** (guard, badges, why-this-hunk), only if 1–6 pass. Then feature freeze.
- [ ] **8. Record video** per PRD §4. Gate: every clause in PRD §2 visible.
- [ ] **9. Write-up PDF** per PRD §5, scorecard timestamps from the final cut.
- [ ] **10. Clean-clone README check, secrets grep, links public (incognito), submit form.**

## Notes

- The SDK is ESM-only. esbuild bundles it into the CJS extension fine; plain `require` from Node fails (use `import`).
- TrueForge 0.185.1 local. MCP servers are registered via `PUT /api/v1/settings/mcp-servers` (`{manifest:{type:"remote",name,url,description,auth:{type:"header",headers}}}`).
- Inline agent preloads its 4 tools (speed); agent mode uses deferred tool loading (B4, explained in write-up §3).
