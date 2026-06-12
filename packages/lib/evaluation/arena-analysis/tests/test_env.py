from pathlib import Path

from arena_analysis import env
from pytest import MonkeyPatch


def test_env_loads_package_dotenv_keys_without_overriding_existing_values(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    env_file = tmp_path / '.env'
    env_file.write_text(
        'OPENAI_BASE=http://dotenv.example/v1\nOPENAI_API_KEY=secret-from-file\nMODEL=dotenv-model\n',
        encoding='utf-8',
    )
    monkeypatch.delenv('OPENAI_BASE', raising=False)
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    monkeypatch.delenv('MODEL', raising=False)
    monkeypatch.setenv('OPENAI_BASE_URL', 'http://existing.example/v1')

    loaded = env.load(env_file)

    assert loaded.loaded is True
    assert set(loaded.keys) == {'MODEL', 'OPENAI_BASE', 'OPENAI_BASE_URL', 'OPENAI_API_KEY'}
    assert env.base_url() == 'http://dotenv.example/v1'
    assert env.model() == 'dotenv-model'
    assert env.api_key() == 'secret-from-file'
