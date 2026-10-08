import { describe, it, expect, beforeEach } from 'vitest';
import { startRun, finishRun, inRun, agentProgress, turnStatus, currentRun, resetRunsForTests } from '../agent/turnRun.js';

describe('turnRun', () => {
  beforeEach(() => resetRunsForTests());
  it('allows one running turn per user', () => {
    const r = startRun('u1', 'make me a program', undefined, 1000)!;
    expect(r).toBeTruthy();
    expect(startRun('u1', 'again', undefined, 2000)).toBeNull();
    expect(startRun('u2', 'other user', undefined, 2000)).toBeTruthy();
    finishRun(r, 3000);
    expect(startRun('u1', 'next', undefined, 4000)).toBeTruthy();
  });
  it('a stuck turn stops blocking after 8 minutes', () => {
    startRun('u1', 'a', undefined, 0);
    expect(startRun('u1', 'b', undefined, 8 * 60_000 + 1)).toBeTruthy();
  });
  it('tools report progress inside the turn; the status shows the steps', async () => {
    const seen: string[] = [];
    const r = startRun('u1', 'make me a program', (s) => seen.push(`${s.verb} ${s.text}`))!;
    await inRun(r, async () => {
      expect(currentRun()).toBe(r);
      agentProgress('w', 'Reading', 'Writing your program');
      agentProgress('w', 'Drafted', '12-week program');
    });
    expect(seen).toEqual(['Reading Writing your program', 'Drafted 12-week program']);
    const st = turnStatus('u1');
    expect(st).toMatchObject({ running: true, message: 'make me a program' });
    expect(st.steps).toEqual([{ id: 'p:w', verb: 'Drafted', text: '12-week program' }]);
    finishRun(r);
    expect(turnStatus('u1').running).toBe(false);
    agentProgress('x', 'Reading', 'outside a turn — ignored');
    expect(turnStatus('u2').running).toBe(false);
  });
});
