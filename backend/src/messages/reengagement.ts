// ─── Re-engagement & Shame Message Pools ──────────────────────────────────────
// Placeholders: {{name}} {{days}} {{food}} {{calories}}

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
    title: 'The gym misses you 🏋️',
    body: "It's been {{days}} days, {{name}}. Cheating on me with an IRL trainer are you? 💔",
  },
  {
    title: "{{days}} days, {{name}}",
    body: "The bar isn't going to lift itself chief. Log something today.",
  },
  {
    title: 'Where have you been?',
    body: "Your muscles have been on vacation for {{days}} days. Time to clock back in.",
  },
  {
    title: 'Lock in, {{name}}',
    body: "Doing a whole lot of hollering about gains but it's been {{days}} days since you logged anything.",
  },
  {
    title: 'Anakin is concerned 👀',
    body: "{{days}} days of radio silence from the gym, {{name}}. You good? Tap in.",
  },
];

const WORKOUT_MID: MessageTemplate[] = [
  {
    title: 'Your pre-workout has a problem',
    body: "{{days}} days without a log. At this point your pre-workout has a best-before date problem.",
  },
  {
    title: 'Charitable donation',
    body: "Your gym membership is basically a donation right now. {{days}} days, zero logs.",
  },
  {
    title: '{{days}} days, {{name}} 😐',
    body: "The couch won't build your program. Tap in, even 20 minutes counts.",
  },
];

const WORKOUT_LATE: MessageTemplate[] = [
  {
    title: 'Not mad. Just disappointed.',
    body: "A week+ with no workout log. Not mad. Just deeply, professionally disappointed. Come back.",
  },
  {
    title: 'Are you coming back?',
    body: "{{days}} days. The gains you worked for are starting to wonder if you're coming back. Are you?",
  },
  {
    title: 'We put your gains on a milk carton',
    body: "{{days}} days offline. Your strength profile is collecting dust. Whatever happened — we're here.",
  },
];

// ─── Nutrition Miss ────────────────────────────────────────────────────────────

const NUTRITION_EARLY: MessageTemplate[] = [
  {
    title: "My 600 Lb Life casting is open 😬",
    body: "Keep skipping meal logs and you're on a shortlist. It's been {{days}} days, {{name}}. Log it.",
  },
  {
    title: 'Calories still count',
    body: "{{days}} days of mystery eating. Calories don't stop existing because you stopped counting them.",
  },
  {
    title: 'Fasting or hiding something?',
    body: "{{days}} days no food logs, {{name}}. Either you're fasting or hiding something. Which is it?",
  },
  {
    title: 'Your macros have no idea',
    body: "{{days}} days of mystery meals. Your macros have absolutely no idea what's happening right now.",
  },
  {
    title: 'Bold. Very chaotic.',
    body: "{{days}} days no nutrition logs. Bold strategy. Very chaotic. Anakin disapproves.",
  },
  {
    title: 'Don\'t be a chud, {{name}}',
    body: "{{days}} days without logging a single meal. Log your food, stop being a chud.",
  },
  {
    title: 'Big Chungus energy 🐰',
    body: "{{days}} days of untracked eating is big chungus monkey energy. Get it together and log your meals.",
  },
];

const NUTRITION_MID: MessageTemplate[] = [
  {
    title: 'Anakin is improvising',
    body: "{{days}} days with no food logs. At this point Anakin is just guessing your macros. Help him out.",
  },
  {
    title: 'Your protein target is crying',
    body: "Your protein target has been crying for {{days}} days. Feed it. Or at least tell us what you ate.",
  },
  {
    title: '{{days}} days, {{name}}',
    body: "A week of mystery nutrition. Whatever you're eating, your future self wants receipts.",
  },
  {
    title: 'Fat chud behaviour',
    body: "{{days}} days zero nutrition logs. This is fat chud behaviour, {{name}}. Snap out of it.",
  },
];

const NUTRITION_LATE: MessageTemplate[] = [
  {
    title: 'Ghost nutrition 👻',
    body: "The only macro Anakin can track right now is your {{days}}-day absence. Come back.",
  },
  {
    title: "It's between you and your stomach",
    body: "{{days}} days without a food log. Whatever you've been eating, it's a secret between you two. Log it.",
  },
  {
    title: 'Full chungus monkey mode',
    body: "{{days}} days, {{name}}. You've entered full chungus monkey mode. Time to log a meal and come back to reality.",
  },
];

// ─── General Inactivity (no app activity at all) ───────────────────────────────

const INACTIVITY_EARLY: MessageTemplate[] = [
  {
    title: 'The app misses you',
    body: "{{name}}, it's been {{days}} days. The app is getting clingy. Just tap in.",
  },
  {
    title: 'Silent retreat or rage quit?',
    body: "{{days}} days offline. Either you're on a silent retreat or you've rage-quit. Either way, come back.",
  },
  {
    title: 'Still alive out there, {{name}}?',
    body: "Your strength profile is gathering dust. {{days}} days dark. Tap in.",
  },
  {
    title: 'Future you has opinions',
    body: "{{days}} days away, {{name}}. Your future self is going to have words with your current self.",
  },
];

const INACTIVITY_MID: MessageTemplate[] = [
  {
    title: 'You ghosted us 💀',
    body: "{{days}} days and nothing. We're not mad. We're just... logging it.",
  },
  {
    title: 'No pressure. Some pressure.',
    body: "{{days}} days dark. The app, your program, and Anakin are all waiting. Some pressure.",
  },
];

const INACTIVITY_LATE: MessageTemplate[] = [
  {
    title: 'Gains on a milk carton 🥛',
    body: "Week+ offline, {{name}}. We've put your gains on a milk carton. Please come back.",
  },
  {
    title: 'We\'re still here',
    body: "It's been {{days}} days, {{name}}. Whatever happened — we're here. Just tap the app.",
  },
];

// ─── Junk Food (instant — fired when junk logged) ─────────────────────────────

const JUNK_FOOD_MESSAGES: MessageTemplate[] = [
  {
    title: 'We saw that 👀',
    body: "{{food}} logged. Full judgment. But hey, at least you're being honest. Back on track tomorrow.",
  },
  {
    title: 'Anakin has seen the {{food}}',
    body: "He's not angry. Just deeply, professionally concerned about your choices.",
  },
  {
    title: '{{calories}} kcal. Worth it?',
    body: "That {{food}} just cost you {{calories}} kcal. Worth it? (Don't answer that) 😂",
  },
  {
    title: 'Extra cardio incoming',
    body: "You logged a {{food}}. Anakin is adding extra cardio to your program as we speak. 😤",
  },
  {
    title: 'Your macros called',
    body: "They want to know what the {{food}} is doing here. Get it together, {{name}}.",
  },
  {
    title: 'Respect the honesty',
    body: "Logging that {{food}} was step one. Step two is never doing it again. We believe in you.",
  },
  {
    title: 'Bold. Chaotic.',
    body: "{{food}} logged. The shame is real but so is the accountability. That's literally the point 💪",
  },
  {
    title: 'Are you okay?',
    body: "{{food}}?? Anakin would like to schedule an emergency check-in. Please tap in.",
  },
];

// ─── Junk food keyword detection ──────────────────────────────────────────────

const JUNK_KEYWORDS = [
  'cake', 'cupcake', 'brownie', 'cookie', 'cookies', 'donut', 'doughnut',
  'chocolate', 'candy', 'gummy', 'gummies', 'skittles', 'haribo', 'twix',
  'snickers', 'kitkat', 'kit kat', 'reese', 'oreo', 'chips ahoy', 'm&m',
  'ice cream', 'gelato', 'soft serve', 'milkshake', 'sundae', 'sorbet',
  'pizza', 'burger', 'cheeseburger', 'big mac', 'whopper', 'double double',
  'french fries', 'fries', 'onion rings', 'fried chicken', 'chicken nuggets',
  'hot dog', 'corn dog', 'nachos', 'cheetos', 'doritos', 'lays', 'pringles',
  'chips', 'popcorn', 'cotton candy', 'funnel cake', 'churros',
  'mcdonalds', 'mcdonald\'s', 'kfc', 'popeyes', 'wendy\'s', 'taco bell',
  'burger king', 'five guys', 'cinnabon', 'krispy kreme', 'dairy queen',
  'pop tart', 'poptart', 'toaster strudel', 'soda', 'mountain dew', 'dr pepper',
  'coca cola', 'pepsi', 'sprite', 'energy drink', 'red bull', 'monster',
];

const JUNK_TAGS = ['ultra-processed', 'high-sugar', 'deep-fried', 'high-sodium'];

export function isJunkFood(mealName: string, tags: string[], calories: number): boolean {
  const nameLower = mealName.toLowerCase();
  if (JUNK_KEYWORDS.some(kw => nameLower.includes(kw))) return true;
  if (tags.some(t => JUNK_TAGS.includes(t.toLowerCase()))) return true;
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
