import { useState } from 'react'

const KEY = 'dcb_mois_courant'
const moisCourant = new Date().toISOString().substring(0, 7)

export function useMoisPersisted() {
  const [mois, _setMois] = useState(() => localStorage.getItem(KEY) || moisCourant)

  function setMois(val) {
    localStorage.setItem(KEY, val)
    _setMois(val)
  }

  return [mois, setMois]
}
