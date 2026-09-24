import { describe, it, expect } from 'vitest'
import { planifierSynchro, emailDepuisClientEvoliz } from '../proprietaireSyncCore.js'

// Règles validées par Oïhan le 24/09/2026 (I-148) : compléter les vides, mettre à jour ce qui a
// changé chez Evoliz, ne jamais écraser une saisie locale, ne jamais réactiver une fiche.
const client = (over = {}) => ({ clientid: 42, name: 'DUPONT Jean', type: 'Particulier', mobile: '0600000000',
  address: { addr: '1 rue A', postcode: '64200', town: 'Biarritz', country: { label: 'France' } }, ...over })
const fiche = (over = {}) => ({ id: 'p1', id_evoliz: '42', nom: 'DUPONT', prenom: 'Jean', telephone: null,
  adresse: null, code_postal: null, ville: null, pays: null, actif: true, evoliz_snapshot: null, ...over })

describe('planifierSynchro', () => {
  it('complète les champs vides', () => {
    const { updates } = planifierSynchro([client()], [fiche()], new Set(), 'dcb')
    expect(updates[0].patch).toMatchObject({ telephone: '0600000000', adresse: '1 rue A', ville: 'Biarritz' })
  })

  it("n'écrase pas une saisie locale à la 1re synchro (pas de snapshot)", () => {
    const { updates } = planifierSynchro([client()], [fiche({ adresse: '9 rue Locale' })], new Set(), 'dcb')
    expect(updates[0].patch.adresse).toBeUndefined()
  })

  it("n'écrase pas une saisie locale si Evoliz n'a pas changé", () => {
    const snap = { nom: 'DUPONT', prenom: 'Jean', telephone: '0600000000', adresse: '1 rue A', code_postal: '64200', ville: 'Biarritz', pays: 'France' }
    const { updates } = planifierSynchro([client()], [fiche({ adresse: '9 rue Locale', telephone: '0700000000', code_postal: '64200', ville: 'Biarritz', pays: 'France', evoliz_snapshot: snap })], new Set(), 'dcb')
    expect(updates).toHaveLength(0)
  })

  it('reporte une modification faite chez Evoliz', () => {
    const snap = { nom: 'DUPONT', prenom: 'Jean', telephone: '0600000000', adresse: '1 rue A', code_postal: '64200', ville: 'Biarritz', pays: 'France' }
    const c = client({ address: { addr: '2 rue Nouvelle', postcode: '64200', town: 'Biarritz', country: { label: 'France' } } })
    const { updates } = planifierSynchro([c], [fiche({ adresse: '1 rue A', telephone: '0600000000', code_postal: '64200', ville: 'Biarritz', pays: 'France', evoliz_snapshot: snap })], new Set(), 'dcb')
    expect(updates[0].patch.adresse).toBe('2 rue Nouvelle')
  })

  it("n'efface jamais une valeur locale quand Evoliz est vide", () => {
    const { updates } = planifierSynchro([client({ mobile: '', phone: '' })], [fiche({ telephone: '0611111111' })], new Set(), 'dcb')
    expect(updates[0].patch.telephone).toBeUndefined()
  })

  it('ne touche jamais actif ni agence', () => {
    const { updates } = planifierSynchro([client()], [fiche({ actif: false })], new Set(), 'dcb')
    for (const u of updates) { expect(u.patch).not.toHaveProperty('actif'); expect(u.patch).not.toHaveProperty('agence') }
  })

  it("bloque la création d'un id_evoliz déjà pris par une autre agence", () => {
    const { inserts, collisions } = planifierSynchro([client({ name: 'MARTIN Paul' })], [], new Set(['42']), 'dcb')
    expect(inserts).toHaveLength(0)
    expect(collisions[0].raison).toBe('id_evoliz_autre_agence')
  })

  it('bloque un homonyme sans id_evoliz (garde-fou anti-doublon)', () => {
    const { inserts, collisions } = planifierSynchro([client()], [fiche({ id_evoliz: null })], new Set(), 'dcb')
    expect(inserts).toHaveLength(0)
    expect(collisions[0].raison).toBe('homonyme')
  })

  it('crée un nouveau client actif avec son snapshot', () => {
    const { inserts } = planifierSynchro([client()], [], new Set(), 'lauian')
    expect(inserts[0]).toMatchObject({ id_evoliz: '42', actif: true, agence: 'lauian' })
    expect(inserts[0].evoliz_snapshot.adresse).toBe('1 rue A')
  })
})

describe('emailDepuisClientEvoliz', () => {
  it('prend l\'email direct, sinon le 1er contact', () => {
    expect(emailDepuisClientEvoliz({ email: ' A@B.fr ' })).toBe('a@b.fr')
    expect(emailDepuisClientEvoliz({ contacts: [{ email: '' }, { email: 'c@d.fr' }] })).toBe('c@d.fr')
    expect(emailDepuisClientEvoliz({})).toBeNull()
  })
})
