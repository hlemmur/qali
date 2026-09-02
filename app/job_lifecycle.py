from enum import StrEnum


class JobRetryReason(StrEnum):
    PROCESSOR_ERROR = "processor_error"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"


__all__ = ["JobRetryReason"]
