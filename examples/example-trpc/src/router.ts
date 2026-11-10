import { initTRPC } from "@trpc/server";
import { z } from "zod";

const t = initTRPC.create();

const usersRouter = t.router({
  list: t.procedure.query(() => []),
  byId: t.procedure.input(z.object({ id: z.string() })).query(() => ({})),
  create: t.procedure
    .input(z.object({ name: z.string(), email: z.string().email() }))
    .mutation(() => ({})),
});

const ordersRouter = t.router({
  list: t.procedure.query(() => []),
  place: t.procedure.input(z.object({ total: z.number() })).mutation(() => ({})),
});

export const appRouter = t.router({
  health: t.procedure.query(() => "ok"),
  users: usersRouter,
  orders: ordersRouter,
  onOrder: t.procedure.subscription(() => null),
});
