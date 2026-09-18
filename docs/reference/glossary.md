# Glossary

## Action

A named semantic operation with parameter metadata and an owning provider. Its operation record identifies its kind, inputs, effects, dynamic ref parameters, and results.

## Analytical projection

The graph, state, summaries, and freshness a provider derives from its source at observation time.

## Capabilities

A scoped graph view containing sources, ownership, entities, relationships, and available actions.

## Freshness

The relationship between an output and its input revision. An output can be current, stale, running, or failed.

## Graph

A semantic model composed from source descriptions, nodes, edges, actions, and ownership maps.

## Observation

One revisioned read of the composed graph, state, summaries, and output freshness.

## Provider

A source description plus a live binding that publishes observations, executes owned actions, sends invalidations, and releases source resources.

## Ref

A stable `vacp://` identifier for an analytical entity.

## Runtime

The component that composes providers, routes actions by ownership, records history, and manages replay and lifecycle.

## Source

A stable owner identified by a `vacp-source://` ID. A source can represent an application, visualization, widget, notebook, database, or another analytical system.

## State

Current analytical values keyed by refs. State includes selections, parameters, widget values, and provider-defined output records.

## Transport

An adapter between the runtime bridge and an agent-facing interface such as MCP or WebMCP.
