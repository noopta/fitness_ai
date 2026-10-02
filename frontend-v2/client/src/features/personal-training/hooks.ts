// Server state for the personal-training views. The app-wide QueryClient
// never refetches (staleTime: Infinity); a roster is live data, so these
// queries opt back in to a short stale time and refetch on focus.

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PersonalTrainingApiError, queryKeys,
  type TimelineKind, type TimelinePage,
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
