# Module resolution

How an import specifier becomes a file. The implementation lives in
`packages/core/module-resolution/`; the contract lives in
`packages/contracts/interfaces/core/module-resolution.interface.ts`.

## Why there is a resolver at all

An import specifier is a **string**, and the string only means
something next to the files that interpret it: the `tsconfig.json`
that declares the aliases, the `package.json` that declares the
entry points, the workspace layout that says which package is which.
A resolver that only knows how to join a relative path with the
directory of the importing file understands none of that, and the
symbol behind the import is silently lost.

The resolver answers two questions, and it answers them separately:

| Method             | Touches the filesystem | Answers                                  |
| ------------------ | ---------------------- | ---------------------------------------- |
| `candidates(...)`  | no                     | "where **would** this specifier look?"   |
| `resolve(...)`     | yes                    | "which file **is** this specifier?"       |

`candidates()` is what a scanner wants: it walks the tree of the
project and needs to know whether an import lands on a file that
belongs to the project. `resolve()` is what a caller that wants the
file itself wants.

## The rules, in order

The first rule that matches wins, exactly as Node and TypeScript do.

1. **`#internal`** — the `imports` field of the nearest
   `package.json`. The target is relative to the package directory.
2. **`./x`, `../x`** — relative to the importing file.
3. **`/x`, `C:\x`, `\\server\share\x`** — absolute.
4. **`@/x`** — a `compilerOptions.paths` alias. The pattern with the
   longest prefix wins, the same rule the compiler applies.
5. **`x` with a `baseUrl`** — relative to `compilerOptions.baseUrl`.
6. **`@acme/x`** — a package of the workspace (npm, yarn, pnpm, bun).
7. **`lodash`** — a package of `node_modules`. The lookup walks up
   from the importing file, which is how hoisting works: the package
   may live in the root `node_modules` even when the importer is
   three directories below.

A package that declares `exports` is **authoritative**: a subpath
that is not in the map is not importable, and the `main` field is
not consulted.

The conditions of `exports` and `imports` are read in the order of
the map, and `default` always matches. The active set is
`import`, `require`, `node` and `default`; `browser` is **not**
active by default, because a scan of a backend project must not
resolve to the browser bundle. A caller that scans a frontend says
so:

```ts
const resolver = new ModuleResolver({
  projectRoot,
  conditions: ["browser", "import", "default"],
});
```

A declaration file (`.d.ts`) is a valid target, and it is preferred
over the runtime entry: the scanner reads TypeScript, and a `.js`
entry would carry no symbols.

## Path dialects

Three dialects are understood, and the dialect is a property of the
**string**, not of the machine that runs the scan:

- POSIX — `/app/src/main.ts`
- Windows with a drive letter — `C:\app\src\main.ts`
- Windows UNC share — `\\server\share\pkg`

An absolute path written in another dialect is interpreted **inside
the project**: the drive (or the share) is mapped onto the project
root, which is the only root the machine doing the scan can probe.
A caller that knows the real drive root says so, and the mapping
wins:

```ts
const resolver = new ModuleResolver({
  projectRoot,
  driveRoots: { "C:": "/home/dev/app" },
});
```

## When a specifier resolves to nothing

The resolver never answers "unresolved" with a silent empty list.
It returns a structured failure that names the specifier and every
path it probed:

```ts
const outcome = resolver.resolve("lodash", fromFile);
if (!outcome.ok) {
  outcome.error.code; // "NOT_FOUND" | "INVALID_SPECIFIER" | "UNSUPPORTED"
  outcome.error.specifier; // "lodash"
  outcome.error.searchPaths; // every path that was probed
}
```

`searchPaths` is the part that matters: it is what tells a reader
whether the problem is a missing dependency, a wrong alias or a file
that was never written.

## The legacy global symbol lookup

`SymbolGraph.resolveByImportPath()` used to answer an import it could
not follow by searching **every file of the project** for a symbol
with the imported name. That is a footgun: two routers named `router`
in two files both match, and the caller picks one arbitrarily.

The lookup is **removed by default**. The option that brings it back
is `experimental.allowGlobalSymbolLookup`:

```ts
const graph = SymbolGraph.builder({
  experimental: { allowGlobalSymbolLookup: true },
}).finalize();
```

It is `false` by default, and `removeLegacyGlobalNameLookup(graph)`
switches it off on a graph that was built with it.

### When the flag is the right answer

There is one case where the global lookup is the honest answer: the
caller **knows** the name is unique in the project and cannot name
the destination file. The usual one is a barrel that is generated at
build time — a `index.ts` that re-exports from a file that only
exists after the code generator has run. The import is real, the
destination is not on disk yet, and the only thing the scanner can
do is look the name up.

The cost is the one the flag advertises: the answer is a guess, and
it is only a guess because the caller said so. A project with two
symbols of the same name must not use it — the caller would get
both, and picking one is the bug the default removes.

## The benchmark

`tests/core/module-resolution.bench.ts` resolves 1000 imports of a
synthetic project and prints the time:

```
bun run tests/core/module-resolution.bench.ts
```

The budget is **100 ms** for the cold pass (the manifests and the
`tsconfig` are read when the resolver is built; the pass itself does
the real resolution). The `--check` flag turns the budget into a
gate that exits with 1 when it is exceeded.
