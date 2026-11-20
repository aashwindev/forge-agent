import { Workspace, estimateTokens } from './workspace';

// Explicit context: "@src/app/main.py", "@main.py" or "@parse_config" in a request.
// Files are pinned whole (or as an outline if huge); symbols are pinned as their full definition.

export interface Mention { token: string; kind: 'file' | 'symbol'; path: string; line?: number; body: string; tokens: number }
export interface SymbolEntry { name: string; path: string; line: number }

const MENTION = /(^|\s)@([A-Za-z0-9_./-]+[A-Za-z0-9_])/g;
const DEF = /^(\s*)(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)|^(\s*)(?:export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_]\w*)/;
const MAX_FILE_TOKENS = 3000;

let symCache: { at: number; list: SymbolEntry[] } | undefined;

/** Every def/class/function in the workspace (cached briefly). Used for @symbol resolution and autocomplete. */
export async function listSymbols(ws: Workspace): Promise<SymbolEntry[]> {
  if (symCache && Date.now() - symCache.at < 10_000) return symCache.list;
  const list: SymbolEntry[] = [];
  for (const f of await ws.listFiles()) {
    if (!/\.(py|ts|js|tsx|jsx)$/.test(f)) continue;
    let text: string;
    try { text = await ws.read(f); } catch { continue; }
    text.split('\n').forEach((l, i) => { const m = l.match(DEF); if (m) list.push({ name: m[2] ?? m[4], path: f, line: i + 1 }); });
  }
  symCache = { at: Date.now(), list };
  return list;
}

/** Up to `max` completions for an @-prefix: files by path substring, symbols by name prefix. */
export async function complete(ws: Workspace, q: string, max = 8): Promise<{ insert: string; kind: 'file' | 'symbol'; detail: string }[]> {
  const lq = q.toLowerCase();
  const files = (await ws.listFiles()).filter(f => f.toLowerCase().includes(lq))
    .sort((a, b) => score(a, lq) - score(b, lq)).slice(0, max)
    .map(f => ({ insert: f, kind: 'file' as const, detail: 'file' }));
  const syms = lq.includes('/') || lq.includes('.') ? [] : (await listSymbols(ws)).filter(s => s.name.toLowerCase().startsWith(lq))
    .sort((a, b) => Number(isTest(a.path)) - Number(isTest(b.path)) || a.name.length - b.name.length).slice(0, max)
    .map(s => ({ insert: s.name, kind: 'symbol' as const, detail: `${s.path}:${s.line}` }));
  return [...syms.slice(0, Math.ceil(max / 2)), ...files].slice(0, max);
}

export async function resolveMentions(ws: Workspace, text: string): Promise<{ found: Mention[]; missing: string[] }> {
  const found: Mention[] = [];
  const missing: string[] = [];
  const files = await ws.listFiles();
  for (const m of text.matchAll(MENTION)) {
    const token = m[2];
    if (found.some(f => f.token === token) || missing.includes(token)) continue;
    const file = files.includes(token) ? token : files.find(f => f.endsWith('/' + token));
    if (file) {
      const body = await ws.read(file);
      const full = estimateTokens(body) <= MAX_FILE_TOKENS;
      const shown = full ? body : body.split('\n').slice(0, 200).join('\n') + '\n… (truncated: read_file for the rest)';
      found.push({ token, kind: 'file', path: file, body: shown, tokens: estimateTokens(shown) });
      continue;
    }
    if (/^[A-Za-z_]\w*$/.test(token)) {
      const defs = (await listSymbols(ws)).filter(s => s.name === token).sort((a, b) => Number(isTest(a.path)) - Number(isTest(b.path)));
      if (defs.length) {
        const d = defs[0];
        const body = definition((await ws.read(d.path)).split('\n'), d.line - 1);
        found.push({ token, kind: 'symbol', path: d.path, line: d.line, body, tokens: estimateTokens(body) });
        continue;
      }
    }
    missing.push(token);
  }
  return { found, missing };
}

/** The definition starting at line `i` (plus its decorators), up to the next line at the same or lower indent. */
function definition(lines: string[], i: number): string {
  const indent = lines[i].match(/^\s*/)![0].length;
  let start = i;
  while (start > 0 && /^\s*@/.test(lines[start - 1])) start--;
  let end = i + 1;
  while (end < lines.length && (lines[end].trim() === '' || lines[end].match(/^\s*/)![0].length > indent)) end++;
  return lines.slice(start, Math.min(end, start + 150)).map((l, k) => `${start + k + 1}: ${l}`).join('\n').trimEnd();
}

const isTest = (p: string) => /(^|\/)tests?\//.test(p);
const score = (f: string, q: string) => (f.toLowerCase().endsWith(q) ? 0 : 1) * 1000 + f.length;
