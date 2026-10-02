// React Native binding for the shared personal-training client. apiFetch
// already attaches the Bearer token, applies the request deadline and throws
// an Error carrying `status`; this only re-types that error for the views.

import { createApi, PersonalTrainingApiError, type Fetcher } from '@axiom/personal-training-core';
import { apiFetch } from '../../lib/api';

const fetcher: Fetcher = async (path, init) => {
  try {
    // silent404: "not enabled for this account" is an expected answer, not a console error.
    return await apiFetch(path, { ...init, silent404: true } as any);
  } catch (err: any) {
    throw new PersonalTrainingApiError(err?.message ?? 'Request failed', typeof err?.status === 'number' ? err.status : 0);
  }
};

export const ptApi = createApi(fetcher);
