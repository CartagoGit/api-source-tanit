CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL,
  active_snapshot_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('building', 'complete', 'failed')),
  revision INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  digest TEXT,
  metadata_json TEXT,
  failure TEXT,
  UNIQUE (project_id, revision)
);

CREATE TABLE IF NOT EXISTS services (
  service_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, service_id)
);

CREATE TABLE IF NOT EXISTS operations (
  operation_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  server_ref TEXT,
  auth_ref TEXT,
  schema_id TEXT,
  PRIMARY KEY (snapshot_id, operation_id),
  FOREIGN KEY (snapshot_id, service_id) REFERENCES services(snapshot_id, service_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS servers (
  server_ref TEXT NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  metadata_json TEXT,
  PRIMARY KEY (snapshot_id, server_ref)
);

CREATE TABLE IF NOT EXISTS auth_profiles (
  auth_ref TEXT NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  scheme TEXT NOT NULL,
  metadata_json TEXT,
  PRIMARY KEY (snapshot_id, auth_ref)
);

CREATE TABLE IF NOT EXISTS schemas (
  schema_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  media_type TEXT,
  schema_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, schema_id)
);

CREATE TABLE IF NOT EXISTS diagnostics (
  diagnostic_id INTEGER PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error'))
);

CREATE TABLE IF NOT EXISTS provenance (
  provenance_id INTEGER PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS source_files (
  source_file_id INTEGER PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  metadata_json TEXT,
  UNIQUE (snapshot_id, path)
);

