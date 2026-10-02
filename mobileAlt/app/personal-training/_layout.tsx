import { Stack } from 'expo-router';

// Human-trainer dashboard. Deliberately its own route group, not under the
// coach tab — "coach" in this app is the AI coach every athlete talks to.
export default function PersonalTrainingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
