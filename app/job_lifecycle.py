from enum import StrEnum


class JobRetryReason(StrEnum):
    PROCESSOR_ERROR = "processor_error"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"


class JobFailureReason(StrEnum):
    RETRY_EXHAUSTED = "retry_exhausted"


__all__ = ["JobFailureReason", "JobRetryReason"]
