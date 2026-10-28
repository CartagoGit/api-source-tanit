import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = loginSchema.parse(body);
  return Response.json({ token: "fake", ...parsed });
}