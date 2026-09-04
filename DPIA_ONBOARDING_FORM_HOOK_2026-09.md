# DPIA Addendum — Form Analysis in onboarding ("the first-run hook")

**Status:** draft for review before launch. Extends, and does not replace,
`DPIA_FORM_VIDEO_2026-09.md` (reference stills).
**Date:** 2026-09-04

---

## 1. Why a new assessment was required

The stills DPIA states at §1 that the underlying video analysis is "already
exists and is unchanged by this assessment in its essentials." That is no
longer true, and two of its load-bearing findings do not survive the change:

**Its lawful basis argument.** §3 concludes consent is freely given
"because the written analysis — the thing the user is paying for — is
delivered in full whether or not they opt in. Nothing is withheld from a user
who declines." In the onboarding hook the video step sits between signing up
and reaching the product. The reasoning that made consent freely given in the
old placement does not transfer.

**Its population.** §3 scopes data subjects to "registered Axiom users aged
18+ who affirmatively opt in." The hook is shown to users who registered
seconds earlier, have completed no intake, and — before the controls below —
could be as young as 13, the app's minimum age.

The processing operation itself (upload → Vertex → written critique → delete)
is unchanged. What changed is **context, population and volume**, and under
Art. 35(1) that is what triggers reassessment. Volume is the sharpest of the
three: the feature has had 23 uses by 4 accounts in its lifetime, 21 of them
internal. As the default first-run step it becomes the highest-volume ingest
path in the product.

---

## 2. What is being assessed

> Immediately after sign-up, before the coach intake, invite the user to film
> a ≤15-second clip of a lift. Upload it once, run a fast technique-only pass
> the user waits for (~8s) and a fuller written report in the background, then
> delete the video. Show the fast result, then proceed to intake.

Not in scope and not done: retained stills (explicitly disabled on this path),
facial recognition, biometric identification, retained pose templates, matching
users across videos, advertising use, model-training use.

---

## 3. Lawful basis, re-argued

**Basis:** Art. 6(1)(a) consent; Art. 9(2)(a) explicit consent, since a clip of
a person's body in a training context is health-adjacent and is treated as
special category data. Also "consumer health data" under Washington's My Health
My Data Act and Nevada SB 370.

Consent is only valid here if it is genuinely freely given (Art. 4(11), Art.
7(4)). Three properties are engineered to make that true, and each is a
testable claim rather than a statement of intent:

1. **Declining costs the user nothing.** Skip is available on every stage of
   the hook and is a real, labelled control ("Skip this — go to my intake"),
   not a greyed afterthought. A user who skips reaches exactly the same
   product, with the same program, at the same price. Nothing is gated behind
   having filmed.
2. **Consent is informed at the point of decision.** What happens to the clip
   — sent to Google Vertex AI, deleted after analysis, written feedback kept,
   never used for training, no other viewer — is stated on the screen before
   the camera opens, not in a policy the user has not opened.
3. **Consent is recorded separately from action.** `formHookConsented` fires
   at the agree step and `formHookSubmitted` at upload. The gap between them is
   monitored: if they converge to identity, the consent screen has become a
   click-through and the basis weakens. That is a live signal, not an audit.

**Retention:** the video is deleted from GCS immediately after analysis, with a
1-day bucket lifecycle rule as backstop. The written analysis is retained with
the account and is deleted with it. One deliberate exception is at §5.

**Recipients:** Google Vertex AI as processor (existing, contractually excluded
from model training). No other recipient. Stills are not produced on this path.

---

## 4. Risks and controls

### 4.1 Children reaching a flow designed to maximise data provision — *high, controlled*

The app's minimum age is 13. The UK Age Appropriate Design Code applies to any
service likely to be accessed by children and specifically prohibits nudge
techniques that lead a child to provide more data than necessary. A first-run
step engineered for uptake is close to the paradigm case, and it is not
coherent to refuse to *store* imagery of a 15-year-old (the existing 18+ stills
gate) while making filming themselves the first thing we ask them to do.

**Control:** the hook is **18+**, enforced in three independent places — the
route returns 403 `age_restricted`, the mobile router never navigates a
non-adult to it, and the ingest classifier rejects clips whose subject appears
to be a minor. All three fail closed: a user with no date of birth on file is
treated as not eligible, not as an adult.

Under-18s are never shown the hook and it is never mentioned to them, so there
is no exclusion message and nothing to work around.

*Residual:* date of birth is self-declared. Accepted, and mitigated by the
classifier as a second layer. Note the related open issue at §7.

### 4.2 Apparent CSAM, and the conflict with our own deletion guarantee — *high, controlled*

Opening video upload to every new signup creates a path that did not
meaningfully exist at 23 lifetime uploads. Before this work there was no
detection, no escalation, and no preservation anywhere in the codebase.

There is also a direct conflict between two things we are obliged to do. Our
privacy design deletes the video within a minute. But once a US provider is
aware of apparent CSAM, 18 U.S.C. §2258A requires reporting and preservation —
and deleting destroys what the report depends on.

**Control:** every clip is screened on ingest, concurrently with the analysis.
A `quarantine` verdict **suppresses the automatic delete**, records a
`ContentFlag` holding a pointer to the preserved object, blocks the result, and
raises an unmissable error-level alert naming the object and the obligation.
No coaching text derived from a refused clip is ever persisted or shown.

*Residual, and material:* the bucket's 1-day lifecycle rule will still reap a
preserved object. **Acting on a quarantine alert is therefore time-bound to 24
hours.** A named human owner and an out-of-band alert channel are required
before launch — a console log is not a process. See §7.

### 4.3 Consent that is assumed rather than given — *high, addressed*

Covered at §3. The specific failure mode this replaces: relying on a privacy
policy and a feature the user sought out, when in the new placement the user
sought out nothing and the step found them.

### 4.4 Third parties captured in the background — *medium, partially controlled*

Gym footage catches bystanders who gave no consent and have no relationship
with us. At 23 clips this was negligible; at every-signup volume it is
systematic, and it engages BIPA for Illinois bystanders as well as GDPR.

**Control:** the consent screen instructs the user to film only themselves and
avoid catching others in frame; the classifier reports `otherPeopleVisible`;
the video is deleted within a minute and no stills are kept on this path, so
nothing about a bystander persists beyond the written critique of someone
else's technique.

*Residual:* we cannot prevent capture, only minimise retention. `otherPeopleVisible`
is currently recorded but not acted on; escalating it to a soft warning
("we spotted other people — film somewhere quieter if you can") is proposed but
not built.

### 4.5 Health inferences delivered before we know anything about the user — *medium, controlled*

The full analysis is instructed to flag injury risk in clinical terms. At
onboarding the app holds no injury history, no medical constraints, and neither
`constraintsText` nor `coachProfile.injuries` — those are collected in the
intake that comes *after*. Issuing a musculoskeletal risk assessment to someone
we know nothing about is both a safety problem and a claim we cannot support.

**Control:** the quick pass runs a separate system prompt that forbids assessing
injury risk, naming any injury or condition, using clinical language, or
commenting on the user's body, weight or appearance. Where something looks
genuinely unsafe it must be expressed as a technique cue and nothing more.
Injury flagging returns in the full report, which the user reads after intake.

### 4.6 An unmetered endpoint as the front door — *medium, partially controlled*

The route deliberately does not consume the daily quota, so a bad first clip is
retryable rather than a paywall. That also removes the main brake on an
endpoint reachable by any account seconds after creation.

**Control:** `aiLimiter` (12/min/user), 200MB cap, 18+ gate, first-analysis-only
eligibility.
*Residual:* uploads are buffered in memory and the background passes are
fire-and-forget with no concurrency ceiling. A queue bound is proposed at §7.

---

## 5. The one deliberate retention exception

Quarantined objects are **not** deleted, and the `ContentFlag` recording the
decision has no foreign key to `User`, so it survives account deletion. This is
intentional: an abuse record a user can erase by deleting and re-registering is
not an abuse record. It is a narrow, documented carve-out from the deletion
guarantee at §3, and it is limited to material a human must review under a
statutory obligation.

This exception must be stated in the privacy policy. It is not currently.

---

## 6. Rights of the data subject

Unchanged from the stills DPIA. Erasure removes the account, the analyses, and
the written feedback; the video is already gone. The §5 carve-out is the sole
exception, and it is legally mandated rather than discretionary.

---

## 7. Conditions before launch

These are conditions, not recommendations. The first three are blocking.

1. **A named owner and an out-of-band alert for quarantine.** Currently a
   `console.error`. Nobody is paged, and the 24-hour lifecycle window means an
   unread alert is an expired obligation (§4.2).
2. **A written NCMEC reporting procedure** — who reviews, on what timeline,
   who files, how the preserved object is handed over, how the account is
   handled. Detection without a procedure is not compliance.
3. **Privacy policy update** — the onboarding context, the 18+ restriction, the
   two-pass processing, and the §5 retention exception. The current text
   describes a feature the user chooses and cites "up to 60 seconds."
4. Legal review of the §3 consent argument. It is engineered to be defensible;
   whether it *is* defensible is not an engineering judgement.
5. Escalate `otherPeopleVisible` to user-facing guidance (§4.4).
6. Bound background analysis concurrency (§4.6).
