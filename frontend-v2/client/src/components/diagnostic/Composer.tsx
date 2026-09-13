import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, Paperclip, Video } from 'lucide-react';
import {
  COPY,
  isValidSet,
  parseNumber,
  type ComposerView,
  type DiagnosticController,
  type Stage,
  type WeightUnit,
} from '@axiom/diagnostic-core';
import { readVideoDuration } from '@/lib/diagnosticApi';
import { Chip, InkButton, OutlineButton, QuietButton, SendButton } from './primitives';

const MAX_CLIP_SECONDS = 60;

interface Props {
  view: ComposerView;
  stage: Stage;
  controller: DiagnosticController;
  onOpenReport: () => void;
  onDone: () => void;
}

/** Sticky footer, 94% white + blur. Its controls are a pure function of the stage. */
export function Composer({ view, stage, controller, onOpenReport, onDone }: Props) {
  return (
    <div className="sticky bottom-0 border-t border-zinc-200 bg-white/95 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto w-full max-w-[640px] px-4 pt-3">
        <Mode view={view} stage={stage} controller={controller} onOpenReport={onOpenReport} onDone={onDone} />
      </div>
    </div>
  );
}

function Mode({ view, stage, controller: c, onOpenReport, onDone }: Props) {
  switch (view.mode) {
    case 'chips':
      return <ChipsComposer view={view} stage={stage} controller={c} />;
    case 'typing':
      return <TypingComposer view={view} stage={stage} controller={c} />;
    case 'numbers':
      return <NumbersComposer unit={view.unit as WeightUnit} disabled={view.disabled} onSend={(set) => c.act({ type: 'main', set })} />;
    case 'accessory':
      return <AccessoryComposer view={view} controller={c} />;
    case 'video':
      return <VideoComposer disabled={view.disabled} controller={c} />;
    case 'generate':
      return (
        <InkButton className="w-full" disabled={view.disabled} onClick={() => c.act({ type: 'verdict' })}>
          {view.label}
        </InkButton>
      );
    case 'waiting':
      return (
        <div className="flex min-h-12 items-center justify-center gap-2.5 text-sm font-semibold text-zinc-500" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-950" />
          {view.label}
        </div>
      );
    case 'done':
      return (
        <div className="flex gap-2.5">
          <InkButton className="flex-1" onClick={onOpenReport}>{COPY.openReport}</InkButton>
          <OutlineButton className="px-6" onClick={onDone}>{COPY.done}</OutlineButton>
        </div>
      );
    case 'blocked':
      return <p className="py-3 text-center text-[13px] font-medium text-zinc-500">{view.caption}</p>;
  }
}

function ChipsComposer({ view, stage, controller }: { view: Extract<ComposerView, { mode: 'chips' }>; stage: Stage; controller: DiagnosticController }) {
  const [pressed, setPressed] = useState<string | null>(null);
  useEffect(() => setPressed(null), [stage]);
  const pick = (o: { id: string; label: string; flags: string[] }) => {
    setPressed(o.id);
    if (stage === 'lift') controller.act({ type: 'lift', lift: o.id as never });
    else if (stage === 'q0' || stage === 'q1' || stage === 'q2') {
      controller.act({ type: 'answer', question: stage, optionId: o.id, text: o.label, flags: o.flags });
    }
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-[7px]">
        {view.options.map((o) => (
          <Chip key={o.id} active={pressed === o.id} disabled={view.disabled} onClick={() => pick(o)}>
            {o.label}
          </Chip>
        ))}
      </div>
      {view.typeInstead ? (
        <QuietButton className="self-start" disabled={view.disabled} onClick={() => controller.setTypeInstead(true)}>
          {COPY.typeInstead}
        </QuietButton>
      ) : null}
    </div>
  );
}

function TypingComposer({ view, stage, controller }: { view: Extract<ComposerView, { mode: 'typing' }>; stage: Stage; controller: DiagnosticController }) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (stage !== 'q0' && stage !== 'q1' && stage !== 'q2') return;
    if (controller.act({ type: 'answer', question: stage, text, flags: [] })) setText('');
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <div className="flex items-end gap-2.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e);
          }}
          placeholder={view.placeholder}
          aria-label={view.placeholder}
          maxLength={1000}
          rows={1}
          autoFocus
          disabled={view.disabled}
          className="max-h-32 min-h-[46px] flex-1 resize-none rounded-[23px] border border-zinc-200 px-4 py-3 text-[15px] text-zinc-950 outline-none placeholder:text-zinc-400 focus:border-zinc-950"
        />
        <SendButton disabled={view.disabled || !text.trim()} />
      </div>
      <QuietButton className="self-start" onClick={() => controller.setTypeInstead(false)}>
        {COPY.backToQuick}
      </QuietButton>
    </form>
  );
}

function NumericField({ label, value, onChange, className }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <label className={className}>
      <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, ''))}
        inputMode={label.startsWith('Weight') ? 'decimal' : 'numeric'}
        aria-label={label}
        className="w-full border-0 border-b-2 border-zinc-950 bg-transparent px-0 py-1 text-[26px] font-bold tracking-[-0.035em] text-zinc-950 outline-none focus:ring-0"
      />
    </label>
  );
}

function NumbersComposer({
  unit, disabled, onSend, resetKey,
}: { unit: WeightUnit; disabled: boolean; onSend: (set: { weight: number; sets: number; reps: number; unit: WeightUnit }) => boolean; resetKey?: string }) {
  const [weight, setWeight] = useState('');
  const [sets, setSets] = useState('');
  const [reps, setReps] = useState('');
  useEffect(() => {
    setWeight('');
    setSets('');
    setReps('');
  }, [resetKey]);
  const valid = isValidSet(weight, sets, reps);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onSend({ weight: parseNumber(weight)!, sets: parseNumber(sets)!, reps: parseNumber(reps)!, unit });
  };
  return (
    <form onSubmit={submit} className="flex items-end gap-2.5">
      <NumericField label={COPY.weightLabel(unit)} value={weight} onChange={setWeight} className="min-w-0 flex-1" />
      <NumericField label={COPY.setsLabel} value={sets} onChange={setSets} className="w-14" />
      <NumericField label={COPY.repsLabel} value={reps} onChange={setReps} className="w-14" />
      <SendButton disabled={disabled || !valid} />
    </form>
  );
}

function AccessoryComposer({ view, controller }: { view: Extract<ComposerView, { mode: 'accessory' }>; controller: DiagnosticController }) {
  const id = view.exerciseId;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-zinc-950">{view.exerciseName}</div>
          <div className={view.counter.atMinimum ? 'text-xs font-semibold text-zinc-500' : 'text-xs font-semibold text-zinc-950'}>
            {view.counter.text}
          </div>
        </div>
        {view.canChange ? (
          <QuietButton disabled={view.disabled} onClick={() => controller.act({ type: 'change', exerciseId: id })}>
            {COPY.change}
          </QuietButton>
        ) : null}
      </div>
      <NumbersComposer
        unit={view.unit as WeightUnit}
        disabled={view.disabled}
        resetKey={id}
        onSend={(set) => controller.act({ type: 'accessory', exerciseId: id, set })}
      />
      <div className="flex items-center justify-between gap-2.5">
        <OutlineButton className="min-h-10 px-4 text-sm" disabled={view.disabled} onClick={() => controller.act({ type: 'untrained', exerciseId: id })}>
          {COPY.dontTrain}
        </OutlineButton>
        {view.escape === 'moveOn' ? (
          <InkButton className="min-h-10 px-4 text-sm" disabled={view.disabled} onClick={() => controller.act({ type: 'moveOn' })}>
            {COPY.moveOn}
          </InkButton>
        ) : (
          <QuietButton disabled={view.disabled} onClick={() => controller.act({ type: 'skip', exerciseId: id })}>
            {COPY.skip}
          </QuietButton>
        )}
      </div>
    </div>
  );
}

function VideoComposer({ disabled, controller }: { disabled: boolean; controller: DiagnosticController }) {
  const recordRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    setNote(null);
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setNote('That file isn’t a video.');
      return;
    }
    const duration = await readVideoDuration(file);
    if (duration != null && duration > MAX_CLIP_SECONDS + 2) {
      setNote('Keep it under 60 seconds — one working rep is plenty.');
      return;
    }
    controller.act({ type: 'video', durationSec: duration != null ? Math.round(duration) : null, file });
  };

  return (
    <div className="flex flex-col gap-2.5">
      {note ? <p className="text-center text-[13px] font-medium text-zinc-500">{note}</p> : null}
      <input ref={uploadRef} type="file" accept="video/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      <input ref={recordRef} type="file" accept="video/*" capture="environment" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      <div className="flex items-center gap-2.5">
        <InkButton className="flex-1" disabled={disabled} onClick={() => uploadRef.current?.click()}>
          <Paperclip size={18} strokeWidth={2} />
          {COPY.attachSet}
        </InkButton>
        <OutlineButton className="px-4 md:hidden" disabled={disabled} onClick={() => recordRef.current?.click()} aria-label="Record a set">
          <Video size={18} strokeWidth={2} />
        </OutlineButton>
        <QuietButton disabled={disabled} onClick={() => controller.act({ type: 'skipVideo' })}>
          {COPY.skip}
        </QuietButton>
      </div>
    </div>
  );
}
