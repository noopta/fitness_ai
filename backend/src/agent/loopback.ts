// Call one of our own API routes as the user, in-process over loopback.
//
// Social, groups, Train Together and institution routes carry moderation,
// block checks, rate limits and pushes inside their handlers. Rather than
// copy that logic into agent ops (and let the copies drift), ops call the
// route itself with a 2-minute token for the same user. Only ops use this —
// and only on the user's tap for anything that leaves the account.

import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

export class LoopbackError extends Error {
  constructor(message: string, public status: number, public body?: any) { super(message); }
}

type Fetcher = (url: string, init: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }>;
let fetcher: Fetcher = (url, init) => fetch(url, init) as any;
export function setLoopbackFetcherForTests(f: Fetcher) { fetcher = f; }

export async function callApi<T = any>(userId: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, tier: true } });
  if (!u) throw new LoopbackError('User not found', 404);
  const token = jwt.sign({ id: u.id, email: u.email, tier: u.tier, via: 'agent' }, process.env.JWT_SECRET!, { expiresIn: '2m' });
  const res = await fetcher(`http://127.0.0.1:${PORT}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Agent-Loopback': '1' },
    ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new LoopbackError(data?.error ?? `Request failed (${res.status})`, res.status, data);
  return data as T;
}
