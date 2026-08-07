from flask import Flask, jsonify, request
from marshmallow import Schema, fields

app = Flask(__name__)


# Marshmallow: de aquí salen los campos, tipos y obligatoriedad del
# body que aparece en la colección. Sin un esquema declarado, un
# `request.get_json()` no dice nada sobre lo que espera el endpoint.
class UserSchema(Schema):
    name = fields.Str(required=True)
    email = fields.Email(required=True)
    age = fields.Int(required=False)


class OrderSchema(Schema):
    customer_id = fields.Int(required=True)
    total = fields.Decimal(required=True)
    note = fields.Str(required=False)


@app.route("/users", methods=["GET"])
def list_users():
    return jsonify({"users": []})


@app.route("/users", methods=["POST"])
def create_user():
    data = UserSchema().load(request.json)
    return jsonify({"id": 1, **data}), 201


@app.route("/users/<int:id>", methods=["GET"])
def get_user(id):
    return jsonify({"id": id})


@app.route("/users/<int:id>", methods=["PUT"])
def update_user(id):
    data = UserSchema(partial=True).load(request.json)
    return jsonify({"id": id, **data})


@app.route("/users/<int:id>", methods=["DELETE"])
def delete_user(id):
    return jsonify({"deleted": id})


@app.route("/orders", methods=["GET"])
def list_orders():
    return jsonify({"orders": []})


@app.route("/orders", methods=["POST"])
def create_order():
    data = OrderSchema().load(request.json)
    return jsonify({"id": 1, **data}), 201


@app.route("/auth/login", methods=["POST"])
def login():
    data = request.get_json()
    return jsonify({"token": "fake"})


@app.route("/auth/refresh", methods=["POST"])
def refresh():
    data = request.get_json()
    return jsonify({"token": "fake"})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(debug=True)
