-- 332 — Inventaire → sac automatique (06/10/2026, demande Oïhan).
-- Quand un objet suivi passe à « à remplacer » ou « manquant » (petit équipement, consommable, stock),
-- quel que soit l'écran (inventaire portail, PowerHouse, ⚡ Agir, « Il manque » de Ma journée), un
-- besoin_sac est créé pour le prochain passage — sauf s'il y en a déjà un ouvert pour cet objet.
-- Retour à « présent » / « ok » avant d'être mis dans le sac → le besoin à préparer est annulé.
-- Attention aux clés : inventaire_*.bien_id = bien_toolbox.id ; besoin_sac.bien_id = bien.id.
create or replace function public.inventaire_vers_sac()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_bien uuid; v_item catalogue_items;
begin
  if tg_op = 'UPDATE' and new.statut is not distinct from old.statut then return new; end if;
  select bien_id into v_bien from bien_toolbox where id = new.bien_id;
  select * into v_item from catalogue_items where id = new.item_id;
  if v_bien is null or v_item.id is null or v_item.type not in ('petit_equipement', 'consommable', 'stock') then return new; end if;
  if new.statut in ('a_remplacer', 'manquant') then
    if not exists (select 1 from besoin_sac where bien_id = v_bien and item_id = new.item_id and statut in ('a_preparer', 'dans_sac')) then
      insert into besoin_sac (bien_id, item_id, libelle, quantite, note)
      values (v_bien, new.item_id, v_item.nom, 1, case new.statut when 'a_remplacer' then 'Inventaire : à remplacer' else 'Inventaire : manquant' end);
    end if;
  elsif new.statut in ('present', 'ok') then
    update besoin_sac set statut = 'annule', updated_at = now()
     where bien_id = v_bien and item_id = new.item_id and statut = 'a_preparer';
  end if;
  return new;
exception when others then
  return new; -- ne jamais bloquer une mise à jour d'inventaire
end $$;

drop trigger if exists trg_inventaire_vers_sac on public.inventaire_bien_stock;
create trigger trg_inventaire_vers_sac after insert or update of statut on public.inventaire_bien_stock
  for each row execute function public.inventaire_vers_sac();
