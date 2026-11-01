from flask import Flask, jsonify

app = Flask(__name__)

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

@app.route("/api/users", methods=["GET"])
def list_users():
    return jsonify([])

@app.route("/api/users", methods=["POST"])
def create_user():
    return jsonify({}), 201

@app.route("/api/users/<int:id>", methods=["GET"])
def get_user(id):
    return jsonify({"id": id})

@app.route("/api/users/<int:id>", methods=["DELETE"])
def delete_user(id):
    return "", 204
