import { REDACTED, redactSensitiveData, redactText } from '@packages/logging/index.js';

const EXTRA_OAUTH_SENSITIVE_KEYS = new Set([
  'code',
  'codeverifier',
  'code_verifier',
  'idtoken',
  'id_token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'clientsecret',
  'client_secret',
  'stepuptoken',
  'step_up_token',
  'nonce',
  'authorization',
  'samlresponse',
  'saml_response',
  'samlrequest',
  'saml_request',
  'assertion',
  'assertionxml',
  'assertion_xml',
  'rawxml',
  'raw_xml',
  'signaturevalue',
  'signature_value',
  'x509certificate',
  'x509_certificate',
  'privatekey',
  'private_key',
  'privatekeyencrypted',
  'private_key_encrypted',
  'samlcode',
  'saml_code',
  'relaystate',
  'relay_state',
]);

function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

export function sanitizeFederatedErrorMessage(
  raw: string | null | undefined,
  maxLength = 500,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withoutSamlXml = trimmed
    .replace(
      /<[\w:-]*(?:Assertion|SignatureValue|X509Certificate|EncryptedData|EncryptedAssertion|Response|AuthnRequest)\b[\s\S]*?(?:<\/[\w:-]*(?:Assertion|SignatureValue|X509Certificate|EncryptedData|EncryptedAssertion|Response|AuthnRequest)>|\/>)/gi,
      '[REDACTED_SAML_XML]',
    )
    .replace(/[A-Za-z0-9+/=_-]{120,}/g, '[REDACTED_SAML_PAYLOAD]');
  const redacted = redactText(withoutSamlXml).text;
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}…`;
}

export function redactFederatedMetadata(
  input: Record<string, unknown> | null | undefined,
  depth = 0,
): Record<string, unknown> {
  if (!input || depth > 8) return {};
  const baseRedacted = redactSensitiveData(input);
  const out: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(baseRedacted)) {
    const normalized = normalizeKey(key);
    if (EXTRA_OAUTH_SENSITIVE_KEYS.has(normalized)) {
      out[key] = REDACTED;
    } else if (typeof val === 'string') {
      out[key] = val === REDACTED ? val : redactText(val).text;
    } else if (Array.isArray(val)) {
      out[key] = val.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? redactFederatedMetadata(item as Record<string, unknown>, depth + 1)
          : typeof item === 'string'
            ? redactText(item).text
            : item,
      );
    } else if (val && typeof val === 'object') {
      out[key] = redactFederatedMetadata(val as Record<string, unknown>, depth + 1);
    } else {
      out[key] = val;
    }
  }

  return out;
}
