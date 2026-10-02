import { Tabs } from 'expo-router';

// Human-trainer dashboard. Deliberately its own route group, not under the
// coach tab — "coach" in this app is the AI coach every athlete talks to.
//
// A tab navigator with its own bar hidden: each screen draws the handoff's
// five-tab bar itself (features/personal-training/components.tsx), and
// router.navigate between routes jumps rather than stacking screens. Back
// from a client or from settings returns to the tab it was opened from.
export default function PersonalTrainingLayout() {
  return <Tabs backBehavior="history" tabBar={() => null} screenOptions={{ headerShown: false }} />;
}
