# Despliegue: reglas de Firestore endurecidas

Tres pasos, **en este orden**. El cliente nuevo funciona con las reglas actuales y con las
nuevas, así que se puede parar entre un paso y otro sin que nada se rompa.

Antes de empezar, en una terminal con Node 18+ y Java:

```bash
cd rules-tests && npm ci && npm test      # 89 pruebas; todas tienen que pasar
```

## 0 · Red de seguridad

- **Copia de los datos.** Una exportación de Firestore, o la última copia de la Pi. El paso 2
  escribe en producción.
- **Guarda las reglas actuales** (el fichero de la rama, antes del paso 3):
  `git show HEAD:firestore.rules > ~/firestore.rules.antiguas`

## 1 · Cliente (GitHub Pages)

Fusiona la rama a `main` con un *merge commit* (no *squash*: hay ramas apiladas encima).
Pages publica solo. La rama ya trae el `sw.js` con la versión subida, así que los móviles se
actualizan en ~30 s; si prefieres lanzarlo con `./deploy.sh`, también vale.

Comprueba en la PWA: entrar, sumar una caca, abrir un grupo, buscar un amigo por email.

Lo que ve la gente: **el enlace de invitación de amistad ya no hace amigos al instante**, manda
una solicitud que la otra persona acepta (cambian los textos «Añadir» y «Le enviaremos una
solicitud…»).

## 2 · Relleno de datos

Desde la Raspberry (necesita `firebase-admin` v10 o posterior y credenciales):

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/ruta/a/la/clave.json
node tools/backfill-public-docs.cjs                    # ensayo: no escribe nada
```

Revisa el informe:

- **Conflictos** (código de grupo repetido, email repetido, grupo sin código): hay que
  resolverlos a mano; el script sale con código 1 y no los pisa.
- **Parejas de grupo sin amistad aceptada**: las reglas nuevas ocultarían a esas personas entre
  sí. `--fix-friendships` las crea o acepta.

```bash
node tools/backfill-public-docs.cjs --apply --yes [--fix-friendships]
node tools/backfill-public-docs.cjs                    # repetir: todo tiene que salir a 0
```

Es idempotente: se puede repetir. Los usuarios que se registren o entren después se sincronizan
solos.

## 3 · Reglas

```bash
cp firestore.rules.draft firestore.rules
```

y publícalas: **consola de Firebase** (Firestore → Reglas → pegar → Publicar), o con la CLI
(`firebase deploy --only firestore:rules`; hoy el repo no tiene `firebase.json` en la raíz, haría
falta uno con `{"firestore":{"rules":"firestore.rules"}}`).

**Comprobación inmediata, con dos cuentas que sean amigas y una que no:**

- [ ] Entrar y sumar una caca.
- [ ] Ver el perfil, las cacas y el mapa de un amigo.
- [ ] Mandar una solicitud por email y aceptarla (el nombre se ve antes de aceptar).
- [ ] Crear un grupo y unirse con su código desde otra cuenta.
- [ ] Abrir un enlace `?friend=` y un enlace `?join=`.
- [ ] La cuenta sin relación **no** puede ver las cacas de la otra (consola del navegador:
  `permission-denied`).

## Marcha atrás

- **Reglas:** vuelve a publicar `~/firestore.rules.antiguas`. El cliente nuevo sigue
  funcionando con ellas.
- **Cliente:** `git revert -m 1 <merge>`; solo hace falta si hay un fallo de interfaz.
- Los docs que crea el relleno (`publicProfiles`, `userLookup`, `inviteCodes`) no estorban a las
  reglas antiguas: no hace falta borrarlos.

## Qué vigilar después

- **Lecturas:** cada lectura del perfil o las cacas de un amigo hace una lectura más en las
  reglas. Mira la cuota los primeros días.
- **`permission-denied` inesperados**, sobre todo de personas con grupos antiguos: casi siempre es
  una pareja de grupo sin amistad que el relleno no arregló.
- **Un tipo de push nuevo** hay que añadirlo a la lista de `pushQueue` en las reglas, o fallará
  sin avisar.

## Lo que este despliegue no resuelve

Unirse a un grupo sigue sin comprobar el código en las reglas; el borrado de cuenta, denunciar y
bloquear, y la política de privacidad son trabajo aparte (ver `MIGRACION-EXPO.md`, Fase 0).


## Añadido por el borrado de cuenta (app nativa)

Además de las reglas nuevas, hay que **desplegar los índices**: `firebase deploy --only firestore:indexes`. El borrado de cuenta busca la actividad propia y las
conexiones de tuberías en las que se participa (`audience` + `uid` y `audience` + `kind`) y, sin esos dos índices compuestos, esa búsqueda falla en producción
(en el emulador no se nota). Tardan unos minutos en construirse: despliégalos antes de publicar la app.


## Estado del despliegue (2026-11-02)

- Cliente nuevo publicado (versión `20261102-150043`), relleno aplicado (145 operaciones; 44 usuarios, 13 grupos) e índices creados.
- **Reglas endurecidas desplegadas a las 15:06** (`firestore.rules` = `firestore.rules.draft`). Comprobación en producción con una cuenta desechable sin
  relación con nadie: 403 al leer perfil y cacas de otra persona, al listar usuarios, grupos y actividad, al crear una amistad aceptada y al crear un grupo
  con otra persona dentro; 200 al leer un perfil público y la configuración global.
- Marcha atrás: republicar `~/firestore.rules.antiguas` (reglas de arranque anteriores; copia del 2026-11-02).


## Actualización 2026-11-04 · reglas de denuncias y bloqueos DESPLEGADAS
- Publicada antes la PWA (`20261104-124539`) y después las reglas (`firebase deploy --only firestore:rules`, 145 pruebas en verde con el mismo fichero). `firestore.rules` = `firestore.rules.draft`.
- Añaden: `reports` (crear con validación de que el mensaje/grupo denunciado es real; leer y gestionar solo el admin), `users/{uid}/blocked`, bloqueo entre dos en DM/invitaciones/solicitudes/avisos y el tipo `report` de `pushQueue` hacia el admin.
- Marcha atrás: las reglas anteriores están en `~/firestore.rules.antes-denuncias` (y en el historial de git: commit `9f4ce38`).
