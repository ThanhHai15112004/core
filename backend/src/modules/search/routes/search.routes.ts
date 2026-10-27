export const SEARCH_ROUTES = {
  PREFIX: 'search',
  ROOT: '',
  ENTITIES: 'entities',
  DOCUMENTS: 'documents',
  DOCUMENT_BY_ENTITY_AND_ID: 'documents/:entityCode/:entityId',
  SYNC: 'sync',
  REBUILD: 'rebuild',
  LAG: 'lag',
  ZERO_RESULTS: 'zero-results',
  ZERO_RESULT_BY_KEYWORD: 'zero-results/:keyword',
  HISTORIES: 'histories',
  HISTORY_BY_ID: 'histories/:historyId',
} as const;
