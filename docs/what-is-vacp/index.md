# What is VACP?

VACP is a small in-app contract for making interactive visual analytics observable and controllable through semantic operations.

Interactive visual analytics already has structure. Selections filter data. Parameters drive encodings. Views depend on each other. VACP makes this structure readable and operable without guessing from pixels or DOM shapes.

## The contract

Capabilities describe the interface as a small graph of entities and relations. They also list the actions that can be executed.

State is a snapshot of current values keyed by stable references. A selection, a parameter, or a data handle can be followed across rerenders.

Actions are intent-level operations. They are validated and either succeed with a structured result or fail with a structured error.

## Where it lives

VACP lives inside the app process. In this repo it is exposed as `window.__vacp`.

Screenshots and DOM access are still useful. They show layout and visual feedback. VACP exists for the parts that need precision: what is selected, which parameters are set, and which interactions are currently valid.

Some stacks already describe intent in declarative specs like Vega-Lite. Some intent only exists in app code and design decisions. VACP is the runtime layer that exposes the semantics an agent needs.

## What this repo provides

This repo ships the protocol types and the in-page runtime that installs a bridge and executes actions.
It also includes provider integrations for common visualization stacks and helpers for custom apps.

Tools reach the same in-page contract through transports. For development, the repo includes a debug overlay and an in-page client.
Examples and evaluation tooling keep the contract exercised and testable.
