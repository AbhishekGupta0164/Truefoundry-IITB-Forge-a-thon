"""
demo/app.py
Tiny sample Flask application for testing agent inline edits, secret handling, and refactoring.

Task B check: copy this file into the Flask checkout as demo/app.py, then run
    flask --app demo/app config
SECRET_KEY and API_TOKEN must print as "***"; SITE_NAME prints its real value.
All values here are dummies, safe to commit.
"""

from flask import Flask, jsonify, request

app = Flask(__name__)

# Application Configuration
app.config["SECRET_KEY"] = "demo-placeholder-secret-not-for-prod"
app.config["SITE_NAME"] = "Forge Demo Portal"
app.config["API_TOKEN"] = "demo-token-12345"

@app.route("/")
def index():
    return jsonify({
        "site": app.config["SITE_NAME"],
        "status": "online"
    })

@app.route("/api/data", methods=["GET"])
def get_data():
    auth_header = request.headers.get("Authorization")
    if not auth_header or auth_header != f"Bearer {app.config['API_TOKEN']}":
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify({"payload": [1, 2, 3, 4, 5]})

if __name__ == "__main__":
    app.run(port=5000)
