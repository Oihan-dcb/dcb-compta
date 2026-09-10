// Loader Node minimal pour exécuter en script les modules src/services/*.js
// écrits pour Vite (imports relatifs sans extension .js, résolus par le
// bundler mais pas par Node ESM nativement). Utilisé UNIQUEMENT par les
// scripts ponctuels de scripts/ (node --experimental-loader ...) — jamais
// par l'app buildée (Vite/Vercel résolvent déjà ces imports normalement).
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && (specifier.startsWith('.') || specifier.startsWith('/'))) {
      return nextResolve(specifier + '.js', context)
    }
    throw err
  }
}
