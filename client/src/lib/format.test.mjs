// node src/lib/format.test.mjs — checks the wording rules the screens rely on.
import assert from 'node:assert/strict';
const { formatAmount, formatSigned, formatTime } = await import('./format.ts');
assert.equal(formatAmount(1280), '1,280');
assert.equal(formatSigned(50), '+50');
assert.equal(formatSigned(-20), '−20');
assert.equal(formatTime('2026-10-27T06:20:00Z', new Date('2026-12-01T00:00:00Z')), '10月27日 14:20');
assert.equal(formatTime('2025-01-02T01:05:00Z', new Date('2026-12-01T00:00:00Z')), '2025年1月2日 09:05');
console.log('format ok');
