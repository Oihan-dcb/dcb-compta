-- Charge le template contrat de prestation AE (DCB + Lauïan) dans contract_templates.
-- Source : dcb-planning/contracts/contrat_prestation_ae_2026-v1.html
delete from public.contract_templates where type_contrat='prestation_ae' and version='2026-v1';
insert into public.contract_templates (agence,langue,type_contrat,version,nom,contenu_html,variables_attendues,is_active) values
('dcb','fr','prestation_ae','2026-v1','Contrat de prestation AE — DCB', $aetpl$<!--
  Template CONTRAT DE PRESTATION DE SERVICE — Auto-entrepreneur (AE) — v1 (2026)
  Source de vérité versionnée — à charger dans contract_templates (type_contrat='prestation_ae').
  Moteur : renderMustache (api/generate-contrat-ae.js) — {{var}}, {{#cond}}…{{/cond}}, {{^cond}}…{{/cond}}.
  Entité variable DCB / Lauïan : {{#est_lauian}}…{{/est_lauian}}.
  Le PRESTATAIRE = l'auto-entrepreneur. Le CLIENT = l'agence (conciergerie DCB / Lauïan).
  Signé dans le portail AE (connecté). Données : auto_entrepreneur + ae_onboarding.reponses.
  Vars config : penalite_montant, preavis_resiliation, non_solicit_jours, delai_paiement, incident_delai.
-->
<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<style>
  @font-face{font-family:'Northwell';src:url('https://dcb-contrats.vercel.app/fonts/Northwell.ttf') format('truetype');font-weight:normal;font-style:normal}
  @page{size:A4;margin:14mm 15mm 16mm}
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#2C2416;font-size:11px;line-height:1.55;margin:0;padding:0}
  .chk{display:inline-block;width:11px;height:11px;border:1.5px solid #CC9933;border-radius:2px;background:#CC9933;vertical-align:-1px;margin-right:5px}
  .header{display:flex;align-items:center;justify-content:space-between;padding:8px 0 20px;position:relative}
  .header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:3px;border-radius:2px;background:linear-gradient(90deg,#CC9933 0%,#E4A853 50%,#CC9933 100%)}
  .header-left{display:flex;align-items:center;gap:14px}
  .logo-square{width:50px;height:50px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:700;flex-shrink:0;background:linear-gradient(135deg,#D4A035 0%,#CC9933 60%,#B8872A 100%);box-shadow:0 2px 8px rgba(204,153,51,.30)}
  .header-brand .name{font-size:15pt;font-weight:700;color:#1C1C1C;letter-spacing:-.3px}
  .header-brand .sub{font-size:8pt;color:#8C7B65;letter-spacing:2px;text-transform:uppercase;margin-top:1px}
  .header-right{text-align:right;font-size:8pt;color:#8C7B65;line-height:1.8}
  .doc-title-block{text-align:center;padding:26px 0 18px;border-bottom:1px solid #EAE0D0;margin-bottom:18px}
  .doc-title{font-size:15pt;font-weight:700;color:#1C1C1C;text-transform:uppercase;letter-spacing:3px}
  .doc-subtitle{font-size:9.5pt;color:#8C7B65;font-style:italic;margin-top:6px}
  .gold-line{width:48px;height:2px;background:linear-gradient(90deg,#CC9933,#E4A853,#CC9933);margin:12px auto;border-radius:2px}
  .doc-num{display:inline-block;border:1.5px solid #CC9933;border-radius:8px;padding:4px 16px;font-size:11pt;margin-top:6px}
  .doc-num strong{color:#8a6d1f}
  .section-title{font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#CC9933;border-bottom:1.5px solid #E8DCC8;padding-bottom:6px;margin:18px 0 10px}
  .art{font-weight:700;margin:13px 0 3px;color:#1C1C1C;font-size:11.5px}
  .sub{font-weight:700;margin:10px 0 2px;color:#1C1C1C}
  .muted{color:#6b6150}.small{font-size:9.5px;color:#8C7B65}
  .box{background:#FDFAF5;border:1px solid #E8DCC8;border-left:3px solid #CC9933;border-radius:6px;padding:10px 14px;margin:10px 0}
  .footer{margin-top:22px;border-top:2px solid #CC9933;padding-top:10px}
  .sign-zone{display:flex;justify-content:space-between;margin-top:26px}
  .sign-box{width:45%;background:#FDFAF5;border:1px solid #E8DCC8;border-radius:6px;padding:12px 16px;min-height:96px;font-size:10px}
  .sig-label{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#8C7B65;border-bottom:1px solid #E8DCC8;padding-bottom:5px;margin-bottom:7px}
  .sig-name{font-weight:700;font-size:10pt;color:#1C1C1C}
  .sig-script{font-family:'Northwell',cursive;font-size:22pt;color:#CC9933;line-height:1;padding:6px 0 2px}
  .sig-line{border-bottom:1.5px dashed #CC9933;height:46px;margin-top:10px;opacity:.5}
  .sig-note{font-size:7.5pt;color:#A09282;margin-top:4px;line-height:1.5}
  ul{margin:4px 0 4px 18px;padding:0}li{margin:2px 0}
  table.parties{width:100%;border-collapse:collapse;font-size:10px;margin:6px 0}
  table.parties td{padding:7px 12px;border:1px solid #E8DCC8;vertical-align:top}
  table.parties td.k{width:34%;font-weight:600;color:#6B5840;background:#FBF6EC}
</style></head>
<body>

<div class="header">
  <div class="header-left">
    <div class="logo-square">{{#est_lauian}}L{{/est_lauian}}{{^est_lauian}}D{{/est_lauian}}</div>
    <div class="header-brand">
      <div class="name">{{agence_nom}}</div>
      <div class="sub">Conciergerie · Côte Basque</div>
    </div>
  </div>
  <div class="header-right">{{agence_adresse_ligne1}}<br>{{agence_adresse_ligne2}}<br>{{agence_tel}}<br>{{agence_email}}</div>
</div>

<div class="doc-title-block">
  <div class="doc-title">Contrat de prestation de service</div>
  <div class="gold-line"></div>
  <div class="doc-subtitle">Entre le prestataire indépendant et {{agence_nom}}</div>
  <div class="doc-num">N° <strong>{{contrat_numero}}</strong></div>
  {{#prestataire_siret}}<div class="small" style="margin-top:8px">Prestataire : <strong>{{prestataire_designation}}</strong> · SIRET <strong>{{prestataire_siret}}</strong></div>{{/prestataire_siret}}
</div>

<div class="section-title">Entre les soussignés</div>

<div class="sub">Le Prestataire</div>
<table class="parties">
  <tr><td class="k">Désignation</td><td><strong>{{prestataire_designation}}</strong></td></tr>
  {{#prestataire_statut}}<tr><td class="k">Statut</td><td>{{prestataire_statut}}</td></tr>{{/prestataire_statut}}
  {{#prestataire_siret}}<tr><td class="k">N° SIRET</td><td>{{prestataire_siret}}</td></tr>{{/prestataire_siret}}
  {{#prestataire_adresse}}<tr><td class="k">Adresse</td><td>{{prestataire_adresse}}</td></tr>{{/prestataire_adresse}}
  {{#prestataire_tel}}<tr><td class="k">Téléphone</td><td>{{prestataire_tel}}</td></tr>{{/prestataire_tel}}
  {{#prestataire_email}}<tr><td class="k">E-mail</td><td>{{prestataire_email}}</td></tr>{{/prestataire_email}}
  {{#prestataire_assurance}}<tr><td class="k">Assurance RC pro</td><td>{{prestataire_assurance}}</td></tr>{{/prestataire_assurance}}
</table>
<p><strong>Ci-après dénommé « le Prestataire », d'une part,</strong></p>

<div class="sub">Le Client</div>
<p>La société <strong>{{agence_nom}}</strong>, {{agence_forme}} au capital de {{agence_capital}} euros, immatriculée au RCS de {{agence_rcs}}, dont le siège social est situé {{agence_adresse}}, numéro de TVA intracommunautaire {{agence_tva}}, représentée par <strong>{{agence_representant}}</strong>, en sa qualité de {{agence_qualite}}, dûment habilité(e) aux fins des présentes.</p>
<p><strong>Ci-après dénommée « le Client », d'autre part,</strong></p>

<div class="section-title">Il a été préalablement exposé</div>
<p>{{agence_nom}} est une agence spécialisée dans la conciergerie et la gestion locative d'appartements et de maisons meublés sur la Côte Basque. À ce titre, elle a reçu mandat de la part de ses clients propriétaires afin de gérer leurs logements et d'y accueillir des voyageurs. Dans ce cadre, le Prestataire a souhaité proposer ses services au Client, étant en mesure de réaliser des prestations de préparation des logements et d'accueil des voyageurs. Ceci exposé, il a été convenu ce qui suit.</p>

<div class="art">Article 1 — Objet</div>
<p>Le présent contrat est un contrat de prestation de services ayant pour objet la réalisation de prestations de <strong>préparation des logements</strong> et d'<strong>accueil des voyageurs</strong> dans des logements meublés gérés par le Client, dans le respect du cahier des charges fourni en amont et mis à jour au besoin.</p>
<p><strong>1 — Préparation des logements :</strong> récupérer et rapporter les éléments nécessaires (clés, linge, produits) ; remettre le logement en état conformément au cahier des charges ; envoyer un compte-rendu via le Portail AE. <strong>2 — Accueil des voyageurs :</strong> vérifier l'état du logement avant l'arrivée ; accueillir les voyageurs, présenter le logement et son fonctionnement, remettre les clés ; envoyer un compte-rendu via le Portail AE. Des missions en cours de séjour ou des ménages de printemps pourront aussi être réalisés à la demande.</p>

<div class="art">Article 2 — Portail AE : outil officiel de mission</div>
<p>Le <strong>Portail AE {{agence_nom}}</strong> (application en ligne mise à disposition par le Client) constitue <strong>l'outil officiel unique</strong> de la relation : proposition et acceptation des missions, planning, comptes-rendus, photos, signalements d'incidents, prestations hors forfait et récapitulatifs de facturation y transitent. Le Prestataire s'engage à le consulter régulièrement, à y tenir son planning à jour et à y renseigner les comptes-rendus de chaque mission. Toute mission est réputée n'avoir été ni proposée ni acceptée en dehors du Portail.</p>

<div class="art">Article 3 — Attribution des missions et prix</div>
<p>Pour obtenir de nouvelles prestations, le Prestataire se connecte au Portail AE, sur lequel il choisit librement les missions qui l'intéressent. Pour chaque mission, le Client indique la date, l'heure (ou une tranche horaire), le lieu, un descriptif et un prix associé. Le prix peut varier selon la date et l'heure, le nombre de prestataires disponibles et les caractéristiques du logement. Le Client pourra faire évoluer ces éléments afin d'améliorer son système d'attribution.</p>

<div class="art">Article 4 — Prestations hors forfait</div>
<p>Outre les missions standard, des <strong>prestations hors forfait</strong> (ménage de printemps, gestion du linge, attente prolongée, intervention exceptionnelle, petit dépannage, etc.) peuvent être réalisées. Elles doivent être <strong>préalablement validées par le Client</strong> et sont saisies par le Prestataire dans le module « prestations hors forfait » du Portail AE, au tarif convenu. Toute prestation hors forfait non validée au préalable ne pourra donner lieu à rémunération.</p>

<div class="art">Article 5 — Facturation et paiement</div>
<p>La facturation est <strong>mensuelle</strong>. À la fin de chaque mois, le Prestataire établit une facture récapitulant l'ensemble des missions et prestations hors forfait <strong>validées</strong> au cours du mois écoulé, le Portail AE mettant à sa disposition le récapitulatif correspondant. Le règlement est effectué par <strong>virement bancaire</strong> sous <strong>{{delai_paiement}}</strong> à compter de la réception de la facture. Les éventuels frais annexes nécessaires à l'exécution d'une prestation, validés au préalable, sont facturés en sus sur relevé de dépenses. Le Prestataire fait son affaire personnelle de ses obligations sociales, fiscales et déclaratives.</p>

<div class="art">Article 6 — Durée</div>
<p>Le présent contrat est conclu pour une durée indéterminée, à compter de sa signature.</p>

<div class="art">Article 7 — Assurance responsabilité civile professionnelle</div>
<p>Le Prestataire est <strong>vivement encouragé à souscrire et à maintenir une assurance responsabilité civile professionnelle</strong> couvrant les dommages susceptibles d'être causés dans le cadre de ses prestations. S'il en dispose, il en remet l'attestation au Client et l'informe de toute modification, suspension ou résiliation. À défaut d'assurance, le Prestataire demeure personnellement responsable des dommages qu'il pourrait causer dans l'exécution de ses missions.</p>

<div class="art">Article 8 — Exécution et obligations de moyens</div>
<p>Le Prestataire s'engage à mener à bien les tâches précisées à l'article 1, conformément aux règles de l'art, en autonomie, avec professionnalisme et dans le respect des règles de sécurité. Le Client et les voyageurs pourront évaluer les qualités de propreté et d'accueil. En cas de non-respect du cahier des charges relevé par le voyageur ou le Client, le Prestataire s'engage à retourner au logement afin de corriger sa prestation, sans rémunération supplémentaire. Si l'absence de résultat provient d'une faute du Client, le Prestataire est déchargé de toute responsabilité. Lorsqu'une mission lui a été affectée, le Prestataire s'engage à la réaliser ; en cas de force majeure, il avertit le Client au plus tôt afin qu'une solution de remplacement soit trouvée.</p>

<div class="art">Article 9 — Clés et codes d'accès</div>
<p>Les clés, badges et codes d'accès remis au Prestataire le sont <strong>aux seules fins de l'exécution des missions acceptées</strong>. Le Prestataire en assure la garde et la stricte confidentialité : il s'interdit de les dupliquer, de les photographier, de les communiquer ou de les confier à quiconque. Il les restitue immédiatement à la demande du Client et au plus tard à la fin du contrat. <strong>Toute perte ou vol doit être signalé sans délai</strong> ; en cas de négligence, les frais de remplacement des clés et/ou de changement de serrure ou de codes seront à la charge du Prestataire.</p>

<div class="art">Article 10 — Déclaration d'incident</div>
<p>Tout incident, dégât, dysfonctionnement, anomalie de sécurité ou manquement constaté dans un logement (matériel, propreté, intrusion, sinistre…) doit être <strong>signalé sans délai au Client via le module « Signaler » du Portail AE</strong>, et au plus tard dans un délai de <strong>{{incident_delai}}</strong>, accompagné de photographies lorsque c'est possible. Le Prestataire ne réalise aucune réparation de sa propre initiative sans accord du Client, sauf mesure conservatoire urgente.</p>

<div class="art">Article 11 — Confidentialité et discrétion</div>
<p>Le Prestataire considère comme strictement confidentiel et s'interdit de divulguer toute information, document ou donnée dont il a connaissance à l'occasion du présent contrat. Il observe une <strong>discrétion absolue à l'égard des propriétaires et des voyageurs</strong> : il respecte leur vie privée, leurs biens, leur identité et la confidentialité des logements, des codes et des séjours. Il s'interdit toute communication d'informations à des tiers, toute publication (notamment sur les réseaux sociaux) et tout contact direct avec les propriétaires en dehors du cadre défini par le Client. Cette obligation survit à la fin du contrat.</p>

<div class="art">Article 12 — Interdiction d'accès et non-sollicitation</div>
<p>Le Prestataire s'interdit d'accéder aux logements en dehors des périodes d'accueil et de préparation, et seulement sur demande du Client. Il ne pénètre jamais dans un logement pour un usage autre que professionnel et ne permet à personne d'y pénétrer sans autorisation. Le manquement à cette obligation pourra entraîner une plainte auprès des autorités et la résiliation immédiate. Par ailleurs, le Prestataire s'engage à ne pas contracter directement avec les propriétaires clients de la Société pendant toute la durée du partenariat et pendant <strong>{{non_solicit_jours}} jours</strong> suivant la fin du contrat.</p>

<div class="art">Article 13 — Obligation d'image</div>
<p>Durant la durée du contrat, le Prestataire autorise à titre gracieux le Client à utiliser une photo qu'il aura fournie, afin de communiquer en amont avec les voyageurs pour les accueils, conformément aux dispositions relatives au droit à l'image.</p>

<div class="section-title">Obligations du Client</div>
<div class="art">Article 14 — Information et collaboration</div>
<p>Le Client s'engage à fournir au Prestataire toute information et tout matériel nécessaires à l'accomplissement de ses missions : informations sur le logement (accès, composition, fonctionnement), sur les voyageurs (nombre, coordonnées) et sur la mission (cahier des charges préparation et accueil). Il tient à sa disposition, via le Portail AE, les informations utiles à la bonne réalisation des prestations.</p>

<div class="art">Article 15 — Responsabilités</div>
<p>Quels que soient les fondements de sa réclamation, la responsabilité éventuelle du Prestataire au titre de l'exécution du présent contrat sera limitée à un montant n'excédant pas la somme totale effectivement payée par le Client pour les prestations concernées, sauf faute manifeste ayant conduit à des dommages matériels pouvant atteindre les immeubles, installations, matériels et mobiliers du Client et des clients propriétaires.</p>

<div class="art">Article 16 — Pénalités</div>
<p>La non-présentation à un rendez-vous de préparation ou d'accueil accepté et non annulé au moins 48 heures à l'avance engendre l'obligation pour le Prestataire de payer au Client la somme de <strong>{{penalite_montant}} €</strong> à titre de pénalité, retenue sur le montant restant dû.</p>

<div class="art">Article 17 — Résiliation pour faute</div>
<p>En cas de non-présentation à un rendez-vous accepté, d'insatisfaction manifeste du Client ou des voyageurs, de manquement aux obligations du Prestataire, de manquement à la confidentialité ou de sous-traitance non autorisée, le Client pourra résilier le présent contrat avec application immédiate.</p>

<div class="art">Article 18 — Résiliation hors faute</div>
<p>Le présent contrat pourra être résilié à tout instant par chacune des parties, sous réserve d'un préavis de <strong>{{preavis_resiliation}}</strong> notifié par e-mail ou courrier postal simple.</p>

<div class="art">Article 19 — Non sous-traitance</div>
<p>Pour des raisons d'organisation, le Prestataire ne pourra pas sous-traiter les missions, sauf accord préalable du Client. Il pourra toutefois introduire auprès du Client de nouveaux prestataires potentiels en vue de leur référencement.</p>

<div class="art">Article 20 — Cession</div>
<p>Le présent contrat est conclu en considération de la personne du Prestataire, qui ne pourra substituer de tiers dans la réalisation des tâches définies.</p>

<div class="art">Article 21 — Non-exclusivité et indépendance</div>
<p>Le Prestataire exerce son activité <strong>en toute indépendance, sans aucun lien de subordination</strong> avec {{agence_nom}}. Il est libre d'accepter ou non les missions proposées et de travailler pour d'autres clients. Il organise librement son temps et ses moyens, et demeure seul responsable de ses obligations sociales, fiscales et déclaratives. <strong>Le Prestataire s'engage à informer {{agence_nom}} sans délai de toute modification de sa situation ou de son statut</strong> (cessation ou radiation d'activité, changement de forme juridique, perte de la qualité d'auto-entrepreneur, modification du numéro SIRET, suspension ou résiliation de son assurance responsabilité civile professionnelle).</p>

<div class="art">Article 22 — Interprétation</div>
<p>Le présent contrat et ses annexes contiennent l'intégralité des engagements des parties ; les correspondances, offres ou propositions antérieures sont considérées comme non-avenues.</p>

<div class="art">Article 23 — Juridiction compétente</div>
<p>Tout litige relatif à la formation, l'exécution ou l'interprétation du présent contrat relèvera de la compétence exclusive du tribunal de commerce de {{agence_ville_tribunal}}.</p>

<div class="section-title">Collecte des données personnelles</div>
<p class="small">Les données personnelles du Prestataire, collectées à l'occasion des présentes, font l'objet de traitements nécessaires à l'exécution du contrat, conservées pendant sa durée augmentée des délais légaux. Le Prestataire peut exercer ses droits auprès du Client ou saisir la CNIL (www.cnil.fr). <span class="chk"></span><strong>En signant, le Prestataire l'accepte expressément.</strong></p>

<div class="footer">
  <div class="section-title" style="margin-top:0">Date et signatures</div>
  <p>Fait à {{lieu_signature}}, le {{contrat_date}}, et signé électroniquement, chaque partie en conservant un exemplaire sur un support durable garantissant l'intégrité de l'acte.</p>
  <div class="sign-zone">
    <div class="sign-box">
      <div class="sig-label">Le Prestataire — Lu et approuvé</div>
      <div class="sig-name">{{prestataire_designation}}</div>
      {{#signature_prestataire}}<div class="sig-script">{{signature_prestataire}}</div>
      <div class="sig-note">Signature électronique apposée{{#signature_horodatage}} le {{signature_horodatage}}{{/signature_horodatage}}<br>portail prestataire {{agence_nom}}</div>{{/signature_prestataire}}
      {{^signature_prestataire}}<div class="sig-line"></div>{{/signature_prestataire}}
    </div>
    <div class="sign-box">
      <div class="sig-label">Le Client</div>
      <div class="sig-name">{{agence_representant}}</div>
      <div class="sig-script">{{agence_representant}}</div>
      <div class="sig-note">{{agence_qualite}} — {{agence_nom}}</div>
    </div>
  </div>
  <p class="small" style="margin-top:18px">{{#signature_ref}}Signature électronique : {{signature_mode}} · Horodatage {{signature_horodatage}} · Réf. {{signature_ref}}{{/signature_ref}}{{^signature_ref}}Document établi pour signature électronique sécurisée dans le portail prestataire.{{/signature_ref}}</p>
</div>

</body></html>
$aetpl$, '{"defaults": {"penalite_montant": "50", "preavis_resiliation": "trois semaines", "non_solicit_jours": "365", "delai_paiement": "30 jours", "incident_delai": "24 heures"}}'::jsonb, true),
('lauian','fr','prestation_ae','2026-v1','Contrat de prestation AE — Lauïan', $aetpl$<!--
  Template CONTRAT DE PRESTATION DE SERVICE — Auto-entrepreneur (AE) — v1 (2026)
  Source de vérité versionnée — à charger dans contract_templates (type_contrat='prestation_ae').
  Moteur : renderMustache (api/generate-contrat-ae.js) — {{var}}, {{#cond}}…{{/cond}}, {{^cond}}…{{/cond}}.
  Entité variable DCB / Lauïan : {{#est_lauian}}…{{/est_lauian}}.
  Le PRESTATAIRE = l'auto-entrepreneur. Le CLIENT = l'agence (conciergerie DCB / Lauïan).
  Signé dans le portail AE (connecté). Données : auto_entrepreneur + ae_onboarding.reponses.
  Vars config : penalite_montant, preavis_resiliation, non_solicit_jours, delai_paiement, incident_delai.
-->
<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<style>
  @font-face{font-family:'Northwell';src:url('https://dcb-contrats.vercel.app/fonts/Northwell.ttf') format('truetype');font-weight:normal;font-style:normal}
  @page{size:A4;margin:14mm 15mm 16mm}
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#2C2416;font-size:11px;line-height:1.55;margin:0;padding:0}
  .chk{display:inline-block;width:11px;height:11px;border:1.5px solid #CC9933;border-radius:2px;background:#CC9933;vertical-align:-1px;margin-right:5px}
  .header{display:flex;align-items:center;justify-content:space-between;padding:8px 0 20px;position:relative}
  .header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:3px;border-radius:2px;background:linear-gradient(90deg,#CC9933 0%,#E4A853 50%,#CC9933 100%)}
  .header-left{display:flex;align-items:center;gap:14px}
  .logo-square{width:50px;height:50px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:700;flex-shrink:0;background:linear-gradient(135deg,#D4A035 0%,#CC9933 60%,#B8872A 100%);box-shadow:0 2px 8px rgba(204,153,51,.30)}
  .header-brand .name{font-size:15pt;font-weight:700;color:#1C1C1C;letter-spacing:-.3px}
  .header-brand .sub{font-size:8pt;color:#8C7B65;letter-spacing:2px;text-transform:uppercase;margin-top:1px}
  .header-right{text-align:right;font-size:8pt;color:#8C7B65;line-height:1.8}
  .doc-title-block{text-align:center;padding:26px 0 18px;border-bottom:1px solid #EAE0D0;margin-bottom:18px}
  .doc-title{font-size:15pt;font-weight:700;color:#1C1C1C;text-transform:uppercase;letter-spacing:3px}
  .doc-subtitle{font-size:9.5pt;color:#8C7B65;font-style:italic;margin-top:6px}
  .gold-line{width:48px;height:2px;background:linear-gradient(90deg,#CC9933,#E4A853,#CC9933);margin:12px auto;border-radius:2px}
  .doc-num{display:inline-block;border:1.5px solid #CC9933;border-radius:8px;padding:4px 16px;font-size:11pt;margin-top:6px}
  .doc-num strong{color:#8a6d1f}
  .section-title{font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#CC9933;border-bottom:1.5px solid #E8DCC8;padding-bottom:6px;margin:18px 0 10px}
  .art{font-weight:700;margin:13px 0 3px;color:#1C1C1C;font-size:11.5px}
  .sub{font-weight:700;margin:10px 0 2px;color:#1C1C1C}
  .muted{color:#6b6150}.small{font-size:9.5px;color:#8C7B65}
  .box{background:#FDFAF5;border:1px solid #E8DCC8;border-left:3px solid #CC9933;border-radius:6px;padding:10px 14px;margin:10px 0}
  .footer{margin-top:22px;border-top:2px solid #CC9933;padding-top:10px}
  .sign-zone{display:flex;justify-content:space-between;margin-top:26px}
  .sign-box{width:45%;background:#FDFAF5;border:1px solid #E8DCC8;border-radius:6px;padding:12px 16px;min-height:96px;font-size:10px}
  .sig-label{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#8C7B65;border-bottom:1px solid #E8DCC8;padding-bottom:5px;margin-bottom:7px}
  .sig-name{font-weight:700;font-size:10pt;color:#1C1C1C}
  .sig-script{font-family:'Northwell',cursive;font-size:22pt;color:#CC9933;line-height:1;padding:6px 0 2px}
  .sig-line{border-bottom:1.5px dashed #CC9933;height:46px;margin-top:10px;opacity:.5}
  .sig-note{font-size:7.5pt;color:#A09282;margin-top:4px;line-height:1.5}
  ul{margin:4px 0 4px 18px;padding:0}li{margin:2px 0}
  table.parties{width:100%;border-collapse:collapse;font-size:10px;margin:6px 0}
  table.parties td{padding:7px 12px;border:1px solid #E8DCC8;vertical-align:top}
  table.parties td.k{width:34%;font-weight:600;color:#6B5840;background:#FBF6EC}
</style></head>
<body>

<div class="header">
  <div class="header-left">
    <div class="logo-square">{{#est_lauian}}L{{/est_lauian}}{{^est_lauian}}D{{/est_lauian}}</div>
    <div class="header-brand">
      <div class="name">{{agence_nom}}</div>
      <div class="sub">Conciergerie · Côte Basque</div>
    </div>
  </div>
  <div class="header-right">{{agence_adresse_ligne1}}<br>{{agence_adresse_ligne2}}<br>{{agence_tel}}<br>{{agence_email}}</div>
</div>

<div class="doc-title-block">
  <div class="doc-title">Contrat de prestation de service</div>
  <div class="gold-line"></div>
  <div class="doc-subtitle">Entre le prestataire indépendant et {{agence_nom}}</div>
  <div class="doc-num">N° <strong>{{contrat_numero}}</strong></div>
  {{#prestataire_siret}}<div class="small" style="margin-top:8px">Prestataire : <strong>{{prestataire_designation}}</strong> · SIRET <strong>{{prestataire_siret}}</strong></div>{{/prestataire_siret}}
</div>

<div class="section-title">Entre les soussignés</div>

<div class="sub">Le Prestataire</div>
<table class="parties">
  <tr><td class="k">Désignation</td><td><strong>{{prestataire_designation}}</strong></td></tr>
  {{#prestataire_statut}}<tr><td class="k">Statut</td><td>{{prestataire_statut}}</td></tr>{{/prestataire_statut}}
  {{#prestataire_siret}}<tr><td class="k">N° SIRET</td><td>{{prestataire_siret}}</td></tr>{{/prestataire_siret}}
  {{#prestataire_adresse}}<tr><td class="k">Adresse</td><td>{{prestataire_adresse}}</td></tr>{{/prestataire_adresse}}
  {{#prestataire_tel}}<tr><td class="k">Téléphone</td><td>{{prestataire_tel}}</td></tr>{{/prestataire_tel}}
  {{#prestataire_email}}<tr><td class="k">E-mail</td><td>{{prestataire_email}}</td></tr>{{/prestataire_email}}
  {{#prestataire_assurance}}<tr><td class="k">Assurance RC pro</td><td>{{prestataire_assurance}}</td></tr>{{/prestataire_assurance}}
</table>
<p><strong>Ci-après dénommé « le Prestataire », d'une part,</strong></p>

<div class="sub">Le Client</div>
<p>La société <strong>{{agence_nom}}</strong>, {{agence_forme}} au capital de {{agence_capital}} euros, immatriculée au RCS de {{agence_rcs}}, dont le siège social est situé {{agence_adresse}}, numéro de TVA intracommunautaire {{agence_tva}}, représentée par <strong>{{agence_representant}}</strong>, en sa qualité de {{agence_qualite}}, dûment habilité(e) aux fins des présentes.</p>
<p><strong>Ci-après dénommée « le Client », d'autre part,</strong></p>

<div class="section-title">Il a été préalablement exposé</div>
<p>{{agence_nom}} est une agence spécialisée dans la conciergerie et la gestion locative d'appartements et de maisons meublés sur la Côte Basque. À ce titre, elle a reçu mandat de la part de ses clients propriétaires afin de gérer leurs logements et d'y accueillir des voyageurs. Dans ce cadre, le Prestataire a souhaité proposer ses services au Client, étant en mesure de réaliser des prestations de préparation des logements et d'accueil des voyageurs. Ceci exposé, il a été convenu ce qui suit.</p>

<div class="art">Article 1 — Objet</div>
<p>Le présent contrat est un contrat de prestation de services ayant pour objet la réalisation de prestations de <strong>préparation des logements</strong> et d'<strong>accueil des voyageurs</strong> dans des logements meublés gérés par le Client, dans le respect du cahier des charges fourni en amont et mis à jour au besoin.</p>
<p><strong>1 — Préparation des logements :</strong> récupérer et rapporter les éléments nécessaires (clés, linge, produits) ; remettre le logement en état conformément au cahier des charges ; envoyer un compte-rendu via le Portail AE. <strong>2 — Accueil des voyageurs :</strong> vérifier l'état du logement avant l'arrivée ; accueillir les voyageurs, présenter le logement et son fonctionnement, remettre les clés ; envoyer un compte-rendu via le Portail AE. Des missions en cours de séjour ou des ménages de printemps pourront aussi être réalisés à la demande.</p>

<div class="art">Article 2 — Portail AE : outil officiel de mission</div>
<p>Le <strong>Portail AE {{agence_nom}}</strong> (application en ligne mise à disposition par le Client) constitue <strong>l'outil officiel unique</strong> de la relation : proposition et acceptation des missions, planning, comptes-rendus, photos, signalements d'incidents, prestations hors forfait et récapitulatifs de facturation y transitent. Le Prestataire s'engage à le consulter régulièrement, à y tenir son planning à jour et à y renseigner les comptes-rendus de chaque mission. Toute mission est réputée n'avoir été ni proposée ni acceptée en dehors du Portail.</p>

<div class="art">Article 3 — Attribution des missions et prix</div>
<p>Pour obtenir de nouvelles prestations, le Prestataire se connecte au Portail AE, sur lequel il choisit librement les missions qui l'intéressent. Pour chaque mission, le Client indique la date, l'heure (ou une tranche horaire), le lieu, un descriptif et un prix associé. Le prix peut varier selon la date et l'heure, le nombre de prestataires disponibles et les caractéristiques du logement. Le Client pourra faire évoluer ces éléments afin d'améliorer son système d'attribution.</p>

<div class="art">Article 4 — Prestations hors forfait</div>
<p>Outre les missions standard, des <strong>prestations hors forfait</strong> (ménage de printemps, gestion du linge, attente prolongée, intervention exceptionnelle, petit dépannage, etc.) peuvent être réalisées. Elles doivent être <strong>préalablement validées par le Client</strong> et sont saisies par le Prestataire dans le module « prestations hors forfait » du Portail AE, au tarif convenu. Toute prestation hors forfait non validée au préalable ne pourra donner lieu à rémunération.</p>

<div class="art">Article 5 — Facturation et paiement</div>
<p>La facturation est <strong>mensuelle</strong>. À la fin de chaque mois, le Prestataire établit une facture récapitulant l'ensemble des missions et prestations hors forfait <strong>validées</strong> au cours du mois écoulé, le Portail AE mettant à sa disposition le récapitulatif correspondant. Le règlement est effectué par <strong>virement bancaire</strong> sous <strong>{{delai_paiement}}</strong> à compter de la réception de la facture. Les éventuels frais annexes nécessaires à l'exécution d'une prestation, validés au préalable, sont facturés en sus sur relevé de dépenses. Le Prestataire fait son affaire personnelle de ses obligations sociales, fiscales et déclaratives.</p>

<div class="art">Article 6 — Durée</div>
<p>Le présent contrat est conclu pour une durée indéterminée, à compter de sa signature.</p>

<div class="art">Article 7 — Assurance responsabilité civile professionnelle</div>
<p>Le Prestataire est <strong>vivement encouragé à souscrire et à maintenir une assurance responsabilité civile professionnelle</strong> couvrant les dommages susceptibles d'être causés dans le cadre de ses prestations. S'il en dispose, il en remet l'attestation au Client et l'informe de toute modification, suspension ou résiliation. À défaut d'assurance, le Prestataire demeure personnellement responsable des dommages qu'il pourrait causer dans l'exécution de ses missions.</p>

<div class="art">Article 8 — Exécution et obligations de moyens</div>
<p>Le Prestataire s'engage à mener à bien les tâches précisées à l'article 1, conformément aux règles de l'art, en autonomie, avec professionnalisme et dans le respect des règles de sécurité. Le Client et les voyageurs pourront évaluer les qualités de propreté et d'accueil. En cas de non-respect du cahier des charges relevé par le voyageur ou le Client, le Prestataire s'engage à retourner au logement afin de corriger sa prestation, sans rémunération supplémentaire. Si l'absence de résultat provient d'une faute du Client, le Prestataire est déchargé de toute responsabilité. Lorsqu'une mission lui a été affectée, le Prestataire s'engage à la réaliser ; en cas de force majeure, il avertit le Client au plus tôt afin qu'une solution de remplacement soit trouvée.</p>

<div class="art">Article 9 — Clés et codes d'accès</div>
<p>Les clés, badges et codes d'accès remis au Prestataire le sont <strong>aux seules fins de l'exécution des missions acceptées</strong>. Le Prestataire en assure la garde et la stricte confidentialité : il s'interdit de les dupliquer, de les photographier, de les communiquer ou de les confier à quiconque. Il les restitue immédiatement à la demande du Client et au plus tard à la fin du contrat. <strong>Toute perte ou vol doit être signalé sans délai</strong> ; en cas de négligence, les frais de remplacement des clés et/ou de changement de serrure ou de codes seront à la charge du Prestataire.</p>

<div class="art">Article 10 — Déclaration d'incident</div>
<p>Tout incident, dégât, dysfonctionnement, anomalie de sécurité ou manquement constaté dans un logement (matériel, propreté, intrusion, sinistre…) doit être <strong>signalé sans délai au Client via le module « Signaler » du Portail AE</strong>, et au plus tard dans un délai de <strong>{{incident_delai}}</strong>, accompagné de photographies lorsque c'est possible. Le Prestataire ne réalise aucune réparation de sa propre initiative sans accord du Client, sauf mesure conservatoire urgente.</p>

<div class="art">Article 11 — Confidentialité et discrétion</div>
<p>Le Prestataire considère comme strictement confidentiel et s'interdit de divulguer toute information, document ou donnée dont il a connaissance à l'occasion du présent contrat. Il observe une <strong>discrétion absolue à l'égard des propriétaires et des voyageurs</strong> : il respecte leur vie privée, leurs biens, leur identité et la confidentialité des logements, des codes et des séjours. Il s'interdit toute communication d'informations à des tiers, toute publication (notamment sur les réseaux sociaux) et tout contact direct avec les propriétaires en dehors du cadre défini par le Client. Cette obligation survit à la fin du contrat.</p>

<div class="art">Article 12 — Interdiction d'accès et non-sollicitation</div>
<p>Le Prestataire s'interdit d'accéder aux logements en dehors des périodes d'accueil et de préparation, et seulement sur demande du Client. Il ne pénètre jamais dans un logement pour un usage autre que professionnel et ne permet à personne d'y pénétrer sans autorisation. Le manquement à cette obligation pourra entraîner une plainte auprès des autorités et la résiliation immédiate. Par ailleurs, le Prestataire s'engage à ne pas contracter directement avec les propriétaires clients de la Société pendant toute la durée du partenariat et pendant <strong>{{non_solicit_jours}} jours</strong> suivant la fin du contrat.</p>

<div class="art">Article 13 — Obligation d'image</div>
<p>Durant la durée du contrat, le Prestataire autorise à titre gracieux le Client à utiliser une photo qu'il aura fournie, afin de communiquer en amont avec les voyageurs pour les accueils, conformément aux dispositions relatives au droit à l'image.</p>

<div class="section-title">Obligations du Client</div>
<div class="art">Article 14 — Information et collaboration</div>
<p>Le Client s'engage à fournir au Prestataire toute information et tout matériel nécessaires à l'accomplissement de ses missions : informations sur le logement (accès, composition, fonctionnement), sur les voyageurs (nombre, coordonnées) et sur la mission (cahier des charges préparation et accueil). Il tient à sa disposition, via le Portail AE, les informations utiles à la bonne réalisation des prestations.</p>

<div class="art">Article 15 — Responsabilités</div>
<p>Quels que soient les fondements de sa réclamation, la responsabilité éventuelle du Prestataire au titre de l'exécution du présent contrat sera limitée à un montant n'excédant pas la somme totale effectivement payée par le Client pour les prestations concernées, sauf faute manifeste ayant conduit à des dommages matériels pouvant atteindre les immeubles, installations, matériels et mobiliers du Client et des clients propriétaires.</p>

<div class="art">Article 16 — Pénalités</div>
<p>La non-présentation à un rendez-vous de préparation ou d'accueil accepté et non annulé au moins 48 heures à l'avance engendre l'obligation pour le Prestataire de payer au Client la somme de <strong>{{penalite_montant}} €</strong> à titre de pénalité, retenue sur le montant restant dû.</p>

<div class="art">Article 17 — Résiliation pour faute</div>
<p>En cas de non-présentation à un rendez-vous accepté, d'insatisfaction manifeste du Client ou des voyageurs, de manquement aux obligations du Prestataire, de manquement à la confidentialité ou de sous-traitance non autorisée, le Client pourra résilier le présent contrat avec application immédiate.</p>

<div class="art">Article 18 — Résiliation hors faute</div>
<p>Le présent contrat pourra être résilié à tout instant par chacune des parties, sous réserve d'un préavis de <strong>{{preavis_resiliation}}</strong> notifié par e-mail ou courrier postal simple.</p>

<div class="art">Article 19 — Non sous-traitance</div>
<p>Pour des raisons d'organisation, le Prestataire ne pourra pas sous-traiter les missions, sauf accord préalable du Client. Il pourra toutefois introduire auprès du Client de nouveaux prestataires potentiels en vue de leur référencement.</p>

<div class="art">Article 20 — Cession</div>
<p>Le présent contrat est conclu en considération de la personne du Prestataire, qui ne pourra substituer de tiers dans la réalisation des tâches définies.</p>

<div class="art">Article 21 — Non-exclusivité et indépendance</div>
<p>Le Prestataire exerce son activité <strong>en toute indépendance, sans aucun lien de subordination</strong> avec {{agence_nom}}. Il est libre d'accepter ou non les missions proposées et de travailler pour d'autres clients. Il organise librement son temps et ses moyens, et demeure seul responsable de ses obligations sociales, fiscales et déclaratives. <strong>Le Prestataire s'engage à informer {{agence_nom}} sans délai de toute modification de sa situation ou de son statut</strong> (cessation ou radiation d'activité, changement de forme juridique, perte de la qualité d'auto-entrepreneur, modification du numéro SIRET, suspension ou résiliation de son assurance responsabilité civile professionnelle).</p>

<div class="art">Article 22 — Interprétation</div>
<p>Le présent contrat et ses annexes contiennent l'intégralité des engagements des parties ; les correspondances, offres ou propositions antérieures sont considérées comme non-avenues.</p>

<div class="art">Article 23 — Juridiction compétente</div>
<p>Tout litige relatif à la formation, l'exécution ou l'interprétation du présent contrat relèvera de la compétence exclusive du tribunal de commerce de {{agence_ville_tribunal}}.</p>

<div class="section-title">Collecte des données personnelles</div>
<p class="small">Les données personnelles du Prestataire, collectées à l'occasion des présentes, font l'objet de traitements nécessaires à l'exécution du contrat, conservées pendant sa durée augmentée des délais légaux. Le Prestataire peut exercer ses droits auprès du Client ou saisir la CNIL (www.cnil.fr). <span class="chk"></span><strong>En signant, le Prestataire l'accepte expressément.</strong></p>

<div class="footer">
  <div class="section-title" style="margin-top:0">Date et signatures</div>
  <p>Fait à {{lieu_signature}}, le {{contrat_date}}, et signé électroniquement, chaque partie en conservant un exemplaire sur un support durable garantissant l'intégrité de l'acte.</p>
  <div class="sign-zone">
    <div class="sign-box">
      <div class="sig-label">Le Prestataire — Lu et approuvé</div>
      <div class="sig-name">{{prestataire_designation}}</div>
      {{#signature_prestataire}}<div class="sig-script">{{signature_prestataire}}</div>
      <div class="sig-note">Signature électronique apposée{{#signature_horodatage}} le {{signature_horodatage}}{{/signature_horodatage}}<br>portail prestataire {{agence_nom}}</div>{{/signature_prestataire}}
      {{^signature_prestataire}}<div class="sig-line"></div>{{/signature_prestataire}}
    </div>
    <div class="sign-box">
      <div class="sig-label">Le Client</div>
      <div class="sig-name">{{agence_representant}}</div>
      <div class="sig-script">{{agence_representant}}</div>
      <div class="sig-note">{{agence_qualite}} — {{agence_nom}}</div>
    </div>
  </div>
  <p class="small" style="margin-top:18px">{{#signature_ref}}Signature électronique : {{signature_mode}} · Horodatage {{signature_horodatage}} · Réf. {{signature_ref}}{{/signature_ref}}{{^signature_ref}}Document établi pour signature électronique sécurisée dans le portail prestataire.{{/signature_ref}}</p>
</div>

</body></html>
$aetpl$, '{"defaults": {"penalite_montant": "50", "preavis_resiliation": "trois semaines", "non_solicit_jours": "365", "delai_paiement": "30 jours", "incident_delai": "24 heures"}}'::jsonb, true);
