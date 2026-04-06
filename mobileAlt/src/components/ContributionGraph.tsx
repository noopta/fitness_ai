import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { getToken } from '../lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HeatmapDay {
  date: string;
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
const CELL_STEP = CELL_SIZE + CELL_GAP;
const COLS = 52;
const ROWS = 7;

const MONTH_ROW_H = 16; // height reserved for month label row
const MONTH_GAP = 3;    // gap between month row and cells

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const EMPTY_CELL = '#1e2328';
const LEGEND_COLORS = [EMPTY_CELL, '#1a7f37', '#26a641', '#39d353', '#56e368'];

function getColor(count: number): string {
  if (count === 0) return EMPTY_CELL;
  if (count === 1) return '#1a7f37';
  if (count <= 3) return '#26a641';
  if (count <= 5) return '#39d353';
  return '#56e368';
}

function buildGrid(days: HeatmapDay[]): Array<Array<{ date: string; count: number }>> {
  const countMap = new Map<string, number>();
  for (const d of days) countMap.set(d.date, d.count);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - today.getDay());

  const firstSunday = new Date(lastSunday);
  firstSunday.setDate(lastSunday.getDate() - 51 * 7);

  const grid: Array<Array<{ date: string; count: number }>> = [];
  for (let col = 0; col < COLS; col++) {
    const column: Array<{ date: string; count: number }> = [];
    for (let row = 0; row < ROWS; row++) {
      const d = new Date(firstSunday);
      d.setDate(firstSunday.getDate() + col * 7 + row);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      column.push({ date: iso, count: d > today ? -1 : (countMap.get(iso) ?? 0) });
    }
    grid.push(column);
  }
  return grid;
}

function buildMonthLabels(grid: Array<Array<{ date: string; count: number }>>): Array<string | null> {
  const labels: Array<string | null> = [];
  let lastMonth = -1;
  for (const col of grid) {
    const firstCell = col.find(c => c.count !== -1) ?? col[0];
    const month = new Date(firstCell.date + 'T00:00:00').getMonth();
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

export const ContributionGraph = React.memo(function ContributionGraph({ userId }: Props) {
  const [rawDays, setRawDays] = useState<HeatmapDay[] | null>(null);
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
        if (!res.ok) throw new Error(`Server returned ${res.status}`);

        const json: HeatmapResponse | HeatmapDay[] = await res.json();
        const raw: HeatmapDay[] = Array.isArray(json)
          ? json
          : (json as HeatmapResponse).days ?? (json as HeatmapResponse).data ?? (json as HeatmapResponse).heatmap ?? [];

        if (!cancelled) setRawDays(raw);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? 'Failed to load activity');
          setRawDays([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [userId]);

  const grid = useMemo(() => rawDays ? buildGrid(rawDays) : null, [rawDays]);
  const monthLabels = useMemo(() => grid ? buildMonthLabels(grid) : [], [grid]);
  const totalCount = useMemo(
    () => rawDays ? rawDays.reduce((sum, d) => sum + (d.count ?? 0), 0) : 0,
    [rawDays],
  );

  if (loading || !grid) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={colors.mutedForeground} />
        <Text style={styles.loadingText}>Loading activity…</Text>
      </View>
    );
  }

  // Single SVG canvas replaces 364 native Views — eliminates layout overhead
  // and nested ScrollView gesture conflicts.
  const svgWidth = COLS * CELL_STEP - CELL_GAP;
  const cellsY = MONTH_ROW_H + MONTH_GAP;
  const svgHeight = cellsY + ROWS * CELL_STEP - CELL_GAP;

  // Legend SVG dimensions
  const legendItemW = CELL_SIZE + 3; // cell + gap
  const legendW = LEGEND_COLORS.length * legendItemW - 3;

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <Svg width={svgWidth} height={svgHeight}>
          {/* Month labels */}
          {monthLabels.map((label, colIndex) =>
            label ? (
              <SvgText
                key={`m-${colIndex}`}
                x={colIndex * CELL_STEP}
                y={MONTH_ROW_H - 4}
                fontSize={9}
                fill="#8b949e"
                fontWeight="500"
              >
                {label}
              </SvgText>
            ) : null
          )}

          {/* Cell grid */}
          {grid.map((col, colIndex) =>
            col.map((cell, rowIndex) => {
              if (cell.count < 0) return null;
              return (
                <Rect
                  key={`${colIndex}-${rowIndex}`}
                  x={colIndex * CELL_STEP}
                  y={cellsY + rowIndex * CELL_STEP}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  rx={2}
                  ry={2}
                  fill={getColor(cell.count)}
                />
              );
            })
          )}
        </Svg>
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
          <Svg width={legendW} height={CELL_SIZE}>
            {LEGEND_COLORS.map((c, i) => (
              <Rect key={c} x={i * legendItemW} y={0} width={CELL_SIZE} height={CELL_SIZE} rx={2} ry={2} fill={c} />
            ))}
          </Svg>
          <Text style={styles.legendLabel}>More</Text>
        </View>
      </View>
    </View>
  );
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#0d1117',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#30363d',
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
  footer: {
    marginTop: spacing.sm,
    paddingHorizontal: 2,
    gap: 6,
  },
  footerText: {
    fontSize: fontSize.xs,
    color: '#8b949e',
    fontWeight: fontWeight.medium,
  },
  errorText: {
    fontSize: fontSize.xs,
    color: colors.destructive,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendLabel: {
    fontSize: 9,
    color: '#8b949e',
    fontWeight: fontWeight.medium,
    marginHorizontal: 2,
  },
});
