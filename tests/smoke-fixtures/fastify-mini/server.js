import Fastify from "fastify";
const app = Fastify();
app.get("/users", async () => []);
app.post("/users", async (request) => request.body);
export default app;
