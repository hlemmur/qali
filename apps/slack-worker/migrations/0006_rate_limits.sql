CREATE TABLE rate_limit_events (
  event_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX rate_limit_window_idx
  ON rate_limit_events(scope, subject_hash, occurred_at);
