// Server state for the coach-platform surfaces: link clients and their portal
// links, client record edits, contraindications, goals, measurements, photos
// and the practice profile. Same conventions as hooks.ts — short stale time,
// refetch on focus, no retry on a 4xx.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PersonalTrainingApiError, queryKeys,
  type ClientPatch, type ContraindicationInput, type GoalInput, type MeasurementKind, type PracticeProfile, type ProgressPhoto,
} from '@axiom/personal-training-core';
import { ptApi } from './api';

const LIVE = { staleTime: 60_000, refetchOnWindowFocus: true } as const;

const retry = (count: number, err: unknown) =>
  count < 2 && !(err instanceof PersonalTrainingApiError && err.status < 500);

type QC = ReturnType<typeof useQueryClient>;

/**
 * The roster itself only (`exact`): the roster key prefixes every client key,
 * and GET /clients/:id answers 404 for an archived client, so refetching the
 * client right after archiving would replace the Restore banner with "not found".
 * Callers store the server's copy of the client instead.
 */
const refreshClients = (qc: QC) => {
  void qc.invalidateQueries({ queryKey: queryKeys.roster, exact: true });
  void qc.invalidateQueries({ queryKey: queryKeys.tags });
  // Paused and archived clients leave the briefing.
  void qc.invalidateQueries({ queryKey: queryKeys.briefing });
};

// ── Link clients and record edits ────────────────────────────────────────────

export function useTags(enabled = true) {
  return useQuery({ queryKey: queryKeys.tags, queryFn: () => ptApi.tags(), enabled, retry, ...LIVE });
}

export function useCreateLinkClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; email?: string; phone?: string; tags?: string[] }) => ptApi.createLinkClient(input),
    onSuccess: () => refreshClients(qc),
  });
}

export function usePatchClient(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ClientPatch) => ptApi.patchClient(id, patch),
    onSuccess: ({ client }) => {
      if (client) qc.setQueryData(queryKeys.client(id), { client });
      refreshClients(qc);
    },
  });
}

export function useClientLink(id: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.link(id), queryFn: () => ptApi.link(id), enabled: !!id && enabled, retry, ...LIVE });
}

export function useLinkActions(id: string) {
  const qc = useQueryClient();
  return {
    /** For a "Not joined" client this converts them; the result then carries their new client record and id. */
    issue: useMutation({
      mutationFn: () => ptApi.issueLink(id),
      onSuccess: ({ link, client }) => {
        qc.setQueryData(queryKeys.link(client?.id ?? id), { link });
        if (client) refreshClients(qc);
      },
    }),
    revoke: useMutation({
      mutationFn: () => ptApi.revokeLink(id),
      onSuccess: () => qc.setQueryData(queryKeys.link(id), { link: null }),
    }),
  };
}

// ── Contraindications ────────────────────────────────────────────────────────

export function useContraindicationMeta() {
  // The vocabulary is fixed per deploy.
  return useQuery({ queryKey: queryKeys.contraindicationMeta, queryFn: () => ptApi.contraindicationMeta(), retry, staleTime: Infinity });
}

export function useContraindications(id: string) {
  return useQuery({ queryKey: queryKeys.contraindications(id), queryFn: () => ptApi.contraindications(id), enabled: !!id, retry, ...LIVE });
}

export function useContraindicationActions(id: string) {
  const qc = useQueryClient();
  // The header chips come from the client record, and the briefing's guardrail badges read the same data.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.contraindications(id) });
    void qc.invalidateQueries({ queryKey: queryKeys.client(id), exact: true });
    void qc.invalidateQueries({ queryKey: queryKeys.roster, exact: true });
    void qc.invalidateQueries({ queryKey: queryKeys.briefing });
  };
  return {
    add: useMutation({ mutationFn: (input: ContraindicationInput) => ptApi.addContraindication(id, input), onSuccess: refresh }),
    update: useMutation({ mutationFn: (v: { cid: string; input: ContraindicationInput }) => ptApi.updateContraindication(id, v.cid, v.input), onSuccess: refresh }),
    archive: useMutation({ mutationFn: (cid: string) => ptApi.archiveContraindication(id, cid), onSuccess: refresh }),
  };
}

export function useCheckGuardrails(id: string) {
  return useMutation({ mutationFn: (exercises: string[]) => ptApi.checkGuardrails(id, exercises) });
}

// ── Goals and measurements ───────────────────────────────────────────────────

export function useGoals(id: string) {
  return useQuery({ queryKey: queryKeys.goals(id), queryFn: () => ptApi.goals(id), enabled: !!id, retry, ...LIVE });
}

export function useGoalActions(id: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.goals(id) });
  return {
    add: useMutation({ mutationFn: (input: GoalInput) => ptApi.addGoal(id, input), onSuccess: refresh }),
    update: useMutation({ mutationFn: (v: { gid: string; input: GoalInput }) => ptApi.updateGoal(id, v.gid, v.input), onSuccess: refresh }),
  };
}

export function useMeasurements(id: string) {
  return useQuery({ queryKey: queryKeys.measurements(id), queryFn: () => ptApi.measurements(id), enabled: !!id, retry, ...LIVE });
}

export function useMeasurementActions(id: string) {
  const qc = useQueryClient();
  // A goal's current value is read from measurements, and they appear on the timeline.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.goals(id) });
    void qc.invalidateQueries({ queryKey: ['personal-training', 'clients', id, 'timeline'] });
  };
  return {
    add: useMutation({
      mutationFn: (input: { kind: MeasurementKind; value: number; unit: string; date?: string; label?: string }) => ptApi.addMeasurement(id, input),
      onSuccess: (data) => { qc.setQueryData(queryKeys.measurements(id), data); refresh(); },
    }),
    remove: useMutation({
      mutationFn: (mid: string) => ptApi.deleteMeasurement(id, mid),
      onSuccess: () => { void qc.invalidateQueries({ queryKey: queryKeys.measurements(id) }); refresh(); },
    }),
  };
}

// ── Photos ───────────────────────────────────────────────────────────────────

export function usePhotos(id: string) {
  // Photo URLs are short-lived signed links; a long stale time would serve dead ones.
  // Storage being off (503) is a setting, not an outage, so it is not retried either.
  return useQuery({
    queryKey: queryKeys.photos(id), queryFn: () => ptApi.photos(id), enabled: !!id,
    retry: (count, err) => !isStorageOff(err) && retry(count, err), staleTime: 5 * 60_000, refetchOnWindowFocus: true,
  });
}

export function usePhotoActions(id: string) {
  const qc = useQueryClient();
  return {
    add: useMutation({
      mutationFn: (input: { imageBase64: string; pose: ProgressPhoto['pose']; date?: string; note?: string }) => ptApi.addPhoto(id, input),
      onSuccess: (data) => qc.setQueryData(queryKeys.photos(id), data),
    }),
    remove: useMutation({
      mutationFn: (pid: string) => ptApi.deletePhoto(id, pid),
      onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.photos(id) }),
    }),
  };
}

// ── Practice profile ─────────────────────────────────────────────────────────

export function usePracticeProfile() {
  return useQuery({ queryKey: queryKeys.practiceProfile, queryFn: () => ptApi.practiceProfile(), retry, ...LIVE });
}

export function useSavePracticeProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Omit<PracticeProfile, 'logoUrl'>> & { name?: string }) => ptApi.savePracticeProfile(patch),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.practiceProfile, data);
      // The practice name shows in the rail, from /me.
      void qc.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useUploadLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (imageBase64: string) => ptApi.uploadLogo(imageBase64),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.practiceProfile, data);
      void qc.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

/** True for the server's "storage is not configured" answer, which views show as a calm state rather than an error. */
export const isStorageOff = (err: unknown) => err instanceof PersonalTrainingApiError && err.status === 503;
