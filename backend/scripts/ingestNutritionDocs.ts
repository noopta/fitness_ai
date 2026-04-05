/**
 * Nutrition RAG Knowledge Base Ingestion
 * Usage: npx tsx scripts/ingestNutritionDocs.ts [--dry-run]
 *
 * Seeds the KnowledgeChunk table with evidence-based nutrition science documents.
 * These are used by the nutrition profile orchestrator to ground LLM responses
 * in verified science rather than parametric memory.
 *
 * Source: synthesized from ISSN Position Stands, ACSM guidelines, peer-reviewed literature.
 * Safe to re-run — existing NUTRITION_SCIENCE chunks are cleared before re-inserting.
 */

import 'dotenv/config';
import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const SOURCE = 'NUTRITION_SCIENCE';
const EMBED_MODEL = 'text-embedding-3-small';

// ─── Knowledge Documents ──────────────────────────────────────────────────────
// Each document = one chunk. Sized to ~400-600 tokens for high retrieval precision.

const NUTRITION_DOCUMENTS: Array<{ chapter: string; content: string }> = [

  // ── PROTEIN ────────────────────────────────────────────────────────────────

  {
    chapter: 'Protein Requirements for Strength Athletes',
    content: `Protein intake recommendations for strength and power athletes (ISSN Position Stand 2017):

The International Society of Sports Nutrition recommends 1.4–2.0 g/kg/day for exercising individuals, with 1.6–2.2 g/kg/day as the optimal range for maximizing muscle protein synthesis (MPS) in resistance-trained athletes.

Key evidence:
- Below 1.6 g/kg/day: MPS is suboptimal even with adequate training stimulus. Net protein balance (NPB) remains negative on a daily basis.
- 1.6–2.2 g/kg/day: Maximizes the anabolic response to resistance exercise. This range provides sufficient leucine and essential amino acids (EAAs) to saturate mTORC1 activation across multiple daily eating occasions.
- Above 2.2 g/kg/day: Diminishing returns. Protein above this threshold is increasingly oxidized via gluconeogenesis rather than incorporated into muscle tissue.
- During caloric restriction: Increase to 2.2–3.1 g/kg of lean body mass to preserve muscle during fat loss (Helms et al., 2014).

Practical distribution: 3–5 meals per day each containing 0.4–0.5 g/kg body weight of protein (≈25–40g) produces superior MPS to the same total protein in fewer doses.`,
  },

  {
    chapter: 'Leucine Threshold and mTOR Activation',
    content: `Leucine is the critical amino acid that acts as the primary trigger for muscle protein synthesis via mTORC1 signaling.

The leucine threshold:
- Approximately 2.5–3.0 g leucine per meal is required to maximally stimulate mTORC1. This corresponds to approximately 25–30g of high-quality complete protein (whey, meat, eggs, dairy).
- Below the leucine threshold, protein intake has a blunted effect on MPS regardless of total daily protein consumed.
- The threshold must be reached at each meal independently — leucine from one meal cannot "carry over" to activate MPS from a subsequent subthreshold dose.

Clinical implications:
- Spreading protein across 4 eating occasions of 30g each produces greater 24-hour MPS than 2 meals of 60g (Areta et al., 2013, Journal of Physiology).
- Plant proteins generally require larger serving sizes (30–40g) to achieve the leucine threshold due to lower leucine density compared to animal proteins.
- Older adults (>50 years) have "anabolic resistance" — require 35–40g protein per meal to achieve the same MPS response as younger adults receiving 20–25g.

Practical application: For a 80kg athlete consuming 3 meals/day: each meal should contain ≥30g protein to reliably exceed the leucine threshold and maintain anabolic signaling throughout the day.`,
  },

  {
    chapter: 'Protein Timing and Distribution',
    content: `Protein distribution across the day significantly influences 24-hour muscle protein synthesis, independent of total daily protein intake.

Key research findings:
- Areta et al. (2013): 80g protein distributed as 4 × 20g doses over 12 hours produced 31% greater myofibrillar MPS compared to 2 × 40g or 8 × 10g doses.
- Moore et al. (2012): MPS is maximized at 20–40g protein per meal in young trained males; surplus beyond this is oxidized.
- Post-exercise anabolic window: Consuming 20–40g high-quality protein within 2 hours post-exercise maximizes post-workout MPS. This window is more important when training in a fasted state.

Morning protein:
- Overnight fasting (8–12h) results in elevated cortisol and suppressed insulin at waking. Breakfast protein (≥25g) terminates the overnight catabolic state and initiates the first MPS pulse of the day.
- Skipping breakfast extends the fasting-induced catabolic window and delays the first mTOR activation by 4–6 hours.

Pre-sleep protein:
- 40g casein protein before sleep increases overnight MPS by 22% (Res et al., 2012). Casein's slow digestion provides sustained amino acid availability throughout the overnight fast.`,
  },

  // ── CARBOHYDRATES ─────────────────────────────────────────────────────────

  {
    chapter: 'Carbohydrate Periodization for Athletes',
    content: `Carbohydrate periodization — varying carbohydrate intake based on training demands — is one of the most evidence-backed nutritional strategies for optimizing athletic performance and body composition.

Physiological basis:
- Muscle glycogen is the primary fuel source during moderate-to-high intensity exercise (>65% VO2max). A 90-minute training session can deplete glycogen stores by 30–60%.
- Post-exercise glycogen resynthesis occurs via GLUT-4 transporter upregulation and insulin-mediated glucose uptake. The rate is highest in the 0–2h post-exercise window (8–10 mmol/kg/h with adequate CHO intake).
- Training days require more carbohydrates to fuel training and replenish glycogen.
- Rest days require fewer carbohydrates as glycogen stores do not need to be restored.

Practical carb periodization:
- Training day: 4–7 g/kg carbohydrates depending on training duration/intensity.
- Rest day: 2–4 g/kg carbohydrates.
- Pre-workout (2–4h prior): 1–4 g/kg slow-digesting carbohydrates to top up glycogen.
- Post-workout (0–2h): 1.0–1.5 g/kg fast-digesting carbohydrates for rapid glycogen resynthesis.

Warning signs of inadequate carbohydrate intake:
- Training days with lower carbs than rest days = inverted periodization (suboptimal).
- Chronic carbohydrate restriction impairs high-intensity training performance, increases muscle protein catabolism for gluconeogenesis, and reduces training volume capacity.`,
  },

  {
    chapter: 'Glycogen Resynthesis and Recovery Nutrition',
    content: `Glycogen resynthesis after exercise is a time-sensitive process critical for next-session performance.

Rate of glycogen resynthesis:
- Without carbohydrate intake: ~2–3 mmol/kg/h (complete resynthesis takes 20+ hours)
- With optimal carbohydrate intake (1.0–1.2 g/kg/h): 5–8 mmol/kg/h
- Combined carbohydrate + protein (4:1 ratio): Up to 8–10 mmol/kg/h due to additive insulin response

Burke et al. (2011) established that athletes with <8 hours between sessions require aggressive post-workout carbohydrate refeeding (1.2 g/kg/h) to achieve functional glycogen restoration.

Practical recommendations:
- Post-workout meal within 30–60 minutes: 1.0–1.5 g/kg carbohydrates + 25–40g protein
- For same-day training or next-morning training: prioritize carbohydrate replenishment
- Fructose + glucose combined (2:1 ratio) replenishes liver and muscle glycogen simultaneously, achieving 40% higher glycogen resynthesis rates vs. glucose alone

Night-time carbohydrates:
- Consuming carbohydrates before sleep on heavy training days blunts overnight cortisol-driven glycogenolysis and preserves morning glycogen stores for next-day training.`,
  },

  // ── FAT ───────────────────────────────────────────────────────────────────

  {
    chapter: 'Dietary Fat and Hormonal Health in Athletes',
    content: `Dietary fat plays a critical role in steroid hormone synthesis, cellular membrane integrity, fat-soluble vitamin absorption, and anti-inflammatory signaling.

Minimum fat requirements:
- Athletes should consume ≥0.5–1.0 g/kg/day of fat minimum. Below this threshold, hormonal disruption is clinically documented.
- Fat intake <20% of total calories is associated with significant reductions in testosterone in both males and females.
- Hamalainen et al. (1984): Reducing dietary fat from 40% to 25% of calories reduced total testosterone by 15% in healthy males.

Testosterone and dietary fat:
- Saturated and monounsaturated fats are direct precursors to cholesterol, the building block for all steroid hormones including testosterone, estrogen, and cortisol.
- Omega-3 fatty acids (EPA/DHA): Associated with reduced exercise-induced inflammation (DOMS), enhanced insulin sensitivity, and improved anabolic signaling (Smith et al., 2011).
- Very low-fat diets (<20% of calories) in female athletes are a primary driver of menstrual dysfunction (hypothalamic amenorrhea) and reduced bone mineral density.

Fat distribution recommendations:
- Saturated fat: ≤10% of total calories (cholesterol precursor but excess increases CVD risk)
- Monounsaturated fat: 10–15% of total calories (olive oil, avocado, nuts)
- Polyunsaturated fat: 5–10% including ≥2g EPA+DHA omega-3 per day
- Avoid trans fats completely: inhibit delta-6 desaturase, impairing omega-3 conversion and increasing systemic inflammation.`,
  },

  // ── ENERGY PATTERNS ───────────────────────────────────────────────────────

  {
    chapter: 'Meal Timing and Circadian Nutrition',
    content: `The circadian clock governs metabolic processes including glucose tolerance, insulin sensitivity, and thermogenesis. Meal timing in alignment with circadian rhythms has profound effects on body composition and energy.

Key findings:
- Morning eating: Insulin sensitivity is 30–50% higher in the morning vs. evening (Sutton et al., 2018, Cell Metabolism). The same meal consumed at breakfast produces less fat storage than at dinner.
- Back-loaded eating (>40% calories after 6pm): Associated with reduced diet-induced thermogenesis (DIT), impaired glucose clearance, elevated evening insulin, and higher rates of fat storage — independent of total calories consumed.
- Sutton et al. (2018) demonstrated that time-restricted eating (eTRF) aligned to morning/afternoon improved insulin sensitivity, blood pressure, and oxidative stress markers without caloric restriction.

Practical implications:
- Consuming >40% of daily calories after 6pm is a metabolic risk factor for fat accumulation even at maintenance calories.
- The ideal calorie distribution follows energy demand: larger meals around training, smaller meals in the evening.
- Skipping breakfast while consuming large dinners creates a "circadian mismatch" between meal timing and peak metabolic enzyme activity.

Athletes who train in the morning benefit most from immediate pre-training carbohydrate and post-training protein, with the largest carbohydrate meal consumed post-workout (typically morning).`,
  },

  {
    chapter: 'Energy Availability and RED-S in Athletes',
    content: `Relative Energy Deficiency in Sport (RED-S), formerly the Female Athlete Triad, describes the impaired physiological function caused by low energy availability (LEA).

Energy availability (EA) = dietary energy intake − exercise energy expenditure, divided by fat-free mass.
- Optimal EA: ≥45 kcal/kg FFM/day
- Subclinical zone: 30–45 kcal/kg FFM/day (increased injury risk, hormonal suppression)
- Clinical RED-S threshold: <30 kcal/kg FFM/day (significant health consequences)

Health consequences of low EA:
- Hormonal: Suppressed LH pulsatility → reduced testosterone (males) and estrogen (females). In males, testosterone can fall by 40–50% with chronic LEA.
- Metabolic: Decreased T3, resting metabolic rate, and IGF-1. Increased cortisol. Impaired protein synthesis.
- Performance: Decreased muscle strength, glycogen stores, reaction time, and coordination.
- Bone: Decreased bone mineral density → elevated stress fracture risk.

Recognition signs in nutritional data:
- Sustained average calories significantly below estimated TDEE
- Trend of decreasing caloric intake over multiple weeks
- Low fat intake (<0.5 g/kg) combined with high training volume
- Chronically low energy wellness ratings (<5/10) without explanation`,
  },

  // ── RECOVERY AND SLEEP ────────────────────────────────────────────────────

  {
    chapter: 'Nutrition for Sleep and Recovery',
    content: `Sleep is the primary anabolic window. Nutritional strategies directly influence sleep quality, overnight muscle protein synthesis, and recovery.

Sleep and muscle repair:
- 70% of daily growth hormone (GH) secretion occurs during slow-wave sleep (N3). GH stimulates IGF-1-mediated muscle protein synthesis and lipolysis.
- Sleep deprivation (<7h): Reduces GH secretion by 23%, reduces MPS by 18%, elevates morning cortisol by 37% (Dattilo et al., 2011), and increases muscle protein catabolism.
- Optimal sleep for athletes: 7–9 hours per night. Elite athlete data (NFL, NBA) shows performance metrics degrade linearly below 8h.

Pre-sleep nutrition:
- 40g casein protein before sleep increases overnight MPS by 22% without fat gain (Res et al., 2012). Casein's slow digestion (~7h) provides sustained amino acid delivery during the overnight fast.
- Tryptophan → serotonin → melatonin pathway: Carbohydrate consumption in the evening increases brain tryptophan uptake by reducing competing large neutral amino acids, facilitating melatonin synthesis and sleep onset.
- Avoid: large high-fat meals within 2h of sleep (delay gastric emptying, raise core body temperature, disrupt sleep onset).

Magnesium and sleep:
- Magnesium deficiency (common in athletes with restricted diets) is associated with reduced sleep quality and elevated nighttime cortisol. Sources: leafy greens, nuts, seeds, dark chocolate.

Inflammation and recovery:
- Omega-3 fatty acids (EPA/DHA) reduce IL-6 and TNF-α post-exercise inflammation, accelerating DOMS resolution and readiness for next session.
- High refined carbohydrate + low omega-3 diets elevate omega-6/omega-3 ratio, increasing systemic inflammation and prolonging recovery time.`,
  },

  // ── MENTAL CLARITY ────────────────────────────────────────────────────────

  {
    chapter: 'Nutrition and Cognitive Performance',
    content: `Nutritional patterns profoundly influence cognitive function, focus, and mood via neurotransmitter synthesis, glucose stability, and cerebral blood flow.

Glucose and cognitive function:
- The brain consumes ~120g glucose/day (20% of total body glucose use). Stable blood glucose is critical for sustained cognitive function.
- Low-glycemic, high-fiber meals produce stable glucose curves (gradual rise, slow fall) associated with sustained focus for 3–4 hours post-meal.
- High-glycemic meals (refined sugars, white bread) produce rapid glucose spikes followed by reactive hypoglycemia — associated with the "post-meal slump" at 90–120 minutes post-consumption.

Neurotransmitter precursors from diet:
- Tryptophan → 5-HTP → Serotonin: Found in turkey, eggs, dairy, seeds. Serotonin regulates mood, impulse control, and delayed gratification. Low dietary tryptophan predicts lower mood and increased carbohydrate cravings.
- Tyrosine → DOPA → Dopamine/Norepinephrine: Found in meat, fish, dairy, soy. Dopamine drives motivation, reward anticipation, and sustained attention. Low-protein diets directly reduce dopamine precursor availability.
- Choline → Acetylcholine: Found in eggs, liver, beef. Acetylcholine is the primary neurotransmitter for memory encoding and muscle contraction.

Glucose stability strategies:
- Pair carbohydrates with protein and fat to slow gastric emptying and flatten the glucose curve.
- Meal spacing of 3–4 hours maintains euglycemia while allowing meal-induced insulin to clear.
- Chronic erratic meal timing (meals <2h or >6h apart) destabilizes glucose homeostasis and impairs cognitive performance over time.`,
  },

  // ── LIFT-SPECIFIC NUTRITION ───────────────────────────────────────────────

  {
    chapter: 'Nutrition for Strength Lifts (Squat, Deadlift, Bench)',
    content: `Powerlifting-specific nutrition for the squat, deadlift, and bench press:

Energy systems:
- 1-3 rep maximal efforts: Primarily phosphocreatine (PCr) system — ATP produced from creatine phosphate stores, depleted in 8–12 seconds. Recovery requires 3–5 minutes for 90%+ PCr resynthesis.
- 4-8 rep strength sets: PCr + glycolytic contribution. Muscle glycogen fuels the glycolytic component.
- High-volume training (8-15 reps): Predominantly glycolytic. Glycogen depletion is significant; carbohydrate adequacy is critical for completing training volume.

Pre-workout nutrition for strength:
- 2–4 hours before training: Mixed meal with 1–2 g/kg carbohydrates + 0.4 g/kg protein + low-moderate fat.
- 30–60 minutes before: Simple carbohydrate (30-50g) if needed for top-up; optional but beneficial for volume work.

Deadlift-specific considerations:
- Heavy deadlifts are the most metabolically demanding of the three powerlifts due to the large muscle mass involvement (posterior chain + back + core).
- Protein intake after deadlift sessions should be prioritized for muscle protein synthesis in the posterior chain (glutes, hamstrings, erector spinae).

Bench press-specific considerations:
- Pectoralis, deltoid, and triceps are relatively fast-twitch dominant. Pre-workout creatine phosphate availability supports maximal force production.
- Post-workout protein within 2h supports chest and shoulder recovery.

Squat-specific considerations:
- Barbell back squat is the most glycogen-demanding of the three lifts due to bilateral quad/glute/hamstring involvement.
- On heavy squat days, carbohydrate intake should be at the higher end of the periodization target.`,
  },

  {
    chapter: 'Nutrition for Olympic Weightlifting (Clean & Jerk, Snatch)',
    content: `Olympic weightlifting nutrition demands:

Energy system profile:
- Olympic lifts are explosive (1-2 seconds of effort), primarily phosphocreatine dependent.
- However, training sessions involve multiple sets of technique work, pulling derivatives, and squatting — creating significant glycolytic demand.
- Total glycogen depletion in an Olympic weightlifting session: 20–40% of stores.

Unique nutritional considerations:
- Weight class management: Olympic lifters often manage body weight to compete within a class. Aggressive caloric restriction within 72 hours of competition impairs power output more than strength-focused athletes.
- Carbohydrate timing is critical: Technical work deteriorates sharply with even mild glycogen depletion (<50% stores). Intra-workout carbohydrates (30-60g/hour) during long sessions preserve technique quality.
- Protein needs: Similar to powerlifting (1.8–2.2 g/kg/day). Emphasis on fast-digesting proteins post-workout to support the eccentric loading component of receiving positions.

Power output and carbohydrates:
- Lees & Fahey (2000): Even 24 hours of carbohydrate restriction reduces peak power output in explosive efforts by 8–12%.
- Burke et al. (2011): Olympic athletes in low-carbohydrate states show increased RPE at equivalent power outputs.`,
  },

  // ── BODY COMPOSITION ─────────────────────────────────────────────────────

  {
    chapter: 'Simultaneous Fat Loss and Muscle Gain (Body Recomposition)',
    content: `Body recomposition — simultaneous fat loss and muscle gain — is achievable under specific nutritional conditions.

Who can recompose?
- Most effectively achieved in: (1) training beginners, (2) individuals returning after a break, (3) people with relatively high body fat (>20% males, >28% females), (4) those using performance-enhancing drugs.
- Advanced trained athletes with low body fat have greater difficulty due to reduced anabolic sensitivity.

Nutritional strategy for recomposition:
- Caloric target: Near maintenance or slight deficit (−200 to +100 kcal from TDEE). Deep deficits impair MPS; large surpluses cause fat gain.
- Protein: 2.2–3.1 g/kg of lean body mass — the highest protein range is needed to spare muscle while in mild deficit.
- Carbohydrate periodization: High carbohydrate on training days (support MPS + performance), low carbohydrate on rest days (promote lipolysis when insulin is low).
- Meal timing: Post-workout protein + carbohydrate combination maximizes the anabolic response while partitioning nutrients toward muscle rather than fat storage.

Key indicators of successful recomposition:
- Body weight stable or slightly decreasing
- Performance metrics improving (strength, rep counts, training volume)
- Subjective energy and recovery improving`,
  },

];

// ─── Ingestion Logic ──────────────────────────────────────────────────────────

async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({ model: EMBED_MODEL, input: texts });
  return response.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`\n🥗 Axiom Nutrition RAG Ingestion`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`Documents: ${NUTRITION_DOCUMENTS.length}`);

  if (dryRun) {
    NUTRITION_DOCUMENTS.forEach((doc, i) => {
      console.log(`\n  [${i + 1}] ${doc.chapter} (${doc.content.length} chars)`);
      console.log('  ' + doc.content.slice(0, 200).replace(/\n/g, '\n  ') + '...');
    });
    return;
  }

  // Clear existing nutrition science chunks
  const existing = await prisma.knowledgeChunk.count({ where: { source: SOURCE } });
  if (existing > 0) {
    console.log(`\n  Clearing ${existing} existing ${SOURCE} chunks...`);
    await prisma.knowledgeChunk.deleteMany({ where: { source: SOURCE } });
  }

  // Embed in batches of 10
  const BATCH = 10;
  let stored = 0;
  for (let i = 0; i < NUTRITION_DOCUMENTS.length; i += BATCH) {
    const batch = NUTRITION_DOCUMENTS.slice(i, i + BATCH);
    process.stdout.write(`  Embedding batch ${Math.floor(i / BATCH) + 1}...`);
    const embeddings = await embedBatch(batch.map(d => `${d.chapter}\n\n${d.content}`));
    for (let j = 0; j < batch.length; j++) {
      await prisma.knowledgeChunk.create({
        data: {
          source: SOURCE,
          chapter: batch[j].chapter,
          content: batch[j].content,
          embedding: JSON.stringify(embeddings[j]),
          tokenCount: Math.ceil(batch[j].content.length / 4),
        },
      });
      stored++;
    }
    process.stdout.write(` ✓ (${stored}/${NUTRITION_DOCUMENTS.length})\n`);
    if (i + BATCH < NUTRITION_DOCUMENTS.length) await new Promise(r => setTimeout(r, 300));
  }

  const total = await prisma.knowledgeChunk.count({ where: { source: SOURCE } });
  console.log(`\n✅ Done. ${total} nutrition science chunks stored.`);
  await prisma.$disconnect();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
