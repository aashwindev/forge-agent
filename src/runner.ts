import * as vscode from 'vscode';
import { AgentKind, Decision, ForgeClient, PendingCall, TurnResult, loadAgentDef } from './forge';
import { ReviewController, ReviewItem, editKey } from './review';
import { EditArgs, runCommand, validateEdit } from './tools';
import { Workspace } from './workspace';

// One run = one user request. Owns cancellation, retry/fallback and rollback,
// so a stopped or failed run never leaves half-applied edits behind.

export interface RunUI {
  begin(label: string): void;
  text(delta: string): void;
  log(kind: 'tool' | 'read' | 'guard' | 'subagent' | 'info' | 'session', text: string): void;
  status(text: string, tone: 'info' | 'warn' | 'error' | 'ok'): void;
  end(): void;
}

const BACKOFF_MS = [1000, 3000];
const FIRST_EVENT_TIMEOUT_MS = 20_000;

export class Runner {
  private active?: { abort: AbortController; sessionId?: string; attemptId: string; runId: string; allowCommands: boolean; approved: Set<string> };
  private seq = 0;

  constructor(
    private forge: ForgeClient,
    private ws: Workspace,
    private review: ReviewController,
    private agentDir: string,
    private ui: RunUI,
  ) {}

  get busy() { return !!this.active; }
  get attemptId() { return this.active?.attemptId ?? 'none'; }

  /** Checked by the run_command MCP handler: only commands the user approved in this run (or read-only ones) execute. */
  commandAllowed(line: string): boolean {
    if (isAutoApproved(line)) return true;
    const a = this.active;
    return !!a && (a.allowCommands || a.approved.delete(line));
  }

  async start(kind: AgentKind, message: string, label: string): Promise<void> {
    if (this.active) { vscode.window.showWarningMessage('Forge is already running. Press Stop first.'); return; }
    const cfg = vscode.workspace.getConfiguration('forge');
    const models = [cfg.get<string>('model'), cfg.get<string>('fallbackModel')].filter((m): m is string => !!m && !m.startsWith('<'));
    const runId = `run-${++this.seq}`;
    const abort = new AbortController();
    this.active = { abort, runId, attemptId: runId, allowCommands: false, approved: new Set() };
    this.ui.begin(label);

    try {
      for (let m = 0; m < models.length; m++) {
        const model = models[m];
        const spec = loadAgentDef(this.agentDir, kind, model).manifest;
        const tries = m === 0 ? BACKOFF_MS.length + 1 : 1;
        for (let t = 0; t < tries; t++) {
          if (abort.signal.aborted) return;
          this.active.attemptId = `${runId}#${m}.${t}`;
          this.ui.status(`${model}${t ? ` (retry ${t}/${BACKOFF_MS.length})` : ''}: working…`, 'info');
          const r = await this.attempt(spec, message, abort.signal);
          if (abort.signal.aborted || r.status === 'cancelled') return;
          if (r.status === 'done') {
            this.ui.status(`Done on ${model}${m ? ' (fallback)' : ''}.`, 'ok');
            return;
          }
          // Failed attempt: roll back anything it wrote, so retries start clean.
          await this.review.discardAll();
          const undone = await this.review.undo(this.active.attemptId);
          const why = shortError(r.error);
          if (t < tries - 1) {
            this.ui.status(`${model} failed: ${why}. Retrying in ${BACKOFF_MS[t] / 1000}s…${undone.length ? ` (rolled back ${undone.length} file(s))` : ''}`, 'warn');
            await sleep(BACKOFF_MS[t], abort.signal);
          } else if (m < models.length - 1) {
            this.ui.status(`${model} failed: ${why}. Switching automatically to fallback model ${models[m + 1]}.`, 'warn');
          } else {
            this.ui.status(`All configured models failed (last: ${why}). No files were changed. Check TrueForge Settings → Models.`, 'error');
          }
        }
      }
      if (!models.length) this.ui.status('No model configured. Set forge.model in Settings.', 'error');
    } finally {
      this.active = undefined;
      this.ui.end();
    }
  }

  /** Stop: abort the stream, cancel the TrueForge turn, drop proposals, roll back this run's writes. */
  async stop(): Promise<void> {
    const a = this.active;
    if (!a) return;
    a.abort.abort();
    if (a.sessionId) void this.forge.cancel(a.sessionId);
    await this.review.discardAll();
    const undone = await this.review.undo(a.runId, true);
    const clean = (await runCommand(this.ws, 'git', ['status', '--porcelain'])).split('\n').slice(2).join('').trim() === '';
    this.ui.status(`Stopped.${undone.length ? ` Rolled back ${undone.join(', ')}.` : ' Nothing was written.'}${clean ? ' Workspace clean ✓ (git status)' : ''}`, 'ok');
  }

  private async attempt(spec: any, message: string, signal: AbortSignal): Promise<TurnResult> {
    // Per-attempt controller so a stalled model can be abandoned without stopping the run.
    const own = new AbortController();
    const onAbort = () => own.abort();
    signal.addEventListener('abort', onAbort);
    let sawEvent = false;
    const stall = setTimeout(() => { if (!sawEvent) own.abort(); }, FIRST_EVENT_TIMEOUT_MS);
    try {
      const r = await this.forge.runTurn(spec, message, {
        onText: (d, thread) => { if (thread === 'main') this.ui.text(d); },
        onEvent: e => {
          if (e.type === 'turn.created') { sawEvent = true; this.ui.log('session', `TrueForge session ${this.active?.sessionId ?? ''}`); }
          if (e.type === 'model.message.delta') sawEvent = true;
          if (e.type === 'thread.created') this.ui.log('subagent', `Subagent started: ${e.title ?? e.agentInfo?.name ?? ''}`);
          if (e.type === 'thread.done') this.ui.log('subagent', `Subagent finished: ${e.title ?? ''}`);
          if (e.type === 'thread.context_compaction_started') this.ui.log('info', 'TrueForge is compacting context…');
        },
        onApproval: calls => this.approve(calls),
        onSession: id => { if (this.active) this.active.sessionId = id; },
      }, own.signal);
      if (own.signal.aborted && !signal.aborted) return { ...r, status: 'error', error: `no response from the model within ${FIRST_EVENT_TIMEOUT_MS / 1000}s` };
      return r;
    } catch (e) {
      if (signal.aborted) return { sessionId: '', status: 'cancelled' };
      if (own.signal.aborted) return { sessionId: '', status: 'error', error: `no response from the model within ${FIRST_EVENT_TIMEOUT_MS / 1000}s` };
      return { sessionId: '', status: 'error', error: (e as Error).message };
    } finally {
      clearTimeout(stall);
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** TrueForge paused for approval: guard-check edits, open the per-hunk review, answer. */
  private async approve(calls: PendingCall[]): Promise<Decision[]> {
    const decisions: Decision[] = [];
    const items: { call: PendingCall; item: ReviewItem }[] = [];
    const simulated = new Map<string, string>();
    for (const c of calls) {
      if (c.name === 'propose_edit') {
        const a = c.args as EditArgs;
        const v = await validateEdit(this.ws, a, simulated.get(a.path));
        if (!v.ok) {
          this.ui.log('guard', `Blocked before review: ${v.error}`);
          decisions.push({ toolCallId: c.toolCallId, threadId: c.threadId, allow: false, reason: v.error });
          continue;
        }
        simulated.set(a.path, v.after);
        items.push({ call: c, item: { key: editKey(a), args: a, before: v.before, after: v.after } });
      } else if (c.name === 'run_command') {
        const ok = await this.confirmCommand(c.args);
        decisions.push(ok
          ? { toolCallId: c.toolCallId, threadId: c.threadId, allow: true }
          : { toolCallId: c.toolCallId, threadId: c.threadId, allow: false, reason: 'The user declined to run this command.' });
      } else {
        decisions.push({ toolCallId: c.toolCallId, threadId: c.threadId, allow: true });
      }
    }
    if (items.length) {
      this.ui.status(`Review ${items.length} proposed edit(s): accept or reject each hunk.`, 'info');
      const result = await this.review.review(items.map(i => i.item));
      for (const { call, item } of items) {
        const acc = result?.get(item.key);
        decisions.push(acc && acc.size
          ? { toolCallId: call.toolCallId, threadId: call.threadId, allow: true }
          : { toolCallId: call.toolCallId, threadId: call.threadId, allow: false, reason: `The user rejected every hunk of this edit to ${item.args.path}. Nothing was written. Do not propose it again.` });
      }
    }
    return decisions;
  }

  private async confirmCommand(args: { command: string; args?: string[] }): Promise<boolean> {
    const line = [args.command, ...(args.args ?? [])].join(' ');
    // Read-only commands (by default git status/diff/log/show) never change the workspace: no prompt.
    if (isAutoApproved(line)) return true;
    if (this.active?.allowCommands) return true;
    const pick = await vscode.window.showInformationMessage(`Forge wants to run: ${line}`, 'Allow', 'Allow for this run', 'Deny');
    if (pick === 'Allow for this run' && this.active) this.active.allowCommands = true;
    const ok = pick === 'Allow' || pick === 'Allow for this run';
    if (ok) this.active?.approved.add(line);
    return ok;
  }
}

function isAutoApproved(line: string): boolean {
  const auto = vscode.workspace.getConfiguration('forge').get<string[]>('autoApproveCommands') ?? [];
  return auto.some(p => line === p || line.startsWith(p + ' '));
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>(r => {
    const t = setTimeout(r, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
  });
}

function shortError(e?: string): string {
  if (!e) return 'unknown error';
  const m = e.match(/\((\d{3})\)[:\s]*([^"}\]]{0,80})/);
  return m ? `${m[1]} ${m[2].trim()}` : e.slice(0, 120);
}
