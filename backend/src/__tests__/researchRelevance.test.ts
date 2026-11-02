// What counts as a research source worth showing (Nov 2026).
import * as R2 from '../services/research/relevance.js';
import { describe, it, expect } from 'vitest';
import { claimsFrom, contentWords, feedItemRelevant, isTrialRegistration, libraryTitle, supportedChunks, pageTitleFrom, preferTrusted, BOOK_MIN, POD_MIN } from '../services/research/relevance.js';

describe('research relevance', () => {
  it('subject words skip filler like "after", "latest", "research"', () => {
    expect(contentWords('latest research on achilles rehab after surgery')).toEqual(['achilles', 'rehab', 'surgery']);
  });
  it('feed items need two subject words in the title; trial registrations never count', () => {
    const q = 'achilles tendon rupture rehab protocols';
    expect(feedItemRelevant({ title: 'Accelerated rehab after Achilles tendon rupture: an RCT', source: 'PubMed' }, q)).toBe(true);
    expect(feedItemRelevant({ title: 'Recovery after hip replacement', source: 'PubMed' }, q)).toBe(false);
    expect(feedItemRelevant({ title: 'Achilles tendon rupture rehab trial', source: 'ClinicalTrials.gov' }, q)).toBe(false);
    expect(isTrialRegistration('clinicaltrials.gov')).toBe(true);
  });
  it('floors are the Nov 2026 values', () => {
    expect(BOOK_MIN).toBe(0.52);
    expect(POD_MIN).toBe(0.66);
  });
  it('library titles drop fragment headings', () => {
    expect(libraryTitle('NCSF', 'Anaerobic Resistance Training')).toBe('NCSF — Anaerobic Resistance Training');
    expect(libraryTitle('NASM', 'the following:')).toBe('NASM textbook');
    expect(libraryTitle('NUTRITION_SCIENCE', null)).toBe('Nutrition science notes');
    expect(libraryTitle('NUTRITION_SCIENCE', 'Nutrition for Sleep and Recovery')).toBe('Nutrition science — Nutrition for Sleep and Recovery');
    expect(libraryTitle('NASM', 'Chapter 17 – Nutrition')).toBe('NASM — Chapter 17 – Nutrition');
    expect(libraryTitle('NCSF', 'One advantage to this method is that it allows for a wider range of')).toBe('NCSF textbook');
    expect(libraryTitle('NCSF', 'Bench sit-ups')).toBe('NCSF textbook');
  });
  it('web sources are the chunks the answer leans on', () => {
    expect(supportedChunks(['a', 'b', 'c'], [{ groundingChunkIndices: [2] }, { groundingChunkIndices: [0, 2] }])).toEqual(['a', 'c']);
    expect(supportedChunks(['a', 'b'], undefined)).toEqual(['a', 'b']);
  });
  it('page titles: citation_title, then og:title, then <title>; error pages are not titles', () => {
    expect(pageTitleFrom('<meta name="citation_title" content="Rehabilitation after Achilles repair"><title>x</title>')).toBe('Rehabilitation after Achilles repair');
    expect(pageTitleFrom('<meta content="Vitamin D &amp; muscle" property="og:title">')).toBe('Vitamin D & muscle');
    expect(pageTitleFrom('<title>Just a moment...</title>')).toBeNull();
  });
  it('two trusted sources push the rest out', () => {
    expect(preferTrusted(['nih', 'shop', 'bmj'], (s) => s !== 'shop')).toEqual(['nih', 'bmj']);
    expect(preferTrusted(['nih', 'shop'], (s) => s !== 'shop')).toEqual(['nih', 'shop']);
  });
});

describe('claim-to-source mapping', () => {
  it('numbers the shown sources and drops claims no shown source backs', () => {
    const supports = [
      { segment: { text: 'Early weight bearing did not raise re-rupture rates.' }, groundingChunkIndices: [0, 2] },
      { segment: { text: 'A supplement shop says collagen fixes tendons.' }, groundingChunkIndices: [1] },
      { segment: { text: 'short' }, groundingChunkIndices: [0] },
    ];
    const urlOf = new Map<number, string | null>([[0, 'https://nih.gov/a'], [1, 'https://shop.com/x'], [2, 'https://bmj.com/b']]);
    expect(claimsFrom(supports, urlOf, ['https://bmj.com/b', 'https://nih.gov/a'])).toEqual([{ claim: 'Early weight bearing did not raise re-rupture rates.', sources: [1, 2] }]);
  });
});

describe('marketing pages and titles', () => {
  it('store blogs, product pages and shop hosts are not evidence; journals and public health are', () => {
    const { isMarketingPage, decodeEntities } = R2;
    expect(isMarketingPage('https://cymbiotika.com/blogs/health-hacks/vitamin-c-and-zinc')).toBe(true);
    expect(isMarketingPage('https://www.bodybuildingshop.com/creatine')).toBe(true);
    expect(isMarketingPage('https://example.com/products/collagen')).toBe(true);
    expect(isMarketingPage('https://pubmed.ncbi.nlm.nih.gov/123/')).toBe(false);
    expect(isMarketingPage('https://www.bmj.com/content/1/2')).toBe(false);
    expect(decodeEntities('Doctor&#x27;s Note &amp; more &#8212; x')).toBe("Doctor's Note & more — x");
  });
});
