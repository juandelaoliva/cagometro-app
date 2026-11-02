#!/bin/bash
# Despliega la PWA: renueva la versión del service worker (para que los móviles
# detecten la actualización y se recarguen solos), commitea y hace push.
# Uso:  ./deploy.sh "mensaje del commit"
set -e
cd "$(dirname "$0")"

STAMP=$(date +%Y%m%d-%H%M%S)
# bump del nombre de caché del SW → fuerza un service worker nuevo en los clientes
# (-i.bak + rm: funciona igual con el sed de macOS y el de Linux)
sed -i.bak -E "s/const CACHE = \"cagometro-[^\"]*\";/const CACHE = \"cagometro-${STAMP}\";/" sw.js && rm -f sw.js.bak
# misma marca dentro de app.js: se enseña al pie de Ajustes para saber qué versión ejecuta el móvil
sed -i.bak -E "s/const APP_VERSION = \"[^\"]*\";/const APP_VERSION = \"${STAMP}\";/" app.js && rm -f app.js.bak

git add -A
git commit -q -m "${1:-deploy} (sw ${STAMP})"
git push origin main
echo "⬆️  push hecho · sw=cagometro-${STAMP}"

# esperar a que GitHub Pages publique de verdad (suele tardar 1-3 min)
echo "⏳ esperando a GitHub Pages…"
for i in $(seq 1 40); do
  LIVE=$(curl -s "https://juandelaoliva.github.io/cagometro-app/sw.js?cb=${i}$(date +%s)" | grep -oE 'cagometro-[0-9-]+' | head -1)
  if [ "$LIVE" = "cagometro-${STAMP}" ]; then echo "🌐 EN VIVO (tras ~$((i*8))s)"; exit 0; fi
  sleep 8
done
echo "⏳ todavía propagando; revísalo en un par de minutos"
