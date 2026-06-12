-- Phase 2.3 (prerequis) — Chargement template mandat administration (DCB + Lauian) v2026-v1.
-- Source: dcb-planning/contracts/mandat_administration_2026-v1.html (regenere automatiquement).
update contract_templates set is_active=false where type_contrat='mandat_administration' and is_active=true;
delete from contract_templates where type_contrat='mandat_administration' and version='2026-v1';
insert into contract_templates (agence,langue,type_contrat,version,nom,contenu_html,variables_attendues,is_active) values
('dcb','fr','mandat_administration','2026-v1','Mandat d''administration — DCB',$tpl$<!--
  Template MANDAT D'ADMINISTRATION - LOCATION SAISONNIÈRE — v1 (2026)
  Source de vérité versionnée — à charger dans contract_templates (type_contrat='mandat_administration').
  Moteur : renderMustache (api/generate-contract.js) — {{var}}, {{#cond}}…{{/cond}}, {{^cond}}…{{/cond}}.
  Entité variable DCB / Lauïan : {{#est_lauian}}…{{/est_lauian}} vs {{^est_lauian}}…{{/est_lauian}}.
  UN mandat = UN bien (cohérent avec clôture/facturation/accès par bien).
  Données : proprietaire + proprietaire_onboarding.reponses + bien + mandat_gestion.
  Corrections relecture : couverture premium, résidence principale conditionnelle,
  rétractation conditionnelle, durée en variable, mono-bien.
-->
<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<style>
  @font-face{font-family:'Northwell';src:url('https://dcb-contrats.vercel.app/fonts/Northwell.ttf') format('truetype');font-weight:normal;font-style:normal}
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#2C2416;font-size:11px;line-height:1.55;margin:0;padding:0}
  .page{padding:34px 46px}
  .page-break{page-break-after:always}
  /* En-tête (inspiré des contrats voyageurs DCB) */
  .header{display:flex;align-items:center;justify-content:space-between;padding:8px 0 20px;position:relative;margin-bottom:0}
  .header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:3px;border-radius:2px;background:linear-gradient(90deg,#CC9933 0%,#E4A853 50%,#CC9933 100%)}
  .header-left{display:flex;align-items:center;gap:14px}
  .logo-square{width:50px;height:50px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:700;flex-shrink:0;background:linear-gradient(135deg,#D4A035 0%,#CC9933 60%,#B8872A 100%);box-shadow:0 2px 8px rgba(204,153,51,.30)}
  .header-brand .name{font-size:15pt;font-weight:700;color:#1C1C1C;letter-spacing:-.3px}
  .header-brand .sub{font-size:8pt;color:#8C7B65;letter-spacing:2px;text-transform:uppercase;margin-top:1px}
  .header-right{text-align:right;font-size:8pt;color:#8C7B65;line-height:1.8}
  /* Bloc titre */
  .doc-title-block{text-align:center;padding:26px 0 18px;border-bottom:1px solid #EAE0D0;margin-bottom:24px}
  .doc-title{font-size:15pt;font-weight:700;color:#1C1C1C;text-transform:uppercase;letter-spacing:3px}
  .doc-subtitle{font-size:9.5pt;color:#8C7B65;font-style:italic;margin-top:6px}
  .gold-line{width:48px;height:2px;background:linear-gradient(90deg,#CC9933,#E4A853,#CC9933);margin:12px auto;border-radius:2px}
  .doc-num{display:inline-block;border:1.5px solid #CC9933;border-radius:8px;padding:4px 16px;font-size:11pt;margin-top:6px}
  .doc-num strong{color:#8a6d1f}
  /* Corps */
  .section-title{font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#CC9933;border-bottom:1.5px solid #E8DCC8;padding-bottom:6px;margin:20px 0 12px}
  .sub{font-weight:700;margin:12px 0 2px;color:#1C1C1C}
  .bien-card,.partie-box{background:#FDFAF5;border:1px solid #E8DCC8;border-left:3px solid #CC9933;border-radius:6px;padding:12px 16px;margin:8px 0}
  .muted{color:#6b6150}.small{font-size:9.5px;color:#8C7B65}
  .box{background:#FDFAF5;border:1px solid #E8DCC8;border-left:3px solid #CC9933;border-radius:6px;padding:10px 14px;margin:10px 0}
  .footer{margin-top:24px;border-top:2px solid #CC9933;padding-top:10px}
  .sign-zone{display:flex;justify-content:space-between;margin-top:30px}
  .sign-box{width:45%;background:#FDFAF5;border:1px solid #E8DCC8;border-radius:6px;padding:12px 16px;min-height:96px;font-size:10px}
  .sig-label{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#8C7B65;border-bottom:1px solid #E8DCC8;padding-bottom:5px;margin-bottom:7px}
  .sig-name{font-weight:700;font-size:10pt;color:#1C1C1C}
  .sig-script{font-family:'Northwell',cursive;font-size:22pt;color:#CC9933;line-height:1;padding:6px 0 2px}
  .sig-line{border-bottom:1.5px dashed #CC9933;height:46px;margin-top:10px;opacity:.5}
  .sig-note{font-size:7.5pt;color:#A09282;margin-top:4px;line-height:1.5}
  ul{margin:4px 0 4px 18px;padding:0}li{margin:2px 0}
  /* Couverture photo (style contrats voyageurs DCB) */
  .hero-section{position:relative;flex:1;min-height:0;overflow:hidden;background:#fff}
  .hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 60%;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
  .hero-overlay{position:absolute;inset:0;z-index:2}
  /* Fiche bien premium (style annexe contrats voyageurs) */
  .annexe-table{width:100%;border-collapse:collapse;font-size:10px;margin:8px 0;border-radius:6px;overflow:hidden}
  .annexe-table td{padding:8px 12px;border:1px solid #E8DCC8;vertical-align:top}
  .annexe-table tr:nth-child(even) td{background:#FDFAF5}
  .annexe-table td.k{width:40%;font-weight:600;color:#6B5840;background:#FBF6EC}
</style></head>
<body>

<!-- ══ PAGE DE COUVERTURE (logo posé sur la photo, façon rapport DCB) ════════ -->
<div style="page-break-after:always;position:relative;height:265mm;overflow:hidden;background:#1C140A;font-family:Georgia,'Times New Roman',serif">

  <!-- Photo plein cadre -->
  <img class="hero-img" src="{{hero_url}}" alt="" style="object-position:center 55%" />

  <!-- Voile clair en haut (lisibilité du logo) -->
  <div style="position:absolute;top:0;left:0;right:0;height:44%;background:linear-gradient(to bottom,rgba(255,253,249,0.94) 0%,rgba(255,253,249,0.80) 42%,rgba(255,253,249,0) 100%)"></div>

  <!-- Logo de marque (avec baseline Immobilier · Conciergerie · Location · Gestion) -->
  <div style="position:absolute;top:26mm;left:0;right:0;text-align:center">
    <img src="{{logo_url}}" alt="{{agence_nom}}" style="width:430px;max-width:80%;height:auto;-webkit-print-color-adjust:exact;print-color-adjust:exact" />
  </div>

  <!-- Dégradé sombre en bas -->
  <div style="position:absolute;bottom:0;left:0;right:0;height:52%;background:linear-gradient(to top,rgba(20,14,8,0.88) 0%,rgba(20,14,8,0.42) 55%,rgba(20,14,8,0) 100%)"></div>

  <!-- Pastille photo + texte bien / propriétaire en bas -->
  <div style="position:absolute;bottom:0;left:0;right:0;padding:0 20px 20mm;color:#fff;text-align:center">
    {{#has_bien_photos}}<div style="margin:0 auto 16px;width:96px;height:96px;border-radius:50%;overflow:hidden;border:3px solid rgba(255,255,255,0.92);box-shadow:0 4px 18px rgba(0,0,0,.55)"><img src="{{bien_photo_1}}" style="width:100%;height:100%;object-fit:cover;display:block"></div>{{/has_bien_photos}}
    <div style="font-size:9px;color:rgba(255,255,255,.72);letter-spacing:2.5px;text-transform:uppercase;margin-bottom:6px">{{#est_lauian}}Mandat exclusif de gestion{{/est_lauian}}{{^est_lauian}}Mandat d&rsquo;administration{{/est_lauian}}</div>
    <div style="font-size:21px;font-weight:700;letter-spacing:1px;line-height:1.25;text-shadow:0 2px 6px rgba(0,0,0,.55)">{{bien_nom}}</div>
    <div style="font-size:9.5px;color:rgba(255,255,255,.7);margin-top:5px;letter-spacing:2px;text-transform:uppercase">{{cover_location}}</div>
    <div style="width:30px;height:1px;background:rgba(255,255,255,.45);margin:11px auto 8px"></div>
    <div style="font-size:13px;font-weight:600;color:#fff;letter-spacing:.5px;text-shadow:0 1px 4px rgba(0,0,0,.5)">{{proprietaire_nom_complet}}</div>
    <div style="font-size:8.5px;color:rgba(255,255,255,.72);margin-top:4px;letter-spacing:.5px">N&deg;&nbsp;{{mandat_numero}} &middot; {{date_contrat_longue}}</div>
  </div>

</div>
<!-- ══ FIN COUVERTURE ════════════════════════════════════════════════════ -->

<div class="page">

  <!-- En-tête de marque (style contrats voyageurs DCB) -->
  <div class="header">
    <div class="header-left">
      <div class="logo-square">D</div>
      <div class="header-brand">
        <div class="name">{{agence_nom}}</div>
        <div class="sub">Conciergerie · Côte Basque</div>
      </div>
    </div>
    <div class="header-right">{{agence_adresse_ligne1}}<br>{{agence_adresse_ligne2}}<br>{{agence_tel}}<br>{{agence_email}}</div>
  </div>

  <!-- Titre du document -->
  <div class="doc-title-block">
    <div class="doc-title">{{#est_lauian}}Mandat exclusif de location saisonnière{{/est_lauian}}{{^est_lauian}}Mandat d'administration — Location saisonnière{{/est_lauian}}</div>
    <div class="gold-line"></div>
    <div class="doc-subtitle">Entre le propriétaire mandant et {{agence_nom}}, mandataire</div>
    <div class="doc-num">Mandat n° <strong>{{mandat_numero}}</strong></div>
  </div>
</div>

<!-- ════════ CORPS DU MANDAT ════════ -->
<div class="page">

  <div class="section-title">DÉSIGNATION DES PARTIES</div>

  <div class="sub">Le mandant</div>
  <p>{{mandant_civilite}} <strong>{{mandant_nom}}</strong>{{#mandant_ne_le}}, né(e) le {{mandant_ne_le}}{{/mandant_ne_le}}{{#mandant_lieu_naissance}} à {{mandant_lieu_naissance}}{{/mandant_lieu_naissance}}{{#mandant_nationalite}}, de nationalité {{mandant_nationalite}}{{/mandant_nationalite}}{{#mandant_profession}}, {{mandant_profession}}{{/mandant_profession}}, demeurant {{mandant_adresse}}{{#mandant_situation_matrimoniale}}, {{mandant_situation_matrimoniale}}{{/mandant_situation_matrimoniale}}.</p>
  <p><strong>Ci-après « le MANDANT », d'une part,</strong></p>

  <div class="sub">Le mandataire</div>
  <p><strong>{{agence_nom}}</strong>, ci-après désignée <strong>« l'Agence » ou « le Mandataire »</strong>, située {{agence_adresse}}, téléphone {{agence_tel}}, adresse mail {{agence_email}}, exploitée par la société {{agence_nom}} {{agence_forme}} au capital de {{agence_capital}} euros, dont le siège social est situé {{agence_adresse}}, RCS {{agence_rcs}}, titulaire de la carte professionnelle Gestion immobilière n° {{agence_cpi}} délivrée par {{agence_cpi_delivree}}, numéro de TVA {{agence_tva}}, assurée en responsabilité civile professionnelle par {{agence_rcp}}.<br>
  Adhérente de la caisse de Garantie {{agence_garantie}} pour un montant de {{agence_garantie_montant}} euros{{#est_lauian}}. Titulaire du compte séquestre n° {{agence_sequestre_iban}} ouvert auprès de {{agence_sequestre_banque}}, n'ayant aucun lien capitalistique ou juridique avec une banque ou une société financière{{/est_lauian}}.<br>
  Représentée par <strong>{{agence_representant}}</strong>, agissant en sa qualité de {{agence_qualite}}, ayant tous pouvoirs à l'effet des présentes,</p>
  <p><strong>D'autre part,</strong></p>

  <div class="section-title">IL A ÉTÉ CONVENU CE QUI SUIT</div>
  <p>Le MANDANT confère par les présentes au MANDATAIRE, qui l'accepte, mandat {{#est_lauian}}exclusif de rechercher un ou plusieurs locataires pour{{/est_lauian}}{{^est_lauian}}d'administrer{{/est_lauian}} le bien suivant{{^est_lauian}} tant activement que passivement{{/est_lauian}}.</p>

  <div class="sub">Désignation du bien</div>
  <table class="annexe-table">
    <tr><td class="k">Type de bien</td><td>{{bien_type}}</td></tr>
    <tr><td class="k">Adresse du logement</td><td>{{bien_adresse}}</td></tr>
    {{#bien_surface}}<tr><td class="k">Surface habitable</td><td>{{bien_surface}} m²</td></tr>{{/bien_surface}}
    {{#bien_pieces}}<tr><td class="k">Pièces principales</td><td>{{bien_pieces}}</td></tr>{{/bien_pieces}}
    {{#bien_capacite}}<tr><td class="k">Capacité d'accueil</td><td>{{bien_capacite}} personnes</td></tr>{{/bien_capacite}}
    {{#bien_autres_parties}}<tr><td class="k">Autres parties</td><td>{{bien_autres_parties}}</td></tr>{{/bien_autres_parties}}
    {{#bien_equipements}}<tr><td class="k">Équipements</td><td>{{bien_equipements}}</td></tr>{{/bien_equipements}}
    {{#bien_classement}}<tr><td class="k">Classement meublé de tourisme</td><td>{{bien_classement}}{{#bien_numero_declaration}} · N° de déclaration {{bien_numero_declaration}}{{/bien_numero_declaration}}</td></tr>{{/bien_classement}}
    {{#si_piscine}}<tr><td class="k">Piscine</td><td>Équipée d'un système de sécurité conforme aux normes en vigueur{{#bien_securite_piscine}} — {{bien_securite_piscine}}{{/bien_securite_piscine}}</td></tr>{{/si_piscine}}
  </table>

  <div class="section-title">CONDITION DE LOCATION</div>
  <p><strong>Destination du bien :</strong> le bien loué est destiné à un <strong>usage de location saisonnière en meublé</strong>.
  {{^residence_principale}}Le MANDANT indique que le bien objet du mandat <strong>ne constitue pas</strong> sa résidence principale.{{/residence_principale}}
  {{#residence_principale}}{{#location_chambre}}Le bien objet du mandat est une chambre de la résidence principale du MANDANT, donnée en location en tant que location d'une ou plusieurs chambres de la résidence principale ; à ce titre, sa mise en location <strong>n'est pas soumise à la limite annuelle</strong> applicable à la location du logement entier.{{/location_chambre}}{{^location_chambre}}Le MANDANT indique que le bien objet du mandat <strong>constitue sa résidence principale</strong>. À ce titre, le logement ne peut être donné en location saisonnière plus de <strong>{{limite_jours}} jours</strong> sur une année civile, conformément à la réglementation en vigueur.{{/location_chambre}}{{/residence_principale}}</p>
  <p><strong>Autorisation préalable de mise en location</strong> : le MANDANT reconnaît avoir été informé qu'une autorisation préalable est obligatoire, et déclare l'avoir obtenue, ce dont il justifie.</p>
  <p><strong>Prix de la location :</strong> le tarif par nuit est déterminé selon une méthode de yield management inspirée du secteur hôtelier, afin d'optimiser le taux de remplissage tout en valorisant le potentiel du bien et en maintenant une clientèle cohérente avec son standing. 50 % à la réservation, le solde du loyer acquitté un mois avant la mise à disposition des lieux.</p>
  {{#charges_complementaires}}<p><strong>Charges complémentaires :</strong> le locataire acquittera : {{charges_complementaires}}.</p>{{/charges_complementaires}}
  {{#prestations_complementaires}}<div class="sub">Prestations complémentaires</div><ul>{{prestations_complementaires}}</ul>{{/prestations_complementaires}}
  <p><strong>Disponibilité des biens :</strong> les biens seront proposés à la location {{#dispo_debut}}du {{dispo_debut}} au {{dispo_fin}}{{/dispo_debut}}{{^dispo_debut}}durant toute l'année civile{{/dispo_debut}}.{{#periodes_exclues}} Périodes exclues : {{periodes_exclues}}.{{/periodes_exclues}}</p>

  <div class="section-title">DÉCLARATION ET ENGAGEMENTS DU MANDANT</div>
  <p>Le MANDANT déclare, sous sa responsabilité, ne faire l'objet d'aucune mesure de protection de la personne ni d'aucune procédure collective (redressement / liquidation judiciaires), et que les biens ne font l'objet d'aucune procédure de saisie immobilière, ni d'aucune indemnisation au titre d'un sinistre (catastrophe naturelle ou technologique). Pendant la durée du mandat il s'engage à : ne pas louer le bien sans en aviser préalablement son MANDATAIRE ; transmettre toute demande de location émanant d'une personne ayant déjà loué par son intermédiaire ; honorer les contrats consentis par le MANDATAIRE ; faire connaître toute modification juridique (démembrement, usufruit…). <strong>Le MANDANT s'interdit de confier tout pouvoir concurrent à un tiers.</strong></p>

  {{#est_lauian}}
  <div class="section-title">EXCLUSIVITÉ CONSENTIE PAR LE MANDANT</div>
  <p>Le MANDANT déclare ne pas avoir déjà consenti de mandat de location non expiré ou dénoncé et s'interdit de le faire ultérieurement sans avoir préalablement dénoncé le présent mandat. Il s'interdit, pendant toute la durée du mandat et de ses renouvellements, de louer les biens directement ou par l'intermédiaire d'un autre mandataire, et durant les 6 mois suivant l'expiration ou la résiliation, de traiter directement avec une personne à qui le bien aura été présenté par le MANDATAIRE.</p>
  <div class="box"><strong>SI LE MANDANT NE RESPECTAIT PAS L'UN OU L'AUTRE DE CES ENGAGEMENTS, LE MANDATAIRE AURA DROIT, À TITRE DE CLAUSE PÉNALE, À UNE INDEMNITÉ FORFAITAIRE À LA CHARGE DU MANDANT, D'UN MONTANT ÉGAL À CELUI DE LA RÉMUNÉRATION TOUTES TAXES COMPRISES DU MANDATAIRE PRÉVUE AU PRÉSENT MANDAT.</strong></div>
  {{/est_lauian}}

  <div class="section-title">DURÉE</div>
  <p>Le présent mandat est donné pour une durée de <strong>{{duree_initiale}}</strong> à compter de ce jour. Il se renouvellera ensuite tacitement par période{{#duree_renouv_pluriel}}s{{/duree_renouv_pluriel}} de {{duree_renouvellement}}, sans que la durée totale ne puisse dépasser {{duree_max}} à compter de sa signature.
  {{^est_lauian}} L'une ou l'autre des parties pourra résilier au terme de chaque période en avisant l'autre par lettre recommandée avec AR trois mois avant la date anniversaire.{{/est_lauian}}
  {{#est_lauian}} Passé un délai de trois mois à compter de sa signature, le mandat pourra être dénoncé à tout moment par chacune des parties moyennant un préavis de quinze jours par lettre recommandée avec AR (article 78 du décret du 20 juillet 1972). Le présent mandat ne peut être dénoncé que dans sa totalité.{{/est_lauian}}</p>
  <p class="small">En application de l'article L. 215-4 du Code de la consommation, les dispositions des articles L. 215-1 à L. 215-3 et L. 241-3 dudit code sont réputées reproduites (information sur la reconduction tacite et droit de résiliation gratuit du consommateur).</p>

  <div class="section-title">MISSIONS ET POUVOIRS DU MANDATAIRE</div>
  <p>Le MANDANT autorise expressément le MANDATAIRE à accomplir, pour son compte et en son nom, tous les actes d'administration, et notamment : rechercher des locataires, louer et relouer le bien ; rédiger et signer les engagements ; donner et accepter les congés ; dresser les états des lieux ; établir les diagnostics obligatoires aux frais du MANDANT ; encaisser loyers, charges, dépôts de garantie, indemnités et provisions ; donner quittance et mainlevée ; faire exécuter sans autorisation préalable les réparations dont le montant ne dépasse pas <strong>{{seuil_reparations}} €</strong> ainsi que les réparations d'urgence ; pour les autres travaux, après accord écrit du MANDANT ; régler les factures dans la limite des fonds disponibles ; compléter les éléments d'équipement nécessaires à la conformité du logement.</p>

  <div class="section-title">RÉMUNÉRATION</div>
  <p>Le MANDATAIRE aura droit à une rémunération fixée à <strong>{{taux_ht}} % HT, soit {{taux_ttc}} % TTC</strong> du montant des nuitées au taux actuel de la TVA. Si le taux de TVA venait à varier, le taux TTC évoluerait de la même manière. <strong>La rémunération du MANDATAIRE sera à la charge exclusive du MANDANT</strong> et sera prélevée sur chaque relevé de compte. Les frais de ménage sont collectés directement auprès du voyageur.</p>

  <div class="section-title">REDDITION DES COMPTES</div>
  <p>Le MANDATAIRE rendra compte de sa gestion tous les mois et transmettra un état détaillé des sommes perçues et dépensées, le MANDANT s'obligeant à tous les frais et avances pour l'exécution du présent mandat à compter du {{date_reddition_debut}}. Le règlement au MANDANT se fera par virement en début de mois.</p>

  <div class="section-title">ASSURANCES</div>
  <p>Le MANDANT reconnaît avoir été informé, avant la signature, de l'intérêt de souscrire un contrat d'assurance couvrant les risques liés à sa qualité de propriétaire d'un bien immobilier et de bailleur.</p>

  {{#clause_particuliere}}<div class="section-title">CLAUSE(S) PARTICULIÈRE(S)</div><p>{{clause_particuliere}}</p>{{/clause_particuliere}}

  <div class="section-title">ENGAGEMENT DE NON-DISCRIMINATION</div>
  <p class="small">Constitue une discrimination toute distinction opérée entre les personnes sur le fondement notamment de l'origine, du sexe, de la situation de famille, de l'apparence physique, de l'état de santé, du handicap, de l'âge, des opinions, de l'orientation sexuelle, de l'appartenance vraie ou supposée à une ethnie, une Nation, une prétendue race ou une religion. Toute discrimination est punie pénalement ; les parties s'engagent à n'opposer aucun refus de location fondé sur un motif discriminatoire.</p>

  <div class="section-title">COLLECTE ET EXPLOITATION DES DONNÉES PERSONNELLES</div>
  <p class="small">Les données à caractère personnel du MANDANT, collectées à l'occasion des présentes, font l'objet de traitements nécessaires à leur exécution, conservées pendant la durée du contrat augmentée des délais légaux. Elles peuvent être transmises à des prestataires techniques et utilisées pour la gestion des fichiers clients, le marketing direct, et la lutte contre le blanchiment. Le MANDANT peut exercer ses droits auprès de l'Agence ou saisir la CNIL (www.cnil.fr). ☑ <strong>En cochant cette case, le MANDANT l'accepte expressément.</strong></p>

  <div class="section-title">DROIT DE RÉTRACTATION</div>
  <p class="small">Le présent mandat étant consenti hors établissement ou à distance, le MANDANT bénéficie, en application des articles L. 221-18 et suivants du Code de la consommation, d'un <strong>délai de quatorze jours pour exercer, sans motif, son droit de rétractation</strong>. Un formulaire de rétractation est annexé.</p>
  <div class="box small">
    {{#execution_immediate}}☑ <strong>Le MANDANT DEMANDE EXPRESSÉMENT au MANDATAIRE de commencer l'exécution dès la signature</strong>, sans attendre la fin du délai de rétractation de quatorze jours, et reconnaît qu'après exécution complète il ne disposera plus du droit de se rétracter.{{/execution_immediate}}
    {{^execution_immediate}}☑ <strong>Le MANDANT NE SOUHAITE PAS</strong> que le MANDATAIRE commence l'exécution avant la fin du délai de rétractation de quatorze jours, sauf demande expresse ultérieure de sa part.{{/execution_immediate}}
  </div>

  <div class="footer">
    <div class="section-title" style="margin-top:0">DATE ET SIGNATURES</div>
    <p>Fait à {{lieu_signature}}, le {{mandat_date}}, et signé électroniquement par l'ensemble des Parties, chacune en conservant un exemplaire original sur un support durable garantissant l'intégrité de l'acte.</p>
    <div class="sign-zone">
      <div class="sign-box">
        <div class="sig-label">Le MANDANT</div>
        <div class="sig-name">{{mandant_civilite}} {{mandant_nom}}</div>
        {{#signature_mandant}}<div class="sig-script">{{signature_mandant}}</div>
        <div class="sig-note">Signature électronique apposée{{#signature_horodatage}} le {{signature_horodatage}}{{/signature_horodatage}}<br>contrat.destinationcotebasque.com</div>{{/signature_mandant}}
        {{^signature_mandant}}<div class="sig-line"></div>{{/signature_mandant}}
      </div>
      <div class="sign-box">
        <div class="sig-label">Le MANDATAIRE</div>
        <div class="sig-name">{{agence_representant}}</div>
        <div class="sig-script">{{agence_representant}}</div>
        <div class="sig-note">{{agence_qualite}} — {{agence_nom}}</div>
      </div>
    </div>
    <p class="small" style="margin-top:18px">{{#signature_ref}}Signature électronique : {{signature_mode}} · Horodatage {{signature_horodatage}} · Réf. {{signature_ref}}{{/signature_ref}}{{^signature_ref}}Document établi pour signature électronique sécurisée (OTP).{{/signature_ref}}</p>
  </div>

</div>
</body></html>
$tpl$,'{"defaults":{"est_lauian":false,"duree_initiale":"3 ans","duree_renouvellement":"3 ans","duree_max":"30 ans","duree_renouv_pluriel":false,"limite_jours":"120","seuil_reparations":"300","logo_url":"https://dcb-planning.vercel.app/dcb-logo.png"}}'::jsonb,true),
('lauian','fr','mandat_administration','2026-v1','Mandat exclusif de gestion — Lauian',$tpl$<!--
  Template MANDAT D'ADMINISTRATION - LOCATION SAISONNIÈRE — v1 (2026)
  Source de vérité versionnée — à charger dans contract_templates (type_contrat='mandat_administration').
  Moteur : renderMustache (api/generate-contract.js) — {{var}}, {{#cond}}…{{/cond}}, {{^cond}}…{{/cond}}.
  Entité variable DCB / Lauïan : {{#est_lauian}}…{{/est_lauian}} vs {{^est_lauian}}…{{/est_lauian}}.
  UN mandat = UN bien (cohérent avec clôture/facturation/accès par bien).
  Données : proprietaire + proprietaire_onboarding.reponses + bien + mandat_gestion.
  Corrections relecture : couverture premium, résidence principale conditionnelle,
  rétractation conditionnelle, durée en variable, mono-bien.
-->
<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<style>
  @font-face{font-family:'Northwell';src:url('https://dcb-contrats.vercel.app/fonts/Northwell.ttf') format('truetype');font-weight:normal;font-style:normal}
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#2C2416;font-size:11px;line-height:1.55;margin:0;padding:0}
  .page{padding:34px 46px}
  .page-break{page-break-after:always}
  /* En-tête (inspiré des contrats voyageurs DCB) */
  .header{display:flex;align-items:center;justify-content:space-between;padding:8px 0 20px;position:relative;margin-bottom:0}
  .header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:3px;border-radius:2px;background:linear-gradient(90deg,#CC9933 0%,#E4A853 50%,#CC9933 100%)}
  .header-left{display:flex;align-items:center;gap:14px}
  .logo-square{width:50px;height:50px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:700;flex-shrink:0;background:linear-gradient(135deg,#D4A035 0%,#CC9933 60%,#B8872A 100%);box-shadow:0 2px 8px rgba(204,153,51,.30)}
  .header-brand .name{font-size:15pt;font-weight:700;color:#1C1C1C;letter-spacing:-.3px}
  .header-brand .sub{font-size:8pt;color:#8C7B65;letter-spacing:2px;text-transform:uppercase;margin-top:1px}
  .header-right{text-align:right;font-size:8pt;color:#8C7B65;line-height:1.8}
  /* Bloc titre */
  .doc-title-block{text-align:center;padding:26px 0 18px;border-bottom:1px solid #EAE0D0;margin-bottom:24px}
  .doc-title{font-size:15pt;font-weight:700;color:#1C1C1C;text-transform:uppercase;letter-spacing:3px}
  .doc-subtitle{font-size:9.5pt;color:#8C7B65;font-style:italic;margin-top:6px}
  .gold-line{width:48px;height:2px;background:linear-gradient(90deg,#CC9933,#E4A853,#CC9933);margin:12px auto;border-radius:2px}
  .doc-num{display:inline-block;border:1.5px solid #CC9933;border-radius:8px;padding:4px 16px;font-size:11pt;margin-top:6px}
  .doc-num strong{color:#8a6d1f}
  /* Corps */
  .section-title{font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#CC9933;border-bottom:1.5px solid #E8DCC8;padding-bottom:6px;margin:20px 0 12px}
  .sub{font-weight:700;margin:12px 0 2px;color:#1C1C1C}
  .bien-card,.partie-box{background:#FDFAF5;border:1px solid #E8DCC8;border-left:3px solid #CC9933;border-radius:6px;padding:12px 16px;margin:8px 0}
  .muted{color:#6b6150}.small{font-size:9.5px;color:#8C7B65}
  .box{background:#FDFAF5;border:1px solid #E8DCC8;border-left:3px solid #CC9933;border-radius:6px;padding:10px 14px;margin:10px 0}
  .footer{margin-top:24px;border-top:2px solid #CC9933;padding-top:10px}
  .sign-zone{display:flex;justify-content:space-between;margin-top:30px}
  .sign-box{width:45%;background:#FDFAF5;border:1px solid #E8DCC8;border-radius:6px;padding:12px 16px;min-height:96px;font-size:10px}
  .sig-label{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#8C7B65;border-bottom:1px solid #E8DCC8;padding-bottom:5px;margin-bottom:7px}
  .sig-name{font-weight:700;font-size:10pt;color:#1C1C1C}
  .sig-script{font-family:'Northwell',cursive;font-size:22pt;color:#CC9933;line-height:1;padding:6px 0 2px}
  .sig-line{border-bottom:1.5px dashed #CC9933;height:46px;margin-top:10px;opacity:.5}
  .sig-note{font-size:7.5pt;color:#A09282;margin-top:4px;line-height:1.5}
  ul{margin:4px 0 4px 18px;padding:0}li{margin:2px 0}
  /* Couverture photo (style contrats voyageurs DCB) */
  .hero-section{position:relative;flex:1;min-height:0;overflow:hidden;background:#fff}
  .hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 60%;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
  .hero-overlay{position:absolute;inset:0;z-index:2}
  /* Fiche bien premium (style annexe contrats voyageurs) */
  .annexe-table{width:100%;border-collapse:collapse;font-size:10px;margin:8px 0;border-radius:6px;overflow:hidden}
  .annexe-table td{padding:8px 12px;border:1px solid #E8DCC8;vertical-align:top}
  .annexe-table tr:nth-child(even) td{background:#FDFAF5}
  .annexe-table td.k{width:40%;font-weight:600;color:#6B5840;background:#FBF6EC}
</style></head>
<body>

<!-- ══ PAGE DE COUVERTURE (logo posé sur la photo, façon rapport DCB) ════════ -->
<div style="page-break-after:always;position:relative;height:265mm;overflow:hidden;background:#1C140A;font-family:Georgia,'Times New Roman',serif">

  <!-- Photo plein cadre -->
  <img class="hero-img" src="{{hero_url}}" alt="" style="object-position:center 55%" />

  <!-- Voile clair en haut (lisibilité du logo) -->
  <div style="position:absolute;top:0;left:0;right:0;height:44%;background:linear-gradient(to bottom,rgba(255,253,249,0.94) 0%,rgba(255,253,249,0.80) 42%,rgba(255,253,249,0) 100%)"></div>

  <!-- Logo de marque (avec baseline Immobilier · Conciergerie · Location · Gestion) -->
  <div style="position:absolute;top:26mm;left:0;right:0;text-align:center">
    <img src="{{logo_url}}" alt="{{agence_nom}}" style="width:430px;max-width:80%;height:auto;-webkit-print-color-adjust:exact;print-color-adjust:exact" />
  </div>

  <!-- Dégradé sombre en bas -->
  <div style="position:absolute;bottom:0;left:0;right:0;height:52%;background:linear-gradient(to top,rgba(20,14,8,0.88) 0%,rgba(20,14,8,0.42) 55%,rgba(20,14,8,0) 100%)"></div>

  <!-- Pastille photo + texte bien / propriétaire en bas -->
  <div style="position:absolute;bottom:0;left:0;right:0;padding:0 20px 20mm;color:#fff;text-align:center">
    {{#has_bien_photos}}<div style="margin:0 auto 16px;width:96px;height:96px;border-radius:50%;overflow:hidden;border:3px solid rgba(255,255,255,0.92);box-shadow:0 4px 18px rgba(0,0,0,.55)"><img src="{{bien_photo_1}}" style="width:100%;height:100%;object-fit:cover;display:block"></div>{{/has_bien_photos}}
    <div style="font-size:9px;color:rgba(255,255,255,.72);letter-spacing:2.5px;text-transform:uppercase;margin-bottom:6px">{{#est_lauian}}Mandat exclusif de gestion{{/est_lauian}}{{^est_lauian}}Mandat d&rsquo;administration{{/est_lauian}}</div>
    <div style="font-size:21px;font-weight:700;letter-spacing:1px;line-height:1.25;text-shadow:0 2px 6px rgba(0,0,0,.55)">{{bien_nom}}</div>
    <div style="font-size:9.5px;color:rgba(255,255,255,.7);margin-top:5px;letter-spacing:2px;text-transform:uppercase">{{cover_location}}</div>
    <div style="width:30px;height:1px;background:rgba(255,255,255,.45);margin:11px auto 8px"></div>
    <div style="font-size:13px;font-weight:600;color:#fff;letter-spacing:.5px;text-shadow:0 1px 4px rgba(0,0,0,.5)">{{proprietaire_nom_complet}}</div>
    <div style="font-size:8.5px;color:rgba(255,255,255,.72);margin-top:4px;letter-spacing:.5px">N&deg;&nbsp;{{mandat_numero}} &middot; {{date_contrat_longue}}</div>
  </div>

</div>
<!-- ══ FIN COUVERTURE ════════════════════════════════════════════════════ -->

<div class="page">

  <!-- En-tête de marque (style contrats voyageurs DCB) -->
  <div class="header">
    <div class="header-left">
      <div class="logo-square">D</div>
      <div class="header-brand">
        <div class="name">{{agence_nom}}</div>
        <div class="sub">Conciergerie · Côte Basque</div>
      </div>
    </div>
    <div class="header-right">{{agence_adresse_ligne1}}<br>{{agence_adresse_ligne2}}<br>{{agence_tel}}<br>{{agence_email}}</div>
  </div>

  <!-- Titre du document -->
  <div class="doc-title-block">
    <div class="doc-title">{{#est_lauian}}Mandat exclusif de location saisonnière{{/est_lauian}}{{^est_lauian}}Mandat d'administration — Location saisonnière{{/est_lauian}}</div>
    <div class="gold-line"></div>
    <div class="doc-subtitle">Entre le propriétaire mandant et {{agence_nom}}, mandataire</div>
    <div class="doc-num">Mandat n° <strong>{{mandat_numero}}</strong></div>
  </div>
</div>

<!-- ════════ CORPS DU MANDAT ════════ -->
<div class="page">

  <div class="section-title">DÉSIGNATION DES PARTIES</div>

  <div class="sub">Le mandant</div>
  <p>{{mandant_civilite}} <strong>{{mandant_nom}}</strong>{{#mandant_ne_le}}, né(e) le {{mandant_ne_le}}{{/mandant_ne_le}}{{#mandant_lieu_naissance}} à {{mandant_lieu_naissance}}{{/mandant_lieu_naissance}}{{#mandant_nationalite}}, de nationalité {{mandant_nationalite}}{{/mandant_nationalite}}{{#mandant_profession}}, {{mandant_profession}}{{/mandant_profession}}, demeurant {{mandant_adresse}}{{#mandant_situation_matrimoniale}}, {{mandant_situation_matrimoniale}}{{/mandant_situation_matrimoniale}}.</p>
  <p><strong>Ci-après « le MANDANT », d'une part,</strong></p>

  <div class="sub">Le mandataire</div>
  <p><strong>{{agence_nom}}</strong>, ci-après désignée <strong>« l'Agence » ou « le Mandataire »</strong>, située {{agence_adresse}}, téléphone {{agence_tel}}, adresse mail {{agence_email}}, exploitée par la société {{agence_nom}} {{agence_forme}} au capital de {{agence_capital}} euros, dont le siège social est situé {{agence_adresse}}, RCS {{agence_rcs}}, titulaire de la carte professionnelle Gestion immobilière n° {{agence_cpi}} délivrée par {{agence_cpi_delivree}}, numéro de TVA {{agence_tva}}, assurée en responsabilité civile professionnelle par {{agence_rcp}}.<br>
  Adhérente de la caisse de Garantie {{agence_garantie}} pour un montant de {{agence_garantie_montant}} euros{{#est_lauian}}. Titulaire du compte séquestre n° {{agence_sequestre_iban}} ouvert auprès de {{agence_sequestre_banque}}, n'ayant aucun lien capitalistique ou juridique avec une banque ou une société financière{{/est_lauian}}.<br>
  Représentée par <strong>{{agence_representant}}</strong>, agissant en sa qualité de {{agence_qualite}}, ayant tous pouvoirs à l'effet des présentes,</p>
  <p><strong>D'autre part,</strong></p>

  <div class="section-title">IL A ÉTÉ CONVENU CE QUI SUIT</div>
  <p>Le MANDANT confère par les présentes au MANDATAIRE, qui l'accepte, mandat {{#est_lauian}}exclusif de rechercher un ou plusieurs locataires pour{{/est_lauian}}{{^est_lauian}}d'administrer{{/est_lauian}} le bien suivant{{^est_lauian}} tant activement que passivement{{/est_lauian}}.</p>

  <div class="sub">Désignation du bien</div>
  <table class="annexe-table">
    <tr><td class="k">Type de bien</td><td>{{bien_type}}</td></tr>
    <tr><td class="k">Adresse du logement</td><td>{{bien_adresse}}</td></tr>
    {{#bien_surface}}<tr><td class="k">Surface habitable</td><td>{{bien_surface}} m²</td></tr>{{/bien_surface}}
    {{#bien_pieces}}<tr><td class="k">Pièces principales</td><td>{{bien_pieces}}</td></tr>{{/bien_pieces}}
    {{#bien_capacite}}<tr><td class="k">Capacité d'accueil</td><td>{{bien_capacite}} personnes</td></tr>{{/bien_capacite}}
    {{#bien_autres_parties}}<tr><td class="k">Autres parties</td><td>{{bien_autres_parties}}</td></tr>{{/bien_autres_parties}}
    {{#bien_equipements}}<tr><td class="k">Équipements</td><td>{{bien_equipements}}</td></tr>{{/bien_equipements}}
    {{#bien_classement}}<tr><td class="k">Classement meublé de tourisme</td><td>{{bien_classement}}{{#bien_numero_declaration}} · N° de déclaration {{bien_numero_declaration}}{{/bien_numero_declaration}}</td></tr>{{/bien_classement}}
    {{#si_piscine}}<tr><td class="k">Piscine</td><td>Équipée d'un système de sécurité conforme aux normes en vigueur{{#bien_securite_piscine}} — {{bien_securite_piscine}}{{/bien_securite_piscine}}</td></tr>{{/si_piscine}}
  </table>

  <div class="section-title">CONDITION DE LOCATION</div>
  <p><strong>Destination du bien :</strong> le bien loué est destiné à un <strong>usage de location saisonnière en meublé</strong>.
  {{^residence_principale}}Le MANDANT indique que le bien objet du mandat <strong>ne constitue pas</strong> sa résidence principale.{{/residence_principale}}
  {{#residence_principale}}{{#location_chambre}}Le bien objet du mandat est une chambre de la résidence principale du MANDANT, donnée en location en tant que location d'une ou plusieurs chambres de la résidence principale ; à ce titre, sa mise en location <strong>n'est pas soumise à la limite annuelle</strong> applicable à la location du logement entier.{{/location_chambre}}{{^location_chambre}}Le MANDANT indique que le bien objet du mandat <strong>constitue sa résidence principale</strong>. À ce titre, le logement ne peut être donné en location saisonnière plus de <strong>{{limite_jours}} jours</strong> sur une année civile, conformément à la réglementation en vigueur.{{/location_chambre}}{{/residence_principale}}</p>
  <p><strong>Autorisation préalable de mise en location</strong> : le MANDANT reconnaît avoir été informé qu'une autorisation préalable est obligatoire, et déclare l'avoir obtenue, ce dont il justifie.</p>
  <p><strong>Prix de la location :</strong> le tarif par nuit est déterminé selon une méthode de yield management inspirée du secteur hôtelier, afin d'optimiser le taux de remplissage tout en valorisant le potentiel du bien et en maintenant une clientèle cohérente avec son standing. 50 % à la réservation, le solde du loyer acquitté un mois avant la mise à disposition des lieux.</p>
  {{#charges_complementaires}}<p><strong>Charges complémentaires :</strong> le locataire acquittera : {{charges_complementaires}}.</p>{{/charges_complementaires}}
  {{#prestations_complementaires}}<div class="sub">Prestations complémentaires</div><ul>{{prestations_complementaires}}</ul>{{/prestations_complementaires}}
  <p><strong>Disponibilité des biens :</strong> les biens seront proposés à la location {{#dispo_debut}}du {{dispo_debut}} au {{dispo_fin}}{{/dispo_debut}}{{^dispo_debut}}durant toute l'année civile{{/dispo_debut}}.{{#periodes_exclues}} Périodes exclues : {{periodes_exclues}}.{{/periodes_exclues}}</p>

  <div class="section-title">DÉCLARATION ET ENGAGEMENTS DU MANDANT</div>
  <p>Le MANDANT déclare, sous sa responsabilité, ne faire l'objet d'aucune mesure de protection de la personne ni d'aucune procédure collective (redressement / liquidation judiciaires), et que les biens ne font l'objet d'aucune procédure de saisie immobilière, ni d'aucune indemnisation au titre d'un sinistre (catastrophe naturelle ou technologique). Pendant la durée du mandat il s'engage à : ne pas louer le bien sans en aviser préalablement son MANDATAIRE ; transmettre toute demande de location émanant d'une personne ayant déjà loué par son intermédiaire ; honorer les contrats consentis par le MANDATAIRE ; faire connaître toute modification juridique (démembrement, usufruit…). <strong>Le MANDANT s'interdit de confier tout pouvoir concurrent à un tiers.</strong></p>

  {{#est_lauian}}
  <div class="section-title">EXCLUSIVITÉ CONSENTIE PAR LE MANDANT</div>
  <p>Le MANDANT déclare ne pas avoir déjà consenti de mandat de location non expiré ou dénoncé et s'interdit de le faire ultérieurement sans avoir préalablement dénoncé le présent mandat. Il s'interdit, pendant toute la durée du mandat et de ses renouvellements, de louer les biens directement ou par l'intermédiaire d'un autre mandataire, et durant les 6 mois suivant l'expiration ou la résiliation, de traiter directement avec une personne à qui le bien aura été présenté par le MANDATAIRE.</p>
  <div class="box"><strong>SI LE MANDANT NE RESPECTAIT PAS L'UN OU L'AUTRE DE CES ENGAGEMENTS, LE MANDATAIRE AURA DROIT, À TITRE DE CLAUSE PÉNALE, À UNE INDEMNITÉ FORFAITAIRE À LA CHARGE DU MANDANT, D'UN MONTANT ÉGAL À CELUI DE LA RÉMUNÉRATION TOUTES TAXES COMPRISES DU MANDATAIRE PRÉVUE AU PRÉSENT MANDAT.</strong></div>
  {{/est_lauian}}

  <div class="section-title">DURÉE</div>
  <p>Le présent mandat est donné pour une durée de <strong>{{duree_initiale}}</strong> à compter de ce jour. Il se renouvellera ensuite tacitement par période{{#duree_renouv_pluriel}}s{{/duree_renouv_pluriel}} de {{duree_renouvellement}}, sans que la durée totale ne puisse dépasser {{duree_max}} à compter de sa signature.
  {{^est_lauian}} L'une ou l'autre des parties pourra résilier au terme de chaque période en avisant l'autre par lettre recommandée avec AR trois mois avant la date anniversaire.{{/est_lauian}}
  {{#est_lauian}} Passé un délai de trois mois à compter de sa signature, le mandat pourra être dénoncé à tout moment par chacune des parties moyennant un préavis de quinze jours par lettre recommandée avec AR (article 78 du décret du 20 juillet 1972). Le présent mandat ne peut être dénoncé que dans sa totalité.{{/est_lauian}}</p>
  <p class="small">En application de l'article L. 215-4 du Code de la consommation, les dispositions des articles L. 215-1 à L. 215-3 et L. 241-3 dudit code sont réputées reproduites (information sur la reconduction tacite et droit de résiliation gratuit du consommateur).</p>

  <div class="section-title">MISSIONS ET POUVOIRS DU MANDATAIRE</div>
  <p>Le MANDANT autorise expressément le MANDATAIRE à accomplir, pour son compte et en son nom, tous les actes d'administration, et notamment : rechercher des locataires, louer et relouer le bien ; rédiger et signer les engagements ; donner et accepter les congés ; dresser les états des lieux ; établir les diagnostics obligatoires aux frais du MANDANT ; encaisser loyers, charges, dépôts de garantie, indemnités et provisions ; donner quittance et mainlevée ; faire exécuter sans autorisation préalable les réparations dont le montant ne dépasse pas <strong>{{seuil_reparations}} €</strong> ainsi que les réparations d'urgence ; pour les autres travaux, après accord écrit du MANDANT ; régler les factures dans la limite des fonds disponibles ; compléter les éléments d'équipement nécessaires à la conformité du logement.</p>

  <div class="section-title">RÉMUNÉRATION</div>
  <p>Le MANDATAIRE aura droit à une rémunération fixée à <strong>{{taux_ht}} % HT, soit {{taux_ttc}} % TTC</strong> du montant des nuitées au taux actuel de la TVA. Si le taux de TVA venait à varier, le taux TTC évoluerait de la même manière. <strong>La rémunération du MANDATAIRE sera à la charge exclusive du MANDANT</strong> et sera prélevée sur chaque relevé de compte. Les frais de ménage sont collectés directement auprès du voyageur.</p>

  <div class="section-title">REDDITION DES COMPTES</div>
  <p>Le MANDATAIRE rendra compte de sa gestion tous les mois et transmettra un état détaillé des sommes perçues et dépensées, le MANDANT s'obligeant à tous les frais et avances pour l'exécution du présent mandat à compter du {{date_reddition_debut}}. Le règlement au MANDANT se fera par virement en début de mois.</p>

  <div class="section-title">ASSURANCES</div>
  <p>Le MANDANT reconnaît avoir été informé, avant la signature, de l'intérêt de souscrire un contrat d'assurance couvrant les risques liés à sa qualité de propriétaire d'un bien immobilier et de bailleur.</p>

  {{#clause_particuliere}}<div class="section-title">CLAUSE(S) PARTICULIÈRE(S)</div><p>{{clause_particuliere}}</p>{{/clause_particuliere}}

  <div class="section-title">ENGAGEMENT DE NON-DISCRIMINATION</div>
  <p class="small">Constitue une discrimination toute distinction opérée entre les personnes sur le fondement notamment de l'origine, du sexe, de la situation de famille, de l'apparence physique, de l'état de santé, du handicap, de l'âge, des opinions, de l'orientation sexuelle, de l'appartenance vraie ou supposée à une ethnie, une Nation, une prétendue race ou une religion. Toute discrimination est punie pénalement ; les parties s'engagent à n'opposer aucun refus de location fondé sur un motif discriminatoire.</p>

  <div class="section-title">COLLECTE ET EXPLOITATION DES DONNÉES PERSONNELLES</div>
  <p class="small">Les données à caractère personnel du MANDANT, collectées à l'occasion des présentes, font l'objet de traitements nécessaires à leur exécution, conservées pendant la durée du contrat augmentée des délais légaux. Elles peuvent être transmises à des prestataires techniques et utilisées pour la gestion des fichiers clients, le marketing direct, et la lutte contre le blanchiment. Le MANDANT peut exercer ses droits auprès de l'Agence ou saisir la CNIL (www.cnil.fr). ☑ <strong>En cochant cette case, le MANDANT l'accepte expressément.</strong></p>

  <div class="section-title">DROIT DE RÉTRACTATION</div>
  <p class="small">Le présent mandat étant consenti hors établissement ou à distance, le MANDANT bénéficie, en application des articles L. 221-18 et suivants du Code de la consommation, d'un <strong>délai de quatorze jours pour exercer, sans motif, son droit de rétractation</strong>. Un formulaire de rétractation est annexé.</p>
  <div class="box small">
    {{#execution_immediate}}☑ <strong>Le MANDANT DEMANDE EXPRESSÉMENT au MANDATAIRE de commencer l'exécution dès la signature</strong>, sans attendre la fin du délai de rétractation de quatorze jours, et reconnaît qu'après exécution complète il ne disposera plus du droit de se rétracter.{{/execution_immediate}}
    {{^execution_immediate}}☑ <strong>Le MANDANT NE SOUHAITE PAS</strong> que le MANDATAIRE commence l'exécution avant la fin du délai de rétractation de quatorze jours, sauf demande expresse ultérieure de sa part.{{/execution_immediate}}
  </div>

  <div class="footer">
    <div class="section-title" style="margin-top:0">DATE ET SIGNATURES</div>
    <p>Fait à {{lieu_signature}}, le {{mandat_date}}, et signé électroniquement par l'ensemble des Parties, chacune en conservant un exemplaire original sur un support durable garantissant l'intégrité de l'acte.</p>
    <div class="sign-zone">
      <div class="sign-box">
        <div class="sig-label">Le MANDANT</div>
        <div class="sig-name">{{mandant_civilite}} {{mandant_nom}}</div>
        {{#signature_mandant}}<div class="sig-script">{{signature_mandant}}</div>
        <div class="sig-note">Signature électronique apposée{{#signature_horodatage}} le {{signature_horodatage}}{{/signature_horodatage}}<br>contrat.destinationcotebasque.com</div>{{/signature_mandant}}
        {{^signature_mandant}}<div class="sig-line"></div>{{/signature_mandant}}
      </div>
      <div class="sign-box">
        <div class="sig-label">Le MANDATAIRE</div>
        <div class="sig-name">{{agence_representant}}</div>
        <div class="sig-script">{{agence_representant}}</div>
        <div class="sig-note">{{agence_qualite}} — {{agence_nom}}</div>
      </div>
    </div>
    <p class="small" style="margin-top:18px">{{#signature_ref}}Signature électronique : {{signature_mode}} · Horodatage {{signature_horodatage}} · Réf. {{signature_ref}}{{/signature_ref}}{{^signature_ref}}Document établi pour signature électronique sécurisée (OTP).{{/signature_ref}}</p>
  </div>

</div>
</body></html>
$tpl$,'{"defaults":{"est_lauian":true,"duree_initiale":"12 mois","duree_renouvellement":"12 mois","duree_max":"72 mois","duree_renouv_pluriel":false,"limite_jours":"120","seuil_reparations":"300","logo_url":"https://dcb-planning.vercel.app/dcb-logo.png"}}'::jsonb,true);