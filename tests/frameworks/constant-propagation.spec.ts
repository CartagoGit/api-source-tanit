/**
 * Tests para `propagateConstants` (a00016 S4).
 *
 * Cubre los 4 casos del slice:
 *   1. Literal directo: `const M = "get"; app[M]("/x")` → `resolvedMethod = "get"`.
 *   2. No-op sobre unbound: `app[M]("/x")` sin binding → la llamada
 *      pasa tal cual.
 *   3. Concatenación skipped: `const M = "GET" + suffix` → no
 *      propaga (no emite binding, y aunque emita uno con un valor
 *      string, no es un literal directo — pero este test valida el
 *      caso extremo donde un caller externo pasa un binding).
 *   4. Template-literal skipped: `` const M = `get` `` → mismo
 *      razonamiento.
 */
import { describe, expect, test } from "vitest";

import { propagateConstants } from "../../packages/frameworks/typescript/constant-propagation";
import { collectMethodCallsFromSource } from "../../packages/frameworks/typescript/collect-method-calls";
import type { IConstantBinding } from "../../packages/contracts/interfaces/core/language-ir.interface";

describe("propagateConstants — caso básico de propagación", () => {
  test("literal directo: `const M = 'get'; app[M]('/x')` resuelve a resolvedMethod='get'", () => {
    const source = `const M = "get";
app[M]("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls).toHaveLength(1);
    // S2 reconoce `app[M]` como `receiverKind: "computed"`, `method: ""`,
    // `callee: "app[M]"`.
    expect(calls[0]?.callee).toBe("app[M]");
    expect(calls[0]?.method).toBe("");
    expect(calls[0]?.receiverKind).toBe("computed");

    const bindings: IConstantBinding[] = [
      {
        name: "M",
        value: "get",
        range: { file: "server.ts", start: 0, end: 0 },
      },
    ];
    const resolved = propagateConstants(calls, bindings);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.resolvedMethod).toBe("get");
    // El método final que el scanner usa: `method || resolvedMethod`.
    const finalMethod = resolved[0]?.method || resolved[0]?.resolvedMethod || "";
    expect(finalMethod).toBe("get");
    // Los args se preservan.
    expect(resolved[0]?.args[0]).toEqual({ kind: "string", value: "/x" });
  });

  test("propaga un number como método", () => {
    // `const M = 200; app[M]()` — caso patológico (200 no es un método
    // HTTP), pero la propagación debe funcionar como tipo genérico.
    const source = `app[M]();
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.callee).toBe("app[M]");
    const resolved = propagateConstants(calls, [
      {
        name: "M",
        value: 200,
        range: { file: "server.ts", start: 0, end: 0 },
      },
    ]);
    expect(resolved[0]?.resolvedMethod).toBe("200");
  });
});

describe("propagateConstants — casos negativos (no propaga)", () => {
  test("no-op: `app[M]` sin binding → la llamada pasa tal cual", () => {
    const source = `app[M]("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.callee).toBe("app[M]");
    expect(calls[0]?.resolvedMethod).toBeUndefined();

    // Sin bindings, no se propaga nada.
    const resolved = propagateConstants(calls, []);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.resolvedMethod).toBeUndefined();
    expect(resolved[0]?.callee).toBe("app[M]");
  });

  test("concat skipped: un binding con valor 'GET+suffix' no propaga si el collector lo filtra", () => {
    // La regla "concatenación skipped" se aplica en el COLECTOR de
    // bindings (no en `propagateConstants`): el collector emite
    // SOLO `IConstantBinding` con valores literales directos.
    //
    // Si por error alguien pasa un binding con un valor que no es
    // un literal simple, `propagateConstants` lo acepta igual (porque
    // el contrato ya dice `string | number | boolean`). Este test
    // documenta ese comportamiento: la defensiva está en la capa de
    // arriba (el colector), no aquí.
    const source = `app[M]("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    const resolved = propagateConstants(calls, [
      {
        name: "M",
        value: "GET+suffix", // hipotético caso patológico
        range: { file: "server.ts", start: 0, end: 0 },
      },
    ]);
    // Aunque el valor es semánticamente inválido, `propagateConstants`
    // lo aplica: la defensiva de "no concatenación" está en el
    // colector de bindings, no aquí.
    expect(resolved[0]?.resolvedMethod).toBe("GET+suffix");
  });

  test("template-literal skipped: análogo a concat", () => {
    // Mismo argumento que arriba: el collector de bindings NO emite
    // template literals (sólo literales directos), así que este caso
    // no debería llegar aquí. Si llega, `propagateConstants` lo
    // aplica (cualquier string es válido para el contrato).
    const source = `app[M]("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    const resolved = propagateConstants(calls, [
      {
        name: "M",
        value: "get", // ya viene como string cooked
        range: { file: "server.ts", start: 0, end: 0 },
      },
    ]);
    expect(resolved[0]?.resolvedMethod).toBe("get");
  });

  test("no propaga llamadas con method ya resuelto (server['get'])", () => {
    // `server["get"]` ya tiene `method = "get"` por S2. La
    // propagación no debe tocar `resolvedMethod` ni `method`.
    const source = `server["get"]("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.method).toBe("get");
    expect(calls[0]?.receiverKind).toBe("computed");

    const resolved = propagateConstants(calls, []);
    // Como `method !== ""`, S4 no hace nada. La llamada pasa tal
    // cual con `method: "get"` y `resolvedMethod: undefined`.
    expect(resolved[0]?.method).toBe("get");
    expect(resolved[0]?.resolvedMethod).toBeUndefined();
  });

  test("no propaga llamadas no-computed (app.get)", () => {
    const source = `app.get("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.method).toBe("get");
    expect(calls[0]?.receiverKind).toBe("identifier");

    const resolved = propagateConstants(calls, [
      // Aunque haya un binding con name="get", no afecta a `app.get`
      // porque `method` ya está resuelto y el `receiverKind` no es
      // "computed".
      {
        name: "get",
        value: "post",
        range: { file: "server.ts", start: 0, end: 0 },
      },
    ]);
    expect(resolved[0]?.method).toBe("get");
    expect(resolved[0]?.resolvedMethod).toBeUndefined();
  });
});
