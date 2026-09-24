-- Vérification automatique des virements sortants propriétaires (audit 06-07/09/2026,
-- cf. mémoire "exportSCT.js virement brut + audit reversements 2026").
--
-- Remplace la persistance localStorage (`dcb_ctrl_vir_${mois}` dans PageFactures.jsx) du bloc
-- "Contrôle virements propriétaires" : cette table est la nouvelle source de vérité, alimentée
-- automatiquement par l'Edge Function verify-virements-sortants (matching strict, puis Opus en
-- filet de sécurité sur les cas ambigus) et par les choix manuels d'Oïhan dans l'UI.
--
-- `cle` référence soit facture_evoliz.id (honoraires), soit 'com-<facture_evoliz.id>' pour la
-- facture COM (même convention que le localStorage qu'elle remplace) — pas de FK directe sur
-- facture_evoliz pour rester compatible avec les deux formes de clé.
--
-- Rappel terminologie (docs/domain-rules.md §17) : ceci vérifie que VIRProprio (montant facturé,
-- facture_evoliz.montant_reversement) correspond bien au débit bancaire réel constaté côté
-- séquestre — un contrôle symétrique du VIRPayinProuvé (entrant), qui n'avait pas d'équivalent
-- sortant avant cette migration.

CREATE TABLE IF NOT EXISTS public.virement_sortant_controle (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agence                  text        NOT NULL,
  mois                    text        NOT NULL, -- YYYY-MM, mois comptable de la facture
  cle                     text        NOT NULL, -- facture_evoliz.id ou 'com-<id>'
  mouvement_bancaire_id   uuid        REFERENCES public.mouvement_bancaire(id),
  lien_manuel             boolean     NOT NULL DEFAULT false, -- true = choisi explicitement par Oïhan, jamais réécrit par l'auto/Opus
  explicitement_non_lie   boolean     NOT NULL DEFAULT false, -- Oïhan a choisi "— non lié" (équivalent du sentinel 'none' du localStorage)
  ecart_cts               integer,    -- attendu (montant_reversement / total_ttc) − mouvement_bancaire.debit ; NULL si non lié
  match_source            text        CHECK (match_source IN ('auto', 'opus', 'manuel')),
  match_confiance         text        CHECK (match_confiance IN ('certain', 'incertain')),
  match_raison            text,       -- justification Opus (audit/tooltip), NULL pour auto/manuel
  commentaire             text,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agence, mois, cle)
);

CREATE INDEX IF NOT EXISTS virement_sortant_controle_agence_mois_idx
  ON public.virement_sortant_controle (agence, mois);

ALTER TABLE public.virement_sortant_controle ENABLE ROW LEVEL SECURITY;
CREATE POLICY "virement_sortant_controle_open" ON public.virement_sortant_controle FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.virement_sortant_controle IS
  'Rapprochement facture propriétaire (honoraires/COM) <-> mouvement bancaire sortant réel (débit séquestre, alimenté par Pennylane). Remplace la persistance localStorage du bloc "Contrôle virements propriétaires" de PageFactures.jsx. Alimentée par verify-virements-sortants (matching strict puis Opus sur cas ambigus) et par les choix manuels d''Oïhan — un lien_manuel=true n''est jamais réécrit par le matching automatique.';

COMMENT ON COLUMN public.virement_sortant_controle.ecart_cts IS
  'attendu - débit réel, en centimes. 0 = virement conforme. Piloté le badge "Virement" dans PageFactures.jsx (symétrique du badge "Tréso" côté entrant).';
