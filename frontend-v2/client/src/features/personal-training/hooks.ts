// Server state for the personal-training views. The app-wide QueryClient
// never refetches (staleTime: Infinity); a roster is live data, so these
// queries opt back in to a short stale time and refetch on focus.

import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PersonalTrainingApiError, queryKeys,
  type AnakinScope, type BriefingItem, type BriefingResponse, type CheckInSchedule, type Draft, type LiftKey,
  type NotificationSettingsPatch, type Report, type ResolveAction, type TimelineKind, type TimelinePage,
} from '@axiom/personal-training-core';
import { ptApi } from './api';

const LIVE = { staleTime: 60_000, refetchOnWindowFocus: true } as const;

/** 4xx answers are decisions, not outages — retrying them only delays the right screen. */
const retry = (count: number, err: unknown) =>
  count < 2 && !(err instanceof PersonalTrainingApiError && err.status < 500);

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: ptApi.me, staleTime: 5 * 60_000, retry });
}

export function useRoster(enabled = true) {
  return useQuery({ queryKey: queryKeys.roster, queryFn: ptApi.roster, enabled, retry, ...LIVE });
}

export function useClient(id: string) {
  return useQuery({ queryKey: queryKeys.client(id), queryFn: () => ptApi.client(id), enabled: !!id, retry, ...LIVE });
}

export function useTimeline(id: string, kinds: TimelineKind[]) {
  return useInfiniteQuery({
    queryKey: queryKeys.timeline(id, kinds),
    queryFn: ({ pageParam }) => ptApi.timeline(id, kinds, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: TimelinePage) => last.nextCursor,
    enabled: !!id,
    retry,
    ...LIVE,
  });
}

export function useCreatePractice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => ptApi.createPractice(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

export function useCreateInvite() {
  return useMutation({ mutationFn: (email?: string) => ptApi.invite(email) });
}

export function useInvitePreview(token: string) {
  return useQuery({ queryKey: queryKeys.invite(token), queryFn: () => ptApi.invitePreview(token), enabled: !!token, retry });
}

export function useAcceptInvite(token: string) {
  return useMutation({ mutationFn: () => ptApi.acceptInvite(token) });
}

// ── Briefing, drafts, check-ins, progress, reports, Anakin, notifications ────


export function useBriefing() {
  return useQuery({ queryKey: queryKeys.briefing, queryFn: ptApi.briefing, retry, staleTime: 30_000, refetchOnWindowFocus: true });
}

/** Replace one item in the cached briefing with the server's version of it. */
function patchBriefingItem(qc: ReturnType<typeof useQueryClient>, item: BriefingItem) {
  qc.setQueryData<BriefingResponse>(queryKeys.briefing, (prev) =>
    prev?.briefing ? { ...prev, briefing: { ...prev.briefing, items: prev.briefing.items.map((i) => (i.id === item.id ? item : i)) } } : prev);
}

export function useResolveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; action: ResolveAction; editedText?: string }) => ptApi.resolveItem(v.id, v.action, v.editedText),
    onSuccess: ({ item }) => patchBriefingItem(qc, item),
  });
}

export function useUndoItem() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => ptApi.undoItem(id), onSuccess: ({ item }) => patchBriefingItem(qc, item) });
}

/** Anything a sent or unsent draft can change on screen. */
function invalidateAfterDraft(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.checkIns });
  void qc.invalidateQueries({ queryKey: queryKeys.briefing });
}

export function useSendDraft() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; text?: string }) => ptApi.sendDraft(v.id, v.text), onSuccess: () => invalidateAfterDraft(qc) });
}

export function useUndoDraft() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => ptApi.undoDraft(id), onSuccess: () => invalidateAfterDraft(qc) });
}

export function useRedraft() {
  return useMutation({ mutationFn: (v: { id: string; text: string }) => ptApi.redraft(v.id, v.text) });
}

/**
 * True while a send can still be undone. Re-renders once, when the window
 * closes, so the Undo button leaves at the moment the server stops honouring it.
 */
export function useCanUndo(undoUntil: string | undefined): boolean {
  const remaining = undoUntil ? new Date(undoUntil).getTime() - Date.now() : 0;
  const [open, setOpen] = useState(remaining > 0);
  useEffect(() => {
    const left = undoUntil ? new Date(undoUntil).getTime() - Date.now() : 0;
    setOpen(left > 0);
    if (left <= 0) return;
    const timer = setTimeout(() => setOpen(false), left);
    return () => clearTimeout(timer);
  }, [undoUntil]);
  return open;
}

export function useCheckIns() {
  return useQuery({ queryKey: queryKeys.checkIns, queryFn: ptApi.checkIns, retry, ...LIVE });
}

export function useCheckInActions() {
  const qc = useQueryClient();
  const refresh = () => invalidateAfterDraft(qc);
  return {
    request: useMutation({ mutationFn: (ids: string[]) => ptApi.requestCheckIns(ids), onSuccess: refresh }),
    sendRoutine: useMutation({ mutationFn: () => ptApi.sendRoutineReplies(), onSuccess: refresh }),
    markRead: useMutation({ mutationFn: (id: string) => ptApi.markCheckInRead(id), onSuccess: refresh }),
  };
}

export function useSchedules() {
  return useQuery({ queryKey: queryKeys.schedules, queryFn: ptApi.schedules, retry, ...LIVE });
}

export function useScheduleActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.schedules });
  return {
    save: useMutation({ mutationFn: (s: Omit<CheckInSchedule, 'id' | 'clientName'>) => ptApi.saveSchedule(s), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (clientId: string) => ptApi.deleteSchedule(clientId), onSuccess: refresh }),
  };
}

export function useCheckInRequest(id: string) {
  return useQuery({ queryKey: queryKeys.checkInRequest(id), queryFn: () => ptApi.checkInRequest(id), enabled: !!id, retry });
}

export function useSubmitCheckIn(id: string) {
  return useMutation({ mutationFn: (answers: Record<string, string | number>) => ptApi.submitCheckIn(id, answers) });
}

export function useProgress(lift: LiftKey, weeks: number) {
  return useQuery({ queryKey: queryKeys.progress(lift, weeks), queryFn: () => ptApi.progress(lift, weeks), retry, ...LIVE });
}

export function useReport(clientId: string, month: string) {
  return useQuery({ queryKey: queryKeys.report(clientId, month), queryFn: () => ptApi.report(clientId, month), enabled: !!clientId, retry, ...LIVE });
}

export function useReportActions(clientId: string, month: string) {
  const qc = useQueryClient();
  const store = ({ report }: { report: Report }) => qc.setQueryData(queryKeys.report(clientId, month), { report });
  return {
    patch: useMutation({ mutationFn: (v: { id: string; patch: Partial<Pick<Report, 'coachNote' | 'narrative' | 'nextLine'>> }) => ptApi.patchReport(v.id, v.patch), onSuccess: store }),
    send: useMutation({ mutationFn: (id: string) => ptApi.sendReport(id), onSuccess: store }),
    undo: useMutation({ mutationFn: (id: string) => ptApi.undoReport(id), onSuccess: store }),
  };
}

export function useAnakinThreads() {
  return useQuery({ queryKey: queryKeys.anakinThreads, queryFn: ptApi.anakinThreads, retry, ...LIVE });
}

export function useScheduledActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.anakinThreads });
  return {
    add: useMutation({ mutationFn: (v: { text: string; scope: AnakinScope }) => ptApi.addScheduled(v.text, v.scope), onSuccess: refresh }),
    toggle: useMutation({ mutationFn: (v: { id: string; active: boolean }) => ptApi.setScheduled(v.id, v.active), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => ptApi.removeScheduled(id), onSuccess: refresh }),
  };
}

export function useAnakinFilter(threadId: string, messageId: string) {
  return useQuery({
    queryKey: queryKeys.anakinFilter(threadId, messageId),
    queryFn: () => ptApi.anakinFilter(threadId, messageId),
    enabled: !!threadId && !!messageId,
    retry,
    staleTime: Infinity,
  });
}

export function useNotifications(enabled = true) {
  // The bell is on every page; a slow poll keeps the dot honest without a socket.
  return useQuery({ queryKey: queryKeys.notifications, queryFn: ptApi.notifications, enabled, retry, staleTime: 60_000, refetchInterval: 120_000, refetchOnWindowFocus: true });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (ids?: string[]) => ptApi.markNotificationsRead(ids), onSuccess: (feed) => qc.setQueryData(queryKeys.notifications, feed) });
}

export function useNotificationSettings() {
  return useQuery({ queryKey: queryKeys.notificationSettings, queryFn: ptApi.notificationSettings, retry, ...LIVE });
}

export function useSaveNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: NotificationSettingsPatch) => ptApi.saveNotificationSettings(patch),
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.notificationSettings, settings);
      void qc.invalidateQueries({ queryKey: queryKeys.briefing });
    },
  });
}

export type { Draft };

// ── Client dossier ───────────────────────────────────────────────────────────

export function useOverview(id: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.overview(id), queryFn: () => ptApi.overview(id), enabled: !!id && enabled, retry, ...LIVE });
}

export function useProgram(id: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.program(id), queryFn: () => ptApi.program(id), enabled: !!id && enabled, retry, ...LIVE });
}

export function useNotes(id: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.notes(id), queryFn: () => ptApi.notes(id), enabled: !!id && enabled, retry, ...LIVE });
}

export function useNoteActions(id: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.notes(id) });
    // Notes also appear on the timeline.
    void qc.invalidateQueries({ queryKey: queryKeys.client(id) });
  };
  return {
    add: useMutation({ mutationFn: (body: string) => ptApi.addNote(id, body), onSuccess: refresh }),
    update: useMutation({ mutationFn: (v: { noteId: string; body: string }) => ptApi.updateNote(id, v.noteId, v.body), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (noteId: string) => ptApi.deleteNote(id, noteId), onSuccess: refresh }),
  };
}

export function useMessageClient(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (text: string) => ptApi.messageClient(id, text), onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.client(id) }) });
}
