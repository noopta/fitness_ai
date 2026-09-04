# Data Protection Impact Assessment — Form Analysis reference stills

**Product:** Axiom (axiomtraining.io; iOS/Android)
**Processing assessed:** retention of still images extracted from user-uploaded form-check videos
**Date:** 4 September 2026
**Status:** completed before release
**Owner:** Axiom (controller) — inquiries@axiomtraining.io

Prepared to satisfy GDPR Art. 35 and the equivalent "data protection assessment"
obligations for sensitive data under the Colorado, Connecticut, Virginia and Texas
privacy statutes. Not legal advice; intended for review by counsel and retention as
the record that this processing was assessed before it shipped.

---

## 1. What is being assessed, and what is not

Axiom's Form Analysis feature already exists and is unchanged by this assessment in
its essentials: a user uploads a lift video, a Google Gemini model on Vertex AI
returns a written critique, and **the video is deleted as soon as the analysis
completes**. No imagery has ever been retained.

The new processing is narrow and is the whole subject of this DPIA:

> Where the model identifies the specific moment and region a fault occurs, and
> **where the user has separately opted in for that upload**, extract up to three
> frames from their video, draw a marker around the region, and store those images
> with the analysis record so the feedback can show what it is describing.

Not in scope, and explicitly not done: facial recognition, biometric identification,
pose-estimation templates retained as identifiers, matching users across videos,
sharing stills with other users, any advertising use, and any model training use.

## 2. Why we need it (necessity and proportionality)

Written form feedback names a moment the user cannot locate — "your lumbar rounds at
the bottom of rep three" requires the lifter to reconstruct a moment they were under
a bar for and did not see. Showing the frame is the difference between advice they
can act on and advice they have to take on faith. This is the core value of the
feature and the most requested improvement to it.

Alternatives considered and rejected:

| Option | Why not chosen |
|---|---|
| Retain nothing; describe in words only | Status quo. Does not solve the problem the feature exists to solve. |
| Retain the whole video | Far more data, for longer, for no additional benefit. Rejected outright. |
| Render frames on the user's device from their local copy | Genuinely lower risk and seriously considered. Requires a new native dependency and a new app-store build, and breaks whenever the user's local copy is gone (making history views blank). Kept on the roadmap as a future improvement. |
| **Retain up to three marked frames, opt-in** | **Chosen.** The minimum imagery that delivers the benefit. |

Proportionality controls: a hard cap of three frames per analysis, only for faults
the model actually localised, rendered at 540px rather than source resolution, and
only on explicit opt-in.

## 3. Data, subjects, and lawful basis

**Personal data:** still images of the data subject's body, in a domestic or gym
setting, with a timestamp relative to their own upload. These are health-adjacent
images and must be treated as special category data (GDPR Art. 9) and as "consumer
health data" under Washington's My Health My Data Act and Nevada SB 370.

**Data subjects:** registered Axiom users aged 18+ who affirmatively opt in.
Under-18 accounts are excluded (see §5).

**Lawful basis:** Art. 6(1)(a) consent and Art. 9(2)(a) explicit consent. Consent is
the right basis here rather than contract, because the written analysis — the thing
the user is paying for — is delivered in full whether or not they opt in. Nothing is
withheld from a user who declines, so the consent is freely given.

**Recipients:** none. The video reaches Google Vertex AI for the analysis itself (an
existing processor, under Google Cloud terms that exclude customer data from model
training, with the media deleted after processing). The frames are extracted on our
own servers with local ffmpeg and are sent to no one.

**Transfers:** processing and storage in the United States; SCCs plus the UK Addendum
for EEA/UK subjects, as described in the privacy policy.

## 4. Risks identified and how each is addressed

### 4.1 Retained imagery outliving the account it belongs to — *high, mitigated by design*

The natural place for these images is object storage, and it was the wrong place.
Nothing in the codebase deletes a Google Cloud Storage object: `DELETE /auth/account`
is thorough about database rows and silent about blobs. Stills placed there would
have survived account deletion indefinitely, making a published retention promise
false.

**Control:** the JPEGs are stored inside the analysis record itself
(`FormAnalysis.analysisJson`), which already cascades on user delete. The failure is
not mitigated, it is structurally impossible — there is no separate object to orphan.
This also keeps body imagery out of the content-addressed blob store, whose global
deduplication (identical bytes from two users become one object) is in direct tension
with an erasure right.

### 4.2 No way to erase a single analysis — *medium, resolved*

Before this change the only erasure path was deleting the entire account, which is
not a real choice to offer someone who wants one clip gone.

**Control:** `DELETE /api/form-analysis/:id`, surfaced in the app on each analysis,
scoped to the owner within the write predicate. Removing the row removes the imagery
in the same statement.

### 4.3 Consent that is assumed rather than given — *medium, resolved*

**Controls:** the setting is off by default; the flag is transmitted explicitly on
every upload rather than stored once as a profile setting; the server stores nothing
absent an explicit affirmative value; the choice that produced each record is
persisted on the record (`framesConsent`); and clients that predate the feature never
send the flag, so existing installations retain nothing and are unaffected.

### 4.4 Retained imagery of minors — *high, controlled*

The minimum age for the Service is 13, so minors do use it, and retained images of a
14-year-old's body are a materially different proposition from an adult's.

**Control:** users under 18 cannot enable the feature. Enforcement is server-side
against the date of birth collected at registration, not in the app, so a modified or
outdated client cannot bypass it. An account whose age cannot be determined is
treated as under 18. Minors receive the complete written analysis.

### 4.5 An accurate-looking marker in the wrong place — *medium, controlled*

A misplaced marker is not a cosmetic defect. It is confidently-delivered wrong
coaching, pointing a user at a part of their body that is fine while the actual fault
goes unmentioned — and in a feature that flags injury risk, that has a safety
dimension as well as a data-quality one.

Calibration testing against synthetic clips with exact ground truth found this risk
is dominated by the model's video sampling rate. At the platform default of 1 frame
per second, asked about events it had not been shown, the model did not decline — it
produced ten confident, evenly spaced, entirely fabricated ones. At 4 fps the same
task was answered with every timestamp and every attribute correct and regions within
~2% of frame dimensions.

**Controls:** sampling pinned to 4 fps; the model is instructed to anchor only faults
it actually observed at an identifiable instant and to leave the fields null
otherwise; anchors are capped at the three most severe faults; timestamps beyond the
clip's duration are discarded rather than resolved to the final frame; and the marker
is drawn as loose corner brackets rather than a tight box, so the rendering claims
only the precision the measurements support. Residual risk is accepted and disclosed:
the feature is described in-product as coaching feedback that can be wrong.

### 4.6 Storage growth degrading the database — *low, monitored*

Roughly 100KB per analysis, against 23 analyses in the production table at
assessment time. Measured worst-case frame sizes are ~25KB at the shipped width. The
history endpoint does not select the column holding them, so the images travel only
on a single-item detail fetch and are never duplicated across a list response.

**Control:** revisit at ~10,000 analyses (~1GB), at which point the images move behind
a storage key. Deferring is a deliberate choice: the object-storage design carries the
erasure risk in §4.1, and adopting it early would mean taking on that risk to solve a
capacity problem that does not yet exist.

### 4.7 Onward disclosure through social features — *low, controlled*

Axiom has a feed, direct messages and shareable cards. A body still leaking into any
of those would be a disclosure the user never agreed to.

**Control:** stills are returned only on the owner-scoped detail endpoint and are not
wired into any share, feed or messaging path. Any future proposal to include them
requires its own separate consent and an update to this assessment.

## 5. Rights of the data subject

| Right | How it is served |
|---|---|
| Be informed | Privacy policy §§2.1, 4, 6, 8, 9, 11; in-product copy on the toggle states what is kept and for how long |
| Access / portability | Existing data export includes the `formAnalysis` table and therefore the stills |
| Erasure | Per-analysis delete in the app; account deletion cascades; email request honoured within 30 days |
| Withdraw consent | Toggle off at any time; takes effect on the next upload and does not affect analyses already produced |
| Object / restrict | Declining the toggle removes this processing entirely with no loss of service |
| Not be subject to automated decisions | Output is advisory coaching; no legal or similarly significant effect |

## 6. Conclusion

With the controls above, the residual risk is **low** and the processing is
proportionate to a clear benefit to the user. The two risks that would have made it
unacceptable — imagery surviving deletion, and imagery of minors — are addressed
structurally rather than procedurally, which is what makes them stay addressed.

The most significant residual risk is §4.5, marker placement, which is a matter of
accuracy rather than of data protection, is mitigated by the sampling and rendering
choices above, and is disclosed to users.

**Recommendation:** proceed. No prior consultation with a supervisory authority is
considered necessary, on the basis that the residual risk is not high.

**Review triggers:** any change to retention period, any proposal to place stills in
object storage or in a sharing surface, any change to the video model or sampling
rate, and any move to render stills for under-18 accounts. Otherwise review annually.

---

*Open item for counsel: confirm the Washington My Health My Data Act consent flow
described in §3 and the privacy policy meets the Act's separate-consent requirement,
and confirm whether a standalone Consumer Health Data Privacy Policy document is
expected in addition to the dedicated section now in the main policy.*
