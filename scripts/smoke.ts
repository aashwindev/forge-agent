// Headless smoke test: real TrueForge + real MCP server + a real workspace, no VS Code UI.
// Usage: node dist/smoke.js <workspace> <model> "<prompt>" [agent|inline] [approve|deny]
import * as path from 'path';
import { Workspace } from '../src/workspace';
import { makeTools, validateEdit } from '../src/tools';
import { startMcpServer } from '../src/mcpServer';
import { ForgeClient, loadAgentDef } from '../src/forge';
import * as fs from 'fs';

async function main() {
  const [root, model, prompt, kind = 'agent', policy = 'deny'] = process.argv.slice(2);
  const ws = new Workspace(path.resolve(root));
  const tools = makeTools(ws, {
    onRead: (p, t, why) => console.log(`  [receipt] read ${p} ~${t} tok ${why ? '— ' + why : ''}`),
    applyEdit: async a => {
      const v = await validateEdit(ws, a);
      if (!v.ok) return v.error;
      fs.writeFileSync(ws.resolve(a.path), v.after);
      return `Applied all hunks to ${a.path}.`;
    },
  });
  const mcp = await startMcpServer(tools, (n, a) => console.log(`  [mcp] ${n} ${JSON.stringify(a).slice(0, 200)}`));
  const forge = new ForgeClient('http://localhost:8790');
  await forge.ping();
  await forge.registerMcp(mcp.url, mcp.token);
  console.log('registered', mcp.url, 'tools:', (await forge.listMcpTools()).join(', '));
  const agentKind = kind === 'inline' ? 'forge-inline' : 'forge-agent';
  await forge.upsertAgent(path.resolve(__dirname, '../agent'), agentKind, model);
  const spec = loadAgentDef(path.resolve(__dirname, '../agent'), agentKind, model).manifest;
  const t0 = Date.now();
  const r = await forge.runTurn(spec, prompt, {
    onText: (d, th) => process.stdout.write(th === 'main' ? d : ''),
    onEvent: e => {
      if (e.type === 'thread.created') console.log(`\n  [subagent] ${e.title}`);
      if (e.type === 'model.message' && e.toolCalls?.length) console.log(`\n  [tool-call:${e.threadId}] ${e.toolCalls.map((c: any) => c.function?.name).join(', ')}`);
    },
    onApproval: async calls => {
      console.log(`\n  [approval] ${calls.map(c => `${c.name}(${JSON.stringify(c.args).slice(0, 160)})`).join('\n   ')}`);
      return calls.map(c => policy === 'approve'
        ? { toolCallId: c.toolCallId, threadId: c.threadId, allow: true as const }
        : { toolCallId: c.toolCallId, threadId: c.threadId, allow: false as const, reason: 'Smoke test: denied.' });
    },
  });
  console.log(`\n\nresult: ${r.status} ${r.error ?? ''} session=${r.sessionId} ${Date.now() - t0}ms`);
  await mcp.close();
}
main().catch(e => { console.error('FAILED', e); process.exit(1); });
