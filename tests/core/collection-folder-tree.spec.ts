/**
 * S3.a (a00012 H-P2a): el `folder:` explícito de un endpoint debe
 * poder aterrizar como subcarpeta bajo el top real calculado del URI
 * (y no como carpeta top-level fantasma).
 *
 * El bug original vivía en `collection-builder.service.ts`:
 *
 *   const mainKey = g.explicit ? g.key : autoMainKey;
 *   if (g.explicit) {
 *     if (g.key === mainKey) h.direct.push(...g.items);
 *     else                   h.subs.push(...);
 *   } else {
 *     h.direct.push(...g.items);
 *   }
 *
 * Cuando `g.explicit` era true, `mainKey === g.key` por construcción,
 * así que la rama `else` (subcarpeta explícita) **nunca se ejecutaba**.
 *
 * La salida de Postman del fixture se inspecciona por nombre de
 * carpeta (`col.item[*].name`) y por la jerarquía `item[]` — los
 * sub-folders van antes de los items directos.
 */
import { describe, expect, test } from "vitest";

import { buildCollection } from "../../packages/core/domain/collection-builder.service";
import type {
  EndpointSpec,
  PostmanItem,
} from "../../packages/contracts/interfaces/core/postman.interface";
import type { ProjectConfig } from "../../packages/contracts/interfaces/core/project-config.interface";

const baseConfig: ProjectConfig = {
  name: "t",
  collectionName: "T Collection",
  collectionDescription: "Test collection",
  baseUrl: "http://x",
  variables: [{ key: "baseUrl", value: "http://x", type: "string" }],
  filePrefixes: {},
  zones: [],
  zoneOrder: [],
  defaultZone: "Other",
  authDescriptions: {},
  loginEndpointName: "Login",
};

/**
 * Helper mínimo para declarar specs en este archivo. Sólo lo que usan
 * los casos de folder-tree: `method`, `uri`, `name` y `folder`.
 */
function spec(partial: Partial<EndpointSpec> & { name: string; uri: string }): EndpointSpec {
  return {
    method: "GET",
    headers: [],
    query: [],
    body: null,
    formRequest: null,
    ...partial,
  } as EndpointSpec;
}

/** Primera carpeta top-level cuyo `name` coincide (case-insensitive). */
function findFolder(items: PostmanItem[], name: string): PostmanItem | undefined {
  const lower = name.toLowerCase();
  return items.find((it) => it.name.toLowerCase() === lower);
}

/** Primera entrada hija cuyo `name` coincide dentro de una carpeta. */
function findChild(folder: PostmanItem, name: string): PostmanItem | undefined {
  return folder.item?.find((it) => it.name.toLowerCase() === name.toLowerCase());
}

describe("collection-folder-tree (S3.a a00012)", () => {
  test("explícito 'Admin' bajo top real 'users' → subcarpeta Admin dentro de Users", () => {
    const col = buildCollection(
      [
        spec({
          name: "List admin items",
          uri: "/users/admin/items",
          folder: "Admin",
        }),
      ],
      baseConfig,
    );

    const usersFolder = findFolder(col.item, "Users");
    expect(usersFolder).toBeDefined();
    const adminFolder = findChild(usersFolder!, "Admin");
    expect(adminFolder).toBeDefined();
    // La subcarpeta Admin NO debe colarse como carpeta top-level.
    expect(findFolder(col.item, "Admin")).toBeUndefined();
    // Y trae el endpoint dentro.
    expect(adminFolder!.item?.[0]?.name).toBe("List admin items");
  });

  test("explícito autorreferencial (folder === top real) → va a direct", () => {
    const col = buildCollection(
      [
        spec({
          name: "List public posts",
          uri: "/public/posts",
          folder: "public",
        }),
      ],
      baseConfig,
    );

    const publicFolder = findFolder(col.item, "Public");
    expect(publicFolder).toBeDefined();
    // El endpoint vive en `direct`, no dentro de una subcarpeta.
    expect(publicFolder!.item?.[0]?.name).toBe("List public posts");
    // Y no hay subcarpeta "Public" colgada de sí misma.
    expect(findChild(publicFolder!, "Public")).toBeUndefined();
  });

  test("implícito (sin folder:) sigue yendo a direct del top real", () => {
    const col = buildCollection(
      [
        spec({ name: "List orders", uri: "/orders" }),
      ],
      baseConfig,
    );

    const ordersFolder = findFolder(col.item, "Orders");
    expect(ordersFolder).toBeDefined();
    expect(ordersFolder!.item?.[0]?.name).toBe("List orders");
  });

  test("dos grupos explícitos con el mismo top real → ambos bajo la misma carpeta raíz", () => {
    const col = buildCollection(
      [
        spec({
          name: "List admin users",
          uri: "/users/admin/users",
          folder: "Admin",
        }),
        spec({
          name: "List public posts",
          uri: "/users/public/posts",
          folder: "Public",
        }),
      ],
      baseConfig,
    );

    // Ambos comparten `users` como top real, así que la raíz debe ser
    // una sola carpeta "Users" — no debe aparecer "Users" dos veces ni
    // colarse "Admin"/"Public" como top-level.
    const topNames = col.item.map((f) => f.name.toLowerCase());
    expect(topNames).toContain("users");
    expect(topNames).not.toContain("admin");
    expect(topNames).not.toContain("public");

    const usersFolder = findFolder(col.item, "Users");
    expect(usersFolder).toBeDefined();
    expect(findChild(usersFolder!, "Admin")).toBeDefined();
    expect(findChild(usersFolder!, "Public")).toBeDefined();
  });

  test("snapshot semántico: árbol {Users: direct+subs, Orders: direct}", () => {
    const col = buildCollection(
      [
        // Explícito Admin, top real Users → subs.
        spec({
          name: "List admin users",
          uri: "/users/admin/users",
          folder: "Admin",
        }),
        spec({
          name: "List admin items",
          uri: "/users/admin/items",
          folder: "Admin",
        }),
        // Explícito Public, top real Users → subs (mismo root que Admin).
        spec({
          name: "List public posts",
          uri: "/users/public/posts",
          folder: "Public",
        }),
        // Implícito bajo Users → direct del root Users.
        spec({ name: "Get profile", uri: "/users/profile" }),
        // Implícito bajo Orders → root Orders con direct.
        spec({ name: "List orders", uri: "/orders/list" }),
      ],
      baseConfig,
    );

    const usersFolder = findFolder(col.item, "Users");
    const ordersFolder = findFolder(col.item, "Orders");
    expect(usersFolder).toBeDefined();
    expect(ordersFolder).toBeDefined();

    // Users/: primero las subs (Admin, Public), luego el direct.
    expect(usersFolder!.item?.[0]?.name).toBe("Admin");
    expect(usersFolder!.item?.[1]?.name).toBe("Public");
    expect(usersFolder!.item?.[2]?.name).toBe("Get profile");

    const adminFolder = findChild(usersFolder!, "Admin");
    const publicFolder = findChild(usersFolder!, "Public");
    expect(adminFolder!.item?.map((it) => it.name)).toEqual([
      "List admin users",
      "List admin items",
    ]);
    expect(publicFolder!.item?.map((it) => it.name)).toEqual(["List public posts"]);

    // Orders/: sólo el item directo.
    expect(ordersFolder!.item?.map((it) => it.name)).toEqual(["List orders"]);
  });

  test("explícito bajo top real compartido con implícito → raíz única con subs + direct", () => {
    // "Public" explícito cuyo top real es "public"; además hay un
    // implícito bajo "public". Ambos deben aterrizar bajo la misma
    // carpeta raíz "Public" — el explícito como subs y el implícito
    // como direct.
    const col = buildCollection(
      [
        spec({
          name: "Get public profile",
          uri: "/public/profile",
          folder: "Public",
        }),
        spec({ name: "List public items", uri: "/public/items" }),
      ],
      baseConfig,
    );

    const publicFolder = findFolder(col.item, "Public");
    expect(publicFolder).toBeDefined();
    // Una sola raíz "Public".
    expect(col.item.filter((f) => f.name.toLowerCase() === "public")).toHaveLength(1);

    const publicSub = findChild(publicFolder!, "Public");
    expect(publicSub).toBeDefined();
    expect(publicSub!.item?.[0]?.name).toBe("Get public profile");

    // El implícito va después de la sub.
    const directChild = publicFolder!.item?.find(
      (it) => it.name === "List public items",
    );
    expect(directChild).toBeDefined();
  });
});