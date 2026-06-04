# Workload Identity Federation (WIF) — backend GCP auth

The backend authenticates to GCP (Vertex AI, GCS) via WIF tied to the EC2's
AWS IAM role. There are **no long-lived credentials** on disk and **no
human session involved at runtime** — tokens are minted on demand against
the EC2 instance metadata.

## Architecture

```
EC2 (instance profile axiom-ec2-vertex, account 544341949146)
  ↓ AWS STS GetCallerIdentity (signed v4 request)
GCP STS (audience = projects/656267185967/.../axiom-aws/axiom-aws-provider)
  ↓ federated access token
iamcredentials.googleapis.com (impersonates axiom-service-account@sinuous-concept-497821-s5)
  ↓ access token as that SA
Vertex AI + GCS bucket axiom-form-videos-656267185967
```

## What's on disk

`backend/gcp-wif-credentials.json` — routing config (no secrets). Tells the
SDK how to walk the federation chain. Generated on the EC2 by:

```bash
gcloud iam workload-identity-pools create-cred-config \
  projects/656267185967/locations/global/workloadIdentityPools/axiom-aws/providers/axiom-aws-provider \
  --service-account=axiom-service-account@sinuous-concept-497821-s5.iam.gserviceaccount.com \
  --aws --enable-imdsv2 \
  --output-file=backend/gcp-wif-credentials.json
```

The `--enable-imdsv2` flag is critical — without it, the auth library fails
with empty 401s because our EC2 has IMDSv2-required.

`backend/.env` — sets `GOOGLE_APPLICATION_CREDENTIALS` to that file.
SDKs (`@google/genai`, `@google-cloud/storage`) auto-pick it up.

## IAM bindings required

On `axiom-service-account@sinuous-concept-497821-s5.iam.gserviceaccount.com`:
- `roles/iam.workloadIdentityUser` with member `principalSet://iam.googleapis.com/projects/656267185967/locations/global/workloadIdentityPools/axiom-aws/attribute.aws_role/arn:aws:sts::544341949146:assumed-role/axiom-ec2-vertex`

On project `656267185967` (where Vertex API is enabled + credits live):
- `roles/aiplatform.user` for the SA

On bucket `gs://axiom-form-videos-656267185967`:
- `roles/storage.objectUser` for the SA

Cross-project IAM (binding is in sinuous-concept-497821-s5, target is in
656267185967) takes 5–10 min to propagate the first time. Same-project
changes propagate in ~30s.

## Re-creating WIF if you ever lose the credential config

You don't need to keep this file backed up — it can be regenerated any time
with the gcloud command above. The bindings are persistent in GCP; the file
just tells the SDK how to use them.

## When the daily ADC reauth comes back

It shouldn't. If you find yourself running `gcloud auth application-default
login` again to fix backend errors, something is wrong:

- Check `.env` still has `GOOGLE_APPLICATION_CREDENTIALS=/home/ubuntu/...wif-credentials.json`
- Check the file exists + has 600 perms
- Check the EC2 still has IAM role `axiom-ec2-vertex` attached
- Check the SA still has the three role bindings above
