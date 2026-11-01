/**
 * a00016 S6: `const M = "get"; app[M](...)` style.
 *
 * Same endpoints as express-mini but with the HTTP verbs declared
 * via `const METHOD = ...; app[METHOD](...)` — exercises the new
 * `IConstantBinding` extraction. Without S6 the scanner would pass
 * `[]` to `propagateConstants` and resolve `app[METHOD]` as the
 * literal string `"app[METHOD]"`, dropping every endpoint.
 */
import express from "express";

const GET = "get";
const POST = "post";
const DELETE = "delete";

const app = express();

app[GET]("/health", (req, res) => res.json({ ok: true }));
app[GET]("/api/users", (req, res) => res.json([]));
app[POST]("/api/users", (req, res) => res.json({}));
app[GET]("/api/users/:id", (req, res) => res.json({}));
app[DELETE]("/api/users/:id", (req, res) => res.json({}));

app.listen(3000);
