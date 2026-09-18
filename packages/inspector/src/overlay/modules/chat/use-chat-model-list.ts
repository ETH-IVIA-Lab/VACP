import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listVacpLLMModels, type VacpLLMConfig, type VacpLLMModelOption } from '@vacp/agent-ai-sdk';
import { useCallback, useEffect, useMemo, useState } from 'react';

const MODEL_QUERY_KEY = 'vacp-chat-models';

function canListModels(config: VacpLLMConfig): boolean {
  if (!config.apiKey.trim()) return false;

  if (config.provider === 'gemini') return true;

  return Boolean(config.baseURL.trim() && config.providerName.trim());
}

export function useChatModelList({
  config,
  modelPanelVisible,
}: {
  config: VacpLLMConfig;
  modelPanelVisible: boolean;
}): {
  availableModels: VacpLLMModelOption[];
  loadingModels: boolean;
  modelsError: string | null;
  refreshModels: () => void;
  resetModels: () => void;
} {
  const queryClient = useQueryClient();
  const [modelRefreshSeq, setModelRefreshSeq] = useState(0);
  const [modelConfigRevision, setModelConfigRevision] = useState(0);

  const modelCacheKey = useMemo(
    () => [config.provider, config.providerName.trim(), config.baseURL.trim()].join('::'),
    [config.provider, config.providerName, config.baseURL],
  );

  const modelReadinessKey = useMemo(
    () =>
      [
        config.provider,
        config.providerName.trim(),
        config.baseURL.trim(),
        config.apiKey.trim() ? 'configured' : 'missing-key',
      ].join('::'),
    [config.provider, config.providerName, config.baseURL, config.apiKey],
  );

  const [debouncedModelReadinessKey, setDebouncedModelReadinessKey] = useState(modelReadinessKey);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedModelReadinessKey(modelReadinessKey), 320);

    return () => window.clearTimeout(timer);
  }, [modelReadinessKey]);

  const resetModels = useCallback(() => {
    void queryClient.cancelQueries({ queryKey: [MODEL_QUERY_KEY] });
    queryClient.removeQueries({ queryKey: [MODEL_QUERY_KEY] });
    setModelRefreshSeq(0);
    setModelConfigRevision((revision) => revision + 1);
  }, [queryClient]);

  const refreshModels = useCallback(() => setModelRefreshSeq((seq) => seq + 1), []);

  const canFetchModels =
    modelPanelVisible &&
    modelRefreshSeq > 0 &&
    debouncedModelReadinessKey === modelReadinessKey &&
    canListModels(config);

  const modelsQuery = useQuery<VacpLLMModelOption[], Error>({
    queryKey: [MODEL_QUERY_KEY, modelConfigRevision, modelRefreshSeq, modelCacheKey],
    queryFn: ({ signal }) => listVacpLLMModels(config, { signal }),
    enabled: canFetchModels,
    retry: false,
  });

  return {
    availableModels: canFetchModels && !modelsQuery.isError ? (modelsQuery.data ?? []) : [],
    loadingModels: canFetchModels && modelsQuery.isFetching,
    modelsError: canFetchModels ? (modelsQuery.error?.message ?? null) : null,
    refreshModels,
    resetModels,
  };
}
