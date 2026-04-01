import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { getToken } from '../lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HeatmapDay {
  date: string;  // ISO date string, e.g. "2025-03-14"
  count: number;
}

interface HeatmapResponse {
  days?: HeatmapDay[];
  data?: HeatmapDay[];
  heatmap?: HeatmapDay[];
}

interface Props {
  userId?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CELL_SIZE = 10;
const CELL_GAP = 2;
const COLS = 52;
const ROWS = 7; // Sun–Sat

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getColor(count: number): string {
  if (count === 0) return '#1a1a1a';
  if (count === 1) return '#0e4429';
  if (count <= 3) return '#006d32';
  if (count <= 5) return '#26a641';
  return '#39d353';
}

// Build a 52-week grid anchored so the last column ends on "today".
// Returns an array of 52 columns, each column is 7 cells (Sun=0 … Sat=6).
function buildGrid(days: HeatmapDay[]): Array<Array<{ date: string; count: number }>> {
  const countMap = new Map<string, number>();
  for (const d of days) {
    countMap.set(d.date, d.count);
  }

  // End of the grid = today; start = 52 weeks ago (364 days)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Column index 51 = the week containing today, column 0 = oldest week.
  // Within each column index 0 = Sunday … 6 = Saturday.
  // Find the Sunday that starts the last partial week containing today.
  const dayOfWeek = today.getDay(); // 0=Sun … 6=Sat
  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - dayOfWeek);

  // The first Sunday of our grid is 51 weeks before lastSunday.
  const firstSunday = new Date(lastSunday);
  firstSunday.setDate(lastSunday.getDate() - 51 * 7);

  const grid: Array<Array<{ date: string; count: number }>> = [];

  for (let col = 0; col < COLS; col++) {
    const column: Array<{ date: string; count: number }> = [];
    for (let row = 0; row < ROWS; row++) {
      const d = new Date(firstSunday);
      d.setDate(firstSunday.getDate() + col * 7 + row);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const isFuture = d > today;
      column.push({ date: iso, count: isFuture ? -1 : (countMap.get(iso) ?? 0) });
    }
    grid.push(column);
  }

  return grid;
}

// For each column (week), determine whether to show a month label.
// We show the label on the first column where a new month appears in that week.
function buildMonthLabels(grid: Array<Array<{ date: string; count: number }>>): Array<string | null> {
  const labels: Array<string | null> = [];
  let lastMonth = -1;
  for (const col of grid) {
    // Use the first valid cell's month
    const firstCell = col.find(c => c.count !== -1) ?? col[0];
    const d = new Date(firstCell.date + 'T00:00:00');
    const month = d.getMonth();
    if (month !== lastMonth) {
      labels.push(MONTH_LABELS[month]);
      lastMonth = month;
    } else {
      labels.push(null);
    }
  }
  return labels;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ContributionGraph({ userId }: Props) {
  const [grid, setGrid] = useState<Array<Array<{ date: string; count: number }>> | null>(null);
  const [monthLabels, setMonthLabels] = useState<Array<string | null>>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const url =
          'https://api.airthreads.ai:4009/api/activity/heatmap' +
          (userId ? `?userId=${encodeURIComponent(userId)}` : '');

        const res = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }

        const json: HeatmapResponse | HeatmapDay[] = await res.json();

        // Normalise whatever shape the server sends (array or object)
        const raw: HeatmapDay[] = Array.isArray(json)
          ? json
          : (json as HeatmapResponse).days ?? (json as HeatmapResponse).data ?? (json as HeatmapResponse).heatmap ?? [];

        if (!cancelled) {
          const g = buildGrid(raw);
          setGrid(g);
          setMonthLabels(buildMonthLabels(g));
          setTotalCount(raw.reduce((sum, d) => sum + (d.count ?? 0), 0));
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? 'Failed to load activity');
          // Still render an empty grid so the UI doesn't look broken
          const g = buildGrid([]);
          setGrid(g);
          setMonthLabels(buildMonthLabels(g));
          setTotalCount(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [userId]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={colors.mutedForeground} />
        <Text style={styles.loadingText}>Loading activity…</Text>
      </View>
    );
  }

  // ── Grid width for horizontal scroll ──────────────────────────────────────
  const gridWidth = COLS * (CELL_SIZE + CELL_GAP) - CELL_GAP;

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={{ width: gridWidth }}>
          {/* Month labels row */}
          <View style={styles.monthRow}>
            {monthLabels.map((label, colIndex) => (
              <View
                key={colIndex}
                style={[styles.monthCell, { width: CELL_SIZE + CELL_GAP }]}
              >
                {label ? (
                  <Text style={styles.monthText}>{label}</Text>
                ) : null}
              </View>
            ))}
          </View>

          {/* Cells grid: render row-by-row for natural left-to-right layout */}
          <View style={styles.cellGrid}>
            {Array.from({ length: ROWS }, (_, rowIndex) => (
              <View key={rowIndex} style={styles.gridRow}>
                {grid!.map((col, colIndex) => {
                  const cell = col[rowIndex];
                  const bg =
                    cell.count < 0
                      ? 'transparent'
                      : getColor(cell.count);
                  return (
                    <View
                      key={colIndex}
                      style={[
                        styles.cell,
                        { backgroundColor: bg },
                        cell.count < 0 && styles.cellFuture,
                      ]}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {totalCount.toLocaleString()} {totalCount === 1 ? 'activity' : 'activities'} this year
        </Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {/* Legend */}
        <View style={styles.legend}>
          <Text style={styles.legendLabel}>Less</Text>
          {['#1a1a1a', '#0e4429', '#006d32', '#26a641', '#39d353'].map((c) => (
            <View key={c} style={[styles.legendCell, { backgroundColor: c }]} />
          ))}
          <Text style={styles.legendLabel}>More</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },

  loadingContainer: {
    backgroundColor: colors.muted,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    fontWeight: fontWeight.medium,
  },

  scrollContent: {
    paddingHorizontal: 2,
  },

  // Month labels
  monthRow: {
    flexDirection: 'row',
    marginBottom: 4,
    height: 14,
  },
  monthCell: {
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  monthText: {
    fontSize: 9,
    color: colors.mutedForeground,
    fontWeight: fontWeight.medium,
  },

  // Cells
  cellGrid: {
    gap: CELL_GAP,
  },
  gridRow: {
    flexDirection: 'row',
    gap: CELL_GAP,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 2,
  },
  cellFuture: {
    borderWidth: 0,
  },

  // Footer
  footer: {
    marginTop: spacing.sm,
    paddingHorizontal: 2,
    gap: 6,
  },
  footerText: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    fontWeight: fontWeight.medium,
  },
  errorText: {
    fontSize: fontSize.xs,
    color: colors.destructive,
  },

  // Legend
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  legendCell: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  legendLabel: {
    fontSize: 9,
    color: colors.mutedForeground,
    fontWeight: fontWeight.medium,
    marginHorizontal: 2,
  },
});
