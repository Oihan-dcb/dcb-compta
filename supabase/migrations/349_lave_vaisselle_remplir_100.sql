-- 349 — Lave-vaisselle : l'AE remplit sel et liquide de rinçage à 100 %, le reste du paquet reste dans le
-- bien (Oïhan 07/10/2026). Le stock « faible » de l'inventaire désigne donc la RÉSERVE du bien (paquet
-- presque vide), pas le bac de la machine. Un paquet entier est déposé et refacturé (migration 348).
update public.entretien_type
   set consigne = 'Retirer le filtre au fond de la cuve, rincer sous l''eau chaude. Remplir le bac à sel et le liquide de rinçage à 100 % avec la réserve du bien ; le reste du paquet reste rangé dans le bien. Si la réserve est presque vide, la passer en « faible » dans l''inventaire du bien (un paquet neuf partira dans le prochain sac).'
 where id = 'e4f0f224-11ed-4ef7-b7e4-543d018cf055';

-- Note du besoin au sac pour les articles lave-vaisselle : la consigne suit le paquet
create or replace function public.inventaire_vers_sac()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_bien uuid; v_item catalogue_items; v_note text;
begin
  if tg_op = 'UPDATE' and new.statut is not distinct from old.statut then return new; end if;
  select bien_id into v_bien from bien_toolbox where id = new.bien_id;
  select * into v_item from catalogue_items where id = new.item_id;
  if v_bien is null or v_item.id is null or v_item.type not in ('petit_equipement', 'consommable', 'stock') then return new; end if;
  if new.statut in ('a_remplacer', 'manquant') or (new.statut = 'faible' and v_item.reappro_auto) then
    if not exists (select 1 from besoin_sac where bien_id = v_bien and item_id = new.item_id and statut in ('a_preparer', 'dans_sac')) then
      v_note := case new.statut when 'a_remplacer' then 'Inventaire : à remplacer'
                                when 'faible' then 'Inventaire : faible (réassort auto)'
                                else 'Inventaire : manquant' end;
      if v_item.categorie = 'Lave-vaisselle' then
        v_note := v_note || ' — remplir à 100 %, laisser le reste du paquet dans le bien';
      end if;
      insert into besoin_sac (bien_id, item_id, libelle, quantite, note) values (v_bien, new.item_id, v_item.nom, 1, v_note);
    end if;
  elsif new.statut in ('present', 'ok') then
    update besoin_sac set statut = 'annule', updated_at = now()
     where bien_id = v_bien and item_id = new.item_id and statut = 'a_preparer';
  end if;
  return new;
exception when others then
  return new;
end $function$;
