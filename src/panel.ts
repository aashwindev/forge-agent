import * as vscode from 'vscode';
import { RunUI } from './runner';
import { ContextPack } from './context';

// The agent panel (activity bar → Forge). Streams tokens as TrueForge sends them,
// shows a feed of what the agent did, and has Send / Stop.

export class ForgePanel implements vscode.WebviewViewProvider, RunUI {
  static readonly id = 'forge.panel';
  private view?: vscode.WebviewView;
  private queue: any[] = [];
  /** Plain-text record of the panel (also read by the e2e tests). */
  readonly transcript: string[] = [];
  private textBuf = '';
  onSend?: (text: string) => void;
  onStop?: () => void;

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = html(nonce());
    view.webview.onDidReceiveMessage(m => {
      if (m.type === 'send' && m.text?.trim()) this.onSend?.(m.text.trim());
      if (m.type === 'stop') this.onStop?.();
      if (m.type === 'ready') { this.queue.forEach(x => view.webview.postMessage(x)); this.queue = []; }
    });
  }

  async reveal() {
    await vscode.commands.executeCommand(`${ForgePanel.id}.focus`);
  }

  private post(m: any) {
    if (this.view?.visible) this.view.webview.postMessage(m);
    else this.queue.push(m);
  }

  private flush() { if (this.textBuf) { this.transcript.push(`text: ${this.textBuf}`); this.textBuf = ''; } }
  begin(label: string) { this.flush(); this.transcript.push(`begin: ${label}`); this.post({ type: 'begin', label }); }
  text(delta: string) { this.textBuf += delta; this.post({ type: 'text', delta }); }
  log(kind: string, text: string) { this.flush(); this.transcript.push(`${kind}: ${text}`); this.post({ type: 'log', kind, text }); }
  status(text: string, tone: string) { this.flush(); this.transcript.push(`status[${tone}]: ${text}`); this.post({ type: 'status', text, tone }); }
  end() { this.flush(); this.transcript.push('end'); this.post({ type: 'end' }); }
  receipt(p: ContextPack) {
    this.flush();
    this.transcript.push(`receipt: ${p.used}/${p.budget} tok; ${p.rows.map(r => `${r.included ? '+' : '-'}${r.path}`).join(' ')}`);
    this.post({ type: 'receipt', rows: p.rows, used: p.used, budget: p.budget, strategy: p.strategy });
  }
  receiptRead(path: string, tokens: number, why?: string) { this.post({ type: 'receiptRead', path, tokens, why: why ?? '' }); }
}

function nonce() {
  return Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
}

function html(n: string) {
  return /* html */ `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 8px 8px; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; margin: 0; }
  #status { margin: 8px 0; padding: 6px 8px; border-radius: 4px; background: var(--vscode-editorWidget-background); border-left: 3px solid var(--vscode-focusBorder); min-height: 1.2em; }
  #status.warn { border-color: var(--vscode-editorWarning-foreground); }
  #status.error { border-color: var(--vscode-editorError-foreground); }
  #status.ok { border-color: var(--vscode-testing-iconPassed, #3fb950); }
  #feed { flex: 1; overflow-y: auto; }
  #receipt { margin: 0 0 6px; font-size: 0.92em; max-height: 40vh; overflow-y: auto; }
  #receipt summary { cursor: pointer; font-weight: 600; }
  .meter { height: 6px; background: var(--vscode-editorWidget-background); border-radius: 3px; margin: 4px 0; }
  .meter > div { height: 100%; background: var(--vscode-progressBar-background); border-radius: 3px; }
  .strategy { opacity: 0.75; margin-bottom: 4px; }
  #receipt table { width: 100%; border-collapse: collapse; }
  #receipt td { padding: 1px 4px; vertical-align: top; }
  #receipt td.p { font-family: var(--vscode-editor-font-family); word-break: break-all; }
  #receipt tr.out { opacity: 0.55; }
  #receipt .src { font-size: 0.85em; padding: 0 4px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .turn { margin: 10px 0 4px; font-weight: 600; }
  .msg { white-space: pre-wrap; line-height: 1.45; }
  .log { font-size: 0.92em; opacity: 0.85; margin: 2px 0; font-family: var(--vscode-editor-font-family); }
  .log.guard { color: var(--vscode-editorWarning-foreground); }
  .log.subagent { color: var(--vscode-textLink-foreground); }
  #composer { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; border-top: 1px solid var(--vscode-panel-border); }
  textarea { width: 100%; box-sizing: border-box; min-height: 64px; resize: vertical; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); font-family: inherit; padding: 6px; }
  .row { display: flex; gap: 6px; }
  button { flex: 1; padding: 5px; border: none; border-radius: 2px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: 0.5; cursor: default; }
</style></head><body>
<div id="status">Ready. Describe a change; Forge finds the files.</div>
<details id="receipt" open hidden><summary>Context Receipt</summary><div class="strategy"></div><div class="meter"><div></div></div><table></table></details>
<div id="feed"></div>
<div id="composer">
  <textarea id="input" placeholder="Ask Forge to change the workspace… (Ctrl/Cmd+Enter to send)"></textarea>
  <div class="row"><button id="send">Send</button><button id="stop" class="secondary" disabled>■ Stop</button></div>
</div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const feed = document.getElementById('feed'), status = document.getElementById('status');
  const input = document.getElementById('input'), send = document.getElementById('send'), stop = document.getElementById('stop');
  let msg = null;
  const receipt = document.getElementById('receipt'), rtable = receipt.querySelector('table');
  let rrows = new Map(), budget = 0, used = 0, agentTok = 0;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const drawReceipt = () => {
    receipt.hidden = false;
    receipt.querySelector('summary').textContent = 'Context Receipt · packed ' + used + ' / ' + budget + ' tok' + (agentTok ? ' · agent read ' + agentTok + ' tok' : '');
    receipt.querySelector('.meter > div').style.width = Math.min(100, 100 * used / (budget || 1)) + '%';
    rtable.innerHTML = [...rrows.values()].map(r => '<tr class="' + (r.included ? '' : 'out') + '"><td>' + (r.included ? '✓' : '✗') + '</td><td class="p">' + esc(r.path) + '</td><td><span class="src">' + esc(r.source) + (r.read ? ' · read' : '') + '</span></td><td>' + (r.tokens ? r.tokens : '') + '</td><td>' + esc(r.reason) + '</td></tr>').join('');
  };
  const atBottom = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  const add = (cls, text) => { const stick = atBottom(); const d = document.createElement('div'); d.className = cls; d.textContent = text; feed.appendChild(d); if (stick) feed.scrollTop = feed.scrollHeight; return d; };
  send.onclick = () => { vscode.postMessage({ type: 'send', text: input.value }); input.value = ''; };
  stop.onclick = () => vscode.postMessage({ type: 'stop' });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send.click(); });
  window.addEventListener('message', ({ data: m }) => {
    if (m.type === 'begin') { add('turn', '› ' + m.label); msg = null; send.disabled = true; stop.disabled = false; }
    if (m.type === 'text') { if (!msg) msg = add('msg', ''); const stick = atBottom(); msg.textContent += m.delta; if (stick) feed.scrollTop = feed.scrollHeight; }
    if (m.type === 'log') { msg = null; add('log ' + m.kind, ({ tool: '⚙ ', read: '👁 ', guard: '⛔ ', subagent: '↳ ', session: '◆ ', info: '· ' }[m.kind] || '') + m.text); }
    if (m.type === 'status') { status.textContent = m.text; status.className = m.tone; }
    if (m.type === 'receipt') { rrows = new Map(m.rows.map(r => [r.path, { ...r }])); budget = m.budget; used = m.used; agentTok = 0; receipt.querySelector('.strategy').textContent = 'Strategy: ' + m.strategy; drawReceipt(); }
    if (m.type === 'receiptRead' && budget) { agentTok += m.tokens; const r = rrows.get(m.path); if (r) { r.read = true; r.included = true; } else rrows.set(m.path, { path: m.path, source: 'agent', reason: m.why || 'read by the agent', tokens: m.tokens, included: true, read: true }); drawReceipt(); }
    if (m.type === 'end') { send.disabled = false; stop.disabled = true; msg = null; }
  });
  vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}
