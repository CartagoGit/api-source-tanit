# External static-analysis corpus

Each JSON manifest is a reviewed oracle, independent of Tanit's output. It
records an immutable upstream revision, license evidence, exact source hashes,
explicit method/path pairs and a small set of response/property claims.
No upstream source or dependencies are redistributed here.

Obtain the corresponding revision from the manifest's public GitHub repository
and unpack it locally. The runner itself has no download step. It verifies each
listed UTF-8 input and copies only those files into a disposable directory;
extra files, installed dependencies and generated artifacts cannot influence
the scan. It runs Tanit's CLI and actual Application API handlers in browser
context, without starting the upstream server or invoking its scripts.

```bash
bun run scripts/gates/acceptance-external.script.ts \
  --case=realworld-express \
  --project-root=/absolute/path/to/the/pinned-express-checkout \
  --report=/tmp/express-acceptance.json

bun run scripts/gates/acceptance-external.script.ts \
  --case=realworld-laravel \
  --project-root=/absolute/path/to/the/pinned-laravel-checkout \
  --report=/tmp/laravel-acceptance.json
```

Flags use `--name=value`. Output reports must be outside the upstream input tree,
with an existing parent directory. To test an already built Tanit executable,
add `--cli-binary=/absolute/path/to/apisrc-linux-x64`. The binary must be trusted
and outside the third-party tree. The API side always uses this checkout's
source; a binary from another revision can legitimately expose a parity failure.

Both carriers export Postman and OpenAPI. The report compares:

- Endpoint precision and recall against the reviewed oracle, including missing,
  unexpected and duplicate operations. Empty denominators remain unmeasured.
- Full semantic request/inferred-response projections and the generated OpenAPI
  contracts between CLI and API. Collection metadata and transport IDs are
  excluded; path parameters retain their names after representation normalization.
- Reviewed response status/property/type claims separately. OpenAPI's fallback
  `200` is excluded unless the Postman export also carries real response inference.
  Missing inference is `unknown`; an observed incompatible type is `incorrect`.

Exit zero means the route/parity gate passed with no observed type contradiction.
It does not certify every response/schema or a beta release. Sparse positive
claims do not establish whole-schema accuracy; that field remains unmeasured.
A failing analysis writes its measurements and exits nonzero. Execution errors
also replace the requested report with a failed result, preventing stale success.
All temporary inputs, outputs and history are removed afterwards.

The normal test suite checks scoring, malformed oracles, false positives,
duplicates, missing inference, local schema references, changed source hashes and
symlink escapes offline. It does not fetch mutable repositories in CI.

To extend a case, review its source independently before updating expectations.
Never regenerate the oracle from Tanit's current output to make a failing result
pass. Include hashes for every evidence file and license source. The Express
revision declares MIT in `package.json` but supplies no separate license file;
the Laravel revision supplies `LICENSE`. These facts are recorded explicitly.
