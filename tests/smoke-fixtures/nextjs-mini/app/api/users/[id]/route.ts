export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  return Response.json({ id: params.id });
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  return new Response(null, { status: 204 });
}
