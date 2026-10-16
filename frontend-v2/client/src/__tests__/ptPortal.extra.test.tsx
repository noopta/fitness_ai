/**
 * Client portal, phase 2: the intake chat, meal logging, the trainer's
 * program (with a skip marker and apply-in-app) and photos switched off.
 * Runs the real PortalApp against a stubbed fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { IntakeState, PortalHome, PortalNutrition, PortalProgram } from '@axiom/personal-training-core';
import PortalApp from '@/features/pt-portal/PortalApp';
import {
  blockHeading, currentWeekIndex, formatLoad, formatRest, formatSetsReps, itemLabels,
} from '@/features/pt-portal/helpers';
import { parseOptionalNumber } from '@/features/pt-portal/screens/NutritionSection';
import { appendSpoken } from '@/features/pt-portal/MicButton';

const HOME: PortalHome = {
  client: { firstName: 'Maya', name: 'Maya Okafor', unit: 'kg' },
  branding: { practiceName: 'Kofi Coaching', trainerName: 'Kofi Mensah', logoUrl: null, brandColor: null, accentColor: null },
  checkIns: [], goals: [], unreadMessages: 0, hasProgram: true, intake: null, photosEnabled: true, reports: [],
};

const NOT_STARTED: IntakeState = { status: 'not_started', completeness: 0, transcript: [], fields: [], current: 'goal' };
const ASKED: IntakeState = {
  status: 'in_progress', completeness: 0, fields: [], current: 'goal',
  transcript: [{ role: 'trainer', text: 'What do you want from training?', field: 'goal', at: '2026-10-16T09:00:00.000Z' }],
};
const PROBED: IntakeState = {
  status: 'in_progress', completeness: 20, current: 'goal',
  fields: [{ key: 'goal', label: 'Goal', required: true, answer: 'Get fit' }],
  transcript: [
    ...ASKED.transcript,
    { role: 'client', text: 'Get fit', at: '2026-10-16T09:01:00.000Z' },
    { role: 'trainer', text: 'What would "fit" let you do that you cannot now?', field: 'goal', probe: true, at: '2026-10-16T09:01:05.000Z' },
  ],
};

const PROGRAM: PortalProgram = {
  id: 'p1', name: 'Strength block', description: 'Four weeks of heavy basics.', startDate: '2026-10-12', version: 2,
  skip: ['bulgarian split squat'], canApplyInApp: true, appliedAt: null,
  doc: {
    weeks: [
      {
        id: 'w1', label: 'Week 1',
        days: [{
          id: 'd1', name: 'Lower A', weekday: 1,
          blocks: [
            { id: 'b1', kind: 'single', items: [{ id: 'i1', name: 'Back Squat', sets: 3, reps: '5', load: { type: 'percent1rm', value: 75 }, restSec: 180, tempo: '3-1-1' }] },
            {
              id: 'b2', kind: 'superset', rounds: 3,
              items: [
                { id: 'i2', name: 'Bulgarian Split Squat', sets: 3, reps: '8', load: { type: 'rpe', value: 8 }, restSec: 90 },
                { id: 'i3', name: 'Plank', sets: 3, reps: '30s', load: { type: 'bodyweight' }, notes: 'Squeeze glutes' },
              ],
            },
          ],
        }],
      },
      { id: 'w2', label: 'Deload', days: [{ id: 'd2', name: 'Easy day', blocks: [{ id: 'b3', kind: 'amrap', timeCapMin: 12, items: [{ id: 'i4', name: 'Row', sets: 1, reps: '250m' }] }] }] },
    ],
  },
};

const NUTRITION: PortalNutrition = {
  targets: { calories: 2200, proteinG: 150, carbsG: null, fatG: null },
  week: { windowDays: 7, daysLogged: 1, avgCalories: 1650, avgProteinG: 120, avgCarbsG: 180, avgFatG: 55, caloriesOnTarget: 0, proteinOnTarget: 0 },
  days: [{ date: '2026-10-15', calories: 1650, proteinG: 120, carbsG: 180, fatG: 55 }],
};

type Handler = (init: RequestInit) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;
let routes: Record<string, Handler>;
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  window.localStorage.clear();
  routes = {
    'GET /pt-portal/home': () => ({ body: HOME }),
    'GET /pt-portal/intake': () => ({ body: { intake: NOT_STARTED } }),
    'POST /pt-portal/intake/start': () => ({ body: { intake: ASKED } }),
    'GET /pt-portal/measurements': () => ({ body: { measurements: [] } }),
    'GET /pt-portal/nutrition': () => ({ body: { nutrition: { ...NUTRITION, week: { ...NUTRITION.week, daysLogged: 0 }, days: [] } } }),
    'GET /pt-portal/program': () => ({ body: { trainerProgram: PROGRAM, program: null } }),
    'GET /pt-portal/photos': () => ({ body: { photos: [] } }),
  };
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}): Promise<Response> => {
    const path = new URL(url).pathname.replace(/^\/api/, '');
    const handler = routes[`${init.method ?? 'GET'} ${path}`];
    if (!handler) return json(404, { error: 'Not found' });
    const { status = 200, body } = await handler(init);
    return json(status, body);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function renderPortal(search = '') {
  const { hook, searchHook } = memoryLocation({ path: `/c/tok${search}` });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook} searchHook={searchHook}><Route path="/c/:token" component={PortalApp} /></Router>
    </QueryClientProvider>,
  );
}

describe('program helpers', () => {
  it('formats loads, rest and sets', () => {
    expect(formatLoad({ type: 'percent1rm', value: 75 })).toBe('75% 1RM');
    expect(formatLoad({ type: 'rpe', value: 8.5 })).toBe('RPE 8.5');
    expect(formatLoad({ type: 'rir', value: 2 })).toBe('RIR 2');
    expect(formatLoad({ type: 'kg', value: 60 })).toBe('60 kg');
    expect(formatLoad({ type: 'lb', value: 135 })).toBe('135 lb');
    expect(formatLoad({ type: 'bodyweight' })).toBe('Bodyweight');
    expect(formatLoad({ type: 'none' })).toBeNull();
    expect(formatLoad({ type: 'kg' })).toBeNull();
    expect(formatLoad(undefined)).toBeNull();
    expect(formatRest(45)).toBe('45s rest');
    expect(formatRest(120)).toBe('2 min rest');
    expect(formatRest(150)).toBe('2:30 rest');
    expect(formatRest(0)).toBeNull();
    expect(formatSetsReps({ sets: 3, reps: '8-10' })).toBe('3 × 8-10');
    expect(formatSetsReps({ sets: 2, reps: '' })).toBe('2 sets');
  });
  it('labels straight sets by letter and groups as A1/A2', () => {
    const blocks = PROGRAM.doc.weeks[0].days[0].blocks;
    expect(itemLabels(blocks)).toEqual([['A'], ['B1', 'B2']]);
    expect(blockHeading(blocks[0])).toBeNull();
    expect(blockHeading(blocks[1])).toBe('Superset · 3 rounds');
    expect(blockHeading({ id: 'x', kind: 'emom', timeCapMin: 10, items: [] })).toBe('EMOM · 10 min');
  });
  it('picks the current week from the start date, clamped', () => {
    expect(currentWeekIndex(null, 4)).toBe(0);
    expect(currentWeekIndex('2026-10-01', 4, new Date(2026, 9, 1))).toBe(0);
    expect(currentWeekIndex('2026-10-01', 4, new Date(2026, 9, 9))).toBe(1);
    expect(currentWeekIndex('2026-10-01', 4, new Date(2027, 0, 1))).toBe(3);
    expect(currentWeekIndex('2026-10-20', 4, new Date(2026, 9, 1))).toBe(0);
  });
  it('parses optional numbers and appends spoken text', () => {
    expect(parseOptionalNumber('')).toBeUndefined();
    expect(parseOptionalNumber('12.5')).toBe(12.5);
    expect(parseOptionalNumber('-1')).toBeNull();
    expect(appendSpoken('', 'hi')).toBe('hi');
    expect(appendSpoken('I train ', 'three days')).toBe('I train three days');
  });
});

describe('intake chat', () => {
  it('shows the intake card on Home while it is unfinished', async () => {
    renderPortal();
    expect(await screen.findByRole('button', { name: /Tell Kofi about you\s*0% done/ })).toBeInTheDocument();
  });

  it('starts, sends an answer with a typing indicator, and marks follow-ups', async () => {
    const user = userEvent.setup();
    const gate: { release: () => void } = { release: () => {} };
    let answered: unknown = null;
    routes['POST /pt-portal/intake/answer'] = async (init) => {
      answered = JSON.parse(String(init.body));
      await new Promise<void>((r) => { gate.release = r; });
      return { body: { intake: PROBED } };
    };
    renderPortal('?tab=intake');

    expect(await screen.findByText('A few questions before you start')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('What do you want from training?')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Your answer'), 'Get fit');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(screen.getByRole('status')).toHaveTextContent('Kofi is reading your answer');
    expect(screen.getByLabelText('Your answer')).toHaveValue('');
    expect(answered).toEqual({ text: 'Get fit' });

    gate.release();
    expect(await screen.findByText('What would "fit" let you do that you cannot now?')).toBeInTheDocument();
    expect(screen.getByText('follow-up')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Intake completeness' })).toHaveAttribute('aria-valuenow', '20');
  });

  it('puts the answer back when sending fails', async () => {
    const user = userEvent.setup();
    routes['GET /pt-portal/intake'] = () => ({ body: { intake: ASKED } });
    routes['POST /pt-portal/intake/answer'] = () => ({ status: 429, body: { error: 'Give it a moment and try again.' } });
    renderPortal('?tab=intake');
    await user.type(await screen.findByLabelText('Your answer'), 'Run a 10k');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(await screen.findByText('Give it a moment and try again.')).toBeInTheDocument();
    expect(screen.getByLabelText('Your answer')).toHaveValue('Run a 10k');
  });

  it('thanks the client once complete', async () => {
    routes['GET /pt-portal/intake'] = () => ({ body: { intake: { ...PROBED, status: 'complete', completeness: 100, current: null } } });
    renderPortal('?tab=intake');
    expect(await screen.findByText("Thanks, that's everything.")).toBeInTheDocument();
    expect(screen.queryByLabelText('Your answer')).not.toBeInTheDocument();
    expect(screen.getByText('Get fit')).toBeInTheDocument();
  });
});

describe('trainer program', () => {
  it('renders blocks with labels, loads and a skip marker, and switches weeks', async () => {
    const user = userEvent.setup();
    renderPortal('?tab=program');
    expect(await screen.findByRole('heading', { name: 'Strength block' })).toBeInTheDocument();
    expect(screen.getByText('Four weeks of heavy basics.')).toBeInTheDocument();

    expect(screen.getByText('3 × 5 · 75% 1RM · 3 min rest · Tempo 3-1-1')).toBeInTheDocument();
    const superset = screen.getByRole('group', { name: 'Superset · 3 rounds' });
    expect(within(superset).getByText('B1')).toBeInTheDocument();
    expect(within(superset).getByText('B2')).toBeInTheDocument();
    expect(within(superset).getByText('3 × 8 · RPE 8 · 1:30 rest')).toBeInTheDocument();
    expect(within(superset).getByText('3 × 30s · Bodyweight')).toBeInTheDocument();

    // Only the refused exercise is marked.
    const markers = screen.getAllByText('Skip this for now: your trainer is updating it');
    expect(markers).toHaveLength(1);
    expect(markers[0].closest('li')).toHaveTextContent('Bulgarian Split Squat');

    await user.click(screen.getByRole('tab', { name: 'Deload' }));
    expect(screen.getByText('Easy day')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'AMRAP · 12 min' })).toBeInTheDocument();
  });

  it('applies the program in the app after a confirm', async () => {
    const user = userEvent.setup();
    let applied = 0;
    routes['POST /pt-portal/program/apply'] = () => { applied++; return { body: { ok: true } }; };
    renderPortal('?tab=program');
    await user.click(await screen.findByRole('button', { name: 'Use this program in the Axiom app' }));
    expect(applied).toBe(0);
    await user.click(await screen.findByRole('button', { name: 'Replace my program' }));
    await waitFor(() => expect(applied).toBe(1));
    expect(await screen.findByText('Done. Open the Axiom app to start.')).toBeInTheDocument();
  });

  it('hides apply for a link-only client', async () => {
    routes['GET /pt-portal/program'] = () => ({ body: { trainerProgram: { ...PROGRAM, canApplyInApp: false }, program: null } });
    renderPortal('?tab=program');
    await screen.findByRole('heading', { name: 'Strength block' });
    expect(screen.queryByRole('button', { name: /Axiom app/ })).not.toBeInTheDocument();
  });
});

describe('meal logging', () => {
  it('logs a meal and shows the week against the targets', async () => {
    const user = userEvent.setup();
    let posted: Record<string, unknown> | null = null;
    routes['POST /pt-portal/meals'] = (init) => { posted = JSON.parse(String(init.body)); return { status: 201, body: { nutrition: NUTRITION } }; };
    renderPortal('?tab=log');

    expect(await screen.findByText('No meals logged this week')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save meal' });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('What did you eat?'), 'Chicken and rice');
    await user.type(screen.getByLabelText(/^Calories/), '650');
    await user.type(screen.getByLabelText(/^Protein/), '45');
    await user.selectOptions(screen.getByLabelText('Meal'), 'lunch');
    await user.click(save);

    expect(await screen.findByText('1 of 7 days logged')).toBeInTheDocument();
    expect(posted).toMatchObject({ name: 'Chicken and rice', calories: 650, proteinG: 45, mealType: 'lunch' });
    expect(posted!).not.toHaveProperty('carbsG');
    expect(typeof posted!.date).toBe('string');
    expect(screen.getByText(/1,650 kcal a day · target 2,200 kcal/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Calories: average against target' })).toHaveAttribute('aria-valuenow', '75');
    expect(screen.queryByRole('progressbar', { name: 'Carbs: average against target' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('What did you eat?')).toHaveValue('');
  });
});

describe('photos switched off', () => {
  it('says so up front, before anyone picks a photo', async () => {
    routes['GET /pt-portal/home'] = () => ({ body: { ...HOME, photosEnabled: false } });
    renderPortal('?tab=photos');
    expect(await screen.findByText("Photo uploads aren't available yet")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a photo/ })).not.toBeInTheDocument();
  });
});
