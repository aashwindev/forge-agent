import * as vscode from 'vscode';
import { decideAll, finish, gitStatus, note, sleep, state, until } from './common';

const TASK_B = 'Add a new built-in CLI command flask config that prints the loaded application\'s configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.';

async function stopAndMeasure(label: string, res: Record<string, unknown>) {
  const t0 = Date.now();
  await vscode.commands.executeCommand('ledgerforge.stop');
  await until('run to stop', async () => !(await state()).busy, 15_000);
  const ms = Date.now() - t0;
  const s = await state();
  res[`${label}.stopMs`] = ms;
  res[`${label}.openReviews`] = s.reviews.length;
  res[`${label}.gitStatus`] = gitStatus();
  note(`${label}: stopped in ${ms} ms; open reviews ${s.reviews.length}; git status "${res[`${label}.gitStatus`]}"`);
  return ms < 3000 && s.reviews.length === 0 && res[`${label}.gitStatus`] === '';
}

export async function run() {
  const res: Record<string, unknown> = {};
  let ok = false;
  try {
    await until('extension connected', async () => (await state()) !== undefined, 30_000);
    note(`git status before: "${gitStatus()}"`);

    // 1. Stop mid-stream, before any proposal.
    await vscode.commands.executeCommand('ledgerforge._send', TASK_B);
    await until('run to start', async () => (await state()).busy, 30_000);
    await sleep(4000);
    const a = await stopAndMeasure('midStream', res);

    // 2. Accept the first edit (it is written to disk), then stop at the next review: must roll back.
    await vscode.commands.executeCommand('ledgerforge._send', TASK_B);
    await until('first review', async () => (await state()).reviews.length > 0, 240_000);
    // A batch opens its review tabs one by one: keep accepting until nothing is pending.
    await until('first batch accepted', async () => { await decideAll(() => 'accepted'); await sleep(700); const s = await state(); return !s.reviews.some((r: any) => r.state.includes('pending')); }, 60_000).catch(() => undefined);
    const applied = await until('first edit written', async () => gitStatus() || undefined, 60_000).catch(() => '');
    res['afterAccept.gitStatus'] = applied;
    note(`after accepting first edit, git status: "${applied}"`);
    await until('next review or idle', async () => { const s = await state(); return s.reviews.length > 0 || !s.busy; }, 240_000).catch(() => true);
    const b = await stopAndMeasure('afterApply', res);
    ok = a && b && applied !== '';
  } catch (e) {
    res.error = (e as Error).stack;
  }
  await finish('cancel', ok, res);
}
