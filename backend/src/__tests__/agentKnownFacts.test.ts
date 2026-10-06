import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.user = {}; }) }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn() }));

import { factsFromProfile } from '../agent/profile/coachProfile.js';

describe('factsFromProfile — "What Anakin knows" from the intake', () => {
  it('lists set fields with display labels, in registry order', () => {
    const facts = factsFromProfile({ goal: 'Bench 225 by summer', trainingAge: 'intermediate', equipment: 'commercial', dietaryRestrictions: ['halal_kosher'] }, []);
    expect(facts).toEqual([
      { label: 'Main goal', value: 'Bench 225 by summer' },
      { label: 'Training experience', value: 'Intermediate' },
      { label: 'Equipment', value: 'Full gym' },
      { label: 'Diet', value: 'Halal or kosher' },
    ]);
  });

  it('skips unset values and private health answers', () => {
    const facts = factsFromProfile({ goal: '', aestheticGoals: [], medications: 'metformin', medicalConditions: ['asthma'], parq: ['dizziness'], hormonal: 'x' }, []);
    expect(facts).toEqual([]);
  });

  it('adds open injuries and drops resolved ones', () => {
    const facts = factsFromProfile({}, [
      { area: 'Left shoulder', note: 'pinches on overhead press' },
      { area: 'Knee', resolvedAt: '2026-09-01' },
      { area: '  ' },
    ]);
    expect(facts).toEqual([{ label: 'Injury', value: 'Left shoulder — pinches on overhead press' }]);
  });
});
