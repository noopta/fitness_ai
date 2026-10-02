// Roster filtering. The server accepts the same status/q parameters (handoff
// §9), but the views fetch the roster once and filter here so chips and
// search respond instantly and the per-status counts never drift from the
// rows on screen.

import type { Client, RosterFilter, StatusCounts } from './types';

export function countByStatus(clients: Client[]): StatusCounts {
  const counts: StatusCounts = { all: clients.length, support: 0, new: 0, onPlan: 0, paused: 0, notJoined: 0 };
  for (const c of clients) counts[c.status] += 1;
  return counts;
}

export function matchesQuery(client: Client, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    client.name.toLowerCase().includes(needle) ||
    (client.email ?? '').toLowerCase().includes(needle) ||
    (client.program?.goal ?? '').toLowerCase().includes(needle)
  );
}

export function filterClients(clients: Client[], filter: RosterFilter, q: string): Client[] {
  return clients.filter((c) => (filter === 'all' || c.status === filter) && matchesQuery(c, q));
}

/** The line under a client's name: why they are flagged, else where they are in the program. */
export function reasonLine(client: Client): string | null {
  if (client.statusReason) return client.statusReason;
  if (client.program) return `${client.program.blockLabel} · week ${client.program.week} of ${client.program.weeks}`;
  return null;
}
