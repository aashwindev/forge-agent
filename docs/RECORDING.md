# Recording script (≤ 4:00)

Order is fixed: Intro → A → B → C → cancel → end card. Never cut between sending an instruction and the diff appearing. Cuts are only allowed between segments.

## Before you hit record

1. TrueForge running in its own terminal:
   ```
   OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]' npx @truefoundry/trueforge@latest
   ```
2. In `ledgerforge-agent`: `npm run build`, then **F5**. That opens the Flask clone in an Extension Development Host.
3. In that window, set the zoom to 125% (Cmd+= twice), use a high-contrast or clear theme, and close other tabs.
4. Open the LedgerForge panel (activity bar). It should say **Connected to TrueForge**.
5. Open a terminal in the Flask clone and run:
   ```
   source .venv/bin/activate && git log -1 --oneline && git status
   ```
   You should see `22d92470…` and a clean tree.
6. Settings: `ledgerforge.model` = `openai/gpt-5-4-mini`, `ledgerforge.fallbackModel` = `openai/gpt-5-4-nano` (the defaults, for A and B).
7. Have the TrueForge UI open in a browser tab (http://localhost:8790).

## 0:00 Intro (≈6 s)

Terminal: `git log -1 --oneline` → 22d92470, `git status` clean. Caption: *Flask 3.1.3 · TrueForge local*.

## 0:06 Task A: inline edit (≈50 s)

1. Open `src/flask/helpers.py` and select the whole `get_debug_flag` function.
2. Press **Cmd+Alt+K** and paste:
   ```
   Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.
   ```
3. The panel streams. The diff opens with **✓ Accept / ✗ Reject** above each hunk. Click ✓ on hunk 1, then ✓ on hunk 2.
4. Terminal:
   ```
   FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"
   ```
   → `False`
5. Command Palette → **LedgerForge: Undo Last Change** → `git status` → clean.

Caption: *A1 per-hunk accept · B2 undo*.

## 0:55 Task B: agent mode (≈1:45, cut model waits only)

1. Panel input, paste and **Send**:
   ```
   Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.
   ```
2. Show the **Context Receipt** filling in (budget meter, ✓/✗ rows with reasons) and the "↳ Subagent started" line.
3. While it works, click into any editor and type a few characters, then undo them. This shows the editor never blocks.
4. Each review opens. Accept every hunk (✓, or the ✓✓ icon in the editor title).
5. If a popup asks to run `pytest`, click **Allow for this run**.
6. Wait for **Done**. Then in the terminal:
   ```
   pytest tests/test_cli.py -q
   flask --help | grep config
   flask --app ../ledgerforge/demo/demo_app.py config
   git status
   ```
   Expect: passed; `config` listed; JSON with `"***"` for the fake secrets; 4 modified files.
7. Browser: TrueForge → Sessions → the newest session. Scroll past the turns, the `ledgerforge-editor` tool calls, the approval events and the subagent thread.
8. Back in VS Code: **LedgerForge: Undo Last Run** → `git status` → clean.

Caption: *A2 4 files unprompted · B1 receipt · B4 TrueForge session · B2 undo run*.

## 2:40 Task C: model failure (≈50 s)

1. Show TrueForge Settings → Models with the **local-ollama** provider (`http://127.0.0.1:11434/v1`). Its local server is not running, so the endpoint is unreachable. Your OpenAI key never needs to be on screen.
2. VS Code settings: `ledgerforge.model` = `local-ollama/qwen3-coder`, `ledgerforge.fallbackModel` = `openai/gpt-5-4-mini`.
3. Repeat Task A exactly (select `get_debug_flag`, Cmd+Alt+K, same instruction).
4. The banner shows `model endpoint unreachable (ECONNREFUSED 127.0.0.1:11434). Retrying in 1s…`, then `retry 2/2`, then `Switching automatically to fallback model openai/gpt-5-4-mini in the same TrueForge session`. Don't click anything, and type in the editor meanwhile.
5. The diff appears. Terminal: `git status` → clean (nothing written yet).
6. Click **✗** on each hunk. `git status` → clean.

Caption: *B3 automatic fallback, workspace unchanged · A1 per-hunk reject*.

## 3:30 Cancel proof (≈20 s)

1. Set `ledgerforge.model` back to `openai/gpt-5-4-mini`.
2. Send Task B again. When the first review opens, accept it, and when the next one opens, press **■ Stop**.
3. The banner shows `Stopped. Rolled back src/flask/cli.py. Workspace clean ✓`. Terminal: `git status` → clean.

Caption: *A3 immediate cancel, consistent workspace*.

## 3:50 End card

Show the repo link https://github.com/aashwindev/ledgerforge and the line *Every change reviewed, every choice explained, every failure survived.*

## After recording

Upload to YouTube as **Unlisted**, check that it opens in an incognito window, and send me the link plus the timestamp where each segment starts. I'll fill in the scorecard.
