// App Store notification JWS: chaining to the pinned root is not enough. The
// leaf and intermediate must carry Apple's App Store marker OIDs, the payload
// must be for our bundle id, and signedDate must be fresh.
//
// Fixtures: a throwaway EC P-256 chain generated with openssl (20-year
// validity) whose root stands in for Apple Root CA - G3 via APPLE_ROOT_CA_G3_B64.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSign, X509Certificate } from 'crypto';

const FX = {
  "root": "MIIBczCCARigAwIBAgIUW4MWO+i01orKsaG0/o6CAc8i2jMwCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMVGVzdCBSb290IENBMB4XDTI2MTAxNjA5MDYyM1oXDTQ2MTAxMTA5MDYyM1owFzEVMBMGA1UEAwwMVGVzdCBSb290IENBMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7f7M5x62abhmhYe5LPMQnR5ILCM/01jrL65EFzxHrI8gtpbZlh05LEvAAxn9tBTyNnDngJj2Le2xX33NeMEKEaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFFHXMx2WSDeegjok2lkVyHluMl+qMAoGCCqGSM49BAMCA0kAMEYCIQCC/NNeD7o/dwi3YDqC7YE6AHP04qDG23UmQzzEsmW8fwIhAPxV4RXvO9MRsgM2Jn5bqaRCxTo+wBhy2J8xk8ex5z8q",
  "int": "MIIBrjCCAVOgAwIBAgIUId8j+/4HsxMuYHxrzdp+1fD58t4wCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMVGVzdCBSb290IENBMB4XDTI2MTAxNjA5MDYyM1oXDTQ2MTAxMTA5MDYyM1owHDEaMBgGA1UEAwwRVGVzdCBJbnRlcm1lZGlhdGUwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATn5qqpt6wZK4MMeSd2oJ6qZ+5z6Gw3o6MolihI25ChijwM3ZGymZrOveFeWGIQnwVfYkkQh1HCwgTV1h1PpFZYo3gwdjASBgNVHRMBAf8ECDAGAQH/AgEAMA4GA1UdDwEB/wQEAwIBBjAQBgoqhkiG92NkBgIBBAIFADAdBgNVHQ4EFgQU/zpqNjYbkdsOKbwVnupjT4Byel8wHwYDVR0jBBgwFoAUUdczHZZIN56COiTaWRXIeW4yX6owCgYIKoZIzj0EAwIDSQAwRgIhAOquNvdFf5fFtkxdkp4OWEEHzP9M1e3SdiuKQ45J767EAiEAy7QIrA8TLh+4JusnFxjoW0rVfWXpx9vuUiXeFya4Ocs=",
  "leaf": "MIIBpTCCAUqgAwIBAgIUfRqxigEXV9xSd1iUvYLjByq42LgwCgYIKoZIzj0EAwIwHDEaMBgGA1UEAwwRVGVzdCBJbnRlcm1lZGlhdGUwHhcNMjYxMDE2MDkwNjIzWhcNNDYxMDExMDkwNjIzWjAUMRIwEAYDVQQDDAlUZXN0IExlYWYwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATYXuchfBPxvl5Wc6OFGJT6fsS0jDpZ2KFEo7GRJNVstJRiBKY+lzzqR5zdUV8C+O1KTZOU20by0r1YALWkFOPmo3IwcDAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDAQBgoqhkiG92NkBgsBBAIFADAdBgNVHQ4EFgQUIn0BPocpBgfa6yVF4twz+zLdVk8wHwYDVR0jBBgwFoAU/zpqNjYbkdsOKbwVnupjT4Byel8wCgYIKoZIzj0EAwIDSQAwRgIhAKItnDeHLXMHgjycVN/yoatRqdi4OFkGnvKDRdJDNYR1AiEA0mmvNLJ9iwYdzsUY4T37KqOdh25F0UlqhPTPtIcyNhU=",
  "leafbad": "MIIBmTCCAT6gAwIBAgIUfRqxigEXV9xSd1iUvYLjByq42LkwCgYIKoZIzj0EAwIwHDEaMBgGA1UEAwwRVGVzdCBJbnRlcm1lZGlhdGUwHhcNMjYxMDE2MDkwNjIzWhcNNDYxMDExMDkwNjIzWjAaMRgwFgYDVQQDDA9UZXN0IExlYWYgTm9PaWQwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARt+3vVfFg+ayp0taIGbI4D7qL5v3K3ny7VrSnWkkL0ulSjE61DM4AnvNsv9ZDRN9oVTYgkZKfCJGWQ4bFX//Euo2AwXjAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDAdBgNVHQ4EFgQUDiuaMNop+lHRuAJiDKXiSqnRNpAwHwYDVR0jBBgwFoAU/zpqNjYbkdsOKbwVnupjT4Byel8wCgYIKoZIzj0EAwIDSQAwRgIhAPLocRiGUICO5ObTOPbLFsTk3nuPOJs8zxYK+eGzkJ+SAiEAqcpMeL/a7q36p9UA3TAUj6Wu9T4rBUokR3BvadrZwng=",
  "leafKey": "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgiFvFH6GPi8MoKE8d\nZdWWx9anwRZK8rX3rWB/aV4V2H2hRANCAATYXuchfBPxvl5Wc6OFGJT6fsS0jDpZ\n2KFEo7GRJNVstJRiBKY+lzzqR5zdUV8C+O1KTZOU20by0r1YALWkFOPm\n-----END PRIVATE KEY-----",
  "leafbadKey": "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgejnVVaPh1PC1i/DF\nZmQJ2bNWrH9tczBGIUyINYkZOH6hRANCAARt+3vVfFg+ayp0taIGbI4D7qL5v3K3\nny7VrSnWkkL0ulSjE61DM4AnvNsv9ZDRN9oVTYgkZKfCJGWQ4bFX//Eu\n-----END PRIVATE KEY-----"
};


const userMock = vi.hoisted(() => ({ update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) }));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.user = userMock; }) }));
vi.mock('../services/posthogClient.js', () => ({ default: { capture: vi.fn(), captureException: vi.fn() } }));
vi.mock('../middleware/requireAuth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 'u1' }; next(); },
}));

process.env.APPLE_ROOT_CA_G3_B64 = FX.root;
process.env.APPLE_IAP_BUNDLE_ID = 'io.axiomtraining.app';
import express from 'express';
import request from 'supertest';
// Dynamic: the pinned root is read at module load, after the env above.
const { default: appleRouter, verifyAppleJWS, certExtensionOids, hasAppStoreCertRoles, APPLE_LEAF_OID, APPLE_INTERMEDIATE_OID } = await import('../routes/appleIap.js');

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(payload: unknown, leaf = FX.leaf, key = FX.leafKey) {
  const header = b64u({ alg: 'ES256', x5c: [leaf, FX.int, FX.root] });
  const body = b64u(payload);
  const s = createSign('SHA256');
  s.update(`${header}.${body}`);
  const sig = s.sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${header}.${body}.${sig}`;
}
const cert = (b64: string) => new X509Certificate(Buffer.from(b64, 'base64'));

const app = express();
app.use(express.json());
app.use('/api', appleRouter);

beforeEach(() => { userMock.updateMany.mockClear(); });

describe('certificate role checks', () => {
  it('reads the marker OIDs out of the DER', () => {
    expect(certExtensionOids(cert(FX.leaf).raw)).toContain(APPLE_LEAF_OID);
    expect(certExtensionOids(cert(FX.int).raw)).toContain(APPLE_INTERMEDIATE_OID);
    expect(certExtensionOids(cert(FX.leafbad).raw)).not.toContain(APPLE_LEAF_OID);
  });
  it('requires leaf + intermediate roles', () => {
    expect(hasAppStoreCertRoles([cert(FX.leaf), cert(FX.int), cert(FX.root)])).toBe(true);
    expect(hasAppStoreCertRoles([cert(FX.leafbad), cert(FX.int), cert(FX.root)])).toBe(false);
    // An intermediate used as a leaf (CA cert) is refused.
    expect(hasAppStoreCertRoles([cert(FX.int), cert(FX.int), cert(FX.root)])).toBe(false);
    expect(hasAppStoreCertRoles([cert(FX.leaf), cert(FX.root)])).toBe(false);
  });
});

describe('verifyAppleJWS', () => {
  it('accepts a correctly signed App Store chain', () => {
    expect(verifyAppleJWS<any>(sign({ hello: 1 }))).toEqual({ hello: 1 });
  });
  it('refuses an Apple-rooted chain whose leaf lacks the App Store OID', () => {
    expect(verifyAppleJWS(sign({ hello: 1 }, FX.leafbad, FX.leafbadKey))).toBeNull();
  });
  it('refuses a tampered payload', () => {
    const [h, , s] = sign({ a: 1 }).split('.');
    expect(verifyAppleJWS(`${h}.${b64u({ a: 2 })}.${s}`)).toBeNull();
  });
});

describe('POST /payments/apple-iap/notifications', () => {
  const tx = (extra: object = {}) => sign({ originalTransactionId: 'otx1', environment: 'Production', bundleId: 'io.axiomtraining.app', ...extra });
  const note = (extra: object = {}, dataExtra: object = {}) => sign({
    notificationType: 'EXPIRED', signedDate: Date.now(),
    data: { bundleId: 'io.axiomtraining.app', environment: 'Production', signedTransactionInfo: tx(), ...dataExtra },
    ...extra,
  });

  it('acts on a fresh notification for our bundle', async () => {
    const r = await request(app).post('/api/payments/apple-iap/notifications').send({ signedPayload: note() });
    expect(r.status).toBe(200);
    expect(userMock.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { appleOriginalTransactionId: 'otx1' } }));
  });
  it('refuses another bundle id', async () => {
    const r = await request(app).post('/api/payments/apple-iap/notifications').send({ signedPayload: note({}, { bundleId: 'com.other.app' }) });
    expect(r.status).toBe(401);
    expect(userMock.updateMany).not.toHaveBeenCalled();
  });
  it('refuses an inner transaction for another bundle', async () => {
    const r = await request(app).post('/api/payments/apple-iap/notifications').send({ signedPayload: note({}, { signedTransactionInfo: tx({ bundleId: 'com.other.app' }) }) });
    expect(r.status).toBe(401);
    expect(userMock.updateMany).not.toHaveBeenCalled();
  });
  it('refuses a notification signed more than 24 h ago (replay)', async () => {
    const r = await request(app).post('/api/payments/apple-iap/notifications').send({ signedPayload: note({ signedDate: Date.now() - 25 * 3600_000 }) });
    expect(r.status).toBe(401);
    expect(userMock.updateMany).not.toHaveBeenCalled();
  });
  it('refuses an undated notification', async () => {
    const r = await request(app).post('/api/payments/apple-iap/notifications').send({ signedPayload: note({ signedDate: undefined }) });
    expect(r.status).toBe(401);
  });
});
