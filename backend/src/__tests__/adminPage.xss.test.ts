// /admin renders user-controlled names and emails. They must land as text,
// never markup, and the page must ship a CSP that would stop an injected
// script anyway (nonce'd script, no inline handlers).
import { describe, it, expect, vi } from 'vitest';
import vm from 'node:vm';
import express from 'express';
import request from 'supertest';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.$queryRawUnsafe = vi.fn(); }) }));
vi.mock('../middleware/requireAuth.js', () => ({ requireAuth: (_q: any, _s: any, n: any) => n() }));
vi.mock('../middleware/requireAdmin.js', () => ({ requireAdmin: (_q: any, _s: any, n: any) => n() }));

import { renderAdminHtml, adminPageCsp } from '../routes/adminPage.js';
import adminRoutes from '../routes/admin.js';

// Minimal DOM: enough for the page script, and innerHTML throws if touched.
class FakeEl {
  tag: string; children: any[] = []; className = ''; style: Record<string, string> = {};
  value = ''; checked = false; private _text = ''; listeners: Record<string, Function[]> = {};
  constructor(tag: string) { this.tag = tag; }
  set innerHTML(_v: string) { throw new Error('innerHTML used'); }
  get innerHTML() { throw new Error('innerHTML used'); }
  set textContent(v: string) { this._text = String(v); this.children = []; }
  get textContent(): string { return this._text + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  append(...k: any[]) { this.children.push(...k.map((x) => (x?.__text !== undefined ? x.__text : x))); }
  replaceChildren(...k: any[]) { this.children = []; this._text = ''; this.append(...k); }
  addEventListener(t: string, f: Function) { (this.listeners[t] ??= []).push(f); }
  all(): FakeEl[] { return [this, ...this.children.filter((c) => c instanceof FakeEl).flatMap((c: FakeEl) => c.all())]; }
}

async function runPage(users: any[]) {
  const html = renderAdminHtml('n0nce');
  const script = /<script nonce="n0nce">([\s\S]*?)<\/script>/.exec(html)![1];
  const ids: Record<string, FakeEl> = {};
  const byId = (id: string) => (ids[id] ??= new FakeEl('div'));
  const thead = new FakeEl('tr'); const tbody = new FakeEl('tbody');
  const document = {
    createElement: (t: string) => new FakeEl(t),
    createTextNode: (t: string) => ({ __text: t }),
    getElementById: byId,
    querySelector: (q: string) => (q.includes('thead') ? thead : tbody),
  };
  const fetch = async (path: string) => ({
    ok: true, status: 200,
    json: async () => (path.includes('funnel')
      ? { stages: [{ label: '<b>x</b>', count: 1 }], generatedAt: new Date().toISOString() }
      : { users }),
  });
  const ctx = vm.createContext({ document, fetch, localStorage: { getItem: () => null, setItem() {} }, console, Promise, Math, String, Date, Number, Object });
  vm.runInContext(script, ctx);
  await new Promise((r) => setTimeout(r, 10));
  return { tbody, funnel: byId('funnel'), err: byId('err') };
}

describe('/admin page', () => {
  it('renders a hostile name as text, without touching innerHTML', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { tbody, err } = await runPage([{ id: 'abcdef123', name: evil, email: null, username: null, tier: 'free', daysQuiet: null, lastActivityDay: null }]);
    expect(err.textContent).toBe('');
    expect(tbody.textContent).toContain(evil); // shown literally
    expect(tbody.all().some((e) => e.tag === 'img')).toBe(false);
  });

  it('serves a nonce-bound CSP that matches the page script and has no inline handlers', async () => {
    const app = express();
    app.use(adminRoutes);
    const res = await request(app).get('/admin');
    const csp = res.headers['content-security-policy'];
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    expect(res.text).toContain(`<script nonce="${nonce}">`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('unsafe-inline\' \'nonce'); // script-src is nonce-only
    expect(/script-src[^;]*unsafe-inline/.test(csp)).toBe(false);
    expect(res.text).not.toMatch(/\son(click|input|change|load|error)=/i);
    expect(res.text).not.toContain('innerHTML =');
  });

  it('adminPageCsp is nonce-only for scripts', () => {
    expect(adminPageCsp('abc')).toContain("script-src 'nonce-abc'");
  });
});
