# Forge Agent

A VS Code coding-agent extension whose agent loop runs on
[TrueForge](https://github.com/truefoundry/trueforge). Built for the TrueFoundry
Forge-a-thon (Techfest, IIT Bombay 2026-27).

**Starting point:** from scratch (no upstream fork). Editor plumbing uses the VS Code API only.

## Setup (from a clean clone)
1. `npx @truefoundry/trueforge@latest` — starts TrueForge in local mode at http://localhost:8790
2. In TrueForge: Settings -> Models, add two providers and keys (keys live in TrueForge, never in this repo). Defaults: `openai/gpt-5-4-mini` (primary) and `anthropic/claude-haiku-5-5` (fallback, on a different provider so one bad key cannot take out both).
3. `npm install && npm run build`
4. Open this folder in VS Code, press F5 (Extension Development Host).
5. Run **Forge: Ask Agent** from the command palette.

Model names are set via the `forge.model` and `forge.fallbackModel` settings (see `forge.config.example.json`).

## Status
- [x] Milestone 0: extension creates a TrueForge session and streams a turn (verified with `openai/gpt-5-4-mini`)
- [ ] Inline edit with per-hunk diff
- [ ] Agent mode (editor tools as MCP, 3+ files)
- [ ] Context assembly (@file/@symbol + auto retrieval)
- [ ] Streaming + cancel
- [ ] Model fallback

## Models, cost, limitations
_To be filled in with the write-up._
