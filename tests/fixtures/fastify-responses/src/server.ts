import Fastify from "fastify";

const app = Fastify();

app.get(
  "/users",
  {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            email: { type: "string", format: "email" },
          },
          required: ["id", "name"],
        },
      },
    },
  },
  async () => ({ id: 1, name: "Ada", email: "ada@example.com" }),
);

app.post(
  "/users",
  {
    schema: {
      response: {
        201: {
          type: "object",
          properties: {
            id: { type: "integer" },
          },
          required: ["id"],
        },
        400: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
        },
      },
    },
  },
  async () => ({ id: 2 }),
);

app.get("/health", async () => ({ status: "ok" }));

export default app;
