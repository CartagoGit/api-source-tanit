"""FastAPI billing API — the API-key half of the `multi-service` fixture.

Real FastAPI code, not a stub: the scanner reads the `@app.<method>`
decorators, and the service declares its own identity (id, host and
auth scheme) next to the routes it protects.

The API-key signal appears twice on purpose:

  - `require_api_key` is a real dependency the routes declare, so
    every call of this service needs an `X-API-Key` header.
  - `auth_kind` / `base_url` below are what the pipeline reads to
    build the service's `authRef` and `serverRef` (see
    `serviceOverridesFromWorkspaces` in
    `packages/core/discovery/generation.pipeline.ts`).

The sibling NestJS service (`../users-api`) authenticates with OAuth2
against a different host. That difference is the whole point of this
fixture: a combined collection must NOT send billing requests to
`users.example.com` with the users access token, nor the other way
round.
"""
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

# Identity of this service, read by the pipeline from the source as
# well as from `pyproject.toml`.
service_id = "billing"
base_url = "https://billing.example.com"
auth_kind = "apiKey"

app = FastAPI(title="Billing API", version="1.0.0")

EXPECTED_API_KEY = "demo-key"


class CreateInvoice(BaseModel):
    customer: str
    amount: float


def require_api_key(x_api_key: str = Header(...)) -> str:
    """Every route of this service authenticates with an API key."""
    if x_api_key != EXPECTED_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key


@app.get("/api/invoices", dependencies=[Depends(require_api_key)])
def list_invoices() -> list:
    return []


@app.post("/api/invoices", dependencies=[Depends(require_api_key)])
def create_invoice(invoice: CreateInvoice) -> dict:
    return {"id": 1, **invoice.model_dump()}


@app.get("/api/invoices/{invoice_id}", dependencies=[Depends(require_api_key)])
def get_invoice(invoice_id: int) -> dict:
    return {"id": invoice_id}