"""
demo/app.py
Tiny sample Flask application for testing agent inline edits, secret handling, and refactoring.
"""

from flask import Flask, jsonify, request

app = Flask(__name__)

# Application Configuration
app.config["SECRET_KEY"] = "demo-placeholder-secret-not-for-prod"
app.config["SITE_NAME"] = "Forge Demo Portal"
API_TOKEN = "demo-token-12345"

@app.route("/")
def index():
    return jsonify({
        "site": app.config["SITE_NAME"],
        "status": "online"
    })

@app.route("/api/data", methods=["GET"])
def get_data():
    auth_header = request.headers.get("Authorization")
    if not auth_header or auth_header != f"Bearer {API_TOKEN}":
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify({"payload": [1, 2, 3, 4, 5]})

if __name__ == "__main__":
    app.run(port=5000)
