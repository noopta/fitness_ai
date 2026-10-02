// "Trainer mode" — whether this device's signed-in user is here as a personal
// trainer rather than as an athlete. Set by the trainer toggle on the login
// screen, read by postAuthDestination, cleared on sign-out or when the
// trainer switches to their own training.
//
// It is persisted because the app has no other entry to the dashboard: without
// it a trainer would land in the athlete app on every cold start.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const TRAINER_HOME = '/personal-training';

const KEY = 'axiom.personalTraining.trainerMode';

let mode = false;
let loaded = false;

export async function loadTrainerMode(): Promise<boolean> {
  if (!loaded) {
    try {
      mode = (await AsyncStorage.getItem(KEY)) === '1';
    } catch {
      // Unreadable storage reads as "athlete": the safe default is the app everyone has.
      mode = false;
    }
    loaded = true;
  }
  return mode;
}

export async function setTrainerMode(on: boolean): Promise<void> {
  mode = on;
  loaded = true;
  try {
    if (on) await AsyncStorage.setItem(KEY, '1');
    else await AsyncStorage.removeItem(KEY);
  } catch {
    // The in-memory value still routes this launch correctly.
  }
}
