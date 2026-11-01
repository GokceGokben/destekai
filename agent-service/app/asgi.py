"""Uvicorn entry point. Kept apart from main.py so that importing it needs no environment."""

from app.main import create_app

app = create_app()
