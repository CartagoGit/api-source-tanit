from fastapi import FastAPI

app = FastAPI(title="Billing API")


@app.get("/billing/invoices")
def list_invoices():
    return [{"id": "invoice-1", "status": "open"}]