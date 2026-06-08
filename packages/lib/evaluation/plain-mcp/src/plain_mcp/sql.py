from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Literal

from plain_mcp.runtime import JsonDict

SortDirection = Literal['asc', 'desc']


def clean_limit(limit: int, *, max_limit: int = 500) -> int:
    return max(1, min(max_limit, int(limit)))


def sql_literal(value: object) -> str:
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return 'TRUE' if value else 'FALSE'
    if isinstance(value, int | float):
        return str(value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def lower_like(column: str, value: str) -> str:
    return f'LOWER({column}) LIKE {sql_literal(f"%{value.lower()}%")}'


def string_equals(column: str, value: str) -> str:
    return f'LOWER({column}) = {sql_literal(value.lower())}'


def numeric_range(column: str, minimum: float | None, maximum: float | None) -> list[str]:
    clauses: list[str] = []
    if minimum is not None:
        clauses.append(f'{column} >= {sql_literal(minimum)}')
    if maximum is not None:
        clauses.append(f'{column} <= {sql_literal(maximum)}')
    return clauses


def order_clause(column: str | None, direction: SortDirection) -> str:
    if not column:
        return ''
    return f' ORDER BY {column} {"DESC" if direction == "desc" else "ASC"}'


def where_clause(clauses: Iterable[str]) -> str:
    parts = [clause for clause in clauses if clause]
    return f' WHERE {" AND ".join(parts)}' if parts else ''


def select_with_total(
    *,
    columns: Sequence[str],
    where: Sequence[str],
    order_by: str | None,
    direction: SortDirection = 'asc',
    limit: int,
) -> str:
    selected = ', '.join(columns)
    return (
        f'WITH filtered AS (SELECT {selected} FROM vacp_all{where_clause(where)}) '
        f'SELECT *, COUNT(*) OVER () AS __total_count FROM filtered'
        f'{order_clause(order_by, direction)} LIMIT {clean_limit(limit)}'
    )


def select_query(
    *,
    columns: Sequence[str],
    where: Sequence[str],
    order_by: str | None,
    direction: SortDirection = 'asc',
    limit: int,
    source: str = 'vacp_all',
) -> str:
    selected = ', '.join(columns)
    return (
        f'SELECT {selected} FROM {source}'
        f'{where_clause(where)}'
        f'{order_clause(order_by, direction)} '
        f'LIMIT {clean_limit(limit)}'
    )


def quote_ident(identifier: str) -> str:
    escaped = identifier.replace('"', '""')
    return f'"{escaped}"'


def quote_table_ref(table: str) -> str:
    return '.'.join(quote_ident(part) for part in table.split('.'))


def compact_criteria(criteria: Mapping[str, object]) -> JsonDict:
    return {key: value for key, value in criteria.items() if value is not None}


def with_criteria(result: JsonDict, criteria: Mapping[str, object]) -> JsonDict:
    return {**result, 'criteria': compact_criteria(criteria)}


def rows_response(rows: list[JsonDict], *, criteria: JsonDict | None = None) -> JsonDict:
    def to_int(value: object) -> int | None:
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        if isinstance(value, str) and value.isdecimal():
            return int(value)
        return None

    total = 0
    cleaned: list[JsonDict] = []
    for row in rows:
        next_row = dict(row)
        raw_total = next_row.pop('__total_count', None)
        parsed_total = to_int(raw_total)
        if parsed_total is not None:
            total = parsed_total
        cleaned.append(next_row)
    return {'total': total if rows else 0, 'rows': cleaned, 'criteria': compact_criteria(criteria or {})}
