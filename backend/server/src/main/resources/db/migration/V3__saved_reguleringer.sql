CREATE TABLE reguleringer (
  id          SERIAL PRIMARY KEY,
  base_id     VARCHAR(48) NOT NULL UNIQUE,
  navn        TEXT NOT NULL,
  dato        DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE regulering_lister (
  regulering_id INTEGER NOT NULL REFERENCES reguleringer(id) ON DELETE CASCADE,
  list_id       INTEGER NOT NULL REFERENCES lists(id) ON DELETE RESTRICT,
  PRIMARY KEY (regulering_id, list_id)
);

CREATE TABLE regulering_testkjoringer (
  id               BIGSERIAL PRIMARY KEY,
  regulering_id    INTEGER NOT NULL REFERENCES reguleringer(id) ON DELETE RESTRICT,
  external_id      VARCHAR(64) NOT NULL UNIQUE,
  status           TEXT NOT NULL,
  source_snapshot  JSONB NOT NULL,
  payload           TEXT NOT NULL,
  send_status       INTEGER,
  send_message      TEXT,
  start_status      INTEGER,
  start_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT regulering_test_status CHECK (status IN (
    'prepared', 'sent', 'send_rejected', 'send_unknown',
    'start_rejected', 'start_unknown', 'start_accepted'
  ))
);

CREATE INDEX regulering_lister_list_id_idx ON regulering_lister(list_id);
CREATE INDEX regulering_test_regulering_id_idx
  ON regulering_testkjoringer(regulering_id, created_at DESC);
