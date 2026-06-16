import json
import os
from pathlib import Path

# Path relative to the current file (src/utils/config.py)
# Assuming project root is two levels up
CONFIG_PATH = Path(__file__).parent.parent.parent / "data" / "config" / "settings.json"

DEFAULT_SETTINGS = {
    "lexicon_threshold": 0.10,
    "ml_threshold": 0.55,
    "hybrid_threshold": 0.40,
    "merger_threshold": 0.40,
    "labeller_threshold": 0.40
}

def load_settings():
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                settings = json.load(f)
                return settings
        except Exception as e:
            print(f"Error loading settings from {CONFIG_PATH}: {e}")
    return DEFAULT_SETTINGS.copy()

def get_threshold(key, default=None):
    settings = load_settings()
    if default is None:
        default = DEFAULT_SETTINGS.get(key, 0.40)
    return settings.get(key, default)
