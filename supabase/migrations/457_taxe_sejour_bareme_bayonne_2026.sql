-- 457 : barème OFFICIEL 2026 de la taxe de séjour — Bayonne (la COMMUNE perçoit : la délib. CAPB du 15/06/2024
-- exclut Anglet, Bayonne, Biarritz, Bidart, Cambo, Hendaye, cf. 451). 17/10/2026, vague 3 vente directe (LAGREOU).
-- Source : base DGFiP « Tarifs taxe de séjour - Delta » (data.economie.gouv.fr, dataset delta_deliberation_ts_tarif0),
-- commune 64102 BAYONNE, SIREN 216401026, date d'effet 2026, consultée le 17/10/2026 :
-- meublés 1★ 0,80 / 2★ 1,00 / 3★ 1,70 / 4★ 2,60 / 5★ 3,60 € HT ; palaces 4,90 € HT ; « hébergements sans classement
-- ou en attente de classement » 5 %. Plafond non classés = tarif palace 4,90 HT (art. L2333-30 CGCT, cf. 451).
-- Mêmes conventions que 036/451 : classés = tarif TTC (× 1,44 : 10 % département + 34 % région GPSO) ; non classés =
-- taux × prix HT nuitée/personne plafonné à plafond_ht puis × coeff_additionnel. Aucun seuil d'exonération publié
-- dans la base DGFiP 2026 pour Bayonne (non saisi).
insert into public.taxe_sejour_config (agence, commune, classification, type_calcul, taux_pct, plafond_ht, tarif_pers_nuit, coeff_additionnel, annee, notes)
select a.agence, x.commune, x.classification, x.type_calcul, x.taux_pct, x.plafond_ht, x.tarif_pers_nuit, 1.44, 2026, x.notes
from (values ('dcb')) a(agence)  -- barèmes communs à toutes les agences (ligne agence dcb, comme 451)
cross join (values
  ('Bayonne','non_classe','pourcentage',5::numeric,4.90::numeric,null::numeric,'Non classé / en attente : 5 % du prix HT de la nuitée par personne, plafond = palace 4,90 € HT (7,06 TTC). Base DGFiP Delta, commune 64102, date d''effet 2026 — consultée 17/10/2026.'),
  ('Bayonne','1_etoile','forfait',null,null,1.15,'1★ : 0,80 € HT (chambres d''hôtes 0,80). Base DGFiP Delta 2026 — consultée 17/10/2026'),
  ('Bayonne','2_etoiles','forfait',null,null,1.44,'2★ : 1,00 € HT. Base DGFiP Delta 2026 — consultée 17/10/2026'),
  ('Bayonne','3_etoiles','forfait',null,null,2.45,'3★ : 1,70 € HT. Base DGFiP Delta 2026 — consultée 17/10/2026'),
  ('Bayonne','4_etoiles','forfait',null,null,3.74,'4★ : 2,60 € HT. Base DGFiP Delta 2026 — consultée 17/10/2026'),
  ('Bayonne','5_etoiles','forfait',null,null,5.18,'5★ : 3,60 € HT. Base DGFiP Delta 2026 — consultée 17/10/2026')
) x(commune, classification, type_calcul, taux_pct, plafond_ht, tarif_pers_nuit, notes)
where not exists (select 1 from public.taxe_sejour_config t where t.commune = x.commune and t.classification = x.classification and t.annee = 2026 and t.agence = a.agence);
