import React from 'react';
import { Gate } from '../../src/features/personal-training/Gate';
import { ProgressScreen } from '../../src/features/personal-training/ProgressScreen';

export default function PersonalTrainingProgress() {
  return <Gate>{(me) => <ProgressScreen me={me} />}</Gate>;
}
