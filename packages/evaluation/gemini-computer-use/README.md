## About

This package is heavily based on the upstream `google-gemini/computer-use-preview` project, adapted into this monorepo’s
`uv` workspace and `src/` package layout.

The upstream project is licensed under Apache-2.0. A copy of the upstream license text is included at
`licenses/computer-use-preview-LICENSE`.

## Quick start (Gemini Developer API)

1. Set your API key (either as an env var or in `.env`).

   - Env var: `export GEMINI_API_KEY="..."`  
   - `.env` (auto-loaded by the CLI): `GEMINI_API_KEY=...`

2. Install Playwright browsers (once):

   - `uv run playwright install chrome`

3. Run the agent:

   - `uv run gemini-computer-use --query "Go to Google and type 'Hello World' into the search bar" --env playwright`

## Browser environments

- `playwright`: Runs a local Chromium instance via Playwright.
- `browserbase`: Connects to Browserbase via CDP (requires Browserbase credentials).

## Environment variables

- `GEMINI_API_KEY`: Gemini Developer API key (required unless `USE_VERTEXAI=true`).
- `USE_VERTEXAI`: Set to `true`/`1` to use Vertex AI instead of the Gemini Developer API.
- `VERTEXAI_PROJECT`: GCP project ID (Vertex AI only).
- `VERTEXAI_LOCATION`: GCP region/location (Vertex AI only).
- `BROWSERBASE_API_KEY`: Browserbase API key (required for `--env browserbase`).
- `BROWSERBASE_PROJECT_ID`: Browserbase project ID (required for `--env browserbase`).
- `GEMINI_COMPUTER_USE_AUTO_CONFIRM`: If `true`/`1`, never prompt for safety confirmations.
- `GEMINI_COMPUTER_USE_MAX_STEPS`: If set to a positive integer, stops after that many model steps (unset = unlimited).

## Execution limits / full-auto mode

- Full-auto (no safety prompt): pass `--auto_confirm` (or set `GEMINI_COMPUTER_USE_AUTO_CONFIRM=1`).
- Step limit: pass `--max_steps 50` (or set `GEMINI_COMPUTER_USE_MAX_STEPS=50`); use `--max_steps 0` for unlimited.

## Known issues

### Playwright `<select>` dropdowns

On some operating systems, Playwright can fail to capture OS-rendered `<select>` dropdowns in screenshots. This can
prevent the model from choosing the correct option.

Mitigations:

1. Prefer `--env browserbase`.
2. Inject a custom `<select>` renderer such as `proxy-select` in
   `gemini_computer_use.computers.playwright.PlaywrightComputer.__enter__`.
