// Analytics may carry counts, timings and labels — never what someone wrote or ate.
import { describe, it, expect, vi } from 'vitest';

const capture = vi.fn();
vi.mock('../services/posthogClient.js', () => ({ default: { capture: (...a: any[]) => { capture(...a); } } }));
const { cleanProps, track } = await import('../services/productEvents.js');

describe('cleanProps', () => {
  it('keeps numbers, booleans and short labels', () => {
    expect(cleanProps({ ms: 1200, stream: true, step: 'web', tools: ['log_meal', 'read_today'] })).toEqual({ ms: 1200, stream: true, step: 'web', tools: ['log_meal', 'read_today'] });
  });
  it('drops anything under a key that names content', () => {
    expect(cleanProps({ name: 'x', message: 'x', email: 'x', description: 'x', brand: 'x', product: 'x', food_name: 'x', text: 'x', notes: 'x' })).toEqual({});
  });
  it('drops free text under any key, so a careless call site cannot leak it', () => {
    expect(cleanProps({ reason: 'I ate two slices of pizza at Osmow’s', source: 'agent-manual', label: 'a'.repeat(49) })).toEqual({ source: 'agent-manual' });
    expect(cleanProps({ list: ['ok_label', 'free text here'] })).toEqual({ list: ['ok_label'] });
  });
  it('drops null, undefined, NaN and Infinity', () => {
    expect(cleanProps({ a: null, b: undefined, c: NaN, d: Infinity, e: 0 })).toEqual({ e: 0 });
  });
});

describe('track', () => {
  it('sends the cleaned event under the user id', () => {
    capture.mockClear();
    track('u1', 'agent_turn', { ms: 5, message: 'secret' });
    expect(capture).toHaveBeenCalledWith({ distinctId: 'u1', event: 'agent_turn', properties: { ms: 5 } });
  });
  it('skips a call with no user, and never throws', () => {
    capture.mockClear();
    track(null, 'x');
    expect(capture).not.toHaveBeenCalled();
    capture.mockImplementationOnce(() => { throw new Error('down'); });
    expect(() => track('u1', 'x')).not.toThrow();
  });
});
