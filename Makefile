SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
.NOTPARALLEL:

PNPM ?= pnpm
UV ?= uv
PYTHON ?= 3.12
VP := $(PNPM) exec vp
UV_RUN := $(UV) run --all-packages --all-groups --locked --python $(PYTHON)
WORKSPACE_FILTERS := --filter './packages/*' --filter './apps/*' --filter './examples/*'
# Oxfmt and Oxlint read the repository .gitignore only, so name the source roots they check.
SOURCE_PATHS := .github apps development_docs docs examples packages tools $(wildcard *.ts *.json *.jsonc *.yaml *.md)
# Extra Playwright arguments for browser-test, such as --shard=1/4.
PLAYWRIGHT_ARGS ?=

.PHONY: bench help setup setup-web setup-python dev dev-all dev-status format format-check lint typecheck
.PHONY: python-format python-lint python-typecheck python-test python-check python-test-package
.PHONY: build build-libs build-apps docs docs-serve test test-tools test-package-imports knip check package browser-install browser-test e2e ci

help: ## Show development commands.
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

setup: setup-web setup-python ## Install the shared JavaScript and Python workspaces.

setup-web:
	$(PNPM) install --frozen-lockfile

setup-python:
	$(UV) sync --all-packages --all-groups --locked --python $(PYTHON)

dev: ## Serve the gallery at examples.vacp.localhost.
	$(VP) run @ethivia/vacp-examples#dev

dev-all: ## Serve docs, gallery, and every standalone example.
	$(VP) run --parallel --filter @ethivia/vacp-docs --filter './examples/*' dev

dev-status: ## Show registered local development URLs.
	$(PNPM) --filter @ethivia/vacp-examples exec portless list

format: python-format ## Apply lint fixes and format owned source.
	$(VP) check --fix $(SOURCE_PATHS)

format-check: ## Check the formatting of owned source, documentation included.
	$(VP) fmt --check $(SOURCE_PATHS)

lint: build-libs python-lint ## Check formatting, lint rules, and TypeScript types, and lint Python.
	$(VP) check $(SOURCE_PATHS)

build-libs:
	rm -rf packages/*/dist
	$(VP) run --filter './packages/*' build

build-apps: build-libs
	$(VP) run --filter './examples/*' --filter @ethivia/vacp-docs build

build: build-apps ## Build libraries, examples, and docs.

typecheck: build-libs python-typecheck ## Run workspace TypeScript and Python type checks.
	$(VP) check --no-fmt --no-lint $(SOURCE_PATHS)

python-format: ## Format all Python source and tests.
	$(UV_RUN) ruff format .

python-lint: ## Check Python lint and formatting across the repository.
	$(UV_RUN) ruff check .
	$(UV_RUN) ruff format --check .

python-typecheck: ## Run all three Python type checkers across the workspace.
	$(UV_RUN) ty check --error-on-warning
	$(UV_RUN) basedpyright --warnings
	$(UV_RUN) pyrefly check --min-severity warn

python-test: ## Run the combined Python test suite.
	$(UV_RUN) pytest

python-check: python-lint python-typecheck python-test ## Run every Python QA gate.

test-tools: ## Validate the vendored anti-slop rules and their CLI integration.
	$(PNPM) exec node --test --test-concurrency=1 tools/oxlint/anti-slop/rules/*.test.ts tools/oxlint/anti-slop/effect/rules/*.test.ts
	$(PNPM) exec tsx --test tools/stylex/*.test.ts
	$(PNPM) exec tsc -p tools/oxlint/anti-slop/tsconfig.json --noEmit

# The generated gallery routes are what reference examples/gallery/src/route-entry.ts.
knip: ## Check unused files, exports, and dependencies.
	node examples/gallery/scripts/sync-generated.mjs
	$(PNPM) exec knip --treat-config-hints-as-errors

test-package-imports: build-libs ## Verify public package exports in native Node and TypeScript.
	$(PNPM) exec node tools/check-package-imports.mjs

test: build-libs test-package-imports python-test ## Run JavaScript and Python unit tests.
	$(VP) run $(WORKSPACE_FILTERS) test

check: lint python-typecheck test-tools knip test ## Run the complete local static and unit-test gates.

docs: ## Build the documentation site.
	$(VP) run @ethivia/vacp-docs#build

docs-serve: ## Serve the user documentation.
	$(VP) run @ethivia/vacp-docs#dev

package: ## Build Python distributions and validate their PyPI metadata.
	$(UV) build --package vacp --no-sources --python $(PYTHON) --out-dir dist/python
	set -eu; version=$$($(UV) version --package vacp --short); \
		$(UV_RUN) twine check --strict dist/python/vacp-$$version-py3-none-any.whl dist/python/vacp-$$version.tar.gz

python-test-package: package ## Test installed Python distributions. Override PYTHON for compatibility checks.
	set -eu; version=$$($(UV) version --package vacp --short); \
		for distribution in dist/python/vacp-$$version-py3-none-any.whl dist/python/vacp-$$version.tar.gz; do \
			$(UV) run --isolated --no-project --python $(PYTHON) --with "$$distribution" \
				python -I tools/check-python-package.py; \
			$(UV) run --isolated --no-project --python $(PYTHON) --with "$$distribution[server,http]" \
				--with 'pytest>=9' --with 'pytest-asyncio>=0.24.0' \
				python -I -m pytest; \
		done

browser-install: ## Install Chromium and its required system libraries.
	$(PNPM) --filter @ethivia/vacp-e2e exec playwright install --with-deps chromium

browser-test: ## Run the browser suite against existing builds, with PLAYWRIGHT_ARGS.
	$(PNPM) --filter @ethivia/vacp-e2e test:e2e $(PLAYWRIGHT_ARGS)

e2e: build-apps browser-test ## Test examples and the published documentation in Chromium.

ci: build check package ## Run the source-validation CI pipeline.

bench: build-libs ## Measure runtime, browser snapshot, SDK, adapter, inspection, presence, and transport hot paths.
	$(VP) run --filter './packages/*' --concurrency-limit 1 bench
	$(UV_RUN) python packages/python/bench/availability.py
