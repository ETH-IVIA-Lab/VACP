"""ASGI inspection transport for a host-owned analytical session."""

from __future__ import annotations

import asyncio
from typing import Protocol

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from vacp.provider import ActionCall, ActionResult, Observation, as_dict


class InspectionSession(Protocol):
    @property
    def session_id(self) -> str: ...

    async def inspect(self) -> Observation: ...
    async def execute(self, call: ActionCall) -> ActionResult: ...


def create_inspection_app(
    session: InspectionSession,
    *,
    title: str = 'Analysis',
    allowed_origins: tuple[str, ...] = (),
) -> Starlette:
    """Serve observation and execution at /api/vacp.

    The application owner supplies authentication and session lifetime. Mount this
    app within that owner's ASGI application or bind a local development server.
    """
    gate = asyncio.Lock()

    async def describe(_request: Request) -> JSONResponse:
        return JSONResponse({'id': session.session_id, 'title': title})

    def wrong_session(request: Request) -> bool:
        return request.headers.get('X-VACP-Session') != session.session_id

    async def observe(request: Request) -> JSONResponse:
        if wrong_session(request):
            return JSONResponse({'error': 'Analytical session changed. Reconnect the viewer.'}, status_code=409)
        async with gate:
            return JSONResponse(as_dict(await session.inspect()))

    async def execute(request: Request) -> JSONResponse:
        if wrong_session(request):
            return JSONResponse({'error': 'Analytical session changed. Reconnect the viewer.'}, status_code=409)
        try:
            body = await request.json()
        except ValueError:
            return JSONResponse({'error': 'Expected JSON input'}, status_code=400)
        if not isinstance(body, dict) or not isinstance(body.get('name'), str) or not body['name'].strip():
            return JSONResponse({'error': 'Expected a non-empty action name'}, status_code=400)
        if not isinstance(body.get('callId'), str) or not body['callId']:
            return JSONResponse({'error': 'Expected a callId'}, status_code=400)
        async with gate:
            call = (
                ActionCall(body['callId'], body['name'], body['params'])
                if 'params' in body
                else ActionCall(body['callId'], body['name'])
            )
            result = await session.execute(call)
        payload: dict[str, object] = {'callId': result.call_id, 'ok': result.ok}
        if result.ok:
            payload['result'] = result.result
        else:
            payload['error'] = dict(result.error or {'message': 'Action failed'})
        return JSONResponse(payload)

    routes: list[Route] = [
        Route('/api/vacp/session', describe, methods=['GET']),
        Route('/api/vacp/observation', observe, methods=['GET']),
        Route('/api/vacp/operations', execute, methods=['POST']),
    ]
    middleware = (
        [
            Middleware(
                CORSMiddleware,
                allow_origins=list(allowed_origins),
                allow_methods=['GET', 'POST'],
                allow_headers=['Content-Type', 'X-VACP-Session'],
            )
        ]
        if allowed_origins
        else []
    )
    return Starlette(routes=routes, middleware=middleware)
