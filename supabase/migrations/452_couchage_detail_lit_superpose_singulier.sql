-- 452 : couchage_detail — « 1 lit superposé (2 couchages) » au lieu de « 1 lits superposés » (texte FR des couchages,
-- vu sur ALAIA le 16/10/2026 ; pluriel inchangé à partir de 2). Aucune autre modification (définition reprise de la base).
CREATE OR REPLACE FUNCTION public.couchage_detail(p_bien uuid, p_lits jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  r record; v_mode text; v_type text; v_n int; v_larg int; v_lg text; v_places int := 0; v_jeux int := 0;
  v_grands int := 0; v_petits int := 0; v_canapes int := 0; v_sup int := 0; v_app int := 0; v_tr boolean;
  v_draps jsonb := '{}'::jsonb; v_taille text; v_pieces jsonb := '[]'::jsonb; v_cons text[] := '{}'; v_el text; k int; v_q int;
  pl jsonb; lae jsonb;
  fr text; en text; es text;
begin
  for r in select l.* from bien_lit l where l.bien_id = p_bien and l.actif
             and l.id in (select (e->>'lit_id')::uuid from jsonb_array_elements(coalesce(p_lits, '[]'::jsonb)) e where (e->>'lit_id') ~ '^[0-9a-f-]{36}$')
           order by l.ordre, l.piece, l.id loop
    select coalesce(e->>'mode', 'normal') into v_mode from jsonb_array_elements(p_lits) e where e->>'lit_id' = r.id::text limit 1;
    v_tr := v_mode = 'transforme' and r.transforme_type is not null;
    if v_tr then
      v_type := r.transforme_type; v_n := r.transforme_nombre; v_larg := r.transforme_largeur_cm; v_lg := coalesce(r.transforme_linge, case when r.transforme_type = 'simple' then 'Twin' end);
      v_cons := v_cons || format('%s : %s à installer en %s lit%s%s', r.piece,
        case when r.type in ('king', 'queen', 'double') then 'le grand lit' else 'le lit' end,
        v_n, case when v_n > 1 then 's' else '' end, case when v_larg is not null then ' ' || v_larg || '×' || r.longueur_cm else '' end);
    else
      v_type := r.type; v_n := 1; v_larg := r.largeur_cm; v_lg := r.linge;
    end if;
    v_taille := coalesce(v_lg, case when v_larg is not null then v_larg || '×' || r.longueur_cm end, case when v_type in ('simple', 'superpose', 'appoint') then 'simple (taille ?)' else 'grand lit (taille ?)' end);
    for k in 1..v_n loop
      v_q := case when v_type = 'superpose' then 2 else 1 end;
      v_jeux := v_jeux + v_q;
      v_draps := jsonb_set(v_draps, array[v_taille], to_jsonb(coalesce((v_draps->>v_taille)::int, 0) + v_q));
      if v_type = 'superpose' then v_places := v_places + coalesce(r.places, 2); v_sup := v_sup + 1;
      else
        v_places := v_places + case when v_tr then lit_places_defaut(v_type) else coalesce(r.places, lit_places_defaut(v_type)) end;
        if v_type = 'canape_lit' then v_canapes := v_canapes + 1;
        elsif v_type = 'appoint' then v_app := v_app + 1;
        elsif v_type = 'simple' then v_petits := v_petits + 1;
        else v_grands := v_grands + 1; end if;
      end if;
    end loop;
    v_el := v_n || ' ' ||
      case v_type when 'simple' then 'petit' || case when v_n > 1 then 's lits' else ' lit' end
                  when 'canape_lit' then 'canapé' || case when v_n > 1 then 's-lits' else '-lit' end
                  when 'superpose' then case when v_n > 1 then 'lits superposés' else 'lit superposé (2 couchages)' end when 'appoint' then 'couchage' || case when v_n > 1 then 's' else '' end || ' d''appoint'
                  else 'grand' || case when v_n > 1 then 's lits' else ' lit' end end
      || case when v_larg is not null then ' ' || v_larg || '×' || r.longueur_cm else '' end
      || case when v_lg is not null then ' (draps ' || v_lg || ')' else '' end;
    v_pieces := v_pieces || jsonb_build_object('piece', r.piece, 'fr', v_el);
  end loop;
  fr := array_to_string(array_remove(array[
    case when v_grands > 0 then v_grands || ' grand' || case when v_grands > 1 then 's lits' else ' lit' end end,
    case when v_petits > 0 then v_petits || ' petit' || case when v_petits > 1 then 's lits' else ' lit' end end,
    case when v_sup > 0 then v_sup || case when v_sup > 1 then ' lits superposés' else ' lit superposé (2 couchages)' end end,
    case when v_canapes > 0 then v_canapes || ' canapé' || case when v_canapes > 1 then 's-lits' else '-lit' end end,
    case when v_app > 0 then v_app || ' couchage' || case when v_app > 1 then 's' else '' end || ' d''appoint' end], null), ' + ');
  en := array_to_string(array_remove(array[
    case when v_grands > 0 then v_grands || ' large bed' || case when v_grands > 1 then 's' else '' end end,
    case when v_petits > 0 then v_petits || ' single bed' || case when v_petits > 1 then 's' else '' end end,
    case when v_sup > 0 then v_sup || ' bunk bed' || case when v_sup > 1 then 's' else '' end end,
    case when v_canapes > 0 then v_canapes || ' sofa bed' || case when v_canapes > 1 then 's' else '' end end,
    case when v_app > 0 then v_app || ' extra bed' || case when v_app > 1 then 's' else '' end end], null), ' + ');
  es := array_to_string(array_remove(array[
    case when v_grands > 0 then v_grands || case when v_grands > 1 then ' camas grandes' else ' cama grande' end end,
    case when v_petits > 0 then v_petits || case when v_petits > 1 then ' camas individuales' else ' cama individual' end end,
    case when v_sup > 0 then v_sup || ' litera' || case when v_sup > 1 then 's' else '' end end,
    case when v_canapes > 0 then v_canapes || case when v_canapes > 1 then ' sofás cama' else ' sofá cama' end end,
    case when v_app > 0 then v_app || case when v_app > 1 then ' camas supletorias' else ' cama supletoria' end end], null), ' + ');
  select coalesce(jsonb_agg(jsonb_build_object('taille', key, 'qte', value::int) order by key), '[]'::jsonb),
         -- Libellés de l'équipe : « 1 Drap King + 1 Housse King »
         coalesce(jsonb_agg(to_jsonb(case when key ~ '(taille \?)' or key ~ '^\d' then value || ' jeu' || case when value::int > 1 then 'x' else '' end || ' de draps ' || key
                                          -- « Twin/Queen » = drap Twin, housse Queen (ex. IBANETA)
                                          when key ~ '/' then value || ' Drap' || case when value::int > 1 then 's' else '' end || ' ' || split_part(key, '/', 1) || ' + ' || value || ' Housse' || case when value::int > 1 then 's' else '' end || ' ' || split_part(key, '/', 2)
                                          else value || ' Drap' || case when value::int > 1 then 's' else '' end || ' ' || key || ' + ' || value || ' Housse' || case when value::int > 1 then 's' else '' end || ' ' || key end) order by key), '[]'::jsonb)
    into pl, lae from jsonb_each_text(v_draps);
  return jsonb_build_object('places', v_places, 'lits', v_jeux, 'draps', pl, 'linge_lignes', lae, 'grands', v_grands, 'petits', v_petits, 'canapes', v_canapes, 'superposes', v_sup,
    'texte', jsonb_build_object('fr', fr, 'en', en, 'es', es), 'pieces', v_pieces,
    'consigne_auto', nullif(array_to_string(v_cons, ' ; '), ''));
end $function$;
