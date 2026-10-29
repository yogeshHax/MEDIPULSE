"""Shared pytest fixtures for the MediPulse backend tests."""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def synth_ecg(bpm=72, seconds=8.0, rate=250, noise=0.04, seed=7, amplitude=1.2):
    """Deterministic synthetic ECG with R-peaks at a known rate (test signal only)."""
    rng = np.random.default_rng(seed)
    n = int(seconds * rate)
    x = np.zeros(n)
    pos = 40.0
    for _ in range(int(bpm * seconds) + 1):
        pos += 60 / bpm * rate
        idx = int(pos)
        if idx >= n - 24:
            break
        window = np.arange(-2, 22)
        x[idx:idx + 24] += amplitude * np.exp(-0.5 * (window / 4) ** 2)
        x[idx:idx + 24] += 0.2 * np.exp(-0.5 * (window / 18) ** 2)
    x += noise * rng.standard_normal(n)
    return x


@pytest.fixture()
def app_client(tmp_path, monkeypatch):
    """Flask test client backed by a throw-away SQLite database."""
    monkeypatch.setenv("MEDIPULSE_SQLITE_PATH", str(tmp_path / "test.db"))
    monkeypatch.delenv("MEDIPULSE_API_KEY", raising=False)
    import app as app_module

    application = app_module.create_app()
    application.config.update(TESTING=True)
    with application.test_client() as client:
        yield client


@pytest.fixture()
def secured_client(tmp_path, monkeypatch):
    """Client for an API configured with a shared-secret key."""
    monkeypatch.setenv("MEDIPULSE_SQLITE_PATH", str(tmp_path / "secured.db"))
    monkeypatch.setenv("MEDIPULSE_API_KEY", "test-key-123")
    import app as app_module

    application = app_module.create_app()
    application.config.update(TESTING=True)
    with application.test_client() as client:
        yield client
