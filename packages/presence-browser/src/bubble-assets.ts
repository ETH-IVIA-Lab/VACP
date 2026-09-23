/** Lucide `bot`, with its body rectangle expressed as a path so one stroked path draws the mark; see NOTICE. */
export const agentIcon =
  'M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM2 14h2M20 14h2M15 13v2M9 13v2';

// The mark is one 16px box with two layers: the bot at rest, and the loading.dev `Gather` blocks
// while the agent is thinking or acting (see NOTICE). Switching crossfades and scales between them,
// entering with a strong ease-out. Blocks animate on the compositor only.
export const markStyle = `
.vacp-agent-mark{position:relative;display:inline-grid;width:16px;height:16px;flex:none;color:#4f6fd8}
.vacp-agent-mark[hidden]{display:none}
.vacp-agent-mark>*{grid-area:1/1;transition:opacity 220ms cubic-bezier(.23,1,.32,1),transform 220ms cubic-bezier(.23,1,.32,1)}
.vacp-agent-mark svg{width:16px;height:16px}
.vacp-agent-mark .vacp-gather{opacity:0;transform:scale(.72)}
.vacp-agent-mark[data-busy] svg{opacity:0;transform:scale(.72)}
.vacp-agent-mark[data-busy] .vacp-gather{opacity:1;transform:none}
.vacp-gather{display:grid;grid-template-columns:1fr 1fr;gap:24%;width:12px;height:12px;place-self:center;animation:vacp-gather-turn 1600ms ease-in-out infinite}
.vacp-gather i{display:block;background:currentColor;border-radius:1.7px;animation:vacp-gather-pull 1600ms ease-in-out infinite}
@keyframes vacp-gather-pull{0%,100%{transform:translate(0,0)}30%,60%{transform:translate(calc(var(--vacp-x) * 21.1%),calc(var(--vacp-y) * 21.1%))}}
@keyframes vacp-gather-turn{0%,30%{transform:rotate(0)}60%,100%{transform:rotate(90deg)}}
.vacp-heading-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vacp-waiting{min-height:20px;color:#697386}
.vacp-waiting[hidden],[data-vacp-summary][hidden]{display:none}
[data-reduced] .vacp-agent-mark>*{transition:none}
[data-reduced] .vacp-gather,[data-reduced] .vacp-gather i{animation:none}
`;
