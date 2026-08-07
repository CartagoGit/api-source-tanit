import { NextResponse } from "next/server";
import { z } from "zod";

// El schema es de donde salen los campos, tipos y obligatoriedad del
// body en la colección. Un `await request.json()` a secas no dice nada
// sobre lo que el endpoint espera recibir.
const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().min(0).max(120).optional(),
  role: z.enum(["admin", "user", "guest"]).default("user"),
});

export async function GET() {
  return NextResponse.json({ users: [] });
}

export async function POST(request: Request) {
  const parsed = createUserSchema.parse(await request.json());
  return NextResponse.json({ id: 1, ...parsed }, { status: 201 });
}
