/**
 * Build Postman items for tests, **including invalid ones**.
 *
 * Invariant tests need intentionally broken objects: a request with
 * no method, no URL, an item that is neither a folder nor a request.
 * They used to be built with `as unknown as PostmanItem`, an
 * assertion the compiler cannot refute — sixteen times.
 *
 * The problem with that form is not that it is ugly: it is that it
 * **does not say what is broken**. `{ name: "roto", request: { header: [] } } as unknown as
 * PostmanItem` forces you to read the whole object and mentally
 * compare it to the contract to know that the method is missing. And
 * if the contract later adds a required field, those sixteen objects
 * keep compiling while production code is updated: the casting
 * silences exactly the check that would have warned us.
 *
 * Here we declare **what is removed**, by the name of the missing
 * part. The starting object is typed, so a contract change breaks
 * here — where it should.
 */
import type {
  PostmanItem,
  PostmanRequest,
} from "../../packages/contracts/interfaces/core/postman.interface";

/** A valid request, to start from something that does satisfy the contract. */
export function validRequest(
  name: string,
  method = "GET",
  raw = "{{baseUrl}}/users",
): PostmanItem {
  return {
    name,
    request: {
      method,
      header: [],
      url: { raw, host: ["{{baseUrl}}"], path: raw.split("/").filter(Boolean) },
    },
  };
}

/** A folder with whatever is passed in. */
export function folder(name: string, items: PostmanItem[] = []): PostmanItem {
  return { name, item: items };
}

/** Which part is removed from a request to break it. */
export type MissingPart = "method" | "url" | "header" | "request";

/**
 * A request missing one piece, named explicitly.
 *
 * `brokenRequest("no method", "method")` reads naturally, and the
 * object it returns comes from a valid one — so if the contract
 * changes, this stops compiling instead of silently passing.
 */
export function brokenRequest(name: string, missing: MissingPart): PostmanItem {
  const base = validRequest(name);
  if (missing === "request") {
    return { name };
  }
  // `base.request` is always defined: `validRequest` just built it.
  const request: Partial<PostmanRequest> = { ...(base.request ?? {}) };
  delete request[missing];
  // The assertion lives **here and only here**: this is the only spot
  // in the repo that asserts an incomplete object is a valid
  // `PostmanItem`, and it is intentional, because the test is exactly
  // checking what happens with one. Before, that assertion was spread
  // across sixteen places, each with its own ad-hoc object.
  return { name, request: request as PostmanRequest };
}
