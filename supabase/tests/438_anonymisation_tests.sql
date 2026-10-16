-- Tests unitaires de l'anonymisation (438) — exemples FICTIFS uniquement. Lecture seule.
-- Exécution : coller dans l'éditeur SQL (ou API de gestion) ; chaque ligne doit avoir ok = true.
with cas(nom, entree, noms, attendu) as (values
  ('email',            'Écrivez-moi à jean.dupont+test@exemple-mail.fr merci', '{}'::text[], 'Écrivez-moi à [email] merci'),
  ('tel FR espaces',   'Mon numéro : 06 12 34 56 78.', '{}', 'Mon numéro : [tel].'),
  ('tel FR points',    'appelez le 06.12.34.56.78', '{}', 'appelez le [tel]'),
  ('tel FR +33',       'Tel +33 6 12 34 56 78 ou +33(0)6 12 34 56 78', '{}', 'Tel [tel] ou [tel]'),
  ('tel FR collé',     'num 0612345678 ok', '{}', 'num [tel] ok'),
  ('tel UK',           'call me on +44 20 7946 0958 please', '{}', 'call me on [tel] please'),
  ('tel US',           'my cell is +1 (415) 555-0132', '{}', 'my cell is [tel]'),
  ('tel DE 00',        'Handy 0049 151 23456789', '{}', 'Handy [tel]'),
  ('tel ES',           'mi móvil 612 345 678', '{}', 'mi móvil [tel]'),
  ('iban',             'IBAN FR76 3000 6000 0112 3456 7890 189 svp', '{}', 'IBAN [iban] svp'),
  ('carte Luhn',       'carte 4111 1111 1111 1111 exp', '{}', 'carte [carte] exp'),
  ('pas carte',        'annonce 1234 5678 9012 3456', '{}', 'annonce 1234 5678 9012 3456'),
  ('code porte',       'Le code de la porte est 4589B', '{}', 'Le code de la porte est [code]'),
  ('digicode',         'Digicode : 12A45, boîte à clés 0712', '{}', 'Digicode : [code], boîte à clés [code]'),
  ('mot de passe',     'Mot de passe du wifi : soleil64', '{}', 'Mot de passe du wifi : [code]'),
  ('password',         'The wifi password is Ocean2024!', '{}', 'The wifi password is [code]'),
  ('adresse',          'J''habite 12 bis rue des Lilas, 64200 Biarritz.', '{}', 'J''habite [adresse], [adresse].'),
  ('adresse EN',       'I live at 221 Baker Street, London', '{}', 'I live at [adresse], London'),
  ('adresse DE',       'Wir wohnen in der Hauptstraße 12a, Berlin', '{}', 'Wir wohnen in der [adresse], Berlin'),
  ('adresse ES',       'Vivo en Calle Mayor 12, Madrid', '{}', 'Vivo en [adresse], Madrid'),
  ('code alpha',       'the lockbox code is B1234', '{}', 'the lockbox code is [code]'),
  ('nom connu',        'Bonjour Jean-Pierre, merci Mme Dupont !', array['Jean-Pierre Dupont'], 'Bonjour [nom], merci Mme [nom] !'),
  ('nom sans accent',  'Merci Helene et Hélène', array['Hélène Martin'], 'Merci [nom] et [nom]'),
  ('nom casse',        'MARTIN Hélène a écrit', array['Hélène Martin'], '[nom] [nom] a écrit'),
  ('nom court ignoré', 'Bonjour Li, il fait beau', array['Li'], 'Bonjour Li, il fait beau'),
  ('texte neutre',     'Arrivée le 12/10/2026 à 16h, 4 personnes, 250 € par nuit, ménage inclus.', '{}', 'Arrivée le 12/10/2026 à 16h, 4 personnes, 250 € par nuit, ménage inclus.'),
  ('code réservation', 'Réservation HMABCD1234 confirmée', '{}', 'Réservation HMABCD1234 confirmée'),
  ('vide',             '', '{}', ''),
  ('null',             null, '{}', null)
)
select nom, anon_texte(entree, noms) as obtenu, attendu, anon_texte(entree, noms) is not distinct from attendu as ok from cas
union all
select 'jsonb', anon_jsonb('{"guest":{"first_name":"Jean","email":"j@x.fr","phone_numbers":["+33612345678"],"location":"Lyon"},"body":"Merci Jean, appelez le 06 12 34 56 78","n":1234567890123,"lang":"fr"}'::jsonb, array['Jean'])::text,
       '{"n": 1234567890123, "body": "Merci [nom], appelez le [tel]", "lang": "fr", "guest": {"email": "[email]", "location": "[lieu]", "first_name": "[nom]", "phone_numbers": "[tel]"}}',
       anon_jsonb('{"guest":{"first_name":"Jean","email":"j@x.fr","phone_numbers":["+33612345678"],"location":"Lyon"},"body":"Merci Jean, appelez le 06 12 34 56 78","n":1234567890123,"lang":"fr"}'::jsonb, array['Jean'])
         = '{"n": 1234567890123, "body": "Merci [nom], appelez le [tel]", "lang": "fr", "guest": {"email": "[email]", "location": "[lieu]", "first_name": "[nom]", "phone_numbers": "[tel]"}}'::jsonb
union all
select 'luhn', anon_luhn('4111111111111111')::text, 'true', anon_luhn('4111111111111111') and not anon_luhn('1234567890123456');
