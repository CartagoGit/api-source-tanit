import { describe, expect, test } from "vitest";
import { createTempProject, scanProject } from "../helpers/scanner-fixture";

async function scan(files: Record<string, string>): Promise<string[]> {
  const project = await createTempProject({
    "package.json": '{"dependencies":{"express":"^4.18.0"}}',
    ...files,
  });
  try {
    const { routes } = await scanProject("express", project.root);
    return routes.map((route) => `${route.method} ${route.uri || "/"}`).sort();
  } finally { await project.cleanup(); }
}

describe("Express composed router mounts", () => {
  test("default exported anonymous router composes imported controller chains", async () => {
    expect(await scan({
      "main.ts": `import express from 'express'; import routes from './routes';
        const app = express(); app.use(routes); app.get('/', handler);`,
      "routes.ts": `import { Router } from 'express'; import users from './users';
        import tags from './tags'; const api = Router().use(users).use(tags);
        export default Router().use('/api', api);`,
      "users.ts": `import { Router } from 'express'; const router = Router();
        router.get('/users', handler); export default router;`,
      "tags.ts": `import { Router } from 'express'; const router = Router();
        router.get('/tags', handler); export default router;`,
    })).toEqual(['GET /', 'GET /api/tags', 'GET /api/users']);
  });

  test("nested named aliases compose prefixes without leaking to same-named routers", async () => {
    expect(await scan({
      "main.ts": `import express from 'express'; import { publicApi as api } from './public';
        import { router as admin } from './admin'; const app = express();
        app.use('/v1', api); app.use('/admin', admin);`,
      "public.ts": `import { Router as R } from 'express'; import { router as child } from './users';
        export const publicApi = R(); publicApi.use('/people', child);`,
      "users.ts": `import { Router } from 'express'; export const router = Router(); router.get('/list', handler);`,
      "admin.ts": `import { Router } from 'express'; export const router = Router(); router.get('/list', handler);`,
    })).toEqual(['GET /admin/list', 'GET /v1/people/list']);
  });

  test("a router mounted twice produces both paths", async () => {
    expect(await scan({
      "main.ts": `import express, { Router } from 'express'; const app = express();
        const router = Router(); router.get('/users', handler);
        app.use('/v1', router); app.use('/v2', router);`,
    })).toEqual(['GET /v1/users', 'GET /v2/users']);
  });

  test("middleware factories do not become router mounts", async () => {
    expect(await scan({
      "main.ts": `import express, { Router } from 'express'; const app = express();
        const router = Router(); router.get('/users', handler);
        app.use('/middleware', unrelated(router)); app.use('/api', router);`,
    })).toEqual(['GET /api/users']);
  });
});


test("literal prefix constants and CommonJS default exports preserve mount paths", async () => {
  expect(await scan({
    "main.js": `const express = require('express'); const routes = require('./routes');
      const app = express(); const PREFIX = '/api'; app.use(PREFIX, routes);`,
    "routes.js": `const express = require('express'); const router = express.Router();
      router.get('/users', handler); module.exports = router;`,
  })).toEqual(['GET /api/users']);
});

test("cyclic mounts terminate with a warning while preserving acyclic root paths", async () => {
  const project = await createTempProject({
    "package.json": '{"dependencies":{"express":"^4.18.0"}}',
    "main.ts": `import express, { Router } from 'express'; const app = express();
      const a = Router(); const b = Router(); app.use('/api', a);
      a.use('/nested', b); b.use('/loop', a); a.get('/users', handler);`,
  });
  try {
    const { routes, result } = await scanProject('express', project.root);
    expect(routes.map((route) => route.uri)).toEqual(['/api/users']);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({severity:'warning', reason:expect.stringContaining('Cyclic')}));
  } finally { await project.cleanup(); }
});


test("unknown parent factories keep the unresolved mount visible as a diagnostic", async () => {
  const project = await createTempProject({
    "package.json": '{"dependencies":{"express":"^4.18.0"}}',
    "main.ts": `import { Router } from 'express'; const unknown = customFactory();
      const router = Router(); router.get('/users', handler); unknown.use('/api', router);`,
  });
  try {
    const { result } = await scanProject('express', project.root);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({severity:'warning', reason:expect.stringContaining('unknown')}));
  } finally { await project.cleanup(); }
});


test("deep mount chains return an honest warning instead of overflowing the stack", async () => {
  const lines = ["import { Router } from 'express';"];
  for (let index = 0; index < 300; index++) {
    lines.push(`const r${index} = Router();`);
    if (index > 0) lines.push(`r${index - 1}.use('/nested', r${index});`);
  }
  lines.push("r299.get('/users', handler);");
  const project = await createTempProject({
    "package.json": '{"dependencies":{"express":"^4.18.0"}}',
    "main.ts": lines.join('\n'),
  });
  try {
    const { result } = await scanProject('express', project.root);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({severity:'warning', reason:expect.stringContaining('could not be resolved completely')}));
  } finally { await project.cleanup(); }
});
