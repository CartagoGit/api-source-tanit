/**
 * `validate.handler.ts` — is this a well-formed Postman collection?
 *
 * ## What it used to be
 *
 * Nothing. The invariants lived inside the CLI's
 * `validate-json.script.ts`, so the app's validation screen could only
 * say "not available yet" — while the CLI could answer the question
 * exactly.
 *
 * ## What it is
 *
 * The same invariants, now a service in the core and a handler on top
 * of it. Errors and warnings are **separated**: a missing
 * `_postman_id` is a warning, and a warning does not make the
 * collection invalid.
 */
import type { IHandler } from "./dispatcher.js";
import {
  ValidateInputSchema,
  type ValidateInput,
} from "./zod-schemas.js";
import {
  collectionPathOf,
  readProjectCollection,
  requireResults,
  requireSession,
} from "./project-verbs.helper.js";
import { validatePostmanCollection } from "../domain/collection-validator.service.js";
import type { ValidateOutput } from "../../contracts/interfaces/core/application-api.interface.js";
export type { ValidateOutput } from "../../contracts/interfaces/core/application-api.interface.js";

/** Crea el handler que valida la colección. */
export function createValidateHandler(): IHandler<ValidateInput, ValidateOutput> {
  return {
    name: "validate",
    input: ValidateInputSchema,
    async handle(input) {
      const session = requireSession(input.projectRoot);
      const snap = requireResults(session.current());

      const path = collectionPathOf(snap, input.collectionPath);
      const collection = await readProjectCollection(path);

      return { result: validatePostmanCollection(collection, path) };
    },
  };
}
