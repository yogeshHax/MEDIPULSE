"""Endpoint tests for the MediPulse Flask API."""
from conftest import synth_ecg


def test_health_reports_model_and_auth_state(app_client):
    res = app_client.get("/api/health")
    assert res.status_code == 200
    body = res.get_json()
    assert body["status"] == "ok"
    assert body["model"] in {"heuristic-v0", "trained-model"}
    assert body["authRequired"] is False


def test_predict_returns_labelled_experimental_result(app_client):
    samples = synth_ecg(72).tolist()
    res = app_client.post("/api/ecg/predict", json={"ecgSamples": samples, "samplingRate": 250})
    assert res.status_code == 200
    body = res.get_json()
    assert body["modelClass"] in {"N", "L", "R", "A", "V"}
    assert 0 <= body["confidence"] <= 1
    assert 0 <= body["riskScore"] <= 100
    assert body["conditionLevel"] in {"low", "moderate", "high"}
    assert body["experimental"] is True
    assert 55 <= body["bpm"] <= 90  # synthetic 72 bpm signal


def test_predict_rejects_bad_payloads(app_client):
    assert app_client.post("/api/ecg/predict", json={}).status_code == 400
    assert app_client.post("/api/ecg/predict", json={"ecgSamples": [1, 2, 3]}).status_code == 400
    assert app_client.post(
        "/api/ecg/predict", json={"ecgSamples": ["a"] * 200, "samplingRate": 250}
    ).status_code == 400
    assert app_client.post(
        "/api/ecg/predict", json={"ecgSamples": [0.1] * 300, "samplingRate": 5}
    ).status_code == 400
    # Unknown extra fields must not break a valid request.
    ok = app_client.post(
        "/api/ecg/predict",
        json={"ecgSamples": synth_ecg(72).tolist(), "samplingRate": 250, "extra": 1},
    )
    assert ok.status_code == 200


def test_predict_flat_signal_is_not_fabricated_as_normal(app_client):
    res = app_client.post("/api/ecg/predict", json={"ecgSamples": [0.0] * 800, "samplingRate": 250})
    assert res.status_code == 422
    assert "error" in res.get_json()


def test_readings_roundtrip(app_client):
    created = app_client.post("/api/readings", json={
        "patientId": "test-patient",
        "bpm": 78,
        "modelClass": "N",
        "confidence": 0.9,
        "riskScore": 12,
        "signalQuality": "good",
        "source": "hardware",
    })
    assert created.status_code == 201
    rid = created.get_json()["id"]

    listed = app_client.get("/api/readings/test-patient")
    assert listed.status_code == 200
    rows = listed.get_json()
    assert len(rows) == 1
    assert rows[0]["id"] == rid
    assert rows[0]["bpm"] == 78
    assert rows[0]["patientId"] == "test-patient"


def test_readings_validation(app_client):
    assert app_client.post("/api/readings", json={"bpm": 70}).status_code == 400
    assert app_client.post("/api/readings", json={"patientId": "p", "bpm": 900}).status_code == 400
    assert app_client.get("/api/readings/p?max=abc").status_code == 400


def test_alert_lifecycle(app_client):
    created = app_client.post("/api/alerts", json={
        "patientId": "test-patient",
        "kind": "manual-emergency",
        "message": "test request",
        "deliveryConfirmed": False,
    })
    assert created.status_code == 201
    aid = created.get_json()["id"]

    listed = app_client.get("/api/alerts/test-patient").get_json()
    assert listed[0]["status"] == "created"
    assert listed[0]["patientId"] == "test-patient"

    acked = app_client.post(f"/api/alerts/{aid}/ack", json={"ackedBy": "dr-test"})
    assert acked.status_code == 200
    assert acked.get_json()["status"] == "acknowledged"
    assert acked.get_json()["ackedBy"] == "dr-test"

    resolved = app_client.post(f"/api/alerts/{aid}/resolve")
    assert resolved.status_code == 200
    assert resolved.get_json()["status"] == "resolved"
    assert resolved.get_json()["resolvedAt"] is not None

    assert app_client.post("/api/alerts/does-not-exist/ack", json={}).status_code == 404


def test_alert_evaluation_and_cooldown(app_client):
    payload = {"reading": {"patientId": "p1", "bpm": 41, "modelClass": "N"}}
    first = app_client.post("/api/alerts/evaluate", json=payload).get_json()
    assert any(a["kind"] == "bradycardia" for a in first["alerts"])
    second = app_client.post("/api/alerts/evaluate", json=payload).get_json()
    assert second["alerts"] == []
    assert second["suppressed"] >= 1


def test_movement_endpoint(app_client):
    created = app_client.post("/api/movement", json={
        "patientId": "test-patient",
        "activityLevel": "still",
        "magnitude": 1.02,
        "gyro": 12,
        "fallSuspected": True,
        "fallConfirmed": False,
        "source": "hardware",
    })
    assert created.status_code == 201
    rows = app_client.get("/api/movement/test-patient").get_json()
    assert rows[0]["fallSuspected"] is True
    assert rows[0]["fallConfirmed"] is False
    assert app_client.post("/api/movement", json={"patientId": "x", "magnitude": 999}).status_code == 400


def test_unknown_route_returns_json(app_client):
    res = app_client.get("/api/nope")
    assert res.status_code == 404
    assert "error" in res.get_json()


def test_api_key_required_when_configured(secured_client):
    assert secured_client.post("/api/readings", json={"patientId": "p"}).status_code == 401
    assert secured_client.get("/api/readings/p").status_code == 401
    assert secured_client.post(
        "/api/readings", json={"patientId": "p"}, headers={"X-API-Key": "wrong"}
    ).status_code == 401
    ok = secured_client.post(
        "/api/readings", json={"patientId": "p", "bpm": 70}, headers={"X-API-Key": "test-key-123"}
    )
    assert ok.status_code == 201
    # Health stays open so launchers can check readiness without a secret.
    assert secured_client.get("/api/health").status_code == 200
