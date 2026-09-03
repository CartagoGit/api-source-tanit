/**
 * La interfaz, embebida como texto.
 *
 * Va en un `.ts` y no en un `.html` a propósito: el binario compilado
 * **no puede leer ficheros que no estén dentro de él**, así que un
 * `readFile("index.html")` funcionaría en desarrollo y fallaría en el
 * ejecutable que se distribuye — el peor tipo de fallo, el que solo
 * aparece en la máquina de quien lo usa.
 *
 * Sin dependencias de terceros, por lo mismo: no hay CDN que valga
 * cuando el objetivo es abrir un `.exe` y que funcione.
 *
 * Accesibilidad, decidida aquí y no «más adelante»:
 *
 *   · Todo se recorre con el teclado, en orden, y el foco se ve.
 *   · El estado no se comunica solo por color — lleva texto.
 *   · Lo que cambia solo (resultados, errores) va en `aria-live`, o un
 *     lector de pantalla no se entera de nada.
 *   · Se respeta `prefers-reduced-motion` y `prefers-color-scheme`.
 */
export const UI_HTML = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Export to Postman</title>
<style>
  /*
   * El tema, en variables y con los mismos nombres que la hoja de
   * estilos compartida. Quien no elige nada sigue al sistema
   * (prefers-color-scheme); data-tema, cuando existe, gana — para que
   * eso sea posible, el bloque del sistema lleva el selector :not().
   */
  :root {
    color-scheme: light dark;
    --fondo: #ffffff; --texto: #1a1a1a; --tenue: #5c5c5c;
    --borde: #d4d4d4; --acento: #cc5500; --error: #b00020; --ok: #006644;
    --aviso: #9a6700;
    --campo: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-tema="light"]) {
      --fondo: #16181c; --texto: #eceff4; --tenue: #a8b0bd;
      --borde: #333842; --acento: #ff9552; --error: #ff8a8a; --ok: #6ee7a8;
      --aviso: #d29922;
      --campo: #1e2128;
    }
  }
  /* Elegidos a mano, que ganan en los dos sentidos. */
  :root[data-tema="dark"] {
    color-scheme: dark;
    --fondo: #16181c; --texto: #eceff4; --tenue: #a8b0bd;
    --borde: #333842; --acento: #ff9552; --error: #ff8a8a; --ok: #6ee7a8;
    --aviso: #d29922;
    --campo: #1e2128;
  }
  :root[data-tema="light"] {
    color-scheme: light;
    --fondo: #ffffff; --texto: #1a1a1a; --tenue: #5c5c5c;
    --borde: #d4d4d4; --acento: #cc5500; --error: #b00020; --ok: #006644;
    --aviso: #9a6700;
    --campo: #ffffff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.25rem; background: var(--fondo); color: var(--texto);
    font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  p.sub { color: var(--tenue); margin: 0 0 2rem; }
  fieldset { border: 1px solid var(--borde); border-radius: 8px; padding: 1rem 1.25rem 1.25rem; margin: 0 0 1.25rem; }
  legend { padding: 0 .4rem; font-weight: 600; }
  label { display: block; font-weight: 600; margin: .75rem 0 .3rem; }
  input[type=text] {
    width: 100%; padding: .55rem .7rem; border: 1px solid var(--borde); border-radius: 6px;
    background: var(--campo); color: var(--texto); font: inherit;
  }
  /* El foco tiene que verse: sin esto, con teclado no se sabe dónde estás. */
  :focus-visible { outline: 3px solid var(--acento); outline-offset: 2px; }
  .formatos { display: flex; flex-wrap: wrap; gap: .4rem 1.1rem; margin-top: .4rem; }
  .formatos label { font-weight: 400; margin: 0; display: flex; align-items: center; gap: .4rem; }
  button {
    font: inherit; font-weight: 600; padding: .6rem 1.1rem; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--acento); background: var(--acento); color: #fff;
  }
  button.secundario { background: transparent; color: var(--texto); border-color: var(--borde); }
  button[disabled] { opacity: .55; cursor: not-allowed; }
  .acciones { display: flex; gap: .6rem; flex-wrap: wrap; margin-top: 1rem; }
  .aviso { border-left: 4px solid var(--borde); padding: .6rem .9rem; margin-top: 1rem; border-radius: 0 6px 6px 0; }
  .aviso.error { border-left-color: var(--error); }
  .aviso.exito { border-left-color: var(--ok); }
  /* El estado no se dice solo con color. */
  .aviso .etiqueta { font-weight: 700; }
  .aviso.error .etiqueta { color: var(--error); }
  .aviso.exito .etiqueta { color: var(--ok); }
  table { width: 100%; border-collapse: collapse; margin-top: .6rem; }
  th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid var(--borde); }
  th { color: var(--tenue); font-weight: 600; }
  code { background: var(--campo); padding: .1rem .35rem; border-radius: 4px; }
  .cargando::after { content: "…"; animation: puntos 1.2s steps(4) infinite; }
  @keyframes puntos { to { content: "…"; } }
  /* Pantalla de ajustes: una tarjeta con la tuerca arriba a la derecha. */
  .tuerca {
    font-size: 1.1rem; line-height: 1; padding: .45rem .6rem; font-weight: 400;
    background: transparent; color: var(--texto); border: 1px solid var(--borde);
  }
  .tuerca[aria-expanded="true"] { border-color: var(--acento); color: var(--acento); }
  .cabecera { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
  .cabecera h1 { margin: 0 0 .25rem; }
  .tarjeta {
    margin-top: 1.25rem; background: var(--campo); border: 1px solid var(--borde);
    border-radius: 8px; padding: 1rem 1.25rem 1.25rem;
  }
  .tarjeta h2 { font-size: 1.1rem; margin: 0 0 .75rem; }
  .tarjeta label { font-weight: 600; margin: .75rem 0 .3rem; }
  .tarjeta .fila { display: flex; gap: 1rem; flex-wrap: wrap; }
  .tarjeta .fila > div { flex: 1; min-width: 12rem; }
  .tarjeta select {
    width: 100%; padding: .55rem .7rem; border: 1px solid var(--borde); border-radius: 6px;
    background: var(--campo); color: var(--texto); font: inherit;
  }
  /*
   * Dashboard de historial (f00010 S4).
   *
   * Tarjeta plana encima del formulario: "lo último que se generó"
   * se ve antes de empezar a escribir rutas. Cada entrada es una fila
   * con proyecto, framework y fecha; un enlace textual al final abre
   * la ruta del proyecto en una nueva pestaña si el navegador lo
   * permite (file://), y si no, la copia.
   */
  .historial {
    margin: 0 0 1.25rem;
  }
  .historial ol {
    list-style: none; padding: 0; margin: .25rem 0 0;
  }
  .historial li {
    display: grid; grid-template-columns: auto 1fr auto; gap: .35rem .8rem;
    padding: .4rem 0; border-top: 1px solid var(--borde);
    align-items: baseline;
  }
  .historial li:first-child { border-top: 0; }
  .historial .cuando {
    font-variant-numeric: tabular-nums; color: var(--tenue); font-size: .9rem;
  }
  .historial .que { font-weight: 600; }
  .historial .que small {
    font-weight: 400; color: var(--tenue); margin-left: .35rem;
  }
  .historial .accion {
    font-size: .85rem; color: var(--acento); background: transparent;
    border: 0; padding: 0; cursor: pointer; text-decoration: underline;
  }
  .historial .vacio {
    color: var(--tenue); margin: .25rem 0 0; font-style: italic;
  }
  /*
   * f00010 S3: detalle de la detección.
   *
   * La misma información que la CLI imprime bajo "→ ¿Por qué ...?" y
   * "→ Health: ..." se enseña aquí con emoji + color. Dos bloques
   * (evidencia y salud) en una rejilla que se apila en móvil y se
   * separa en escritorio. Los colores salen de las variables del
   * tema, así que un cambio de tema pinta esta sección sin tocarla.
   */
  .deteccion { margin-top: 1.25rem; }
  .deteccion-cuerpo {
    display: grid; gap: 1rem;
    grid-template-columns: 1fr;
  }
  @media (min-width: 38rem) {
    .deteccion-cuerpo { grid-template-columns: 1fr 1fr; }
  }
  .deteccion-bloque {
    border: 1px solid var(--borde);
    border-radius: 6px;
    padding: .75rem .9rem;
    background: var(--campo);
  }
  .deteccion-bloque-titulo {
    margin: 0 0 .55rem;
    font-size: .82rem;
    font-weight: 700;
    color: var(--tenue);
    letter-spacing: .04em;
    text-transform: uppercase;
  }
  .deteccion .vacio {
    color: var(--tenue); font-style: italic; margin: 0;
  }
  /*
   * Evidencia: cada señal es una fila con la señal, su peso y el
   * artefacto del que salió. En móvil el archivo baja a una segunda
   * línea; en escritorio, tres columnas alineadas a la línea base.
   */
  .evidencia-lista { list-style: none; padding: 0; margin: 0; }
  .evidencia-item {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      "senial peso"
      "archivo archivo";
    gap: .15rem .6rem;
    padding: .4rem 0;
    border-top: 1px solid var(--borde);
  }
  .evidencia-item:first-child { border-top: 0; padding-top: .15rem; }
  @media (min-width: 30rem) {
    .evidencia-item {
      grid-template-columns: 1fr auto auto;
      grid-template-areas: "senial peso archivo";
      align-items: baseline;
    }
  }
  .evidencia-senial { grid-area: senial; font-weight: 500; }
  .evidencia-peso {
    grid-area: peso;
    font-variant-numeric: tabular-nums;
    font-size: .9rem;
    color: var(--tenue);
  }
  .evidencia-archivo {
    grid-area: archivo;
    color: var(--tenue);
    font-size: .8rem;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }
  /* La brújula precede cada señal: apunta a por qué se eligió. */
  .evidencia-senial::before {
    content: "\u{1F9ED} ";
    margin-right: .15rem;
  }
  /*
   * Salud: cuatro barras (validación / body / ejemplos / descripciones)
   * con un círculo de color que codifica el tramo. El porcentaje va al
   * lado del texto, no solo el color: la barra cambia de tono, el
   * texto repite la cifra. Quien mira el código ve ambas; quien solo
   * mira, entiende igual (WCAG 1.4.1).
   */
  .salud-grid { display: grid; gap: .6rem .8rem; }
  .salud-celda {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      "etiqueta porcentaje"
      "barra barra";
    gap: .2rem .6rem;
    align-items: baseline;
  }
  .salud-etiqueta { grid-area: etiqueta; font-weight: 600; }
  .salud-porcentaje {
    grid-area: porcentaje;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }
  .salud-barra {
    grid-area: barra;
    height: 6px;
    background: var(--borde);
    border-radius: 3px;
    overflow: hidden;
  }
  .salud-barra-relleno {
    height: 100%;
    border-radius: 3px;
    transition: width .25s ease-out;
  }
  .salud-celda--ok .salud-barra-relleno { background: var(--ok); }
  .salud-celda--ok .salud-porcentaje { color: var(--ok); }
  .salud-celda--aviso .salud-barra-relleno { background: var(--aviso); }
  .salud-celda--aviso .salud-porcentaje { color: var(--aviso); }
  .salud-celda--error .salud-barra-relleno { background: var(--error); }
  .salud-celda--error .salud-porcentaje { color: var(--error); }
  @media (prefers-reduced-motion: reduce) { *, *::after { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
<main>
  <div class="cabecera">
    <div>
      <h1 data-i18n="app.title">Export to Postman</h1>
      <p class="sub">Apunta a la carpeta de tu API y mira lo detectado antes de escribir nada.</p>
    </div>
    <button type="button" id="ajustes" class="tuerca" aria-haspopup="dialog" data-i18n-attr="aria-label:nav.settings" title="Ajustes" aria-label="Ajustes">&#9881;</button>
  </div>

  <div id="vista-principal">
    <!--
      f00010 S4: dashboard de historial de generaciones.
      Se rellena por JS al cargar (pide /api/history) y tras cada
      generación satisfactoria (refresca). Sin historial, dice "todavía
      nada" en vez de esconder la sección: esconderla es como no tener
      dashboard.
    -->
    <section id="historial" class="tarjeta historial" aria-labelledby="historial-titulo">
      <h2 id="historial-titulo">Historial reciente</h2>
      <div id="historial-lista" aria-live="polite">
        <p class="vacio">Cargando…</p>
      </div>
    </section>

    <form id="form">
      <fieldset>
        <legend>Proyecto</legend>
        <label for="raiz" data-i18n="project.label">Carpeta del proyecto</label>
        <input type="text" id="raiz" name="raiz" required autocomplete="off"
               aria-describedby="ayuda-raiz" placeholder="/ruta/a/tu/api">
        <p id="ayuda-raiz" class="sub" style="margin:.35rem 0 0">
          La raíz, donde está el manifiesto (<code>package.json</code>, <code>go.mod</code>…).
        </p>
        <div class="acciones">
          <button type="submit" id="inspeccionar" data-i18n="action.inspect">Ver lo detectado</button>
        </div>
      </fieldset>

      <fieldset id="paso-generar" hidden>
        <legend>Salida</legend>
        <label for="salida"><span data-i18n="output.label">Carpeta de salida</span> <span class="sub">(opcional)</span></label>
        <input type="text" id="salida" name="salida" autocomplete="off"
               placeholder="por defecto, dentro del proyecto">
        <div class="fila">
          <div>
            <label for="framework" data-i18n="framework.label">Framework</label>
            <select id="framework">
              <option value="" data-i18n="framework.auto">Detectar automáticamente</option>
            </select>
          </div>
        </div>
        <fieldset style="margin-top:1rem">
          <legend data-i18n="format.label">Formatos</legend>
          <div class="formatos" id="formatos" role="group" aria-label="Formatos de salida"></div>
          <p class="sub" id="nota-bruno" hidden></p>
        </fieldset>
        <div class="acciones">
          <button type="button" id="generar" data-i18n="action.generate">Generar</button>
        </div>
      </fieldset>
    </form>
  </div>

  <!--
    f00010 S3: detalle de la detección.
    La sección se rellena tras /api/inspect con la evidencia y la
    salud que ya vienen en el summary (S1 + S2). Vacía al cargar:
    "todavía nada" en vez de oculta — quien no sabe que existe, no la
    busca; quien la ve, entiende que se completa al inspeccionar.
  -->
  <section id="deteccion" class="tarjeta deteccion" hidden aria-labelledby="deteccion-titulo">
    <h2 id="deteccion-titulo">¿Por qué este framework? · Salud de la documentación</h2>
    <div class="deteccion-cuerpo">
      <div class="deteccion-bloque">
        <h3 class="deteccion-bloque-titulo">Señales que motivaron la elección</h3>
        <div class="evidencia" id="evidencia-lista" aria-live="polite"></div>
      </div>
      <div class="deteccion-bloque">
        <h3 class="deteccion-bloque-titulo">Salud de la documentación</h3>
        <div class="salud" id="salud-cuadro" aria-live="polite"></div>
      </div>
    </div>
  </section>

  <section id="vista-ajustes" class="tarjeta" hidden>
    <h2 data-i18n="nav.settings">Ajustes</h2>
    <div class="fila">
      <div>
        <label for="idioma" data-i18n="settings.language">Idioma</label>
        <select id="idioma"></select>
      </div>
      <div>
        <label for="tema" data-i18n="settings.theme">Tema</label>
        <select id="tema">
          <option value="system" data-i18n="theme.system">Sigue al sistema</option>
          <option value="light" data-i18n="theme.light">Claro</option>
          <option value="dark" data-i18n="theme.dark">Oscuro</option>
        </select>
      </div>
    </div>
    <div class="acciones">
      <button type="button" id="volver" class="secundario" data-i18n="nav.back">Volver</button>
    </div>
  </section>

  <!-- Lo que cambia solo va aquí, y se anuncia. -->
  <div id="salida-viva" role="status" aria-live="polite"></div>
</main>
<script>
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var viva = $("salida-viva");

  function pinta(tipo, titulo, cuerpo) {
    var etiqueta = tipo === "error" ? "Error" : tipo === "exito" ? "Hecho" : "Aviso";
    viva.innerHTML = "";
    var caja = document.createElement("div");
    caja.className = "aviso " + tipo;
    var h = document.createElement("p");
    h.style.margin = "0";
    var e = document.createElement("span");
    e.className = "etiqueta";
    e.textContent = etiqueta + ": ";
    h.appendChild(e);
    h.appendChild(document.createTextNode(titulo));
    caja.appendChild(h);
    if (cuerpo) caja.appendChild(cuerpo);
    viva.appendChild(caja);
  }

  function tabla(filas) {
    var t = document.createElement("table");
    var tb = document.createElement("tbody");
    filas.forEach(function (f) {
      var tr = document.createElement("tr");
      var th = document.createElement("th");
      th.scope = "row"; th.textContent = f[0];
      var td = document.createElement("td");
      td.textContent = String(f[1]);
      tr.appendChild(th); tr.appendChild(td); tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }

  /**
   * f00010 S3: pinta la tarjeta "¿Por qué este framework? · Salud de
   * la documentación" tras una inspección exitosa.
   *
   * El summary que devuelve '/api/inspect' ya lleva los bloques
   * 'evidence' (S1) y 'health' (S2); este render solo les da una cara
   * legible. Dos tarjetas en paralelo en escritorio, apiladas en
   * móvil:
   *
   *   · Evidencia: cada señal con su peso y el artefacto del que salió.
   *     Un detector sin anotar (la mayoría, hoy) muestra "todavía sin
   *     señales" en vez de esconder la tarjeta — esconder sería como
   *     decir que no existe.
   *   · Salud: cuatro barras con porcentaje + emoji + color. El color
   *     va por tramo (ok ≥ 75 %, aviso ≥ 50 %, error < 50 %) y se
   *     repite el porcentaje como texto, no solo como color.
   *
   * Todo se monta con 'createElement' y 'textContent'. Los nombres de
   * archivo y las señales son strings arbitrarios del usuario o del
   * detector; pasarlos por 'innerHTML' los interpretaría como HTML y
   * un '<' o un '&' rompería el render o abriría XSS. El 'innerHTML =
   * ""' que aparece aquí limpia el contenedor entre inspecciones: no
   * se interpolan datos del summary, así que es seguro.
   */
  function pintaDeteccion(s) {
    var seccion = $("deteccion");
    var lista = $("evidencia-lista");
    var cuadro = $("salud-cuadro");
    if (!seccion || !lista || !cuadro) return;
    seccion.hidden = false;
    lista.innerHTML = "";
    cuadro.innerHTML = "";
    pintaEvidencia(s.evidence || [], lista);
    pintaSalud(s.health, cuadro);
  }

  /**
   * Cada señal es una fila con: la señal en sí (la brújula la pone el
   * CSS, no JS), el peso y, si lo hay, el artefacto del que se leyó.
   * Vacío si el detector aún no se ha enriquecido: se dice "todavía
   * sin señales", no se esconde el bloque.
   */
  function pintaEvidencia(evidence, cont) {
    if (!evidence || evidence.length === 0) {
      var vacio = document.createElement("p");
      vacio.className = "vacio";
      vacio.textContent = "El detector aún no anota señales para este framework.";
      cont.appendChild(vacio);
      return;
    }
    var ul = document.createElement("ul");
    ul.className = "evidencia-lista";
    evidence.forEach(function (e) {
      var li = document.createElement("li");
      li.className = "evidencia-item";
      var senial = document.createElement("span");
      senial.className = "evidencia-senial";
      senial.textContent = e.signal || "";
      var peso = document.createElement("span");
      peso.className = "evidencia-peso";
      // El peso puede ser negativo (penalizaciones): se imprime con
      // su signo y dos decimales para que la columna no salte al
      // cambiar la escala.
      var w = typeof e.weight === "number" ? e.weight : 0;
      peso.textContent = (w >= 0 ? "+" : "") + w.toFixed(2);
      li.appendChild(senial);
      li.appendChild(peso);
      if (e.artifact) {
        var archivo = document.createElement("span");
        archivo.className = "evidencia-archivo";
        archivo.textContent = e.artifact;
        li.appendChild(archivo);
      }
      ul.appendChild(li);
    });
    cont.appendChild(ul);
  }

  /**
   * Cuatro barras, una por categoría del health:
   *   · 75 % o más → ok (verde, círculo verde).
   *   · 50 % o más → aviso (ámbar, círculo amarillo).
   *   · menos de 50 % → error (rojo, círculo rojo).
   *
   * El emoji y el porcentaje van juntos para que el color no sea lo
   * único que comunica el estado (WCAG 1.4.1). Si 'health' no viene
   * (versiones viejas del API), se pinta un mensaje neutro en vez de
   * reventar.
   */
  function pintaSalud(health, cont) {
    if (!health || typeof health !== "object") {
      var v = document.createElement("p");
      v.className = "vacio";
      v.textContent = "La salud de la documentación no está disponible.";
      cont.appendChild(v);
      return;
    }
    var rejilla = document.createElement("div");
    rejilla.className = "salud-grid";
    var piezas = [
      { clave: "withValidationPercent",  etiqueta: "Validación" },
      { clave: "withBodySchemaPercent",  etiqueta: "Body schema" },
      { clave: "withExamplesPercent",    etiqueta: "Ejemplos" },
      { clave: "withDescriptionPercent", etiqueta: "Descripciones" },
    ];
    piezas.forEach(function (p) {
      var valor = health[p.clave];
      var pct = typeof valor === "number" ? Math.max(0, Math.min(100, Math.round(valor))) : 0;
      var tramo = pct >= 75 ? "ok" : pct >= 50 ? "aviso" : "error";
      var emoji = tramo === "ok" ? "\u{1F7E2}" : tramo === "aviso" ? "\u{1F7E1}" : "\u{1F534}";
      var celda = document.createElement("div");
      celda.className = "salud-celda salud-celda--" + tramo;
      var et = document.createElement("span");
      et.className = "salud-etiqueta";
      et.textContent = emoji + " " + p.etiqueta;
      var pc = document.createElement("span");
      pc.className = "salud-porcentaje";
      pc.textContent = pct + "%";
      var barra = document.createElement("div");
      barra.className = "salud-barra";
      var relleno = document.createElement("div");
      relleno.className = "salud-barra-relleno";
      // El ancho va por style (CSSOM), no por innerHTML: no es
      // interpolación de texto del usuario, es un porcentaje
      // numérico ya acotado a 0..100.
      relleno.style.width = pct + "%";
      barra.appendChild(relleno);
      celda.appendChild(et);
      celda.appendChild(pc);
      celda.appendChild(barra);
      rejilla.appendChild(celda);
    });
    cont.appendChild(rejilla);
  }

  // El testigo de esta ejecución, que el servidor inyecta al servir la
  // página. Sin él la API no contesta.
  //
  // Es lo que impide que **otra web** use esta interfaz: el navegador le
  // manda la petición igual —una página cualquiera puede hacer POST a
  // 127.0.0.1— pero no puede leer este HTML para sacar el testigo,
  // porque la política de mismo origen se lo impide.
  var TESTIGO = document.currentScript
    ? document.currentScript.getAttribute("data-token")
    : "";

  function pide(ruta, cuerpo) {
    return fetch(ruta, {
      method: "POST",
      headers: { "content-type": "application/json", "x-expostman-token": TESTIGO },
      body: JSON.stringify(cuerpo || {})
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
  }

  /**
   * Los ajustes: cargar, aplicar y guardar solo.
   *
   * Se cargan nada más abrir — quien los guardó la última vez se
   * encuentra la interfaz tal como la dejó — y se guardan al tocar cada
   * control, sin botón: un botón de guardar se olvida, y entonces el
   * ajuste que alguien cambió no está la próxima vez.
   *
   * Nota: sin backticks en todo este bloque — el HTML vive dentro de un
   * template literal de TypeScript, y un backtick lo cerraria antes de
   * tiempo.
   */
  var ajustes = { locale: undefined, theme: "system" };
  var catalogo = [];

  /** El texto de una clave en el idioma elegido, con respaldo en inglés. */
  function tr(clave) {
    var l = catalogo.filter(function (x) { return x.code === ajustes.locale; })[0];
    var en = catalogo.filter(function (x) { return x.code === "en"; })[0];
    if (l && l.translations && l.translations[clave] !== undefined) return l.translations[clave];
    if (en && en.translations && en.translations[clave] !== undefined) return en.translations[clave];
    return clave;
  }

  /**
   * Repinta los textos que ya estaban en la página. Atributos que
   * también hablan (el aria-label de la tuerca) van con su propia
   * marca: data-i18n-attr="atributo:clave".
   */
  function repintaTextos() {
    var nodos = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodos.length; i++) {
      nodos[i].textContent = tr(nodos[i].getAttribute("data-i18n"));
    }
    var conAtributo = document.querySelectorAll("[data-i18n-attr]");
    for (var k = 0; k < conAtributo.length; k++) {
      var par = conAtributo[k].getAttribute("data-i18n-attr").split(":");
      if (par.length === 2) conAtributo[k].setAttribute(par[0], tr(par[1]));
    }
  }

  /**
   * Aplica el modo elegido. Si el modo es "system", se quita data-tema
   * y el CSS vuelve a seguir al sistema operativo.
   */
  function aplicaTema(modo) {
    if (modo === "dark" || modo === "light") {
      document.documentElement.setAttribute("data-tema", modo);
    } else {
      document.documentElement.removeAttribute("data-tema");
    }
  }

  /** Cambia lang y dir del documento y repinta los textos fijos. */
  function aplicaIdioma() {
    var l = catalogo.filter(function (x) { return x.code === ajustes.locale; })[0];
    document.documentElement.lang = l ? l.code : "en";
    document.documentElement.dir = l && l.rtl ? "rtl" : "ltr";
    repintaTextos();
  }

  /**
   * Guarda campo a campo: la interfaz escribe al tocar cada control, y
   * mandar el objeto entero haría que dos pestañas se pisaran lo que la
   * otra acaba de cambiar.
   */
  function guarda(clave, valor) {
    ajustes[clave] = valor;
    var cuerpo = {};
    cuerpo[clave] = valor;
    return pide("/api/settings/save", cuerpo).then(function (res) {
      if (!res.ok) {
        pinta("aviso", "El ajuste no se pudo guardar; se queda solo en esta pantalla.", null);
      }
    });
  }

  // Ajustes e idiomas, cargados antes de que la página se pueda usar.
  Promise.all([pide("/api/settings"), pide("/api/locales")]).then(function (respuestas) {
    var guardados = respuestas[0].j || {};
    catalogo = (respuestas[1].j && respuestas[1].j.locales) || [];

    ajustes.locale = guardados.settings && guardados.settings.locale;
    ajustes.theme = (guardados.settings && guardados.settings.theme) || "system";

    var sel = $("idioma");
    catalogo.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l.code;
      // El ★ marca los idiomas que alguien dejó en su carpeta: como
      // ganan al empaquetado del mismo código, hay que poder verlo.
      o.textContent = l.nativeName + (l.origin === "external" ? " ★" : "");
      sel.appendChild(o);
    });

    if (!ajustes.locale) {
      // Sin ajuste guardado: sale del navegador. La misma resolución de
      // pickLocale (exacta, solo idioma, primera variante) en tres
      // pasos; si nada casa, inglés.
      var preferidos = navigator.languages || [navigator.language || ""];
      var codigos = catalogo.map(function (l) { return l.code.toLowerCase(); });
      var candidatos = [];
      preferidos.forEach(function (bruto) {
        var pedido = String(bruto || "").trim().toLowerCase();
        if (!pedido) return;
        var base = pedido.split("-")[0];
        candidatos.push(pedido, base);
        codigos.forEach(function (c) { if (c.indexOf(base + "-") === 0) candidatos.push(c); });
      });
      ajustes.locale = candidatos.filter(function (c) { return codigos.indexOf(c) !== -1; })[0] || "en";
      // El idioma elegido por defecto se guarda: la próxima apertura no
      // vuelve a adivinar.
      guarda("locale", ajustes.locale);
    }

    // Los controles reflejan lo aplicado, y al tocarlos se aplica y
    // se guarda: el cambio se ve al momento, sin recargar.
    $("tema").value = ajustes.theme;
    sel.value = ajustes.locale;
    aplicaTema(ajustes.theme);
    aplicaIdioma();

    sel.addEventListener("change", function () {
      ajustes.locale = sel.value;
      aplicaIdioma();
      guarda("locale", sel.value);
    });
    $("tema").addEventListener("change", function () {
      ajustes.theme = $("tema").value;
      aplicaTema(ajustes.theme);
      guarda("theme", ajustes.theme);
    });
  });

  /**
   * Navegación de ajustes: la tuerca abre, Volver regresa al
   * formulario. Las vistas se intercambian sin recargar, así que lo que
   * hubiera escrito sigue ahí. El foco viaja con la vista.
   */
  $("ajustes").addEventListener("click", function () {
    var abiertos = !$("vista-ajustes").hidden;
    $("vista-ajustes").hidden = abiertos;
    $("vista-principal").hidden = !abiertos;
    $("ajustes").setAttribute("aria-expanded", abiertos ? "false" : "true");
    (abiertos ? $("ajustes") : $("idioma")).focus();
  });
  $("volver").addEventListener("click", function () {
    $("vista-ajustes").hidden = true;
    $("vista-principal").hidden = false;
    $("ajustes").setAttribute("aria-expanded", "false");
    $("ajustes").focus();
  });

  fetch("/api/capabilities", {
    method: "POST",
    headers: { "x-expostman-token": TESTIGO }
  })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var cont = $("formatos");
      (j.formats || []).forEach(function (f) {
        var id = "fmt-" + f;
        var l = document.createElement("label");
        var i = document.createElement("input");
        i.type = "checkbox"; i.value = f; i.id = id; i.name = "formato";
        if (f === "postman") { i.checked = true; }
        l.appendChild(i);
        l.appendChild(document.createTextNode(f));
        l.htmlFor = id;
        cont.appendChild(l);
        // Lo que Postman no reimporta no puede parecer equivalente: la
        // nota va junto a la casilla, no enterrada en la documentación.
        if ((j.postmanImportable || []).indexOf(f) === -1) {
          $("nota-bruno").hidden = false;
          $("nota-bruno").textContent =
            f + ": generated, but Postman does not import it — open it in Bruno.";
        }
      });

      // El framework forzado, con la lista del catálogo. "Auto" vale
      // para quien no la necesita; el resto elige de la lista real.
      var selFW = $("framework");
      (j.frameworks || []).forEach(function (fw) {
        var o = document.createElement("option");
        o.value = fw;
        o.textContent = fw;
        selFW.appendChild(o);
      });
    });

  $("form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var raiz = $("raiz").value.trim();
    var boton = $("inspeccionar");
    boton.disabled = true;
    pinta("info", "Mirando el proyecto", null);
    pide("/api/inspect", { projectRoot: raiz }).then(function (res) {
      boton.disabled = false;
      if (!res.ok) {
        pinta("error", res.j.error.reason, tabla([["Qué hacer", res.j.error.nextAction]]));
        $("paso-generar").hidden = true;
        // f00010 S3: esconder la tarjeta para que los datos del
        // proyecto anterior no se queden colgados.
        if ($("deteccion")) $("deteccion").hidden = true;
        return;
      }
      var s = res.j.summary;
      pinta("exito", "Detectado " + s.framework + " — " + s.routesInCode + " endpoints", tabla([
        ["Proyecto", s.projectName],
        ["Base URL", s.baseUrl],
        ["Con reglas", s.withFormRequest],
        ["Sin reglas", s.withoutFormRequest],
        ["Login", s.auth ? s.auth.loginEndpoint : "no detectado"]
      ]));
      // f00010 S3: pinta la tarjeta de evidencia + salud. Va después
      // del resumen plano para que el orden visual sea de lo
      // conocido a lo explicado, no al revés.
      pintaDeteccion(s);
      if (res.j.notice) {
        var p = document.createElement("p");
        p.textContent = res.j.notice;
        viva.firstChild.appendChild(p);
      }
      $("paso-generar").hidden = false;
      $("generar").focus();
    });
  });

  $("generar").addEventListener("click", function () {
    var formatos = Array.prototype.slice
      .call(document.querySelectorAll('input[name="formato"]:checked'))
      .map(function (i) { return i.value; });
    var boton = $("generar");
    boton.disabled = true;
    pinta("info", "Generando", null);
    pide("/api/generate", {
      projectRoot: $("raiz").value.trim(),
      outputDir: $("salida").value.trim() || undefined,
      formats: formatos,
      // Vacío significa "detecta": solo se fuerza si hay elección.
      framework: $("framework").value || undefined
    }).then(function (res) {
      boton.disabled = false;
      if (!res.ok) {
        pinta("error", res.j.error.reason, tabla([["Qué hacer", res.j.error.nextAction]]));
        return;
      }
      var r = res.j.result;
      var filas = [
        ["Colección", r.collectionPath || "no se escribió"],
        ["Requests", r.requests],
        ["Carpetas", r.folders]
      ];
      (r.extraPaths || []).forEach(function (p, i) { filas.push(["Extra " + (i + 1), p]); });
      (r.warnings || []).forEach(function (w, i) { filas.push(["Aviso " + (i + 1), w]); });
      pinta("exito", "Colección generada", tabla(filas));
      // f00010 S4: refresca el dashboard para que la entrada recién
      // generada aparezca arriba. Se hace **después** de mostrar el
      // resultado para no hacer esperar al usuario, y se ignoran
      // errores: si el historial falla, la generación ya salió bien.
      cargarHistorial();
    });
  });

  /**
   * Carga y pinta el historial de generaciones.
   *
   * El dashboard enseña las últimas 20 entradas por defecto; si el
   * servidor las manda vacías, dice "todavía nada" — esconder la
   * tarjeta cuando está vacía es como no tener dashboard. La lista
   * se actualiza en orden inverso al devuelto por la API, así que lo
   * más reciente queda arriba.
   *
   * No se mete en la cadena de errores: si el historial falla al
   * cargar, el formulario sigue funcionando y la persona puede
   * generar sin más. El aviso se imprime en consola y se abandona.
   */
  function cargarHistorial() {
    pide("/api/history", {}).then(function (res) {
      var cont = $("historial-lista");
      cont.innerHTML = "";
      if (!res.ok) {
        var p = document.createElement("p");
        p.className = "vacio";
        p.textContent = "Could not load history.";
        cont.appendChild(p);
        return;
      }
      var entries = (res.j && res.j.entries) || [];
      if (entries.length === 0) {
        var v = document.createElement("p");
        v.className = "vacio";
        v.textContent = "No generations yet. Once you generate one, it will appear here.";
        cont.appendChild(v);
        return;
      }
      var ol = document.createElement("ol");
      entries.forEach(function (e) {
        var li = document.createElement("li");
        var cuando = document.createElement("span");
        cuando.className = "cuando";
        // ISO 8601 → "YYYY-MM-DD HH:MM" sin la T ni los segundos.
        cuando.textContent = (e.timestamp || "").replace("T", " ").slice(0, 16);
        var que = document.createElement("span");
        que.className = "que";
        var verbo = e.kind === "generate" ? "generated" : "summarised";
        que.textContent = (e.projectName || "(unnamed)") + " · " + (e.framework || "?");
        var sub = document.createElement("small");
        sub.textContent = verbo + " · " + (e.endpoints || 0) + " endpoints";
        que.appendChild(sub);
        var accion = document.createElement("button");
        accion.type = "button";
        accion.className = "accion";
        accion.textContent = "Use this project";
        // Rellena el campo "raíz" y pone el foco ahí: el siguiente
        // paso natural es inspeccionar o generar otra vez sobre el
        // mismo proyecto, no abrir un diálogo aparte.
        accion.addEventListener("click", function () {
          $("raiz").value = e.projectRoot || "";
          $("raiz").focus();
          $("raiz").scrollIntoView({ block: "start" });
        });
        li.appendChild(cuando);
        li.appendChild(que);
        li.appendChild(accion);
        ol.appendChild(li);
      });
      cont.appendChild(ol);
    }).catch(function () {
      // Sin red o sin servidor: el dashboard queda con su texto por
      // defecto. Quien está sin interfaz ya verá que la página está
      // rota por el resto de indicadores.
    });
  }

  // Carga inicial, en paralelo con capacidades e idiomas.
  cargarHistorial();
})();
</script>
</body>
</html>`;
