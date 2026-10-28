import { userFlag } from '../userFlag.js';
import { rehabProgramsAvailableFor } from '../featureFlags.js';

export const rehabOn = userFlag(rehabProgramsAvailableFor);
