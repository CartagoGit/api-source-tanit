/**
 * API de Fastify que ejercita las tres formas de declarar una ruta y el
 * `schema` de JSON Schema que Fastify lleva dentro de la propia ruta.
 */
import Fastify from "fastify";

const app = Fastify({ logger: true });

app.register(routes, { prefix: "/api" });

async function routes(app) {
  // Forma corta, sin esquema.
  app.get("/health", async () => ({ ok: true }));

  // Forma corta con esquema de body: es la que da tipos exactos.
  app.post(
    "/users",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            email: { type: "string", format: "email" },
            age: { type: "integer", minimum: 0, maximum: 120 },
            role: { type: "string", enum: ["admin", "user", "guest"] },
          },
        },
      },
    },
    async (request) => request.body,
  );

  // Query y path params declarados en el esquema.
  app.get(
    "/users",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer" },
            limit: { type: "integer" },
            search: { type: "string" },
          },
        },
      },
    },
    async () => [],
  );

  app.get("/users/:id", async (request) => ({ id: request.params.id }));

  app.put(
    "/users/:id",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "integer" },
          },
        },
      },
    },
    async (request) => request.body,
  );

  app.delete("/users/:id", async () => null);

  // Forma larga: `route({ method, url })`.
  app.route({
    method: "POST",
    url: "/auth/login",
    schema: {
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8 },
        },
      },
    },
    handler: async () => ({ token: "jwt" }),
  });

  // Forma larga con varios métodos a la vez.
  app.route({
    method: ["GET", "HEAD"],
    url: "/status",
    handler: async () => ({ up: true }),
  });
}

export default app;
