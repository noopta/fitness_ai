import React from 'react';
import { CheckInsScreen } from '../../src/features/personal-training/CheckInsScreen';
import { Gate } from '../../src/features/personal-training/Gate';

export default function PersonalTrainingCheckIns() {
  return <Gate>{(me) => <CheckInsScreen me={me} />}</Gate>;
}
