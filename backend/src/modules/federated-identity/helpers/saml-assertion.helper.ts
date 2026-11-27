import { createHash } from 'node:crypto';
import type { Element, Node } from '@xmldom/xmldom';
import { FEDERATED_AUTH_STAGE } from '../enum/federated-identity.enum.js';
import { FederatedStageError } from '../services/federated-jwks.service.js';
import type { SamlProviderConfig } from '../types/federated-identity.types.js';

const SAML2_STATUS_SUCCESS = 'urn:oasis:names:tc:SAML:2.0:status:Success';

export interface ValidatedSamlAssertion {
  readonly responseId: string;
  readonly assertionId: string;
  readonly assertionIdHash: string;
  readonly inResponseTo: string | null;
  readonly issuer: string;
  readonly destination: string | null;
  readonly nameId: string;
  readonly nameIdFormat: string | null;
  readonly notBefore: Date | null;
  readonly notOnOrAfter: Date;
  readonly audiences: readonly string[];
  readonly attributes: Readonly<Record<string, readonly string[]>>;
}

function getLocalName(node: Node): string {
  const el = node as Element;
  return el.localName ?? node.nodeName.split(':').pop() ?? '';
}

function getDirectChildren(parent: Node, localName: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i += 1) {
    const child = parent.childNodes.item(i);
    if (child && child.nodeType === 1 && getLocalName(child) === localName) {
      out.push(child as Element);
    }
  }
  return out;
}

function parseSamlTimestamp(raw: string | null): Date | null {
  if (!raw || !raw.trim()) return null;
  const date = new Date(raw.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

export function sha256AssertionId(assertionId: string): string {
  return createHash('sha256').update(assertionId.trim(), 'utf8').digest('hex');
}

export function parseAndValidateSamlAssertion(params: {
  readonly responseNode: Element;
  readonly assertionNode: Element;
  readonly config: SamlProviderConfig;
  readonly now?: Date | undefined;
}): ValidatedSamlAssertion {
  const { responseNode, assertionNode, config } = params;
  const nowMs = (params.now ?? new Date()).getTime();
  const skewMs = Math.max(0, config.clockSkewSeconds) * 1000;

  // 1. Validate Response Status === Success
  const statusEl = getDirectChildren(responseNode, 'Status')[0];
  const statusCodeEl = statusEl ? getDirectChildren(statusEl, 'StatusCode')[0] : undefined;
  const statusValue = statusCodeEl?.getAttribute('Value')?.trim() ?? '';
  if (statusValue !== SAML2_STATUS_SUCCESS) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.providerReturnedError',
      stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
      stageErrorCode: 'SAML_STATUS_NOT_SUCCESS',
      providerError: statusValue || 'UNKNOWN_STATUS',
      diagnosticMessage: `SAML Response status is ${statusValue || 'missing'}`,
    });
  }

  const responseId = responseNode.getAttribute('ID')?.trim() ?? '';
  const responseInResponseTo = responseNode.getAttribute('InResponseTo')?.trim() || null;
  const destination = responseNode.getAttribute('Destination')?.trim() || null;

  if (destination && destination !== config.acsUrl) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidDestination',
      stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
      stageErrorCode: 'SAML_DESTINATION_MISMATCH',
      diagnosticMessage: 'SAML Response Destination does not match configured ACS URL',
    });
  }

  const expectedIdpEntityId = config.idpEntityId?.trim() ?? '';
  const responseIssuer = getDirectChildren(responseNode, 'Issuer')[0]?.textContent?.trim() || null;
  if (responseIssuer && expectedIdpEntityId && responseIssuer !== expectedIdpEntityId) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidIssuer',
      stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
      stageErrorCode: 'SAML_ISSUER_MISMATCH',
      diagnosticMessage: 'SAML Response Issuer does not match configured IdP Entity ID',
    });
  }

  // 2. Validate Assertion ID & Issuer
  const assertionId = assertionNode.getAttribute('ID')?.trim() ?? '';
  if (!assertionId) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidResponse',
      stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
      stageErrorCode: 'SAML_MISSING_ASSERTION_ID',
      diagnosticMessage: 'SAML Assertion is missing required ID attribute',
    });
  }
  const assertionIdHash = sha256AssertionId(assertionId);

  const assertionIssuer = getDirectChildren(assertionNode, 'Issuer')[0]?.textContent?.trim() ?? '';
  if (!assertionIssuer || (expectedIdpEntityId && assertionIssuer !== expectedIdpEntityId)) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidIssuer',
      stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
      stageErrorCode: 'SAML_ISSUER_MISMATCH',
      diagnosticMessage: 'SAML Assertion Issuer does not match configured IdP Entity ID',
      metadata: { assertionIdHash },
    });
  }

  // 3. Validate Subject, NameID, and SubjectConfirmationData
  const subjectEl = getDirectChildren(assertionNode, 'Subject')[0];
  const nameIdEl = subjectEl ? getDirectChildren(subjectEl, 'NameID')[0] : undefined;
  const nameId = nameIdEl?.textContent?.trim() ?? '';
  const nameIdFormat = nameIdEl?.getAttribute('Format')?.trim() || null;

  let confirmationInResponseTo: string | null = null;
  if (subjectEl) {
    const confirmations = getDirectChildren(subjectEl, 'SubjectConfirmation');
    for (const conf of confirmations) {
      const confData = getDirectChildren(conf, 'SubjectConfirmationData')[0];
      if (!confData) continue;
      const recipient = confData.getAttribute('Recipient')?.trim() || null;
      if (recipient && recipient !== config.acsUrl) {
        throw new FederatedStageError({
          i18nKey: 'federated-identity.samlInvalidDestination',
          stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
          stageErrorCode: 'SAML_DESTINATION_MISMATCH',
          diagnosticMessage: 'SubjectConfirmationData Recipient does not match configured ACS URL',
          metadata: { assertionIdHash },
        });
      }
      const confNotOnOrAfter = parseSamlTimestamp(confData.getAttribute('NotOnOrAfter'));
      if (confNotOnOrAfter && nowMs - skewMs >= confNotOnOrAfter.getTime()) {
        throw new FederatedStageError({
          i18nKey: 'federated-identity.samlAssertionExpired',
          stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
          stageErrorCode: 'SAML_TIME_WINDOW_INVALID',
          diagnosticMessage: 'SubjectConfirmationData NotOnOrAfter has expired',
          metadata: { assertionIdHash },
        });
      }
      const dataInResponseTo = confData.getAttribute('InResponseTo')?.trim() || null;
      if (dataInResponseTo) {
        confirmationInResponseTo = dataInResponseTo;
      }
    }
  }

  if (
    responseInResponseTo &&
    confirmationInResponseTo &&
    responseInResponseTo !== confirmationInResponseTo
  ) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInResponseToMismatch',
      stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
      stageErrorCode: 'SAML_IN_RESPONSE_TO_MISMATCH',
      diagnosticMessage: 'Response InResponseTo differs from SubjectConfirmationData InResponseTo',
      metadata: { assertionIdHash },
    });
  }
  const inResponseTo = confirmationInResponseTo ?? responseInResponseTo;

  // 4. Validate Conditions (Time window & AudienceRestriction)
  const conditionsEl = getDirectChildren(assertionNode, 'Conditions')[0];
  if (!conditionsEl) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidAudience',
      stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
      stageErrorCode: 'SAML_AUDIENCE_MISMATCH',
      diagnosticMessage: 'SAML Assertion is missing Conditions element',
      metadata: { assertionIdHash },
    });
  }

  const notBefore = parseSamlTimestamp(conditionsEl.getAttribute('NotBefore'));
  if (conditionsEl.getAttribute('NotBefore') && !notBefore) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlAssertionNotYetValid',
      stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
      stageErrorCode: 'SAML_TIME_WINDOW_INVALID',
      diagnosticMessage: 'Invalid NotBefore timestamp format in SAML Conditions',
      metadata: { assertionIdHash },
    });
  }
  if (notBefore && nowMs + skewMs < notBefore.getTime()) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlAssertionNotYetValid',
      stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
      stageErrorCode: 'SAML_TIME_WINDOW_INVALID',
      diagnosticMessage: 'SAML Assertion NotBefore is in the future',
      metadata: { assertionIdHash },
    });
  }

  const notOnOrAfter = parseSamlTimestamp(conditionsEl.getAttribute('NotOnOrAfter'));
  if (!notOnOrAfter) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlAssertionExpired',
      stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
      stageErrorCode: 'SAML_TIME_WINDOW_INVALID',
      diagnosticMessage: 'SAML Assertion Conditions is missing valid NotOnOrAfter',
      metadata: { assertionIdHash },
    });
  }
  if (nowMs - skewMs >= notOnOrAfter.getTime()) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlAssertionExpired',
      stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
      stageErrorCode: 'SAML_TIME_WINDOW_INVALID',
      diagnosticMessage: 'SAML Assertion NotOnOrAfter has expired',
      metadata: { assertionIdHash },
    });
  }

  const audienceRestrictions = getDirectChildren(conditionsEl, 'AudienceRestriction');
  const allAudiences: string[] = [];
  let audienceMatched = false;
  for (const ar of audienceRestrictions) {
    const audienceEls = getDirectChildren(ar, 'Audience');
    const groupAudiences = audienceEls
      .map((a) => a.textContent?.trim() ?? '')
      .filter((v) => v.length > 0);
    allAudiences.push(...groupAudiences);
    if (groupAudiences.includes(config.spEntityId)) {
      audienceMatched = true;
    }
  }
  if (audienceRestrictions.length === 0 || !audienceMatched) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidAudience',
      stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
      stageErrorCode: 'SAML_AUDIENCE_MISMATCH',
      diagnosticMessage: 'SAML Assertion AudienceRestriction does not match SP Entity ID',
      metadata: { assertionIdHash },
    });
  }

  // 5. Extract AttributeStatement attributes
  const attributesMap: Record<string, string[]> = {};
  const attrStatements = getDirectChildren(assertionNode, 'AttributeStatement');
  for (const stmt of attrStatements) {
    const attrs = getDirectChildren(stmt, 'Attribute');
    for (const attr of attrs) {
      const name = attr.getAttribute('Name')?.trim() || '';
      const friendlyName = attr.getAttribute('FriendlyName')?.trim() || '';
      const values = getDirectChildren(attr, 'AttributeValue')
        .map((v) => v.textContent?.trim() ?? '')
        .filter((v) => v.length > 0);
      if (values.length === 0) continue;

      if (name) {
        attributesMap[name] = [...(attributesMap[name] ?? []), ...values];
      }
      if (friendlyName && friendlyName !== name) {
        attributesMap[friendlyName] = [...(attributesMap[friendlyName] ?? []), ...values];
      }
    }
  }

  return {
    responseId,
    assertionId,
    assertionIdHash,
    inResponseTo,
    issuer: assertionIssuer,
    destination,
    nameId,
    nameIdFormat,
    notBefore,
    notOnOrAfter,
    audiences: allAudiences,
    attributes: attributesMap,
  };
}
