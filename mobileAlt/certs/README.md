# EAS Update code signing — removed in 3.2.2 (Nov 2026)

Code-signed updates need the EAS Production plan ($199/mo); the account is on Starter, so EAS refused every signed publish and, while the `EXPO_UPDATES_PRIVATE_KEY` GitHub secret existed, every OTA failed. Signing was removed:

- `app.json` no longer has `codeSigningCertificate` / `codeSigningMetadata`, and `.github/workflows/mobile.yml` publishes unsigned updates.
- Builds from 3.2.2 on, and builds made before 2026-10-16 (App Store 171), accept unsigned updates.
- TestFlight build 173 (3.2.1) was made with the certificate and only accepts signed updates, so it gets none. Replace it with a 3.2.2+ build.
- `certificate.pem` is kept here so signing can be turned back on if the plan changes; the private key is in `secure-backups/eas-codesigning/keys/` on the server. Turning it back on means adding the two keys to `app.json`, restoring the signing step in CI and a new native build.
