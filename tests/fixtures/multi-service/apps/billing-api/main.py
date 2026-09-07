"""FastAPI billing service — sibling of the NestJS users-api in
`tests/fixtures/multi-service/`.

Routes live under `/api/invoices` so the scanner produces a stable
prefix distinct from the users-api sibling (`/api/users`). The
monorepo detector treats `apps/billing-api/` as its own workspace;
this module is the only FastAPI source the scanner walks there.
"""
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Billing API", version="1.0.0")


class CreateInvoice(BaseModel):
    customer: str
    amount: float


@app.get("/api/invoices")
def list_invoices() -> list:
    return []


@app.post("/api/invoices")
def create_invoice(req: CreateInvoice) -> dict:
    return {"id": 1, **req.model_dump()}


@app.get("/api/invoices/{invoice_id}")
def get_invoice(invoice_id: int) -> dict:
    return {"id": invoice_id}