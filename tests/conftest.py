import pytest

from kosarica import ingest


@pytest.fixture(autouse=True)
def no_retry_wait(monkeypatch):
    monkeypatch.setattr(ingest, "RETRY_BASE_SECONDS", 0)
    monkeypatch.setattr(ingest, "PASS_PAUSE_SECONDS", 0)
