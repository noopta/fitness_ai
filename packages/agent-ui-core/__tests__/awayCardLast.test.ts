import { describe, it, expect } from 'vitest';
import { awayCardLast } from '../src/proactive';

const t = (id: string, kind: 'user' | 'agent', fn?: string) => ({ id, kind, cards: fn ? [{ fn }] : [] });

describe('awayCardLast', () => {
  it('moves the away card below turns Anakin added after it', () => {
    const turns = [t('u1', 'user'), t('a1', 'agent'), t('away', 'agent', 'AWAY-01'), t('ask', 'agent'), t('tip', 'agent')];
    expect(awayCardLast(turns).map((x) => x.id)).toEqual(['u1', 'a1', 'ask', 'tip', 'away']);
  });
  it('leaves it alone when it is already last, or once the user has written since', () => {
    const last = [t('a1', 'agent'), t('away', 'agent', 'AWAY-01')];
    expect(awayCardLast(last)).toBe(last);
    const after = [t('away', 'agent', 'AWAY-01'), t('u1', 'user'), t('a2', 'agent')];
    expect(awayCardLast(after)).toBe(after);
  });
  it('no away card: unchanged', () => {
    const turns = [t('u1', 'user'), t('a1', 'agent')];
    expect(awayCardLast(turns)).toBe(turns);
  });
});
