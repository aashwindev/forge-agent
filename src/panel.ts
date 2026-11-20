import * as vscode from 'vscode';
import { RunUI } from './runner';

// The agent panel (activity bar → Forge). Streams tokens as TrueForge sends them,
// shows a feed of what the agent did, and has Send / Stop.

export class ForgePanel implements vscode.WebviewViewProvider, RunUI {
  static readonly id = 'forge.panel';
  private view?: vscode.WebviewView;
  private queue: any[] = [];
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

  begin(label: string) { this.post({ type: 'begin', label }); }
  text(delta: string) { this.post({ type: 'text', delta }); }
  log(kind: string, text: string) { this.post({ type: 'log', kind, text }); }
  status(text: string, tone: string) { this.post({ type: 'status', text, tone }); }
  end() { this.post({ type: 'end' }); }
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
    if (m.type === 'end') { send.disabled = false; stop.disabled = true; msg = null; }
  });
  vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}
