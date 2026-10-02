// Server state for the personal-training screens (TanStack Query, same keys
// as web via the shared core).

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PersonalTrainingApiError, queryKeys, type TimelineKind, type TimelinePage } from '@axiom/personal-training-core';
import { ptApi } from './api';

const LIVE = { staleTime: 60_000 } as const;

/** 4xx answers are decisions, not outages — retrying them only delays the right screen. */
const retry = (count: number, err: unknown) =>
  count < 2 && !(err instanceof PersonalTrainingApiError && err.status >= 400 && err.status < 500);

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: ptApi.me, staleTime: 5 * 60_000, retry });
}

export function useRoster() {
  return useQuery({ queryKey: queryKeys.roster, queryFn: ptApi.roster, retry, ...LIVE });
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
