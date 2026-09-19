# NeuroTriage-Home — hackathon starter

Scoped build per our planning: facial asymmetry (MediaPipe) + voice
fluency/latency (ElevenLabs Conversational AI) → weighted risk score →
clinician dashboard. Hand tremor and real FHIR integration are cut —
see comments in `backend/anomaly_scoring.py` for why.

## Quick start

### Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate   # or use your usual env setup
pip install -r requirements.txt
python app.py
# serves on http://localhost:5001
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# serves on http://localhost:5173, proxies /api to :5001
```

## Before you demo — things to actually finish

1. **ElevenLabs agent**: create a Conversational AI agent in the
   ElevenLabs dashboard, write your fluency/cognitive check-in prompts
   into its system prompt, and paste the agent ID into
   `frontend/src/CheckInFlow.jsx` (`ELEVENLABS_AGENT_ID`).
2. **Voice jitter**: currently stubbed with a random value in
   `CheckInFlow.jsx`. If you have time, run the recorded audio through
   `parselmouth` (Python wrapper for Praat) server-side and replace
   the stub — otherwise just be upfront in the demo that jitter is
   simulated for this prototype and describe how it'd be wired in.
3. **Baseline calibration**: `compute_risk_score` in
   `anomaly_scoring.py` compares against a fixed threshold on the
   first check-in and against the patient's own prior check-in after
   that. For the demo, seed 2-3 fake "past check-ins" with a gradually
   worsening trend so your dashboard graph tells a story.
4. **Clinician dashboard**: `ClinicianDashboard.jsx` isn't wired into
   routing yet — either add a simple toggle/route in `main.jsx`, or
   just swap which component you render when you want to show the
   clinician side during the demo.

## What's deliberately NOT built (say this out loud to judges)

- **Hand tremor detection** — cut for reliability; webcam-based tremor
  frequency analysis is noisy and wasn't worth the risk in 24 hours.
- **Real FHIR resource validation** — `build_fhir_shaped_observation()`
  produces FHIR-*shaped* JSON (right field names, right structure) but
  is not validated against the FHIR spec or wired to a real EHR. Pitch
  it as "designed for FHIR-compatible EHR integration."
- **Real auth** — the dashboard route takes a `clinician_id` query
  param instead of real login. Fine for a demo; say so.
- **Real immutable audit log** — `audit_log.py` is an in-memory list,
  not a tamper-proof store. Mention a production version would use an
  actual append-only log (e.g. AWS QLDB or a write-once log table).

## Privacy/HIPAA-principles boundary (matches the architecture slide)

- Frontend: raw webcam frame is captured, base64-encoded, sent once,
  and never written to disk client-side.
- Backend (`cv_analysis.py`): frame is decoded in memory, landmarks
  extracted, frame reference dropped. Nothing writes image bytes to
  disk.
- Backend (`app.py` / `anomaly_scoring.py`): only numeric metrics +
  a SHA-256 hash of the patient ID (`_hash_patient_id`) ever get
  stored in `PATIENT_HISTORY` or sent in the telemetry payload. The
  raw patient_id never leaves the `/api/checkin/*` request handlers.
- Consent screen is required before the camera/mic ever activates
  (`CheckInFlow.jsx`, `STEPS.CONSENT`).
