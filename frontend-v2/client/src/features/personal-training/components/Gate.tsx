// Decides what a signed-in user sees at /personal-training before any client
// data is requested: the dashboard, practice setup, or a plain statement that
// the feature is not on for this account.

import { useState } from 'react';
import { COPY, PersonalTrainingApiError, type MeResponse } from '@axiom/personal-training-core';
import { BrandLogo } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreatePractice, useMe } from '../hooks';
import { SkeletonBlock } from './primitives';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-axiom-zinc-50 p-4">
      <BrandLogo height={28} className="mb-8" />
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-xs">{children}</div>
    </div>
  );
}

function PracticeSetup() {
  const [name, setName] = useState('');
  const create = useCreatePractice();
  const valid = name.trim().length >= 2 && name.trim().length <= 80;
  return (
    <Centered>
      <h1 className="text-[17px] font-semibold tracking-[-0.01em]">{COPY.setup.title}</h1>
      <p className="mt-1 text-sm leading-relaxed text-axiom-zinc-600">{COPY.setup.body}</p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(name.trim()); }}
      >
        <div className="space-y-2">
          <Label htmlFor="pt-practice-name">{COPY.setup.nameLabel}</Label>
          <Input
            id="pt-practice-name"
            value={name}
            maxLength={80}
            placeholder={COPY.setup.namePlaceholder}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        {create.isError && <p role="alert" className="text-sm text-axiom-destructive-ink">{COPY.setup.failed}</p>}
        <Button type="submit" className="h-10 w-full rounded-xl" disabled={!valid || create.isPending}>
          {COPY.setup.submit}
        </Button>
      </form>
    </Centered>
  );
}

export function Gate({ children }: { children: (me: MeResponse) => React.ReactNode }) {
  const me = useMe();

  if (me.isPending) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-12" aria-busy="true">
        <SkeletonBlock className="mb-6 h-8 w-48" />
        <SkeletonBlock className="mb-3 h-16 w-full max-w-3xl" />
        <SkeletonBlock className="mb-3 h-16 w-full max-w-3xl" />
        <SkeletonBlock className="h-16 w-full max-w-3xl" />
      </div>
    );
  }

  if (me.isError) {
    const notEnabled = me.error instanceof PersonalTrainingApiError && me.error.status === 404;
    return (
      <Centered>
        <h1 className="text-[17px] font-semibold tracking-[-0.01em]">
          {notEnabled ? COPY.unavailable.title : COPY.roster.loadFailed}
        </h1>
        {notEnabled
          ? <p className="mt-1 text-sm leading-relaxed text-axiom-zinc-600">{COPY.unavailable.body}</p>
          : <Button variant="secondary" className="mt-4 h-10 rounded-xl" onClick={() => me.refetch()}>{COPY.roster.retry}</Button>}
      </Centered>
    );
  }

  if (!me.data.practice) return <PracticeSetup />;
  return <>{children(me.data)}</>;
}
