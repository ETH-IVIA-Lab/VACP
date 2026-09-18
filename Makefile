SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
.NOTPARALLEL:

PNPM ?= pnpm
UV ?= uv
VP := $(PNPM) exec vp
UV_RUN := $(UV) run --all-packages --all-groups --locked
WORKSPACE_FILTERS := --filter './packages/*' --filter './apps/*' --filter './examples/*' --filter './evals/*'

.PHONY: help setup setup-web setup-python dev dev-all dev-status format lint typecheck
.PHONY: python-format python-lint python-typecheck python-test python-check
.PHONY: build build-libs build-apps docs docs-serve test test-tools knip check package browser-install e2e ci

help: ## Show development commands.
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

setup: setup-web setup-python ## Install the shared JavaScript and Python workspaces.

setup-web:
	$(PNPM) install --frozen-lockfile

setup-python:
	$(UV) sync --all-packages --all-groups --locked

dev: ## Serve the gallery at examples.vacp.localhost.
	$(VP) run @vacp/examples#dev

dev-all: ## Serve docs, gallery, and every standalone example.
	$(VP) run --parallel --filter './apps/docs' --filter './examples/*' dev

dev-status: ## Show registered local development URLs.
	$(PNPM) portless list

format: python-format ## Apply lint fixes and format owned source.
	$(VP) lint --fix
	$(VP) fmt

lint: python-lint ## Check JavaScript and Python formatting and lint rules.
	$(VP) check

build-libs:
	$(VP) run --filter './packages/*' build

build-apps: build-libs
	$(VP) run --filter './examples/*' --filter './apps/docs' --filter './evals/*' build

build: build-apps ## Build libraries, examples, docs, and evaluation tools.

typecheck: build-libs python-typecheck ## Run workspace TypeScript and Python type checks.
	$(PNPM) exec tsc -p tsconfig.tools.json
	$(VP) run $(WORKSPACE_FILTERS) typecheck

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
	$(PNPM) exec tsc -p tools/oxlint/anti-slop/tsconfig.json --noEmit

knip: ## Check unused files, exports, and dependencies.
	$(PNPM) exec knip --treat-config-hints-as-errors

test: build-libs python-test ## Run JavaScript and Python unit tests.
	$(VP) run $(WORKSPACE_FILTERS) test

check: lint typecheck test-tools knip test ## Run the complete local static and unit-test gates.

docs: ## Build the documentation site.
	$(VP) run @vacp/docs#build

docs-serve: ## Serve the user documentation.
	$(VP) run @vacp/docs#dev

package: ## Build Python wheels and source distributions.
	$(UV) build --all-packages --out-dir dist/python

browser-install: ## Install Chromium and its required system libraries.
	$(PNPM) --filter @vacp/e2e exec playwright install --with-deps chromium

e2e: build-apps ## Test examples, Inspector, and the published documentation in Chromium.
	$(PNPM) --filter @vacp/e2e test:e2e

ci: build check package ## Run the source-validation CI pipeline.
