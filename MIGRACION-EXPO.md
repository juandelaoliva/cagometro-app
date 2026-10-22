# De PWA a app nativa con Expo

Documento de trabajo para llevar **El Cagómetro** de web instalable a app nativa en
App Store y Google Play, manteniendo la web en marcha mientras tanto.

> **Cómo usar esto.** No es un tutorial que se lee de seguido: es el mapa del terreno y
> el orden en que conviene pisarlo. Lo vas a abrir en VSCode con Claude al lado, así que
> cada fase trae lo que hace falta para pedirle el trabajo a trozos.
>
> **Una advertencia honesta sobre las versiones.** Esto se escribió sin acceso a la
> documentación de Expo desde el entorno donde se redactó, así que **no fija versiones ni
> comandos exactos**: Expo se mueve rápido y lo que aquí se nombra como concepto hay que
> contrastarlo con `docs.expo.dev` en el momento de hacerlo. Donde hay un comando, es el
> de arranque, no el evangelio.

---

## 1. Qué tienes hoy

Tres meses de trabajo, 120 commits, 49 PRs. Unas 7.300 líneas:

| | líneas | qué pasa con ello |
|---|---|---|
| `app.js` | 3.561 | **se reescribe**: es interfaz hecha con DOM a mano |
| `store.js` | 864 | **se porta casi tal cual**: es la capa de datos |
| `i18n.js` | 1.063 | **se copia**: son dos diccionarios planos |
| `styles.css` | 1.007 | **se traduce** a estilos de React Native |
| `index.html` | 831 | **desaparece**: se convierte en componentes |

El dato que mejor resume el trabajo: **74 sitios construyen la interfaz con `innerHTML`**.
Cada uno es un componente de React que hay que escribir. No hay atajo ni conversor: la
interfaz es un trabajo nuevo. La lógica y los datos, no.

### Lo que hace la app

Contador y sumar caca · deshacer · cacas olvidadas (con fecha pasada) · escala de Bristol
con fotos · estadísticas y gráficas · feed de actividad con reacciones · amigos · grupos
con rankings · mapas (propio, de un amigo, de grupo) con mapa de calor · chat de DM y de
grupo con respuestas, reacciones y silenciar · notificaciones push y campana · datos de
mierda diarios · ajustes · tour de Bristol · panel de admin · funcionamiento sin conexión
· dos idiomas · recap de año · conexiones de tuberías y combos · hitos.

Todo eso entra en la v1 nativa, porque así lo decidiste.

---

## 2. Decisiones ya tomadas

| decisión | elegido |
|---|---|
| Distribución | **App Store y Google Play**, públicas |
| Alcance de la v1 | **Paridad completa** con la web |
| La PWA | **Se mantiene** en paralelo, contra la misma base de datos |
| Notificaciones | **Servicio de envío de Expo**, dejando FCM a mano |

**Sobre el alcance, una opinión que no te pedí pero te debo:** paridad completa + tiendas
públicas + primera vez es la combinación más ambiciosa de las que había. No es
irrealizable —tienes la lógica resuelta y el modelo de datos probado con gente real— pero
sí es la que más tarda en dar la primera alegría. El plan de abajo **construye por fases
aunque publiques una sola vez**: así ves algo funcionando en tu móvil en la fase 2 y no en
el mes cuatro.

---

## 3. 🚨 Tres cosas que Apple te va a rechazar — hazlas primero

Esto es lo más valioso del documento. Son tres carencias **de la app actual**, no del
puerto, y las tres son causa habitual de rechazo. Si las dejas para el final, te comen
semanas de ida y vuelta con el revisor.

### 3.1 No se puede borrar la cuenta

Apple exige que toda app que permita crear una cuenta permita **borrarla desde dentro de
la app**, no por correo ni por formulario. Hoy no existe: lo único parecido es el «wipe»
del panel de admin, y el propio texto admite que *«NO borra su cuenta de acceso»*.

Hay que construir: borrar el usuario de Firebase Auth, sus cacas, su doc de usuario, sus
mensajes, sacarlo de los grupos y de las amistades, y decidir qué pasa con las conexiones
de tubería compartidas en las que participó.

> Merece la pena hacerlo **ya, en la PWA**. Es trabajo que vale para las dos, y te obliga a
> pensar el borrado en cascada con calma en vez de con prisa.

### 3.2 No hay forma de denunciar ni bloquear a nadie

La app tiene chat, reacciones y nombres que pone el usuario: eso es **contenido generado
por usuarios**, y para eso Apple pide un paquete concreto: una forma de **denunciar**
contenido, una forma de **bloquear** a una persona, un compromiso de actuar sobre lo
denunciado, y una vía de contacto publicada.

Hoy no hay nada de eso. Es el rechazo más típico en apps sociales pequeñas, y el que más
sorprende a quien publica por primera vez: «si somos cuarenta amigos» no es un argumento
que valga en la revisión.

### 3.3 No hay política de privacidad, y los datos son más sensibles de lo que parece

Hace falta una política de privacidad publicada en una URL, y rellenar las etiquetas de
privacidad de la ficha. Lo que recoges hoy:

| categoría | qué, exactamente |
|---|---|
| Contacto | `email`, `displayName`, `photoURL` |
| **Ubicación precisa** | `lat` / `lng` en cada caca |
| **Salud** | la frecuencia de defecación y **la escala de Bristol**, que es una clasificación médica |
| Identificadores | el uid |
| Contenido del usuario | los mensajes del chat |

Lo de **salud** es lo que se suele pasar por alto. Declararlo mal en las etiquetas es
motivo de rechazo, y además te obliga a ser explícito sobre para qué lo usas.

> Los números de cláusula de Apple cambian de vez en cuando. Lo que no cambia es el fondo:
> **borrado de cuenta, moderación de contenido y privacidad declarada**. Contrasta el texto
> vigente en las *App Review Guidelines* antes de enviar.

---

## 4. Lo que no se porta, y por qué

Aquí está el trabajo real. Medido sobre el código, no estimado.

### APIs del navegador

| se usa | veces | equivalente nativo |
|---|---|---|
| `innerHTML` / `insertAdjacentHTML` | **74** | componentes de React — es el grueso del trabajo |
| `localStorage` | 20 | `AsyncStorage` (o `expo-secure-store` si es sensible) |
| `addEventListener("touch…")` | 11 | `react-native-gesture-handler` |
| `Notification` / permisos | 9 | `expo-notifications` |
| `history.pushState` / `popstate` | 8 | el router: **toda la navegación se rehace** |
| `document.createElement` | 8 | componentes |
| `serviceWorker` | 7 | **desaparece**: no hay shell que cachear ni versión que empujar |
| `visualViewport` | 5 | `KeyboardAvoidingView` |
| `getBoundingClientRect` | 5 | `onLayout` / `measure` |
| `navigator.onLine` | 3 | `expo-network` o `@react-native-community/netinfo` |
| `navigator.geolocation` | 2 | `expo-location` (+ textos de permiso en la ficha) |
| `navigator.vibrate` | 2 | `expo-haptics` |
| `matchMedia` | 2 | `useColorScheme` / `Dimensions` |
| `navigator.share` | 1 | `expo-sharing` |
| `CSS.escape`, `scrollIntoView` | 1+1 | `FlatList` con `scrollToIndex` |

### CSS que React Native no tiene

| se usa | reglas | qué hacer |
|---|---|---|
| `display:grid` | 29 | rehacer con flexbox — RN **no tiene grid** |
| `linear-gradient` | 24 | `expo-linear-gradient` |
| `@keyframes` | 18 | `Animated` / `react-native-reanimated` |
| `position:fixed` | 14 | reestructurar: en RN no existe |
| `env(safe-area-inset-*)` | 14 | `react-native-safe-area-context` |
| `backdrop-filter` | 7 | `expo-blur` |
| `::before` / `::after` | 7 | elementos de verdad |
| `dvh` | 2 | `Dimensions` / `useWindowDimensions` |
| `color-mix` | 1 | calcular el color a mano |

### Las tres piezas caras

**Los mapas.** Leaflet con mosaicos de OpenStreetMap, marcadores con HTML propio
(`divIcon`), globos, el control de zoom, el plugin de mapa de calor y el selector de
ubicación. Con `react-native-maps` cambias a Google Maps o Apple Maps, lo que implica
**clave de API y un modelo de costes** que hoy no tienes. El mapa de calor hay que
rehacerlo. Y el tope de zoom de los mapas ajenos (#55-57) se consigue de otra forma.

**El chat.** Lista invertida con paginación, burbujas agrupadas por bloques, deslizar para
responder, mantener pulsado para reaccionar, saltar al mensaje citado, el teclado. Es la
pantalla con más estado de toda la app.

**La navegación.** Hoy son `pushState` y una trampa del botón atrás hecha a mano, con
`_chatNavDepth` como invariante. Eso no se traduce: se tira y se rehace con el router.

### Lo que sí se porta casi tal cual

`store.js` entero, los dos diccionarios de `i18n.js`, `funfacts.js`, `firestore.rules`,
toda la lógica de rachas, contadores, hitos, conexiones y Bristol. **Es más de la mitad
del valor del proyecto y no se toca.** Es la razón por la que esto es viable.

---

## 5. Arquitectura propuesta

```
cagometro-app/          (este repo, la PWA — sigue viva)
cagometro-native/       (repo nuevo, Expo)
  app/                  rutas (expo-router)
  src/
    data/               ← store.js portado, casi sin cambios
    components/
    hooks/
    i18n/               ← copiado tal cual
  assets/
```

**Repo nuevo, no una carpeta dentro de este.** Mezclarlos complica las herramientas y hace
que Claude se confunda de contexto. Dos repos, una sola base de datos de Firebase.

### Firebase en React Native

Dos caminos, y conviene elegir pronto porque condiciona todo:

- **SDK web de Firebase** (`firebase/app`, el que ya usas). Lo que menos cambia: `store.js`
  casi no se toca. Es la opción sensata aquí.
- **React Native Firebase** (`@react-native-firebase/*`), módulos nativos. Mejor
  rendimiento y mejor soporte offline, pero reescribes la capa de datos y necesitas
  compilaciones propias desde el principio.

**Recomendación: empezar con el SDK web.** Si algún día la persistencia offline se queda
corta, se cambia; `store.js` está lo bastante aislado como para que duela poco.

El inicio de sesión con Google **no se porta**: `signInWithPopup` no existe en nativo. Se
hace con `expo-auth-session` o el módulo nativo de Google. Es la primera cosa que se rompe
y conviene resolverla pronto, porque sin ella no puedes ni entrar a probar.

### Notificaciones

Elegiste el servicio de Expo. El cambio:

```
HOY:    app → pushQueue (Firestore) → Raspberry Pi (firebase-admin) → FCM → móvil
MAÑANA: app → pushQueue (Firestore) → Raspberry Pi (HTTP) → Expo Push → móvil
```

La cola y las preferencias por categoría que montamos en #59 **se quedan igual**. Lo que
cambia es el token que guarda cada dispositivo y la llamada final de la Pi. La Pi tendrá
que distinguir tokens web (FCM) de tokens nativos (Expo) mientras convivan las dos apps:
guárdalos en campos distintos desde el primer día.

---

## 6. El plan, por fases

Cada fase termina en algo que puedes abrir en tu móvil. Publicas al final, pero ves
resultados desde la segunda semana.

### Fase 0 · Deuda que arrastra la web *(hazla aquí, en este repo)*
- Borrado de cuenta.
- Denunciar y bloquear.
- Política de privacidad publicada.
- **Arreglar el README**, que hoy describe un `api.js` con datos simulados que ya no
  existe y va a despistar a Claude en el proyecto nuevo.

### Fase 1 · Esqueleto
- Crear el proyecto con `npx create-expo-app` y `expo-router`.
- Cuenta de Apple Developer (99 €/año) y de Google Play (25 $ una vez). **Tramítalas ya**:
  la de Apple puede tardar días en verificarse y bloquea todo lo demás.
- Firebase conectado, inicio de sesión con correo funcionando.
- `store.js` portado y leyendo datos de verdad.
- Primera compilación de desarrollo instalada en tu móvil.

### Fase 2 · El núcleo
- Contador, sumar, deshacer, cacas olvidadas.
- Feed con reacciones.
- Amigos y grupos con rankings.
- Ajustes, incluidas las preferencias de notificación.
- **Aquí ya la usas tú a diario.**

### Fase 3 · Lo nativo
- Notificaciones con Expo, cambio en la Pi.
- Ubicación y permisos.
- Haptics.
- Conexiones de tuberías y combos (dependen de ubicación y avisos).

### Fase 4 · Las pantallas caras
- Chat completo.
- Mapas.
- Bristol, estadísticas y gráficas.
- Panel de admin.

### Fase 5 · Tiendas
- Iconos y pantalla de carga, capturas de cada tamaño.
- Etiquetas de privacidad y clasificación por edad.
- Textos de permiso (ubicación y notificaciones) — **en castellano y explicando el porqué**,
  que los genéricos se rechazan.
- TestFlight y pruebas internas con el grupo antes de enviar.
- Enviar a revisión.

---

## 7. Trabajar con Claude en VSCode

Vas a usar Claude dentro del editor. Tres cosas que cambian mucho el resultado:

### Crea un `CLAUDE.md` en el repo nuevo

Es lo primero que lee Claude en cada sesión. Ponle: qué es la app, qué decisiones están
cerradas (SDK web de Firebase, Expo Router, push de Expo), las convenciones de código, y
**qué NO hacer** (p.ej. «no reintroducir `innerHTML`», «los textos siempre por i18n, nunca
incrustados»). Sin esto repetirás el mismo contexto cada día.

Ten también este repo a mano: la referencia de cómo funciona cada cosa es el código
actual, y conviene que Claude pueda mirarlo.

### Pide pantalla a pantalla, no «pórtame la app»

Una pantalla por sesión, con el fichero de referencia delante. Algo así:

> Porta la pantalla de ajustes a React Native. La referencia es `settingsSheet` en
> `index.html` del repo antiguo y sus manejadores en `app.js`. Mantén los mismos ids de
> claves i18n. Usa los componentes que ya hay en `src/components`. No metas texto
> incrustado: todo por `t()`.

### Arrastra el diseño, no lo reinventes

Los colores y tipografías están en `:root` de `styles.css`. Pásaselos una vez a un fichero
de tema y oblígate a usarlo:

```
--paper #FBF6EC · --card #FFFFFF · --ink #241B12 · --ink-soft #7A6A58
--brand #6E3F1C (espresso) · --brand-2 #9A5A2A · --gold #E59A2E
--mint #2E9E68 · --rose #D8573F
Titulares: Fraunces · Texto: Hanken Grotesk · Esquinas 18-26px
```

---

## 8. Cuentas, costes y tiempos

| | coste | aviso |
|---|---|---|
| Apple Developer | 99 €/año | tramítala la primera semana; verificar la identidad tarda |
| Google Play | 25 $ una vez | también piden verificación de identidad |
| Google Maps (si usas `react-native-maps`) | según uso | hay capa gratis; vigila que no se dispare |
| Firebase | lo que ya pagas | no cambia: misma base de datos |
| Expo EAS (compilar en la nube) | hay plan gratis | con cola; de pago va más rápido |

**Sobre los plazos**: no te doy semanas porque no sé cuánto tiempo le vas a dedicar ni a
qué ritmo trabajas con Claude. Lo que sí te digo es el orden de magnitud de cada trozo: la
fase 2 es la mitad del valor y menos de un tercio del esfuerzo; la fase 4 (chat y mapas)
es la mitad del esfuerzo y se puede posponer sin que nadie se quede sin app.

---

## 9. Trampas conocidas

- **Expo Go no sirve para esto.** En cuanto metas notificaciones o mapas necesitas una
  *development build* propia. Cuanto antes la montes, menos tiempo pierdes.
- **Las dos apps a la vez.** Mientras convivan, cada cambio de datos tiene que valer para
  las dos. Los campos nuevos, siempre opcionales y con el ausente por defecto — es el
  patrón que ya usamos en `notifPrefs` y en `replyTo`.
- **Los tokens de push se mezclan.** Guarda los de web y los de Expo en campos distintos o
  la Pi intentará mandar al sitio equivocado.
- **Las reglas de Firestore son las mismas.** Lo que hoy esté flojo, seguirá flojo. En
  particular: `users/{uid}/cacas` deja leer a cualquier autenticado, con un `// TODO` puesto
  en el propio fichero. Si la app va a estar en tiendas públicas, esto deja de ser una nota
  y pasa a ser un problema.
- **Las fotos de Bristol** son 7 PNG de ~45 KB. En nativo entran en el paquete: conviene
  comprimirlas o pasarlas a formato moderno.
- **La zona horaria** se guarda en cada caca (`tz`). En nativo se obtiene distinto; que no
  se te quede en blanco o romperás las estadísticas por hora.

---

## 10. Lo primero que harías mañana

1. Tramitar la cuenta de Apple Developer. Bloquea todo lo demás y tarda.
2. En **este** repo: borrado de cuenta, denunciar/bloquear, política de privacidad.
3. Crear `cagometro-native` con Expo y su `CLAUDE.md`.
4. Conseguir que el inicio de sesión con correo funcione y que `store.js` lea datos reales.

Con eso tienes la base y las tres cosas que te habrían bloqueado al final, resueltas al
principio.
