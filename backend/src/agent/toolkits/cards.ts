// Card builders shared by chat tools and the turns Anakin starts himself, so
// a card looks the same whether the user asked or Anakin raised it. No agent
// imports here — routes and services import this directly.

import type { CardDraft } from '../cards/types.js';
import { dayLabel, weight } from '../cards/format.js';

export function formResultCard(a: { id: string; status: string; exercise?: string | null; formScore?: number | null; repCount?: number | null; analysis?: any }): CardDraft {
  const an = a.analysis ?? {};
  return {
    fn: 'FRM-02', pattern: 'glance', rule: 'show', meta: { label: `Form check · ${a.exercise && a.exercise !== 'unknown' ? a.exercise : 'video'}`, open: { page: 'form', params: { id: a.id } } },
    hero: { value: String(a.formScore ?? an.formScore ?? '—'), unit: `of 10 · ${a.repCount ?? an.repCount ?? '—'} reps` },
    rows: [
      ...(an.strengths ?? []).slice(0, 2).map((s: string) => ({ key: 'Good', value: s })),
      ...(an.weaknesses ?? []).slice(0, 3).map((w: any) => ({ key: w.issue, value: w.cue, mark: w.severity === 'major' ? 'chg' as const : undefined })),
    ],
    actions: an.recommendedDrills?.length ? [{ id: 'drills', label: 'Add drills to my program', kind: 'secondary', client: { action: 'send_message', args: { text: `Add ${an.recommendedDrills.map((d: any) => d.name).slice(0, 2).join(' and ')} to my program.` } } }] : [],
  };
}

export function partnerInviteCard(p: { id: string; date: string; who: string; note: string | null }): CardDraft {
  return {
    fn: 'TT-04', pattern: 'ask', rule: 'draft_send', meta: { label: `Invite · ${dayLabel(p.date)}` },
    ask: { q: `Train with ${p.who} on ${dayLabel(p.date)}?`, options: [] }, ...(p.note ? { why: p.note } : {}),
    actions: [{ id: 'in', label: 'I’m in', kind: 'primary' }, { id: 'out', label: 'Can’t', kind: 'secondary' }],
    entity: `pin:${p.id}`,
    pending: { actions: { in: { op: 'tt.respond', args: { id: p.id, response: 'accepted' }, status: 'sent', line: 'You’re in' }, out: { op: 'tt.respond', args: { id: p.id, response: 'declined' }, status: 'sent', line: 'Declined' } } },
  };
}

export function friendRequestCard(r: { requesterId: string; name: string }): CardDraft {
  return {
    fn: 'SOC-08', pattern: 'glance', rule: 'draft_send', meta: { label: 'Friend request' }, rows: [{ key: r.name }],
    actions: [{ id: 'accept', label: 'Accept', kind: 'primary' }, { id: 'decline', label: 'Decline', kind: 'secondary' }],
    entity: `friendreq:${r.requesterId}`,
    pending: { actions: { accept: { op: 'social.accept', args: { requesterId: r.requesterId, name: r.name }, line: `Now friends with ${r.name}` }, decline: { op: 'social.decline', args: { requesterId: r.requesterId, name: r.name }, line: 'Declined' } } },
  };
}

export function incomingMessageCard(m: { from: string; preview: string; conversationId: string }): CardDraft {
  return {
    fn: 'SOC-12', pattern: 'glance', rule: 'show', meta: { label: `Message from ${m.from}`, open: { page: 'conversation', params: { id: m.conversationId } } }, rows: [{ key: m.preview }],
    entity: `dm:${m.conversationId}`,
    actions: [{ id: 'reply', label: 'Reply', kind: 'secondary', client: { action: 'send_message', args: { text: `Reply to ${m.from}: ` } } }],
  };
}

export function weeklyReviewCard(w: { sessions: number; avgProtein: number | null; bwDelta: number | null; unit: string; streak: number }): CardDraft {
  return {
    fn: 'MEM-05', pattern: 'glance', rule: 'show', meta: { label: 'Your week' }, hero: { value: String(w.sessions), unit: `workout${w.sessions === 1 ? '' : 's'}` },
    rows: [
      ...(w.avgProtein ? [{ key: 'Protein a day', value: `${w.avgProtein} g` }] : []),
      ...(w.bwDelta != null ? [{ key: 'Weight', value: `${w.bwDelta >= 0 ? '+' : '−'}${Math.abs(w.bwDelta)} ${w.unit === 'kg' ? 'kg' : 'lb'}` }] : []),
      ...(w.streak ? [{ key: 'Streak', value: `${w.streak} days` }] : []),
    ],
    actions: [{ id: 'plan', label: 'What changes next week?', kind: 'secondary', client: { action: 'send_message', args: { text: 'Based on my week, what should change next week?' } } }],
  };
}

export function prCard(prs: { name: string; e1rmLbs: number }[], unit: 'metric' | 'imperial'): CardDraft {
  return {
    fn: 'WRK-09', pattern: 'glance', rule: 'show', meta: { label: 'New best', open: { page: 'strength' } },
    rows: prs.slice(0, 4).map((p) => ({ key: p.name, value: weight(unit, p.e1rmLbs * 0.45359237), sub: 'estimated 1RM', mark: 'chg' as const })),
    actions: [{ id: 'share', label: 'Share', kind: 'secondary', client: { action: 'share', args: { card: 'strength' } } }],
  };
}

export function programReadyCard(p: { goal?: string | null; phases: { name: string; weeks?: number | null }[] }): CardDraft {
  return {
    fn: 'PRG-04', pattern: 'glance', rule: 'show', meta: { label: 'Your program is ready', open: { page: 'training' } },
    rows: p.phases.slice(0, 5).map((ph) => ({ key: ph.name, value: ph.weeks ? `${ph.weeks} wk` : '' })),
    ...(p.goal ? { why: `Built toward ${String(p.goal).slice(0, 80)}.` } : {}),
    actions: [{ id: 'today', label: 'What’s first?', kind: 'primary', client: { action: 'send_message', args: { text: 'What am I doing first?' } } }],
  };
}
