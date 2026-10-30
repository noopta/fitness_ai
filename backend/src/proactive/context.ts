// What the chat model is told about the proactive layer each turn: who runs
// the program (B9 — a coach means Anakin suggests, never edits) and the open
// threads (so "how's the elbow?" has somewhere to land). Short, and empty
// when the feature is off for the user.

import { PrismaClient } from '@prisma/client';
import { proactiveAvailableFor } from '../services/featureFlags.js';
import { getProactivePrefs } from './prefs.js';
import { openThreads } from './threads.js';

const prisma = new PrismaClient();

export async function proactiveContextText(userId: string): Promise<string> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!u || !proactiveAvailableFor(userId, u.email)) return '';
    const [prefs, threads] = await Promise.all([getProactivePrefs(userId), openThreads(userId)]);
    const lines: string[] = [];
    if (prefs.programOwner !== 'me') {
      lines.push(`A coach runs this user's program (${prefs.programOwner === 'coach_axiom' ? 'on Axiom' : 'not on Axiom'}). NEVER change or propose edits to the program yourself — when a change would help, use propose_week_change (it becomes a message to the coach), or offer to draft a note to the coach.`);
    }
    if (threads.length) {
      lines.push(`Working on (open threads you're tracking — pick these up when relevant, and say so):\n${threads.slice(0, 8).map((t) => `- [${t.kind}] ${t.title}${t.checkBackAt ? ` · check back ${t.checkBackAt}` : ''}${t.eventDate ? ` · ${t.eventDate}` : ''}${t.sourceQuote ? ` · they said "${t.sourceQuote.slice(0, 80)}"` : ''}`).join('\n')}`);
    }
    lines.push('When the user is training for a dated event, has a niggle, starts an experiment, or asks something you can only answer later, say you\'ll keep track of it — the app lists these under "Working on". When proposing next week as a diff, use propose_week_change so it can be applied in one tap and reported on later.');
    return lines.length ? `\n\n## Proactive coach\n${lines.join('\n')}` : '';
  } catch { return ''; }
}
