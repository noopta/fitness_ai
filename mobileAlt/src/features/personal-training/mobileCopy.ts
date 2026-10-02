// Strings the phone views need that the shared COPY does not carry. Same
// rules as the core copy (handoff §13): sentence case, no emoji, no
// exclamation marks.

import type { Channel } from '@axiom/personal-training-core';

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const CHANNEL_LABEL: Record<Channel, string> = { app: 'App', webLink: 'Web link' };

export const MOBILE_COPY = {
  back: 'Back',
  close: 'Close',
  cancel: 'Cancel',
  signOut: 'Sign out',
  loading: 'Loading',
  noValue: '—',
  sources: (labels: string) => `Sources: ${labels}`,
  bellUnread: (label: string, n: number) => `${label}, ${n} unread`,
  unread: 'Unread',
  briefing: {
    doneEditing: 'Done editing',
    setupProgress: (done: number, total: number) => `${done} of ${total} done`,
    sourcesRead: 'Sources read',
    sourceDone: (label: string) => `${label}, read`,
    sourceWaiting: (label: string) => `${label}, waiting`,
    earlier: 'an earlier',
    groupCount: (label: string, n: number) => `${label} · ${n}`,
    openClient: (name: string) => `Open ${name}`,
    dismissClient: (label: string, name: string) => `${label}: ${name}`,
  },
  checkIns: {
    noReplySent: 'no reply sent',
    question: (n: number) => `Question ${n}`,
    questionType: (n: number) => `Question ${n} type`,
    questionAction: (action: string, n: number) => `${action}: question ${n}`,
    noClients: 'No clients to ask yet.',
  },
  progress: {
    lift: 'Lift',
    sentTo: (label: string, name: string) => `${label} to ${name}`,
    adherence: (percent: number) => `${percent}%`,
  },
  anakin: {
    thisMorning: (n: number) => `${n} this morning`,
    draftTo: (name: string) => `Draft message to ${name}`,
    runEveryMorningFor: (label: string, text: string) => `${label}: ${text}`,
    avatar: 'Anakin',
    noThreads: 'No questions yet.',
    threadsFailed: 'Could not load your questions.',
  },
  notifications: {
    client: 'Client',
    event: 'Event',
    tier: 'Tier',
    clientFallback: 'Client',
  },
  dossier: {
    noRecentPrs: 'No recent PRs.',
    deleteNoteTitle: 'Delete this note?',
    messageSent: 'Message sent',
    notesFailed: 'Could not save that note.',
    started: (when: string) => `started ${when}`,
    edited: 'edited',
  },
} as const;
