"""
Sample FastAPI app exercising multi-model validation providers.

Endpoints:
- GET /users              → ListUsersRequest
- POST /users             → CreateUserRequest
- GET /users/{id}         → no body (path param)
- PUT /users/{id}         → UpdateUserRequest
- DELETE /users/{id}      → no body
- POST /orders            → CreateOrderRequest
- GET /orders             → ListOrdersRequest
- POST /auth/login        → LoginRequest
- POST /auth/refresh      → RefreshTokenRequest
"""
from typing import Optional, List
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr, Field


# --- User domain ---

class CreateUserRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    age: Optional[int] = Field(default=None, ge=0, le=120)
    role: str = Field(default="user", pattern="^(admin|user|guest)$")


class UpdateUserRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    age: Optional[int] = Field(default=None, ge=0, le=120)


class ListUsersRequest(BaseModel):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, le=100)
    search: Optional[str] = None


# --- Order domain ---

class CreateOrderRequest(BaseModel):
    customer_name: str = Field(..., min_length=1)
    customer_email: EmailStr
    amount: int = Field(..., gt=0)
    items: List[str] = Field(default_factory=list)


class ListOrdersRequest(BaseModel):
    status: Optional[str] = Field(default=None, pattern="^(pending|paid|cancelled)$")
    page: int = 1
    limit: int = 20


# --- Auth domain ---

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)


class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(..., min_length=32)


# --- Router ---

app = FastAPI(title="Sample FastAPI", version="1.0.0")


@app.get("/users")
def list_users(req: ListUsersRequest):
    return {"users": []}


@app.post("/users")
def create_user(req: CreateUserRequest):
    return {"id": 1, **req.model_dump()}


@app.get("/users/{id}")
def get_user(id: int):
    return {"id": id}


@app.put("/users/{id}")
def update_user(id: int, req: UpdateUserRequest):
    return {"id": id, **req.model_dump(exclude_unset=True)}


@app.delete("/users/{id}")
def delete_user(id: int):
    return {"deleted": id}


@app.post("/orders")
def create_order(req: CreateOrderRequest):
    return {"id": 1, "total": req.amount}


@app.get("/orders")
def list_orders(req: ListOrdersRequest):
    return {"orders": []}


@app.post("/auth/login")
def login(req: LoginRequest):
    return {"token": "fake"}


@app.post("/auth/refresh")
def refresh(req: RefreshTokenRequest):
    return {"token": "fake"}
