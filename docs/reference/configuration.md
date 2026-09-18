# Configuration

VACP supports a small set of runtime toggles via URL query params and environment variables. A URL query param for a flag always wins over environment variables, local storage, and defaults.

## Precedence

1. URL query params
2. Environment variables
3. Local storage when available
4. Built-in defaults

## Knobs

### Inspector

Enable with `?vacp-inspector=1`. Disable with `?vacp-inspector=0`.

Enable with `VACP_INSPECTOR=1`. Disable with `VACP_INSPECTOR=0`.

Local storage key is `vacp:inspector=0|1`. Default is on.

The inspector Settings tab shows the resolved source and can store browser-level overrides.

### Bridge exposure

Enable with `?expose-bridge=1` or `?vacp-expose-bridge=1`. Disable with `?expose-bridge=0` or `?vacp-expose-bridge=0`.

CamelCase URL aliases are also accepted.

Enable with `VACP_EXPOSE_BRIDGE=1`. Disable with `VACP_EXPOSE_BRIDGE=0`.

Local storage key is `vacp:expose-bridge=0|1`. Default is on.

### DOM snapshot injection

Enable with `?vacp-dom-snapshot=1`. Disable with `?vacp-dom-snapshot=0`.

Enable with `VACP_DOM_SNAPSHOT=1`. Disable with `VACP_DOM_SNAPSHOT=0`.

Local storage key is `vacp:dom-snapshot=0|1`. Default is on.

### Raw SQL action

Enable with `?enable-sql=1`. Disable with `?enable-sql=0`.

Enable with `VACP_ENABLE_SQL=1`. Disable with `VACP_ENABLE_SQL=0`.

Local storage key is `vacp:enable-sql=0|1`. Default is on. When disabled, providers can still expose DataHandle nodes and `vacp.data_schema`, but `vacp.data_sql` is not registered or listed in capabilities.

## Optional analytics

The example apps can be configured with optional PostHog settings:

```text
VACP_POSTHOG_API_KEY
VACP_POSTHOG_API_HOST
VACP_POSTHOG_DEFAULTS
VACP_POSTHOG_CAPTURE_SNAPSHOTS
```
