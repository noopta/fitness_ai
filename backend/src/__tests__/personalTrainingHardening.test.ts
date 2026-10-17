// Oct 2026 audit — PT surfaces: a null notification override is a 400 (not a
// 500), notification email HTML escapes client strings, imports keep header
// rows only, and the batch routine reply is a fixed template.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) {}) }));

const { applyPatch, escapeHtml, SettingsError } = await import('../services/personalTraining/notifications.js');
const { headersOnly } = await import('../services/personalTraining/imports.js');
const { routineReplyTemplate } = await import('../services/personalTraining/checkins.js');

const current: any = { rules: {}, channels: { push: true, email: false }, overrides: [], quietStart: 21, quietEnd: 7 };

describe('applyPatch overrides', () => {
  it('rejects a null / malformed override with a SettingsError (→ 400)', () => {
    for (const bad of [null, 'x', 7, {}, { clientId: 'c1' }]) {
      expect(() => applyPatch(current, { overrides: [bad as any] } as any, new Set(['c1']))).toThrow(SettingsError);
    }
  });
});

describe('escapeHtml', () => {
  it('escapes markup in client-supplied strings', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)"> & \'q\'')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;q&#39;');
    expect(escapeHtml(null)).toBe('');
  });
});

describe('headersOnly', () => {
  it('keeps each sheet name and its first row only', () => {
    const raw = JSON.stringify([{ name: 'Clients', rows: [['Name', 'Email'], ['Priya', 'p@x.com']] }, { name: 'Empty', rows: [] }]);
    expect(JSON.parse(headersOnly(raw))).toEqual([{ name: 'Clients', rows: [['Name', 'Email']] }, { name: 'Empty', rows: [] }]);
  });
  it('degrades to an empty list on garbage', () => {
    expect(headersOnly('{nope')).toBe('[]');
  });
});

describe('routineReplyTemplate', () => {
  it('is deterministic and uses only the first name', () => {
    expect(routineReplyTemplate('Jordan Lee')).toBe(routineReplyTemplate('Jordan Lee'));
    expect(routineReplyTemplate('Jordan Lee')).toMatch(/^Thanks for checking in, Jordan\./);
    expect(routineReplyTemplate(null)).toMatch(/^Thanks for checking in\./);
  });
});
