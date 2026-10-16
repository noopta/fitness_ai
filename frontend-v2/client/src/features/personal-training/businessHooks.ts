// Server state for the trainer's business surfaces: the messaging inbox,
// billing (Stripe Connect, offers, revenue) and scheduling. Same conventions
// as hooks.ts — short stale time, refetch on focus, no retry on a 4xx.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PersonalTrainingApiError, queryKeys,
  type AvailabilityWindow, type BillingStatus, type BookingView, type Client, type LeadView, type OfferView,
} from '@axiom/personal-training-core';
import { ptApi } from './api';

const LIVE = { staleTime: 60_000, refetchOnWindowFocus: true } as const;

const retry = (count: number, err: unknown) =>
  count < 2 && !(err instanceof PersonalTrainingApiError && err.status < 500);

// ── Inbox ────────────────────────────────────────────────────────────────────

export function useInbox(opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.inbox,
    queryFn: () => ptApi.inbox(),
    retry,
    ...LIVE,
    ...(opts.poll ? { refetchInterval: 30_000, refetchIntervalInBackground: false } : {}),
  });
}

/** Total unread messages across threads, for the nav badge. Shares the inbox query. */
export function useInboxUnread(): number {
  const q = useInbox();
  return q.data?.threads.reduce((n, t) => n + t.unread, 0) ?? 0;
}

export function useInboxThread(clientId: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: queryKeys.inboxThread(clientId),
    queryFn: async () => {
      const convo = await ptApi.inboxThread(clientId);
      // Opening a thread marks it read on the server.
      qc.setQueryData<{ threads: Awaited<ReturnType<typeof ptApi.inbox>>['threads'] }>(queryKeys.inbox, (d) =>
        d ? { threads: d.threads.map((t) => (t.clientId === clientId ? { ...t, unread: 0 } : t)) } : d);
      return convo;
    },
    enabled: !!clientId,
    retry,
    staleTime: 0,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useDraftInboxReply(clientId: string) {
  return useMutation({ mutationFn: () => ptApi.draftInboxReply(clientId) });
}

/** A direct message; it goes through the undo window like every draft, then lands in the thread. */
export function useMessageClient(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => ptApi.messageClient(clientId, text),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.inbox, exact: true });
    },
  });
}

// ── Billing ──────────────────────────────────────────────────────────────────

export function useBillingStatus() {
  return useQuery({ queryKey: queryKeys.billingStatus, queryFn: () => ptApi.billingStatus(), retry, ...LIVE });
}

/** Ask Stripe again (after returning from onboarding) and store the fresh answer. */
export function useRefreshBillingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ptApi.billingStatus(true),
    onSuccess: (d) => qc.setQueryData(queryKeys.billingStatus, d),
  });
}

export function useConnectStripe() {
  return useMutation({ mutationFn: () => ptApi.connectStripe() });
}

export function useSaveBillingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: Partial<Pick<BillingStatus, 'dunningNudges' | 'bookingNeedsCredit'>>) => ptApi.saveBillingSettings(s),
    onMutate: async (s) => {
      await qc.cancelQueries({ queryKey: queryKeys.billingStatus });
      const prev = qc.getQueryData<{ status: BillingStatus }>(queryKeys.billingStatus);
      if (prev) qc.setQueryData(queryKeys.billingStatus, { status: { ...prev.status, ...s } });
      return { prev };
    },
    onError: (_e, _s, ctx) => { if (ctx?.prev) qc.setQueryData(queryKeys.billingStatus, ctx.prev); },
    onSuccess: (d) => qc.setQueryData(queryKeys.billingStatus, d),
  });
}

export function useOffers(enabled = true) {
  return useQuery({ queryKey: queryKeys.offers, queryFn: () => ptApi.offers(), enabled, retry, ...LIVE });
}

export type OfferInput = Parameters<typeof ptApi.createOffer>[0];

export function useCreateOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (o: OfferInput) => ptApi.createOffer(o),
    onSuccess: ({ offer }) => {
      qc.setQueryData<{ offers: OfferView[] }>(queryKeys.offers, (d) => (d ? { offers: [...d.offers, offer] } : d));
      void qc.invalidateQueries({ queryKey: queryKeys.offers });
    },
  });
}

export function useArchiveOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ptApi.archiveOffer(id),
    onSuccess: (_d, id) => {
      qc.setQueryData<{ offers: OfferView[] }>(queryKeys.offers, (d) => (d ? { offers: d.offers.map((o) => (o.id === id ? { ...o, active: false } : o)) } : d));
      void qc.invalidateQueries({ queryKey: queryKeys.offers });
      void qc.invalidateQueries({ queryKey: queryKeys.revenue });
    },
  });
}

export function useRevenue(enabled = true) {
  return useQuery({ queryKey: queryKeys.revenue, queryFn: () => ptApi.revenue(), enabled, retry, ...LIVE });
}

// ── Scheduling ───────────────────────────────────────────────────────────────

export function useAvailability() {
  return useQuery({ queryKey: queryKeys.availability, queryFn: () => ptApi.availability(), retry, ...LIVE });
}

export function useSetAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (windows: AvailabilityWindow[]) => ptApi.setAvailability(windows),
    onSuccess: (d) => qc.setQueryData(queryKeys.availability, d),
  });
}

export function useBookings(range: { from: string; to: string }) {
  return useQuery({
    queryKey: queryKeys.bookings(`${range.from}|${range.to}`),
    queryFn: () => ptApi.bookings(range),
    retry,
    ...LIVE,
  });
}

const refreshBookings = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: ['personal-training', 'schedule', 'bookings'] });

export function useBookSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { clientId: string; startsAt: string; minutes?: number; notes?: string }) => ptApi.bookSession(input),
    onSuccess: () => refreshBookings(qc),
  });
}

export function useUpdateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: 'cancelled' | 'completed' | 'no_show' }) => ptApi.updateBooking(v.id, v.status),
    onSuccess: ({ booking }) => {
      qc.setQueriesData<{ bookings: BookingView[] }>({ queryKey: ['personal-training', 'schedule', 'bookings'] }, (d) =>
        d ? { bookings: d.bookings.map((b) => (b.id === booking.id ? booking : b)) } : d);
      void refreshBookings(qc);
    },
  });
}

// ── Retention ────────────────────────────────────────────────────────────────

export function useRetention() {
  return useQuery({ queryKey: queryKeys.retention, queryFn: () => ptApi.retention(), retry, ...LIVE });
}

export function useDraftOutreach(clientId: string) {
  return useMutation({ mutationFn: () => ptApi.draftOutreach(clientId) });
}

// ── Leads ────────────────────────────────────────────────────────────────────

const LEADS_KEY = ['personal-training', 'leads'] as const;

export function useLeads() {
  return useQuery({ queryKey: LEADS_KEY, queryFn: () => ptApi.leads(), retry, ...LIVE });
}

const storeLead = (qc: ReturnType<typeof useQueryClient>, lead: LeadView) =>
  qc.setQueryData<{ leads: LeadView[] }>(LEADS_KEY, (d) => {
    if (!d) return d;
    const has = d.leads.some((l) => l.id === lead.id);
    return { leads: has ? d.leads.map((l) => (l.id === lead.id ? lead : l)) : [lead, ...d.leads] };
  });

export function useAddLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof ptApi.addLead>[0]) => ptApi.addLead(input),
    onSuccess: ({ lead }) => storeLead(qc, lead),
  });
}

export function useUpdateLead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof ptApi.updateLead>[1]) => ptApi.updateLead(id, patch),
    onSuccess: ({ lead }) => storeLead(qc, lead),
  });
}

export function useConvertLead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ptApi.convertLead(id),
    onSuccess: ({ client }) => {
      qc.setQueryData<{ leads: LeadView[] }>(LEADS_KEY, (d) => (d ? { leads: d.leads.map((l) => (l.id === id ? { ...l, clientId: client.id, status: 'won', needsFollowUp: false } : l)) } : d));
      void qc.invalidateQueries({ queryKey: LEADS_KEY });
      void qc.invalidateQueries({ queryKey: queryKeys.roster, exact: true });
    },
  });
}

// ── Team ─────────────────────────────────────────────────────────────────────

/** A 403 here means "not the owner": a decision, not an outage. */
const ownerOnly = { retry: false, staleTime: 60_000, refetchOnWindowFocus: true } as const;

export function useTeam() {
  return useQuery({ queryKey: queryKeys.team, queryFn: () => ptApi.team(), retry, ...LIVE });
}

export function useTeamAnalytics(enabled = true) {
  return useQuery({ queryKey: queryKeys.teamAnalytics, queryFn: () => ptApi.teamAnalytics(), enabled, ...ownerOnly });
}

export function useInviteCoach() {
  return useMutation({ mutationFn: (email: string) => ptApi.inviteCoach(email) });
}

export function useRemoveCoach() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => ptApi.removeCoach(userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.team });
      void qc.invalidateQueries({ queryKey: queryKeys.roster, exact: true });
    },
  });
}

export function useAcceptCoachInvite(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ptApi.acceptCoachInvite(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

export function useAssignClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { clientId: string; trainerId: string | null }) => ptApi.assignClient(v.clientId, v.trainerId),
    onSuccess: (_d, v) => {
      qc.setQueryData<{ clients: Client[] }>(queryKeys.roster, (d) =>
        d ? { ...d, clients: d.clients.map((c) => (c.id === v.clientId ? { ...c, assignedTrainerId: v.trainerId } : c)) } : d);
      void qc.invalidateQueries({ queryKey: queryKeys.team });
    },
  });
}
