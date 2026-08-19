import { describe, it, expect, vi } from 'vitest';

// PrismaClient is constructed at module load for the ContentFlag audit trail.
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.contentFlag = { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(0) };
  }),
}));

const { evaluateModeration, checkReservedName } = await import('../services/moderationService.js');

/** Build a classifier response with everything false except the named categories. */
function classifierResult(flagged: Record<string, number>) {
  const allCategories = [
    'sexual', 'sexual/minors', 'harassment', 'harassment/threatening',
    'hate', 'hate/threatening', 'violence', 'violence/graphic',
    'self-harm', 'self-harm/intent', 'self-harm/instructions', 'illicit/violent',
  ];
  const categories: Record<string, boolean> = {};
  const category_scores: Record<string, number> = {};
  for (const c of allCategories) {
    categories[c] = c in flagged;
    category_scores[c] = flagged[c] ?? 0;
  }
  return { categories, category_scores };
}

describe('evaluateModeration', () => {
  it('allows clean content', () => {
    const verdict = evaluateModeration(classifierResult({}));
    expect(verdict.allowed).toBe(true);
    expect(verdict.message).toBeNull();
    expect(verdict.needsSupport).toBe(false);
  });

  it('blocks explicit sexual content above the threshold', () => {
    const verdict = evaluateModeration(classifierResult({ sexual: 0.95 }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.blockedCategory).toBe('sexual');
    expect(verdict.message).toContain('sexually explicit');
  });

  it('lets borderline sexual scores through — gym content trips this constantly', () => {
    // A physique photo or a post about glute training scores non-zero here. The
    // threshold is what keeps ordinary fitness content from being rejected.
    const verdict = evaluateModeration(classifierResult({ sexual: 0.4 }));
    expect(verdict.allowed).toBe(true);
    // Still recorded, so the threshold can be tuned against real traffic.
    expect(verdict.flaggedCategories).toContain('sexual');
  });

  it('blocks sexual/minors at any score, ignoring the threshold', () => {
    const verdict = evaluateModeration(classifierResult({ 'sexual/minors': 0.05 }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.blockedCategory).toBe('sexual/minors');
  });

  it('blocks hate and threatening harassment', () => {
    expect(evaluateModeration(classifierResult({ hate: 0.9 })).allowed).toBe(false);
    expect(evaluateModeration(classifierResult({ 'harassment/threatening': 0.9 })).allowed).toBe(false);
  });

  it('FLAGS self-harm for support but never blocks it', () => {
    // The deliberate product decision: this is a nutrition app, and refusing a
    // message from someone struggling removes the one place they reached out.
    const verdict = evaluateModeration(classifierResult({ 'self-harm/intent': 0.9 }));
    expect(verdict.allowed).toBe(true);
    expect(verdict.needsSupport).toBe(true);
  });

  it('still blocks when self-harm co-occurs with a blocking category', () => {
    const verdict = evaluateModeration(classifierResult({ 'self-harm': 0.8, hate: 0.9 }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.needsSupport).toBe(true);
  });

  it('reports the highest score across flagged categories', () => {
    const verdict = evaluateModeration(classifierResult({ hate: 0.6, violence: 0.85 }));
    expect(verdict.topScore).toBeCloseTo(0.85);
  });
});

describe('checkReservedName', () => {
  it('allows ordinary usernames', () => {
    expect(checkReservedName('mike_lifts')).toBeNull();
    expect(checkReservedName('SquatQueen')).toBeNull();
    expect(checkReservedName('admiral_ackbar')).toBeNull();
  });

  it('blocks staff impersonation', () => {
    expect(checkReservedName('admin')).not.toBeNull();
    expect(checkReservedName('AxiomSupport')).not.toBeNull();
    expect(checkReservedName('axiom_official')).not.toBeNull();
    expect(checkReservedName('moderator')).not.toBeNull();
  });

  it('sees through leetspeak', () => {
    // The whole point of an impersonation check is that it survives the obvious
    // evasion — "4dm1n" reads as "admin" to every user who sees it.
    expect(checkReservedName('4dm1n')).not.toBeNull();
    expect(checkReservedName('4x10m_supp0rt')).not.toBeNull();
  });

  it('ignores empty input', () => {
    expect(checkReservedName('')).toBeNull();
    expect(checkReservedName('   ')).toBeNull();
  });
});
