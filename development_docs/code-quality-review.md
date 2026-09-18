# Inspection boundaries

| Owner              | Responsibility                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Analytical source  | Values, operation execution, graph fragments, and freshness.                                      |
| Inspector client   | Connection identity, observations, and optional execution, invalidation, restoration, and reveal. |
| Inspection session | Request lifetime, immutable observations, optional history, operation results, and read errors.   |
| Observation index  | Entity context, source ownership, relationships, and declared operation dependencies.             |
| Consuming surface  | Selection, navigation, parameter editing, presentation, and host integration.                     |

The root `@vacp/inspector-core` entry point uses protocol types and platform primitives. Runtime and HTTP connectors implement its client port through separate entry points. Wire schemas validate untrusted transport payloads. They preserve application-defined metadata and open semantic vocabularies.

Sessions start explicitly. A source invalidation schedules a read, with bursts coalesced and changes during a read followed by another observation. Superseded reads and disposed sessions cannot publish late results. Operations accept cancellation and retain diagnostics independently of the next observation. The source controls whether an in-flight mutation can be cancelled.

History stores changed observations up to the host's limit. The default is zero retained records. Displaying a record does not call the source. Restoration requires an explicit client capability and the observation to restore.

Core tests exercise shared source ownership, independent histories, immutable capture, cancellation, late responses, invalidation bursts, separate failures, read-only clients, graph context, and HTTP identity. Browser tests exercise the examples through the protocol bridge. Run `make check` and `make e2e` for repository validation.
