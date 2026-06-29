from flask import Flask, request, jsonify
import requests
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

ADZUNA_APP_ID = os.getenv("ADZUNA_APP_ID")
ADZUNA_APP_KEY = os.getenv("ADZUNA_APP_KEY")
ADZUNA_BASE_URL = "https://api.adzuna.com/v1/api/jobs"

def get_country_code(location: str) -> str:
    """Map location string to Adzuna country code."""
    location_lower = location.lower()
    mapping = {
        "uk": "gb", "united kingdom": "gb", "london": "gb",
        "us": "us", "usa": "us", "united states": "us", "new york": "us",
        "italy": "it", "italia": "it", "milan": "it", "milano": "it", "rome": "it",
        "germany": "de", "deutschland": "de", "berlin": "de",
        "france": "fr", "paris": "fr",
        "spain": "es", "madrid": "es", "barcelona": "es",
        "netherlands": "nl", "amsterdam": "nl",
        "australia": "au", "sydney": "au", "melbourne": "au",
        "canada": "ca", "toronto": "ca",
    }
    for key, code in mapping.items():
        if key in location_lower:
            return code
    return "gb"  # default to UK

@app.route("/search_jobs", methods=["POST"])
def search_jobs():
    data = request.json

    role = data.get("role", "")
    location = data.get("location", "london")
    results_per_page = data.get("results_per_page", 10)

    country_code = get_country_code(location)

    params = {
        "app_id": ADZUNA_APP_ID,
        "app_key": ADZUNA_APP_KEY,
        "results_per_page": results_per_page,
        "what": role,
        "where": location,
        "content-type": "application/json"
    }

    try:
        response = requests.get(
            f"{ADZUNA_BASE_URL}/{country_code}/search/1",
            params=params
        )
        response.raise_for_status()
        jobs_data = response.json()

        jobs = []
        for job in jobs_data.get("results", []):
            jobs.append({
                "title": job.get("title", ""),
                "company": job.get("company", {}).get("display_name", ""),
                "location": job.get("location", {}).get("display_name", ""),
                "salary_min": job.get("salary_min"),
                "salary_max": job.get("salary_max"),
                "salary_is_predicted": job.get("salary_is_predicted"),
                "contract_type": job.get("contract_type"),
                "contract_time": job.get("contract_time"),
                "description": job.get("description", "")[:500],
                "url": job.get("redirect_url", ""),
                "created": job.get("created", "")
            })

        return jsonify({
            "count": len(jobs),
            "location_used": location,
            "country_code": country_code,
            "jobs": jobs
        })

    except requests.exceptions.RequestException as e:
        return jsonify({"error": str(e)}), 500

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

if __name__ == "__main__":
    app.run(debug=True)