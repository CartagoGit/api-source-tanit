from flask import Blueprint, request

from .schemas import LoginSchema, RefreshSchema

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.route("/login", methods=["POST"])
def login():
    data = LoginSchema().load(request.json)
    return {"access_token": "fake", "email": data["email"]}


@auth_bp.route("/refresh", methods=["POST"])
def refresh():
    data = RefreshSchema().load(request.json)
    return {"access_token": "fake", "from": data["refresh_token"]}


@auth_bp.route("/logout", methods=["POST"])
def logout():
    return {"ok": True}
