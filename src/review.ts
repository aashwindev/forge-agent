import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { Hunk, HunkState, applyHunks, computeHunks, hunkPositions } from './hunks';
import { EditArgs } from './tools';
import { Workspace } from './workspace';

// Per-hunk review driven by TrueForge tool approval.
// 1. TrueForge pauses on propose_edit -> review() opens a diff editor per edit.
// 2. The user accepts/rejects each hunk (CodeLens) -> review() resolves.
// 3. We answer allow/deny; TrueForge calls propose_edit on our MCP server ->
//    apply() writes ONLY the accepted hunks and journals the pre-image.

export const SCHEME = 'forge-proposal';

export interface ReviewItem {
  key: string;
  args: EditArgs;
  before: string;
  after: string;
}

interface OpenReview extends ReviewItem {
  uri: vscode.Uri;
  hunks: Hunk[];
  state: HunkState[];
}

export interface JournalEntry { path: string; before: string; after: string; runId: string }

export const editKey = (a: EditArgs) => createHash('sha256').update(JSON.stringify([a.path, a.old_text, a.new_text])).digest('hex').slice(0, 16);

export class ReviewController implements vscode.TextDocumentContentProvider, vscode.CodeLensProvider {
  private open = new Map<string, OpenReview>(); // by uri.toString()
  private decided = new Map<string, Set<number>>(); // edit key -> accepted hunk indexes
  private waiter?: { keys: string[]; resolve: (r: Map<string, Set<number>> | undefined) => void };
  readonly journal: JournalEntry[] = [];
  private changed = new vscode.EventEmitter<vscode.Uri>();
  private lensChanged = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  readonly onDidChangeCodeLenses = this.lensChanged.event;
  onStateChange?: (summary: string) => void;
  onApplied?: (path: string) => void;

  constructor(private ws: Workspace) {}

  register(ctx: vscode.ExtensionContext) {
    ctx.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, this),
      vscode.languages.registerCodeLensProvider({ scheme: SCHEME }, this),
      vscode.commands.registerCommand('forge.hunk', (uri: string, i: number, s: HunkState) => this.decide(uri, i, s)),
      vscode.commands.registerCommand('forge.acceptAll', (u?: vscode.Uri) => this.decideAll(u, 'accepted')),
      vscode.commands.registerCommand('forge.rejectAll', (u?: vscode.Uri) => this.decideAll(u, 'rejected')),
    );
  }

  // ---- what the diff editor shows ----

  provideTextDocumentContent(uri: vscode.Uri): string {
    if (uri.query === 'empty') return '';
    const r = this.open.get(uri.toString());
    if (!r) return '';
    return applyHunks(r.before, r.hunks, i => r.state[i] !== 'rejected');
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const r = this.open.get(doc.uri.toString());
    if (!r) return [];
    const pos = hunkPositions(r.hunks, i => r.state[i] !== 'rejected');
    const lenses: vscode.CodeLens[] = [];
    r.hunks.forEach((h, i) => {
      const line = Math.min(pos[i], Math.max(0, doc.lineCount - 1));
      const range = new vscode.Range(line, 0, line, 0);
      const tag = `Hunk ${i + 1}/${r.hunks.length}`;
      if (r.state[i] === 'pending') {
        lenses.push(
          new vscode.CodeLens(range, { title: '$(check) Accept', command: 'forge.hunk', arguments: [doc.uri.toString(), i, 'accepted'] }),
          new vscode.CodeLens(range, { title: '$(close) Reject', command: 'forge.hunk', arguments: [doc.uri.toString(), i, 'rejected'] }),
          new vscode.CodeLens(range, { title: `${tag}${r.args.reason ? ' · why: ' + r.args.reason : ''}`, command: '' }),
        );
      } else {
        lenses.push(new vscode.CodeLens(range, { title: `${tag} ${r.state[i] === 'accepted' ? '$(check) accepted' : '$(close) rejected'}`, command: '' }));
      }
    });
    return lenses;
  }

  snapshot() {
    return [...this.open.values()].map(r => ({ uri: r.uri.toString(), path: r.args.path, state: [...r.state] }));
  }

  // ---- review lifecycle ----

  /** Open every item for review; resolves with accepted hunk sets, or undefined if cancelled. */
  async review(items: ReviewItem[]): Promise<Map<string, Set<number>> | undefined> {
    for (const it of items) {
      const uri = vscode.Uri.from({ scheme: SCHEME, path: '/' + it.args.path, query: it.key });
      const hunks = computeHunks(it.before, it.after);
      this.open.set(uri.toString(), { ...it, uri, hunks, state: hunks.map(() => 'pending') });
      const left = this.ws.exists(it.args.path) ? vscode.Uri.file(this.ws.resolve(it.args.path)) : vscode.Uri.from({ scheme: SCHEME, path: '/' + it.args.path, query: 'empty' });
      await vscode.commands.executeCommand('vscode.diff', left, uri, `Forge review: ${it.args.path} (${hunks.length} hunk${hunks.length === 1 ? '' : 's'})`, { preview: false });
    }
    this.lensChanged.fire();
    this.report();
    return new Promise(resolve => {
      this.waiter = { keys: items.map(i => i.key), resolve };
      this.checkDone();
    });
  }

  private decide(uriStr: string, i: number, s: HunkState) {
    const r = this.open.get(uriStr);
    if (!r || r.state[i] !== 'pending') return;
    r.state[i] = s;
    this.changed.fire(r.uri);
    this.lensChanged.fire();
    this.report();
    this.checkDone();
  }

  private decideAll(uri: vscode.Uri | undefined, s: HunkState) {
    const targets = uri ? [this.open.get(uri.toString())].filter(Boolean) as OpenReview[] : [...this.open.values()];
    for (const r of targets) {
      r.state = r.state.map(x => (x === 'pending' ? s : x));
      this.changed.fire(r.uri);
    }
    this.lensChanged.fire();
    this.report();
    this.checkDone();
  }

  private checkDone() {
    if (!this.waiter) return;
    const rs = [...this.open.values()].filter(r => this.waiter!.keys.includes(r.key));
    if (rs.some(r => r.state.includes('pending'))) return;
    const out = new Map<string, Set<number>>();
    for (const r of rs) {
      const acc = new Set(r.state.flatMap((s, i) => (s === 'accepted' ? [i] : [])));
      out.set(r.key, acc);
      this.decided.set(r.key, acc);
    }
    const w = this.waiter;
    this.waiter = undefined;
    this.closeEditors(rs).then(() => w.resolve(out));
  }

  /** Cancel: drop every open proposal without writing anything. */
  async discardAll() {
    const rs = [...this.open.values()];
    await this.closeEditors(rs);
    this.decided.clear();
    const w = this.waiter;
    this.waiter = undefined;
    w?.resolve(undefined);
    this.report();
  }

  private async closeEditors(rs: OpenReview[]) {
    const uris = new Set(rs.map(r => r.uri.toString()));
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => {
      const inp = t.input as any;
      return inp?.modified && uris.has(inp.modified.toString());
    });
    if (tabs.length) await vscode.window.tabGroups.close(tabs);
    rs.forEach(r => this.open.delete(r.uri.toString()));
  }

  private report() {
    const all = [...this.open.values()];
    const pending = all.reduce((n, r) => n + r.state.filter(s => s === 'pending').length, 0);
    vscode.commands.executeCommand('setContext', 'forge.reviewing', all.length > 0);
    this.onStateChange?.(all.length ? `Review: ${pending} hunk(s) pending in ${all.length} file(s)` : '');
  }

  // ---- writing (only reached after TrueForge approval) ----

  /** Called by the propose_edit MCP handler. Writes the accepted hunks only. */
  async apply(args: EditArgs, runId: string): Promise<string> {
    const key = editKey(args);
    const accepted = this.decided.get(key);
    if (!accepted) return 'Not applied: this edit was not reviewed by the user. Propose it again.';
    this.decided.delete(key);
    const before = await this.ws.read(args.path);
    const target = before === '' && args.old_text === '' ? args.new_text : before.replace(args.old_text, () => args.new_text);
    const hunks = computeHunks(before, target);
    const after = applyHunks(before, hunks, i => accepted.has(i));
    if (after === before) return `Not applied: the user rejected every hunk of this edit to ${args.path}. Do not propose it again.`;
    await this.write(args.path, after);
    this.journal.push({ path: args.path, before, after, runId });
    this.onApplied?.(args.path);
    const acc = [...accepted].map(i => i + 1);
    const rej = hunks.map(h => h.index).filter(i => !accepted.has(i)).map(i => i + 1);
    return `Applied hunk(s) ${acc.join(', ')} of ${hunks.length} to ${args.path}.` +
      (rej.length ? ` The user rejected hunk(s) ${rej.join(', ')}; do not propose them again.` : '');
  }

  async write(relPath: string, text: string) {
    const uri = vscode.Uri.file(this.ws.resolve(relPath));
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      await vscode.workspace.fs.writeFile(uri, new Uint8Array());
      doc = await vscode.workspace.openTextDocument(uri);
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), text);
    await vscode.workspace.applyEdit(edit); // goes on the editor's undo stack (Ctrl+Z works)
    await doc.save();
    this.ws.invalidate();
  }

  /** Restore pre-images, newest first. With an id: every change of that attempt (or run, if prefix). Without: the last change. */
  async undo(id?: string, prefix = false): Promise<string[]> {
    const restored: string[] = [];
    const take = id ? this.journal.filter(j => (prefix ? j.runId.startsWith(id + '#') || j.runId === id : j.runId === id)) : this.journal.slice(-1);
    for (const j of [...take].reverse()) {
      await this.write(j.path, j.before);
      this.journal.splice(this.journal.lastIndexOf(j), 1);
      restored.push(j.path);
    }
    return restored;
  }

  /** The run (not attempt) that made the most recent change. */
  lastRunId(): string | undefined {
    return this.journal[this.journal.length - 1]?.runId.split('#')[0];
  }
}
