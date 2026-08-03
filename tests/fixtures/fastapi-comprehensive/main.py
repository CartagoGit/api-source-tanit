"""
Comprehensive FastAPI fixture for testing all scanner features.

Covers:
- Multiple Pydantic models per endpoint (Create/Update/List/Filter).
- Nested models (Address dentro de User).
- Optional fields with defaults.
- Validators: min_length, max_length, ge, le, gt, pattern, regex.
- EmailStr, UUID4, HttpUrl format.
- Enum / Literal type.
- List[X] and Dict[str, X] responses.
- Path params + Query params + Body params.
"""
from typing import Optional, List, Dict, Literal
from fastapi import FastAPI, HTTPException, Query, Path
from pydantic import BaseModel, EmailStr, HttpUrl, Field, UUID4, field_validator


# ───── User domain ─────

class Address(BaseModel):
    street: str = Field(..., min_length=1, max_length=200)
    city: str
    country: str = Field(..., min_length=2, max_length=2, description="ISO 3166-1 alpha-2")
    postal_code: str = Field(..., pattern=r"^\d{5}$")


class CreateUserRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    age: Optional[int] = Field(default=None, ge=0, le=120)
    role: Literal["admin", "user", "guest"] = "user"
    address: Optional[Address] = None
    tags: List[str] = Field(default_factory=list, max_length=20)


class UpdateUserRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    age: Optional[int] = Field(default=None, ge=0, le=120)
    address: Optional[Address] = None


class ListUsersRequest(BaseModel):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, ge=1, le=100)
    search: Optional[str] = Field(default=None, max_length=100)
    role: Optional[Literal["admin", "user", "guest"]] = None
    include_address: bool = False


class UserResponse(BaseModel):
    id: str
    name: str
    email: EmailStr
    age: Optional[int] = None
    role: str
    address: Optional[Address] = None


# ───── Order domain ─────

class OrderItem(BaseModel):
    product_id: str
    quantity: int = Field(..., ge=1, le=100)
    price: float = Field(..., gt=0)


class CreateOrderRequest(BaseModel):
    customer_id: str
    customer_email: EmailStr
    items: List[OrderItem] = Field(..., min_length=1)
    notes: Optional[str] = Field(default=None, max_length=500)
    metadata: Dict[str, str] = Field(default_factory=dict)


class UpdateOrderStatusRequest(BaseModel):
    status: Literal["pending", "paid", "shipped", "cancelled"]
    notes: Optional[str] = None


# ───── Auth domain ─────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(..., min_length=32)


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_at: str


# ───── Webhooks ─────

class WebhookPayload(BaseModel):
    event: Literal["payment.succeeded", "payment.failed", "subscription.cancelled"]
    data: Dict[str, str]
    timestamp: str


# ───── App ─────

app = FastAPI(title="Comprehensive FastAPI", version="2.0.0")


# ───── Health ─────

@app.get("/health")
def health():
    return {"status": "ok"}


# ───── Auth ─────

@app.post("/auth/login")
def login(req: LoginRequest):
    return {"access_token": "fake", "refresh_token": "fake", "expires_at": "2024-01-01"}


@app.post("/auth/refresh")
def refresh(req: RefreshTokenRequest):
    return {"access_token": "fake"}


@app.post("/auth/logout")
def logout():
    return {"ok": True}


# ───── Users ─────

@app.get("/users")
def list_users(req: ListUsersRequest):
    return {"users": [], "page": req.page}


@app.post("/users")
def create_user(req: CreateUserRequest):
    return {"id": "1", **req.model_dump()}


@app.get("/users/{id}")
def get_user(id: str = Path(...)):
    return {"id": id}


@app.put("/users/{id}")
def update_user(id: str, req: UpdateUserRequest):
    return {"id": id, **req.model_dump(exclude_unset=True)}


@app.patch("/users/{id}")
def patch_user(id: str, req: UpdateUserRequest):
    return {"id": id, **req.model_dump(exclude_unset=True)}


@app.delete("/users/{id}")
def delete_user(id: str):
    return {"deleted": id}


@app.put("/users/{id}/address")
def update_user_address(id: str, req: Address):
    return {"id": id, "address": req.model_dump()}


# ───── Orders ─────

@app.get("/orders")
def list_orders(page: int = Query(1, ge=1), limit: int = Query(20, le=100)):
    return {"orders": []}


@app.post("/orders")
def create_order(req: CreateOrderRequest):
    return {"id": "1", "total": 100.0}


@app.get("/orders/{id}")
def get_order(id: str):
    return {"id": id}


@app.patch("/orders/{id}/status")
def update_order_status(id: str, req: UpdateOrderStatusRequest):
    return {"id": id, "status": req.status}


@app.delete("/orders/{id}")
def cancel_order(id: str):
    return {"cancelled": id}


# ───── Products ─────

class Product(BaseModel):
    id: str
    name: str
    sku: str = Field(..., pattern=r"^[A-Z0-9-]+$")
    price: float = Field(..., gt=0)
    url: HttpUrl


@app.get("/products")
def list_products():
    return []


@app.get("/products/{id}")
def get_product(id: str):
    return {"id": id}


# ───── Webhooks ─────

@app.post("/webhooks/payment")
def payment_webhook(req: WebhookPayload):
    return {"received": True}
