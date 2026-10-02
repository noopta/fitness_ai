import React from 'react';
import { Gate } from '../../src/features/personal-training/Gate';
import { RosterScreen } from '../../src/features/personal-training/RosterScreen';

export default function PersonalTrainingClients() {
  return <Gate>{(me) => <RosterScreen me={me} />}</Gate>;
}
