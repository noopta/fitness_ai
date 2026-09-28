// Generic pushed page. `key` selects the content: phases, days, past
// programs, diagnostics, body systems, micronutrients, a meal, strength,
// ratios, a lift, body, streak, memory, billing, preferences, groups,
// leaderboard, train together, a person. One template for all of them.

import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { PushedPageFor } from '../../../src/v2/pages/pushed';

export default function PushedRoute() {
  const params = useLocalSearchParams<{ key: string } & Record<string, string>>();
  const key = String(params.key ?? '');
  return <PushedPageFor pageKey={key} params={params as Record<string, string>} />;
}
