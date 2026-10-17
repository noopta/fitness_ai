# Content Moderation Policy and Report-Review Runbook

Draft for counsel review. Last updated 16 October 2026. Owner: founder. Public rules: Terms of Service section 11 (Community rules).
Covers App Store Guideline 1.2 (UGC: filter, report, block, act within 24h, published contact) and Google Play UGC policy.

## 1. Surfaces
Posts (friends / public), comments, reactions, direct messages, group chats, Train Together groups, profile names/usernames/avatars,
shared workout and program cards, form-check videos (private; screened for minors/CSAM/non-training content).

## 2. Automated controls (in code)
| Control | Where | Behaviour |
|---|---|---|
| Text moderation | `moderateText` (OpenAI moderation) on DMs, comments, post captions, coach messages | Blocks high-confidence violations; flagged-but-allowed and blocked items write a `ContentFlag` (excerpt, categories). Flags survive account deletion for abuse-pattern analysis. |
| Image moderation | `moderatePost`, avatar checks | Blocks sexual/violent imagery. |
| Video screening | `formVideoScreeningService.ts` | `allow` / `reject` / `quarantine`. Quarantine suppresses deletion and pages the founder (see `CSAM_PROCEDURE.md`). |
| Auto-hide on reports | `routes/social.ts` `shouldAutoHide` | A post is set to `visibility: 'hidden'` (not deleted) once **5 distinct reporters whose accounts are more than 7 days old** report it, or **3** such reporters if at least one is the author's accepted friend. Reports from the author and from accounts 7 days old or newer do not count. The author gets a push: "Your post is hidden for review". |
| Report endpoint | `POST /api/social/report` (post, comment, message, user) | Reasons: sexual, harassment, hate, violence, spam, impersonation, self_harm, misinformation, other. A reporter can only report what they can see; unknown ids get the same acknowledgement (no existence oracle). Stored in `ContentReport` (`status` default `pending`). |
| Block | `POST /api/social/users/:userId/block` | Blocked users disappear from each other's feeds, search and messages. |

Known gaps: group-chat messages are not run through `moderateText` yet; there is no admin UI for the `ContentReport` queue (review is done with SQL until it exists).

## 3. Service level
- **Every report is reviewed by a person within 24 hours** of submission (the in-app acknowledgement promises this).
- Self-harm or threats of violence: review within 1 hour of the alert during waking hours; if there is an imminent risk to life, contact local emergency services with the information available.
- Apparent child sexual abuse material: follow `CSAM_PROCEDURE.md` immediately. Do not view more than needed; do not download to personal devices.

## 4. Daily review procedure
1. Open the queue: `SELECT * FROM ContentReport WHERE status='pending' ORDER BY createdAt;` plus `ContentFlag` rows from the last 24h with `blocked=0`.
2. For each report, look at the reported item in context (thread, post, profile). Check prior reports/flags against `reportedUserId`.
3. Decide and record (`status` = `actioned` or `dismissed`, with a note):
   - **Remove**: delete the item, or keep `visibility='hidden'`.
   - **Restore**: an auto-hidden post that does not break the rules goes back to its previous visibility; tell the author.
   - **Warn**: message the user explaining which rule was broken.
   - **Restrict / suspend**: repeated or serious violations (harassment campaigns, sexual content, impersonation, spam rings).
   - **Ban + preserve**: CSAM, credible threats, sextortion; preserve evidence; report (NCMEC / police).
4. Tell the reporter the outcome where the UI allows; tell the affected user what was done and how to appeal.

## 5. Appeals
Users reply to the notice or email inquiries@axiomtraining.io. A different review (or a second look after 24h, while the founder is the only reviewer)
decides within 7 days. Restore content wrongly removed.

## 6. Rules applied (summary of Terms s.11)
Zero tolerance: sexualisation of minors; non-consensual intimate imagery; credible threats. Removed: harassment, hate, sexually explicit content,
promotion of self-harm/eating disorders/extreme restriction/steroids or SARMs, dangerous medical misinformation, spam/scams, impersonation, IP infringement.
Fitness context is allowed: physique photos in normal training attire, injury discussion, frank nutrition talk.

## 7. Records
Keep `ContentReport` and `ContentFlag` rows as the moderation record. Privacy policy discloses that flag excerpts survive deletion for up to
[MODERATION RECORD RETENTION — suggest 2 years]. Review this policy every 6 months or after any incident.
