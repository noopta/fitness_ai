import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const executeOp = vi.fn();
vi.mock('../middleware/requireAuth.js', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 'u1' }; next(); } }));
vi.mock('../agent/toolkits/index.js', () => ({}));
vi.mock('../agent/ops.js', () => ({ executeOp: (...a: any[]) => executeOp(...a) }));
vi.mock('../agent/toolkits/prefs.js', () => ({ readPrefs: async () => ({ prefs: { unitPreference: 'imperial' }, notifications: { social: true }, consent: { logs: true } }) }));
vi.mock('../agent/toolkits/social.js', () => ({ readUsage: async () => ({ pro: false, food: { used: 1, limit: 7 } }) }));

let app: express.Express;
beforeAll(async () => {
  const { default: routes } = await import('../routes/settings.js');
  app = express(); app.use(express.json()); app.use('/api', routes);
});
beforeEach(() => { executeOp.mockReset(); executeOp.mockResolvedValue({ changeId: 'ch1', summary: 'Social · on → off' }); });

describe('/api/me/settings', () => {
  it('reads prefs, notifications, consent and usage together', async () => {
    const r = await request(app).get('/api/me/settings');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ prefs: { unitPreference: 'imperial' }, notifications: { social: true }, consent: { logs: true }, usage: { pro: false } });
  });
  it('writes through the same ops as chat, one per group', async () => {
    const r = await request(app).patch('/api/me/settings').send({ notifications: { social: false }, consent: { nutrition: false } });
    expect(r.status).toBe(200);
    expect(executeOp.mock.calls.map((c) => c[1])).toEqual(['notif.set', 'consent.set']);
    expect(executeOp.mock.calls[0][2]).toEqual({ values: { social: false } });
    expect(r.body.changes).toHaveLength(2);
  });
  it('400s on an empty patch and surfaces op validation errors', async () => {
    expect((await request(app).patch('/api/me/settings').send({})).status).toBe(400);
    executeOp.mockRejectedValueOnce(new Error('Reminder hour is 0–23.'));
    const r = await request(app).patch('/api/me/settings').send({ notifications: { reminderHour: 30 } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Reminder hour is 0–23.');
  });
});
