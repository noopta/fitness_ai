// The unit tests use a hand-rolled `res`, which does NOT model the fact that
// real Express res.json() delegates to res.send(). Since both are patched,
// that delegation is the most likely way this middleware could double-alert in
// production. These tests run it through a real Express app so the guarantee
// is proven against the real object, not against a mock that agrees with me.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const alertServerError = vi.fn(async () => {});
const captureException = vi.fn();

vi.mock('../services/errorAlertService.js', () => ({
  alertServerError: (...a: any[]) => alertServerError(...a),
}));
vi.mock('../services/posthogClient.js', () => ({
  default: { captureException: (...a: any[]) => captureException(...a) },
}));

const { errorReporting, reportServerError } = await import('../middleware/errorReporting.js');

function makeApp(mount: (app: express.Express) => void) {
  const app = express();
  app.use(errorReporting);
  mount(app);
  // Mirrors index.ts: central handler reports through the shared latch.
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err?.status ?? 500;
    if (status >= 500) reportServerError(err, req, res, status);
    res.status(status).json({ error: err?.message ?? 'Internal server error' });
  });
  return app;
}

beforeEach(() => {
  alertServerError.mockClear();
  captureException.mockClear();
});

describe('errorReporting through real Express', () => {
  it('reports exactly once for a hand-rolled 500 (the Aug 7 shape)', async () => {
    // Literally what GET /workouts/:date did: catch, log, respond 500.
    const app = makeApp(a => a.get('/workouts/:date', (_req, res) => {
      try {
        JSON.parse('Squats - 1');           // the real poisoned column value
      } catch {
        return res.status(500).json({ error: 'Failed to fetch workout log' });
      }
    }));

    const r = await request(app).get('/workouts/2026-08-07');
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'Failed to fetch workout log' });
    // The bug: this was 0 before the middleware existed.
    expect(alertServerError).toHaveBeenCalledOnce();
    expect((alertServerError.mock.calls[0] as any[])[1]).toBe('/workouts/:date');
  });

  it('reports exactly once for a thrown error routed to the central handler', async () => {
    const app = makeApp(a => a.get('/boom', () => { throw new Error('kaboom'); }));
    const r = await request(app).get('/boom');
    expect(r.status).toBe(500);
    expect(alertServerError).toHaveBeenCalledOnce();
    // Real stack preserved on this path, unlike a swallowed one.
    expect((alertServerError.mock.calls[0] as any[])[0]).toBeInstanceOf(Error);
    expect((alertServerError.mock.calls[0] as any[])[0].message).toBe('kaboom');
  });

  it('does not report successful or 4xx responses', async () => {
    const app = makeApp(a => {
      a.get('/ok', (_q, res) => { res.json({ ok: true }); });
      a.get('/missing', (_q, res) => { res.status(404).json({ error: 'nope' }); });
    });
    expect((await request(app).get('/ok')).status).toBe(200);
    expect((await request(app).get('/missing')).status).toBe(404);
    expect(alertServerError).not.toHaveBeenCalled();
  });

  it('reports once for res.send (not res.json) too', async () => {
    const app = makeApp(a => a.get('/text', (_q, res) => { res.status(500).send('plain failure'); }));
    const r = await request(app).get('/text');
    expect(r.status).toBe(500);
    expect(alertServerError).toHaveBeenCalledOnce();
  });

  it('leaves the response body and status byte-identical', async () => {
    const body = { error: 'Failed to fetch workout log', code: 'E_PARSE', nested: { a: [1, 2] } };
    const app = makeApp(a => a.get('/x', (_q, res) => { res.status(503).json(body); }));
    const r = await request(app).get('/x');
    expect(r.status).toBe(503);
    expect(r.body).toEqual(body);
  });

  it('a failing alerter cannot break the user response', async () => {
    alertServerError.mockImplementationOnce(() => { throw new Error('twilio down'); });
    const app = makeApp(a => a.get('/x', (_q, res) => { res.status(500).json({ error: 'boom' }); }));
    const r = await request(app).get('/x');
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'boom' });
  });
});
