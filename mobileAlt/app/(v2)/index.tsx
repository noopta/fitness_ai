// The five pages on one horizontal track.

import React, { useEffect } from 'react';
import { Track } from '../../src/v2/shell/Track';
import { HomePage } from '../../src/v2/pages/Home';
import { TrainingPage } from '../../src/v2/pages/Training';
import { FuelPage } from '../../src/v2/pages/Fuel';
import { FeedPage } from '../../src/v2/pages/Feed';
import { YouPage } from '../../src/v2/pages/You';
import { trackScreen } from '../../src/lib/analytics';

export default function V2Index() {
  useEffect(() => { trackScreen('v2.shell'); }, []);
  return <Track pages={[<HomePage key="home" />, <TrainingPage key="training" />, <FuelPage key="fuel" />, <FeedPage key="feed" />, <YouPage key="you" />]} />;
}
