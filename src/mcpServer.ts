import * as http from 'http';
import { randomBytes } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ToolSpec } from './tools';

// The extension's editor capabilities, served as an MCP server on loopback.
// TrueForge (local mode, same machine) connects to it with a per-launch bearer token.

export interface RunningMcp { url: string; token: string; close(): Promise<void> }

export async function startMcpServer(tools: ToolSpec[], onCall: (name: string, args: any) => void = () => {}, log: (s: string) => void = () => {}): Promise<RunningMcp> {
  const token = randomBytes(24).toString('hex');

  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end('unauthorized'); return; }
    if ((req.url ?? '').split('?')[0] !== '/mcp') { res.writeHead(404).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }

    // Stateless: a fresh MCP server per request keeps cancellation and restarts trivial.
    const mcp = new McpServer({ name: 'ledgerforge-editor', version: '0.1.0' });
    for (const t of tools) {
      mcp.registerTool(
        t.name,
        { title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations },
        async (args: any) => {
          onCall(t.name, args);
          try {
            return { content: [{ type: 'text' as const, text: await t.handler(args) }] };
          } catch (e) {
            return { content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }], isError: true };
          }
        },
      );
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); mcp.close(); });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      log(`[mcp] request failed: ${(e as Error).message}`);
      if (!res.headersSent) res.writeHead(500).end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    close: () => new Promise(r => server.close(() => r())),
  };
}
