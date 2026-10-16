/**
 * Client portal helpers: photo sizing, brand-colour contrast, units, and the
 * fetcher that carries the secret link (and never the Axiom session).
 */

import { describe, it, expect, vi } from 'vitest';
import { PersonalTrainingApiError } from '@axiom/personal-training-core';
import {
  accentVars, checkInMinutes, contrastRatio, fitWithin, localDateISO, parseHex, relativeLuminance, stripDataUrl, textOn, unitFor,
} from '@/features/pt-portal/helpers';
import { createPortalClient, isInactiveLinkError, isPhotosUnavailable, makePortalFetcher } from '@/features/pt-portal/api';

describe('fitWithin', () => {
  it('scales a landscape image down to 1600 on the long edge', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
  });
  it('scales a portrait image by its height', () => {
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });
  it('never upscales a small image', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });
  it('keeps very thin images at least a pixel wide', () => {
    expect(fitWithin(10000, 2)).toEqual({ width: 1600, height: 1 });
  });
  it('rounds to whole pixels and honours a custom edge', () => {
    expect(fitWithin(1000, 333, 500)).toEqual({ width: 500, height: 167 });
  });
  it('returns zero for unusable dimensions', () => {
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(NaN, 100)).toEqual({ width: 0, height: 0 });
  });
});

describe('brand colour contrast', () => {
  it('parses short and long hex, rejects anything else', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('1a2B3c')).toEqual([26, 43, 60]);
    expect(parseHex('red')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex(null)).toBeNull();
  });
  it('computes WCAG luminance at the extremes', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 5);
  });
  it('puts white on dark brands and ink on light ones', () => {
    expect(textOn('#1e3a8a')).toBe('#ffffff'); // navy
    expect(textOn('#000000')).toBe('#ffffff');
    expect(textOn('#facc15')).toBe('#09090b'); // yellow
    expect(textOn('#ffffff')).toBe('#09090b');
    expect(textOn('#22c55e')).toBe('#09090b'); // mid green reads better with ink
    expect(textOn('nope')).toBeNull();
  });
  it('falls back to the app ink when there is no usable brand colour', () => {
    expect(accentVars(null)['--portal-accent']).toBe('hsl(var(--foreground))');
    expect(accentVars('#ABC')).toEqual({ '--portal-accent': '#aabbcc', '--portal-on-accent': '#09090b' });
  });
});

describe('units and small formatters', () => {
  it('uses cm with kg and inches with lb', () => {
    expect(unitFor('bodyweight', 'kg')).toBe('kg');
    expect(unitFor('bodyweight', 'lb')).toBe('lb');
    expect(unitFor('waist', 'kg')).toBe('cm');
    expect(unitFor('thigh', 'lb')).toBe('in');
    expect(unitFor('body_fat', 'lb')).toBe('%');
    expect(unitFor('resting_hr', 'kg')).toBe('bpm');
  });
  it('estimates minutes from the question count', () => {
    expect(checkInMinutes(0)).toBe(1);
    expect(checkInMinutes(5)).toBe(2);
  });
  it('formats the local calendar date', () => {
    expect(localDateISO(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
  it('strips a data URL prefix', () => {
    expect(stripDataUrl('data:image/jpeg;base64,AAAA')).toBe('AAAA');
    expect(stripDataUrl('AAAA')).toBe('AAAA');
  });
});

describe('portal fetcher', () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('sends the link as a PtLink header and never sends cookies', async () => {
    const fetchImpl = vi.fn(async () => ok({ messages: [] }));
    const api = createPortalClient('tok_abc', { base: 'https://api.test/api', fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.messages();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/pt-portal/messages');
    expect(init.credentials).toBe('omit');
    expect((init.headers as Record<string, string>).Authorization).toBe('PtLink tok_abc');
    expect(init.method).toBe('GET');
  });

  it('posts JSON bodies with a content type', async () => {
    const fetchImpl = vi.fn(async () => ok({ message: { id: 'm1', fromClient: true, body: 'hi', at: 'x' } }, 201));
    const api = createPortalClient('t', { base: '', fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.sendMessage('hi');
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ text: 'hi' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.credentials).toBe('omit');
  });

  it('types errors and reports an inactive link', async () => {
    const onInactive = vi.fn();
    const fetchImpl = vi.fn(async () => ok({ error: 'This link is no longer active.', code: 'link_inactive' }, 404));
    const fetcher = makePortalFetcher('t', { base: '', fetchImpl: fetchImpl as unknown as typeof fetch, onInactive });
    const err = await fetcher('/pt-portal/home').catch((e) => e);
    expect(err).toBeInstanceOf(PersonalTrainingApiError);
    expect(err.status).toBe(404);
    expect(isInactiveLinkError(err)).toBe(true);
    expect(onInactive).toHaveBeenCalledTimes(1);
  });

  it('tells a 503 photo upload apart from other errors', async () => {
    const fetchImpl = vi.fn(async () => ok({ error: 'Photo storage is not set up on this server' }, 503));
    const api = createPortalClient('t', { base: '', fetchImpl: fetchImpl as unknown as typeof fetch });
    const err = await api.addPhoto({ imageBase64: 'x'.repeat(200), pose: 'front' }).catch((e) => e);
    expect(isPhotosUnavailable(err)).toBe(true);
    expect(isInactiveLinkError(err)).toBe(false);
  });

  it('turns a network failure into a friendly typed error', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const err = await makePortalFetcher('t', { base: '', fetchImpl: fetchImpl as unknown as typeof fetch })('/pt-portal/home').catch((e) => e);
    expect(err).toBeInstanceOf(PersonalTrainingApiError);
    expect(err.message).toMatch(/offline/);
  });
});
