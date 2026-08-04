import { z } from "zod";

const updateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
});

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  return Response.json({ id: params.id });
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } },
) {
  const body = await request.json();
  const parsed = updateUserSchema.parse(body);
  return Response.json({ id: params.id, ...parsed });
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  return Response.json({ deleted: params.id });
}