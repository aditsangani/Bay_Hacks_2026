"""
Shared Supabase client, used by the Flask backend (see ../backend/app.py).

Requires SUPABASE_URL and SUPABASE_KEY in database/.env (see
database/.env.example). Use the project's **service_role** key here,
not the anon key — this file is only ever imported server-side, and
the service_role key is what lets the backend read/write freely
without fighting Postgres row-level-security policies. Never send
this key to the frontend.
"""

import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

# Load database/.env explicitly (by path, not CWD) so this works
# regardless of which directory the Flask app is started from.
load_dotenv(Path(__file__).resolve().parent / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

_client: Client | None = None


def is_configured() -> bool:
    """Whether durable Supabase persistence is configured for this process."""
    return bool(SUPABASE_URL and SUPABASE_KEY)


def get_client() -> Client:
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_KEY must be set in database/.env "
                "(copy database/.env.example and fill in your project's values)"
            )
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client
