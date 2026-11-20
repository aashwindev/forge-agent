import * as fs from 'fs';
import * as path from 'path';
import { TrueForge, isEventDelta, mergeEventDelta } from '@truefoundry/trueforge-sdk';

// Thin client over TrueForge. TrueForge owns the agent loop; this file only
// creates sessions, streams turns, answers approval pauses, and cancels.

export const MCP_SERVER_NAME = 'forge-editor';

export type AgentKind = 'forge-agent' | 'forge-inline';

export interface PendingCall {
  threadId: string;
  toolCallId: string;
  name: string;
  args: any;
}

export type Decision = { toolCallId: string; threadId: string; allow: true } | { toolCallId: string; threadId: string; allow: false; reason: string };

export interface TurnHandlers {
  onEvent?(e: any): void;
  onText?(delta: string, threadId: string): void;
  onSession?(sessionId: string): void;
  /** Called when the turn pauses for tool approval. Return one decision per call. */
  onApproval(calls: PendingCall[]): Promise<Decision[]>;
}

export interface TurnResult {
  sessionId: string;
  turnId?: string;
  status: 'done' | 'cancelled' | 'error';
  error?: string;
  output?: string;
}

export class ForgeClient {
  readonly client: TrueForge;

  constructor(readonly baseUrl: string) {
    this.client = new TrueForge({ baseUrl, timeoutInSeconds: 900 });
  }

  private async api(method: string, p: string, body?: unknown) {
    const res = await fetch(`${this.baseUrl}/api/v1${p}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`TrueForge ${method} ${p} -> ${res.status}: ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : undefined;
  }

  async ping(): Promise<void> {
    try {
      await this.api('GET', '/models');
    } catch (e) {
      throw new Error(`TrueForge is not reachable at ${this.baseUrl}. Start it with: npx @truefoundry/trueforge@latest  (${(e as Error).message})`);
    }
  }

  async listModels(): Promise<string[]> {
    const r = await this.api('GET', '/models');
    return (r?.data ?? []).map((m: any) => m.name);
  }

  /** Register (or re-point) the extension's MCP server in TrueForge. */
  async registerMcp(url: string, token: string): Promise<void> {
    await this.api('PUT', '/settings/mcp-servers', {
      manifest: {
        type: 'remote',
        name: MCP_SERVER_NAME,
        url,
        description: 'Editor capabilities of the open VS Code workspace: search, symbols, read, approval-gated edits, allowlisted commands.',
        auth: { type: 'header', headers: { Authorization: `Bearer ${token}` } },
      },
    }).catch((e: Error) => {
      if (/Outbound URL blocked/.test(e.message)) {
        throw new Error(`TrueForge blocks loopback MCP servers by default. Restart it with:\n  OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]' npx @truefoundry/trueforge@latest`);
      }
      throw e;
    });
  }

  async listMcpTools(): Promise<string[]> {
    const r = await this.api('GET', `/mcp-servers/${MCP_SERVER_NAME}/tools`);
    return (r?.data ?? r?.tools ?? []).map((t: any) => t.name);
  }

  /** Save the agent definition from agent/<kind>.json under its name, so it shows in the TrueForge UI. */
  async upsertAgent(agentDir: string, kind: AgentKind, model: string): Promise<void> {
    const def = loadAgentDef(agentDir, kind, model);
    const list = await this.api('GET', `/agents?agent_name=${encodeURIComponent(kind)}`);
    const existing = (list?.data ?? []).find((a: any) => a.name === kind);
    if (existing) await this.api('PUT', `/agents/${existing.id}`, { description: def.description, manifest: def.manifest });
    else await this.api('POST', '/agents', def);
  }

  /**
   * Run one turn on a fresh session with the given spec. Streams events, pauses
   * for approvals (handled by the caller), resumes, and returns the final state.
   */
  async runTurn(spec: any, input: string, h: TurnHandlers, signal?: AbortSignal, existingSessionId?: string): Promise<TurnResult> {
    const sessionId = existingSessionId ?? (await this.client.sessions.create({ agent: { spec } }, { abortSignal: signal })).data.id;
    h.onSession?.(sessionId);
    const opts = { abortSignal: signal };
    const events = new Map<string, any>();
    let turnId: string | undefined;
    let lastEventId: string | undefined;
    let stream: AsyncIterable<any> = await this.client.sessions.createTurnStream(sessionId, { input: [{ type: 'user.message', content: input }] }, opts);

    while (true) {
      let pending: PendingCall[] = [];
      let paused = false;
      for await (const e of stream) {
        if (signal?.aborted) return { sessionId, turnId, status: 'cancelled' };
        lastEventId = e.id ?? lastEventId;
        if (isEventDelta(e)) {
          const base = events.get(e.id);
          if (base) mergeEventDelta(base, e);
          if (e.type === 'model.message.delta' && e.content) h.onText?.(e.content, e.threadId);
        } else {
          events.set(e.id, e);
        }
        h.onEvent?.(e);
        if (e.type === 'turn.created') turnId = e.turnId;
        if (e.type === 'tool.approval_required') {
          for (const ref of e.toolCalls ?? []) {
            const src = events.get(ref.sourceEventId);
            const call = (src?.toolCalls ?? []).find((c: any) => c.id === ref.id);
            let args: any = {};
            try { args = JSON.parse(call?.function?.arguments ?? '{}'); } catch { /* leave empty */ }
            let name = call?.toolInfo?.name ?? call?.function?.name ?? '?';
            // Deferred tools arrive wrapped: call_tool({mcp_server, tool_name, input}).
            if (name === 'call_tool' && args?.tool_name) { name = args.tool_name; args = args.input ?? {}; }
            pending.push({ threadId: e.threadId, toolCallId: ref.id, name, args });
          }
        }
        if (e.type === 'turn.update' && e.state?.status === 'paused') { paused = true; break; }
        if (e.type === 'turn.done') {
          const st = e.state ?? {};
          return {
            sessionId, turnId, status: st.status,
            error: st.status === 'error' ? describeError(st) : undefined,
            output: typeof st.output?.content === 'string' ? st.output.content : undefined,
          };
        }
      }
      if (signal?.aborted) return { sessionId, turnId, status: 'cancelled' };
      if (!paused || !turnId) return { sessionId, turnId, status: 'error', error: 'The turn stream ended without a result.' };

      const decisions = await h.onApproval(pending);
      if (signal?.aborted) return { sessionId, turnId, status: 'cancelled' };
      await this.client.sessions.createTurnEvents(sessionId, turnId, {
        events: decisions.map(d => ({
          type: 'user.tool_approval',
          threadId: d.threadId,
          toolCallId: d.toolCallId,
          approval: d.allow ? { status: 'allow' } : { status: 'deny', reason: d.reason },
        })) as any,
      }, opts);
      stream = await this.client.sessions.subscribeToTurn(sessionId, turnId, { afterEventId: lastEventId }, opts);
    }
  }

  /** Swap the agent spec (e.g. the model) of an existing session. History is kept. */
  async updateSessionAgent(sessionId: string, spec: any): Promise<void> {
    await this.api('PATCH', `/sessions/${sessionId}`, { agent: { spec } });
  }

  async cancel(sessionId: string): Promise<void> {
    try { await this.client.sessions.cancel(sessionId); } catch { /* already finished */ }
  }
}

export function loadAgentDef(agentDir: string, kind: AgentKind, model: string): { name: string; description: string; manifest: any } {
  const raw = fs.readFileSync(path.join(agentDir, `${kind}.json`), 'utf8').replace(/\{\{MODEL\}\}/g, model);
  return JSON.parse(raw);
}

function describeError(state: any): string {
  const msg = state.error?.message ?? state.message ?? state.error ?? state.reason;
  return typeof msg === 'string' ? msg : JSON.stringify(state).slice(0, 400);
}
