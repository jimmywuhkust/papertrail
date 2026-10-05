"""Refresh evidenced DBLP person/publication associations; builds never need the network."""
from datetime import datetime, timezone
import argparse
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "public/data/venue-library"
CACHE = ROOT / "scripts/.venue-cache/author-identities"
OUT = ROOT / "public/data/researcher-identities.json"


def build(refresh=False):
    index = json.loads((LIBRARY / "index.json").read_text(encoding="utf-8"))
    papers = []
    for shard in index["shards"]:
        papers.extend(p for p in json.loads((LIBRARY / shard["url"]).read_text(encoding="utf-8"))["records"] if p["id"].startswith("dblp:"))
    CACHE.mkdir(parents=True, exist_ok=True)
    people, associations = {}, {}
    checked = datetime.now(timezone.utc).isoformat()
    source_dates=[]
    for start in range(0, len(papers), 250):
        batch = papers[start:start+250]
        values = " ".join(f"<https://dblp.org/rec/{p['id'][5:]}>" for p in batch)
        query = f"""PREFIX dblp: <https://dblp.org/rdf/schema#>
            SELECT ?publ ?person ?name ?ord ?orcid WHERE {{
              VALUES ?publ {{ {values} }}
              ?publ dblp:hasSignature ?s .
              ?s dblp:signatureCreator ?person ; dblp:signatureDblpName ?name .
              OPTIONAL {{ ?s dblp:signatureOrdinal ?ord }}
              OPTIONAL {{ ?person dblp:orcid ?orcid }}
            }} ORDER BY ?publ ?ord"""
        cache = CACHE / (hashlib.sha256(query.encode()).hexdigest() + ".json")
        if cache.exists() and not refresh:
            payload = json.loads(cache.read_text(encoding="utf-8"))
            retrieved=datetime.fromtimestamp(cache.stat().st_mtime,timezone.utc).isoformat()
        else:
            for attempt in range(4):
                try:
                    request = Request("https://sparql.dblp.org/sparql", data=urlencode({"query": query, "format": "json"}).encode(), headers={"Accept": "application/sparql-results+json", "User-Agent": "PaperTrail-author-identities/2.0"})
                    with urlopen(request, timeout=55) as response:
                        payload = json.load(response)
                    cache.write_text(json.dumps(payload), encoding="utf-8")
                    retrieved=datetime.now(timezone.utc).isoformat()
                    time.sleep(2.5)
                    break
                except Exception:
                    if attempt == 3:
                        raise
                    time.sleep(2 ** attempt)
        source_dates.append(retrieved)
        for row in payload["results"]["bindings"]:
            url = row["person"]["value"]
            id = "dblp-person:" + url.removeprefix("https://dblp.org/pid/")
            name = row["name"]["value"]
            clean = re.sub(r"\s+\d{4}$", "", name).strip()
            profile = people.setdefault(id, {"id": id, "name": clean, "nameVariants": [], "identifiers": {"dblp": url}, "affiliations": [], "sources": [url], "identityStatus": "upstream_identifier"})
            for variant in (clean, name):
                if variant not in profile["nameVariants"]:
                    profile["nameVariants"].append(variant)
            if row.get("orcid"):
                profile["identifiers"]["orcid"] = row["orcid"]["value"]
            paper_id = "dblp:" + row["publ"]["value"].removeprefix("https://dblp.org/rec/")
            association = {"authorId": id, "name": clean, "position": int(row.get("ord", {}).get("value", 0)), "sourceUrl": row["publ"]["value"], "source": "DBLP", "status": "upstream_identifier", "checkedAt": retrieved}
            if association not in associations.setdefault(paper_id, []):
                associations[paper_id].append(association)
        print(f"Identity enrichment: {min(start+250,len(papers))}/{len(papers)} papers, {len(people)} people", flush=True)
    # These affiliations and variants are explicitly supported by linked
    # institutional/person pages, not inferred from publication keywords.
    mo = people["dblp-person:87/4982-1"]
    # Preserve the actual manual institution-page verification date on rebuild.
    if OUT.exists():
        prior=json.loads(OUT.read_text(encoding="utf-8"))
        checked=prior["profiles"][mo["id"]]["affiliations"][0]["checkedAt"]
    mo["nameVariants"].extend(["Li, Mo", "李默"])
    mo["affiliations"] = [{"name": "Hong Kong University of Science and Technology", "aliases": ["HKUST"], "sourceUrl": "https://cse.hkust.edu.hk/~lim/", "checkedAt": checked}, {"name": "Nanyang Technological University", "aliases": ["NTU"], "sourceUrl": "https://dblp.org/pid/87/4982-1", "checkedAt": checked}]
    mo["researchAreas"] = ["Wireless and mobile systems", "Internet of Things"]
    mo["sources"].append("https://cse.hkust.edu.hk/~lim/")
    output = {"schemaVersion": 1, "checkedAt": max(source_dates), "source": "https://sparql.dblp.org/sparql", "profiles": people, "paperAssociations": associations}
    OUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {len(people)} evidenced identities and {len(associations)} paper mappings", flush=True)


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh",action="store_true",help="Fetch fresh SPARQL responses instead of reusing timestamped cache")
    build(parser.parse_args().refresh)
