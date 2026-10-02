// Every UI string for the personal-training dashboard. Sentence case, no
// emoji, no exclamation marks (handoff §13). Client-facing status language is
// "Might need support" — never "at risk" or "churning" (§6.2).

import type { ClientStatus, EngagementTrend, RosterFilter, TimelineKind } from './types';

export const STATUS_LABEL: Record<ClientStatus, string> = {
  support: 'Might need support',
  new: 'New',
  onPlan: 'On plan',
  paused: 'Paused',
};

export const FILTER_LABEL: Record<RosterFilter, string> = { all: 'All', ...STATUS_LABEL };

/** Chip order on the roster (§6.2). */
export const ROSTER_FILTERS: RosterFilter[] = ['all', 'support', 'new', 'onPlan', 'paused'];

export const TREND_LABEL: Record<EngagementTrend, string> = {
  rising: 'Rising',
  steady: 'Steady',
  falling: 'Falling',
};

export const KIND_LABEL: Record<TimelineKind, string> = {
  workout: 'Workout',
  checkin: 'Check-in',
  message: 'Message',
  measurement: 'Measurement',
  photos: 'Photos',
  program: 'Program',
  note: 'Note',
  billing: 'Billing',
};

/** Kinds the v1 timeline can actually produce; the rest have no data source yet. */
export const TIMELINE_FILTER_KINDS: TimelineKind[] = ['workout', 'checkin', 'message', 'measurement', 'program'];

export const COPY = {
  productName: 'Personal training',
  nav: {
    briefing: 'Briefing',
    clients: 'Clients',
    checkIns: 'Check-ins',
    progress: 'Progress',
    anakin: 'Ask Anakin',
    comingSoon: 'Coming soon',
  },
  roster: {
    title: 'Clients',
    invite: 'Invite client',
    searchPlaceholder: 'Search clients',
    countLine: (n: number) => (n === 1 ? '1 client' : `${n} clients`),
    emptyTitle: 'No clients yet.',
    emptyBody: 'Invite a client to see their training here.',
    noMatches: 'No clients match that filter.',
    columns: { client: 'Client', status: 'Status', program: 'Program', engagement: 'Engagement', lastCheckIn: 'Last check-in' },
    noProgram: 'No program yet',
    never: 'None yet',
    loadFailed: 'Could not load your clients.',
    retry: 'Try again',
  },
  invite: {
    title: 'Invite a client',
    body: 'They join with their Axiom account. You will see their workouts, check-ins, bodyweight and injuries.',
    emailLabel: 'Client email (optional)',
    emailHint: 'If you add an email, only that account can use the link.',
    generate: 'Create invite link',
    copy: 'Copy link',
    copied: 'Copied',
    expires: (when: string) => `Link expires ${when}.`,
    failed: 'Could not create the invite.',
  },
  join: {
    title: (practice: string) => `Join ${practice}`,
    body: (trainer: string) =>
      `${trainer} will be able to see your workouts, check-ins, bodyweight, program and any injuries you have listed, and can message you.`,
    accept: 'Share my training and join',
    decline: 'Not now',
    joined: 'You are connected.',
    invalid: 'This invite is no longer valid.',
    wrongAccount: 'This invite was sent to a different email address.',
  },
  setup: {
    title: 'Set up your practice',
    body: 'Give your practice a name. Clients see it when you invite them.',
    nameLabel: 'Practice name',
    namePlaceholder: 'Kofi Mensah Coaching',
    submit: 'Create practice',
    failed: 'Could not create the practice.',
  },
  unavailable: {
    title: 'Personal training is not enabled for this account yet.',
    body: 'If you coach clients and want access, get in touch with the Axiom team.',
  },
  timeline: {
    breadcrumb: 'Clients',
    tab: 'Timeline',
    loadEarlier: 'Load earlier',
    empty: 'Nothing logged yet.',
    emptyFiltered: 'Nothing of that kind yet.',
    allKinds: 'All',
    tenure: (when: string) => `Client since ${when}`,
    noContraindications: 'No injuries listed',
    cleared: 'cleared',
    loadFailed: 'Could not load this timeline.',
    notFound: 'This client is not on your roster.',
  },
  login: {
    toggle: 'Sign in as a personal trainer',
    cancel: 'Cancel personal trainer sign-in',
    subtitle: 'Sign in to your trainer dashboard',
    submit: 'Sign in to trainer dashboard',
    divider: 'Personal trainers',
  },
} as const;
