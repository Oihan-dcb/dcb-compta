-- Charge le template contrat de prestation AE (DCB + Lauïan) dans contract_templates.
-- Source de vérité : dcb-planning/contracts/contrat_prestation_ae_2026-v1.html
delete from public.contract_templates where type_contrat='prestation_ae' and version='2026-v1';
insert into public.contract_templates (agence,langue,type_contrat,version,nom,contenu_html,variables_attendues,is_active) values
('dcb','fr','prestation_ae','2026-v1','Contrat de prestation AE — DCB', $aetpl$<!--
  Template CONTRAT DE PRESTATION DE SERVICE — Auto-entrepreneur (AE) — v1 (2026)
  Source de vérité versionnée — à charger dans contract_templates (type_contrat='prestation_ae').
  Moteur : renderMustache (api/generate-contrat-ae.js) — {{var}}, {{#cond}}…{{/cond}}, {{^cond}}…{{/cond}}.
  Entité variable DCB / Lauïan : {{#est_lauian}}…{{/est_lauian}}.
  Le PRESTATAIRE = l'auto-entrepreneur (ménage/accueil). Le CLIENT = l'agence (conciergerie).
  Signé dans le portail AE (connecté). Données : auto_entrepreneur + ae_onboarding.reponses.
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
  .art{font-weight:700;margin:14px 0 3px;color:#1C1C1C;font-size:11.5px}
  .sub{font-weight:700;margin:10px 0 2px;color:#1C1C1C}
  .partie-box{background:#FDFAF5;border:1px solid #E8DCC8;border-left:3px solid #CC9933;border-radius:6px;padding:12px 16px;margin:8px 0}
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
<p>{{agence_nom}} est une agence spécialisée dans la gestion locative d'appartements et de maisons meublés. À ce titre, elle a reçu mandat de la part de ses clients propriétaires afin de gérer leurs logements et d'y accueillir des locataires.</p>
<p>Dans ce cadre, le Prestataire a souhaité proposer ses services au Client, car il est en mesure de réaliser des prestations de préparation des logements et d'accueil des locataires. Ceci exposé, il a été convenu ce qui suit.</p>

<div class="art">Article 1 — Objet</div>
<p>Le présent contrat est un contrat de prestation de services ayant pour objet la réalisation de prestations de <strong>préparation des logements</strong> et d'<strong>accueil des locataires</strong> dans des logements meublés gérés par le Client.</p>
<p><strong>1 — Chaque mission de préparation des logements</strong> consistera à :</p>
<ul>
  <li>Récupérer et rapporter dans une agence du Client les éléments nécessaires à la réalisation de la prestation (clés, linge de maison, produits divers…).</li>
  <li>Remettre les logements en état.</li>
  <li>Envoyer un compte-rendu au Client afin de remonter différentes informations.</li>
</ul>
<p><strong>2 — Chaque mission d'accueil des locataires</strong> consistera à :</p>
<ul>
  <li>Vérifier l'état général du logement avant l'arrivée des locataires et prendre les dispositions nécessaires afin que le logement soit fonctionnel.</li>
  <li>Accueillir les locataires, leur présenter le logement et son fonctionnement, répondre à leurs questions et leur remettre les clés.</li>
  <li>Envoyer un compte-rendu au Client afin de remonter différentes informations liées à la prestation et au logement.</li>
</ul>
<p>Le tout en respectant le cahier des charges du Client, fourni en amont de la signature du présent contrat et mis à jour au besoin. Des missions de préparation pourront aussi être effectuées en cours de séjour, à la demande des locataires, ainsi que des ménages de printemps à la demande du Client.</p>

<div class="art">Article 2 — Attribution des prestations et prix</div>
<p>Pour obtenir de nouvelles prestations, le Prestataire se connectera à une interface conçue par le Client (le portail prestataire), sur laquelle il pourra choisir les missions qui l'intéressent. Pour chaque prestation, le Client indiquera la date, l'heure (ou à défaut une tranche horaire), un lieu, un descriptif ainsi qu'un prix associé. Le Prestataire sera libre de choisir les missions qui l'intéressent en fonction de ces éléments.</p>
<p>Pour chaque mission, le prix proposé au Prestataire pourra varier en fonction de la date et de l'heure de la mission, du nombre de prestataires disponibles et de la qualité du logement. Le Client pourra modifier les éléments pris en compte à tout moment afin d'améliorer son système d'attribution.</p>
<p>Les éventuels frais annexes nécessaires à l'exécution de la prestation et validés au préalable par le Client seront facturés en sus, sur relevé de dépenses. Les sommes dues au titre des prestations seront réglées par virement bancaire.</p>

<div class="art">Article 3 — Durée</div>
<p>Le présent contrat est conclu pour une durée indéterminée, à compter de sa signature.</p>

<div class="art">Article 4 — Exécution de la prestation</div>
<p>Le Prestataire s'engage à mener à bien la tâche précisée à l'article 1. Le Client et les locataires pourront être amenés à évaluer les qualités de propreté et d'accueil. Le Prestataire effectuera ses missions avec professionnalisme.</p>

<div class="art">Article 5 — Calendrier — délais</div>
<p>Les missions pourront être proposées très en avance ou le jour même. Dans tous les cas, il appartiendra au Prestataire d'accepter ou non une mission et de tenir à jour son planning. Lorsqu'une mission lui aura été affectée, le Prestataire s'engage à la réaliser dans les conditions prévues. En cas de force majeure, il avertira le Client au plus tôt afin qu'une solution de remplacement puisse être trouvée. L'article 13 s'applique en cas de non-présentation à un rendez-vous d'accueil ou de préparation préalablement accepté.</p>

<div class="art">Article 6 — Obligations de moyens</div>
<p>Pour l'accomplissement des diligences et prestations prévues à l'article 1, le Prestataire s'engage à donner ses meilleurs soins, conformément aux règles de l'art, en autonomie et en respectant les règles de sécurité. En cas de non-respect du cahier des charges relevé par le locataire ou le Client, le Prestataire s'engage à retourner au logement afin de corriger sa prestation, sans prétendre à rémunération. Dans le cas où l'absence de résultat proviendrait d'une faute du Client, le Prestataire sera déchargé de toute responsabilité.</p>

<div class="art">Article 7 — Obligation de confidentialité</div>
<p>Le Prestataire considérera comme strictement confidentiel, et s'interdit de divulguer, toute information, document, donnée ou concept dont il pourra avoir connaissance à l'occasion du présent contrat. Le Prestataire ne saurait toutefois être tenu pour responsable d'aucune divulgation si les éléments divulgués étaient dans le domaine public à la date de la divulgation, ou s'il en avait connaissance, ou les obtenait de tiers par des moyens légitimes.</p>

<div class="art">Article 8 — Interdiction d'accès et non-sollicitation</div>
<p>Le Prestataire s'interdira d'accéder aux logements en dehors des périodes d'accueil et de préparation, et seulement sur demande formulée par le Client. Il ne pénétrera jamais dans les logements pour un usage autre que professionnel et ne permettra jamais à quiconque d'y pénétrer sans en avoir reçu l'autorisation du Client. Le manquement à cette obligation pourra s'accompagner d'une plainte auprès des autorités de police et de la résiliation immédiate du présent contrat.</p>
<p>Par ailleurs, le Prestataire s'engage à ne pas contracter avec les propriétaires clients de la Société pendant toute la durée du partenariat et pendant une période supplémentaire de <strong>{{non_solicit_jours}} jours</strong> en cas de rupture du contrat, à compter de la date effective de fin de contrat.</p>

<div class="art">Article 9 — Obligation d'image</div>
<p>Durant la durée du contrat, le Prestataire autorise à titre gracieux le Client à utiliser une photo qu'il aura fournie et à utiliser son image pour communiquer en amont avec les locataires pour les accueils, conformément aux dispositions relatives au droit à l'image et aux droits de la personnalité.</p>

<div class="section-title">Obligations du Client</div>
<div class="art">Article 10 — Obligation d'information</div>
<p>Le Client s'engage à donner au Prestataire toute information et matériel nécessaires à l'accomplissement de ses missions, et notamment : les informations concernant le logement (accès, composition, fonctionnement), les informations concernant les locataires (nombre, nationalités, coordonnées) et les informations concernant la mission à accomplir (cahier des charges préparation, cahier des charges accueil…).</p>

<div class="art">Article 11 — Obligation de collaboration</div>
<p>Le Client tiendra à la disposition du Prestataire toutes les informations pouvant contribuer à la bonne réalisation de l'objet du présent contrat.</p>

<div class="art">Article 12 — Responsabilités</div>
<p>Le Client convient que, quels que soient les fondements de sa réclamation et la procédure suivie pour la mettre en œuvre, la responsabilité éventuelle du Prestataire à raison de l'exécution des obligations prévues au présent contrat sera limitée à un montant n'excédant pas la somme totale effectivement payée par le Client pour les services ou tâches fournis par le Prestataire, sauf faute manifeste ayant conduit à des dommages matériels pouvant atteindre les immeubles, installations, matériels et mobiliers du Client et des clients propriétaires.</p>

<div class="art">Article 13 — Pénalités</div>
<p>La non-présentation à un rendez-vous de préparation d'un logement ou d'accueil accepté et non annulé au moins 48 heures avant la date et l'heure de rendez-vous prévu engendrera l'obligation pour le Prestataire de payer au Client la somme de <strong>{{penalite_montant}} €</strong> en pénalités. Ces sommes seraient retenues sur le montant restant dû au Prestataire.</p>

<div class="art">Article 14 — Résiliation pour faute</div>
<p>En cas de non-présentation à un rendez-vous de préparation d'un logement ou d'accueil prévu et accepté, d'insatisfaction manifeste du Client ou des locataires, de constatation d'un manquement à ses obligations de la part du Prestataire, ou de sous-traitance non autorisée au préalable, le Client pourra résilier purement et simplement le présent contrat avec application immédiate.</p>

<div class="art">Article 15 — Résiliation hors faute</div>
<p>Le présent contrat pourra être résilié à tout instant par chacune des parties, sous réserve d'un préavis de <strong>{{preavis_resiliation}}</strong> envoyé par e-mail ou courrier postal simple.</p>

<div class="art">Article 16 — Non sous-traitance</div>
<p>Pour des raisons d'organisation, le Prestataire ne pourra pas sous-traiter les missions à quiconque, sauf accord préalable du Client. Le Prestataire pourra cependant introduire auprès du Client de nouveaux prestataires potentiels en vue de les référencer.</p>

<div class="art">Article 17 — Cession de contrat</div>
<p>Le présent contrat est conclu en considération de la personne du Prestataire, qui ne pourra substituer de tiers dans la réalisation de la tâche ci-dessus définie.</p>

<div class="art">Article 18 — Référencement</div>
<p>Le Client accepte que le Prestataire puisse faire figurer parmi ses références les missions accomplies dans le cadre du présent contrat.</p>

<div class="art">Article 19 — Non-exclusivité et indépendance</div>
<p>Le Prestataire exerce son activité en toute indépendance, sans aucun lien de subordination avec la société {{agence_nom}}. Il est libre d'accepter ou non les missions proposées et est libre de travailler pour des clients autres que {{agence_nom}}. Le Prestataire est seul responsable de ses obligations sociales, fiscales et déclaratives liées à son statut. {{agence_nom}} pourra mettre fin au contrat de prestation à tout moment, sans préavis autre que celui précisé au présent contrat.</p>

<div class="art">Article 20 — Interprétation du contrat</div>
<p>Le présent contrat et ses annexes contiennent tous les engagements des parties ; les correspondances, offres ou propositions antérieures à la signature des présentes sont considérées comme non-avenues.</p>

<div class="art">Article 21 — Juridiction compétente</div>
<p>Tout litige susceptible de s'élever entre les parties, à propos de la formation, de l'exécution ou de l'interprétation du présent contrat, sera de la compétence exclusive du tribunal de commerce de {{agence_ville_tribunal}}.</p>

<div class="section-title">Collecte des données personnelles</div>
<p class="small">Les données à caractère personnel du Prestataire, collectées à l'occasion des présentes, font l'objet de traitements nécessaires à l'exécution du contrat et conservées pendant sa durée augmentée des délais légaux. Le Prestataire peut exercer ses droits auprès du Client ou saisir la CNIL (www.cnil.fr). <span class="chk"></span><strong>En signant, le Prestataire l'accepte expressément.</strong></p>

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
$aetpl$, '{"defaults":{"penalite_montant":"50","preavis_resiliation":"trois semaines","non_solicit_jours":"365"}}'::jsonb, true),
('lauian','fr','prestation_ae','2026-v1','Contrat de prestation AE — Lauïan', $aetpl$<!--
  Template CONTRAT DE PRESTATION DE SERVICE — Auto-entrepreneur (AE) — v1 (2026)
  Source de vérité versionnée — à charger dans contract_templates (type_contrat='prestation_ae').
  Moteur : renderMustache (api/generate-contrat-ae.js) — {{var}}, {{#cond}}…{{/cond}}, {{^cond}}…{{/cond}}.
  Entité variable DCB / Lauïan : {{#est_lauian}}…{{/est_lauian}}.
  Le PRESTATAIRE = l'auto-entrepreneur (ménage/accueil). Le CLIENT = l'agence (conciergerie).
  Signé dans le portail AE (connecté). Données : auto_entrepreneur + ae_onboarding.reponses.
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
  .art{font-weight:700;margin:14px 0 3px;color:#1C1C1C;font-size:11.5px}
  .sub{font-weight:700;margin:10px 0 2px;color:#1C1C1C}
  .partie-box{background:#FDFAF5;border:1px solid #E8DCC8;border-left:3px solid #CC9933;border-radius:6px;padding:12px 16px;margin:8px 0}
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
<p>{{agence_nom}} est une agence spécialisée dans la gestion locative d'appartements et de maisons meublés. À ce titre, elle a reçu mandat de la part de ses clients propriétaires afin de gérer leurs logements et d'y accueillir des locataires.</p>
<p>Dans ce cadre, le Prestataire a souhaité proposer ses services au Client, car il est en mesure de réaliser des prestations de préparation des logements et d'accueil des locataires. Ceci exposé, il a été convenu ce qui suit.</p>

<div class="art">Article 1 — Objet</div>
<p>Le présent contrat est un contrat de prestation de services ayant pour objet la réalisation de prestations de <strong>préparation des logements</strong> et d'<strong>accueil des locataires</strong> dans des logements meublés gérés par le Client.</p>
<p><strong>1 — Chaque mission de préparation des logements</strong> consistera à :</p>
<ul>
  <li>Récupérer et rapporter dans une agence du Client les éléments nécessaires à la réalisation de la prestation (clés, linge de maison, produits divers…).</li>
  <li>Remettre les logements en état.</li>
  <li>Envoyer un compte-rendu au Client afin de remonter différentes informations.</li>
</ul>
<p><strong>2 — Chaque mission d'accueil des locataires</strong> consistera à :</p>
<ul>
  <li>Vérifier l'état général du logement avant l'arrivée des locataires et prendre les dispositions nécessaires afin que le logement soit fonctionnel.</li>
  <li>Accueillir les locataires, leur présenter le logement et son fonctionnement, répondre à leurs questions et leur remettre les clés.</li>
  <li>Envoyer un compte-rendu au Client afin de remonter différentes informations liées à la prestation et au logement.</li>
</ul>
<p>Le tout en respectant le cahier des charges du Client, fourni en amont de la signature du présent contrat et mis à jour au besoin. Des missions de préparation pourront aussi être effectuées en cours de séjour, à la demande des locataires, ainsi que des ménages de printemps à la demande du Client.</p>

<div class="art">Article 2 — Attribution des prestations et prix</div>
<p>Pour obtenir de nouvelles prestations, le Prestataire se connectera à une interface conçue par le Client (le portail prestataire), sur laquelle il pourra choisir les missions qui l'intéressent. Pour chaque prestation, le Client indiquera la date, l'heure (ou à défaut une tranche horaire), un lieu, un descriptif ainsi qu'un prix associé. Le Prestataire sera libre de choisir les missions qui l'intéressent en fonction de ces éléments.</p>
<p>Pour chaque mission, le prix proposé au Prestataire pourra varier en fonction de la date et de l'heure de la mission, du nombre de prestataires disponibles et de la qualité du logement. Le Client pourra modifier les éléments pris en compte à tout moment afin d'améliorer son système d'attribution.</p>
<p>Les éventuels frais annexes nécessaires à l'exécution de la prestation et validés au préalable par le Client seront facturés en sus, sur relevé de dépenses. Les sommes dues au titre des prestations seront réglées par virement bancaire.</p>

<div class="art">Article 3 — Durée</div>
<p>Le présent contrat est conclu pour une durée indéterminée, à compter de sa signature.</p>

<div class="art">Article 4 — Exécution de la prestation</div>
<p>Le Prestataire s'engage à mener à bien la tâche précisée à l'article 1. Le Client et les locataires pourront être amenés à évaluer les qualités de propreté et d'accueil. Le Prestataire effectuera ses missions avec professionnalisme.</p>

<div class="art">Article 5 — Calendrier — délais</div>
<p>Les missions pourront être proposées très en avance ou le jour même. Dans tous les cas, il appartiendra au Prestataire d'accepter ou non une mission et de tenir à jour son planning. Lorsqu'une mission lui aura été affectée, le Prestataire s'engage à la réaliser dans les conditions prévues. En cas de force majeure, il avertira le Client au plus tôt afin qu'une solution de remplacement puisse être trouvée. L'article 13 s'applique en cas de non-présentation à un rendez-vous d'accueil ou de préparation préalablement accepté.</p>

<div class="art">Article 6 — Obligations de moyens</div>
<p>Pour l'accomplissement des diligences et prestations prévues à l'article 1, le Prestataire s'engage à donner ses meilleurs soins, conformément aux règles de l'art, en autonomie et en respectant les règles de sécurité. En cas de non-respect du cahier des charges relevé par le locataire ou le Client, le Prestataire s'engage à retourner au logement afin de corriger sa prestation, sans prétendre à rémunération. Dans le cas où l'absence de résultat proviendrait d'une faute du Client, le Prestataire sera déchargé de toute responsabilité.</p>

<div class="art">Article 7 — Obligation de confidentialité</div>
<p>Le Prestataire considérera comme strictement confidentiel, et s'interdit de divulguer, toute information, document, donnée ou concept dont il pourra avoir connaissance à l'occasion du présent contrat. Le Prestataire ne saurait toutefois être tenu pour responsable d'aucune divulgation si les éléments divulgués étaient dans le domaine public à la date de la divulgation, ou s'il en avait connaissance, ou les obtenait de tiers par des moyens légitimes.</p>

<div class="art">Article 8 — Interdiction d'accès et non-sollicitation</div>
<p>Le Prestataire s'interdira d'accéder aux logements en dehors des périodes d'accueil et de préparation, et seulement sur demande formulée par le Client. Il ne pénétrera jamais dans les logements pour un usage autre que professionnel et ne permettra jamais à quiconque d'y pénétrer sans en avoir reçu l'autorisation du Client. Le manquement à cette obligation pourra s'accompagner d'une plainte auprès des autorités de police et de la résiliation immédiate du présent contrat.</p>
<p>Par ailleurs, le Prestataire s'engage à ne pas contracter avec les propriétaires clients de la Société pendant toute la durée du partenariat et pendant une période supplémentaire de <strong>{{non_solicit_jours}} jours</strong> en cas de rupture du contrat, à compter de la date effective de fin de contrat.</p>

<div class="art">Article 9 — Obligation d'image</div>
<p>Durant la durée du contrat, le Prestataire autorise à titre gracieux le Client à utiliser une photo qu'il aura fournie et à utiliser son image pour communiquer en amont avec les locataires pour les accueils, conformément aux dispositions relatives au droit à l'image et aux droits de la personnalité.</p>

<div class="section-title">Obligations du Client</div>
<div class="art">Article 10 — Obligation d'information</div>
<p>Le Client s'engage à donner au Prestataire toute information et matériel nécessaires à l'accomplissement de ses missions, et notamment : les informations concernant le logement (accès, composition, fonctionnement), les informations concernant les locataires (nombre, nationalités, coordonnées) et les informations concernant la mission à accomplir (cahier des charges préparation, cahier des charges accueil…).</p>

<div class="art">Article 11 — Obligation de collaboration</div>
<p>Le Client tiendra à la disposition du Prestataire toutes les informations pouvant contribuer à la bonne réalisation de l'objet du présent contrat.</p>

<div class="art">Article 12 — Responsabilités</div>
<p>Le Client convient que, quels que soient les fondements de sa réclamation et la procédure suivie pour la mettre en œuvre, la responsabilité éventuelle du Prestataire à raison de l'exécution des obligations prévues au présent contrat sera limitée à un montant n'excédant pas la somme totale effectivement payée par le Client pour les services ou tâches fournis par le Prestataire, sauf faute manifeste ayant conduit à des dommages matériels pouvant atteindre les immeubles, installations, matériels et mobiliers du Client et des clients propriétaires.</p>

<div class="art">Article 13 — Pénalités</div>
<p>La non-présentation à un rendez-vous de préparation d'un logement ou d'accueil accepté et non annulé au moins 48 heures avant la date et l'heure de rendez-vous prévu engendrera l'obligation pour le Prestataire de payer au Client la somme de <strong>{{penalite_montant}} €</strong> en pénalités. Ces sommes seraient retenues sur le montant restant dû au Prestataire.</p>

<div class="art">Article 14 — Résiliation pour faute</div>
<p>En cas de non-présentation à un rendez-vous de préparation d'un logement ou d'accueil prévu et accepté, d'insatisfaction manifeste du Client ou des locataires, de constatation d'un manquement à ses obligations de la part du Prestataire, ou de sous-traitance non autorisée au préalable, le Client pourra résilier purement et simplement le présent contrat avec application immédiate.</p>

<div class="art">Article 15 — Résiliation hors faute</div>
<p>Le présent contrat pourra être résilié à tout instant par chacune des parties, sous réserve d'un préavis de <strong>{{preavis_resiliation}}</strong> envoyé par e-mail ou courrier postal simple.</p>

<div class="art">Article 16 — Non sous-traitance</div>
<p>Pour des raisons d'organisation, le Prestataire ne pourra pas sous-traiter les missions à quiconque, sauf accord préalable du Client. Le Prestataire pourra cependant introduire auprès du Client de nouveaux prestataires potentiels en vue de les référencer.</p>

<div class="art">Article 17 — Cession de contrat</div>
<p>Le présent contrat est conclu en considération de la personne du Prestataire, qui ne pourra substituer de tiers dans la réalisation de la tâche ci-dessus définie.</p>

<div class="art">Article 18 — Référencement</div>
<p>Le Client accepte que le Prestataire puisse faire figurer parmi ses références les missions accomplies dans le cadre du présent contrat.</p>

<div class="art">Article 19 — Non-exclusivité et indépendance</div>
<p>Le Prestataire exerce son activité en toute indépendance, sans aucun lien de subordination avec la société {{agence_nom}}. Il est libre d'accepter ou non les missions proposées et est libre de travailler pour des clients autres que {{agence_nom}}. Le Prestataire est seul responsable de ses obligations sociales, fiscales et déclaratives liées à son statut. {{agence_nom}} pourra mettre fin au contrat de prestation à tout moment, sans préavis autre que celui précisé au présent contrat.</p>

<div class="art">Article 20 — Interprétation du contrat</div>
<p>Le présent contrat et ses annexes contiennent tous les engagements des parties ; les correspondances, offres ou propositions antérieures à la signature des présentes sont considérées comme non-avenues.</p>

<div class="art">Article 21 — Juridiction compétente</div>
<p>Tout litige susceptible de s'élever entre les parties, à propos de la formation, de l'exécution ou de l'interprétation du présent contrat, sera de la compétence exclusive du tribunal de commerce de {{agence_ville_tribunal}}.</p>

<div class="section-title">Collecte des données personnelles</div>
<p class="small">Les données à caractère personnel du Prestataire, collectées à l'occasion des présentes, font l'objet de traitements nécessaires à l'exécution du contrat et conservées pendant sa durée augmentée des délais légaux. Le Prestataire peut exercer ses droits auprès du Client ou saisir la CNIL (www.cnil.fr). <span class="chk"></span><strong>En signant, le Prestataire l'accepte expressément.</strong></p>

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
$aetpl$, '{"defaults":{"penalite_montant":"50","preavis_resiliation":"trois semaines","non_solicit_jours":"365"}}'::jsonb, true);
