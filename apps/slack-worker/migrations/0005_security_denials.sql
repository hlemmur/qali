CREATE TABLE security_denials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  request_kind TEXT NOT NULL
);

CREATE INDEX security_denials_occurred_at_idx ON security_denials(occurred_at);
