-- 531 : reprise de l'historique de la messagerie propriétaires dans la conversation unique (22/10/2026).
-- Fonction owner_chat_fusionner() de la 530 : idempotente (une 2e exécution renvoie 0 / 0).
-- Contrôle avant (22/10/2026) : 185 messages (175 non supprimés), 21 réactions,
--   empreinte contenu md5 7d2fb0492f0792dcb46dfcd507213fc9 (id, auteur, texte, dates, réponse, pièce jointe, épinglé, mission),
--   empreinte cible  md5 e568eeca9e072c682ad0ee1fd2146747 (id, propriétaire principal, bien du salon d'origine).
-- Après : mêmes empreintes, l'empreinte cible étant recalculée avec (id, propriétaire de la conversation, étiquette bien_id).
select public.owner_chat_fusionner();
