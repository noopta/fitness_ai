// A small in-memory stand-in for the Prisma models the proactive layer uses.
// Supports the subset of the query API those modules call: equality and
// { in, not, gte, lte, gt, lt, contains } filters, orderBy on one key, take,
// distinct, select-less reads, create / update / updateMany / count, and
// { increment } on update. Shared by the proactive test files.

export const db: Record<string, any[]> = {};
let seq = 0;

export function reset(seed: Record<string, any[]> = {}) {
  for (const k of Object.keys(db)) delete db[k];
  for (const [k, rows] of Object.entries(seed)) db[k] = rows.map((r) => ({ ...r }));
}

const cmp = (a: any, b: any) => { const x = a instanceof Date ? a.getTime() : a; const y = b instanceof Date ? b.getTime() : b; return x < y ? -1 : x > y ? 1 : 0; };

function matchField(v: any, cond: any): boolean {
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('in' in cond && !cond.in.includes(v)) return false;
    if ('not' in cond && v === cond.not) return false;
    if ('gte' in cond && !(cmp(v, cond.gte) >= 0)) return false;
    if ('lte' in cond && !(cmp(v, cond.lte) <= 0)) return false;
    if ('gt' in cond && !(cmp(v, cond.gt) > 0)) return false;
    if ('lt' in cond && !(cmp(v, cond.lt) < 0)) return false;
    if ('contains' in cond && !String(v ?? '').includes(cond.contains)) return false;
    return true;
  }
  return v === cond || (v == null && cond == null);
}
const match = (row: any, where: any = {}) => Object.entries(where).every(([k, v]) => matchField(row[k], v));

function model(name: string) {
  const rows = () => (db[name] ??= []);
  const query = ({ where, orderBy, take, distinct }: any = {}) => {
    let out = rows().filter((r) => match(r, where));
    if (orderBy) { const [[k, dir]] = Object.entries(orderBy) as [string, string][]; out = out.sort((a, b) => cmp(a[k], b[k]) * (dir === 'desc' ? -1 : 1)); }
    if (distinct) { const seen = new Set<string>(); out = out.filter((r) => { const key = distinct.map((d: string) => String(r[d])).join('|'); if (seen.has(key)) return false; seen.add(key); return true; }); }
    if (take != null) out = out.slice(0, take);
    return out.map((r) => ({ ...r }));
  };
  const applyData = (row: any, data: any) => { for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && !(v instanceof Date) && 'increment' in (v as any) ? (row[k] ?? 0) + (v as any).increment : v; row.updatedAt = new Date(); };
  return {
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows().push(row); return { ...row }; },
    update: async ({ where, data }: any) => { const row = rows().find((r) => match(r, where)); if (!row) throw new Error(`${name} not found`); applyData(row, data); return { ...row }; },
    updateMany: async ({ where, data }: any) => { const hit = rows().filter((r) => match(r, where)); hit.forEach((r) => applyData(r, data)); return { count: hit.length }; },
    upsert: async ({ where, create, update }: any) => { const row = rows().find((r) => match(r, where)); if (row) { applyData(row, update); return { ...row }; } const n = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...where, ...create }; rows().push(n); return { ...n }; },
    findFirst: async (q: any = {}) => query(q)[0] ?? null,
    findUnique: async (q: any = {}) => query(q)[0] ?? null,
    findMany: async (q: any = {}) => query(q),
    count: async ({ where }: any = {}) => rows().filter((r) => match(r, where)).length,
    delete: async ({ where }: any) => { const i = rows().findIndex((r) => match(r, where)); if (i >= 0) rows().splice(i, 1); return {}; },
    deleteMany: async ({ where }: any = {}) => { const keep = rows().filter((r) => !match(r, where)); const n = rows().length - keep.length; db[name] = keep; return { count: n }; },
  };
}

export const MODELS = ['user', 'agentThread', 'proactiveEvent', 'chatPhoto', 'sessionFlag', 'workoutLog', 'mealEntry', 'wellnessCheckin', 'bodyWeightLog', 'agentConversation', 'agentCard', 'agentChange', 'agentMemory', 'adaptationProposal', 'exerciseNormalization', 'scheduleOverride', 'completedProgram'];

/** Constructor form — arrow functions break `this` (CLAUDE.md). */
export const PrismaClient = function (this: any) { for (const m of MODELS) this[m] = model(m); this.$transaction = async (fn: any) => (typeof fn === 'function' ? fn(this) : Promise.all(fn)); } as unknown as new () => any;
