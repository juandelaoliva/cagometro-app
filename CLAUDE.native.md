# CLAUDE.md — El Cagómetro (app nativa)

> Borrador para el repo `cagometro-native`, que todavía no existe. Cuando lo crees,
> cópialo allí con el nombre `CLAUDE.md` y bórralo de este repo.

## Qué es

App nativa (Expo + React Native) de **El Cagómetro**: contador social de cacas con amigos,
grupos, rankings, mapas, chat y notificaciones. Es el puerto de una PWA que **sigue viva** y
que usa **la misma base de datos de Firebase** (proyecto `cagometro-app`).

- **Referencia de comportamiento = la PWA**: repo `cagometro-app`, carpeta hermana
  (`../cagometro-app`). Antes de portar una pantalla, lee su versión allí.
- Plan completo: `../cagometro-app/MIGRACION-EXPO.md`. Reglas propuestas:
  `../cagometro-app/firestore.rules.draft`.

## Decisiones cerradas (no se reabren sin que yo lo pida)

- Expo con **expo-router**. TypeScript.
- **SDK web de Firebase** (`firebase/*`), no React Native Firebase.
- Notificaciones por el **servicio de envío de Expo**. Los tokens nativos se guardan en un
  campo **distinto** al de los tokens web (FCM): nunca en el mismo array.
- v1 con **paridad completa** con la web, por fases (ver el plan).
- Idiomas: castellano y la otra lengua de `i18n.js`. Los diccionarios se copian tal cual.

## Reglas de código

- **Nada de texto incrustado en pantalla**: todo por `t('clave')`, con las **mismas claves**
  que la PWA. Si falta una, se añade en los dos idiomas.
- **No portar `innerHTML` ni construir HTML**. Cada pantalla es un componente. `<Text>` no
  interpreta etiquetas: ese es el arreglo de escapado que nos regala el puerto.
- **Capa de datos = `src/data/store.ts`**, portada de `store.js`. Las pantallas no llaman a
  Firestore directamente.
- Colores y tipografías **solo desde el tema** (`src/theme`), nunca literales:
  `--paper #FBF6EC · --card #FFFFFF · --ink #241B12 · --ink-soft #7A6A58 ·
  --brand #6E3F1C · --brand-2 #9A5A2A · --gold #E59A2E · --mint #2E9E68 · --rose #D8573F`.
  Titulares Fraunces, texto Hanken Grotesk, esquinas 18–26 px. Fuentes con `expo-font`.
- **Cada `onSnapshot` se suelta al desmontar** la pantalla (en nativo la app no se cierra,
  se va al fondo). Un listener sin `unsubscribe` es un bug.
- **Campos de datos nuevos: siempre opcionales y con el ausente como valor por defecto**.
  La PWA convive con la app y lee los mismos documentos (como `notifPrefs` y `replyTo`).
- **Preferencia de la persona → doc de usuario** (viaja entre dispositivos). **Estado de
  este aparato → almacenamiento local**. No mezclarlos.
- No tocar `firestore.rules` desde aquí: viven en el repo de la PWA y se prueban con el
  emulador antes de desplegar.

## Cosas que se rompen al portar (ya localizadas)

- **Auth**: `initializeAuth` con persistencia en AsyncStorage, o la sesión se pierde al
  cerrar la app. Google: `signInWithPopup` no existe; usar `expo-auth-session`.
  Valorar Sign in with Apple (`expo-apple-authentication`).
- **Firestore en RN no tiene caché offline en disco** (sin IndexedDB). El outbox de cacas
  sin enviar (`cago_outbox`) es el único sitio donde vive un dato no sincronizado: cuidado
  con él, y ojo que `outboxGet` pasa de síncrono a asíncrono.
- `runTransaction` necesita red: sin conexión, `addCaca` cae al outbox.
- **Emuladores**: `localhost` en un móvil físico no es tu ordenador; usar la IP de la LAN.
- **Mapas**: no hay equivalente directo de `L.heatLayer`. El tope de zoom de los mapas ajenos
  hay que **probarlo con los dedos**; falló una vez en la web.
- **Expo Go no vale** (notificaciones, mapas): trabajar con *development build*.
- Enlaces de invitación `?join=CÓDIGO` y `?friend=UID`: universal links / app links.

## Antes de dar algo por hecho

- Una pantalla portada se compara con la de la PWA con los mismos datos.
- Cambios de datos, reglas o push: avisar de que afectan también a la PWA.
- Las versiones y comandos de Expo cambian rápido: contrastar con `docs.expo.dev`, no fiarse
  de memoria.
