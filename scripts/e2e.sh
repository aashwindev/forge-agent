#!/usr/bin/env bash
# Run an end-to-end test inside a real, isolated VS Code window.
# Usage: scripts/e2e.sh <taskA|taskB|taskC|cancel> <workspace> [out.json]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
name="$1"; ws="$(cd "$2" && pwd)"; out="${3:-/tmp/forge-e2e-$name.json}"
npx --prefix "$here" esbuild "$here/test/e2e/$name.ts" --bundle --platform=node --format=cjs --external:vscode --outfile="$here/dist/e2e/$name.js" --log-level=warning
(cd "$here" && npm run -s build)
tmp="$(mktemp -d)"
mkdir -p "$tmp/user/User"
# Test windows cannot click popups: allow the commands Task B needs. Real user settings are untouched.
echo '{"ledgerforge.autoApproveCommands":["git status","git diff","git log","git show","pytest","python","flask"],"security.workspace.trust.enabled":false}' > "$tmp/user/User/settings.json"
rm -f "$out"
FORGE_E2E_OUT="$out" code --new-window --disable-extensions --skip-welcome --skip-release-notes \
  --user-data-dir "$tmp/user" --extensions-dir "$tmp/ext" \
  --extensionDevelopmentPath="$here" --extensionTestsPath="$here/dist/e2e/$name.js" "$ws" --wait >/dev/null 2>&1 || true
cat "$out"
