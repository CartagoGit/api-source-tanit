import { z } from "zod";

const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().min(0).max(120),
  role: z.enum(["admin", "user", "guest"]).default("user"),
});

export async function GET() {
  return Response.json([]);
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createUserSchema.parse(body);
  return Response.json({ id: 1, ...parsed });
}