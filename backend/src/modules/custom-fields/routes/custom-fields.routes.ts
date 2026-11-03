export const CUSTOM_FIELDS_ROUTES = {
  ROOT: 'api/v1/custom-fields',
  ENTITIES: 'entities',
  DEFINITIONS: 'definitions',
  DEFINITION_BY_ID: 'definitions/:id',
  DEFINITION_OPTIONS: 'definitions/:id/options',
  DEFINITION_HISTORIES: 'definitions/:id/histories',
  HISTORIES: 'histories',
  VALUES_BY_RECORD: 'values/:entityCode/:recordId',
  VALUES_FILTER: 'values/filter',
} as const;
