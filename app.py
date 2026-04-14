from flask import Flask, jsonify, request, send_from_directory
import yfinance as yf
import requests
from datetime import date
import os

app = Flask(__name__, static_folder=".")


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(".", filename)


@app.route("/api/stock")
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

        dates = [d.strftime("%Y-%m-%d") for d in hist.index]
        closes = [round(float(v), 2) for v in hist["Close"]]

        return jsonify({"symbol": symbol, "dates": dates, "closes": closes})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/search")
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
        res = requests.get(url, params=params, headers=headers, timeout=5)
        data = res.json()

        results = []
        for item in data.get("quotes", []):
            if item.get("quoteType") not in ("EQUITY", "ETF"):
                continue
            results.append({
                "symbol": item["symbol"],
                "name": item.get("shortname") or item.get("longname", ""),
                "exchange": item.get("exchange", ""),
                "type": item.get("quoteType", ""),
            })

        return jsonify(results)

    except Exception:
        return jsonify([])


if __name__ == "__main__":
    app.run(debug=True, port=5000)
