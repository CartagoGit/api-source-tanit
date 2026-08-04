import { z } from "zod";

const updateStatusSchema = z.object({
  status: z.enum(["pending", "paid", "shipped", "cancelled"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const body = await request.json();
  const parsed = updateStatusSchema.parse(body);
  return Response.json({ id: params.id, ...parsed });
}