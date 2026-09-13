import { efficiencyArc, radarGeometry, type RadarIndices } from '@axiom/diagnostic-core';

/** Inline SVG with the exact paths react-native-svg draws on mobile. */
export function DiagnosticRadar({ lift, indices, size = 200 }: { lift: string; indices: RadarIndices; size?: number }) {
  const g = radarGeometry(lift, indices, size);
  if (!g) return null;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Strength profile">
      <path d={g.ringPath} fill="none" stroke="#e4e4e7" strokeWidth={1} />
      {g.axes.map((a) => (
        <line
          key={a.key}
          x1={g.center}
          y1={g.center}
          x2={a.end.x}
          y2={a.end.y}
          stroke="#e4e4e7"
          strokeWidth={1}
          strokeDasharray={a.value == null ? '3 3' : undefined}
        />
      ))}
      {g.valuePath ? <path d={g.valuePath} fill="rgba(9,9,11,0.08)" stroke="#09090b" strokeWidth={1.5} /> : null}
      {g.axes.map((a) => (a.point ? <circle key={`p-${a.key}`} cx={a.point.x} cy={a.point.y} r={3.5} fill="#09090b" /> : null))}
      {g.axes.map((a) => (
        <text
          key={`l-${a.key}`}
          x={a.labelAt.x}
          y={a.labelAt.y + 4}
          fontSize={11}
          fontWeight={600}
          fill={a.value == null ? '#a1a1aa' : '#71717a'}
          textAnchor={a.labelAt.anchor}
        >
          {a.label}
        </text>
      ))}
    </svg>
  );
}

export function EfficiencyGauge({ score, size = 160 }: { score: number; size?: number }) {
  const arc = efficiencyArc(score, size);
  const h = size / 2 + 8;
  return (
    <div className="flex flex-col items-center" style={{ width: size }} aria-label={`Efficiency ${score}`} role="img">
      <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`}>
        <path d={arc.trackPath} fill="none" stroke="#f4f4f5" strokeWidth={10} strokeLinecap="round" />
        {arc.valuePath ? <path d={arc.valuePath} fill="none" stroke="#09090b" strokeWidth={10} strokeLinecap="round" /> : null}
      </svg>
      <div className="-mt-7 text-[26px] font-bold tracking-[-0.035em] text-zinc-950">{Math.round(score)}</div>
    </div>
  );
}
