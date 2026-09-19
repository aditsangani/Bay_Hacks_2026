# NeuroTriage-Home — Bay Hacks 2026

Continuous at-home monitoring for post-stroke / neuromuscular recovery.
Combines facial asymmetry tracking (MediaPipe), experimental webcam estimates
of pulse and breathing, voice fluency check-ins (ElevenLabs Conversational AI),
and a weighted risk score surfaced to a
clinician dashboard — with a de-identified telemetry payload and
FHIR-shaped observation designed around HIPAA principles.

**Tracks:** Nucleate Florida Healthcare Challenge · Best Use of ElevenLabs

---

## Supabase and authentication setup

The app supports two modes:

- **Local demo mode:** runs immediately with built-in patient and clinician
  demo identities. No Supabase browser key is required, and history falls back
  to process memory when the backend database is also unconfigured.
- **Supabase mode:** uses real authentication, profiles, durable check-in
  history, and the clinician audit log. The backend and frontend use different
  API keys; never put the backend service-role key in the frontend.

Complete the steps below for real accounts and persistence. Skip to
[Quick start](#quick-start-macos--zsh) for a local demo.

1. Create a project at [supabase.com](https://supabase.com) (or use an
   existing one).
2. Open **SQL Editor → New query** in the Supabase dashboard, paste in
   the contents of [`database/schema.sql`](database/schema.sql), and
   run it. This creates two tables: `check_ins` and `audit_log`. Run the
   file again after pulling updates; its `add column if not exists` statements
   safely add the camera-estimate fields to an existing `check_ins` table.
   Until that migration is run, the backend remains compatible by storing
   camera estimates inside the existing `wellness` JSON column.
3. In **Project Settings → API**, copy the Project URL, the
   **`service_role` key**, and the **anon/public key**.
4. Configure the backend from the project root:

   ```zsh
   cp database/.env.example database/.env
   ```

   Put the Project URL and `service_role` key in `database/.env` as
   `SUPABASE_URL` and `SUPABASE_KEY`.
5. Configure the frontend:

   ```zsh
   cp frontend/.env.example frontend/.env
   ```

   Put the same Project URL and the **anon/public key** in `frontend/.env` as
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Both `.env` files are
   gitignored; never commit real credentials.

The backend (`backend/app.py`) automatically picks up `database/.env`
via `database/db.py`, regardless of which directory you run `python
app.py` from.

## Quick start (macOS / zsh)

Open Terminal and run:

```zsh
cd /path/to/Bay_Hacks_2026
cd backend
python3.12 -m venv venv-py312
source venv-py312/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
python app.py
```

Replace `/path/to/Bay_Hacks_2026` with the folder where you cloned or
downloaded this project. If your terminal is already open at the project
root (the folder containing `backend/` and `frontend/`), skip that `cd` line.

Leave the backend terminal running. It serves on `http://127.0.0.1:5001`.

Open a **second terminal** for the frontend:

```zsh
cd /path/to/Bay_Hacks_2026/frontend
npm install
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173` in your browser. Replace `/path/to/Bay_Hacks_2026`
with the same project folder used in the backend terminal.

Use Python 3.11 or 3.12 for the pinned MediaPipe dependency. This repository's
macOS setup has been verified with Python 3.12 on Apple silicon.

## Quick start (Windows / PowerShell)

Clone the repo, then `cd` into it. You should see `backend/` and
`frontend/` folders directly — if you don't, you're in the wrong
directory (see [Troubleshooting](#troubleshooting) below).

### 1. Database (Supabase)

For local demo mode, copy `backend/.env.example` to `backend/.env`; this enables
only the two fixed demo identities. For real accounts and durable history,
complete [Supabase setup](#supabase-and-authentication-setup) instead.

### 2. Backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python app.py
```

Leave this running. It serves on `http://localhost:5001`.

**If `python -m venv venv` uses the wrong Python version:** use Python
3.11 or 3.12 for the pinned dependencies. Check your version with
`python --version` after activating. If needed, delete the venv and
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

### 3. Frontend

Open a **second terminal** (leave the backend running in the first):

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

**You need Node.js installed** for this — check with `node --version`.
If missing, install from nodejs.org.

## App views

In local demo mode, use the **Check-In** and **Clinician** tabs to switch
between the fixed demo identities. With real authentication, patients see the
Check-In route and clinicians see the Clinician Dashboard route; role-protected
routes prevent one role from opening the other role's view. A sun/moon button
switches themes. Navigating away from a check-in resets its progress and stops
the camera.

The check-in flow itself: consent → an adaptive sleep, symptoms, and mood
questionnaire → camera measurement → voice prompts → result. The camera view
shows live facial landmarks, samples forehead and cheek regions locally for 30 seconds,
estimates pulse and breathing using windowed rPPG, and finishes with a 3-frame
facial asymmetry capture. A dedicated review screen holds the results until the
patient chooses Continue or Retake. Raw camera frames are discarded. Pulse and
breathing are shown as experimental wellness estimates and remain separate
from the neurological signal risk score.

---

## ElevenLabs setup (required for the voice check-in step)

1. Sign in at [elevenlabs.io](https://elevenlabs.io) and redeem any
   hackathon credit code under **Settings → Subscription**, not just
   the general sign-up link — the credits don't apply automatically
   just by visiting the site from a redemption link.
2. In the sidebar, click **Create agent → Blank Agent**.
3. Follow [`docs/elevenlabs-agent-prompt.md`](docs/elevenlabs-agent-prompt.md).
   Configure the adaptive system prompt and broad first message in the agent
   dashboard. The app sends no conversation overrides, so the default
   ElevenLabs security settings can remain unchanged.
4. Pick a voice, save the agent.
5. Get the **Agent ID** from the agent's page URL — it's the segment
   that looks like `agent_xxxxxxxxxxxxxxxxxxxxxxxxx`.
6. Open `frontend/src/CheckInFlow.jsx` and replace:
   ```js
   const ELEVENLABS_AGENT_ID = 'agent_1201m2wz6ap4e3yrmdy4cfbgn5pm'
   ```
   with your agent ID if you are using a different agent. Save — Vite
   hot-reloads automatically.

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

### `RuntimeError: SUPABASE_URL and SUPABASE_KEY must be set`
You skipped [Supabase setup](#supabase-and-authentication-setup), or
`database/.env` doesn't exist / isn't filled in yet. Copy
`database/.env.example` to `database/.env` and fill in your Supabase
project's URL and service_role key, then restart `python app.py`.

### The page says `Supabase setup required`
This appears in a production build when `frontend/.env` is missing or still
contains example values. Copy
`frontend/.env.example` to `frontend/.env`, fill in the Project URL and
**anon/public** key, then stop and restart `npm run dev`. Do not use the
service-role key in this file. During `npm run dev`, missing frontend values
activate local demo mode instead.

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
- **Production account provisioning** — Supabase login and role-protected API
  routes are implemented, but this hackathon flow lets a new user select the
  patient or clinician role at signup. A production deployment must provision
  clinician roles through an administrator or invitation workflow.
- **Real immutable audit log** — `database/audit_log.py` now persists
  to a real Postgres table via Supabase (survives restarts), but
  nothing enforces true append-only/tamper-proof semantics — there's
  just no update/delete code path. A production version would use an
  actual write-once store (e.g. AWS QLDB).

## Privacy / HIPAA-principles boundary

- Raw webcam frames are processed in memory and never written to disk,
  client-side or server-side, or to Supabase.
- Only numeric derived metrics ever get stored (in Supabase's
  `check_ins` table — see `database/patient_history.py`). The raw
  patient_id is stored there too (needed to query a patient's own
  trend), but only a SHA-256 hash of it ever leaves the
  `/api/checkin/*` handlers in telemetry payloads — see
  `_hash_patient_id()` in `backend/anomaly_scoring.py`.
- Consent screen is required before the camera/mic ever activates
  (`frontend/src/CheckInFlow.jsx`, `STEPS.CONSENT`).
