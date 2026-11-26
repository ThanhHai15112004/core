import {
  DOMParser,
  type Document,
  type Element,
  type Node,
} from '@xmldom/xmldom';
import {
  FEDERATED_AUTH_STAGE,
  SAML_BINDING,
  SAML_CERT_STATUS,
  SAML_DEFAULTS,
  type SamlBinding,
} from '../enum/federated-identity.enum.js';
import { FederatedStageError } from '../services/federated-jwks.service.js';
import type { SamlProviderConfig } from '../types/federated-identity.types.js';
import { inspectX509Certificate, stripPemHeaders } from './saml-certificate.helper.js';

const SAML2_METADATA_NS = 'urn:oasis:names:tc:SAML:2.0:metadata';
const SAML2_PROTOCOL_NS = 'urn:oasis:names:tc:SAML:2.0:protocol';
const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const BINDING_HTTP_REDIRECT_URI = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
const BINDING_HTTP_POST_URI = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';

export interface ParsedIdpMetadata {
  readonly idpEntityId: string;
  readonly idpSsoUrl: string;
  readonly idpSsoBinding: SamlBinding;
  readonly redirectSsoUrl: string | null;
  readonly postSsoUrl: string | null;
  readonly signingCertificatesPem: readonly string[];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function assertSafeXmlPayload(xml: string, maxBytes: number = SAML_DEFAULTS.MAX_RESPONSE_BYTES): void {
  if (!xml || xml.trim().length === 0) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidResponse',
      stage: FEDERATED_AUTH_STAGE.SAML_METADATA,
      stageErrorCode: 'SAML_EMPTY_XML',
      diagnosticMessage: 'XML payload is empty',
    });
  }
  if (Buffer.byteLength(xml, 'utf8') > maxBytes) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidResponse',
      stage: FEDERATED_AUTH_STAGE.SAML_METADATA,
      stageErrorCode: 'SAML_PAYLOAD_TOO_LARGE',
      diagnosticMessage: 'XML payload exceeds maximum allowed size',
    });
  }
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(xml)) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlXxeDetected',
      stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
      stageErrorCode: 'SAML_XXE_DETECTED',
      diagnosticMessage: 'Unsafe DTD or ENTITY declaration rejected in XML payload',
    });
  }
}

export function parseXmlStrict(xml: string): Document {
  assertSafeXmlPayload(xml, SAML_DEFAULTS.MAX_RESPONSE_BYTES);
  let parseFailure: string | null = null;
  const parser = new DOMParser({
    onError: (level: string, msg: string) => {
      if (level === 'fatalError' || level === 'error') {
        parseFailure = msg;
      }
    },
  });
  const doc = parser.parseFromString(xml, 'text/xml');
  if (parseFailure || !doc || !doc.documentElement || doc.doctype != null) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidResponse',
      stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
      stageErrorCode: 'SAML_MALFORMED_XML',
      diagnosticMessage: 'Failed to parse SAML XML payload safely',
    });
  }
  return doc;
}

function getChildElementsByLocalName(parent: Node, localName: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i += 1) {
    const child = parent.childNodes.item(i);
    if (child && child.nodeType === 1) {
      const el = child as Element;
      if ((el.localName ?? el.nodeName.split(':').pop()) === localName) {
        out.push(el);
      }
    }
  }
  return out;
}

function findElementsByLocalName(root: Node, localName: string): Element[] {
  const out: Element[] = [];
  const walk = (node: Node) => {
    for (let i = 0; i < node.childNodes.length; i += 1) {
      const child = node.childNodes.item(i);
      if (child && child.nodeType === 1) {
        const el = child as Element;
        if ((el.localName ?? el.nodeName.split(':').pop()) === localName) {
          out.push(el);
        }
        walk(el);
      }
    }
  };
  walk(root);
  return out;
}

export function buildSpMetadataXml(config: SamlProviderConfig): string {
  const signingSpCerts = config.spCertificates.filter(
    (c) => c.status !== SAML_CERT_STATUS.REVOKED,
  );
  const keyDescriptors = signingSpCerts
    .map((cert) => {
      const certBase64 = stripPemHeaders(cert.pem);
      return [
        '    <md:KeyDescriptor use="signing">',
        `      <ds:KeyInfo xmlns:ds="${XMLDSIG_NS}">`,
        '        <ds:X509Data>',
        `          <ds:X509Certificate>${certBase64}</ds:X509Certificate>`,
        '        </ds:X509Data>',
        '      </ds:KeyInfo>',
        '    </md:KeyDescriptor>',
      ].join('\n');
    })
    .join('\n');

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<md:EntityDescriptor xmlns:md="${SAML2_METADATA_NS}" entityID="${escapeXml(config.spEntityId)}">`,
    `  <md:SPSSODescriptor AuthnRequestsSigned="${String(config.authnRequestsSigned)}" WantAssertionsSigned="${String(config.wantAssertionsSigned)}" protocolSupportEnumeration="${SAML2_PROTOCOL_NS}">`,
    ...(keyDescriptors ? [keyDescriptors] : []),
    `    <md:NameIDFormat>${escapeXml(config.nameIdFormat)}</md:NameIDFormat>`,
    `    <md:AssertionConsumerService Binding="${BINDING_HTTP_POST_URI}" Location="${escapeXml(config.acsUrl)}" index="0" isDefault="true"/>`,
    '  </md:SPSSODescriptor>',
    '</md:EntityDescriptor>',
  ];
  return lines.join('\n');
}

export function parseIdpMetadataXml(xml: string): ParsedIdpMetadata {
  assertSafeXmlPayload(xml, SAML_DEFAULTS.MAX_METADATA_BYTES);
  const doc = parseXmlStrict(xml);
  const root = doc.documentElement;
  if (!root) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidMetadata',
      stage: FEDERATED_AUTH_STAGE.SAML_METADATA,
      stageErrorCode: 'SAML_INVALID_METADATA',
      diagnosticMessage: 'IdP Metadata XML has no root element',
    });
  }
  const rootLocal = root.localName ?? root.nodeName.split(':').pop();

  let entityDescriptor: Element | null = rootLocal === 'EntityDescriptor' ? root : null;
  if (!entityDescriptor) {
    entityDescriptor = findElementsByLocalName(root, 'EntityDescriptor')[0] ?? null;
  }

  const idpEntityId = entityDescriptor?.getAttribute('entityID')?.trim() ?? '';
  if (!idpEntityId) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidMetadata',
      stage: FEDERATED_AUTH_STAGE.SAML_METADATA,
      stageErrorCode: 'SAML_METADATA_MISSING_ENTITY_ID',
      diagnosticMessage: 'IdP Metadata is missing EntityDescriptor/@entityID',
    });
  }

  const idpDescriptor = getChildElementsByLocalName(entityDescriptor!, 'IDPSSODescriptor')[0] ??
    findElementsByLocalName(entityDescriptor!, 'IDPSSODescriptor')[0];
  if (!idpDescriptor) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidMetadata',
      stage: FEDERATED_AUTH_STAGE.SAML_METADATA,
      stageErrorCode: 'SAML_METADATA_MISSING_IDP_DESCRIPTOR',
      diagnosticMessage: 'IdP Metadata is missing IDPSSODescriptor',
    });
  }

  const ssoServices = getChildElementsByLocalName(idpDescriptor, 'SingleSignOnService');
  let redirectSsoUrl: string | null = null;
  let postSsoUrl: string | null = null;
  for (const svc of ssoServices) {
    const binding = svc.getAttribute('Binding')?.trim() ?? '';
    const location = svc.getAttribute('Location')?.trim() ?? '';
    if (!location) continue;
    if (binding === BINDING_HTTP_REDIRECT_URI && !redirectSsoUrl) {
      redirectSsoUrl = location;
    } else if (binding === BINDING_HTTP_POST_URI && !postSsoUrl) {
      postSsoUrl = location;
    }
  }

  const idpSsoUrl = redirectSsoUrl ?? postSsoUrl ?? '';
  const idpSsoBinding: SamlBinding = redirectSsoUrl
    ? SAML_BINDING.HTTP_REDIRECT
    : SAML_BINDING.HTTP_POST;

  if (!idpSsoUrl) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidMetadata',
      stage: FEDERATED_AUTH_STAGE.SAML_METADATA,
      stageErrorCode: 'SAML_METADATA_MISSING_SSO_URL',
      diagnosticMessage: 'IdP Metadata is missing HTTP-Redirect or HTTP-POST SingleSignOnService',
    });
  }

  const keyDescriptors = getChildElementsByLocalName(idpDescriptor, 'KeyDescriptor');
  const seenFingerprints = new Set<string>();
  const signingCertificatesPem: string[] = [];

  for (const kd of keyDescriptors) {
    const use = kd.getAttribute('use')?.trim().toLowerCase();
    if (use && use !== 'signing') continue;
    const certNodes = findElementsByLocalName(kd, 'X509Certificate');
    for (const certNode of certNodes) {
      const rawText = certNode.textContent?.trim() ?? '';
      if (!rawText) continue;
      const inspected = inspectX509Certificate(rawText);
      if (!seenFingerprints.has(inspected.fingerprint256)) {
        seenFingerprints.add(inspected.fingerprint256);
        signingCertificatesPem.push(inspected.pem);
      }
    }
  }

  if (signingCertificatesPem.length === 0) {
    throw new FederatedStageError({
      i18nKey: 'federated-identity.samlInvalidMetadata',
      stage: FEDERATED_AUTH_STAGE.SAML_METADATA,
      stageErrorCode: 'SAML_METADATA_MISSING_CERTIFICATE',
      diagnosticMessage: 'IdP Metadata does not contain any signing X509Certificate',
    });
  }

  return {
    idpEntityId,
    idpSsoUrl,
    idpSsoBinding,
    redirectSsoUrl,
    postSsoUrl,
    signingCertificatesPem,
  };
}
