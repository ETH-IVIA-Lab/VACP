<template>
  <figure class="vacp-architecture">
    <svg viewBox="0 0 790 330" role="img" aria-labelledby="vacp-architecture-title vacp-architecture-desc">
      <title id="vacp-architecture-title">VACP architecture</title>
      <desc id="vacp-architecture-desc">
        Providers describe analytical sources. The runtime composes them, observes graph, state, and freshness, executes
        actions, and records provenance. Agents and people reach the runtime through the page bridge.
      </desc>
      <defs>
        <marker id="vacp-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 8 4 0 8z" class="head" />
        </marker>
      </defs>
      <text class="heading" x="10" y="20">Sources</text>
      <rect class="box" x="10" y="34" width="170" height="52" rx="6" />
      <text class="label" x="24" y="56">Vega-Lite view</text>
      <text class="note" x="24" y="73">@vacp/adapter-vega-lite</text>
      <rect class="box" x="10" y="98" width="170" height="52" rx="6" />
      <text class="label" x="24" y="120">Mosaic vgplot</text>
      <text class="note" x="24" y="137">@vacp/adapter-vgplot</text>
      <rect class="box" x="10" y="162" width="170" height="52" rx="6" />
      <text class="label" x="24" y="184">Your application</text>
      <text class="note" x="24" y="201">@vacp/sdk</text>
      <text class="note" x="10" y="238">Each provider owns its nodes,</text>
      <text class="note" x="10" y="253">state, and actions.</text>
      <path class="edge" d="M180 60 C 210 60 210 110 238 118" />
      <path class="edge" d="M180 124 L238 124" />
      <path class="edge" d="M180 188 C 210 188 210 138 238 130" />
      <text class="heading" x="244" y="20">Runtime</text>
      <rect class="runtime" x="244" y="34" width="232" height="180" rx="8" />
      <text class="title" x="262" y="62">@vacp/runtime</text>
      <text class="label" x="262" y="92">Composes sources by ownership</text>
      <text class="label" x="262" y="118">Observes graph, state, freshness</text>
      <text class="label" x="262" y="144">Prepares and executes actions</text>
      <text class="label" x="262" y="170">Records provenance</text>
      <text class="code" x="262" y="200">window.__vacp</text>
      <path class="edge" d="M476 84 C 510 84 510 62 538 62" />
      <path class="edge" d="M476 98 L538 116" />
      <path class="edge" d="M476 112 C 510 112 510 170 538 170" />
      <path class="edge" d="M476 190 C 500 200 500 252 538 252" />
      <path class="edge" d="M476 200 C 494 230 494 292 538 296" />
      <text class="heading" x="538" y="20">Agents</text>
      <rect class="box" x="538" y="38" width="242" height="46" rx="6" />
      <text class="label" x="552" y="58">MCP server</text>
      <text class="note" x="552" y="74">External agents · vacp (Python)</text>
      <rect class="box" x="538" y="92" width="242" height="46" rx="6" />
      <text class="label" x="552" y="112">In-page agent</text>
      <text class="note" x="552" y="128">AI SDK tools · @vacp/agent-ai-sdk</text>
      <rect class="box" x="538" y="146" width="242" height="46" rx="6" />
      <text class="label" x="552" y="166">Browser agent</text>
      <text class="note" x="552" y="182">WebMCP · @vacp/transport-webmcp</text>
      <text class="heading" x="538" y="222">People</text>
      <rect class="box" x="538" y="230" width="242" height="44" rx="6" />
      <text class="label" x="552" y="249">Presence and replay</text>
      <text class="note" x="552" y="265">Cursor, narration, checkpoints</text>
      <rect class="box" x="538" y="280" width="242" height="44" rx="6" />
      <text class="label" x="552" y="299">Inspection surfaces</text>
      <text class="note" x="552" y="315">@vacp/inspector-core</text>
    </svg>
  </figure>
</template>

<style scoped>
.vacp-architecture {
  margin: 24px 0;
  overflow-x: auto;
}
svg {
  display: block;
  width: 100%;
  min-width: 620px;
  height: auto;
  font-family: var(--vp-font-family-base);
}
.box {
  fill: var(--vp-c-bg-soft);
  stroke: var(--vp-c-divider);
}
.runtime {
  fill: var(--vp-c-brand-soft);
  stroke: var(--vp-c-brand-1);
}
.heading {
  fill: var(--vp-c-text-2);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.title {
  fill: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 600;
}
.label {
  fill: var(--vp-c-text-1);
  font-size: 13px;
}
.note {
  fill: var(--vp-c-text-2);
  font-size: 11.5px;
}
.code {
  fill: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}
.edge {
  fill: none;
  stroke: var(--vp-c-text-3);
  stroke-width: 1.2;
  marker-end: url(#vacp-arrow);
}
.head {
  fill: var(--vp-c-text-3);
}
</style>
