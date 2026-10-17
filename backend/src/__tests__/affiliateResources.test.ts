// Affiliate enablement resources: manifest validation, token-gated listing,
// short-lived signed file links, and the signature-only file route.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const store = vi.hoisted(() => ({ affiliates: [] as any[] }));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.affiliate = {
      findUnique: vi.fn(async (a: any) => {
        if (a.where.inviteToken !== undefined) return store.affiliates.find(x => x.inviteToken === a.where.inviteToken) ?? null;
        if (a.where.id !== undefined) return store.affiliates.find(x => x.id === a.where.id) ?? null;
        return null;
      }),
      update: vi.fn(),
    };
  }),
}));
vi.mock('../services/affiliateService.js', () => ({
  generateOnboardingLink: vi.fn(), generateDashboardLink: vi.fn(), checkAndUpdateOnboardingStatus: vi.fn(),
  getAffiliateDashboard: vi.fn(), inviteAffiliate: vi.fn(), runMonthlyPayouts: vi.fn(),
}));
vi.mock('../middleware/requireAuth.js', () => ({ requireAuth: (_req: any, res: any) => res.status(401).json({ error: 'auth' }) }));
vi.mock('../middleware/requireAdmin.js', () => ({ requireAdmin: (_req: any, _res: any, next: any) => next() }));

process.env.API_PUBLIC_URL = 'https://api.example.test/api';

import affiliatesRouter from '../routes/affiliates.js';
import { loadManifest, listResources, resetAffiliateResourcesCache, AffiliateResourcesManifestError } from '../services/affiliateResources.js';
import { signLink, verifyLink } from '../services/signedLinks.js';

const app = express();
app.use(express.json());
app.use('/api', affiliatesRouter);

const ACTIVE = { id: 'aff-1', name: 'A', email: 'a@x.com', inviteToken: 'tok-active', active: true, onboarded: true };
const INACTIVE = { id: 'aff-2', name: 'B', email: 'b@x.com', inviteToken: 'tok-inactive', active: false, onboarded: false };

const REAL_DIR = join(process.cwd(), 'data', 'affiliate-resources');

function entry(over: Record<string, unknown> = {}) {
  return { slug: 'doc', title: 'Doc', description: 'd', file: 'doc.pdf', category: 'Outreach', updatedAt: '2026-10-16', audience: 'general', ...over };
}

function linkParams(url: string) {
  const u = new URL(url);
  return { path: u.pathname.replace(/^\/api/, ''), search: u.search };
}

beforeEach(() => {
  store.affiliates = [{ ...ACTIVE }, { ...INACTIVE }];
  delete process.env.AFFILIATE_RESOURCES_DIR;
  resetAffiliateResourcesCache();
});
afterEach(() => { vi.useRealTimers(); });

describe('manifest validation', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'affres-'));
    writeFileSync(join(dir, 'doc.pdf'), '%PDF-1.4 test');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    mkdirSync(join(dir, 'sub'));
  });

  it('the shipped manifest is valid and every file exists', () => {
    const items = loadManifest(REAL_DIR);
    expect(items.map(i => i.slug).sort()).toEqual(['affiliate-playbook', 'outreach-guide']);
    for (const i of items) expect(i.sizeBytes).toBeGreaterThan(1000);
  });

  it('accepts a well-formed entry', () => {
    const [r] = loadManifest(dir, [entry()]);
    expect(r.fileName).toBe('doc.pdf');
    expect(r.sizeBytes).toBe('%PDF-1.4 test'.length);
  });

  it('rejects path traversal and absolute paths', () => {
    writeFileSync(join(dir, '..', 'escape.pdf'), '%PDF');
    expect(() => loadManifest(dir, [entry({ file: '../escape.pdf' })])).toThrow(AffiliateResourcesManifestError);
    expect(() => loadManifest(dir, [entry({ file: join(dir, '..', 'escape.pdf') })])).toThrow(/escapes/);
    expect(() => loadManifest(dir, [entry({ file: 'sub/../../escape.pdf' })])).toThrow(/escapes/);
  });

  it('rejects bad slugs, non-pdf files, missing files, bad categories, duplicates', () => {
    expect(() => loadManifest(dir, [entry({ slug: 'Bad Slug' })])).toThrow(/slug/);
    expect(() => loadManifest(dir, [entry({ slug: '../x' })])).toThrow(/slug/);
    expect(() => loadManifest(dir, [entry({ file: 'notes.txt' })])).toThrow(/pdf/);
    expect(() => loadManifest(dir, [entry({ file: 'missing.pdf' })])).toThrow(/missing/);
    expect(() => loadManifest(dir, [entry({ file: 'sub' })])).toThrow();
    expect(() => loadManifest(dir, [entry({ category: 'Other' })])).toThrow(AffiliateResourcesManifestError);
    expect(() => loadManifest(dir, [entry({ updatedAt: 'yesterday' })])).toThrow(/updatedAt/);
    expect(() => loadManifest(dir, [entry(), entry()])).toThrow(/duplicate/);
  });

  it('listResources exposes metadata and size but no filesystem path', () => {
    const list = listResources();
    expect(list.length).toBe(2);
    const json = JSON.stringify(list);
    expect(json).not.toContain(REAL_DIR);
    expect(json).not.toContain('absPath');
    expect(list[0]).toHaveProperty('sizeBytes');
  });
});

describe('signedLinks', () => {
  it('verifies, rejects tampering and expiry', () => {
    const { exp, sig } = signLink(['a', 'b'], 1000, 10_000);
    expect(verifyLink(['a', 'b'], exp, sig, 10_500)).toBe(true);
    expect(verifyLink(['a', 'c'], exp, sig, 10_500)).toBe(false);
    expect(verifyLink(['a', 'b'], exp + 1, sig, 10_500)).toBe(false);
    expect(verifyLink(['a', 'b'], exp, sig, 11_001)).toBe(false);
    expect(verifyLink(['a', 'b'], 'nope', sig, 10_500)).toBe(false);
    expect(verifyLink(['a', 'b'], exp, '', 10_500)).toBe(false);
  });
});

describe('GET /api/affiliate/resources', () => {
  it('requires a valid token for an active affiliate', async () => {
    expect((await request(app).get('/api/affiliate/resources')).status).toBe(401);
    expect((await request(app).get('/api/affiliate/resources').set('X-Affiliate-Token', 'guess')).status).toBe(401);
    expect((await request(app).get('/api/affiliate/resources').set('X-Affiliate-Token', 'tok-inactive')).status).toBe(403);
    const ok = await request(app).get('/api/affiliate/resources').set('X-Affiliate-Token', 'tok-active');
    expect(ok.status).toBe(200);
    expect(ok.body.resources.map((r: any) => r.title)).toEqual(['Axiom Affiliate Outreach Guide', 'Axiom Affiliate Playbook']);
    expect(ok.body.resources[0]).toMatchObject({ slug: 'outreach-guide', category: 'Outreach', audience: 'trainer-plan' });
    expect(JSON.stringify(ok.body)).not.toContain('/data/');
  });
});

describe('GET /api/affiliate/resources/:slug/link', () => {
  it('requires the token, 404s unknown slugs, returns a signed 10-minute URL', async () => {
    expect((await request(app).get('/api/affiliate/resources/outreach-guide/link')).status).toBe(401);
    expect((await request(app).get('/api/affiliate/resources/nope/link').set('X-Affiliate-Token', 'tok-active')).status).toBe(404);
    const before = Date.now();
    const r = await request(app).get('/api/affiliate/resources/outreach-guide/link').set('X-Affiliate-Token', 'tok-active');
    expect(r.status).toBe(200);
    expect(r.body.url).toMatch(/^https:\/\/api\.example\.test\/api\/affiliate\/resources\/outreach-guide\/file\?/);
    expect(r.body.url).not.toContain('tok-active');
    const u = new URL(r.body.url);
    expect(u.searchParams.get('aid')).toBe('aff-1');
    expect(u.searchParams.get('sig')).toBeTruthy();
    const ttl = Date.parse(r.body.expiresAt) - before;
    expect(ttl).toBeGreaterThan(9 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000 + 1000);
  });
});

describe('GET /api/affiliate/resources/:slug/file', () => {
  async function freshLink(slug = 'outreach-guide') {
    const r = await request(app).get(`/api/affiliate/resources/${slug}/link`).set('X-Affiliate-Token', 'tok-active');
    return linkParams(r.body.url);
  }

  it('200 with PDF headers and the exact bytes for a valid link (no token needed)', async () => {
    const { path, search } = await freshLink();
    const r = await request(app).get(`/api${path}${search}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toBe('inline; filename="axiom-affiliate-outreach-guide.pdf"');
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    const bytes = readFileSync(join(REAL_DIR, 'axiom-affiliate-outreach-guide.pdf'));
    expect(r.headers['content-length']).toBe(String(bytes.length));
    expect(Buffer.compare(r.body as Buffer, bytes)).toBe(0);
  });

  it('download=1 switches to attachment', async () => {
    const { path, search } = await freshLink('affiliate-playbook');
    const r = await request(app).get(`/api${path}${search}&download=1`);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toBe('attachment; filename="axiom-affiliate-playbook.pdf"');
  });

  it('403 on tampered signature, swapped affiliate, slug swap, or missing params', async () => {
    const { path, search } = await freshLink();
    const p = new URLSearchParams(search);
    const sig = p.get('sig')!;
    const tampered = new URLSearchParams(p); tampered.set('sig', (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1));
    expect((await request(app).get(`/api${path}?${tampered}`)).status).toBe(403);
    const otherAff = new URLSearchParams(p); otherAff.set('aid', 'aff-2');
    expect((await request(app).get(`/api${path}?${otherAff}`)).status).toBe(403);
    const longerExp = new URLSearchParams(p); longerExp.set('exp', String(Number(p.get('exp')) + 60_000));
    expect((await request(app).get(`/api${path}?${longerExp}`)).status).toBe(403);
    expect((await request(app).get(`/api/affiliate/resources/affiliate-playbook/file?${p}`)).status).toBe(403);
    expect((await request(app).get(`/api${path}`)).status).toBe(403);
  });

  it('403 once expired', async () => {
    const { path, search } = await freshLink();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
    expect((await request(app).get(`/api${path}${search}`)).status).toBe(403);
  });

  it('403 if the affiliate was deactivated after the link was minted', async () => {
    const { path, search } = await freshLink();
    store.affiliates[0].active = false;
    expect((await request(app).get(`/api${path}${search}`)).status).toBe(403);
  });

  it('404 for unknown slugs', async () => {
    const { exp, sig } = signLink(['affiliate-resource', 'nope', 'aff-1'], 60_000);
    expect((await request(app).get(`/api/affiliate/resources/nope/file?aid=aff-1&exp=${exp}&sig=${sig}`)).status).toBe(404);
    expect((await request(app).get('/api/affiliate/resources/..%2Fmanifest/file')).status).toBe(404);
  });
});
