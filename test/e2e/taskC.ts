import * as vscode from 'vscode';
import * as path from 'path';
import { decideAll, finish, gitStatus, note, root, sleep, state, until } from './common';

// Task C: the primary model's endpoint is unreachable (a local model server that is not running).
// Repeat Task A; LedgerForge must retry, fall back to the second model with no user action,
// leave the workspace untouched until review, and stay clean after every hunk is rejected.
const INSTRUCTION = "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.";
const BROKEN = process.env.FORGE_BROKEN_MODEL ?? 'local-ollama/qwen3-coder';
const FALLBACK = process.env.FORGE_FALLBACK_MODEL ?? 'openai/gpt-5-4-mini';

export async function run() {
  const res: Record<string, unknown> = {};
  let ok = false;
  try {
    const cfg = vscode.workspace.getConfiguration('ledgerforge');
    await cfg.update('model', BROKEN, vscode.ConfigurationTarget.Global);
    await cfg.update('fallbackModel', FALLBACK, vscode.ConfigurationTarget.Global);
    note(`primary ${BROKEN} (endpoint down), fallback ${FALLBACK}; git status before: "${gitStatus()}"`);

    const doc = await vscode.workspace.openTextDocument(path.join(root(), 'src/flask/helpers.py'));
    const ed = await vscode.window.showTextDocument(doc);
    const lines = doc.getText().split('\n');
    const start = lines.findIndex(l => l.startsWith('def get_debug_flag'));
    const end = lines.findIndex((l, i) => i > start && l.includes('return bool(val'));
    ed.selection = new vscode.Selection(start, 0, end + 1, 0);
    await until('extension connected', async () => (await state()) !== undefined, 30_000);

    const t0 = Date.now();
    await vscode.commands.executeCommand('ledgerforge.inlineEdit', INSTRUCTION);
    const s = await until('fallback review to open', async () => { const x = await state(); return x.reviews.length ? x : undefined; });
    res.secondsToDiff = (Date.now() - t0) / 1000;
    res.banners = s.transcript.filter((l: string) => l.startsWith('status['));
    res.cleanBeforeDecision = gitStatus() === '';
    note(`review open after ${res.secondsToDiff}s; git status before decision: "${gitStatus()}"`);

    await decideAll(() => 'rejected');
    await until('run to finish', async () => !(await state()).busy);
    await sleep(500);
    res.statusAfterReject = gitStatus();
    note(`git status after rejecting every hunk: "${res.statusAfterReject}"`);

    const b = (res.banners as string[]).join('\n');
    res.sawRetry = /retry|Retrying/.test(b);
    res.sawFallback = b.includes('Switching automatically to fallback model');
    ok = !!(res.sawRetry && res.sawFallback && res.cleanBeforeDecision && res.statusAfterReject === '');
  } catch (e) {
    res.error = (e as Error).stack;
  }
  await finish('taskC', ok, res);
}
