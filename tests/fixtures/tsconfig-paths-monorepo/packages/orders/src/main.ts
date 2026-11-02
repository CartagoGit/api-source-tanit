/**
 * The entry point of the `@acme/orders` workspace package.
 *
 * It is the target of the `@orders/main` alias and of the bare
 * `@acme/orders` import.
 */
export const ordersPackage = {
  name: "orders",
  routes: ["/orders", "/orders/:id"],
};
