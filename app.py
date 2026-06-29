from flask import Flask, request, jsonify
import requests
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

ADZUNA_APP_ID = os.getenv("ADZUNA_APP_ID")
ADZUNA_APP_KEY = os.getenv("ADZUNA_APP_KEY")
ADZUNA_BASE_URL = "https://api.adzuna.com/v1/api/jobs"

DEFAULT_ROLES = [
    "financial analyst",
    "software engineer",
    "data analyst",
    "data scientist",
    "product manager",
    "marketing manager",
    "sales manager",
    "business analyst",
    "project manager",
    "operations manager",
    "supply chain analyst",
    "accountant",
    "consultant",
    "HR manager",
    "customer success manager"
]


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


def clean_job(job: dict, search_role: str) -> dict:
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
        "source": "Adzuna",
        "search_role": search_role
    }


def unique_key(job: dict) -> str:
    return "|".join([
        str(job.get("title", "")).lower().strip(),
        str(job.get("company", "")).lower().strip(),
        str(job.get("location", "")).lower().strip(),
        str(job.get("url", "")).lower().strip()
    ])


def fetch_adzuna_jobs(role, location, results_per_page, max_pages):
    country_code = get_country_code(location)
    jobs = []
    raw_count = 0
    pages_fetched = 0

    for page in range(1, max_pages + 1):
        params = {
            "app_id": ADZUNA_APP_ID,
            "app_key": ADZUNA_APP_KEY,
            "results_per_page": results_per_page,
            "where": location,
            "content-type": "application/json"
        }

        if role:
            params["what"] = role

        response = requests.get(
            f"{ADZUNA_BASE_URL}/{country_code}/search/{page}",
            params=params,
            timeout=15
        )

        response.raise_for_status()
        data = response.json()
        results = data.get("results", [])

        pages_fetched += 1
        raw_count += len(results)

        if not results:
            break

        for raw_job in results:
            jobs.append(clean_job(raw_job, role or "all"))

    return jobs, raw_count, pages_fetched


@app.route("/search_jobs", methods=["POST"])
def search_jobs():
    data = request.json or {}

    role = (data.get("role") or "").strip()
    location = data.get("location", "london")

    results_per_page = int(data.get("results_per_page", 50))
    max_pages = int(data.get("max_pages", 3))

    results_per_page = max(1, min(results_per_page, 50))
    max_pages = max(1, min(max_pages, 5))

    roles_to_search = [role] if role else DEFAULT_ROLES

    all_jobs = []
    seen = set()
    total_raw_count = 0
    total_pages_fetched = 0

    try:
        for search_role in roles_to_search:
            jobs, raw_count, pages_fetched = fetch_adzuna_jobs(
                search_role,
                location,
                results_per_page,
                max_pages
            )

            total_raw_count += raw_count
            total_pages_fetched += pages_fetched

            for job in jobs:
                key = unique_key(job)

                if key in seen:
                    continue

                seen.add(key)
                all_jobs.append(job)

        return jsonify({
            "count": len(all_jobs),
            "raw_count": total_raw_count,
            "deduplicated_count": len(all_jobs),
            "location_used": location,
            "country_code": get_country_code(location),
            "roles_searched": roles_to_search,
            "results_per_page": results_per_page,
            "max_pages_per_role": max_pages,
            "total_pages_fetched": total_pages_fetched,
            "jobs": all_jobs
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


@app.route("/jobs", methods=["GET"])
def jobs_get():
    role = request.args.get("role", "")
    location = request.args.get("location", "london")
    results_per_page = int(request.args.get("results_per_page", 50))
    max_pages = int(request.args.get("max_pages", 3))

    with app.test_request_context(json={
        "role": role,
        "location": location,
        "results_per_page": results_per_page,
        "max_pages": max_pages
    }):
        return search_jobs()


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "adzuna_app_id_configured": bool(ADZUNA_APP_ID),
        "adzuna_app_key_configured": bool(ADZUNA_APP_KEY)
    })


@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "status": "ok",
        "message": "Job Searcher API is running",
        "endpoints": ["/health", "/jobs", "/search_jobs"]
    })


if __name__ == "__main__":
    app.run(debug=True)
