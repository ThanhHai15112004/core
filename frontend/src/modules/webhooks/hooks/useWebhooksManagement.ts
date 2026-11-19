import { useCallback, useEffect, useState } from 'react';
import { webhooksApi } from '../services/webhooks.api';
import type {
  WebhookDeliveryItem,
  WebhookEndpointItem,
  WebhookEventCatalogItem,
} from '../types/webhooks.types';

export function useWebhooksManagement() {
  const [eventsCatalog, setEventsCatalog] = useState<WebhookEventCatalogItem[]>([]);
  const [endpoints, setEndpoints] = useState<WebhookEndpointItem[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryItem[]>([]);
  const [selectedDelivery, setSelectedDelivery] = useState<WebhookDeliveryItem | null>(null);

  const [deliveryEndpointFilter, setDeliveryEndpointFilter] = useState<string>('');
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<string>('');
  const [deliveryEventFilter, setDeliveryEventFilter] = useState<string>('');

  const [revealedSecret, setRevealedSecret] = useState<{
    endpointName: string;
    signingSecret: string;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadCatalogAndEndpoints = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalogRes, endpointsRes] = await Promise.all([
        webhooksApi.listEvents(),
        webhooksApi.listEndpoints('limit=100'),
      ]);
      setEventsCatalog(Array.isArray(catalogRes) ? catalogRes : []);
      setEndpoints(Array.isArray(endpointsRes.data) ? endpointsRes.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách Webhook Endpoints');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDeliveries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (deliveryEndpointFilter) params.set('endpointId', deliveryEndpointFilter);
      if (deliveryStatusFilter) params.set('status', deliveryStatusFilter);
      if (deliveryEventFilter.trim()) params.set('eventName', deliveryEventFilter.trim());
      const res = await webhooksApi.listDeliveries(params.toString());
      setDeliveries(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải lịch sử gửi Webhook');
    } finally {
      setLoading(false);
    }
  }, [deliveryEndpointFilter, deliveryEventFilter, deliveryStatusFilter]);

  const loadDeliveryDetail = useCallback(async (deliveryId: number) => {
    setDetailLoading(true);
    setError(null);
    try {
      const detail = await webhooksApi.getDeliveryById(deliveryId);
      setSelectedDelivery(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải chi tiết lần gửi Webhook');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalogAndEndpoints();
  }, [loadCatalogAndEndpoints]);

  useEffect(() => {
    void loadDeliveries();
  }, [loadDeliveries]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadCatalogAndEndpoints(), loadDeliveries()]);
    if (selectedDelivery) {
      await loadDeliveryDetail(selectedDelivery.id);
    }
  }, [loadCatalogAndEndpoints, loadDeliveries, loadDeliveryDetail, selectedDelivery]);

  return {
    eventsCatalog,
    endpoints,
    deliveries,
    selectedDelivery,
    setSelectedDelivery,
    deliveryEndpointFilter,
    setDeliveryEndpointFilter,
    deliveryStatusFilter,
    setDeliveryStatusFilter,
    deliveryEventFilter,
    setDeliveryEventFilter,
    revealedSecret,
    setRevealedSecret,
    loading,
    detailLoading,
    error,
    setError,
    feedback,
    setFeedback,
    loadCatalogAndEndpoints,
    loadDeliveries,
    loadDeliveryDetail,
    refreshAll,
  };
}
