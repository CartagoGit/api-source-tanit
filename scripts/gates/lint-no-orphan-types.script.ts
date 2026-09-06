#!/usr/bin/env bun
/**
 * `bun run lint:no-orphan-types` — no type packages huérfanos hoisted
 * que falsean el typecheck local (x00051 S3).
 *
 * Por qué existe
 * ──────────────
 * El análisis 2026-09-05 observó que el typecheck local mentía:
 * pasaba con 92 errores que la CI descubría en cuanto tenía un
 * install limpio. Causa raíz: `@types/node@26.2.0` estaba
 * HOISTED en `node_modules/@types/` desde una dependencia vieja
 * (`integrations/delendai`, que antes era workspace del lockfile
 * raíz). x00045 quitó esa dependencia, pero el `node_modules`
 * local NUNCA se limpió: tsc auto-incluía `@types/node` aunque
 * `types: []` estuviera declarado en `tsconfig.base.json`. La
 * disciplina del repo (ambient manual en `runtime.d.ts`) estaba
 * vigente pero el huérfano la enmascaraba.
 *
 * La fix de x00051 fue completar `runtime.d.ts` para que el
 * typecheck pase SIN depender de `@types/node`. Este gate se
 * asegura de que nadie vuelva a aterrizar con un huérfano sin
 * darse cuenta.
 *
 * Qué considera violación
 * ───────────────────────
 * - Paquetes en `node_modules/@types/<X>` que NO están declarados
 *   en el `package.json` raíz (dependencies + devDependencies) NI
 *   son transitivos del `bun.lock` raíz.
 *
 * Las transitivas se calculan recorriendo el árbol de dependencias
 * del lockfile (Bun ya lo almacena en `bun.lock`). Si `X` aparece
 * transitivamente desde una dependencia declarada, NO es huérfano.
 *
 * Excepciones
 * ───────────
 * - `TANIT_ALLOW_ORPHAN_TYPES=1` desactiva el gate (modo dev).
 *   Pensado para sesiones donde el desarrollador sabe que hay un
 *   huérfano temporal y no quiere que le bloquee `validate`.
 *
 * Uso
 * ───
 *   bun run lint:no-orphan-types
 *   TANIT_ALLOW_ORPHAN_TYPES=1 bun run lint:no-orphan-types
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../helpers/root.helper.js";

const execFileAsync = promisify(execFile);

/**
 * Lista los type packages presentes en `node_modules/@types/`.
 * Si el directorio no existe (install aún no corrió), devuelve [].
 */
function listInstalledTypes(): string[] {
  const typesDir = join(REPO_ROOT, "node_modules", "@types");
  if (!existsSync(typesDir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(typesDir)) {
    if (!entry.startsWith("@")) {
      const full = join(typesDir, entry);
      if (statSync(full).isDirectory()) out.push(entry);
    }
  }
  return out;
}

/**
 * Lee los nombres de dependencies+devDependencies declarados en el
 * package.json raíz.
 */
function declaredInRoot(): Set<string> {
  const pkgPath = join(REPO_ROOT, "package.json");
  if (!existsSync(pkgPath)) return new Set();
  const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return new Set([
    ...Object.keys(raw.dependencies ?? {}),
    ...Object.keys(raw.devDependencies ?? {}),
  ]);
}

/**
 * Recorre el lockfile (en formato textual de bun) y devuelve los
 * paths de paquetes transitivos desde el root workspace.
 *
 * El lockfile de Bun tiene entradas tipo:
 *
 *   "vitest@4.1.11":
 *     dependencies:
 *       "@types/node": ...
 *
 * y como cadenas de "packages". Recorrer esas cadenas desde el
 * workspace raíz enumera todos los transitivos que están REALMENTE
 * resueltos en este install (no los transitivos hipotéticos de
 * cualquier versión del árbol).
 *
 * No es perfecto (el lockfile puede listar paquetes que el árbol
 * actual no tiene materializados por hoisting), pero detecta la
 * clase de huérfano que queremos: `@types/X` presente en
 * `node_modules/@types/` pero NO prometido por ninguna dependencia.
 *
 * La alternativa más estricta sería `bun pm ls --all` (muestra el
 * árbol resuelto), pero requiere `bun` instalado en PATH y un
 * subshell — más caro que parsear el lockfile.
 */
async function transitiveFromLockfile(): Promise<Set<string>> {
  const lockPath = join(REPO_ROOT, "bun.lock");
  if (!existsSync(lockPath)) return new Set();
  const lock = readFileSync(lockPath, "utf8");
  const set = new Set<string>();
  // Formato del lockfile: `"pkg@version"` en líneas propias
  // seguidas de un bloque con `dependencies:`. Matchamos pkg@version
  // como cabecera.
  //
  // El nombre puede llevar scope (`@scope/pkg`) — cubrimos con dos
  // ramas en la alternación. Bun parser no soporta `(?:...)` dentro
  // de character classes; evitamos con `|` de primer nivel.
  const header = /^"(@[^/"\/]+\/[^@"]+|[^@"]+)@[^"]+"\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = header.exec(lock)) !== null) {
    set.add(m[1]!.replace(/^@/, ""));
  }
  return set;
}

/** Busca un paquete por nombre (sin scope) en el lockfile textual. */
async function packageInLockfile(pkg: string, lockTransitives: Set<string>): Promise<boolean> {
  return lockTransitives.has(pkg);
}

/**
 * Versión alternativa que usa `bun pm ls --all` (subshell) si Bun
 * está disponible. No se usa por defecto porque añade latencia;
 * se mantiene para referencia o activación futura.
 */
async function transitiveViaBunCli(): Promise<Set<string> | null> {
  try {
    const { stdout } = await execFileAsync("bun", ["pm", "ls", "--all"], {
      cwd: REPO_ROOT,
      maxBuffer: 8 * 1024 * 1024,
    });
    const set = new Set<string>();
    // Cada entry es un nombre de paquete con su versión. Bun
    // prefija cada línea con glyphs tree (`├──`, `└──`, `│`) o
    // espacios. Lo más robusto: trimear cualquier carácter que
    // NO sea letra/dígito/`.`/`-`/`@`/`/` desde el inicio, y
    // leer hasta el `@version`.
    for (const line of stdout.split("\n")) {
      // Trimear prefijo no-paquete: espacios y box-drawing chars
      // (U+2500..U+257F). El `g` flag es para que se pueda usar
      // sin entrar en replaceAll; nos basta `replace`.
      const trimmed = line.replace(/^[\s\u2500-\u257F]*/, "");
      const m = /^(@?[A-Za-z0-9._\-\/]+)@[\d^~>=<*]+/.exec(trimmed);
      if (!m) continue;
      const pkg = m[1]!;
      if (pkg === "root" || pkg === ".") continue;
      set.add(pkg);
    }
    return set;
  } catch {
    return null;
  }
}

export async function main(): Promise<number> {
  if (process.env.TANIT_ALLOW_ORPHAN_TYPES === "1") {
    console.log("lint:no-orphan-types -- desactivado por TANIT_ALLOW_ORPHAN_TYPES=1");
    return 0;
  }

  const installed = listInstalledTypes();
  if (installed.length === 0) {
    console.log("lint:no-orphan-types -- node_modules/@types/ ausente (sin install?); nada que revisar");
    return 0;
  }

  const declared = declaredInRoot();
  // Fuente de verdad: el árbol RESUELTO por Bun en este install.
  // El lockfile lista `peerDependencies` y `optionalPeers` que NO
  // se materializan necesariamente — usar el lockfile como prueba
  // daría falsos positivos. `bun pm ls --all` recorre lo que
  // REALMENTE está instalado bajo root y sus transitivos.
  const tree = await transitiveViaBunCli();
  let lockTransitives: Set<string>;
  let orphanViaTree: boolean;
  if (tree !== null) {
    // Normalizar: `@types/foo` → `foo`, `@scope/pkg` → `scope/pkg`,
    // `foo` → `foo`. El lockfile los lista igual.
    const norm = new Set<string>();
    for (const pkg of tree) {
      if (pkg.startsWith("@types/")) {
        norm.add(pkg.slice("@types/".length));
      } else if (pkg.startsWith("@")) {
        norm.add(pkg.slice(1));
      } else {
        norm.add(pkg);
      }
    }
    lockTransitives = norm;
    orphanViaTree = true;
  } else {
    lockTransitives = await transitiveFromLockfile();
    orphanViaTree = false;
  }

  // Los types que SÍ deben estar en node_modules: declarados en root
  // O en el árbol resuelto de Bun.
  const orphans = installed.filter(
    (t) => !declared.has(t) && !lockTransitives.has(t),
  );

  // Heurística adicional: `chai` y `deep-eql` los arrastra vitest
  // (y por eso están en lockfile). `@types/estree` lo arrastra
  // `estree-walker`. Aparecen como transitivos — pero si bun.lock
  // no los lista, es huérfano. Esta heurística es simplemente el
  // `lockTransitives.has(t)` de arriba; los huérfanos reales no
  // aparecen en ningún sitio del lockfile.

  if (orphans.length === 0) {
    console.log(
      `lint:no-orphan-types -- ${installed.length} type packages, todos declarados o transitivos` +
        (orphanViaTree ? " (árbol bun)" : " (fallback lockfile)"),
    );
    return 0;
  }

  console.error(
    `lint:no-orphan-types -- ${orphans.length} type package(s) huérfano(s) en node_modules/@types/:`
  );
  for (const t of orphans) {
    console.error(`  - @types/${t}`);
  }
  console.error("");
  console.error(
    "Los huérfanos falsean el typecheck local: tsc los auto-incluye aunque `types: []`",
  );
  console.error(
    "lo bloquee, y enmascaran declaraciones ambient que faltan en `runtime.d.ts`.",
  );
  console.error(
    "Fix: declarar la dependencia en package.json (si es legítima), o añadir la",
  );
  console.error(
    "ambient que falta en `packages/contracts/interfaces/runtime.d.ts` y borrar el huérfano.",
  );
  return 1;
}

if (import.meta.main) {
  const code_ = await main();
  process.exit(code_);
}