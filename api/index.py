"""Vercel entry point. The Python runtime serves the WSGI callable named `app`.

The Django project lives in `backend/`, which `vercel.json` ships with the function. Putting it on
`sys.path` here keeps `config` and `apps` importable the same way they are under `manage.py`.
"""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from config.wsgi import application as app  # noqa: E402

__all__ = ["app"]
