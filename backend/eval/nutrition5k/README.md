# Nutrition5k photo scoreboard

40 dishes from the Nutrition5k test split (Google Research, CC BY 4.0) with
weighed ingredients and true calories, mass and macros: `test-40.json`.

Run (from backend/, real Vertex + USDA calls):

    node scripts/evalPhotoNutrition5k.mjs <label>     # MEAL_PHOTO_MODEL / MEAL_PHOTO_THINKING_LEVEL / HINTS=own|decoy

Images download on first run to `.runtime/n5k/`. Reports calorie MAPE, median,
within-20%, bias, protein MAE, mass error, and latency.

Baseline, 11 Oct 2026 (one run each):

| setup | kcal MAPE | within 20% | bias | protein MAE | mass error |
|---|---|---|---|---|---|
| gemini-3.1-pro (budget thinking) | 27.0% | 19/40 | +12.1% | 9.2 g | 16.2% |
| gemini-3.8-flash MEDIUM | 29.4% | 14/40 | +7.3% | 8.4 g | 20.2% |
| 3.8 + user-food hints (regular) | 26.9% | 15/40 | +6.0% | 9.7 g | 19.5% |

3.8 vs 3.1 difference is within noise (paired 95% CI −4 to +9 points; run-to-run
swing ~12%). Most error is portion weight (12/40 dishes >25% off on grams).

## Portion calibration (11 Oct 2026)

`scripts/fitPortionCalibration.py` fits one factor per food type on 189 TRAIN
dishes (collected through the live pipeline) and scores on the 40 TEST dishes.
Both models learned nearly the same corrections — meat/fish/eggs ~0.7, sauces
and fats ~0.85, grains ~0.88, dairy 0.92 — i.e. both overestimate protein
portions by ~30%. Held-out TEST (one run per model):

| model | setup | kcal MAPE | median | within 20% | bias |
|---|---|---|---|---|---|
| 3.8-flash | none | 32.1% | 29.4% | 12/40 | +8.0% |
| 3.8-flash | half-strength (shipped) | 29.3% | 27.5% | 13/40 | −0.9% |
| 3.8-flash | full | 28.5% | 30.9% | 17/40 | −9.8% |
| 3.1-pro | none | 40.6% | 28.6% | 16/40 | +23.1% |
| 3.1-pro | full | 33.2% | 23.4% | 15/40 | −0.8% |

Half strength removes the bias on both TRAIN and TEST without the ~10%
undercount of full strength. Improvements are within the 40-dish noise band.
