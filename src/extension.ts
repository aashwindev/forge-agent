import * as vscode from 'vscode';
import * as path from 'path';
import { ForgeClient, loadAgentDef } from './forge';
import { startMcpServer, RunningMcp } from './mcpServer';
import { ForgePanel } from './panel';
import { ReviewController, SCHEME } from './review';
import { Runner } from './runner';
import { makeTools, runCommand } from './tools';
import { Workspace } from './workspace';

// Extension = TrueForge client + editor MCP server + review UI.
// TrueForge runs the agent loop; nothing here calls a model provider.

let mcp: RunningMcp | undefined;

export async function activate(ctx: vscode.ExtensionContext) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const panel = new ForgePanel();
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(ForgePanel.id, panel, { webviewOptions: { retainContextWhenHidden: true } }));
  if (!folder) {
    panel.status('Open a folder to use Forge.', 'warn');
    return;
  }

  const cfg = () => vscode.workspace.getConfiguration('forge');
  const forge = new ForgeClient(cfg().get<string>('baseUrl') ?? 'http://localhost:8790');
  const agentDir = path.join(ctx.extensionPath, 'agent');
  const ws = new Workspace(folder.uri.fsPath, abs => vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.fsPath === abs)?.getText());
  const review = new ReviewController(ws);
  review.register(ctx);
  const runner = new Runner(forge, ws, review, agentDir, panel);
  review.onStateChange = s => { if (s) panel.status(s, 'info'); };

  const tools = makeTools(ws, {
    onRead: (p, tokens, why) => panel.log('read', `${p} (~${tokens} tok)${why ? ' — ' + why : ''}`),
    applyEdit: args => review.apply(args, runner.attemptId),
  });

  /** Start the MCP server and register it + the agents in TrueForge. Safe to call repeatedly. */
  const connect = async (): Promise<string[]> => {
    await forge.ping();
    if (!mcp) {
      mcp = await startMcpServer(tools, (name, args) => {
        if (name !== 'read_file') panel.log('tool', `${name} ${summarize(args)}`);
      });
    }
    await forge.registerMcp(mcp.url, mcp.token);
    for (const kind of ['forge-agent', 'forge-inline'] as const) await forge.upsertAgent(agentDir, kind, cfg().get<string>('model')!);
    return forge.listMcpTools();
  };

  const ready = connect().then(
    t => panel.status(`Connected to TrueForge. Editor tools: ${t.join(', ')}.`, 'ok'),
    e => panel.status((e as Error).message, 'error'),
  );

  const ensure = async () => {
    await ready;
    try { await connect(); return true; } catch (e) { panel.status((e as Error).message, 'error'); return false; }
  };

  panel.onSend = async text => {
    if (!(await ensure())) return;
    runner.start('forge-agent', text, text.length > 80 ? text.slice(0, 80) + '…' : text);
  };
  panel.onStop = () => runner.stop();

  ctx.subscriptions.push(
    { dispose: () => { void mcp?.close(); mcp = undefined; } },

    vscode.commands.registerCommand('forge.ask', () => panel.reveal()),

    vscode.commands.registerCommand('forge.inlineEdit', async (given?: string) => {
      const ed = vscode.window.activeTextEditor;
      if (!ed || ed.document.uri.scheme !== 'file') return;
      const sel = ed.selection.isEmpty ? ed.document.lineAt(ed.selection.active.line).range : ed.selection;
      const instruction = typeof given === 'string' ? given : await vscode.window.showInputBox({ prompt: 'Forge: what should change in the selection?', placeHolder: 'e.g. handle None input', ignoreFocusOut: true });
      if (!instruction) return;
      if (!(await ensure())) return;
      const rel = ws.rel(ed.document.uri.fsPath);
      const first = sel.start.line + 1, last = sel.end.line + (sel.end.character === 0 && sel.end.line > sel.start.line ? 0 : 1);
      const selected = ed.document.getText(new vscode.Range(sel.start.line, 0, last, 0));
      const lang = ed.document.languageId;
      const message = `File: ${rel}\nSelected lines ${first}-${last}:\n\`\`\`${lang}\n${selected}\`\`\`\n\nInstruction: ${instruction}`;
      await panel.reveal();
      await vscode.window.showTextDocument(ed.document, ed.viewColumn);
      runner.start('forge-inline', message, `Inline · ${rel}:${first}-${last} · ${instruction}`);
    }),

    vscode.commands.registerCommand('forge.stop', () => runner.stop()),

    // Internal, used by the end-to-end tests to drive the same UI a user clicks.
    vscode.commands.registerCommand('forge._state', () => ({ busy: runner.busy, reviews: review.snapshot() })),
    vscode.commands.registerCommand('forge._send', (text: string) => panel.onSend?.(text)),

    vscode.commands.registerCommand('forge.undo', async () => {
      const restored = await review.undo();
      panel.status(restored.length ? `Undid the last Forge change to ${restored[0]}.` : 'Nothing to undo.', restored.length ? 'ok' : 'info');
    }),

    vscode.commands.registerCommand('forge.undoRun', async () => {
      const id = review.lastRunId();
      const restored = id ? await review.undo(id, true) : [];
      const clean = await gitClean(ws);
      panel.status(restored.length ? `Undid the last run: restored ${[...new Set(restored)].join(', ')}.${clean ? ' Workspace clean ✓ (git status)' : ''}` : 'Nothing to undo.', restored.length ? 'ok' : 'info');
    }),

    vscode.commands.registerCommand('forge.doctor', async () => {
      await panel.reveal();
      panel.begin('Forge: Doctor');
      try {
        const t = await connect();
        panel.log('info', `TrueForge reachable at ${forge.baseUrl}`);
        panel.log('info', `MCP server ${mcp?.url} registered; tools: ${t.join(', ')}`);
        panel.log('info', `Agents loaded from ${agentDir}: forge-agent, forge-inline`);
        const available = await forge.listModels();
        for (const key of ['model', 'fallbackModel']) {
          const m = cfg().get<string>(key)!;
          if (!available.includes(m)) { panel.log('guard', `${key} ${m} is not configured in TrueForge`); continue; }
          const r = await forge.runTurn({ ...loadAgentDef(agentDir, 'forge-inline', m).manifest, mcp_servers: [] }, 'Reply with the single word OK.', { onApproval: async () => [] });
          panel.log(r.status === 'done' ? 'info' : 'guard', `${key} ${m}: ${r.status === 'done' ? 'answers ✓' : 'FAILED — ' + (r.error ?? r.status)}`);
        }
        panel.status('Doctor finished.', 'ok');
      } catch (e) {
        panel.status((e as Error).message, 'error');
      } finally {
        panel.end();
      }
    }),
  );

  void vscode.commands.executeCommand('setContext', 'forge.proposalScheme', SCHEME);
}

async function gitClean(ws: Workspace): Promise<boolean> {
  const out = await runCommand(ws, 'git', ['status', '--porcelain']);
  return out.split('\n').slice(2).join('').trim() === '';
}

function summarize(args: any): string {
  if (!args) return '';
  if (args.path) return `${args.path}${args.reason ? ' — ' + args.reason : ''}`;
  if (args.query) return `"${args.query}"`;
  if (args.name) return args.name;
  if (args.command) return [args.command, ...(args.args ?? [])].join(' ');
  return JSON.stringify(args).slice(0, 120);
}

export function deactivate() {
  return mcp?.close();
}
