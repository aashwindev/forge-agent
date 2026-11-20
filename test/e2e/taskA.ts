import * as vscode from 'vscode';
import * as path from 'path';
import { decideAll, finish, gitStatus, note, root, sh, sleep, state, until } from './common';

// Task A, exactly as in the brief: select get_debug_flag, give the instruction,
// review per hunk and accept, then verify on the command line, then undo.
const INSTRUCTION = "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.";

export async function run() {
  const res: Record<string, unknown> = {};
  let ok = false;
  try {
    if (process.env.FORGE_MODEL) await vscode.workspace.getConfiguration('ledgerforge').update('model', process.env.FORGE_MODEL, vscode.ConfigurationTarget.Global);
    note(`git status before: "${gitStatus()}"`);
    const doc = await vscode.workspace.openTextDocument(path.join(root(), 'src/flask/helpers.py'));
    const ed = await vscode.window.showTextDocument(doc);
    const lines = doc.getText().split('\n');
    const start = lines.findIndex(l => l.startsWith('def get_debug_flag'));
    const end = lines.findIndex((l, i) => i > start && l.includes('return bool(val'));
    ed.selection = new vscode.Selection(start, 0, end + 1, 0);
    note(`selected lines ${start + 1}-${end + 1}`);
    await until('extension connected', async () => (await state()) !== undefined, 30_000);

    const t0 = Date.now();
    await vscode.commands.executeCommand('ledgerforge.inlineEdit', INSTRUCTION);
    const s = await until('review to open', async () => { const x = await state(); return x.reviews.length ? x : undefined; });
    res.secondsToDiff = (Date.now() - t0) / 1000;
    res.hunks = s.reviews.map((r: any) => `${r.path}: ${r.state.length}`);
    note(`review open after ${res.secondsToDiff}s: ${res.hunks}`);
    note(`git status while reviewing (must be empty): "${gitStatus()}"`);
    res.cleanDuringReview = gitStatus() === '';
    await decideAll(() => 'accepted');
    await until('run to finish', async () => !(await state()).busy);
    await sleep(500);
    res.badges = (await state()).badges;

    const py = path.join(root(), '.venv/bin/python');
    const check = (v: string) => sh(py, ['-c', 'from flask.helpers import get_debug_flag; print(get_debug_flag())'], { FLASK_DEBUG: v });
    res.verify = Object.fromEntries(['off', 'OFF', 'n', 'N', 'no', '0', 'false', '1', 'yes'].map(v => [v, check(v)]));
    note(`FLASK_DEBUG=off -> ${check('off')}`);
    res.diff = sh('git', ['diff']);
    res.changedFiles = gitStatus();
    const falsy = ['off', 'OFF', 'n', 'N', 'no', '0', 'false'].every(v => (res.verify as any)[v] === 'False');
    const truthy = ['1', 'yes'].every(v => (res.verify as any)[v] === 'True');

    await vscode.commands.executeCommand('ledgerforge.undo');
    await sleep(800);
    res.statusAfterUndo = gitStatus();
    note(`git status after LedgerForge: Undo (must be empty): "${res.statusAfterUndo}"`);
    ok = falsy && truthy && res.cleanDuringReview === true && res.statusAfterUndo === '';
  } catch (e) {
    res.error = (e as Error).stack;
  }
  await finish('taskA', ok, res);
}
