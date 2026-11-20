import * as vscode from 'vscode';
import { Workspace } from './workspace';

// Explorer footprint for the current run: 👁 read by the agent, ✎ proposed (in review), ✓ applied.
type Mark = 'read' | 'proposed' | 'applied';
const RANK: Record<Mark, number> = { read: 0, proposed: 1, applied: 2 };
const LOOK: Record<Mark, vscode.FileDecoration> = {
  read: new vscode.FileDecoration('👁', 'LedgerForge: read by the agent in this run'),
  proposed: new vscode.FileDecoration('✎', 'LedgerForge: edit proposed, waiting for review', new vscode.ThemeColor('editorWarning.foreground')),
  applied: new vscode.FileDecoration('✓', 'LedgerForge: accepted hunks applied in this run', new vscode.ThemeColor('testing.iconPassed')),
};

export class Footprint implements vscode.FileDecorationProvider {
  private marks = new Map<string, Mark>();
  private emitter = new vscode.EventEmitter<vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;

  constructor(private ws: Workspace) {}

  provideFileDecoration(uri: vscode.Uri) {
    const m = uri.scheme === 'file' ? this.marks.get(uri.fsPath) : undefined;
    return m && LOOK[m];
  }

  /** Raise a file's mark (never lower it, except via set(..., force)). */
  mark(rel: string, m: Mark, force = false) {
    let abs: string;
    try { abs = this.ws.resolve(rel); } catch { return; }
    const cur = this.marks.get(abs);
    if (!force && cur && RANK[cur] >= RANK[m]) return;
    this.marks.set(abs, m);
    this.emitter.fire([vscode.Uri.file(abs)]);
  }

  /** End of run: proposals that were never applied go back to "read". */
  settle() { for (const [k, v] of this.marks) if (v === 'proposed') this.marks.set(k, 'read'); this.emitter.fire(undefined); }

  snapshot() { return Object.fromEntries([...this.marks].map(([k, v]) => [this.ws.rel(k), v])); }

  clear() { this.marks.clear(); this.emitter.fire(undefined); }
}
