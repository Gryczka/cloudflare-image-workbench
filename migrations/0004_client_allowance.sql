-- Per-client daily allowances. Clients are salted hashes, and both tables are purged daily.
CREATE TABLE IF NOT EXISTS client_salts (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_usage (
  kind TEXT NOT NULL CHECK (kind IN ('upload', 'creative')),
  client TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (kind, client, day)
);
