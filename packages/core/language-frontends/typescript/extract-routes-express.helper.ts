import type { IRouteCallExpression } from "../../../contracts/interfaces/core/language-ir.interface.js";
import type {
  IExtractRoutesResult,
  IExtractedRoute,
  IRouterMount,
} from "./extract-routes-fastify.helper.js";

const HTTP_VERBS = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options",
] as const;

const RESERVED_RECEIVERS: ReadonlySet<string> = new Set([
  "app",
  "server",
  "fastify",
  "koa",
]);

export function extractExpressRoutesFromIR(
  calls: ReadonlyArray<IRouteCallExpression>,
): IExtractRoutesResult {
  const routes: IExtractedRoute[] = [];
  const mounts: IRouterMount[] = [];

  for (const call of calls) {
    const method = (call.method ?? call.resolvedMethod ?? "").toLowerCase();
    const receiver = call.receiver ?? "";
    const args = call.args ?? [];

    if (method === "use") {
      const prefixArg = args[0];
      const routerArg = args[1];
      if (
        prefixArg?.kind === "string" &&
        typeof prefixArg.value === "string" &&
        routerArg?.kind === "identifier" &&
        typeof routerArg.identifierName === "string"
      ) {
        mounts.push({
          plugin: routerArg.identifierName,
          prefix: prefixArg.value,
          range: call.range,
        });
      }
      continue;
    }

    if (!(HTTP_VERBS as readonly string[]).includes(method)) continue;
    const pathArg = args[0];
    if (pathArg?.kind !== "string" || typeof pathArg.value !== "string") {
      continue;
    }
    routes.push({
      method: method.toUpperCase(),
      path: pathArg.value,
      range: call.range,
      isApp: !receiver || RESERVED_RECEIVERS.has(receiver),
      receiver,
    });
  }

  return { routes, mounts };
}