import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { decideAll, finish, gitStatus, note, root, sh, sleep, state, until } from './common';

// Task B, exactly as in the brief, sent from the panel with no file names.
// Accept every hunk as reviews arrive, then verify like the video does, then Undo run.
const INSTRUCTION = `Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.`;

export async function run() {
  const res: Record<string, unknown> = {};
  let ok = false;
  try {
    note(`git status before: "${gitStatus()}"`);
    await until('extension connected', async () => (await state()) !== undefined, 30_000);
    const t0 = Date.now();
    await vscode.commands.executeCommand('forge._send', INSTRUCTION);
    await until('run to start', async () => (await state()).busy, 30_000);
    let reviews = 0;
    await until('run to finish', async () => {
      const s = await state();
      if (s.reviews.some((r: any) => r.state.includes('pending'))) { reviews++; await decideAll(() => 'accepted'); }
      return !s.busy;
    }, 9 * 60_000);
    res.seconds = (Date.now() - t0) / 1000;
    res.reviewRounds = reviews;
    await sleep(500);

    const status = gitStatus();
    res.changed = status.split('\n').filter(Boolean);
    note(`changed after run: ${JSON.stringify(res.changed)}`);
    const bin = (b: string) => path.join(root(), '.venv/bin', b);
    res.pytest = sh(bin('pytest'), ['tests/test_cli.py', '-q', '-p', 'no:cacheprovider']).split('\n').slice(-3).join('\n');
    const help = sh(bin('flask'), ['--help']);
    res.inHelp = /^\s+config\b/m.test(help);
    const demo = path.join(os.tmpdir(), 'forge_demo_app.py');
    fs.writeFileSync(demo, 'from flask import Flask\napp = Flask(__name__)\napp.config.update(SECRET_KEY="s3cr3t", DB_PASSWORD="hunter2", API_TOKEN="t0k", GREETING="hello")\n');
    res.configOutput = sh(bin('flask'), ['--app', demo, 'config']);
    note(`flask config -> ${String(res.configOutput).slice(0, 300)}`);
    const out = String(res.configOutput);
    const masked = !/s3cr3t|hunter2|t0k/.test(out) && out.includes('"***"') && out.includes('hello');
    res.masked = masked;
    const tr: string[] = (await state()).transcript;
    res.subagent = tr.some(l => l.startsWith('subagent: Subagent started'));
    res.receipt = tr.find(l => l.startsWith('receipt:'));

    await vscode.commands.executeCommand('forge.undoRun');
    await sleep(1000);
    res.statusAfterUndo = gitStatus();
    note(`git status after Undo run: "${res.statusAfterUndo}"`);
    ok = (res.changed as string[]).length >= 3 && /passed/.test(String(res.pytest)) && !/failed|error/i.test(String(res.pytest))
      && res.inHelp === true && masked && res.statusAfterUndo === '';
  } catch (e) {
    res.error = (e as Error).stack;
  }
  await finish('taskB', ok, res);
}
