// Photo manifest — single source of truth for the 7 scene images.
//
// Files are PNG (user-supplied). Skia's useImage decodes either format,
// the dither shader greyscales + applies the duotone regardless.
// gym-oldschool reuses the moody Smith-rack shot — placeholder until a
// dedicated empty-gym photo is sourced.

export const PHOTOS: Record<PhotoKey, ReturnType<typeof require>> = {
  gymOldschool: require('./gym-oldschool.png'),
  nutrition:    require('./nutrition.png'),
  coachSquat:   require('./coach-squat.png'),
  hypeDuo:      require('./hype-duo.png'),
  equipGymleco: require('./equip-gymleco.png'),
  physiqueBack: require('./physique-back.png'),
  rackSmith:    require('./rack-smith.png'),
};

export type PhotoKey =
  | 'gymOldschool' | 'nutrition' | 'coachSquat' | 'hypeDuo'
  | 'equipGymleco' | 'physiqueBack' | 'rackSmith';
