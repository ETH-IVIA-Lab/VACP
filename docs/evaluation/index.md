# Evaluation

VACP is designed to be testable. When state and interactions are explicit, you can run tasks against a stable contract and record what happened.

This repo includes Agent Arena, a CLI for running scenario suites against VACP-enabled apps and producing analysis artifacts.
Agent Arena lives in `packages/lib/evaluation/agent-arena`.

At a high level, a run combines a scenario and an experiment. A scenario is a URL and a task. An experiment is the model setup and tool policy used to run it.

The examples gallery matters here. It serves all demo apps from one base URL with stable routes, which makes scenario suites reproducible.

End-to-end browser coverage lives in `packages/testing/e2e` and is implemented with [Playwright](https://playwright.dev/).

## Outputs

Agent Arena produces:

- a run folder with evidence snapshots
- derived datasets
- a report bundle
