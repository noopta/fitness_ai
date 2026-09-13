// Keyword parser that turns free-text interview answers into the engine's
// SessionFlags. Shared by the legacy wizard chat (routes/sessions.ts) and the
// conversational diagnostic's "Type instead" answers.

// Parse conversational text into structured SessionFlags for the diagnostic engine.
// Patterns are order-independent — keyword proximity matters, not word order.
export function parseSessionFlags(text: string): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  const t = text.toLowerCase();

  // ── hard_off_floor ─────────────────────────────────────────────────────────
  // Catches: "hard off the floor", "off the floor is hard", "struggle off the floor",
  //          "hardest off the floor", "hard to get off the floor", "hard from the floor",
  //          "hard at the start", "hardest at the start", "hard leaving the ground"
  if (
    /hard.{0,25}(off|from|at|on).{0,15}(floor|ground|start|bottom)/i.test(t) ||
    /(off|from).{0,15}(floor|ground).{0,25}(hard|difficult|struggle|tough)/i.test(t) ||
    /(floor|ground|start|initial).{0,25}(hard|difficult|struggle|tough|worst|hardest)/i.test(t) ||
    /(struggle|difficult|tough|hardest|worst).{0,30}(floor|ground|off|start|initial.pull)/i.test(t) ||
    /\b(off the floor|off the ground|from the floor|from the ground)\b.{0,30}(hard|difficult|struggle|issue|problem)/i.test(t) ||
    /(hard|difficult|struggle|issue|problem).{0,30}\b(off the floor|off the ground|from the floor)\b/i.test(t)
  ) flags.hard_off_floor = true;

  // ── hard_off_chest (bench/press specific) ──────────────────────────────────
  if (
    /hard.{0,20}(off|from|at|on).{0,10}(chest|bottom|start)/i.test(t) ||
    /(chest|bottom).{0,20}(hard|difficult|struggle|tough|worst)/i.test(t) ||
    /(struggle|difficult|tough).{0,20}(chest|bottom|off chest)/i.test(t)
  ) flags.hard_off_chest = true;

  // ── hard_mid_range ─────────────────────────────────────────────────────────
  if (
    /hard.{0,20}(mid|middle|halfway|half.?way)/i.test(t) ||
    /(mid|middle|halfway).{0,20}(hard|difficult|struggle|sticking|stall)/i.test(t) ||
    /sticking.{0,15}point.{0,20}(mid|middle|halfway)/i.test(t)
  ) flags.hard_mid_range = true;

  // ── hard_at_lockout ────────────────────────────────────────────────────────
  if (
    /(hard|fail|struggle|difficult).{0,20}lock(out|ing)/i.test(t) ||
    /lock(out|ing).{0,20}(hard|fail|struggle|difficult|weak)/i.test(t) ||
    /can.t.{0,10}lock(out| it| them)/i.test(t)
  ) flags.hard_at_lockout = true;

  // ── hips_shoot_up ──────────────────────────────────────────────────────────
  if (
    /hip.{0,15}shoot/i.test(t) ||
    /hips.{0,10}(rise|come up|go up|shoot|high|pop)/i.test(t) ||
    /(hips|butt|posterior).{0,20}(rise|shoot|come up|go up|first|before)/i.test(t)
  ) flags.hips_shoot_up = true;

  // ── back_rounds ────────────────────────────────────────────────────────────
  if (
    /back.{0,15}round/i.test(t) ||
    /round.{0,15}back/i.test(t) ||
    /spine.{0,15}(round|flex|bend|lose)/i.test(t) ||
    /(lose|losing|lost).{0,15}(back|spinal).{0,10}(position|neutral|flat)/i.test(t)
  ) flags.back_rounds = true;

  // ── bar_drifts / bar_drifts_forward ────────────────────────────────────────
  if (/bar.{0,15}drift/i.test(t)) flags.bar_drifts = true;
  if (/bar.{0,15}(drift|move|shift|swing).{0,15}forward/i.test(t) ||
      /bar.{0,15}(away|out|forward).{0,15}(body|legs|me)/i.test(t)) flags.bar_drifts_forward = true;

  // ── tension loss (new) — maps to hard_off_floor for deadlift / setup issues
  // "hard to maintain tension", "lose tension", "can't keep tension", "tension breaks"
  if (
    /(maintain|keep|hold|create).{0,20}tension/i.test(t) ||
    /tension.{0,20}(hard|difficult|issue|problem|lose|lost|breaks|gone)/i.test(t) ||
    /(lose|losing|lost|break|breaking).{0,20}tension/i.test(t) ||
    /can.t.{0,20}(maintain|keep|hold|create|get).{0,20}tension/i.test(t)
  ) {
    // Tension issues on deadlift → setup/initial pull problem
    flags.hard_off_floor = true;
  }

  // ── feel_lower_back ────────────────────────────────────────────────────────
  if (
    /lower back.{0,20}(pain|sore|tight|feel|strain|stress|work|pump)/i.test(t) ||
    /(feel|feeling|feel it).{0,20}lower back/i.test(t)
  ) flags.feel_lower_back = true;

  // ── elbows_flare_early ─────────────────────────────────────────────────────
  if (
    /chest.{0,15}drop/i.test(t) ||
    /elbows.{0,15}(flare|out|wide|up)/i.test(t) ||
    /(flare|flaring).{0,15}elbow/i.test(t)
  ) flags.elbows_flare_early = true;

  // ── shoulder_discomfort ────────────────────────────────────────────────────
  if (/shoulder.{0,15}(pain|discomfort|hurt|ache|issue)/i.test(t)) flags.shoulder_discomfort = true;

  // ── mobility_restriction ───────────────────────────────────────────────────
  if (/mobility.{0,15}(issue|problem|limit|restrict)/i.test(t) ||
      /(tight|stiff).{0,15}(hip|ankle|shoulder|wrist)/i.test(t)) flags.mobility_restriction = true;

  // ── grip_limiting ──────────────────────────────────────────────────────────
  if (/grip.{0,15}(limit|fail|slip|weak|issue|problem)/i.test(t) ||
      /(hand|hands|wrist).{0,15}(slip|fail|weak|give)/i.test(t)) flags.grip_limiting = true;

  // ── pause_much_harder ──────────────────────────────────────────────────────
  if (/pause.{0,20}(harder|much harder|worse|difficult)/i.test(t)) flags.pause_much_harder = true;

  // ── touch_point_inconsistent ───────────────────────────────────────────────
  if (/touch.{0,20}(inconsistent|vary|different|spot|point)/i.test(t)) flags.touch_point_inconsistent = true;

  return flags;
}
