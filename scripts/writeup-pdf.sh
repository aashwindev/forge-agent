#!/usr/bin/env bash
# docs/writeup.md -> docs/writeup.pdf (A4, must stay within 3 pages). Needs Google Chrome.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"; tmp="$(mktemp -d)"
npx -y marked@12.0.2 -i "$here/docs/writeup.md" -o "$tmp/body.html"
{ echo '<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:16mm 15mm}body{font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:10pt;line-height:1.38;color:#111}h1{font-size:16pt;margin:0 0 4px}h2{font-size:12pt;margin:12px 0 4px;border-bottom:1px solid #ccc;padding-bottom:2px}p,li{margin:3px 0}ul,ol{margin:3px 0;padding-left:20px}table{border-collapse:collapse;width:100%;font-size:8.8pt;margin:5px 0}td,th{border:1px solid #bbb;padding:2px 5px;vertical-align:top;text-align:left}th{background:#f0f0f0}pre{background:#f6f6f6;padding:6px 8px;font-size:8.3pt;line-height:1.25;margin:5px 0}code{font-family:Menlo,monospace;font-size:8.8pt}</style></head><body>'
  cat "$tmp/body.html"; echo '</body></html>'; } > "$tmp/writeup.html"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="$here/docs/writeup.pdf" "$tmp/writeup.html" 2>/dev/null
pdfinfo "$here/docs/writeup.pdf" | grep Pages
