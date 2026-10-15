-- 432 — BGH (Grands Hommes) : configuration de couchage « 1 grand lit » (Oïhan 16/10/2026).
-- Les deux chambres sont identiques selon Oïhan → on fait la chambre verte (lit 160×200, draps King selon la fiche linge
-- de l'équipe : bien_lit.linge = 'King'). Sans supplément. Proposée seulement à ≤ 2 voyageurs (2 places : filtre places ≥ voyageurs)
-- et choisie par défaut à 1–2 voyageurs (couchage_pour / choisirCouchage : la plus petite qui couche tout le monde).
-- « 2 grands lits » garde +30 € si ≤ 2 voyageurs (431b) ; « 1 grand lit + 2 petits lits » inchangée.
insert into public.bien_couchage (bien_id, nom, lits, supplement_centimes, ordre, maj_par)
select b.id, '1 grand lit', jsonb_build_array(jsonb_build_object('lit_id', l.id, 'mode', 'normal')), 0, 0, 'migration 432'
  from public.bien b join public.bien_lit l on l.bien_id = b.id and l.actif and l.piece = 'Chambre verte' and l.largeur_cm = 160
 where b.code = 'BGH'
   and not exists (select 1 from public.bien_couchage c where c.bien_id = b.id and c.nom = '1 grand lit');
