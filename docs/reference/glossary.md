# Glossary

## Action

A named operation with validated parameters. Example: set an interval _Selection_.

## Capabilities

A snapshot describing what exists in the app and what actions are available.

## Graph

A semantic model of the interface represented as nodes and edges.

## Provider

A translation layer that maps a visualization runtime into VACP capabilities, state, and actions.

## Ref

A stable identifier for a semantic entity in the app. Example: `vacp://...`.

## State

A snapshot of current values keyed by refs. It includes *Selection*s, *Param*s, and configuration values.

## Transport

A way to reach the in-app protocol from another process. Example: MCP over Playwright.

## Runtime

The in-page layer that installs the bridge, validates actions, and optionally records history.
