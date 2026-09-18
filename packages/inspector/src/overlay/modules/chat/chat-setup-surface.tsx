import type { VacpChatMessage as UIMessage } from '@vacp/agent-ai-sdk';
import type { VacpAgentToolEvent, VacpLLMConfig } from '@vacp/agent-ai-sdk';
import { ClipboardCopy, RefreshCw, Send, Settings2, Square } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { INSPECTOR_PANEL_BREAKPOINTS } from '@vacp/inspector/overlay/inspector-breakpoints';
import { Button } from '@vacp/inspector/ui/components/ui/button';
import { Textarea } from '@vacp/inspector/ui/components/ui/textarea';
import { copyTextToClipboard } from '@vacp/inspector/ui/lib/clipboard';
import { cn } from '@vacp/inspector/ui/lib/utils';

import { ModuleSubheader } from '../module-layout';
import { exportConversationAsMarkdown } from './chat-export';
import { ChatMessages } from './chat-messages';
import { useChatAutoscroll } from './use-chat-autoscroll';

type ChatSetupSurfaceProps = {
  scopeLabel: string;
  panelWidth: number;
  config: VacpLLMConfig;
  messages: UIMessage[];
  toolEvents: VacpAgentToolEvent[];
  draft: string;
  onDraftChange: (value: string) => void;
  onOpenSettings: () => void;
};

function messageSignal(messages: UIMessage[]): string {
  const last = messages[messages.length - 1];

  return `${messages.length}:${last?.id ?? ''}:${last?.parts.length ?? 0}`;
}

export function ChatSetupSurface(props: ChatSetupSurfaceProps): ReactElement {
  const compactPanel = props.panelWidth < INSPECTOR_PANEL_BREAKPOINTS.chatCompactPanel;
  const autoScrollSignal = useMemo(() => messageSignal(props.messages), [props.messages]);
  const { scrollRef, contentRef, stickToBottom, jumpToLatest } = useChatAutoscroll(autoScrollSignal);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!copyNotice) return;
    const timer = window.setTimeout(() => setCopyNotice(null), 2400);

    return () => window.clearTimeout(timer);
  }, [copyNotice]);

  const copyConversation = async () => {
    const markdown = exportConversationAsMarkdown({
      scopeLabel: props.scopeLabel,
      config: props.config,
      messages: props.messages,
      toolEvents: props.toolEvents,
    });

    await copyTextToClipboard(markdown);
    setCopyNotice('Conversation copied as Markdown.');
  };

  const threadSummary =
    props.messages.length === 0
      ? 'Ask about the active visualization once chat is configured.'
      : `${props.messages.length} message${props.messages.length === 1 ? '' : 's'} in the active thread.`;

  return (
    <div className="relative grid h-full min-h-0 grid-cols-1 overflow-hidden">
      <div className="flex min-h-0 flex-col">
        <section className="grid min-h-0 flex-1 grid-rows-[auto_minmax(72px,1fr)_auto] overflow-hidden">
          <ModuleSubheader
            data-vacp-chat-subheader="1"
            role="group"
            aria-label="Conversation controls"
            className="justify-between overflow-hidden"
          >
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <div className="inline-flex h-7 shrink-0 items-center rounded-md border border-white/[0.065] bg-white/[0.018] px-2 text-[11px] font-semibold text-slate-100/72">
                Conversation
              </div>
              <div
                className={cn('min-w-0 truncate text-[11px] leading-none text-slate-100/62', compactPanel && 'sr-only')}
              >
                {threadSummary}
              </div>
            </div>
            <div className="flex max-w-full shrink-0 items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Button
                size="iconSm"
                aria-label="Copy conversation as Markdown"
                title="Copy conversation as Markdown"
                onClick={() => void copyConversation()}
              >
                <ClipboardCopy className="h-3.5 w-3.5 text-slate-100/90" />
                <span className="sr-only">Copy conversation</span>
              </Button>
              <Button
                size="sm"
                aria-label="Open chat settings"
                title="Open chat settings"
                onClick={props.onOpenSettings}
              >
                <Settings2 className="h-3.5 w-3.5 text-slate-100/90" />
                <span className={compactPanel ? 'sr-only' : ''}>Settings</span>
              </Button>
              <div className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-amber-100/14 bg-amber-100/[0.055] px-2 text-[10px] text-amber-50/76">
                <span data-vacp-chat-status="1">Setup needed</span>
              </div>
            </div>
          </ModuleSubheader>

          <div
            className={cn(
              'flex min-h-0 flex-1 overflow-hidden border-t border-white/[0.075]',
              compactPanel ? 'px-2 py-1.5' : 'px-3 py-3',
            )}
          >
            <ChatMessages
              messages={props.messages}
              status="ready"
              scrollRef={scrollRef}
              contentRef={contentRef}
              showJumpToLatest={!stickToBottom}
              onJumpToLatest={() => jumpToLatest()}
              compact={compactPanel}
            />
          </div>

          <div
            className={cn(
              'relative z-10 border-t border-white/[0.075] bg-[#0b1115]/88 backdrop-blur-sm',
              compactPanel ? 'px-2 py-2' : 'px-3 py-3',
            )}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-100/56">
              <div className="min-w-0 flex-1 text-pretty">
                Configure a provider, key, and model to send messages. Drafts stay with this thread.
              </div>
              {copyNotice ? <div className="text-slate-100/68">{copyNotice}</div> : null}
            </div>
            <label htmlFor="vacp-chat-input" className="sr-only">
              Chat input
            </label>
            <Textarea
              id="vacp-chat-input"
              data-vacp-chat-input="1"
              className={cn(
                'w-full overflow-x-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere]',
                compactPanel ? 'min-h-[54px]' : 'min-h-[96px]',
              )}
              wrap="soft"
              value={props.draft}
              onChange={(event) => props.onDraftChange(event.target.value)}
              placeholder="Ask about the active visualization..."
            />
            <div className={cn('flex flex-wrap items-center gap-1.5', compactPanel ? 'mt-1.5' : 'mt-2')}>
              <Button
                variant="primary"
                size={compactPanel ? 'iconSm' : 'sm'}
                data-vacp-chat-send="1"
                aria-label="Send message"
                title="Configure chat settings to send messages"
                disabled
              >
                <Send className="h-4 w-4 text-slate-100/90" />
                <span className={compactPanel ? 'sr-only' : ''}>Send</span>
              </Button>
              <Button
                size={compactPanel ? 'iconSm' : 'sm'}
                data-vacp-chat-stop="1"
                aria-label="Stop response"
                title="Stop response"
                disabled
              >
                <Square className="h-3.5 w-3.5 text-slate-100/90" />
                <span className={compactPanel ? 'sr-only' : ''}>Stop</span>
              </Button>
              <Button
                size={compactPanel ? 'iconSm' : 'sm'}
                aria-label="Regenerate response"
                title="Regenerate response"
                disabled
              >
                <RefreshCw className="h-3.5 w-3.5 text-slate-100/90" />
                <span className={compactPanel ? 'sr-only' : ''}>Regenerate</span>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
