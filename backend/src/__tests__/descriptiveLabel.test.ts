// Regression tests for descriptiveLabel() — the guard against a cosmetic label
// mismatch destroying a real meal log.
//
// The 2026-08-03 production incident: iOS shipped the barcode scanner, the
// backend enum didn't know 'barcode', and every scanned meal 400'd. The first
// test below is that incident; it fails against a strict z.enum().

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  descriptiveLabel,
  KNOWN_MEAL_SOURCES,
  KNOWN_PARSE_CONFIDENCE,
} from '../validation/descriptiveLabel.js';

// A miniature stand-in for mealEntrySchema: one real field the user cares about
// plus the descriptive label, so we can assert the label never takes the meal
// down with it.
const schema = z.object({
  name: z.string().min(1),
  source: descriptiveLabel(KNOWN_MEAL_SOURCES, 'manual'),
});

describe('descriptiveLabel — the barcode incident', () => {
  it('accepts a label the server does not know yet, instead of rejecting the log', () => {
    // Exactly the payload prod rejected on 2026-08-03.
    const result = schema.safeParse({ name: 'Clif Bar', source: 'barcode' });

    expect(result.success).toBe(true);
    expect(result.data?.source).toBe('barcode');
  });

  it('preserves hyphenated sources already present in production data', () => {
    // 'order-scan', 'agent-manual' and 'agent-parsed' exist in the prod
    // MealEntry table (written via prisma directly). If one is ever routed
    // through this schema it must keep its identity, not collapse to 'manual'.
    for (const source of ['order-scan', 'agent-manual', 'agent-parsed']) {
      expect(schema.parse({ name: 'x', source }).source).toBe(source);
    }
  });

  it('lets a FUTURE client ship an entry method with no backend deploy', () => {
    // The real test of the fix: a source nobody has written down anywhere.
    const result = schema.safeParse({ name: 'Oat milk', source: 'fridge_camera' });

    expect(result.success).toBe(true);
    // Stored as sent, so analytics attributes it correctly on day one.
    expect(result.data?.source).toBe('fridge_camera');
  });

  it('never fails the write — the meal survives any label', () => {
    const labels = ['barcode', 'nfc_tag', 'WIDGET', '  Voice  ', '', null, undefined, 42, {}, []];

    for (const source of labels) {
      const result = schema.safeParse({ name: 'Chicken and rice', source });
      expect(result.success, `label ${JSON.stringify(source)} rejected the meal`).toBe(true);
      expect(typeof result.data?.source).toBe('string');
    }
  });
});

describe('descriptiveLabel — normalisation', () => {
  it('passes known labels through unchanged', () => {
    for (const known of KNOWN_MEAL_SOURCES) {
      expect(schema.parse({ name: 'x', source: known }).source).toBe(known);
    }
  });

  it('normalises case and surrounding whitespace onto a known label', () => {
    expect(schema.parse({ name: 'x', source: '  PHOTO ' }).source).toBe('photo');
    expect(schema.parse({ name: 'x', source: 'Saved_Food' }).source).toBe('saved_food');
  });

  it('falls back when the label is absent or not a string', () => {
    expect(schema.parse({ name: 'x' }).source).toBe('manual');
    expect(schema.parse({ name: 'x', source: undefined }).source).toBe('manual');
    expect(schema.parse({ name: 'x', source: null }).source).toBe('manual');
    expect(schema.parse({ name: 'x', source: 7 }).source).toBe('manual');
    expect(schema.parse({ name: 'x', source: { a: 1 } }).source).toBe('manual');
  });
});

describe('descriptiveLabel — malformed input still cannot reach the column', () => {
  it('rejects junk that is not a plausible client label', () => {
    const junk = [
      '',                        // empty
      '   ',                     // whitespace only
      '9lives',                  // leading digit
      '_leading',                // leading underscore
      'has spaces',
      'punctuation!',
      "'; DROP TABLE MealEntry--",
      '<script>alert(1)</script>',
      'a'.repeat(33),            // over the length bound
    ];

    for (const source of junk) {
      expect(schema.parse({ name: 'x', source }).source, `"${source}" leaked through`).toBe('manual');
    }
  });

  it('accepts a slug at exactly the length bound but not past it', () => {
    const atBound = 'a' + 'b'.repeat(31);   // 32 chars
    expect(atBound).toHaveLength(32);
    expect(schema.parse({ name: 'x', source: atBound }).source).toBe(atBound);
    expect(schema.parse({ name: 'x', source: atBound + 'c' }).source).toBe('manual');
  });
});

describe('descriptiveLabel — operator feedback', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('warns when it accepts an unfamiliar label, so the known list can catch up', () => {
    schema.parse({ name: 'x', source: 'fridge_camera' });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('fridge_camera');
  });

  it('stays quiet for known labels and for fallbacks', () => {
    schema.parse({ name: 'x', source: 'barcode' });
    schema.parse({ name: 'x', source: 'has spaces' });

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('descriptiveLabel — null fallback (parseConfidence)', () => {
  const confidence = z.object({
    parseConfidence: descriptiveLabel(KNOWN_PARSE_CONFIDENCE, null),
  });

  it('yields null rather than a string when absent, matching the nullable column', () => {
    expect(confidence.parse({}).parseConfidence).toBeNull();
    expect(confidence.parse({ parseConfidence: 'bad value!' }).parseConfidence).toBeNull();
  });

  it('still passes real confidence values through', () => {
    expect(confidence.parse({ parseConfidence: 'high' }).parseConfidence).toBe('high');
    expect(confidence.parse({ parseConfidence: 'LOW' }).parseConfidence).toBe('low');
  });
});
