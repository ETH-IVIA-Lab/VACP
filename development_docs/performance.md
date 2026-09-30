# Runtime performance

Run `make bench` from the repository root. It builds the libraries, then measures runtime reads and WebMCP catalog registration. Benchmarks are opt-in; CI checks behavior without wall-clock thresholds.

## Workloads

- `packages/runtime/bench/runtime.ts`: 1,000 nodes, 1,000 actions, and 1,000 state references from a static provider. Each result is the median of five 100-operation batches after 20 warmup operations. The serialized state is 49,791 UTF-16 code units.
- `packages/runtime-browser/bench/snapshot.ts`: DOM snapshot writes for 400 refs, 20 of them holding 200 rows, with one ref changing per snapshot. Each snapshot is cloned, as composition clones provider observations, and each write is checked to publish exactly the changed ref.
- `packages/transport-webmcp/bench/registration.ts`: 50 synchronous graph revisions, each with 1,000 changed action descriptions. Results are the median of five bursts after two warmups. The injected registry resolves immediately; native browser registration latency is excluded.

- `packages/adapter-vega-lite/bench/data.ts`: a headless Vega view over 20,000 rows with a parsed date and a time unit, and a DuckDB client that accepts every write and counts loads. It times a SQL read of unchanged data, a filter change alone, and a SQL read after the filter changes the shown rows, timed apart from the change. Each read must succeed and load exactly the tables it names.

These isolate runtime and transport overhead. They do not measure visualization rendering, provider work, agent latency, or network requests. Avoid running builds or browser tests alongside timing runs.

## September 18, 2026 round

Measured on an Apple M3 Max with Node 24.16.0, against the implementation immediately before this performance round:

| Workload                                |     Before |     After |
| --------------------------------------- | ---------: | --------: |
| Hash 100 KiB of ASCII text              |   1.861 ms |  0.680 ms |
| Capabilities read without subscribers   |   1.846 ms |  0.001 ms |
| Full state response without subscribers |   6.220 ms |  1.284 ms |
| Unchanged delta without subscribers     |   7.635 ms |  2.092 ms |
| Unchanged subscribed snapshot           |   2.314 ms |  2.301 ms |
| WebMCP catalog burst                    | 379.244 ms | 11.874 ms |
| Registrations per catalog burst         |     50,000 |     1,000 |

The runtime reuses the state-update builder's scoped snapshot and token for its response cache. Graph change detection runs only while capabilities or snapshot subscribers exist. Provider reads remain fresh; graphs and schemas are not cached by object identity.

The shared FNV-1a implementation uses two 32-bit limbs instead of allocating BigInts per character. Differential tests against the original arithmetic cover all UTF-16 code units, long inputs, and deterministic generated strings. Existing tokens remain identical.

WebMCP keeps one active catalog update and one pending catalog. New revisions replace the pending graph, and callers share its completion promise. A refresh therefore waits for its graph or a newer queued revision to finish registering. Tests with a delayed registry protect this completion guarantee, cancellation, and ownership of unrelated tools.

Subscribed snapshot serialization is unchanged by this round. Its cost remains proportional to graph and state size, including when content has not changed; object identity is insufficient because providers can mutate existing values.

## September 30, 2026 round

Measured on an Apple M3 Max with Node 24.16.0 under a concurrent CPU load, as the median of three interleaved runs of `bench/data.ts` against the implementation immediately before this round:

| Workload                                         |  Before |   After |
| ------------------------------------------------ | ------: | ------: |
| Filter change alone                              | 40.5 ms | 40.8 ms |
| SQL read after the filter changes the shown rows | 33.6 ms |  5.2 ms |

`tableRows` formats each instant's wall-clock text once per load, since time units repeat a few hundred instants across every row, and collects the column names in the same loop. While Vega's data listener is attached, its change count names the shown rows, so a reload serializes them once, for DuckDB. The filter change is Vega's own work, so its difference between runs is machine noise. Observations after a filter change read the shown row count from those rows and leave DuckDB alone until SQL or a new schema needs it.

Eval runs wait for page readiness on native witnesses: the page's WebMCP registry holds every tool its observed graph compiles to, and every output the observation reports has rendered its current input. It replaces a fixed settle window. Over 64 reference-solution runs, every scenario twice at a concurrency of 2 on one gallery and interleaved with the settle window, the median run fell from 2,281 ms to 1,088 ms, and the run time of one pass over the 32 scenarios from 74.9 s to 34.2 s.
