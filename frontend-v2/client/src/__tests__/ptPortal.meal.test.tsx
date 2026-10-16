/**
 * Portal meal photo: a photo is read into the meal form for the client to
 * check — it is never logged on its own — with low-confidence and limit
 * messages. The downscale step is stubbed (happy-dom has no canvas).
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { PortalHome } from '@axiom/personal-training-core';

vi.mock('@/features/pt-portal/media', async (orig) => ({
  ...(await orig<typeof import('@/features/pt-portal/media')>()),
  downscalePhoto: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,QUJD', base64: 'QUJD'.repeat(40), width: 1600, height: 1200 })),
}));

import PortalApp from '@/features/pt-portal/PortalApp';
import { isLowConfidence } from '@/features/pt-portal/screens/NutritionSection';

const HOME: PortalHome = {
  client: { firstName: 'Maya', name: 'Maya Okafor', unit: 'kg' },
  branding: { practiceName: 'Kofi Coaching', trainerName: 'Kofi Mensah', logoUrl: null, brandColor: null, accentColor: null },
  checkIns: [], goals: [], unreadMessages: 0, hasProgram: false, intake: { status: 'complete', completeness: 100 }, photosEnabled: true, reports: [],
};

let routes: Record<string, (init: RequestInit) => { status?: number; body: unknown }>;
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  routes = {
    'GET /pt-portal/home': () => ({ body: HOME }),
    'GET /pt-portal/measurements': () => ({ body: { measurements: [] } }),
    'GET /pt-portal/nutrition': () => ({ body: { nutrition: { targets: null, week: { windowDays: 7, daysLogged: 0, avgCalories: null, avgProteinG: null, avgCarbsG: null, avgFatG: null, caloriesOnTarget: null, proteinOnTarget: null }, days: [] } } }),
  };
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}): Promise<Response> => {
    const path = new URL(url).pathname.replace(/^\/api/, '');
    const h = routes[`${init.method ?? 'GET'} ${path}`];
    if (!h) return json(404, { error: 'Not found' });
    const { status = 200, body } = h(init);
    return json(status, body);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderLog() {
  const { hook, searchHook } = memoryLocation({ path: '/c/tok?tab=log' });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Router hook={hook} searchHook={searchHook}><Route path="/c/:token" component={PortalApp} /></Router></QueryClientProvider>);
}

async function pickPhoto(container: HTMLElement) {
  const user = userEvent.setup();
  await screen.findByRole('button', { name: /Estimate from a photo/ });
  const input = container.querySelector('input[type="file"][capture]') as HTMLInputElement;
  await user.upload(input, new File(['x'], 'lunch.jpg', { type: 'image/jpeg' }));
  return user;
}

describe('meal photo estimate', () => {
  it('pre-fills the form for the client to check, and logs only when they save', async () => {
    let estimateBody: unknown = null;
    const logged: unknown[] = [];
    routes['POST /pt-portal/meals/estimate'] = (init) => {
      estimateBody = JSON.parse(String(init.body));
      return { body: { estimate: { name: 'Chicken salad', calories: 520, proteinG: 42, carbsG: 30, fatG: 22, mealType: 'lunch', confidence: 'high' } } };
    };
    routes['POST /pt-portal/meals'] = (init) => { logged.push(JSON.parse(String(init.body))); return { status: 201, body: { nutrition: { targets: null, week: { windowDays: 7, daysLogged: 1, avgCalories: 520, avgProteinG: 42, avgCarbsG: 30, avgFatG: 22, caloriesOnTarget: null, proteinOnTarget: null }, days: [] } } }; };

    const { container } = renderLog();
    const user = await pickPhoto(container);

    expect(await screen.findByLabelText('What did you eat?')).toHaveValue('Chicken salad');
    expect(screen.getByLabelText(/^Calories/)).toHaveValue(520);
    expect(screen.getByLabelText('Meal')).toHaveValue('lunch');
    expect(screen.getByText(/Estimated from your photo/)).toBeInTheDocument();
    expect(screen.queryByText(/hard to read/)).not.toBeInTheDocument();
    expect(estimateBody).toEqual({ imageBase64: 'QUJD'.repeat(40), mimeType: 'image/jpeg' });
    expect(logged).toHaveLength(0);
    const [, init] = fetchMock.mock.calls.find(([u]) => u.endsWith('/pt-portal/meals/estimate'))!;
    expect((init!.headers as Record<string, string>).Authorization).toBe('PtLink tok');

    await user.clear(screen.getByLabelText(/^Calories/));
    await user.type(screen.getByLabelText(/^Calories/), '480');
    await user.click(screen.getByRole('button', { name: 'Save meal' }));
    await waitFor(() => expect(logged).toHaveLength(1));
    expect(logged[0]).toMatchObject({ name: 'Chicken salad', calories: 480, proteinG: 42, mealType: 'lunch' });
  });

  it('warns when the estimate is unsure', async () => {
    routes['POST /pt-portal/meals/estimate'] = () => ({ body: { estimate: { name: 'Stew', calories: 600, proteinG: 30, carbsG: 50, fatG: 25, mealType: 'dinner', confidence: 'low' } } });
    const { container } = renderLog();
    await pickPhoto(container);
    expect(await screen.findByText(/hard to read, so the numbers may be well off/)).toBeInTheDocument();
  });

  it("shows the server's limit and could-not-read messages", async () => {
    routes['POST /pt-portal/meals/estimate'] = () => ({ status: 429, body: { error: 'That is the limit for photo estimates today. You can still type a meal in.' } });
    const { container } = renderLog();
    await pickPhoto(container);
    expect(await screen.findByText(/limit for photo estimates today/)).toBeInTheDocument();
    expect(screen.getByLabelText('What did you eat?')).toHaveValue('');
  });

  it('reads confidence words and numbers', () => {
    expect(isLowConfidence('low')).toBe(true);
    expect(isLowConfidence('Uncertain')).toBe(true);
    expect(isLowConfidence('high')).toBe(false);
    expect(isLowConfidence('0.3')).toBe(true);
    expect(isLowConfidence('0.8')).toBe(false);
    expect(isLowConfidence('40')).toBe(true);
    expect(isLowConfidence(null)).toBe(false);
  });
});
