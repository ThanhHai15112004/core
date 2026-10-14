import {
  BREAKING_CHANGE_RULES,
  type BreakingChangeIssue,
  type BreakingChangeReport,
  type OpenApiDocument,
  type OpenApiOperationObject,
  type OpenApiSchemaObject,
} from '../contracts/api-docs.contract.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/**
 * Chuẩn hóa kiểu dữ liệu của `OpenApiSchemaObject` về chuỗi thống nhất để so sánh.
 */
function normalizeSchemaType(schema: OpenApiSchemaObject | undefined): string {
  if (!schema) return 'unknown';
  if (Array.isArray(schema.type)) {
    return [...schema.type].sort().join('|');
  }
  if (typeof schema.type === 'string') {
    return schema.type === 'integer' ? 'number' : schema.type;
  }
  if (schema.properties) return 'object';
  if (schema.items) return 'array';
  return 'any';
}

/**
 * Kiểm tra xem hai kiểu dữ liệu OpenAPI có tương thích hay bị thay đổi không tương thích.
 */
function isTypeIncompatible(baseType: string, currentType: string): boolean {
  if (baseType === 'any' || currentType === 'any') return false;
  return baseType !== currentType;
}

/**
 * So sánh 2 tài liệu `OpenApiDocument` (bản baseline chuẩn và bản hiện tại)
 * để phát hiện các thay đổi phá vỡ hợp đồng API (Breaking Changes) trong CI/CD.
 */
export function detectOpenApiBreakingChanges(
  baseline: OpenApiDocument,
  current: OpenApiDocument,
): BreakingChangeReport {
  const issues: BreakingChangeIssue[] = [];
  let totalOperationsCompared = 0;

  for (const [pathKey, basePathItem] of Object.entries(baseline.paths)) {
    const currPathItem = current.paths[pathKey];

    if (!currPathItem) {
      for (const method of HTTP_METHODS) {
        if (basePathItem[method]) {
          totalOperationsCompared++;
          issues.push({
            rule: BREAKING_CHANGE_RULES.ENDPOINT_REMOVED,
            severity: 'BREAKING',
            path: pathKey,
            method: method.toUpperCase(),
            message: `Endpoint [${method.toUpperCase()} ${pathKey}] existed in baseline but was completely removed.`,
          });
        }
      }
      continue;
    }

    for (const method of HTTP_METHODS) {
      const baseOp = basePathItem[method];
      if (!baseOp) continue;

      totalOperationsCompared++;
      const currOp = currPathItem[method];

      // 1. Kiểm tra xóa HTTP method trên cùng một path
      if (!currOp) {
        issues.push({
          rule: BREAKING_CHANGE_RULES.ENDPOINT_REMOVED,
          severity: 'BREAKING',
          path: pathKey,
          method: method.toUpperCase(),
          message: `HTTP operation [${method.toUpperCase()} ${pathKey}] was removed.`,
        });
        continue;
      }

      // 2. Kiểm tra siết chặt bảo mật (Security / Permissions / Roles)
      compareSecurityConstraints(pathKey, method.toUpperCase(), baseOp, currOp, issues);

      // 3. Kiểm tra Query & Path Parameters
      compareParameters(pathKey, method.toUpperCase(), baseOp, currOp, issues);

      // 4. Kiểm tra Request Body Schema
      compareRequestBody(pathKey, method.toUpperCase(), baseOp, currOp, issues);

      // 5. Kiểm tra Response 2xx Schema
      compareSuccessResponses(pathKey, method.toUpperCase(), baseOp, currOp, issues);
    }
  }

  return {
    passed: issues.length === 0,
    totalOperationsCompared,
    breakingChanges: issues,
  };
}

/** Kiểm tra việc chuyển API từ Public sang yêu cầu xác thực hoặc bổ sung thêm quyền bắt buộc */
function compareSecurityConstraints(
  pathKey: string,
  method: string,
  baseOp: OpenApiOperationObject,
  currOp: OpenApiOperationObject,
  issues: BreakingChangeIssue[],
): void {
  const wasPublic = baseOp['x-public'] === true || baseOp.security.length === 0;
  const isNowPublic = currOp['x-public'] === true || currOp.security.length === 0;

  if (wasPublic && !isNowPublic) {
    issues.push({
      rule: BREAKING_CHANGE_RULES.SECURITY_TIGHTENED,
      severity: 'BREAKING',
      path: pathKey,
      method,
      message: `Endpoint [${method} ${pathKey}] changed from Public to Authenticated (Bearer JWT required).`,
    });
  }

  const basePerms = new Set(baseOp['x-required-permissions'] ?? []);
  const currPerms = currOp['x-required-permissions'] ?? [];
  const addedPerms = currPerms.filter((p) => !basePerms.has(p));

  if (addedPerms.length > 0) {
    issues.push({
      rule: BREAKING_CHANGE_RULES.SECURITY_TIGHTENED,
      severity: 'BREAKING',
      path: pathKey,
      method,
      field: 'x-required-permissions',
      message: `Endpoint [${method} ${pathKey}] added new required permission(s): ${addedPerms.join(', ')}.`,
    });
  }

  const baseRoles = new Set(baseOp['x-required-roles'] ?? []);
  const currRoles = currOp['x-required-roles'] ?? [];
  const addedRoles = currRoles.filter((r) => !baseRoles.has(r));

  if (addedRoles.length > 0 && baseRoles.size === 0) {
    issues.push({
      rule: BREAKING_CHANGE_RULES.SECURITY_TIGHTENED,
      severity: 'BREAKING',
      path: pathKey,
      method,
      field: 'x-required-roles',
      message: `Endpoint [${method} ${pathKey}] added role restriction(s): ${addedRoles.join(', ')}.`,
    });
  }
}

/** Kiểm tra thêm tham số bắt buộc hoặc đổi kiểu dữ liệu / thu hẹp enum của tham số */
function compareParameters(
  pathKey: string,
  method: string,
  baseOp: OpenApiOperationObject,
  currOp: OpenApiOperationObject,
  issues: BreakingChangeIssue[],
): void {
  const baseParams = new Map((baseOp.parameters ?? []).map((p) => [`${p.in}:${p.name}`, p]));
  const currParams = new Map((currOp.parameters ?? []).map((p) => [`${p.in}:${p.name}`, p]));

  // Kiểm tra thêm tham số bắt buộc mới hoặc chuyển từ optional sang required
  for (const [key, currParam] of currParams.entries()) {
    const baseParam = baseParams.get(key);
    if (!baseParam && currParam.required) {
      issues.push({
        rule: BREAKING_CHANGE_RULES.REQUIRED_PARAM_ADDED,
        severity: 'BREAKING',
        path: pathKey,
        method,
        field: currParam.name,
        message: `New required ${currParam.in} parameter "${currParam.name}" was added to [${method} ${pathKey}].`,
      });
      continue;
    }

    if (baseParam && !baseParam.required && currParam.required) {
      issues.push({
        rule: BREAKING_CHANGE_RULES.REQUIRED_PARAM_ADDED,
        severity: 'BREAKING',
        path: pathKey,
        method,
        field: currParam.name,
        message: `Optional ${currParam.in} parameter "${currParam.name}" became required in [${method} ${pathKey}].`,
      });
    }

    if (baseParam) {
      const baseType = normalizeSchemaType(baseParam.schema);
      const currType = normalizeSchemaType(currParam.schema);
      if (isTypeIncompatible(baseType, currType)) {
        issues.push({
          rule: BREAKING_CHANGE_RULES.PARAM_TYPE_OR_ENUM_NARROWED,
          severity: 'BREAKING',
          path: pathKey,
          method,
          field: currParam.name,
          message: `Parameter "${currParam.name}" type changed from "${baseType}" to "${currType}" in [${method} ${pathKey}].`,
        });
      }

      if (Array.isArray(baseParam.schema.enum) && Array.isArray(currParam.schema.enum)) {
        const currEnumSet = new Set(currParam.schema.enum.map(String));
        const removedEnumVals = baseParam.schema.enum
          .map(String)
          .filter((v) => !currEnumSet.has(v));
        if (removedEnumVals.length > 0) {
          issues.push({
            rule: BREAKING_CHANGE_RULES.PARAM_TYPE_OR_ENUM_NARROWED,
            severity: 'BREAKING',
            path: pathKey,
            method,
            field: currParam.name,
            message: `Enum parameter "${currParam.name}" removed allowed value(s): ${removedEnumVals.join(', ')}.`,
          });
        }
      }
    }
  }
}

/** Kiểm tra thay đổi phá vỡ hợp đồng trên Request Body */
function compareRequestBody(
  pathKey: string,
  method: string,
  baseOp: OpenApiOperationObject,
  currOp: OpenApiOperationObject,
  issues: BreakingChangeIssue[],
): void {
  const baseBodySchema = baseOp.requestBody?.content['application/json']?.schema;
  const currBodySchema = currOp.requestBody?.content['application/json']?.schema;

  if (!baseBodySchema && currBodySchema && currOp.requestBody?.required) {
    issues.push({
      rule: BREAKING_CHANGE_RULES.REQUIRED_BODY_FIELD_ADDED,
      severity: 'BREAKING',
      path: pathKey,
      method,
      message: `Endpoint [${method} ${pathKey}] now requires a request body where none was required before.`,
    });
    return;
  }

  if (!baseBodySchema || !currBodySchema) {
    return;
  }

  const baseProps = baseBodySchema.properties ?? {};
  const currProps = currBodySchema.properties ?? {};
  const baseRequired = new Set(baseBodySchema.required ?? []);
  const currRequired = new Set(currBodySchema.required ?? []);

  // Trường mới hoặc trường cũ chuyển thành bắt buộc trong Request Body
  for (const reqField of currRequired) {
    if (!baseRequired.has(reqField)) {
      issues.push({
        rule: BREAKING_CHANGE_RULES.REQUIRED_BODY_FIELD_ADDED,
        severity: 'BREAKING',
        path: pathKey,
        method,
        field: reqField,
        message: `Request body field "${reqField}" became required in [${method} ${pathKey}].`,
      });
    }
  }

  // Trường đang có trong Request Body bị xóa hoặc bị đổi kiểu dữ liệu
  for (const [fieldName, basePropSchema] of Object.entries(baseProps)) {
    const currPropSchema = currProps[fieldName];
    if (!currPropSchema) {
      issues.push({
        rule: BREAKING_CHANGE_RULES.BODY_FIELD_REMOVED_OR_TYPE_CHANGED,
        severity: 'BREAKING',
        path: pathKey,
        method,
        field: fieldName,
        message: `Request body field "${fieldName}" was removed from [${method} ${pathKey}].`,
      });
      continue;
    }

    const baseType = normalizeSchemaType(basePropSchema);
    const currType = normalizeSchemaType(currPropSchema);
    if (isTypeIncompatible(baseType, currType)) {
      issues.push({
        rule: BREAKING_CHANGE_RULES.BODY_FIELD_REMOVED_OR_TYPE_CHANGED,
        severity: 'BREAKING',
        path: pathKey,
        method,
        field: fieldName,
        message: `Request body field "${fieldName}" changed type from "${baseType}" to "${currType}" in [${method} ${pathKey}].`,
      });
    }
  }
}

/** Kiểm tra xóa trường hoặc đổi kiểu dữ liệu trong phần `data` của Response 2xx */
function compareSuccessResponses(
  pathKey: string,
  method: string,
  baseOp: OpenApiOperationObject,
  currOp: OpenApiOperationObject,
  issues: BreakingChangeIssue[],
): void {
  const baseSuccessStatus = Object.keys(baseOp.responses).find((code) => code.startsWith('2'));
  if (!baseSuccessStatus) return;

  const baseResp = baseOp.responses[baseSuccessStatus];
  const currResp =
    currOp.responses[baseSuccessStatus] ??
    currOp.responses[Object.keys(currOp.responses).find((c) => c.startsWith('2')) ?? ''];

  if (!currResp) {
    issues.push({
      rule: BREAKING_CHANGE_RULES.RESPONSE_FIELD_REMOVED_OR_TYPE_CHANGED,
      severity: 'BREAKING',
      path: pathKey,
      method,
      message: `Success response (${baseSuccessStatus}) was removed from [${method} ${pathKey}].`,
    });
    return;
  }

  const baseEnvelope = baseResp?.content?.['application/json']?.schema;
  const currEnvelope = currResp.content?.['application/json']?.schema;
  const baseDataSchema = baseEnvelope?.properties?.['data'];
  const currDataSchema = currEnvelope?.properties?.['data'];

  if (!baseDataSchema || !currDataSchema) return;

  compareResponseSchemaRecursive(pathKey, method, 'data', baseDataSchema, currDataSchema, issues);
}

/** So sánh đệ quy cấu trúc `data` trong Response để phát hiện trường bị xóa hoặc đổi kiểu */
function compareResponseSchemaRecursive(
  pathKey: string,
  method: string,
  fieldPath: string,
  baseSchema: OpenApiSchemaObject,
  currSchema: OpenApiSchemaObject,
  issues: BreakingChangeIssue[],
): void {
  const baseType = normalizeSchemaType(baseSchema);
  const currType = normalizeSchemaType(currSchema);

  if (isTypeIncompatible(baseType, currType)) {
    issues.push({
      rule: BREAKING_CHANGE_RULES.RESPONSE_FIELD_REMOVED_OR_TYPE_CHANGED,
      severity: 'BREAKING',
      path: pathKey,
      method,
      field: fieldPath,
      message: `Response field "${fieldPath}" changed type from "${baseType}" to "${currType}" in [${method} ${pathKey}].`,
    });
    return;
  }

  if (baseType === 'array' && baseSchema.items && currSchema.items) {
    compareResponseSchemaRecursive(
      pathKey,
      method,
      `${fieldPath}[]`,
      baseSchema.items,
      currSchema.items,
      issues,
    );
    return;
  }

  const baseProps = baseSchema.properties ?? {};
  const currProps = currSchema.properties ?? {};

  for (const [propName, basePropSchema] of Object.entries(baseProps)) {
    const nextPath = `${fieldPath}.${propName}`;
    const currPropSchema = currProps[propName];
    if (!currPropSchema) {
      issues.push({
        rule: BREAKING_CHANGE_RULES.RESPONSE_FIELD_REMOVED_OR_TYPE_CHANGED,
        severity: 'BREAKING',
        path: pathKey,
        method,
        field: nextPath,
        message: `Response field "${nextPath}" was removed from [${method} ${pathKey}].`,
      });
      continue;
    }

    compareResponseSchemaRecursive(
      pathKey,
      method,
      nextPath,
      basePropSchema,
      currPropSchema,
      issues,
    );
  }
}
