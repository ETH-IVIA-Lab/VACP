from __future__ import annotations

import asyncio
import shutil
import subprocess
import sys
from importlib.metadata import distribution
from importlib.resources import files
from importlib.util import find_spec
from pathlib import Path

import vacp
from vacp import ProviderComposer, as_dict


def test_installed_base_distribution() -> None:
    package = distribution('vacp')
    metadata = package.metadata
    assert {specifier.strip() for specifier in metadata['Requires-Python'].split(',')} == {'>=3.10', '<3.15'}
    assert metadata['License-Expression'] == 'Apache-2.0'
    license_files = metadata.get_all('License-File') or []
    assert license_files
    for license_file in license_files:
        assert package.read_text(f'licenses/{license_file}')
    assert files('vacp').joinpath('py.typed').is_file()
    assert vacp.__file__ is not None
    assert not Path(vacp.__file__).resolve().is_relative_to(Path(__file__).resolve().parents[3])
    for dependency in ('fastmcp', 'playwright', 'starlette'):
        assert find_spec(dependency) is None

    composer = ProviderComposer([])
    try:
        observation = asyncio.run(composer.observe())
        assert as_dict(observation)['graph'] == {
            'sources': [],
            'ownership': {'nodes': {}, 'actions': {}},
            'nodes': [],
            'edges': [],
            'actions': [],
        }
    finally:
        composer.dispose()

    executable = shutil.which('vacp')
    assert executable is not None
    for command in ([sys.executable, '-I', '-m', 'vacp'], [executable]):
        help_result = subprocess.run([*command, '--help'], capture_output=True, text=True, check=True)
        assert 'usage: vacp ' in help_result.stdout
        version_result = subprocess.run([*command, '--version'], capture_output=True, text=True, check=True)
        assert version_result.stdout.strip() == f'vacp {package.version}'
    print(f'Installed vacp {package.version}: base API, CLI, typing marker, and license verified on {sys.version}')
