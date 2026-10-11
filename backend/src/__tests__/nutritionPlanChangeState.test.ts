// Plan changes for users without a gut plan or a program: a starter plan from
// their targets, and macros from the targets they set themselves.

import { describe, it, expect } from 'vitest';
import { planChanges, applyChanges, type StoredPlan } from '../services/nutritionPlanSummary.js';
import { computeMicroTargets } from '../services/microTargetsService.js';

const targets = computeMicroTargets({ sex: 'male', weightKg: 90 });
const starter: StoredPlan = {
  summary: 'Targets set with Anakin.',
  focusNutrients: targets.focus.map((key) => { const t = targets.targets.find((x) => x.key === key)!; return { key, label: t.label, target: t.target, unit: t.unit, why: '', foods: [], citationIds: [] }; }),
  gutProtocol: { principles: [] }, supplements: [], disclaimer: '', seeProfessional: false,
};

describe('post-surgery recovery card on a starter plan', () => {
  it('sets focus, raised targets, a timed supplement and macros in one change list', () => {
    const changes = planChanges({ plan: starter, targets, macros: { calories: 2500 } }, [
      { field: 'focus', to: ['vitamin C', 'zinc', 'omega-3', 'vitamin D'] },
      { field: 'vitaminCMg', to: 500 },
      { field: 'omega3G', to: 2 },
      { field: 'zincMg', to: 25 },
      { field: 'supplement', name: 'Collagen peptides + vitamin C', to: { dose: '15 g + 50 mg', when: '1 hour before physio' } },
      { field: 'calories', to: 2400 },
      { field: 'proteinG', to: 190 },
    ] as any);
    expect(changes.map((c) => c.kind)).toEqual(['focus', 'target', 'target', 'target', 'supplement', 'macro', 'macro']);
    expect(changes[1].row).toMatchObject({ key: 'Vitamin C target', to: '500 mg' });
    const next = applyChanges(starter, targets, changes.filter((c) => c.kind !== 'macro'), new Date('2026-10-11'));
    expect(next.targets.focus).toEqual(['vitaminCMg', 'zincMg', 'omega3G', 'vitaminDIU']);
    expect(next.targets.targets.find((t) => t.key === 'vitaminCMg')?.target).toBe(500);
    expect(next.plan.supplements[0]).toMatchObject({ name: 'Collagen peptides + vitamin C', when: '1 hour before physio' });
  });

  it('macro changes work from the user’s own targets when there is no program', () => {
    expect(planChanges({ plan: starter, targets, macros: { calories: 2500, proteinG: 180 } }, [{ field: 'proteinG', to: 190 }] as any)[0].row)
      .toMatchObject({ from: '180 g', to: '190 g' });
    expect(() => planChanges({ plan: starter, targets, macros: null }, [{ field: 'calories', to: 2400 }] as any)).toThrow(/no daily targets/);
  });
});
