-- 451 : barèmes OFFICIELS 2026 de la taxe de séjour — Bidart, Ahetze, Arbonne (CA Pays Basque), Bordeaux (Bordeaux
-- Métropole), Arcachon (commune) + sources ajoutées au barème Biarritz (vérifié, inchangé). 16/10/2026, feu vert Oïhan.
--
-- Convention de la table (migration 036) : classés = tarif_pers_nuit TTC (part collectivité × 1,44) ;
-- non classés = taux_pct × prix HT de la nuitée PAR PERSONNE, plafonné à plafond_ht (part collectivité, HT), puis
-- × coeff_additionnel (1 + 10 % département + 34 % région GPSO, art. L4332-5 CGCT, depuis le 01/01/2024).
-- Plafond non classés = « tarif le plus élevé adopté par la collectivité » (art. L2333-30 CGCT depuis la LF 2021 :
-- le plafond « hôtels 4 étoiles » a été supprimé) = tarif PALACE de la collectivité. service-public F31635 vérifié
-- le 01/01/2026. L'ancien audit qui plafonnait les non classés à 2,60 € (4★) était faux.
--
-- Données consultées le 16/10/2026. Base DGFiP « Tarifs taxe de séjour - Delta » (data.economie.gouv.fr,
-- delta_deliberation_ts_tarif0, MAJ 29/06/2026) concordante pour chaque commune.

-- ── Bidart : la COMMUNE perçoit la taxe (hors CA Pays Basque, cf. délib. CAPB 15/06/2024 qui exclut Anglet, Bayonne,
-- Biarritz, Bidart, Cambo, Hendaye). Délibération n° 240617-03 du 17/06/2024 « tarifs applicables à compter du
-- 01/01/2025 » sans terme ; aucune délibération 2026 (base DGFiP : dernière date d'effet 2025) → en vigueur en 2026.
-- Source : https://www.bidart.fr/fileadmin/mediatheque/documents_PDF/Tarifs_taxe_sejour_2025.pdf (lien publié par la
-- page mairie « La location saisonnière en pratique », mise à jour 23/03/2026). Palace 4,80 HT (6,91 TTC).
-- Exonération : loyer < 1 € par nuitée et par personne.
-- ── Ahetze, Arbonne : CA Pays Basque (taxe communautaire, 152 communes OTPB). Fiche « Tarifs taxe de séjour 2026 »
-- https://taxedesejour.communaute-paysbasque.fr/includes/download/NoC4VB-Tarifs-Taxe-de-sejour-2026---FR-GB.pdf
-- + délibération CC 15/06/2024 OJ 042 (ID 064-200067106-20240615-CC_20240615_042-DE). Palace 4,80 HT (6,91 TTC).
-- Exonération : loyer < 5 € par jour.
-- ── Bordeaux : Bordeaux Métropole, délib. 2025-190 du 06/06/2025 (tarifs 2026 = plafonds légaux 2026) ; tableau
-- « fourchette légale 2026 » et rappel des loyers exonérés 2026 dans la délib. 2026-159 du 22/05/2026 (tarifs 2027
-- identiques) : https://taxedesejour.bordeaux-metropole.fr/includes/download/IGSUJH-2026-159-deliberation-des-tarifs-2027-taxe-de-sejour.pdf
-- (le PDF 2025-190 du portail renvoie 404 au 16/10/2026). Palace 4,90 HT (7,06 TTC) = plafond des non classés
-- (« soit sur Bordeaux Métropole le tarif applicable aux palaces »). Exonération 2026 : loyer < 30 €/nuitée,
-- 116 €/semaine, 346 €/mois.
-- ── Arcachon : la COMMUNE perçoit. Délib. D2506_39 du 26/06/2025 « Taxe de séjour 2026 » (maintien des tarifs 2025)
-- + annexe 1 « Tarifs 2026 » : https://taxe.3douest.com/includes/download/J24MZp-D25.06-39-Taxe-de-sejour-2026.pdf et
-- https://taxe.3douest.com/includes/download/gPCAVQ-39-Annexe-1---Tarifs.pdf. Non classés 3,85 % dans la limite du
-- tarif palace 2,57 HT (3,70 TTC). Totaux TTC repris de l'annexe officielle.
-- ── Biarritz : vérifié = base DGFiP 2026 (palace 4,90 HT = plafond ; 1★ 0,80 / 2★ 1,00 / 3★ 1,70 / 4★ 2,60 /
-- 5★ 3,60 HT × 1,44). Aucune valeur modifiée, seules les notes reçoivent la source.

insert into public.taxe_sejour_config (agence, commune, classification, type_calcul, taux_pct, plafond_ht, tarif_pers_nuit, coeff_additionnel, annee, notes)
values
  -- Bidart
  ('dcb','Bidart','non_classe','pourcentage',5,4.80,null,1.44,2026,'Non classé / en attente : 5 % du prix HT de la nuitée par personne, plafond = palace 4,80 € HT (6,91 TTC). Délib. Bidart 240617-03 du 17/06/2024 (applicable dès 01/01/2025, pas de délib. 2026) https://www.bidart.fr/fileadmin/mediatheque/documents_PDF/Tarifs_taxe_sejour_2025.pdf — consulté 16/10/2026 ; DGFiP Delta concordant. Exonération loyer < 1 €/nuit/pers.'),
  ('dcb','Bidart','1_etoile','forfait',null,null,1.15,1.44,2026,'1★ + chambres d''hôtes : 0,80 € HT × 1,44. Délib. Bidart 240617-03 du 17/06/2024 (en vigueur 2026) — consulté 16/10/2026'),
  ('dcb','Bidart','2_etoiles','forfait',null,null,1.44,1.44,2026,'2★ : 1,00 € HT × 1,44. Délib. Bidart 240617-03 du 17/06/2024 (en vigueur 2026) — consulté 16/10/2026'),
  ('dcb','Bidart','3_etoiles','forfait',null,null,2.45,1.44,2026,'3★ : 1,70 € HT × 1,44. Délib. Bidart 240617-03 du 17/06/2024 (en vigueur 2026) — consulté 16/10/2026'),
  ('dcb','Bidart','4_etoiles','forfait',null,null,3.74,1.44,2026,'4★ : 2,60 € HT × 1,44. Délib. Bidart 240617-03 du 17/06/2024 (en vigueur 2026) — consulté 16/10/2026'),
  ('dcb','Bidart','5_etoiles','forfait',null,null,5.04,1.44,2026,'5★ : 3,50 € HT × 1,44. Délib. Bidart 240617-03 du 17/06/2024 (en vigueur 2026) — consulté 16/10/2026'),
  -- Ahetze (CA Pays Basque)
  ('dcb','Ahetze','non_classe','pourcentage',5,4.80,null,1.44,2026,'Non classé : 5 %, plafond = palace CAPB 4,80 € HT (6,91 TTC). Fiche CAPB « Tarifs 2026 » https://taxedesejour.communaute-paysbasque.fr/includes/download/NoC4VB-Tarifs-Taxe-de-sejour-2026---FR-GB.pdf + délib. CC 15/06/2024 OJ 042 — consulté 16/10/2026. Exonération loyer < 5 €/jour.'),
  ('dcb','Ahetze','1_etoile','forfait',null,null,1.15,1.44,2026,'1★ + chambres d''hôtes : 0,80 € HT. Fiche CAPB Tarifs 2026 — consulté 16/10/2026'),
  ('dcb','Ahetze','2_etoiles','forfait',null,null,1.44,1.44,2026,'2★ : 1,00 € HT. Fiche CAPB Tarifs 2026 — consulté 16/10/2026'),
  ('dcb','Ahetze','3_etoiles','forfait',null,null,2.45,1.44,2026,'3★ : 1,70 € HT. Fiche CAPB Tarifs 2026 — consulté 16/10/2026'),
  ('dcb','Ahetze','4_etoiles','forfait',null,null,3.74,1.44,2026,'4★ : 2,60 € HT. Fiche CAPB Tarifs 2026 — consulté 16/10/2026'),
  ('dcb','Ahetze','5_etoiles','forfait',null,null,5.04,1.44,2026,'5★ : 3,50 € HT. Fiche CAPB Tarifs 2026 — consulté 16/10/2026'),
  -- Arbonne (CA Pays Basque)
  ('dcb','Arbonne','non_classe','pourcentage',5,4.80,null,1.44,2026,'Non classé : 5 %, plafond = palace CAPB 4,80 € HT (6,91 TTC). Fiche CAPB « Tarifs 2026 » https://taxedesejour.communaute-paysbasque.fr/includes/download/NoC4VB-Tarifs-Taxe-de-sejour-2026---FR-GB.pdf + délib. CC 15/06/2024 OJ 042 — consulté 16/10/2026. Exonération loyer < 5 €/jour.'),
  ('dcb','Arbonne','1_etoile','forfait',null,null,1.15,1.44,2026,'1★ + chambres d''hôtes : 0,80 € HT. Fiche CAPB Tarifs 2026 — consulté 16/10/2026'),
  ('dcb','Arbonne','2_etoiles','forfait',null,null,1.44,1.44,2026,'2★ : 1,00 € HT. Fiche CAPB Tarifs 2026 — consulté 16/10/2026'),
  ('dcb','Arbonne','3_etoiles','forfait',null,null,2.45,1.44,2026,'3★ : 1,70 € HT. Fiche CAPB Tarifs 2026 — consulté 16/10/2026'),
  ('dcb','Arbonne','4_etoiles','forfait',null,null,3.74,1.44,2026,'4★ : 2,60 € HT. Fiche CAPB Tarifs 2026 — consulté 16/10/2026'),
  ('dcb','Arbonne','5_etoiles','forfait',null,null,5.04,1.44,2026,'5★ : 3,50 € HT. Fiche CAPB Tarifs 2026 — consulté 16/10/2026'),
  -- Bordeaux (Bordeaux Métropole)
  ('dcb','Bordeaux','non_classe','pourcentage',5,4.90,null,1.44,2026,'Non classé : 5 %, plafond = palace 4,90 € HT (7,06 TTC). Bordeaux Métropole délib. 2025-190 du 06/06/2025 (tarifs 2026) ; fourchette 2026 + loyers exonérés 2026 rappelés dans délib. 2026-159 https://taxedesejour.bordeaux-metropole.fr/includes/download/IGSUJH-2026-159-deliberation-des-tarifs-2027-taxe-de-sejour.pdf ; DGFiP Delta 2026 — consulté 16/10/2026. Exonération loyer < 30 €/nuitée (116 €/sem., 346 €/mois).'),
  ('dcb','Bordeaux','1_etoile','forfait',null,null,1.15,1.44,2026,'1★ + chambres d''hôtes : 0,80 € HT. Bordeaux Métropole délib. 2025-190 (2026) / DGFiP Delta 2026 — consulté 16/10/2026'),
  ('dcb','Bordeaux','2_etoiles','forfait',null,null,1.44,1.44,2026,'2★ : 1,00 € HT. Bordeaux Métropole délib. 2025-190 (2026) / DGFiP Delta 2026 — consulté 16/10/2026'),
  ('dcb','Bordeaux','3_etoiles','forfait',null,null,2.45,1.44,2026,'3★ : 1,70 € HT. Bordeaux Métropole délib. 2025-190 (2026) / DGFiP Delta 2026 — consulté 16/10/2026'),
  ('dcb','Bordeaux','4_etoiles','forfait',null,null,3.74,1.44,2026,'4★ : 2,60 € HT. Bordeaux Métropole délib. 2025-190 (2026) / DGFiP Delta 2026 — consulté 16/10/2026'),
  ('dcb','Bordeaux','5_etoiles','forfait',null,null,5.18,1.44,2026,'5★ : 3,60 € HT. Bordeaux Métropole délib. 2025-190 (2026) / DGFiP Delta 2026 — consulté 16/10/2026'),
  -- Arcachon (commune)
  ('dcb','Arcachon','non_classe','pourcentage',3.85,2.57,null,1.44,2026,'Non classé : 3,85 % dans la limite du tarif palace 2,57 € HT (3,70 TTC). Délib. Arcachon D2506_39 du 26/06/2025 « Taxe de séjour 2026 » https://taxe.3douest.com/includes/download/J24MZp-D25.06-39-Taxe-de-sejour-2026.pdf + annexe 1 https://taxe.3douest.com/includes/download/gPCAVQ-39-Annexe-1---Tarifs.pdf — consulté 16/10/2026'),
  ('dcb','Arcachon','1_etoile','forfait',null,null,1.08,1.44,2026,'1★ + chambres d''hôtes : 0,75 € HT (total officiel 1,08). Délib. Arcachon D2506_39, annexe 1 Tarifs 2026 — consulté 16/10/2026'),
  ('dcb','Arcachon','2_etoiles','forfait',null,null,1.30,1.44,2026,'2★ : 0,90 € HT (total officiel 1,30). Délib. Arcachon D2506_39, annexe 1 Tarifs 2026 — consulté 16/10/2026'),
  ('dcb','Arcachon','3_etoiles','forfait',null,null,1.90,1.44,2026,'3★ : 1,32 € HT (total officiel 1,90). Délib. Arcachon D2506_39, annexe 1 Tarifs 2026 — consulté 16/10/2026'),
  ('dcb','Arcachon','4_etoiles','forfait',null,null,2.82,1.44,2026,'4★ : 1,96 € HT (total officiel 2,82). Délib. Arcachon D2506_39, annexe 1 Tarifs 2026 — consulté 16/10/2026'),
  ('dcb','Arcachon','5_etoiles','forfait',null,null,3.57,1.44,2026,'5★ : 2,48 € HT (total officiel 3,57). Délib. Arcachon D2506_39, annexe 1 Tarifs 2026 — consulté 16/10/2026')
on conflict (agence, commune, classification, annee) do update set
  type_calcul = excluded.type_calcul, taux_pct = excluded.taux_pct, plafond_ht = excluded.plafond_ht,
  tarif_pers_nuit = excluded.tarif_pers_nuit, coeff_additionnel = excluded.coeff_additionnel, notes = excluded.notes;

-- Biarritz : valeurs vérifiées (inchangées), source ajoutée.
update public.taxe_sejour_config
   set notes = coalesce(notes,'') || ' — Vérifié 16/10/2026 : base DGFiP « Tarifs taxe de séjour - Delta » 2026 (Biarritz, SIREN 216401224) : '
            || case classification when 'non_classe' then '5 %, plafond = palace 4,90 € HT (7,06 TTC), art. L2333-30 CGCT'
                                   when '1_etoile' then '0,80 € HT × 1,44' when '2_etoiles' then '1,00 € HT × 1,44'
                                   when '3_etoiles' then '1,70 € HT × 1,44' when '4_etoiles' then '2,60 € HT × 1,44'
                                   when '5_etoiles' then '3,60 € HT × 1,44' else '' end
 where agence = 'dcb' and commune = 'Biarritz' and annee = 2026 and coalesce(notes,'') not like '%Vérifié 16/10/2026%';
