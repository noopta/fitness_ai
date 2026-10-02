import React from 'react';
import { Gate } from '../../../src/features/personal-training/Gate';
import { NotificationSettingsScreen } from '../../../src/features/personal-training/NotificationSettingsScreen';

export default function PersonalTrainingNotificationSettings() {
  return <Gate>{(me) => <NotificationSettingsScreen me={me} />}</Gate>;
}
