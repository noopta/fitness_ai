// React Query bindings for the portal. The API instance comes from context so
// tests can hand in a client built on a mocked fetch.

import { createContext, useCallback, useContext } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useParams, useSearch } from 'wouter';
import {
  portalKeys, portalKeysExtra,
  type IntakeState, type MeasurementKind, type PortalHome, type PortalMessage, type ProgressPhoto,
} from '@axiom/personal-training-core';
import type { FullPortalApi } from './api';

export const PortalApiContext = createContext<FullPortalApi | null>(null);

export function usePortalApi(): FullPortalApi {
  const api = useContext(PortalApiContext);
  if (!api) throw new Error('usePortalApi outside PortalApiContext');
  return api;
}

// ─── Navigation (query params, so email and DM deep links work) ─────────────

export type PortalTab = 'home' | 'book' | 'messages' | 'log' | 'photos' | 'program' | 'billing' | 'intake';
/** Every `?tab=` value; the intake is reached from Home, the rest from the bar or More. */
export const PORTAL_TABS: PortalTab[] = ['home', 'book', 'messages', 'log', 'photos', 'program', 'billing', 'intake'];

export function usePortalNav() {
  const { token = '' } = useParams<{ token: string }>();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const rawTab = params.get('tab') as PortalTab | null;
  const tab: PortalTab = rawTab && PORTAL_TABS.includes(rawTab) ? rawTab : 'home';
  const checkIn = params.get('checkin');
  const report = params.get('report');
  /** The offer a trainer's payment link picked, and Stripe's return flag. */
  const offer = params.get('offer');
  const paid = params.get('paid') === '1';
  const go = useCallback((next: { tab?: PortalTab; checkin?: string; report?: string }) => {
    const q = new URLSearchParams();
    if (next.checkin) q.set('checkin', next.checkin);
    else if (next.report) q.set('report', next.report);
    else if (next.tab && next.tab !== 'home') q.set('tab', next.tab);
    const qs = q.toString();
    navigate(`/c/${encodeURIComponent(token)}${qs ? `?${qs}` : ''}`);
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      try { window.scrollTo(0, 0); } catch { /* not in every environment */ }
    }
  }, [navigate, token]);
  return { token, tab, checkIn, report, offer, paid, go };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useHome() {
  const api = usePortalApi();
  // Unread count and due check-ins change under the client; refresh on focus.
  return useQuery({ queryKey: portalKeys.home, queryFn: api.home, staleTime: 30_000, refetchOnWindowFocus: true });
}

export function useCheckIn(id: string) {
  const api = usePortalApi();
  return useQuery({ queryKey: portalKeys.checkIn(id), queryFn: () => api.checkIn(id), enabled: !!id, staleTime: 0 });
}

export function useSubmitCheckIn(id: string) {
  const api = usePortalApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (answers: Record<string, string | number>) => api.submitCheckIn(id, answers),
    onSuccess: () => {
      qc.setQueryData<PortalHome>(portalKeys.home, (h) => (h ? { ...h, checkIns: h.checkIns.filter((c) => c.id !== id) } : h));
      qc.invalidateQueries({ queryKey: portalKeys.home });
      qc.invalidateQueries({ queryKey: portalKeys.checkIn(id) });
    },
  });
}

export function useTranscribe() {
  const api = usePortalApi();
  return useMutation({ mutationFn: (v: { audioBase64: string; mimeType: string }) => api.transcribe(v.audioBase64, v.mimeType) });
}

export function useMeasurements() {
  const api = usePortalApi();
  return useQuery({ queryKey: portalKeys.measurements, queryFn: api.measurements, staleTime: 60_000 });
}

export function useAddMeasurement() {
  const api = usePortalApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: MeasurementKind; value: number; unit: string; date?: string }) => api.addMeasurement(input),
    onSuccess: (data) => {
      qc.setQueryData(portalKeys.measurements, data);
      // A weigh-in moves bodyweight goals.
      qc.invalidateQueries({ queryKey: portalKeys.home });
    },
  });
}

export function usePhotos() {
  const api = usePortalApi();
  // Photo URLs are short-lived signed links: refetch whenever the tab opens.
  return useQuery({ queryKey: portalKeys.photos, queryFn: api.photos, staleTime: 0, refetchOnMount: 'always' });
}

export function useAddPhoto() {
  const api = usePortalApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { imageBase64: string; pose: ProgressPhoto['pose']; date?: string }) => api.addPhoto(input),
    onSuccess: (data) => qc.setQueryData(portalKeys.photos, data),
  });
}

export function useDeletePhoto() {
  const api = usePortalApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePhoto(id),
    onSuccess: (_d, id) => qc.setQueryData<{ photos: ProgressPhoto[] }>(portalKeys.photos, (p) => (p ? { photos: p.photos.filter((x) => x.id !== id) } : p)),
  });
}

/** A message the client has sent that the server has not confirmed yet. */
export type ThreadMessage = PortalMessage & { pending?: boolean };

export function useMessages() {
  const api = usePortalApi();
  const qc = useQueryClient();
  return useQuery({
    queryKey: portalKeys.messages,
    queryFn: async () => {
      const data = await api.messages();
      // Reading the thread marks it read on the server.
      qc.setQueryData<PortalHome>(portalKeys.home, (h) => (h ? { ...h, unreadMessages: 0 } : h));
      return data as { messages: ThreadMessage[] };
    },
    staleTime: 0,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

let tempSeq = 0;

export function useSendMessage() {
  const api = usePortalApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api.sendMessage(text),
    onMutate: async (text) => {
      await qc.cancelQueries({ queryKey: portalKeys.messages });
      const prev = qc.getQueryData<{ messages: ThreadMessage[] }>(portalKeys.messages);
      const temp: ThreadMessage = { id: `pending-${++tempSeq}`, fromClient: true, body: text, at: new Date().toISOString(), pending: true };
      qc.setQueryData<{ messages: ThreadMessage[] }>(portalKeys.messages, { messages: [...(prev?.messages ?? []), temp] });
      return { prev, tempId: temp.id };
    },
    onError: (_e, _text, ctx) => {
      if (ctx) qc.setQueryData(portalKeys.messages, ctx.prev ?? { messages: [] });
    },
    onSuccess: ({ message }, _text, ctx) => {
      qc.setQueryData<{ messages: ThreadMessage[] }>(portalKeys.messages, (d) => {
        // A poll may have landed mid-send and already carry the real message, or dropped the placeholder.
        const rest = (d?.messages ?? []).filter((m) => m.id !== ctx?.tempId && m.id !== message.id);
        return { messages: [...rest, message].sort((a, b) => a.at.localeCompare(b.at)) };
      });
    },
  });
}

/** The trainer's published program, plus the client's own app program as a fallback. */
export function usePrograms() {
  const api = usePortalApi();
  return useQuery({ queryKey: portalKeys.program, queryFn: api.programs, staleTime: 60_000, refetchOnWindowFocus: true });
}

export function useApplyProgram() {
  const api = usePortalApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.applyProgram(),
    onSuccess: () => qc.invalidateQueries({ queryKey: portalKeys.program }),
  });
}

// ─── Intake ──────────────────────────────────────────────────────────────────

export function useIntake() {
  const api = usePortalApi();
  return useQuery({ queryKey: portalKeysExtra.intake, queryFn: api.intake, staleTime: 0 });
}

function useIntakeMutation<V>(fn: (v: V) => Promise<{ intake: IntakeState }>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: ({ intake }) => {
      qc.setQueryData(portalKeysExtra.intake, { intake });
      qc.setQueryData<PortalHome>(portalKeys.home, (h) => (h ? { ...h, intake: { status: intake.status, completeness: intake.completeness } } : h));
    },
  });
}

export function useStartIntake() {
  const api = usePortalApi();
  return useIntakeMutation<void>(() => api.startIntake());
}

export function useAnswerIntake() {
  const api = usePortalApi();
  return useIntakeMutation<string>((text) => api.answerIntake(text));
}

// ─── Nutrition ───────────────────────────────────────────────────────────────

export function useNutrition() {
  const api = usePortalApi();
  return useQuery({ queryKey: portalKeysExtra.nutrition, queryFn: api.nutrition, staleTime: 60_000 });
}

export type MealInput = Parameters<FullPortalApi['logMeal']>[0];

/** Read a meal photo into numbers for the client to check. Never logs anything. */
export function useEstimateMeal() {
  const api = usePortalApi();
  return useMutation({ mutationFn: (imageBase64: string) => api.estimateMeal(imageBase64, 'image/jpeg') });
}

export function useLogMeal() {
  const api = usePortalApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MealInput) => api.logMeal(input),
    onSuccess: (data) => qc.setQueryData(portalKeysExtra.nutrition, data),
  });
}

export function useReport(id: string) {
  const api = usePortalApi();
  return useQuery({ queryKey: portalKeys.report(id), queryFn: () => api.report(id), enabled: !!id });
}

// ─── Paying and booking ──────────────────────────────────────────────────────

export const portalBusinessKeys = {
  billing: ['pt-portal', 'billing'] as const,
  slots: ['pt-portal', 'slots'] as const,
  bookings: ['pt-portal', 'bookings'] as const,
};

export function usePortalBilling() {
  const api = usePortalApi();
  return useQuery({ queryKey: portalBusinessKeys.billing, queryFn: () => api.billing(), staleTime: 30_000, refetchOnWindowFocus: true });
}

export function useCheckout() {
  const api = usePortalApi();
  return useMutation({ mutationFn: (offerId: string) => api.checkout(offerId) });
}

export function useManageBilling() {
  const api = usePortalApi();
  return useMutation({ mutationFn: () => api.manageBilling() });
}

export function useSlots() {
  const api = usePortalApi();
  return useQuery({ queryKey: portalBusinessKeys.slots, queryFn: () => api.slots(14), staleTime: 30_000, refetchOnWindowFocus: true });
}

export function usePortalBookings() {
  const api = usePortalApi();
  return useQuery({ queryKey: portalBusinessKeys.bookings, queryFn: () => api.bookings(), staleTime: 30_000, refetchOnWindowFocus: true });
}

export function useBook() {
  const api = usePortalApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slot: { startsAt: string; trainerId?: string }) => api.book(slot.startsAt, slot.trainerId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: portalBusinessKeys.bookings });
      void qc.invalidateQueries({ queryKey: portalBusinessKeys.slots });
      void qc.invalidateQueries({ queryKey: portalBusinessKeys.billing });
    },
    onError: (err) => {
      // Someone else took it: show what is actually open now.
      if ((err as { code?: string | null }).code === 'slot_taken') void qc.invalidateQueries({ queryKey: portalBusinessKeys.slots });
    },
  });
}

export function useCancelBooking() {
  const api = usePortalApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelBooking(id),
    onSuccess: ({ booking }) => {
      qc.setQueryData<{ bookings: import('@axiom/personal-training-core').BookingView[] }>(portalBusinessKeys.bookings, (d) =>
        d ? { bookings: d.bookings.map((b) => (b.id === booking.id ? booking : b)) } : d);
      void qc.invalidateQueries({ queryKey: portalBusinessKeys.bookings });
      void qc.invalidateQueries({ queryKey: portalBusinessKeys.slots });
      void qc.invalidateQueries({ queryKey: portalBusinessKeys.billing });
    },
  });
}
