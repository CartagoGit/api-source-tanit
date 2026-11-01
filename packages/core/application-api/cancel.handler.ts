/**
 * `cancel.handler.ts` — cancel a scan or a watch subscription.
 *
 * Two paths:
 *   - `cancel({ projectRoot })` closes the session for that root;
 *     a fresh `open-project` will start a new scan.
 *   - `cancel({ subscriptionId })` removes the watch subscription
 *     so the caller stops receiving events.
 *
 * Returns the count of resources that were actually cancelled
 * (0 when the project/subscription was already gone — not an
 * error, because cancel is idempotent).
 */

import type { IHandler } from "./dispatcher.js";
import {
  CancelInputSchema,
  type CancelInput,
} from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import {
  clearSubscriptions,
  dropSubscriptionById,
} from "./watch.handlers.js";

/** Resultado de cancelar sesiones o suscripciones activas. */
import type { CancelOutput } from "../../contracts/interfaces/core/application-api.interface.js";
export type { CancelOutput } from "../../contracts/interfaces/core/application-api.interface.js";

/** Crea el handler idempotente para cancelar sesiones o suscripciones. */
export function createCancelHandler(): IHandler<CancelInput, CancelOutput> {
  return {
    name: "cancel",
    input: CancelInputSchema,
    async handle(input) {
      let cancelled = 0;

      if (input.projectRoot) {
        const session = getSession(input.projectRoot);
        if (session) {
          session.close();
          cancelled += 1;
        }
      }

      if (input.subscriptionId) {
        if (dropSubscriptionById(input.subscriptionId)) {
          cancelled += 1;
        }
      }

      // If neither matched, that is not an error — cancel is
      // idempotent. We return `cancelled: 0` and let the caller
      // decide whether that means "already done" or "wrong
      // identifier".
      void clearSubscriptions;
      return { cancelled };
    },
  };
}