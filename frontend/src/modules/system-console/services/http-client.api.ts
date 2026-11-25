import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  HttpClientAllCircuitsResetResultDto,
  HttpClientCircuitResetResultDto,
  HttpClientOpsOverviewDto,
  ResilienceLayersSummaryDto,
} from '../types/http-client.types';

export function fetchHttpClientOverview(): Promise<HttpClientOpsOverviewDto> {
  return fetchApi<HttpClientOpsOverviewDto>(API_ROUTES.OPS.HTTP_CLIENT.path('overview'));
}

export function fetchResilienceSummary(): Promise<ResilienceLayersSummaryDto> {
  return fetchApi<ResilienceLayersSummaryDto>(API_ROUTES.OPS.HTTP_CLIENT.path('resilience'));
}

export function resetHttpClientCircuit(service: string): Promise<HttpClientCircuitResetResultDto> {
  return fetchApi<HttpClientCircuitResetResultDto>(
    API_ROUTES.OPS.HTTP_CLIENT.path(`circuits/${encodeURIComponent(service)}/reset`),
    { method: 'POST' },
  );
}

export function resetAllHttpClientCircuits(): Promise<HttpClientAllCircuitsResetResultDto> {
  return fetchApi<HttpClientAllCircuitsResetResultDto>(
    API_ROUTES.OPS.HTTP_CLIENT.path('circuits/reset-all'),
    { method: 'POST' },
  );
}
