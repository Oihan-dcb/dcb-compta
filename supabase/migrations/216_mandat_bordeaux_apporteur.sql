-- 216_mandat_bordeaux_apporteur.sql
-- Variante « Mandat Bordeaux » : apporteur d'affaires Léa Escudier = 2e signataire
-- (mention + bloc signature dans le template DCB) + état de co-signature.
-- Déjà appliqué en prod ; ce fichier le rend reproductible.

-- 1. Colonnes de co-signature « apporteur » sur mandat_signature
alter table mandat_signature
  add column if not exists apporteur_actif boolean default false,
  add column if not exists apporteur_nom text,
  add column if not exists apporteur_email text,
  add column if not exists apporteur_tel text,
  add column if not exists apporteur_sign_token uuid,
  add column if not exists apporteur_token_expires_at timestamptz,
  add column if not exists apporteur_canal text,
  add column if not exists apporteur_otp_hash text,
  add column if not exists apporteur_otp_expires_at timestamptz,
  add column if not exists apporteur_otp_verified_at timestamptz,
  add column if not exists apporteur_attempts integer default 0,
  add column if not exists apporteur_signature_canvas text,
  add column if not exists apporteur_signed_at timestamptz,
  add column if not exists apporteur_sent_at timestamptz;

create index if not exists idx_mandat_apporteur_token
  on mandat_signature(apporteur_sign_token) where apporteur_sign_token is not null;

-- 2. Template mandat DCB : mention apporteur (section mandataire), conditionnelle {{apporteur_lea}}
update contract_templates
set contenu_html = replace(contenu_html,
  $old$<p><strong>D'autre part,</strong></p>$old$,
  $new${{#apporteur_lea}}<p>Le présent mandat a été apporté par <strong>{{apporteur_nom}}</strong>, entrepreneur Individuel (EI), agent commercial inscrit au Registre spécial des Agents commerciaux sous le numéro {{apporteur_rsac}}, dûment habilité(e).</p>
  {{/apporteur_lea}}<p><strong>D'autre part,</strong></p>$new$)
where id = '1d6ef5b9-370f-4147-8e1b-444714dc0f56';

-- 3. Template mandat DCB : 3e case de signature « L'apporteur d'affaires »
update contract_templates
set contenu_html = replace(contenu_html,
$old$        <div class="sig-note">{{agence_qualite}} — {{agence_nom}}</div>
      </div>
    </div>$old$,
$new$        <div class="sig-note">{{agence_qualite}} — {{agence_nom}}</div>
      </div>
{{#apporteur_lea}}      <div class="sign-box">
        <div class="sig-label">L'APPORTEUR D'AFFAIRES</div>
        <div class="sig-name">{{apporteur_nom}}</div>
        {{#apporteur_signature}}<div class="sig-script">{{apporteur_signature}}</div>
        <div class="sig-note">Signature électronique apposée{{#apporteur_horodatage}} le {{apporteur_horodatage}}{{/apporteur_horodatage}}<br>Agent commercial · RSAC {{apporteur_rsac}}</div>{{/apporteur_signature}}
        {{^apporteur_signature}}<div class="sig-line"></div>
        <div class="sig-note">Agent commercial · RSAC {{apporteur_rsac}} — signature en attente</div>{{/apporteur_signature}}
      </div>
{{/apporteur_lea}}    </div>$new$)
where id = '1d6ef5b9-370f-4147-8e1b-444714dc0f56';
