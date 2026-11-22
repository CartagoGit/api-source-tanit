from flask import Blueprint, request

from .schemas import AddressSchema, UpdateUserSchema, UserSchema

users_bp = Blueprint("users", __name__, url_prefix="/api/users")


@users_bp.route("/", methods=["GET"])
def list_users():
    return []


@users_bp.route("/", methods=["POST"])
def create_user():
    data = UserSchema().load(request.json)
    return {"id": 1, **data}


@users_bp.route("/<int:id>", methods=["GET"])
def show_user(id):
    return {"id": id}


@users_bp.route("/<int:id>", methods=["PUT"])
def update_user(id):
    data = UpdateUserSchema().load(request.json)
    return {"id": id, **data}


@users_bp.route("/<int:id>", methods=["DELETE"])
def delete_user(id):
    return {"deleted": id}


@users_bp.route("/<int:id>/address", methods=["PUT"])
def update_address(id):
    data = AddressSchema().load(request.json)
    return {"id": id, "address": data}
