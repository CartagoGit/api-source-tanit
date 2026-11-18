import { z } from "zod";

const createOrderSchema = z.object({
  customerName: z.string(),
  customerEmail: z.string().email(),
  amount: z.number().int().positive(),
  currency: z.enum(["EUR", "USD", "GBP"]).default("EUR"),
});

export async function GET() {
  return Response.json([]);
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createOrderSchema.parse(body);
  return Response.json({ id: 1, ...parsed });
}