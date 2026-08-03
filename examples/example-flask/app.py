from flask import Flask, jsonify, request

app = Flask(__name__)


@app.route("/users", methods=["GET"])
def list_users():
    return jsonify({"users": []})


@app.route("/users", methods=["POST"])
def create_user():
    data = request.get_json()
    return jsonify({"id": 1, **data}), 201


@app.route("/users/<int:id>", methods=["GET"])
def get_user(id):
    return jsonify({"id": id})


@app.route("/users/<int:id>", methods=["PUT"])
def update_user(id):
    data = request.get_json()
    return jsonify({"id": id, **data})


@app.route("/users/<int:id>", methods=["DELETE"])
def delete_user(id):
    return jsonify({"deleted": id})


@app.route("/orders", methods=["GET"])
def list_orders():
    return jsonify({"orders": []})


@app.route("/orders", methods=["POST"])
def create_order():
    data = request.get_json()
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
