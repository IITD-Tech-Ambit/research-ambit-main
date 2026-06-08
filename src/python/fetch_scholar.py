#!/usr/bin/env python3
"""
Google Scholar fallback fetcher for Research Ambit.

Given a Google Scholar author id (the value of `google_scholar_id[0]` on a
Faculty document), this script returns a normalized JSON analytics payload on
stdout so the Node backend can map it into the same response shape used for
Scopus-backed faculty.

Usage:
    python fetch_scholar.py <google_scholar_id>

Output (stdout, on success):
    {
      "source": "scholar",
      "scholarId": "ABCDE",
      "name": "...",
      "affiliation": "...",
      "citations": 1234,
      "hIndex": 21,
      "coAuthors": [{ "name": "...", "affiliation": "...", "scholarId": "..." }],
      "papers": [
        { "title": "...", "year": 2021, "citations": 12,
          "type": "Publication", "venue": "...", "authors": ["...", "..."] }
      ],
      "publicationTimeline": [{ "year": 2021, "count": 3 }]
    }

On failure the script writes a short message to stderr and exits non-zero; the
Node caller treats any non-zero exit (or unparseable stdout) as "no data" and
falls back to a safe empty analytics response. This keeps the UI from breaking.

------------------------------------------------------------------------------
Why two backends?
------------------------------------------------------------------------------
Google Scholar has NO public API and aggressively blocks un-proxied scrapers
(it returns a CAPTCHA page instead of data). Because of that this script has two
strategies, chosen automatically:

  1. SerpApi (RECOMMENDED, reliable) — set SERPAPI_KEY. SerpApi solves the
     CAPTCHA/proxy problem for you and returns clean structured JSON. Free tier:
     100 searches/month, no credit card. https://serpapi.com/google-scholar-author-api

  2. scholarly (no key, best-effort) — used when SERPAPI_KEY is absent. This
     scrapes Scholar directly and WILL usually be blocked from normal IPs unless
     you configure a proxy (SCRAPER_API_KEY / SCHOLAR_USE_FREE_PROXY).

Tunable via environment variables:
    SERPAPI_KEY          SerpApi key -> reliable structured results (preferred)
    SCHOLAR_MAX_PAPERS   max publications to include            (default 40)
    SCHOLAR_FILL_LIMIT   (scholarly only) publications to enrich with per-paper
                         author lists; each costs 1 request    (default 0)
    SCRAPER_API_KEY      (scholarly only) ScraperAPI proxy key
    SCHOLAR_USE_FREE_PROXY=1
                         (scholarly only) use the free proxy pool (unreliable)
    SCHOLAR_RETRIES      attempts when a request is blocked     (default 3)
"""

import json
import os
import sys


def _to_int(value, default=0):
    try:
        if value is None:
            return default
        if isinstance(value, str):
            value = value.replace(",", "").strip()
            if not value:
                return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _build_timeline(papers):
    timeline = {}
    for paper in papers:
        year = paper.get("year")
        if year:
            timeline[year] = timeline.get(year, 0) + 1
    return [
        {"year": year, "count": count}
        for year, count in sorted(timeline.items(), reverse=True)
    ]


# ───────────────────────────── SerpApi backend ─────────────────────────────


def fetch_via_serpapi(scholar_id, api_key):
    """Reliable path: SerpApi Google Scholar Author API (structured JSON)."""
    import requests

    max_papers = _to_int(os.environ.get("SCHOLAR_MAX_PAPERS"), 40) or 40

    resp = requests.get(
        "https://serpapi.com/search.json",
        params={
            "engine": "google_scholar_author",
            "author_id": scholar_id,
            "num": min(max_papers, 100),
            "sort": "pubdate",
            "api_key": api_key,
        },
        timeout=40,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"SerpApi HTTP {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    if data.get("error"):
        raise RuntimeError(f"SerpApi error: {data['error']}")

    author = data.get("author") or {}

    # cited_by.table is a list of single-key dicts: citations / h_index / i10_index
    citations = 0
    h_index = 0
    for row in (data.get("cited_by") or {}).get("table", []) or []:
        if "citations" in row:
            citations = _to_int((row["citations"] or {}).get("all"), citations)
        elif "h_index" in row:
            h_index = _to_int((row["h_index"] or {}).get("all"), h_index)

    co_authors = []
    for co in data.get("co_authors", []) or []:
        name = (co.get("name") or "").strip()
        if not name:
            continue
        co_authors.append(
            {
                "name": name,
                "affiliation": (co.get("affiliations") or "").strip(),
                "scholarId": (co.get("author_id") or "").strip(),
            }
        )

    papers = []
    for art in (data.get("articles", []) or [])[:max_papers]:
        title = (art.get("title") or "").strip()
        if not title:
            continue
        # SerpApi gives authors as a comma-separated string.
        authors = [a.strip() for a in (art.get("authors") or "").split(",") if a.strip()]
        papers.append(
            {
                "title": title,
                "year": _to_int(art.get("year"), 0) or None,
                "citations": _to_int((art.get("cited_by") or {}).get("value"), 0),
                "type": "Publication",
                "venue": (art.get("publication") or "").strip(),
                "authors": authors,
            }
        )

    return {
        "source": "scholar",
        "scholarId": scholar_id,
        "name": (author.get("name") or "").strip(),
        "affiliation": (author.get("affiliations") or "").strip(),
        "citations": citations,
        "hIndex": h_index,
        "coAuthors": co_authors,
        "papers": papers,
        "publicationTimeline": _build_timeline(papers),
    }


# ──────────────────────────── scholarly backend ────────────────────────────


def _split_authors(author_field):
    """scholarly stores publication authors as 'A Name and B Name and ...'."""
    if not author_field or not isinstance(author_field, str):
        return []
    return [part.strip() for part in author_field.split(" and ") if part.strip()]


def _setup_scholarly_proxy():
    """Configure scholarly to route through a proxy when one is requested.

    Returns a short description of the strategy used (for stderr diagnostics).
    """
    from scholarly import scholarly, ProxyGenerator

    scraper_key = (os.environ.get("SCRAPER_API_KEY") or "").strip()
    use_free = (os.environ.get("SCHOLAR_USE_FREE_PROXY") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    )

    try:
        if scraper_key:
            pg = ProxyGenerator()
            if pg.ScraperAPI(scraper_key):
                scholarly.use_proxy(pg)
                return "scraperapi"
            sys.stderr.write("ScraperAPI proxy setup failed; falling back to direct\n")
        elif use_free:
            pg = ProxyGenerator()
            if pg.FreeProxies():
                scholarly.use_proxy(pg)
                return "free-proxies"
            sys.stderr.write("FreeProxies setup failed; falling back to direct\n")
    except Exception as exc:  # noqa: BLE001 - proxy setup is best-effort
        sys.stderr.write(f"proxy setup error ({exc}); falling back to direct\n")

    return "direct"


def fetch_via_scholarly(scholar_id):
    """Best-effort path: scrape Scholar via the scholarly package (often blocked)."""
    from scholarly import scholarly

    max_papers = _to_int(os.environ.get("SCHOLAR_MAX_PAPERS"), 40) or 40
    fill_limit = _to_int(os.environ.get("SCHOLAR_FILL_LIMIT"), 0)
    retries = _to_int(os.environ.get("SCHOLAR_RETRIES"), 3) or 3

    strategy = _setup_scholarly_proxy()
    sys.stderr.write(f"scholarly fetch strategy: {strategy}\n")

    last_error = None
    author = None
    for attempt in range(1, retries + 1):
        try:
            found = scholarly.search_author_id(scholar_id)
            if not found:
                raise RuntimeError(f"No Scholar author found for id {scholar_id}")
            author = scholarly.fill(
                found,
                sections=["basics", "indices", "counts", "coauthors", "publications"],
            )
            break
        except Exception as exc:  # noqa: BLE001 - retry on any scrape failure
            last_error = exc
            sys.stderr.write(f"attempt {attempt}/{retries} failed: {exc}\n")
    if author is None:
        raise RuntimeError(
            "Google Scholar blocked the request (CAPTCHA). Set SERPAPI_KEY for a "
            f"reliable backend, or configure a proxy. Last error: {last_error}"
        )

    co_authors = []
    for co in author.get("coauthors", []) or []:
        name = (co.get("name") or "").strip()
        if not name:
            continue
        co_authors.append(
            {
                "name": name,
                "affiliation": (co.get("affiliation") or "").strip(),
                "scholarId": (co.get("scholar_id") or "").strip(),
            }
        )

    raw_pubs = author.get("publications", []) or []
    raw_pubs.sort(key=lambda p: _to_int((p.get("bib") or {}).get("pub_year"), 0), reverse=True)
    raw_pubs = raw_pubs[:max_papers]

    filled = 0
    if fill_limit > 0:
        for pub in raw_pubs:
            if filled >= fill_limit:
                break
            try:
                scholarly.fill(pub)
                filled += 1
            except Exception:
                break

    papers = []
    for pub in raw_pubs:
        bib = pub.get("bib") or {}
        title = (bib.get("title") or "").strip()
        if not title:
            continue
        papers.append(
            {
                "title": title,
                "year": _to_int(bib.get("pub_year"), 0) or None,
                "citations": _to_int(pub.get("num_citations"), 0),
                "type": (bib.get("pub_type") or "Publication").strip() or "Publication",
                "venue": (bib.get("venue") or bib.get("citation") or "").strip(),
                "authors": _split_authors(bib.get("author")),
            }
        )

    return {
        "source": "scholar",
        "scholarId": scholar_id,
        "name": (author.get("name") or "").strip(),
        "affiliation": (author.get("affiliation") or "").strip(),
        "citations": _to_int(author.get("citedby"), 0),
        "hIndex": _to_int(author.get("hindex"), 0),
        "coAuthors": co_authors,
        "papers": papers,
        "publicationTimeline": _build_timeline(papers),
    }


def fetch(scholar_id):
    serpapi_key = (os.environ.get("SERPAPI_KEY") or "").strip()
    if serpapi_key:
        sys.stderr.write("scholar backend: serpapi\n")
        return fetch_via_serpapi(scholar_id, serpapi_key)
    sys.stderr.write("scholar backend: scholarly (no SERPAPI_KEY set)\n")
    return fetch_via_scholarly(scholar_id)


def main():
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        sys.stderr.write("Missing Google Scholar id argument\n")
        sys.exit(2)

    scholar_id = sys.argv[1].strip()
    try:
        result = fetch(scholar_id)
    except ImportError as exc:
        sys.stderr.write(f"required package not available: {exc}\n")
        sys.exit(3)
    except Exception as exc:  # noqa: BLE001 - any failure is a soft fallback
        sys.stderr.write(f"Scholar fetch failed for {scholar_id}: {exc}\n")
        sys.exit(1)

    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
