from .users import users_bp
from .orders import orders_bp
from .auth import auth_bp


def register_blueprints(app):
    app.register_blueprint(users_bp)
    app.register_blueprint(orders_bp)
    app.register_blueprint(auth_bp)


@app.route("/health", methods=["GET"])
def health():
    return {"status": "ok"}