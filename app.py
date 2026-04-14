from flask import (
    Flask, jsonify, request, render_template, redirect, url_for
)
import yfinance as yf
import requests as http
from datetime import date
import os

from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager, UserMixin,
    login_user, logout_user, login_required, current_user
)
import bcrypt

# ── アプリ設定 ──────────────────────────────────────
app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-before-deploy")

app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///users.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

# ── DB ─────────────────────────────────────────────
db = SQLAlchemy(app)

class User(UserMixin, db.Model):
    id            = db.Column(db.Integer, primary_key=True)
    username      = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)

# ── flask-login ────────────────────────────────────
login_manager = LoginManager(app)
login_manager.login_view    = "login"   # 未ログイン時にリダイレクトするページ
login_manager.login_message = ""        # デフォルトのメッセージを非表示

@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))

# DB テーブルを自動作成
with app.app_context():
    db.create_all()

# ── 認証ルート ──────────────────────────────────────

@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        if not username or not password:
            return render_template("register.html", error="ユーザー名とパスワードを入力してください")

        if User.query.filter_by(username=username).first():
            return render_template("register.html", error="そのユーザー名はすでに使われています")

        pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt())
        user = User(username=username, password_hash=pw_hash.decode())
        db.session.add(user)
        db.session.commit()

        login_user(user)
        return redirect(url_for("index"))

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        user = User.query.filter_by(username=username).first()
        if user and bcrypt.checkpw(password.encode(), user.password_hash.encode()):
            login_user(user)
            return redirect(url_for("index"))

        return render_template("login.html", error="ユーザー名またはパスワードが違います")

    return render_template("login.html")


@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("login"))


@app.route("/admin/users")
def admin_users():
    # 環境変数 ADMIN_KEY と一致するキーをクエリに渡した場合だけ表示
    # 例: /admin/users?key=your_secret
    admin_key = os.environ.get("ADMIN_KEY", "")
    if not admin_key or request.args.get("key") != admin_key:
        return "unauthorized", 403

    users = User.query.order_by(User.id).all()
    rows = "".join(f"<tr><td>{u.id}</td><td>{u.username}</td></tr>" for u in users)
    return f"""
    <html><head><meta charset='utf-8'>
    <style>body{{font-family:sans-serif;padding:24px;background:#111;color:#eee}}
    table{{border-collapse:collapse}}td{{padding:8px 20px;border:1px solid #444}}</style>
    </head><body>
    <h2>登録ユーザー（{len(users)} 人）</h2>
    <table><tr><th>ID</th><th>ユーザー名</th></tr>{rows}</table>
    </body></html>
    """

# ── メインページ ────────────────────────────────────

@app.route("/")
@login_required
def index():
    return render_template("index.html", username=current_user.username)

# ── 株価 API ────────────────────────────────────────

@app.route("/api/stock")
@login_required
def get_stock():
    symbol = request.args.get("symbol", "").strip().upper()
    if not symbol:
        return jsonify({"error": "symbol is required"}), 400

    today = date.today()
    start = date(today.year, 1, 1)

    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(start=start.isoformat(), end=today.isoformat())

        if hist.empty:
            return jsonify({"error": f"No data found for symbol: {symbol}"}), 404

        dates  = [d.strftime("%Y-%m-%d") for d in hist.index]
        closes = [round(float(v), 2) for v in hist["Close"]]

        return jsonify({"symbol": symbol, "dates": dates, "closes": closes})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/search")
@login_required
def search_symbols():
    q = request.args.get("q", "").strip()
    if len(q) < 1:
        return jsonify([])

    try:
        url = "https://query1.finance.yahoo.com/v1/finance/search"
        params = {
            "q": q,
            "lang": "en-US",
            "region": "US",
            "quotesCount": 8,
            "newsCount": 0,
            "enableFuzzyQuery": "false",
            "quotesQueryId": "tss_match_phrase_query",
        }
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        res  = http.get(url, params=params, headers=headers, timeout=5)
        data = res.json()

        results = []
        for item in data.get("quotes", []):
            if item.get("quoteType") not in ("EQUITY", "ETF"):
                continue
            results.append({
                "symbol":   item["symbol"],
                "name":     item.get("shortname") or item.get("longname", ""),
                "exchange": item.get("exchange", ""),
                "type":     item.get("quoteType", ""),
            })

        return jsonify(results)

    except Exception:
        return jsonify([])


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV") == "development"
    app.run(host="0.0.0.0", port=port, debug=debug)
