"""Availability workloads, separate from correctness tests and timing thresholds."""

from platform import python_version
from statistics import median
from time import perf_counter

from vacp import ActionDescriptor, Availability, GraphFragment, Node, OperationSemantics, resolve_availability

SIZE = 5_000


def measure(label: str, graph: GraphFragment, expected: int) -> None:
    def run() -> None:
        _, actions = resolve_availability(graph)
        if sum(status.available for status in actions.values()) != expected:
            raise RuntimeError('Incorrect action availability')

    for _ in range(20):
        run()
    rounds: list[float] = []
    for _ in range(5):
        start = perf_counter()
        for _ in range(20):
            run()
        rounds.append((perf_counter() - start) * 1000 / 20)
    print(f'{label}: {median(rounds):.3f} ms/op (median of 5 x 20)')


print(f'Python {python_version()}; {SIZE} nodes and actions')
nodes = tuple(Node(f'vacp://bench/{index}', 'Param', 'ConfigLayer') for index in range(SIZE))
actions = tuple(ActionDescriptor(f'set.{index}', 'Set value', OperationSemantics('mutation')) for index in range(SIZE))
measure('unrestricted availability', GraphFragment(nodes, (), actions), SIZE)
gated_nodes = tuple(
    Node(
        node.ref,
        node.kind,
        node.layer,
        availability=Availability(unavailable='Choose data')
        if index == 0
        else Availability(requires=('vacp://bench/0',))
        if index % 2
        else None,
    )
    for index, node in enumerate(nodes)
)
gated_actions = tuple(
    ActionDescriptor(action.name, action.description, action.operation, availability=Availability(requires=(node.ref,)))
    for node, action in zip(nodes, actions, strict=True)
)
measure('half-hidden availability', GraphFragment(gated_nodes, (), gated_actions), SIZE // 2 - 1)
chain = tuple(
    Node(
        node.ref, node.kind, node.layer, availability=Availability(requires=(nodes[index - 1].ref,)) if index else None
    )
    for index, node in enumerate(nodes)
)
measure('deep prerequisite chain', GraphFragment(chain, (), actions), SIZE)
