// Where a client lands from a trainer's invite link. Accepting shares their
// training data with that trainer, so the page says exactly what is shared
// before the button, and declining is one tap.

import { Link, useLocation, useRoute } from 'wouter';
import { COPY, PersonalTrainingApiError } from '@axiom/personal-training-core';
import { BrandLogo } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { SkeletonBlock } from '../components/primitives';
import { useAcceptInvite, useInvitePreview } from '../hooks';

export default function JoinPage() {
  const [, params] = useRoute('/personal-training/join/:token');
  const token = params?.token ?? '';
  const [, navigate] = useLocation();
  const preview = useInvitePreview(token);
  const accept = useAcceptInvite(token);

  const acceptError = accept.error instanceof PersonalTrainingApiError ? accept.error : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-axiom-zinc-50 p-4">
      <BrandLogo height={28} className="mb-8" />
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-xs">
        {preview.isPending ? (
          <div aria-busy="true"><SkeletonBlock className="mb-3 h-6 w-48" /><SkeletonBlock className="h-16 w-full" /></div>
        ) : preview.isError ? (
          <>
            <h1 className="text-[17px] font-semibold tracking-[-0.01em]">{COPY.join.invalid}</h1>
            <Button asChild variant="secondary" className="mt-4 h-11 rounded-xl"><Link href="/coach">Back to Axiom</Link></Button>
          </>
        ) : accept.isSuccess ? (
          <>
            <h1 className="text-[17px] font-semibold tracking-[-0.01em]">{COPY.join.joined}</h1>
            <p className="mt-1 text-sm leading-relaxed text-axiom-zinc-600">{preview.data.practice.name}</p>
            <Button className="mt-4 h-11 rounded-xl" onClick={() => navigate('/coach')}>Continue</Button>
          </>
        ) : (
          <>
            <h1 className="text-[17px] font-semibold tracking-[-0.01em]">{COPY.join.title(preview.data.practice.name)}</h1>
            <p className="mt-2 text-sm leading-relaxed text-axiom-zinc-600">{COPY.join.body(preview.data.trainerName)}</p>
            {acceptError && (
              <p role="alert" className="mt-3 text-sm text-axiom-destructive-ink">
                {acceptError.status === 403 ? COPY.join.wrongAccount : acceptError.message}
              </p>
            )}
            <div className="mt-5 flex flex-col gap-2">
              <Button className="h-11 rounded-xl" disabled={accept.isPending} onClick={() => accept.mutate()}>{COPY.join.accept}</Button>
              <Button asChild variant="ghost" className="h-11 rounded-xl text-axiom-zinc-600"><Link href="/coach">{COPY.join.decline}</Link></Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
