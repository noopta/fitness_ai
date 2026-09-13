import { describe, it, expect } from 'vitest';
import { safeReturnPath } from '../services/checkoutReturn.js';

describe('safeReturnPath', () => {
  it('keeps same-site paths so Checkout returns to the page that opened it', () => {
    expect(safeReturnPath('/diagnostics/11111111-2222-4333-8444-555555555555')).toBe('/diagnostics/11111111-2222-4333-8444-555555555555');
    expect(safeReturnPath('/diagnostics/new')).toBe('/diagnostics/new');
  });

  it('rejects anything that could leave the site', () => {
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '/a?next=//x', '/a#b', 42, undefined]) {
      expect(safeReturnPath(bad)).toBe('');
    }
  });
});
