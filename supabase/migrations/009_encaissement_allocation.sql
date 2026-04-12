-- Migration 009 : Table de vérité des encaissements alloués
-- Source persistée par réservation/bien/mois — remplace les calculs à la volée
-- Règle absolue : aucun fin_revenue ne compte comme preuve. Aucun fallback silencieux.

-- ============================================================
-- TABLE PRINCIPALE : encaissement_allocation
-- ============================================================

CREATE TABLE IF NOT EXISTS encaissement_allocation (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Clés métier
  reservation_id            UUID        NOT NULL REFERENCES reservation(id),
  bien_id                   UUID        NOT NULL REFERENCES bien(id),
  mois_comptable            TEXT        NOT NULL,  -- YYYY-MM (mois comptable de la résa, PAS du virement)

  -- Lien bancaire (NULL = aucune preuve bancaire directe)
  mouvement_bancaire_id     UUID        REFERENCES mouvement_bancaire(id),

  -- Montant alloué (centimes, toujours positif)
  montant_alloue            INTEGER     NOT NULL CHECK (montant_alloue > 0),

  -- Qualité de la preuve
  -- 'prouve'    : mouvement_bancaire tracé + rapproché (mouvement_id non null, credit non null)
  -- 'approxime' : payout.amount sans lien bancaire direct (BGH-style) — jamais safe pour reversement
  preuve_niveau             TEXT        NOT NULL
                            CHECK (preuve_niveau IN ('prouve', 'approxime')),

  -- Hiérarchie stricte : exact > proportional > manual
  -- 'exact'        : 1 payout → 1 réservation, ou reservation_paiement direct
  -- 'proportional' : 1 payout → N réservations, split par fin_revenue (dernier recours)
  -- 'manual'       : correction manuelle par Oihan
  mode_allocation           TEXT        NOT NULL
                            CHECK (mode_allocation IN ('exact', 'proportional', 'manual')),

  -- Obligatoire si mode_allocation = 'proportional' : explique pourquoi on n'a pas pu faire exact
  proportional_reason       TEXT,

  -- Groupe : toutes les allocations issues du même payout ou du même mouvement direct
  -- ex: 'payout:{payout_hospitable.id}', 'direct:mb:{mouvement_bancaire.id}'
  allocation_group_key      TEXT,

  -- Verrou de sécurité : false si preuve_niveau = 'approxime' (jamais safe)
  -- Une facture n'est safe que si TOUTES ses allocations ont can_be_used_for_reversement = true
  can_be_used_for_reversement BOOLEAN   NOT NULL DEFAULT false,

  -- Origine de la preuve
  source_type               TEXT        NOT NULL
                            CHECK (source_type IN ('payout_hospitable', 'reservation_paiement', 'manual')),
  source_ref                TEXT,       -- ID de l'objet source (payout_hospitable.id, reservation_paiement.id)

  -- Identifiant unique de ligne source — clé d'idempotence pour UPSERT
  -- Format : 'ph:{ph_id}:r:{resa_id}' | 'rp:{rp_id}' | 'manual:{uuid}'
  source_line_id            TEXT        NOT NULL,

  -- Contexte lisible
  justification             TEXT,

  -- Contexte payout (pour vérification du split)
  payout_total              INTEGER,    -- montant brut du payout (centimes)
  payout_resa_count         INTEGER,    -- nb total de réservations dans le payout

  -- Audit
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now(),
  computed_by               TEXT        NOT NULL DEFAULT 'auto'  -- 'auto' | 'manual'
);

-- Contrainte d'unicité sur source_line_id (permet UPSERT idempotent)
-- Les lignes manuelles (computed_by='manual') ne sont jamais écrasées par l'auto
CREATE UNIQUE INDEX IF NOT EXISTS encaissement_allocation_source_line_id_key
  ON encaissement_allocation (source_line_id)
  WHERE computed_by != 'manual';

-- Index de lecture
CREATE INDEX IF NOT EXISTS idx_encaiss_alloc_mois_bien
  ON encaissement_allocation (mois_comptable, bien_id);

CREATE INDEX IF NOT EXISTS idx_encaiss_alloc_reservation
  ON encaissement_allocation (reservation_id);

CREATE INDEX IF NOT EXISTS idx_encaiss_alloc_mouvement
  ON encaissement_allocation (mouvement_bancaire_id)
  WHERE mouvement_bancaire_id IS NOT NULL;


-- ============================================================
-- TABLE ANOMALIES : encaissement_anomalie
-- ============================================================

CREATE TABLE IF NOT EXISTS encaissement_anomalie (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  reservation_id    UUID        NOT NULL REFERENCES reservation(id),
  bien_id           UUID        NOT NULL REFERENCES bien(id),
  mois_comptable    TEXT        NOT NULL,

  -- Codes d'anomalie
  -- PAYOUT_MISSING              : aucun payout_reservation pour cette résa Airbnb/Booking
  -- PAYOUT_HOSPITABLE_MISSING   : payout_reservation trouvé mais payout_hospitable absent
  -- PAYOUT_SANS_MONTANT         : payout_hospitable sans mouvement_id ni amount
  -- MOUVEMENT_ID_NULL           : mouvement_id null — encaissement approximé (BGH-style)
  -- MOUVEMENT_NON_RAPPROCHE     : mouvement_id renseigné mais non rapproché
  -- RESERVATION_PAIEMENT_MISSING: réservation directe sans aucun paiement enregistré
  -- RESERVATION_PAIEMENT_NOT_LINKED : paiement enregistré mais non rattaché à un mouvement bancaire
  code_anomalie     TEXT        NOT NULL,

  description       TEXT        NOT NULL,
  contexte          JSONB,

  -- Résolution
  resolu            BOOLEAN     NOT NULL DEFAULT false,
  resolu_at         TIMESTAMPTZ,
  resolu_note       TEXT,

  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Unicité : une anomalie donnée ne peut exister qu'une fois par réservation (non résolue)
-- L'upsert sur ce couple permet de mettre à jour la description sans créer de doublon
CREATE UNIQUE INDEX IF NOT EXISTS encaissement_anomalie_resa_code_key
  ON encaissement_anomalie (reservation_id, code_anomalie);

CREATE INDEX IF NOT EXISTS idx_encaiss_anomalie_mois_bien
  ON encaissement_anomalie (mois_comptable, bien_id);

CREATE INDEX IF NOT EXISTS idx_encaiss_anomalie_non_resolu
  ON encaissement_anomalie (mois_comptable, resolu)
  WHERE resolu = false;
