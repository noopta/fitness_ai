// Canonical nutrient registry — the single source of truth for the Nutrition
// Profile feature. Everything downstream (daily targets, coverage %, which
// nutrients drive which body system, the Nutrient Detail mechanism chains, the
// recommendation gap vector) is derived from this table.
//
// DESIGN: the nutrient set is intentionally OPEN. There is no fixed count.
//   - Adding a tracked nutrient = add one row here (key, target, unit, the
//     body systems it drives, optional USDA ids + mechanism content). Nothing
//     else needs to change — the engine iterates the registry, the schemas
//     accept any numeric key, and the mobile UI renders whatever the API
//     returns.
//   - Nutrients we DON'T have a registry row for still surface: the parser and
//     enrichment carry an open `extras` channel (see MealNutrients), so a food
//     rich in, say, lycopene shows its lycopene even before we add a row with
//     a target. Registry rows just add targets + system mapping + mechanism.
//
// §11 of the spec: all mechanism/target copy here is reviewed against the
// science library before shipping. Treat targets as adult general defaults;
// per-user adjustment (bodyweight, sex, training load) layers on top in the
// engine, never by editing this table.

export type BodySystemId = 'recovery' | 'cognition' | 'energy' | 'sleep' | 'mood';

export const BODY_SYSTEMS: { id: BodySystemId; name: string }[] = [
  { id: 'recovery', name: 'Recovery' },
  { id: 'cognition', name: 'Cognition & focus' },
  { id: 'energy', name: 'Energy & output' },
  { id: 'sleep', name: 'Sleep quality' },
  { id: 'mood', name: 'Mood & drive' },
];

export type NutrientUnit = 'g' | 'mg' | 'mcg' | 'IU';

// How a nutrient contributes to a body system. `weight` is its share of that
// system's roll (0–1, relative within the system); `direction` marks nutrients
// where MORE is worse past the target (sodium, added sugar, saturated fat) so
// the engine scores them as a ceiling instead of a floor.
export interface SystemDriver {
  system: BodySystemId;
  weight: number;
  direction?: 'ceiling'; // default is 'floor' (hit the target = good)
}

export interface MechanismStep {
  title: string;
  body: string;
}

export interface NutrientDef {
  key: string;               // stable id, also the JSON key on MealNutrients
  label: string;             // display name
  unit: NutrientUnit;
  target: number;            // adult general daily target (floor unless ceiling)
  // Optional per-kg-bodyweight target — when set, the engine uses
  // max(target, perKgTarget × bodyweightKg). Protein/leucine style.
  perKgTarget?: number;
  usdaIds?: number[];        // FoodData Central nutrient ids (enrichment)
  tag?: string;              // Nutrient Detail header chip, e.g. "Neuro cofactor"
  drives: SystemDriver[];
  // Nutrient Detail flagship content. Chain = the mechanism → outcome steps.
  // `why` is a template the LLM personalizes; kept here as the grounded default.
  chain?: MechanismStep[];
  watchFor?: string;         // single amber caution on Effect/Nutrient detail
}

// The registry. Ordered roughly by how load-bearing each nutrient is to the
// five systems. This is a curated STARTER set spanning all systems — add rows
// freely; the pipeline does not care how many there are.
export const NUTRIENTS: NutrientDef[] = [
  {
    key: 'proteinG', label: 'Protein', unit: 'g', target: 130, perKgTarget: 1.6,
    tag: 'Tissue substrate',
    drives: [{ system: 'recovery', weight: 0.5 }, { system: 'energy', weight: 0.15 }],
    chain: [
      { title: 'Dietary protein', body: 'Digested to free amino acids in the gut and delivered to circulation.' },
      { title: 'Leucine threshold', body: 'A large enough leucine bolus flips on mTOR signalling in muscle.' },
      { title: 'Muscle protein synthesis', body: 'Damaged contractile proteins are rebuilt above breakdown for hours after.' },
      { title: 'Net recovery', body: 'Positive protein balance is what turns a session into adaptation instead of a deficit.' },
    ],
    watchFor: 'Spread it across the day — one large bolus wastes the leucine trigger the other meals miss.',
  },
  {
    key: 'leucineG', label: 'Leucine', unit: 'g', target: 10, tag: 'MPS trigger',
    drives: [{ system: 'recovery', weight: 0.2 }],
    chain: [
      { title: 'Leucine', body: 'The branched-chain amino acid that acts as the on-switch, not just a brick.' },
      { title: 'mTORC1 activation', body: 'Crossing ~2.5 g per meal maximally stimulates the synthesis pathway.' },
      { title: 'Muscle protein synthesis', body: 'Recovery rate scales with how many meals clear the threshold, not total grams.' },
    ],
  },
  {
    key: 'cholineMg', label: 'Choline', unit: 'mg', target: 550, usdaIds: [1180],
    tag: 'Neuro cofactor',
    drives: [{ system: 'cognition', weight: 0.35 }, { system: 'energy', weight: 0.1 }],
    chain: [
      { title: 'Dietary choline', body: 'Absorbed and phosphorylated; whole eggs and liver are the densest sources.' },
      { title: 'Choline + Acetyl-CoA', body: 'Choline acetyltransferase joins the two into acetylcholine.' },
      { title: 'Acetylcholine synthesis', body: 'The neurotransmitter of the neuromuscular junction and of focus.' },
      { title: 'Motor-unit recruitment', body: 'Cleaner signalling means more force per contraction and sharper bar speed.' },
    ],
    watchFor: 'Most people under-eat choline; it rarely shows on a label so it hides in plain sight.',
  },
  {
    key: 'omega3G', label: 'Omega-3 (EPA/DHA)', unit: 'g', target: 1.6, usdaIds: [1270, 1271, 1272, 1273],
    tag: 'Membrane lipid',
    drives: [
      { system: 'recovery', weight: 0.2 }, { system: 'cognition', weight: 0.2 },
      { system: 'mood', weight: 0.25 },
    ],
    chain: [
      { title: 'EPA + DHA', body: 'Incorporated into cell membranes across muscle and brain.' },
      { title: 'Resolvin synthesis', body: 'They are the raw material for the signals that END inflammation, not just blunt it.' },
      { title: 'Faster resolution', body: 'Training soreness clears sooner and neural membranes stay fluid.' },
    ],
    watchFor: 'Omega-6 competes for the same enzymes — a high omega-6 diet blunts the omega-3 you do eat.',
  },
  {
    key: 'ironMg', label: 'Iron', unit: 'mg', target: 12, usdaIds: [1089], tag: 'Oxygen carrier',
    drives: [{ system: 'energy', weight: 0.35 }, { system: 'cognition', weight: 0.15 }],
    chain: [
      { title: 'Dietary iron', body: 'Heme iron (meat) absorbs far better than non-heme (plants).' },
      { title: 'Haemoglobin loading', body: 'Iron sits at the centre of the molecule that binds oxygen in red cells.' },
      { title: 'Oxygen delivery', body: 'More carrying capacity means more aerobic output before fatigue.' },
    ],
    watchFor: 'Coffee or tea with a meal can cut non-heme iron absorption sharply — separate them.',
  },
  {
    key: 'magnesiumMg', label: 'Magnesium', unit: 'mg', target: 400, usdaIds: [1090], tag: 'Relaxation cofactor',
    drives: [
      { system: 'sleep', weight: 0.35 }, { system: 'recovery', weight: 0.15 },
      { system: 'energy', weight: 0.1 },
    ],
    chain: [
      { title: 'Magnesium', body: 'A cofactor in 300+ reactions, including every step that spends ATP.' },
      { title: 'GABA + NMDA modulation', body: 'It calms the excitatory NMDA receptor and supports inhibitory GABA tone.' },
      { title: 'Parasympathetic shift', body: 'The nervous system drops into the rest-and-digest state sleep needs.' },
    ],
    watchFor: 'Training and sweat deplete magnesium; heavy weeks raise the real requirement.',
  },
  {
    key: 'potassiumMg', label: 'Potassium', unit: 'mg', target: 3400, usdaIds: [1092], tag: 'Electrolyte',
    drives: [{ system: 'energy', weight: 0.2 }, { system: 'recovery', weight: 0.1 }],
    chain: [
      { title: 'Potassium', body: 'The dominant intracellular electrolyte, balanced against sodium.' },
      { title: 'Membrane potential', body: 'It sets the charge that lets a muscle fibre fire and reset.' },
      { title: 'Contraction & pump', body: 'Adequate potassium supports force output and staves off cramping.' },
    ],
  },
  {
    key: 'sodiumMg', label: 'Sodium', unit: 'mg', target: 2300, usdaIds: [1093], tag: 'Electrolyte',
    drives: [{ system: 'energy', weight: 0.1, direction: 'ceiling' }],
    watchFor: 'Endurance and heavy sweating raise the sodium you need — the ceiling is not one-size-fits-all.',
  },
  {
    key: 'vitaminDIU', label: 'Vitamin D', unit: 'IU', target: 800, usdaIds: [1114, 1110], tag: 'Hormone precursor',
    drives: [
      { system: 'recovery', weight: 0.15 }, { system: 'mood', weight: 0.2 },
      { system: 'energy', weight: 0.1 },
    ],
    chain: [
      { title: 'Vitamin D', body: 'Acts as a pro-hormone once hydroxylated in the liver and kidney.' },
      { title: 'Nuclear receptor binding', body: 'It regulates genes for muscle function, immunity and serotonin synthesis.' },
      { title: 'Force + mood', body: 'Sufficiency tracks with type-II fibre function and stable mood.' },
    ],
    watchFor: 'Diet alone rarely covers it without sun or a supplement, especially in winter.',
  },
  {
    key: 'vitaminB12Mcg', label: 'Vitamin B12', unit: 'mcg', target: 2.4, usdaIds: [1178], tag: 'Energy cofactor',
    drives: [{ system: 'energy', weight: 0.2 }, { system: 'cognition', weight: 0.15 }, { system: 'mood', weight: 0.1 }],
    chain: [
      { title: 'Vitamin B12', body: 'Required to recycle homocysteine and build the myelin that insulates nerves.' },
      { title: 'Red cell maturation', body: 'Without it, red cells enlarge and carry oxygen poorly.' },
      { title: 'Sustained energy', body: 'Adequacy underlies steady aerobic energy and clear thinking.' },
    ],
    watchFor: 'Plant-only diets need a reliable B12 source — deficiency builds silently over months.',
  },
  {
    key: 'folateMcg', label: 'Folate', unit: 'mcg', target: 400, usdaIds: [1177], tag: 'Methylation',
    drives: [{ system: 'cognition', weight: 0.1 }, { system: 'mood', weight: 0.15 }],
    chain: [
      { title: 'Folate', body: 'Feeds the one-carbon cycle alongside B12.' },
      { title: 'Neurotransmitter synthesis', body: 'It supports methylation steps that build serotonin and dopamine.' },
      { title: 'Mood stability', body: 'Low folate tracks with low mood and slower processing.' },
    ],
  },
  {
    key: 'vitaminCMg', label: 'Vitamin C', unit: 'mg', target: 90, usdaIds: [1162], tag: 'Antioxidant',
    drives: [{ system: 'recovery', weight: 0.15 }, { system: 'mood', weight: 0.1 }],
    chain: [
      { title: 'Vitamin C', body: 'A water-soluble antioxidant and enzyme cofactor.' },
      { title: 'Collagen + dopamine', body: 'Needed to build connective tissue and to convert dopamine to noradrenaline.' },
      { title: 'Tissue repair', body: 'Supports tendon and ligament recovery under training load.' },
    ],
  },
  {
    key: 'zincMg', label: 'Zinc', unit: 'mg', target: 11, usdaIds: [1095], tag: 'Hormone cofactor',
    drives: [{ system: 'recovery', weight: 0.15 }, { system: 'mood', weight: 0.1 }],
    chain: [
      { title: 'Zinc', body: 'A cofactor for hundreds of enzymes and for testosterone synthesis.' },
      { title: 'Endocrine support', body: 'Deficiency depresses anabolic hormone output and immune response.' },
      { title: 'Recovery capacity', body: 'Adequacy protects the hormonal side of adaptation.' },
    ],
  },
  {
    key: 'calciumMg', label: 'Calcium', unit: 'mg', target: 1000, usdaIds: [1087], tag: 'Contraction signal',
    drives: [{ system: 'energy', weight: 0.1 }, { system: 'sleep', weight: 0.1 }],
    chain: [
      { title: 'Calcium', body: 'Stored in bone and released to trigger every muscle contraction.' },
      { title: 'Excitation–contraction', body: 'Calcium flux is the literal trigger that shortens a fibre.' },
      { title: 'Force & bone', body: 'Adequacy protects both contractile function and skeletal load tolerance.' },
    ],
  },
  {
    key: 'fiberG', label: 'Fiber', unit: 'g', target: 30, usdaIds: [1079], tag: 'Microbiome fuel',
    drives: [{ system: 'energy', weight: 0.15 }, { system: 'mood', weight: 0.15 }],
    chain: [
      { title: 'Dietary fiber', body: 'Fermented by gut bacteria into short-chain fatty acids.' },
      { title: 'SCFA + serotonin', body: 'Those metabolites feed the gut lining and most of the body’s serotonin.' },
      { title: 'Steady energy & mood', body: 'Slower glucose release and a healthier gut-brain axis.' },
    ],
    watchFor: 'Ramp intake gradually — a sudden jump backfires on digestion.',
  },
  {
    key: 'tryptophanG', label: 'Tryptophan', unit: 'g', target: 1.0, tag: 'Serotonin precursor',
    drives: [{ system: 'sleep', weight: 0.25 }, { system: 'mood', weight: 0.2 }],
    chain: [
      { title: 'Tryptophan', body: 'An essential amino acid and the raw material for serotonin.' },
      { title: 'Serotonin → melatonin', body: 'Serotonin converts to melatonin as light drops in the evening.' },
      { title: 'Sleep onset', body: 'Better precursor availability supports falling asleep and depth.' },
    ],
  },
  {
    key: 'addedSugarG', label: 'Added sugar', unit: 'g', target: 36, tag: 'Glycemic load',
    drives: [{ system: 'energy', weight: 0.15, direction: 'ceiling' }, { system: 'mood', weight: 0.1, direction: 'ceiling' }],
    watchFor: 'Large evening sugar loads can fragment sleep and swing energy — timing matters as much as amount.',
  },
  {
    key: 'saturatedFatG', label: 'Saturated fat', unit: 'g', target: 22, usdaIds: [1258], tag: 'Lipid quality',
    drives: [{ system: 'recovery', weight: 0.05, direction: 'ceiling' }],
  },
];

// Index for O(1) lookups.
const BY_KEY = new Map<string, NutrientDef>(NUTRIENTS.map(n => [n.key, n]));
export function getNutrient(key: string): NutrientDef | undefined { return BY_KEY.get(key); }

// All nutrient keys that drive a given system, with their weights.
export function driversForSystem(system: BodySystemId): { def: NutrientDef; driver: SystemDriver }[] {
  const out: { def: NutrientDef; driver: SystemDriver }[] = [];
  for (const def of NUTRIENTS) {
    const driver = def.drives.find(d => d.system === system);
    if (driver) out.push({ def, driver });
  }
  return out;
}

// USDA id → registry key, for the enrichment service to attribute fetched
// nutrient amounts back onto canonical keys.
export const USDA_ID_TO_KEY: Record<number, string> = (() => {
  const m: Record<number, string> = {};
  for (const n of NUTRIENTS) for (const id of n.usdaIds ?? []) m[id] = n.key;
  return m;
})();
