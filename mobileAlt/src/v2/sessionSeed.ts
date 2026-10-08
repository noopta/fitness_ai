// A session that isn't today's program day (T-05 guided freestyle): the page
// that built it hands it to the Active workout here, in memory. The session
// screen takes it once on mount; with none it runs today's session as before.

export interface SeedSession { name: string; focus?: string | null; exercises: { name: string; sets: number; reps: string | number; notes?: string | null }[] }

let seed: SeedSession | null = null;

export const setSessionSeed = (s: SeedSession | null) => { seed = s; };
export const takeSessionSeed = (): SeedSession | null => { const s = seed; seed = null; return s; };
