# NeuroTriage-Home — Bay Hacks 2026

Continuous at-home monitoring for post-stroke / neuromuscular recovery.
Combines facial asymmetry tracking (MediaPipe), voice fluency check-ins
(ElevenLabs Conversational AI), and a weighted risk score surfaced to a
clinician dashboard — with a de-identified telemetry payload and
FHIR-shaped observation designed around HIPAA principles.

**Tracks:** Nucleate Florida Healthcare Challenge · Best Use of ElevenLabs

---

## Quick start (Windows / PowerShell)

Clone the repo, then `cd` into it. You should see `backend/` and
`frontend/` folders directly — if you don't, you're in the wrong
directory (see [Troubleshooting](#troubleshooting) below).

### 1. Backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Leave this running. It serves on `http://localhost:5001`.

**If `python -m venv venv` uses the wrong Python version:** MediaPipe
only supports Python 3.9–3.11 (not 3.12+). Check your version with
`python --version` after activating. If it's wrong, delete the venv and
recreate it pointing at a specific install:

```powershell
deactivate
Remove-Item -Recurse -Force venv
& "C:\Path\To\Python311\python.exe" -m venv venv
.\venv\Scripts\Activate.ps1
python --version   # confirm it says 3.11.x
pip install -r requirements.txt
```

Find your installed Python versions under
`C:\Users\<you>\AppData\Local\Programs\Python\` if you're not sure of
the exact path.

**If `.\venv\Scripts\Activate.ps1` fails** with a script-execution
error, run this once, then retry activation:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**If `python` isn't recognized**, try `py` instead (`py -m venv venv`).

**MediaPipe install takes a while** — it pulls in numpy, opencv,
protobuf, jax, and other heavy dependencies. If the terminal looks
"stuck" but no error has appeared, it's still unpacking/installing.
Give it a couple of minutes before assuming something's wrong.

### 2. Frontend

Open a **second terminal** (leave the backend running in the first):

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

**You need Node.js installed** for this — check with `node --version`.
If missing, install from nodejs.org.

---

## ElevenLabs setup (required for the voice check-in step)

1. Sign in at [elevenlabs.io](https://elevenlabs.io) and redeem any
   hackathon credit code under **Settings → Subscription**, not just
   the general sign-up link — the credits don't apply automatically
   just by visiting the site from a redemption link.
2. In the sidebar, click **Create agent → Blank Agent**.
3. Set the **System Prompt** and **First Message** (see
   `docs/elevenlabs-agent-prompt.md` if present, or ask a teammate who
   already has this saved).
4. Pick a voice, save the agent.
5. Get the **Agent ID** from the agent's page URL — it's the segment
   that looks like `agent_xxxxxxxxxxxxxxxxxxxxxxxxx`.
6. Open `frontend/src/CheckInFlow.jsx` and replace:
   ```js
   const ELEVENLABS_AGENT_ID = 'REPLACE_WITH_YOUR_AGENT_ID'
   ```
   with your real agent ID. Save — Vite hot-reloads automatically.

If you see an orange warning on the voice step instead of the widget,
the agent ID hasn't been set yet.

---

## Troubleshooting

### "Cannot find path ...\backend"
You're not in the project root. Run `Get-ChildItem` (PowerShell's
`ls`) to see what's actually in your current folder. If you see a
zip file instead of extracted folders, extract it first. If you see
a duplicate nested folder (e.g. `neurotriage-starter\neurotriage-starter`),
`cd` into the inner one.

### Vite shows a 404 / blank page at localhost:5173
Vite expects `index.html` at the **frontend project root**
(`frontend/index.html`), not inside `frontend/public/`. If you get a
404, check where `index.html` actually lives and move it:
```powershell
Move-Item public\index.html index.html
```

### `ModuleNotFoundError: No module named 'flask'`
Your venv isn't activated, or you activated a venv in the wrong
folder. Confirm your terminal prompt shows `(venv)` at the start, and
that you're running `python app.py` from inside `backend/` with that
same venv active.

### `git push` rejected — "fetch first" or "non-fast-forward"
Someone else (or GitHub itself, if it auto-created a README) has
commits you don't have locally. Pull and merge first:
```powershell
git pull origin main --allow-unrelated-histories --no-edit
git push -u origin main
```
If this creates a merge conflict (commonly in `README.md`), open the
conflicting file, keep the version you want (VS Code shows "Accept
Current Change" / "Accept Incoming Change" buttons above each
conflict), save, then:
```powershell
git add <file>
git commit -m "Merge conflict resolution"
git push
```

### Backend terminal shows TensorFlow/protobuf warnings
Lines like `Created TensorFlow Lite XNNPACK delegate` or
`SymbolDatabase.GetPrototype() is deprecated` are normal MediaPipe/
protobuf noise, not errors. As long as you see `Running on
http://127.0.0.1:5001` and no traceback, the server is fine.

### `response_latency_ms` looks huge (100,000+)
This field currently measures total conversation length (start of
voice step to clicking "I've finished the conversation"), not true
per-response latency — it will always look elevated on a real
conversation. Known limitation; see `backend/anomaly_scoring.py` for
the threshold and adjust or relabel before relying on that flag in a
demo.

---

## What's deliberately not built

- **Hand tremor detection** — webcam-based tremor frequency analysis
  is noisy and wasn't reliable enough to build under a 24-hour
  deadline. Facial asymmetry + voice fluency are the two real signals.
- **Real FHIR validation** — `build_fhir_shaped_observation()` in
  `backend/anomaly_scoring.py` produces FHIR-*shaped* JSON (correct
  field names/structure) but isn't validated against the FHIR spec or
  wired to a real EHR.
- **Real auth** — the dashboard route takes a `clinician_id` query
  param instead of a login system.
- **Real immutable audit log** — `backend/audit_log.py` is an
  in-memory list, not a tamper-proof store. A production version would
  use an actual append-only log (e.g. AWS QLDB).

## Privacy / HIPAA-principles boundary

- Raw webcam frames are processed in memory and never written to disk,
  client-side or server-side.
- Only numeric derived metrics + a SHA-256 hash of the patient ID ever
  leave the `/api/checkin/*` handlers or get stored — see
  `_hash_patient_id()` in `backend/anomaly_scoring.py`.
- Consent screen is required before the camera/mic ever activates
  (`frontend/src/CheckInFlow.jsx`, `STEPS.CONSENT`).
