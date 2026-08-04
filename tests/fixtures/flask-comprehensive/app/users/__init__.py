from flask import Blueprint

users_bp = Blueprint("users", __name__, url_prefix="/api/users")


@users_bp.route("/", methods=["GET"])
def list_users():
    return []


@users_bp.route("/", methods=["POST"])
def create_user():
    return {"id": 1}


@users_bp.route("/<int:id>", methods=["GET"])
def show_user(id):
    return {"id": id}


@users_bp.route("/<int:id>", methods=["PUT"])
def update_user(id):
    return {"id": id}


@users_bp.route("/<int:id>", methods=["DELETE"])
def delete_user(id):
    return {"deleted": id}


@users_bp.route("/<int:id>/address", methods=["PUT"])
def update_address(id):
    return {"id": id, "address": {}}