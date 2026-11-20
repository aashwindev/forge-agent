import assert from 'node:assert/strict';
import { computeHunks, applyHunks, hunkPositions } from '../src/hunks';

const before = `def get_debug_flag() -> bool:
    """Get whether debug mode should be enabled for the app, indicated by the
    :envvar:\`FLASK_DEBUG\` environment variable. The default is \`\`False\`\`.
    """
    val = os.environ.get("FLASK_DEBUG")
    return bool(val and val.lower() not in {"0", "false", "no"})
`;
const after = `def get_debug_flag() -> bool:
    """Get whether debug mode should be enabled for the app, indicated by the
    :envvar:\`FLASK_DEBUG\` environment variable. The default is \`\`False\`\`.
    Values treated as false: 0, false, no, off, n (case-insensitive).
    """
    val = os.environ.get("FLASK_DEBUG")
    return bool(val and val.lower() not in {"0", "false", "no", "off", "n"})
`;
const hunks = computeHunks(before, after);
assert.equal(hunks.length, 2, 'docstring and code are separate hunks');
assert.equal(applyHunks(before, hunks, () => true), after, 'accept all = after');
assert.equal(applyHunks(before, hunks, () => false), before, 'reject all = before');
const codeOnly = applyHunks(before, hunks, i => i === 1);
assert.ok(codeOnly.includes('"off", "n"') && !codeOnly.includes('Values treated as false'), 'partial accept');
assert.deepEqual(hunkPositions(hunks, () => true), [3, 6]);
assert.deepEqual(hunkPositions(hunks, i => i === 1), [3, 5]);
// no trailing newline + new file
assert.equal(applyHunks('a\nb', computeHunks('a\nb', 'a\nc'), () => true), 'a\nc');
assert.equal(applyHunks('', computeHunks('', 'x\ny\n'), () => true), 'x\ny\n');
console.log('hunks: all tests passed');
