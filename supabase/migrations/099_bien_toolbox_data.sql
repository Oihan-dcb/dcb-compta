-- Migration 095 : données bien_toolbox
-- Import des biens depuis le CSV "Général"

INSERT INTO bien_toolbox (
  nom_csv, statut, type_location, ville, adresse, parking,
  code_entree, code_coffre, coffre_lieu, ou_appart, poubelles,
  lien_arrivee, mdp_arrivee, temps_nettoyage, temps_nettoyage_h
) VALUES
  ('416 / Harea', 'En location', 'Annuel', 'Biarritz centre', '21TER, avenue Édouard 7, biarritz, residence victoria surf, 4ème étage', 'Idem 602', 'MARS : 2850 / AVRIL : 7315 / MAI : 6904 / JUIN : 4937', '0625', 'Sur porte', '4ème étage à gauche', 'Sur le palier à droite des ascenseurs', 'https://destinationcotebasque.com/home-1/arrivee-autonome-harea/', 'XVL', '45min', 1),
  ('602 /Horizonte', 'En location', 'Annuel', NULL, '21TER, avenue Édouard 7, biarritz, residence victoria surf, 6eme étage', 'Devant la résidence payant ou sous sol payant', NULL, '0625', NULL, '6eme étage à droite', NULL, 'https://destinationcotebasque.com/home-1/arrivee-autonome-horizonte/', 'VSN', '45min', 1),
  ('506P/ Edertasun', 'En location', 'Annuel', NULL, '23, avenue Édouard 7, biarritz, residence victoria surf, 5eme étage', NULL, 'MARS : 7361 / AVRIL : 8530 / MAI : 9573 / JUIN : 2584', '0625', NULL, '5eme étage à gauche', NULL, 'https://destinationcotebasque.com/home-1/arrivee-autonome-edertasun/', 'VLE', NULL, 1),
  ('408P', 'En location', 'Annuel', NULL, '23, avenue Édouard 7, biarritz, residence victoria surf, 4eme étage', NULL, NULL, '0625', NULL, '4ème étage à gauche', NULL, 'https://destinationcotebasque.com/home-1/arrivee-autonome-ikuspegi/', 'SBL', '1h', 1.25),
  ('AITA', 'En location', 'Saisonnier', 'Bidart', '140 chemin marienea', 'Devant appartement', '/', '0625', 'A droite de la porte', 'A droite de la maison', 'Devant la maison', NULL, NULL, '1.5', NULL),
  ('ALAIA ILBARRITZ', 'En location', 'Annuel', 'Biarritz', 'Mer et Golf Ilbarritz, 2ème étage à Gauche, appt 23', NULL, 'MARS : 7240 / AVRIL : 8350 / MAI : 3160 / JUIN : 2815 / JUILLET : 5150 / AOUT : 7090 / SEPTEMBRE : 2865 / OCTOBRE : 7945 / NOVEMBRE : 3350 / DECEMBRE : 7640', '0625', NULL, NULL, NULL, 'https://destinationcotebasque.com/home-1/arrivee-autonome-alaia/', 'ILB', NULL, NULL),
  ('ARREBA', 'En location', 'Etudiant/saisonnier', 'Biarritz', '4 Parc Bon Air, 64200 BIARRITZ', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('ASKIDA', 'En location', 'Annuel', 'Biarritz', '6, allée des chênes biarritz', 'Rue devant', '/', '5481', 'Sur porte', 'Allée à droite du bâtiment', 'Devant résidence', NULL, NULL, '1.5', 1.5),
  ('ASKUN', 'En location', 'Annuel', 'Biarritz', '6, allée des chênes biarritz', 'Rue devant', '/', 'Coffre proprio : 2108 / Coffre clients : 0625', 'Sur porte', 'Allée à droite du bâtiment', 'Devant résidence', 'https://destinationcotebasque.com/home-1/arrivee-autonome-askun/', 'TLP', '1', 1.5),
  ('AUREAN CERES BIS', 'En location', NULL, 'Biarritz', '4 Rue de l''Abbé Pierre Moussempès, Biarritz', NULL, 'clé + 4137 + clé', '0625', NULL, NULL, NULL, 'https://destinationcotebasque.com/home-1/arrivee-autonome-aurean/', 'CRS', NULL, NULL),
  ('B-1 (16)', 'En location', 'Saisonnier', 'Bidart', '378 avenue d''Atherbea', 'Parking résidence', '-', '0625', 'Sur la place de parking 16', 'N16, premier étage à gauche', 'En face', 'https://destinationcotebasque.com/home-1/arrivee-autonome-b-16/', 'arbre', '45min', 1),
  ('B-3 (24)', 'En location', 'Saisonnier', 'Bidart', '378 avenue d''Atherbea', 'Parking résidence', NULL, '5481', 'Sur la place de parking 24', 'Deuxième étage à gauche', 'En face', 'https://destinationcotebasque.com/home-1/arrivee-autonome-b-22/', 'plage', '45min', 1),
  ('BGH', 'En location', 'Annuel', 'Bordeaux', '15 rue Michel Montaigne', NULL, 'Entrée autonome interphone et code porte MOES — User : cjerem31@hotmail.com / Pass : Moes2026', NULL, NULL, NULL, NULL, 'https://destinationcotebasque.com/home-1/arrivee-autonome-bordeaux-grands-hommes/', NULL, NULL, NULL),
  ('BITXI', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('CARLTON', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('CERES', 'En location', 'Annuel', 'Biarritz', '5 Rue de l''Abbé Pierre Moussempès, Biarritz', 'Place de parking résidence', '1812a : 1ère porte et 2580 / Code alarme : 0610 + maison', '0625', 'Sur le palier, porte technique à droite (s''ouvre avec une clef dans le pot de fleur)', 'Penthouse au 7ème étage, porte de gauche ET de droite (terrasse)', 'A gauche en sortant de la résidence', NULL, NULL, '2.25', 2.5),
  ('CHALET PALMARIA', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('Chalet Plaisance', 'En location', NULL, 'Biarritz côte des basques', '3 Place Beau Rivage, 64200 Biarritz', 'Parking gratuit de la résidence', '/', '0625', 'Caché au niveau du parking sur la murette', 'Porte en PVC Chalet Plaisance', 'En face du rond point', 'https://destinationcotebasque.com/home-1/arrivee-autonome-chalet-plaisance/', 'PAR', '2.25', 3),
  ('DUL / Ilargia', 'En location', 'Annuel', 'Biarritz centre', '4 impasse duler biarritz', 'Ville de biarritz', '/', '5481', 'Accroché au remparts des escaliers devant la porte', '2eme étage à gauche', 'Devant la résidence', 'https://destinationcotebasque.com/home-1/arrivee-autonome-illargia/', 'FML', '1.75', 2),
  ('DUL2 / Maitasua', 'En location', 'Saisonnier', 'Biarritz centre', '4 impasse duler biarritz', 'Impasse à voir', '/', '0625', 'Accroché au remparts des escaliers devant la porte', '2eme étage à droite', 'Entrée de la rue à droite', 'https://destinationcotebasque.com/home-1/arrivee-autonome-maitasuna/', 'SLL', '1.25', 1.5),
  ('EGIN', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('EGOA BIDART', 'En location', '120 jours', 'Bidart', '25 rue de Chailla, 64100 BIDART', 'Devant', '-', '0625', 'Accroché au portillon', '-', 'Dans le jardin', NULL, NULL, NULL, NULL),
  ('EKIA', 'En location', 'Annuel', 'Biarritz', '114 Avenue de Verdun 64200 Biarritz', 'Dans la rue', '/', '0625', NULL, NULL, NULL, 'https://destinationcotebasque.com/home-1/arrivee-autonome-ekia/', 'SOL', NULL, NULL),
  ('ENEKO', 'En location', 'Etudiant et saisonnier', 'Biarritz', '260 Rue de la Gare, Bidart', 'Devant la maison', '/', '0625', 'Sur la terrasse', 'A droite de la maison', 'Devant la maison', NULL, NULL, NULL, NULL),
  ('ERDIGUNEA', 'En location', 'Ponctuel', 'Bidart', '8 Rue de la Madeleine, 64210 Bidart', 'Devant l''entrée (place en bas à gauche en arrivant ou à l''intérieur devant la maison)', '/', '1212', 'Cabanon', 'RDC', NULL, 'https://destinationcotebasque.com/home-1/arrivee-autonome-erdigunea-2/', 'ERD', NULL, NULL),
  ('ERREGINA', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('ETXEA STCHARLES', 'EN location', '120 jours', 'Biarritz', '5 avenue Montjoly', 'Devant', '-', '5273', 'Dans BAL, ouvrir avec une clé classique', '1er étage à gauche', 'Dehors', NULL, NULL, NULL, NULL),
  ('Fole Brise', 'En location', 'Saisonnier', 'Biarritz', '38 avenue de l''impératrice à Biarritz', '/', '/', '0625', 'Dans la BAL', '1er étage à droite, 1ère porte à droite', 'Dans la rue', 'https://destinationcotebasque.com/home-1/arrivee-autonome-folle-brise/', 'FLB', NULL, NULL),
  ('GASQ / Bihotza', 'En location', 'Annuel', 'Biarritz centre', '5, rue de Gascogne, biarritz', 'Sous terrain ou devant parking payant', '/', '0625', 'Ouverture porte à distance, coffre à clef dans local technique deuxième porte à gauche', 'RDC 1er appartement à droite appartement 2', 'En haut de la rue de Gascogne', 'https://destinationcotebasque.com/home-1/arrivee-autonome-bihotza/', 'SSM', '1.50', 1.5),
  ('GASQ BIS AMAIA', 'En location', '120 jours', 'Biarritz', '15 bis rue de Gascogne, 64200 BIARRITZ', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('ITS', 'Résidence principale 120jrs/an', 'Saisonnier', 'Biarritz', '2 rue des Chalets, 64200 BIARRITZ', 'Oui, avant dernière place à gauche', '1506', '0625', 'Encadrement de la porte', '2ème étage, à gauche', 'A l''entrée de la rue', NULL, NULL, NULL, NULL),
  ('LAGREOU', 'En location', 'Annuel', 'Bayonne', '6, rue Lagreou, Bayonne', 'Parking porte d''Espagne 1euro', '1524', '0625', 'Sur porte', '1er étage à gauche', 'Sur la place devant la résidence', 'https://destinationcotebasque.com/home-1/arrivee-autonome-lagreou/', 'PMT', '45min', 1),
  ('LAGUN ETXEA', 'En location', '120 jours', 'Biarritz', '23 Avenue Voltaire, Biarritz', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('MAISON MAITE', 'En location', 'Annuel', 'Biarritz', '5 rue d''Alger 64200 BIARRITZ', '/', '/', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('MAISON SUZETTE', NULL, NULL, NULL, '19 impasse de Madrid, Maison Suzette, 64200 BIARRITZ', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('MIRAMAR 85', 'En location', 'Annuel', 'Biarritz', 'Résidence Miramar, 4ème étage n°85, BIARRITZ', NULL, 'Badge / Code porte : 1785', NULL, NULL, '4ème étage, à gauche, appart 85', NULL, 'https://destinationcotebasque.com/home-1/arrivee-autonome-miramarvel/', 'MRM', NULL, NULL),
  ('MOB / Mendi', 'Dispo 1er juillet', 'Saisonnier', 'Biarritz centre', '4bis passage des thermes', 'Parking payant rue ou en hauteur gratuit', '-', '-', '-', '-', 'Rue à gauche', NULL, NULL, NULL, 5),
  ('MUNDUZ', 'En location', 'Annuel', 'Bidart', '36 rue Mundustenea, Biarritz', 'Oui devant la maison', '-', '0625', 'Encadrement de la porte', 'Monter les escaliers à gauche et 1ère porte à droite', '?', 'https://destinationcotebasque.com/home-1/arrivee-autonome-munduz/', 'MDZ', NULL, NULL),
  ('PAITO', 'Disponible', 'Saisonnier', 'Biarritz', '18, rue des petites sœurs des pauvres, biarritz', 'Place 20', 'Code porte résidence : bouton clé et 1259', '5418', 'Boîte aux lettres Guedj', '1er étage à gauche première porte Guedj', 'Devant la résidence', NULL, NULL, '45min', 1),
  ('PATXI', 'En location', 'Annuel', 'Biarritz centre', '3, impasse fontaine marron biarritz', 'Devant résidence en warning', 'NB : 2ème chambre, coffre à clé dans placard, code 8642', '0625', 'Ouvre porte résidence à distance + coffre dans boîte aux lettres Garât', 'Première porte à gauche RDC', 'Devant la résidence', 'https://destinationcotebasque.com/home-1/arrivee-autonome-patxi/', 'JRN', '1.25', 1.5),
  ('Potxoka / Playboy', 'En location', 'Annuel', 'Biarritz Centre', '15 Place Georges Clemenceau', 'Privé sous terrain', 'Badge', '0625', 'Boîte aux lettres', 'RDC à gauche', NULL, 'https://destinationcotebasque.com/home-1/arrivee-autonome-potxoka/', 'CVL', NULL, NULL),
  ('TANDEM', 'En location', 'Annuel', 'Biarritz centre', 'Place sainte Eugénie biarritz', 'Pas de parking', '2748A', '0625', 'Niche à gauche de la porte de l''appartement', '5ème étage en face', 'Sur la place à gauche', 'https://destinationcotebasque.com/home-1/arrivee-autonome-tandem/', 'TND', '1', 1.25),
  ('VIKY', 'En location', 'Ponctuel', 'Biarritz centre', '14, avenue reine victoria, biarritz', 'Parking sous terrain résidence place 5', '7164', '5481', 'Boîte aux lettres n°55', '1er étage à gauche appartement 55', 'Sortie à gauche', 'https://destinationcotebasque.com/home-1/arrivee-autonome-viky/', 'VTR', '1', 1.25),
  ('VILLA AITZINA', NULL, NULL, NULL, '37 chemin de Ziburia, 64210 ARBONNE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('VILLA ARCANGUES', NULL, NULL, NULL, '98 Impasse Bellevue, 64200 ARCANGUES', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('VILLA ARROSA', NULL, NULL, NULL, '245 Route de Saint-Pée, Arbonne', 'Devant la maison', 'Alarme', '-', '-', '-', '-', '-', NULL, NULL, NULL),
  ('VILLA AUGUSTA', NULL, NULL, NULL, '5 rue de FOURVIERES, 64600 ANGLET', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('VILLA BELEZIA', NULL, NULL, NULL, '32 Rue Marie Duprat, Biarritz', NULL, NULL, '9476', 'Coffre sur la gauche pour les techniques', NULL, NULL, NULL, NULL, NULL, NULL),
  ('VILLA BERDEA', NULL, NULL, NULL, '145 Chemin de Errota Handia, 64200 Arcangues', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('VILLA CANOPEE', NULL, NULL, NULL, '36 rue du HAMEAU, 64200 BIARRITZ', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('VILLA CHOCOMAITENA', NULL, NULL, NULL, '44 rue Alan SEEGER, BIARRITZ', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('VILLA AMA', NULL, NULL, NULL, '14 Avenue Carnot, BIARRITZ', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('VILLA COCO', NULL, NULL, NULL, 'Villa PENTZIA, 8 impasse LANCHIPIETTE, Arcangues', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('VILLA OASIS', NULL, NULL, NULL, 'Impasse des Dauphins, 64200 BIARRITZ', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('VILLA OLATUA', NULL, NULL, NULL, '6 impasse des bruyères, 64200 Biarritz', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('VILLA ONTZI', NULL, NULL, NULL, '223 Promenade de la Barre, 64600 ANGLET', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('VILLA SILVANA', NULL, NULL, NULL, '9 avenue de Tennis', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('VILLA TXORIA', NULL, NULL, NULL, '45 avenue de l''Océan, 64500 Saint Jean de Luz', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('VILLA URDIN', NULL, NULL, NULL, '15 allée du Village du bois belin, 64600 ANGLET', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('XABADENIA', 'En location', 'Saisonnier', 'Bidart', '181, rue Berrua, Bidart', 'Places visiteur résidence', 'Barrière : 6678 / portes : 2507', '0625', 'Boîte aux lettres (zora)', '1er étage à gauche appartement 19', 'Devant la résidence en hauteur avant la sortie voiture', 'https://destinationcotebasque.com/home-1/arrivee-autonome-xabadenia/', 'BRH', '1.25', 1.5),
  ('ZURBIAC', 'En location', 'Annuel', 'Biarritz', '38 avenue maréchal joffre biarritz', 'Sur la rue ou petite allée sur le côté', 'Code portillons : 6475', '5278', 'Entrée résidence à gauche', 'RDC à gauche porte de droite Allaux', 'Coin de rue avant la résidence', 'https://destinationcotebasque.com/home-1/arrivee-autonome-zurbiac/', 'VYE', '1.5', 1.5)
;

-- Mise à jour des données linge et consommables

UPDATE bien_toolbox SET
  linge_plat = '1 Drap Queen + 1housse de couette Q + 2 Taies Carrées',
  linge_eponge = '2 Grandes Serviettes 2 Petites Serviettes 2 Carré Visage 1 Tapis de bain 1 Torchon 1 Microfibre',
  consommables = '2 Sac poubelle 50L 4 Capsules Nespresso 1 Rouleaux Papier toilette'
WHERE nom_csv = '416 / Harea';

UPDATE bien_toolbox SET
  linge_plat = '1 Drap Queen + 1housse de couette Q + 2 Taies Carrées',
  linge_eponge = '2 Grandes Serviettes 2 Petites Serviettes 2 Carré Visage 1 Tapis de bain 1 Torchon 1 Microfibre',
  consommables = '2 Sac poubelle 50L 4 Capsules Nespresso 1 Rouleaux Papier toilette'
WHERE nom_csv = '602 /Horizonte';

UPDATE bien_toolbox SET
  linge_plat = '1 Drap Queen + 1housse de couette Q + 2 Taies Carrées',
  linge_eponge = '4 Grandes Serviettes 2 Petites Serviettes 2 Carré Visage 2 Tapis de bain 2 Peignoirs 2 paires de chaussons 1 Torchon 1 Microfibre',
  consommables = '2 Sac poubelle 50L Café en grains 1 Rouleaux Papier toilette'
WHERE nom_csv = 'ASKIDA';

UPDATE bien_toolbox SET
  linge_plat = '1 Drap Queen + 1housse de couette Q + 2 Taies Carrées',
  linge_eponge = '2 Grandes Serviettes 2 Petites Serviettes 2 Carré Visage 1 Tapis de bain 1 Torchon 1 Microfibre',
  consommables = '2 Sac poubelle 50L Dosettes Café 1 Rouleaux Papier toilette'
WHERE nom_csv = 'B-1 (16)';

UPDATE bien_toolbox SET
  linge_plat = '1 Drap Queen + 1housse de couette Q + 2 Taies Carrées',
  linge_eponge = '2 Grandes Serviettes 2 Petites Serviettes 2 Carré Visage 1 Tapis de bain 1 Torchon 1 Microfibre',
  consommables = '2 Sac poubelle 50L Dosettes café 1 Rouleaux Papier toilette'
WHERE nom_csv = 'B-3 (24)';

UPDATE bien_toolbox SET
  linge_plat = '2 Drap King 2 housse de couette King ou 6 Draps King 4 Taies Carrées 4 Taies Rectangulaires',
  linge_eponge = '4 Grandes Serviettes 4 Petites Serviettes 4 Carré Visage 1 Tapis de bain 2 Torchon 2 Microfibre',
  consommables = '2 Sac poubelle 50L 4 Capsules Nespresso grosses 2 Rouleaux Papier toilette'
WHERE nom_csv = 'BGH';

UPDATE bien_toolbox SET
  linge_plat = '2 Drap Queen + 2 housse de couette Q + 10 Taies Carrées',
  linge_eponge = '4 Grandes Serviettes 4 Petites Serviettes 4 Carré Visage 2 Tapis de bain 3 Torchon 2 Microfibre',
  consommables = '2 Sac poubelle 50L 4 Capsules Nespresso 4 Rouleaux Papier toilette'
WHERE nom_csv = 'CERES';

UPDATE bien_toolbox SET
  linge_plat = '1 Drap KING 1 Drap QUEEN 1 Drap TWIN 1 Housse de couette K 1 Housse de couette Q 1 Housse de couette TWIN 2 Taies Carrées 5 Taies Rectangle',
  linge_eponge = '5 Grandes Serviettes 4 Petites Serviettes 1 Petite serviette WC 4 Carré Visage 2 Tapis de bain 2 Torchon 2 Microfibre',
  consommables = '2 Sac poubelle 50L 4 Capsules Nespresso 1 Rouleaux Papier toilette'
WHERE nom_csv = 'DUL / Ilargia';

UPDATE bien_toolbox SET
  linge_plat = '1 Drap Queen + 1housse de couette Q + 2 Taies Carrées',
  linge_eponge = '2 Grandes Serviettes 2 Petites Serviettes 2 Carré Visage 1 Tapis de bain 1 Torchon 1 Microfibre',
  consommables = '2 Sac poubelle 50L 4 Capsules Nespresso 1 Rouleaux Papier toilette'
WHERE nom_csv = 'DUL2 / Maitasua';

UPDATE bien_toolbox SET
  linge_plat = '1 Drap Queen + 1housse de couette Q + 2 Taies Carrées',
  linge_eponge = '2 Grandes Serviettes 2 Petites Serviettes 2 Carré Visage 1 Tapis de bain 1 Torchon 1 Microfibre',
  consommables = '2 Sac poubelle 50L 4 Capsules Nespresso 1 Rouleaux Papier toilette'
WHERE nom_csv = 'GASQ / Bihotza';

UPDATE bien_toolbox SET
  linge_plat = '1 Drap Queen + 1housse de couette Q + 2 Taies Carrées',
  linge_eponge = '2 Grandes Serviettes 2 Petites Serviettes 2 Carré Visage 1 Tapis de bain 1 Torchon 1 Microfibre',
  consommables = '2 Sac poubelle 50L 4 Capsules Nespresso 1 Rouleaux Papier toilette'
WHERE nom_csv = 'LAGREOU';

UPDATE bien_toolbox SET
  linge_plat = '1 Drap Queen + 1housse de couette Q + 2 Taies Carrées',
  linge_eponge = '2 Grandes Serviettes 2 Petites Serviettes 2 Carré Visage 1 Tapis de bain 1 Torchon 1 Microfibre',
  consommables = '2 Sac poubelle 50L 4 Capsules Nespresso 1 Rouleaux Papier toilette'
WHERE nom_csv = 'PAITO';

UPDATE bien_toolbox SET
  linge_plat = '1 Drap Queen + 1housse de couette Q + 2 Taies Carrées',
  linge_eponge = '2 Grandes Serviettes 2 Petites Serviettes 2 Carré Visage 1 Tapis de bain 1 Torchon 1 Microfibre',
  consommables = '2 Sac poubelle 50L 4 Capsules Nespresso 1 Rouleaux Papier toilette'
WHERE nom_csv = 'PATXI';

UPDATE bien_toolbox SET
  linge_plat = '1 Drap Queen + 1housse de couette Q + 2 Taies Carrées',
  linge_eponge = '2 Grandes Serviettes 2 Petites Serviettes 2 Carré Visage 1 Tapis de bain 1 Torchon 1 Microfibre',
  consommables = '2 Sac poubelle 50L 4 Capsules Nespresso 1 Rouleaux Papier toilette'
WHERE nom_csv = 'TANDEM';

UPDATE bien_toolbox SET
  linge_plat = '1 Drap Queen + 1housse de couette Q + 2 Taies Carrées',
  linge_eponge = '2 Grandes Serviettes 2 Petites Serviettes 2 Carré Visage 1 Tapis de bain 1 Torchon 1 Microfibre',
  consommables = '2 Sac poubelle 50L 4 Capsules Nespresso 1 Rouleaux Papier toilette'
WHERE nom_csv = 'VIKY';

UPDATE bien_toolbox SET
  linge_plat = '1 Drap Queen + 1housse de couette Q + 2 Taies Carrées',
  linge_eponge = '2 Grandes Serviettes 2 Petites Serviettes 2 Carré Visage 1 Tapis de bain 1 Torchon 1 Microfibre',
  consommables = '2 Sac poubelle 50L Dosettes café 1 Rouleaux Papier toilette'
WHERE nom_csv = 'XABADENIA';

UPDATE bien_toolbox SET
  linge_plat = '2 Drap Queen + 2 Housse de couette Q + 4 Taies Carrées',
  linge_eponge = '4 Grandes Serviettes 4 Petites Serviettes 4 Carré Visage 1 Tapis de bain 2 Torchon 2 Microfibre',
  consommables = '2 Sac poubelle 50L Café filtre 2 Rouleaux Papier toilette'
WHERE nom_csv = 'ZURBIAC';
