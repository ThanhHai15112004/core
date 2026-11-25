import type {
  IncidentDetailView,
  IncidentPostmortemView,
  IncidentView,
  IncidentsOverviewView,
  IngestIncidentAlertInput,
} from '../types/incidents-ops.types.js';

export const INCIDENTS_OPS_PUBLIC_SERVICE = Symbol('INCIDENTS_OPS_PUBLIC_SERVICE');

export interface IIncidentsOpsPublicService {
  getOverview(): Promise<IncidentsOverviewView>;
  ingestAlert(input: IngestIncidentAlertInput): Promise<{
    readonly incident: IncidentView;
    readonly deduplicated: boolean;
  }>;
  getIncidentDetail(id: number): Promise<IncidentDetailView>;
  getPostmortem(incidentId: number): Promise<IncidentPostmortemView>;
}
