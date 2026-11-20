import { diffLines } from 'diff';

// Pure hunk logic, no VS Code. A hunk is one contiguous run of removed and/or
// added lines. Context is zero, so separate changes (e.g. docstring vs code)
// become separate hunks the user can accept or reject independently.

export interface Hunk {
  index: number;
  oldStart: number; // 0-based line in `before` where the hunk starts
  oldLines: string[]; // lines removed, each keeping its line ending
  newLines: string[]; // lines added
}

export type HunkState = 'pending' | 'accepted' | 'rejected';

export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export function computeHunks(before: string, after: string): Hunk[] {
  const hunks: Hunk[] = [];
  let line = 0;
  let cur: Hunk | undefined;
  for (const part of diffLines(before, after)) {
    const lines = splitLines(part.value);
    if (!part.added && !part.removed) {
      if (cur) { hunks.push(cur); cur = undefined; }
      line += lines.length;
      continue;
    }
    cur ??= { index: hunks.length, oldStart: line, oldLines: [], newLines: [] };
    if (part.removed) { cur.oldLines.push(...lines); line += lines.length; }
    else cur.newLines.push(...lines);
  }
  if (cur) hunks.push(cur);
  return hunks;
}

/** Rebuild the text from `before`, applying only the hunks for which `take(i)` is true. */
export function applyHunks(before: string, hunks: Hunk[], take: (i: number) => boolean): string {
  const src = splitLines(before);
  const out: string[] = [];
  let i = 0;
  for (const h of hunks) {
    while (i < h.oldStart) out.push(src[i++]);
    if (take(h.index)) out.push(...h.newLines);
    else out.push(...h.oldLines);
    i += h.oldLines.length;
  }
  while (i < src.length) out.push(src[i++]);
  return out.join('');
}

/**
 * Where each hunk starts in the text produced by applyHunks with the same
 * `take` (0-based line). Used to anchor the Accept/Reject CodeLens.
 */
export function hunkPositions(hunks: Hunk[], take: (i: number) => boolean): number[] {
  let delta = 0;
  return hunks.map(h => {
    const pos = h.oldStart + delta;
    delta += (take(h.index) ? h.newLines.length : h.oldLines.length) - h.oldLines.length;
    return pos;
  });
}
