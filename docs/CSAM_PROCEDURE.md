# CSAM Detection, Preservation and Reporting Procedure (18 U.S.C. 2258A)

Draft for counsel review. Last updated 16 October 2026. Named responsible person: [NAMED QUARANTINE OWNER — founder]. Backup: [BACKUP CONTACT].
This closes the open launch condition in `DPIA_FORM_VIDEO_2026-09.md` addendum (named owner + written NCMEC procedure).

## 1. Legal duty (summary, counsel to confirm)
As a US electronic service provider, once Axiom has **actual knowledge** of apparent child sexual abuse material (CSAM) on its systems it must
report to the **NCMEC CyberTipline** "as soon as reasonably possible" (2258A(a)), and **preserve** the reported content and related data for
**1 year** after the report (2258A(h), as amended by the REPORT Act 2024). Do not notify the user. It is a crime to distribute or keep CSAM
outside this process: never copy, forward, screenshot or share it, including with staff, lawyers or police, except as below.

## 2. How it reaches us
- Form-check / diagnostic video screening returns `quarantine` (`formVideoScreeningService.ts`): deletion is suppressed, a `ContentFlag` row is written
  (`excerpt` = preserved `gs://` object path, `topScore` = 1), and `alertContentQuarantine` sends an SMS summons (no content, no path) and logs
  `[errorAlert] CONTENT QUARANTINE flag=<id>` to journald.
- User report with reason `sexual` involving an apparent minor; image moderation on posts/avatars/DMs; external tip.

## 3. Within 24 hours of the alert (GCS lifecycle deletes objects after 1 day)
1. **Preserve first.** Copy the object out of the lifecycle bucket into a restricted evidence bucket with no lifecycle rule and access limited to the
   named owner: `gsutil cp gs://<bucket>/<object> gs://[EVIDENCE BUCKET]/<flagId>/` and record the hash (`gsutil hash`). Do this before review.
2. **Minimal review.** View only as much as needed to decide whether the content is apparent CSAM. False positives (adult in training clothes,
   non-training content) -> mark the flag reviewed, delete the preserved copy, done.
3. **Suspend the account** (disable login) without telling the user why. Do not delete the account: deletion would cascade away evidence.
4. **Preserve related data** for the same 1-year period: user row (id, name, email, DOB, sign-in provider ids), IP addresses and timestamps from nginx
   and journald (export them now: they rotate within 14 days / 200 MB), upload request metadata, `ContentFlag` row, related messages/posts.
   Store in the evidence location, encrypted, access-logged.

## 4. Report to the NCMEC CyberTipline
1. Register Axiom as an ESP with NCMEC once (report.cybertip.org, ESP registration) before launch. [ESP REGISTRATION STATUS]
2. File the report via the ESP portal or API: incident type (apparent child pornography), date/time of upload (UTC), the uploader's account
   identifiers (user id, email, username, IPs with timestamps), and upload the file itself through the portal. Indicate whether the file was viewed by Axiom staff.
3. Save the CyberTipline report number in the incident log and on the `ContentFlag` row (or a private register).
4. If there is reason to believe a child is in imminent danger, also call local law enforcement / FBI (tips.fbi.gov) immediately.

## 5. After the report
- Keep the preserved content and data for **1 year** from the report (longer if law enforcement asks in writing). Then delete securely and record the deletion.
- Respond to any law-enforcement legal process through counsel.
- Ban the account permanently; block re-registration with the same email/sign-in identifiers.
- Do not disclose the report to the user (this could alert a suspect).

## 6. Test and review
Run `testQuarantineAlert()` quarterly to confirm the SMS summons arrives. Review this procedure annually and after every real incident.
