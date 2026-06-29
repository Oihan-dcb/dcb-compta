-- 214_assurance_art7_refonte.sql
-- Refonte de l'Article 7 (assurance villégiature) des contrats saisonniers (2026-06-29).
-- Déjà appliqué en prod via l'éditeur ; ce fichier rend le changement reproductible
-- (idempotent : les replace/regexp_replace ne matchent plus une fois appliqués).
--
-- 1. Bug glyphe : ☑/☐ (U+2611/U+2610) ne s'affichaient PAS dans le PDF Chromium
--    (police sans ces glyphes) → aucune case visible sur le contrat. Remplacés par
--    une case CSS + lettre "X" (rendu garanti).
-- 2. Wording : option "j'ai une assurance" reformulée (attestation sur demande),
--    déclaration "sans assurance" renforcée (responsabilité + acceptation de poursuivre).
-- 3. Phrase CGV de responsabilité ajoutée ; intro neutralisée ; paragraphe
--    "À défaut… refuser l'accès" retiré (contradictoire). Lauian harmonisé (ajout
--    du conditionnel is_booking_platform + de la case no_insurance).
-- Périmètre : type_contrat='saisonnier', is_active, agences dcb + lauian, langues fr/en/es.

-- ── 1. Fix glyphe ☑/☐ → case CSS + X (toutes langues) ─────────────────────────
update contract_templates
set contenu_html = replace(replace(replace(contenu_html,
  '{{#assurance_choice_mrh}}☑{{/assurance_choice_mrh}}{{^assurance_choice_mrh}}☐{{/assurance_choice_mrh}}',
  '{{#assurance_choice_mrh}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #1a1a1a;background:#1a1a1a;color:#fff;text-align:center;line-height:11px;font-size:9px;font-weight:700;vertical-align:middle">X</span>{{/assurance_choice_mrh}}{{^assurance_choice_mrh}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #8a8a8a;vertical-align:middle"></span>{{/assurance_choice_mrh}}'),
  '{{#assurance_choice_platform}}☑{{/assurance_choice_platform}}{{^assurance_choice_platform}}☐{{/assurance_choice_platform}}',
  '{{#assurance_choice_platform}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #1a1a1a;background:#1a1a1a;color:#fff;text-align:center;line-height:11px;font-size:9px;font-weight:700;vertical-align:middle">X</span>{{/assurance_choice_platform}}{{^assurance_choice_platform}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #8a8a8a;vertical-align:middle"></span>{{/assurance_choice_platform}}'),
  '{{#assurance_choice_no_insurance}}☑{{/assurance_choice_no_insurance}}{{^assurance_choice_no_insurance}}☐{{/assurance_choice_no_insurance}}',
  '{{#assurance_choice_no_insurance}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #1a1a1a;background:#1a1a1a;color:#fff;text-align:center;line-height:11px;font-size:9px;font-weight:700;vertical-align:middle">X</span>{{/assurance_choice_no_insurance}}{{^assurance_choice_no_insurance}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #8a8a8a;vertical-align:middle"></span>{{/assurance_choice_no_insurance}}'),
    updated_at = now()
where is_active and type_contrat = 'saisonnier';

-- ── 2. FR : intro neutralisée + bloc options harmonisé + phrase CGV ───────────
update contract_templates
set contenu_html = replace(contenu_html,
  'Le locataire déclare être couvert par une assurance <strong>responsabilité civile villégiature</strong> (dommages aux tiers, incendie, dégât des eaux, vol) valable pendant toute la durée du séjour.',
  'L''assurance <strong>responsabilité civile villégiature</strong> couvre les dommages pouvant être causés au logement, à son contenu et aux tiers (incendie, dégât des eaux, vol, casse) pendant le séjour. Le locataire indique ci-dessous sa situation au regard de cette garantie :')
where is_active and type_contrat = 'saisonnier' and langue = 'fr';

update contract_templates
set contenu_html = regexp_replace(contenu_html,
  '<div style="margin:14px 0;display:flex;flex-direction:column;gap:6px;font-size:10pt">.*?</p>',
  $rep$<div style="margin:14px 0;display:flex;flex-direction:column;gap:6px;font-size:10pt">
{{#is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_platform}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #1a1a1a;background:#1a1a1a;color:#fff;text-align:center;line-height:11px;font-size:9px;font-weight:700;vertical-align:middle">X</span>{{/assurance_choice_platform}}{{^assurance_choice_platform}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #8a8a8a;vertical-align:middle"></span>{{/assurance_choice_platform}}</span>
        <span>Couverture villégiature incluse via la plateforme de réservation ({{assurance_platform_name}})</span>
      </div>
{{/is_booking_platform}}
{{^is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_mrh}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #1a1a1a;background:#1a1a1a;color:#fff;text-align:center;line-height:11px;font-size:9px;font-weight:700;vertical-align:middle">X</span>{{/assurance_choice_mrh}}{{^assurance_choice_mrh}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #8a8a8a;vertical-align:middle"></span>{{/assurance_choice_mrh}}</span>
        <span>Je dispose d'une assurance villégiature couvrant la période du séjour et pourrai fournir une attestation sur demande.</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_no_insurance}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #1a1a1a;background:#1a1a1a;color:#fff;text-align:center;line-height:11px;font-size:9px;font-weight:700;vertical-align:middle">X</span>{{/assurance_choice_no_insurance}}{{^assurance_choice_no_insurance}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #8a8a8a;vertical-align:middle"></span>{{/assurance_choice_no_insurance}}</span>
        <span>Je déclare ne pas bénéficier d'une garantie villégiature couvrant les dommages pouvant être causés au logement loué pendant mon séjour. J'ai été informé(e) que je pourrais être tenu(e) personnellement responsable des dommages matériels causés au logement, à son mobilier ou aux tiers pendant la durée de la location, et j'accepte de poursuivre la réservation sans cette couverture.</span>
      </div>
{{/is_booking_platform}}
    </div>
    <p style="font-weight:700">
      L'absence d'assurance villégiature n'exonère en aucun cas le locataire de sa responsabilité en cas de dommages causés au logement ou à son contenu.
    </p>$rep$)
where is_active and type_contrat = 'saisonnier' and langue = 'fr';

-- ── 3. EN ────────────────────────────────────────────────────────────────────
update contract_templates
set contenu_html = replace(contenu_html,
  'The tenant declares being covered by a <strong>holiday liability insurance</strong> (third-party damage, fire, water damage, theft) valid for the entire duration of the stay.',
  'The <strong>holiday liability insurance</strong> covers damage that may be caused to the accommodation, its contents and to third parties (fire, water damage, theft, breakage) during the stay. The tenant indicates below their situation regarding this coverage:')
where is_active and type_contrat = 'saisonnier' and langue = 'en';

update contract_templates
set contenu_html = regexp_replace(contenu_html,
  '<div style="margin:14px 0;display:flex;flex-direction:column;gap:6px;font-size:10pt">.*?</p>',
  $rep$<div style="margin:14px 0;display:flex;flex-direction:column;gap:6px;font-size:10pt">
{{#is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_platform}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #1a1a1a;background:#1a1a1a;color:#fff;text-align:center;line-height:11px;font-size:9px;font-weight:700;vertical-align:middle">X</span>{{/assurance_choice_platform}}{{^assurance_choice_platform}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #8a8a8a;vertical-align:middle"></span>{{/assurance_choice_platform}}</span>
        <span>Holiday coverage included via the booking platform ({{assurance_platform_name}})</span>
      </div>
{{/is_booking_platform}}
{{^is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_mrh}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #1a1a1a;background:#1a1a1a;color:#fff;text-align:center;line-height:11px;font-size:9px;font-weight:700;vertical-align:middle">X</span>{{/assurance_choice_mrh}}{{^assurance_choice_mrh}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #8a8a8a;vertical-align:middle"></span>{{/assurance_choice_mrh}}</span>
        <span>I hold a holiday liability insurance covering the period of the stay and can provide a certificate upon request.</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_no_insurance}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #1a1a1a;background:#1a1a1a;color:#fff;text-align:center;line-height:11px;font-size:9px;font-weight:700;vertical-align:middle">X</span>{{/assurance_choice_no_insurance}}{{^assurance_choice_no_insurance}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #8a8a8a;vertical-align:middle"></span>{{/assurance_choice_no_insurance}}</span>
        <span>I declare that I do not hold any holiday liability insurance covering damage that may be caused to the rented accommodation during my stay. I have been informed that I may be held personally liable for any material damage caused to the accommodation, its furnishings or to third parties during the rental period, and I agree to proceed with the booking without such coverage.</span>
      </div>
{{/is_booking_platform}}
    </div>
    <p style="font-weight:700">
      The absence of holiday insurance does not in any way release the tenant from liability for any damage caused to the accommodation or its contents.
    </p>$rep$)
where is_active and type_contrat = 'saisonnier' and langue = 'en';

-- ── 4. ES ────────────────────────────────────────────────────────────────────
update contract_templates
set contenu_html = replace(contenu_html,
  'El arrendatario declara estar cubierto por un seguro de <strong>responsabilidad civil vacacional</strong> (daños a terceros, incendio, daños por agua, robo) válido durante toda la duración de la estancia.',
  'El seguro de <strong>responsabilidad civil vacacional</strong> cubre los daños que puedan causarse a la vivienda, a su contenido y a terceros (incendio, daños por agua, robo, rotura) durante la estancia. El arrendatario indica a continuación su situación respecto a esta garantía:')
where is_active and type_contrat = 'saisonnier' and langue = 'es';

update contract_templates
set contenu_html = regexp_replace(contenu_html,
  '<div style="margin:14px 0;display:flex;flex-direction:column;gap:6px;font-size:10pt">.*?</p>',
  $rep$<div style="margin:14px 0;display:flex;flex-direction:column;gap:6px;font-size:10pt">
{{#is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_platform}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #1a1a1a;background:#1a1a1a;color:#fff;text-align:center;line-height:11px;font-size:9px;font-weight:700;vertical-align:middle">X</span>{{/assurance_choice_platform}}{{^assurance_choice_platform}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #8a8a8a;vertical-align:middle"></span>{{/assurance_choice_platform}}</span>
        <span>Cobertura vacacional incluida a través de la plataforma de reserva ({{assurance_platform_name}})</span>
      </div>
{{/is_booking_platform}}
{{^is_booking_platform}}
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_mrh}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #1a1a1a;background:#1a1a1a;color:#fff;text-align:center;line-height:11px;font-size:9px;font-weight:700;vertical-align:middle">X</span>{{/assurance_choice_mrh}}{{^assurance_choice_mrh}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #8a8a8a;vertical-align:middle"></span>{{/assurance_choice_mrh}}</span>
        <span>Dispongo de un seguro de responsabilidad civil vacacional que cubre el periodo de la estancia y podré facilitar un certificado a petición.</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;padding:7px 12px;border:1px solid #E8DDD0;border-radius:4px">
        <span style="font-size:13pt;flex-shrink:0;line-height:1">{{#assurance_choice_no_insurance}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #1a1a1a;background:#1a1a1a;color:#fff;text-align:center;line-height:11px;font-size:9px;font-weight:700;vertical-align:middle">X</span>{{/assurance_choice_no_insurance}}{{^assurance_choice_no_insurance}}<span style="display:inline-block;width:11px;height:11px;border:1.4px solid #8a8a8a;vertical-align:middle"></span>{{/assurance_choice_no_insurance}}</span>
        <span>Declaro no disponer de un seguro de responsabilidad civil vacacional que cubra los daños que puedan causarse a la vivienda alquilada durante mi estancia. He sido informado(a) de que podría ser considerado(a) personalmente responsable de los daños materiales causados a la vivienda, a su mobiliario o a terceros durante el periodo de alquiler, y acepto continuar con la reserva sin dicha cobertura.</span>
      </div>
{{/is_booking_platform}}
    </div>
    <p style="font-weight:700">
      La ausencia de un seguro de vacaciones no exime en ningún caso al arrendatario de su responsabilidad por los daños causados a la vivienda o a su contenido.
    </p>$rep$)
where is_active and type_contrat = 'saisonnier' and langue = 'es';
