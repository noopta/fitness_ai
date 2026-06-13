# Firebase Analytics → Google Ads conversion tracking

What the codebase already has (committed) vs. what you have to do in the
Firebase Console and Google Ads dashboard to make conversion tracking
actually work.

## Codebase status

| | |
|---|---|
| `@react-native-firebase/app` | installed |
| `@react-native-firebase/analytics` | installed |
| `expo-build-properties` (Podfile `useFrameworks: static`, required by Firebase iOS) | installed |
| `@react-native-firebase/app` config plugin in `app.json` | added |
| iOS `googleServicesFile` path | `./GoogleService-Info.plist` |
| Android `googleServicesFile` path | `./google-services.json` |
| `src/lib/firebaseAnalytics.ts` lazy-load wrapper | shipped |
| `Analytics.register()` → fires Firebase `sign_up` | wired |
| `Analytics.login()` → fires Firebase `login` | wired |
| `Analytics.diagnosticCompleted()` → fires `tutorial_complete` | wired |
| `Analytics.upgradeCompleted()` → fires `purchase` (with value + currency) | wired |
| `identifyUser()` → sets Firebase user_id + user_tier | wired |
| `resetUser()` → clears Firebase user_id on logout | wired |
| `app_open` | auto-fired by Firebase SDK on cold start, no code needed |

## What you have to do (one-time)

### 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. **Add project** → name it `Axiom` (or whatever)
3. Disable Google Analytics during project creation? **NO — keep it enabled.** That's the whole point.
4. When prompted for the Analytics account, use `Default Account for Firebase` unless you have a specific reason

### 2. Register both apps under the Firebase project

**iOS:**

1. In the Firebase console → Project Overview → **Add app** → iOS
2. **Bundle ID**: `io.axiomtraining.app` (must match `app.json` `ios.bundleIdentifier` exactly)
3. App nickname: `Axiom iOS`
4. App Store ID: `6761032954` (your ASC App ID — visible in App Store Connect)
5. Download **`GoogleService-Info.plist`**
6. Place it at `mobileAlt/GoogleService-Info.plist` (root of the mobile project, next to `app.json`). **Do not commit it.** (Wait — actually, see the .gitignore note below.)

**Android:**

1. Add app → Android
2. **Package name**: `io.axiomtraining.app` (matches `app.json` `android.package`)
3. App nickname: `Axiom Android`
4. SHA-1: paste the SHA-1 from your EAS Android keystore. To get it:
   ```bash
   cd mobileAlt
   eas credentials -p android
   ```
   Pick the production keystore → it shows the SHA-1. Paste it into Firebase.
   *(Optional — needed for Dynamic Links and Phone Auth; not strictly required for Analytics. You can skip and add later.)*
5. Download **`google-services.json`**
6. Place at `mobileAlt/google-services.json`

### 3. .gitignore — config files contain identifiers

Add to `mobileAlt/.gitignore` if not already there:

```
GoogleService-Info.plist
google-services.json
```

These files are technically OK to commit (no secrets — they're keys used in
the client anyway) but the convention is to leave them out and have EAS
secrets manage them at build time. For now you can either:

- (a) commit them (simpler, works immediately)
- (b) upload them as EAS secrets via `eas secret:create` and reference
  them as `EAS_BUILD_PROFILE_<...>` — Expo docs

If unsure, option (a) is fine for early-stage. The keys in those files
are public-facing client identifiers — they show up in network requests
to Firebase regardless.

### 4. Build with EAS

This change is NATIVE (Firebase has native modules), so OTA won't deliver
it. You need a new EAS build:

```bash
cd mobileAlt
eas build --platform ios --profile production --non-interactive --auto-submit
eas build --platform android --profile production --non-interactive --auto-submit
```

(Build numbers auto-increment per the eas.json `appVersionSource: remote` setting.)

### 5. Verify events are arriving in Firebase

After install + a few in-app actions:

1. Firebase console → **Analytics** → **Realtime** (left nav)
2. You should see events like `app_open`, `sign_up`, `login`, `tutorial_complete`, `purchase` appearing within ~30 seconds of the action in-app
3. If nothing appears after 5 minutes, check Firebase → DebugView (you may need to enable analytics debug mode via Xcode or `adb shell setprop`)

### 6. Link Firebase to Google Ads

This is the step that makes the conversion tracking actually feed your ad campaign.

1. **Google Ads dashboard** → Tools → **Linked accounts** → Firebase
2. Click **Link** and authorize with the Google account that owns the Firebase project
3. Pick the Firebase project you just created → choose `Axiom iOS` and `Axiom Android` → Link
4. Now Google Ads can see Firebase events from those apps

### 7. Mark events as conversions in Google Ads

Once Firebase is linked, Google Ads shows the Firebase events under a new
section. You pick which events count as conversions for your campaign.

1. Google Ads → Tools → **Conversions** → New conversion action → **App**
2. Source: **Firebase** (will be available once link is set up)
3. Pick the event(s):
   - **Primary conversion** (what the campaign optimizes for): use `sign_up` if your goal is install→signup, OR `purchase` if your goal is direct revenue, OR `tutorial_complete` if you want users who've actually engaged
   - **Secondary conversions** (tracked but not optimized): the other events on the list

   For a "Maximize conversions" bid strategy on an install campaign, **the recommended primary conversion is `sign_up`** — it's a strong signal of a real install, not a tire-kicker.

4. Conversion window: 30 days (default)
5. Save

### 8. Pause + restart your campaign

Once steps 1-7 are done, go back to the campaign you started this morning
and let it pick up the new conversion configuration:

1. Pause the campaign
2. Edit it → Bidding → re-confirm "Maximize conversions" + pick the new
   `sign_up` (or your chosen) conversion action
3. Unpause

The campaign now optimizes for real installs that result in actual signups,
not just install pings. Google's algorithm needs ~50 conversions before
auto-optimization stabilizes; with CA$20/day and 2026 install costs, that's
roughly 1-2 weeks of running time.

## What events Firebase will see from us

| Firebase event | Triggered when | Use it as |
|---|---|---|
| `app_open` | Cold start (auto-fired) | Lowest-funnel signal — install completed |
| `sign_up` | User created an account (any method) | Recommended primary conversion |
| `login` | Returning user authenticated | Retention metric |
| `tutorial_complete` | First diagnostic finished | Mid-funnel — committed user |
| `purchase` | Pro upgrade succeeded | High-value conversion (with `value` + `currency`) |

Items we could add next session (not wired yet):

- `generate_lead` on first plan generation (between tutorial_complete and purchase)
- `view_item` on viewing pricing
- `add_to_cart` on tapping Subscribe
- `level_up` on workout streak milestones

## Open the campaign with conversion tracking on

After build + Firebase link + conversion config, your Google Ads campaign
will go from a "won't perform well" warning to actually optimizing for
real installs that turn into accounts. CA$20/day at proper conversion
tracking is enough to start learning.
