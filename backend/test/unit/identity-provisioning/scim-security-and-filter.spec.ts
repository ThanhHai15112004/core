import { describe, expect, it } from '@jest/globals';
import { SCIM_SCHEMAS } from '../../../src/modules/identity-provisioning/enum/identity-provisioning.enum.js';
import { ScimProtocolException } from '../../../src/modules/identity-provisioning/helpers/scim-error.helper.js';
import {
  matchesScimGroupFilter,
  matchesScimUserFilter,
  parseScimFilter,
} from '../../../src/modules/identity-provisioning/helpers/scim-filter.helper.js';
import {
  applyScimGroupPatchOperations,
  applyScimUserPatchOperations,
} from '../../../src/modules/identity-provisioning/helpers/scim-mapper.helper.js';
import {
  computeScimPayloadFingerprint,
  formatScimEtag,
  generateScimBearerToken,
  isScimClientIpAllowed,
  normalizeCallerIp,
  parseScimIfMatchVersion,
  redactScimPayload,
  verifyScimTokenHash,
} from '../../../src/modules/identity-provisioning/helpers/scim-security.helper.js';
import type {
  ScimGroupResource,
  ScimUserResource,
} from '../../../src/modules/identity-provisioning/types/identity-provisioning.types.js';

describe('SCIM 2.0 Security, Fingerprint, ETag & Filter Helpers', () => {
  it('generates scim_ bearer token, verifies SHA-256 hash and masks prefix', () => {
    const generated = generateScimBearerToken();
    expect(generated.plainToken.startsWith('scim_')).toBe(true);
    expect(generated.tokenHash).toHaveLength(64);
    expect(generated.tokenPrefix).toContain('...');
    expect(verifyScimTokenHash(generated.plainToken, generated.tokenHash)).toBe(true);
    expect(verifyScimTokenHash(`${generated.plainToken}_tampered`, generated.tokenHash)).toBe(
      false,
    );
  });

  it('evaluates IP allowlist with exact IP, IPv6-mapped IPv4, wildcard and CIDR', () => {
    expect(normalizeCallerIp('::ffff:10.20.1.15')).toBe('10.20.1.15');
    expect(isScimClientIpAllowed('203.0.113.5', [])).toBe(true);
    expect(isScimClientIpAllowed('::ffff:10.20.1.15', ['10.20.1.0/24'])).toBe(true);
    expect(isScimClientIpAllowed('10.20.2.15', ['10.20.1.0/24'])).toBe(false);
    expect(isScimClientIpAllowed('192.168.5.42', ['192.168.5.*'])).toBe(true);
    expect(isScimClientIpAllowed(null, ['10.0.0.1'])).toBe(false);
  });

  it('computes key-order independent fingerprint and parses weak/strong If-Match ETags', () => {
    const fp1 = computeScimPayloadFingerprint({ b: 2, a: { y: 'hi', x: 1 } });
    const fp2 = computeScimPayloadFingerprint({ a: { x: 1, y: 'hi' }, b: 2 });
    expect(fp1).toBe(fp2);

    expect(formatScimEtag(4)).toBe('W/"4"');
    expect(parseScimIfMatchVersion('W/"4"')).toBe(4);
    expect(parseScimIfMatchVersion('"7"')).toBe(7);
    expect(parseScimIfMatchVersion('*')).toBe('*');
    expect(parseScimIfMatchVersion('bad-etag')).toBe('INVALID');
    expect(parseScimIfMatchVersion(undefined)).toBeNull();
  });

  it('redacts sensitive secrets from SCIM request/response log summaries', () => {
    const redacted = redactScimPayload({
      userName: 'alice@example.com',
      password: 'plain-password',
      authorization: 'Bearer scim_12345',
      token: 'secret-tok',
    });
    expect(redacted?.['userName']).toBe('a***@example.com');
    expect(redacted?.['password']).toBe('[REDACTED]');
    expect(redacted?.['authorization']).toBe('[REDACTED]');
    expect(redacted?.['token']).toBe('[REDACTED]');
  });

  it('parses and matches SCIM User and Group filter queries safely', () => {
    const sampleUser: ScimUserResource = {
      schemas: [SCIM_SCHEMAS.USER],
      id: '10',
      externalId: 'okta-u-10',
      userName: 'alice@acme.test',
      displayName: 'Alice Tran',
      active: true,
      emails: [{ value: 'alice@acme.test', type: 'work', primary: true }],
      meta: { resourceType: 'User', version: 'W/"1"' },
    };

    const clauses = parseScimFilter(
      'userName eq "alice@acme.test" and active eq true and emails[type eq "work"].value sw "alice"',
    );
    expect(matchesScimUserFilter(sampleUser, clauses)).toBe(true);
    expect(
      matchesScimUserFilter(sampleUser, parseScimFilter('externalId eq "other-id"')),
    ).toBe(false);

    const sampleGroup: ScimGroupResource = {
      schemas: [SCIM_SCHEMAS.GROUP],
      id: '3',
      externalId: 'okta-g-3',
      displayName: 'Platform Engineers',
      members: [],
      meta: { resourceType: 'Group', version: 'W/"2"' },
    };
    expect(
      matchesScimGroupFilter(sampleGroup, parseScimFilter('displayName co "Engineers"')),
    ).toBe(true);

    expect(() => parseScimFilter('invalid filter syntax !!')).toThrow(ScimProtocolException);
  });

  it('applies SCIM User and Group PATCH operations including Okta/Entra member selector syntax', () => {
    const patchedUser = applyScimUserPatchOperations(
      {
        externalId: 'ext-1',
        userName: 'bob@acme.test',
        email: 'bob@acme.test',
        phone: null,
        firstName: 'Bob',
        lastName: 'Le',
        fullName: 'Bob Le',
        active: true,
      },
      [
        { op: 'replace', path: 'active', value: false },
        { op: 'replace', path: 'displayName', value: 'Bobby Le' },
      ],
    );
    expect(patchedUser.active).toBe(false);
    expect(patchedUser.fullName).toBe('Bobby Le');

    const patchedGroup = applyScimGroupPatchOperations(
      {
        externalId: 'grp-1',
        displayName: 'Staff',
        memberUserIds: [1, 2],
      },
      [
        { op: 'add', path: 'members', value: [{ value: '3' }] },
        { op: 'remove', path: 'members[value eq "1"]' },
      ],
    );
    expect(patchedGroup.memberUserIds).toEqual([2, 3]);
  });
});
