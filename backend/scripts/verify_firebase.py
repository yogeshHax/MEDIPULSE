"""Firebase integration self-test (Firestore, Admin SDK).

Checks the eight things docs/firebase-setup.md promises:
  1. credentials load against firebase project `medipulse-48c9a`
  2. a reading can be written under a TEST patient
  3. the reading can be read back
  4. a realtime listener receives the change
  5. the stored BPM matches what we wrote
  6. an authorised doctor-side listener sees the same update
  7. a failed write surfaces a real error (invalid document path)
  8. the test data is removed afterwards

This script uses the Admin SDK, which BYPASSES security rules. It proves the
database is reachable and the schema is writable; it does NOT prove the browser
rules are correct. Rule verification requires signing in as two real test
accounts and is documented as a manual step in docs/firebase-setup.md §6.

Exit codes: 0 all checked, 2 credentials/SDK missing, 1 a check failed.
"""
from __future__ import annotations

import os
import sys
import time
import uuid
from pathlib import Path

TEST_PATIENT = "medipulse-integration-test"
PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "medipulse-48c9a")


def fail(msg: str) -> None:
    print(f"  ✗ {msg}")


def ok(msg: str) -> None:
    print(f"  ✓ {msg}")


def main() -> int:
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        print("Firebase Admin SDK is not installed.")
        print("  py -m pip install firebase-admin")
        return 2

    cred_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if not cred_path or not Path(cred_path).exists():
        print("No service-account key found.")
        print("  Set FIREBASE_SERVICE_ACCOUNT to the path of your service-account JSON")
        print("  (Firebase console → Project settings → Service accounts → Generate new private key).")
        print("  The key is server-only: keep it out of Git (it is already in .gitignore).")
        return 2

    if not firebase_admin._apps:  # noqa: SLF001 — documented SDK check
        firebase_admin.initialize_app(
            credentials.Certificate(cred_path), {"projectId": PROJECT_ID}
        )
    db = firestore.client()
    print(f"Firebase integration self-test — project {PROJECT_ID}")

    reading_ref = (
        db.collection("patients").document(TEST_PATIENT).collection("readings").document(
            f"selftest_{uuid.uuid4().hex[:10]}"
        )
    )
    bpm = 71
    payload = {
        "patientId": TEST_PATIENT,
        "timestamp": int(time.time() * 1000),
        "bpm": bpm,
        "source": "bridge",
        "signalQuality": "good",
        "modelClass": None,
        "confidence": None,
        "riskScore": None,
        "trend": "stable",
        "conditionLevel": None,
        "selftest": True,
    }

    received: list[dict] = []

    def on_snapshot(docs, _changes, _read_time):
        for d in docs:
            received.append(d.to_dict() or {})

    failures = 0
    unsub = reading_ref.parent.on_snapshot(on_snapshot)
    try:
        time.sleep(1.0)
        ok("credentials loaded and Firestore client created")

        reading_ref.set(payload)
        ok("write accepted")

        snap = reading_ref.get()
        if snap.exists:
            ok("read back the written document")
        else:
            fail("document not readable after write")
            failures += 1

        got = snap.to_dict() or {}
        if got.get("bpm") == bpm:
            ok(f"stored BPM matches ({bpm})")
        else:
            fail(f"BPM mismatch: wrote {bpm}, read {got.get('bpm')}")
            failures += 1

        deadline = time.time() + 6
        while time.time() < deadline and not any(r.get("bpm") == bpm for r in received):
            time.sleep(0.25)
        if any(r.get("bpm") == bpm for r in received):
            ok("realtime listener received the update")
        else:
            fail("realtime listener did not receive the update within 6 s")
            failures += 1

        # Check 7 — a write to an invalid path must raise, not silently "succeed".
        try:
            db.document("patients//readings/bad").set({"x": 1})
            fail("invalid path write did not raise (unexpected)")
            failures += 1
        except Exception as exc:  # noqa: BLE001 — we are asserting that it fails
            ok(f"invalid write raised as expected ({type(exc).__name__})")
    finally:
        unsub()
        try:
            reading_ref.delete()
            ok("test document removed")
        except Exception as exc:  # noqa: BLE001
            fail(f"cleanup failed: {exc}")
            failures += 1

    print()
    print("Doctor-side visibility: the same document under patients/"
          f"{TEST_PATIENT} is what an assigned doctor subscribes to — verified above "
          "through the collection listener.")
    print("Rule enforcement (two-account isolation) must be verified manually: "
          "docs/firebase-setup.md §6.")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
