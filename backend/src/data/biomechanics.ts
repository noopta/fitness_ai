// Detailed biomechanics knowledge for each compound lift
export interface LiftBiomechanics {
  liftId: string;
  liftName: string;
  movementPhases: MovementPhase[];
  strengthRatios: StrengthRatio[];
  commonWeaknesses: string[];
}

export interface MovementPhase {
  phaseName: string;
  rangeOfMotion: string; // e.g., "0-30 degrees" or "bottom 6 inches"
  primaryMuscles: MuscleActivation[];
  secondaryMuscles: MuscleActivation[];
  mechanicalFocus: string;
  commonFailurePoint: string;
}

export interface MuscleActivation {
  muscle: string;
  activationLevel: 'primary' | 'secondary' | 'stabilizer';
  fiberType: 'fast-twitch' | 'slow-twitch' | 'mixed';
  role: string;
}

export interface StrengthRatio {
  comparisonExercise: string;
  expectedRatio: string; // e.g., "0.8-0.9x" or "80-90%"
  interpretation: string;
}

export const liftBiomechanics: LiftBiomechanics[] = [
  {
    liftId: 'flat_bench_press',
    liftName: 'Flat Bench Press',
    movementPhases: [
      {
        phaseName: 'Bottom Position (0-2 inches off chest)',
        rangeOfMotion: '0-20% of ROM',
        primaryMuscles: [
          {
            muscle: 'Pectoralis Major (sternal head)',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Primary mover for horizontal adduction and reversal out of stretch'
          },
          {
            muscle: 'Anterior Deltoid',
            activationLevel: 'primary',
            fiberType: 'mixed',
            role: 'Shoulder flexion and initial drive'
          }
        ],
        secondaryMuscles: [
          {
            muscle: 'Lats (eccentric)',
            activationLevel: 'stabilizer',
            fiberType: 'slow-twitch',
            role: 'Control descent and maintain bar path'
          },
          {
            muscle: 'Serratus Anterior',
            activationLevel: 'stabilizer',
            fiberType: 'slow-twitch',
            role: 'Scapular stability'
          }
        ],
        mechanicalFocus: 'Stretch-shortening cycle, chest stretch reflex, reversal strength',
        commonFailurePoint: 'Weak off chest - often indicates insufficient pec strength or poor stretch reflex utilization'
      },
      {
        phaseName: 'Early Mid-Range (2-6 inches)',
        rangeOfMotion: '20-50% of ROM',
        primaryMuscles: [
          {
            muscle: 'Pectoralis Major (all heads)',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Horizontal adduction and pressing'
          },
          {
            muscle: 'Anterior Deltoid',
            activationLevel: 'primary',
            fiberType: 'mixed',
            role: 'Shoulder flexion'
          },
          {
            muscle: 'Triceps (long head)',
            activationLevel: 'secondary',
            fiberType: 'mixed',
            role: 'Beginning elbow extension'
          }
        ],
        secondaryMuscles: [
          {
            muscle: 'Upper Back (rhomboids, traps)',
            activationLevel: 'stabilizer',
            fiberType: 'slow-twitch',
            role: 'Maintain scapular retraction and stable base'
          }
        ],
        mechanicalFocus: 'Transition from stretch to concentric, maintaining bar path, leg drive transfer',
        commonFailurePoint: 'Sticking point 2-4 inches off chest - indicates overall pressing strength deficit or technique breakdown'
      },
      {
        phaseName: 'Late Mid-Range to Lockout (6+ inches)',
        rangeOfMotion: '50-100% of ROM',
        primaryMuscles: [
          {
            muscle: 'Triceps (all heads)',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Primary elbow extension'
          },
          {
            muscle: 'Pectoralis Major (clavicular head)',
            activationLevel: 'secondary',
            fiberType: 'mixed',
            role: 'Finish horizontal adduction'
          }
        ],
        secondaryMuscles: [
          {
            muscle: 'Anterior Deltoid',
            activationLevel: 'secondary',
            fiberType: 'mixed',
            role: 'Final shoulder flexion'
          }
        ],
        mechanicalFocus: 'Triceps dominance, elbow extension mechanics, lockout strength',
        commonFailurePoint: 'Slow lockout - indicates triceps weakness or fatigue'
      }
    ],
    strengthRatios: [
      {
        comparisonExercise: 'Close-Grip Bench Press',
        expectedRatio: '85-95% of flat bench',
        interpretation: 'If < 80%, indicates significant triceps weakness. If > 95%, may indicate chest is the limiter.'
      },
      {
        comparisonExercise: 'Incline Bench Press',
        expectedRatio: '80-90% of flat bench',
        interpretation: 'If < 75%, indicates weak upper chest or anterior delts. Normal to be 10-20% weaker.'
      },
      {
        comparisonExercise: 'Overhead Press',
        expectedRatio: '60-70% of flat bench',
        interpretation: 'If < 55%, indicates weak shoulders. If > 75%, chest may be underdeveloped relative to shoulders.'
      },
      {
        comparisonExercise: 'Dumbbell Bench Press',
        expectedRatio: '70-80% of flat bench (per dumbbell)',
        interpretation: 'If much weaker, indicates stabilizer weakness or unilateral imbalance.'
      },
      {
        comparisonExercise: 'Barbell Row',
        expectedRatio: '70-80% of flat bench',
        interpretation: 'Upper back strength for stable base. If < 65%, stability may be limiting bench.'
      }
    ],
    commonWeaknesses: [
      'Triceps lockout strength (indicated by slow final 2-3 inches)',
      'Chest strength off bottom (pause bench significantly harder)',
      'Upper back stability (bar path deviates, shoulders feel unstable)',
      'Shoulder health (pain or discomfort limits load or ROM)',
      'Leg drive integration (cannot transfer lower body power)'
    ]
  },
  {
    liftId: 'incline_bench_press',
    liftName: 'Incline Bench Press',
    movementPhases: [
      {
        phaseName: 'Bottom Position',
        rangeOfMotion: '0-20% of ROM',
        primaryMuscles: [
          {
            muscle: 'Pectoralis Major (clavicular head)',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Upper chest activation in stretch position'
          },
          {
            muscle: 'Anterior Deltoid',
            activationLevel: 'primary',
            fiberType: 'mixed',
            role: 'Shoulder flexion from stretched position'
          }
        ],
        secondaryMuscles: [
          {
            muscle: 'Rotator Cuff',
            activationLevel: 'stabilizer',
            fiberType: 'slow-twitch',
            role: 'Shoulder joint stability in vulnerable position'
          }
        ],
        mechanicalFocus: 'Upper chest stretch, anterior delt engagement, shoulder stability',
        commonFailurePoint: 'Weak off chest indicates upper chest or anterior delt weakness'
      },
      {
        phaseName: 'Mid-Range Press',
        rangeOfMotion: '20-70% of ROM',
        primaryMuscles: [
          {
            muscle: 'Anterior Deltoid',
            activationLevel: 'primary',
            fiberType: 'mixed',
            role: 'Primary mover in shoulder flexion plane'
          },
          {
            muscle: 'Pectoralis Major (clavicular)',
            activationLevel: 'primary',
            fiberType: 'mixed',
            role: 'Upper chest pressing'
          },
          {
            muscle: 'Triceps (long head)',
            activationLevel: 'secondary',
            fiberType: 'mixed',
            role: 'Elbow extension'
          }
        ],
        secondaryMuscles: [],
        mechanicalFocus: 'Shoulder flexion dominant, anterior delt endurance',
        commonFailurePoint: 'Mid-range stall indicates anterior delt fatigue or weakness'
      },
      {
        phaseName: 'Lockout',
        rangeOfMotion: '70-100% of ROM',
        primaryMuscles: [
          {
            muscle: 'Triceps',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Elbow extension to lockout'
          }
        ],
        secondaryMuscles: [],
        mechanicalFocus: 'Triceps extension',
        commonFailurePoint: 'Slow lockout indicates triceps weakness'
      }
    ],
    strengthRatios: [
      {
        comparisonExercise: 'Flat Bench Press',
        expectedRatio: '80-90% of incline',
        interpretation: 'Flat should be 10-20% stronger. If gap is larger, upper chest/front delts are weak.'
      },
      {
        comparisonExercise: 'Overhead Press',
        expectedRatio: '65-75% of incline',
        interpretation: 'If OHP is very weak, anterior delts are the limiter on incline.'
      },
      {
        comparisonExercise: 'Dumbbell Incline Press',
        expectedRatio: '70-80% per dumbbell',
        interpretation: 'If much weaker, stability or unilateral strength is lacking.'
      }
    ],
    commonWeaknesses: [
      'Anterior deltoid strength (primary limiter on incline)',
      'Upper chest development',
      'Triceps lockout',
      'Shoulder stability and health'
    ]
  },
  {
    liftId: 'deadlift',
    liftName: 'Deadlift',
    movementPhases: [
      {
        phaseName: 'Off the Floor (0-2 inches)',
        rangeOfMotion: 'Floor to bar at mid-shin',
        primaryMuscles: [
          {
            muscle: 'Quadriceps',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Knee extension to break bar from floor'
          },
          {
            muscle: 'Hamstrings (isometric)',
            activationLevel: 'primary',
            fiberType: 'mixed',
            role: 'Hip extension and maintaining back angle'
          },
          {
            muscle: 'Erector Spinae',
            activationLevel: 'primary',
            fiberType: 'slow-twitch',
            role: 'Isometric back extension, preventing spinal flexion'
          }
        ],
        secondaryMuscles: [
          {
            muscle: 'Lats',
            activationLevel: 'stabilizer',
            fiberType: 'slow-twitch',
            role: 'Keep bar close to body, prevent forward drift'
          },
          {
            muscle: 'Core/Abs',
            activationLevel: 'stabilizer',
            fiberType: 'slow-twitch',
            role: 'Bracing and spinal stability'
          }
        ],
        mechanicalFocus: 'Leg drive, creating tension, breaking inertia',
        commonFailurePoint: 'Slow off floor indicates quad weakness, poor starting position, or insufficient leg drive'
      },
      {
        phaseName: 'Past Knees (shin to knee height)',
        rangeOfMotion: 'Mid-shin to knee level',
        primaryMuscles: [
          {
            muscle: 'Hamstrings',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Hip extension as knees extend'
          },
          {
            muscle: 'Glutes',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Hip extension power'
          },
          {
            muscle: 'Erector Spinae',
            activationLevel: 'primary',
            fiberType: 'slow-twitch',
            role: 'Maintain back angle against increasing moment arm'
          }
        ],
        secondaryMuscles: [
          {
            muscle: 'Lats',
            activationLevel: 'stabilizer',
            fiberType: 'slow-twitch',
            role: 'Keep bar path vertical'
          }
        ],
        mechanicalFocus: 'Hip extension, posterior chain engagement, back position maintenance',
        commonFailurePoint: 'Stall at knees indicates hamstring/glute weakness or back position breakdown'
      },
      {
        phaseName: 'Lockout (knee to standing)',
        rangeOfMotion: 'Knee height to full hip extension',
        primaryMuscles: [
          {
            muscle: 'Glutes',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Final hip extension to vertical'
          },
          {
            muscle: 'Erector Spinae (upper)',
            activationLevel: 'primary',
            fiberType: 'mixed',
            role: 'Thoracic extension to stand tall'
          },
          {
            muscle: 'Traps (upper)',
            activationLevel: 'secondary',
            fiberType: 'slow-twitch',
            role: 'Finish pulling shoulders back'
          }
        ],
        secondaryMuscles: [
          {
            muscle: 'Forearms/Grip',
            activationLevel: 'stabilizer',
            fiberType: 'slow-twitch',
            role: 'Maintain grip on bar'
          }
        ],
        mechanicalFocus: 'Hip lockout, glute squeeze, full body extension',
        commonFailurePoint: 'Slow lockout indicates weak glutes, erectors, or grip failure'
      }
    ],
    strengthRatios: [
      {
        comparisonExercise: 'Back Squat',
        expectedRatio: '110-130% of squat',
        interpretation: 'Deadlift typically 10-30% stronger. If less, posterior chain is weak. If much more, quads may be limiting squat.'
      },
      {
        comparisonExercise: 'Romanian Deadlift (RDL)',
        expectedRatio: '65-75% of deadlift',
        interpretation: 'If RDL is very weak, hamstring and hip hinge strength is lacking.'
      },
      {
        comparisonExercise: 'Rack Pull (from knee height)',
        expectedRatio: '115-130% of deadlift',
        interpretation: 'If rack pull is only slightly stronger, lockout strength is the limiter. If much stronger, off-floor strength is weak.'
      },
      {
        comparisonExercise: 'Deficit Deadlift',
        expectedRatio: '85-95% of deadlift',
        interpretation: 'If much weaker, indicates off-floor weakness (quads, starting position).'
      },
      {
        comparisonExercise: 'Barbell Row',
        expectedRatio: '50-65% of deadlift',
        interpretation: 'Upper back strength for maintaining position. If very weak, back stability is compromised.'
      }
    ],
    commonWeaknesses: [
      'Off floor strength (quads, starting position, leg drive)',
      'Lockout strength (glutes, hip extension, upper back)',
      'Back position and bracing (erectors, core, lats)',
      'Grip strength (forearms, hand strength)',
      'Hamstring strength (hip hinge pattern)'
    ]
  },
  {
    liftId: 'barbell_back_squat',
    liftName: 'Barbell Back Squat',
    movementPhases: [
      {
        phaseName: 'Descent',
        rangeOfMotion: 'Standing to bottom',
        primaryMuscles: [
          {
            muscle: 'Quadriceps (eccentric)',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Control knee flexion'
          },
          {
            muscle: 'Glutes (eccentric)',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Control hip flexion'
          },
          {
            muscle: 'Erector Spinae',
            activationLevel: 'stabilizer',
            fiberType: 'slow-twitch',
            role: 'Maintain spinal position'
          }
        ],
        secondaryMuscles: [
          {
            muscle: 'Core',
            activationLevel: 'stabilizer',
            fiberType: 'slow-twitch',
            role: 'Bracing and trunk stability'
          },
          {
            muscle: 'Adductors',
            activationLevel: 'stabilizer',
            fiberType: 'mixed',
            role: 'Hip stability and control'
          }
        ],
        mechanicalFocus: 'Controlled eccentric, maintaining balance, storing elastic energy',
        commonFailurePoint: 'Loss of tightness, knees caving, forward lean indicates mobility or stability issues'
      },
      {
        phaseName: 'Bottom Position / Hole',
        rangeOfMotion: 'Deepest position',
        primaryMuscles: [
          {
            muscle: 'Quadriceps',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Initiating knee extension from deep flexion'
          },
          {
            muscle: 'Glutes',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Hip extension from deep hip flexion'
          },
          {
            muscle: 'Adductors',
            activationLevel: 'secondary',
            fiberType: 'mixed',
            role: 'Hip stability and preventing knee valgus'
          }
        ],
        secondaryMuscles: [
          {
            muscle: 'Hamstrings',
            activationLevel: 'secondary',
            fiberType: 'mixed',
            role: 'Hip extension contribution'
          }
        ],
        mechanicalFocus: 'Reversal strength, stretch reflex, simultaneous hip and knee extension',
        commonFailurePoint: 'Weak out of hole indicates quad or glute weakness, or loss of tightness'
      },
      {
        phaseName: 'Ascent / Drive',
        rangeOfMotion: 'Bottom to standing',
        primaryMuscles: [
          {
            muscle: 'Quadriceps',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Primary knee extension throughout ascent'
          },
          {
            muscle: 'Glutes',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Hip extension, especially in later half of ascent'
          },
          {
            muscle: 'Erector Spinae',
            activationLevel: 'primary',
            fiberType: 'mixed',
            role: 'Maintain torso angle, prevent forward collapse'
          }
        ],
        secondaryMuscles: [
          {
            muscle: 'Hamstrings',
            activationLevel: 'secondary',
            fiberType: 'mixed',
            role: 'Hip extension assistance'
          },
          {
            muscle: 'Core',
            activationLevel: 'stabilizer',
            fiberType: 'slow-twitch',
            role: 'Transfer force, prevent energy leaks'
          }
        ],
        mechanicalFocus: 'Coordinated hip and knee extension, maintaining bar path, force production',
        commonFailurePoint: 'Hips shooting up indicates quad weakness. Sticking point mid-ascent indicates overall leg strength deficit. Forward collapse indicates core or erector weakness.'
      }
    ],
    strengthRatios: [
      {
        comparisonExercise: 'Front Squat',
        expectedRatio: '80-90% of back squat',
        interpretation: 'Front squat should be 10-20% weaker. If gap is larger, quad strength or upper back is weak.'
      },
      {
        comparisonExercise: 'Deadlift',
        expectedRatio: '75-90% of deadlift',
        interpretation: 'If squat is much weaker than deadlift, quads are the limiter. If closer, posterior chain may be weak.'
      },
      {
        comparisonExercise: 'Leg Press',
        expectedRatio: '150-200% of back squat',
        interpretation: 'If leg press isn\'t significantly stronger, core/stability is limiting squat, not leg strength.'
      },
      {
        comparisonExercise: 'Bulgarian Split Squat',
        expectedRatio: '30-40% of back squat per leg',
        interpretation: 'Indicates unilateral strength and balance. If very weak, single-leg work needed.'
      },
      {
        comparisonExercise: 'Pause Squat',
        expectedRatio: '85-95% of back squat',
        interpretation: 'If pause squat is much weaker, indicates reliance on bounce/stretch reflex. True strength out of hole is weak.'
      }
    ],
    commonWeaknesses: [
      'Quad strength (weak out of hole, hips shoot up)',
      'Glute and hip extension (forward collapse, slow ascent)',
      'Core and bracing (cannot maintain tightness, torso instability)',
      'Mobility limitations (cannot reach depth, heels lift, butt wink)',
      'Upper back strength (bar rolls forward, cannot stay upright)'
    ]
  },
  {
    liftId: 'barbell_front_squat',
    liftName: 'Barbell Front Squat',
    movementPhases: [
      {
        phaseName: 'Descent',
        rangeOfMotion: 'Standing to bottom',
        primaryMuscles: [
          {
            muscle: 'Quadriceps (eccentric)',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Control knee flexion while staying upright'
          },
          {
            muscle: 'Upper Back (traps, rhomboids)',
            activationLevel: 'primary',
            fiberType: 'slow-twitch',
            role: 'Maintain front rack position and upright torso'
          },
          {
            muscle: 'Core (anterior)',
            activationLevel: 'primary',
            fiberType: 'slow-twitch',
            role: 'Prevent torso from collapsing forward'
          }
        ],
        secondaryMuscles: [
          {
            muscle: 'Glutes (eccentric)',
            activationLevel: 'secondary',
            fiberType: 'mixed',
            role: 'Control hip flexion'
          }
        ],
        mechanicalFocus: 'Maintaining vertical torso, elbows up, controlled descent',
        commonFailurePoint: 'Torso leans forward, elbows drop, indicates upper back or core weakness'
      },
      {
        phaseName: 'Bottom Position',
        rangeOfMotion: 'Deep squat',
        primaryMuscles: [
          {
            muscle: 'Quadriceps',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Initiate knee extension from maximal flexion'
          },
          {
            muscle: 'Upper Back',
            activationLevel: 'primary',
            fiberType: 'mixed',
            role: 'Prevent torso collapse under load'
          }
        ],
        secondaryMuscles: [
          {
            muscle: 'Glutes',
            activationLevel: 'secondary',
            fiberType: 'fast-twitch',
            role: 'Hip extension contribution'
          },
          {
            muscle: 'Core',
            activationLevel: 'stabilizer',
            fiberType: 'slow-twitch',
            role: 'Trunk stability'
          }
        ],
        mechanicalFocus: 'Extreme quad demand, upright torso maintenance, reversal out of deep position',
        commonFailurePoint: 'Cannot stand up from bottom indicates quad weakness'
      },
      {
        phaseName: 'Ascent',
        rangeOfMotion: 'Bottom to standing',
        primaryMuscles: [
          {
            muscle: 'Quadriceps',
            activationLevel: 'primary',
            fiberType: 'fast-twitch',
            role: 'Dominant muscle group for entire ascent'
          },
          {
            muscle: 'Upper Back',
            activationLevel: 'primary',
            fiberType: 'mixed',
            role: 'Keep torso vertical throughout ascent'
          },
          {
            muscle: 'Core',
            activationLevel: 'primary',
            fiberType: 'slow-twitch',
            role: 'Transfer force, maintain rigidity'
          }
        ],
        secondaryMuscles: [
          {
            muscle: 'Glutes',
            activationLevel: 'secondary',
            fiberType: 'mixed',
            role: 'Hip extension in final third'
          }
        ],
        mechanicalFocus: 'Quad-dominant ascent, maintaining front rack, staying upright',
        commonFailurePoint: 'Torso collapse or elbows drop indicates upper back fatigue. Slow ascent indicates quad weakness.'
      }
    ],
    strengthRatios: [
      {
        comparisonExercise: 'Back Squat',
        expectedRatio: '80-90% of back squat',
        interpretation: 'If gap is larger than 20%, quads or upper back are limiting. If closer, back squat form may be compromised.'
      },
      {
        comparisonExercise: 'Leg Press',
        expectedRatio: '130-170% of front squat',
        interpretation: 'If leg press isn\'t much stronger, indicates true quad strength is the limiter, not positioning.'
      },
      {
        comparisonExercise: 'Leg Extension',
        expectedRatio: '25-35% of front squat',
        interpretation: 'Isolated quad strength indicator.'
      },
      {
        comparisonExercise: 'Barbell Row',
        expectedRatio: '50-70% of front squat',
        interpretation: 'Upper back strength to maintain upright torso. If weak, positioning will fail.'
      }
    ],
    commonWeaknesses: [
      'Quad strength (primary limiter - cannot drive out of bottom)',
      'Upper back strength (torso collapses forward, elbows drop)',
      'Core stability (anterior core weakness leads to instability)',
      'Mobility (ankle, wrist, thoracic - limits depth or rack position)',
      'Front rack position (technique and shoulder/wrist flexibility)'
    ]
  }
];

export function getBiomechanicsForLift(liftId: string): LiftBiomechanics | undefined {
  return liftBiomechanics.find(bio => bio.liftId === liftId);
}
