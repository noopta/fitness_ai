import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Plus, Trash2, Dumbbell, ChevronDown, ChevronUp,
  Clock, Calendar, CheckCircle2, X, Save, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface WorkoutExercise {
  name: string;
  sets: number;
  reps: string;
  weightKg: number | null;
  rpe: number | null;
  notes: string | null;
}

interface WorkoutLog {
  id: string;
  date: string;
  title: string | null;
  exercises: WorkoutExercise[];
  notes: string | null;
  duration: number | null;
  createdAt: string;
}

const EMPTY_EXERCISE: WorkoutExercise = {
  name: '',
  sets: 3,
  reps: '8',
  weightKg: null,
  rpe: null,
  notes: null,
};

function todayStr() {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function groupByDate(logs: WorkoutLog[]): Array<{ date: string; logs: WorkoutLog[] }> {
  const map = new Map<string, WorkoutLog[]>();
  for (const log of logs) {
    const existing = map.get(log.date) || [];
    existing.push(log);
    map.set(log.date, existing);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, logs]) => ({ date, logs }));
}

// ─── Exercise row in the log form ────────────────────────────────────────────
function ExerciseRow({
  ex,
  index,
  onChange,
  onRemove,
}: {
  ex: WorkoutExercise;
  index: number;
  onChange: (updated: WorkoutExercise) => void;
  onRemove: () => void;
}) {
  const [showNotes, setShowNotes] = useState(false);

  function update(field: keyof WorkoutExercise, value: any) {
    onChange({ ...ex, [field]: value });
  }

  return (
    <div className="rounded-xl border bg-muted/30 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-muted-foreground w-5 shrink-0">{index + 1}.</span>
        <input
          type="text"
          placeholder="Exercise name (e.g. Bench Press)"
          value={ex.name}
          onChange={e => update('name', e.target.value)}
          className="flex-1 min-w-0 bg-transparent text-sm font-medium placeholder:text-muted-foreground/60 outline-none border-b border-border/50 pb-0.5 focus:border-primary transition-colors"
        />
        <button onClick={onRemove} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-1">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Sets</label>
          <input
            type="number"
            min="1"
            max="20"
            value={ex.sets}
            onChange={e => update('sets', parseInt(e.target.value) || 1)}
            className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm text-center outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Reps</label>
          <input
            type="text"
            placeholder="8 or 6-8"
            value={ex.reps}
            onChange={e => update('reps', e.target.value)}
            className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm text-center outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Weight (lbs)</label>
          <input
            type="number"
            min="0"
            step="2.5"
            placeholder="—"
            value={ex.weightKg ?? ''}
            onChange={e => update('weightKg', e.target.value === '' ? null : parseFloat(e.target.value))}
            className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm text-center outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">RPE (1-10)</label>
          <input
            type="number"
            min="1"
            max="10"
            step="0.5"
            placeholder="—"
            value={ex.rpe ?? ''}
            onChange={e => update('rpe', e.target.value === '' ? null : parseFloat(e.target.value))}
            className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm text-center outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <button
        onClick={() => setShowNotes(v => !v)}
        className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
      >
        {showNotes ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {showNotes ? 'Hide' : 'Add'} notes
      </button>

      {showNotes && (
        <textarea
          rows={2}
          placeholder="Notes (form cues, how it felt, injuries...)"
          value={ex.notes ?? ''}
          onChange={e => update('notes', e.target.value || null)}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 outline-none focus:ring-1 focus:ring-primary resize-none"
        />
      )}
    </div>
  );
}

// ─── Log form (today's session) ───────────────────────────────────────────────
function WorkoutForm({ onSaved }: { onSaved: (log: WorkoutLog) => void }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayStr());
  const [exercises, setExercises] = useState<WorkoutExercise[]>([{ ...EMPTY_EXERCISE }]);
  const [notes, setNotes] = useState('');
  const [duration, setDuration] = useState('');
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(true);

  function addExercise() {
    setExercises(prev => [...prev, { ...EMPTY_EXERCISE }]);
  }

  function updateExercise(i: number, updated: WorkoutExercise) {
    setExercises(prev => prev.map((ex, idx) => idx === i ? updated : ex));
  }

  function removeExercise(i: number) {
    setExercises(prev => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    const validExercises = exercises.filter(ex => ex.name.trim() && ex.reps.trim());
    if (validExercises.length === 0) {
      toast.error('Add at least one exercise with a name and reps.');
      return;
    }

    setSaving(true);
    try {
      const res = await authFetch(`${API_BASE}/workouts`, {
        method: 'POST',
        body: JSON.stringify({
          date,
          title: title.trim() || null,
          exercises: validExercises,
          notes: notes.trim() || null,
          duration: duration ? parseInt(duration) : null,
        }),
      });

      if (!res.ok) throw new Error('Save failed');
      const log: WorkoutLog = await res.json();
      toast.success('Workout logged!');
      onSaved(log);
      // Reset form
      setTitle('');
      setExercises([{ ...EMPTY_EXERCISE }]);
      setNotes('');
      setDuration('');
      setOpen(false);
    } catch {
      toast.error('Failed to save workout. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10">
            <Plus className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm">Log Today's Workout</p>
            <p className="text-xs text-muted-foreground">Track your sets, reps, and weights</p>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-4 border-t">
              {/* Title + date + duration */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4">
                <div className="sm:col-span-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Session Title</label>
                  <input
                    type="text"
                    placeholder="Push Day, Leg Day, etc."
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Duration (min)</label>
                  <input
                    type="number"
                    min="1"
                    max="600"
                    placeholder="60"
                    value={duration}
                    onChange={e => setDuration(e.target.value)}
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Exercises */}
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Exercises</p>
                <div className="space-y-2">
                  {exercises.map((ex, i) => (
                    <ExerciseRow
                      key={i}
                      ex={ex}
                      index={i}
                      onChange={updated => updateExercise(i, updated)}
                      onRemove={() => removeExercise(i)}
                    />
                  ))}
                </div>
                <button
                  onClick={addExercise}
                  className="mt-2 flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" /> Add exercise
                </button>
              </div>

              {/* Session notes */}
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Session Notes</label>
                <textarea
                  rows={2}
                  placeholder="How did the session feel? Any PRs, injuries, or observations..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full rounded-xl border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>

              <Button onClick={save} disabled={saving} className="w-full sm:w-auto rounded-xl">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save Workout
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ─── Workout history card ─────────────────────────────────────────────────────
function WorkoutCard({ log, onDelete }: { log: WorkoutLog; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm('Delete this workout log?')) return;
    setDeleting(true);
    try {
      const res = await authFetch(`${API_BASE}/workouts/${log.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      onDelete(log.id);
      toast.success('Workout deleted.');
    } catch {
      toast.error('Failed to delete.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-xl border bg-background overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Dumbbell className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{log.title || 'Workout Session'}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground">{log.exercises.length} exercises</span>
              {log.duration && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" /> {log.duration}min
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {expanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />
          }
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-t"
          >
            <div className="px-4 py-3 space-y-2">
              {log.exercises.map((ex, i) => (
                <div key={i} className="flex items-start justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{ex.name}</p>
                    {ex.notes && <p className="text-xs text-muted-foreground mt-0.5">{ex.notes}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1 shrink-0 justify-end">
                    <Badge variant="secondary" className="text-[10px]">{ex.sets}×{ex.reps}</Badge>
                    {ex.weightKg != null && (
                      <Badge variant="outline" className="text-[10px]">{ex.weightKg} lbs</Badge>
                    )}
                    {ex.rpe != null && (
                      <Badge variant="outline" className="text-[10px]">RPE {ex.rpe}</Badge>
                    )}
                  </div>
                </div>
              ))}
              {log.notes && (
                <p className="text-xs text-muted-foreground px-1 pt-1">{log.notes}</p>
              )}
              <div className="pt-1">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-xs text-destructive hover:underline flex items-center gap-1 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                  {deleting ? 'Deleting…' : 'Delete log'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function WorkoutsPage() {
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch(`${API_BASE}/workouts`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setLogs(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleSaved(log: WorkoutLog) {
    setLogs(prev => [log, ...prev]);
  }

  function handleDelete(id: string) {
    setLogs(prev => prev.filter(l => l.id !== id));
  }

  const grouped = groupByDate(logs);

  return (
    <div className="min-h-screen bg-background">
      <Navbar variant="full" />
      <main className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Workout Log</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track your sets, reps, and weights. This feeds into your strength profile.
          </p>
        </div>

        {/* Log form */}
        <WorkoutForm onSaved={handleSaved} />

        {/* History */}
        <div>
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-widest mb-3">History</h2>

          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {!loading && logs.length === 0 && (
            <Card className="p-8 flex flex-col items-center gap-3 text-center text-muted-foreground">
              <Dumbbell className="h-8 w-8 opacity-40" />
              <p className="text-sm">No workouts logged yet.</p>
              <p className="text-xs opacity-70">Log your first session above to start tracking your progress.</p>
            </Card>
          )}

          {!loading && grouped.length > 0 && (
            <div className="space-y-4">
              {grouped.map(({ date, logs: dayLogs }) => (
                <div key={date}>
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground">{formatDate(date)}</span>
                    <span className="text-xs text-muted-foreground opacity-60">· {date}</span>
                  </div>
                  <div className="space-y-2">
                    {dayLogs.map(log => (
                      <WorkoutCard key={log.id} log={log} onDelete={handleDelete} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
