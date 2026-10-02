import React from 'react';
import { BriefingScreen } from '../../src/features/personal-training/BriefingScreen';
import { Gate } from '../../src/features/personal-training/Gate';

export default function PersonalTrainingHome() {
  return <Gate>{(me) => <BriefingScreen me={me} />}</Gate>;
}
