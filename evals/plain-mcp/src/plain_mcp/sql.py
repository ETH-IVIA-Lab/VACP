from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Literal, cast

from plain_mcp.runtime import JsonDict

SortDirection = Literal['asc', 'desc']


def clean_limit(limit: int, *, max_limit: int = 500) -> int:
    return max(1, min(max_limit, limit))


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


def _compact_mapping(values: Mapping[str, object]) -> JsonDict:
    return {key: value for key, value in values.items() if value is not None}


def _parse_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.isdecimal():
        return int(value)
    return None


def _clean_rows(rows: Sequence[object]) -> list[JsonDict]:
    cleaned: list[JsonDict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        cleaned.append({str(key): value for key, value in row.items() if not str(key).startswith('__')})
    return cleaned


def _columns_from_rows(rows: Sequence[JsonDict]) -> list[str]:
    columns: list[str] = []
    for row in rows:
        for key in row:
            if key not in columns:
                columns.append(key)
    return columns


def data_response(result: JsonDict, filters: Mapping[str, object], *, note: str | None = None) -> JsonDict:
    raw_rows = result.get('rows')
    cleaned_rows = _clean_rows(raw_rows if isinstance(raw_rows, list) else [])
    raw_columns = result.get('columns')
    columns = (
        [str(column) for column in raw_columns] if isinstance(raw_columns, list) else _columns_from_rows(cleaned_rows)
    )
    columns = [column for column in columns if not column.startswith('__')]

    total_rows = len(cleaned_rows)
    for raw_row in raw_rows if isinstance(raw_rows, list) else []:
        if isinstance(raw_row, dict):
            parsed_total = _parse_int(cast(dict[str, object], raw_row).get('__total_count'))
            if parsed_total is not None:
                total_rows = parsed_total
                break

    response: JsonDict = {
        'rows': cleaned_rows,
        'columns': columns,
        'rowCount': len(cleaned_rows),
        'totalRows': total_rows,
        'filters': _compact_mapping(filters),
    }
    if result.get('truncated') is True:
        response['truncated'] = True
    if note:
        response['note'] = note
    return response


def action_response(action: str, state: JsonDict, *, details: Mapping[str, object] | None = None) -> JsonDict:
    response: JsonDict = {'status': 'ok', 'action': action, 'state': state}
    if details:
        response['details'] = _compact_mapping(details)
    return response
