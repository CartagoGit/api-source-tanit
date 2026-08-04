from flask import Blueprint

orders_bp = Blueprint("orders", __name__, url_prefix="/api/orders")


@orders_bp.route("/", methods=["GET"])
def list_orders():
    return []


@orders_bp.route("/", methods=["POST"])
def create_order():
    return {"id": 1}


@orders_bp.route("/<int:id>", methods=["GET"])
def show_order(id):
    return {"id": id}


@orders_bp.route("/<int:id>/status", methods=["PATCH"])
def update_status(id):
    return {"id": id}