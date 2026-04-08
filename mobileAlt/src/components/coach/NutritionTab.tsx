import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TextInput,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from '../ui/KeyboardDoneBar';
import Svg, { Polyline, Circle, Line, Text as SvgText, Path } from 'react-native-svg';
import { coachApi, nutritionApi } from '../../lib/api';
import { MealLogModal } from './MealLogModal';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';

const MEAL_SHEET_HEIGHT = Dimensions.get('window').height * 0.75;

// ─── Nutrition Cache ──────────────────────────────────────────────────────────
// Body weight logs are cached for 30 days; today's meals are cached per-day
// and invalidated automatically when the date changes or new food is logged.

const BW_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function getCached<T>(key: string, ttlMs: number): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > ttlMs) return null;
    return data as T;
  } catch { return null; }
}

async function setCache(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch { /* best-effort */ }
}

async function clearCache(key: string): Promise<void> {
  try { await AsyncStorage.removeItem(key); } catch { /* best-effort */ }
}
const CHART_WIDTH = Dimensions.get('window').width - spacing.md * 4;

// ─── Body Weight Charts ───────────────────────────────────────────────────────

interface BodyWeightEntry { id?: string; weightKg?: number; weightLbs?: number; date: string; createdAt?: string }

function WeightChart({ entries }: { entries: BodyWeightEntry[] }) {
  if (entries.length < 2) return null;
  const W = CHART_WIDTH; const H = 100; const PH = 32; const PV = 12;
  const sorted = [...entries].reverse();
  const weights = sorted.map(e => e.weightLbs ?? e.weightKg ?? 0);
  const minW = Math.min(...weights); const maxW = Math.max(...weights); const range = maxW - minW || 1;
  const toX = (i: number) => PH + (i / (sorted.length - 1)) * (W - PH * 2);
  const toY = (w: number) => PV + (1 - (w - minW) / range) * (H - PV * 2);
  const points = sorted.map((e, i) => `${toX(i).toFixed(1)},${toY(e.weightLbs ?? e.weightKg ?? 0).toFixed(1)}`).join(' ');
  const trend = weights[weights.length - 1] - weights[0];
  const lineColor = trend <= 0 ? colors.success : colors.destructive;
  return (
    <View style={{ alignItems: 'center', marginVertical: spacing.sm }}>
      <Svg width={W} height={H}>
        <Line x1={PH} y1={H - PV} x2={W - PH} y2={H - PV} stroke={colors.border} strokeWidth="1" />
        <Polyline points={points} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <Circle cx={toX(0)} cy={toY(weights[0])} r="4" fill={colors.border} />
        <Circle cx={toX(sorted.length - 1)} cy={toY(weights[weights.length - 1])} r="4" fill={lineColor} />
        <SvgText x={2} y={toY(maxW) + 4} fontSize="9" fill={colors.mutedForeground}>{maxW.toFixed(0)}</SvgText>
        <SvgText x={2} y={toY(minW) + 4} fontSize="9" fill={colors.mutedForeground}>{minW.toFixed(0)}</SvgText>
      </Svg>
    </View>
  );
}

function WeightProjectionChart({ entries, weeklyChangeLbs, totalWeeks, currentWeek }: { entries: BodyWeightEntry[]; weeklyChangeLbs: number; totalWeeks: number; currentWeek: number }) {
  const [tooltip, setTooltip] = useState<{ idx: number; x: number; y: number } | null>(null);
  const W = CHART_WIDTH; const H = 155; const PH = 36; const PV = 30;
  interface ProjectionPoint { label: string; actual: number | null; projected: number | null }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const points: ProjectionPoint[] = [];
  for (let w = -4; w <= 0; w++) {
    const d = new Date(today); d.setDate(d.getDate() + w * 7);
    const entry = entries.find(e => { const diff = Math.abs(new Date((e.date || e.createdAt || '').split('T')[0]).getTime() - d.getTime()) / 86400000; return diff <= 3; });
    points.push({ label: `W${w === 0 ? 'Now' : w}`, actual: entry ? (entry.weightLbs ?? entry.weightKg ?? null) : null, projected: null });
  }
  const weeksRemaining = Math.max(0, totalWeeks - currentWeek);
  const latestActual = entries.length > 0 ? (entries[0].weightLbs ?? entries[0].weightKg ?? null) : null;
  if (latestActual !== null && weeksRemaining > 0) {
    const projWeeks = Math.min(weeksRemaining, 8);
    for (let w = 1; w <= projWeeks; w++) points.push({ label: `+${w}w`, actual: null, projected: latestActual + weeklyChangeLbs * w });
  }
  if (points.length < 2) return null;
  const allVals = points.flatMap(p => [p.actual, p.projected]).filter((v): v is number => v !== null);
  if (allVals.length < 2) return null;
  const minV = Math.min(...allVals) - 2; const maxV = Math.max(...allVals) + 2; const range = maxV - minV || 1;
  const toX = (i: number) => PH + (i / (points.length - 1)) * (W - PH * 2);
  const toY = (v: number) => PV + (1 - (v - minV) / range) * (H - PV * 2 - 20);
  const actualPts = points.map((p, i) => p.actual !== null ? `${toX(i).toFixed(1)},${toY(p.actual).toFixed(1)}` : null).filter(Boolean);
  const projPts = points.map((p, i) => p.projected !== null ? `${toX(i).toFixed(1)},${toY(p.projected).toFixed(1)}` : null).filter(Boolean);
  const lastActualIdx = points.reduce((acc, p, i) => p.actual !== null ? i : acc, -1);
  const firstProjIdx = points.findIndex(p => p.projected !== null);
  let bridgePath = '';
  if (lastActualIdx >= 0 && firstProjIdx > lastActualIdx) {
    bridgePath = `M${toX(lastActualIdx).toFixed(1)},${toY(points[lastActualIdx].actual!).toFixed(1)} L${toX(firstProjIdx).toFixed(1)},${toY(points[firstProjIdx].projected!).toFixed(1)}`;
  }
  const trend = weeklyChangeLbs <= 0 ? colors.success : colors.destructive;

  // Find which index is closest to touch X
  function handleTouch(touchX: number) {
    let closest = 0;
    let minDist = Infinity;
    points.forEach((_, i) => {
      const dist = Math.abs(toX(i) - touchX);
      if (dist < minDist) { minDist = dist; closest = i; }
    });
    const p = points[closest];
    const val = p.actual ?? p.projected;
    if (val !== null) setTooltip({ idx: closest, x: toX(closest), y: toY(val) });
  }

  const activePoint = tooltip !== null ? points[tooltip.idx] : null;
  const activeVal = activePoint ? (activePoint.actual ?? activePoint.projected) : null;
  const isProjected = activePoint ? activePoint.actual === null : false;

  return (
    <View style={{ gap: spacing.xs }}>
      <View
        onStartShouldSetResponder={() => true}
        onResponderGrant={e => handleTouch(e.nativeEvent.locationX)}
        onResponderMove={e => handleTouch(e.nativeEvent.locationX)}
        onResponderRelease={() => setTimeout(() => setTooltip(null), 1400)}
      >
        <Svg width={W} height={H}>
          <Line x1={PH} y1={H - PV - 12} x2={W - PH} y2={H - PV - 12} stroke={colors.border} strokeWidth="1" />
          {actualPts.length >= 2 && <Polyline points={actualPts.join(' ')} fill="none" stroke={colors.primary} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
          {bridgePath ? <Path d={bridgePath} fill="none" stroke={trend} strokeWidth="1.5" strokeDasharray="4,4" /> : null}
          {projPts.length >= 2 && <Polyline points={projPts.join(' ')} fill="none" stroke={trend} strokeWidth="2" strokeDasharray="5,4" strokeLinejoin="round" strokeLinecap="round" />}

          {/* Data point dots with labels */}
          {points.map((p, i) => {
            const val = p.actual ?? p.projected;
            if (val === null) return null;
            const cx = toX(i); const cy = toY(val);
            const isProj = p.actual === null;
            const dotColor = isProj ? trend : colors.primary;
            const isActive = tooltip?.idx === i;
            return (
              <React.Fragment key={i}>
                <Circle cx={cx} cy={cy} r={isActive ? 6 : 3} fill={dotColor} opacity={isProj && !isActive ? 0.6 : 1} />
                {/* Label below dot */}
                <SvgText x={cx} y={H - 6} fontSize="8" fill={colors.mutedForeground} textAnchor="middle">{p.label}</SvgText>
                {/* Weight label above every 2nd point */}
                {(i % 2 === 0 || i === points.length - 1) && (
                  <SvgText x={cx} y={cy - 7} fontSize="9" fill={isProj ? trend : colors.primary} textAnchor="middle" fontWeight="600">
                    {val.toFixed(1)}
                  </SvgText>
                )}
              </React.Fragment>
            );
          })}

          {/* Tooltip bubble on active touch */}
          {tooltip && activeVal !== null && (() => {
            const tx = Math.min(Math.max(tooltip.x, 50), W - 50);
            const ty = Math.max(tooltip.y - 36, 24);
            return (
              <>
                <Line x1={tooltip.x} y1={tooltip.y - 6} x2={tooltip.x} y2={H - PV - 14} stroke={isProjected ? trend : colors.primary} strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />
                <Circle cx={tooltip.x} cy={tooltip.y} r={8} fill={isProjected ? trend : colors.primary} opacity="0.15" />
                <Circle cx={tooltip.x} cy={tooltip.y} r={5} fill={isProjected ? trend : colors.primary} />
                {/* Tooltip box */}
                <Path d={`M${tx - 34},${ty} Q${tx - 34},${ty - 2} ${tx - 32},${ty - 2} L${tx + 32},${ty - 2} Q${tx + 34},${ty - 2} ${tx + 34},${ty} L${tx + 34},${ty + 18} Q${tx + 34},${ty + 20} ${tx + 32},${ty + 20} L${tx - 32},${ty + 20} Q${tx - 34},${ty + 20} ${tx - 34},${ty + 18} Z`} fill={isProjected ? trend : colors.primary} opacity="0.9" />
                <SvgText x={tx} y={ty + 13} fontSize="10" fill="#fff" textAnchor="middle" fontWeight="700">
                  {activeVal.toFixed(1)} lbs {isProjected ? '(proj)' : ''}
                </SvgText>
              </>
            );
          })()}

          <SvgText x={2} y={toY(maxV - 2) + 4} fontSize="9" fill={colors.mutedForeground}>{Math.round(maxV - 2)}</SvgText>
          <SvgText x={2} y={toY(minV + 2) + 4} fontSize="9" fill={colors.mutedForeground}>{Math.round(minV + 2)}</SvgText>
        </Svg>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} /><Text style={{ fontSize: 10, color: colors.mutedForeground }}>Actual</Text></View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: trend }} /><Text style={{ fontSize: 10, color: colors.mutedForeground }}>Projected</Text></View>
        <Text style={{ marginLeft: 'auto' as any, fontSize: 10, color: colors.mutedForeground, fontStyle: 'italic' }}>{weeklyChangeLbs > 0 ? '+' : ''}{weeklyChangeLbs.toFixed(1)} lbs/week</Text>
      </View>
    </View>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface NutritionTabProps {
  coachData: any;
  coachGoal?: string | null;
  coachBudget?: string | null;
  onRefresh?: () => Promise<void> | void;
  userId?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ value, color, height = 4 }: { value: number; color: string; height?: number }) {
  const pct = Math.min(Math.max(value, 0), 100);
  const animWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(animWidth, {
      toValue: pct,
      damping: 18,
      stiffness: 120,
      useNativeDriver: false,
    }).start();
  }, [pct]);

  const widthInterpolated = animWidth.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.progressTrack, { height }]}>
      <Animated.View style={[styles.progressBar, { width: widthInterpolated, backgroundColor: color }]} />
    </View>
  );
}

interface MacroCardProps {
  label: string;
  grams: number | null;
  logged: number;
  color: string;
  target?: string;
}

function MacroCard({ label, grams, logged, color, target }: MacroCardProps) {
  const pct = grams ? (logged / grams) * 100 : 0;
  return (
    <View style={styles.macroCard}>
      <View style={[styles.macroIndicator, { backgroundColor: color }]} />
      <Text style={styles.macroCardLabel}>{label}</Text>
      <Text style={[styles.macroGrams, { color }]}>
        {logged > 0 ? `${Math.round(logged)}` : grams !== null ? `${grams}` : target ?? '—'}
        <Text style={styles.macroUnit}>g</Text>
      </Text>
      {grams !== null && (
        <Text style={styles.macroTarget}>of {grams}g</Text>
      )}
      <ProgressBar value={pct} color={color} />
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function NutritionTab({ coachData, coachGoal, coachBudget, onRefresh, userId }: NutritionTabProps) {
  const [mealModalVisible, setMealModalVisible] = useState(false);
  const [mealSuggestions, setMealSuggestions] = useState<any[]>([]);
  const [mealLoading, setMealLoading] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [prefillMeal, setPrefillMeal] = useState<any>(null);

  // Today's logged meals
  const [todayMeals, setTodayMeals] = useState<any[]>([]);
  const [loadingMeals, setLoadingMeals] = useState(false);

  // Body weight logs
  const [bwLogs, setBwLogs] = useState<BodyWeightEntry[]>([]);
  const [bwLoading, setBwLoading] = useState(true);
  const [bwInput, setBwInput] = useState('');
  const [savingBw, setSavingBw] = useState(false);

  // Describe-a-meal parser
  const [mealDesc, setMealDesc] = useState('');
  const [mealParsing, setMealParsing] = useState(false);
  const [parsedMeal, setParsedMeal] = useState<{
    name: string; mealType: string; calories: number;
    proteinG: number; carbsG: number; fatG: number; confidence: string; notes?: string;
  } | null>(null);

  // Parse nutrition plan from saved program
  let nutritionPlan: any = null;
  let savedProg: any = null;
  if (coachData?.savedProgram) {
    try {
      savedProg =
        typeof coachData.savedProgram === 'string'
          ? JSON.parse(coachData.savedProgram)
          : coachData.savedProgram;
      nutritionPlan = savedProg?.nutritionPlan ?? savedProg?.nutrition ?? null;
    } catch {
      nutritionPlan = null;
    }
  }

  const macros = nutritionPlan?.macros ?? nutritionPlan;
  const baseTargetCalories: number | null = macros?.calories ?? nutritionPlan?.calories ?? null;

  // Adjustable calorie state (initialized from plan, user can tweak)
  const [calorieAdjust, setCalorieAdjust] = useState<number>(0);
  const [calorieInput, setCalorieInput] = useState<string>('');
  const [photoScanning, setPhotoScanning] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [scannedMeal, setScannedMeal] = useState<{ name: string; proteinG: number; carbsG: number; fatG: number; calories: number; mealType: string; confidence: string; notes: string } | null>(null);

  const targetCalories: number | null = baseTargetCalories !== null
    ? baseTargetCalories + calorieAdjust
    : null;

  // Weight projection data
  const weeklyWeightChangeLb: number | null = nutritionPlan?.expectedOutcomes?.weeklyWeightChangeLb ?? null;
  const totalWeeks: number = savedProg?.durationWeeks ?? 0;
  const currentWeek: number = coachData?.currentWeek ?? 1;
  const weeksRemaining = Math.max(0, totalWeeks - currentWeek);
  // Adjust projected weekly change based on calorie adjustment (3500 kcal ≈ 1 lb)
  const adjustedWeeklyChange: number | null = weeklyWeightChangeLb !== null
    ? weeklyWeightChangeLb + (calorieAdjust * 7) / 3500
    : null;
  const currentWeightLbs: number | null = (() => {
    try {
      const bw = coachData?.currentWeightLbs ?? coachData?.weightKg
        ? (coachData.weightKg ? coachData.weightKg * 2.205 : null)
        : null;
      return bw;
    } catch { return null; }
  })();
  const targetWeightLbs: number | null =
    currentWeightLbs !== null && adjustedWeeklyChange !== null && weeksRemaining > 0
      ? currentWeightLbs + adjustedWeeklyChange * weeksRemaining
      : null;
  const targetProtein: number | null = macros?.proteinG ?? macros?.protein_g ?? macros?.protein ?? null;
  const targetCarbs: number | null = macros?.carbsG ?? macros?.carbs_g ?? macros?.carbs ?? null;
  const targetFat: number | null = macros?.fatG ?? macros?.fat_g ?? macros?.fat ?? null;
  const targetFiber: number | null = macros?.fiberG ?? macros?.fiber_g ?? macros?.fiber ?? null;

  // Chart aliases for WeightProjectionChart
  const weeklyChangeLbsForChart = adjustedWeeklyChange;
  const weeksForChart = totalWeeks;
  const currentWeekForChart = currentWeek;
  const weeksToEnd = weeksRemaining;

  // Today's logged totals
  const loggedCalories = todayMeals.reduce((s, m) => s + (m.calories || 0), 0);
  const loggedProtein = todayMeals.reduce((s, m) => s + (m.proteinG || 0), 0);
  const loggedCarbs = todayMeals.reduce((s, m) => s + (m.carbsG || 0), 0);
  const loggedFat = todayMeals.reduce((s, m) => s + (m.fatG || 0), 0);

  const caloriePct = targetCalories ? (loggedCalories / targetCalories) * 100 : 0;

  const bwCacheKey = `nutrition_bw_${userId ?? 'anon'}`;
  const mealCacheKey = `nutrition_meals_${userId ?? 'anon'}_${todayStr()}`;

  const loadMealData = useCallback(async (forceRefresh = false) => {
    setLoadingMeals(true);
    try {
      // Today's meals: cache per user per day (invalidated by date change or forced refresh)
      let mealsData: any = forceRefresh ? null : await getCached<any>(mealCacheKey, 24 * 60 * 60 * 1000);
      if (!mealsData) {
        mealsData = await nutritionApi.getMeals(todayStr());
        if (mealsData) await setCache(mealCacheKey, mealsData);
      }
      setTodayMeals(mealsData?.entries ?? []);

      // Body weight logs: cache for 30 days
      let bwData: any = forceRefresh ? null : await getCached<any>(bwCacheKey, BW_CACHE_TTL_MS);
      if (!bwData) {
        bwData = await coachApi.getBodyWeight().catch(() => null);
        if (bwData) await setCache(bwCacheKey, bwData);
      }
      if (bwData) {
        const logs = Array.isArray(bwData) ? bwData : bwData?.logs ?? bwData?.entries ?? bwData?.weights ?? [];
        setBwLogs([...logs].sort((a: any, b: any) => new Date(b.date || b.createdAt || 0).getTime() - new Date(a.date || a.createdAt || 0).getTime()));
      }
      setBwLoading(false);
    } catch {
      // silently fail — nutrition data is supplementary
    } finally {
      setLoadingMeals(false);
    }
  }, [bwCacheKey, mealCacheKey]);

  useEffect(() => {
    loadMealData();
  }, [loadMealData]);

  async function handleDeleteMeal(id: string) {
    Alert.alert('Delete Meal', 'Remove this meal entry?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await nutritionApi.deleteMeal(id);
            setTodayMeals(prev => prev.filter(m => m.id !== id));
            await clearCache(mealCacheKey);
          } catch (err: any) {
            Alert.alert('Error', err?.message || 'Failed to delete meal');
          }
        },
      },
    ]);
  }

  async function handleParseMealDesc() {
    if (mealDesc.trim().length < 3) return;
    setMealParsing(true);
    setParsedMeal(null);
    try {
      const result = await nutritionApi.parseMeal(mealDesc.trim());
      if (result) setParsedMeal(result);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not analyze meal. Please try again.');
    } finally {
      setMealParsing(false);
    }
  }

  async function handleAddParsedMeal() {
    if (!parsedMeal) return;
    try {
      await nutritionApi.logMeal({
        date: todayStr(),
        name: parsedMeal.name,
        mealType: (parsedMeal.mealType as any) || 'meal',
        calories: parsedMeal.calories,
        proteinG: parsedMeal.proteinG,
        carbsG: parsedMeal.carbsG,
        fatG: parsedMeal.fatG,
        notes: mealDesc.trim(),
      });
      setMealDesc('');
      setParsedMeal(null);
      await clearCache(mealCacheKey);
      loadMealData(true);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to log meal.');
    }
  }

  async function handlePickAndScanPhoto(useCamera: boolean) {
    const permFn = useCamera
      ? ImagePicker.requestCameraPermissionsAsync
      : ImagePicker.requestMediaLibraryPermissionsAsync;
    const { status } = await permFn();
    if (status !== 'granted') {
      Alert.alert('Permission needed', `Please allow ${useCamera ? 'camera' : 'photo library'} access in Settings.`);
      return;
    }
    const result = await (useCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const compressed = await ImageManipulator.manipulateAsync(
      result.assets[0].uri,
      [{ resize: { width: 1024 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );
    setPhotoUri(compressed.uri);
    setScannedMeal(null);
    setPhotoScanning(true);
    try {
      const resp = await fetch(compressed.uri);
      const blob = await resp.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const analysisResult = await nutritionApi.analyzePhoto(base64, 'image/jpeg');
      if (analysisResult) setScannedMeal(analysisResult);
    } catch (err: any) {
      Alert.alert('Analysis failed', err?.message || 'Could not analyze photo. Try describing the meal instead.');
      setPhotoUri(null);
    } finally {
      setPhotoScanning(false);
    }
  }

  async function handleAddScannedMeal() {
    if (!scannedMeal) return;
    try {
      await nutritionApi.logMeal({
        date: todayStr(),
        name: scannedMeal.name,
        mealType: (scannedMeal.mealType as any) || 'meal',
        calories: scannedMeal.calories,
        proteinG: scannedMeal.proteinG,
        carbsG: scannedMeal.carbsG,
        fatG: scannedMeal.fatG,
      });
      setScannedMeal(null);
      setPhotoUri(null);
      await clearCache(mealCacheKey);
      loadMealData(true);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to log meal.');
    }
  }

  async function handleLogBodyWeight() {
    const val = parseFloat(bwInput);
    if (!val || val < 50 || val > 700) {
      Alert.alert('Invalid', 'Please enter a valid weight in lbs.');
      return;
    }
    setSavingBw(true);
    try {
      await coachApi.logBodyWeight(val);
      setBwInput('');
      const bwRes = await coachApi.getBodyWeight().catch(() => null);
      if (bwRes) {
        const logs = Array.isArray(bwRes) ? bwRes : bwRes?.logs ?? bwRes?.entries ?? bwRes?.weights ?? [];
        setBwLogs([...logs].sort((a: any, b: any) => new Date(b.date || b.createdAt || 0).getTime() - new Date(a.date || a.createdAt || 0).getTime()));
      }
      setBwLoading(false);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to log weight.');
    } finally {
      setSavingBw(false);
    }
  }

  async function handleGetMealSuggestions() {
    setMealLoading(true);
    try {
      const result = await coachApi.getMealSuggestions({
        macros: {
          proteinG: targetProtein ?? 150,
          carbsG: targetCarbs ?? 200,
          fatG: targetFat ?? 60,
          calories: targetCalories ?? 2000,
        },
        goal: coachGoal || 'strength',
        numberOfMeals: 5,
        budget: coachBudget || null,
      });
      const raw: any[] = Array.isArray(result)
        ? result
        : result?.meals ?? result?.suggestions ?? result?.mealSuggestions ?? [];
      setMealSuggestions(raw.length === 0
        ? [{ name: 'No suggestions returned', description: 'Please try again.' }]
        : raw.map((item: any) => typeof item === 'string' ? { name: item } : item)
      );
    } catch (err: any) {
      setMealSuggestions([{ name: err?.message || 'Could not load suggestions. Please try again.' }]);
    } finally {
      setMealLoading(false);
      setMealModalVisible(true);
    }
  }

  async function handleGeneratePlan() {
    setGeneratingPlan(true);
    setPlanError(null);
    try {
      const plan = await coachApi.generateNutritionPlan({ goal: coachGoal || 'general' });
      const existingProgram = coachData?.savedProgram ?? {};
      await coachApi.updateProgram({ program: { ...existingProgram, nutritionPlan: plan } });
      if (onRefresh) await onRefresh();
    } catch (err: any) {
      setPlanError(err?.message || 'Failed to generate plan. Please try again.');
    } finally {
      setGeneratingPlan(false);
    }
  }

  // ── No plan state ────────────────────────────────────────────────────────────

  if (!nutritionPlan) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Card style={styles.card}>
          <CardContent style={styles.emptyContent}>
            <Text style={styles.emptyIcon}>🥗</Text>
            <Text style={styles.emptyTitle}>No Nutrition Plan Yet</Text>
            <Text style={styles.emptyDesc}>
              Generate a personalized nutrition plan based on your training goals.
            </Text>
            <Button fullWidth onPress={handleGeneratePlan} loading={generatingPlan} style={styles.generateBtn}>
              Generate Nutrition Plan
            </Button>
            {planError && <Text style={styles.planErrorText}>{planError}</Text>}
          </CardContent>
        </Card>
      </ScrollView>
    );
  }

  // ── Has plan ─────────────────────────────────────────────────────────────────

  return (
    <>
      <KeyboardDoneBar />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={loadingMeals} onRefresh={() => loadMealData(true)} />}
      >
        {/* ── Today's Progress ── */}
        <Card style={styles.card}>
          <CardHeader>
            <View style={styles.cardHeaderRow}>
              <CardTitle>Today's Calories</CardTitle>
              <TouchableOpacity style={styles.logBtn} onPress={() => { setPrefillMeal(null); setLogModalVisible(true); }}>
                <Ionicons name="add" size={14} color={colors.primary} />
                <Text style={styles.logBtnText}>Log Meal</Text>
              </TouchableOpacity>
            </View>
          </CardHeader>
          <CardContent style={styles.calContent}>
            <View style={styles.calRow}>
              <View style={styles.calMain}>
                <Text style={styles.calLogged}>{Math.round(loggedCalories)}</Text>
                <Text style={styles.calSlash}> / </Text>
                <Text style={styles.calTarget}>{targetCalories ?? '—'}</Text>
                <Text style={styles.calUnit}> kcal</Text>
              </View>
              <Text style={styles.calRemaining}>
                {targetCalories
                  ? `${Math.max(0, Math.round(targetCalories - loggedCalories))} left`
                  : ''}
              </Text>
            </View>
            <ProgressBar value={caloriePct} color={colors.primary} height={6} />
          </CardContent>
        </Card>

        {/* ── Macro targets ── */}
        <Card style={styles.card}>
          <CardHeader><CardTitle>Macronutrients</CardTitle></CardHeader>
          <CardContent style={styles.macroGrid}>
            <MacroCard label="Protein" grams={targetProtein} logged={loggedProtein} color="#3b82f6" />
            <MacroCard label="Carbs" grams={targetCarbs} logged={loggedCarbs} color="#f59e0b" />
            <MacroCard label="Fat" grams={targetFat} logged={loggedFat} color="#ec4899" />
            <MacroCard label="Fiber" grams={targetFiber} logged={0} color="#22c55e" target="25-35g" />
          </CardContent>
        </Card>

        {/* ── Log a Meal by Description ── */}
        <Card style={styles.card}>
          <CardHeader>
            <View style={styles.descCardHeader}>
              <Ionicons name="sparkles" size={13} color={colors.mutedForeground} />
              <Text style={styles.descCardLabel}>LOG A MEAL BY DESCRIPTION</Text>
            </View>
          </CardHeader>
          <CardContent style={styles.descCardContent}>
            <View style={styles.descInputRow}>
              <TextInput
                style={styles.descInput}
                placeholder={`e.g. "osmow's oz box" or "2 eggs and toast"`}
                placeholderTextColor={colors.mutedForeground}
                value={mealDesc}
                onChangeText={setMealDesc}
                onSubmitEditing={handleParseMealDesc}
                returnKeyType="done"
                inputAccessoryViewID={KEYBOARD_DONE_ID}
              />
              <TouchableOpacity
                style={[styles.descBtn, (mealParsing || mealDesc.trim().length < 3) && styles.descBtnDisabled]}
                onPress={handleParseMealDesc}
                disabled={mealParsing || mealDesc.trim().length < 3}
              >
                {mealParsing
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.descBtnText}>Get Macros</Text>}
              </TouchableOpacity>
            </View>

            {parsedMeal && (
              <View style={styles.parsedCard}>
                <View style={styles.parsedHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.parsedName}>{parsedMeal.name}</Text>
                    {parsedMeal.notes ? (
                      <Text style={styles.parsedNotes} numberOfLines={1}>{parsedMeal.notes}</Text>
                    ) : null}
                  </View>
                  <View style={[styles.confidenceBadge, {
                    backgroundColor: parsedMeal.confidence === 'high' ? '#22c55e15' :
                      parsedMeal.confidence === 'medium' ? '#f59e0b15' : '#ef444415',
                  }]}>
                    <Text style={[styles.confidenceText, {
                      color: parsedMeal.confidence === 'high' ? '#16a34a' :
                        parsedMeal.confidence === 'medium' ? '#d97706' : '#dc2626',
                    }]}>{parsedMeal.confidence}</Text>
                  </View>
                </View>

                <View style={styles.parsedMacros}>
                  {[
                    { label: 'Protein', value: `${parsedMeal.proteinG}g`, color: '#6366f1' },
                    { label: 'Carbs', value: `${parsedMeal.carbsG}g`, color: '#22c55e' },
                    { label: 'Fat', value: `${parsedMeal.fatG}g`, color: '#f59e0b' },
                    { label: 'Calories', value: String(parsedMeal.calories), color: colors.foreground },
                  ].map(({ label, value, color }) => (
                    <View key={label} style={[styles.parsedMacroTile, { borderColor: color + '30' }]}>
                      <Text style={styles.parsedMacroLabel}>{label}</Text>
                      <Text style={[styles.parsedMacroVal, { color }]}>{value}</Text>
                    </View>
                  ))}
                </View>

                <TouchableOpacity style={styles.addToLogBtn} onPress={handleAddParsedMeal}>
                  <Ionicons name="add-circle-outline" size={15} color="#fff" />
                  <Text style={styles.addToLogBtnText}>Add to Today's Log</Text>
                </TouchableOpacity>
              </View>
            )}
          </CardContent>
        </Card>

        {/* ── Scan a Meal Photo ── */}
        <Card style={styles.card}>
          <CardHeader>
            <View style={styles.descCardHeader}>
              <Ionicons name="camera-outline" size={13} color={colors.mutedForeground} />
              <Text style={styles.descCardLabel}>SCAN A MEAL PHOTO</Text>
              <View style={styles.aiVisionBadge}>
                <Text style={styles.aiVisionText}>AI Vision</Text>
              </View>
            </View>
          </CardHeader>
          <CardContent style={styles.descCardContent}>
            {photoScanning ? (
              <View style={styles.scanningBox}>
                {photoUri && <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />}
                <View style={styles.scanningOverlay}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={styles.scanningText}>Analyzing your meal…</Text>
                </View>
              </View>
            ) : (
              <View style={styles.scanBtnRow}>
                <TouchableOpacity style={styles.scanActionBtn} onPress={() => handlePickAndScanPhoto(true)}>
                  <Ionicons name="camera" size={20} color={colors.primary} />
                  <Text style={styles.scanActionBtnText}>Take Photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.scanActionBtn, styles.scanActionBtnSecondary]} onPress={() => handlePickAndScanPhoto(false)}>
                  <Ionicons name="images-outline" size={20} color={colors.mutedForeground} />
                  <Text style={[styles.scanActionBtnText, { color: colors.mutedForeground }]}>Library</Text>
                </TouchableOpacity>
              </View>
            )}

            {scannedMeal && !photoScanning && (
              <View style={styles.parsedCard}>
                <View style={styles.parsedHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.parsedName}>{scannedMeal.name}</Text>
                    {scannedMeal.notes ? (
                      <Text style={styles.parsedNotes} numberOfLines={1}>{scannedMeal.notes}</Text>
                    ) : null}
                  </View>
                  <View style={[styles.confidenceBadge, {
                    backgroundColor: scannedMeal.confidence === 'high' ? '#22c55e15' :
                      scannedMeal.confidence === 'medium' ? '#f59e0b15' : '#ef444415',
                  }]}>
                    <Text style={[styles.confidenceText, {
                      color: scannedMeal.confidence === 'high' ? '#16a34a' :
                        scannedMeal.confidence === 'medium' ? '#d97706' : '#dc2626',
                    }]}>{scannedMeal.confidence}</Text>
                  </View>
                </View>
                <View style={styles.parsedMacros}>
                  {[
                    { label: 'Protein', value: `${scannedMeal.proteinG}g`, color: '#6366f1' },
                    { label: 'Carbs', value: `${scannedMeal.carbsG}g`, color: '#22c55e' },
                    { label: 'Fat', value: `${scannedMeal.fatG}g`, color: '#f59e0b' },
                    { label: 'Calories', value: String(scannedMeal.calories), color: colors.foreground },
                  ].map(({ label, value, color }) => (
                    <View key={label} style={[styles.parsedMacroTile, { borderColor: color + '30' }]}>
                      <Text style={styles.parsedMacroLabel}>{label}</Text>
                      <Text style={[styles.parsedMacroVal, { color }]}>{value}</Text>
                    </View>
                  ))}
                </View>
                <TouchableOpacity style={styles.addToLogBtn} onPress={handleAddScannedMeal}>
                  <Ionicons name="add-circle-outline" size={15} color="#fff" />
                  <Text style={styles.addToLogBtnText}>Add to Today's Log</Text>
                </TouchableOpacity>
              </View>
            )}
          </CardContent>
        </Card>

        {/* ── Weight Projection + Calorie Adjustment ── */}
        {(adjustedWeeklyChange !== null || targetCalories !== null) && (
          <Card style={styles.card}>
            <CardHeader><CardTitle>Weekly Projection</CardTitle></CardHeader>
            <CardContent style={styles.projContent}>
              {adjustedWeeklyChange !== null && (
                <View style={styles.projRow}>
                  <Text style={styles.projLabel}>Projected weight change/week</Text>
                  <Text style={[
                    styles.projValue,
                    { color: adjustedWeeklyChange < 0 ? colors.success : adjustedWeeklyChange > 0 ? colors.destructive : colors.foreground }
                  ]}>
                    {adjustedWeeklyChange > 0 ? '+' : ''}{adjustedWeeklyChange.toFixed(2)} lbs
                  </Text>
                </View>
              )}
              {targetWeightLbs !== null && (
                <View style={styles.projRow}>
                  <Text style={styles.projLabel}>Target weight at program end</Text>
                  <Text style={[styles.projValue, { color: colors.primary }]}>
                    {targetWeightLbs.toFixed(1)} lbs
                  </Text>
                </View>
              )}
              {baseTargetCalories !== null && (
                <View style={styles.calAdjustSection}>
                  <Text style={styles.calAdjustLabel}>Adjust daily calories</Text>
                  <View style={styles.calAdjustRow}>
                    <TouchableOpacity
                      style={styles.calAdjustBtn}
                      onPress={() => setCalorieAdjust(a => Math.max(a - 50, -500))}
                    >
                      <Text style={styles.calAdjustBtnText}>−50</Text>
                    </TouchableOpacity>
                    <View style={styles.calAdjustDisplay}>
                      <Text style={styles.calAdjustDisplayVal}>
                        {targetCalories} kcal
                      </Text>
                      {calorieAdjust !== 0 && (
                        <Text style={[styles.calAdjustDiff, { color: calorieAdjust > 0 ? colors.destructive : colors.success }]}>
                          {calorieAdjust > 0 ? '+' : ''}{calorieAdjust} from plan
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={styles.calAdjustBtn}
                      onPress={() => setCalorieAdjust(a => Math.min(a + 50, 500))}
                    >
                      <Text style={styles.calAdjustBtnText}>+50</Text>
                    </TouchableOpacity>
                  </View>
                  {calorieAdjust !== 0 && (
                    <TouchableOpacity onPress={() => setCalorieAdjust(0)} style={styles.resetBtn}>
                      <Text style={styles.resetBtnText}>Reset to plan</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Today's meals ── */}
        <Card style={styles.card}>
          <CardHeader>
            <View style={styles.cardHeaderRow}>
              <CardTitle>Today's Meals</CardTitle>
              {loadingMeals && <ActivityIndicator size="small" color={colors.primary} />}
            </View>
          </CardHeader>
          <CardContent style={styles.mealsContent}>
            {todayMeals.length === 0 ? (
              <View style={styles.mealsEmpty}>
                <Ionicons name="restaurant-outline" size={28} color={colors.mutedForeground} />
                <Text style={styles.mealsEmptyText}>No meals logged yet today</Text>
                <TouchableOpacity
                  style={styles.mealsEmptyBtn}
                  onPress={() => { setPrefillMeal(null); setLogModalVisible(true); }}
                >
                  <Text style={styles.mealsEmptyBtnText}>+ Log your first meal</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.mealsList}>
                {todayMeals.map((meal, i) => (
                  <View key={meal.id ?? i} style={styles.mealRow}>
                    <View style={styles.mealRowLeft}>
                      <View style={[styles.mealTypeDot, { backgroundColor: mealTypeColor(meal.mealType) }]} />
                      <View style={styles.mealRowInfo}>
                        <Text style={styles.mealRowName}>{meal.name}</Text>
                        <Text style={styles.mealRowMeta}>
                          {meal.mealType ?? 'meal'}{meal.calories > 0 ? ` · ${Math.round(meal.calories)} kcal` : ''}
                          {meal.proteinG > 0 ? ` · ${Math.round(meal.proteinG)}g P` : ''}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => handleDeleteMeal(meal.id)} style={styles.mealDeleteBtn}>
                      <Ionicons name="trash-outline" size={14} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </CardContent>
        </Card>

        {/* ── Body Weight Tracking ── */}
        <Card style={styles.card}>
          <CardHeader>
            <CardTitle>Body Weight</CardTitle>
          </CardHeader>
          <CardContent style={styles.bwContent}>
            <View style={styles.bwLogRow}>
              <TextInput
                style={styles.bwInput}
                placeholder="Enter weight (lbs)"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
                value={bwInput}
                onChangeText={setBwInput}
                inputAccessoryViewID={KEYBOARD_DONE_ID}
              />
              <TouchableOpacity
                style={[styles.bwLogBtn, savingBw && { opacity: 0.6 }]}
                onPress={handleLogBodyWeight}
                disabled={savingBw}
              >
                {savingBw ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.bwLogBtnText}>Log</Text>}
              </TouchableOpacity>
            </View>

            {bwLoading ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: spacing.sm }} />
            ) : bwLogs.length === 0 ? (
              <Text style={styles.bwEmptyText}>No weight entries yet. Log daily to track progress.</Text>
            ) : (
              <>
                <WeightChart entries={bwLogs} />

                {weeklyChangeLbsForChart !== null && weeklyChangeLbsForChart !== 0 && weeksToEnd > 0 && (
                  <>
                    <Text style={styles.bwSectionLabel}>WEIGHT PROJECTION</Text>
                    <WeightProjectionChart
                      entries={bwLogs}
                      weeklyChangeLbs={weeklyChangeLbsForChart}
                      totalWeeks={weeksForChart}
                      currentWeek={currentWeekForChart}
                    />
                  </>
                )}

                {targetWeightLbs !== null && (
                  <View style={styles.bwProjectionRow}>
                    <Ionicons name="flag-outline" size={13} color={colors.primary} />
                    <Text style={styles.bwProjectionText}>
                      Target by program end: <Text style={styles.bwProjectionVal}>{targetWeightLbs.toFixed(1)} lbs</Text>
                    </Text>
                  </View>
                )}

                <Text style={styles.bwSectionLabel}>RECENT ENTRIES</Text>
                <View style={styles.bwTable}>
                  <View style={[styles.bwTableRow, styles.bwTableHeader]}>
                    <Text style={[styles.bwTableCell, styles.bwTableHeaderText, { flex: 1.2 }]}>Date</Text>
                    <Text style={[styles.bwTableCell, styles.bwTableHeaderText, { flex: 1.2, textAlign: 'right' }]}>Weight (lbs)</Text>
                    <Text style={[styles.bwTableCell, styles.bwTableHeaderText, { flex: 0.8, textAlign: 'right' }]}>Change</Text>
                  </View>
                  {bwLogs.slice(0, 7).map((entry, idx) => {
                    const w = entry.weightLbs ?? entry.weightKg ?? 0;
                    const prev = bwLogs[idx + 1];
                    const delta = prev ? w - (prev.weightLbs ?? prev.weightKg ?? 0) : null;
                    const deltaStr = delta === null ? '—' : delta === 0 ? '±0' : delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
                    const deltaColor = delta === null || delta === 0 ? colors.mutedForeground : delta > 0 ? colors.destructive : colors.success;
                    const dateStr = new Date((entry.date || entry.createdAt || '') + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    return (
                      <View key={entry.id ?? idx} style={[styles.bwTableRow, idx % 2 === 0 ? styles.bwTableRowEven : {}]}>
                        <Text style={[styles.bwTableCell, { flex: 1.2 }]}>{dateStr}</Text>
                        <Text style={[styles.bwTableCell, { flex: 1.2, textAlign: 'right', color: colors.foreground, fontWeight: fontWeight.medium }]}>{w.toFixed(1)}</Text>
                        <Text style={[styles.bwTableCell, { flex: 0.8, textAlign: 'right', color: deltaColor }]}>{deltaStr}</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Meal suggestions ── */}
        <Button fullWidth variant="outline" onPress={handleGetMealSuggestions} loading={mealLoading} disabled={mealLoading}>
          View Meal Suggestions
        </Button>
      </ScrollView>

      {/* ── Meal Log Modal ── */}
      <MealLogModal
        visible={logModalVisible}
        onClose={() => setLogModalVisible(false)}
        onSaved={async () => { setLogModalVisible(false); await clearCache(mealCacheKey); loadMealData(true); }}
        prefill={prefillMeal}
        date={todayStr()}
      />

      {/* ── Meal suggestions modal ── */}
      <Modal
        visible={mealModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMealModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setMealModalVisible(false)}>
          <View style={styles.modalSpacer} />
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Meal Suggestions</Text>
            <Text style={styles.modalSubtitle}>{mealSuggestions.length} meals matched to your macros</Text>

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {mealSuggestions.map((meal: any, i: number) => (
                <View key={i} style={styles.mealCard}>
                  <View style={styles.mealCardHeader}>
                    <Text style={styles.mealName}>{meal.name || `Meal ${i + 1}`}</Text>
                    {meal.mealType ? (
                      <View style={styles.mealTypeBadge}>
                        <Text style={styles.mealTypeText}>{meal.mealType}</Text>
                      </View>
                    ) : null}
                  </View>
                  {meal.description ? <Text style={styles.mealDesc}>{meal.description}</Text> : null}
                  {meal.macros ? (
                    <View style={styles.mealMacroRow}>
                      {meal.macros.proteinG != null && (
                        <View style={[styles.macroPill, { backgroundColor: '#3b82f620' }]}>
                          <Text style={[styles.macroPillText, { color: '#3b82f6' }]}>{meal.macros.proteinG}g P</Text>
                        </View>
                      )}
                      {meal.macros.carbsG != null && (
                        <View style={[styles.macroPill, { backgroundColor: '#f59e0b20' }]}>
                          <Text style={[styles.macroPillText, { color: '#f59e0b' }]}>{meal.macros.carbsG}g C</Text>
                        </View>
                      )}
                      {meal.macros.fatG != null && (
                        <View style={[styles.macroPill, { backgroundColor: '#ec489920' }]}>
                          <Text style={[styles.macroPillText, { color: '#ec4899' }]}>{meal.macros.fatG}g F</Text>
                        </View>
                      )}
                      {meal.macros.calories != null && (
                        <View style={[styles.macroPill, { backgroundColor: '#6366f120' }]}>
                          <Text style={[styles.macroPillText, { color: '#6366f1' }]}>{meal.macros.calories} cal</Text>
                        </View>
                      )}
                    </View>
                  ) : null}
                  {meal.prepMinutes != null && (
                    <Text style={styles.mealPrepTime}>{meal.prepMinutes} min prep</Text>
                  )}
                  {/* Log this meal button */}
                  <TouchableOpacity
                    style={styles.logThisMealBtn}
                    onPress={() => {
                      setMealModalVisible(false);
                      setPrefillMeal({
                        name: meal.name,
                        mealType: meal.mealType,
                        calories: meal.macros?.calories,
                        proteinG: meal.macros?.proteinG,
                        carbsG: meal.macros?.carbsG,
                        fatG: meal.macros?.fatG,
                      });
                      setLogModalVisible(true);
                    }}
                  >
                    <Ionicons name="add-circle-outline" size={13} color={colors.primary} />
                    <Text style={styles.logThisMealText}>Log this meal</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            <Pressable style={styles.closeBtnPill} onPress={() => setMealModalVisible(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function mealTypeColor(type: string) {
  switch (type) {
    case 'breakfast': return '#f59e0b';
    case 'lunch': return '#22c55e';
    case 'dinner': return '#6366f1';
    case 'snack': return '#ec4899';
    default: return colors.mutedForeground;
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  card: {},

  // Empty state
  emptyContent: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  emptyDesc: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center', lineHeight: 20 },
  generateBtn: { marginTop: spacing.xs },
  planErrorText: { fontSize: fontSize.sm, color: '#ef4444', textAlign: 'center', marginTop: spacing.sm },

  // Card header row
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  logBtnText: { fontSize: 11, color: colors.primary, fontWeight: fontWeight.medium },

  // Calorie progress
  calContent: { gap: spacing.sm, paddingTop: 0 },
  calRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  calMain: { flexDirection: 'row', alignItems: 'baseline' },
  calLogged: { fontSize: 28, fontWeight: fontWeight.bold, color: colors.primary },
  calSlash: { fontSize: 18, color: colors.mutedForeground },
  calTarget: { fontSize: 18, fontWeight: fontWeight.semibold, color: colors.foreground },
  calUnit: { fontSize: fontSize.sm, color: colors.mutedForeground },
  calRemaining: { fontSize: fontSize.xs, color: colors.mutedForeground },

  // Progress bar
  progressTrack: {
    borderRadius: radius.full,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressBar: { height: '100%', borderRadius: radius.full },

  // Macro grid
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: 0 },
  macroCard: {
    width: '47%',
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 2,
  },
  macroIndicator: { width: 24, height: 3, borderRadius: radius.full, marginBottom: 4 },
  macroCardLabel: {
    fontSize: 10, color: colors.mutedForeground,
    fontWeight: fontWeight.medium, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  macroGrams: { fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  macroUnit: { fontSize: fontSize.sm, fontWeight: fontWeight.normal },
  macroTarget: { fontSize: 10, color: colors.mutedForeground },

  // Today's meals list
  mealsContent: { paddingTop: 0 },
  mealsEmpty: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.xs },
  mealsEmptyText: { fontSize: fontSize.sm, color: colors.mutedForeground },
  mealsEmptyBtn: { marginTop: spacing.xs },
  mealsEmptyBtnText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: fontWeight.medium },
  mealsList: { gap: spacing.xs },
  mealRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  mealRowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  mealTypeDot: { width: 8, height: 8, borderRadius: 4 },
  mealRowInfo: { flex: 1 },
  mealRowName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground },
  mealRowMeta: { fontSize: fontSize.xs, color: colors.mutedForeground, textTransform: 'capitalize' },
  mealDeleteBtn: { padding: 6 },

  // Meal suggestions modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSpacer: { flex: 1 },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
    height: MEAL_SHEET_HEIGHT,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  modalSubtitle: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2, marginBottom: spacing.sm },
  modalScroll: { flex: 1, minHeight: 0 },
  modalScrollContent: { gap: spacing.sm, paddingBottom: spacing.md },
  mealCard: { backgroundColor: colors.muted, borderRadius: radius.lg, padding: spacing.sm, gap: 6 },
  mealCardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.xs },
  mealName: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  mealTypeBadge: { backgroundColor: `${colors.primary}20`, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  mealTypeText: { fontSize: 10, color: colors.primary, fontWeight: fontWeight.semibold, textTransform: 'capitalize' },
  mealDesc: { fontSize: fontSize.xs, color: colors.mutedForeground, lineHeight: 17 },
  mealMacroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  macroPill: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  macroPillText: { fontSize: 10, fontWeight: fontWeight.semibold },
  mealPrepTime: { fontSize: 10, color: colors.mutedForeground },
  logThisMealBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingTop: 4,
    borderTopWidth: 1, borderTopColor: colors.border,
    marginTop: 2,
  },
  logThisMealText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.medium },
  closeBtnPill: {
    backgroundColor: colors.foreground, borderRadius: radius.xl,
    paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm,
  },
  closeBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.primaryForeground },

  // Projection card
  projContent: { paddingTop: 0, gap: spacing.sm },
  projRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  projLabel: { fontSize: fontSize.sm, color: colors.mutedForeground, flex: 1 },
  projValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  calAdjustSection: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.xs },
  calAdjustLabel: { fontSize: fontSize.xs, color: colors.mutedForeground, fontWeight: fontWeight.medium, textTransform: 'uppercase', letterSpacing: 0.5 },
  calAdjustRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  calAdjustBtn: {
    backgroundColor: colors.muted, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 8,
  },
  calAdjustBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  calAdjustDisplay: { flex: 1, alignItems: 'center' },
  calAdjustDisplayVal: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  calAdjustDiff: { fontSize: 10, fontWeight: fontWeight.medium },
  resetBtn: { alignSelf: 'center' },
  resetBtnText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.medium },

  // Body weight
  bwContent: { gap: spacing.sm },
  bwLogRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  bwInput: {
    flex: 1, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 9,
    fontSize: fontSize.sm, color: colors.foreground,
  },
  bwLogBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10, minWidth: 52, alignItems: 'center',
  },
  bwLogBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: '#fff' },
  bwProjectionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: `${colors.primary}08`, borderRadius: radius.md, padding: spacing.sm,
  },
  bwProjectionText: { fontSize: fontSize.xs, color: colors.mutedForeground, flex: 1 },
  bwProjectionVal: { fontWeight: fontWeight.semibold, color: colors.foreground },
  bwHistoryLabel: {
    fontSize: 10, fontWeight: fontWeight.bold, color: colors.mutedForeground, letterSpacing: 0.8,
  },
  bwEntry: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  bwEntryBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  bwEntryDate: { fontSize: fontSize.sm, color: colors.mutedForeground },
  bwEntryVal: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  bwEmptyText: { fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: 'center', paddingVertical: spacing.sm },
  bwSectionLabel: { fontSize: 10, fontWeight: fontWeight.bold, color: colors.mutedForeground, letterSpacing: 0.8, marginTop: spacing.sm, marginBottom: 4 },
  bwTable: { borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  bwTableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  bwTableRowEven: { backgroundColor: `${colors.muted}60` },
  bwTableHeader: { backgroundColor: colors.muted, borderBottomWidth: 1, borderBottomColor: colors.border },
  bwTableHeaderText: { fontWeight: fontWeight.semibold, color: colors.mutedForeground, fontSize: fontSize.xs, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  bwTableCell: { fontSize: fontSize.sm, color: colors.mutedForeground, flex: 1 },

  // Describe-a-meal card
  descCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  descCardLabel: {
    fontSize: 10, fontWeight: fontWeight.bold, color: colors.mutedForeground, letterSpacing: 0.8,
  },
  descCardContent: { gap: spacing.sm },
  descInputRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  descInput: {
    flex: 1, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 9,
    fontSize: fontSize.sm, color: colors.foreground,
  },
  descBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10, alignItems: 'center', justifyContent: 'center',
  },
  descBtnDisabled: { opacity: 0.4 },
  descBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: '#fff' },

  // Parsed meal result
  parsedCard: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    padding: spacing.sm, gap: spacing.sm, backgroundColor: colors.muted,
  },
  parsedHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  parsedName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  parsedNotes: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 1 },
  confidenceBadge: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  confidenceText: { fontSize: 10, fontWeight: fontWeight.bold },
  parsedMacros: { flexDirection: 'row', gap: 6 },
  parsedMacroTile: {
    flex: 1, borderWidth: 1, borderRadius: radius.md, padding: 6,
    alignItems: 'center', backgroundColor: colors.background,
  },
  parsedMacroLabel: { fontSize: 9, color: colors.mutedForeground, marginBottom: 2 },
  parsedMacroVal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  addToLogBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, backgroundColor: colors.primary,
    borderRadius: radius.md, paddingVertical: 10,
  },
  addToLogBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: '#fff' },
  aiVisionBadge: { marginLeft: 'auto', backgroundColor: `${colors.primary}18`, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  aiVisionText: { fontSize: 9, fontWeight: fontWeight.semibold, color: colors.primary },
  scanBtnRow: { flexDirection: 'row', gap: spacing.sm },
  scanActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: `${colors.primary}12`, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.lg, paddingVertical: 16 },
  scanActionBtnSecondary: { backgroundColor: colors.muted, borderColor: colors.border },
  scanActionBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.primary },
  scanningBox: { height: 180, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.muted },
  photoPreview: { width: '100%', height: '100%' },
  scanningOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  scanningText: { color: '#fff', fontSize: fontSize.sm, fontWeight: fontWeight.medium },
});
