// OpenCode plugin: patch global fetch so Gemini Computer Use models don't 400.
//
// Context:
// - `gemini-2.5-computer-use-preview-10-2025` rejects requests unless the
//   Computer Use tool is present (tools: [{ computer_use: { environment: ... } }]).
// - OpenCode currently uses @ai-sdk/google, which doesn't (yet) expose this tool.
// - We inject it at the HTTP layer for this one model to keep the change small and local.

const COMPUTER_USE_MODEL_SUBSTRING = 'gemini-2.5-computer-use-preview-10-2025';

// From https://ai.google.dev/gemini-api/docs/computer-use#supported-actions
const COMPUTER_USE_PREDEFINED_FUNCTIONS = [
  'open_web_browser',
  'wait_5_seconds',
  'go_back',
  'go_forward',
  'search',
  'navigate',
  'click_at',
  'hover_at',
  'type_text_at',
  'key_combination',
  'scroll_document',
  'scroll_at',
  'drag_and_drop',
];

function toUrlString(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  try {
    return String(input);
  } catch {
    return '';
  }
}

function shouldPatch(url) {
  // Tight scope: only patch the Gemini API + the specific Computer Use model.
  return url.includes('generativelanguage.googleapis.com') && url.includes(COMPUTER_USE_MODEL_SUBSTRING);
}

function injectComputerUseTool(init) {
  if (!init || init.method !== 'POST' || init.body == null) return init;
  if (typeof init.body !== 'string') return init;

  try {
    const body = JSON.parse(init.body);
    const tools = Array.isArray(body?.tools) ? body.tools : [];

    const hasComputerUse = tools.some(
      (t) => t && typeof t === 'object' && Object.prototype.hasOwnProperty.call(t, 'computer_use'),
    );
    if (hasComputerUse) return init;

    tools.push({
      computer_use: {
        environment: 'ENVIRONMENT_BROWSER',
        // In agent-arena we already provide browser control via OpenCode tools (bash + agent-browser),
        // so exclude the built-in action set to reduce unsupported tool-call risk.
        excluded_predefined_functions: COMPUTER_USE_PREDEFINED_FUNCTIONS,
      },
    });

    body.tools = tools;
    return { ...init, body: JSON.stringify(body) };
  } catch {
    return init;
  }
}

export default async function GoogleComputerUsePlugin() {
  // Prevent double-patching across instance reloads.
  if (globalThis.__vacpGoogleComputerUseFetchPatched) return {};
  globalThis.__vacpGoogleComputerUseFetchPatched = true;

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== 'function') return {};

  globalThis.fetch = async (input, init) => {
    const url = toUrlString(input);
    if (!shouldPatch(url)) return originalFetch(input, init);
    return originalFetch(input, injectComputerUseTool(init));
  };

  return {};
}

