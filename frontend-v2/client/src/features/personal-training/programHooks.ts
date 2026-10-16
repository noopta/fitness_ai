// Server state for programs, the exercise library, and the dossier's Intake,
// Nutrition and Billing tabs. Same conventions as hooks.ts: short stale time,
// refetch on focus, no retry on a 4xx.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PersonalTrainingApiError, queryKeys,
  type ProgramAiRequest, type ProgramCheck, type ProgramDoc, type TrainerProgram,
} from '@axiom/personal-training-core';
import { ptApi, type ApiErrorWithBody } from './api';

const LIVE = { staleTime: 60_000, refetchOnWindowFocus: true } as const;
const retry = (count: number, err: unknown) =>
  count < 2 && !(err instanceof PersonalTrainingApiError && err.status < 500);

type QC = ReturnType<typeof useQueryClient>;

/** The rules engine's check carried by a 409 (refused publish, refused live edit); null otherwise. */
export function checkFromError(err: unknown): ProgramCheck | null {
  const e = err as ApiErrorWithBody | null;
  if (!(e instanceof PersonalTrainingApiError) || e.status !== 409) return null;
  const check = e.body?.check as ProgramCheck | undefined;
  return check && Array.isArray(check.issues) ? check : null;
}

// ── Library ──────────────────────────────────────────────────────────────────

export interface ExerciseQuery { q?: string; pattern?: string; equipment?: string }
const exerciseKey = (q: ExerciseQuery) => queryKeys.exercises([q.q ?? '', q.pattern ?? '', q.equipment ?? ''].join('|'));

export function useExercises(q: ExerciseQuery = {}, enabled = true) {
  return useQuery({ queryKey: exerciseKey(q), queryFn: () => ptApi.exercises(q), enabled, retry, staleTime: 5 * 60_000, placeholderData: (prev) => prev });
}

export function useExerciseActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['personal-training', 'exercises'] });
  type Input = Parameters<typeof ptApi.createExercise>[0];
  return {
    create: useMutation({ mutationFn: (input: Input) => ptApi.createExercise(input), onSuccess: refresh }),
    update: useMutation({ mutationFn: (v: { id: string; input: Partial<Input> }) => ptApi.updateExercise(v.id, v.input), onSuccess: refresh }),
    archive: useMutation({ mutationFn: (id: string) => ptApi.archiveExercise(id), onSuccess: refresh }),
  };
}

// ── Programs ─────────────────────────────────────────────────────────────────

export function usePrograms(filter: { clientId?: string; templates?: boolean } = {}) {
  const key = filter.clientId ? `client:${filter.clientId}` : filter.templates ? 'templates' : 'all';
  return useQuery({ queryKey: queryKeys.programs(key), queryFn: () => ptApi.programs(filter), retry, ...LIVE });
}

export function useTrainerProgram(id: string) {
  // The canvas owns the document while it is open; a background refetch must not overwrite typing.
  return useQuery({ queryKey: queryKeys.programDetail(id), queryFn: () => ptApi.trainerProgram(id), enabled: !!id, retry, staleTime: Infinity, refetchOnWindowFocus: false });
}

const refreshLists = (qc: QC) => qc.invalidateQueries({ queryKey: ['personal-training', 'programs'] });
const store = (qc: QC, program: TrainerProgram) => qc.setQueryData(queryKeys.programDetail(program.id), { program });

export function useCreateProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof ptApi.createProgram>[0]) => ptApi.createProgram(input),
    onSuccess: ({ program }) => { store(qc, program); void refreshLists(qc); },
  });
}

export function useGenerateProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { clientId: string; req: ProgramAiRequest }) => ptApi.generateProgram(v.clientId, v.req),
    onSuccess: ({ program }) => { store(qc, program); void refreshLists(qc); },
  });
}

export function useProgramActions(id: string) {
  const qc = useQueryClient();
  const done = ({ program }: { program: TrainerProgram }) => { store(qc, program); void refreshLists(qc); };
  return {
    save: useMutation({ mutationFn: (patch: { doc?: ProgramDoc; name?: string; description?: string; startDate?: string | null }) => ptApi.saveProgram(id, patch), onSuccess: done }),
    acknowledge: useMutation({ mutationFn: (keys: string[]) => ptApi.acknowledgeWarnings(id, keys), onSuccess: done }),
    publish: useMutation({
      mutationFn: () => ptApi.publishProgram(id),
      onSuccess: (data) => {
        done(data);
        // A publish sends the client a message and archives their previous program.
        void qc.invalidateQueries({ queryKey: queryKeys.roster });
        void qc.invalidateQueries({ queryKey: queryKeys.briefing });
      },
    }),
  };
}

export function useCopyProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; clientIds?: string[]; asTemplate?: boolean; name?: string }) => ptApi.copyProgram(v.id, { clientIds: v.clientIds, asTemplate: v.asTemplate, name: v.name }),
    onSuccess: () => refreshLists(qc),
  });
}

export function useArchiveProgram() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => ptApi.archiveProgram(id), onSuccess: () => refreshLists(qc) });
}

// ── Intake, nutrition ────────────────────────────────────────────────────────

export function useIntake(id: string) {
  return useQuery({ queryKey: queryKeys.intake(id), queryFn: () => ptApi.intake(id), enabled: !!id, retry, ...LIVE });
}

export function useResetIntake(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => ptApi.resetIntake(id), onSuccess: (data) => qc.setQueryData(queryKeys.intake(id), data) });
}

export function useNutrition(id: string) {
  return useQuery({ queryKey: queryKeys.nutrition(id), queryFn: () => ptApi.nutrition(id), enabled: !!id, retry, ...LIVE });
}

export function useSetNutritionTargets(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (t: Parameters<typeof ptApi.setNutritionTargets>[1]) => ptApi.setNutritionTargets(id, t),
    onSuccess: (data) => qc.setQueryData(queryKeys.nutrition(id), data),
  });
}

// ── Billing (read side, for the dossier) ─────────────────────────────────────

export function useBillingStatus() {
  return useQuery({ queryKey: queryKeys.billingStatus, queryFn: () => ptApi.billingStatus(), retry, ...LIVE });
}

export function useOffers(enabled = true) {
  return useQuery({ queryKey: queryKeys.offers, queryFn: () => ptApi.offers(), enabled, retry, ...LIVE });
}

export function useClientBilling(id: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.clientBilling(id), queryFn: () => ptApi.clientBilling(id), enabled: !!id && enabled, retry, ...LIVE });
}

export function usePaymentRequest(id: string) {
  return useMutation({ mutationFn: (offerId: string) => ptApi.paymentRequestLink(id, offerId) });
}
