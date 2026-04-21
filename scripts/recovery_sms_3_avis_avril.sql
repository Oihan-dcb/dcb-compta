-- Récupération manuelle — 3 avis 5⭐ manqués semaine du 14-21 avril 2026
-- Téléphones récupérés via API Hospitable
-- Coller dans Supabase SQL Editor et exécuter

INSERT INTO sms_queue (
  hospitable_reservation_id,
  guest_name,
  guest_phone,
  guest_country,
  property_name,
  comment,
  rating,
  send_at
) VALUES
  (
    '804d8d84-91dd-442a-a6a8-a6698725e7d9',
    'Guillaume',
    '+33698080435',
    'France',
    '416 "Harea"',
    'Le séjour était parfait et votre appartement a grandement contribué. Vous êtes parfaitement placé, le logement est fonctionnel il ne manque de rien. La vue est à couper le souffle et offre un spectacle incroyable. Je me suis régalé. Merci encore pour ce somptueux moment.',
    5,
    now()
  ),
  (
    '6f18da86-409d-4a2b-acc8-b8b49548b59c',
    'Nathalie',
    '+33683129308',
    'France',
    '416 "Harea"',
    'Hôte très réactif et attentif. Le logement est fidèle à la description et la respiration sur l''océan est un pur bonheur!',
    5,
    now()
  ),
  (
    'f576cf7a-5123-43ec-86d9-745f45dc745c',
    'Carole',
    '+33618271119',
    'France',
    'Chambre Txomin - Maison Maïté',
    'Séjour très agréable dans cette maison au style décoratif soigné et harmonieux. La propreté est irréprochable, ce qui rend l''ensemble encore plus appréciable. On s''y sent rapidement à l''aise, comme chez soi grâce à Vincent. L''emplacement est idéal, proche de tout et très pratique. Une adresse que je recommande sans hésiter.',
    5,
    now()
  )
ON CONFLICT DO NOTHING;
