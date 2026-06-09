// ProgressShareModal (web) — branded, screenshot-ready cards for nutrition or
// weight progress, exported to PNG via html-to-image (Web Share API or download).

import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Share2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { shareOrDownloadNode } from '@/lib/shareImage';

export interface MacroSummary {
  label: string;
  used: number;
  target: number | null;
  color: string;
}

type Variant =
  | { kind: 'nutrition'; dateLabel: string; calories: { used: number; target: number | null }; macros: MacroSummary[] }
  | { kind: 'weight'; rangeLabel: string; current: number | null; totalChange: number | null; series: number[] };

interface Props {
  variant: Variant;
  onClose: () => void;
}

function MiniTrend({ values }: { values: number[] }) {
  const W = 300, H = 90, PAD = 8;
  const finite = values.filter(v => Number.isFinite(v));
  if (finite.length < 2) return <div style={{ height: H }} />;
  const min = Math.min(...finite), max = Math.max(...finite), range = max - min || 1;
  const dx = (W - PAD * 2) / (finite.length - 1);
  const pts = finite.map((v, i) => `${(PAD + i * dx).toFixed(1)},${(PAD + (1 - (v - min) / range) * (H - PAD * 2)).toFixed(1)}`).join(' ');
  return (
    <svg width={W} height={H}>
      <polyline points={pts} fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function ProgressShareModal({ variant, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  async function doShare() {
    if (!cardRef.current) return;
    setBusy(true);
    try {
      await shareOrDownloadNode(
        cardRef.current,
        variant.kind === 'nutrition' ? 'axiom-nutrition.png' : 'axiom-progress.png',
        variant.kind === 'nutrition' ? 'My nutrition' : 'My progress',
      );
    } catch {
      toast.error('Could not export image.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="w-full max-w-sm space-y-4">
        <div ref={cardRef} className="rounded-2xl bg-[#0a0a0a] text-white p-6 space-y-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-lg font-bold tracking-[2px]">AXIOM</span>
            <span className="text-xs font-semibold text-zinc-400">
              {variant.kind === 'nutrition' ? variant.dateLabel : variant.rangeLabel}
            </span>
          </div>

          {variant.kind === 'nutrition' ? (
            <>
              <div className="text-5xl font-bold">
                {Math.round(variant.calories.used)}
                {variant.calories.target ? <span className="text-xl text-zinc-500"> / {Math.round(variant.calories.target)}</span> : null}
              </div>
              <div className="text-xs font-bold tracking-widest text-zinc-400 mb-3">CALORIES</div>
              <div className="space-y-3">
                {variant.macros.map(m => {
                  const pct = m.target && m.target > 0 ? Math.min(m.used / m.target, 1) : 0;
                  return (
                    <div key={m.label} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-zinc-200">{m.label}</span>
                        <span className="text-zinc-400">{Math.round(m.used)}{m.target ? `/${Math.round(m.target)}` : ''}g</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                        <div className="h-2 rounded-full" style={{ width: `${Math.round(pct * 100)}%`, backgroundColor: m.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="text-xs font-bold tracking-widest text-zinc-400">BODY WEIGHT</div>
              <div className="flex items-end gap-1.5">
                <span className="text-5xl font-bold">{variant.current != null ? variant.current.toFixed(1) : '—'}</span>
                <span className="text-xl text-zinc-500 mb-1.5">lb</span>
              </div>
              {variant.totalChange != null && (
                <div className={`text-base font-semibold ${variant.totalChange <= 0 ? 'text-green-500' : 'text-amber-500'}`}>
                  {variant.totalChange > 0 ? '+' : ''}{variant.totalChange.toFixed(1)} lb this {variant.rangeLabel.toLowerCase()}
                </div>
              )}
              <div className="flex justify-center mt-2"><MiniTrend values={variant.series} /></div>
            </>
          )}

          <div className="text-xs text-zinc-500 text-center pt-4">
            {variant.kind === 'nutrition' ? 'Tracked with Axiom 💪' : 'Progress with Axiom 💪'}
          </div>
        </div>

        <div className="flex gap-2">
          <Button className="flex-1 rounded-xl" onClick={doShare} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Share2 className="h-4 w-4 mr-2" />}
            Share
          </Button>
          <Button variant="ghost" className="rounded-xl text-white hover:bg-white/10" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
