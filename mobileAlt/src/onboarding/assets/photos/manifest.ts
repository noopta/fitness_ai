// Photo manifest — single source of truth for the 7 scene images.
//
// The user will drop the JPGs into this folder (see README.md). Filenames
// are the EXACT names below. Until each lands, the require() call would
// throw at bundle time, so we conditionally return `undefined` and the
// Poster falls back to its deep-wash color (no crash, just no photo).
//
// Once a file is added, replace its line with:
//   gymOldschool: require('./gym-oldschool.jpg'),

// Currently NONE of these files exist on disk — Metro would fail on require.
// We keep this as a manifest with `undefined` values so the build passes;
// each scene reads `PHOTOS.foo` and the Poster handles `undefined` cleanly.
//
// TO ADD A PHOTO:
//   1. drop the JPG in this folder with the EXACT name below
//   2. uncomment the matching require() line
//   3. rebuild

export const PHOTOS: Record<PhotoKey, ReturnType<typeof require> | undefined> = {
  // gymOldschool: require('./gym-oldschool.jpg'),
  // nutrition:    require('./nutrition.jpg'),
  // coachSquat:   require('./coach-squat.jpg'),
  // hypeDuo:      require('./hype-duo.jpg'),
  // equipGymleco: require('./equip-gymleco.jpg'),
  // physiqueBack: require('./physique-back.jpg'),
  // rackSmith:    require('./rack-smith.jpg'),
  gymOldschool: undefined,
  nutrition:    undefined,
  coachSquat:   undefined,
  hypeDuo:      undefined,
  equipGymleco: undefined,
  physiqueBack: undefined,
  rackSmith:    undefined,
};

export type PhotoKey =
  | 'gymOldschool' | 'nutrition' | 'coachSquat' | 'hypeDuo'
  | 'equipGymleco' | 'physiqueBack' | 'rackSmith';
