#!/bin/bash
# Despliega la PWA: renueva la versión del service worker (para que los móviles
# detecten la actualización y se recarguen solos), commitea y hace push.
# Uso:  ./deploy.sh "mensaje del commit"
set -e
cd "$(dirname "$0")"

STAMP=$(date +%Y%m%d-%H%M%S)
# bump del nombre de caché del SW → fuerza un service worker nuevo en los clientes
sed -i '' -E "s/const CACHE = \"cagometro-[^\"]*\";/const CACHE = \"cagometro-${STAMP}\";/" sw.js

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
