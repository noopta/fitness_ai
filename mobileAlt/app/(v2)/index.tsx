// The five pages on one horizontal track.

import React, { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Track } from '../../src/v2/shell/Track';
import { HomePage } from '../../src/v2/pages/Home';
import { TrainingPage } from '../../src/v2/pages/Training';
import { FuelPage } from '../../src/v2/pages/Fuel';
import { FeedPage, FeedHeaderRight } from '../../src/v2/pages/Feed';
import { useShell } from '../../src/v2/shell/ShellContext';
import { TABS } from '@axiom/agent-ui-core';
import { YouPage } from '../../src/v2/pages/You';
import { trackScreen } from '../../src/lib/analytics';

const FEED_HEADER = [null, null, null, <FeedHeaderRight key="feed" />, null];

export default function V2Index() {
  useEffect(() => { trackScreen('v2.shell'); }, []);
  // Deep links (social notifications) open a page: /(v2)?tab=feed.
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const shell = useShell();
  useEffect(() => {
    const i = tab ? TABS.findIndex((t) => t.toLowerCase() === String(tab).toLowerCase()) : -1;
    if (i > 0) requestAnimationFrame(() => shell.goTo(i));
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Track pages={[<HomePage key="home" />, <TrainingPage key="training" />, <FuelPage key="fuel" />, <FeedPage key="feed" />, <YouPage key="you" />]} headerRight={FEED_HEADER} />;
}
