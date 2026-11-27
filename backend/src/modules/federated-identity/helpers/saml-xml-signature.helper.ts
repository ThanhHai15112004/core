import { createSign, randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { XMLSerializer, type Document, type Element, type Node } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import {
  FEDERATED_AUTH_STAGE,
  SAML_BINDING,
  type SamlBinding,
  type SamlCertStatus,
} from '../enum/federated-identity.enum.js';
import { FederatedStageError } from '../services/federated-jwks.service.js';
import type { SamlIdpCertificateConfig } from '../types/federated-identity.types.js';
import { getEligibleIdpVerificationCerts } from './saml-certificate.helper.js';
import { parseXmlStrict } from './saml-metadata.helper.js';

const SAML2_PROTOCOL_NS = 'urn:oasis:names:tc:SAML:2.0:protocol';
const SAML2_ASSERTION_NS = 'urn:oasis:names:tc:SAML:2.0:assertion';
const BINDING_HTTP_POST_URI = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
const RSA_SHA256_SIG_ALG_URI = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';

export interface VerifiedSamlXmlResult {
  readonly document: Document;
  readonly responseNode: Element;
  readonly assertionNode: Element;
  readonly signedTarget: 'ASSERTION' | 'RESPONSE';
  readonly certFingerprint: string;
  readonly certStatus: SamlCertStatus;
}

export interface BuiltSamlAuthnRequest {
  readonly requestId: string;
  readonly authorizationUrl: string;
  readonly samlRequest: string;
  readonly relayState: string;
  readonly binding: SamlBinding;
  readonly xml: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getLocalName(node: Node): string {
  const el = node as Element;
  return el.localName ?? node.nodeName.split(':').pop() ?? '';
}

function getDirectChildElements(parent: Node, localName: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i += 1) {
    const child = parent.childNodes.item(i);
    if (child && child.nodeType === 1 && getLocalName(child) === localName) {
      out.push(child as Element);
    }
  }
  return out;
}

function assertNoDuplicateXmlIds(root: Element): void {
  const seenIds = new Set<string>();
  const walk = (el: Element) => {
    const idAttr =
      el.getAttribute('ID')?.trim() ||
      el.getAttribute('Id')?.trim() ||
      el.getAttribute('id')?.trim();
    if (idAttr) {
      if (seenIds.has(idAttr)) {
        throw new FederatedStageError({
          i18nKey: 'federated-identity.samlXswDetected',
          stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
          stageErrorCode: 'SAML_XSW_DETECTED',
          diagnosticMessage: 'Duplicate XML ID attribute detected in SAML document',
        });
      }
      seenIds.add(idAttr);
    }
    for (let i = 0; i < el.childNodes.length; i += 1) {
      const child = el.childNodes.item(i);
      if (child && child.nodeType === 1) {
        walk(child as Element);
      }
    }
  };
  walk(root);
}

function findAllSignatureElements(root: Node): Element[] {
  const out: Element[] = [];
  const walk = (node: Node) => {
    for (let i = 0; i < node.childNodes.length; i += 1) {
      const child = node.childNodes.item(i);
      if (child && child.nodeType === 1) {
        const el = child as Element;
        if (
          getLocalName(el) === 'Signature' &&
          (!el.namespaceURI || el.namespaceURI === XMLDSIG_NS)
        ) {
          out.push(el);
        }
        walk(el);
      }
    }
  };
  walk(root);
  return out;
}

function verifySignatureAgainstCerts(params: {
  readonly xml: string;
  readonly signatureNode: Element;
  readonly expectedTargetId: string;
  readonly allowEmptyUri: boolean;
  readonly eligibleCerts: readonly SamlIdpCertificateConfig[];
}): { readonly certFingerprint: string; readonly certStatus: SamlCertStatus } | null {
  const serializer = new XMLSerializer();
  const signatureXml = serializer.serializeToString(params.signatureNode);

  for (const cert of params.eligibleCerts) {
    try {
      const verifier = new SignedXml({
        publicCert: cert.pem,
        // Bắt buộc bỏ qua KeyInfo nhúng trong XML để chỉ tin tưởng certificate do hệ thống quản trị cấu hình.
        getCertFromKeyInfo: () => null,
      });
      verifier.loadSignature(signatureXml);
      const isValid = verifier.checkSignature(params.xml);
      if (!isValid) continue;

      const refs = verifier.getReferences();
      if (refs.length !== 1) continue;
      const refUri = (refs[0]?.uri ?? '').trim();
      const matchesTarget =
        refUri === `#${params.expectedTargetId}` || (params.allowEmptyUri && refUri === '');
      if (!matchesTarget) {
        continue;
      }
      return {
        certFingerprint: cert.fingerprint256,
        certStatus: cert.status,
      };
    } catch {
      // Try next eligible certificate (supports active + transitioning rotation)
    }
  }
  return null;
}

export function verifySamlXmlSignature(params: {
  readonly xml: string;
  readonly idpCertificates: readonly SamlIdpCertificateConfig[];
  readonly wantAssertionsSigned: boolean;
  readonly now?: Date | undefined;
  readonly clockSkewSeconds?: number | undefined;
}): VerifiedSamlXmlResult {
  const doc = parseXmlStrict(params.xml);
  const responseNode = doc.documentElement;
  if (!responseNode || getLocalName(responseNode) !== 'Response') {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidResponse',
      stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
      stageErrorCode: 'SAML_INVALID_ROOT_ELEMENT',
      diagnosticMessage: 'SAML payload root element must be Response',
    });
  }

  assertNoDuplicateXmlIds(responseNode);

  const encryptedAssertions = getDirectChildElements(responseNode, 'EncryptedAssertion');
  if (encryptedAssertions.length > 0) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidResponse',
      stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
      stageErrorCode: 'SAML_ENCRYPTED_ASSERTION_UNSUPPORTED',
      diagnosticMessage: 'Encrypted SAML assertions are not supported',
    });
  }

  const assertions = getDirectChildElements(responseNode, 'Assertion');
  if (assertions.length !== 1 || !assertions[0]) {
    throw new FederatedStageError({
      i18nKey:
        assertions.length > 1
          ? 'federated-identity.samlXswDetected'
          : 'federated-identity.samlInvalidResponse',
      stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
      stageErrorCode: assertions.length > 1 ? 'SAML_XSW_DETECTED' : 'SAML_MISSING_ASSERTION',
      diagnosticMessage:
        assertions.length > 1
          ? 'Multiple SAML Assertion elements are rejected for XSW protection'
          : 'SAML Response does not contain a direct Assertion element',
    });
  }

  const assertionNode = assertions[0];
  const allSignatures = findAllSignatureElements(responseNode);
  if (allSignatures.length === 0) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlUnsignedAssertion',
      stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
      stageErrorCode: 'SAML_UNSIGNED_ASSERTION',
      diagnosticMessage: 'SAML Response/Assertion contains no XMLDSig Signature',
    });
  }

  const eligibleCerts = getEligibleIdpVerificationCerts(
    params.idpCertificates,
    params.now ?? new Date(),
    params.clockSkewSeconds ?? 60,
  );
  if (eligibleCerts.length === 0) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidSignature',
      stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
      stageErrorCode: 'SAML_NO_ELIGIBLE_CERTIFICATE',
      diagnosticMessage:
        'No active or transitioning IdP certificate is eligible to verify signature',
    });
  }

  const serializer = new XMLSerializer();
  const normalizedXml = serializer.serializeToString(doc);

  const assertionSignatures = getDirectChildElements(assertionNode, 'Signature');
  const assertionId = assertionNode.getAttribute('ID')?.trim() ?? '';

  if (assertionSignatures.length > 1) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlXswDetected',
      stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
      stageErrorCode: 'SAML_XSW_DETECTED',
      diagnosticMessage: 'Multiple direct Signature elements on SAML Assertion are rejected',
    });
  }

  if (assertionSignatures.length === 1 && assertionSignatures[0]) {
    if (!assertionId) {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.samlInvalidSignature',
        stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
        stageErrorCode: 'SAML_INVALID_SIGNATURE',
        diagnosticMessage: 'Signed Assertion is missing ID attribute',
      });
    }
    const verified = verifySignatureAgainstCerts({
      xml: normalizedXml,
      signatureNode: assertionSignatures[0],
      expectedTargetId: assertionId,
      allowEmptyUri: false,
      eligibleCerts,
    });
    if (!verified) {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.samlInvalidSignature',
        stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
        stageErrorCode: 'SAML_INVALID_SIGNATURE',
        diagnosticMessage: 'SAML Assertion signature verification failed',
      });
    }
    return {
      document: doc,
      responseNode,
      assertionNode,
      signedTarget: 'ASSERTION',
      certFingerprint: verified.certFingerprint,
      certStatus: verified.certStatus,
    };
  }

  if (params.wantAssertionsSigned) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlUnsignedAssertion',
      stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
      stageErrorCode: 'SAML_UNSIGNED_ASSERTION',
      diagnosticMessage: 'Provider requires SAML Assertion element itself to be signed',
    });
  }

  const responseSignatures = getDirectChildElements(responseNode, 'Signature');
  const responseId = responseNode.getAttribute('ID')?.trim() ?? '';
  if (responseSignatures.length !== 1 || !responseSignatures[0] || !responseId) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidSignature',
      stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
      stageErrorCode: 'SAML_INVALID_SIGNATURE',
      diagnosticMessage: 'SAML Response signature is missing or invalid',
    });
  }

  const verifiedResponse = verifySignatureAgainstCerts({
    xml: normalizedXml,
    signatureNode: responseSignatures[0],
    expectedTargetId: responseId,
    allowEmptyUri: true,
    eligibleCerts,
  });
  if (!verifiedResponse) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidSignature',
      stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
      stageErrorCode: 'SAML_INVALID_SIGNATURE',
      diagnosticMessage: 'SAML Response signature verification failed',
    });
  }

  return {
    document: doc,
    responseNode,
    assertionNode,
    signedTarget: 'RESPONSE',
    certFingerprint: verifiedResponse.certFingerprint,
    certStatus: verifiedResponse.certStatus,
  };
}

export function buildSamlAuthnRequest(params: {
  readonly spEntityId: string;
  readonly acsUrl: string;
  readonly idpSsoUrl: string;
  readonly nameIdFormat: string;
  readonly binding: SamlBinding;
  readonly relayState: string;
  readonly signRequest?: boolean | undefined;
  readonly signingPrivateKeyPem?: string | null | undefined;
  readonly signingCertPem?: string | null | undefined;
  readonly issueInstant?: Date | undefined;
}): BuiltSamlAuthnRequest {
  const requestId = `_${randomBytes(16).toString('hex')}`;
  const issueInstant = (params.issueInstant ?? new Date()).toISOString();

  let xml = [
    `<samlp:AuthnRequest xmlns:samlp="${SAML2_PROTOCOL_NS}" xmlns:saml="${SAML2_ASSERTION_NS}"`,
    ` ID="${escapeXml(requestId)}"`,
    ` Version="2.0"`,
    ` IssueInstant="${escapeXml(issueInstant)}"`,
    ` Destination="${escapeXml(params.idpSsoUrl)}"`,
    ` ProtocolBinding="${BINDING_HTTP_POST_URI}"`,
    ` AssertionConsumerServiceURL="${escapeXml(params.acsUrl)}">`,
    `<saml:Issuer>${escapeXml(params.spEntityId)}</saml:Issuer>`,
    `<samlp:NameIDPolicy Format="${escapeXml(params.nameIdFormat)}" AllowCreate="true"/>`,
    `</samlp:AuthnRequest>`,
  ].join('');

  if (params.binding === SAML_BINDING.HTTP_POST) {
    if (params.signRequest && params.signingPrivateKeyPem) {
      const signer = new SignedXml({
        privateKey: params.signingPrivateKeyPem,
        ...(params.signingCertPem ? { publicCert: params.signingCertPem } : {}),
        signatureAlgorithm: RSA_SHA256_SIG_ALG_URI,
        canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
      });
      signer.addReference({
        xpath: "//*[local-name(.)='AuthnRequest']",
        transforms: [
          'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
          'http://www.w3.org/2001/10/xml-exc-c14n#',
        ],
        digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
        uri: `#${requestId}`,
      });
      signer.computeSignature(xml, {
        prefix: 'ds',
        location: { reference: "//*[local-name(.)='Issuer']", action: 'after' },
      });
      xml = signer.getSignedXml();
    }

    const samlRequest = Buffer.from(xml, 'utf8').toString('base64');
    return {
      requestId,
      authorizationUrl: params.idpSsoUrl,
      samlRequest,
      relayState: params.relayState,
      binding: SAML_BINDING.HTTP_POST,
      xml,
    };
  }

  const deflated = deflateRawSync(Buffer.from(xml, 'utf8'));
  const samlRequest = deflated.toString('base64');
  const queryParts = [
    `SAMLRequest=${encodeURIComponent(samlRequest)}`,
    `RelayState=${encodeURIComponent(params.relayState)}`,
  ];

  if (params.signRequest && params.signingPrivateKeyPem) {
    queryParts.push(`SigAlg=${encodeURIComponent(RSA_SHA256_SIG_ALG_URI)}`);
    const toSign = queryParts.join('&');
    const signature = createSign('RSA-SHA256')
      .update(toSign, 'utf8')
      .sign(params.signingPrivateKeyPem, 'base64');
    queryParts.push(`Signature=${encodeURIComponent(signature)}`);
  }

  const separator = params.idpSsoUrl.includes('?') ? '&' : '?';
  const authorizationUrl = `${params.idpSsoUrl}${separator}${queryParts.join('&')}`;

  return {
    requestId,
    authorizationUrl,
    samlRequest,
    relayState: params.relayState,
    binding: SAML_BINDING.HTTP_REDIRECT,
    xml,
  };
}
