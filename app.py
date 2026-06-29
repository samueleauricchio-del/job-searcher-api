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
    location_lower = (location or "").lower()

    mapping = {
        "uk": "gb", "united kingdom": "gb", "england": "gb",
        "london": "gb", "manchester": "gb", "birmingham": "gb",

        "us": "us", "usa": "us", "united states": "us",
        "new york": "us", "san francisco": "us",

        "italy": "it", "italia": "it", "milan": "it", "milano": "it", "rome": "it",

        "germany": "de", "deutschland": "de", "berlin": "de", "munich": "de",

        "france": "fr", "paris": "fr",

        "spain": "es", "madrid": "es", "barcelona": "es",

        "netherlands": "nl", "amsterdam": "nl",

        "australia": "au", "sydney": "au", "melbourne": "au",

        "canada": "ca", "toronto": "ca",
    }

    for key, code in mapping.items():
        if key in location_lower:
            return code

    return "gb"


def clean_job(job: dict) -> dict:
    return {
        "title": job.get("title", ""),
        "company": job.get("company", {}).get("display_name", ""),
        "location": job.get("location", {}).get("display_name", ""),
        "salary_min": job.get("salary_min"),
        "salary_max": job.get("salary_max"),
        "salary_is_predicted": job.get("salary_is_predicted"),
        "contract_type": job.get("contract_type"),
        "contract_time": job.get("contract_time"),
        "category": job.get("category", {}).get("label", ""),
        "description": (job.get("description") or "")[:1200],
        "url": job.get("redirect_url", ""),
        "created": job.get("created", ""),
        "source": "Adzuna"
    }


def unique_key(job: dict) -> str:
    return "|".join([
        str(job.get("title", "")).lower().strip(),
        str(job.get("company", "")).lower().strip(),
        str(job.get("location", "")).lower().strip(),
        str(job.get("url", "")).lower().strip()
    ])


@app.route("/search_jobs", methods=["POST"])
def search_jobs():
    data = request.json or {}

    role = data.get("role", "")
    location = data.get("location", "london")

    results_per_page = int(data.get("results_per_page", 50))
    max_pages = int(data.get("max_pages", 5))

    # Free-tier safe limits
    results_per_page = max(1, min(results_per_page, 50))
    max_pages = max(1, min(max_pages, 5))

    country_code = get_country_code(location)

    jobs = []
    seen = set()
    pages_fetched = 0

    try:
        for page in range(1, max_pages + 1):
            params = {
                "app_id": ADZUNA_APP_ID,
                "app_key": ADZUNA_APP_KEY,
                "results_per_page": results_per_page,
                "what": role,
                "where": location,
                "content-type": "application/json"
            }

            response = requests.get(
                f"{ADZUNA_BASE_URL}/{country_code}/search/{page}",
                params=params,
                timeout=15
            )

            response.raise_for_status()
            data = response.json()
            results = data.get("results", [])

            pages_fetched += 1

            if not results:
                break

            for raw_job in results:
                job = clean_job(raw_job)
                key = unique_key(job)

                if key in seen:
                    continue

                seen.add(key)
                jobs.append(job)

        return jsonify({
            "count": len(jobs),
            "role_used": role,
            "location_used": location,
            "country_code": country_code,
            "results_per_page": results_per_page,
            "pages_fetched": pages_fetched,
            "jobs": jobs
        })

    except requests.exceptions.RequestException as e:
        return jsonify({
            "error": "Adzuna request failed",
            "details": str(e)
        }), 500

    except Exception as e:
        return jsonify({
            "error": "Unexpected server error",
            "details": str(e)
        }), 500


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "adzuna_app_id_configured": bool(ADZUNA_APP_ID),
        "adzuna_app_key_configured": bool(ADZUNA_APP_KEY)
    })


if __name__ == "__main__":
    app.run(debug=True)
