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

-- Veille automatique (scripts/veille-auto.ts) : dernier état connu de chaque page surveillée.
CREATE TABLE IF NOT EXISTS watch_snapshots (
  url TEXT PRIMARY KEY,
  hash TEXT,                                 -- empreinte des passages utiles (inscriptions, 2027, complet…)
  snippets TEXT NOT NULL DEFAULT '[]',       -- JSON : passages relevés lors de la dernière lecture réussie
  http_status INTEGER,
  failures INTEGER NOT NULL DEFAULT 0,       -- échecs consécutifs de lecture
  fetched_at TEXT NOT NULL
);

-- Signaux à examiner par un administrateur (aucun effet sur les données publiées).
CREATE TABLE IF NOT EXISTS watch_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT,
  kind TEXT NOT NULL,                        -- date_differente | manifestation_non_suivie | formats_complets | page_modifiee | source_injoignable
  message TEXT NOT NULL,
  source_url TEXT,
  quote TEXT,
  state TEXT NOT NULL DEFAULT 'ouverte',     -- ouverte | traitee
  dedupe_key TEXT NOT NULL UNIQUE,           -- une alerte identique n'est jamais recréée, même après traitement
  created_at TEXT NOT NULL,
  closed_at TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_watch_alerts_state ON watch_alerts (state, id);

-- Signalements communautaires des inscriptions (migration additive : aucune table existante modifiée).
CREATE TABLE IF NOT EXISTS registration_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,                    -- identifiant d'une des 78 épreuves régionales
  type TEXT NOT NULL,                        -- inscriptions_ouvertes | complet | ouverture_annoncee
  format TEXT NOT NULL DEFAULT '',           -- format concerné (« complet » uniquement), sinon vide
  source_url TEXT NOT NULL,                  -- adresse normalisée fournie par le membre
  state TEXT NOT NULL DEFAULT 'en_attente',  -- en_attente | confirme | sans_effet | a_verifier | traite | rejete
  received_at TEXT NOT NULL,
  verified_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  reason TEXT,                               -- motif de la décision (texte court)
  evidence TEXT,                             -- passage de la page qui fonde la décision
  change_id INTEGER,                         -- changement publié (table changes) le cas échéant
  dedupe_key TEXT NOT NULL,                  -- empreinte épreuve + type + format + adresse
  client_hash TEXT                           -- empreinte salée et quotidienne de l'adresse IP (limitation de débit), effacée après 2 jours
);
CREATE INDEX IF NOT EXISTS idx_reports_state ON registration_reports (state, id);
CREATE INDEX IF NOT EXISTS idx_reports_dedupe ON registration_reports (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_reports_client ON registration_reports (client_hash, received_at);
