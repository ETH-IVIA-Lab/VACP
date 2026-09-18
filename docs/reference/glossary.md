# Glossary

## Action

A named operation with a parameter description and an application handler. Example: set an interval _Selection_.

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

An adapter between the bridge and an agent-facing tool contract. Example: MCP over Playwright.

## Runtime

The component that combines snapshot and action providers with history, subscriptions, and replay.
