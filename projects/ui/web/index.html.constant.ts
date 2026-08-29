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
    --campo: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-tema="light"]) {
      --fondo: #16181c; --texto: #eceff4; --tenue: #a8b0bd;
      --borde: #333842; --acento: #ff9552; --error: #ff8a8a; --ok: #6ee7a8;
      --campo: #1e2128;
    }
  }
  /* Elegidos a mano, que ganan en los dos sentidos. */
  :root[data-tema="dark"] {
    color-scheme: dark;
    --fondo: #16181c; --texto: #eceff4; --tenue: #a8b0bd;
    --borde: #333842; --acento: #ff9552; --error: #ff8a8a; --ok: #6ee7a8;
    --campo: #1e2128;
  }
  :root[data-tema="light"] {
    color-scheme: light;
    --fondo: #ffffff; --texto: #1a1a1a; --tenue: #5c5c5c;
    --borde: #d4d4d4; --acento: #cc5500; --error: #b00020; --ok: #006644;
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
        <fieldset style="margin-top:1rem">
          <legend data-i18n="format.label">Formatos</legend>
          <div class="formatos" id="formatos" role="group" aria-label="Formatos de salida"></div>
        </fieldset>
        <div class="acciones">
          <button type="button" id="generar" data-i18n="action.generate">Generar</button>
        </div>
      </fieldset>
    </form>
  </div>

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
      formats: formatos
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
    });
  });
})();
</script>
</body>
</html>`;
