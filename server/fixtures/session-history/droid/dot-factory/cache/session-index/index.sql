CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  cwd TEXT,
  title TEXT,
  tags BLOB NOT NULL DEFAULT (jsonb('{}')),
  archived_at TEXT,
  first_event_at INTEGER,
  last_event_at INTEGER
);
INSERT INTO sessions (session_id, project_key, cwd, title, first_event_at, last_event_at) VALUES
  ('00000000-0000-4000-8000-000000000001', :folder, :cwd, 'Fixture droid title 1', 1790845200000, 1790848800000),
  ('00000000-0000-4000-8000-000000000002', :folder, :cwd, 'Fixture droid title 2', 1790931600000, 1790935200000),
  ('00000000-0000-4000-8000-000000000003', :folder, '/elsewhere', 'Fixture droid elsewhere', 1791018000000, 1791021600000);
INSERT INTO sessions (session_id, project_key, cwd, title, tags, first_event_at, last_event_at) VALUES
  ('00000000-0000-4000-8000-000000000004', :folder, :cwd, 'Fixture droid exec', jsonb('{"exec":1}'), 1791020000000, 1791030000000);
