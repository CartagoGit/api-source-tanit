from flask import Blueprint

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.route("/login", methods=["POST"])
def login():
    return {"token": "fake"}


@auth_bp.route("/refresh", methods=["POST"])
def refresh():
    return {"token": "fake"}


@auth_bp.route("/logout", methods=["POST"])
def logout():
    return {"ok": True}