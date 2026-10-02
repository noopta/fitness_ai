import { describe, it, expect } from 'vitest';
import { parseModelJson } from '../services/modelJson.js';

describe('parseModelJson', () => {
  it('parses plain JSON unchanged', () => {
    expect(parseModelJson('{"name":"Oats","calories":300}')).toEqual({ name: 'Oats', calories: 300 });
    expect(parseModelJson('[1,2]')).toEqual([1, 2]);
  });

  it('parses the fenced object that broke /nutrition/parse-meal in production', () => {
    const raw = '```json\n{\n  "name": "Chicken shawarma wrap",\n  "calories": 640,\n  "proteinG": 38\n}\n```';
    expect(parseModelJson(raw)).toEqual({ name: 'Chicken shawarma wrap', calories: 640, proteinG: 38 });
  });

  it('handles a bare fence, prose around the object, and fenced arrays', () => {
    expect(parseModelJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('Here is the meal:\n{"a":{"b":"x } y"}}\nHope that helps.')).toEqual({ a: { b: 'x } y' } });
    expect(parseModelJson('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
  });

  it('still throws on output that is not JSON at all, with the original error', () => {
    expect(() => parseModelJson('I could not analyse that meal.')).toThrow(SyntaxError);
    expect(() => parseModelJson('```json\n{"a": \n```')).toThrow(SyntaxError);
    expect(() => parseModelJson('')).toThrow(SyntaxError);
    expect(() => parseModelJson(null)).toThrow(SyntaxError);
  });
});
