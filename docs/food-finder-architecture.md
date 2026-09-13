# Food Finder — architecture and build plan

Status: in progress. Branch `feature/food-finder-2026-08`.

## The shape of the problem

A request needs three things joined: what the user still owes today (macros, micros,
budget), what physically exists near them, and what those places sell. Only the first
is user-specific and fast-changing. The second changes over months, the third over
quarters.

That asymmetry is the whole design. **Nothing in the request path may do acquisition
work.** Measured today on the existing route: 200–400 ms cold (one Places round-trip),
11–15 ms warm. Every decision below protects that number.

| Layer | Volatility | Where it is computed |
|---|---|---|
| remaining macros/micros, budget | per request | live, in-process |
| which places exist at a corner | months | offline crawl → local index |
| a chain's menu nutrition | quarters | offline scrape → local index |
| an indie's menu + prices | quarters | offline parse → local index |
| grocery staple prices | weeks | seeded table, periodic refresh |
| open/closed right now | minutes | Places field, request-time, cached ~1 km grid |

---

## D1 — Where the corpus lives

**Options.** (a) SQLite via the existing Prisma schema. (b) Cloud SQL Postgres +
PostGIS. (c) Firestore. (d) BigQuery.

**Chosen: SQLite for the queryable hot index; GCS for raw artifacts and snapshots.**

Postgres+PostGIS is the textbook answer and it is wrong here. The backend runs on EC2;
the database would run on GCP. Every food-finder query would cross clouds — 20–50 ms
minimum per round trip, against a hot path that currently costs 11 ms — and it would
introduce a network failure mode into a route that today has none. It also cuts against
a standing constraint: we are committed to AWS and spend GCP credits on Gemini/Vertex,
not on migrating primary storage.

Sizing says we do not need it. Chain nutrition is O(50k) rows; one metro of parsed indie
menus is O(250k) rows. Call it 150–300 MB on top of a 76 MB database. SQLite is
comfortable well past that, it is already backed up with everything else, and Prisma is
already wired.

**What GCS is genuinely for** (and where the credits go): raw scrape artifacts — fetched
HTML, menu PDFs, menu photographs — plus per-metro corpus snapshots. These are large,
immutable, write-once/read-rarely, and never touched during a request. `blobStore.ts`
already does content-addressed puts against a configured bucket with proven WIF auth.

**Accepted cost.** No PostGIS. See D2. If a second region's corpus ever pushes SQLite
past comfort, the escape hatch is Cloud SQL *with a read replica colocated on EC2*, not
a naked cross-cloud query.

## D2 — Geospatial indexing without PostGIS

**Options.** PostGIS `ST_DWithin`; S2 cell / geohash prefix columns; bounding-box
prefilter plus haversine refinement.

**Chosen: bbox prefilter on indexed `lat`/`lng`, then haversine in application code.**

Candidate sets here are thousands per metro, not millions. A bbox scan over an indexed
column reduces to a few hundred rows, and haversine over a few hundred rows is
microseconds. Geohash prefixes add real complexity for a constant factor we cannot
measure at this scale, and they handle the antimeridian and polar cases badly.

## D3 — Where acquisition runs

**Options.** Cron on the prod EC2 box; Cloud Run Jobs; Cloud Functions.

**Chosen: portable Node scripts, run on EC2 for small jobs, Cloud Run Jobs for metro passes.**

The box is 2 vCPU / 3.7 GB and runs production. A full metro pass over ~8k restaurants
with network concurrency would contend with the prod service for exactly the resources
it has least of. The chain scrape (~200 well-known sites, hours, one-time) is small
enough to run locally inside the dev cgroup slice. The metro indie pass is not.

Every pipeline stage is therefore written as a plain script with no ambient server
dependency: input from the index or GCS, output to the index or GCS. That makes the
EC2-vs-Cloud-Run choice a deployment detail rather than a rewrite.

## D4 — Menu acquisition, tiered by cost and fidelity

Try the cheapest and most accurate source first; fall through.

| Tier | Source | Fidelity | Cost |
|---|---|---|---|
| 1 | ordering-platform JSON (Toast, Square, Clover, ChowNow) | exact items + prices | ~0 |
| 2 | HTML / PDF menu → text → LLM structuring | good | low |
| 3 | photographed menu → Gemini vision | fair | cents each |
| 4 | nothing published | cuisine default (existing behaviour) | 0 |

Tier 1 matters more than it looks: a large share of independents outsource their own
online ordering to one of a handful of platforms, and those expose structured item
data on the restaurant's *own* domain. That is both the cheapest tier and the
defensible one — we read the restaurant's own site, never a delivery aggregator.

## D5 — Nutrition confidence, measured rather than asserted

The existing ladder is `usda` (1.0) → `published` (0.85) → `estimated` (0.7). Parsing an
indie menu yields a *dish name and description*, which is strictly more than a cuisine
guess and strictly less than a published nutrition table. It gets its own rung:

    usda > published > inferred > estimated

`inferred` = we know the dish and its description at this specific restaurant, and a
model estimated the macros. `estimated` = we only know the cuisine.

**The calibration loop.** For chains we hold ground truth. Running the same dish-name
estimator over chain items and comparing against their published tables yields a real,
per-cuisine, per-dish-type error distribution. That converts the ranker's discount from
a hand-picked 0.7 into a measured number, and lets the UI say "≈620 kcal, ±25%" honestly.
A macro-tracking app that is silently off by 400 kcal is worse than one that declines to
answer, so this is a correctness feature, not a polish feature.

## D6 — Price, and the budget-comparability trap

Grocery prices are not purchasable per-store at any sane cost. A regional staple price
table (~300 common ingredients, per metro, per unit) multiplied by the store's Places
`priceLevel` tier gets within a useful margin and is labelled as an estimate. Parsed
menu items carry their exact listed price.

The trap: a $40 grocery basket and an $18 takeout order are not comparable numbers — one
buys four meals. Ranking on raw basket price makes groceries lose every time. **Rank on
cost per meal covered**, amortising a basket across the servings it yields.

Currency follows from the resolved country, not from a user setting.

## D7 — Cache tiers

Keyed on the stable half (grid cell, place id, dish name) and never on the user, so one
fetch serves every user in a neighbourhood. This is why coverage should go deep in one
metro before going wide.

| Data | TTL | Rationale |
|---|---|---|
| Places nearby (~1 km grid) | 24 h | existing |
| parsed menus | 90 d | indie menus drift seasonally |
| dish nutrition inference | permanent, keyed by normalised dish name | same dish, same answer |
| grocery staple prices | 30 d | a stale price is a lie |
| open/closed | never cached | wrong answer sends someone to a locked door |

## D8 — Dietary restrictions are a filter, not a weight

Allergies, vegetarian/vegan, halal/kosher, and dislikes apply **before** ranking and can
never be traded off against a better macro fit. There is no schema field for any of this
today, which makes it a prerequisite rather than a later phase: a confident food
recommendation that violates an allergy is the kind of failure that ends trust
permanently.

---

## Build order

1. **Schema + dietary filters** — restrictions on `User`, corpus models, recommendation log.
2. **Phase 1 (the testable core)** — budget + currency, staple price table, cost-per-meal
   ranking, directions deep-links, dietary hard filters, variety/recency penalty,
   `websiteUri` on the Places field mask.
3. **Chain nutrition corpus** — scrape, normalise, brand-match to Places results.
4. **Indie menu pipeline** — tiered acquisition, GCS artifacts, Gemini structuring/vision.
5. **Calibration harness** — estimator vs chain ground truth, per-cuisine error bars.
6. **Web UI** — budget/diet controls, provenance and confidence surfaced, directions.
