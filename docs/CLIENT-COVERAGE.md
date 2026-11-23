# Frontend HTTP analysis coverage

Tanit reads frontend source locally and reports the HTTP calls it can prove from syntax, imports and bindings. The CLI, Application API and DelendAI MCP use the same report. A detected framework, a version resolved from a lockfile and an analyzed HTTP call are separate facts. A compiler version in this reference identifies the fixture environment.

## Verified source forms

| Source form | HTTP evidence covered | Verification boundary |
| --- | --- | --- |
| JavaScript and TypeScript | Direct Fetch, selected Axios calls and configured module receivers. Statically proved strings and constant expressions can supply paths. | Runtime URLs, substituted clients and unresolved aliases remain uncertain. |
| JSX and TSX | The same call analysis inside JavaScript or TypeScript expressions, including event callbacks. | The fixtures establish parser coverage. React and Solid runtime versions have separate compatibility boundaries. |
| Angular component TypeScript | Instance members tied to an import of `@angular/common/http` through constructor injection or `inject()`. Explicit instance calls include verb methods and `request()`. | The receiver, method and URL need independent evidence. The fixtures exercise the receiver independently of component state. |
| Angular external HTML | Direct named event calls on a proven `HttpClient` member when the template is linked to one component. | The Angular compiler under test is 20.3.30. Ambiguous ownership, unsupported expressions and changed source spans retain diagnostics. |
| Vue single-file component scripts | Tested inline JS and TS include classic and setup script blocks, plus paired blocks of the same language with shared imports and isolated declarations. | The real Vue compiler check uses 3.5.46. Unsupported or conflicting script forms retain diagnostics. |
| Vue single-file component templates | Direct named events on an Axios import or configured module receiver visible through `<script setup>`, including a supported paired classic import. | The real Vue compiler check uses 3.5.46. Scoped slots, loops, delegated handlers and receivers without evidence retain diagnostics. |

Check the focused fixtures for the source forms and their failure modes. The project proposals record the compiler and three-carrier receipts where a source form requires runtime-specific interpretation. [Frontend analyzer fixtures](../tests/core/client-consumption.spec.ts)

## Transport and version boundaries

- **Fetch.** The recognizer tests direct calls, literal and statically derived URLs and known options. The separately enabled request-contract comparison covers a literal JSON body with an explicit content type and a supported OpenAPI declaration.
- **Axios.** Fixtures cover known ES imports, a verified CommonJS require, verb methods and explicit request configuration. A narrow, separately enabled response comparison covers an inline type argument on `get` and a supported OpenAPI response declaration. The call tests exercise the static API shapes they name.
- **Configured client.** A declared receiver can prove a direct method call when its import matches the configured module or when it is an explicitly configured global with no local binding. The unresolved status preserves an alias or receiver the scanner cannot verify.
- **Angular HttpClient.** Angular-owned receivers are recognized by provenance of the binding. AngularJS `$http` has separate service injection semantics and its own pending adapter.
- **Pending validation.** Native XMLHttpRequest lifecycle, jQuery AJAX transports, AngularJS, Svelte, Astro, legacy Vue template bindings and further React, Solid and Angular version checks each have dedicated follow-up slices. JS or TS call forms inside already supported carriers continue to use the common recognizers.

A known request mechanism can still have an unknown route. An observed route can still have an unknown body contract. This lets you compare code evidence without attributing a dynamic call or an unresolved schema to an operation. [Client analysis and comparison commands](CLI.md#client-api-consumption)
