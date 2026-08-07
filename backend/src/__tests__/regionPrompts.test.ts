// The load-bearing property here is the NEGATIVE one: for the 'global' region
// every block must be exactly '', so existing prompts are byte-identical and no
// current user's behaviour can drift. Everything else is additive.

import { describe, it, expect } from 'vitest';
import {
  regionPromptBlock,
  normalizeFoodRegion,
  isWestAfrican,
  type PromptKind,
} from '../services/prompts/regionPrompts.js';

const KINDS: PromptKind[] = ['text', 'photo', 'recipe', 'order', 'micros'];

describe('global region is a no-op', () => {
  it('returns empty string for every prompt kind', () => {
    for (const kind of KINDS) {
      expect(regionPromptBlock('global', kind), kind).toBe('');
    }
  });
});

describe('West African regions produce guidance', () => {
  it('returns a non-empty block for every kind and region', () => {
    for (const region of ['ng', 'gm', 'wa'] as const) {
      for (const kind of KINDS) {
        expect(regionPromptBlock(region, kind).length, `${region}/${kind}`).toBeGreaterThan(100);
      }
    }
  });

  it('names the right country', () => {
    expect(regionPromptBlock('ng', 'text')).toContain('Nigeria');
    expect(regionPromptBlock('gm', 'text')).toContain('The Gambia');
  });

  it('offers region-appropriate dishes', () => {
    expect(regionPromptBlock('ng', 'text')).toContain('Egusi soup');
    expect(regionPromptBlock('gm', 'text')).toContain('Domoda');
    // Pan-regional dishes appear for both.
    expect(regionPromptBlock('ng', 'text')).toContain('Jollof rice');
    expect(regionPromptBlock('gm', 'text')).toContain('Jollof rice');
  });
});

describe('the two corrections that actually change scoring', () => {
  it('lists local fermented foods, so the gut pillar stops reading zero', () => {
    // Without these the parser only knows kefir/kimchi/yoghurt and a user
    // eating iru daily scores zero on the fermented pillar forever.
    const block = regionPromptBlock('ng', 'text');
    for (const term of ['ogi', 'iru', 'dawadawa', 'ugba', 'wara', 'kunu']) {
      expect(block, term).toContain(term);
    }
    expect(block).toContain('fermentedFoods');
  });

  it('overrides the US plate anchor in the photo prompt', () => {
    const block = regionPromptBlock('ng', 'photo');
    expect(block).toContain('10-inch');   // explicitly tells the model to ignore it
    expect(block.toLowerCase()).toContain('swallow');
  });

  it('supplies local portion weights rather than US ones', () => {
    const block = regionPromptBlock('ng', 'text');
    for (const unit of ['wrap', 'ladle', 'derica', 'mudu', 'tuber']) {
      expect(block, unit).toContain(unit);
    }
  });

  it('flags palm oil in the micros prompt — it dominates vitamin A', () => {
    expect(regionPromptBlock('ng', 'micros')).toMatch(/palm oil/i);
    expect(regionPromptBlock('ng', 'micros')).toMatch(/vitamin A/i);
  });

  it('names local delivery apps in the order prompt', () => {
    const block = regionPromptBlock('ng', 'order');
    for (const app of ['Chowdeck', 'Glovo', 'Bolt Food', 'Jumia Food']) {
      expect(block, app).toContain(app);
    }
  });

  it('mentions local measures in the recipe prompt', () => {
    const block = regionPromptBlock('ng', 'recipe');
    expect(block).toContain('derica');
    expect(block).toContain('mudu');
  });
});

describe('normalizeFoodRegion', () => {
  it('accepts the valid regions', () => {
    expect(normalizeFoodRegion('ng')).toBe('ng');
    expect(normalizeFoodRegion('GM')).toBe('gm');
    expect(normalizeFoodRegion(' wa ')).toBe('wa');
    expect(normalizeFoodRegion('global')).toBe('global');
  });

  it('falls back to global for anything else', () => {
    // Must never throw — this value comes from a database column that older
    // rows and older clients may not have set.
    for (const bad of [undefined, null, '', 'nigeria', 'us', 42, {}, []]) {
      expect(normalizeFoodRegion(bad), String(bad)).toBe('global');
    }
  });
});

describe('isWestAfrican', () => {
  it('classifies correctly', () => {
    expect(isWestAfrican('ng')).toBe(true);
    expect(isWestAfrican('gm')).toBe(true);
    expect(isWestAfrican('wa')).toBe(true);
    expect(isWestAfrican('global')).toBe(false);
  });
});
