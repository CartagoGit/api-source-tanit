import { NextResponse } from "next/server";
import { z } from "zod";

const createOrderSchema = z.object({
  customerId: z.number().int(),
  total: z.number(),
  note: z.string().optional(),
});

export async function GET() {
  return NextResponse.json({ orders: [] });
}

export async function POST(request: Request) {
  const parsed = createOrderSchema.parse(await request.json());
  return NextResponse.json({ id: 1, ...parsed }, { status: 201 });
}
