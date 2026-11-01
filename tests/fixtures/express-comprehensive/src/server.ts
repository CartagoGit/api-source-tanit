import express from "express";
import { userRouter } from "./routes/users.js";
import { orderRouter } from "./routes/orders.js";
import { authRouter } from "./routes/auth.js";

const app = express();

app.use(express.json());

// Health endpoint
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Mount sub-routers
app.use("/api/users", userRouter);
app.use("/api/orders", orderRouter);
app.use("/api/auth", authRouter);

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});