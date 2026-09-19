# NeuroTriage-Home — Bay Hacks 2026

Continuous at-home monitoring for post-stroke / neuromuscular recovery.
Combines facial asymmetry tracking (MediaPipe), voice fluency check-ins
(ElevenLabs Conversational AI), and a weighted risk score surfaced to a
clinician dashboard — with a de-identified telemetry payload and
FHIR-shaped observation designed around HIPAA principles.

**Tracks:** Nucleate Florida Healthcare Challenge · Best Use of ElevenLabs

---

## Database setup (Supabase)

Check-in history and the clinician audit log are persisted in
[Supabase](https://supabase.com) — a hosted Postgres instance — instead
of the in-memory dict/list this started as, so a check-in's trend
survives restarting the backend.

1. Create a project at [supabase.com](https://supabase.com) (or use an
   existing one).
2. Open **SQL Editor → New query** in the Supabase dashboard, paste in
   the contents of [`database/schema.sql`](database/schema.sql), and
   run it. This creates two tables: `check_ins` and `audit_log`.
3. In the dashboard, go to **Project Settings → API** and copy the
   **Project URL** and the **`service_role` key** (not the `anon` key
   — this backend needs to read/write freely without fighting
   row-level-security policies, and the service_role key is only ever
   used server-side, never sent to the frontend).
4. From the project root:
   ```powershell
   cd database
   copy .env.example .env      # macOS/Linux: cp .env.example .env
   ```
   Open `database/.env` and fill in `SUPABASE_URL` and `SUPABASE_KEY`
   with the values from step 3. This file is gitignored — never commit
   real credentials.

The backend (`backend/app.py`) automatically picks up `database/.env`
via `database/db.py`, regardless of which directory you run `python
app.py` from.

## Quick start (macOS / zsh)

Set up the [database](#database-setup-supabase) first, then open
Terminal and run:

```zsh
cd /path/to/Bay_Hacks_2026
cd backend
rm -rf venv
python3.11 -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
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

Python 3.11 is required because the pinned MediaPipe dependency does not
support Python 3.12 or newer.

## Quick start (Windows / PowerShell)

Clone the repo, then `cd` into it. You should see `backend/` and
`frontend/` folders directly — if you don't, you're in the wrong
directory (see [Troubleshooting](#troubleshooting) below).

### 1. Database (Supabase)

Check-in history and the clinician audit log are persisted in Supabase
(see [Database setup](#database-setup-supabase) below) — set this up
**before** starting the backend, or `/api/checkin/submit` and
`/api/dashboard/:patient` will fail with a missing-env-var error.

### 2. Backend

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

Use the **Check-In** and **Clinician** tabs in the top nav to switch
views (these are real routes — `/` and `/dashboard` — not just a
toggle). A sun/moon button next to the tabs switches between light and
dark theme, saved in the browser. Navigating away from a check-in
resets its progress and stops the camera; returning to the check-in
view starts at the consent screen.

The check-in flow itself: consent → face capture (a live ring/message
gives positioning feedback via `/api/checkin/face/preview` before you
capture a 3-frame burst) → voice prompts → an adaptive wellness
questionnaire (follow-up questions appear based on your answers, via
`/api/checkin/wellness/plan`) → result.

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

### `RuntimeError: SUPABASE_URL and SUPABASE_KEY must be set`
You skipped [Database setup](#database-setup-supabase), or
`database/.env` doesn't exist / isn't filled in yet. Copy
`database/.env.example` to `database/.env` and fill in your Supabase
project's URL and service_role key, then restart `python app.py`.

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
