CREATE TABLE inbound_deduplication (
  identity TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

CREATE TABLE correlations (
  request_id TEXT PRIMARY KEY,
  workflow_id TEXT,
  run_id TEXT UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  team_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  request_ts TEXT NOT NULL,
  response_ts TEXT
);

CREATE INDEX correlations_run_id_idx ON correlations(run_id);
