# PRD: LedgerForge, Forge-a-thon Round 1 submission

**Repo:** https://github.com/aashwindev/ledgerforge · **Deadline:** 20 Nov 2026, 23:59 IST. Submit as early as possible: ties break on B, then A, then **earlier submission time**.
**Pitch:** *"Every change reviewed, every choice explained, every failure survived."*

## What our project does (plain English)

**LedgerForge** is an AI coding assistant inside VS Code, like a small Cursor, whose "thinking loop" runs on TrueForge, not on code we wrote.

- **Fix a selected function.** Select code, press **Ctrl/Cmd+Alt+K**, type what you want in plain English. The proposed change appears **inside the editor** as red/green lines, split into hunks, each with its own **✓ Accept / ✗ Reject** button. Nothing is saved until you accept.
- **Build a feature across the repo.** Type one request in the LedgerForge panel without naming any files. The agent searches the repo, finds the right files itself (in Flask: the CLI code, its tests, its docs, the changelog), proposes edits to all of them, runs the tests, and waits for you to review every hunk.
- **Shows its homework.** A **Context Receipt** lists every file the agent looked at, why it picked it, how many tokens it used out of a fixed budget (e.g. `5.9k / 8k`), and which files it **left out and why**. File badges in the Explorer light up live: 👁 read, ✎ proposed, ✓ applied.
- **Safe by construction.** The agent can only *propose* edits. TrueForge pauses for approval, and only the hunks you accept get written. A guard rejects any edit to code that doesn't exist or that breaks Python syntax. Ctrl+Z, or **LedgerForge: Undo run**, reverts applied changes.
- **Stop anytime.** Press Stop and it halts at once. Pending proposals vanish, and anything this run wrote is rolled back. `git status` stays clean.
- **Survives model failure.** If the main AI model fails (bad key, server down), it retries, then **automatically switches to a second model**. You see a clear banner, and your files are never touched by the failure.
- **Bonus:** LedgerForge: Doctor (one-click health check), "Why this hunk?" notes on every change, and a one-click PR-ready summary of what changed and why.

How it is wired: VS Code extension ↔ TrueForge (local, runs the loop and calls the model) ↔ our **editor MCP server** inside the extension (read, search, propose edit, run command). The model is configured only inside TrueForge. The extension never talks to a model provider.

---

## 1. Rule compliance audit (every rule in the PDF)

| PDF rule | How we comply | Status |
|---|---|---|
| Agent loop runs on TrueForge; extension is a TrueForge client creating sessions/turns via SDK and rendering streamed events | `@truefoundry/trueforge-sdk` only; panel renders `model.message.delta` etc. | ✅ |
| Editor capabilities (read file, search workspace, propose write, run command) exposed as **MCP tools**, agent decides | `read_file`, `search_code`, `find_symbol`, `propose_edit`, `run_command` on our MCP server, registered in TrueForge | ✅ |
| TrueForge in local mode (`npx @truefoundry/trueforge@latest`); sandbox optional | Local mode; no sandbox used | ✅ |
| Model configured in TrueForge (catalog or OpenAI-compatible); **extension never calls a provider** | Model names are settings; Doctor's model checks run as TrueForge sessions, never direct HTTP to a provider | ✅ |
| Must work with any configured model; no provider dependency; no hard-coded provider | No provider-specific code; model names chosen from TrueForge's model list; inline degraded mode for models without tool calling (disclosed) | ✅ |
| Video briefly shows TrueForge session for Task B (turns + tool calls); repo contains agent definition | Session shot inside the Task B segment; `agent/ledgerforge-agent.json`, `agent/ledgerforge-inline.json` committed | ✅ |
| Declare every model, where it ran, rough cost | Write-up §5 | ✅ |
| No API keys committed; ship example config | Keys only in TrueForge UI; `ledgerforge.config.example.json`; `git grep` check before submit | ✅ |
| Fork point declared or "from scratch"; upstream licence preserved; delta described | From scratch, no upstream; MIT LICENSE; npm deps credited in §7 | ✅ |
| Out of scope (tab completion, training/hosting models, hosted backend/DB, auth, Marketplace) | None built. MCP server is in-process on 127.0.0.1; journal is in memory | ✅ |
| Inline edit: select → keybinding → plain-language instruction → diff in editor, accept/reject; not copy-paste | Inline decorations + per-hunk CodeLens | ✅ |
| Agent mode: tool loop (read, search, write, run command) until done/gives up; ≥3 files not named by user | Webview panel; agent discovers 4 files in Flask | ✅ |
| Context assembly: @file, @symbol, plus automatic retrieval; use TrueForge context features | Both mentions + hybrid auto-retrieval + scout subagent + deferred tools | ✅ |
| Diff review: hunk by hunk, visible preview, per-hunk accept/reject, no silent writes, applied change undoable | Approval-gated `propose_edit`; per-hunk; Ctrl+Z + Undo run | ✅ |
| Streaming + cancellation: tokens via TrueForge streaming events, interrupt mid-flight, editor never blocks, cancelled run consistent | Deltas rendered live; Stop = `sessions.cancel` + discard + journal rollback | ✅ |
| Repo pinned: pallets/flask 3.1.3 (22d92470) | Rehearsal clone at 22d92470; `git log -1` on camera | ✅ |
| Exact task wording | Wording pasted verbatim from the PDF (in §4) | ✅ |
| Video ≤ 4 min, editor visible, A → B → C in order, each followed by verification; may cut model wait, **not** between instruction and diff; public link | Storyboard §4 at ~3:55; extra proof only *after* C; YouTube unlisted | ✅ |
| Write-up PDF 1–3 pages, 8 headings in order | §5 template with the exact headings | ✅ |
| GitHub public; README setup from clean clone incl. starting TrueForge and loading the agent definition; example model config; LICENSE; no secrets | README: `npx`, LedgerForge: Doctor auto-loads agents, plus a manual `curl` fallback to load `agent/*.json` | ✅ |
| Rule 4: declare AI coding tools | Write-up §7 | ✅ |
| Rule 6: no employer/private code | Own work only | ✅ |
| Rule 7: public under an open-source licence | MIT | ✅ |
| Rule 12: no copying other teams | We read only README summaries; no code reused | ✅ |
| Shortlist call: explain own code; repeat Task A live with organisers' model | Every member can walk through `ARCHITECTURE.md`; Task A rehearsed on a small model; Doctor for setup | ✅ |

---

## 2. Full-marks proof for every criterion

Each row quotes the **top anchor exactly**, then the on-screen proof that meets **every clause** of it (between anchors, the lower one applies, so no clause can be missing).

| Row | Top anchor (verbatim) | Clause-by-clause proof on screen | Build requirement | Risk → mitigation |
|---|---|---|---|---|
| **A1 Inline (10/10)** | "diff rendered with per-hunk accept and reject" | *diff rendered*: red/green inline in `helpers.py` (Task A). *per-hunk accept*: click ✓ on hunk 1 (code) then ✓ on hunk 2 (docstring). *per-hunk reject*: Task C fallback diff, click ✗ on each hunk individually | Decorations + CodeLens per hunk | The model emits one big hunk → hunks are computed by us from the diff, so code and docstring split naturally; rehearse |
| **A2 Agent (10/10)** | "discovers and edits three or more files unprompted (Task B)" | Instruction names no files; receipt + badges show discovery; review set lists `src/flask/cli.py`, `tests/test_cli.py`, `docs/cli.rst`, `CHANGES.rst`; `git status` shows 4 modified files | Panel, tool loop, link-expansion retrieval | The agent misses docs/test → retrieval adds code→tests→docs links before turn 1; instructions require tests + docs; rehearse ×3 |
| **A3 Stream/cancel (10/10)** | "cancellation is immediate and the workspace stays consistent" | Tokens stream in Task A. Typing in the editor during Task B generation (never blocks). Final segment: Stop mid-run while proposals are pending → stream halts in < 1 s, proposals disappear, `git status` clean | `sessions.cancel` + abort + deny pending + journal rollback | Cancel lag → abort the client stream first, then cancel the server |
| **B1 Context (15/15)** | "retrieval with a size budget, strategy stated, and visibly at work in Task B (the agent shows which files it chose and why)" | *size budget*: live meter `x / 8k`. *strategy stated*: write-up §4. *visibly at work in Task B*: receipt fills during Task B. *chose and why*: each row has a reason, including the scout subagent's own stated reasons; excluded files listed with reasons | ContextEngine + receipt from event stream | Receipt looks fake → it is built only from real tool calls/events |
| **B2 Diff safety (10/10)** | "per-hunk review and a working undo of an applied change, shown on screen" | Per-hunk review in A and B. *Undo shown*: after Task A verification, Ctrl+Z → `helpers.py` restored, `git status` clean; after Task B verification, LedgerForge: Undo run → all 4 files restored, `git status` clean | WorkspaceEdit (native undo) + run journal | Ctrl+Z after save → the journal-based Undo run is the guaranteed path |
| **B3 Resilience (10/10)** | "automatic fallback to a second configured model with no user action, workspace unchanged" | TrueForge Settings shows the primary key replaced with an invalid one (blurred); repeat Task A; banner `401 → retry 1/2 → retry 2/2 → switched to <model 2>`, no clicks; typing during retry; `git status` clean **before** decision; reject hunks; `git status` clean | Retry/backoff + fallback session with the same input | Fallback model also misconfigured → Doctor checks both before recording |
| **B4 TrueForge (10/10)** | "editor capabilities exposed as MCP tools, with TrueForge tool approval driving the diff review · also makes meaningful use of at least one context-engineering feature… explained in the write-up and visible in the session" | *MCP tools*: TrueForge session shows `ledgerforge-editor` tool calls. *approval drives review*: session shows `propose_edit` approval events matching our clicks. *context feature visible in session*: scout subagent thread + deferred tool discovery calls in the session shot. *explained*: write-up §3 | `require_approval_for_tools`, subagents on, preload false | Model doesn't spawn a subagent → instructions require it; rehearse; deferred tool discovery is a second visible feature as backup |
| **C1 Video (10/10)** | "all three complete, legible, and visibly verified on screen" | A, B, C strictly in order, each ending with its exact verification command; 125% zoom, high-contrast theme, captions naming rubric rows | Storyboard §4 | Over 4:00 → trim between tasks only, never between instruction and diff |
| **C2 Write-up (15/15)** | "also carries an accurate scorecard with timestamps and an honest limitations section" (on top of architecture, context strategy, model setup and trade-offs) | 8 exact headings; diagram; numbers; scorecard: 9 rows (A1…C2), timestamps taken from the **final** cut; honest limitations | §5 template | Timestamps drift → fill §6 last, from the uploaded video |

**Expected total: 100/100.** The remaining risk sits in live model behaviour (A2, B4 subagent), and the rehearsal gates in §6 cover it.

**Against the field (43 repos):** the standard design is common. Our decisive edges: excluded-with-reasons + a budget meter + code→tests→docs expansion (B1); TrueForge approval as *the* review mechanism, with a subagent visible in the session (B4; most teams stage edits outside approval); cancel that also rolls back applied hunks (A3); an inline mode that works on any model, for the live re-run; and a video and write-up judges can score at a glance (C1/C2, the field's usual weak spot).

---

## 3. Product spec

### 3.1 Architecture
```
VS Code extension (TS)
 ├─ ForgeClient       TrueForge SDK: sessions, turns, approvals, cancel, retry/fallback   (only network peer)
 ├─ Editor MCP server 127.0.0.1:<random>, Streamable HTTP, per-launch bearer token
 ├─ ContextEngine     in-memory index: symbols + BM25 function chunks + code→tests→docs links
 ├─ ReviewController  hunks, inline decorations, CodeLens, run journal, undo
 └─ Webview panel     streaming chat, Context Receipt, status/fallback banner
TrueForge local :8790 runs the loop, calls models, calls our MCP server
```
Activation (also **LedgerForge: Doctor**): start the MCP server → register `ledgerforge-editor` in TrueForge (`PUT /settings/mcp-servers`, header auth) → upsert `agent/*.json` via the agents API → check that both models answer via tiny TrueForge sessions → probe tool calling.

**Agent definitions:** `ledgerforge-agent` (panel) and `ledgerforge-inline` (inline). `require_approval_for_tools: ["propose_edit","run_command"]`, subagents on, compaction on, `preload: false`. Primary/fallback model names come from the `ledgerforge.model` / `ledgerforge.fallbackModel` settings. The instructions require: delegate exploration to a scout subagent, cover tests and docs, call `propose_edit` only after reading the target.

### 3.2 MCP tools
| Tool | Behaviour | Limits |
|---|---|---|
| `search_code(query)` | hybrid-ranked hits with reason + snippet | ≤ 12 hits, ≤ 1.5k tokens |
| `find_symbol(name)` | definitions + references | ≤ 20 refs |
| `read_file(path, start?, end?)` | reads the editor buffer | ≤ 400 lines/call, charged to budget |
| `propose_edit(path, old_text, new_text, reason)` | never writes; guard: `old_text` occurs exactly once, Python parses after the change; on failure returns an error to the agent | approval-gated |
| `run_command(cmd, args)` | no shell; allowlist `pytest`, `python`, `flask`, `git status/diff`; cwd = workspace; 120 s timeout | approval-gated, "allow for session" offered |

### 3.3 Review flow (TrueForge approval drives it)
`tool.approval_required` → read call args from the event index → compute hunks (`diff` npm) → render the review set (all pending files) → per-hunk decisions keyed by an args hash. ≥1 accepted → `user.tool_approval allow` → TrueForge calls our `propose_edit` → we apply **only accepted hunks** (WorkspaceEdit + save, pre-image to the journal) and return `applied [1,3], rejected [2]: <reason>` to the agent. All rejected → `deny` with reason. Resume via `subscribeToTurn`.

### 3.4 Context strategy (write-up §4)
1. **Auto-retrieval before turn 1, model-independent:** split identifiers in the instruction → score = BM25 over function-level chunks + symbol-name match + **link expansion** (module → `tests/test_<module>.py` → `.rst` docs that mention its symbols → changelog).
2. **8k-token budget packing:** outlines and signatures for every pick, full bodies for the top 3; the rest listed as excluded with reasons.
3. **@file / @symbol** pinned first, charged to the budget.
4. **Scout subagent** (TrueForge thread) expands with tools and returns ranked files + reasons; the root never sees raw dumps. Compaction stays on for long runs.
5. **Receipt row:** `file · source (auto | @mention | scout | read) · reason · tokens · included/excluded` + budget meter.

### 3.5 Cancel and resilience
- **Stop:** abort the client stream → `sessions.cancel()` → deny pending approvals, drop proposals → roll back this run's applied hunks from the journal → `git status --porcelain` shown as `Workspace clean ✓`.
- **Fallback:** turn `error`, or no first event within 20 s → retry the primary with backoff 1 s / 3 s (banner) → automatically open a new session on the fallback model with the same input + context pack → banner names both models and the error. TrueForge down → message with the exact `npx` command. Both models down → clear error; workspace unchanged.
- **Degraded inline mode:** if the tool-call probe fails, inline uses a TrueForge structured-output turn and the extension builds the hunks. Disclosed in the write-up; not used in the video.

### 3.6 Extras (beyond the rubric, built after the core passes)
1. Hallucination guard (in `propose_edit`), answering the brief's own complaint about "confidently edits a symbol that does not exist".
2. Explorer footprint badges (👁 ✎ ✓).
3. "Why this hunk?": the agent's reason shown above each hunk.
4. LedgerForge: Doctor health panel.
5. Copy change summary (PR-ready markdown with receipt, tests and session link).
6. Open in TrueForge link for the current run.

Not building (risk or zero points): Code Mode/skills (need a sandbox), own model proxy (eligibility risk), forks, parallel strategies.

---

## 4. Video storyboard (≤ 4:00)
Exact instructions, pasted verbatim:
- **A:** `Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.`
- **B:** `Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.`

| ~Time | Segment | Shots | Caption |
|---|---|---|---|
| 0:00–0:06 | Intro | `git log -1` = 22d92470, `git status` clean, TrueForge running | Flask 3.1.3 · TrueForge local |
| 0:06–0:55 | **Task A** | open `src/flask/helpers.py`, select `get_debug_flag`, Ctrl+Alt+K, paste A; tokens stream; 2 hunks inline; ✓ each; terminal `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` → `False`; Ctrl+Z → restored, `git status` clean | A1 · B2 undo |
| 0:55–2:40 | **Task B** | panel, paste B; receipt + budget fill, scout thread, badges; typing in the editor meanwhile; review set of 4 files, ✓ all hunks; agent runs pytest (approve); terminal `pytest tests/test_cli.py -q` passes; `flask --help` shows `config`; `flask --app <demo app> config` → masked JSON; `git status` shows ≥3 files; **TrueForge session** (turns, tool calls, approvals, subagent); LedgerForge: Undo run → `git status` clean | A2 · B1 · B4 · B2 |
| 2:40–3:30 | **Task C** | TrueForge Settings: primary key invalid (blurred); repeat Task A; banner retry → fallback, no clicks, typing meanwhile; diff appears; `git status` clean; ✗ each hunk; `git status` clean | B3 · A1 reject |
| 3:30–3:50 | Cancel proof | start Task B again, Stop mid-run with proposals pending → halts, proposals cleared, `git status` clean | A3 |
| 3:50–3:58 | End card | repo link, "every change reviewed, every choice explained, every failure survived" | — |

Rules: no cut between instruction and diff (pick the fastest model that passes rehearsal; any speed-up is labelled). Key always blurred. Record each segment 2–3×.

## 5. Write-up template (≤ 3 pages, these exact headings in order)
1. **Team**: members, college or employer, GitHub handles.
2. **Starting point**: "From scratch (no upstream fork)."
3. **Architecture on TrueForge**: diagram 3.1; SDK sessions/turns/streaming; MCP tool table; approval-driven review; subagents + deferred tools + compaction and why; why not Code Mode/skills (sandbox).
4. **How context is selected**: 3.4 with numbers (8k budget, top-3 bodies, ≤12 hits, link expansion) and trade-offs.
5. **Model setup**: primary + fallback, where they ran, cost per task run and total; how to switch (TrueForge Settings → Models + `ledgerforge.model`/`ledgerforge.fallbackModel`).
6. **Scorecard**: 9 rows A1–C2: timestamp + one-line claim, taken from the final video.
7. **Tools used**: VS Code API, TrueForge + SDK, `@modelcontextprotocol/sdk`, `diff`, esbuild; AI assistant: Claude Code (Opus 5.5).
8. **Known limitations and what we would do with another month**: Python-only syntax guard, BM25 not embeddings, fallback opens a new session, degraded inline mode bypasses approval; next: tree-sitter multi-language, embeddings, a TrueForge PR for native model fallback.

## 6. Build order (each step has a gate; commit + push after each, no AI attribution)
1. **Unblock:** a working primary + fallback model in TrueForge; LedgerForge: Ask streams. *Gate: reply streams.*
2. **MCP server + tools + registration + agent upsert + basic Doctor.** *Gate: TrueForge session shows `read_file` called on our server.*
3. **Approval-driven review + inline edit (Task A) + undo.** *Gate: `False` printed; Ctrl+Z restores; `git status` clean.*
4. **Cancel + journal rollback.** *Gate: Stop mid-run → `git status` clean.*
5. **Retry/fallback (Task C).** *Gate: invalid key → auto fallback diff → reject → clean.*
6. **ContextEngine + receipt + scout instructions + run_command (Task B).** *Gate: 3 of 3 rehearsals touch ≥3 files, pytest green, masked JSON, subagent visible in session.*
7. **Extras 1–3** only if gates 1–6 pass. Then **feature freeze**.
8. **Record video** per §4. *Gate: watch against §2, every clause visible.*
9. **Write-up PDF** per §5; scorecard timestamps from the final cut.
10. **Clean-clone README check, secrets grep, make links public (incognito), submit form.**

**Cut order if late:** extras → @symbol → degraded inline mode → Undo run (keep Ctrl+Z). **Never cut:** anything in §2.

**Rehearsal setup:** venv in the Flask clone with `pip install -e .` plus test deps; check that `python -c "import flask; print(flask.__file__)"` points to `src/` (otherwise Task A verifies the wrong Flask); `git status` clean before every take; test Task A once on a small model to simulate the live re-run.

## 7. Files
`src/extension.ts` (reuses Milestone 0's session/stream code), `src/forgeClient.ts`, `src/mcpServer.ts`, `src/tools/*`, `src/context/engine.ts`, `src/review/*`, `src/panel/*`, `agent/ledgerforge-agent.json`, `agent/ledgerforge-inline.json`, `ledgerforge.config.example.json`, `README.md`, `ARCHITECTURE.md`, `docs/writeup.md` → PDF, `docs/PRD.md` (this file).

## 8. Final verification before submit
1. Fresh clone → `npm i && npm run build` → F5 → Doctor all green.
2. Tasks A, B, C and cancel each pass end to end per §2 on the recording model.
3. Task A passes on a second, smaller model.
4. `git grep -iE "sk-|api[_-]?key\s*[:=]"` empty; LICENSE present; agent JSON present.
5. Video ≤ 4:00, unlisted, opens in incognito; PDF ≤ 3 pages, public; repo public.

## 9. Needed from the team
Working primary + fallback model keys (entered in the TrueForge UI only) · TrueForge running · names, colleges, GitHub handles · Techfest Team ID.
