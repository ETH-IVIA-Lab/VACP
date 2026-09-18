import { Eye, EyeOff, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import type { ReactElement } from 'react';

import type { VacpLLMConfig, VacpLLMModelOption } from '@vacp/agent-ai-sdk';
import { vacpLLMConfigStorageKey } from '@vacp/agent-ai-sdk';
import { Button } from '@vacp/inspector/ui/components/ui/button';
import { Input } from '@vacp/inspector/ui/components/ui/input';
import { cn } from '@vacp/inspector/ui/lib/utils';

export type ChatConfigPanelProps = {
  config: VacpLLMConfig;
  onConfigChange: (next: VacpLLMConfig) => void;
  onProviderChange: (provider: VacpLLMConfig['provider']) => void;
  showApiKey: boolean;
  onToggleApiKey: () => void;
  onClearConfig: () => void;
  onClose: () => void;
  availableModels: VacpLLMModelOption[];
  loadingModels: boolean;
  modelsError: string | null;
  onRefreshModels: () => void;
  compact?: boolean;
  showHeading?: boolean;
  showClose?: boolean;
  className?: string;
};

export function ChatConfigPanel(props: ChatConfigPanelProps): ReactElement {
  const setField = <K extends keyof VacpLLMConfig>(key: K, value: VacpLLMConfig[K]) => {
    props.onConfigChange({ ...props.config, [key]: value });
  };

  const provider = props.config.provider;
  const openAICompatibleSelected = provider === 'openai-compatible';
  const currentModelInList = props.availableModels.some((item) => item.id === props.config.model);
  const compact = props.compact ?? false;
  const showHeading = props.showHeading ?? true;

  return (
    <section
      data-vacp-chat-settings-panel="1"
      className={cn(
        'vacp-chat-scroll grid min-h-0 content-start overflow-y-auto overflow-x-hidden p-4',
        compact ? 'gap-3' : 'gap-4',
        props.className,
      )}
    >
      {showHeading ? (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase text-slate-100/75">Settings</div>
            <div className="mt-1 text-pretty text-[11px] text-slate-100/70">
              Configure your chat provider and model for this browser session.
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="iconSm"
              aria-label="Clear saved config"
              title="Clear saved config"
              onClick={props.onClearConfig}
            >
              <Trash2 className="h-4 w-4 text-slate-100/90" />
            </Button>
            {(props.showClose ?? true) ? (
              <Button size="iconSm" aria-label="Close settings" title="Close settings" onClick={props.onClose}>
                <X className="h-4 w-4 text-slate-100/90" />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={cn('grid', compact ? 'gap-3' : 'gap-4')}>
        <section className={cn('grid gap-3', showHeading && 'border-t border-white/[0.075] pt-4')}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-slate-100/85">Connection</div>
              <div className="mt-1 text-pretty text-[11px] text-slate-100/60">
                Choose the provider endpoint and model exposed to the inspector chat runtime.
              </div>
            </div>
            {!showHeading ? (
              <Button
                size="iconSm"
                aria-label="Clear saved config"
                title="Clear saved config"
                onClick={props.onClearConfig}
              >
                <Trash2 className="h-4 w-4 text-slate-100/90" />
              </Button>
            ) : null}
          </div>
          <div className={cn('grid grid-cols-1 gap-3', !compact && 'sm:grid-cols-2')}>
            <label className="text-[11px] text-slate-100/80">
              Provider
              <select
                data-vacp-chat-provider="1"
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-[#101821]/72 px-2 py-2 text-xs text-slate-100/90 outline-none focus:border-white/22 focus:ring-2 focus:ring-white/22"
                value={provider}
                onChange={(e) => props.onProviderChange(e.target.value as VacpLLMConfig['provider'])}
              >
                <option value="openai-compatible">OpenAI-compatible</option>
                <option value="gemini">Gemini</option>
              </select>
            </label>
            <label className="text-[11px] text-slate-100/80">
              Model
              <div className="mt-1 flex items-center gap-2">
                <select
                  data-vacp-chat-model-select="1"
                  className="w-full rounded-lg border border-white/[0.08] bg-[#101821]/72 px-2 py-2 text-xs text-slate-100/90 outline-none focus:border-white/22 focus:ring-2 focus:ring-white/22"
                  value={props.config.model}
                  disabled={props.loadingModels || props.availableModels.length === 0}
                  onChange={(e) => setField('model', e.target.value)}
                >
                  {props.availableModels.length === 0 ? (
                    <option value={props.config.model}>
                      {props.loadingModels ? 'Loading models...' : 'No models loaded'}
                    </option>
                  ) : null}
                  {props.availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                  {!currentModelInList && props.config.model.trim() ? (
                    <option value={props.config.model}>Current: {props.config.model}</option>
                  ) : null}
                </select>
                <Button
                  size="iconSm"
                  data-vacp-chat-refresh-models="1"
                  aria-label="Refresh model list"
                  title="Refresh model list"
                  onClick={props.onRefreshModels}
                >
                  {props.loadingModels ? (
                    <Loader2 className="h-4 w-4 animate-spin text-slate-100/90" />
                  ) : (
                    <RefreshCw className="h-4 w-4 text-slate-100/90" />
                  )}
                </Button>
              </div>
              <div className="mt-1 text-[10px] text-slate-100/60">
                {props.modelsError
                  ? props.modelsError
                  : props.availableModels.length > 0
                    ? `${props.availableModels.length} models available`
                    : 'Enter provider details and refresh models.'}
              </div>
            </label>
            {openAICompatibleSelected ? (
              <label className={cn('text-[11px] text-slate-100/80', !compact && 'sm:col-span-2')}>
                Base URL
                <Input
                  data-vacp-chat-baseurl="1"
                  className="mt-1"
                  value={props.config.baseURL}
                  onChange={(e) => setField('baseURL', e.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
            ) : null}
          </div>
        </section>

        <section className="grid gap-3 border-t border-white/[0.075] pt-4">
          <div>
            <div className="text-[11px] font-semibold text-slate-100/85">Credentials</div>
            <div className="mt-1 text-pretty text-[11px] text-slate-100/60">
              The key is stored locally for this browser profile and only sent to the configured provider endpoint.
            </div>
          </div>
          <label className="text-[11px] text-slate-100/80">
            {openAICompatibleSelected ? 'API key' : 'Gemini API key'}
            <div className="mt-1 flex items-center gap-2">
              <Input
                data-vacp-chat-apikey="1"
                type={props.showApiKey ? 'text' : 'password'}
                value={props.config.apiKey}
                onChange={(e) => setField('apiKey', e.target.value)}
                placeholder={openAICompatibleSelected ? 'sk-...' : 'AIza...'}
              />
              <Button
                size="iconSm"
                aria-label={props.showApiKey ? 'Hide API key' : 'Show API key'}
                title={props.showApiKey ? 'Hide API key' : 'Show API key'}
                onClick={props.onToggleApiKey}
              >
                {props.showApiKey ? (
                  <EyeOff className="h-4 w-4 text-slate-100/90" />
                ) : (
                  <Eye className="h-4 w-4 text-slate-100/90" />
                )}
              </Button>
            </div>
          </label>
        </section>

        <details className="border-t border-white/[0.075] pt-4">
          <summary className="cursor-pointer select-none text-[11px] font-semibold text-slate-100/80">Advanced</summary>
          <div className={cn('mt-2 grid grid-cols-1 gap-3', !compact && 'sm:grid-cols-3')}>
            {!openAICompatibleSelected ? (
              <label className={cn('text-[11px] text-slate-100/80', !compact && 'sm:col-span-3')}>
                Base URL (optional)
                <Input
                  data-vacp-chat-baseurl="1"
                  className="mt-1"
                  value={props.config.baseURL}
                  onChange={(e) => setField('baseURL', e.target.value)}
                  placeholder="https://generativelanguage.googleapis.com/v1beta"
                />
              </label>
            ) : null}
            <label className={cn('text-[11px] text-slate-100/80', !compact && 'sm:col-span-3')}>
              Manual model id
              <Input
                data-vacp-chat-model="1"
                className="mt-1"
                value={props.config.model}
                onChange={(e) => setField('model', e.target.value)}
                placeholder={openAICompatibleSelected ? 'gpt-5.2' : 'gemini-2.5-flash'}
              />
            </label>
            {openAICompatibleSelected ? (
              <label className={cn('text-[11px] text-slate-100/80', !compact && 'sm:col-span-3')}>
                Provider name
                <Input
                  data-vacp-chat-provider-name="1"
                  className="mt-1"
                  value={props.config.providerName}
                  onChange={(e) => setField('providerName', e.target.value)}
                  placeholder="openai-compatible"
                />
              </label>
            ) : null}
            <label className="text-[11px] text-slate-100/80">
              Max steps
              <Input
                data-vacp-chat-maxsteps="1"
                className="mt-1 tabular-nums"
                type="number"
                min={1}
                max={64}
                value={props.config.maxSteps ?? 6}
                onChange={(e) => setField('maxSteps', Math.max(1, Number(e.target.value || 6)))}
              />
            </label>
            <label className="text-[11px] text-slate-100/80">
              Max output tokens
              <Input
                data-vacp-chat-max-output-tokens="1"
                className="mt-1 tabular-nums"
                type="number"
                min={64}
                max={8192}
                value={props.config.maxOutputTokens ?? 900}
                onChange={(e) => setField('maxOutputTokens', Math.max(64, Number(e.target.value || 900)))}
              />
            </label>
            <label className="text-[11px] text-slate-100/80">
              Temperature
              <Input
                data-vacp-chat-temperature="1"
                className="mt-1 tabular-nums"
                type="number"
                step={0.1}
                min={0}
                max={2}
                value={props.config.temperature ?? 0.2}
                onChange={(e) => setField('temperature', Math.max(0, Number(e.target.value || 0)))}
              />
            </label>
          </div>
        </details>

        <div className="border-t border-white/[0.075] pt-3 text-[11px] text-slate-100/60">
          Your API key never leaves your browser except when directly sent to your selected provider endpoint. It is
          stored locally at {vacpLLMConfigStorageKey}.
        </div>
      </div>
    </section>
  );
}
