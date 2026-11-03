import { fetchApi, fetchApiWithMeta } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/api.routes';
import type {
  CustomFieldDefinitionItem,
  CustomFieldFilterCondition,
  CustomFieldHistoryItem,
  ExtensibleEntityItem,
  FilterRecordsByCustomFieldsResult,
  RecordCustomFieldsPayload,
} from '../types/custom-fields.types';

export const customFieldsApi = {
  listExtensibleEntities: (qs = ''): Promise<ExtensibleEntityItem[]> =>
    fetchApi<ExtensibleEntityItem[]>(API_ROUTES.CUSTOM_FIELDS.ENTITIES(qs)),

  listDefinitions: (qs = '') =>
    fetchApiWithMeta<CustomFieldDefinitionItem[]>(API_ROUTES.CUSTOM_FIELDS.DEFINITIONS(qs)),

  getDefinitionById: (id: number | string): Promise<CustomFieldDefinitionItem> =>
    fetchApi<CustomFieldDefinitionItem>(API_ROUTES.CUSTOM_FIELDS.DEFINITION_BY_ID(id)),

  createDefinition: (payload: Record<string, unknown>): Promise<CustomFieldDefinitionItem> =>
    fetchApi<CustomFieldDefinitionItem>(API_ROUTES.CUSTOM_FIELDS.DEFINITIONS(), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateDefinition: (
    id: number | string,
    payload: Record<string, unknown>,
  ): Promise<CustomFieldDefinitionItem> =>
    fetchApi<CustomFieldDefinitionItem>(API_ROUTES.CUSTOM_FIELDS.DEFINITION_BY_ID(id), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  upsertOptions: (
    id: number | string,
    payload: {
      options: Array<{
        optionCode: string;
        label: string;
        labels?: Record<string, string>;
        color?: string | null;
        sortOrder?: number;
        status?: number;
        isDefault?: boolean;
      }>;
      reason?: string | null;
    },
  ): Promise<CustomFieldDefinitionItem> =>
    fetchApi<CustomFieldDefinitionItem>(API_ROUTES.CUSTOM_FIELDS.DEFINITION_OPTIONS(id), {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  listAllHistories: (qs = '') =>
    fetchApiWithMeta<CustomFieldHistoryItem[]>(API_ROUTES.CUSTOM_FIELDS.HISTORIES(qs)),

  listDefinitionHistories: (id: number | string, qs = '') =>
    fetchApiWithMeta<CustomFieldHistoryItem[]>(
      API_ROUTES.CUSTOM_FIELDS.DEFINITION_HISTORIES(id, qs),
    ),

  getRecordValues: (
    entityCode: string,
    recordId: string | number,
    qs = '',
  ): Promise<RecordCustomFieldsPayload> =>
    fetchApi<RecordCustomFieldsPayload>(
      API_ROUTES.CUSTOM_FIELDS.VALUES_BY_RECORD(entityCode, recordId, qs),
    ),

  setRecordValues: (
    entityCode: string,
    recordId: string | number,
    values: Record<string, unknown>,
    mode: 'create' | 'update' = 'update',
  ): Promise<RecordCustomFieldsPayload> =>
    fetchApi<RecordCustomFieldsPayload>(
      API_ROUTES.CUSTOM_FIELDS.VALUES_BY_RECORD(entityCode, recordId),
      {
        method: 'PUT',
        body: JSON.stringify({ values, mode }),
      },
    ),

  filterRecords: (payload: {
    entityCode: string;
    filters: CustomFieldFilterCondition[];
  }): Promise<FilterRecordsByCustomFieldsResult> =>
    fetchApi<FilterRecordsByCustomFieldsResult>(API_ROUTES.CUSTOM_FIELDS.FILTER, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
