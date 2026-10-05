// A meal logged from Fuel's food search, opened from chat (bug fixes 5 Oct
// 2026, 4b), lands in the thread as a Logged card that owns its Undo.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.AGENT_ENABLED = 'true';

const executeOp = vi.fn();
const saveCard = vi.fn();
const appendInitiated = vi.fn();
vi.mock('../middleware/requireAuth.js', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 'me' }; next(); } }));
vi.mock('../agent/toolkits/index.js', () => ({}));
vi.mock('../agent/ops.js', () => ({
  executeOp: (...a: unknown[]) => executeOp(...a),
  withWriteGuard: (_w: string, _t: string, fn: () => unknown) => fn(),
  revertChange: vi.fn(), listChanges: vi.fn(),
  UndoError: class UndoError extends Error {},
}));
vi.mock('../agent/cards/store.js', () => ({
  saveCard: (...a: unknown[]) => saveCard(...a),
  applyCardAction: vi.fn(), undoCard: vi.fn(), editCardField: vi.fn(), toggleCardField: vi.fn(), answerCard: vi.fn(), editDraftBody: vi.fn(), getCard: vi.fn(),
  CardError: class CardError extends Error { status = 400; },
}));
vi.mock('../agent/conversation.js', () => ({ appendInitiated: (...a: unknown[]) => appendInitiated(...a) }));
vi.mock('../agent/cardNotes.js', () => ({ cardRef: (c: any) => ({ id: c.id, fn: c.fn }) }));

let app: express.Express;
beforeAll(async () => {
  const { default: routes } = await import('../routes/agentCards.js');
  app = express(); app.use(express.json()); app.use('/api', routes);
});
beforeEach(() => { vi.clearAllMocks(); });

describe('POST /coach/agent/cards/logged', () => {
  it('runs the capture op, saves the Logged card with its change, and appends it to the thread', async () => {
    const change = { changeId: 'c1', undoUntil: null, reversible: true, result: { nextCard: { fn: 'NUT-02', pattern: 'logged', rule: 'log_undo' } } };
    executeOp.mockResolvedValue(change);
    saveCard.mockResolvedValue({ id: 'card1', fn: 'NUT-02' });
    const r = await request(app).post('/api/coach/agent/cards/logged').send({ mealIds: ['m1'] });
    expect(r.status).toBe(200);
    expect(executeOp).toHaveBeenCalledWith('me', 'capture.meal_logged', { value: 'm1' });
    expect(saveCard).toHaveBeenCalledWith('me', change.result.nextCard, { change });
    expect(appendInitiated).toHaveBeenCalledWith('me', '', [{ id: 'card1', fn: 'NUT-02' }]);
    expect(r.body.card.id).toBe('card1');
  });

  it('rejects an empty list', async () => {
    const r = await request(app).post('/api/coach/agent/cards/logged').send({ mealIds: [] });
    expect(r.status).toBe(400);
    expect(executeOp).not.toHaveBeenCalled();
  });
});
