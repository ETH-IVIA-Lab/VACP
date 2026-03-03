# Configuration

VACP supports a small set of runtime toggles via URL query params and environment variables. URL params win.

## Precedence

1. URL query params
2. Environment variables
3. Local storage when available
4. Built-in defaults

## Knobs

### Debug overlay

Enable with `?vacp-debug=1`. Disable with `?vacp-debug=0`.

Enable with `VACP_DEBUG_UI=1`. Disable with `VACP_DEBUG_UI=0`.

Local storage key is `vacp:debug=1`. Default is off.

### Bridge exposure

Enable with `?expose-bridge=1`. Disable with `?expose-bridge=0`.

Enable with `VACP_EXPOSE_BRIDGE=1`. Disable with `VACP_EXPOSE_BRIDGE=0`.

Default is on.

### DOM snapshot injection

Enable with `?vacp-dom-snapshot=1`. Disable with `?vacp-dom-snapshot=0`.

Enable with `VACP_DOM_SNAPSHOT=1`. Disable with `VACP_DOM_SNAPSHOT=0`.

Default is on.

## Optional analytics

The example apps can be configured with optional PostHog settings:

```text
VACP_POSTHOG_API_KEY
VACP_POSTHOG_API_HOST
VACP_POSTHOG_DEFAULTS
VACP_POSTHOG_CAPTURE_SNAPSHOTS
```
