import { z } from "zod";

const addressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  country: z.string().length(2),
  postalCode: z.string().regex(/^\d{5}$/),
});

export async function PUT(
  request: Request,
  { params }: { params: { id: string } },
) {
  const body = await request.json();
  const parsed = addressSchema.parse(body);
  return Response.json({ id: params.id, address: parsed });
}