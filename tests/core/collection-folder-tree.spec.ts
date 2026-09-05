/**
 * S3.a (a00012 H-P2a): an endpoint's explicit `folder:` must be able
 * to land as a subfolder under the real top computed from the URI
 * (not as a phantom top-level folder).
 *
 * The original bug lived in `collection-builder.service.ts`:
 *
 *   const mainKey = g.explicit ? g.key : autoMainKey;
 *   if (g.explicit) {
 *     if (g.key === mainKey) h.direct.push(...g.items);
 *     else                   h.subs.push(...);
 *   } else {
 *     h.direct.push(...g.items);
 *   }
 *
 * When `g.explicit` was true, `mainKey === g.key` by construction,
 * so the `else` branch (explicit subfolder) **never ran**.
 *
 * The Postman output of the fixture is inspected by folder name
 * (`col.item[*].name`) and by the `item[]` hierarchy — subfolders come
 * before direct items.
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
 * Minimal helper to declare specs in this file. Only what the
 * folder-tree cases use: `method`, `uri`, `name` and `folder`.
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

/** First top-level folder whose `name` matches (case-insensitive). */
function findFolder(items: PostmanItem[], name: string): PostmanItem | undefined {
  const lower = name.toLowerCase();
  return items.find((it) => it.name.toLowerCase() === lower);
}

/** First child entry whose `name` matches inside a folder. */
function findChild(folder: PostmanItem, name: string): PostmanItem | undefined {
  return folder.item?.find((it) => it.name.toLowerCase() === name.toLowerCase());
}

describe("collection-folder-tree (S3.a a00012)", () => {
  test("explicit 'Admin' under real top 'users' → subfolder Admin inside Users", () => {
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
    // The Admin subfolder must NOT leak as a top-level folder.
    expect(findFolder(col.item, "Admin")).toBeUndefined();
    // And it carries the endpoint inside.
    expect(adminFolder!.item?.[0]?.name).toBe("List admin items");
  });

  test("self-referential explicit (folder === real top) → goes to direct", () => {
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
    // The endpoint lives in `direct`, not inside a subfolder.
    expect(publicFolder!.item?.[0]?.name).toBe("List public posts");
    // And there is no "Public" subfolder hanging off itself.
    expect(findChild(publicFolder!, "Public")).toBeUndefined();
  });

  test("implicit (no folder:) still goes to direct of the real top", () => {
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

  test("two explicit groups with the same real top → both under the same root folder", () => {
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

    // Both share `users` as the real top, so the root must be a
    // single "Users" folder — "Users" must not appear twice, and
    // "Admin"/"Public" must not leak as top-level.
    const topNames = col.item.map((f) => f.name.toLowerCase());
    expect(topNames).toContain("users");
    expect(topNames).not.toContain("admin");
    expect(topNames).not.toContain("public");

    const usersFolder = findFolder(col.item, "Users");
    expect(usersFolder).toBeDefined();
    expect(findChild(usersFolder!, "Admin")).toBeDefined();
    expect(findChild(usersFolder!, "Public")).toBeDefined();
  });

  test("semantic snapshot: tree {Users: direct+subs, Orders: direct}", () => {
    const col = buildCollection(
      [
        // Explicit Admin, real top Users → subs.
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
        // Explicit Public, real top Users → subs (same root as Admin).
        spec({
          name: "List public posts",
          uri: "/users/public/posts",
          folder: "Public",
        }),
        // Implicit under Users → direct of root Users.
        spec({ name: "Get profile", uri: "/users/profile" }),
        // Implicit under Orders → root Orders with direct.
        spec({ name: "List orders", uri: "/orders/list" }),
      ],
      baseConfig,
    );

    const usersFolder = findFolder(col.item, "Users");
    const ordersFolder = findFolder(col.item, "Orders");
    expect(usersFolder).toBeDefined();
    expect(ordersFolder).toBeDefined();

    // Users/: first the subs (Admin, Public), then the direct.
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

    // Orders/: only the direct item.
    expect(ordersFolder!.item?.map((it) => it.name)).toEqual(["List orders"]);
  });

  test("explicit under real top shared with implicit → unique root with subs + direct", () => {
    // Explicit "Public" whose real top is "public"; plus an implicit
    // one under "public". Both must land under the same "Public" root
    // folder — the explicit as subs and the implicit as direct.
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
    // A single "Public" root.
    expect(col.item.filter((f) => f.name.toLowerCase() === "public")).toHaveLength(1);

    const publicSub = findChild(publicFolder!, "Public");
    expect(publicSub).toBeDefined();
    expect(publicSub!.item?.[0]?.name).toBe("Get public profile");

    // The implicit one comes after the sub.
    const directChild = publicFolder!.item?.find(
      (it) => it.name === "List public items",
    );
    expect(directChild).toBeDefined();
  });
});