export interface Lift {
  id: string;
  name: string;
  category: string;
  description: string;
  phases: LiftPhase[];
  commonLimiters: Limiter[];
}

export interface LiftPhase {
  id: string;
  name: string;
  description: string;
  commonIssues: string[];
}

export interface Limiter {
  id: string;
  name: string;
  description: string;
  diagnosticQuestions: string[];
  targetMuscles: string[];
  indicatorExercises?: string[]; // Exercise IDs that indicate this limiter
}

export const lifts: Lift[] = [
  {
    id: 'flat_bench_press',
    name: 'Flat Bench Press',
    category: 'upper_push',
    description: 'Primary horizontal pressing movement for chest, triceps, and anterior deltoids',
    phases: [
      {
        id: 'setup',
        name: 'Setup & Unrack',
        description: 'Shoulder blade retraction, arch, grip width',
        commonIssues: ['Unstable shoulder position', 'Poor arch', 'Grip too wide/narrow']
      },
      {
        id: 'descent',
        name: 'Descent',
        description: 'Controlled eccentric to touch point',
        commonIssues: ['Bar drifts forward', 'Elbows flare excessively', 'Loss of tightness']
      },
      {
        id: 'bottom',
        name: 'Bottom Position',
        description: 'Touch point and reversal',
        commonIssues: ['Weak off chest', 'Pause difficulty', 'Shoulder pain']
      },
      {
        id: 'ascent',
        name: 'Mid-Range Press',
        description: 'Drive from chest to mid-point',
        commonIssues: ['Stall at mid-point', 'Bar path deviation', 'Leg drive loss']
      },
      {
        id: 'lockout',
        name: 'Lockout',
        description: 'Final triceps extension',
        commonIssues: ['Slow lockout', 'Triceps fatigue', 'Elbow positioning']
      }
    ],
    commonLimiters: [
      {
        id: 'triceps_lockout_strength',
        name: 'Triceps Lockout Strength',
        description: 'Inability to complete final extension phase',
        diagnosticQuestions: [
          'Does the bar slow down most in the final few inches?',
          'Do your triceps fatigue quickly on pressing movements?',
          'Is your close-grip bench significantly weaker than regular bench?'
        ],
        targetMuscles: ['triceps'],
        indicatorExercises: ['close_grip_bench_press', 'overhead_triceps_extension']
      },
      {
        id: 'chest_strength',
        name: 'Chest Strength Off Bottom',
        description: 'Weak reversal from bottom position',
        diagnosticQuestions: [
          'Is the hardest part right off your chest?',
          'Do pause reps feel significantly harder?',
          'Does the bar slow immediately after touching your chest?'
        ],
        targetMuscles: ['chest', 'anterior_deltoid'],
        indicatorExercises: ['dumbbell_bench_press', 'dumbbell_incline_press']
      },
      {
        id: 'upper_back_stability',
        name: 'Upper Back Stability',
        description: 'Insufficient scapular and lat tension',
        diagnosticQuestions: [
          'Does the bar drift forward or backward during the lift?',
          'Do you struggle to maintain shoulder blade retraction?',
          'Does your upper back feel unstable under heavier loads?'
        ],
        targetMuscles: ['lats', 'rhomboids', 'traps'],
        indicatorExercises: ['barbell_row', 'chest_supported_row']
      },
      {
        id: 'shoulder_health',
        name: 'Shoulder Health & Stability',
        description: 'Rotator cuff or shoulder discomfort limiting performance',
        diagnosticQuestions: [
          'Do you experience any shoulder discomfort during or after benching?',
          'Does your shoulder feel unstable in the bottom position?',
          'Do you have limited shoulder mobility?'
        ],
        targetMuscles: ['rotator_cuff', 'rear_deltoid'],
        indicatorExercises: ['face_pull', 'external_rotation']
      }
    ]
  },
  {
    id: 'incline_bench_press',
    name: 'Incline Bench Press',
    category: 'upper_push',
    description: 'Upper chest and anterior deltoid emphasis pressing',
    phases: [
      {
        id: 'setup',
        name: 'Setup',
        description: 'Bench angle, shoulder position',
        commonIssues: ['Angle too steep', 'Poor shoulder positioning']
      },
      {
        id: 'descent',
        name: 'Descent',
        description: 'Controlled lowering to upper chest',
        commonIssues: ['Bar drifts', 'Elbow flare']
      },
      {
        id: 'bottom',
        name: 'Bottom',
        description: 'Touch point and reversal',
        commonIssues: ['Weak off chest', 'Shoulder strain']
      },
      {
        id: 'ascent',
        name: 'Press',
        description: 'Drive to lockout',
        commonIssues: ['Mid-point stall', 'Shoulder fatigue']
      },
      {
        id: 'lockout',
        name: 'Lockout',
        description: 'Final extension',
        commonIssues: ['Triceps fatigue']
      }
    ],
    commonLimiters: [
      {
        id: 'upper_chest_strength',
        name: 'Upper Chest Strength',
        description: 'Underdeveloped upper pectorals',
        diagnosticQuestions: [
          'Is incline significantly weaker than flat bench?',
          'Do you feel more anterior deltoid than chest activation?'
        ],
        targetMuscles: ['upper_chest'],
        indicatorExercises: ['dumbbell_incline_press']
      },
      {
        id: 'anterior_deltoid_strength',
        name: 'Anterior Deltoid Strength',
        description: 'Front delt limiting factor on incline',
        diagnosticQuestions: [
          'Do your shoulders fatigue first on incline?',
          'Is your overhead press weak relative to flat bench?'
        ],
        targetMuscles: ['anterior_deltoid'],
        indicatorExercises: ['overhead_press']
      },
      {
        id: 'triceps_lockout_strength',
        name: 'Triceps Lockout',
        description: 'Weak lockout phase',
        diagnosticQuestions: [
          'Does the lockout slow down significantly?'
        ],
        targetMuscles: ['triceps'],
        indicatorExercises: ['close_grip_bench_press']
      }
    ]
  },
  {
    id: 'deadlift',
    name: 'Deadlift',
    category: 'lower_pull',
    description: 'Hip hinge posterior chain movement',
    phases: [
      {
        id: 'setup',
        name: 'Setup',
        description: 'Bar position, hip height, tension',
        commonIssues: ['Hips too high/low', 'No tension before pull', 'Poor back position']
      },
      {
        id: 'initial_pull',
        name: 'Off the Floor',
        description: 'Breaking the bar from the floor',
        commonIssues: ['Hips shoot up', 'Back rounds', 'Slow off floor']
      },
      {
        id: 'knee_level',
        name: 'Past Knees',
        description: 'Bar traveling past knee level',
        commonIssues: ['Bar drifts forward', 'Hips stall']
      },
      {
        id: 'lockout',
        name: 'Lockout',
        description: 'Hip extension and standing tall',
        commonIssues: ['Slow lockout', 'Lean back excessively', 'Grip fails']
      }
    ],
    commonLimiters: [
      {
        id: 'off_floor_strength',
        name: 'Off Floor Strength',
        description: 'Difficulty breaking the bar from the floor',
        diagnosticQuestions: [
          'Is the hardest part getting the bar off the floor?',
          'Do your quads fatigue quickly?',
          'Is your squat weak relative to deadlift?'
        ],
        targetMuscles: ['quads', 'hamstrings'],
        indicatorExercises: ['deficit_deadlift', 'pause_squat']
      },
      {
        id: 'lockout_strength',
        name: 'Lockout Strength',
        description: 'Weak hip extension at top',
        diagnosticQuestions: [
          'Does the bar slow down at knee level or above?',
          'Do you struggle to fully extend your hips?',
          'Are rack pulls significantly stronger than full deadlifts?'
        ],
        targetMuscles: ['glutes', 'erectors', 'traps'],
        indicatorExercises: ['rack_pull', 'hip_thrust', 'romanian_deadlift']
      },
      {
        id: 'back_position',
        name: 'Back Position & Bracing',
        description: 'Inability to maintain neutral spine',
        diagnosticQuestions: [
          'Does your back round during the pull?',
          'Do you struggle with bracing?',
          'Does your torso collapse forward?'
        ],
        targetMuscles: ['erectors', 'core', 'lats'],
        indicatorExercises: ['good_morning', 'barbell_row']
      },
      {
        id: 'grip_strength',
        name: 'Grip Strength',
        description: 'Grip fails before posterior chain',
        diagnosticQuestions: [
          'Does the bar slip from your hands?',
          'Can you lift more with straps?',
          'Do your forearms fatigue quickly?'
        ],
        targetMuscles: ['forearms'],
        indicatorExercises: []
      }
    ]
  },
  {
    id: 'barbell_back_squat',
    name: 'Barbell Back Squat',
    category: 'lower_push',
    description: 'Primary lower body compound movement',
    phases: [
      {
        id: 'setup',
        name: 'Setup & Walkout',
        description: 'Bar position, stance, bracing',
        commonIssues: ['Unstable unrack', 'Poor bracing', 'Foot positioning']
      },
      {
        id: 'descent',
        name: 'Descent',
        description: 'Controlled eccentric to depth',
        commonIssues: ['Knees cave in', 'Forward lean', 'Loss of bracing']
      },
      {
        id: 'bottom',
        name: 'Bottom Position',
        description: 'Hole depth and reversal',
        commonIssues: ['Weak out of hole', 'Butt wink', 'Balance issues', 'Mobility limitations']
      },
      {
        id: 'ascent',
        name: 'Ascent',
        description: 'Drive from bottom to standing',
        commonIssues: ['Hips shoot up', 'Knees collapse', 'Good morning squat', 'Sticking point']
      }
    ],
    commonLimiters: [
      {
        id: 'quad_strength',
        name: 'Quad Strength',
        description: 'Weak knee extension power',
        diagnosticQuestions: [
          'Do you struggle most in the bottom third of the squat?',
          'Do your hips shoot up faster than your chest?',
          'Is your front squat very weak compared to back squat?'
        ],
        targetMuscles: ['quads'],
        indicatorExercises: ['barbell_front_squat', 'leg_press', 'leg_extension']
      },
      {
        id: 'glute_hip_strength',
        name: 'Glute & Hip Strength',
        description: 'Weak hip extension out of the hole',
        diagnosticQuestions: [
          'Do you feel like you collapse forward?',
          'Is your deadlift significantly stronger than your squat?',
          'Do pause squats feel extremely difficult?'
        ],
        targetMuscles: ['glutes', 'hamstrings'],
        indicatorExercises: ['pause_squat', 'hip_thrust', 'bulgarian_split_squat']
      },
      {
        id: 'core_bracing',
        name: 'Core & Bracing',
        description: 'Inability to maintain trunk stability',
        diagnosticQuestions: [
          'Does your torso collapse forward under load?',
          'Do you struggle to maintain tightness through the lift?',
          'Does your lower back round or hyperextend?'
        ],
        targetMuscles: ['core', 'erectors'],
        indicatorExercises: ['good_morning', 'plank', 'pallof_press']
      },
      {
        id: 'mobility',
        name: 'Mobility Limitations',
        description: 'Ankle, hip, or thoracic mobility restrictions',
        diagnosticQuestions: [
          'Do you struggle to reach proper depth?',
          'Do your heels lift off the ground?',
          'Does your lower back round at the bottom (butt wink)?'
        ],
        targetMuscles: [],
        indicatorExercises: []
      }
    ]
  },
  {
    id: 'barbell_front_squat',
    name: 'Barbell Front Squat',
    category: 'lower_push',
    description: 'Quad-dominant squat with upper back demand',
    phases: [
      {
        id: 'setup',
        name: 'Setup & Rack Position',
        description: 'Front rack, elbows up, bracing',
        commonIssues: ['Poor rack position', 'Elbows drop', 'Wrist discomfort']
      },
      {
        id: 'descent',
        name: 'Descent',
        description: 'Controlled lowering maintaining upright torso',
        commonIssues: ['Torso leans forward', 'Knees cave', 'Bar rolls forward']
      },
      {
        id: 'bottom',
        name: 'Bottom',
        description: 'Deep squat position',
        commonIssues: ['Weak out of hole', 'Elbows drop', 'Balance loss']
      },
      {
        id: 'ascent',
        name: 'Ascent',
        description: 'Drive while staying upright',
        commonIssues: ['Torso collapse', 'Bar dumps forward', 'Knee valgus']
      }
    ],
    commonLimiters: [
      {
        id: 'quad_strength',
        name: 'Quad Strength',
        description: 'Primary limiter in front squat',
        diagnosticQuestions: [
          'Do you fail in the bottom position?',
          'Is the ascent extremely slow?'
        ],
        targetMuscles: ['quads'],
        indicatorExercises: ['leg_press', 'leg_extension', 'bulgarian_split_squat']
      },
      {
        id: 'upper_back_strength',
        name: 'Upper Back Strength',
        description: 'Cannot maintain upright torso',
        diagnosticQuestions: [
          'Does your torso collapse forward?',
          'Do your elbows drop during the rep?',
          'Is your upper back weak or tired?'
        ],
        targetMuscles: ['upper_back', 'traps'],
        indicatorExercises: ['barbell_row', 'tbar_row']
      },
      {
        id: 'core_bracing',
        name: 'Core Stability',
        description: 'Weak anterior core',
        diagnosticQuestions: [
          'Do you lose tightness in the bottom?',
          'Does your core feel like the weak link?'
        ],
        targetMuscles: ['core', 'abs'],
        indicatorExercises: ['plank', 'pallof_press']
      },
      {
        id: 'mobility',
        name: 'Mobility (Ankle/Wrist/Thoracic)',
        description: 'Limited range of motion',
        diagnosticQuestions: [
          'Do you struggle to maintain the front rack?',
          'Do your heels lift?',
          'Can you squat deep while staying upright?'
        ],
        targetMuscles: [],
        indicatorExercises: []
      }
    ]
  }
];

export function getLiftById(id: string): Lift | undefined {
  return lifts.find(lift => lift.id === id);
}
