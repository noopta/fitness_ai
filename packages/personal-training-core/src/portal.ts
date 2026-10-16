// Typed client for /api/pt-portal — the no-install client's pages. The
// platform's fetcher must send `Authorization: PtLink <token>` and nothing
// else: the portal never carries the Axiom session.

import type { CheckInRequest, Measurement, MeasurementKind, PortalHome, PortalMessage, ProgressPhoto, ClientProgramView, ReportStats } from './types';
import type { Fetcher } from './api';

export const PORTAL_PREFIX = '/pt-portal';

export interface PortalReport {
  id: string;
  month: string;
  narrative: string;
  coachNote: string;
  nextLine: string;
  stats: ReportStats | null;
  sentAt: string | null;
}

export const portalKeys = {
  home: ['pt-portal', 'home'] as const,
  checkIn: (id: string) => ['pt-portal', 'check-ins', id] as const,
  measurements: ['pt-portal', 'measurements'] as const,
  photos: ['pt-portal', 'photos'] as const,
  messages: ['pt-portal', 'messages'] as const,
  program: ['pt-portal', 'program'] as const,
  report: (id: string) => ['pt-portal', 'reports', id] as const,
};

export function createPortalApi(fetcher: Fetcher) {
  const P = PORTAL_PREFIX;
  return {
    home: () => fetcher(`${P}/home`) as Promise<PortalHome>,
    checkIn: (id: string) => fetcher(`${P}/check-ins/${encodeURIComponent(id)}`) as Promise<CheckInRequest>,
    submitCheckIn: (id: string, answers: Record<string, string | number>) =>
      fetcher(`${P}/check-ins/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ answers }) }) as Promise<unknown>,
    transcribe: (audioBase64: string, mimeType: string) =>
      fetcher(`${P}/transcribe`, { method: 'POST', body: JSON.stringify({ audioBase64, mimeType }) }) as Promise<{ text: string }>,
    measurements: () => fetcher(`${P}/measurements`) as Promise<{ measurements: Measurement[] }>,
    addMeasurement: (input: { kind: MeasurementKind; value: number; unit: string; date?: string; label?: string }) =>
      fetcher(`${P}/measurements`, { method: 'POST', body: JSON.stringify(input) }) as Promise<{ measurements: Measurement[] }>,
    photos: () => fetcher(`${P}/photos`) as Promise<{ photos: ProgressPhoto[] }>,
    addPhoto: (input: { imageBase64: string; pose?: ProgressPhoto['pose']; date?: string; note?: string }) =>
      fetcher(`${P}/photos`, { method: 'POST', body: JSON.stringify(input) }) as Promise<{ photos: ProgressPhoto[] }>,
    deletePhoto: (id: string) => fetcher(`${P}/photos/${encodeURIComponent(id)}`, { method: 'DELETE' }) as Promise<{ ok: true }>,
    messages: () => fetcher(`${P}/messages`) as Promise<{ messages: PortalMessage[] }>,
    sendMessage: (text: string) => fetcher(`${P}/messages`, { method: 'POST', body: JSON.stringify({ text }) }) as Promise<{ message: PortalMessage }>,
    program: () => fetcher(`${P}/program`) as Promise<{ program: ClientProgramView | null }>,
    report: (id: string) => fetcher(`${P}/reports/${encodeURIComponent(id)}`) as Promise<{ report: PortalReport }>,
  };
}

export type PortalApi = ReturnType<typeof createPortalApi>;

// ── Intake, meals and the trainer's program ──
import type { IntakeState, NutritionRollup, NutritionTargets, PortalProgram } from './types';

export interface PortalNutrition {
  targets: NutritionTargets | null;
  week: NutritionRollup;
  days: { date: string; calories: number; proteinG: number; carbsG: number; fatG: number }[];
}

export const portalKeysExtra = {
  intake: ['pt-portal', 'intake'] as const,
  nutrition: ['pt-portal', 'nutrition'] as const,
};

export function createPortalApiExtra(fetcher: Fetcher) {
  const P = PORTAL_PREFIX;
  return {
    intake: () => fetcher(`${P}/intake`) as Promise<{ intake: IntakeState }>,
    startIntake: () => fetcher(`${P}/intake/start`, { method: 'POST' }) as Promise<{ intake: IntakeState }>,
    answerIntake: (text: string) => fetcher(`${P}/intake/answer`, { method: 'POST', body: JSON.stringify({ text }) }) as Promise<{ intake: IntakeState }>,
    nutrition: () => fetcher(`${P}/nutrition`) as Promise<{ nutrition: PortalNutrition }>,
    logMeal: (input: { name: string; calories?: number; proteinG?: number; carbsG?: number; fatG?: number; mealType?: string; date?: string }) =>
      fetcher(`${P}/meals`, { method: 'POST', body: JSON.stringify(input) }) as Promise<{ nutrition: PortalNutrition }>,
    /** `trainerProgram` is the trainer's published program; `program` is the client's own app program, if any. */
    programs: () => fetcher(`${P}/program`) as Promise<{ trainerProgram: PortalProgram | null; program: import('./types').ClientProgramView | null }>,
    applyProgram: () => fetcher(`${P}/program/apply`, { method: 'POST' }) as Promise<{ ok: true }>,
    billing: () => fetcher(`${P}/billing`) as Promise<{ available: boolean; offers: import('./types').OfferView[]; plans: import('./types').ClientPlanView[]; payments: import('./types').PaymentView[] }>,
    /** Returns Stripe's hosted checkout URL to navigate to. */
    checkout: (offerId: string) => fetcher(`${P}/billing/checkout`, { method: 'POST', body: JSON.stringify({ offerId }) }) as Promise<{ url: string }>,
    /** Stripe's customer portal: update card, cancel. */
    manageBilling: () => fetcher(`${P}/billing/manage`, { method: 'POST' }) as Promise<{ url: string }>,
    slots: (days = 14) => fetcher(`${P}/slots?days=${days}`) as Promise<{ slots: import('./types').Slot[] }>,
    bookings: () => fetcher(`${P}/bookings`) as Promise<{ bookings: import('./types').BookingView[] }>,
    book: (startsAt: string, trainerId?: string) => fetcher(`${P}/bookings`, { method: 'POST', body: JSON.stringify({ startsAt, ...(trainerId ? { trainerId } : {}) }) }) as Promise<{ booking: import('./types').BookingView }>,
    cancelBooking: (id: string) => fetcher(`${P}/bookings/${encodeURIComponent(id)}`, { method: 'DELETE' }) as Promise<{ booking: import('./types').BookingView }>,
  };
}

export interface MealEstimate {
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  mealType: string;
  confidence: string | null;
}

/** A photo estimate for the client to check before logging. Nothing is logged by this call. */
export const estimateMealPath = `${PORTAL_PREFIX}/meals/estimate`;
