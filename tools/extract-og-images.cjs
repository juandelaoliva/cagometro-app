#!/usr/bin/env node
/* ============================================================================
   Cagómetro · extractor de og:image para los fun facts
   ----------------------------------------------------------------------------
   Cada fun fact guarda la `url` de su fuente. Este script visita esas páginas,
   lee la etiqueta <meta property="og:image"> del HTML y añade el campo `img` a
   funfacts.js, para poder ilustrar la tarjeta de "¿Sabías que?".

   Se ejecuta UNA vez y desde tu máquina (la app nunca hace esto: no puede, por
   CORS, y sería absurdo bajarse un artículo entero para leer una línea).

   Uso:
     node tools/extract-og-images.cjs              # prueba, no escribe nada
     node tools/extract-og-images.cjs --apply      # reescribe funfacts.js
     node tools/extract-og-images.cjs --apply --only-missing

   Guarda una caché en tools/.og-cache.json, así que si lo relanzas no vuelve a
   pedir las que ya consiguió. Puedes cortarlo (Ctrl-C) y retomarlo.

   Requiere Node 18+ (usa fetch nativo). No instala nada.
   ========================================================================== */
const fs = require("fs");
const path = require("path");

const ROOT       = path.resolve(__dirname, "..");
const FACTS_FILE = path.join(ROOT, "funfacts.js");
const CACHE_FILE = path.join(__dirname, ".og-cache.json");

const APPLY        = process.argv.includes("--apply");
const ONLY_MISSING = process.argv.includes("--only-missing");

// Pausa entre peticiones. 65 de los 100 enlaces son del mismo dominio, así que
// conviene no ir a saco: es una extracción de una sola vez, no hay prisa.
const DELAY_MS   = 1200;
const TIMEOUT_MS = 20000;
const REINTENTOS = 1;

// Nos presentamos como lo que somos: un lector de vistas previas. Si algún sitio
// devuelve 403, prueba con un User-Agent de navegador normal.
const UA = "Mozilla/5.0 (compatible; CagometroLinkPreview/1.0)";

const sleep = ms => new Promise(r => setTimeout(r, ms));

// El contenido de og:image viene escapado como HTML (&amp; en los parámetros es
// lo habitual). Sin esto, la URL resultante estaría rota.
const unescapeHtml = s => s
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x2F;/gi, "/");

// Bastantes sitios declaran un og:image de plantilla —su logo, su tarjeta social
// genérica— cuando el artículo no tiene imagen propia. Eso es peor que no tener
// nada: PubMed Central devuelve la MISMA tarjeta para todos sus artículos, así que
// media tarjetera saldría con el logo de PMC. Mejor descartarla y dejar que la app
// use el respaldo por categoría, que al menos varía.
const GENERICAS = [
  /\/pmc\/cms\/images\/pmc-card-share\./i,     // PubMed Central
  /natgeo\/static\/default\.NG\.logo/i,        // National Geographic
  /\/scidaily-icon\./i,                        // ScienceDaily
  /\/social-cards\/[a-z-]*homepage\./i,        // Sky HISTORY y similares
  /\/themes\/custom\/[^/]+\/images\//i,        // logo del tema del CMS (NOAA Repository, Drupal…)
  /\/(logo|default|placeholder)\.(png|jpe?g|svg)$/i,
];
const esGenerica = url => GENERICAS.some(re => re.test(url));

// Busca og:image y, si no está, las alternativas habituales. Acepta los atributos
// en cualquier orden, que varía mucho entre CMS.
function extraerImagen(html, baseUrl){
  const props = ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"];
  for (const prop of props){
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*?content=["']([^"']+)["']` +
      `|<meta[^>]+content=["']([^"']+)["'][^>]*?(?:property|name)=["']${prop}["']`, "i");
    const m = html.match(re);
    const val = m && (m[1] || m[2]);
    if (val){
      try {
        const abs = new URL(unescapeHtml(val.trim()), baseUrl).href;    // resuelve relativas
        if (!esGenerica(abs)) return abs;    // si es plantilla, probamos la siguiente propiedad
      } catch { /* URL inválida: seguimos probando */ }
    }
  }
  return null;
}

async function pedir(url){
  for (let i = 0; i <= REINTENTOS; i++){
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } catch (e) {
      if (i === REINTENTOS) throw e;
      await sleep(2000);
    }
  }
}

(async () => {
  const original = fs.readFileSync(FACTS_FILE, "utf8");
  const lineas   = original.split("\n");
  const cache    = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) : {};

  // Localiza las líneas que son un fun fact (un objeto JSON por línea).
  const entradas = [];
  lineas.forEach((linea, i) => {
    const m = linea.match(/^(\s*)(\{.*\})(,?)\s*$/);
    if (!m) return;
    try { entradas.push({ i, sangria: m[1], obj: JSON.parse(m[2]), coma: m[3] }); }
    catch { /* no es JSON: no es un fun fact */ }
  });

  // Una plantilla que ya esté guardada en funfacts.js se tira: así el fichero se cura
  // solo al relanzar, en vez de arrastrarla porque "ya tiene imagen".
  let limpiadas = 0;
  for (const e of entradas) if (e.obj.img && esGenerica(e.obj.img)){ delete e.obj.img; limpiadas++; }
  if (limpiadas) console.log(`${limpiadas} imágenes de plantilla descartadas de funfacts.js`);

  const pendientes = entradas.filter(e => e.obj.url && !(ONLY_MISSING && e.obj.img));
  console.log(`${entradas.length} fun facts · ${pendientes.length} por procesar` +
              `${Object.keys(cache).length ? ` · ${Object.keys(cache).length} ya en caché` : ""}`);
  console.log(APPLY ? "MODO APPLY: al terminar se reescribe funfacts.js\n" : "PRUEBA: no se escribirá nada\n");

  let ok = 0, fallos = [];
  for (const [n, e] of pendientes.entries()){
    const url = e.obj.url;
    const etiqueta = `[${String(n + 1).padStart(3)}/${pendientes.length}] ${new URL(url).hostname}`;

    if (cache[url]){                       // ya resuelta en una pasada anterior
      // La caché puede venir de antes de que existiera el filtro de plantillas, así
      // que hay que pasarla por él igual: si no, una entrada vieja reinyecta el logo
      // del sitio sin llegar a tocar extraerImagen().
      if (esGenerica(cache[url])){
        delete cache[url];
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
        fallos.push({ url, motivo: "en caché, pero es una plantilla del sitio" });
        console.log(`${etiqueta}  ❌ en caché, pero es una plantilla del sitio`);
        continue;
      }
      e.obj.img = cache[url]; ok++;
      console.log(`${etiqueta}  ⏩ en caché`);
      continue;
    }
    try {
      const html = await pedir(url);
      const img  = extraerImagen(html, url);
      if (!img) throw new Error("sin og:image propia (o es una plantilla del sitio)");
      e.obj.img = img; cache[url] = img; ok++;
      console.log(`${etiqueta}  ✅ ${img.slice(0, 70)}`);
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));   // guarda ya: permite cortar
    } catch (err) {
      fallos.push({ url, motivo: err.message });
      console.log(`${etiqueta}  ❌ ${err.message}`);
    }
    if (n < pendientes.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n── Resumen ──`);
  console.log(`  con imagen : ${ok}`);
  console.log(`  sin imagen : ${fallos.length}`);
  if (fallos.length){
    console.log(`\n  Fallidas (la tarjeta usará el respaldo por categoría):`);
    fallos.forEach(f => console.log(`    ${f.motivo.padEnd(34)} ${f.url}`));
    console.log(`\n  Relanza el script para reintentar solo estas (las buenas están cacheadas).`);
  }

  if (!APPLY){ console.log("\nNada escrito. Relanza con --apply para aplicarlo."); return; }

  // Reescribe SOLO las líneas de los fun facts, dejando intactos la cabecera, el
  // export y el formato del fichero.
  for (const e of entradas) lineas[e.i] = e.sangria + JSON.stringify(e.obj) + e.coma;
  const salida = lineas.join("\n");

  fs.writeFileSync(FACTS_FILE + ".bak", original);      // por si acaso
  fs.writeFileSync(FACTS_FILE, salida);
  console.log(`\nfunfacts.js reescrito (copia de seguridad en funfacts.js.bak)`);
  console.log(`Compruébalo con:  node --check funfacts.js && git diff --stat`);
})().catch(e => { console.error("ERROR:", e); process.exit(1); });
