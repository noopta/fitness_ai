// Zod helper for DESCRIPTIVE metadata fields — values that label how a record
// was produced (`source`, `parseConfidence`, …) rather than what it contains.
//
// These fields share three properties: they land in free-form String columns,
// they drive no control flow, and the set of valid values grows whenever a
// client ships a new entry method. Validating them with a strict z.enum()
// therefore couples every client release to a backend deploy — and when the
// client wins the race, the enum rejects the WHOLE request, so a cosmetic label
// mismatch destroys real user data.
//
// That has now happened twice on POST /nutrition/meals:
//   2026-07-29  the Amarachi incident — a new user's meal logs 400'd on a
//               schema mismatch; fixed by adding a validation watchdog, which
//               alerted on the symptom but left the strict enum in place.
//   2026-08-03  the iOS barcode scanner shipped and sent source: 'barcode'.
//               Lookup worked, every scanned meal failed to save.
//
// descriptiveLabel() inverts the coupling. A well-formed label the server does
// not yet know is accepted and stored as sent, so a new client flow works the
// day it ships and reports accurately in analytics with no backend change.
// Malformed input still never reaches the column — it degrades to `fallback`
// instead of failing the write. The `known` list becomes bookkeeping that keeps
// the warning quiet, not a gate a client has to wait behind.
//
// Use this ONLY for descriptive fields. Anything that selects a code path, gates
// access, or must round-trip exactly still belongs in a strict z.enum(), where
// rejecting an unknown value is the correct and safe behaviour.

import { z } from 'zod';

// Accepted shape for an unfamiliar label: a lowercase slug that looks like a
// deliberate identifier from a newer client, bounded so nothing unreasonable
// reaches the column. Hyphens are allowed because existing writers already use
// them ('order-scan', 'agent-manual', 'agent-parsed') — those paths write via
// prisma directly today, but a stricter pattern would silently rewrite them to
// the fallback the moment one is routed through this schema.
const SLUG = /^[a-z][a-z0-9_-]{0,31}$/;

export function descriptiveLabel<T extends string | null>(known: string[], fallback: T) {
  return z.unknown().optional().transform((raw): string | T => {
    if (typeof raw !== 'string') return fallback;

    const value = raw.trim().toLowerCase();
    if (known.includes(value)) return value;

    if (SLUG.test(value)) {
      // Not an error — the client is ahead of us. Surfaced so the known list can
      // be topped up and a genuinely wrong value is still visible in the logs.
      console.warn(
        `[descriptiveLabel] unrecognised label "${value}" accepted (known: ${known.join(', ')})`,
      );
      return value;
    }

    return fallback;
  });
}

// Known labels for meal entries. Additive-only: dropping a value here does not
// reject it, it just makes it log a warning.
export const KNOWN_MEAL_SOURCES = [
  'manual',
  'text',
  'photo',
  'saved_food',
  'recipe',
  'barcode',
  'voice',
  'order',
  // Written today via prisma directly (agent/tools.ts, routes/nutritionGut.ts)
  // rather than through mealEntrySchema — listed so they stay warning-free if
  // those paths are ever moved onto this route. Confirmed present in prod data.
  'order-scan',
  'agent-manual',
  'agent-parsed',
];

export const KNOWN_PARSE_CONFIDENCE = ['high', 'medium', 'low'];
