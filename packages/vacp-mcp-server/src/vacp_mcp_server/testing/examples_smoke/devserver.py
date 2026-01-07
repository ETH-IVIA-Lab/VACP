from __future__ import annotations

import asyncio
import os
import socket
from dataclasses import dataclass
from pathlib import Path


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        s.listen(1)
        return int(s.getsockname()[1])


async def wait_http_ready(url: str, timeout_s: float = 30.0) -> None:
    import urllib.request

    start = asyncio.get_event_loop().time()
    while True:
        try:
            with urllib.request.urlopen(url, timeout=2) as _:
                return
        except Exception as err:
            if asyncio.get_event_loop().time() - start > timeout_s:
                raise TimeoutError(f'Timed out waiting for server: {url}') from err
            await asyncio.sleep(0.2)


@dataclass(frozen=True)
class DevServer:
    name: str
    cwd: Path
    port: int
    url: str
    proc: asyncio.subprocess.Process
    log_path: Path

    async def stop(self) -> None:
        if self.proc.returncode is not None:
            return
        self.proc.terminate()
        try:
            await asyncio.wait_for(self.proc.wait(), timeout=10)
        except TimeoutError:
            self.proc.kill()
            await self.proc.wait()


async def start_vite_dev_server(name: str, cwd: Path, port: int, artifacts_dir: Path) -> DevServer:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    log_path = artifacts_dir / f'{name}.dev.log'
    log_f = log_path.open('wb')
    proc = await asyncio.create_subprocess_exec(
        'pnpm',
        'dev',
        '--host',
        '127.0.0.1',
        '--port',
        str(port),
        '--strictPort',
        cwd=str(cwd),
        stdout=log_f,
        stderr=asyncio.subprocess.STDOUT,
        env={**os.environ, 'BROWSER': 'none'},
    )
    url = f'http://127.0.0.1:{port}/'
    try:
        await wait_http_ready(url, timeout_s=45)
    except Exception:
        await DevServer(
            name=name,
            cwd=cwd,
            port=port,
            url=url,
            proc=proc,
            log_path=log_path,
        ).stop()
        raise
    return DevServer(name=name, cwd=cwd, port=port, url=url, proc=proc, log_path=log_path)
