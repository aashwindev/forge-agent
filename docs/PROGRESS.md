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
- [x] **3. Approval-driven review + inline edit (Task A) + undo.** Gate: `False` printed; undo restores; `git status` clean.
  - Verified in a real isolated VS Code window (`scripts/e2e.sh taskA ../forge-agent-flask-rehearsal`): diff in 4.2 s, 2 hunks (docstring, code) accepted one by one, `git status` empty during review, `FLASK_DEBUG=off` -> `False` (also OFF/n/N; 1/yes still True), Forge: Undo -> `git status` clean.
  - Built: `src/hunks.ts` (+ `test/hunks.test.ts`), `src/review.ts` (diff editor + per-hunk CodeLens, journal, undo), `src/runner.ts` (approvals -> review, retry/fallback, stop + rollback), `src/panel.ts` (agent panel), `src/extension.ts` (wiring, Doctor), `.vscode/launch.json` (F5 opens the Flask clone).
  - Flask clone: `.venv` with editable install + pytest 8.4.2 (Flask's lock; newest pytest breaks `tests/test_cli.py`); `.venv/` in `.git/info/exclude` so `git status` stays clean.
  - Video note: use **Forge: Undo Last Change** on camera (deterministic); Ctrl+Z also works on the buffer but leaves it unsaved.
  - **Todo for Aashwin:** press F5 once and eyeball the CodeLens / panel look before recording.
- [x] **4. Cancel + journal rollback.** Gate: Stop mid-run leaves `git status` clean.
  - Verified (`scripts/e2e.sh cancel`): Stop mid-stream in 24 ms, no reviews left, `git status` clean; accept first `cli.py` edit (`M src/flask/cli.py`), Stop at next review in 44 ms -> rolled back, `git status` clean.
  - Commands: read-only git auto-approved (`forge.autoApproveCommands`); the run_command handler itself refuses anything the user did not approve. Agent + subagent told to explore with search_code/read_file only.
- [x] **5. Retry/fallback (Task C).** Gate: invalid key, then auto fallback diff, then reject, then clean.
  - Verified (`scripts/e2e.sh taskC`): primary `anthropic/claude-haiku-5-5` (invalid key in TrueForge) -> 401, retry 1s, retry 3s, auto switch to `openai/gpt-5-4-mini`; diff in 8.7 s; `git status` clean before decision; both hunks rejected -> clean.
  - Video: since the Anthropic key really is invalid, record Task C by setting `forge.model` to the Anthropic model (shown in Settings) and `forge.fallbackModel` to gpt-5-4-mini. Show the TrueForge Models page with the bad key blurred.
- [x] **6. ContextEngine + receipt + scout instructions + run_command (Task B).** Gate: 3 of 3 rehearsals touch ≥3 files, pytest green, masked JSON, subagent visible in session.
  - Verified (`scripts/e2e.sh taskB`, runs 7–9 all pass, 61–139 s): CHANGES.rst, docs/cli.rst, src/flask/cli.py, tests/test_cli.py changed; 59 passed; `config` in `flask --help`; masked JSON; subagent thread; Undo run -> clean.
  - `src/context.ts`: tf-idf retrieval + link expansion (module -> tests -> docs -> changelog), 8k budget, 2,991 tok on Task B; Context Receipt in the panel (✓/✗, source, tokens, reason, meter, live "read" marks).
  - Fixed: approvals arriving via TrueForge's `call_tool` wrapper were not recognised (edits bypassed review; handler still refused to write). Now unwrapped, and unknown approvals fail closed.
  - Added: if a run applied edits but never ran pytest, Forge sends one follow-up turn in the same session asking for tests (run 1 had shipped a timedelta JSON bug untested).
  - Drafted early: `docs/writeup.md` (TODOs: team, video link, costs, timestamps), `docs/RECORDING.md` (shot list), `demo/demo_app.py`.
- [x] **7. Extras 1–3** (guard, badges, why-this-hunk), only if 1–6 pass. Then feature freeze.
  - Guard (step 2) and why-this-hunk (reason shown in the review CodeLens, step 3) were already in. Added `src/badges.ts`: Explorer badges 👁 read / ✎ proposed / ✓ applied for the current run.
  - Regression after the extras: taskA ok (diff 5.2 s, badge `applied`), taskC ok (fallback, diff 8.1 s, clean), cancel ok (30 ms / 72 ms, clean).
  - **Feature freeze.** From here on: video, write-up, submission only.
- [x] Small-model check (PRD §8.3): Task A passes on `openai/gpt-5-4-nano` (diff 3.1 s, 2 hunks, `False`, undo clean).
- [ ] **8. Record video** per PRD §4. Gate: every clause in PRD §2 visible.
- [ ] **9. Write-up PDF** per PRD §5, scorecard timestamps from the final cut.
  - [x] `docs/writeup.md` drafted, measured costs filled in. Left: team details, video URL, timestamps, then PDF.
- [ ] **10. Clean-clone README check, secrets grep, links public (incognito), submit form.**
  - [x] README rewritten (setup, agent-definition loading incl. tested manual `curl`, architecture, commands, tests).
  - [x] Fresh `git clone` -> `npm install && npm run build` OK; `agent/*.json`, LICENSE present.
  - [x] Secrets grep empty.
  - [ ] Repo public, video unlisted + incognito check, write-up PDF public, submit form (Aashwin).

## Notes

- The SDK is ESM-only. esbuild bundles it into the CJS extension fine; plain `require` from Node fails (use `import`).
- TrueForge 0.185.1 local. MCP servers are registered via `PUT /api/v1/settings/mcp-servers` (`{manifest:{type:"remote",name,url,description,auth:{type:"header",headers}}}`).
- Inline agent preloads its 4 tools (speed); agent mode uses deferred tool loading (B4, explained in write-up §3).
