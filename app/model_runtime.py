from __future__ import annotations

from google.adk.models import Gemini
from google.genai import types

MODEL_ID = "gemini-3.7-flash"
MAX_OUTPUT_TOKENS = 4_096
RETRYABLE_HTTP_STATUS_CODES = (408, 500, 502, 503, 504)


def create_free_tier_gemini() -> Gemini:
    return Gemini(
        model=MODEL_ID,
        retry_options=types.HttpRetryOptions(
            attempts=3,
            initial_delay=1,
            max_delay=8,
            exp_base=2,
            jitter=0,
            http_status_codes=list(RETRYABLE_HTTP_STATUS_CODES),
        ),
    )


def bounded_generation_config() -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        temperature=0,
        max_output_tokens=MAX_OUTPUT_TOKENS,
    )


__all__ = [
    "MAX_OUTPUT_TOKENS",
    "MODEL_ID",
    "RETRYABLE_HTTP_STATUS_CODES",
    "bounded_generation_config",
    "create_free_tier_gemini",
]
