-- Schéma D1 de la veille. Idempotent : peut être rejoué sans perte.
CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  category TEXT NOT NULL,
  patch TEXT NOT NULL,                       -- JSON des champs proposés
  summary TEXT NOT NULL,
  evidence TEXT,
  source_url TEXT,
  checked_at TEXT NOT NULL,                  -- date de vérification du fait (ISO 8601)
  origin TEXT NOT NULL,                      -- import | correction
  state TEXT NOT NULL DEFAULT 'en_attente',  -- en_attente | publie | rejete
  dedupe_key TEXT NOT NULL,                  -- empreinte épreuve + contenu
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decision_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_changes_state ON changes (state, decided_at);
-- Faux doublons : une même proposition ne peut être en attente qu'une fois.
-- (Un changement déjà publié et identique à l'état courant est écarté comme « sans effet ».)
CREATE UNIQUE INDEX IF NOT EXISTS idx_changes_pending ON changes (dedupe_key) WHERE state = 'en_attente';

CREATE TABLE IF NOT EXISTS event_overrides (
  event_id TEXT PRIMARY KEY,
  patch TEXT NOT NULL,                       -- JSON fusionné des changements publiés
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  change_id INTEGER NOT NULL REFERENCES changes (id),
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS check_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  trigger_kind TEXT NOT NULL,                -- planifie | manuel
  links_checked INTEGER NOT NULL DEFAULT 0,
  links_failed INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'en_cours',    -- en_cours | termine | erreur
  note TEXT
);

CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER,
  event_id TEXT,
  url TEXT,
  message TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  occurred_at TEXT NOT NULL
);
