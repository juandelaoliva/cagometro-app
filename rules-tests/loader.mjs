// Redirige `./firebase-bundle.js` (bundle de navegador que usa la app) al SDK de npm, para
// poder ejecutar store.js tal cual en Node contra los emuladores. No toca el código de la app.
export async function resolve(specifier, context, next) {
  if (specifier.endsWith("firebase-bundle.js"))
    return { url: new URL("./firebase-shim.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
