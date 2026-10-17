-- 469 — Contrat de location saisonnière : PÉNALITÉ DE DÉPART TARDIF NON AUTORISÉ (décision d'Oïhan du 17/10/2026,
-- validée sur exemple chiffré : studio ~120 €/nuit → 12 € à 10h15, 60 € à 11h00, 120 € plafond).
-- NOUVELLES VERSIONS des 6 modèles saisonniers actifs (anciennes lignes CONSERVÉES, désactivées, comme 456/460/464) :
--   §3 Période de location : clause « Heure de départ — départ tardif non autorisé » (clause pénale art. 1231-5 C. civ.) :
--     tolérance 10 min, puis 10 % du prix moyen d'une nuit d'hébergement (hors frais et taxes) par tranche de 10 min
--     commencée, plafond = prix d'une nuit, + frais réels justifiés ; exemple 10h10/10h15/11h00 ; rappel départ tardif
--     demandé à l'avance 25 € (12h00) / 45 € (14h00) ; directe = débit sur la carte de garantie après notification (art. 11),
--     sans garantie = facturé au locataire, Airbnb/Booking ({{#is_booking_platform}}) = réclamé via la plateforme.
--     Montant du séjour : NOUVELLES variables PowerHouse (api/_penaliteDepart.js) {{penalite_tranche_eur}},
--     {{penalite_plafond_eur}} dans {{#has_penalite_montant}} — absentes = phrase générale seule.
--   §6 Obligations du locataire (règlement intérieur) : puce « Libérer le logement à l'heure de départ du séjour (article 3) ».
--   §11 Retenues : « Retard de départ : facturation au prorata du loyer journalier » remplacé par la nouvelle règle (renvoi art. 3).
-- Contrats déjà envoyés / signés : INCHANGÉS (relisent LEUR modèle par template_id ; vérifié 96/96 identique, banc du vrai handler).
-- APPLIQUÉE le 17/10/2026 via l'API REST service après déploiement PowerHouse b760649 (6 lignes inactives : dcb en 65288a66,
-- es bc085e1c, fr 2318a79a ; lauian en a94a3ab6, es 1c54e584, fr 34cd16fa) puis bascule is_active — rejouable sans effet.
-- Aperçus PDF locaux : scratchpad penalite/apercu/. Sauvegarde des modèles actifs avant : scratchpad penalite/sauvegarde/.
-- Prérequis : PowerHouse déployé avec les variables penalite_* AVANT la bascule (sinon : phrase générale sans montant, sans erreur).

-- dcb saisonnier en : 2026-v5 → 2026-v6
insert into contract_templates (agence, langue, type_contrat, version, nom, contenu_html, variables_attendues, is_active)
select 'dcb', 'en', 'saisonnier', '2026-v6', null, $tpl469$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Seasonal Rental Agreement — Destination Côte Basque</title>
<style>
/* ── Reset ── */
* { margin: 0; padding: 0; box-sizing: border-box; }
@font-face {
  font-family: 'Northwell';
  src: url('https://dcb-contrats.vercel.app/fonts/Northwell.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
}

/* ── Page PDF ── */
@page {
  size: A4;
  margin: 20mm 15mm 22mm;
  @bottom-right {
    content: "Page " counter(page) " / " counter(pages);
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 7.5pt;
    color: #A09282;
  }
  @bottom-left {
    content: "Destination Côte Basque — Seasonal Rental Agreement";
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 7.5pt;
    color: #A09282;
  }
}

body {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 10.5pt;
  color: #1C1C1C;
  line-height: 1.65;
  background: #fff;
  counter-reset: page;
}

/* ── Mise en page ── */
.page { max-width: 800px; margin: 0 auto; padding: 0 20px; }

/* ── En-tête ── */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28px 0 20px;
  border-bottom: 0;
  margin-bottom: 0;
  position: relative;
}
.header::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #CC9933 0%, #E4A853 50%, #CC9933 100%);
  border-radius: 2px;
}
.header-left { display: flex; align-items: center; gap: 14px; }
.logo-square {
  width: 50px; height: 50px;
  background: linear-gradient(135deg, #D4A035 0%, #CC9933 60%, #B8872A 100%);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 24px; font-weight: 700;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(204,153,51,0.30);
}
.header-brand { font-family: 'Helvetica Neue', Arial, sans-serif; }
.header-brand .name { font-size: 14pt; font-weight: 700; color: #1C1C1C; letter-spacing: -0.3px; }
.header-brand .sub  { font-size: 8pt; color: #8C7B65; letter-spacing: 2px; text-transform: uppercase; margin-top: 1px; }
.header-right {
  text-align: right;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 8pt; color: #8C7B65; line-height: 1.8;
}

/* ── Titre principal ── */
.doc-title-block {
  text-align: center;
  padding: 28px 0 20px;
  border-bottom: 1px solid #EAE0D0;
  margin-bottom: 26px;
}
.doc-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 15pt;
  font-weight: 700;
  color: #1C1C1C;
  text-transform: uppercase;
  letter-spacing: 3px;
  margin-bottom: 8px;
}
.doc-subtitle {
  font-size: 9.5pt;
  color: #8C7B65;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-style: italic;
}
.gold-line {
  width: 48px; height: 2px;
  background: linear-gradient(90deg, #CC9933, #E4A853, #CC9933);
  margin: 12px auto;
  border-radius: 2px;
}

/* ── Sections ── */
.section {
  margin-bottom: 24px;
  page-break-inside: avoid;
}
.section-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 8.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: #CC9933;
  border-bottom: 1.5px solid #E8DCC8;
  padding-bottom: 6px;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 0;
}
.section-title-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #D4A035, #CC9933);
  color: #fff;
  border-radius: 50%;
  width: 22px; height: 22px;
  font-size: 9pt;
  font-weight: 700;
  margin-right: 10px;
  flex-shrink: 0;
  box-shadow: 0 1px 4px rgba(204,153,51,0.30);
}

/* ── Blocs parties ── */
.parties-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 4px;
}
.partie-box {
  background: #FDFAF5;
  border: 1px solid #E8DCC8;
  border-left: 3px solid #CC9933;
  border-radius: 6px;
  padding: 14px 16px;
}
.partie-label {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: #8C7B65;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #E8DCC8;
}
.partie-nom {
  font-size: 11pt;
  font-weight: 700;
  color: #1C1C1C;
  margin-bottom: 5px;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
.partie-detail {
  font-size: 9pt;
  color: #4A3F32;
  line-height: 1.75;
}

/* ── Tableau financier ── */
.financial-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9.5pt;
  margin-bottom: 4px;
  border-radius: 6px;
  overflow: hidden;
}
.financial-table th {
  background: #F0E8D8;
  color: #6B5840;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 8px 12px;
  text-align: left;
  border: 1px solid #E0D4C0;
}
.financial-table td {
  padding: 10px 12px;
  border: 1px solid #E8DCC8;
  vertical-align: top;
}
.financial-table tr:nth-child(even) td { background: #FDFAF5; }
.amount { font-weight: 700; color: #1C1C1C; text-align: right; }
.total-row td { background: #F0E8D8 !important; font-weight: 700; font-size: 10pt; }

/* ── Bloc garantie ── */
.garantie-box {
  background: #F0FBF4;
  border: 1px solid #86EFAC;
  border-left: 4px solid #15803D;
  border-radius: 6px;
  padding: 14px 16px;
  margin: 12px 0;
  font-size: 9.5pt;
  line-height: 1.7;
  color: #1C1C1C;
}
.garantie-box strong { color: #166534; }
.garantie-icon { font-size: 13pt; margin-right: 6px; vertical-align: middle; }

/* ── Clauses / Articles ── */
.clause {
  margin-bottom: 14px;
  page-break-inside: avoid;
}
.clause-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9.5pt;
  font-weight: 700;
  color: #2C2416;
  margin-bottom: 5px;
  letter-spacing: -0.1px;
}
.clause p {
  font-size: 9.5pt;
  color: #2C2416;
  margin-bottom: 6px;
  line-height: 1.65;
}
.clause ul, .clause ol {
  padding-left: 20px;
  margin: 6px 0;
}
.clause li {
  font-size: 9.5pt;
  color: #2C2416;
  margin-bottom: 4px;
  line-height: 1.65;
}

/* ── Tableau descriptif annexe ── */
.annexe-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9pt;
  margin-bottom: 12px;
}
.annexe-table th {
  background: #F0E8D8;
  color: #6B5840;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 7px 10px;
  border: 1px solid #E0D4C0;
  text-align: left;
}
.annexe-table td {
  padding: 8px 10px;
  border: 1px solid #E8DCC8;
  vertical-align: top;
}
.annexe-table tr:nth-child(even) td { background: #FDFAF5; }
.annexe-label { color: #8C7B65; font-size: 8pt; font-family: 'Helvetica Neue', Arial, sans-serif; }

/* ── Bloc signature ── */
.signature-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-top: 20px;
}
.signature-block {
  border: 1px solid #E8DCC8;
  border-radius: 8px;
  padding: 16px;
  min-height: 110px;
  background: #FDFAF5;
}
.signature-label {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #8C7B65;
  margin-bottom: 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid #E8DCC8;
}
.signature-name {
  font-weight: 700;
  font-size: 10pt;
  color: #1C1C1C;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
.signature-note { font-size: 7.5pt; color: #8C7B65; margin-top: 4px; line-height: 1.5; font-family: 'Helvetica Neue', Arial, sans-serif; }
.signature-line {
  border-bottom: 1.5px dashed #CC9933;
  height: 52px;
  margin-top: 14px;
  opacity: 0.5;
}

/* ── Pied de page ── */
.footer {
  margin-top: 32px;
  padding-top: 14px;
  border-top: 1px solid #E8DCC8;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  color: #A09282;
  line-height: 1.8;
  text-align: center;
}

/* ── Sauts de page ── */
.page-break { page-break-before: always; break-before: page; }
.avoid-break { page-break-inside: avoid; break-inside: avoid; }

/* ── Info notice ── */
.notice {
  background: #FFF8E6;
  border: 1px solid #FDE68A;
  border-left: 3px solid #D97706;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 9pt;
  color: #78350F;
  margin: 10px 0;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  img { max-width: 100% !important; }
}
@media screen {
  body > div[style*="height:297mm"] { max-width: 800px; margin: 0 auto; }
}
/* ── Cover page print-safe ── */
.cover-page {
  background:#fff;
}
.hero-section {
  position:relative;
  flex:1;
  min-height:0;
  overflow:hidden;
  background:#fff;
}
.hero-img {
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  object-fit:cover;
  object-position:center 65%;
  -webkit-print-color-adjust:exact !important;
  print-color-adjust:exact !important;
}
.hero-overlay {
  position:absolute;
  inset:0;
  z-index:2;
}
.hero-bg,.hero-gradient,.hero-section::before {
  display:none !important;
  content:none !important;
}
.hero-bg {
  position:absolute; inset:0;
  background-image:url(https://omuncchvypbtxkpalwcr.supabase.co/storage/v1/object/public/rapport-assets/hero.jpg);
  background-size:cover;
  background-position:center 65%;
  background-repeat:no-repeat;
  -webkit-print-color-adjust:exact !important;
  print-color-adjust:exact !important;
}
.hero-gradient {
  position:absolute; inset:0;
  background:linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.45));
  -webkit-print-color-adjust:exact !important;
  print-color-adjust:exact !important;
}
</style>
</head>
<body>
<!-- ══ COVER PAGE ════════════════════════════════════════════════════════════ -->
<div style="page-break-after:always;height:220mm;display:flex;flex-direction:column;background:#F7F3EC;font-family:'Questrial',Georgia,serif;">

  <!-- Logo & tagline -->
  <div style="padding:12mm 0 6mm;text-align:center;">
    <div style="font-size:18px;letter-spacing:3.5px;color:#2C2416;text-transform:uppercase;font-weight:700;">Destination Côte Basque</div>
    <div style="width:48px;height:2px;background:#CC9933;margin:7px auto;"></div>
    <div style="font-size:9px;color:#CC9933;letter-spacing:4px;text-transform:uppercase;font-style:italic;">The Art of Hospitality on the Basque Coast</div>
  </div>

  <!-- Main photo -->
  <div class="hero-section">
  <img class="hero-img" src="{{hero_url}}" alt="" />
  <div class="hero-overlay">
    {{#has_bien_photos}}<div style="position:absolute;bottom:72px;right:18px;width:72px;height:72px;border-radius:50%;overflow:hidden;border:3px solid rgba(255,255,255,0.92);box-shadow:0 4px 18px rgba(0,0,0,.55);"><img src="{{bien_photo_1}}" style="width:100%;height:100%;object-fit:cover;display:block;"></div>{{/has_bien_photos}}
    <div class="hero-gradient"></div>
    <div style="position:absolute;bottom:0;left:0;right:0;padding:14px 20px;color:#fff;text-align:center;">
      <div style="font-size:19px;font-weight:700;letter-spacing:1.5px;line-height:1.3;text-shadow:0 2px 6px rgba(0,0,0,.5);padding:0 92px;">{{bien_nom_public}}</div>
      <div style="font-size:9.5px;color:rgba(255,255,255,.65);margin-top:4px;letter-spacing:2px;text-transform:uppercase;">{{cover_location}}</div>
      <div style="width:28px;height:1px;background:rgba(255,255,255,.4);margin:10px auto 7px;"></div>
      <div style="font-size:13px;font-weight:600;color:#fff;letter-spacing:.5px;text-shadow:0 1px 4px rgba(0,0,0,.5);">{{guest_civilite_affiche}} {{guest_nom_affiche}}</div>
      <div style="font-size:9px;color:rgba(255,255,255,.8);margin-top:3px;">{{date_arrivee_longue}} &rarr; {{date_depart_longue}}</div>
      <div style="font-size:8px;color:rgba(255,255,255,.65);margin-top:2px;letter-spacing:.5px;">{{nb_nuits_label}} &middot; {{guest_nb_personnes_label}}</div>
    </div>
  </div></div></div>
  <!-- Legal footer -->
  <div style="border-top:1px solid #D9CEB8;padding:3mm 0 0;text-align:center;margin-top:auto;">
    <div style="font-size:7px;color:#C0B09A;line-height:2;">
      {{agence_nom}} &middot; {{agence_adresse}} &middot; Tel.&nbsp;{{agence_telephone_affiche}}<br>
      RCS {{agence_rcs}} &middot; {{agence_cpi}} &middot; Insurance {{agence_assurance_affiche}}
    </div>
  </div>

</div>
<!-- ══ END COVER ══════════════════════════════════════════════════════════ -->

<div class="page"><div class="cover-page">

<!-- ══ HEADER ══════════════════════════════════════════════════════ -->
<div class="header">
  <div class="header-left">
    <div class="logo-square">D</div>
    <div class="header-brand">
      <div class="name">Destination Côte Basque</div>
      <div class="sub">Seasonal rental management &amp; real estate</div>
    </div>
  </div>
  <div class="header-right">
    {{agence_adresse}}<br>
    Tel. {{agence_telephone_affiche}}<br>
    {{agence_email_contact}}<br>
    RCS {{agence_rcs}}
  </div>
</div>

<!-- ══ TITLE ════════════════════════════════════════════════════════ -->
<div class="doc-title-block">
  <div class="doc-title">Seasonal Rental Agreement</div>
  <div class="gold-line"></div>
  <div class="doc-subtitle">Executed at {{lieu_signature}}, on {{date_contrat_longue}}</div>
</div>

<!-- ══ 1. PARTIES ═══════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">1</span>
    Parties to the Agreement
  </div>
  <div class="parties-grid">
    <!-- Landlord -->
    <div class="partie-box">
      <div class="partie-label">Landlord (property owner)</div>
      <div class="partie-nom">{{bailleur_nom_affiche}}</div>
      <div class="partie-detail">
        {{bailleur_statut_affiche}}<br>
        {{bailleur_adresse_complete}}
      </div>
    </div>
    <!-- Managing Agent -->
    <div class="partie-box">
      <div class="partie-label">Agent — Managing Agency</div>
      <div class="partie-nom">{{agence_nom}}</div>
      <div class="partie-detail">
        {{agence_adresse}}<br>
        Tel. {{agence_telephone_affiche}}<br>
        {{agence_email_contact}}<br>
        RCS {{agence_rcs}} — {{agence_cpi}}<br>
        issued by {{agence_cpi_delivree_par}}<br>
        {{agence_forme}} with share capital of {{agence_capital}} €<br>
        VAT: {{agence_tva}}<br>
        Represented by {{agence_representant_affiche}}, {{agence_qualite_representant}}
      </div>
    </div>
  </div>
  <!-- Tenant full width -->
  <div class="partie-box" style="margin-top:14px">
    <div class="partie-label">Tenant</div>
    <div class="partie-nom">{{guest_civilite_affiche}} {{guest_nom_affiche}}</div>
    <div class="partie-detail">
      {{#guest_adresse_complete}}Address: {{guest_adresse_affichee}}<br>{{/guest_adresse_complete}}
      E-mail: {{guest_email}}&nbsp;&nbsp;·&nbsp;&nbsp;Phone: {{guest_telephone_affiche}}<br>
      Number of persons: <strong>{{guest_nb_personnes}}</strong>{{guest_detail_personnes}}
    </div>
  </div>
</div>

<!-- ══ 2. DESCRIPTION OF THE PROPERTY ══════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">2</span>
    Description of the Property
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:35%" class="annexe-label">Property type</td>
      <td>{{bien_nature_label}}</td>
      <td style="width:30%" class="annexe-label">Classification</td>
      <td>{{bien_classement_label}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Full address</td>
      <td colspan="3">{{bien_adresse_complete}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Owner</td>
      <td>{{bailleur_nom_affiche}}</td>
      <td class="annexe-label">Maximum capacity</td>
      <td>{{bien_capacite_max_label}}</td>
    </tr>
    {{#has_surface_pieces}}
    <tr>
      <td class="annexe-label">{{bien_superficie_label}}</td>
      <td>{{#bien_superficie}}{{bien_superficie}} m²{{/bien_superficie}}</td>
      <td class="annexe-label">Number of rooms</td>
      <td>{{#bien_nb_pieces}}{{bien_nb_pieces_label}}{{/bien_nb_pieces}}</td>
    </tr>
    {{/has_surface_pieces}}
    {{#has_construction_etage}}
    <tr>
      <td class="annexe-label">Year of construction</td>
      <td>{{bien_date_construction}}</td>
      <td class="annexe-label">Floor</td>
      <td>{{bien_etage}}</td>
    </tr>
    {{/has_construction_etage}}
    {{#a_piscine}}
    <tr>
      <td class="annexe-label">Special amenities</td>
      <td colspan="3">🏊 Private swimming pool included in the rental</td>
    </tr>
    {{/a_piscine}}
  </table>
</div>

<!-- ══ 3. RENTAL PERIOD ═════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">3</span>
    Rental Period
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:30%" class="annexe-label">Check-in</td>
      <td><strong>{{date_arrivee_longue}}</strong> from {{heure_arrivee}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Check-out</td>
      <td><strong>{{date_depart_longue}}</strong> before {{heure_depart}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Length of stay</td>
      <td><strong>{{nb_nuits_label}}</strong></td>
    </tr>
  </table>
  <div class="clause" style="margin-top:12px">
    <div class="clause-title">Check-out time — unauthorised late check-out</div>
    <p>
      The property must be vacated, and the keys returned as instructed, no later than the check-out time stated above or, where applicable, the late check-out time paid for in advance. A <strong>10-minute</strong> grace period applies. Beyond that, a tenant who remains in the property without the agency's written agreement shall owe, as a penalty clause (article 1231-5 of the French Civil Code), <strong>10% of the average price of one night of accommodation</strong> of the stay (excluding fees and taxes) <strong>per 10-minute period started</strong> after the grace period{{#has_penalite_montant}}, i.e. <strong>{{penalite_tranche_eur}} per period</strong> for this stay{{/has_penalite_montant}}, up to <strong>the price of one night</strong>{{#has_penalite_montant}} ({{penalite_plafond_eur}}){{/has_penalite_montant}}. Any actual costs caused by the delay (urgent re-cleaning, rehousing or compensation of the next guests) are added, upon proof.
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      Example for a 10:00 check-out: leaving at 10:10 = no penalty; at 10:15 = 1 period; at 11:00 = 5 periods. A late check-out requested in advance costs €25 until 12:00 or €45 until 14:00, subject to availability; staying without agreement costs up to the price of one night. {{^is_booking_platform}}The amount is {{^is_none_guarantee}}charged to the bank card registered as a guarantee{{/is_none_guarantee}}{{#is_none_guarantee}}invoiced to the tenant{{/is_none_guarantee}}, after written notice stating the observed departure time and the calculation, under the conditions of article 11.{{/is_booking_platform}}{{#is_booking_platform}}For a booking made through a platform (Airbnb, Booking.com…), the amount is claimed through that platform, according to its rules.{{/is_booking_platform}}
    </p>
  </div>
  <p style="font-size:9pt;color:#8C7B65;margin-top:8px;font-family:Arial,sans-serif;">
    Key handover is carried out according to the arrangements communicated by the agency (secure key safe or on-site reception). The tenant undertakes to return the property clean and in the same condition as found, by the time stipulated above.
  </p>
</div>

<!-- ══ 4. FINANCIAL TERMS ════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">4</span>
    Financial Terms
  </div>
  <table class="financial-table">
    <thead>
      <tr>
        <th>Description</th>
        <th style="text-align:right">Amount</th>
        <th>Payment method</th>
      </tr>
    </thead>
    <tbody>
      <!-- Total -->
      <tr>
        <td>Total to pay{{#has_taxes_total}}<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">of which {{taxes_total_eur}} in taxes</span>{{/has_taxes_total}}</td>
        <td class="amount">{{prix_total_eur}}</td>
        <td style="font-size:9pt">{{modalite_loyer_affiche}}</td>
      </tr>{{#has_options}}<tr><td>including selected options<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">{{options_detail}}</span></td><td class="amount">{{options_total_eur}}</td><td style="font-size:9pt"></td></tr>{{/has_options}}{{#has_promo}}<tr><td>{{promo_libelle}}</td><td class="amount">{{promo_montant_eur}}</td><td style="font-size:9pt">{{promo_note}}</td></tr>{{/has_promo}}{{#has_demandes}}<tr><td>Guest requests<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">{{demandes_detail}}</span></td><td class="amount"></td><td style="font-size:9pt">No extra charge, no commitment</td></tr>{{/has_demandes}}
      <!-- Deposit — card (stripe_dcb_contract or cb_50_cash) -->
      {{#is_cb}}
      <tr>
        <td>Deposit ({{acompte_pourcentage}}%)</td>
        <td class="amount">{{acompte_montant_eur}}</td>
        <td style="font-size:9pt">{{#is_prepaye}}{{paye_le_texte}}{{/is_prepaye}}{{^is_prepaye}}Charged to the bank card registered at signing{{/is_prepaye}}</td>
      </tr>
      {{/is_cb}}
      <!-- Deposit — bank transfer -->
      {{#is_bank_transfer}}
      <tr>
        <td>Deposit ({{acompte_pourcentage}}%)</td>
        <td class="amount">{{acompte_montant_eur}}</td>
        <td style="font-size:9pt">Bank transfer at signing (see bank details below)</td>
      </tr>
      {{/is_bank_transfer}}
      <!-- Balance — automatic card (stripe_dcb_contract) -->
      {{#has_solde_stripe}}
      <tr>
        <td>Balance ({{solde_pourcentage}}%) — due on {{date_solde}}</td>
        <td class="amount">{{solde_montant_eur}}</td>
        <td style="font-size:9pt">{{modalite_solde_affiche}} ({{date_solde_motif}})</td>
      </tr>
      {{/has_solde_stripe}}
      <!-- Balance — bank transfer -->
      {{#has_solde_virement}}
      <tr>
        <td>Balance ({{solde_pourcentage}}%) — due on {{date_solde}}</td>
        <td class="amount">{{solde_montant_eur}}</td>
        <td style="font-size:9pt">Bank transfer before due date</td>
      </tr>
      {{/has_solde_virement}}
      <!-- Balance — cash (cb_50_cash) -->
      {{#has_solde_cash}}
      <tr>
        <td>Balance ({{solde_pourcentage}}%) — payable in cash on arrival, {{date_arrivee_longue}}</td>
        <td class="amount">{{solde_montant_eur}}</td>
        <td style="font-size:9pt">Cash handed over at check-in</td>
      </tr>
      {{/has_solde_cash}}
      <!-- Tourist tax -->
      {{#has_taxe_sejour}}
      <tr>
        <td>Tourist tax</td>
        <td class="amount">{{taxe_sejour_eur}}</td>
        <td style="font-size:9pt">Collected and remitted to the local authority</td>
      </tr>
      {{/has_taxe_sejour}}
    </tbody>
  </table>
  <!-- Contextual notices by payment mode -->
  {{#is_stripe_contract}}{{^is_cb_50_cash}}
  <div class="notice" style="margin-top:12px">
    ⚠️ {{^is_prepaye}}Payments are automatically charged to the bank card registered at signing.{{/is_prepaye}}{{#is_prepaye}}The deposit was paid online ({{paye_le_texte_min}}); the balance is automatically charged on {{date_solde}} to the same card.{{/is_prepaye}} In case of failure, the tenant will be contacted to settle the payment.
  </div>
  {{/is_cb_50_cash}}{{/is_stripe_contract}}
  {{#is_bank_transfer}}
  <div class="notice" style="margin-top:12px">
    ⚠️ Any late wire transfer may result in contract termination under the conditions of Article 8.
  </div>
  {{/is_bank_transfer}}
  {{#is_cb_50_cash}}
  <div class="notice" style="margin-top:12px">
    ⚠️ {{#is_cb}}The deposit is charged to the card at signing.{{/is_cb}}{{#is_bank_transfer}}The deposit is paid by bank transfer at signing.{{/is_bank_transfer}} The balance of {{solde_montant_eur}} is payable in cash, handed to the agency or its representative upon check-in on {{date_arrivee_longue}}; it is not charged to the card.
  </div>
  {{/is_cb_50_cash}}
  <!-- Bank details / escrow (bank transfer only) -->
  {{#has_rib}}
  <div class="notice" style="margin-top:10px;background:#EFF6FF;border-color:#93C5FD;color:#1E3A5F;page-break-inside:avoid;break-inside:avoid;">
    <strong>📄 Bank Details — Escrow Transfer</strong><br>
    Account holder: <strong>{{rib_titulaire}}</strong><br>
    IBAN: <strong>{{rib_iban}}</strong><br>
    BIC: {{rib_bic}} &nbsp;·&nbsp; Bank: {{rib_banque}}<br><em style="font-size:8.5pt;color:#5C7FB0">Payment reference: <strong>{{virement_reference}}</strong></em>
  </div>
  {{/has_rib}}
{{#is_booking_platform}}
  <div class="notice" style="margin-top:10px;background:#EEF6FF;border-color:#93C5FD;color:#1E3A5F;">
    ℹ️ <strong>Payment managed by Booking.com</strong><br>
    The payment for this stay is managed by Booking.com in accordance with the conditions accepted at the time of booking.<br>
    <em style="font-size:8.5pt;color:#5C7FB0;">This contract supplements the stay conditions: identity, occupancy, house rules, check-in/check-out inspection, security deposit and any additional charges.</em>
  </div>
{{/is_booking_platform}}
</div>

<!-- ══ 5. SECURITY GUARANTEE ════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">5</span>
    Security Guarantee
  </div>
  {{#is_stripe_card_on_file}}
  <div class="garantie-box">
    <span class="garantie-icon">🔐</span>
    <strong>Card registered as a guarantee</strong><br><br>
    {{garantie_clause}}
  </div>
  <p style="font-size:8.5pt;color:#8C7B65;font-family:Arial,sans-serif;margin-top:8px;">
    The bank card is securely registered via Stripe (PCI-DSS Level 1). No card number is stored by Destination Côte Basque.
  </p>
  {{/is_stripe_card_on_file}}
  {{#is_none_guarantee}}
  <p style="font-size:9.5pt;font-family:Arial,sans-serif;color:#555;margin:0;">
    No additional bank guarantee is required for this stay. The tenant remains liable for any damage observed at the final property inspection, in accordance with Article 9.
  </p>
  {{/is_none_guarantee}}
</div>

<!-- ══ 6. TENANT'S OBLIGATIONS ══════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">6</span>
    Tenant's Obligations
  </div>
  <div class="clause">
    <p>The tenant undertakes to:</p>
    <ul>
      <li>Occupy the premises personally, peacefully, as a responsible tenant, and in accordance with their temporary seasonal residential purpose.</li>
      <li>Not sublet or assign this agreement, partially or in full, without prior written consent from the landlord.</li>
      <li>Strictly respect the maximum number of authorised occupants ({{bien_capacite_max_label}}). Any additional occupation is strictly prohibited without written authorisation.</li>
      <li>Not bring animals onto the premises unless explicitly authorised in writing by the agency.</li>
      <li>Respect neighbourhood rules, particularly quiet hours between 10:00 PM and 8:00 AM.</li>
      <li>Not conduct any commercial or professional activity on the premises.</li>
      <li>Immediately report any damage or breakdown to the agency.</li>
      <li>Vacate the property by the check-out time of the stay (article 3): any unauthorised late check-out is charged as set out in article 3; a late check-out may be requested in advance.</li>
      <li>Return the property in its initial inventory condition: clean dishes, cleaned appliances, waste removed, bed linen stripped.</li>
      <li>Not smoke inside the property.</li>
      {{#a_piscine}}<li>Comply with pool safety rules: never leave minors unsupervised, do not use the pool between 11:00 PM and 7:00 AM.</li>{{/a_piscine}}
    </ul>
  </div>
</div>

<!-- ══ 7. HOLIDAY INSURANCE ═════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">7</span>
    Holiday Insurance
  </div>
  <div class="clause">
    <p>
      The <strong>holiday liability insurance</strong> covers damage that may be caused to the accommodation, its contents and to third parties (fire, water damage, theft, breakage) during the stay. The tenant indicates below their situation regarding this coverage:
    </p>
    <div style="margin:14px 0;display:flex;flex-direction:column;gap:6px;font-size:10pt">
{{#is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_platform}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Checked box (option selected)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_platform}}{{^assurance_choice_platform}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Unchecked box" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_platform}}</span>
        <span>Holiday coverage included via the booking platform ({{assurance_platform_name}})</span>
      </div>
{{/is_booking_platform}}
{{^is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_mrh}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Checked box (option selected)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_mrh}}{{^assurance_choice_mrh}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Unchecked box" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_mrh}}</span>
        <span>I hold a holiday liability insurance covering the period of the stay and can provide a certificate upon request.</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_no_insurance}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Checked box (option selected)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_no_insurance}}{{^assurance_choice_no_insurance}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Unchecked box" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_no_insurance}}</span>
        <span>I declare that I do not hold any holiday liability insurance covering damage that may be caused to the rented accommodation during my stay. I have been informed that I may be held personally liable for any material damage caused to the accommodation, its furnishings or to third parties during the rental period, and I agree to proceed with the booking without such coverage.</span>
      </div>
{{/is_booking_platform}}
    </div>
    <p style="font-weight:700">
      The absence of holiday insurance does not in any way release the tenant from liability for any damage caused to the accommodation or its contents.
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      Note: the agency's insurance covers only the professional civil liability of {{agence_nom}} (insurance {{agence_assurance_affiche}}). It does not substitute the tenant's personal insurance.
    </p>
  </div>
</div>

<!-- ══ 8. CANCELLATION AND TERMINATION CONDITIONS ════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">8</span>
    Cancellation and Termination Conditions
  </div>
  <div class="clause">
    <p>Any cancellation must be notified in writing (e-mail to {{agence_email_contact}}):</p>
{{clause_annulation}}
    <p>
      In the event of termination by the landlord or agency for reasons beyond the tenant's control, all payments made will be fully refunded within 15 days.
    </p>
  </div>
</div>

<!-- ══ 9. PERSONAL DATA PROTECTION (GDPR) ════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">9</span>
    Personal Data Protection (GDPR)
  </div>
  <div class="clause">
    <div class="clause-title">9.1 Data Controller</div>
    <p>
      {{agence_nom}}, {{agence_adresse}} (the "Data Controller"), processes your personal data in the context of managing your reservation and the contractual relationship.
    </p>
    <div class="clause-title" style="margin-top:10px">9.2 Data Collected and Purposes</div>
    <p>The data collected (surname, first name, address, e-mail, phone number, payment data) is processed for:</p>
    <ul>
      <li>The management and execution of this rental agreement;</li>
      <li>The management of payments and the security guarantee;</li>
      <li>Compliance with legal obligations (tourist tax declaration, fiscal obligations);</li>
      <li>Identity verification for the security of the property.</li>
    </ul>
    <div class="clause-title" style="margin-top:10px">9.3 Retention Period</div>
    <p>
      Contract data is retained for <strong>5 years</strong> from the end of the stay (accounting obligations). The identity documents (verification photo and identity document) are kept for <strong>1 year</strong> from the end of the stay, then permanently deleted. Bank card data is managed exclusively by Stripe — no full card number is stored by {{agence_nom}}.
    </p>
    <div class="clause-title" style="margin-top:10px">9.4 Tenant's Rights</div>
    <p>
      In accordance with the GDPR (EU Regulation 2016/679) and French Data Protection Law, you have the right of access, rectification, deletion and portability of your data, as well as the right to object to processing. To exercise these rights: {{agence_email_contact}}.
    </p>
    <div class="clause-title" style="margin-top:10px">9.5 Third-Party Transfers</div>
    <p>
      Your data is shared, strictly to the extent necessary, with: Stripe Inc. (payment, United States — adequacy decision EU-US Data Privacy Framework), Twilio Inc. (SMS verification), and services hosted on Supabase (Cloud infrastructure, EU). No data is sold to third parties.
    </p>
    <div class="clause-title" style="margin-top:10px">9.6 Document security and identity verification</div>
    <p>
      The verification photo taken at signature undergoes an automated check whose sole purpose is to verify that a face is visible and usable (photo not blank, not blurred, not taken of a screen). This check does not aim to identify the person: it involves no facial recognition, no comparison with the identity document and no processing of biometric data. It is based on the legitimate interest of {{agence_nom}} in preventing fraud and securing access to the property, and cannot on its own prevent signature: after two further attempts, the photo is accepted. It is performed by our processor Anthropic PBC (United States) under the standard contractual clauses adopted by the European Commission; Anthropic does not use this data to train its models and deletes it within 30 days, unless longer retention is required by law or to enforce its usage policies. The identity document is never sent to it. The verification photo and the identity document are marked upon receipt with the watermark “document destiné uniquement à la location saisonnière” (document intended solely for the seasonal rental) and are never stored without it. The signed contract is electronically sealed by {{agence_nom}}: any later modification of the document can be detected.
    </p>
  </div>
</div>

<!-- ══ 10. PROPERTY INSPECTION ══════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">10</span>
    Property Inspection
  </div>
  <div class="clause">
    <div class="clause-title">10.1 Check-in Inspection</div>
    <p>
      A joint inspection is carried out upon the tenant's arrival, in the presence of an agency representative or by equivalent means (digital form, dated photos). The tenant has <strong>24 hours</strong> from key handover to report any damage or reservation not mentioned in the initial inspection, in writing to {{agence_email_contact}}.
    </p>
    <div class="clause-title" style="margin-top:10px">10.2 Check-out Inspection</div>
    <p>
      At the end of the stay, a joint check-out inspection is conducted according to the same procedures. The property must be returned in the condition noted at check-in, cleaned, and in accordance with the attached inventory. Any damage noted at check-out that was not recorded at check-in will be charged to the tenant.
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      In the absence of the tenant at the check-out inspection, the inspection will be conducted unilaterally by the agency and notified to the tenant within 48 hours by e-mail. The tenant may submit observations within 5 days of the notification.
    </p>
  </div>
</div>

<!-- ══ 11. DEDUCTIONS AND RESTORATION COSTS ════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">11</span>
    Deductions and Restoration Costs
  </div>
  <div class="clause">
    <p>
      In the event of damage observed at the check-out inspection, breach of the tenant's obligations, or additional costs incurred, the agency may charge the bank card registered as a security guarantee (Article 5), after justification and written notification to the tenant, for the following reasons:
    </p>
    <ul>
      <li><strong>Property left in heavily soiled condition:</strong> billing of actual cleaning costs (minimum €80).</li>
      <li><strong>Sheets or towels heavily stained beyond normal use:</strong> additional laundering or replacement fee (minimum €30 per set).</li>
      <li><strong>Broken, damaged or missing items:</strong> replacement or repair at actual justified cost.</li>
      <li><strong>Large or excessive amounts of waste not removed:</strong> removal fee (minimum €50).</li>
      <li><strong>Keys not returned:</strong> lock or key safe replacement (actual cost).</li>
      <li><strong>Unauthorised occupation (animals, overcrowding):</strong> fixed penalty of €100 plus 5% of the total stay amount, without prejudice to other damages.</li>
      <li><strong>Unauthorised late check-out:</strong> penalty of 10% of the price of one night per 10-minute period started after a 10-minute grace period, capped at the price of one night, plus justified actual costs (article 3).</li>
    </ul>
    <p style="font-size:9pt;color:#8C7B65;margin-top:8px;">
      Any charge will be preceded by a notification email detailing the reasons and amounts. The tenant has 7 days to contest in writing. In the absence of a written contest within this period, the charge is deemed accepted.
    </p>
  </div>
</div>

<!-- ══ 12. EMERGENCY REPAIRS — ACCESS TO THE PROPERTY ════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">12</span>
    Emergency Repairs — Access to the Property
  </div>
  <div class="clause">
    <p>
      The tenant is required to immediately notify the agency of any breakdown or damage observed. The tenant expressly authorises the agency or its contractors to access the property for any urgent work necessary to preserve it (water leak, heating failure, electrical issue, etc.), even in the tenant's absence, after prior notification.
    </p>
    <p>
      Such urgent interventions do not entitle the tenant to any reduction in rent, unless they deprive the tenant of the use of a substantial part of the property for more than 48 consecutive hours. In that case, a proportional reduction will be calculated by mutual agreement.
    </p>
  </div>
</div>

<!-- ══ 13. FORCE MAJEURE ════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">13</span>
    Force Majeure
  </div>
  <div class="clause">
    <p>
      Neither the landlord nor the agency shall be held liable for non-performance or delay in performance of their obligations in the event of force majeure within the meaning of Article 1218 of the French Civil Code (natural disaster, fire, flood, administrative decision, pandemic with closure imposed by authorities, etc.).
    </p>
    <p>
      In the event of force majeure rendering the property uninhabitable or inaccessible, all amounts paid by the tenant will be fully refunded within 15 days, to the exclusion of any other compensation. Tenants are advised to take out cancellation insurance to cover cases not covered by statutory force majeure.
    </p>
  </div>
</div>

<!-- ══ 14. APPLICABLE LAW AND JURISDICTION ══════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">14</span>
    Applicable Law, Mediation and Jurisdiction
  </div>
  <div class="clause">
    <p>
      This agreement is governed by French law. In the event of a dispute, the parties agree to attempt an amicable resolution before taking legal action.
    </p>
    <p>
      In accordance with Articles L612-1 et seq. of the French Consumer Code, if a dispute remains unresolved after a prior written complaint to the agency, the tenant may refer it, free of charge, to the following consumer mediator: Centre de la Médiation de la Consommation de Conciliateurs de Justice (CM2C), 49 rue de Ponthieu, 75008 Paris, France – www.cm2c.net (online application) – +33 1 89 47 00 14. The mediator must be contacted within one year of the written complaint sent to the agency.
    </p>
    <p>
      Failing amicable agreement, the Judicial Court of Bayonne shall have sole jurisdiction, unless a mandatory provision to the contrary applies to the consumer tenant.
    </p>
  </div>
</div>

<!-- ══ SIGNATURES ════════════════════════════════════════════════════ -->
<div class="section avoid-break">
  <div class="section-title">
    <span class="section-title-num" style="background:linear-gradient(135deg,#2C2416,#4A3820)">✍</span>
    Signatures of the Parties
  </div>
  <div style="background:#FDFAF5;border:1px solid #E8DCC8;border-left:3px solid #CC9933;border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:9pt;color:#4A3F32;font-family:'Helvetica Neue',Arial,sans-serif;line-height:1.7">
    The tenant acknowledges having read the entire agreement (including the descriptive annex), having had the opportunity to ask any questions, and accepts without reservation the terms and conditions defined above. The electronic signature affixed below has the same legal value as a handwritten signature (EU Regulation No 910/2014 eIDAS, and French law of 13 March 2000, Art. 1366 and 1367 of the Civil Code).
  </div>
  <div class="signature-grid">
    <div class="signature-block">
      <div class="signature-label">For the landlord / agent</div>
      <div class="signature-name">{{agence_nom}}</div>
      <div class="signature-note">Represented by {{agence_representant_affiche}}, {{agence_qualite_representant}}<br>{{agence_email_representant}}</div>
      <div style="margin-top:10px;text-align:center">
        <div style="font-size:8pt;color:#8C7B65;margin-bottom:4px">Electronically signed</div>
        <div style="font-family:'Northwell',cursive;font-size:20pt;color:#CC9933;line-height:1;padding:4px 0">Oihan Campandegui</div>
        <div style="font-size:7.5pt;color:#A09282;margin-top:2px">{{agence_qualite_representant}} — {{agence_nom}}</div>
      </div>
    </div>
    <div class="signature-block">
      <div class="signature-label">Tenant — electronic signature</div>
      <div class="signature-name">{{guest_civilite_affiche}} {{guest_nom_affiche}}</div>
      <div class="signature-note">Signature affixed via the secure portal contrat.destinationcotebasque.com</div>
      <div class="signature-line"></div>
    </div>
  </div>
</div>

<!-- ══ ANNEX — PROPERTY DESCRIPTION ════════════════════════════════ -->
<div class="page-break"></div>
<div class="header" style="margin-bottom:0;padding:20px 0 16px">
  <div class="header-left">
    <div class="logo-square" style="width:38px;height:38px;font-size:18px">D</div>
    <div class="header-brand">
      <div class="name" style="font-size:11pt">Destination Côte Basque</div>
      <div class="sub">Annex to the Seasonal Rental Agreement</div>
    </div>
  </div>
  <div class="header-right">{{date_contrat_longue}}</div>
</div>
<div class="doc-title-block" style="padding:18px 0 14px;margin-bottom:20px">
  <div class="doc-title" style="font-size:12pt;letter-spacing:2px">Property Description</div>
  <div class="gold-line"></div>
  <div class="doc-subtitle">{{bien_nom_public}}</div>
  <div class="doc-subtitle" style="margin-top:2px;font-size:8.5pt;">{{bien_adresse_complete}}</div>
</div>
<div class="section">
  <div class="section-title">
    <span class="section-title-num">A</span>
    General Characteristics
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:28%" class="annexe-label">Address</td>
      <td colspan="3">{{bien_adresse_complete}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Type / Category</td>
      <td>{{bien_nature_label}}</td>
      <td style="width:28%" class="annexe-label">Classification</td>
      <td>{{bien_classement_label}}</td>
    </tr>
    {{#has_surface_pieces}}
    <tr>
      <td class="annexe-label">{{bien_superficie_label}}</td>
      <td>{{#bien_superficie}}{{bien_superficie}} m²{{/bien_superficie}}</td>
      <td class="annexe-label">No. of main rooms</td>
      <td>{{bien_nb_pieces}}</td>
    </tr>
    {{/has_surface_pieces}}
    {{#has_construction_etage}}
    <tr>
      <td class="annexe-label">Year of construction</td>
      <td>{{bien_date_construction}}</td>
      <td class="annexe-label">Floor</td>
      <td>{{bien_etage}}</td>
    </tr>
    {{/has_construction_etage}}
    <tr>
      <td class="annexe-label">Maximum occupancy</td>
      <td>{{bien_capacite_max_label}} max.</td>
      {{#has_exposition}}
      <td class="annexe-label">Orientation</td>
      <td>{{bien_exposition}}</td>
      {{/has_exposition}}
      {{#has_no_exposition}}
      <td colspan="2"></td>
      {{/has_no_exposition}}
    </tr>
    {{#has_voisinage}}
    <tr>
      <td class="annexe-label">Environment / Surroundings</td>
      <td colspan="3">{{bien_voisinage}}</td>
    </tr>
    {{/has_voisinage}}
    {{#a_piscine}}
    <tr>
      <td class="annexe-label">Special amenities</td>
      <td colspan="3">Private swimming pool — reserved for occupants of the property</td>
    </tr>
    {{/a_piscine}}
  </table>

  {{#has_distances}}
  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">B</span>
    Distances and Location
  </div>
  <table class="annexe-table">
    <thead>
      <tr>
        <th>Reference point</th>
        <th>Approximate distance</th>
      </tr>
    </thead>
    <tbody>
      {{#bien_distance_mer}}
      <tr>
        <td>Sea / ocean</td>
        <td>{{bien_distance_mer}}</td>
      </tr>
      {{/bien_distance_mer}}
      {{#bien_distance_plage}}
      <tr>
        <td>Nearest beach</td>
        <td>{{bien_distance_plage}}</td>
      </tr>
      {{/bien_distance_plage}}
      {{#bien_distance_gare}}
      <tr>
        <td>Train station</td>
        <td>{{bien_distance_gare}}</td>
      </tr>
      {{/bien_distance_gare}}
      {{#bien_distance_centre}}
      <tr>
        <td>Town centre</td>
        <td>{{bien_distance_centre}}</td>
      </tr>
      {{/bien_distance_centre}}
    </tbody>
  </table>
  {{/has_distances}}

  {{#has_description_pieces}}
  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">C</span>
    Room Description
  </div>
  <table class="annexe-table">
    <thead>
      <tr>
        <th>Room</th>
        <th>Description &amp; amenities</th>
      </tr>
    </thead>
    <tbody>
      {{#has_desc_sejour}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Living room / Lounge</td>
        <td>{{bien_description_sejour}}</td>
      </tr>
      {{/has_desc_sejour}}
      {{#has_desc_cuisine}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Kitchen</td>
        <td>{{bien_cuisine}}</td>
      </tr>
      {{/has_desc_cuisine}}
      {{#has_desc_sdb}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Bathroom</td>
        <td>{{bien_sdb}}</td>
      </tr>
      {{/has_desc_sdb}}
      {{#has_desc_toilettes}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Toilet</td>
        <td>{{bien_toilettes}}</td>
      </tr>
      {{/has_desc_toilettes}}
      {{#has_desc_etat}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">General condition</td>
        <td>{{bien_etat_general}}</td>
      </tr>
      {{/has_desc_etat}}
    </tbody>
  </table>
  {{/has_description_pieces}}

  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">D</span>
    Access Hours (Check-in / Check-out)
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:50%" class="annexe-label">Check-in time</td>
      <td>From {{heure_arrivee}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Check-out time</td>
      <td>Before {{heure_depart}}</td>
    </tr>
  </table>
</div>

<!-- ══ FOOTER ═══════════════════════════════════════════════════════ -->
<div class="footer">
  {{agence_nom}} — {{agence_adresse}} — {{agence_email_contact}} — Tel. {{agence_telephone_affiche}}<br>
  Professional Card {{agence_cpi}} issued by {{agence_cpi_delivree_par}} — RCS {{agence_rcs}} — VAT {{agence_tva}}<br>
  Professional liability insurance: {{agence_assurance_affiche}} — Financial guarantee: {{agence_garantie_galian}}<br>
  <em>Document generated automatically on {{date_contrat_longue}} — Certified electronic signature</em>
</div>

</div><!-- /.page -->
</body>
</html>
$tpl469$, $v$[]$v$::jsonb, false
where not exists (select 1 from contract_templates where agence='dcb' and langue='en' and type_contrat='saisonnier' and version='2026-v6');

-- dcb saisonnier es : 2026-v5 → 2026-v6
insert into contract_templates (agence, langue, type_contrat, version, nom, contenu_html, variables_attendues, is_active)
select 'dcb', 'es', 'saisonnier', '2026-v6', null, $tpl469$<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Contrato de arrendamiento estacional — Destination Côte Basque</title>
<style>
/* ── Reset ── */
* { margin: 0; padding: 0; box-sizing: border-box; }
@font-face {
  font-family: 'Northwell';
  src: url('https://dcb-contrats.vercel.app/fonts/Northwell.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
}

/* ── Page PDF ── */
@page {
  size: A4;
  margin: 20mm 15mm 22mm;
  @bottom-right {
    content: "Page " counter(page) " / " counter(pages);
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 7.5pt;
    color: #A09282;
  }
  @bottom-left {
    content: "Destination Côte Basque — Contrato de arrendamiento estacional";
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 7.5pt;
    color: #A09282;
  }
}

body {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 10.5pt;
  color: #1C1C1C;
  line-height: 1.65;
  background: #fff;
  counter-reset: page;
}

/* ── Mise en page ── */
.page { max-width: 800px; margin: 0 auto; padding: 0 20px; }

/* ── En-tête ── */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28px 0 20px;
  border-bottom: 0;
  margin-bottom: 0;
  position: relative;
}
.header::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #CC9933 0%, #E4A853 50%, #CC9933 100%);
  border-radius: 2px;
}
.header-left { display: flex; align-items: center; gap: 14px; }
.logo-square {
  width: 50px; height: 50px;
  background: linear-gradient(135deg, #D4A035 0%, #CC9933 60%, #B8872A 100%);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 24px; font-weight: 700;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(204,153,51,0.30);
}
.header-brand { font-family: 'Helvetica Neue', Arial, sans-serif; }
.header-brand .name { font-size: 14pt; font-weight: 700; color: #1C1C1C; letter-spacing: -0.3px; }
.header-brand .sub  { font-size: 8pt; color: #8C7B65; letter-spacing: 2px; text-transform: uppercase; margin-top: 1px; }
.header-right {
  text-align: right;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 8pt; color: #8C7B65; line-height: 1.8;
}

/* ── Titre principal ── */
.doc-title-block {
  text-align: center;
  padding: 28px 0 20px;
  border-bottom: 1px solid #EAE0D0;
  margin-bottom: 26px;
}
.doc-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 15pt;
  font-weight: 700;
  color: #1C1C1C;
  text-transform: uppercase;
  letter-spacing: 3px;
  margin-bottom: 8px;
}
.doc-subtitle {
  font-size: 9.5pt;
  color: #8C7B65;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-style: italic;
}
.gold-line {
  width: 48px; height: 2px;
  background: linear-gradient(90deg, #CC9933, #E4A853, #CC9933);
  margin: 12px auto;
  border-radius: 2px;
}

/* ── Sections ── */
.section {
  margin-bottom: 24px;
  page-break-inside: avoid;
}
.section-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 8.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: #CC9933;
  border-bottom: 1.5px solid #E8DCC8;
  padding-bottom: 6px;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 0;
}
.section-title-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #D4A035, #CC9933);
  color: #fff;
  border-radius: 50%;
  width: 22px; height: 22px;
  font-size: 9pt;
  font-weight: 700;
  margin-right: 10px;
  flex-shrink: 0;
  box-shadow: 0 1px 4px rgba(204,153,51,0.30);
}

/* ── Blocs parties ── */
.parties-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 4px;
}
.partie-box {
  background: #FDFAF5;
  border: 1px solid #E8DCC8;
  border-left: 3px solid #CC9933;
  border-radius: 6px;
  padding: 14px 16px;
}
.partie-label {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: #8C7B65;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #E8DCC8;
}
.partie-nom {
  font-size: 11pt;
  font-weight: 700;
  color: #1C1C1C;
  margin-bottom: 5px;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
.partie-detail {
  font-size: 9pt;
  color: #4A3F32;
  line-height: 1.75;
}

/* ── Tableau financier ── */
.financial-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9.5pt;
  margin-bottom: 4px;
  border-radius: 6px;
  overflow: hidden;
}
.financial-table th {
  background: #F0E8D8;
  color: #6B5840;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 8px 12px;
  text-align: left;
  border: 1px solid #E0D4C0;
}
.financial-table td {
  padding: 10px 12px;
  border: 1px solid #E8DCC8;
  vertical-align: top;
}
.financial-table tr:nth-child(even) td { background: #FDFAF5; }
.amount { font-weight: 700; color: #1C1C1C; text-align: right; }
.total-row td { background: #F0E8D8 !important; font-weight: 700; font-size: 10pt; }

/* ── Bloc garantie ── */
.garantie-box {
  background: #F0FBF4;
  border: 1px solid #86EFAC;
  border-left: 4px solid #15803D;
  border-radius: 6px;
  padding: 14px 16px;
  margin: 12px 0;
  font-size: 9.5pt;
  line-height: 1.7;
  color: #1C1C1C;
}
.garantie-box strong { color: #166534; }
.garantie-icon { font-size: 13pt; margin-right: 6px; vertical-align: middle; }

/* ── Clauses / Articles ── */
.clause {
  margin-bottom: 14px;
  page-break-inside: avoid;
}
.clause-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9.5pt;
  font-weight: 700;
  color: #2C2416;
  margin-bottom: 5px;
  letter-spacing: -0.1px;
}
.clause p {
  font-size: 9.5pt;
  color: #2C2416;
  margin-bottom: 6px;
  line-height: 1.65;
}
.clause ul, .clause ol {
  padding-left: 20px;
  margin: 6px 0;
}
.clause li {
  font-size: 9.5pt;
  color: #2C2416;
  margin-bottom: 4px;
  line-height: 1.65;
}

/* ── Tableau descriptif annexe ── */
.annexe-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9pt;
  margin-bottom: 12px;
}
.annexe-table th {
  background: #F0E8D8;
  color: #6B5840;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 7px 10px;
  border: 1px solid #E0D4C0;
  text-align: left;
}
.annexe-table td {
  padding: 8px 10px;
  border: 1px solid #E8DCC8;
  vertical-align: top;
}
.annexe-table tr:nth-child(even) td { background: #FDFAF5; }
.annexe-label { color: #8C7B65; font-size: 8pt; font-family: 'Helvetica Neue', Arial, sans-serif; }

/* ── Bloc signature ── */
.signature-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-top: 20px;
}
.signature-block {
  border: 1px solid #E8DCC8;
  border-radius: 8px;
  padding: 16px;
  min-height: 110px;
  background: #FDFAF5;
}
.signature-label {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #8C7B65;
  margin-bottom: 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid #E8DCC8;
}
.signature-name {
  font-weight: 700;
  font-size: 10pt;
  color: #1C1C1C;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
.signature-note { font-size: 7.5pt; color: #8C7B65; margin-top: 4px; line-height: 1.5; font-family: 'Helvetica Neue', Arial, sans-serif; }
.signature-line {
  border-bottom: 1.5px dashed #CC9933;
  height: 52px;
  margin-top: 14px;
  opacity: 0.5;
}

/* ── Pied de page ── */
.footer {
  margin-top: 32px;
  padding-top: 14px;
  border-top: 1px solid #E8DCC8;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  color: #A09282;
  line-height: 1.8;
  text-align: center;
}

/* ── Sauts de page ── */
.page-break { page-break-before: always; break-before: page; }
.avoid-break { page-break-inside: avoid; break-inside: avoid; }

/* ── Info notice ── */
.notice {
  background: #FFF8E6;
  border: 1px solid #FDE68A;
  border-left: 3px solid #D97706;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 9pt;
  color: #78350F;
  margin: 10px 0;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  img { max-width: 100% !important; }
}
@media screen {
  body > div[style*="height:297mm"] { max-width: 800px; margin: 0 auto; }
}
/* ── Cover page print-safe ── */
.cover-page {
  background:#fff;
}
.hero-section {
  position:relative;
  flex:1;
  min-height:0;
  overflow:hidden;
  background:#fff;
}
.hero-img {
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  object-fit:cover;
  object-position:center 65%;
  -webkit-print-color-adjust:exact !important;
  print-color-adjust:exact !important;
}
.hero-overlay {
  position:absolute;
  inset:0;
  z-index:2;
}
.hero-bg,.hero-gradient,.hero-section::before {
  display:none !important;
  content:none !important;
}
.hero-bg {
  position:absolute; inset:0;
  background-image:url(https://omuncchvypbtxkpalwcr.supabase.co/storage/v1/object/public/rapport-assets/hero.jpg);
  background-size:cover;
  background-position:center 65%;
  background-repeat:no-repeat;
  -webkit-print-color-adjust:exact !important;
  print-color-adjust:exact !important;
}
.hero-gradient {
  position:absolute; inset:0;
  background:linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.45));
  -webkit-print-color-adjust:exact !important;
  print-color-adjust:exact !important;
}
</style>
</head>
<body>
<!-- ══ PORTADA ════════════════════════════════════════════════════════════════ -->
<div style="page-break-after:always;height:220mm;display:flex;flex-direction:column;background:#F7F3EC;font-family:'Questrial',Georgia,serif;">

  <!-- Logo & tagline -->
  <div style="padding:12mm 0 6mm;text-align:center;">
    <div style="font-size:18px;letter-spacing:3.5px;color:#2C2416;text-transform:uppercase;font-weight:700;">Destination Côte Basque</div>
    <div style="width:48px;height:2px;background:#CC9933;margin:7px auto;"></div>
    <div style="font-size:9px;color:#CC9933;letter-spacing:4px;text-transform:uppercase;font-style:italic;">El arte de la hospitalidad en la Costa Vasca</div>
  </div>

  <!-- Foto principal -->
  <div class="hero-section">
  <img class="hero-img" src="{{hero_url}}" alt="" />
  <div class="hero-overlay">
    {{#has_bien_photos}}<div style="position:absolute;bottom:72px;right:18px;width:72px;height:72px;border-radius:50%;overflow:hidden;border:3px solid rgba(255,255,255,0.92);box-shadow:0 4px 18px rgba(0,0,0,.55);"><img src="{{bien_photo_1}}" style="width:100%;height:100%;object-fit:cover;display:block;"></div>{{/has_bien_photos}}
    <div class="hero-gradient"></div>
    <div style="position:absolute;bottom:0;left:0;right:0;padding:14px 20px;color:#fff;text-align:center;">
      <div style="font-size:19px;font-weight:700;letter-spacing:1.5px;line-height:1.3;text-shadow:0 2px 6px rgba(0,0,0,.5);padding:0 92px;">{{bien_nom_public}}</div>
      <div style="font-size:9.5px;color:rgba(255,255,255,.65);margin-top:4px;letter-spacing:2px;text-transform:uppercase;">{{cover_location}}</div>
      <div style="width:28px;height:1px;background:rgba(255,255,255,.4);margin:10px auto 7px;"></div>
      <div style="font-size:13px;font-weight:600;color:#fff;letter-spacing:.5px;text-shadow:0 1px 4px rgba(0,0,0,.5);">{{guest_civilite_affiche}} {{guest_nom_affiche}}</div>
      <div style="font-size:9px;color:rgba(255,255,255,.8);margin-top:3px;">{{date_arrivee_longue}} &rarr; {{date_depart_longue}}</div>
      <div style="font-size:8px;color:rgba(255,255,255,.65);margin-top:2px;letter-spacing:.5px;">{{nb_nuits_label}} &middot; {{guest_nb_personnes_label}}</div>
    </div>
  </div></div>

  <!-- Pie legal -->
  <div style="border-top:1px solid #D9CEB8;padding:3mm 0 0;text-align:center;margin-top:auto;">
    <div style="font-size:7px;color:#C0B09A;line-height:2;">
      {{agence_nom}} &middot; {{agence_adresse}} &middot; Tel.&nbsp;{{agence_telephone_affiche}}<br>
      RCS {{agence_rcs}} &middot; {{agence_cpi}} &middot; Seguro {{agence_assurance_affiche}}
    </div>
  </div>

</div>
<!-- ══ FIN PORTADA ═══════════════════════════════════════════════════════════ -->

<div class="page"><div class="cover-page">

<!-- ══ CABECERA ══════════════════════════════════════════════════════ -->
<div class="header">
  <div class="header-left">
    <div class="logo-square">D</div>
    <div class="header-brand">
      <div class="name">Destination Côte Basque</div>
      <div class="sub">Gestión de alquileres e inmobiliaria</div>
    </div>
  </div>
  <div class="header-right">
    {{agence_adresse}}<br>
    Tel. {{agence_telephone_affiche}}<br>
    {{agence_email_contact}}<br>
    RCS {{agence_rcs}}
  </div>
</div>

<!-- ══ TÍTULO ════════════════════════════════════════════════════════ -->
<div class="doc-title-block">
  <div class="doc-title">Contrato de Arrendamiento Estacional</div>
  <div class="gold-line"></div>
  <div class="doc-subtitle">Redactado en {{lieu_signature}}, el {{date_contrat_longue}}</div>
</div>

<!-- ══ 1. PARTES ═════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">1</span>
    Partes del contrato
  </div>
  <div class="parties-grid">
    <!-- Arrendador -->
    <div class="partie-box">
      <div class="partie-label">Arrendador (propietario)</div>
      <div class="partie-nom">{{bailleur_nom_affiche}}</div>
      <div class="partie-detail">
        {{bailleur_statut_affiche}}<br>
        {{bailleur_adresse_complete}}
      </div>
    </div>
    <!-- Agencia gestora -->
    <div class="partie-box">
      <div class="partie-label">Mandatario — Agencia de gestión</div>
      <div class="partie-nom">{{agence_nom}}</div>
      <div class="partie-detail">
        {{agence_adresse}}<br>
        Tel. {{agence_telephone_affiche}}<br>
        {{agence_email_contact}}<br>
        RCS {{agence_rcs}} — {{agence_cpi}}<br>
        expedida por {{agence_cpi_delivree_par}}<br>
        {{agence_forme}} con capital social de {{agence_capital}} €<br>
        IVA: {{agence_tva}}<br>
        Representado por {{agence_representant_affiche}}, {{agence_qualite_representant}}
      </div>
    </div>
  </div>
  <!-- Arrendatario — ancho completo -->
  <div class="partie-box" style="margin-top:14px">
    <div class="partie-label">Arrendatario</div>
    <div class="partie-nom">{{guest_civilite_affiche}} {{guest_nom_affiche}}</div>
    <div class="partie-detail">
      Dirección: {{guest_adresse_affichee}}<br>
      Correo electrónico: {{guest_email}}&nbsp;&nbsp;·&nbsp;&nbsp;Teléfono: {{guest_telephone_affiche}}<br>
      Número de personas previstas: <strong>{{guest_nb_personnes}}</strong>{{guest_detail_personnes}}
    </div>
  </div>
</div>

<!-- ══ 2. DESCRIPCIÓN DEL INMUEBLE ═══════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">2</span>
    Descripción del inmueble arrendado
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:35%" class="annexe-label">Naturaleza del inmueble</td>
      <td>{{bien_nature_label}}</td>
      <td style="width:30%" class="annexe-label">Clasificación</td>
      <td>{{bien_classement_label}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Dirección completa</td>
      <td colspan="3">{{bien_adresse_complete}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Propietario</td>
      <td>{{bailleur_nom_affiche}}</td>
      <td class="annexe-label">Capacidad máxima</td>
      <td>{{bien_capacite_max_label}}</td>
    </tr>
    {{#has_surface_pieces}}
    <tr>
      <td class="annexe-label">{{bien_superficie_label}}</td>
      <td>{{#bien_superficie}}{{bien_superficie}} m²{{/bien_superficie}}</td>
      <td class="annexe-label">Número de habitaciones</td>
      <td>{{#bien_nb_pieces}}{{bien_nb_pieces_label}}{{/bien_nb_pieces}}</td>
    </tr>
    {{/has_surface_pieces}}
    {{#has_construction_etage}}
    <tr>
      <td class="annexe-label">Año de construcción</td>
      <td>{{bien_date_construction}}</td>
      <td class="annexe-label">Planta</td>
      <td>{{bien_etage}}</td>
    </tr>
    {{/has_construction_etage}}
    {{#a_piscine}}
    <tr>
      <td class="annexe-label">Equipamientos especiales</td>
      <td colspan="3">🏊 Piscina privada incluida en el arrendamiento</td>
    </tr>
    {{/a_piscine}}
  </table>
</div>

<!-- ══ 3. PERÍODO DE ARRENDAMIENTO ══════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">3</span>
    Período de arrendamiento
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:30%" class="annexe-label">Llegada</td>
      <td><strong>{{date_arrivee_longue}}</strong> a partir de {{heure_arrivee}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Salida</td>
      <td><strong>{{date_depart_longue}}</strong> antes de {{heure_depart}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Duración de la estancia</td>
      <td><strong>{{nb_nuits_label}}</strong></td>
    </tr>
  </table>
  <div class="clause" style="margin-top:12px">
    <div class="clause-title">Hora de salida — salida tardía no autorizada</div>
    <p>
      El alojamiento debe quedar libre, y las llaves devueltas según las instrucciones, a más tardar a la hora de salida indicada arriba o, en su caso, a la hora de salida tardía pagada con antelación. Se concede una tolerancia de <strong>10 minutos</strong>. Pasado ese plazo, el arrendatario que permanezca en el alojamiento sin acuerdo escrito de la agencia adeudará, en concepto de cláusula penal (artículo 1231-5 del Código Civil francés), <strong>un 10 % del precio medio de una noche de alojamiento</strong> de la estancia (sin gastos ni impuestos) <strong>por cada tramo de 10 minutos iniciado</strong> tras la tolerancia{{#has_penalite_montant}}, es decir, <strong>{{penalite_tranche_eur}} por tramo</strong> para esta estancia{{/has_penalite_montant}}, con un máximo del <strong>precio de una noche</strong>{{#has_penalite_montant}} ({{penalite_plafond_eur}}){{/has_penalite_montant}}. Se añaden, previa justificación, los gastos reales ocasionados por el retraso (limpieza urgente, realojamiento o compensación de los siguientes huéspedes).
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      Ejemplo para una salida prevista a las 10:00: salir a las 10:10 = sin penalización; a las 10:15 = 1 tramo; a las 11:00 = 5 tramos. Una salida tardía solicitada con antelación cuesta 25 € hasta las 12:00 o 45 € hasta las 14:00, según disponibilidad; quedarse sin acuerdo cuesta hasta el precio de una noche. {{^is_booking_platform}}El importe se {{^is_none_guarantee}}carga en la tarjeta bancaria registrada como garantía{{/is_none_guarantee}}{{#is_none_guarantee}}factura al arrendatario{{/is_none_guarantee}}, previa notificación escrita que indique la hora de salida constatada y el cálculo, en las condiciones del artículo 11.{{/is_booking_platform}}{{#is_booking_platform}}Para una reserva realizada a través de una plataforma (Airbnb, Booking.com…), el importe se reclama a través de dicha plataforma, según sus normas.{{/is_booking_platform}}
    </p>
  </div>
  <p style="font-size:9pt;color:#8C7B65;margin-top:8px;font-family:Arial,sans-serif;">
    La entrega de llaves se realiza según las modalidades comunicadas por la agencia (caja de seguridad o recepción in situ). El arrendatario se compromete a devolver el inmueble limpio y en el estado en que lo encontró, a la hora indicada anteriormente.
  </p>
</div>

<!-- ══ 4. CONDICIONES FINANCIERAS ═══════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">4</span>
    Condiciones financieras
  </div>
  <table class="financial-table">
    <thead>
      <tr>
        <th>Descripción</th>
        <th style="text-align:right">Importe</th>
        <th>Modalidad de pago</th>
      </tr>
    </thead>
    <tbody>
      <!-- Alquiler total -->
      <tr>
        <td>Total a pagar{{#has_taxes_total}}<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">de los cuales {{taxes_total_eur}} en impuestos</span>{{/has_taxes_total}}</td>
        <td class="amount">{{prix_total_eur}}</td>
        <td style="font-size:9pt">{{modalite_loyer_affiche}}</td>
      </tr>{{#has_options}}<tr><td>de los cuales opciones elegidas<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">{{options_detail}}</span></td><td class="amount">{{options_total_eur}}</td><td style="font-size:9pt"></td></tr>{{/has_options}}{{#has_promo}}<tr><td>{{promo_libelle}}</td><td class="amount">{{promo_montant_eur}}</td><td style="font-size:9pt">{{promo_note}}</td></tr>{{/has_promo}}{{#has_demandes}}<tr><td>Solicitudes del viajero<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">{{demandes_detail}}</span></td><td class="amount"></td><td style="font-size:9pt">Sin suplemento ni compromiso</td></tr>{{/has_demandes}}
      <!-- Depósito CB (stripe_dcb_contract o cb_50_cash) -->
      {{#is_cb}}
      <tr>
        <td>Depósito ({{acompte_pourcentage}}%)</td>
        <td class="amount">{{acompte_montant_eur}}</td>
        <td style="font-size:9pt">{{#is_prepaye}}{{paye_le_texte}}{{/is_prepaye}}{{^is_prepaye}}Cargo en tarjeta bancaria registrada en la firma{{/is_prepaye}}</td>
      </tr>
      {{/is_cb}}
      <!-- Depósito transferencia -->
      {{#is_bank_transfer}}
      <tr>
        <td>Depósito ({{acompte_pourcentage}}%)</td>
        <td class="amount">{{acompte_montant_eur}}</td>
        <td style="font-size:9pt">Transferencia bancaria en la firma (ver datos bancarios a continuación)</td>
      </tr>
      {{/is_bank_transfer}}
      <!-- Saldo CB automático (stripe_dcb_contract puro) -->
      {{#has_solde_stripe}}
      <tr>
        <td>Saldo ({{solde_pourcentage}}%) — vencimiento {{date_solde}}</td>
        <td class="amount">{{solde_montant_eur}}</td>
        <td style="font-size:9pt">{{modalite_solde_affiche}} ({{date_solde_motif}})</td>
      </tr>
      {{/has_solde_stripe}}
      <!-- Saldo transferencia -->
      {{#has_solde_virement}}
      <tr>
        <td>Saldo ({{solde_pourcentage}}%) — vencimiento {{date_solde}}</td>
        <td class="amount">{{solde_montant_eur}}</td>
        <td style="font-size:9pt">Transferencia bancaria antes del vencimiento</td>
      </tr>
      {{/has_solde_virement}}
      <!-- Saldo efectivo (cb_50_cash) -->
      {{#has_solde_cash}}
      <tr>
        <td>Saldo ({{solde_pourcentage}}%) — pagadero en efectivo a la llegada, {{date_arrivee_longue}}</td>
        <td class="amount">{{solde_montant_eur}}</td>
        <td style="font-size:9pt">Efectivo entregado al entrar en el inmueble</td>
      </tr>
      {{/has_solde_cash}}
      <!-- Tasa turística -->
      {{#has_taxe_sejour}}
      <tr>
        <td>Tasa turística</td>
        <td class="amount">{{taxe_sejour_eur}}</td>
        <td style="font-size:9pt">Recaudada y transferida al municipio</td>
      </tr>
      {{/has_taxe_sejour}}
    </tbody>
  </table>
  <!-- Avisos contextuales según modalidad -->
  {{#is_stripe_contract}}{{^is_cb_50_cash}}
  <div class="notice" style="margin-top:12px">
    ⚠️ {{^is_prepaye}}Los cargos se realizan automáticamente en la tarjeta bancaria registrada en la firma.{{/is_prepaye}}{{#is_prepaye}}El depósito se pagó en línea ({{paye_le_texte_min}}); el saldo se carga automáticamente el {{date_solde}} en la misma tarjeta.{{/is_prepaye}} En caso de fallo, se contactará al arrendatario para regularizar.
  </div>
  {{/is_cb_50_cash}}{{/is_stripe_contract}}
  {{#is_bank_transfer}}
  <div class="notice" style="margin-top:12px">
    ⚠️ Cualquier retraso en la transferencia podrá dar lugar a la rescisión del contrato según las condiciones del artículo 8.
  </div>
  {{/is_bank_transfer}}
  {{#is_cb_50_cash}}
  <div class="notice" style="margin-top:12px">
    ⚠️ {{#is_cb}}El depósito se carga en tarjeta en la firma.{{/is_cb}}{{#is_bank_transfer}}El depósito se paga por transferencia bancaria en la firma.{{/is_bank_transfer}} El saldo de {{solde_montant_eur}} se paga en efectivo, entregado a la agencia o a su representante al entrar en el inmueble el {{date_arrivee_longue}}; no se carga en la tarjeta.
  </div>
  {{/is_cb_50_cash}}
  <!-- Datos bancarios (solo transferencia) -->
  {{#has_rib}}
  <div class="notice" style="margin-top:10px;background:#EFF6FF;border-color:#93C5FD;color:#1E3A5F;page-break-inside:avoid;break-inside:avoid;">
    <strong>📄 Datos bancarios — Transferencia en depósito</strong><br>
    Titular: <strong>{{rib_titulaire}}</strong><br>
    IBAN: <strong>{{rib_iban}}</strong><br>
    BIC: {{rib_bic}} &nbsp;·&nbsp; Banco: {{rib_banque}}<br><em style="font-size:8.5pt;color:#5C7FB0">Referencia transferencia: <strong>{{virement_reference}}</strong></em>
  </div>
  {{/has_rib}}
{{#is_booking_platform}}
  <div class="notice" style="margin-top:10px;background:#EEF6FF;border-color:#93C5FD;color:#1E3A5F;">
    ℹ️ <strong>Pago gestionado por Booking.com</strong><br>
    El pago de la estancia es gestionado por Booking.com de acuerdo con las condiciones aceptadas en el momento de la reserva.<br>
    <em style="font-size:8.5pt;color:#5C7FB0;">El presente contrato complementa las condiciones de la estancia: identidad, ocupación, reglamento interno, inspección de entrada/salida, depósito de garantía y gastos adicionales.</em>
  </div>
{{/is_booking_platform}}
</div>

<!-- ══ 5. GARANTÍA BANCARIA ══════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">5</span>
    Garantía bancaria
  </div>
  {{#is_stripe_card_on_file}}
  <div class="garantie-box">
    <span class="garantie-icon">🔐</span>
    <strong>Tarjeta registrada como garantía</strong><br><br>
    {{garantie_clause}}
  </div>
  <p style="font-size:8.5pt;color:#8C7B65;font-family:Arial,sans-serif;margin-top:8px;">
    La tarjeta bancaria se registra de forma segura mediante Stripe (PCI-DSS nivel 1). Ningún número de tarjeta es almacenado por Destination Côte Basque.
  </p>
  {{/is_stripe_card_on_file}}
  {{#is_none_guarantee}}
  <p style="font-size:9.5pt;font-family:Arial,sans-serif;color:#555;margin:0;">
    No se requiere garantía bancaria adicional para esta estancia. El arrendatario sigue siendo responsable de cualquier daño constatado en el inventario de salida, de conformidad con el artículo 9.
  </p>
  {{/is_none_guarantee}}
</div>

<!-- ══ 6. OBLIGACIONES DEL ARRENDATARIO ═════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">6</span>
    Obligaciones del arrendatario
  </div>
  <div class="clause">
    <p>El arrendatario se compromete a:</p>
    <ul>
      <li>Ocupar el inmueble personalmente, de forma pacífica, como buen padre de familia, y conforme a su destino de alojamiento estacional temporal.</li>
      <li>No subarrendar ni ceder el presente contrato, parcial o totalmente, sin el consentimiento previo por escrito del arrendador.</li>
      <li>Respetar estrictamente el número máximo de personas autorizadas ({{bien_capacite_max_label}}). Cualquier ocupación adicional está expresamente prohibida sin autorización escrita.</li>
      <li>No introducir animales en el inmueble salvo autorización expresa por escrito de la agencia.</li>
      <li>Respetar las normas de convivencia, en particular el silencio entre las 22:00 y las 8:00.</li>
      <li>No ejercer ninguna actividad comercial o profesional en el inmueble.</li>
      <li>Notificar inmediatamente a la agencia cualquier daño o avería constatado.</li>
      <li>Dejar libre el alojamiento a la hora de salida de la estancia (artículo 3): toda salida tardía no autorizada se factura según el artículo 3; puede solicitarse una salida tardía con antelación.</li>
      <li>Devolver el inmueble en el estado del inventario inicial: vajilla limpia, electrodomésticos limpios, residuos evacuados, ropa de cama retirada.</li>
      <li>No fumar en el interior del inmueble.</li>
      {{#a_piscine}}<li>Respetar las normas de seguridad de la piscina: no dejar menores sin supervisión, no utilizar la piscina entre las 23:00 y las 7:00.</li>{{/a_piscine}}
    </ul>
  </div>
</div>

<!-- ══ 7. SEGURO DE VACACIONES ══════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">7</span>
    Seguro de vacaciones
  </div>
  <div class="clause">
    <p>
      El seguro de <strong>responsabilidad civil vacacional</strong> cubre los daños que puedan causarse a la vivienda, a su contenido y a terceros (incendio, daños por agua, robo, rotura) durante la estancia. El arrendatario indica a continuación su situación respecto a esta garantía:
    </p>
    <div style="margin:14px 0;display:flex;flex-direction:column;gap:6px;font-size:10pt">
{{#is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_platform}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Casilla marcada (opción elegida)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_platform}}{{^assurance_choice_platform}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Casilla sin marcar" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_platform}}</span>
        <span>Cobertura vacacional incluida a través de la plataforma de reserva ({{assurance_platform_name}})</span>
      </div>
{{/is_booking_platform}}
{{^is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_mrh}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Casilla marcada (opción elegida)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_mrh}}{{^assurance_choice_mrh}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Casilla sin marcar" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_mrh}}</span>
        <span>Dispongo de un seguro de responsabilidad civil vacacional que cubre el periodo de la estancia y podré facilitar un certificado a petición.</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_no_insurance}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Casilla marcada (opción elegida)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_no_insurance}}{{^assurance_choice_no_insurance}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Casilla sin marcar" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_no_insurance}}</span>
        <span>Declaro no disponer de un seguro de responsabilidad civil vacacional que cubra los daños que puedan causarse a la vivienda alquilada durante mi estancia. He sido informado(a) de que podría ser considerado(a) personalmente responsable de los daños materiales causados a la vivienda, a su mobiliario o a terceros durante el periodo de alquiler, y acepto continuar con la reserva sin dicha cobertura.</span>
      </div>
{{/is_booking_platform}}
    </div>
    <p style="font-weight:700">
      La ausencia de un seguro de vacaciones no exime en ningún caso al arrendatario de su responsabilidad por los daños causados a la vivienda o a su contenido.
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      Nota: el seguro de la agencia cubre únicamente la responsabilidad civil profesional de {{agence_nom}} (seguro {{agence_assurance_affiche}}). No sustituye al seguro personal del arrendatario.
    </p>
  </div>
</div>

<!-- ══ 8. CONDICIONES DE CANCELACIÓN Y RESCISIÓN ═════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">8</span>
    Condiciones de cancelación y rescisión
  </div>
  <div class="clause">
    <p>Toda cancelación debe notificarse por escrito (correo electrónico a {{agence_email_contact}}):</p>
{{clause_annulation}}
    <p>
      En caso de rescisión por parte del arrendador o la agencia por causas ajenas al arrendatario, las cantidades abonadas serán íntegramente reembolsadas en un plazo de 15 días.
    </p>
  </div>
</div>

<!-- ══ 9. PROTECCIÓN DE DATOS PERSONALES (RGPD) ═════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">9</span>
    Protección de datos personales (RGPD)
  </div>
  <div class="clause">
    <div class="clause-title">9.1 Responsable del tratamiento</div>
    <p>
      {{agence_nom}}, {{agence_adresse}} (el «Responsable del tratamiento»), trata sus datos personales en el marco de la gestión de su reserva y de la relación contractual.
    </p>
    <div class="clause-title" style="margin-top:10px">9.2 Datos recogidos y finalidades</div>
    <p>Los datos recogidos (nombre, apellidos, dirección, correo electrónico, teléfono, datos de pago) son tratados para:</p>
    <ul>
      <li>La gestión y ejecución del presente contrato de arrendamiento;</li>
      <li>La gestión de los pagos y de la garantía bancaria;</li>
      <li>El cumplimiento de las obligaciones legales (declaración de tasa turística, obligaciones fiscales);</li>
      <li>La verificación de identidad a efectos de seguridad del inmueble.</li>
    </ul>
    <div class="clause-title" style="margin-top:10px">9.3 Plazo de conservación</div>
    <p>
      Los datos contractuales se conservan durante <strong>5 años</strong> a partir del fin de la estancia (obligaciones contables). Los documentos de identidad (fotografía de verificación y documento de identidad) se conservan durante <strong>1 año</strong> a partir del fin de la estancia y después se eliminan definitivamente. Los datos de tarjeta bancaria son gestionados exclusivamente por Stripe — ningún número completo de tarjeta es almacenado por {{agence_nom}}.
    </p>
    <div class="clause-title" style="margin-top:10px">9.4 Derechos del arrendatario</div>
    <p>
      De conformidad con el RGPD (Reglamento UE 2016/679) y la normativa aplicable en materia de protección de datos, usted dispone de un derecho de acceso, rectificación, supresión y portabilidad de sus datos, así como de un derecho de oposición al tratamiento. Para ejercer estos derechos: {{agence_email_contact}}.
    </p>
    <div class="clause-title" style="margin-top:10px">9.5 Transferencia a terceros</div>
    <p>
      Sus datos son compartidos, en la estricta medida de lo necesario, con: Stripe Inc. (pago, Estados Unidos — decisión de adecuación EU-US Data Privacy Framework), Twilio Inc. (verificación SMS), y los servicios alojados en Supabase (infraestructura Cloud, UE). Ningún dato es vendido a terceros.
    </p>
    <div class="clause-title" style="margin-top:10px">9.6 Seguridad de los documentos y verificación de identidad</div>
    <p>
      La foto de verificación tomada durante la firma es objeto de un control automatizado cuyo único fin es comprobar que un rostro es visible y utilizable (foto no vacía, no borrosa, no tomada de una pantalla). Este control no tiene por objeto identificar a la persona: no implica ningún reconocimiento facial, ninguna comparación con el documento de identidad ni ningún tratamiento de datos biométricos. Se basa en el interés legítimo de {{agence_nom}} en prevenir el fraude y asegurar el acceso al alojamiento, y no puede por sí solo impedir la firma: tras dos nuevos intentos, la foto se acepta. Lo realiza nuestro encargado del tratamiento Anthropic PBC (Estados Unidos), en el marco de las cláusulas contractuales tipo adoptadas por la Comisión Europea; Anthropic no utiliza estos datos para entrenar sus modelos y los suprime en un plazo de 30 días, salvo conservación más prolongada exigida por la ley o por el control del cumplimiento de sus normas de uso. El documento de identidad nunca se le transmite. La foto de verificación y el documento de identidad se marcan desde su recepción con la marca de agua «document destiné uniquement à la location saisonnière» (documento destinado únicamente al alquiler de temporada) y nunca se conservan sin ella. El contrato firmado está sellado electrónicamente por {{agence_nom}}: cualquier modificación posterior del documento es detectable.
    </p>
  </div>
</div>

<!-- ══ 10. INVENTARIO DEL ESTADO ═════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">10</span>
    Inventario del estado del inmueble
  </div>
  <div class="clause">
    <div class="clause-title">10.1 Inventario de entrada</div>
    <p>
      Se realiza un inventario contradictorio a la llegada del arrendatario, en presencia de un representante de la agencia o por cualquier medio equivalente (formulario digital, fotografías con fecha). El arrendatario dispone de un plazo de <strong>24 horas</strong> a partir de la entrega de llaves para comunicar por escrito a {{agence_email_contact}} cualquier desperfecto o reserva no mencionado en el inventario inicial.
    </p>
    <div class="clause-title" style="margin-top:10px">10.2 Inventario de salida</div>
    <p>
      A la expiración de la estancia, se levanta un inventario contradictorio de salida según las mismas modalidades. El inmueble debe ser restituido en el estado constatado a la entrada, limpio y conforme al inventario adjunto. Todo desperfecto constatado a la salida, no mencionado en la entrada, será imputado al arrendatario.
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      En ausencia del arrendatario durante el inventario de salida, este será levantado contradictoriamente por la agencia en solitario y notificado al arrendatario en un plazo de 48 horas por correo electrónico. El arrendatario podrá formular observaciones en los 5 días siguientes a la notificación.
    </p>
  </div>
</div>

<!-- ══ 11. RETENCIONES Y GASTOS DE RESTITUCIÓN ══════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">11</span>
    Retenciones y gastos de restitución
  </div>
  <div class="clause">
    <p>
      En caso de desperfecto constatado en el inventario de salida, de incumplimiento de las obligaciones del arrendatario o de gastos adicionales generados, la agencia podrá proceder a un cargo en la tarjeta bancaria registrada como garantía (artículo 5), previa justificación y notificación escrita al arrendatario, por los motivos siguientes:
    </p>
    <ul>
      <li><strong>Alojamiento dejado en estado de suciedad avanzada:</strong> facturación de los gastos de limpieza reales (mínimo 80 €).</li>
      <li><strong>Sábanas o toallas muy manchadas más allá del desgaste normal:</strong> gastos de lavandería o sustitución (mínimo 30 € por lote).</li>
      <li><strong>Objetos rotos, deteriorados o faltantes:</strong> sustitución o reparación al coste real justificado.</li>
      <li><strong>Residuos en cantidad excesiva no evacuados:</strong> gastos de recogida (mínimo 50 €).</li>
      <li><strong>Llaves no restituidas:</strong> sustitución de cerradura o caja de seguridad (coste real).</li>
      <li><strong>Ocupación no autorizada (animales, sobreocupación):</strong> penalización fija de 100 € más el 5 % del importe total de la estancia, sin perjuicio de otros daños.</li>
      <li><strong>Salida tardía no autorizada:</strong> penalización del 10 % del precio de una noche por cada tramo de 10 minutos iniciado tras 10 minutos de tolerancia, con un máximo del precio de una noche, más los gastos reales justificados (artículo 3).</li>
    </ul>
    <p style="font-size:9pt;color:#8C7B65;margin-top:8px;">
      Todo cargo irá precedido de un correo electrónico de notificación detallando los motivos y los importes. El arrendatario dispone de 7 días para impugnar por escrito. En ausencia de impugnación dentro de dicho plazo, el cargo se considerará aceptado.
    </p>
  </div>
</div>

<!-- ══ 12. REPARACIONES URGENTES — ACCESO AL INMUEBLE ══════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">12</span>
    Reparaciones urgentes — Acceso al inmueble
  </div>
  <div class="clause">
    <p>
      El arrendatario está obligado a comunicar inmediatamente a la agencia cualquier avería o desperfecto constatado. Autoriza expresamente el acceso al inmueble por parte de la agencia o sus proveedores para cualquier trabajo urgente necesario para la conservación del bien (fuga de agua, avería de calefacción, problema eléctrico, etc.), incluso en su ausencia, previa información.
    </p>
    <p>
      Estas intervenciones urgentes no dan derecho a ninguna reducción del alquiler, salvo que priven al arrendatario del disfrute de una parte sustancial del inmueble durante más de 48 horas consecutivas. En tal caso, se calculará una reducción proporcional de mutuo acuerdo.
    </p>
  </div>
</div>

<!-- ══ 13. FUERZA MAYOR ══════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">13</span>
    Fuerza mayor
  </div>
  <div class="clause">
    <p>
      Ni el arrendador ni la agencia podrán ser considerados responsables del incumplimiento o retraso en el cumplimiento de sus obligaciones en caso de fuerza mayor en el sentido del artículo 1218 del Código Civil francés (catástrofe natural, incendio, inundación, decisión administrativa, pandemia con cierre impuesto por las autoridades, etc.).
    </p>
    <p>
      En caso de fuerza mayor que haga el inmueble inhabitable o su acceso imposible, las cantidades abonadas por el arrendatario serán íntegramente reembolsadas en un plazo de 15 días, con exclusión de cualquier otra indemnización. Se invita al arrendatario a suscribir un seguro de cancelación para protegerse de los casos no cubiertos por la fuerza mayor legal.
    </p>
  </div>
</div>

<!-- ══ 14. DERECHO APLICABLE Y JURISDICCIÓN COMPETENTE ═════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">14</span>
    Derecho aplicable, mediación y jurisdicción competente
  </div>
  <div class="clause">
    <p>
      El presente contrato se rige por la legislación francesa. En caso de litigio, las partes se comprometen a intentar una resolución amistosa antes de cualquier acción judicial.
    </p>
    <p>
      De conformidad con los artículos L612-1 y siguientes del Código de Consumo francés, en caso de litigio no resuelto tras una reclamación previa por escrito ante la agencia, el arrendatario puede recurrir gratuitamente al siguiente mediador de consumo: Centre de la Médiation de la Consommation de Conciliateurs de Justice (CM2C), 49 rue de Ponthieu, 75008 Paris, France – www.cm2c.net (solicitud en línea) – +33 1 89 47 00 14. El mediador debe ser consultado en el plazo de un año a partir de la reclamación escrita dirigida a la agencia.
    </p>
    <p>
      A falta de acuerdo amistoso, el Tribunal Judicial de Bayona será el único competente, salvo disposición imperativa contraria aplicable al arrendatario consumidor.
    </p>
  </div>
</div>

<!-- ══ FIRMAS ══════════════════════════════════════════════════════════ -->
<div class="section avoid-break">
  <div class="section-title">
    <span class="section-title-num" style="background:linear-gradient(135deg,#2C2416,#4A3820)">✍</span>
    Firmas de las partes
  </div>
  <div style="background:#FDFAF5;border:1px solid #E8DCC8;border-left:3px solid #CC9933;border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:9pt;color:#4A3F32;font-family:'Helvetica Neue',Arial,sans-serif;line-height:1.7">
    El arrendatario reconoce haber leído íntegramente el presente contrato (incluido el anexo descriptivo), haber tenido la posibilidad de plantear cualquier pregunta, y acepta sin reservas los términos y condiciones definidos anteriormente. La firma electrónica estampada a continuación tiene el mismo valor jurídico que una firma manuscrita (Reglamento UE n.º 910/2014 eIDAS y ley francesa del 13 de marzo de 2000, art. 1366 y 1367 del Código Civil).
  </div>
  <div class="signature-grid">
    <div class="signature-block">
      <div class="signature-label">Para el arrendador / mandatario</div>
      <div class="signature-name">{{agence_nom}}</div>
      <div class="signature-note">Representado por {{agence_representant_affiche}}, {{agence_qualite_representant}}<br>{{agence_email_representant}}</div>
      <div style="margin-top:10px;text-align:center">
        <div style="font-size:8pt;color:#8C7B65;margin-bottom:4px">Firmado electrónicamente</div>
        <div style="font-family:'Northwell',cursive;font-size:20pt;color:#CC9933;line-height:1;padding:4px 0">Oihan Campandegui</div>
        <div style="font-size:7.5pt;color:#A09282;margin-top:2px">Gerente — Destination Côte Basque</div>
      </div>
    </div>
    <div class="signature-block">
      <div class="signature-label">Arrendatario — firma electrónica</div>
      <div class="signature-name">{{guest_civilite_affiche}} {{guest_nom_affiche}}</div>
      <div class="signature-note">Firma estampada a través del portal seguro contrat.destinationcotebasque.com</div>
      <div class="signature-line"></div>
    </div>
  </div>
</div>

<!-- ══ ANEXO — DESCRIPCIÓN DEL INMUEBLE ══════════════════════════════ -->
<div class="page-break"></div>
<div class="header" style="margin-bottom:0;padding:20px 0 16px">
  <div class="header-left">
    <div class="logo-square" style="width:38px;height:38px;font-size:18px">D</div>
    <div class="header-brand">
      <div class="name" style="font-size:11pt">Destination Côte Basque</div>
      <div class="sub">Anexo al contrato de arrendamiento estacional</div>
    </div>
  </div>
  <div class="header-right">{{date_contrat_longue}}</div>
</div>
<div class="doc-title-block" style="padding:18px 0 14px;margin-bottom:20px">
  <div class="doc-title" style="font-size:12pt;letter-spacing:2px">Descripción del inmueble</div>
  <div class="gold-line"></div>
  <div class="doc-subtitle">{{bien_adresse_complete}}</div>
</div>
<div class="section">
  <div class="section-title">
    <span class="section-title-num">A</span>
    Características generales
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:28%" class="annexe-label">Dirección</td>
      <td colspan="3">{{bien_adresse_complete}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Naturaleza / Tipo</td>
      <td>{{bien_nature_label}}</td>
      <td style="width:28%" class="annexe-label">Clasificación</td>
      <td>{{bien_classement_label}}</td>
    </tr>
    {{#has_surface_pieces}}
    <tr>
      <td class="annexe-label">Superficie</td>
      <td>{{#bien_superficie}}{{bien_superficie}} m²{{/bien_superficie}}</td>
      <td class="annexe-label">N.º de habitaciones principales</td>
      <td>{{bien_nb_pieces}}</td>
    </tr>
    {{/has_surface_pieces}}
    {{#has_construction_etage}}
    <tr>
      <td class="annexe-label">Año de construcción</td>
      <td>{{bien_date_construction}}</td>
      <td class="annexe-label">Planta</td>
      <td>{{bien_etage}}</td>
    </tr>
    {{/has_construction_etage}}
    <tr>
      <td class="annexe-label">Capacidad de alojamiento</td>
      <td>{{bien_capacite_max_label}} máx.</td>
      {{#has_exposition}}
      <td class="annexe-label">Orientación</td>
      <td>{{bien_exposition}}</td>
      {{/has_exposition}}
      {{#has_no_exposition}}
      <td colspan="2"></td>
      {{/has_no_exposition}}
    </tr>
    {{#has_voisinage}}
    <tr>
      <td class="annexe-label">Entorno / Vecindario</td>
      <td colspan="3">{{bien_voisinage}}</td>
    </tr>
    {{/has_voisinage}}
    {{#a_piscine}}
    <tr>
      <td class="annexe-label">Equipamientos especiales</td>
      <td colspan="3">Piscina privada — uso reservado a los ocupantes del inmueble</td>
    </tr>
    {{/a_piscine}}
  </table>

  {{#has_distances}}
  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">B</span>
    Distancias y situación geográfica
  </div>
  <table class="annexe-table">
    <thead>
      <tr>
        <th>Punto de referencia</th>
        <th>Distancia aproximada</th>
      </tr>
    </thead>
    <tbody>
      {{#bien_distance_mer}}
      <tr>
        <td>Mar / océano</td>
        <td>{{bien_distance_mer}}</td>
      </tr>
      {{/bien_distance_mer}}
      {{#bien_distance_plage}}
      <tr>
        <td>Playa más cercana</td>
        <td>{{bien_distance_plage}}</td>
      </tr>
      {{/bien_distance_plage}}
      {{#bien_distance_gare}}
      <tr>
        <td>Estación de tren</td>
        <td>{{bien_distance_gare}}</td>
      </tr>
      {{/bien_distance_gare}}
      {{#bien_distance_centre}}
      <tr>
        <td>Centro urbano</td>
        <td>{{bien_distance_centre}}</td>
      </tr>
      {{/bien_distance_centre}}
    </tbody>
  </table>
  {{/has_distances}}

  {{#has_description_pieces}}
  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">C</span>
    Descripción de las habitaciones
  </div>
  <table class="annexe-table">
    <thead>
      <tr>
        <th>Habitación</th>
        <th>Descripción y equipamiento</th>
      </tr>
    </thead>
    <tbody>
      {{#has_desc_sejour}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Salón / Sala de estar</td>
        <td>{{bien_description_sejour}}</td>
      </tr>
      {{/has_desc_sejour}}
      {{#has_desc_cuisine}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Cocina</td>
        <td>{{bien_cuisine}}</td>
      </tr>
      {{/has_desc_cuisine}}
      {{#has_desc_sdb}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Baño</td>
        <td>{{bien_sdb}}</td>
      </tr>
      {{/has_desc_sdb}}
      {{#has_desc_toilettes}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Aseos</td>
        <td>{{bien_toilettes}}</td>
      </tr>
      {{/has_desc_toilettes}}
      {{#has_desc_etat}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Estado general</td>
        <td>{{bien_etat_general}}</td>
      </tr>
      {{/has_desc_etat}}
    </tbody>
  </table>
  {{/has_description_pieces}}

  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">D</span>
    Horarios de acceso (check-in / check-out)
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:50%" class="annexe-label">Hora de llegada (check-in)</td>
      <td>A partir de {{heure_arrivee}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Hora de salida (check-out)</td>
      <td>Antes de {{heure_depart}}</td>
    </tr>
  </table>
</div>

<!-- ══ PIE DE PÁGINA ══════════════════════════════════════════════════ -->
<div class="footer">
  {{agence_nom}} — {{agence_adresse}} — {{agence_email_contact}} — Tel. {{agence_telephone_affiche}}<br>
  Tarjeta Profesional {{agence_cpi}} expedida por {{agence_cpi_delivree_par}} — RCS {{agence_rcs}} — IVA {{agence_tva}}<br>
  Seguro RCP: {{agence_assurance_affiche}} — Garantía financiera: {{agence_garantie_galian}}<br>
  <em>Documento generado automáticamente el {{date_contrat_longue}} — Firma electrónica certificada</em>
</div>

</div><!-- /.page -->
</body>
</html>
$tpl469$, $v$[]$v$::jsonb, false
where not exists (select 1 from contract_templates where agence='dcb' and langue='es' and type_contrat='saisonnier' and version='2026-v6');

-- dcb saisonnier fr : 2026-v7 → 2026-v8
insert into contract_templates (agence, langue, type_contrat, version, nom, contenu_html, variables_attendues, is_active)
select 'dcb', 'fr', 'saisonnier', '2026-v8', $n$FR Saisonnier 2026 — Premium UI v3$n$, $tpl469$<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Contrat de location saisonnière — Destination Côte Basque</title>
<style>


@font-face {
  font-family: 'Northwell';
  src: url('https://dcb-contrats.vercel.app/fonts/Northwell.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
}

/* ── Reset ── */
* { margin: 0; padding: 0; box-sizing: border-box; }

/* ── Page PDF ── */
@page {
  size: A4;
  margin: 20mm 15mm 22mm;
  @bottom-right {
    content: "Page " counter(page) " / " counter(pages);
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 7.5pt;
    color: #A09282;
  }
  @bottom-left {
    content: "Destination Côte Basque — Contrat de location saisonnière";
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 7.5pt;
    color: #A09282;
  }
}

body {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 10.5pt;
  color: #1C1C1C;
  line-height: 1.65;
  background: #fff;
  counter-reset: page;
}

/* ── Mise en page ── */
.page { max-width: 800px; margin: 0 auto; padding: 0 20px; }

/* ── En-tête ── */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28px 0 20px;
  border-bottom: 0;
  margin-bottom: 0;
  position: relative;
}
.header::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 4px;
  background: linear-gradient(90deg, transparent 0%, #CC9933 15%, #E4A853 50%, #CC9933 85%, transparent 100%);
  border-radius: 2px;
}
.header-left { display: flex; align-items: center; gap: 14px; }
.logo-square {
  width: 46px; height: 46px;
  background: linear-gradient(135deg, #D4A035 0%, #CC9933 60%, #B8872A 100%);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 22px; font-weight: 700;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(204,153,51,0.30);
}
.header-brand { font-family: 'Helvetica Neue', Arial, sans-serif; }
.header-brand .name { font-size: 14pt; font-weight: 700; color: #1C1C1C; letter-spacing: -0.3px; }
.header-brand .sub  { font-size: 8pt; color: #8C7B65; letter-spacing: 2px; text-transform: uppercase; margin-top: 3px; font-family: 'Helvetica Neue', Arial, sans-serif; }
.header-right {
  text-align: right;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 8pt; color: #8C7B65; line-height: 1.8;
}

/* ── Titre principal ── */
.doc-title-block {
  text-align: center;
  padding: 28px 0 20px;
  border-bottom: 1px solid #EAE0D0;
  margin-bottom: 26px;
}
.doc-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 15pt;
  font-weight: 700;
  color: #1C1C1C;
  text-transform: uppercase;
  letter-spacing: 3px;
  margin-bottom: 8px;
}
.doc-subtitle {
  font-size: 9.5pt;
  color: #8C7B65;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-style: italic;
}
.gold-line {
  width: 48px; height: 2px;
  background: linear-gradient(90deg, #CC9933, #E4A853, #CC9933);
  margin: 12px auto;
  border-radius: 2px;
}

/* ── Sections ── */
.section {
  margin-bottom: 24px;
  page-break-inside: avoid;
}
.section-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 8.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: #CC9933;
  border-bottom: 1.5px solid #E8DCC8;
  padding-bottom: 6px;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 0;
}
.section-title-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #D4A035, #CC9933);
  color: #fff;
  border-radius: 50%;
  width: 22px; height: 22px;
  font-size: 9pt;
  font-weight: 700;
  margin-right: 10px;
  flex-shrink: 0;
  box-shadow: 0 1px 4px rgba(204,153,51,0.30);
}

/* ── Blocs parties ── */
.parties-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 4px;
}
.partie-box {
  background: #FDFAF5;
  border: 1px solid #E8DCC8;
  border-left: 3px solid #CC9933;
  border-radius: 6px;
  padding: 14px 16px;
}
.partie-label {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: #8C7B65;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #E8DCC8;
}
.partie-nom {
  font-size: 11pt;
  font-weight: 700;
  color: #1C1C1C;
  margin-bottom: 5px;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
.partie-detail {
  font-size: 9pt;
  color: #4A3F32;
  line-height: 1.75;
}

/* ── Tableau financier ── */
.financial-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9.5pt;
  margin-bottom: 4px;
  border-radius: 6px;
  overflow: hidden;
}
.financial-table th {
  background: #F0E8D8;
  color: #6B5840;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 8px 12px;
  text-align: left;
  border: 1px solid #E0D4C0;
}
.financial-table td {
  padding: 10px 12px;
  border: 1px solid #E8DCC8;
  vertical-align: top;
}
.financial-table tr:nth-child(even) td { background: #FDFAF5; }
.amount { font-weight: 700; color: #1C1C1C; text-align: right; }
.total-row td { background: #F0E8D8 !important; font-weight: 700; font-size: 10pt; }

/* ── Bloc garantie ── */
.garantie-box {
  background: #F0FBF4;
  border: 1px solid #86EFAC;
  border-left: 4px solid #15803D;
  border-radius: 6px;
  padding: 14px 16px;
  margin: 12px 0;
  font-size: 9.5pt;
  line-height: 1.7;
  color: #1C1C1C;
}
.garantie-box strong { color: #166534; }
.garantie-icon { font-size: 13pt; margin-right: 6px; vertical-align: middle; }

/* ── Clauses / Articles ── */
.clause {
  margin-bottom: 14px;
  page-break-inside: avoid;
}
.clause-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9.5pt;
  font-weight: 700;
  color: #2C2416;
  margin-bottom: 5px;
  letter-spacing: -0.1px;
}
.clause p {
  font-size: 9.5pt;
  color: #2C2416;
  margin-bottom: 6px;
  line-height: 1.65;
}
.clause ul, .clause ol {
  padding-left: 20px;
  margin: 6px 0;
}
.clause li {
  font-size: 9.5pt;
  color: #2C2416;
  margin-bottom: 4px;
  line-height: 1.65;
}

/* ── Tableau descriptif annexe ── */
.annexe-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9pt;
  margin-bottom: 12px;
  page-break-inside: avoid;
  break-inside: avoid;
}
.annexe-table th {
  background: #F0E8D8;
  color: #6B5840;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 7px 10px;
  border: 1px solid #E0D4C0;
  text-align: left;
}
.annexe-table td {
  padding: 8px 10px;
  border: 1px solid #E8DCC8;
  vertical-align: top;
}
.annexe-table tr:nth-child(even) td { background: #FDFAF5; }
.annexe-label { color: #8C7B65; font-size: 8pt; font-family: 'Helvetica Neue', Arial, sans-serif; }

/* ── Bloc signature ── */
.signature-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-top: 20px;
  page-break-inside: avoid;
  break-inside: avoid;
}
.signature-block {
  border: 1px solid #E8DCC8;
  border-radius: 8px;
  padding: 16px;
  min-height: 110px;
  background: #FDFAF5;
}
.signature-label {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #8C7B65;
  margin-bottom: 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid #E8DCC8;
}
.signature-name {
  font-weight: 700;
  font-size: 10pt;
  color: #1C1C1C;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
.signature-note { font-size: 7.5pt; color: #8C7B65; margin-top: 4px; line-height: 1.5; font-family: 'Helvetica Neue', Arial, sans-serif; }
.signature-line {
  border-bottom: 1.5px dashed #CC9933;
  height: 52px;
  margin-top: 14px;
  opacity: 0.5;
}

/* ── Pied de page ── */
.footer {
  margin-top: 32px;
  padding-top: 14px;
  border-top: 1px solid #E8DCC8;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  color: #A09282;
  line-height: 1.8;
  text-align: center;
}

/* ── Sauts de page ── */
.page-break { page-break-before: always; break-before: page; }
.avoid-break { page-break-inside: avoid; break-inside: avoid; }

/* ── Info notice ── */
.notice {
  background: #FFF8E6;
  border: 1px solid #FDE68A;
  border-left: 3px solid #D97706;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 9pt;
  color: #78350F;
  margin: 10px 0;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  img { max-width: 100% !important; }
}
@media screen {
  body > div[style*="height:297mm"] { max-width: 800px; margin: 0 auto; }
}
/* ── Cover page print-safe ── */
.cover-page {
  background:#fff;
}
.hero-section {
  position:relative;
  flex:1;
  min-height:0;
  overflow:hidden;
  background:#fff;
}
.hero-img {
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  object-fit:cover;
  object-position:center 65%;
  -webkit-print-color-adjust:exact !important;
  print-color-adjust:exact !important;
}
.hero-overlay {
  position:absolute;
  inset:0;
  z-index:2;
}
.hero-bg,.hero-gradient,.hero-section::before {
  display:none !important;
  content:none !important;
}
.hero-bg {
  position:absolute; inset:0;
  background-image:url(https://omuncchvypbtxkpalwcr.supabase.co/storage/v1/object/public/rapport-assets/hero.jpg);
  background-size:cover;
  background-position:center 65%;
  background-repeat:no-repeat;
  -webkit-print-color-adjust:exact !important;
  print-color-adjust:exact !important;
}
.hero-gradient {
  position:absolute; inset:0;
  background:linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.45));
  -webkit-print-color-adjust:exact !important;
  print-color-adjust:exact !important;
}
</style>
</head>
<body>
<!-- ══ PAGE DE COUVERTURE ═══════════════════════════════════════════════════ -->
<div style="page-break-after:always;height:220mm;display:flex;flex-direction:column;background:#F7F3EC;font-family:Georgia,'Times New Roman',serif;">

  <!-- Logo & tagline -->
  <div style="padding:12mm 0 6mm;text-align:center;">
    <div style="font-size:18px;letter-spacing:3.5px;color:#2C2416;text-transform:uppercase;font-weight:700;">Destination Côte Basque</div>
    <div style="width:48px;height:2px;background:#CC9933;margin:7px auto;"></div>
    <div style="font-size:9px;color:#CC9933;letter-spacing:4px;text-transform:uppercase;font-style:italic;">L&rsquo;art de recevoir sur la Côte Basque</div>
  </div>

  <!-- Photo principale -->
  <div class="hero-section">
  <img class="hero-img" src="{{hero_url}}" alt="" />
  <div class="hero-overlay">
    {{#has_bien_photos}}<div style="position:absolute;bottom:72px;right:18px;width:72px;height:72px;border-radius:50%;overflow:hidden;border:3px solid rgba(255,255,255,0.92);box-shadow:0 4px 18px rgba(0,0,0,.55);"><img src="{{bien_photo_1}}" style="width:100%;height:100%;object-fit:cover;display:block;"></div>{{/has_bien_photos}}
    <div class="hero-gradient"></div>
    <div style="position:absolute;bottom:0;left:0;right:0;padding:14px 20px;color:#fff;text-align:center;">
      <div style="font-size:19px;font-weight:700;letter-spacing:1.5px;line-height:1.3;text-shadow:0 2px 6px rgba(0,0,0,.5);padding:0 92px;">{{bien_nom_public}}</div>
      <div style="font-size:9.5px;color:rgba(255,255,255,.65);margin-top:4px;letter-spacing:2px;text-transform:uppercase;">{{cover_location}}</div>
      <div style="width:28px;height:1px;background:rgba(255,255,255,.4);margin:10px auto 7px;"></div>
      <div style="font-size:13px;font-weight:600;color:#fff;letter-spacing:.5px;text-shadow:0 1px 4px rgba(0,0,0,.5);">{{guest_civilite}} {{guest_nom_affiche}}</div>
      <div style="font-size:9px;color:rgba(255,255,255,.8);margin-top:3px;">{{date_arrivee_longue}} &rarr; {{date_depart_longue}}</div>
      <div style="font-size:8px;color:rgba(255,255,255,.65);margin-top:2px;letter-spacing:.5px;">{{nb_nuits_label}} &middot; {{guest_nb_personnes_label}}</div>
    </div>
  </div></div>

  <!-- Footer légal -->
  <div style="border-top:1px solid #D9CEB8;padding:3mm 0 0;text-align:center;margin-top:auto;">
    <div style="font-size:7px;color:#C0B09A;line-height:2;">
      {{agence_nom}} &middot; {{agence_adresse}} &middot; Tél.&nbsp;{{agence_telephone_affiche}}<br>
      RCS {{agence_rcs}} &middot; {{agence_cpi}} &middot; Assurance {{agence_assurance}}
    </div>
  </div>

</div>
<!-- ══ FIN COUVERTURE ════════════════════════════════════════════════════ -->

<div class="page"><div class="cover-page">

<!-- ══ EN-TÊTE ══════════════════════════════════════════════════════ -->
<div class="header">
  <div class="header-left">
    <div class="logo-square">D</div>
    <div class="header-brand">
      <div class="name">Destination Côte Basque</div>
      <div class="sub">Gestion locative &amp; immobilier</div>
    </div>
  </div>
  <div class="header-right">
    {{agence_adresse}}<br>
    Tél. {{agence_telephone_affiche}}<br>
    {{agence_email_contact}}<br>
    RCS {{agence_rcs}}
  </div>
</div>

<!-- ══ TITRE ════════════════════════════════════════════════════════ -->
<div class="doc-title-block">
  <div class="doc-title">Contrat de Location Saisonnière</div>
  <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:9pt;color:#CC9933;letter-spacing:1.5px;margin-top:4px;font-weight:600">N°&nbsp;{{contract_numero}}</div>
  <div class="gold-line"></div>
  <div class="doc-subtitle">Établi à {{lieu_signature}}, le {{date_contrat_longue}}</div>
</div>

<!-- ══ 1. PARTIES ═══════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">1</span>
    Parties au contrat
  </div>
  <div class="parties-grid">
    <!-- Bailleur -->
    <div class="partie-box">
      <div class="partie-label">Bailleur (propriétaire)</div>
      <div class="partie-nom">{{bailleur_nom_affiche}}</div>
      <div class="partie-detail">
        {{bailleur_statut}}<br>
        {{bailleur_adresse_complete}}
      </div>
    </div>
    <!-- Agence mandataire -->
    <div class="partie-box">
      <div class="partie-label">Mandataire — Agence de gestion</div>
      <div class="partie-nom">{{agence_nom}}</div>
      <div class="partie-detail">
        {{agence_adresse}}<br>
        Tél. {{agence_telephone_affiche}}<br>
        {{agence_email_contact}}<br>
        RCS {{agence_rcs}} — {{agence_cpi}}<br>
        délivré par {{agence_cpi_delivree_par}}<br>
        {{agence_forme}} au capital social de {{agence_capital}} €<br>
        TVA : {{agence_tva}}<br>
        Représenté par {{agence_representant}}, {{agence_qualite_representant}}
      </div>
    </div>
  </div>
  <!-- Locataire pleine largeur -->
  <div class="partie-box" style="margin-top:14px">
    <div class="partie-label">Locataire</div>
    <div class="partie-nom">{{guest_civilite}} {{guest_nom_affiche}}</div>
    <div class="partie-detail">
      Adresse : {{guest_adresse_affichee}}<br>
      E-mail : {{guest_email}}&nbsp;&nbsp;·&nbsp;&nbsp;Téléphone : {{guest_telephone_affiche}}<br>
      Nombre de personnes prévues : <strong>{{guest_nb_personnes}}</strong>{{guest_detail_personnes}}
    </div>
  </div>
</div>

<!-- ══ 2. BIEN LOUÉ ══════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">2</span>
    Désignation du bien loué
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:35%" class="annexe-label">Nature du bien</td>
      <td>{{bien_nature_label}}</td>
      <td style="width:30%" class="annexe-label">Classement</td>
      <td>{{bien_classement_label}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Adresse complète</td>
      <td colspan="3">{{bien_adresse_complete}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Propriétaire</td>
      <td>{{bailleur_nom_affiche}}</td>
      <td class="annexe-label">Capacité maximale</td>
      <td>{{bien_capacite_max_label}}</td>
    </tr>
    {{#has_surface_pieces}}
    <tr>
      <td class="annexe-label">{{bien_superficie_label}}</td>
      <td>{{#bien_superficie}}{{bien_superficie}} m²{{/bien_superficie}}</td>
      <td class="annexe-label">Nombre de pièces</td>
      <td>{{#bien_nb_pieces}}{{bien_nb_pieces_label}}{{/bien_nb_pieces}}</td>
    </tr>
    {{/has_surface_pieces}}
    {{#has_construction_etage}}
    <tr>
      <td class="annexe-label">Année de construction</td>
      <td>{{bien_date_construction}}</td>
      <td class="annexe-label">Étage</td>
      <td>{{bien_etage}}</td>
    </tr>
    {{/has_construction_etage}}
    {{#a_piscine}}
    <tr>
      <td class="annexe-label">Équipements spéciaux</td>
      <td colspan="3">🏊 {{piscine_label}} — {{piscine_horaires_label}}</td>
    </tr>
    {{/a_piscine}}
  </table>
</div>

<!-- ══ 3. PÉRIODE DE LOCATION ════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">3</span>
    Période de location
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:30%" class="annexe-label">Arrivée</td>
      <td><strong>{{date_arrivee_longue}}</strong> à partir de {{heure_arrivee}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Départ</td>
      <td><strong>{{date_depart_longue}}</strong> avant {{heure_depart}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Durée du séjour</td>
      <td><strong>{{nb_nuits_label}}</strong></td>
    </tr>
  </table>
  <div class="clause" style="margin-top:12px">
    <div class="clause-title">Heure de départ — départ tardif non autorisé</div>
    <p>
      Le logement doit être libéré, et les clés restituées selon les consignes, au plus tard à l'heure de départ indiquée ci-dessus ou, le cas échéant, à l'heure de départ tardif réglée à l'avance. Une tolérance de <strong>10 minutes</strong> est accordée. Au-delà, le locataire qui se maintient dans les lieux sans accord écrit de l'agence est redevable, à titre de clause pénale (article 1231-5 du Code civil), de <strong>10 % du prix moyen d'une nuit d'hébergement</strong> du séjour (hors frais et taxes) <strong>par tranche de 10 minutes commencée</strong> après la tolérance{{#has_penalite_montant}}, soit <strong>{{penalite_tranche_eur}} par tranche</strong> pour ce séjour{{/has_penalite_montant}}, dans la limite du <strong>prix d'une nuit</strong>{{#has_penalite_montant}} ({{penalite_plafond_eur}}){{/has_penalite_montant}}. S'y ajoutent, sur justificatif, les frais réels causés par le retard (ménage refait en urgence, relogement ou dédommagement du voyageur suivant).
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      Exemple pour un départ prévu à 10h00 : départ à 10h10 = aucune pénalité ; à 10h15 = 1 tranche ; à 11h00 = 5 tranches. Un départ tardif demandé à l'avance coûte 25 € jusqu'à 12h00 ou 45 € jusqu'à 14h00, selon disponibilité ; rester sans accord coûte jusqu'au prix d'une nuit. {{^is_booking_platform}}Le montant est {{^is_none_guarantee}}débité sur la carte bancaire enregistrée en garantie{{/is_none_guarantee}}{{#is_none_guarantee}}facturé au locataire{{/is_none_guarantee}}, après notification écrite indiquant l'heure de départ constatée et le calcul, dans les conditions de l'article 11.{{/is_booking_platform}}{{#is_booking_platform}}Pour une réservation effectuée via une plateforme (Airbnb, Booking.com…), le montant est réclamé par l'intermédiaire de cette plateforme, selon ses règles.{{/is_booking_platform}}
    </p>
  </div>
  <p style="font-size:9pt;color:#8C7B65;margin-top:8px;font-family:Arial,sans-serif;">
    La remise des clés s'effectue selon les modalités communiquées par l'agence (boîte à clé sécurisée ou accueil sur place). Le locataire s'engage à restituer le bien propre et dans l'état dans lequel il l'a trouvé, à l'heure fixée ci-dessus.
  </p>
</div>

<!-- ══ 4. CONDITIONS FINANCIÈRES ════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">4</span>
    Conditions financières
  </div>
  <table class="financial-table">
    <thead>
      <tr>
        <th>Désignation</th>
        <th style="text-align:right">Montant</th>
        <th>Modalité de paiement</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Total à régler{{#has_taxes_total}}<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">dont {{taxes_total_eur}} de taxes</span>{{/has_taxes_total}}</td>
        <td class="amount">{{prix_total_eur}}</td>
        <td style="font-size:9pt">{{modalite_loyer_affiche}}</td>
      </tr>{{#has_options}}<tr><td>dont options choisies<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">{{options_detail}}</span></td><td class="amount">{{options_total_eur}}</td><td style="font-size:9pt"></td></tr>{{/has_options}}{{#has_promo}}<tr><td>{{promo_libelle}}</td><td class="amount">{{promo_montant_eur}}</td><td style="font-size:9pt">{{promo_note}}</td></tr>{{/has_promo}}{{#has_demandes}}<tr><td>Demandes du voyageur<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">{{demandes_detail}}</span></td><td class="amount"></td><td style="font-size:9pt">Sans supplément ni engagement</td></tr>{{/has_demandes}}
      {{#has_acompte}}<tr>
        <td>Acompte à la réservation ({{acompte_pourcentage}}%)</td>
        <td class="amount">{{acompte_montant_eur}}</td>
        <td style="font-size:9pt">{{modalite_acompte_affiche}}</td>
      </tr>{{/has_acompte}}
      {{#has_solde}}
      <tr>
        <td>Solde ({{solde_pourcentage}}%) — {{#has_solde_cash}}payable en espèces à l'arrivée, le {{date_arrivee_longue}}{{/has_solde_cash}}{{^has_solde_cash}}dû au plus tard le {{date_solde}}{{/has_solde_cash}}</td>
        <td class="amount">{{solde_montant_eur}}</td>
        <td style="font-size:9pt">{{modalite_solde_affiche}}</td>
      </tr>
      {{/has_solde}}
      {{#has_taxe_sejour}}
      <tr>
        <td>Taxe de séjour</td>
        <td class="amount">{{taxe_sejour_eur}}</td>
        <td style="font-size:9pt">Collectée et reversée à la commune</td>
      </tr>
      {{/has_taxe_sejour}}
    </tbody>
  </table>
  {{#has_payment_warning}}<div class="notice" style="margin-top:12px">
    ⚠️ Tout retard ou annulation de paiement pourra entraîner la résiliation du contrat, selon les conditions énoncées à l'article 8.
  </div>{{/has_payment_warning}}
  {{#is_cb}}
  <div class="notice" style="margin-top:8px;background:#F0FDF4;border-color:#86EFAC;font-size:9.5pt">
    💳 <strong>Modalités de règlement{{^is_cb_50_cash}} par carte bancaire{{/is_cb_50_cash}} :</strong><br>
    • <strong>Acompte de {{acompte_montant_eur}} ({{acompte_pourcentage}}%)</strong> — {{#is_prepaye}}{{paye_le_texte_min}} (réservation en ligne).{{/is_prepaye}}{{^is_prepaye}}prélevé par carte bancaire à la signature électronique du présent contrat.{{/is_prepaye}}<br>
    {{#has_solde_stripe}}• <strong>Solde de {{solde_montant_eur}} ({{solde_pourcentage}}%)</strong> — prélevé automatiquement par carte bancaire{{carte_mention}} le <strong>{{date_solde}}</strong> ({{date_solde_motif}}).{{/has_solde_stripe}}{{#has_solde_cash}}• <strong>Solde de {{solde_montant_eur}} ({{solde_pourcentage}}%)</strong> — payable en espèces à l'arrivée, le <strong>{{date_arrivee_longue}}</strong>, remis à l'agence ou à son représentant lors de l'entrée dans les lieux (aucun prélèvement sur la carte).{{/has_solde_cash}}<br>
    <em style="font-size:8.5pt;color:#166534">Les prélèvements sont effectués via Stripe (PCI-DSS niveau 1). Un justificatif vous sera envoyé par e-mail.</em>
  </div>
  {{/is_cb}}
</div>

  {{#has_rib}}
  <div class="notice" style="margin-top:8px;background:#EEF4FF;border-color:#93C5FD;font-size:9pt;page-break-inside:avoid;break-inside:avoid;">
    🏦 <strong>Virement à effectuer sur le compte séquestre :</strong><br>
    Titulaire : <strong>{{rib_titulaire}}</strong> &nbsp;·&nbsp;
    IBAN : <strong>{{rib_iban}}</strong> &nbsp;·&nbsp;
    BIC : <strong>{{rib_bic}}</strong> &nbsp;·&nbsp;
    Banque : {{rib_banque}}<br>
    <em style="font-size:8.5pt;color:#5C7FB0">Référence virement : <strong>{{virement_reference}}</strong></em>
  </div>
  {{/has_rib}}
{{#is_booking_platform}}
  <div class="notice" style="margin-top:10px;background:#EEF6FF;border-color:#93C5FD;color:#1E3A5F;">
    ℹ️ <strong>Paiement géré par Booking.com</strong><br>
    Le paiement du séjour est géré par Booking.com selon les conditions acceptées lors de la réservation.<br>
    <em style="font-size:8.5pt;color:#5C7FB0;">Le présent contrat complète les conditions de séjour : identité, occupation, règlement intérieur, état des lieux, garantie bancaire et frais éventuels.</em>
  </div>
{{/is_booking_platform}}

{{^is_none_guarantee}}<!-- ══ 5. GARANTIE BANCAIRE ══════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">5</span>
    Garantie bancaire — Empreinte CB
  </div>
  <div class="garantie-box">
    <span class="garantie-icon">🔐</span>
    <strong>Carte enregistrée en garantie</strong><br><br>
    {{garantie_clause}}
  </div>
  <p style="font-size:8.5pt;color:#8C7B65;font-family:Arial,sans-serif;margin-top:8px;">
    La carte bancaire est enregistrée de manière sécurisée via Stripe (PCI-DSS niveau 1). Aucun numéro de carte n'est stocké par Destination Côte Basque.
  </p>
</div>

{{/is_none_guarantee}}<!-- ══ 6. OBLIGATIONS DU LOCATAIRE ══════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">6</span>
    Obligations du locataire
  </div>
  <div class="clause">
    <p>Le locataire s'engage à :</p>
    <ul>
      <li>Occuper les lieux personnellement, de manière paisible, en « bon père de famille », et de manière conforme à leur destination d'habitation saisonnière temporaire.</li>
      <li>Ne pas sous-louer ni céder le présent contrat, partiellement ou totalement, sans accord écrit préalable du bailleur.</li>
      <li>Respecter scrupuleusement le nombre maximum de personnes autorisé ({{bien_capacite_max_label}}). Toute occupation supplémentaire est formellement interdite sans autorisation écrite.</li>
      <li>Ne pas introduire d'animaux dans le logement sauf autorisation explicite écrite de l'agence.</li>
      <li>Respecter les règles de voisinage, notamment le calme et la tranquillité entre 22h00 et 8h00.</li><li>Ne pas utiliser de matériel de sonorisation susceptible de générer des nuisances pour le voisinage (enceintes amplifiées, sono, etc.).</li>
      <li>Ne pratiquer aucune activité commerciale ou professionnelle dans le logement.</li>
      <li>Signaler immédiatement toute dégradation ou panne constatée à l'agence.</li>
      <li>Libérer le logement à l'heure de départ du séjour (article 3) : tout départ tardif non autorisé est facturé selon l'article 3 ; un départ tardif peut être demandé à l'avance.</li>
      <li>Restituer le logement dans l'état d'inventaire initial : vaisselle propre, électroménager nettoyé, déchets évacués, linge de lit retiré.</li>
      <li>Ne pas fumer à l'intérieur du logement.</li>
      {{#a_piscine}}<li>Respecter les règles de sécurité liées à la piscine : ne pas laisser de mineurs sans surveillance, ne pas utiliser la piscine entre 23h00 et 7h00. Le locataire reconnaît avoir été informé que l'utilisation de la piscine se fait sous sa seule responsabilité.</li>{{/a_piscine}}
    </ul>
  </div>
</div>

<!-- ══ 7. ASSURANCE VILLÉGIATURE ════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">7</span>
    Assurance villégiature
  </div>
  <div class="clause">
    <p>
      L'assurance <strong>responsabilité civile villégiature</strong> couvre les dommages pouvant être causés au logement, à son contenu et aux tiers (incendie, dégât des eaux, vol, casse) pendant le séjour. Le locataire indique ci-dessous sa situation au regard de cette garantie :
    </p>
    <div style="margin:14px 0;display:flex;flex-direction:column;gap:6px;font-size:10pt">
{{#is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_platform}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Case cochée (option retenue)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_platform}}{{^assurance_choice_platform}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Case non cochée" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_platform}}</span>
        <span>Couverture villégiature incluse via la plateforme de réservation ({{assurance_platform_name}})</span>
      </div>
{{/is_booking_platform}}
{{^is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_mrh}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Case cochée (option retenue)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_mrh}}{{^assurance_choice_mrh}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Case non cochée" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_mrh}}</span>
        <span>Je dispose d'une assurance villégiature couvrant la période du séjour et pourrai fournir une attestation sur demande.</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_no_insurance}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Case cochée (option retenue)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_no_insurance}}{{^assurance_choice_no_insurance}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Case non cochée" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_no_insurance}}</span>
        <span>Je déclare ne pas bénéficier d'une garantie villégiature couvrant les dommages pouvant être causés au logement loué pendant mon séjour. J'ai été informé(e) que je pourrais être tenu(e) personnellement responsable des dommages matériels causés au logement, à son mobilier ou aux tiers pendant la durée de la location, et j'accepte de poursuivre la réservation sans cette couverture.</span>
      </div>
{{/is_booking_platform}}
    </div>
    <p style="font-weight:700">
      L'absence d'assurance villégiature n'exonère en aucun cas le locataire de sa responsabilité en cas de dommages causés au logement ou à son contenu.
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      Note : l'assurance de l'agence couvre uniquement la responsabilité civile professionnelle de {{agence_nom}} (assurance {{agence_assurance}}). Elle ne se substitue pas à l'assurance personnelle du locataire.
    </p>
  </div>
</div>

<!-- ══ 8. CONDITIONS D'ANNULATION ════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">8</span>
    Conditions d'annulation et de résiliation
  </div>
  <div class="clause">
    <p>Toute annulation doit être notifiée par écrit (e-mail à {{agence_email_contact}}) :</p>
    {{clause_annulation}}
    <p>
      Les frais de traitement bancaire éventuellement supportés par l'agence pourront être déduits du remboursement. En cas de résiliation par le bailleur ou l'agence pour raison indépendante de la volonté du locataire, les sommes versées seront intégralement remboursées dans un délai de 15 jours.
    </p>
  </div>
</div>

<!-- ══ 9. RGPD — TRAITEMENT DES DONNÉES PERSONNELLES ════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">9</span>
    Protection des données personnelles (RGPD)
  </div>
  <div class="clause">
    <div class="clause-title">9.1 Responsable du traitement</div>
    <p>
      {{agence_nom}}, {{agence_adresse}} (le « Responsable de traitement »), traite vos données personnelles dans le cadre de la gestion de votre réservation et de la relation contractuelle.
    </p>
    <div class="clause-title" style="margin-top:10px">9.2 Données collectées et finalités</div>
    <p>Les données collectées (nom, prénom, adresse, e-mail, téléphone, données de paiement) sont traitées pour :</p>
    <ul>
      <li>La gestion et l'exécution du présent contrat de location ;</li>
      <li>La gestion des paiements et de la garantie bancaire ;</li>
      <li>La conformité aux obligations légales (déclaration de taxe de séjour, obligations fiscales) ;</li>
      <li>La vérification d'identité aux fins de sécurité du logement.</li>
    </ul>
    <div class="clause-title" style="margin-top:10px">9.3 Durée de conservation</div>
    <p>
      Les données contractuelles sont conservées pendant <strong>5 ans</strong> à compter de la fin du séjour (obligations comptables). Les documents d'identité (photo de vérification et pièce d'identité) sont conservés pendant <strong>1 an</strong> à compter de la fin du séjour, puis supprimés définitivement. Les données de carte bancaire sont gérées exclusivement par Stripe — aucun numéro complet de carte n'est stocké par {{agence_nom}}.
    </p>
    <div class="clause-title" style="margin-top:10px">9.4 Droits du locataire</div>
    <p>
      Conformément au RGPD (Règlement UE 2016/679) et à la loi Informatique et Libertés, vous bénéficiez d'un droit d'accès, de rectification, de suppression et de portabilité de vos données, ainsi que d'un droit d'opposition au traitement. Pour exercer ces droits : {{agence_email_contact}}.
    </p>
    <div class="clause-title" style="margin-top:10px">9.5 Transfert vers des tiers</div>
    <p>
      Vos données sont partagées, dans la stricte limite du nécessaire, avec : Stripe Inc. (paiement, États-Unis — adequacy decision EU-US Data Privacy Framework), Twilio Inc. (vérification SMS), et les services hébergés sur Supabase (infrastructure Cloud, UE). Aucune donnée n'est vendue à des tiers.
    </p>
    <div class="clause-title" style="margin-top:10px">9.6 Sécurité des documents et vérification d'identité</div>
    <p>
      La photo de vérification prise lors de la signature fait l'objet d'un contrôle automatisé dont le seul objet est de vérifier qu'un visage est visible et exploitable (photo non vide, non floue, non prise sur un écran). Ce contrôle ne vise pas à identifier la personne : il ne comporte aucune reconnaissance faciale, aucune comparaison avec la pièce d'identité ni aucun traitement de données biométriques. Il repose sur l'intérêt légitime de {{agence_nom}} à prévenir la fraude et à sécuriser l'accès au logement, et ne peut à lui seul empêcher la signature : après deux nouvelles prises de vue, la photo est acceptée. Il est réalisé par notre sous-traitant Anthropic PBC (États-Unis), dans le cadre des clauses contractuelles types adoptées par la Commission européenne ; Anthropic n'utilise pas ces données pour entraîner ses modèles et les supprime dans un délai de 30 jours, sauf conservation plus longue imposée par la loi ou par le contrôle du respect de ses règles d'utilisation. La pièce d'identité ne lui est jamais transmise. La photo de vérification et la pièce d'identité sont marquées dès leur réception d'un filigrane « document destiné uniquement à la location saisonnière » et ne sont jamais conservées sans ce filigrane. Le contrat signé est scellé électroniquement par {{agence_nom}} : toute modification ultérieure du document est détectable.
    </p>
  </div>
</div>

<!-- ══ 10. ÉTAT DES LIEUX ════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">10</span>
    État des lieux
  </div>
  <div class="clause">
    <div class="clause-title">10.1 État des lieux d'entrée</div>
    <p>
      Un état des lieux contradictoire est réalisé à l'arrivée du locataire, en présence d'un représentant de l'agence ou par tout moyen équivalent (formulaire numérique, photos datées). Le locataire dispose d'un délai de <strong>24 heures</strong> à compter de la remise des clés pour signaler tout désordre ou réserve non mentionné dans l'état des lieux initial, par écrit à {{agence_email_contact}}.
    </p>
    <div class="clause-title" style="margin-top:10px">10.2 État des lieux de sortie</div>
    <p>
      À l'expiration du séjour, un état des lieux contradictoire de sortie est établi selon les mêmes modalités. Le bien doit être restitué dans l'état constaté à l'entrée, nettoyé, et conforme à l'inventaire joint. Toute dégradation constatée lors de la sortie, non mentionnée à l'entrée, sera imputée au locataire.
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      En l'absence du locataire lors de l'état des lieux de sortie, celui-ci sera établi contradictoirement par l'agence seule, et notifié au locataire dans les 48 heures par e-mail. Le locataire pourra formuler des observations dans les 5 jours suivant la notification.
    </p>
  </div>
</div>

<!-- ══ 11. RETENUES ET FRAIS DE REMISE EN ÉTAT ═════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">11</span>
    Retenues sur garantie et frais de remise en état
  </div>
  <div class="clause">
    <p>
      En cas de dégradation constatée à l'état des lieux de sortie, de manquement aux obligations du locataire, ou de frais supplémentaires engendrés, l'agence pourra procéder à un débit sur la carte bancaire enregistrée comme garantie (article 5), après justification et notification écrite au locataire, pour les motifs suivants :
    </p>
    <ul>
      <li><strong>Bien laissé dans un état de saleté avancée :</strong> facturation des frais de nettoyage réels (minimum 80 €).</li>
      <li><strong>Draps ou serviettes fortement souillés au-delà de l'usage normal :</strong> frais de traitement en sus (minimum 30 € par lot).</li>
      <li><strong>Objets cassés, détériorés ou manquants :</strong> remplacement ou réparation au coût réel justifié.</li>
      <li><strong>Déchets en quantité importante non évacués :</strong> frais d'enlèvement (minimum 50 €).</li>
      <li><strong>Clés non restituées :</strong> remplacement de serrure ou boîte à clé sécurisée (coût réel).</li>
      <li><strong>Occupation non autorisée (animaux, sur-occupation) :</strong> pénalité forfaitaire de 100 € plus 5 % du montant total du séjour, sans préjudice d'autres dommages.</li>
      <li><strong>Départ tardif non autorisé :</strong> pénalité de 10 % du prix d'une nuit par tranche de 10 minutes commencée après 10 minutes de tolérance, plafonnée au prix d'une nuit, plus les frais réels justifiés (article 3).</li>
    </ul>
    <p style="font-size:9pt;color:#8C7B65;margin-top:8px;">
      Tout débit sera précédé d'un e-mail de notification détaillant les motifs et les montants. Le locataire dispose de 7 jours pour contester par écrit. Le locataire peut présenter toute observation ou contestation dans un délai de 7 jours.
    </p>
  </div>
</div>

<!-- ══ 12. RÉPARATIONS URGENTES — ACCÈS AU LOGEMENT ════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">12</span>
    Réparations urgentes et accès au logement
  </div>
  <div class="clause">
    <p>
      Le locataire est tenu de signaler immédiatement à l'agence toute panne ou dégradation constatée. Il autorise expressément l'accès au logement par l'agence ou ses prestataires pour tout travail d'urgence nécessaire à la conservation du bien (fuite d'eau, panne de chauffage, problème électrique, etc.), même en son absence, après information préalable.
    </p>
    <p>
      Ces interventions urgentes n'ouvrent droit à aucune réduction du loyer, sauf si elles privaient le locataire de la jouissance d'une partie substantielle du logement pendant plus de 48 heures consécutives. Dans ce dernier cas, une réduction proportionnelle sera calculée d'un commun accord.
    </p>
  </div>
</div>

<!-- ══ 13. FORCE MAJEURE ════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">13</span>
    Force majeure
  </div>
  <div class="clause">
    <p>
      Ni le bailleur, ni l'agence ne pourront être tenus responsables de l'inexécution ou du retard dans l'exécution de leurs obligations en cas d'événement de force majeure au sens de l'article 1218 du Code civil (catastrophe naturelle, incendie, inondation, décision administrative, pandémie avec fermeture imposée par les autorités, etc.).
    </p>
    <p>
      En cas de force majeure rendant le logement inhabitable ou son accès impossible, les sommes versées par le locataire seront remboursées intégralement dans un délai de 15 jours, à l'exclusion de tout autre indemnité. Le locataire est invité à souscrire une assurance annulation pour se prémunir des cas non couverts par la force majeure légale. Les pannes temporaires de réseaux internet, de téléphonie, de télévision ou de services tiers ne constituent pas un cas d'inexécution contractuelle lorsqu'elles échappent au contrôle du bailleur.
    </p>
  </div>
</div>

<!-- ══ 14. DROIT APPLICABLE ET JURIDICTION COMPÉTENTE ══════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">14</span>
    Droit applicable, médiation et juridiction compétente
  </div>
  <div class="clause">
    <p>
      Le présent contrat est soumis au droit français. En cas de litige, les parties s'engagent à tenter une résolution amiable avant toute action en justice.
    </p>
    <p>
      Conformément aux articles L612-1 et suivants du Code de la consommation, en cas de litige non résolu après une réclamation écrite préalable auprès de l'agence, le locataire peut recourir gratuitement au médiateur de la consommation suivant : le Centre de la Médiation de la Consommation de Conciliateurs de Justice (CM2C), 49 rue de Ponthieu, 75008 Paris – www.cm2c.net (dépôt de la demande en ligne) – 01 89 47 00 14. La saisine du médiateur doit intervenir dans un délai d'un an à compter de la réclamation écrite adressée à l'agence.
    </p>
    <p>
      En cas de litige, les règles de compétence prévues par le Code de la consommation et le Code de procédure civile s'appliquent.
    </p>
  </div>
</div>

<!-- ══ SIGNATURES ════════════════════════════════════════════════════ -->
<div class="section avoid-break">
  <div class="section-title">
    <span class="section-title-num" style="background:linear-gradient(135deg,#2C2416,#4A3820)">✍</span>
    Signatures des parties
  </div>
  <div style="background:#FDFAF5;border:1px solid #E8DCC8;border-left:3px solid #CC9933;border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:9pt;color:#4A3F32;font-family:'Helvetica Neue',Arial,sans-serif;line-height:1.7">
    Le locataire reconnaît avoir pris connaissance de l'intégralité du présent contrat (y compris l'annexe descriptive), avoir eu la possibilité de poser toute question, et accepte sans réserve les termes et conditions définis ci-dessus. La signature électronique apposée ci-dessous a la même valeur juridique qu'une signature manuscrite (loi n° 2000-230 du 13 mars 2000, art. 1366 et 1367 du Code civil).
  </div>
  <div class="signature-grid">
    <div class="signature-block">
      <div class="signature-label">Pour le bailleur / mandataire</div>
      <div class="signature-name">{{agence_nom}}</div>
      <div class="signature-note">Représenté par {{agence_representant}}, {{agence_qualite_representant}}<br>{{agence_email_representant}}</div>
      <div style="margin-top:10px;text-align:center">
        <div style="font-size:8pt;color:#8C7B65;margin-bottom:4px">Signé électroniquement</div>
        <div style="font-family:'Northwell',cursive;font-size:20pt;color:#CC9933;line-height:1;padding:4px 0">Oihan Campandegui</div>
        <div style="font-size:7.5pt;color:#A09282;margin-top:2px">{{agence_qualite_representant}} — {{agence_nom}}</div>
      </div>
    </div>
    <div class="signature-block">
      <div class="signature-label">Locataire — signature électronique</div>
      <div class="signature-name">{{guest_civilite}} {{guest_nom_affiche}}</div>
      <div class="signature-note">Signature apposée via le portail sécurisé<br>contrat.destinationcotebasque.com</div>
      <div class="signature-line"></div>
    </div>
  </div>
</div>

<!-- ══ ANNEXE — ÉTAT DESCRIPTIF DU BIEN ═════════════════════════════ -->
<div class="page-break"></div>
<div class="header" style="margin-bottom:0;padding:20px 0 16px">
  <div class="header-left">
    <div class="logo-square" style="width:38px;height:38px;font-size:18px">D</div>
    <div class="header-brand">
      <div class="name" style="font-size:11pt">Destination Côte Basque</div>
      <div class="sub">Annexe au contrat de location saisonnière</div>
    </div>
  </div>
  <div class="header-right">{{date_contrat_longue}}</div>
</div>
<div class="doc-title-block" style="padding:18px 0 14px;margin-bottom:20px">
  <div class="doc-title" style="font-size:12pt;letter-spacing:2px">État Descriptif du Bien</div>
  <div class="gold-line"></div>
  <div class="doc-subtitle">{{bien_nom_public}}</div>
  <div class="doc-subtitle" style="margin-top:2px;font-size:8.5pt;">{{bien_adresse_complete}}</div>
</div>
<div class="section">
  <div class="section-title">
    <span class="section-title-num">A</span>
    Caractéristiques générales
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:28%" class="annexe-label">Adresse</td>
      <td colspan="3">{{bien_adresse_complete}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Nature / Type</td>
      <td>{{bien_nature_label}}</td>
      <td style="width:28%" class="annexe-label">Classement</td>
      <td>{{bien_classement_label}}</td>
    </tr>
    {{#has_surface_pieces}}
    <tr>
      <td class="annexe-label">Surface</td>
      <td>{{#bien_superficie}}{{bien_superficie}} m²{{/bien_superficie}}</td>
      <td class="annexe-label">Nb pièces principales</td>
      <td>{{bien_nb_pieces}}</td>
    </tr>
    {{/has_surface_pieces}}
    {{#has_construction_etage}}
    <tr>
      <td class="annexe-label">Année de construction</td>
      <td>{{bien_date_construction}}</td>
      <td class="annexe-label">Étage</td>
      <td>{{bien_etage}}</td>
    </tr>
    {{/has_construction_etage}}
    <tr>
      <td class="annexe-label">Capacité d'accueil</td>
      <td>{{bien_capacite_max_label}} max.</td>
      {{#has_exposition}}
      <td class="annexe-label">Exposition</td>
      <td>{{bien_exposition}}</td>
      {{/has_exposition}}
      {{#has_no_exposition}}
      <td colspan="2"></td>
      {{/has_no_exposition}}
    </tr>
    {{#has_voisinage}}
    <tr>
      <td class="annexe-label">Environnement / Voisinage</td>
      <td colspan="3">{{bien_voisinage}}</td>
    </tr>
    {{/has_voisinage}}
    {{#a_piscine}}
    <tr>
      <td class="annexe-label">Équipements spéciaux</td>
      <td colspan="3">🏊 {{piscine_label}} — {{piscine_horaires_label}}</td>
    </tr>
    {{/a_piscine}}
  </table>

  {{#has_distances}}
  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">B</span>
    Distances et situation géographique
  </div>
  <table class="annexe-table">
    <thead>
      <tr>
        <th>Point de référence</th>
        <th>Distance approximative</th>
      </tr>
    </thead>
    <tbody>
      {{#bien_distance_mer}}
      <tr>
        <td>Mer / océan</td>
        <td>{{bien_distance_mer}}</td>
      </tr>
      {{/bien_distance_mer}}
      {{#bien_distance_plage}}
      <tr>
        <td>Plage la plus proche</td>
        <td>{{bien_distance_plage}}</td>
      </tr>
      {{/bien_distance_plage}}
      {{#bien_distance_gare}}
      <tr>
        <td>Gare</td>
        <td>{{bien_distance_gare}}</td>
      </tr>
      {{/bien_distance_gare}}
      {{#bien_distance_centre}}
      <tr>
        <td>Centre-ville</td>
        <td>{{bien_distance_centre}}</td>
      </tr>
      {{/bien_distance_centre}}
    </tbody>
  </table>
  {{/has_distances}}

  {{#has_description_pieces}}
  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">C</span>
    Description des pièces
  </div>
  <table class="annexe-table">
    <thead>
      <tr>
        <th>Pièce</th>
        <th>Description &amp; équipements</th>
      </tr>
    </thead>
    <tbody>
      {{#has_desc_sejour}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Séjour / Salon</td>
        <td>{{bien_description_sejour}}</td>
      </tr>
      {{/has_desc_sejour}}
      {{#has_desc_cuisine}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Cuisine</td>
        <td>{{bien_cuisine}}</td>
      </tr>
      {{/has_desc_cuisine}}
      {{#has_desc_sdb}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Salle de bain</td>
        <td>{{bien_sdb}}</td>
      </tr>
      {{/has_desc_sdb}}
      {{#has_desc_toilettes}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Toilettes</td>
        <td>{{bien_toilettes}}</td>
      </tr>
      {{/has_desc_toilettes}}
      {{#has_desc_etat}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">État général</td>
        <td>{{bien_etat_general}}</td>
      </tr>
      {{/has_desc_etat}}
    </tbody>
  </table>
  {{/has_description_pieces}}

  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">D</span>
    Heures d'accès (check-in / check-out)
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:50%" class="annexe-label">Heure d'arrivée (check-in)</td>
      <td>À partir de {{heure_arrivee}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Heure de départ (check-out)</td>
      <td>Avant {{heure_depart}}</td>
    </tr>
  </table>
</div>

{{#has_bien_photos}}
<div class="section" style="page-break-inside:avoid;break-inside:avoid;margin-top:20px">
  <div class="section-title">
    <span class="section-title-num" style="background:linear-gradient(135deg,#5C7FB0,#3B6FA0)">📷</span>
    Photos du bien
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px">
    {{#bien_photo_1}}<img src="{{bien_photo_1}}" style="width:100%;height:140px;object-fit:cover;border-radius:6px;border:1px solid #E8DCC8" alt="Photo du bien">{{/bien_photo_1}}
    {{#bien_photo_2}}<img src="{{bien_photo_2}}" style="width:100%;height:140px;object-fit:cover;border-radius:6px;border:1px solid #E8DCC8" alt="Photo du bien">{{/bien_photo_2}}
    {{#bien_photo_3}}<img src="{{bien_photo_3}}" style="width:100%;height:140px;object-fit:cover;border-radius:6px;border:1px solid #E8DCC8" alt="Photo du bien">{{/bien_photo_3}}
  </div>
</div>
{{/has_bien_photos}}

<!-- ══ PIED DE PAGE ═══════════════════════════════════════════════════ -->
<div class="footer">
  {{agence_nom}} — {{agence_adresse}} — {{agence_email_contact}} — Tél. {{agence_telephone_affiche}}<br>
  Carte Professionnelle {{agence_cpi}} délivrée par {{agence_cpi_delivree_par}} — RCS {{agence_rcs}} — TVA {{agence_tva}}<br>
  Assurance RCP : {{agence_assurance}} — Garantie financière : {{agence_garantie_galian}}<br>
  <em>Document généré automatiquement le {{date_contrat_longue}} — Signature électronique certifiée</em>
</div>

</div><!-- /.page -->
</body>
</html>
$tpl469$, $v$[]$v$::jsonb, false
where not exists (select 1 from contract_templates where agence='dcb' and langue='fr' and type_contrat='saisonnier' and version='2026-v8');

-- lauian saisonnier en : 2026-v5 → 2026-v6
insert into contract_templates (agence, langue, type_contrat, version, nom, contenu_html, variables_attendues, is_active)
select 'lauian', 'en', 'saisonnier', '2026-v6', $n$EN Seasonal 2026 — Lauïan Immobilier$n$, $tpl469$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Seasonal Rental Agreement — Lauïan Immobilier</title>
<style>
/* ── Reset ── */
* { margin: 0; padding: 0; box-sizing: border-box; }
@font-face {
  font-family: 'Northwell';
  src: url('https://dcb-contrats.vercel.app/fonts/Northwell.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
}

/* ── Page PDF ── */
@page {
  size: A4;
  margin: 20mm 15mm 22mm;
  @bottom-right {
    content: "Page " counter(page) " / " counter(pages);
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 7.5pt;
    color: #A09282;
  }
  @bottom-left {
    content: "Lauïan Immobilier — Seasonal Rental Agreement";
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 7.5pt;
    color: #A09282;
  }
}

body {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 10.5pt;
  color: #1C1C1C;
  line-height: 1.65;
  background: #fff;
  counter-reset: page;
}

/* ── Mise en page ── */
.page { max-width: 800px; margin: 0 auto; padding: 0 20px; }

/* ── En-tête ── */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28px 0 20px;
  border-bottom: 0;
  margin-bottom: 0;
  position: relative;
}
.header::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #CC9933 0%, #E4A853 50%, #CC9933 100%);
  border-radius: 2px;
}
.header-left { display: flex; align-items: center; gap: 14px; }
.logo-square {
  width: 50px; height: 50px;
  background: linear-gradient(135deg, #D4A035 0%, #CC9933 60%, #B8872A 100%);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 24px; font-weight: 700;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(204,153,51,0.30);
}
.header-brand { font-family: 'Helvetica Neue', Arial, sans-serif; }
.header-brand .name { font-size: 14pt; font-weight: 700; color: #1C1C1C; letter-spacing: -0.3px; }
.header-brand .sub  { font-size: 8pt; color: #8C7B65; letter-spacing: 2px; text-transform: uppercase; margin-top: 1px; }
.header-right {
  text-align: right;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 8pt; color: #8C7B65; line-height: 1.8;
}

/* ── Titre principal ── */
.doc-title-block {
  text-align: center;
  padding: 28px 0 20px;
  border-bottom: 1px solid #EAE0D0;
  margin-bottom: 26px;
}
.doc-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 15pt;
  font-weight: 700;
  color: #1C1C1C;
  text-transform: uppercase;
  letter-spacing: 3px;
  margin-bottom: 8px;
}
.doc-subtitle {
  font-size: 9.5pt;
  color: #8C7B65;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-style: italic;
}
.gold-line {
  width: 48px; height: 2px;
  background: linear-gradient(90deg, #CC9933, #E4A853, #CC9933);
  margin: 12px auto;
  border-radius: 2px;
}

/* ── Sections ── */
.section {
  margin-bottom: 24px;
  page-break-inside: avoid;
}
.section-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 8.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: #CC9933;
  border-bottom: 1.5px solid #E8DCC8;
  padding-bottom: 6px;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 0;
}
.section-title-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #D4A035, #CC9933);
  color: #fff;
  border-radius: 50%;
  width: 22px; height: 22px;
  font-size: 9pt;
  font-weight: 700;
  margin-right: 10px;
  flex-shrink: 0;
  box-shadow: 0 1px 4px rgba(204,153,51,0.30);
}

/* ── Blocs parties ── */
.parties-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 4px;
}
.partie-box {
  background: #FDFAF5;
  border: 1px solid #E8DCC8;
  border-left: 3px solid #CC9933;
  border-radius: 6px;
  padding: 14px 16px;
}
.partie-label {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: #8C7B65;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #E8DCC8;
}
.partie-nom {
  font-size: 11pt;
  font-weight: 700;
  color: #1C1C1C;
  margin-bottom: 5px;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
.partie-detail {
  font-size: 9pt;
  color: #4A3F32;
  line-height: 1.75;
}

/* ── Tableau financier ── */
.financial-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9.5pt;
  margin-bottom: 4px;
  border-radius: 6px;
  overflow: hidden;
}
.financial-table th {
  background: #F0E8D8;
  color: #6B5840;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 8px 12px;
  text-align: left;
  border: 1px solid #E0D4C0;
}
.financial-table td {
  padding: 10px 12px;
  border: 1px solid #E8DCC8;
  vertical-align: top;
}
.financial-table tr:nth-child(even) td { background: #FDFAF5; }
.amount { font-weight: 700; color: #1C1C1C; text-align: right; }
.total-row td { background: #F0E8D8 !important; font-weight: 700; font-size: 10pt; }

/* ── Bloc garantie ── */
.garantie-box {
  background: #F0FBF4;
  border: 1px solid #86EFAC;
  border-left: 4px solid #15803D;
  border-radius: 6px;
  padding: 14px 16px;
  margin: 12px 0;
  font-size: 9.5pt;
  line-height: 1.7;
  color: #1C1C1C;
}
.garantie-box strong { color: #166534; }
.garantie-icon { font-size: 13pt; margin-right: 6px; vertical-align: middle; }

/* ── Clauses / Articles ── */
.clause {
  margin-bottom: 14px;
  page-break-inside: avoid;
}
.clause-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9.5pt;
  font-weight: 700;
  color: #2C2416;
  margin-bottom: 5px;
  letter-spacing: -0.1px;
}
.clause p {
  font-size: 9.5pt;
  color: #2C2416;
  margin-bottom: 6px;
  line-height: 1.65;
}
.clause ul, .clause ol {
  padding-left: 20px;
  margin: 6px 0;
}
.clause li {
  font-size: 9.5pt;
  color: #2C2416;
  margin-bottom: 4px;
  line-height: 1.65;
}

/* ── Tableau descriptif annexe ── */
.annexe-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9pt;
  margin-bottom: 12px;
}
.annexe-table th {
  background: #F0E8D8;
  color: #6B5840;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 7px 10px;
  border: 1px solid #E0D4C0;
  text-align: left;
}
.annexe-table td {
  padding: 8px 10px;
  border: 1px solid #E8DCC8;
  vertical-align: top;
}
.annexe-table tr:nth-child(even) td { background: #FDFAF5; }
.annexe-label { color: #8C7B65; font-size: 8pt; font-family: 'Helvetica Neue', Arial, sans-serif; }

/* ── Bloc signature ── */
.signature-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-top: 20px;
}
.signature-block {
  border: 1px solid #E8DCC8;
  border-radius: 8px;
  padding: 16px;
  min-height: 110px;
  background: #FDFAF5;
}
.signature-label {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #8C7B65;
  margin-bottom: 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid #E8DCC8;
}
.signature-name {
  font-weight: 700;
  font-size: 10pt;
  color: #1C1C1C;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
.signature-note { font-size: 7.5pt; color: #8C7B65; margin-top: 4px; line-height: 1.5; font-family: 'Helvetica Neue', Arial, sans-serif; }
.signature-line {
  border-bottom: 1.5px dashed #CC9933;
  height: 52px;
  margin-top: 14px;
  opacity: 0.5;
}

/* ── Pied de page ── */
.footer {
  margin-top: 32px;
  padding-top: 14px;
  border-top: 1px solid #E8DCC8;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  color: #A09282;
  line-height: 1.8;
  text-align: center;
}

/* ── Sauts de page ── */
.page-break { page-break-before: always; break-before: page; }
.avoid-break { page-break-inside: avoid; break-inside: avoid; }

/* ── Info notice ── */
.notice {
  background: #FFF8E6;
  border: 1px solid #FDE68A;
  border-left: 3px solid #D97706;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 9pt;
  color: #78350F;
  margin: 10px 0;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  img { max-width: 100% !important; }
}
</style>
</head>
<body>
<div class="page">

<!-- ══ HEADER ══════════════════════════════════════════════════════ -->
<div class="header">
  <div class="header-left">
    <div class="logo-square">L</div>
    <div class="header-brand">
      <div class="name">Lauïan Immobilier</div>
      <div class="sub">Seasonal rental management &amp; real estate</div>
    </div>
  </div>
  <div class="header-right">
    {{agence_adresse}}<br>
    Tel. {{agence_telephone_affiche}}<br>
    {{agence_email_contact}}<br>
    RCS {{agence_rcs}}
  </div>
</div>

<!-- ══ TITLE ════════════════════════════════════════════════════════ -->
<div class="doc-title-block">
  <div class="doc-title">Seasonal Rental Agreement</div>
  <div class="gold-line"></div>
  <div class="doc-subtitle">Executed at {{lieu_signature}}, on {{date_contrat_longue}}</div>
</div>

<!-- ══ 1. PARTIES ═══════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">1</span>
    Parties to the Agreement
  </div>
  <div class="parties-grid">
    <!-- Landlord -->
    <div class="partie-box">
      <div class="partie-label">Landlord (property owner)</div>
      <div class="partie-nom">{{bailleur_nom_affiche}}</div>
      <div class="partie-detail">
        {{bailleur_statut_affiche}}<br>
        {{bailleur_adresse_complete}}
      </div>
    </div>
    <!-- Managing Agent -->
    <div class="partie-box">
      <div class="partie-label">Agent — Managing Agency</div>
      <div class="partie-nom">{{agence_nom}}</div>
      <div class="partie-detail">
        {{agence_adresse}}<br>
        Tel. {{agence_telephone_affiche}}<br>
        {{agence_email_contact}}<br>
        RCS {{agence_rcs}} — {{agence_cpi}}<br>
        issued by {{agence_cpi_delivree_par}}<br>
        {{agence_forme}} with share capital of {{agence_capital}} €<br>
        VAT: {{agence_tva}}<br>
        Represented by {{agence_representant_affiche}}, {{agence_qualite_representant}}
      </div>
    </div>
  </div>
  <!-- Tenant full width -->
  <div class="partie-box" style="margin-top:14px">
    <div class="partie-label">Tenant</div>
    <div class="partie-nom">{{guest_civilite_affiche}} {{guest_nom_affiche}}</div>
    <div class="partie-detail">
      Address: {{guest_adresse_affichee}}<br>
      E-mail: {{guest_email}}&nbsp;&nbsp;·&nbsp;&nbsp;Phone: {{guest_telephone_affiche}}<br>
      Number of persons: <strong>{{guest_nb_personnes}}</strong>{{guest_detail_personnes}}
    </div>
  </div>
</div>

<!-- ══ 2. DESCRIPTION OF THE PROPERTY ══════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">2</span>
    Description of the Property
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:35%" class="annexe-label">Property type</td>
      <td>{{bien_nature_label}}</td>
      <td style="width:30%" class="annexe-label">Classification</td>
      <td>{{bien_classement_label}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Full address</td>
      <td colspan="3">{{bien_adresse_complete}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Owner</td>
      <td>{{bailleur_nom_affiche}}</td>
      <td class="annexe-label">Maximum capacity</td>
      <td>{{bien_capacite_max_label}}</td>
    </tr>
    {{#has_surface_pieces}}
    <tr>
      <td class="annexe-label">{{bien_superficie_label}}</td>
      <td>{{#bien_superficie}}{{bien_superficie}} m²{{/bien_superficie}}</td>
      <td class="annexe-label">Number of rooms</td>
      <td>{{#bien_nb_pieces}}{{bien_nb_pieces_label}}{{/bien_nb_pieces}}</td>
    </tr>
    {{/has_surface_pieces}}
    {{#has_construction_etage}}
    <tr>
      <td class="annexe-label">Year of construction</td>
      <td>{{bien_date_construction}}</td>
      <td class="annexe-label">Floor</td>
      <td>{{bien_etage}}</td>
    </tr>
    {{/has_construction_etage}}
    {{#a_piscine}}
    <tr>
      <td class="annexe-label">Special amenities</td>
      <td colspan="3">🏊 Private swimming pool included in the rental</td>
    </tr>
    {{/a_piscine}}
  </table>
</div>

<!-- ══ 3. RENTAL PERIOD ═════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">3</span>
    Rental Period
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:30%" class="annexe-label">Check-in</td>
      <td><strong>{{date_arrivee_longue}}</strong> from {{heure_arrivee}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Check-out</td>
      <td><strong>{{date_depart_longue}}</strong> before {{heure_depart}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Length of stay</td>
      <td><strong>{{nb_nuits_label}}</strong></td>
    </tr>
  </table>
  <div class="clause" style="margin-top:12px">
    <div class="clause-title">Check-out time — unauthorised late check-out</div>
    <p>
      The property must be vacated, and the keys returned as instructed, no later than the check-out time stated above or, where applicable, the late check-out time paid for in advance. A <strong>10-minute</strong> grace period applies. Beyond that, a tenant who remains in the property without the agency's written agreement shall owe, as a penalty clause (article 1231-5 of the French Civil Code), <strong>10% of the average price of one night of accommodation</strong> of the stay (excluding fees and taxes) <strong>per 10-minute period started</strong> after the grace period{{#has_penalite_montant}}, i.e. <strong>{{penalite_tranche_eur}} per period</strong> for this stay{{/has_penalite_montant}}, up to <strong>the price of one night</strong>{{#has_penalite_montant}} ({{penalite_plafond_eur}}){{/has_penalite_montant}}. Any actual costs caused by the delay (urgent re-cleaning, rehousing or compensation of the next guests) are added, upon proof.
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      Example for a 10:00 check-out: leaving at 10:10 = no penalty; at 10:15 = 1 period; at 11:00 = 5 periods. A late check-out requested in advance costs €25 until 12:00 or €45 until 14:00, subject to availability; staying without agreement costs up to the price of one night. {{^is_booking_platform}}The amount is {{^is_none_guarantee}}charged to the bank card registered as a guarantee{{/is_none_guarantee}}{{#is_none_guarantee}}invoiced to the tenant{{/is_none_guarantee}}, after written notice stating the observed departure time and the calculation, under the conditions of article 11.{{/is_booking_platform}}{{#is_booking_platform}}For a booking made through a platform (Airbnb, Booking.com…), the amount is claimed through that platform, according to its rules.{{/is_booking_platform}}
    </p>
  </div>
  <p style="font-size:9pt;color:#8C7B65;margin-top:8px;font-family:Arial,sans-serif;">
    Key handover is carried out according to the arrangements communicated by the agency (secure key safe or on-site reception). The tenant undertakes to return the property clean and in the same condition as found, by the time stipulated above.
  </p>
</div>

<!-- ══ 4. FINANCIAL TERMS ════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">4</span>
    Financial Terms
  </div>
  <table class="financial-table">
    <thead>
      <tr>
        <th>Description</th>
        <th style="text-align:right">Amount</th>
        <th>Payment method</th>
      </tr>
    </thead>
    <tbody>
      <!-- Total -->
      <tr>
        <td>Total to pay{{#has_taxes_total}}<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">of which {{taxes_total_eur}} in taxes</span>{{/has_taxes_total}}</td>
        <td class="amount">{{prix_total_eur}}</td>
        <td style="font-size:9pt">{{modalite_loyer_affiche}}</td>
      </tr>{{#has_options}}<tr><td>including selected options<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">{{options_detail}}</span></td><td class="amount">{{options_total_eur}}</td><td style="font-size:9pt"></td></tr>{{/has_options}}{{#has_promo}}<tr><td>{{promo_libelle}}</td><td class="amount">{{promo_montant_eur}}</td><td style="font-size:9pt">{{promo_note}}</td></tr>{{/has_promo}}{{#has_demandes}}<tr><td>Guest requests<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">{{demandes_detail}}</span></td><td class="amount"></td><td style="font-size:9pt">No extra charge, no commitment</td></tr>{{/has_demandes}}
      <!-- Deposit — card (stripe_dcb_contract or cb_50_cash) -->
      {{#is_cb}}
      <tr>
        <td>Deposit ({{acompte_pourcentage}}%)</td>
        <td class="amount">{{acompte_montant_eur}}</td>
        <td style="font-size:9pt">{{#is_prepaye}}{{paye_le_texte}}{{/is_prepaye}}{{^is_prepaye}}Charged to the bank card registered at signing{{/is_prepaye}}</td>
      </tr>
      {{/is_cb}}
      <!-- Deposit — bank transfer -->
      {{#is_bank_transfer}}
      <tr>
        <td>Deposit ({{acompte_pourcentage}}%)</td>
        <td class="amount">{{acompte_montant_eur}}</td>
        <td style="font-size:9pt">Bank transfer at signing (see bank details below)</td>
      </tr>
      {{/is_bank_transfer}}
      <!-- Balance — automatic card (stripe_dcb_contract) -->
      {{#has_solde_stripe}}
      <tr>
        <td>Balance ({{solde_pourcentage}}%) — due on {{date_solde}}</td>
        <td class="amount">{{solde_montant_eur}}</td>
        <td style="font-size:9pt">{{modalite_solde_affiche}} ({{date_solde_motif}})</td>
      </tr>
      {{/has_solde_stripe}}
      <!-- Balance — bank transfer -->
      {{#has_solde_virement}}
      <tr>
        <td>Balance ({{solde_pourcentage}}%) — due on {{date_solde}}</td>
        <td class="amount">{{solde_montant_eur}}</td>
        <td style="font-size:9pt">Bank transfer before due date</td>
      </tr>
      {{/has_solde_virement}}
      <!-- Balance — cash (cb_50_cash) -->
      {{#has_solde_cash}}
      <tr>
        <td>Balance ({{solde_pourcentage}}%) — payable in cash on arrival, {{date_arrivee_longue}}</td>
        <td class="amount">{{solde_montant_eur}}</td>
        <td style="font-size:9pt">Cash handed over at check-in</td>
      </tr>
      {{/has_solde_cash}}
      <!-- Tourist tax -->
      {{#has_taxe_sejour}}
      <tr>
        <td>Tourist tax</td>
        <td class="amount">{{taxe_sejour_eur}}</td>
        <td style="font-size:9pt">Collected and remitted to the local authority</td>
      </tr>
      {{/has_taxe_sejour}}
    </tbody>
  </table>
  <!-- Contextual notices by payment mode -->
  {{#is_stripe_contract}}{{^is_cb_50_cash}}
  <div class="notice" style="margin-top:12px">
    ⚠️ {{^is_prepaye}}Payments are automatically charged to the bank card registered at signing.{{/is_prepaye}}{{#is_prepaye}}The deposit was paid online ({{paye_le_texte_min}}); the balance is automatically charged on {{date_solde}} to the same card.{{/is_prepaye}} In case of failure, the tenant will be contacted to settle the payment.
  </div>
  {{/is_cb_50_cash}}{{/is_stripe_contract}}
  {{#is_bank_transfer}}
  <div class="notice" style="margin-top:12px">
    ⚠️ Any late wire transfer may result in contract termination under the conditions of Article 8.
  </div>
  {{/is_bank_transfer}}
  {{#is_cb_50_cash}}
  <div class="notice" style="margin-top:12px">
    ⚠️ {{#is_cb}}The deposit is charged to the card at signing.{{/is_cb}}{{#is_bank_transfer}}The deposit is paid by bank transfer at signing.{{/is_bank_transfer}} The balance of {{solde_montant_eur}} is payable in cash, handed to the agency or its representative upon check-in on {{date_arrivee_longue}}; it is not charged to the card.
  </div>
  {{/is_cb_50_cash}}
  <!-- Bank details / escrow (bank transfer only) -->
  {{#has_rib}}
  <div class="notice" style="margin-top:10px;background:#EFF6FF;border-color:#93C5FD;color:#1E3A5F;page-break-inside:avoid;break-inside:avoid;">
    <strong>📄 Bank Details — Escrow Transfer</strong><br>
    Account holder: <strong>{{rib_titulaire}}</strong><br>
    IBAN: <strong>{{rib_iban}}</strong><br>
    BIC: {{rib_bic}} &nbsp;·&nbsp; Bank: {{rib_banque}}<br><em style="font-size:8.5pt;color:#5C7FB0">Payment reference: <strong>{{virement_reference}}</strong></em>
  </div>
  {{/has_rib}}
{{#is_booking_platform}}
  <div class="notice" style="margin-top:10px;background:#EEF6FF;border-color:#93C5FD;color:#1E3A5F;">
    ℹ️ <strong>Payment managed by Booking.com</strong><br>
    The payment for this stay is managed by Booking.com in accordance with the conditions accepted at the time of booking.<br>
    <em style="font-size:8.5pt;color:#5C7FB0;">This contract supplements the stay conditions: identity, occupancy, house rules, check-in/check-out inspection, security deposit and any additional charges.</em>
  </div>
{{/is_booking_platform}}
</div>

<!-- ══ 5. SECURITY GUARANTEE ════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">5</span>
    Security Guarantee
  </div>
  {{#is_stripe_card_on_file}}
  <div class="garantie-box">
    <span class="garantie-icon">🔐</span>
    <strong>Card registered as a guarantee</strong><br><br>
    {{garantie_clause}}
  </div>
  <p style="font-size:8.5pt;color:#8C7B65;font-family:Arial,sans-serif;margin-top:8px;">
    The bank card is securely registered via Stripe (PCI-DSS Level 1). No card number is stored by Lauïan Immobilier.
  </p>
  {{/is_stripe_card_on_file}}
  {{#is_none_guarantee}}
  <p style="font-size:9.5pt;font-family:Arial,sans-serif;color:#555;margin:0;">
    No additional bank guarantee is required for this stay. The tenant remains liable for any damage observed at the final property inspection, in accordance with Article 9.
  </p>
  {{/is_none_guarantee}}
</div>

<!-- ══ 6. TENANT'S OBLIGATIONS ══════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">6</span>
    Tenant's Obligations
  </div>
  <div class="clause">
    <p>The tenant undertakes to:</p>
    <ul>
      <li>Occupy the premises personally, peacefully, as a responsible tenant, and in accordance with their temporary seasonal residential purpose.</li>
      <li>Not sublet or assign this agreement, partially or in full, without prior written consent from the landlord.</li>
      <li>Strictly respect the maximum number of authorised occupants ({{bien_capacite_max_label}}). Any additional occupation is strictly prohibited without written authorisation.</li>
      <li>Not bring animals onto the premises unless explicitly authorised in writing by the agency.</li>
      <li>Respect neighbourhood rules, particularly quiet hours between 10:00 PM and 8:00 AM.</li>
      <li>Not conduct any commercial or professional activity on the premises.</li>
      <li>Immediately report any damage or breakdown to the agency.</li>
      <li>Vacate the property by the check-out time of the stay (article 3): any unauthorised late check-out is charged as set out in article 3; a late check-out may be requested in advance.</li>
      <li>Return the property in its initial inventory condition: clean dishes, cleaned appliances, waste removed, bed linen stripped.</li>
      <li>Not smoke inside the property.</li>
      {{#a_piscine}}<li>Comply with pool safety rules: never leave minors unsupervised, do not use the pool between 11:00 PM and 7:00 AM.</li>{{/a_piscine}}
    </ul>
  </div>
</div>

<!-- ══ 7. HOLIDAY INSURANCE ═════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">7</span>
    Holiday Insurance
  </div>
  <div class="clause">
    <p>
      The <strong>holiday liability insurance</strong> covers damage that may be caused to the accommodation, its contents and to third parties (fire, water damage, theft, breakage) during the stay. The tenant indicates below their situation regarding this coverage:
    </p>
    <div style="margin:14px 0;display:flex;flex-direction:column;gap:6px;font-size:10pt">
{{#is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_platform}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Checked box (option selected)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_platform}}{{^assurance_choice_platform}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Unchecked box" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_platform}}</span>
        <span>Holiday coverage included via the booking platform ({{assurance_platform_name}})</span>
      </div>
{{/is_booking_platform}}
{{^is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_mrh}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Checked box (option selected)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_mrh}}{{^assurance_choice_mrh}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Unchecked box" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_mrh}}</span>
        <span>I hold a holiday liability insurance covering the period of the stay and can provide a certificate upon request.</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_no_insurance}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Checked box (option selected)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_no_insurance}}{{^assurance_choice_no_insurance}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Unchecked box" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_no_insurance}}</span>
        <span>I declare that I do not hold any holiday liability insurance covering damage that may be caused to the rented accommodation during my stay. I have been informed that I may be held personally liable for any material damage caused to the accommodation, its furnishings or to third parties during the rental period, and I agree to proceed with the booking without such coverage.</span>
      </div>
{{/is_booking_platform}}
    </div>
    <p style="font-weight:700">
      The absence of holiday insurance does not in any way release the tenant from liability for any damage caused to the accommodation or its contents.
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      Note: the agency's insurance covers only the professional civil liability of {{agence_nom}} (insurance {{agence_assurance_affiche}}). It does not substitute the tenant's personal insurance.
    </p>
  </div>
</div>

<!-- ══ 8. CANCELLATION AND TERMINATION CONDITIONS ════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">8</span>
    Cancellation and Termination Conditions
  </div>
  <div class="clause">
    <p>Any cancellation must be notified in writing (e-mail to {{agence_email_contact}}):</p>
{{clause_annulation}}
    <p>
      In the event of termination by the landlord or agency for reasons beyond the tenant's control, all payments made will be fully refunded within 15 days.
    </p>
  </div>
</div>

<!-- ══ 9. PERSONAL DATA PROTECTION (GDPR) ════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">9</span>
    Personal Data Protection (GDPR)
  </div>
  <div class="clause">
    <div class="clause-title">9.1 Data Controller</div>
    <p>
      {{agence_nom}}, {{agence_adresse}} (the "Data Controller"), processes your personal data in the context of managing your reservation and the contractual relationship.
    </p>
    <div class="clause-title" style="margin-top:10px">9.2 Data Collected and Purposes</div>
    <p>The data collected (surname, first name, address, e-mail, phone number, payment data) is processed for:</p>
    <ul>
      <li>The management and execution of this rental agreement;</li>
      <li>The management of payments and the security guarantee;</li>
      <li>Compliance with legal obligations (tourist tax declaration, fiscal obligations);</li>
      <li>Identity verification for the security of the property.</li>
    </ul>
    <div class="clause-title" style="margin-top:10px">9.3 Retention Period</div>
    <p>
      Contract data is retained for <strong>5 years</strong> from the end of the stay (accounting obligations). The identity documents (verification photo and identity document) are kept for <strong>1 year</strong> from the end of the stay, then permanently deleted. Bank card data is managed exclusively by Stripe — no full card number is stored by {{agence_nom}}.
    </p>
    <div class="clause-title" style="margin-top:10px">9.4 Tenant's Rights</div>
    <p>
      In accordance with the GDPR (EU Regulation 2016/679) and French Data Protection Law, you have the right of access, rectification, deletion and portability of your data, as well as the right to object to processing. To exercise these rights: {{agence_email_contact}}.
    </p>
    <div class="clause-title" style="margin-top:10px">9.5 Third-Party Transfers</div>
    <p>
      Your data is shared, strictly to the extent necessary, with: Stripe Inc. (payment, United States — adequacy decision EU-US Data Privacy Framework), Twilio Inc. (SMS verification), and services hosted on Supabase (Cloud infrastructure, EU). No data is sold to third parties.
    </p>
    <div class="clause-title" style="margin-top:10px">9.6 Document security and identity verification</div>
    <p>
      The verification photo taken at signature undergoes an automated check whose sole purpose is to verify that a face is visible and usable (photo not blank, not blurred, not taken of a screen). This check does not aim to identify the person: it involves no facial recognition, no comparison with the identity document and no processing of biometric data. It is based on the legitimate interest of {{agence_nom}} in preventing fraud and securing access to the property, and cannot on its own prevent signature: after two further attempts, the photo is accepted. It is performed by our processor Anthropic PBC (United States) under the standard contractual clauses adopted by the European Commission; Anthropic does not use this data to train its models and deletes it within 30 days, unless longer retention is required by law or to enforce its usage policies. The identity document is never sent to it. The verification photo and the identity document are marked upon receipt with the watermark “document destiné uniquement à la location saisonnière” (document intended solely for the seasonal rental) and are never stored without it. The signed contract is electronically sealed by {{agence_nom}}: any later modification of the document can be detected.
    </p>
  </div>
</div>

<!-- ══ 10. PROPERTY INSPECTION ══════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">10</span>
    Property Inspection
  </div>
  <div class="clause">
    <div class="clause-title">10.1 Check-in Inspection</div>
    <p>
      A joint inspection is carried out upon the tenant's arrival, in the presence of an agency representative or by equivalent means (digital form, dated photos). The tenant has <strong>24 hours</strong> from key handover to report any damage or reservation not mentioned in the initial inspection, in writing to {{agence_email_contact}}.
    </p>
    <div class="clause-title" style="margin-top:10px">10.2 Check-out Inspection</div>
    <p>
      At the end of the stay, a joint check-out inspection is conducted according to the same procedures. The property must be returned in the condition noted at check-in, cleaned, and in accordance with the attached inventory. Any damage noted at check-out that was not recorded at check-in will be charged to the tenant.
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      In the absence of the tenant at the check-out inspection, the inspection will be conducted unilaterally by the agency and notified to the tenant within 48 hours by e-mail. The tenant may submit observations within 5 days of the notification.
    </p>
  </div>
</div>

<!-- ══ 11. DEDUCTIONS AND RESTORATION COSTS ════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">11</span>
    Deductions and Restoration Costs
  </div>
  <div class="clause">
    <p>
      In the event of damage observed at the check-out inspection, breach of the tenant's obligations, or additional costs incurred, the agency may charge the bank card registered as a security guarantee (Article 5), after justification and written notification to the tenant, for the following reasons:
    </p>
    <ul>
      <li><strong>Property left in heavily soiled condition:</strong> billing of actual cleaning costs (minimum €80).</li>
      <li><strong>Sheets or towels heavily stained beyond normal use:</strong> additional laundering or replacement fee (minimum €30 per set).</li>
      <li><strong>Broken, damaged or missing items:</strong> replacement or repair at actual justified cost.</li>
      <li><strong>Large or excessive amounts of waste not removed:</strong> removal fee (minimum €50).</li>
      <li><strong>Keys not returned:</strong> lock or key safe replacement (actual cost).</li>
      <li><strong>Unauthorised occupation (animals, overcrowding):</strong> fixed penalty of €100 plus 5% of the total stay amount, without prejudice to other damages.</li>
      <li><strong>Unauthorised late check-out:</strong> penalty of 10% of the price of one night per 10-minute period started after a 10-minute grace period, capped at the price of one night, plus justified actual costs (article 3).</li>
    </ul>
    <p style="font-size:9pt;color:#8C7B65;margin-top:8px;">
      Any charge will be preceded by a notification email detailing the reasons and amounts. The tenant has 7 days to contest in writing. In the absence of a written contest within this period, the charge is deemed accepted.
    </p>
  </div>
</div>

<!-- ══ 12. EMERGENCY REPAIRS — ACCESS TO THE PROPERTY ════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">12</span>
    Emergency Repairs — Access to the Property
  </div>
  <div class="clause">
    <p>
      The tenant is required to immediately notify the agency of any breakdown or damage observed. The tenant expressly authorises the agency or its contractors to access the property for any urgent work necessary to preserve it (water leak, heating failure, electrical issue, etc.), even in the tenant's absence, after prior notification.
    </p>
    <p>
      Such urgent interventions do not entitle the tenant to any reduction in rent, unless they deprive the tenant of the use of a substantial part of the property for more than 48 consecutive hours. In that case, a proportional reduction will be calculated by mutual agreement.
    </p>
  </div>
</div>

<!-- ══ 13. FORCE MAJEURE ════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">13</span>
    Force Majeure
  </div>
  <div class="clause">
    <p>
      Neither the landlord nor the agency shall be held liable for non-performance or delay in performance of their obligations in the event of force majeure within the meaning of Article 1218 of the French Civil Code (natural disaster, fire, flood, administrative decision, pandemic with closure imposed by authorities, etc.).
    </p>
    <p>
      In the event of force majeure rendering the property uninhabitable or inaccessible, all amounts paid by the tenant will be fully refunded within 15 days, to the exclusion of any other compensation. Tenants are advised to take out cancellation insurance to cover cases not covered by statutory force majeure.
    </p>
  </div>
</div>

<!-- ══ 14. APPLICABLE LAW AND JURISDICTION ══════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">14</span>
    Applicable Law, Mediation and Jurisdiction
  </div>
  <div class="clause">
    <p>
      This agreement is governed by French law. In the event of a dispute, the parties agree to attempt an amicable resolution before taking legal action.
    </p>
    <p>
      In accordance with Articles L612-1 et seq. of the French Consumer Code, if a dispute remains unresolved after a prior written complaint to the agency, the tenant may refer it, free of charge, to the following consumer mediator: Centre de la Médiation de la Consommation de Conciliateurs de Justice (CM2C), 49 rue de Ponthieu, 75008 Paris, France – www.cm2c.net (online application) – +33 1 89 47 00 14. The mediator must be contacted within one year of the written complaint sent to the agency.
    </p>
    <p>
      Failing amicable agreement, the Judicial Court of Bayonne shall have sole jurisdiction, unless a mandatory provision to the contrary applies to the consumer tenant.
    </p>
  </div>
</div>

<!-- ══ SIGNATURES ════════════════════════════════════════════════════ -->
<div class="section avoid-break">
  <div class="section-title">
    <span class="section-title-num" style="background:linear-gradient(135deg,#2C2416,#4A3820)">✍</span>
    Signatures of the Parties
  </div>
  <div style="background:#FDFAF5;border:1px solid #E8DCC8;border-left:3px solid #CC9933;border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:9pt;color:#4A3F32;font-family:'Helvetica Neue',Arial,sans-serif;line-height:1.7">
    The tenant acknowledges having read the entire agreement (including the descriptive annex), having had the opportunity to ask any questions, and accepts without reservation the terms and conditions defined above. The electronic signature affixed below has the same legal value as a handwritten signature (EU Regulation No 910/2014 eIDAS, and French law of 13 March 2000, Art. 1366 and 1367 of the Civil Code).
  </div>
  <div class="signature-grid">
    <div class="signature-block">
      <div class="signature-label">For the landlord / agent</div>
      <div class="signature-name">{{agence_nom}}</div>
      <div class="signature-note">Represented by {{agence_representant_affiche}}, {{agence_qualite_representant}}<br>{{agence_email_representant}}</div>
      <div style="margin-top:10px;text-align:center">
        <div style="font-size:8pt;color:#8C7B65;margin-bottom:4px">Electronically signed</div>
        <div style="font-family:'Northwell',cursive;font-size:20pt;color:#CC9933;line-height:1;padding:4px 0">Oihan Campandegui</div>
        <div style="font-size:7.5pt;color:#A09282;margin-top:2px">President — Lauïan Immobilier</div>
      </div>
    </div>
    <div class="signature-block">
      <div class="signature-label">Tenant — electronic signature</div>
      <div class="signature-name">{{guest_civilite_affiche}} {{guest_nom_affiche}}</div>
      <div class="signature-note">Signature affixed via the secure portal contrat.destinationcotebasque.com</div>
      <div class="signature-line"></div>
    </div>
  </div>
</div>

<!-- ══ ANNEX — PROPERTY DESCRIPTION ════════════════════════════════ -->
<div class="page-break"></div>
<div class="header" style="margin-bottom:0;padding:20px 0 16px">
  <div class="header-left">
    <div class="logo-square" style="width:38px;height:38px;font-size:18px">L</div>
    <div class="header-brand">
      <div class="name" style="font-size:11pt">Lauïan Immobilier</div>
      <div class="sub">Annex to the Seasonal Rental Agreement</div>
    </div>
  </div>
  <div class="header-right">{{date_contrat_longue}}</div>
</div>
<div class="doc-title-block" style="padding:18px 0 14px;margin-bottom:20px">
  <div class="doc-title" style="font-size:12pt;letter-spacing:2px">Property Description</div>
  <div class="gold-line"></div>
  <div class="doc-subtitle">{{bien_nom_public}}</div>
  <div class="doc-subtitle" style="margin-top:2px;font-size:8.5pt;">{{bien_adresse_complete}}</div>
</div>
<div class="section">
  <div class="section-title">
    <span class="section-title-num">A</span>
    General Characteristics
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:28%" class="annexe-label">Address</td>
      <td colspan="3">{{bien_adresse_complete}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Type / Category</td>
      <td>{{bien_nature_label}}</td>
      <td style="width:28%" class="annexe-label">Classification</td>
      <td>{{bien_classement_label}}</td>
    </tr>
    {{#has_surface_pieces}}
    <tr>
      <td class="annexe-label">{{bien_superficie_label}}</td>
      <td>{{#bien_superficie}}{{bien_superficie}} m²{{/bien_superficie}}</td>
      <td class="annexe-label">No. of main rooms</td>
      <td>{{bien_nb_pieces}}</td>
    </tr>
    {{/has_surface_pieces}}
    {{#has_construction_etage}}
    <tr>
      <td class="annexe-label">Year of construction</td>
      <td>{{bien_date_construction}}</td>
      <td class="annexe-label">Floor</td>
      <td>{{bien_etage}}</td>
    </tr>
    {{/has_construction_etage}}
    <tr>
      <td class="annexe-label">Maximum occupancy</td>
      <td>{{bien_capacite_max_label}} max.</td>
      {{#has_exposition}}
      <td class="annexe-label">Orientation</td>
      <td>{{bien_exposition}}</td>
      {{/has_exposition}}
      {{#has_no_exposition}}
      <td colspan="2"></td>
      {{/has_no_exposition}}
    </tr>
    {{#has_voisinage}}
    <tr>
      <td class="annexe-label">Environment / Surroundings</td>
      <td colspan="3">{{bien_voisinage}}</td>
    </tr>
    {{/has_voisinage}}
    {{#a_piscine}}
    <tr>
      <td class="annexe-label">Special amenities</td>
      <td colspan="3">Private swimming pool — reserved for occupants of the property</td>
    </tr>
    {{/a_piscine}}
  </table>

  {{#has_distances}}
  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">B</span>
    Distances and Location
  </div>
  <table class="annexe-table">
    <thead>
      <tr>
        <th>Reference point</th>
        <th>Approximate distance</th>
      </tr>
    </thead>
    <tbody>
      {{#bien_distance_mer}}
      <tr>
        <td>Sea / ocean</td>
        <td>{{bien_distance_mer}}</td>
      </tr>
      {{/bien_distance_mer}}
      {{#bien_distance_plage}}
      <tr>
        <td>Nearest beach</td>
        <td>{{bien_distance_plage}}</td>
      </tr>
      {{/bien_distance_plage}}
      {{#bien_distance_gare}}
      <tr>
        <td>Train station</td>
        <td>{{bien_distance_gare}}</td>
      </tr>
      {{/bien_distance_gare}}
      {{#bien_distance_centre}}
      <tr>
        <td>Town centre</td>
        <td>{{bien_distance_centre}}</td>
      </tr>
      {{/bien_distance_centre}}
    </tbody>
  </table>
  {{/has_distances}}

  {{#has_description_pieces}}
  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">C</span>
    Room Description
  </div>
  <table class="annexe-table">
    <thead>
      <tr>
        <th>Room</th>
        <th>Description &amp; amenities</th>
      </tr>
    </thead>
    <tbody>
      {{#has_desc_sejour}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Living room / Lounge</td>
        <td>{{bien_description_sejour}}</td>
      </tr>
      {{/has_desc_sejour}}
      {{#has_desc_cuisine}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Kitchen</td>
        <td>{{bien_cuisine}}</td>
      </tr>
      {{/has_desc_cuisine}}
      {{#has_desc_sdb}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Bathroom</td>
        <td>{{bien_sdb}}</td>
      </tr>
      {{/has_desc_sdb}}
      {{#has_desc_toilettes}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Toilet</td>
        <td>{{bien_toilettes}}</td>
      </tr>
      {{/has_desc_toilettes}}
      {{#has_desc_etat}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">General condition</td>
        <td>{{bien_etat_general}}</td>
      </tr>
      {{/has_desc_etat}}
    </tbody>
  </table>
  {{/has_description_pieces}}

  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">D</span>
    Access Hours (Check-in / Check-out)
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:50%" class="annexe-label">Check-in time</td>
      <td>From {{heure_arrivee}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Check-out time</td>
      <td>Before {{heure_depart}}</td>
    </tr>
  </table>
</div>

<!-- ══ FOOTER ═══════════════════════════════════════════════════════ -->
<div class="footer">
  {{agence_nom}} — {{agence_adresse}} — {{agence_email_contact}} — Tel. {{agence_telephone_affiche}}<br>
  Professional Card {{agence_cpi}} issued by {{agence_cpi_delivree_par}} — RCS {{agence_rcs}} — VAT {{agence_tva}}<br>
  Professional liability insurance: {{agence_assurance_affiche}} — Financial guarantee: {{agence_garantie_galian}}<br>
  <em>Document generated automatically on {{date_contrat_longue}} — Certified electronic signature</em>
</div>

</div><!-- /.page -->
</body>
</html>
$tpl469$, $v$[]$v$::jsonb, false
where not exists (select 1 from contract_templates where agence='lauian' and langue='en' and type_contrat='saisonnier' and version='2026-v6');

-- lauian saisonnier es : 2026-v5 → 2026-v6
insert into contract_templates (agence, langue, type_contrat, version, nom, contenu_html, variables_attendues, is_active)
select 'lauian', 'es', 'saisonnier', '2026-v6', $n$ES Alquiler 2026 — Lauïan Immobilier$n$, $tpl469$<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Contrato de arrendamiento estacional — Lauïan Immobilier</title>
<style>
/* ── Reset ── */
* { margin: 0; padding: 0; box-sizing: border-box; }
@font-face {
  font-family: 'Northwell';
  src: url('https://dcb-contrats.vercel.app/fonts/Northwell.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
}

/* ── Page PDF ── */
@page {
  size: A4;
  margin: 20mm 15mm 22mm;
  @bottom-right {
    content: "Page " counter(page) " / " counter(pages);
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 7.5pt;
    color: #A09282;
  }
  @bottom-left {
    content: "Lauïan Immobilier — Contrato de arrendamiento estacional";
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 7.5pt;
    color: #A09282;
  }
}

body {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 10.5pt;
  color: #1C1C1C;
  line-height: 1.65;
  background: #fff;
  counter-reset: page;
}

/* ── Mise en page ── */
.page { max-width: 800px; margin: 0 auto; padding: 0 20px; }

/* ── En-tête ── */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28px 0 20px;
  border-bottom: 0;
  margin-bottom: 0;
  position: relative;
}
.header::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #CC9933 0%, #E4A853 50%, #CC9933 100%);
  border-radius: 2px;
}
.header-left { display: flex; align-items: center; gap: 14px; }
.logo-square {
  width: 50px; height: 50px;
  background: linear-gradient(135deg, #D4A035 0%, #CC9933 60%, #B8872A 100%);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 24px; font-weight: 700;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(204,153,51,0.30);
}
.header-brand { font-family: 'Helvetica Neue', Arial, sans-serif; }
.header-brand .name { font-size: 14pt; font-weight: 700; color: #1C1C1C; letter-spacing: -0.3px; }
.header-brand .sub  { font-size: 8pt; color: #8C7B65; letter-spacing: 2px; text-transform: uppercase; margin-top: 1px; }
.header-right {
  text-align: right;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 8pt; color: #8C7B65; line-height: 1.8;
}

/* ── Titre principal ── */
.doc-title-block {
  text-align: center;
  padding: 28px 0 20px;
  border-bottom: 1px solid #EAE0D0;
  margin-bottom: 26px;
}
.doc-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 15pt;
  font-weight: 700;
  color: #1C1C1C;
  text-transform: uppercase;
  letter-spacing: 3px;
  margin-bottom: 8px;
}
.doc-subtitle {
  font-size: 9.5pt;
  color: #8C7B65;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-style: italic;
}
.gold-line {
  width: 48px; height: 2px;
  background: linear-gradient(90deg, #CC9933, #E4A853, #CC9933);
  margin: 12px auto;
  border-radius: 2px;
}

/* ── Sections ── */
.section {
  margin-bottom: 24px;
  page-break-inside: avoid;
}
.section-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 8.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: #CC9933;
  border-bottom: 1.5px solid #E8DCC8;
  padding-bottom: 6px;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 0;
}
.section-title-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #D4A035, #CC9933);
  color: #fff;
  border-radius: 50%;
  width: 22px; height: 22px;
  font-size: 9pt;
  font-weight: 700;
  margin-right: 10px;
  flex-shrink: 0;
  box-shadow: 0 1px 4px rgba(204,153,51,0.30);
}

/* ── Blocs parties ── */
.parties-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 4px;
}
.partie-box {
  background: #FDFAF5;
  border: 1px solid #E8DCC8;
  border-left: 3px solid #CC9933;
  border-radius: 6px;
  padding: 14px 16px;
}
.partie-label {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: #8C7B65;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #E8DCC8;
}
.partie-nom {
  font-size: 11pt;
  font-weight: 700;
  color: #1C1C1C;
  margin-bottom: 5px;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
.partie-detail {
  font-size: 9pt;
  color: #4A3F32;
  line-height: 1.75;
}

/* ── Tableau financier ── */
.financial-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9.5pt;
  margin-bottom: 4px;
  border-radius: 6px;
  overflow: hidden;
}
.financial-table th {
  background: #F0E8D8;
  color: #6B5840;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 8px 12px;
  text-align: left;
  border: 1px solid #E0D4C0;
}
.financial-table td {
  padding: 10px 12px;
  border: 1px solid #E8DCC8;
  vertical-align: top;
}
.financial-table tr:nth-child(even) td { background: #FDFAF5; }
.amount { font-weight: 700; color: #1C1C1C; text-align: right; }
.total-row td { background: #F0E8D8 !important; font-weight: 700; font-size: 10pt; }

/* ── Bloc garantie ── */
.garantie-box {
  background: #F0FBF4;
  border: 1px solid #86EFAC;
  border-left: 4px solid #15803D;
  border-radius: 6px;
  padding: 14px 16px;
  margin: 12px 0;
  font-size: 9.5pt;
  line-height: 1.7;
  color: #1C1C1C;
}
.garantie-box strong { color: #166534; }
.garantie-icon { font-size: 13pt; margin-right: 6px; vertical-align: middle; }

/* ── Clauses / Articles ── */
.clause {
  margin-bottom: 14px;
  page-break-inside: avoid;
}
.clause-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9.5pt;
  font-weight: 700;
  color: #2C2416;
  margin-bottom: 5px;
  letter-spacing: -0.1px;
}
.clause p {
  font-size: 9.5pt;
  color: #2C2416;
  margin-bottom: 6px;
  line-height: 1.65;
}
.clause ul, .clause ol {
  padding-left: 20px;
  margin: 6px 0;
}
.clause li {
  font-size: 9.5pt;
  color: #2C2416;
  margin-bottom: 4px;
  line-height: 1.65;
}

/* ── Tableau descriptif annexe ── */
.annexe-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9pt;
  margin-bottom: 12px;
}
.annexe-table th {
  background: #F0E8D8;
  color: #6B5840;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 7px 10px;
  border: 1px solid #E0D4C0;
  text-align: left;
}
.annexe-table td {
  padding: 8px 10px;
  border: 1px solid #E8DCC8;
  vertical-align: top;
}
.annexe-table tr:nth-child(even) td { background: #FDFAF5; }
.annexe-label { color: #8C7B65; font-size: 8pt; font-family: 'Helvetica Neue', Arial, sans-serif; }

/* ── Bloc signature ── */
.signature-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-top: 20px;
}
.signature-block {
  border: 1px solid #E8DCC8;
  border-radius: 8px;
  padding: 16px;
  min-height: 110px;
  background: #FDFAF5;
}
.signature-label {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #8C7B65;
  margin-bottom: 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid #E8DCC8;
}
.signature-name {
  font-weight: 700;
  font-size: 10pt;
  color: #1C1C1C;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
.signature-note { font-size: 7.5pt; color: #8C7B65; margin-top: 4px; line-height: 1.5; font-family: 'Helvetica Neue', Arial, sans-serif; }
.signature-line {
  border-bottom: 1.5px dashed #CC9933;
  height: 52px;
  margin-top: 14px;
  opacity: 0.5;
}

/* ── Pied de page ── */
.footer {
  margin-top: 32px;
  padding-top: 14px;
  border-top: 1px solid #E8DCC8;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  color: #A09282;
  line-height: 1.8;
  text-align: center;
}

/* ── Sauts de page ── */
.page-break { page-break-before: always; break-before: page; }
.avoid-break { page-break-inside: avoid; break-inside: avoid; }

/* ── Info notice ── */
.notice {
  background: #FFF8E6;
  border: 1px solid #FDE68A;
  border-left: 3px solid #D97706;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 9pt;
  color: #78350F;
  margin: 10px 0;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  img { max-width: 100% !important; }
}
</style>
</head>
<body>
<div class="page">

<!-- ══ CABECERA ══════════════════════════════════════════════════════ -->
<div class="header">
  <div class="header-left">
    <div class="logo-square">L</div>
    <div class="header-brand">
      <div class="name">Lauïan Immobilier</div>
      <div class="sub">Gestión de alquileres e inmobiliaria</div>
    </div>
  </div>
  <div class="header-right">
    {{agence_adresse}}<br>
    Tel. {{agence_telephone_affiche}}<br>
    {{agence_email_contact}}<br>
    RCS {{agence_rcs}}
  </div>
</div>

<!-- ══ TÍTULO ════════════════════════════════════════════════════════ -->
<div class="doc-title-block">
  <div class="doc-title">Contrato de Arrendamiento Estacional</div>
  <div class="gold-line"></div>
  <div class="doc-subtitle">Redactado en {{lieu_signature}}, el {{date_contrat_longue}}</div>
</div>

<!-- ══ 1. PARTES ═════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">1</span>
    Partes del contrato
  </div>
  <div class="parties-grid">
    <!-- Arrendador -->
    <div class="partie-box">
      <div class="partie-label">Arrendador (propietario)</div>
      <div class="partie-nom">{{bailleur_nom_affiche}}</div>
      <div class="partie-detail">
        {{bailleur_statut_affiche}}<br>
        {{bailleur_adresse_complete}}
      </div>
    </div>
    <!-- Agencia gestora -->
    <div class="partie-box">
      <div class="partie-label">Mandatario — Agencia de gestión</div>
      <div class="partie-nom">{{agence_nom}}</div>
      <div class="partie-detail">
        {{agence_adresse}}<br>
        Tel. {{agence_telephone_affiche}}<br>
        {{agence_email_contact}}<br>
        RCS {{agence_rcs}} — {{agence_cpi}}<br>
        expedida por {{agence_cpi_delivree_par}}<br>
        {{agence_forme}} con capital social de {{agence_capital}} €<br>
        IVA: {{agence_tva}}<br>
        Representado por {{agence_representant_affiche}}, {{agence_qualite_representant}}
      </div>
    </div>
  </div>
  <!-- Arrendatario — ancho completo -->
  <div class="partie-box" style="margin-top:14px">
    <div class="partie-label">Arrendatario</div>
    <div class="partie-nom">{{guest_civilite_affiche}} {{guest_nom_affiche}}</div>
    <div class="partie-detail">
      Dirección: {{guest_adresse_affichee}}<br>
      Correo electrónico: {{guest_email}}&nbsp;&nbsp;·&nbsp;&nbsp;Teléfono: {{guest_telephone_affiche}}<br>
      Número de personas previstas: <strong>{{guest_nb_personnes}}</strong>{{guest_detail_personnes}}
    </div>
  </div>
</div>

<!-- ══ 2. DESCRIPCIÓN DEL INMUEBLE ═══════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">2</span>
    Descripción del inmueble arrendado
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:35%" class="annexe-label">Naturaleza del inmueble</td>
      <td>{{bien_nature_label}}</td>
      <td style="width:30%" class="annexe-label">Clasificación</td>
      <td>{{bien_classement_label}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Dirección completa</td>
      <td colspan="3">{{bien_adresse_complete}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Propietario</td>
      <td>{{bailleur_nom_affiche}}</td>
      <td class="annexe-label">Capacidad máxima</td>
      <td>{{bien_capacite_max_label}}</td>
    </tr>
    {{#has_surface_pieces}}
    <tr>
      <td class="annexe-label">{{bien_superficie_label}}</td>
      <td>{{#bien_superficie}}{{bien_superficie}} m²{{/bien_superficie}}</td>
      <td class="annexe-label">Número de habitaciones</td>
      <td>{{#bien_nb_pieces}}{{bien_nb_pieces_label}}{{/bien_nb_pieces}}</td>
    </tr>
    {{/has_surface_pieces}}
    {{#has_construction_etage}}
    <tr>
      <td class="annexe-label">Año de construcción</td>
      <td>{{bien_date_construction}}</td>
      <td class="annexe-label">Planta</td>
      <td>{{bien_etage}}</td>
    </tr>
    {{/has_construction_etage}}
    {{#a_piscine}}
    <tr>
      <td class="annexe-label">Equipamientos especiales</td>
      <td colspan="3">🏊 Piscina privada incluida en el arrendamiento</td>
    </tr>
    {{/a_piscine}}
  </table>
</div>

<!-- ══ 3. PERÍODO DE ARRENDAMIENTO ══════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">3</span>
    Período de arrendamiento
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:30%" class="annexe-label">Llegada</td>
      <td><strong>{{date_arrivee_longue}}</strong> a partir de {{heure_arrivee}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Salida</td>
      <td><strong>{{date_depart_longue}}</strong> antes de {{heure_depart}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Duración de la estancia</td>
      <td><strong>{{nb_nuits_label}}</strong></td>
    </tr>
  </table>
  <div class="clause" style="margin-top:12px">
    <div class="clause-title">Hora de salida — salida tardía no autorizada</div>
    <p>
      El alojamiento debe quedar libre, y las llaves devueltas según las instrucciones, a más tardar a la hora de salida indicada arriba o, en su caso, a la hora de salida tardía pagada con antelación. Se concede una tolerancia de <strong>10 minutos</strong>. Pasado ese plazo, el arrendatario que permanezca en el alojamiento sin acuerdo escrito de la agencia adeudará, en concepto de cláusula penal (artículo 1231-5 del Código Civil francés), <strong>un 10 % del precio medio de una noche de alojamiento</strong> de la estancia (sin gastos ni impuestos) <strong>por cada tramo de 10 minutos iniciado</strong> tras la tolerancia{{#has_penalite_montant}}, es decir, <strong>{{penalite_tranche_eur}} por tramo</strong> para esta estancia{{/has_penalite_montant}}, con un máximo del <strong>precio de una noche</strong>{{#has_penalite_montant}} ({{penalite_plafond_eur}}){{/has_penalite_montant}}. Se añaden, previa justificación, los gastos reales ocasionados por el retraso (limpieza urgente, realojamiento o compensación de los siguientes huéspedes).
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      Ejemplo para una salida prevista a las 10:00: salir a las 10:10 = sin penalización; a las 10:15 = 1 tramo; a las 11:00 = 5 tramos. Una salida tardía solicitada con antelación cuesta 25 € hasta las 12:00 o 45 € hasta las 14:00, según disponibilidad; quedarse sin acuerdo cuesta hasta el precio de una noche. {{^is_booking_platform}}El importe se {{^is_none_guarantee}}carga en la tarjeta bancaria registrada como garantía{{/is_none_guarantee}}{{#is_none_guarantee}}factura al arrendatario{{/is_none_guarantee}}, previa notificación escrita que indique la hora de salida constatada y el cálculo, en las condiciones del artículo 11.{{/is_booking_platform}}{{#is_booking_platform}}Para una reserva realizada a través de una plataforma (Airbnb, Booking.com…), el importe se reclama a través de dicha plataforma, según sus normas.{{/is_booking_platform}}
    </p>
  </div>
  <p style="font-size:9pt;color:#8C7B65;margin-top:8px;font-family:Arial,sans-serif;">
    La entrega de llaves se realiza según las modalidades comunicadas por la agencia (caja de seguridad o recepción in situ). El arrendatario se compromete a devolver el inmueble limpio y en el estado en que lo encontró, a la hora indicada anteriormente.
  </p>
</div>

<!-- ══ 4. CONDICIONES FINANCIERAS ═══════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">4</span>
    Condiciones financieras
  </div>
  <table class="financial-table">
    <thead>
      <tr>
        <th>Descripción</th>
        <th style="text-align:right">Importe</th>
        <th>Modalidad de pago</th>
      </tr>
    </thead>
    <tbody>
      <!-- Alquiler total -->
      <tr>
        <td>Total a pagar{{#has_taxes_total}}<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">de los cuales {{taxes_total_eur}} en impuestos</span>{{/has_taxes_total}}</td>
        <td class="amount">{{prix_total_eur}}</td>
        <td style="font-size:9pt">{{modalite_loyer_affiche}}</td>
      </tr>{{#has_options}}<tr><td>de los cuales opciones elegidas<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">{{options_detail}}</span></td><td class="amount">{{options_total_eur}}</td><td style="font-size:9pt"></td></tr>{{/has_options}}{{#has_promo}}<tr><td>{{promo_libelle}}</td><td class="amount">{{promo_montant_eur}}</td><td style="font-size:9pt">{{promo_note}}</td></tr>{{/has_promo}}{{#has_demandes}}<tr><td>Solicitudes del viajero<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">{{demandes_detail}}</span></td><td class="amount"></td><td style="font-size:9pt">Sin suplemento ni compromiso</td></tr>{{/has_demandes}}
      <!-- Depósito CB (stripe_dcb_contract o cb_50_cash) -->
      {{#is_cb}}
      <tr>
        <td>Depósito ({{acompte_pourcentage}}%)</td>
        <td class="amount">{{acompte_montant_eur}}</td>
        <td style="font-size:9pt">{{#is_prepaye}}{{paye_le_texte}}{{/is_prepaye}}{{^is_prepaye}}Cargo en tarjeta bancaria registrada en la firma{{/is_prepaye}}</td>
      </tr>
      {{/is_cb}}
      <!-- Depósito transferencia -->
      {{#is_bank_transfer}}
      <tr>
        <td>Depósito ({{acompte_pourcentage}}%)</td>
        <td class="amount">{{acompte_montant_eur}}</td>
        <td style="font-size:9pt">Transferencia bancaria en la firma (ver datos bancarios a continuación)</td>
      </tr>
      {{/is_bank_transfer}}
      <!-- Saldo CB automático (stripe_dcb_contract puro) -->
      {{#has_solde_stripe}}
      <tr>
        <td>Saldo ({{solde_pourcentage}}%) — vencimiento {{date_solde}}</td>
        <td class="amount">{{solde_montant_eur}}</td>
        <td style="font-size:9pt">{{modalite_solde_affiche}} ({{date_solde_motif}})</td>
      </tr>
      {{/has_solde_stripe}}
      <!-- Saldo transferencia -->
      {{#has_solde_virement}}
      <tr>
        <td>Saldo ({{solde_pourcentage}}%) — vencimiento {{date_solde}}</td>
        <td class="amount">{{solde_montant_eur}}</td>
        <td style="font-size:9pt">Transferencia bancaria antes del vencimiento</td>
      </tr>
      {{/has_solde_virement}}
      <!-- Saldo efectivo (cb_50_cash) -->
      {{#has_solde_cash}}
      <tr>
        <td>Saldo ({{solde_pourcentage}}%) — pagadero en efectivo a la llegada, {{date_arrivee_longue}}</td>
        <td class="amount">{{solde_montant_eur}}</td>
        <td style="font-size:9pt">Efectivo entregado al entrar en el inmueble</td>
      </tr>
      {{/has_solde_cash}}
      <!-- Tasa turística -->
      {{#has_taxe_sejour}}
      <tr>
        <td>Tasa turística</td>
        <td class="amount">{{taxe_sejour_eur}}</td>
        <td style="font-size:9pt">Recaudada y transferida al municipio</td>
      </tr>
      {{/has_taxe_sejour}}
    </tbody>
  </table>
  <!-- Avisos contextuales según modalidad -->
  {{#is_stripe_contract}}{{^is_cb_50_cash}}
  <div class="notice" style="margin-top:12px">
    ⚠️ {{^is_prepaye}}Los cargos se realizan automáticamente en la tarjeta bancaria registrada en la firma.{{/is_prepaye}}{{#is_prepaye}}El depósito se pagó en línea ({{paye_le_texte_min}}); el saldo se carga automáticamente el {{date_solde}} en la misma tarjeta.{{/is_prepaye}} En caso de fallo, se contactará al arrendatario para regularizar.
  </div>
  {{/is_cb_50_cash}}{{/is_stripe_contract}}
  {{#is_bank_transfer}}
  <div class="notice" style="margin-top:12px">
    ⚠️ Cualquier retraso en la transferencia podrá dar lugar a la rescisión del contrato según las condiciones del artículo 8.
  </div>
  {{/is_bank_transfer}}
  {{#is_cb_50_cash}}
  <div class="notice" style="margin-top:12px">
    ⚠️ {{#is_cb}}El depósito se carga en tarjeta en la firma.{{/is_cb}}{{#is_bank_transfer}}El depósito se paga por transferencia bancaria en la firma.{{/is_bank_transfer}} El saldo de {{solde_montant_eur}} se paga en efectivo, entregado a la agencia o a su representante al entrar en el inmueble el {{date_arrivee_longue}}; no se carga en la tarjeta.
  </div>
  {{/is_cb_50_cash}}
  <!-- Datos bancarios (solo transferencia) -->
  {{#has_rib}}
  <div class="notice" style="margin-top:10px;background:#EFF6FF;border-color:#93C5FD;color:#1E3A5F;page-break-inside:avoid;break-inside:avoid;">
    <strong>📄 Datos bancarios — Transferencia en depósito</strong><br>
    Titular: <strong>{{rib_titulaire}}</strong><br>
    IBAN: <strong>{{rib_iban}}</strong><br>
    BIC: {{rib_bic}} &nbsp;·&nbsp; Banco: {{rib_banque}}<br><em style="font-size:8.5pt;color:#5C7FB0">Referencia transferencia: <strong>{{virement_reference}}</strong></em>
  </div>
  {{/has_rib}}
{{#is_booking_platform}}
  <div class="notice" style="margin-top:10px;background:#EEF6FF;border-color:#93C5FD;color:#1E3A5F;">
    ℹ️ <strong>Pago gestionado por Booking.com</strong><br>
    El pago de la estancia es gestionado por Booking.com de acuerdo con las condiciones aceptadas en el momento de la reserva.<br>
    <em style="font-size:8.5pt;color:#5C7FB0;">El presente contrato complementa las condiciones de la estancia: identidad, ocupación, reglamento interno, inspección de entrada/salida, depósito de garantía y gastos adicionales.</em>
  </div>
{{/is_booking_platform}}
</div>

<!-- ══ 5. GARANTÍA BANCARIA ══════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">5</span>
    Garantía bancaria
  </div>
  {{#is_stripe_card_on_file}}
  <div class="garantie-box">
    <span class="garantie-icon">🔐</span>
    <strong>Tarjeta registrada como garantía</strong><br><br>
    {{garantie_clause}}
  </div>
  <p style="font-size:8.5pt;color:#8C7B65;font-family:Arial,sans-serif;margin-top:8px;">
    La tarjeta bancaria se registra de forma segura mediante Stripe (PCI-DSS nivel 1). Ningún número de tarjeta es almacenado por Lauïan Immobilier.
  </p>
  {{/is_stripe_card_on_file}}
  {{#is_none_guarantee}}
  <p style="font-size:9.5pt;font-family:Arial,sans-serif;color:#555;margin:0;">
    No se requiere garantía bancaria adicional para esta estancia. El arrendatario sigue siendo responsable de cualquier daño constatado en el inventario de salida, de conformidad con el artículo 9.
  </p>
  {{/is_none_guarantee}}
</div>

<!-- ══ 6. OBLIGACIONES DEL ARRENDATARIO ═════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">6</span>
    Obligaciones del arrendatario
  </div>
  <div class="clause">
    <p>El arrendatario se compromete a:</p>
    <ul>
      <li>Ocupar el inmueble personalmente, de forma pacífica, como buen padre de familia, y conforme a su destino de alojamiento estacional temporal.</li>
      <li>No subarrendar ni ceder el presente contrato, parcial o totalmente, sin el consentimiento previo por escrito del arrendador.</li>
      <li>Respetar estrictamente el número máximo de personas autorizadas ({{bien_capacite_max_label}}). Cualquier ocupación adicional está expresamente prohibida sin autorización escrita.</li>
      <li>No introducir animales en el inmueble salvo autorización expresa por escrito de la agencia.</li>
      <li>Respetar las normas de convivencia, en particular el silencio entre las 22:00 y las 8:00.</li>
      <li>No ejercer ninguna actividad comercial o profesional en el inmueble.</li>
      <li>Notificar inmediatamente a la agencia cualquier daño o avería constatado.</li>
      <li>Dejar libre el alojamiento a la hora de salida de la estancia (artículo 3): toda salida tardía no autorizada se factura según el artículo 3; puede solicitarse una salida tardía con antelación.</li>
      <li>Devolver el inmueble en el estado del inventario inicial: vajilla limpia, electrodomésticos limpios, residuos evacuados, ropa de cama retirada.</li>
      <li>No fumar en el interior del inmueble.</li>
      {{#a_piscine}}<li>Respetar las normas de seguridad de la piscina: no dejar menores sin supervisión, no utilizar la piscina entre las 23:00 y las 7:00.</li>{{/a_piscine}}
    </ul>
  </div>
</div>

<!-- ══ 7. SEGURO DE VACACIONES ══════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">7</span>
    Seguro de vacaciones
  </div>
  <div class="clause">
    <p>
      El seguro de <strong>responsabilidad civil vacacional</strong> cubre los daños que puedan causarse a la vivienda, a su contenido y a terceros (incendio, daños por agua, robo, rotura) durante la estancia. El arrendatario indica a continuación su situación respecto a esta garantía:
    </p>
    <div style="margin:14px 0;display:flex;flex-direction:column;gap:6px;font-size:10pt">
{{#is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_platform}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Casilla marcada (opción elegida)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_platform}}{{^assurance_choice_platform}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Casilla sin marcar" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_platform}}</span>
        <span>Cobertura vacacional incluida a través de la plataforma de reserva ({{assurance_platform_name}})</span>
      </div>
{{/is_booking_platform}}
{{^is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_mrh}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Casilla marcada (opción elegida)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_mrh}}{{^assurance_choice_mrh}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Casilla sin marcar" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_mrh}}</span>
        <span>Dispongo de un seguro de responsabilidad civil vacacional que cubre el periodo de la estancia y podré facilitar un certificado a petición.</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_no_insurance}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Casilla marcada (opción elegida)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_no_insurance}}{{^assurance_choice_no_insurance}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Casilla sin marcar" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_no_insurance}}</span>
        <span>Declaro no disponer de un seguro de responsabilidad civil vacacional que cubra los daños que puedan causarse a la vivienda alquilada durante mi estancia. He sido informado(a) de que podría ser considerado(a) personalmente responsable de los daños materiales causados a la vivienda, a su mobiliario o a terceros durante el periodo de alquiler, y acepto continuar con la reserva sin dicha cobertura.</span>
      </div>
{{/is_booking_platform}}
    </div>
    <p style="font-weight:700">
      La ausencia de un seguro de vacaciones no exime en ningún caso al arrendatario de su responsabilidad por los daños causados a la vivienda o a su contenido.
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      Nota: el seguro de la agencia cubre únicamente la responsabilidad civil profesional de {{agence_nom}} (seguro {{agence_assurance_affiche}}). No sustituye al seguro personal del arrendatario.
    </p>
  </div>
</div>

<!-- ══ 8. CONDICIONES DE CANCELACIÓN Y RESCISIÓN ═════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">8</span>
    Condiciones de cancelación y rescisión
  </div>
  <div class="clause">
    <p>Toda cancelación debe notificarse por escrito (correo electrónico a {{agence_email_contact}}):</p>
{{clause_annulation}}
    <p>
      En caso de rescisión por parte del arrendador o la agencia por causas ajenas al arrendatario, las cantidades abonadas serán íntegramente reembolsadas en un plazo de 15 días.
    </p>
  </div>
</div>

<!-- ══ 9. PROTECCIÓN DE DATOS PERSONALES (RGPD) ═════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">9</span>
    Protección de datos personales (RGPD)
  </div>
  <div class="clause">
    <div class="clause-title">9.1 Responsable del tratamiento</div>
    <p>
      {{agence_nom}}, {{agence_adresse}} (el «Responsable del tratamiento»), trata sus datos personales en el marco de la gestión de su reserva y de la relación contractual.
    </p>
    <div class="clause-title" style="margin-top:10px">9.2 Datos recogidos y finalidades</div>
    <p>Los datos recogidos (nombre, apellidos, dirección, correo electrónico, teléfono, datos de pago) son tratados para:</p>
    <ul>
      <li>La gestión y ejecución del presente contrato de arrendamiento;</li>
      <li>La gestión de los pagos y de la garantía bancaria;</li>
      <li>El cumplimiento de las obligaciones legales (declaración de tasa turística, obligaciones fiscales);</li>
      <li>La verificación de identidad a efectos de seguridad del inmueble.</li>
    </ul>
    <div class="clause-title" style="margin-top:10px">9.3 Plazo de conservación</div>
    <p>
      Los datos contractuales se conservan durante <strong>5 años</strong> a partir del fin de la estancia (obligaciones contables). Los documentos de identidad (fotografía de verificación y documento de identidad) se conservan durante <strong>1 año</strong> a partir del fin de la estancia y después se eliminan definitivamente. Los datos de tarjeta bancaria son gestionados exclusivamente por Stripe — ningún número completo de tarjeta es almacenado por {{agence_nom}}.
    </p>
    <div class="clause-title" style="margin-top:10px">9.4 Derechos del arrendatario</div>
    <p>
      De conformidad con el RGPD (Reglamento UE 2016/679) y la normativa aplicable en materia de protección de datos, usted dispone de un derecho de acceso, rectificación, supresión y portabilidad de sus datos, así como de un derecho de oposición al tratamiento. Para ejercer estos derechos: {{agence_email_contact}}.
    </p>
    <div class="clause-title" style="margin-top:10px">9.5 Transferencia a terceros</div>
    <p>
      Sus datos son compartidos, en la estricta medida de lo necesario, con: Stripe Inc. (pago, Estados Unidos — decisión de adecuación EU-US Data Privacy Framework), Twilio Inc. (verificación SMS), y los servicios alojados en Supabase (infraestructura Cloud, UE). Ningún dato es vendido a terceros.
    </p>
    <div class="clause-title" style="margin-top:10px">9.6 Seguridad de los documentos y verificación de identidad</div>
    <p>
      La foto de verificación tomada durante la firma es objeto de un control automatizado cuyo único fin es comprobar que un rostro es visible y utilizable (foto no vacía, no borrosa, no tomada de una pantalla). Este control no tiene por objeto identificar a la persona: no implica ningún reconocimiento facial, ninguna comparación con el documento de identidad ni ningún tratamiento de datos biométricos. Se basa en el interés legítimo de {{agence_nom}} en prevenir el fraude y asegurar el acceso al alojamiento, y no puede por sí solo impedir la firma: tras dos nuevos intentos, la foto se acepta. Lo realiza nuestro encargado del tratamiento Anthropic PBC (Estados Unidos), en el marco de las cláusulas contractuales tipo adoptadas por la Comisión Europea; Anthropic no utiliza estos datos para entrenar sus modelos y los suprime en un plazo de 30 días, salvo conservación más prolongada exigida por la ley o por el control del cumplimiento de sus normas de uso. El documento de identidad nunca se le transmite. La foto de verificación y el documento de identidad se marcan desde su recepción con la marca de agua «document destiné uniquement à la location saisonnière» (documento destinado únicamente al alquiler de temporada) y nunca se conservan sin ella. El contrato firmado está sellado electrónicamente por {{agence_nom}}: cualquier modificación posterior del documento es detectable.
    </p>
  </div>
</div>

<!-- ══ 10. INVENTARIO DEL ESTADO ═════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">10</span>
    Inventario del estado del inmueble
  </div>
  <div class="clause">
    <div class="clause-title">10.1 Inventario de entrada</div>
    <p>
      Se realiza un inventario contradictorio a la llegada del arrendatario, en presencia de un representante de la agencia o por cualquier medio equivalente (formulario digital, fotografías con fecha). El arrendatario dispone de un plazo de <strong>24 horas</strong> a partir de la entrega de llaves para comunicar por escrito a {{agence_email_contact}} cualquier desperfecto o reserva no mencionado en el inventario inicial.
    </p>
    <div class="clause-title" style="margin-top:10px">10.2 Inventario de salida</div>
    <p>
      A la expiración de la estancia, se levanta un inventario contradictorio de salida según las mismas modalidades. El inmueble debe ser restituido en el estado constatado a la entrada, limpio y conforme al inventario adjunto. Todo desperfecto constatado a la salida, no mencionado en la entrada, será imputado al arrendatario.
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      En ausencia del arrendatario durante el inventario de salida, este será levantado contradictoriamente por la agencia en solitario y notificado al arrendatario en un plazo de 48 horas por correo electrónico. El arrendatario podrá formular observaciones en los 5 días siguientes a la notificación.
    </p>
  </div>
</div>

<!-- ══ 11. RETENCIONES Y GASTOS DE RESTITUCIÓN ══════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">11</span>
    Retenciones y gastos de restitución
  </div>
  <div class="clause">
    <p>
      En caso de desperfecto constatado en el inventario de salida, de incumplimiento de las obligaciones del arrendatario o de gastos adicionales generados, la agencia podrá proceder a un cargo en la tarjeta bancaria registrada como garantía (artículo 5), previa justificación y notificación escrita al arrendatario, por los motivos siguientes:
    </p>
    <ul>
      <li><strong>Alojamiento dejado en estado de suciedad avanzada:</strong> facturación de los gastos de limpieza reales (mínimo 80 €).</li>
      <li><strong>Sábanas o toallas muy manchadas más allá del desgaste normal:</strong> gastos de lavandería o sustitución (mínimo 30 € por lote).</li>
      <li><strong>Objetos rotos, deteriorados o faltantes:</strong> sustitución o reparación al coste real justificado.</li>
      <li><strong>Residuos en cantidad excesiva no evacuados:</strong> gastos de recogida (mínimo 50 €).</li>
      <li><strong>Llaves no restituidas:</strong> sustitución de cerradura o caja de seguridad (coste real).</li>
      <li><strong>Ocupación no autorizada (animales, sobreocupación):</strong> penalización fija de 100 € más el 5 % del importe total de la estancia, sin perjuicio de otros daños.</li>
      <li><strong>Salida tardía no autorizada:</strong> penalización del 10 % del precio de una noche por cada tramo de 10 minutos iniciado tras 10 minutos de tolerancia, con un máximo del precio de una noche, más los gastos reales justificados (artículo 3).</li>
    </ul>
    <p style="font-size:9pt;color:#8C7B65;margin-top:8px;">
      Todo cargo irá precedido de un correo electrónico de notificación detallando los motivos y los importes. El arrendatario dispone de 7 días para impugnar por escrito. En ausencia de impugnación dentro de dicho plazo, el cargo se considerará aceptado.
    </p>
  </div>
</div>

<!-- ══ 12. REPARACIONES URGENTES — ACCESO AL INMUEBLE ══════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">12</span>
    Reparaciones urgentes — Acceso al inmueble
  </div>
  <div class="clause">
    <p>
      El arrendatario está obligado a comunicar inmediatamente a la agencia cualquier avería o desperfecto constatado. Autoriza expresamente el acceso al inmueble por parte de la agencia o sus proveedores para cualquier trabajo urgente necesario para la conservación del bien (fuga de agua, avería de calefacción, problema eléctrico, etc.), incluso en su ausencia, previa información.
    </p>
    <p>
      Estas intervenciones urgentes no dan derecho a ninguna reducción del alquiler, salvo que priven al arrendatario del disfrute de una parte sustancial del inmueble durante más de 48 horas consecutivas. En tal caso, se calculará una reducción proporcional de mutuo acuerdo.
    </p>
  </div>
</div>

<!-- ══ 13. FUERZA MAYOR ══════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">13</span>
    Fuerza mayor
  </div>
  <div class="clause">
    <p>
      Ni el arrendador ni la agencia podrán ser considerados responsables del incumplimiento o retraso en el cumplimiento de sus obligaciones en caso de fuerza mayor en el sentido del artículo 1218 del Código Civil francés (catástrofe natural, incendio, inundación, decisión administrativa, pandemia con cierre impuesto por las autoridades, etc.).
    </p>
    <p>
      En caso de fuerza mayor que haga el inmueble inhabitable o su acceso imposible, las cantidades abonadas por el arrendatario serán íntegramente reembolsadas en un plazo de 15 días, con exclusión de cualquier otra indemnización. Se invita al arrendatario a suscribir un seguro de cancelación para protegerse de los casos no cubiertos por la fuerza mayor legal.
    </p>
  </div>
</div>

<!-- ══ 14. DERECHO APLICABLE Y JURISDICCIÓN COMPETENTE ═════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">14</span>
    Derecho aplicable, mediación y jurisdicción competente
  </div>
  <div class="clause">
    <p>
      El presente contrato se rige por la legislación francesa. En caso de litigio, las partes se comprometen a intentar una resolución amistosa antes de cualquier acción judicial.
    </p>
    <p>
      De conformidad con los artículos L612-1 y siguientes del Código de Consumo francés, en caso de litigio no resuelto tras una reclamación previa por escrito ante la agencia, el arrendatario puede recurrir gratuitamente al siguiente mediador de consumo: Centre de la Médiation de la Consommation de Conciliateurs de Justice (CM2C), 49 rue de Ponthieu, 75008 Paris, France – www.cm2c.net (solicitud en línea) – +33 1 89 47 00 14. El mediador debe ser consultado en el plazo de un año a partir de la reclamación escrita dirigida a la agencia.
    </p>
    <p>
      A falta de acuerdo amistoso, el Tribunal Judicial de Bayona será el único competente, salvo disposición imperativa contraria aplicable al arrendatario consumidor.
    </p>
  </div>
</div>

<!-- ══ FIRMAS ══════════════════════════════════════════════════════════ -->
<div class="section avoid-break">
  <div class="section-title">
    <span class="section-title-num" style="background:linear-gradient(135deg,#2C2416,#4A3820)">✍</span>
    Firmas de las partes
  </div>
  <div style="background:#FDFAF5;border:1px solid #E8DCC8;border-left:3px solid #CC9933;border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:9pt;color:#4A3F32;font-family:'Helvetica Neue',Arial,sans-serif;line-height:1.7">
    El arrendatario reconoce haber leído íntegramente el presente contrato (incluido el anexo descriptivo), haber tenido la posibilidad de plantear cualquier pregunta, y acepta sin reservas los términos y condiciones definidos anteriormente. La firma electrónica estampada a continuación tiene el mismo valor jurídico que una firma manuscrita (Reglamento UE n.º 910/2014 eIDAS y ley francesa del 13 de marzo de 2000, art. 1366 y 1367 del Código Civil).
  </div>
  <div class="signature-grid">
    <div class="signature-block">
      <div class="signature-label">Para el arrendador / mandatario</div>
      <div class="signature-name">{{agence_nom}}</div>
      <div class="signature-note">Representado por {{agence_representant_affiche}}, {{agence_qualite_representant}}<br>{{agence_email_representant}}</div>
      <div style="margin-top:10px;text-align:center">
        <div style="font-size:8pt;color:#8C7B65;margin-bottom:4px">Firmado electrónicamente</div>
        <div style="font-family:'Northwell',cursive;font-size:20pt;color:#CC9933;line-height:1;padding:4px 0">Oihan Campandegui</div>
        <div style="font-size:7.5pt;color:#A09282;margin-top:2px">Presidente — Lauïan Immobilier</div>
      </div>
    </div>
    <div class="signature-block">
      <div class="signature-label">Arrendatario — firma electrónica</div>
      <div class="signature-name">{{guest_civilite_affiche}} {{guest_nom_affiche}}</div>
      <div class="signature-note">Firma estampada a través del portal seguro contrat.destinationcotebasque.com</div>
      <div class="signature-line"></div>
    </div>
  </div>
</div>

<!-- ══ ANEXO — DESCRIPCIÓN DEL INMUEBLE ══════════════════════════════ -->
<div class="page-break"></div>
<div class="header" style="margin-bottom:0;padding:20px 0 16px">
  <div class="header-left">
    <div class="logo-square" style="width:38px;height:38px;font-size:18px">L</div>
    <div class="header-brand">
      <div class="name" style="font-size:11pt">Lauïan Immobilier</div>
      <div class="sub">Anexo al contrato de arrendamiento estacional</div>
    </div>
  </div>
  <div class="header-right">{{date_contrat_longue}}</div>
</div>
<div class="doc-title-block" style="padding:18px 0 14px;margin-bottom:20px">
  <div class="doc-title" style="font-size:12pt;letter-spacing:2px">Descripción del inmueble</div>
  <div class="gold-line"></div>
  <div class="doc-subtitle">{{bien_nom_public}}</div>
  <div class="doc-subtitle" style="margin-top:2px;font-size:8.5pt;">{{bien_adresse_complete}}</div>
</div>
<div class="section">
  <div class="section-title">
    <span class="section-title-num">A</span>
    Características generales
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:28%" class="annexe-label">Dirección</td>
      <td colspan="3">{{bien_adresse_complete}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Naturaleza / Tipo</td>
      <td>{{bien_nature_label}}</td>
      <td style="width:28%" class="annexe-label">Clasificación</td>
      <td>{{bien_classement_label}}</td>
    </tr>
    {{#has_surface_pieces}}
    <tr>
      <td class="annexe-label">Superficie</td>
      <td>{{#bien_superficie}}{{bien_superficie}} m²{{/bien_superficie}}</td>
      <td class="annexe-label">N.º de habitaciones principales</td>
      <td>{{bien_nb_pieces}}</td>
    </tr>
    {{/has_surface_pieces}}
    {{#has_construction_etage}}
    <tr>
      <td class="annexe-label">Año de construcción</td>
      <td>{{bien_date_construction}}</td>
      <td class="annexe-label">Planta</td>
      <td>{{bien_etage}}</td>
    </tr>
    {{/has_construction_etage}}
    <tr>
      <td class="annexe-label">Capacidad de alojamiento</td>
      <td>{{bien_capacite_max_label}} máx.</td>
      {{#has_exposition}}
      <td class="annexe-label">Orientación</td>
      <td>{{bien_exposition}}</td>
      {{/has_exposition}}
      {{#has_no_exposition}}
      <td colspan="2"></td>
      {{/has_no_exposition}}
    </tr>
    {{#has_voisinage}}
    <tr>
      <td class="annexe-label">Entorno / Vecindario</td>
      <td colspan="3">{{bien_voisinage}}</td>
    </tr>
    {{/has_voisinage}}
    {{#a_piscine}}
    <tr>
      <td class="annexe-label">Equipamientos especiales</td>
      <td colspan="3">Piscina privada — uso reservado a los ocupantes del inmueble</td>
    </tr>
    {{/a_piscine}}
  </table>

  {{#has_distances}}
  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">B</span>
    Distancias y situación geográfica
  </div>
  <table class="annexe-table">
    <thead>
      <tr>
        <th>Punto de referencia</th>
        <th>Distancia aproximada</th>
      </tr>
    </thead>
    <tbody>
      {{#bien_distance_mer}}
      <tr>
        <td>Mar / océano</td>
        <td>{{bien_distance_mer}}</td>
      </tr>
      {{/bien_distance_mer}}
      {{#bien_distance_plage}}
      <tr>
        <td>Playa más cercana</td>
        <td>{{bien_distance_plage}}</td>
      </tr>
      {{/bien_distance_plage}}
      {{#bien_distance_gare}}
      <tr>
        <td>Estación de tren</td>
        <td>{{bien_distance_gare}}</td>
      </tr>
      {{/bien_distance_gare}}
      {{#bien_distance_centre}}
      <tr>
        <td>Centro urbano</td>
        <td>{{bien_distance_centre}}</td>
      </tr>
      {{/bien_distance_centre}}
    </tbody>
  </table>
  {{/has_distances}}

  {{#has_description_pieces}}
  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">C</span>
    Descripción de las habitaciones
  </div>
  <table class="annexe-table">
    <thead>
      <tr>
        <th>Habitación</th>
        <th>Descripción y equipamiento</th>
      </tr>
    </thead>
    <tbody>
      {{#has_desc_sejour}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Salón / Sala de estar</td>
        <td>{{bien_description_sejour}}</td>
      </tr>
      {{/has_desc_sejour}}
      {{#has_desc_cuisine}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Cocina</td>
        <td>{{bien_cuisine}}</td>
      </tr>
      {{/has_desc_cuisine}}
      {{#has_desc_sdb}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Baño</td>
        <td>{{bien_sdb}}</td>
      </tr>
      {{/has_desc_sdb}}
      {{#has_desc_toilettes}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Aseos</td>
        <td>{{bien_toilettes}}</td>
      </tr>
      {{/has_desc_toilettes}}
      {{#has_desc_etat}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Estado general</td>
        <td>{{bien_etat_general}}</td>
      </tr>
      {{/has_desc_etat}}
    </tbody>
  </table>
  {{/has_description_pieces}}

  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">D</span>
    Horarios de acceso (check-in / check-out)
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:50%" class="annexe-label">Hora de llegada (check-in)</td>
      <td>A partir de {{heure_arrivee}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Hora de salida (check-out)</td>
      <td>Antes de {{heure_depart}}</td>
    </tr>
  </table>
</div>

<!-- ══ PIE DE PÁGINA ══════════════════════════════════════════════════ -->
<div class="footer">
  {{agence_nom}} — {{agence_adresse}} — {{agence_email_contact}} — Tel. {{agence_telephone_affiche}}<br>
  Tarjeta Profesional {{agence_cpi}} expedida por {{agence_cpi_delivree_par}} — RCS {{agence_rcs}} — IVA {{agence_tva}}<br>
  Seguro RCP: {{agence_assurance_affiche}} — Garantía financiera: {{agence_garantie_galian}}<br>
  <em>Documento generado automáticamente el {{date_contrat_longue}} — Firma electrónica certificada</em>
</div>

</div><!-- /.page -->
</body>
</html>
$tpl469$, $v$[]$v$::jsonb, false
where not exists (select 1 from contract_templates where agence='lauian' and langue='es' and type_contrat='saisonnier' and version='2026-v6');

-- lauian saisonnier fr : 2026-v5 → 2026-v6
insert into contract_templates (agence, langue, type_contrat, version, nom, contenu_html, variables_attendues, is_active)
select 'lauian', 'fr', 'saisonnier', '2026-v6', $n$FR Saisonnier 2026 — Lauïan Immobilier$n$, $tpl469$<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Contrat de location saisonnière — Lauïan Immobilier</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Questrial&display=swap');

@font-face {
  font-family: 'Northwell';
  src: url('https://dcb-contrats.vercel.app/fonts/Northwell.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
}

/* ── Reset ── */
* { margin: 0; padding: 0; box-sizing: border-box; }

/* ── Page PDF ── */
@page {
  size: A4;
  margin: 20mm 15mm 22mm;
  @bottom-right {
    content: "Page " counter(page) " / " counter(pages);
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 7.5pt;
    color: #A09282;
  }
  @bottom-left {
    content: "Lauïan Immobilier — Contrat de location saisonnière";
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 7.5pt;
    color: #A09282;
  }
}

body {
  font-family: 'Questrial', 'Helvetica Neue', Arial, sans-serif;
  font-size: 10.5pt;
  color: #1C1C1C;
  line-height: 1.65;
  background: #fff;
  counter-reset: page;
}

/* ── Mise en page ── */
.page { max-width: 100%; padding: 0; }

/* ── En-tête ── */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 36px 0 24px;
  border-bottom: 0;
  margin-bottom: 0;
  position: relative;
}
.header::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 4px;
  background: linear-gradient(90deg, transparent 0%, #CC9933 15%, #E4A853 50%, #CC9933 85%, transparent 100%);
  border-radius: 2px;
}
.header-left { display: flex; align-items: center; gap: 14px; }
.logo-square {
  width: 46px; height: 46px;
  background: linear-gradient(135deg, #D4A035 0%, #CC9933 60%, #B8872A 100%);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 22px; font-weight: 700;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(204,153,51,0.30);
}
.header-brand { font-family: 'Helvetica Neue', Arial, sans-serif; }
.header-brand .name { font-family: 'Northwell', cursive; font-size: 26pt; font-weight: normal; color: #CC9933; letter-spacing: 1px; line-height: 1.1; }
.header-brand .sub  { font-size: 8pt; color: #8C7B65; letter-spacing: 2px; text-transform: uppercase; margin-top: 3px; font-family: 'Helvetica Neue', Arial, sans-serif; }
.header-right {
  text-align: right;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 8pt; color: #8C7B65; line-height: 1.8;
}

/* ── Titre principal ── */
.doc-title-block {
  text-align: center;
  padding: 28px 0 20px;
  border-bottom: 1px solid #EAE0D0;
  margin-bottom: 26px;
}
.doc-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 15pt;
  font-weight: 700;
  color: #1C1C1C;
  text-transform: uppercase;
  letter-spacing: 3px;
  margin-bottom: 8px;
}
.doc-subtitle {
  font-size: 9.5pt;
  color: #8C7B65;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-style: italic;
}
.gold-line {
  width: 48px; height: 2px;
  background: linear-gradient(90deg, #CC9933, #E4A853, #CC9933);
  margin: 12px auto;
  border-radius: 2px;
}

/* ── Sections ── */
.section {
  margin-bottom: 24px;
  page-break-inside: avoid;
}
.section-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 8.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: #CC9933;
  border-bottom: 1.5px solid #E8DCC8;
  padding-bottom: 6px;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 0;
}
.section-title-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #D4A035, #CC9933);
  color: #fff;
  border-radius: 50%;
  width: 22px; height: 22px;
  font-size: 9pt;
  font-weight: 700;
  margin-right: 10px;
  flex-shrink: 0;
  box-shadow: 0 1px 4px rgba(204,153,51,0.30);
}

/* ── Blocs parties ── */
.parties-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 4px;
}
.partie-box {
  background: #FDFAF5;
  border: 1px solid #E8DCC8;
  border-left: 3px solid #CC9933;
  border-radius: 6px;
  padding: 14px 16px;
}
.partie-label {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: #8C7B65;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #E8DCC8;
}
.partie-nom {
  font-size: 11pt;
  font-weight: 700;
  color: #1C1C1C;
  margin-bottom: 5px;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
.partie-detail {
  font-size: 9pt;
  color: #4A3F32;
  line-height: 1.75;
}

/* ── Tableau financier ── */
.financial-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9.5pt;
  margin-bottom: 4px;
  border-radius: 6px;
  overflow: hidden;
}
.financial-table th {
  background: #F0E8D8;
  color: #6B5840;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 8px 12px;
  text-align: left;
  border: 1px solid #E0D4C0;
}
.financial-table td {
  padding: 10px 12px;
  border: 1px solid #E8DCC8;
  vertical-align: top;
}
.financial-table tr:nth-child(even) td { background: #FDFAF5; }
.amount { font-weight: 700; color: #1C1C1C; text-align: right; }
.total-row td { background: #F0E8D8 !important; font-weight: 700; font-size: 10pt; }

/* ── Bloc garantie ── */
.garantie-box {
  background: #F0FBF4;
  border: 1px solid #86EFAC;
  border-left: 4px solid #15803D;
  border-radius: 6px;
  padding: 14px 16px;
  margin: 12px 0;
  font-size: 9.5pt;
  line-height: 1.7;
  color: #1C1C1C;
}
.garantie-box strong { color: #166534; }
.garantie-icon { font-size: 13pt; margin-right: 6px; vertical-align: middle; }

/* ── Clauses / Articles ── */
.clause {
  margin-bottom: 14px;
  page-break-inside: avoid;
}
.clause-title {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9.5pt;
  font-weight: 700;
  color: #2C2416;
  margin-bottom: 5px;
  letter-spacing: -0.1px;
}
.clause p {
  font-size: 9.5pt;
  color: #2C2416;
  margin-bottom: 6px;
  line-height: 1.65;
}
.clause ul, .clause ol {
  padding-left: 20px;
  margin: 6px 0;
}
.clause li {
  font-size: 9.5pt;
  color: #2C2416;
  margin-bottom: 4px;
  line-height: 1.65;
}

/* ── Tableau descriptif annexe ── */
.annexe-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 9pt;
  margin-bottom: 12px;
  page-break-inside: avoid;
  break-inside: avoid;
}
.annexe-table th {
  background: #F0E8D8;
  color: #6B5840;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 7px 10px;
  border: 1px solid #E0D4C0;
  text-align: left;
}
.annexe-table td {
  padding: 8px 10px;
  border: 1px solid #E8DCC8;
  vertical-align: top;
}
.annexe-table tr:nth-child(even) td { background: #FDFAF5; }
.annexe-label { color: #8C7B65; font-size: 8pt; font-family: 'Helvetica Neue', Arial, sans-serif; }

/* ── Bloc signature ── */
.signature-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-top: 20px;
  page-break-inside: avoid;
  break-inside: avoid;
}
.signature-block {
  border: 1px solid #E8DCC8;
  border-radius: 8px;
  padding: 16px;
  min-height: 110px;
  background: #FDFAF5;
}
.signature-label {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #8C7B65;
  margin-bottom: 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid #E8DCC8;
}
.signature-name {
  font-weight: 700;
  font-size: 10pt;
  color: #1C1C1C;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
.signature-note { font-size: 7.5pt; color: #8C7B65; margin-top: 4px; line-height: 1.5; font-family: 'Helvetica Neue', Arial, sans-serif; }
.signature-line {
  border-bottom: 1.5px dashed #CC9933;
  height: 52px;
  margin-top: 14px;
  opacity: 0.5;
}

/* ── Pied de page ── */
.footer {
  margin-top: 32px;
  padding-top: 14px;
  border-top: 1px solid #E8DCC8;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 7.5pt;
  color: #A09282;
  line-height: 1.8;
  text-align: center;
}

/* ── Sauts de page ── */
.page-break { page-break-before: always; break-before: page; }
.avoid-break { page-break-inside: avoid; break-inside: avoid; }

/* ── Info notice ── */
.notice {
  background: #FFF8E6;
  border: 1px solid #FDE68A;
  border-left: 3px solid #D97706;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 9pt;
  color: #78350F;
  margin: 10px 0;
  font-family: 'Helvetica Neue', Arial, sans-serif;
}
@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  img { max-width: 100% !important; }
}
</style>
</head>
<body>
<div class="page">

<!-- ══ EN-TÊTE ══════════════════════════════════════════════════════ -->
<div class="header">
  <div class="header-left">
    <div class="logo-square">L</div>
    <div class="header-brand">
      <div class="name">Lauïan Immobilier</div>
      <div class="sub">Conciergerie &amp; gestion locative</div>
    </div>
  </div>
  <div class="header-right">
    {{agence_adresse}}<br>
    Tél. {{agence_telephone_affiche}}<br>
    {{agence_email_contact}}<br>
    RCS {{agence_rcs}}
  </div>
</div>

<!-- ══ TITRE ════════════════════════════════════════════════════════ -->
<div class="doc-title-block">
  <div class="doc-title">Contrat de Location Saisonnière</div>
  <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:9pt;color:#CC9933;letter-spacing:1.5px;margin-top:4px;font-weight:600">N°&nbsp;{{contract_numero}}</div>
  <div class="gold-line"></div>
  <div class="doc-subtitle">Établi à {{lieu_signature}}, le {{date_contrat_longue}}</div>
</div>

<!-- ══ 1. PARTIES ═══════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">1</span>
    Parties au contrat
  </div>
  <div class="parties-grid">
    <!-- Bailleur -->
    <div class="partie-box">
      <div class="partie-label">Bailleur (propriétaire)</div>
      <div class="partie-nom">{{bailleur_nom_affiche}}</div>
      <div class="partie-detail">
        {{bailleur_statut}}<br>
        {{bailleur_adresse_complete}}
      </div>
    </div>
    <!-- Agence mandataire -->
    <div class="partie-box">
      <div class="partie-label">Mandataire — Agence de gestion</div>
      <div class="partie-nom">{{agence_nom}}</div>
      <div class="partie-detail">
        {{agence_adresse}}<br>
        Tél. {{agence_telephone_affiche}}<br>
        {{agence_email_contact}}<br>
        RCS {{agence_rcs}} — {{agence_cpi}}<br>
        délivré par {{agence_cpi_delivree_par}}<br>
        {{agence_forme}} au capital social de {{agence_capital}} €<br>
        TVA : {{agence_tva}}<br>
        Représenté par {{agence_representant}}, {{agence_qualite_representant}}
      </div>
    </div>
  </div>
  <!-- Locataire pleine largeur -->
  <div class="partie-box" style="margin-top:14px">
    <div class="partie-label">Locataire</div>
    <div class="partie-nom">{{guest_civilite}} {{guest_nom_affiche}}</div>
    <div class="partie-detail">
      Adresse : {{guest_adresse_affichee}}<br>
      E-mail : {{guest_email}}&nbsp;&nbsp;·&nbsp;&nbsp;Téléphone : {{guest_telephone_affiche}}<br>
      Nombre de personnes prévues : <strong>{{guest_nb_personnes}}</strong>{{guest_detail_personnes}}
    </div>
  </div>
</div>

<!-- ══ 2. BIEN LOUÉ ══════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">2</span>
    Désignation du bien loué
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:35%" class="annexe-label">Nature du bien</td>
      <td>{{bien_nature_label}}</td>
      <td style="width:30%" class="annexe-label">Classement</td>
      <td>{{bien_classement_label}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Adresse complète</td>
      <td colspan="3">{{bien_adresse_complete}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Propriétaire</td>
      <td>{{bailleur_nom_affiche}}</td>
      <td class="annexe-label">Capacité maximale</td>
      <td>{{bien_capacite_max_label}}</td>
    </tr>
    {{#has_surface_pieces}}
    <tr>
      <td class="annexe-label">{{bien_superficie_label}}</td>
      <td>{{#bien_superficie}}{{bien_superficie}} m²{{/bien_superficie}}</td>
      <td class="annexe-label">Nombre de pièces</td>
      <td>{{#bien_nb_pieces}}{{bien_nb_pieces_label}}{{/bien_nb_pieces}}</td>
    </tr>
    {{/has_surface_pieces}}
    {{#has_construction_etage}}
    <tr>
      <td class="annexe-label">Année de construction</td>
      <td>{{bien_date_construction}}</td>
      <td class="annexe-label">Étage</td>
      <td>{{bien_etage}}</td>
    </tr>
    {{/has_construction_etage}}
    {{#a_piscine}}
    <tr>
      <td class="annexe-label">Équipements spéciaux</td>
      <td colspan="3">🏊 {{piscine_label}} — {{piscine_horaires_label}}</td>
    </tr>
    {{/a_piscine}}
  </table>
</div>

<!-- ══ 3. PÉRIODE DE LOCATION ════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">3</span>
    Période de location
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:30%" class="annexe-label">Arrivée</td>
      <td><strong>{{date_arrivee_longue}}</strong> à partir de {{heure_arrivee}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Départ</td>
      <td><strong>{{date_depart_longue}}</strong> avant {{heure_depart}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Durée du séjour</td>
      <td><strong>{{nb_nuits_label}}</strong></td>
    </tr>
  </table>
  <div class="clause" style="margin-top:12px">
    <div class="clause-title">Heure de départ — départ tardif non autorisé</div>
    <p>
      Le logement doit être libéré, et les clés restituées selon les consignes, au plus tard à l'heure de départ indiquée ci-dessus ou, le cas échéant, à l'heure de départ tardif réglée à l'avance. Une tolérance de <strong>10 minutes</strong> est accordée. Au-delà, le locataire qui se maintient dans les lieux sans accord écrit de l'agence est redevable, à titre de clause pénale (article 1231-5 du Code civil), de <strong>10 % du prix moyen d'une nuit d'hébergement</strong> du séjour (hors frais et taxes) <strong>par tranche de 10 minutes commencée</strong> après la tolérance{{#has_penalite_montant}}, soit <strong>{{penalite_tranche_eur}} par tranche</strong> pour ce séjour{{/has_penalite_montant}}, dans la limite du <strong>prix d'une nuit</strong>{{#has_penalite_montant}} ({{penalite_plafond_eur}}){{/has_penalite_montant}}. S'y ajoutent, sur justificatif, les frais réels causés par le retard (ménage refait en urgence, relogement ou dédommagement du voyageur suivant).
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      Exemple pour un départ prévu à 10h00 : départ à 10h10 = aucune pénalité ; à 10h15 = 1 tranche ; à 11h00 = 5 tranches. Un départ tardif demandé à l'avance coûte 25 € jusqu'à 12h00 ou 45 € jusqu'à 14h00, selon disponibilité ; rester sans accord coûte jusqu'au prix d'une nuit. {{^is_booking_platform}}Le montant est {{^is_none_guarantee}}débité sur la carte bancaire enregistrée en garantie{{/is_none_guarantee}}{{#is_none_guarantee}}facturé au locataire{{/is_none_guarantee}}, après notification écrite indiquant l'heure de départ constatée et le calcul, dans les conditions de l'article 11.{{/is_booking_platform}}{{#is_booking_platform}}Pour une réservation effectuée via une plateforme (Airbnb, Booking.com…), le montant est réclamé par l'intermédiaire de cette plateforme, selon ses règles.{{/is_booking_platform}}
    </p>
  </div>
  <p style="font-size:9pt;color:#8C7B65;margin-top:8px;font-family:Arial,sans-serif;">
    La remise des clés s'effectue selon les modalités communiquées par l'agence (boîte à clé sécurisée ou accueil sur place). Le locataire s'engage à restituer le bien propre et dans l'état dans lequel il l'a trouvé, à l'heure fixée ci-dessus.
  </p>
</div>

<!-- ══ 4. CONDITIONS FINANCIÈRES ════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">4</span>
    Conditions financières
  </div>
  <table class="financial-table">
    <thead>
      <tr>
        <th>Désignation</th>
        <th style="text-align:right">Montant</th>
        <th>Modalité de paiement</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Total à régler{{#has_taxes_total}}<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">dont {{taxes_total_eur}} de taxes</span>{{/has_taxes_total}}</td>
        <td class="amount">{{prix_total_eur}}</td>
        <td style="font-size:9pt">{{modalite_loyer_affiche}}</td>
      </tr>{{#has_options}}<tr><td>dont options choisies<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">{{options_detail}}</span></td><td class="amount">{{options_total_eur}}</td><td style="font-size:9pt"></td></tr>{{/has_options}}{{#has_promo}}<tr><td>{{promo_libelle}}</td><td class="amount">{{promo_montant_eur}}</td><td style="font-size:9pt">{{promo_note}}</td></tr>{{/has_promo}}{{#has_demandes}}<tr><td>Demandes du voyageur<br><span style="font-weight:normal;font-size:9pt;color:#8C7B65;">{{demandes_detail}}</span></td><td class="amount"></td><td style="font-size:9pt">Sans supplément ni engagement</td></tr>{{/has_demandes}}
      {{#has_acompte}}<tr>
        <td>Acompte à la réservation ({{acompte_pourcentage}}%)</td>
        <td class="amount">{{acompte_montant_eur}}</td>
        <td style="font-size:9pt">{{modalite_acompte_affiche}}</td>
      </tr>{{/has_acompte}}
      {{#has_solde}}
      <tr>
        <td>Solde ({{solde_pourcentage}}%) — {{#has_solde_cash}}payable en espèces à l'arrivée, le {{date_arrivee_longue}}{{/has_solde_cash}}{{^has_solde_cash}}dû au plus tard le {{date_solde}}{{/has_solde_cash}}</td>
        <td class="amount">{{solde_montant_eur}}</td>
        <td style="font-size:9pt">{{modalite_solde_affiche}}</td>
      </tr>
      {{/has_solde}}
      {{#has_taxe_sejour}}
      <tr>
        <td>Taxe de séjour</td>
        <td class="amount">{{taxe_sejour_eur}}</td>
        <td style="font-size:9pt">Collectée et reversée à la commune</td>
      </tr>
      {{/has_taxe_sejour}}
    </tbody>
  </table>
  {{#has_payment_warning}}<div class="notice" style="margin-top:12px">
    ⚠️ Tout retard ou annulation de paiement pourra entraîner la résiliation du contrat, selon les conditions énoncées à l'article 8.
  </div>{{/has_payment_warning}}
  {{#is_cb}}
  <div class="notice" style="margin-top:8px;background:#F0FDF4;border-color:#86EFAC;font-size:9.5pt">
    💳 <strong>Modalités de règlement{{^is_cb_50_cash}} par carte bancaire{{/is_cb_50_cash}} :</strong><br>
    • <strong>Acompte de {{acompte_montant_eur}} ({{acompte_pourcentage}}%)</strong> — {{#is_prepaye}}{{paye_le_texte_min}} (réservation en ligne).{{/is_prepaye}}{{^is_prepaye}}prélevé par carte bancaire à la signature électronique du présent contrat.{{/is_prepaye}}<br>
    {{#has_solde_stripe}}• <strong>Solde de {{solde_montant_eur}} ({{solde_pourcentage}}%)</strong> — prélevé automatiquement par carte bancaire{{carte_mention}} le <strong>{{date_solde}}</strong> ({{date_solde_motif}}).{{/has_solde_stripe}}{{#has_solde_cash}}• <strong>Solde de {{solde_montant_eur}} ({{solde_pourcentage}}%)</strong> — payable en espèces à l'arrivée, le <strong>{{date_arrivee_longue}}</strong>, remis à l'agence ou à son représentant lors de l'entrée dans les lieux (aucun prélèvement sur la carte).{{/has_solde_cash}}<br>
    <em style="font-size:8.5pt;color:#166534">Les prélèvements sont effectués via Stripe (PCI-DSS niveau 1). Un justificatif vous sera envoyé par e-mail.</em>
  </div>
  {{/is_cb}}
</div>

  {{#has_rib}}
  <div class="notice" style="margin-top:8px;background:#EEF4FF;border-color:#93C5FD;font-size:9pt;page-break-inside:avoid;break-inside:avoid;">
    🏦 <strong>Virement à effectuer sur le compte séquestre :</strong><br>
    Titulaire : <strong>{{rib_titulaire}}</strong> &nbsp;·&nbsp;
    IBAN : <strong>{{rib_iban}}</strong> &nbsp;·&nbsp;
    BIC : <strong>{{rib_bic}}</strong> &nbsp;·&nbsp;
    Banque : {{rib_banque}}<br>
    <em style="font-size:8.5pt;color:#5C7FB0">Référence virement : <strong>{{virement_reference}}</strong></em>
  </div>
  {{/has_rib}}
{{#is_booking_platform}}
  <div class="notice" style="margin-top:10px;background:#EEF6FF;border-color:#93C5FD;color:#1E3A5F;">
    ℹ️ <strong>Paiement géré par Booking.com</strong><br>
    Le paiement du séjour est géré par Booking.com selon les conditions acceptées lors de la réservation.<br>
    <em style="font-size:8.5pt;color:#5C7FB0;">Le présent contrat complète les conditions de séjour : identité, occupation, règlement intérieur, état des lieux, garantie bancaire et frais éventuels.</em>
  </div>
{{/is_booking_platform}}

{{^is_none_guarantee}}<!-- ══ 5. GARANTIE BANCAIRE ══════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">5</span>
    Garantie bancaire — Empreinte CB
  </div>
  <div class="garantie-box">
    <span class="garantie-icon">🔐</span>
    <strong>Carte enregistrée en garantie</strong><br><br>
    {{garantie_clause}}
  </div>
  <p style="font-size:8.5pt;color:#8C7B65;font-family:Arial,sans-serif;margin-top:8px;">
    La carte bancaire est enregistrée de manière sécurisée via Stripe (PCI-DSS niveau 1). Aucun numéro de carte n'est stocké par Lauïan Immobilier.
  </p>
</div>

{{/is_none_guarantee}}<!-- ══ 6. OBLIGATIONS DU LOCATAIRE ══════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">6</span>
    Obligations du locataire
  </div>
  <div class="clause">
    <p>Le locataire s'engage à :</p>
    <ul>
      <li>Occuper les lieux personnellement, de manière paisible, en « bon père de famille », et de manière conforme à leur destination d'habitation saisonnière temporaire.</li>
      <li>Ne pas sous-louer ni céder le présent contrat, partiellement ou totalement, sans accord écrit préalable du bailleur.</li>
      <li>Respecter scrupuleusement le nombre maximum de personnes autorisé ({{bien_capacite_max_label}}). Toute occupation supplémentaire est formellement interdite sans autorisation écrite.</li>
      <li>Ne pas introduire d'animaux dans le logement sauf autorisation explicite écrite de l'agence.</li>
      <li>Respecter les règles de voisinage, notamment le calme et la tranquillité entre 22h00 et 8h00.</li><li>Ne pas utiliser de matériel de sonorisation susceptible de générer des nuisances pour le voisinage (enceintes amplifiées, sono, etc.).</li>
      <li>Ne pratiquer aucune activité commerciale ou professionnelle dans le logement.</li>
      <li>Signaler immédiatement toute dégradation ou panne constatée à l'agence.</li>
      <li>Libérer le logement à l'heure de départ du séjour (article 3) : tout départ tardif non autorisé est facturé selon l'article 3 ; un départ tardif peut être demandé à l'avance.</li>
      <li>Restituer le logement dans l'état d'inventaire initial : vaisselle propre, électroménager nettoyé, déchets évacués, linge de lit retiré.</li>
      <li>Ne pas fumer à l'intérieur du logement.</li>
      {{#a_piscine}}<li>Respecter les règles de sécurité liées à la piscine : ne pas laisser de mineurs sans surveillance, ne pas utiliser la piscine entre 23h00 et 7h00. Le locataire reconnaît avoir été informé que l'utilisation de la piscine se fait sous sa seule responsabilité.</li>{{/a_piscine}}
    </ul>
  </div>
</div>

<!-- ══ 7. ASSURANCE VILLÉGIATURE ════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">7</span>
    Assurance villégiature
  </div>
  <div class="clause">
    <p>
      L'assurance <strong>responsabilité civile villégiature</strong> couvre les dommages pouvant être causés au logement, à son contenu et aux tiers (incendie, dégât des eaux, vol, casse) pendant le séjour. Le locataire indique ci-dessous sa situation au regard de cette garantie :
    </p>
    <div style="margin:14px 0;display:flex;flex-direction:column;gap:6px;font-size:10pt">
{{#is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_platform}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Case cochée (option retenue)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_platform}}{{^assurance_choice_platform}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Case non cochée" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_platform}}</span>
        <span>Couverture villégiature incluse via la plateforme de réservation ({{assurance_platform_name}})</span>
      </div>
{{/is_booking_platform}}
{{^is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_mrh}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Case cochée (option retenue)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_mrh}}{{^assurance_choice_mrh}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Case non cochée" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_mrh}}</span>
        <span>Je dispose d'une assurance villégiature couvrant la période du séjour et pourrai fournir une attestation sur demande.</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_no_insurance}}<svg class="case-option case-cochee" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Case cochée (option retenue)" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#1a1a1a" stroke="#1a1a1a" stroke-width="1.5"/><path d="M3.4 7.3l2.5 2.5 4.8-5.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{/assurance_choice_no_insurance}}{{^assurance_choice_no_insurance}}<svg class="case-option case-vide" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Case non cochée" style="display:inline-block;vertical-align:-2px"><rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/></svg>{{/assurance_choice_no_insurance}}</span>
        <span>Je déclare ne pas bénéficier d'une garantie villégiature couvrant les dommages pouvant être causés au logement loué pendant mon séjour. J'ai été informé(e) que je pourrais être tenu(e) personnellement responsable des dommages matériels causés au logement, à son mobilier ou aux tiers pendant la durée de la location, et j'accepte de poursuivre la réservation sans cette couverture.</span>
      </div>
{{/is_booking_platform}}
    </div>
    <p style="font-weight:700">
      L'absence d'assurance villégiature n'exonère en aucun cas le locataire de sa responsabilité en cas de dommages causés au logement ou à son contenu.
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      Note : l'assurance de l'agence couvre uniquement la responsabilité civile professionnelle de {{agence_nom}} (assurance {{agence_assurance}}). Elle ne se substitue pas à l'assurance personnelle du locataire.
    </p>
  </div>
</div>

<!-- ══ 8. CONDITIONS D'ANNULATION ════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">8</span>
    Conditions d'annulation et de résiliation
  </div>
  <div class="clause">
    <p>Toute annulation doit être notifiée par écrit (e-mail à {{agence_email_contact}}) :</p>
    {{clause_annulation}}
    <p>
      Les frais de traitement bancaire éventuellement supportés par l'agence pourront être déduits du remboursement. En cas de résiliation par le bailleur ou l'agence pour raison indépendante de la volonté du locataire, les sommes versées seront intégralement remboursées dans un délai de 15 jours.
    </p>
  </div>
</div>

<!-- ══ 9. RGPD — TRAITEMENT DES DONNÉES PERSONNELLES ════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">9</span>
    Protection des données personnelles (RGPD)
  </div>
  <div class="clause">
    <div class="clause-title">9.1 Responsable du traitement</div>
    <p>
      {{agence_nom}}, {{agence_adresse}} (le « Responsable de traitement »), traite vos données personnelles dans le cadre de la gestion de votre réservation et de la relation contractuelle.
    </p>
    <div class="clause-title" style="margin-top:10px">9.2 Données collectées et finalités</div>
    <p>Les données collectées (nom, prénom, adresse, e-mail, téléphone, données de paiement) sont traitées pour :</p>
    <ul>
      <li>La gestion et l'exécution du présent contrat de location ;</li>
      <li>La gestion des paiements et de la garantie bancaire ;</li>
      <li>La conformité aux obligations légales (déclaration de taxe de séjour, obligations fiscales) ;</li>
      <li>La vérification d'identité aux fins de sécurité du logement.</li>
    </ul>
    <div class="clause-title" style="margin-top:10px">9.3 Durée de conservation</div>
    <p>
      Les données contractuelles sont conservées pendant <strong>5 ans</strong> à compter de la fin du séjour (obligations comptables). Les documents d'identité (photo de vérification et pièce d'identité) sont conservés pendant <strong>1 an</strong> à compter de la fin du séjour, puis supprimés définitivement. Les données de carte bancaire sont gérées exclusivement par Stripe — aucun numéro complet de carte n'est stocké par {{agence_nom}}.
    </p>
    <div class="clause-title" style="margin-top:10px">9.4 Droits du locataire</div>
    <p>
      Conformément au RGPD (Règlement UE 2016/679) et à la loi Informatique et Libertés, vous bénéficiez d'un droit d'accès, de rectification, de suppression et de portabilité de vos données, ainsi que d'un droit d'opposition au traitement. Pour exercer ces droits : {{agence_email_contact}}.
    </p>
    <div class="clause-title" style="margin-top:10px">9.5 Transfert vers des tiers</div>
    <p>
      Vos données sont partagées, dans la stricte limite du nécessaire, avec : Stripe Inc. (paiement, États-Unis — adequacy decision EU-US Data Privacy Framework), Twilio Inc. (vérification SMS), et les services hébergés sur Supabase (infrastructure Cloud, UE). Aucune donnée n'est vendue à des tiers.
    </p>
    <div class="clause-title" style="margin-top:10px">9.6 Sécurité des documents et vérification d'identité</div>
    <p>
      La photo de vérification prise lors de la signature fait l'objet d'un contrôle automatisé dont le seul objet est de vérifier qu'un visage est visible et exploitable (photo non vide, non floue, non prise sur un écran). Ce contrôle ne vise pas à identifier la personne : il ne comporte aucune reconnaissance faciale, aucune comparaison avec la pièce d'identité ni aucun traitement de données biométriques. Il repose sur l'intérêt légitime de {{agence_nom}} à prévenir la fraude et à sécuriser l'accès au logement, et ne peut à lui seul empêcher la signature : après deux nouvelles prises de vue, la photo est acceptée. Il est réalisé par notre sous-traitant Anthropic PBC (États-Unis), dans le cadre des clauses contractuelles types adoptées par la Commission européenne ; Anthropic n'utilise pas ces données pour entraîner ses modèles et les supprime dans un délai de 30 jours, sauf conservation plus longue imposée par la loi ou par le contrôle du respect de ses règles d'utilisation. La pièce d'identité ne lui est jamais transmise. La photo de vérification et la pièce d'identité sont marquées dès leur réception d'un filigrane « document destiné uniquement à la location saisonnière » et ne sont jamais conservées sans ce filigrane. Le contrat signé est scellé électroniquement par {{agence_nom}} : toute modification ultérieure du document est détectable.
    </p>
  </div>
</div>

<!-- ══ 10. ÉTAT DES LIEUX ════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">10</span>
    État des lieux
  </div>
  <div class="clause">
    <div class="clause-title">10.1 État des lieux d'entrée</div>
    <p>
      Un état des lieux contradictoire est réalisé à l'arrivée du locataire, en présence d'un représentant de l'agence ou par tout moyen équivalent (formulaire numérique, photos datées). Le locataire dispose d'un délai de <strong>24 heures</strong> à compter de la remise des clés pour signaler tout désordre ou réserve non mentionné dans l'état des lieux initial, par écrit à {{agence_email_contact}}.
    </p>
    <div class="clause-title" style="margin-top:10px">10.2 État des lieux de sortie</div>
    <p>
      À l'expiration du séjour, un état des lieux contradictoire de sortie est établi selon les mêmes modalités. Le bien doit être restitué dans l'état constaté à l'entrée, nettoyé, et conforme à l'inventaire joint. Toute dégradation constatée lors de la sortie, non mentionnée à l'entrée, sera imputée au locataire.
    </p>
    <p style="font-size:9pt;color:#8C7B65;">
      En l'absence du locataire lors de l'état des lieux de sortie, celui-ci sera établi contradictoirement par l'agence seule, et notifié au locataire dans les 48 heures par e-mail. Le locataire pourra formuler des observations dans les 5 jours suivant la notification.
    </p>
  </div>
</div>

<!-- ══ 11. RETENUES ET FRAIS DE REMISE EN ÉTAT ═════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">11</span>
    Retenues sur garantie et frais de remise en état
  </div>
  <div class="clause">
    <p>
      En cas de dégradation constatée à l'état des lieux de sortie, de manquement aux obligations du locataire, ou de frais supplémentaires engendrés, l'agence pourra procéder à un débit sur la carte bancaire enregistrée comme garantie (article 5), après justification et notification écrite au locataire, pour les motifs suivants :
    </p>
    <ul>
      <li><strong>Ménage non effectué ou insuffisant :</strong> facturation des frais de nettoyage réels (minimum 80 €).</li>
      <li><strong>Bien laissé dans un état de saleté avancée ou draps/serviettes fortement souillés :</strong> frais de traitement en sus (minimum 30 € par lot).</li>
      <li><strong>Objets cassés, détériorés ou manquants :</strong> remplacement ou réparation au coût réel justifié.</li>
      <li><strong>Déchets en quantité importante non évacués :</strong> frais d'enlèvement (minimum 50 €).</li>
      <li><strong>Clés non restituées :</strong> remplacement de serrure ou boîte à clé sécurisée (coût réel).</li>
      <li><strong>Occupation non autorisée (animaux, sur-occupation) :</strong> pénalité forfaitaire de 100 € plus 5 % du montant total du séjour, sans préjudice d'autres dommages.</li>
      <li><strong>Départ tardif non autorisé :</strong> pénalité de 10 % du prix d'une nuit par tranche de 10 minutes commencée après 10 minutes de tolérance, plafonnée au prix d'une nuit, plus les frais réels justifiés (article 3).</li>
    </ul>
    <p style="font-size:9pt;color:#8C7B65;margin-top:8px;">
      Tout débit sera précédé d'un e-mail de notification détaillant les motifs et les montants. Le locataire dispose de 7 jours pour contester par écrit. Le locataire peut présenter toute observation ou contestation dans un délai de 7 jours.
    </p>
  </div>
</div>

<!-- ══ 12. RÉPARATIONS URGENTES — ACCÈS AU LOGEMENT ════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">12</span>
    Réparations urgentes et accès au logement
  </div>
  <div class="clause">
    <p>
      Le locataire est tenu de signaler immédiatement à l'agence toute panne ou dégradation constatée. Il autorise expressément l'accès au logement par l'agence ou ses prestataires pour tout travail d'urgence nécessaire à la conservation du bien (fuite d'eau, panne de chauffage, problème électrique, etc.), même en son absence, après information préalable.
    </p>
    <p>
      Ces interventions urgentes n'ouvrent droit à aucune réduction du loyer, sauf si elles privaient le locataire de la jouissance d'une partie substantielle du logement pendant plus de 48 heures consécutives. Dans ce dernier cas, une réduction proportionnelle sera calculée d'un commun accord.
    </p>
  </div>
</div>

<!-- ══ 13. FORCE MAJEURE ════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">13</span>
    Force majeure
  </div>
  <div class="clause">
    <p>
      Ni le bailleur, ni l'agence ne pourront être tenus responsables de l'inexécution ou du retard dans l'exécution de leurs obligations en cas d'événement de force majeure au sens de l'article 1218 du Code civil (catastrophe naturelle, incendie, inondation, décision administrative, pandémie avec fermeture imposée par les autorités, etc.).
    </p>
    <p>
      En cas de force majeure rendant le logement inhabitable ou son accès impossible, les sommes versées par le locataire seront remboursées intégralement dans un délai de 15 jours, à l'exclusion de tout autre indemnité. Le locataire est invité à souscrire une assurance annulation pour se prémunir des cas non couverts par la force majeure légale. Les pannes temporaires de réseaux internet, de téléphonie, de télévision ou de services tiers ne constituent pas un cas d'inexécution contractuelle lorsqu'elles échappent au contrôle du bailleur.
    </p>
  </div>
</div>

<!-- ══ 14. DROIT APPLICABLE ET JURIDICTION COMPÉTENTE ══════════════ -->
<div class="section">
  <div class="section-title">
    <span class="section-title-num">14</span>
    Droit applicable, médiation et juridiction compétente
  </div>
  <div class="clause">
    <p>
      Le présent contrat est soumis au droit français. En cas de litige, les parties s'engagent à tenter une résolution amiable avant toute action en justice.
    </p>
    <p>
      Conformément aux articles L612-1 et suivants du Code de la consommation, en cas de litige non résolu après une réclamation écrite préalable auprès de l'agence, le locataire peut recourir gratuitement au médiateur de la consommation suivant : le Centre de la Médiation de la Consommation de Conciliateurs de Justice (CM2C), 49 rue de Ponthieu, 75008 Paris – www.cm2c.net (dépôt de la demande en ligne) – 01 89 47 00 14. La saisine du médiateur doit intervenir dans un délai d'un an à compter de la réclamation écrite adressée à l'agence.
    </p>
    <p>
      En cas de litige, les règles de compétence prévues par le Code de la consommation et le Code de procédure civile s'appliquent.
    </p>
  </div>
</div>

<!-- ══ SIGNATURES ════════════════════════════════════════════════════ -->
<div class="section avoid-break">
  <div class="section-title">
    <span class="section-title-num" style="background:linear-gradient(135deg,#2C2416,#4A3820)">✍</span>
    Signatures des parties
  </div>
  <div style="background:#FDFAF5;border:1px solid #E8DCC8;border-left:3px solid #CC9933;border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:9pt;color:#4A3F32;font-family:'Helvetica Neue',Arial,sans-serif;line-height:1.7">
    Le locataire reconnaît avoir pris connaissance de l'intégralité du présent contrat (y compris l'annexe descriptive), avoir eu la possibilité de poser toute question, et accepte sans réserve les termes et conditions définis ci-dessus. La signature électronique apposée ci-dessous a la même valeur juridique qu'une signature manuscrite (loi n° 2000-230 du 13 mars 2000, art. 1366 et 1367 du Code civil).
  </div>
  <div class="signature-grid">
    
    <div class="signature-block">
      <div class="signature-label">Pour le mandataire</div>
      <div class="signature-name">{{agence_representant}}</div>
      <div class="signature-note">{{agence_qualite_representant}} — {{agence_nom}}<br>{{agence_email_representant}}</div>
      <div style="margin-top:10px;text-align:center">
        <div style="font-size:8pt;color:#8C7B65;margin-bottom:4px">Signé électroniquement</div>
        <div style="font-family:'Northwell',cursive;font-size:20pt;color:#CC9933;line-height:1;padding:4px 0">Oihan Campandegui</div>
        <div style="font-size:7.5pt;color:#A09282;margin-top:2px">Président — Lauïan Immobilier</div>
      </div>
    </div>
    <div class="signature-block">
      <div class="signature-label">Locataire — signature électronique</div>
      <div class="signature-name">{{guest_civilite}} {{guest_nom_affiche}}</div>
      <div class="signature-note">Signature apposée via le portail sécurisé<br>contrat.destinationcotebasque.com</div>
      <div class="signature-line"></div>
    </div>
  </div>
</div>

<!-- ══ ANNEXE — ÉTAT DESCRIPTIF DU BIEN ═════════════════════════════ -->
<div class="page-break"></div>
<div class="header" style="margin-bottom:0;padding:20px 0 16px">
  <div class="header-left">
    <div class="logo-square" style="width:38px;height:38px;font-size:18px">L</div>
    <div class="header-brand">
      <div class="name" style="font-size:11pt">Lauïan Immobilier</div>
      <div class="sub">Annexe au contrat de location saisonnière</div>
    </div>
  </div>
  <div class="header-right">{{date_contrat_longue}}</div>
</div>
<div class="doc-title-block" style="padding:18px 0 14px;margin-bottom:20px">
  <div class="doc-title" style="font-size:12pt;letter-spacing:2px">État Descriptif du Bien</div>
  <div class="gold-line"></div>
  <div class="doc-subtitle">{{bien_nom_public}}</div>
  <div class="doc-subtitle" style="margin-top:2px;font-size:8.5pt;">{{bien_adresse_complete}}</div>
</div>
<div class="section">
  <div class="section-title">
    <span class="section-title-num">A</span>
    Caractéristiques générales
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:28%" class="annexe-label">Adresse</td>
      <td colspan="3">{{bien_adresse_complete}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Nature / Type</td>
      <td>{{bien_nature_label}}</td>
      <td style="width:28%" class="annexe-label">Classement</td>
      <td>{{bien_classement_label}}</td>
    </tr>
    {{#has_surface_pieces}}
    <tr>
      <td class="annexe-label">Surface</td>
      <td>{{#bien_superficie}}{{bien_superficie}} m²{{/bien_superficie}}</td>
      <td class="annexe-label">Nb pièces principales</td>
      <td>{{bien_nb_pieces}}</td>
    </tr>
    {{/has_surface_pieces}}
    {{#has_construction_etage}}
    <tr>
      <td class="annexe-label">Année de construction</td>
      <td>{{bien_date_construction}}</td>
      <td class="annexe-label">Étage</td>
      <td>{{bien_etage}}</td>
    </tr>
    {{/has_construction_etage}}
    <tr>
      <td class="annexe-label">Capacité d'accueil</td>
      <td>{{bien_capacite_max_label}} max.</td>
      {{#has_exposition}}
      <td class="annexe-label">Exposition</td>
      <td>{{bien_exposition}}</td>
      {{/has_exposition}}
      {{#has_no_exposition}}
      <td colspan="2"></td>
      {{/has_no_exposition}}
    </tr>
    {{#has_voisinage}}
    <tr>
      <td class="annexe-label">Environnement / Voisinage</td>
      <td colspan="3">{{bien_voisinage}}</td>
    </tr>
    {{/has_voisinage}}
    {{#a_piscine}}
    <tr>
      <td class="annexe-label">Équipements spéciaux</td>
      <td colspan="3">🏊 {{piscine_label}} — {{piscine_horaires_label}}</td>
    </tr>
    {{/a_piscine}}
  </table>

  {{#has_distances}}
  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">B</span>
    Distances et situation géographique
  </div>
  <table class="annexe-table">
    <thead>
      <tr>
        <th>Point de référence</th>
        <th>Distance approximative</th>
      </tr>
    </thead>
    <tbody>
      {{#bien_distance_mer}}
      <tr>
        <td>Mer / océan</td>
        <td>{{bien_distance_mer}}</td>
      </tr>
      {{/bien_distance_mer}}
      {{#bien_distance_plage}}
      <tr>
        <td>Plage la plus proche</td>
        <td>{{bien_distance_plage}}</td>
      </tr>
      {{/bien_distance_plage}}
      {{#bien_distance_gare}}
      <tr>
        <td>Gare</td>
        <td>{{bien_distance_gare}}</td>
      </tr>
      {{/bien_distance_gare}}
      {{#bien_distance_centre}}
      <tr>
        <td>Centre-ville</td>
        <td>{{bien_distance_centre}}</td>
      </tr>
      {{/bien_distance_centre}}
    </tbody>
  </table>
  {{/has_distances}}

  {{#has_description_pieces}}
  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">C</span>
    Description des pièces
  </div>
  <table class="annexe-table">
    <thead>
      <tr>
        <th>Pièce</th>
        <th>Description &amp; équipements</th>
      </tr>
    </thead>
    <tbody>
      {{#has_desc_sejour}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Séjour / Salon</td>
        <td>{{bien_description_sejour}}</td>
      </tr>
      {{/has_desc_sejour}}
      {{#has_desc_cuisine}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Cuisine</td>
        <td>{{bien_cuisine}}</td>
      </tr>
      {{/has_desc_cuisine}}
      {{#has_desc_sdb}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Salle de bain</td>
        <td>{{bien_sdb}}</td>
      </tr>
      {{/has_desc_sdb}}
      {{#has_desc_toilettes}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">Toilettes</td>
        <td>{{bien_toilettes}}</td>
      </tr>
      {{/has_desc_toilettes}}
      {{#has_desc_etat}}
      <tr>
        <td style="font-weight:700;white-space:nowrap">État général</td>
        <td>{{bien_etat_general}}</td>
      </tr>
      {{/has_desc_etat}}
    </tbody>
  </table>
  {{/has_description_pieces}}

  <div class="section-title" style="margin-top:20px">
    <span class="section-title-num">D</span>
    Heures d'accès (check-in / check-out)
  </div>
  <table class="annexe-table">
    <tr>
      <td style="width:50%" class="annexe-label">Heure d'arrivée (check-in)</td>
      <td>À partir de {{heure_arrivee}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Heure de départ (check-out)</td>
      <td>Avant {{heure_depart}}</td>
    </tr>
  </table>
</div>

{{#has_bien_photos}}
<div class="section" style="page-break-inside:avoid;break-inside:avoid;margin-top:20px">
  <div class="section-title">
    <span class="section-title-num" style="background:linear-gradient(135deg,#5C7FB0,#3B6FA0)">📷</span>
    Photos du bien
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px">
    {{#bien_photo_1}}<img src="{{bien_photo_1}}" style="width:100%;height:140px;object-fit:cover;border-radius:6px;border:1px solid #E8DCC8" alt="Photo du bien">{{/bien_photo_1}}
    {{#bien_photo_2}}<img src="{{bien_photo_2}}" style="width:100%;height:140px;object-fit:cover;border-radius:6px;border:1px solid #E8DCC8" alt="Photo du bien">{{/bien_photo_2}}
    {{#bien_photo_3}}<img src="{{bien_photo_3}}" style="width:100%;height:140px;object-fit:cover;border-radius:6px;border:1px solid #E8DCC8" alt="Photo du bien">{{/bien_photo_3}}
  </div>
</div>
{{/has_bien_photos}}

<!-- ══ PIED DE PAGE ═══════════════════════════════════════════════════ -->
<div class="footer">
  {{agence_nom}} — {{agence_adresse}} — {{agence_email_contact}} — Tél. {{agence_telephone_affiche}}<br>
  Carte Professionnelle {{agence_cpi}} délivrée par {{agence_cpi_delivree_par}} — RCS {{agence_rcs}} — TVA {{agence_tva}}<br>
  Assurance RCP : {{agence_assurance}} — Garantie financière : {{agence_garantie_galian}}<br>
  <em>Document généré automatiquement le {{date_contrat_longue}} — Signature électronique certifiée</em>
</div>

</div><!-- /.page -->
</body>
</html>
$tpl469$, $v$[]$v$::jsonb, false
where not exists (select 1 from contract_templates where agence='lauian' and langue='fr' and type_contrat='saisonnier' and version='2026-v6');

-- Bascule : seule la nouvelle version reste active pour chaque (agence, langue).
update contract_templates set is_active = (version = '2026-v6'), updated_at = now() where agence='dcb' and langue='en' and type_contrat='saisonnier' and version in ('2026-v5','2026-v6');
update contract_templates set is_active = (version = '2026-v6'), updated_at = now() where agence='dcb' and langue='es' and type_contrat='saisonnier' and version in ('2026-v5','2026-v6');
update contract_templates set is_active = (version = '2026-v8'), updated_at = now() where agence='dcb' and langue='fr' and type_contrat='saisonnier' and version in ('2026-v7','2026-v8');
update contract_templates set is_active = (version = '2026-v6'), updated_at = now() where agence='lauian' and langue='en' and type_contrat='saisonnier' and version in ('2026-v5','2026-v6');
update contract_templates set is_active = (version = '2026-v6'), updated_at = now() where agence='lauian' and langue='es' and type_contrat='saisonnier' and version in ('2026-v5','2026-v6');
update contract_templates set is_active = (version = '2026-v6'), updated_at = now() where agence='lauian' and langue='fr' and type_contrat='saisonnier' and version in ('2026-v5','2026-v6');
