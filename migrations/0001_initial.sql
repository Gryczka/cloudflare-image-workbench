CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  capability_hash TEXT NOT NULL,
  original_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'ready', 'partial', 'failed')),
  caption TEXT,
  alt_text TEXT,
  subject TEXT,
  focal_x REAL,
  focal_y REAL,
  focal_source TEXT NOT NULL DEFAULT 'none',
  outputs_json TEXT NOT NULL DEFAULT '[]',
  error_note TEXT,
  creative_status TEXT NOT NULL DEFAULT 'idle' CHECK (creative_status IN ('idle', 'queued', 'processing', 'ready', 'failed')),
  creative_key TEXT,
  creative_prompt TEXT
);

CREATE INDEX IF NOT EXISTS uploads_expires_at ON uploads (expires_at);

CREATE TABLE IF NOT EXISTS usage_counters (
  kind TEXT NOT NULL CHECK (kind IN ('upload', 'creative')),
  month TEXT NOT NULL,
  month_count INTEGER NOT NULL,
  day TEXT NOT NULL,
  day_count INTEGER NOT NULL,
  PRIMARY KEY (kind, month)
);

CREATE TABLE IF NOT EXISTS gallery (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  caption TEXT NOT NULL,
  alt_text TEXT NOT NULL,
  credit TEXT NOT NULL,
  approved_at INTEGER NOT NULL,
  outputs_json TEXT NOT NULL DEFAULT '[]',
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  has_creative INTEGER NOT NULL DEFAULT 0 CHECK (has_creative IN (0, 1))
);
