import React from 'react';
import { AnakinScreen } from '../../src/features/personal-training/AnakinScreen';
import { Gate } from '../../src/features/personal-training/Gate';

export default function PersonalTrainingAnakin() {
  return <Gate>{(me) => <AnakinScreen me={me} />}</Gate>;
}
