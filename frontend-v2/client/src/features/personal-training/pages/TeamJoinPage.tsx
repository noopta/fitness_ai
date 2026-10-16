// Where a co-trainer lands from an owner's invite. Signed in already (the
// route is protected); the invite only works for the email it was sent to,
// and the server says so plainly when it does not match.

import { Link, useLocation, useRoute } from 'wouter';
import { PersonalTrainingApiError } from '@axiom/personal-training-core';
import { BrandLogo } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { useAcceptCoachInvite } from '../businessHooks';
import { BCOPY } from '../copyBusiness';

const T = BCOPY.team.join;

export default function TeamJoinPage() {
  const [, params] = useRoute('/personal-training/team/join/:token');
  const token = params?.token ?? '';
  const [, navigate] = useLocation();
  const accept = useAcceptCoachInvite(token);
  const err = accept.error instanceof PersonalTrainingApiError ? accept.error : null;
  const message = !accept.error ? null
    : err?.status === 404 ? T.notFound
    : err && err.status < 500 && err.message ? err.message
    : 'Something went wrong. Try again.';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-axiom-zinc-50 p-4">
      <BrandLogo height={28} className="mb-8" />
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-xs">
        {accept.isSuccess ? (
          <>
            <h1 className="text-[17px] font-semibold tracking-[-0.01em]">{T.joined(accept.data.practice.name)}</h1>
            <Button className="mt-4 h-11 w-full rounded-xl" onClick={() => navigate('/personal-training')}>{T.open}</Button>
          </>
        ) : (
          <>
            <h1 className="text-[17px] font-semibold tracking-[-0.01em]">{T.title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-axiom-zinc-600">{T.body}</p>
            {message && <p role="alert" className="mt-3 text-sm text-axiom-destructive-ink">{message}</p>}
            <div className="mt-5 flex flex-col gap-2">
              <Button className="h-11 rounded-xl" disabled={!token || accept.isPending || err?.status === 404} onClick={() => accept.mutate(undefined, { onSuccess: () => navigate('/personal-training') })}>
                {accept.isPending ? T.joining : T.accept}
              </Button>
              <Button asChild variant="ghost" className="h-11 rounded-xl text-axiom-zinc-600"><Link href="/coach">{T.decline}</Link></Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
