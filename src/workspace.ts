import * as fs from 'fs';
import * as path from 'path';

// Everything the agent can see goes through this. The VS Code build passes an
// overlay that returns unsaved editor text, so tools see what the user sees.
export type Overlay = (absPath: string) => string | undefined;

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', '.venv', 'venv', 'env', '__pycache__', '.mypy_cache', '.pytest_cache',
  '.ruff_cache', '.tox', 'dist', 'build', '.idea', '.vscode', 'htmlcov', '.eggs',
]);
const BLOCKED = /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|id_rsa.*)$/i;
const TEXT_FILE = /\.(py|pyi|rst|md|txt|toml|cfg|ini|json|ya?ml|js|mjs|cjs|ts|tsx|jsx|html|css|sh|in)$/i;
const MAX_FILE_BYTES = 512 * 1024;

export class Workspace {
  private cache?: { at: number; files: string[] };

  constructor(readonly root: string, private overlay: Overlay = () => undefined) {}

  /** Resolve a workspace-relative path, refusing anything outside the root or secret-looking. */
  resolve(rel: string): string {
    const abs = path.resolve(this.root, rel);
    const relToRoot = path.relative(this.root, abs);
    if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) throw new Error(`Path is outside the workspace: ${rel}`);
    if (relToRoot.split(path.sep).includes('.git')) throw new Error(`Path is not readable: ${rel}`);
    if (BLOCKED.test(relToRoot)) throw new Error(`Refusing to touch a secrets file: ${rel}`);
    return abs;
  }

  rel(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join('/');
  }

  async read(rel: string): Promise<string> {
    const abs = this.resolve(rel);
    const live = this.overlay(abs);
    if (live !== undefined) return live;
    return fs.promises.readFile(abs, 'utf8');
  }

  exists(rel: string): boolean {
    try { return fs.statSync(this.resolve(rel)).isFile(); } catch { return false; }
  }

  /** Text files in the workspace, workspace-relative with forward slashes. Cached briefly. */
  async listFiles(): Promise<string[]> {
    if (this.cache && Date.now() - this.cache.at < 5000) return this.cache.files;
    const out: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (!IGNORED_DIRS.has(e.name) && !e.name.endsWith('.egg-info')) await walk(path.join(dir, e.name));
        } else if (e.isFile() && TEXT_FILE.test(e.name)) {
          const abs = path.join(dir, e.name);
          const rel = this.rel(abs);
          if (BLOCKED.test(rel)) continue;
          if ((await fs.promises.stat(abs)).size <= MAX_FILE_BYTES) out.push(rel);
        }
      }
    };
    await walk(this.root);
    out.sort();
    this.cache = { at: Date.now(), files: out };
    return out;
  }

  invalidate() { this.cache = undefined; }
}

export const estimateTokens = (s: string) => Math.ceil(s.length / 4);
