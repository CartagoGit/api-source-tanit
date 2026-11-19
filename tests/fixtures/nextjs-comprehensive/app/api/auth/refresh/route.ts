import { z } from "zod";

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = refreshSchema.parse(body);
  return Response.json({ token: "fake", ...parsed });
}