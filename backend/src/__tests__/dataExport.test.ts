// Data export (Oct 2026 audit): a Train Together pin exports only the
// requesting member's fit cards, pins they were invited to are included, and
// trainer-held client records come along.
import { describe, it, expect, vi } from 'vitest';

const calls: Record<string, any[]> = {};
const rows: Record<string, any[]> = {
  partnerWorkout: [{
    id: 'pin1', creatorId: 'friend', date: '2026-10-01',
    sharedFitJson: JSON.stringify({ me: [{ heading: 'Mine' }], friend: [{ heading: 'Theirs' }] }),
  }],
  ptGoal: [{ id: 'g1', clientId: 'me', text: 'Squat 140' }],
};

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    return new Proxy({}, {
      get: (_t, model: string) => ({
        findUnique: vi.fn(async () => ({ id: 'me', email: 'me@axiom.io' })),
        findMany: vi.fn(async (args: any) => {
          (calls[model] ??= []).push(args);
          return rows[model] ?? [];
        }),
      }),
    });
  }),
}));

const { buildUserDataExport, scopePartnerWorkoutForExport } = await import('../services/dataExportService.js');

describe('scopePartnerWorkoutForExport', () => {
  it('keeps only the requesting member\'s fit cards', () => {
    const out = scopePartnerWorkoutForExport(rows.partnerWorkout[0], 'me');
    expect(JSON.parse(out.sharedFitJson!)).toEqual({ me: [{ heading: 'Mine' }] });
  });
  it('nulls the column when the member has no cards or it is garbage', () => {
    expect(scopePartnerWorkoutForExport({ sharedFitJson: JSON.stringify({ friend: [] }) }, 'me').sharedFitJson).toBeNull();
    expect(scopePartnerWorkoutForExport({ sharedFitJson: '{nope' }, 'me').sharedFitJson).toBeNull();
  });
});

describe('buildUserDataExport', () => {
  it('includes invited pins (scoped) and trainer-held records', async () => {
    const out = await buildUserDataExport('me');
    const pins = out.social.partnerWorkouts as any[];
    expect(pins).toHaveLength(1);
    expect(pins[0].sharedFitJson).not.toContain('Theirs');
    expect(calls.partnerWorkout[0].where.OR).toEqual([{ creatorId: 'me' }, { members: { some: { userId: 'me' } } }]);
    expect(out.heldByTrainers.goals).toEqual([{ id: 'g1', clientId: 'me', text: 'Squat 140' }]);
    expect(calls.ptGoal[0].where).toEqual({ clientId: 'me' });
    // Photo bytes/keys never exported, only metadata.
    expect(calls.ptProgressPhoto[0].select.blobKey).toBeUndefined();
  });
});
