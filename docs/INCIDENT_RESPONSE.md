# Incident Response Runbook (one page)

Draft for counsel review. Last updated 16 October 2026. Owner: founder (sole on-call). Backup owner: [BACKUP CONTACT].

## 0. What counts as an incident
Any actual or suspected unauthorised access to, disclosure of, loss of, or alteration of personal data: leaked secret or `.env`, stolen
JWT/admin session, DB file copied, bucket made public, processor breach notice (Anthropic, OpenAI, Google, OpenRouter, Stripe, SendGrid,
Twilio, PostHog, Sentry, Expo, AWS, Cloudflare), mis-sent email, bug exposing one user's data to another, ransomware/disk loss.
Health data (injuries, conditions, medications, body measurements, body video/stills, meal logs, check-ins, coach chat) makes almost any
incident notifiable. Treat as notifiable until a written assessment says otherwise.

## 1. First hour: contain and preserve
1. Start an incident log (time-stamped, facts only) in a private doc. Note who found it, when, how.
2. Contain: rotate the affected secret(s) (`JWT_SECRET` also invalidates every session; `EMAIL_UNSUB_SECRET`; Stripe, Anthropic, OpenAI,
   Twilio, SendGrid, Google service-account keys); block the IP/account; take the route offline; make the bucket private.
3. Preserve evidence BEFORE cleaning up. Do not delete logs, rows or objects. Snapshot the EBS volume; copy `backend/dev.db` and the
   latest nightly backup to a separate, encrypted, access-restricted location.
4. Do not message affected users or post publicly until step 3 is done and the facts are checked.

## 2. Where the logs live
| Source | Where | Retention (check before it rolls) |
|---|---|---|
| App logs | `journalctl -u fitness-ai.service --since ...` (journald) | size-capped at 200 MB (`/etc/systemd/journald.conf.d/10-cap.conf`); export immediately: `journalctl -u fitness-ai.service -o json --since <t> > /secure/ir-<date>-journal.json` |
| Web/API access | nginx: `/var/log/nginx/access.log*`, `error.log*` | 14 daily rotations (`/etc/logrotate.d/nginx`) |
| Errors | Sentry org `axiom-4p` (us.sentry.io), backend + mobile projects | plan retention |
| Product analytics | PostHog (events per userId, web session replay if consented) | plan retention |
| Payments | Stripe dashboard events + webhook logs | Stripe |
| Email | SendGrid activity feed | ~30 days on most plans |
| SMS alerts | Twilio console message log | Twilio |
| Content flags | DB tables `ContentFlag`, `ContentReport` | until deleted |
| Backups | nightly DB backup, 7 days on-box; encrypted off-box copy 30 days once enabled | 7 / 30 days |

Recommended hardening: add `MaxRetentionSec=90day` to journald so the policy can state a time limit.

## 3. Within 24 hours: assess
Answer in the log: what data, whose (count, by country/US state, any under 18), was it encrypted, was it actually acquired or just exposed,
is it still exposed, which processor is involved. Decide: notifiable or not, and to whom. If a processor caused it, get their written incident report.

## 4. Notification clock (from when Axiom becomes aware)
| Law | Who | Deadline | Notes |
|---|---|---|---|
| GDPR / UK GDPR Art. 33-34 | Lead supervisory authority (via [EU REPRESENTATIVE]) / ICO | **72 hours** | Users "without undue delay" if high risk (health data = usually high risk). Document even non-notified breaches (Art. 33(5)). |
| FTC Health Breach Notification Rule, 16 CFR 318 | Affected individuals; FTC | Individuals **without unreasonable delay, no later than 60 calendar days** after discovery. 500+ people: FTC at the same time as individuals (same 60-day cap); under 500: log it and report to the FTC within 60 days after the end of the calendar year; 500+ residents of one state: also prominent media in that state | Axiom is a vendor of personal health records (not HIPAA-covered). An unauthorised *disclosure* (e.g., sharing with an analytics vendor without authorisation) also counts, not only hacks. |
| US state breach laws (all 50) | Residents; some AGs | Typically "most expedient time", hard caps: **30 days** CO, FL, WA; **45 days** e.g. AL, AZ, MD, NM, OH, OR, RI, TN, VT, WI; **60 days** e.g. CT, DE, LA, SD, TX | AG notice thresholds vary (e.g., CA 500+, NY any, TX 250+ within 30 days, WA 500+). Health data is "personal information" in CA, TX, WA, NY, and others. |
| Washington MHMDA / Nevada SB 370 | (no separate breach clock; state breach law applies) | per state law | Also check the incident does not amount to a "sharing" without consent. |
| Canada PIPEDA | Privacy Commissioner + individuals | "as soon as feasible" if real risk of significant harm | Keep a breach record for 24 months. |
| Trainers (Trainer Terms) | Affected trainers (controllers of client data) | **72 hours** | So they can meet their own duties. |
| App stores | Apple/Google if their user data or credentials involved | promptly | |

Counsel to confirm the state matrix against the residence list before sending anything.

## 5. Notify
Plain-language notice: what happened, when, what data, what we did, what they should do (change password, watch for phishing), contact
([PRIVACY CONTACT EMAIL — suggest privacy@axiomtraining.io], [POSTAL ADDRESS]). Send via SendGrid as a transactional email (not gated by marketing consent).
Keep copies of every notice and the recipient list.

## 6. After
Root-cause write-up within 14 days; fix; add a regression test; update `docs/DATA_PROCESSORS.md` and the privacy policy if processing changed.
Retain the incident file for at least 5 years.
