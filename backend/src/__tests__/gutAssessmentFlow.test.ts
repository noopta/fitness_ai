// Gut and nutrition questions (20 Oct 2026): progress survives the card, plain-chat
// answers count, and "it's already on your screen" with nothing shown is caught.
import { describe, it, expect } from 'vitest';
import { nextQuestion, answerValue, ASSESSMENT_QUESTIONS as Q } from '../agent/toolkits/health.js';
import { claimsShownWithoutTool } from '../agent/actionClaims.js';

describe('gut assessment progress', () => {
  it('resumes at the first unanswered question, in any order', () => {
    expect(nextQuestion([])).toBe(0);
    expect(nextQuestion(['mealsPerDay', 'bloating'])).toBe(1);
    expect(nextQuestion(Q.map((q) => q.key))).toBe(-1);
  });
  it('maps answers in the user’s words to option values; free text only where allowed', () => {
    const meals = Q.find((q) => q.key === 'mealsPerDay')!;
    expect(answerValue(meals, '4-5')).toEqual({ value: 5, label: '4–5' });
    expect(answerValue(meals, 'four or five')).toBeNull();
    const intol = Q.find((q) => q.key === 'intolerances')!;
    expect(answerValue(intol, 'dairy')).toEqual({ value: ['dairy'], label: 'Dairy' });
    expect(answerValue(intol, 'shellfish, eggs')).toEqual({ value: 'shellfish, eggs', label: 'shellfish, eggs' });
  });
});

describe('claimsShownWithoutTool', () => {
  it('catches the 20 Oct replies', () => {
    expect(claimsShownWithoutTool('Already running — question 1 of 13 is on your screen now.', [])).toBe(true);
    expect(claimsShownWithoutTool("That's already open on your screen — question 1 of 13.", [])).toBe(true);
  });
  it('ignores ordinary talk, and any turn where a tool ran', () => {
    expect(claimsShownWithoutTool("You're already up 2 lb this week.", [])).toBe(false);
    expect(claimsShownWithoutTool('Your protein is already there for today.', [])).toBe(false);
    expect(claimsShownWithoutTool("That's already open on your screen.", ['start_nutrition_assessment'])).toBe(false);
  });
});
