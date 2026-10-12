-- Baseline schema. Databases created before Flyway was introduced already have these
-- tables; baselineOnMigrate marks them as version 1 and skips this file. IF NOT EXISTS
-- keeps it harmless if it ever runs against one anyway. Later migrations are plain DDL.

CREATE TABLE IF NOT EXISTS lists (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data       JSONB NOT NULL
);

-- Read-through cache of raw upstream geodata payloads (Geonorge/Kartverket), keyed by
-- query. Body is stored as text (JSON or GML); the frontend parses it.
CREATE TABLE IF NOT EXISTS geo_cache (
  cache_key    TEXT PRIMARY KEY,
  body         TEXT NOT NULL,
  content_type TEXT NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
