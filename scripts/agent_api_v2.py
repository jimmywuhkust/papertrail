"""Versioned, compact, evidenced resources and contracts for the v2 query SDKs."""
from collections import defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import shutil
import runpy
import unicodedata

VERSION = "2.0.0"
SHORT_FIELDS = ["id", "title", "authors", "year", "venueId", "venueName", "doi", "url", "sourceUrl", "metadataSources", "counts", "relationshipStatus", "fieldProvenance", "authorships"]


def name_key(value):
    return " ".join(unicodedata.normalize("NFKC", value).lower().split())


def bucket(value):
    return hashlib.sha256(value.encode()).hexdigest()[:2]


def augment(db, records, index, root):
    identity_path = root / "public/data/researcher-identities.json"
    registry = json.loads(identity_path.read_text(encoding="utf-8"))
    content = hashlib.sha256((VERSION + sqlite3.sqlite_version + unicodedata.unidata_version).encode())
    for source in ("scripts/build-agent-api.py", "scripts/agent_api_v2.py", "scripts/agent_contracts.py", "public/agents/papertrail.py", "public/agents/papertrail.mjs"):
        content.update((root / source).read_text(encoding="utf-8").encode())
    for path in [root / "public/data/venue-library/index.json", identity_path] + [root / "public/data/venue-library" / s["url"] for s in index["shards"] + index["referenceShards"]]:
        content.update(hashlib.sha256(path.read_bytes()).digest())
    snapshot_id = content.hexdigest()[:24]
    db.executescript("""CREATE TABLE researchers(id TEXT PRIMARY KEY, name_key TEXT, profile TEXT) WITHOUT ROWID;
        CREATE TABLE author_papers(author_id TEXT NOT NULL, node_id INTEGER NOT NULL REFERENCES papers, association TEXT,
            PRIMARY KEY(author_id,node_id)) WITHOUT ROWID;
        CREATE INDEX author_papers_node ON author_papers(node_id);""")
    db.execute("CREATE TABLE author_names(name_key TEXT,author_id TEXT,PRIMARY KEY(name_key,author_id)) WITHOUT ROWID")
    profiles = {}
    for id, profile in registry["profiles"].items():
        profiles[id] = {**profile, "associations": []}
    outgoing = dict(db.execute("SELECT source,COUNT(*) FROM edges GROUP BY source"))
    incoming = dict(db.execute("SELECT target,COUNT(*) FROM edges GROUP BY target"))
    crossref_seen = set()
    for shard in index["referenceShards"]:
        for record in json.loads((root / "public/data/venue-library" / shard["url"]).read_text(encoding="utf-8"))["records"]:
            crossref_seen.add(record["sourceDoi"])
    compact = []
    for number, original in enumerate(records, 1):
        associations = registry["paperAssociations"].get(original["id"], [])
        authorships = []
        for position, name in enumerate(original["authors"], 1):
            candidates = [a for a in associations if name_key(a["name"]) == name_key(name) and a["position"] == position]
            candidate = candidates[0] if len(candidates) == 1 else None
            if not candidate:
                upstream = next((a for a in original.get("authorships", []) if a.get("name") == name and a.get("authorId")), None)
                candidate = upstream
            if candidate:
                id = candidate["authorId"]
                profiles.setdefault(id, {"id": id, "name": name, "nameVariants": [name], "identifiers": candidate.get("identifiers", {}), "affiliations": candidate.get("affiliations", []), "sources": [candidate.get("sourceUrl", original["sourceUrl"])], "identityStatus": "upstream_identifier", "associations": []})
                association = {**candidate, "paperId": original["id"], "venueId": original["venueId"], "year": original["year"]}
            else:
                id = "unresolved-name:" + hashlib.sha256(name_key(name).encode()).hexdigest()[:24]
                profiles.setdefault(id, {"id": id, "name": name, "nameVariants": [name], "identifiers": {}, "affiliations": [], "sources": [], "identityStatus": "name_only_group", "associations": []})
                association = {"authorId": id, "name": name, "position": position, "paperId": original["id"], "venueId": original["venueId"], "year": original["year"], "source": original["metadataSources"][0], "sourceUrl": original["sourceUrl"], "status": "name_only", "checkedAt": None}
            # The source snapshot sometimes collapses homonymous name entries;
            # ambiguous positions remain name-only rather than claiming identity.
            profiles[id]["associations"].append(association)
            authorships.append({key: association[key] for key in ("authorId", "name", "position", "status", "source", "sourceUrl", "checkedAt")})
            db.execute("INSERT OR IGNORE INTO author_papers VALUES(?,?,?)", (id, number, json.dumps(association, ensure_ascii=False)))
        primary = original["metadataSources"][0]
        provenance = {field: {"source": primary, "sourceUrl": original["sourceUrl"], "retrievedAt": None, "basis": "recorded_source_strategy"} for field in ("title", "year", "authors", "doi")}
        provenance["upstreamCitationCount"] = {"source": "OpenAlex" if original.get("citationCount") is not None else None, "sourceUrl": f"https://openalex.org/{original['openAlexId']}" if original.get("openAlexId") else None, "retrievedAt": None, "sourceUpdatedAt": original.get("sourceUpdatedAt")}
        reference_sources = (["OpenAlex"] if original["referenceIds"] else []) + (["Crossref"] if original.get("doi") in crossref_seen else [])
        relation_status = {"references": "available" if reference_sources else "unknown", "cited_by": "available", "referenceSources": reference_sources, "completeness": "not_asserted", "checkedAt": None}
        record = {**original, "authorships": authorships, "fieldProvenance": provenance,
                  "fieldConflicts": None, "counts": {"upstreamCitationCount": original.get("citationCount"), "incomingCorpusCitationCount": incoming.get(number, 0), "recordedReferenceCount": outgoing.get(number, 0)}, "relationshipStatus": relation_status, "resolutionState": "resolved"}
        db.execute("UPDATE papers SET metadata=? WHERE node_id=?", (json.dumps(record, ensure_ascii=False, separators=(",", ":")), number))
        compact.append({key: record[key] for key in SHORT_FIELDS + ["topics", "resolutionState"]})
    # Empty registry people do not become searchable phantom candidates.
    profiles = {id: p for id, p in profiles.items() if p["associations"]}
    for id, profile in profiles.items():
        profile["paperCount"] = len({a["paperId"] for a in profile["associations"]})
        profile["associationStatus"] = "upstream_identifier" if profile["identityStatus"] == "upstream_identifier" else "name_only"
        # Associations already live in indexed author_papers; do not duplicate
        # them in half a million SQLite profile blobs.
        db_profile={k:v for k,v in profile.items() if k!="associations"}
        db.execute("INSERT INTO researchers VALUES(?,?,?)", (id, name_key(profile["name"]), json.dumps(db_profile, ensure_ascii=False, separators=(",", ":"))))
        db.executemany("INSERT OR IGNORE INTO author_names VALUES(?,?)", [(name_key(v),id) for v in profile["nameVariants"]])
    coverage = {"code": "VENUE_SNAPSHOT", "yearRange": index["range"], "venueIds": [v["id"] for v in index["venues"]], "paperSnapshotAt": index["generatedAt"], "identityCheckedAt": registry["checkedAt"], "abstractsAvailable": False, "fullTextAvailable": False, "incomingCitationScope": "CORPUS_SOURCES_ONLY", "externalIdentityAlignment": "CORPUS_ASSERTED_ALIASES_ONLY"}
    db.executemany("INSERT INTO metadata VALUES(?,?)", ((key, json.dumps(value)) for key, value in {"snapshotId": snapshot_id, "responseSchemaVersion": 2, "identityCheckedAt": registry["checkedAt"], "coverage": coverage, "venues": index["venues"]}.items()))
    db.commit()
    return {"snapshotId": snapshot_id, "compact": compact, "profiles": profiles, "identityCheckedAt": registry["checkedAt"], "outgoing": outgoing, "incoming": incoming}


def publish(db, ids, data, old_manifest, root, database_path, digest):
    snapshot_id = data["snapshotId"]
    snapshot_path = f"api/v2/snapshots/{snapshot_id}/"
    directory = root / "public" / snapshot_path
    directory.mkdir(parents=True, exist_ok=True)
    # Only remove previous generated snapshot directories inside this build-owned root.
    snapshots = (root / "public/api/v2/snapshots").resolve()
    for previous in snapshots.iterdir():
        if previous.is_dir() and re.fullmatch(r"[0-9a-f]{24}",previous.name) and previous.name != snapshot_id:
            if previous.resolve().parent != snapshots:
                raise ValueError("Snapshot cleanup escaped generated root")
            shutil.rmtree(previous)
    resources = {}

    def write(path, value):
        serialized = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        file = directory / path
        file.parent.mkdir(parents=True, exist_ok=True)
        if path.endswith(".gz"):
            uncompressed = {"uncompressedBytes": len(serialized), "uncompressedSha256": hashlib.sha256(serialized).hexdigest()}
            serialized = gzip.compress(serialized, compresslevel=6, mtime=0)
        else:
            uncompressed = {}
        file.write_bytes(serialized)
        resources[path] = {"bytes": len(serialized), "sha256": hashlib.sha256(serialized).hexdigest(), **uncompressed}

    def resource(value):
        return {"schemaVersion": 2, "snapshotId": snapshot_id, **value}

    search = defaultdict(list)
    compact = {record["id"]: record for record in data["compact"]}
    for record in compact.values():
        search[record["venueId"]].append(record)
    for venue, records in search.items():
        write(f"search/{venue}.json.gz", resource({"items": records}))

    names, profile_buckets = [defaultdict(list) for _ in range(256)], [dict() for _ in range(256)]
    all_names = []
    for id, profile in data["profiles"].items():
        profile_buckets[int(bucket(id), 16)][id] = profile
        for variant in set(name_key(v) for v in profile["nameVariants"]):
            names[int(bucket(variant), 16)][variant].append(id)
            all_names.append([variant, id])
    for number in range(256):
        write(f"names/{number:02x}.json.gz", resource({"names": names[number]}))
        write(f"authors/{number:02x}.json.gz", resource({"authors": profile_buckets[number]}))
    write("author-names.json.gz", resource({"names": sorted(all_names)}))

    # Bucket all known nodes, including external references. Absence now means
    # not_in_snapshot; a known external state requires an actual recorded node.
    node_buckets = [dict() for _ in range(256)]
    for number, id in ids.items():
        node_buckets[int(bucket(id), 16)][number] = id
    lookup = {row[0]: ids[row[1]] for row in db.execute("SELECT identifier,node_id FROM aliases")}
    lookup_buckets = [dict() for _ in range(256)]
    for alias, canonical in lookup.items():
        lookup_buckets[int(bucket(alias), 16)][alias] = canonical
    for number, group in enumerate(node_buckets):
        entries = {}
        for node, id in group.items():
            paper = compact.get(id, {"id": id, "title": None, "authors": [], "resolutionState": "external_reference", "counts": {"upstreamCitationCount": None, "incomingCorpusCitationCount": data["incoming"].get(node, 0), "recordedReferenceCount": 0}, "relationshipStatus": {"references": "unavailable", "cited_by": "available", "referenceSources": [], "completeness": "not_asserted", "checkedAt": None}})
            entries[id] = {"paper": paper, "references": [], "cited_by": []}
        placeholders = ",".join("?" for _ in group)
        for source, target, provenance in db.execute(f"SELECT source,target,provenance FROM edges WHERE source IN ({placeholders}) ORDER BY source,target", list(group)):
            entries[ids[source]]["references"].append([ids[target], provenance])
        for source, target, provenance in db.execute(f"SELECT source,target,provenance FROM edges WHERE target IN ({placeholders}) ORDER BY target,source", list(group)):
            entries[ids[target]]["cited_by"].append([ids[source], provenance])
        write(f"graph/{number:02x}.json.gz", resource({"entries": entries}))
        write(f"lookup/{number:02x}.json.gz", resource({"identifiers": lookup_buckets[number]}))
        if number % 64 == 0:
            print(f"Published v2 graph buckets {number+1}/256", flush=True)
    archive = directory / "papertrail.sqlite.gz"
    with database_path.open("rb") as source, archive.open("wb") as target:
        with gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=0, compresslevel=6) as zipped:
            while chunk := source.read(1024 * 1024):
                zipped.write(chunk)
    coverage = {"code": "VENUE_SNAPSHOT", "yearRange": old_manifest["range"], "venueIds": [v["id"] for v in old_manifest["venues"]], "paperSnapshotAt": old_manifest["snapshot"], "identityCheckedAt": data["identityCheckedAt"], "abstractsAvailable": False, "fullTextAvailable": False, "incomingCitationScope": "CORPUS_SOURCES_ONLY", "externalIdentityAlignment": "CORPUS_ASSERTED_ALIASES_ONLY"}
    common = {"searchFields": ["title", "topics", "authors"], "matching": ["all_tokens", "any_tokens", "exact_name", "exact_phrase"], "authorSearch": True, "authorIdentityLookup": True, "batchLookup": True, "fieldProjection": True, "cursorPagination": True, "limits": {"search": 100, "batchLookup": 100, "relationships": 1000, "graphDepth": 3, "graphNodes": 500, "graphEdges": 5000}, "ranking": "weighted_token_overlap", "defaults": {"fields": ["title", "topics"], "match": "all_tokens", "limit": 20}}
    manifest = {"schemaVersion": 2, "apiVersion": VERSION, "snapshotId": snapshot_id, "snapshot": old_manifest["snapshot"], "snapshotPath": snapshot_path, "range": old_manifest["range"], "stats": {**old_manifest["stats"], "researcherCandidates": len(data["profiles"]), "identifiedResearchers": sum(p["identityStatus"] == "upstream_identifier" for p in data["profiles"].values())}, "coverage": coverage, "resources": resources, "venues": old_manifest["venues"], "defaultPaperFields": SHORT_FIELDS,
        "database": {"url": "papertrail.sqlite.gz", "compression": "gzip", "bytes": archive.stat().st_size, "sha256": digest(archive), "uncompressedBytes": database_path.stat().st_size, "uncompressedSha256": digest(database_path)},
        "capabilities": {"javascript": {**common, "relatedMethods": ["text"], "graphTraversal": False, "startup": "manifest only; compressed indexes fetched on demand"}, "python": {**common, "relatedMethods": ["text", "coupling", "cocitation"], "graphTraversal": True, "startup": "manifest only; SQLite is lazy for coupling/cocitation/graph"}, "mcp": {**common, "relatedMethods": ["text", "coupling", "cocitation"], "graphTraversal": True, "startup": "initialization/discovery require no database"}},
        "guide": old_manifest["guide"], "transport": "static HTTPS resources, Python/JavaScript queries, optional local SQLite, MCP stdio", "retention": "The published artifact contains the current immutable snapshot; cache/archive needed resources for long-term reproducibility. An unavailable historical snapshot fails explicitly.", "provenance": old_manifest["provenance"], "license": old_manifest["license"]}
    from agent_contracts import contracts
    manifest["defaultPaperFields"] = runpy.run_path(str(root / "public/agents/papertrail.py"))["DEFAULT_FIELDS"]
    for name, value in contracts(manifest, root).items():
        write(name, resource(value))
        (root / "public/api/v2" / name).write_bytes((directory / name).read_bytes())
    manifest["contracts"] = {"tools": "tools.json", "responses": "schemas.json", "staticResources": "openapi.json"}
    manifest["pythonSdk"] = old_manifest["pythonSdk"].replace("-v1.py", ".py")
    manifest["javascriptSdk"] = old_manifest["javascriptSdk"].replace("-v1.mjs", ".mjs")
    manifest_bytes = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    (directory / "manifest.json").write_bytes(manifest_bytes)
    (root / "public/api/v2/manifest.json").write_bytes(manifest_bytes)
    return manifest
