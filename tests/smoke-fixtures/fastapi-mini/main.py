from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/api/users")
def list_users():
    return []


@app.post("/api/users")
def create_user():
    return {}


@app.get("/api/users/{user_id}")
def show_user(user_id: int):
    return {}
