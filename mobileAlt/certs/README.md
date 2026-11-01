# EAS Update code signing

`certificate.pem` is public and ships in `app.json`. A build made with it only accepts updates signed by the matching private key.

- The private key is not in this repo: it's in `secure-backups/eas-codesigning/keys/` on the server, and in the GitHub secret `EXPO_UPDATES_PRIVATE_KEY`.
- CI signs every OTA when that secret is set (`.github/workflows/mobile.yml`). Without it, CI publishes unsigned updates, and any build carrying the certificate ignores them.
- Builds made before 2026-10-16 have no certificate and accept any update from the channel.
- Changing the key means a new certificate, and builds with the old one stop receiving updates. Push the new certificate to `main` before changing the secret: a key that doesn't match the certificate can stop OTAs for everyone.

GitHub never shows a secret's value after saving, so an empty edit box doesn't mean it's unset. To check it, look at the OTA job: a malformed key fails with `Invalid PEM formatted message`.
