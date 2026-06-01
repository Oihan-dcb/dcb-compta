-- Migration 177 — Seed template FR saisonnier 2026-v1
-- Insère le premier template HTML Mustache de contrat de location saisonnière.
-- Agence: dcb | Langue: fr | Type: saisonnier | Version: 2026-v1

INSERT INTO contract_templates (
  agence,
  langue,
  type_contrat,
  version,
  nom,
  contenu_html,
  variables_attendues,
  is_active
)
VALUES (
  'dcb',
  'fr',
  'saisonnier',
  '2026-v1',
  'Contrat de location saisonnière DCB — Français 2026',
  $TEMPLATE$
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Contrat de location saisonnière</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 10.5pt;
  color: #1C1C1C;
  line-height: 1.6;
  background: #fff;
}
.page { max-width: 800px; margin: 0 auto; padding: 0 20px; }
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 0 18px;
  border-bottom: 3px solid #CC9933;
  margin-bottom: 28px;
}
.header-left { display: flex; align-items: center; gap: 14px; }
.logo-square {
  width: 48px; height: 48px;
  background: #CC9933;
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 22px; font-weight: 700;
  font-family: 'Arial', sans-serif;
  flex-shrink: 0;
}
.header-brand { font-family: 'Arial', sans-serif; }
.header-brand .name { font-size: 14pt; font-weight: 700; color: #1C1C1C; }
.header-brand .sub  { font-size: 8.5pt; color: #8C7B65; letter-spacing: 1.5px; text-transform: uppercase; }
.header-right { text-align: right; font-family: 'Arial', sans-serif; font-size: 8pt; color: #8C7B65; line-height: 1.7; }
.doc-title {
  text-align: center;
  font-family: 'Arial', sans-serif;
  font-size: 15pt;
  font-weight: 700;
  color: #1C1C1C;
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-bottom: 6px;
}
.doc-subtitle {
  text-align: center;
  font-size: 9pt;
  color: #8C7B65;
  font-family: 'Arial', sans-serif;
  margin-bottom: 28px;
}
.gold-line { width: 60px; height: 2px; background: #CC9933; margin: 10px auto 24px; }
.section { margin-bottom: 26px; page-break-inside: avoid; }
.section-title {
  font-family: 'Arial', sans-serif;
  font-size: 9.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: #CC9933;
  border-bottom: 1px solid #E8DCC8;
  padding-bottom: 5px;
  margin-bottom: 14px;
}
.section-title-num {
  display: inline-block;
  background: #CC9933;
  color: #fff;
  border-radius: 50%;
  width: 20px; height: 20px;
  text-align: center;
  line-height: 20px;
  font-size: 9pt;
  margin-right: 8px;
  vertical-align: middle;
}
.parties-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 4px; }
.partie-box {
  background: #FDFAF5;
  border: 1px solid #E8DCC8;
  border-left: 3px solid #CC9933;
  border-radius: 4px;
  padding: 14px 16px;
}
.partie-label {
  font-family: 'Arial', sans-serif;
  font-size: 8pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #8C7B65;
  margin-bottom: 8px;
}
.partie-nom { font-size: 11pt; font-weight: 700; color: #1C1C1C; margin-bottom: 4px; }
.partie-detail { font-size: 9pt; color: #4A3F32; line-height: 1.7; }
.financial-table { width: 100%; border-collapse: collapse; font-family: 'Arial', sans-serif; font-size: 9.5pt; margin-bottom: 4px; }
.financial-table th {
  background: #F5EFE0; color: #8C7B65; font-size: 8pt; font-weight: 700;
  text-transform: uppercase; letter-spacing: .8px;
  padding: 7px 12px; text-align: left; border: 1px solid #E8DCC8;
}
.financial-table td { padding: 9px 12px; border: 1px solid #E8DCC8; vertical-align: top; }
.financial-table tr:nth-child(even) td { background: #FDFAF5; }
.amount { font-weight: 700; color: #1C1C1C; text-align: right; }
.garantie-box {
  background: #F0F8F0;
  border: 1px solid #A8D5B5;
  border-left: 4px solid #2D7D46;
  border-radius: 4px;
  padding: 14px 16px;
  margin: 12px 0;
  font-size: 9.5pt;
  line-height: 1.65;
  color: #1C1C1C;
}
.garantie-box strong { color: #1A5C33; }
.garantie-icon { font-size: 13pt; margin-right: 6px; vertical-align: middle; }
.clause { margin-bottom: 16px; page-break-inside: avoid; }
.clause-title { font-family: 'Arial', sans-serif; font-size: 9.5pt; font-weight: 700; color: #1C1C1C; margin-bottom: 5px; }
.clause p { font-size: 9.5pt; color: #2C2416; margin-bottom: 5px; line-height: 1.6; }
.clause ul, .clause ol { padding-left: 18px; margin: 5px 0; }
.clause li { font-size: 9.5pt; color: #2C2416; margin-bottom: 3px; line-height: 1.6; }
.annexe-table { width: 100%; border-collapse: collapse; font-family: 'Arial', sans-serif; font-size: 9pt; margin-bottom: 12px; }
.annexe-table th {
  background: #F5EFE0; color: #8C7B65; font-size: 8pt; font-weight: 700;
  text-transform: uppercase; letter-spacing: .8px;
  padding: 6px 10px; border: 1px solid #E8DCC8; text-align: left;
}
.annexe-table td { padding: 7px 10px; border: 1px solid #E8DCC8; vertical-align: top; }
.annexe-table tr:nth-child(even) td { background: #FDFAF5; }
.annexe-label { color: #8C7B65; font-size: 8pt; }
.signature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 20px; }
.signature-block { border: 1px solid #E8DCC8; border-radius: 4px; padding: 16px; min-height: 100px; }
.signature-label { font-family: 'Arial', sans-serif; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; color: #8C7B65; margin-bottom: 6px; }
.signature-name { font-weight: 700; font-size: 10pt; color: #1C1C1C; }
.signature-note { font-size: 8pt; color: #8C7B65; margin-top: 4px; }
.signature-line { border-bottom: 1px dashed #D9CEB8; height: 50px; margin-top: 12px; }
.footer {
  margin-top: 30px; padding-top: 14px;
  border-top: 1px solid #E8DCC8;
  font-family: 'Arial', sans-serif; font-size: 7.5pt; color: #A09282; line-height: 1.7; text-align: center;
}
.page-break { page-break-before: always; }
.avoid-break { page-break-inside: avoid; }
.notice { background: #FFF9ED; border: 1px solid #F0D87A; border-radius: 4px; padding: 10px 14px; font-size: 9pt; color: #7A5C1E; margin-bottom: 14px; font-family: 'Arial', sans-serif; }
</style>
</head>
<body>
<div class="page">
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
    Tél. {{agence_telephone}}<br>
    {{agence_email}}<br>
    RCS {{agence_rcs}}
  </div>
</div>
<div class="doc-title">Contrat de Location Saisonnière</div>
<div class="gold-line"></div>
<div class="doc-subtitle">Établi à {{lieu_signature}}, le {{date_contrat_longue}}</div>
<div class="section">
  <div class="section-title"><span class="section-title-num">1</span>Parties au contrat</div>
  <div class="parties-grid">
    <div class="partie-box">
      <div class="partie-label">Bailleur (propriétaire)</div>
      <div class="partie-nom">{{bailleur_nom_complet}}</div>
      <div class="partie-detail">{{bailleur_statut}}<br>{{bailleur_adresse_complete}}</div>
    </div>
    <div class="partie-box">
      <div class="partie-label">Mandataire — Agence de gestion</div>
      <div class="partie-nom">{{agence_nom}}</div>
      <div class="partie-detail">
        {{agence_adresse}}<br>Tél. {{agence_telephone}}<br>{{agence_email}}<br>
        RCS {{agence_rcs}} — CPI {{agence_cpi}}<br>délivré par {{agence_cpi_delivree_par}}<br>
        Capital social : {{agence_capital}} €<br>TVA : {{agence_tva}}<br>
        Représenté par {{agence_representant}}, {{agence_qualite_representant}}
      </div>
    </div>
  </div>
  <div class="partie-box" style="margin-top:14px">
    <div class="partie-label">Locataire</div>
    <div class="partie-nom">{{guest_civilite}} {{guest_nom_complet}}</div>
    <div class="partie-detail">
      Adresse : {{guest_adresse_complete}}<br>
      E-mail : {{guest_email}}&nbsp;&nbsp;·&nbsp;&nbsp;Téléphone : {{guest_telephone}}<br>
      Nombre de personnes prévues : <strong>{{guest_nb_personnes}}</strong>
    </div>
  </div>
</div>
<div class="section">
  <div class="section-title"><span class="section-title-num">2</span>Désignation du bien loué</div>
  <table class="annexe-table">
    <tr>
      <td style="width:35%" class="annexe-label">Nature du bien</td><td>{{bien_nature}}</td>
      <td style="width:30%" class="annexe-label">Classement</td><td>{{bien_classement}}</td>
    </tr>
    <tr><td class="annexe-label">Adresse complète</td><td colspan="3">{{bien_adresse_complete}}</td></tr>
    <tr>
      <td class="annexe-label">Propriétaire</td><td>{{bien_proprio_nom}}</td>
      <td class="annexe-label">Capacité maximale</td><td>{{bien_capacite_max}} personnes</td>
    </tr>
    <tr>
      <td class="annexe-label">Surface habitable</td><td>{{bien_superficie}} m²</td>
      <td class="annexe-label">Nombre de pièces</td><td>{{bien_nb_pieces}} pièces</td>
    </tr>
    <tr>
      <td class="annexe-label">Année de construction</td><td>{{bien_date_construction}}</td>
      <td class="annexe-label">Étage</td><td>{{bien_etage}}</td>
    </tr>
    {{#a_piscine}}
    <tr><td class="annexe-label">Équipements spéciaux</td><td colspan="3">🏊 Piscine privative incluse dans la location</td></tr>
    {{/a_piscine}}
  </table>
</div>
<div class="section">
  <div class="section-title"><span class="section-title-num">3</span>Période de location</div>
  <table class="annexe-table">
    <tr><td style="width:30%" class="annexe-label">Arrivée</td><td><strong>{{date_arrivee_longue}}</strong> à partir de {{heure_arrivee}}</td></tr>
    <tr><td class="annexe-label">Départ</td><td><strong>{{date_depart_longue}}</strong> avant {{heure_depart}}</td></tr>
    <tr><td class="annexe-label">Durée du séjour</td><td><strong>{{nb_nuits}} nuit(s)</strong></td></tr>
  </table>
  <p style="font-size:9pt;color:#8C7B65;margin-top:8px;font-family:Arial,sans-serif;">La remise des clés s'effectue selon les modalités communiquées par l'agence (boîte à clé sécurisée ou accueil sur place). Le locataire s'engage à restituer le bien propre et dans l'état dans lequel il l'a trouvé, à l'heure fixée ci-dessus.</p>
</div>
<div class="section">
  <div class="section-title"><span class="section-title-num">4</span>Conditions financières</div>
  <table class="financial-table">
    <thead><tr><th>Désignation</th><th style="text-align:right">Montant</th><th>Modalité de paiement</th></tr></thead>
    <tbody>
      <tr>
        <td>Loyer saisonnier total (toutes charges comprises)</td>
        <td class="amount">{{montant_loyer_eur}}</td>
        <td style="font-size:9pt">Virement bancaire ou paiement en ligne</td>
      </tr>
      <tr>
        <td>Acompte à la réservation ({{acompte_pourcentage}}%)</td>
        <td class="amount">{{acompte_montant_eur}}</td>
        <td style="font-size:9pt">Dû à la signature du présent contrat</td>
      </tr>
      <tr>
        <td>Taxe de séjour</td>
        <td class="amount">{{taxe_sejour_eur}}</td>
        <td style="font-size:9pt">Collectée et reversée à la commune</td>
      </tr>
    </tbody>
  </table>
  <div class="notice" style="margin-top:12px">⚠️ Tout retard ou annulation de paiement pourra entraîner la résiliation du contrat, selon les conditions énoncées à l'article 8.</div>
</div>
<div class="section">
  <div class="section-title"><span class="section-title-num">5</span>Garantie bancaire — Empreinte CB</div>
  <div class="garantie-box">
    <span class="garantie-icon">🔐</span>
    <strong>Empreinte bancaire hôtelière (Stripe SetupIntent)</strong><br><br>
    {{garantie_clause}}
  </div>
  <p style="font-size:8.5pt;color:#8C7B65;font-family:Arial,sans-serif;margin-top:8px;">La carte bancaire est enregistrée de manière sécurisée via Stripe (PCI-DSS niveau 1). Aucun numéro de carte n'est stocké par Destination Côte Basque.</p>
</div>
<div class="section">
  <div class="section-title"><span class="section-title-num">6</span>Obligations du locataire</div>
  <div class="clause">
    <p>Le locataire s'engage à :</p>
    <ul>
      <li>Occuper les lieux personnellement, de manière paisible, en « bon père de famille », et de manière conforme à leur destination d'habitation saisonnière temporaire.</li>
      <li>Ne pas sous-louer ni céder le présent contrat, partiellement ou totalement, sans accord écrit préalable du bailleur.</li>
      <li>Respecter scrupuleusement le nombre maximum de personnes autorisé ({{bien_capacite_max}} personnes). Toute occupation supplémentaire est formellement interdite sans autorisation écrite.</li>
      <li>Ne pas introduire d'animaux dans le logement sauf autorisation explicite écrite de l'agence.</li>
      <li>Respecter les règles de voisinage, notamment le calme et la tranquillité entre 22h00 et 8h00.</li>
      <li>Ne pratiquer aucune activité commerciale ou professionnelle dans le logement.</li>
      <li>Signaler immédiatement toute dégradation ou panne constatée à l'agence.</li>
      <li>Restituer le logement dans l'état d'inventaire initial : vaisselle propre, électroménager nettoyé, déchets évacués, linge de lit retiré.</li>
      <li>Ne pas fumer à l'intérieur du logement.</li>
      {{#a_piscine}}<li>Respecter les règles de sécurité liées à la piscine : ne pas laisser de mineurs sans surveillance, ne pas utiliser la piscine entre 23h00 et 7h00.</li>{{/a_piscine}}
    </ul>
  </div>
</div>
<div class="section">
  <div class="section-title"><span class="section-title-num">7</span>Assurance villégiature</div>
  <div class="clause">
    <p>Le locataire déclare être couvert par une assurance <strong>responsabilité civile villégiature</strong> (dommages aux tiers, incendie, dégât des eaux, vol) valable pendant toute la durée du séjour.</p>
    <p>À défaut de contrat d'assurance habitation incluant la garantie villégiature, le locataire s'engage à souscrire une assurance temporaire avant la date d'entrée dans les lieux. L'agence se réserve le droit de refuser l'accès au logement en cas de défaut de couverture attesté.</p>
    <p style="font-size:9pt;color:#8C7B65;">Note : l'assurance de l'agence couvre uniquement la responsabilité civile professionnelle de {{agence_nom}} (assurance {{agence_assurance}}). Elle ne se substitue pas à l'assurance personnelle du locataire.</p>
  </div>
</div>
<div class="section">
  <div class="section-title"><span class="section-title-num">8</span>Conditions d'annulation et de résiliation</div>
  <div class="clause">
    <p>Toute annulation doit être notifiée par écrit (e-mail à {{agence_email}}) :</p>
    <ul>
      <li><strong>Plus de 60 jours avant l'arrivée :</strong> remboursement de l'acompte déduction faite des frais de dossier (80 €).</li>
      <li><strong>Entre 30 et 60 jours avant l'arrivée :</strong> l'acompte versé reste acquis au bailleur à titre de clause pénale.</li>
      <li><strong>Moins de 30 jours avant l'arrivée :</strong> la totalité du loyer reste due. En cas de non-relouage, l'intégralité du séjour sera facturée.</li>
    </ul>
    <p>En cas de résiliation par le bailleur ou l'agence pour raison indépendante de la volonté du locataire, les sommes versées seront intégralement remboursées dans un délai de 15 jours.</p>
  </div>
</div>
<div class="section">
  <div class="section-title"><span class="section-title-num">9</span>Protection des données personnelles (RGPD)</div>
  <div class="clause">
    <div class="clause-title">9.1 Responsable du traitement</div>
    <p>{{agence_nom}}, {{agence_adresse}} (le « Responsable de traitement »), traite vos données personnelles dans le cadre de la gestion de votre réservation et de la relation contractuelle.</p>
    <div class="clause-title" style="margin-top:10px">9.2 Données collectées et finalités</div>
    <p>Les données collectées (nom, prénom, adresse, e-mail, téléphone, données de paiement) sont traitées pour :</p>
    <ul>
      <li>La gestion et l'exécution du présent contrat de location ;</li>
      <li>La gestion des paiements et de la garantie bancaire ;</li>
      <li>La conformité aux obligations légales (déclaration de taxe de séjour, obligations fiscales) ;</li>
      <li>La vérification d'identité aux fins de sécurité du logement.</li>
    </ul>
    <div class="clause-title" style="margin-top:10px">9.3 Durée de conservation</div>
    <p>Les données contractuelles sont conservées pendant <strong>5 ans</strong> à compter de la fin du séjour. La photo d'identité est conservée pendant la durée du séjour puis supprimée dans un délai de 30 jours. Les données de carte bancaire sont gérées exclusivement par Stripe — aucun numéro complet de carte n'est stocké par {{agence_nom}}.</p>
    <div class="clause-title" style="margin-top:10px">9.4 Droits du locataire</div>
    <p>Conformément au RGPD (Règlement UE 2016/679) et à la loi Informatique et Libertés, vous bénéficiez d'un droit d'accès, de rectification, de suppression et de portabilité de vos données, ainsi que d'un droit d'opposition au traitement. Pour exercer ces droits : {{agence_email}}.</p>
    <div class="clause-title" style="margin-top:10px">9.5 Transfert vers des tiers</div>
    <p>Vos données sont partagées, dans la stricte limite du nécessaire, avec : Stripe Inc. (paiement, États-Unis — EU-US Data Privacy Framework), Twilio Inc. (vérification SMS), et les services hébergés sur Supabase (infrastructure Cloud, UE). Aucune donnée n'est vendue à des tiers.</p>
  </div>
</div>
<div class="section">
  <div class="section-title"><span class="section-title-num">10</span>Droit applicable et juridiction compétente</div>
  <div class="clause">
    <p>Le présent contrat est soumis au droit français. En cas de litige, les parties s'engagent à tenter une résolution amiable avant toute action en justice.</p>
    <p>À défaut d'accord amiable, le Tribunal Judiciaire de Bayonne sera seul compétent, sauf disposition impérative contraire applicable au locataire consommateur.</p>
  </div>
</div>
<div class="section avoid-break">
  <div class="section-title">Signatures des parties</div>
  <p style="font-size:9pt;color:#4A3F32;margin-bottom:14px;font-family:Arial,sans-serif;">Le locataire reconnaît avoir pris connaissance de l'intégralité du présent contrat (y compris l'annexe descriptive), avoir eu la possibilité de poser toute question, et accepte sans réserve les termes et conditions définis ci-dessus.</p>
  <div class="signature-grid">
    <div class="signature-block">
      <div class="signature-label">Pour le bailleur / mandataire</div>
      <div class="signature-name">{{agence_nom}}</div>
      <div class="signature-note">Représenté par {{agence_representant}}, {{agence_qualite_representant}}</div>
      <div class="signature-line"></div>
    </div>
    <div class="signature-block">
      <div class="signature-label">Locataire — signature électronique</div>
      <div class="signature-name">{{guest_civilite}} {{guest_nom_complet}}</div>
      <div class="signature-note">Signature apposée via le portail sécurisé contrat.destinationcotebasque.com</div>
      <div class="signature-line"></div>
    </div>
  </div>
</div>
<div class="page-break"></div>
<div class="section">
  <div class="doc-title" style="font-size:13pt;margin-bottom:6px">Annexe — État Descriptif du Bien</div>
  <div class="gold-line"></div>
  <div class="doc-subtitle" style="margin-bottom:20px">{{bien_adresse_complete}}</div>
  <div class="section-title">Caractéristiques générales</div>
  <table class="annexe-table">
    <tr>
      <td style="width:28%" class="annexe-label">Adresse</td><td colspan="3">{{bien_adresse_complete}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Nature / Type</td><td>{{bien_nature}}</td>
      <td style="width:28%" class="annexe-label">Classement</td><td>{{bien_classement}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Surface</td><td>{{bien_superficie}} m²</td>
      <td class="annexe-label">Nb pièces principales</td><td>{{bien_nb_pieces}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Année de construction</td><td>{{bien_date_construction}}</td>
      <td class="annexe-label">Étage</td><td>{{bien_etage}}</td>
    </tr>
    <tr>
      <td class="annexe-label">Capacité d'accueil</td><td>{{bien_capacite_max}} personnes max.</td>
      <td class="annexe-label">Exposition</td><td>{{bien_exposition}}</td>
    </tr>
    <tr><td class="annexe-label">Environnement / Voisinage</td><td colspan="3">{{bien_voisinage}}</td></tr>
    {{#a_piscine}}
    <tr><td class="annexe-label">Équipements spéciaux</td><td colspan="3">Piscine privée — usage réservé aux occupants du logement</td></tr>
    {{/a_piscine}}
  </table>
  <div class="section-title" style="margin-top:18px">Distances et situation géographique</div>
  <table class="annexe-table">
    <thead><tr><th>Point de référence</th><th>Distance approximative</th></tr></thead>
    <tbody>
      <tr><td>Mer / océan</td><td>{{bien_distance_mer}}</td></tr>
      <tr><td>Plage la plus proche</td><td>{{bien_distance_plage}}</td></tr>
      <tr><td>Gare</td><td>{{bien_distance_gare}}</td></tr>
      <tr><td>Centre-ville</td><td>{{bien_distance_centre}}</td></tr>
    </tbody>
  </table>
  <div class="section-title" style="margin-top:18px">Description des pièces</div>
  <table class="annexe-table">
    <thead><tr><th>Pièce</th><th>Description &amp; équipements</th></tr></thead>
    <tbody>
      <tr><td style="font-weight:700;white-space:nowrap">Séjour / Salon</td><td>{{bien_description_sejour}}</td></tr>
      <tr><td style="font-weight:700;white-space:nowrap">Cuisine</td><td>{{bien_cuisine}}</td></tr>
      <tr><td style="font-weight:700;white-space:nowrap">Salle de bain</td><td>{{bien_sdb}}</td></tr>
      <tr><td style="font-weight:700;white-space:nowrap">Toilettes</td><td>{{bien_toilettes}}</td></tr>
      <tr><td style="font-weight:700;white-space:nowrap">État général</td><td>{{bien_etat_general}}</td></tr>
    </tbody>
  </table>
  <div class="section-title" style="margin-top:18px">Heures d'accès</div>
  <table class="annexe-table">
    <tr><td style="width:50%" class="annexe-label">Heure d'arrivée (check-in)</td><td>À partir de {{heure_arrivee}}</td></tr>
    <tr><td class="annexe-label">Heure de départ (check-out)</td><td>Avant {{heure_depart}}</td></tr>
  </table>
</div>
<div class="footer">
  {{agence_nom}} — {{agence_adresse}} — {{agence_email}} — Tél. {{agence_telephone}}<br>
  Carte Professionnelle {{agence_cpi}} délivrée par {{agence_cpi_delivree_par}} — RCS {{agence_rcs}} — TVA {{agence_tva}}<br>
  Assurance RCP : {{agence_assurance}} — Garantie financière : {{agence_garantie_galian}}<br>
  <em>Document généré automatiquement le {{date_contrat_longue}} — Signature électronique certifiée</em>
</div>
</div>
</body>
</html>
$TEMPLATE$,
  '[
    "bailleur_nom_complet","bailleur_statut","bailleur_adresse_complete",
    "agence_nom","agence_adresse","agence_telephone","agence_email","agence_rcs","agence_capital",
    "agence_cpi","agence_cpi_delivree_par","agence_tva","agence_assurance","agence_garantie_galian",
    "agence_representant","agence_qualite_representant",
    "guest_civilite","guest_nom_complet","guest_email","guest_telephone","guest_adresse_complete","guest_nb_personnes",
    "bien_nature","bien_adresse_complete","bien_capacite_max","bien_proprio_nom","bien_date_construction",
    "bien_classement","bien_nb_pieces","bien_superficie","bien_etage","bien_distance_mer","bien_distance_plage",
    "bien_distance_gare","bien_distance_centre","bien_exposition","bien_voisinage",
    "bien_cuisine","bien_sdb","bien_toilettes","bien_description_sejour","bien_etat_general",
    "date_arrivee_longue","heure_arrivee","date_depart_longue","heure_depart","nb_nuits",
    "montant_loyer_eur","acompte_pourcentage","acompte_montant_eur","taxe_sejour_eur",
    "garantie_clause","date_contrat_longue","lieu_signature"
  ]'::jsonb,
  true
)
ON CONFLICT (agence, langue, type_contrat, version) DO UPDATE SET
  contenu_html        = EXCLUDED.contenu_html,
  variables_attendues = EXCLUDED.variables_attendues,
  nom                 = EXCLUDED.nom,
  is_active           = EXCLUDED.is_active,
  updated_at          = now();
