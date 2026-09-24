/**
 * Noyau PUR de la synchro Evoliz → proprietaire (zéro import) — partagé par
 * src/services/syncProprietaires.js (bouton) et api/sync-proprietaires.js (cron nightly),
 * même pattern que ventilationCore.js : plus de logique dupliquée à synchroniser à la main.
 *
 * Règle de fusion (audit segment Propriétaires, 24/09/2026 — I-148) :
 *   - un champ local VIDE est complété depuis Evoliz ;
 *   - un champ local rempli n'est remplacé QUE si Evoliz l'a modifié depuis la dernière synchro
 *     (comparaison avec proprietaire.evoliz_snapshot) — une saisie faite dans dcb-compta /
 *     PowerHouse n'est donc plus écrasée chaque nuit ;
 *   - une valeur vide côté Evoliz n'efface jamais une valeur locale ;
 *   - `actif` et `agence` d'une fiche existante ne sont JAMAIS touchés : avant, la synchro
 *     repassait actif=true chaque nuit (31 fiches fusionnées réactivées, archivage impossible).
 *   - 1re synchro d'une fiche (pas encore de snapshot) : complétion seule, rien n'est écrasé.
 *
 * L'email n'est pas dans listClients (il vit dans getClient → contacts) : voir
 * emailDepuisClientEvoliz + la phase d'enrichissement des appelants.
 */

export const CHAMPS_SYNC = ['nom', 'prenom', 'telephone', 'adresse', 'code_postal', 'ville', 'pays']

const vide = v => v == null || (typeof v === 'string' && v.trim() === '')

export function normalizeName(nom, prenom) {
  return `${nom || ''} ${prenom || ''}`
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Client Evoliz (listClients) → valeurs de fiche proprietaire. Jamais d'email ici. */
export function ligneDepuisClientEvoliz(c, agence) {
  const name = (c.name || '').trim()
  const parts = name.split(/\s+/)
  let nom = name
  let prenom = null
  if (c.type === 'Particulier' && parts.length >= 2) {
    const upperParts = parts.filter(p => p === p.toUpperCase() && p.length > 1)
    const mixedParts = parts.filter(p => p !== p.toUpperCase() || p.length <= 1)
    if (upperParts.length > 0 && mixedParts.length > 0) {
      nom = upperParts.join(' ')
      prenom = mixedParts.join(' ')
    } else {
      nom = parts[parts.length - 1]
      prenom = parts.slice(0, -1).join(' ')
    }
  }
  const addr = c.address || {}
  return {
    id_evoliz: String(c.clientid),
    nom: nom.trim(),
    prenom: prenom?.trim() || null,
    telephone: (c.mobile || c.phone || '').trim() || null,
    adresse: addr.addr || null,
    code_postal: addr.postcode || null,
    ville: addr.town || null,
    pays: addr.country?.label || null,
    agence,
  }
}

/** Email d'un client Evoliz détaillé (getClient) : direct ou premier contact qui en a un. */
export function emailDepuisClientEvoliz(c) {
  const direct = (c?.email || '').trim()
  if (direct) return direct.toLowerCase()
  const contact = (c?.contacts || []).find(ct => (ct?.email || '').trim())
  return contact ? contact.email.trim().toLowerCase() : null
}

function snapshotDe(ligne) {
  return Object.fromEntries(CHAMPS_SYNC.map(f => [f, ligne[f] ?? null]))
}

/**
 * @param clients        clients Evoliz (listClients, dédoublonnés, enabled uniquement)
 * @param existantsAgence fiches de l'agence : id, nom, prenom, id_evoliz, evoliz_snapshot + CHAMPS_SYNC
 * @param idsEvolizAutresAgences Set des id_evoliz déjà pris par une AUTRE agence (contrainte
 *        UNIQUE globale : sans ce filtre, un seul conflit faisait échouer tout l'INSERT groupé)
 * @returns {{ inserts, updates: {id, patch}[], collisions }}
 */
export function planifierSynchro(clients, existantsAgence, idsEvolizAutresAgences, agence) {
  const lignes = clients.map(c => ligneDepuisClientEvoliz(c, agence))
  const parEvolizId = new Map(existantsAgence.filter(p => p.id_evoliz).map(p => [p.id_evoliz, p]))
  const parNom = new Map(existantsAgence.map(p => [normalizeName(p.nom, p.prenom), p]))

  const inserts = [], updates = [], collisions = []

  for (const l of lignes) {
    const ex = parEvolizId.get(l.id_evoliz)
    if (ex) {
      const snap = ex.evoliz_snapshot || null
      const patch = {}
      for (const f of CHAMPS_SYNC) {
        const ev = l[f], loc = ex[f]
        if (vide(ev)) continue                                   // jamais effacer une valeur locale
        if (vide(loc)) { patch[f] = ev; continue }                // compléter
        if (snap && snap[f] !== ev && loc !== ev) patch[f] = ev   // modifié chez Evoliz depuis la dernière synchro
      }
      const nouveauSnap = snapshotDe(l)
      if (JSON.stringify(nouveauSnap) !== JSON.stringify(snap)) patch.evoliz_snapshot = nouveauSnap
      if (Object.keys(patch).length) updates.push({ id: ex.id, patch })
      continue
    }
    const homonyme = parNom.get(normalizeName(l.nom, l.prenom))
    if (homonyme || idsEvolizAutresAgences.has(l.id_evoliz)) {
      collisions.push({
        nom: l.nom, prenom: l.prenom, id_evoliz_nouveau: l.id_evoliz,
        proprietaire_existant_id: homonyme?.id || null,
        proprietaire_existant_nom: homonyme ? `${homonyme.nom} ${homonyme.prenom || ''}`.trim() : null,
        raison: homonyme ? 'homonyme' : 'id_evoliz_autre_agence',
      })
      continue
    }
    inserts.push({ ...l, pays: l.pays || 'France', actif: true, evoliz_snapshot: snapshotDe(l) })
  }
  return { inserts, updates, collisions }
}
