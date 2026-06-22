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
echo "✅ desplegado · sw=cagometro-${STAMP}"
