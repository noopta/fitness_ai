export interface Exercise {
  id: string;
  name: string;
  category: string; // compound, accessory, isolation
  targetPhase?: string[]; // setup, descent, bottom, ascent, lockout
  targetMuscle: string[];
  equipment: string[];
  fatigueCost: 'low' | 'medium' | 'high';
  contraindications?: string[];
  description?: string;
}

export const exercises: Exercise[] = [
  // COMPOUND LIFTS
  {
    id: 'flat_bench_press',
    name: 'Flat Bench Press',
    category: 'compound',
    targetMuscle: ['chest', 'triceps', 'anterior_deltoid'],
    equipment: ['barbell', 'bench'],
    fatigueCost: 'high',
    description: 'Primary horizontal pressing movement'
  },
  {
    id: 'incline_bench_press',
    name: 'Incline Bench Press',
    category: 'compound',
    targetMuscle: ['upper_chest', 'anterior_deltoid', 'triceps'],
    equipment: ['barbell', 'bench'],
    fatigueCost: 'high',
    description: 'Upper chest emphasis pressing'
  },
  {
    id: 'deadlift',
    name: 'Deadlift',
    category: 'compound',
    targetPhase: ['setup', 'initial_pull', 'knee_level', 'lockout'],
    targetMuscle: ['hamstrings', 'glutes', 'erectors', 'lats', 'traps'],
    equipment: ['barbell'],
    fatigueCost: 'high',
    description: 'Hip hinge posterior chain movement'
  },
  {
    id: 'barbell_back_squat',
    name: 'Barbell Back Squat',
    category: 'compound',
    targetPhase: ['setup', 'descent', 'bottom', 'ascent'],
    targetMuscle: ['quads', 'glutes', 'erectors'],
    equipment: ['barbell', 'rack'],
    fatigueCost: 'high',
    description: 'Primary lower body compound'
  },
  {
    id: 'barbell_front_squat',
    name: 'Barbell Front Squat',
    category: 'compound',
    targetPhase: ['setup', 'descent', 'bottom', 'ascent'],
    targetMuscle: ['quads', 'upper_back', 'core'],
    equipment: ['barbell', 'rack'],
    fatigueCost: 'high',
    description: 'Quad-dominant squat variation'
  },

  // BENCH ACCESSORIES
  {
    id: 'close_grip_bench_press',
    name: 'Close Grip Bench Press',
    category: 'accessory',
    targetPhase: ['lockout'],
    targetMuscle: ['triceps', 'chest'],
    equipment: ['barbell', 'bench'],
    fatigueCost: 'medium',
    description: 'Triceps lockout strength'
  },
  {
    id: 'dumbbell_bench_press',
    name: 'Dumbbell Bench Press',
    category: 'accessory',
    targetMuscle: ['chest', 'triceps', 'stabilizers'],
    equipment: ['dumbbells', 'bench'],
    fatigueCost: 'medium',
    description: 'Stability and ROM variation'
  },
  {
    id: 'overhead_press',
    name: 'Overhead Press',
    category: 'compound',
    targetMuscle: ['anterior_deltoid', 'triceps', 'upper_chest'],
    equipment: ['barbell'],
    fatigueCost: 'medium',
    contraindications: ['shoulder_impingement'],
    description: 'Vertical pressing strength'
  },
  {
    id: 'dumbbell_incline_press',
    name: 'Dumbbell Incline Press',
    category: 'accessory',
    targetMuscle: ['upper_chest', 'anterior_deltoid'],
    equipment: ['dumbbells', 'bench'],
    fatigueCost: 'medium',
    description: 'Upper chest hypertrophy'
  },
  {
    id: 'dips',
    name: 'Dips',
    category: 'accessory',
    targetPhase: ['lockout'],
    targetMuscle: ['triceps', 'chest', 'anterior_deltoid'],
    equipment: ['dip_bars'],
    fatigueCost: 'medium',
    contraindications: ['shoulder_pain'],
    description: 'Bodyweight pressing power'
  },

  // TRICEPS ISOLATION
  {
    id: 'rope_pressdown',
    name: 'Rope Pressdown',
    category: 'isolation',
    targetPhase: ['lockout'],
    targetMuscle: ['triceps'],
    equipment: ['cable'],
    fatigueCost: 'low',
    description: 'High-volume triceps work'
  },
  {
    id: 'overhead_triceps_extension',
    name: 'Overhead Triceps Extension',
    category: 'isolation',
    targetMuscle: ['triceps_long_head'],
    equipment: ['dumbbell', 'cable'],
    fatigueCost: 'low',
    description: 'Long head triceps stretch'
  },
  {
    id: 'jm_press',
    name: 'JM Press',
    category: 'accessory',
    targetPhase: ['lockout'],
    targetMuscle: ['triceps'],
    equipment: ['barbell', 'bench'],
    fatigueCost: 'medium',
    description: 'Specific lockout training'
  },

  // UPPER BACK / ROWS
  {
    id: 'barbell_row',
    name: 'Barbell Row',
    category: 'compound',
    targetMuscle: ['lats', 'rhomboids', 'rear_deltoid'],
    equipment: ['barbell'],
    fatigueCost: 'medium',
    description: 'Horizontal pulling strength'
  },
  {
    id: 'chest_supported_row',
    name: 'Chest Supported Row',
    category: 'accessory',
    targetMuscle: ['lats', 'rhomboids', 'traps'],
    equipment: ['dumbbells', 'bench'],
    fatigueCost: 'low',
    description: 'Pressing stability and back hypertrophy'
  },
  {
    id: 'tbar_row',
    name: 'T-Bar Row',
    category: 'accessory',
    targetMuscle: ['lats', 'traps', 'rhomboids'],
    equipment: ['landmine', 'barbell'],
    fatigueCost: 'medium',
    description: 'Thick back development'
  },
  {
    id: 'cable_row',
    name: 'Cable Row',
    category: 'accessory',
    targetMuscle: ['lats', 'rhomboids'],
    equipment: ['cable'],
    fatigueCost: 'low',
    description: 'Constant tension rowing'
  },

  // SHOULDER SUPPORT
  {
    id: 'face_pull',
    name: 'Face Pull',
    category: 'isolation',
    targetMuscle: ['rear_deltoid', 'rotator_cuff'],
    equipment: ['cable'],
    fatigueCost: 'low',
    description: 'Shoulder health and posture'
  },
  {
    id: 'band_pull_apart',
    name: 'Band Pull Apart',
    category: 'isolation',
    targetMuscle: ['rear_deltoid', 'rhomboids'],
    equipment: ['band'],
    fatigueCost: 'low',
    description: 'Shoulder stability warmup'
  },
  {
    id: 'external_rotation',
    name: 'External Rotation',
    category: 'isolation',
    targetMuscle: ['rotator_cuff'],
    equipment: ['dumbbell', 'cable'],
    fatigueCost: 'low',
    contraindications: [],
    description: 'Rotator cuff prehab'
  },

  // LOWER BODY ACCESSORIES (for squat/deadlift)
  {
    id: 'romanian_deadlift',
    name: 'Romanian Deadlift',
    category: 'accessory',
    targetPhase: ['initial_pull', 'lockout'],
    targetMuscle: ['hamstrings', 'glutes', 'erectors'],
    equipment: ['barbell'],
    fatigueCost: 'medium',
    description: 'Hip hinge and hamstring strength'
  },
  {
    id: 'leg_curl',
    name: 'Leg Curl',
    category: 'isolation',
    targetMuscle: ['hamstrings'],
    equipment: ['machine'],
    fatigueCost: 'low',
    description: 'Hamstring isolation'
  },
  {
    id: 'leg_press',
    name: 'Leg Press',
    category: 'accessory',
    targetMuscle: ['quads', 'glutes'],
    equipment: ['machine'],
    fatigueCost: 'medium',
    description: 'Quad volume without spinal load'
  },
  {
    id: 'bulgarian_split_squat',
    name: 'Bulgarian Split Squat',
    category: 'accessory',
    targetMuscle: ['quads', 'glutes'],
    equipment: ['dumbbells', 'bench'],
    fatigueCost: 'medium',
    description: 'Unilateral leg strength'
  },
  {
    id: 'leg_extension',
    name: 'Leg Extension',
    category: 'isolation',
    targetMuscle: ['quads'],
    equipment: ['machine'],
    fatigueCost: 'low',
    description: 'Quad isolation and lockout'
  },
  {
    id: 'hip_thrust',
    name: 'Hip Thrust',
    category: 'accessory',
    targetMuscle: ['glutes', 'hamstrings'],
    equipment: ['barbell', 'bench'],
    fatigueCost: 'low',
    description: 'Glute strength and lockout power'
  },
  {
    id: 'pause_squat',
    name: 'Pause Squat',
    category: 'accessory',
    targetPhase: ['bottom'],
    targetMuscle: ['quads', 'glutes'],
    equipment: ['barbell', 'rack'],
    fatigueCost: 'high',
    description: 'Bottom position strength'
  },
  {
    id: 'deficit_deadlift',
    name: 'Deficit Deadlift',
    category: 'accessory',
    targetPhase: ['initial_pull'],
    targetMuscle: ['hamstrings', 'quads', 'erectors'],
    equipment: ['barbell', 'platform'],
    fatigueCost: 'high',
    description: 'Off-floor strength'
  },
  {
    id: 'rack_pull',
    name: 'Rack Pull',
    category: 'accessory',
    targetPhase: ['lockout'],
    targetMuscle: ['erectors', 'traps', 'glutes'],
    equipment: ['barbell', 'rack'],
    fatigueCost: 'medium',
    description: 'Lockout specific work'
  },
  {
    id: 'good_morning',
    name: 'Good Morning',
    category: 'accessory',
    targetMuscle: ['hamstrings', 'erectors', 'glutes'],
    equipment: ['barbell'],
    fatigueCost: 'medium',
    description: 'Hip hinge pattern reinforcement'
  },

  // CORE
  {
    id: 'plank',
    name: 'Plank',
    category: 'isolation',
    targetMuscle: ['core', 'abs'],
    equipment: ['bodyweight'],
    fatigueCost: 'low',
    description: 'Anti-extension core stability'
  },
  {
    id: 'pallof_press',
    name: 'Pallof Press',
    category: 'isolation',
    targetMuscle: ['core', 'obliques'],
    equipment: ['cable', 'band'],
    fatigueCost: 'low',
    description: 'Anti-rotation core strength'
  },
  {
    id: 'ab_wheel',
    name: 'Ab Wheel Rollout',
    category: 'isolation',
    targetMuscle: ['core', 'abs'],
    equipment: ['ab_wheel'],
    fatigueCost: 'low',
    description: 'Advanced core anti-extension'
  },
  {
    id: 'hanging_leg_raise',
    name: 'Hanging Leg Raise',
    category: 'isolation',
    targetMuscle: ['abs', 'hip_flexors'],
    equipment: ['pull_up_bar'],
    fatigueCost: 'low',
    description: 'Lower abs and hip flexor strength'
  },

  // ADDITIONAL PRESSING VARIATIONS
  {
    id: 'floor_press',
    name: 'Floor Press',
    category: 'accessory',
    targetPhase: ['lockout'],
    targetMuscle: ['triceps', 'chest'],
    equipment: ['barbell', 'dumbbells'],
    fatigueCost: 'medium',
    description: 'Lockout strength without stretch reflex'
  },
  {
    id: 'spoto_press',
    name: 'Spoto Press',
    category: 'accessory',
    targetPhase: ['bottom'],
    targetMuscle: ['chest', 'triceps'],
    equipment: ['barbell', 'bench'],
    fatigueCost: 'high',
    description: 'Paused bench press for bottom strength'
  },
  {
    id: 'larsen_press',
    name: 'Larsen Press',
    category: 'accessory',
    targetMuscle: ['chest', 'triceps', 'core'],
    equipment: ['barbell', 'bench'],
    fatigueCost: 'medium',
    description: 'Bench press with feet up for stability'
  },
  {
    id: 'decline_bench_press',
    name: 'Decline Bench Press',
    category: 'accessory',
    targetMuscle: ['lower_chest', 'triceps'],
    equipment: ['barbell', 'bench'],
    fatigueCost: 'medium',
    description: 'Lower chest emphasis'
  },
  {
    id: 'pin_press',
    name: 'Pin Press',
    category: 'accessory',
    targetPhase: ['lockout'],
    targetMuscle: ['triceps', 'chest', 'anterior_deltoid'],
    equipment: ['barbell', 'rack'],
    fatigueCost: 'medium',
    description: 'Overload specific sticking points'
  },

  // SHOULDER VARIATIONS
  {
    id: 'dumbbell_shoulder_press',
    name: 'Dumbbell Shoulder Press',
    category: 'accessory',
    targetMuscle: ['anterior_deltoid', 'triceps'],
    equipment: ['dumbbells'],
    fatigueCost: 'medium',
    description: 'Shoulder strength with stabilization'
  },
  {
    id: 'arnold_press',
    name: 'Arnold Press',
    category: 'accessory',
    targetMuscle: ['anterior_deltoid', 'lateral_deltoid'],
    equipment: ['dumbbells'],
    fatigueCost: 'medium',
    description: 'Full ROM shoulder development'
  },
  {
    id: 'lateral_raise',
    name: 'Lateral Raise',
    category: 'isolation',
    targetMuscle: ['lateral_deltoid'],
    equipment: ['dumbbells', 'cable'],
    fatigueCost: 'low',
    description: 'Lateral deltoid isolation'
  },
  {
    id: 'front_raise',
    name: 'Front Raise',
    category: 'isolation',
    targetMuscle: ['anterior_deltoid'],
    equipment: ['dumbbells', 'cable', 'plate'],
    fatigueCost: 'low',
    description: 'Front deltoid isolation'
  },
  {
    id: 'reverse_fly',
    name: 'Reverse Fly',
    category: 'isolation',
    targetMuscle: ['rear_deltoid', 'rhomboids'],
    equipment: ['dumbbells', 'cable', 'machine'],
    fatigueCost: 'low',
    description: 'Rear deltoid and upper back'
  },
  {
    id: 'z_press',
    name: 'Z Press',
    category: 'accessory',
    targetMuscle: ['anterior_deltoid', 'triceps', 'core'],
    equipment: ['barbell', 'dumbbells'],
    fatigueCost: 'medium',
    description: 'Seated floor press for core stability'
  },
  {
    id: 'bradford_press',
    name: 'Bradford Press',
    category: 'accessory',
    targetMuscle: ['anterior_deltoid', 'lateral_deltoid'],
    equipment: ['barbell'],
    fatigueCost: 'medium',
    contraindications: ['shoulder_impingement'],
    description: 'Constant tension shoulder work'
  },

  // ADDITIONAL BACK/PULLING
  {
    id: 'lat_pulldown',
    name: 'Lat Pulldown',
    category: 'accessory',
    targetMuscle: ['lats', 'biceps'],
    equipment: ['cable', 'machine'],
    fatigueCost: 'low',
    description: 'Vertical pulling for lats'
  },
  {
    id: 'pull_up',
    name: 'Pull-Up',
    category: 'compound',
    targetMuscle: ['lats', 'biceps', 'upper_back'],
    equipment: ['pull_up_bar'],
    fatigueCost: 'medium',
    description: 'Bodyweight vertical pull'
  },
  {
    id: 'chin_up',
    name: 'Chin-Up',
    category: 'compound',
    targetMuscle: ['lats', 'biceps'],
    equipment: ['pull_up_bar'],
    fatigueCost: 'medium',
    description: 'Supinated grip vertical pull'
  },
  {
    id: 'pendlay_row',
    name: 'Pendlay Row',
    category: 'accessory',
    targetMuscle: ['lats', 'traps', 'erectors'],
    equipment: ['barbell'],
    fatigueCost: 'medium',
    description: 'Explosive row from floor'
  },
  {
    id: 'seal_row',
    name: 'Seal Row',
    category: 'accessory',
    targetMuscle: ['lats', 'rhomboids', 'traps'],
    equipment: ['barbell', 'bench'],
    fatigueCost: 'low',
    description: 'Isolated back work without lower back'
  },
  {
    id: 'dumbbell_row',
    name: 'Dumbbell Row',
    category: 'accessory',
    targetMuscle: ['lats', 'rhomboids'],
    equipment: ['dumbbells'],
    fatigueCost: 'low',
    description: 'Unilateral back development'
  },
  {
    id: 'meadows_row',
    name: 'Meadows Row',
    category: 'accessory',
    targetMuscle: ['lats', 'rhomboids'],
    equipment: ['landmine', 'barbell'],
    fatigueCost: 'low',
    description: 'Landmine unilateral row'
  },
  {
    id: 'kroc_row',
    name: 'Kroc Row',
    category: 'accessory',
    targetMuscle: ['lats', 'traps', 'grip'],
    equipment: ['dumbbells'],
    fatigueCost: 'medium',
    description: 'High-rep heavy dumbbell rows'
  },
  {
    id: 'straight_arm_pulldown',
    name: 'Straight-Arm Pulldown',
    category: 'isolation',
    targetMuscle: ['lats'],
    equipment: ['cable'],
    fatigueCost: 'low',
    description: 'Lat isolation without biceps'
  },
  {
    id: 'shrug',
    name: 'Barbell Shrug',
    category: 'isolation',
    targetMuscle: ['traps'],
    equipment: ['barbell', 'dumbbells'],
    fatigueCost: 'low',
    description: 'Trap development'
  },

  // ARM ISOLATION
  {
    id: 'barbell_curl',
    name: 'Barbell Curl',
    category: 'isolation',
    targetMuscle: ['biceps'],
    equipment: ['barbell'],
    fatigueCost: 'low',
    description: 'Standard bicep development'
  },
  {
    id: 'dumbbell_curl',
    name: 'Dumbbell Curl',
    category: 'isolation',
    targetMuscle: ['biceps'],
    equipment: ['dumbbells'],
    fatigueCost: 'low',
    description: 'Unilateral bicep work'
  },
  {
    id: 'hammer_curl',
    name: 'Hammer Curl',
    category: 'isolation',
    targetMuscle: ['biceps', 'brachialis', 'forearms'],
    equipment: ['dumbbells'],
    fatigueCost: 'low',
    description: 'Neutral grip arm development'
  },
  {
    id: 'preacher_curl',
    name: 'Preacher Curl',
    category: 'isolation',
    targetMuscle: ['biceps'],
    equipment: ['barbell', 'dumbbells', 'machine'],
    fatigueCost: 'low',
    description: 'Isolated bicep curl'
  },
  {
    id: 'skullcrusher',
    name: 'Skullcrusher',
    category: 'isolation',
    targetMuscle: ['triceps'],
    equipment: ['barbell', 'dumbbells'],
    fatigueCost: 'low',
    description: 'Lying triceps extension'
  },
  {
    id: 'tricep_kickback',
    name: 'Tricep Kickback',
    category: 'isolation',
    targetMuscle: ['triceps'],
    equipment: ['dumbbells'],
    fatigueCost: 'low',
    description: 'Isolation tricep extension'
  },
  {
    id: 'cable_curl',
    name: 'Cable Curl',
    category: 'isolation',
    targetMuscle: ['biceps'],
    equipment: ['cable'],
    fatigueCost: 'low',
    description: 'Constant tension bicep work'
  },

  // ADDITIONAL LOWER BODY
  {
    id: 'hack_squat',
    name: 'Hack Squat',
    category: 'accessory',
    targetMuscle: ['quads', 'glutes'],
    equipment: ['machine'],
    fatigueCost: 'medium',
    description: 'Quad-focused machine squat'
  },
  {
    id: 'goblet_squat',
    name: 'Goblet Squat',
    category: 'accessory',
    targetMuscle: ['quads', 'glutes', 'core'],
    equipment: ['dumbbell', 'kettlebell'],
    fatigueCost: 'low',
    description: 'Front-loaded squat pattern'
  },
  {
    id: 'zercher_squat',
    name: 'Zercher Squat',
    category: 'accessory',
    targetMuscle: ['quads', 'upper_back', 'core'],
    equipment: ['barbell'],
    fatigueCost: 'medium',
    description: 'Front squat with elbow carry'
  },
  {
    id: 'safety_bar_squat',
    name: 'Safety Bar Squat',
    category: 'accessory',
    targetMuscle: ['quads', 'glutes'],
    equipment: ['safety_squat_bar', 'rack'],
    fatigueCost: 'high',
    description: 'Squat with cambered bar'
  },
  {
    id: 'box_squat',
    name: 'Box Squat',
    category: 'accessory',
    targetPhase: ['bottom'],
    targetMuscle: ['quads', 'glutes', 'hamstrings'],
    equipment: ['barbell', 'rack', 'box'],
    fatigueCost: 'high',
    description: 'Squat with pause on box'
  },
  {
    id: 'sumo_deadlift',
    name: 'Sumo Deadlift',
    category: 'compound',
    targetMuscle: ['quads', 'glutes', 'adductors'],
    equipment: ['barbell'],
    fatigueCost: 'high',
    description: 'Wide stance deadlift variation'
  },
  {
    id: 'trap_bar_deadlift',
    name: 'Trap Bar Deadlift',
    category: 'compound',
    targetMuscle: ['quads', 'glutes', 'hamstrings'],
    equipment: ['trap_bar'],
    fatigueCost: 'high',
    description: 'Deadlift with neutral grip'
  },
  {
    id: 'glute_ham_raise',
    name: 'Glute-Ham Raise',
    category: 'accessory',
    targetMuscle: ['hamstrings', 'glutes'],
    equipment: ['glute_ham_developer'],
    fatigueCost: 'medium',
    description: 'Hamstring eccentric strength'
  },
  {
    id: 'nordic_curl',
    name: 'Nordic Curl',
    category: 'accessory',
    targetMuscle: ['hamstrings'],
    equipment: ['bodyweight'],
    fatigueCost: 'medium',
    description: 'Bodyweight hamstring eccentric'
  },
  {
    id: 'back_extension',
    name: 'Back Extension',
    category: 'isolation',
    targetMuscle: ['erectors', 'glutes', 'hamstrings'],
    equipment: ['back_extension_bench'],
    fatigueCost: 'low',
    description: 'Posterior chain isolation'
  },
  {
    id: 'reverse_hyper',
    name: 'Reverse Hyperextension',
    category: 'isolation',
    targetMuscle: ['glutes', 'hamstrings', 'erectors'],
    equipment: ['reverse_hyper_machine'],
    fatigueCost: 'low',
    description: 'Hip extension with decompression'
  },
  {
    id: 'walking_lunge',
    name: 'Walking Lunge',
    category: 'accessory',
    targetMuscle: ['quads', 'glutes'],
    equipment: ['dumbbells', 'barbell'],
    fatigueCost: 'medium',
    description: 'Unilateral leg conditioning'
  },
  {
    id: 'step_up',
    name: 'Step-Up',
    category: 'accessory',
    targetMuscle: ['quads', 'glutes'],
    equipment: ['dumbbells', 'barbell', 'box'],
    fatigueCost: 'low',
    description: 'Unilateral leg strength'
  },
  {
    id: 'calf_raise',
    name: 'Calf Raise',
    category: 'isolation',
    targetMuscle: ['calves'],
    equipment: ['machine', 'dumbbells'],
    fatigueCost: 'low',
    description: 'Calf development'
  },
  {
    id: 'adductor_machine',
    name: 'Adductor Machine',
    category: 'isolation',
    targetMuscle: ['adductors'],
    equipment: ['machine'],
    fatigueCost: 'low',
    description: 'Inner thigh strength'
  },
  {
    id: 'abductor_machine',
    name: 'Abductor Machine',
    category: 'isolation',
    targetMuscle: ['abductors', 'glute_medius'],
    equipment: ['machine'],
    fatigueCost: 'low',
    description: 'Hip abductor strength'
  },

  // CHEST ISOLATION
  {
    id: 'cable_fly',
    name: 'Cable Fly',
    category: 'isolation',
    targetMuscle: ['chest'],
    equipment: ['cable'],
    fatigueCost: 'low',
    description: 'Chest stretch and contraction'
  },
  {
    id: 'dumbbell_fly',
    name: 'Dumbbell Fly',
    category: 'isolation',
    targetMuscle: ['chest'],
    equipment: ['dumbbells', 'bench'],
    fatigueCost: 'low',
    description: 'Chest stretch under load'
  },
  {
    id: 'pec_deck',
    name: 'Pec Deck',
    category: 'isolation',
    targetMuscle: ['chest'],
    equipment: ['machine'],
    fatigueCost: 'low',
    description: 'Machine chest isolation'
  },

  // OLYMPIC LIFTS
  {
    id: 'power_clean',
    name: 'Power Clean',
    category: 'compound',
    targetMuscle: ['traps', 'glutes', 'quads', 'erectors'],
    equipment: ['barbell'],
    fatigueCost: 'high',
    description: 'Explosive power development'
  },
  {
    id: 'hang_clean',
    name: 'Hang Clean',
    category: 'compound',
    targetMuscle: ['traps', 'glutes', 'hamstrings'],
    equipment: ['barbell'],
    fatigueCost: 'medium',
    description: 'Explosive hip extension'
  },
  {
    id: 'push_press',
    name: 'Push Press',
    category: 'compound',
    targetMuscle: ['anterior_deltoid', 'triceps', 'quads'],
    equipment: ['barbell'],
    fatigueCost: 'medium',
    description: 'Overhead press with leg drive'
  },

  // GRIP & FOREARMS
  {
    id: 'farmers_walk',
    name: "Farmer's Walk",
    category: 'accessory',
    targetMuscle: ['grip', 'forearms', 'traps', 'core'],
    equipment: ['dumbbells', 'trap_bar'],
    fatigueCost: 'low',
    description: 'Loaded carry for grip and stability'
  },
  {
    id: 'dead_hang',
    name: 'Dead Hang',
    category: 'isolation',
    targetMuscle: ['grip', 'forearms', 'lats'],
    equipment: ['pull_up_bar'],
    fatigueCost: 'low',
    description: 'Grip endurance and decompression'
  },
  {
    id: 'wrist_curl',
    name: 'Wrist Curl',
    category: 'isolation',
    targetMuscle: ['forearms'],
    equipment: ['dumbbells', 'barbell'],
    fatigueCost: 'low',
    description: 'Forearm flexor development'
  },
  {
    id: 'reverse_wrist_curl',
    name: 'Reverse Wrist Curl',
    category: 'isolation',
    targetMuscle: ['forearms'],
    equipment: ['dumbbells', 'barbell'],
    fatigueCost: 'low',
    description: 'Forearm extensor development'
  },

  // PAUSED/TEMPO VARIATIONS
  {
    id: 'paused_bench_press',
    name: 'Paused Bench Press',
    category: 'accessory',
    targetPhase: ['bottom'],
    targetMuscle: ['chest', 'triceps'],
    equipment: ['barbell', 'bench'],
    fatigueCost: 'high',
    description: 'Bottom position strength without stretch reflex'
  },
  {
    id: 'paused_deadlift',
    name: 'Paused Deadlift',
    category: 'accessory',
    targetPhase: ['initial_pull', 'knee_level'],
    targetMuscle: ['hamstrings', 'glutes', 'erectors'],
    equipment: ['barbell'],
    fatigueCost: 'high',
    description: 'Sticking point strength work'
  },
  {
    id: 'tempo_squat',
    name: 'Tempo Squat',
    category: 'accessory',
    targetPhase: ['descent', 'bottom'],
    targetMuscle: ['quads', 'glutes'],
    equipment: ['barbell', 'rack'],
    fatigueCost: 'high',
    description: 'Slow eccentric for time under tension'
  }
];

export function getExerciseById(id: string): Exercise | undefined {
  return exercises.find(ex => ex.id === id);
}

export function getExercisesByLift(liftId: string): Exercise[] {
  // Return relevant exercises for snapshot entry based on selected lift
  const liftMappings: Record<string, string[]> = {
    flat_bench_press: [
      'flat_bench_press',
      'incline_bench_press',
      'close_grip_bench_press',
      'dumbbell_bench_press',
      'overhead_press',
      'dips',
      'rope_pressdown',
      'overhead_triceps_extension',
      'barbell_row',
      'chest_supported_row',
      'face_pull'
    ],
    incline_bench_press: [
      'incline_bench_press',
      'flat_bench_press',
      'dumbbell_incline_press',
      'overhead_press',
      'dips',
      'rope_pressdown',
      'cable_row',
      'face_pull'
    ],
    deadlift: [
      'deadlift',
      'romanian_deadlift',
      'rack_pull',
      'deficit_deadlift',
      'good_morning',
      'leg_curl',
      'hip_thrust',
      'barbell_row'
    ],
    barbell_back_squat: [
      'barbell_back_squat',
      'barbell_front_squat',
      'pause_squat',
      'leg_press',
      'bulgarian_split_squat',
      'leg_extension',
      'romanian_deadlift',
      'good_morning'
    ],
    barbell_front_squat: [
      'barbell_front_squat',
      'barbell_back_squat',
      'pause_squat',
      'leg_press',
      'bulgarian_split_squat',
      'leg_extension',
      'romanian_deadlift'
    ]
  };

  const exerciseIds = liftMappings[liftId] || [];
  return exerciseIds.map(id => getExerciseById(id)).filter(Boolean) as Exercise[];
}
