import express from "express";

const app = express();

// x00028 S3: ambos servicios exponen GET /health. Si la spec isolation
// estuviera rota, los dos servicios verían ambos /health (uno desde
// cada side) y cada colección contendría dos rutas GET /health con
// IDs distintos. El test verifica que cada servicio tiene exactamente
// uno.
app.get("/health", (req, res) => res.json({ ok: true, service: "users" }));
app.get("/api/users", (req, res) => res.json([]));
app.get("/api/users/:id", (req, res) => res.json({}));

export default app;
