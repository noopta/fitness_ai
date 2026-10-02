import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Gate } from '../../../src/features/personal-training/Gate';
import { TimelineScreen } from '../../../src/features/personal-training/TimelineScreen';

export default function PersonalTrainingClient() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Gate>{(me) => <TimelineScreen me={me} clientId={String(id ?? '')} />}</Gate>;
}
