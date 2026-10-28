// A rehab program asked for is a card (Oct 2026): the founder's two messages
// that got a chat reply and no card must trigger the check.
import { describe, it, expect } from 'vitest';
import { asksForRehabProgram, needsRehabCard } from '../agent/rehabNudge.js';

const asked = [
  "Build my Achilles rehab program like an elite physio would prescribe it — the rehab itself from current protocols, not a gym program. I'm 2.5 weeks post-op (surgery Oct 10), cleared for physio Oct 26.",
  'Build a brand new one from scratch, I just want to start over — my Achilles rehab program',
  'I want to create a new program from scratch based around the latest and most modern techniques for physiotherapy for achilles rupture recovery',
  'Can we build a program around this latest and advanced physio recovery protocol, with the exercises, etc',
];
const notAsked = [
  'What does the research say about Achilles rupture recovery?',
  'Build me a push pull legs program',
  'How is my recovery looking this week?',
  'log my physio session: 30 min',
];

describe('rehab card check', () => {
  it('recognises a request for a rehab program', () => {
    for (const m of asked) expect(asksForRehabProgram(m), m).toBe(true);
    for (const m of notAsked) expect(asksForRehabProgram(m), m).toBe(false);
  });
  it('fires only when the feature is on and no rehab card went up', () => {
    expect(needsRehabCard(asked[0], [], true)).toBe(true);
    expect(needsRehabCard(asked[0], ['MEM-06', 'MEM-07'], true)).toBe(true);
    expect(needsRehabCard(asked[0], ['PRG-21'], true)).toBe(false);
    expect(needsRehabCard(asked[0], [], false)).toBe(false);
    expect(needsRehabCard(notAsked[0], [], true)).toBe(false);
  });
});
