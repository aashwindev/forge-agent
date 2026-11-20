import * as vscode from 'vscode';
import * as fs from 'fs';
import { execFileSync } from 'child_process';

export const root = () => vscode.workspace.workspaceFolders![0].uri.fsPath;
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const state = () => vscode.commands.executeCommand<any>('forge._state');
export const log: string[] = [];
export const note = (s: string) => { log.push(`${new Date().toISOString().slice(11, 19)} ${s}`); };

export async function until<T>(what: string, f: () => Promise<T | undefined | false>, ms = 180_000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await f().catch(() => undefined);
    if (v) return v as T;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what}`);
}

export function sh(cmd: string, args: string[], env: Record<string, string> = {}): string {
  try {
    return execFileSync(cmd, args, { cwd: root(), env: { ...process.env, ...env }, encoding: 'utf8' }).trim();
  } catch (e: any) {
    return `[exit ${e.status}] ${(e.stdout ?? '') + (e.stderr ?? '')}`.trim();
  }
}

export const gitStatus = () => sh('git', ['status', '--porcelain']);

/** Accept (or reject) every pending hunk, one at a time, exactly as clicking the CodeLens does. */
export async function decideAll(decide: (path: string, i: number) => 'accepted' | 'rejected') {
  const s = await state();
  for (const r of s.reviews) {
    for (let i = 0; i < r.state.length; i++) {
      if (r.state[i] !== 'pending') continue;
      const d = decide(r.path, i);
      note(`${d === 'accepted' ? 'accept' : 'reject'} ${r.path} hunk ${i + 1}/${r.state.length}`);
      await vscode.commands.executeCommand('forge.hunk', r.uri, i, d);
      await sleep(300);
    }
  }
}

export async function finish(name: string, ok: boolean, extra: Record<string, unknown> = {}) {
  extra.transcript = (await state().catch(() => ({})))?.transcript;
  const out = process.env.FORGE_E2E_OUT ?? `/tmp/forge-e2e-${name}.json`;
  fs.writeFileSync(out, JSON.stringify({ name, ok, log, ...extra }, null, 2));
}
