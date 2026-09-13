// The alerting pipeline existed on 2026-08-07 and stayed silent, because the
// route caught its own error and answered 500 directly — never calling
// next(err), so the central handler (which owns PostHog + SMS) never ran.
// ~147 routes do that and none call next(err). This middleware closes the gap
// at the response layer, so these tests are about the guarantee "a 5xx leaving
// the process is reported exactly once, however it was produced".

import { describe, it, expect, vi, beforeEach } from 'vitest';

const alertServerError = vi.fn(async () => {});
const captureException = vi.fn();

vi.mock('../services/errorAlertService.js', () => ({
  alertServerError: (...a: any[]) => alertServerError(...a),
}));
vi.mock('../services/posthogClient.js', () => ({
  default: { captureException: (...a: any[]) => captureException(...a) },
}));

const { errorReporting, reportServerError } = await import('../middleware/errorReporting.js');

function mkReq(over: any = {}) {
  return { method: 'GET', path: '/workouts/2026-08-07', route: { path: '/workouts/:date' }, ...over } as any;
}

/** Minimal res whose json/send record what was written. */
function mkRes(statusCode = 200) {
  const res: any = { statusCode, written: undefined };
  res.json = (b: any) => { res.written = b; return res; };
  res.send = (b: any) => { res.written = b; return res; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  return res;
}

function run(req: any, res: any) {
  const next = vi.fn();
  errorReporting(req, res, next);
  expect(next).toHaveBeenCalled();
}

beforeEach(() => {
  alertServerError.mockClear();
  captureException.mockClear();
});

describe('errorReporting — the Aug 7 shape', () => {
  it('reports a hand-rolled res.status(500).json() that never called next(err)', () => {
    const req = mkReq(); const res = mkRes();
    run(req, res);
    // Exactly what routes/workouts.ts did.
    res.status(500).json({ error: 'Failed to fetch workout log' });

    expect(alertServerError).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledOnce();
    const [err, route, method, status] = alertServerError.mock.calls[0] as any[];
    expect((err as Error).message).toBe('Failed to fetch workout log');
    expect(route).toBe('/workouts/:date');   // parameterised, so alerts group
    expect(method).toBe('GET');
    expect(status).toBe(500);
  });

  it('still forwards the original body to the client', () => {
    const req = mkReq(); const res = mkRes();
    run(req, res);
    res.status(500).json({ error: 'boom' });
    expect(res.written).toEqual({ error: 'boom' });
  });

  it('reports only once even though res.json delegates to res.send', () => {
    const req = mkReq(); const res = mkRes();
    run(req, res);
    res.status(500).json({ error: 'boom' });
    res.send('boom again');
    expect(alertServerError).toHaveBeenCalledOnce();
  });
});

describe('errorReporting — what must NOT be reported', () => {
  it('ignores 2xx and 4xx', () => {
    for (const code of [200, 201, 304, 400, 401, 404, 429]) {
      const req = mkReq(); const res = mkRes();
      run(req, res);
      res.status(code).json({ ok: true });
      expect(alertServerError, `status ${code}`).not.toHaveBeenCalled();
    }
  });

  it('does report other 5xx codes', () => {
    const req = mkReq(); const res = mkRes();
    run(req, res);
    res.status(503).json({ error: 'unavailable' });
    expect(alertServerError).toHaveBeenCalledOnce();
    expect((alertServerError.mock.calls[0] as any[])[3]).toBe(503);
  });
});

describe('reportServerError — shared latch with the central handler', () => {
  it('does not double-report when the handler reported first', () => {
    const req = mkReq(); const res = mkRes();
    run(req, res);
    // Central handler path: real Error, real stack.
    reportServerError(new SyntaxError('Unexpected token S'), req, res, 500);
    expect(alertServerError).toHaveBeenCalledOnce();

    // The response it then writes must not be reported a second time.
    res.status(500).json({ error: 'Unexpected token S' });
    expect(alertServerError).toHaveBeenCalledOnce();
    expect((alertServerError.mock.calls[0] as any[])[0]).toBeInstanceOf(SyntaxError);
  });

  it('attaches the user id when present', () => {
    const req = mkReq({ user: { id: 'u_123' } }); const res = mkRes();
    run(req, res);
    res.status(500).json({ error: 'boom' });
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), 'u_123');
  });
});

describe('errorReporting — never breaks the response', () => {
  it('still sends when the alerter throws', () => {
    alertServerError.mockImplementationOnce(() => { throw new Error('twilio down'); });
    const req = mkReq(); const res = mkRes();
    run(req, res);
    expect(() => res.status(500).json({ error: 'boom' })).not.toThrow();
    expect(res.written).toEqual({ error: 'boom' });
  });

  it('handles bodies with no message to extract', () => {
    for (const body of [undefined, null, '', 'plain string', { nope: 1 }]) {
      const req = mkReq(); const res = mkRes();
      run(req, res);
      expect(() => res.status(500).json(body)).not.toThrow();
    }
    expect(alertServerError).toHaveBeenCalledTimes(5);
  });
});
