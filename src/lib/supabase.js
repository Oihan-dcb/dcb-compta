import { createClient } from '@supabase/supabase-js'

// Isomorphe : côté client (Vite) via import.meta.env ; côté serveur (fonctions Vercel
// qui importent les services — ex. api/matching-auto.js) via process.env, avec la clé
// service_role (pas de session utilisateur côté serveur → RLS bypassée volontairement).
const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : process.env
const isServer = typeof window === 'undefined'

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL
const supabaseKey = (isServer && env.SUPABASE_SERVICE_ROLE_KEY) || env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase URL ou clé manquante dans .env.local')
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: {
    fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }),
  },
})
