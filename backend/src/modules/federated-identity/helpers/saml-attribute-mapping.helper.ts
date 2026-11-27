import { FEDERATED_AUTH_STAGE, FEDERATED_DRIVER_CODE } from '../enum/federated-identity.enum.js';
import { FederatedStageError } from '../services/federated-jwks.service.js';
import type {
  SamlProviderConfig,
  VerifiedExternalProfile,
} from '../types/federated-identity.types.js';
import type { ValidatedSamlAssertion } from './saml-assertion.helper.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FALLBACK_ATTR_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  email: [
    'email',
    'mail',
    'emailAddress',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    'urn:oid:0.9.2342.19200300.100.1.3',
  ],
  displayName: [
    'displayName',
    'name',
    'cn',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
    'urn:oid:2.16.840.1.113730.3.1.241',
  ],
  firstName: [
    'firstName',
    'givenName',
    'given_name',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
    'urn:oid:2.5.4.42',
  ],
  lastName: [
    'lastName',
    'sn',
    'surname',
    'family_name',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
    'urn:oid:2.5.4.4',
  ],
  groups: [
    'groups',
    'group',
    'memberOf',
    'roles',
    'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
    'http://schemas.xmlsoap.org/claims/Group',
  ],
};

function hasControlChars(val: string): boolean {
  for (let i = 0; i < val.length; i += 1) {
    const code = val.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function getAttrValues(
  attributes: Readonly<Record<string, readonly string[]>>,
  primaryName: string | null | undefined,
  fallbackGroupKey?: keyof typeof FALLBACK_ATTR_CANDIDATES,
): readonly string[] {
  if (primaryName && attributes[primaryName]?.length) {
    return attributes[primaryName]!;
  }
  if (primaryName) {
    const lowerPrimary = primaryName.toLowerCase();
    for (const [k, vals] of Object.entries(attributes)) {
      if (k.toLowerCase() === lowerPrimary && vals.length > 0) {
        return vals;
      }
    }
  }
  if (fallbackGroupKey) {
    for (const candidate of FALLBACK_ATTR_CANDIDATES[fallbackGroupKey] ?? []) {
      if (attributes[candidate]?.length) {
        return attributes[candidate]!;
      }
    }
  }
  return [];
}

function getSingleValidatedString(
  values: readonly string[],
  maxLength: number,
  fieldLabel: string,
  assertionIdHash: string,
): string | null {
  const first = values[0]?.trim();
  if (!first) return null;
  if (first.length > maxLength || hasControlChars(first)) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlAttributeValidationFailed',
      stage: FEDERATED_AUTH_STAGE.SAML_ATTRIBUTE_MAPPING,
      stageErrorCode: 'SAML_ATTRIBUTE_VALIDATION_FAILED',
      diagnosticMessage: `SAML attribute "${fieldLabel}" violates length or character constraints`,
      metadata: { assertionIdHash, fieldLabel },
    });
  }
  return first;
}

function parseBooleanValue(val: string | null): boolean {
  if (!val) return false;
  const lower = val.trim().toLowerCase();
  return lower === 'true' || lower === '1' || lower === 'yes';
}

export function mapAndValidateSamlAttributes(params: {
  readonly assertion: ValidatedSamlAssertion;
  readonly config: SamlProviderConfig;
  readonly providerCode: string;
}): VerifiedExternalProfile {
  const { assertion, config, providerCode } = params;
  const mapping = config.attributeMapping;
  const { attributes, assertionIdHash } = assertion;

  // Validate required attributes declared by admin
  for (const requiredAttr of mapping.requiredAttributes) {
    const vals = getAttrValues(attributes, requiredAttr);
    if (vals.length === 0 || !vals[0]?.trim()) {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.samlAttributeValidationFailed',
        stage: FEDERATED_AUTH_STAGE.SAML_ATTRIBUTE_MAPPING,
        stageErrorCode: 'SAML_ATTRIBUTE_VALIDATION_FAILED',
        diagnosticMessage: `Required SAML attribute "${requiredAttr}" is missing`,
        metadata: { assertionIdHash, missingAttribute: requiredAttr },
      });
    }
  }

  // Resolve stable subject (NameID or configured subjectAttribute)
  const rawSubject = mapping.subjectAttribute
    ? getSingleValidatedString(
        getAttrValues(attributes, mapping.subjectAttribute),
        255,
        'subject',
        assertionIdHash,
      )
    : getSingleValidatedString(
        assertion.nameId ? [assertion.nameId] : [],
        255,
        'NameID',
        assertionIdHash,
      );

  if (!rawSubject) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.missingSubject',
      stage: FEDERATED_AUTH_STAGE.SAML_ATTRIBUTE_MAPPING,
      stageErrorCode: 'SAML_MISSING_SUBJECT',
      diagnosticMessage: 'SAML Assertion does not contain a valid NameID or subject attribute',
      metadata: { assertionIdHash },
    });
  }

  const emailFromAttr = getSingleValidatedString(
    getAttrValues(
      attributes,
      mapping.emailAttribute,
      mapping.emailAttribute === 'email' ? 'email' : undefined,
    ),
    255,
    'email',
    assertionIdHash,
  );
  const emailFromNameId =
    !emailFromAttr && EMAIL_REGEX.test(assertion.nameId) ? assertion.nameId.trim() : null;
  const email = (emailFromAttr ?? emailFromNameId)?.toLowerCase() ?? null;

  if (mapping.requireEmail && !email) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlAttributeValidationFailed',
      stage: FEDERATED_AUTH_STAGE.SAML_ATTRIBUTE_MAPPING,
      stageErrorCode: 'SAML_ATTRIBUTE_VALIDATION_FAILED',
      diagnosticMessage: 'Required SAML email attribute is missing',
      metadata: { assertionIdHash, missingAttribute: mapping.emailAttribute },
    });
  }

  if (email && !EMAIL_REGEX.test(email)) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlAttributeValidationFailed',
      stage: FEDERATED_AUTH_STAGE.SAML_ATTRIBUTE_MAPPING,
      stageErrorCode: 'SAML_ATTRIBUTE_VALIDATION_FAILED',
      diagnosticMessage: 'Mapped SAML email attribute is not a valid email address',
      metadata: { assertionIdHash, invalidAttribute: mapping.emailAttribute },
    });
  }

  const emailVerifiedVal = mapping.emailVerifiedAttribute
    ? getSingleValidatedString(
        getAttrValues(attributes, mapping.emailVerifiedAttribute),
        32,
        'emailVerified',
        assertionIdHash,
      )
    : null;
  const emailVerified = Boolean(
    email &&
    (emailVerifiedVal !== null
      ? parseBooleanValue(emailVerifiedVal)
      : mapping.treatEmailAsVerified),
  );

  const firstName = getSingleValidatedString(
    getAttrValues(
      attributes,
      mapping.firstNameAttribute,
      mapping.firstNameAttribute === 'firstName' ? 'firstName' : undefined,
    ),
    120,
    'firstName',
    assertionIdHash,
  );
  const lastName = getSingleValidatedString(
    getAttrValues(
      attributes,
      mapping.lastNameAttribute,
      mapping.lastNameAttribute === 'lastName' ? 'lastName' : undefined,
    ),
    120,
    'lastName',
    assertionIdHash,
  );
  const explicitName = getSingleValidatedString(
    getAttrValues(
      attributes,
      mapping.nameAttribute,
      mapping.nameAttribute === 'displayName' ? 'displayName' : undefined,
    ),
    255,
    'displayName',
    assertionIdHash,
  );
  const displayName = explicitName ?? ([lastName, firstName].filter(Boolean).join(' ') || email);

  const avatarUrl = mapping.avatarAttribute
    ? getSingleValidatedString(
        getAttrValues(attributes, mapping.avatarAttribute),
        1000,
        'avatarUrl',
        assertionIdHash,
      )
    : null;
  if (avatarUrl && !/^https?:\/\//i.test(avatarUrl)) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlAttributeValidationFailed',
      stage: FEDERATED_AUTH_STAGE.SAML_ATTRIBUTE_MAPPING,
      stageErrorCode: 'SAML_ATTRIBUTE_VALIDATION_FAILED',
      diagnosticMessage: 'Mapped SAML avatar URL must use http or https scheme',
      metadata: { assertionIdHash, invalidAttribute: 'avatarUrl' },
    });
  }

  const tenantId = mapping.tenantIdAttribute
    ? getSingleValidatedString(
        getAttrValues(attributes, mapping.tenantIdAttribute),
        120,
        'tenantId',
        assertionIdHash,
      )
    : null;

  const rawGroups = getAttrValues(
    attributes,
    mapping.groupsAttribute,
    mapping.groupsAttribute === 'groups' ? 'groups' : undefined,
  );
  const groups = Array.from(
    new Set(
      rawGroups
        .flatMap((g) => (g.includes(',') ? g.split(',') : [g]))
        .map((g) => g.trim())
        .filter((g) => g.length > 0 && g.length <= 255 && !hasControlChars(g)),
    ),
  );

  const extraMapped: Record<string, string | number | boolean | null> = {};
  for (const [targetKey, sourceAttr] of Object.entries(mapping.extraAttributes)) {
    const val = getSingleValidatedString(
      getAttrValues(attributes, sourceAttr),
      500,
      targetKey,
      assertionIdHash,
    );
    if (val !== null) {
      extraMapped[targetKey] = val;
    }
  }

  return {
    providerCode,
    driverCode: FEDERATED_DRIVER_CODE.SAML,
    issuer: assertion.issuer,
    subject: rawSubject,
    tenantId,
    email,
    emailVerified,
    displayName,
    firstName,
    lastName,
    avatarUrl,
    ...(groups.length > 0 ? { groups } : {}),
    ...(Object.keys(extraMapped).length > 0 ? { attributes: extraMapped } : {}),
    rawClaimsSummary: {
      issuer: assertion.issuer,
      emailVerified,
      groupsCount: groups.length,
      nameIdFormat: assertion.nameIdFormat,
      assertionIdHash,
      ...(tenantId ? { tenantId } : {}),
      ...(Object.keys(extraMapped).length > 0
        ? { mappedAttributeKeys: Object.keys(extraMapped) }
        : {}),
    },
  };
}
