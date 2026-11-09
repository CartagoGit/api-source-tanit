/**
 * Entry point of the `tsconfig-paths-monorepo` fixture.
 *
 * The three imports below are the three ways a monorepo redirects an
 * import:
 *
 *   - `@/users/users.controller` — a `paths` alias inside the package.
 *   - `@orders/main` — a `paths` alias that crosses into a workspace
 *     package.
 *   - `@acme/orders` — the workspace package itself, imported by the
 *     name its `package.json` declares.
 */
import { usersController } from "@/users/users.controller";
import { ordersMain } from "@orders/main";
import { ordersPackage } from "@acme/orders";

export const app = {
  usersController,
  ordersMain,
  ordersPackage,
};
