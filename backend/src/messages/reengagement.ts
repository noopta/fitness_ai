// ─── Re-engagement & Encouragement Message Pools ──────────────────────────────
// Placeholders: {{name}} {{days}} {{food}} {{calories}}
//
// Tone: warm, supportive, motivating — the voice of a coach who's in your
// corner. No shame, no sarcasm, no crude humour. Beginners and casual users
// should feel welcomed back, never judged. Every message frames the next
// action as easy and worthwhile, and treats any gap as normal.

export interface MessageTemplate {
  title: string;
  body: string;
}

type Tier = 'early' | 'mid' | 'late';

function tier(days: number): Tier {
  if (days <= 4) return 'early';
  if (days <= 7) return 'mid';
  return 'late';
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fill(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v)),
    template,
  );
}

// ─── Workout Miss ──────────────────────────────────────────────────────────────

const WORKOUT_EARLY: MessageTemplate[] = [
  {
    title: 'Ready when you are 💪',
    body: "It's been {{days}} days, {{name}}. A short session today is a great way to keep your momentum going.",
  },
  {
    title: 'Your next workout is waiting',
    body: "{{days}} days since your last log. Even 20 minutes counts — Anakin has your plan ready when you are.",
  },
  {
    title: "Let's pick it back up, {{name}}",
    body: "A {{days}}-day breather is completely fine. Today's a great day to log your next session.",
  },
  {
    title: 'Small steps add up',
    body: "It's been {{days}} days. One workout today keeps you moving toward your goal — you've got this.",
  },
  {
    title: "Anakin's got your plan ready",
    body: "{{days}} days out, {{name}}. Whenever you're ready, your next session is just one tap away.",
  },
];

const WORKOUT_MID: MessageTemplate[] = [
  {
    title: 'A fresh start today',
    body: "{{days}} days since your last workout, {{name}}. No pressure — pick one movement and log it. That's all it takes.",
  },
  {
    title: 'Consistency beats perfection',
    body: "It's been {{days}} days. Getting back in today matters far more than the gap before it.",
  },
  {
    title: 'Your goals are still in reach',
    body: "{{days}} days off won't undo your progress, {{name}}. A session today gets you right back on track.",
  },
];

const WORKOUT_LATE: MessageTemplate[] = [
  {
    title: "We'd love to see you back",
    body: "It's been {{days}} days, {{name}}. Whenever you're ready, today is a perfect day to start again.",
  },
  {
    title: 'Every comeback starts with one',
    body: "{{days}} days away. One workout today and you're moving forward again — Anakin's ready to help.",
  },
  {
    title: 'No judgment, just support',
    body: "Life gets busy, {{name}}. Your plan is still here, and a fresh start is always one session away.",
  },
];

// ─── Nutrition Miss ────────────────────────────────────────────────────────────

const NUTRITION_EARLY: MessageTemplate[] = [
  {
    title: 'Quick meal log?',
    body: "It's been {{days}} days, {{name}}. Logging today helps Anakin keep your nutrition guidance on point.",
  },
  {
    title: 'Stay in the loop',
    body: "{{days}} days without a food log. A couple of quick entries today keeps your macros accurate.",
  },
  {
    title: 'Small habit, big results',
    body: "Logging meals takes a minute and really pays off, {{name}}. It's been {{days}} days — jump back in.",
  },
  {
    title: 'Anakin wants to help',
    body: "{{days}} days of meals untracked. Log today and Anakin can fine-tune your nutrition guidance.",
  },
  {
    title: "You're doing great — keep logging",
    body: "It's been {{days}} days, {{name}}. A quick meal log today keeps your progress moving.",
  },
];

const NUTRITION_MID: MessageTemplate[] = [
  {
    title: "Let's get your macros back on track",
    body: "{{days}} days without food logs, {{name}}. A few quick entries today and you're right back in rhythm.",
  },
  {
    title: 'Your protein goal is waiting',
    body: "It's been {{days}} days. Logging today helps you hit your protein target and recover stronger.",
  },
  {
    title: 'One meal at a time',
    body: "{{days}} days off, {{name}}. No need to catch up — just log your next meal and keep going.",
  },
];

const NUTRITION_LATE: MessageTemplate[] = [
  {
    title: 'A fresh start with your nutrition',
    body: "It's been {{days}} days, {{name}}. Log one meal today and Anakin can pick things right back up.",
  },
  {
    title: 'Nutrition is half your progress',
    body: "{{days}} days without logs. Whenever you're ready, a quick entry gets you back on track.",
  },
  {
    title: "We're here when you're ready",
    body: "{{days}} days, {{name}}. No pressure at all — just log your next meal and keep building.",
  },
];

// ─── General Inactivity (no app activity at all) ───────────────────────────────

const INACTIVITY_EARLY: MessageTemplate[] = [
  {
    title: "We're here when you're ready",
    body: "{{name}}, it's been {{days}} days. Pop back in whenever — your plan and progress are waiting for you.",
  },
  {
    title: 'Your progress is saved',
    body: "{{days}} days away. Everything's right where you left it, {{name}}. Come say hi whenever you like.",
  },
  {
    title: 'A quick check-in?',
    body: "It's been {{days}} days. Even a minute in the app keeps you connected to your goals, {{name}}.",
  },
  {
    title: "Anakin's still in your corner",
    body: "{{days}} days out, {{name}}. Whenever you're ready, we're ready to help you keep going.",
  },
];

const INACTIVITY_MID: MessageTemplate[] = [
  {
    title: 'Let\'s pick up where you left off',
    body: "{{days}} days away, {{name}}. Your plan, your progress, and Anakin are all still here for you.",
  },
  {
    title: 'Still cheering you on',
    body: "It's been {{days}} days. No pressure at all — just know your goals are still well within reach.",
  },
];

const INACTIVITY_LATE: MessageTemplate[] = [
  {
    title: 'A warm welcome back awaits',
    body: "It's been {{days}} days, {{name}}. Whenever you're ready, we'd love to help you start again.",
  },
  {
    title: "We're still here for you",
    body: "It's been {{days}} days, {{name}}. Whatever got in the way, today is a great day to begin again.",
  },
];

// ─── Junk Food (instant — fired when an indulgent item is logged) ─────────────
// Positive framing: logging an indulgence honestly is a win in itself. These
// reassure the user that one treat fits inside a balanced week — never shame.

const JUNK_FOOD_MESSAGES: MessageTemplate[] = [
  {
    title: 'Logged it — nice work 👍',
    body: "You tracked your {{food}}, and honest logging is what real progress is built on. One meal won't derail your week.",
  },
  {
    title: 'Every meal counts as data',
    body: "{{food}} logged. Tracking the treats too gives Anakin the full picture — that's how real balance happens.",
  },
  {
    title: 'Balance, not perfection',
    body: "Enjoyed a {{food}}? That's part of a sustainable approach. Log it, savour it, and carry on, {{name}}.",
  },
  {
    title: 'Honesty pays off',
    body: "You logged your {{food}} — that consistency is a win on its own. Tomorrow's a fresh page, {{name}}.",
  },
  {
    title: 'One treat, no worries',
    body: "That {{food}} ({{calories}} kcal) is logged. A single meal fits just fine inside a balanced week.",
  },
  {
    title: 'Great tracking, {{name}}',
    body: "Logging the {{food}} keeps your numbers accurate. Small, honest habits are what move the needle.",
  },
  {
    title: "You're building a real habit",
    body: "{{food}} logged. Tracking everything — treats included — is exactly how lasting change sticks.",
  },
  {
    title: 'Progress, not guilt',
    body: "You logged a {{food}}, and that's something to feel good about. Anakin's got your back, not a scoreboard.",
  },
];

// ─── Junk food keyword detection ──────────────────────────────────────────────

// High-confidence junk food keywords — specific brands/items only.
// Deliberately excludes broad terms like "chocolate", "chips", "popcorn",
// "soda" that commonly appear in healthy foods (protein bars, veggie chips,
// flavoured waters, etc). Those only fire when combined with a calorie threshold.
const JUNK_KEYWORDS_STRONG = [
  'cupcake', 'brownie', 'donut', 'doughnut',
  'candy', 'gummy', 'gummies', 'skittles', 'haribo', 'twix',
  'snickers', 'kitkat', 'kit kat', 'reese', 'oreo', 'chips ahoy', 'm&m',
  'ice cream', 'gelato', 'soft serve', 'milkshake', 'sundae',
  'cheeseburger', 'big mac', 'whopper', 'double double',
  'french fries', 'onion rings', 'fried chicken', 'chicken nuggets',
  'hot dog', 'corn dog', 'cheetos', 'doritos', 'lays', 'pringles',
  'cotton candy', 'funnel cake', 'churros',
  'mcdonalds', "mcdonald's", 'kfc', 'popeyes', "wendy's", 'taco bell',
  'burger king', 'five guys', 'cinnabon', 'krispy kreme', 'dairy queen',
  'pop tart', 'poptart', 'toaster strudel',
  'mountain dew', 'dr pepper', 'coca cola', 'pepsi', 'sprite',
  'red bull', 'monster energy',
];

// These only trigger when calories >= CALORIE_THRESHOLD_SOFT
const JUNK_KEYWORDS_SOFT = [
  'cake', 'cookie', 'cookies', 'chocolate', 'nachos', 'chips',
  'popcorn', 'pizza', 'burger', 'fries', 'soda', 'energy drink',
];

// AI-assigned tags that confidently indicate junk — only with calorie threshold
// (removed high-sugar and high-sodium alone — too many healthy foods get these)
const JUNK_TAGS_STRONG = ['deep-fried'];
const JUNK_TAGS_WITH_THRESHOLD = ['ultra-processed'];

const CALORIE_THRESHOLD_SOFT = 400; // soft keywords / tags only fire above this

export function isJunkFood(mealName: string, tags: string[], calories: number): boolean {
  const nameLower = mealName.toLowerCase();

  // Strong keywords always fire regardless of calories
  if (JUNK_KEYWORDS_STRONG.some(kw => nameLower.includes(kw))) return true;

  // Deep-fried tag always fires
  if (tags.some(t => JUNK_TAGS_STRONG.includes(t.toLowerCase()))) return true;

  // Soft keywords and tags only fire if the meal is substantial
  if (calories >= CALORIE_THRESHOLD_SOFT) {
    if (JUNK_KEYWORDS_SOFT.some(kw => nameLower.includes(kw))) return true;
    if (tags.some(t => JUNK_TAGS_WITH_THRESHOLD.includes(t.toLowerCase()))) return true;
  }

  return false;
}

// ─── Public getters ────────────────────────────────────────────────────────────

export function getWorkoutMissMessage(days: number, name: string): MessageTemplate {
  const pool = tier(days) === 'early' ? WORKOUT_EARLY : tier(days) === 'mid' ? WORKOUT_MID : WORKOUT_LATE;
  const tpl = pick(pool);
  return {
    title: fill(tpl.title, { name, days }),
    body: fill(tpl.body, { name, days }),
  };
}

export function getNutritionMissMessage(days: number, name: string): MessageTemplate {
  const pool = tier(days) === 'early' ? NUTRITION_EARLY : tier(days) === 'mid' ? NUTRITION_MID : NUTRITION_LATE;
  const tpl = pick(pool);
  return {
    title: fill(tpl.title, { name, days }),
    body: fill(tpl.body, { name, days }),
  };
}

export function getInactivityMessage(days: number, name: string): MessageTemplate {
  const pool = tier(days) === 'early' ? INACTIVITY_EARLY : tier(days) === 'mid' ? INACTIVITY_MID : INACTIVITY_LATE;
  const tpl = pick(pool);
  return {
    title: fill(tpl.title, { name, days }),
    body: fill(tpl.body, { name, days }),
  };
}

export function getJunkFoodMessage(
  foodName: string,
  calories: number,
  userName: string,
): MessageTemplate {
  const tpl = pick(JUNK_FOOD_MESSAGES);
  return {
    title: fill(tpl.title, { food: foodName, calories, name: userName }),
    body: fill(tpl.body, { food: foodName, calories, name: userName }),
  };
}
