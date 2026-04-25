CREATE TABLE IF NOT EXISTS seq_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT UNIQUE,
  timestamp TIMESTAMPTZ NOT NULL,
  message_template TEXT,
  message TEXT,
  level TEXT NOT NULL DEFAULT 'Information',
  trace_id TEXT,
  span_id TEXT,
  user_id TEXT,
  guid_cotacao TEXT,
  service TEXT,
  environment TEXT,
  request_path TEXT,
  source_context TEXT,
  raw_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seq_events_timestamp ON seq_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_seq_events_level ON seq_events(level);
CREATE INDEX IF NOT EXISTS idx_seq_events_guid_cotacao ON seq_events(guid_cotacao);
CREATE INDEX IF NOT EXISTS idx_seq_events_user_id ON seq_events(user_id);
CREATE INDEX IF NOT EXISTS idx_seq_events_service ON seq_events(service);
CREATE INDEX IF NOT EXISTS idx_seq_events_raw ON seq_events USING GIN(raw_data);
CREATE INDEX IF NOT EXISTS idx_seq_events_request_path ON seq_events(request_path);

CREATE TABLE IF NOT EXISTS sync_config (
  id SERIAL PRIMARY KEY,
  seq_url TEXT,
  api_key TEXT,
  signal TEXT,
  last_synced_at TIMESTAMPTZ,
  last_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
