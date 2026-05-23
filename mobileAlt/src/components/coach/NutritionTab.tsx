// NutritionTab — thin wrapper that hands off to the v17b NutritionScreen.
//
// Why a wrapper instead of editing coach.tsx: the parent screen has dozens
// of imports + activeTab branches that all read `<NutritionTab .../>`.
// Keeping the export here lets the chassis swap stay invisible to the rest
// of the Coach surface.
//
// The pre-v17b implementation lived in this file (≈1200 lines, four cards).
// Its sub-components live on in version control; resurrecting them is a
// `git show` away.

export { NutritionScreen as NutritionTab } from './nutrition/NutritionScreen';
