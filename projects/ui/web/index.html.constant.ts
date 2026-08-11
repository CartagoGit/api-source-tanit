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
  :root {
    color-scheme: light dark;
    --fondo: #ffffff; --texto: #1a1a1a; --tenue: #5c5c5c;
    --borde: #d4d4d4; --acento: #cc5500; --error: #b00020; --ok: #006644;
    --campo: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --fondo: #16181c; --texto: #eceff4; --tenue: #a8b0bd;
      --borde: #333842; --acento: #ff9552; --error: #ff8a8a; --ok: #6ee7a8;
      --campo: #1e2128;
    }
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
  @media (prefers-reduced-motion: reduce) { *, *::after { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
<main>
  <h1>Export to Postman</h1>
  <p class="sub">Apunta a la carpeta de tu API y mira lo detectado antes de escribir nada.</p>

  <form id="form">
    <fieldset>
      <legend>Proyecto</legend>
      <label for="raiz">Carpeta del proyecto</label>
      <input type="text" id="raiz" name="raiz" required autocomplete="off"
             aria-describedby="ayuda-raiz" placeholder="/ruta/a/tu/api">
      <p id="ayuda-raiz" class="sub" style="margin:.35rem 0 0">
        La raíz, donde está el manifiesto (<code>package.json</code>, <code>go.mod</code>…).
      </p>
      <div class="acciones">
        <button type="submit" id="inspeccionar">Ver lo detectado</button>
      </div>
    </fieldset>

    <fieldset id="paso-generar" hidden>
      <legend>Salida</legend>
      <label for="salida">Carpeta de salida <span class="sub">(opcional)</span></label>
      <input type="text" id="salida" name="salida" autocomplete="off"
             placeholder="por defecto, dentro del proyecto">
      <fieldset style="margin-top:1rem">
        <legend>Formatos</legend>
        <div class="formatos" id="formatos" role="group" aria-label="Formatos de salida"></div>
      </fieldset>
      <div class="acciones">
        <button type="button" id="generar">Generar</button>
      </div>
    </fieldset>
  </form>

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
