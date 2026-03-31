import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface DayData {
  date: string;
  count: number;
}

interface ContributionGraphProps {
  userId?: string;
}

function getColor(count: number): string {
  if (count === 0) return 'var(--contribution-0, #1a1f2e)';
  if (count === 1) return 'var(--contribution-1, #0e4429)';
  if (count <= 3) return 'var(--contribution-2, #006d32)';
  if (count <= 5) return 'var(--contribution-3, #26a641)';
  return 'var(--contribution-4, #39d353)';
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function ContributionGraph({ userId }: ContributionGraphProps) {
  const [data, setData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    const url = userId
      ? `${API_BASE}/activity/heatmap?userId=${encodeURIComponent(userId)}`
      : `${API_BASE}/activity/heatmap`;

    authFetch(url)
      .then(r => r.json())
      .then((d: DayData[]) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">
        Loading activity…
      </div>
    );
  }

  if (!data.length) return null;

  // Build 52 full weeks (364 days) + up to 1 partial week = 53 columns max
  // data is oldest-first, 365 items. We need to arrange into columns of 7 (Sun→Sat).
  // Find the day-of-week of the first date so we can pad the first column.
  const firstDate = new Date(data[0].date + 'T12:00:00');
  const startDow = firstDate.getDay(); // 0=Sun

  // Pad the front so index 0 aligns to Sunday
  const padded: (DayData | null)[] = [
    ...Array(startDow).fill(null),
    ...data,
  ];

  // Split into columns of 7
  const columns: (DayData | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) {
    columns.push(padded.slice(i, i + 7));
  }

  // Month labels: find the first column where each month starts
  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  columns.forEach((col, ci) => {
    for (const cell of col) {
      if (!cell) continue;
      const m = new Date(cell.date + 'T12:00:00').getMonth();
      if (m !== lastMonth) {
        monthLabels.push({ col: ci, label: MONTH_NAMES[m] });
        lastMonth = m;
      }
      break;
    }
  });

  const totalCount = data.reduce((s, d) => s + d.count, 0);

  const CELL = 11; // px per cell
  const GAP = 2;
  const STEP = CELL + GAP;
  const ROW_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

  return (
    <div className="select-none">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs text-muted-foreground font-medium">Activity — last 365 days</span>
        <span className="text-xs text-muted-foreground">{totalCount} total activit{totalCount === 1 ? 'y' : 'ies'}</span>
      </div>

      <div className="overflow-x-auto">
        <div style={{ position: 'relative', paddingLeft: 28, paddingTop: 18 }}>
          {/* Month labels */}
          <div style={{ position: 'absolute', top: 0, left: 28, display: 'flex', gap: 0 }}>
            {monthLabels.map(({ col, label }) => (
              <span
                key={`${col}-${label}`}
                style={{
                  position: 'absolute',
                  left: col * STEP,
                  fontSize: 10,
                  color: 'var(--muted-foreground, #888)',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </span>
            ))}
          </div>

          {/* Day-of-week row labels */}
          <div style={{ position: 'absolute', left: 0, top: 18, display: 'flex', flexDirection: 'column', gap: GAP }}>
            {ROW_LABELS.map((label, i) => (
              <div
                key={i}
                style={{ height: CELL, fontSize: 9, color: 'var(--muted-foreground, #888)', lineHeight: `${CELL}px`, textAlign: 'right', width: 24 }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Grid */}
          <div style={{ display: 'flex', gap: GAP }}>
            {columns.map((col, ci) => (
              <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
                {Array.from({ length: 7 }).map((_, row) => {
                  const cell = col[row] ?? null;
                  if (!cell) {
                    return (
                      <div
                        key={row}
                        style={{ width: CELL, height: CELL, borderRadius: 2, background: 'transparent' }}
                      />
                    );
                  }
                  const dateObj = new Date(cell.date + 'T12:00:00');
                  const label = `${cell.count} activit${cell.count === 1 ? 'y' : 'ies'} on ${MONTH_NAMES[dateObj.getMonth()]} ${dateObj.getDate()}`;
                  return (
                    <div
                      key={row}
                      title={label}
                      onMouseEnter={e => {
                        const rect = (e.target as HTMLElement).getBoundingClientRect();
                        setTooltip({ x: rect.left + rect.width / 2, y: rect.top - 6, text: label });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                      style={{
                        width: CELL,
                        height: CELL,
                        borderRadius: 2,
                        background: getColor(cell.count),
                        cursor: 'default',
                        transition: 'transform 0.1s',
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tooltip (portal-style via fixed position) */}
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%)',
            background: 'var(--popover, #1e2533)',
            color: 'var(--popover-foreground, #e2e8f0)',
            border: '1px solid var(--border, #2d3748)',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 11,
            pointerEvents: 'none',
            zIndex: 9999,
            whiteSpace: 'nowrap',
          }}
        >
          {tooltip.text}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-1.5 mt-2">
        <span className="text-[10px] text-muted-foreground">Less</span>
        {[0, 1, 2, 4, 6].map(n => (
          <div
            key={n}
            style={{ width: CELL, height: CELL, borderRadius: 2, background: getColor(n) }}
          />
        ))}
        <span className="text-[10px] text-muted-foreground">More</span>
      </div>
    </div>
  );
}
