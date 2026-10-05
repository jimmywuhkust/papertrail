"""PaperTrail 2.0: identity-aware static query SDK, lazy SQLite and MCP. MIT."""
import argparse
import base64
from collections import deque
import gzip
import hashlib
from http.client import IncompleteRead
import json
import math
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import tempfile
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

VERSION = "2.0.0"
DEFAULT_BASE = "https://jimmywuhkust.github.io/papertrail/"
DEFAULT_FIELDS = ["id","title","authors","year","venueId","venueName","doi","url","sourceUrl","metadataSources","counts","relationshipStatus"]
CAPABILITIES={"searchFields":["title","topics","authors"],"matching":["all_tokens","any_tokens","exact_name","exact_phrase"],"authorSearch":True,"authorIdentityLookup":True,"batchLookup":True,"fieldProjection":True,"cursorPagination":True,"limits":{"search":100,"batchLookup":100,"relationships":1000,"graphDepth":3,"graphNodes":500,"graphEdges":5000},"ranking":"weighted_token_overlap","defaults":{"fields":["title","topics"],"match":"all_tokens","limit":20},"relatedMethods":["text","coupling","cocitation"],"graphTraversal":True,"startup":"manifest only; SQLite is lazy for coupling/cocitation/graph"}


class PaperTrailError(ValueError):
    def __init__(self, code, message, retryable=False, **details):
        super().__init__(message)
        self.error = {"code":code,"message":message,"retryable":retryable,**details}


def key(value):
    return " ".join(unicodedata.normalize("NFKC", str(value)).lower().split())


def tokens(value):
    return re.findall(r"[^\W_]+", key(value), re.UNICODE)


def normalized(identifier):
    if not isinstance(identifier,str) or not identifier.strip():
        raise PaperTrailError("INVALID_IDENTIFIER","Supply a DOI, OpenAlex or source identifier")
    raw = identifier.strip()
    if re.fullmatch(r"(?:https?://openalex\.org/|oa:)?W\d+",raw,re.I):
        return "oa:"+re.search(r"W\d+$",raw,re.I)[0].upper()
    doi = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)","",raw.lower()).strip()
    if re.fullmatch(r"10\.\d{4,9}/\S+",doi):
        return "doi:"+doi
    if re.fullmatch(r"dblp:[A-Za-z0-9_./-]+",raw):
        return raw
    raise PaperTrailError("INVALID_IDENTIFIER","Expected DOI 10.<registrant>/<suffix>, oa:W<number>, or dblp:<key>",input=identifier)


def bound(value,maximum,minimum=1):
    if not isinstance(value,int) or isinstance(value,bool) or not minimum<=value<=maximum:
        raise PaperTrailError("INVALID_INPUT",f"Expected integer {minimum} to {maximum}")
    return value


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"))


def sha(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream,"sha256").hexdigest()


def matching(paper,q,fields,match):
    wanted=tokens(q)
    matches,non_author_tokens={},set()
    for field in fields:
        values=[paper.get("title","")] if field=="title" else paper.get(field,[])
        for value in values:
            words=tokens(value)
            found=[term for term in wanted if term in words]
            accepted=bool(found)
            if field=="authors" and match=="all_tokens":
                accepted=all(term in words for term in wanted)
            if match=="exact_name":
                accepted=key(q)==key(value)
            if match=="exact_phrase":
                accepted=any(words[start:start+len(wanted)]==wanted for start in range(len(words)-len(wanted)+1))
            if accepted:
                matches.setdefault(field,set()).update(found)
            if field!="authors":
                non_author_tokens.update(words)
    if match=="all_tokens" and not (all(term in non_author_tokens for term in wanted) or "authors" in matches):
        return None
    if not matches:
        return None
    weights={"title":4,"topics":2,"authors":1}
    return {"method":"weighted_token_overlap","score":sum(len(words)*weights[field] for field,words in matches.items()),"scoreDirection":"higher_is_better","matchedFields":[field for field in fields if field in matches],"matchedTerms":sorted(set().union(*matches.values())),"match":match}


class PaperTrail:
    def __init__(self,path=None,base_url=DEFAULT_BASE,cache_dir=None,snapshot=None):
        self.base_url=base_url.rstrip("/")+"/"
        self.cache_dir=Path(cache_dir or Path.home()/".cache/papertrail")
        self.cache,self.db,self.path={},None,Path(path) if path else None
        if path:
            self._open(path)
            metadata={r[0]:json.loads(r[1]) for r in self.db.execute("SELECT * FROM metadata")}
            if metadata.get("responseSchemaVersion")!=2:
                raise PaperTrailError("UNSUPPORTED_SCHEMA","Rebuild the v2 database or use papertrail-v1.py")
            self.manifest={"schemaVersion":2,"apiVersion":VERSION,"snapshotId":metadata["snapshotId"],"snapshot":metadata["snapshot"],"stats":metadata["stats"],"coverage":metadata["coverage"],"venues":metadata["venues"]}
        else:
            if snapshot and not re.fullmatch(r"[0-9a-f]{24}",snapshot):
                raise PaperTrailError("INVALID_SNAPSHOT","Snapshot ids have 24 lowercase hexadecimal characters")
            resource=f"api/v2/snapshots/{snapshot}/manifest.json" if snapshot else "api/v2/manifest.json"
            self.manifest=json.loads(self._fetch(urljoin(self.base_url,resource)))
            if self.manifest.get("schemaVersion")!=2:
                raise PaperTrailError("UNSUPPORTED_SCHEMA","This SDK supports schema 2")
        if snapshot and self.manifest["snapshotId"]!=snapshot:
            raise PaperTrailError("SNAPSHOT_CHANGED","Requested snapshot differs from loaded snapshot")
        self.snapshot_id=self.manifest["snapshotId"]

    def _open(self,path):
        self.db=sqlite3.connect(Path(path).resolve().as_uri()+"?mode=ro",uri=True)
        self.db.row_factory=sqlite3.Row
        self.db.execute("PRAGMA query_only=ON")

    def close(self):
        if self.db:
            self.db.close()
            self.db=None

    def _fetch(self,url):
        for attempt in range(3):
            try:
                with urlopen(url,timeout=30) as response:
                    return response.read()
            except HTTPError as error:
                transient=error.code==429 or error.code>=500
                if not transient or attempt==2:
                    raise PaperTrailError("SNAPSHOT_UNAVAILABLE" if error.code==404 else "NETWORK_ERROR",f"Resource HTTP {error.code}",transient,url=url) from error
            except (URLError,TimeoutError) as error:
                if attempt==2:
                    raise PaperTrailError("NETWORK_ERROR",str(error),True,url=url) from error
            time.sleep(.2*2**attempt)

    def resource(self,path):
        if path not in self.cache:
            info=self.manifest["resources"].get(path)
            if not info:
                raise PaperTrailError("UNSUPPORTED_CAPABILITY","Resource not declared by this snapshot")
            data=self._fetch(urljoin(self.base_url,self.manifest["snapshotPath"]+path))
            digest=hashlib.sha256(data).hexdigest()
            compressed_valid=len(data)==info["bytes"] and digest==info["sha256"]
            decoded_valid=len(data)==info.get("uncompressedBytes") and digest==info.get("uncompressedSha256")
            if not compressed_valid and not decoded_valid:
                raise PaperTrailError("INTEGRITY_FAILURE","Resource differs from pinned snapshot",resource=path)
            result=json.loads(gzip.decompress(data) if path.endswith(".gz") and compressed_valid else data)
            if result["snapshotId"]!=self.snapshot_id:
                raise PaperTrailError("SNAPSHOT_CHANGED","Resource belongs to another snapshot")
            self.cache[path]=result
        return self.cache[path]

    def _envelope(self,operation,items,warnings=None,**extra):
        return {"schemaVersion":2,"snapshotId":self.snapshot_id,"operation":operation,"items":items,"coverage":self.manifest["coverage"],"warnings":warnings or [],**extra}

    def _page(self,operation,items,context,limit=20,offset=0,cursor=None,warnings=None):
        bound(limit,1000 if operation in ("references","cited_by") else 100)
        bound(offset,1_000_000,0)
        if cursor is not None:
            try:
                if not isinstance(cursor,str) or not cursor:
                    raise ValueError("Expected opaque cursor string")
                payload=json.loads(base64.urlsafe_b64decode(cursor+"="*(-len(cursor)%4)))
                if not isinstance(payload,dict) or "offset" not in payload:
                    raise ValueError("Expected cursor object")
            except Exception as error:
                raise PaperTrailError("INVALID_CURSOR","Cursor could not be decoded") from error
            if payload.get("snapshotId")!=self.snapshot_id or payload.get("context")!=context:
                raise PaperTrailError("CURSOR_MISMATCH","Cursor belongs to another snapshot/query/projection")
            offset=bound(payload["offset"],1_000_000,0)
        selected=items[offset:offset+limit]
        next_cursor=None
        if offset+len(selected)<len(items):
            next_cursor=base64.urlsafe_b64encode(canonical({"snapshotId":self.snapshot_id,"context":context,"offset":offset+len(selected)}).encode()).decode().rstrip("=")
        return self._envelope(operation,selected,warnings,pagination={"returned":len(selected),"total":len(items),"offset":offset,"nextCursor":next_cursor,"hasMore":next_cursor is not None})

    def _filters(self,venue,from_year,to_year):
        if venue is not None and venue not in [v["id"] for v in self.manifest["venues"]]:
            raise PaperTrailError("UNKNOWN_VENUE","Use a venue id from the manifest",venue=venue)
        for year in (from_year,to_year):
            if year is not None:
                bound(year,2100,1900)
        if from_year is not None and to_year is not None and from_year>to_year:
            raise PaperTrailError("INVALID_YEAR_RANGE","from_year must not exceed to_year")

    def _select(self,item,fields=None):
        fields=DEFAULT_FIELDS if fields is None else fields
        always=["id","resolutionState","matchEvidence","relationship","input","normalizedIdentifier","canonicalIdentifier"]
        allowed=set(DEFAULT_FIELDS+always+["topics","fieldProvenance","authorships","fieldConflicts","referenceIds","citationCount"])
        if not isinstance(fields,list) or not fields or any(f not in allowed for f in fields):
            raise PaperTrailError("INVALID_FIELDS","Unknown paper projection fields")
        return {f:item[f] for f in dict.fromkeys(fields+always) if f in item}

    def _records(self,venue=None):
        if self.db:
            return (json.loads(r[0]) for r in self.db.execute("SELECT metadata FROM papers"+(" WHERE venue_id=?" if venue else ""),(venue,) if venue else ()))
        return (item for v in self.manifest["venues"] if not venue or v["id"]==venue for item in self.resource(f"search/{v['id']}.json.gz")["items"])

    def search(self,q,fields=None,match="all_tokens",venue=None,from_year=None,to_year=None,limit=20,offset=0,cursor=None,select=None):
        fields=["title","topics"] if fields is None else fields
        if not isinstance(q,str) or not tokens(q) or len(q)>300:
            raise PaperTrailError("INVALID_QUERY","q must contain words and be at most 300 characters")
        if not isinstance(fields,list) or not fields or any(f not in ("title","topics","authors") for f in fields):
            raise PaperTrailError("INVALID_FIELDS","Search fields: title, topics, authors")
        if match not in ("all_tokens","any_tokens","exact_name","exact_phrase") or (match=="exact_name" and fields!=["authors"]):
            raise PaperTrailError("INVALID_MATCH","exact_name requires fields=['authors']")
        self._filters(venue,from_year,to_year)
        bound(limit,100);bound(offset,1_000_000,0)
        self._select({},select)
        items=[]
        for paper in self._records(venue):
            if (from_year is not None and paper["year"]<from_year) or (to_year is not None and paper["year"]>to_year):
                continue
            evidence=matching(paper,q,fields,match)
            if evidence:
                items.append(self._select({**paper,"matchEvidence":evidence},select))
        items.sort(key=lambda p:(-p["matchEvidence"]["score"],p["id"]))
        context={"operation":"search","q":key(q),"fields":fields,"match":match,"venue":venue,"fromYear":from_year,"toYear":to_year,"select":select}
        return self._page("search",items,context,limit,offset,cursor)

    def _entry(self,identifier):
        value=normalized(identifier)
        if self.db:
            row=self.db.execute("SELECT node_id FROM aliases WHERE identifier=? UNION SELECT node_id FROM nodes WHERE id=? LIMIT 1",(value,value)).fetchone()
            if not row:
                return None,value
            number=row[0]
            metadata=self.db.execute("SELECT metadata FROM papers WHERE node_id=?",(number,)).fetchone()
            id=self.db.execute("SELECT id FROM nodes WHERE node_id=?",(number,)).fetchone()[0]
            paper=json.loads(metadata[0]) if metadata else {"id":id,"title":None,"authors":[],"resolutionState":"external_reference","counts":{"upstreamCitationCount":None,"recordedReferenceCount":0,"incomingCorpusCitationCount":self.db.execute("SELECT COUNT(*) FROM edges WHERE target=?",(number,)).fetchone()[0]},"relationshipStatus":{"references":"unavailable","cited_by":"available","completeness":"not_asserted","referenceSources":[],"checkedAt":None}}
            entry={"paper":paper}
            for direction,endpoint,neighbor in (("references","source","target"),("cited_by","target","source")):
                entry[direction]=[[r[0],r[1]] for r in self.db.execute(f"SELECT n.id,e.provenance FROM edges e JOIN nodes n ON n.node_id=e.{neighbor} WHERE e.{endpoint}=? ORDER BY n.node_id",(number,))]
            return entry,value
        prefix=hashlib.sha256(value.encode()).hexdigest()[:2]
        id=self.resource(f"lookup/{prefix}.json.gz")["identifiers"].get(value,value)
        prefix=hashlib.sha256(id.encode()).hexdigest()[:2]
        return self.resource(f"graph/{prefix}.json.gz")["entries"].get(id),value

    def paper(self,id,fields=None):
        entry,value=self._entry(id)
        item={**(entry["paper"] if entry else {"id":value,"title":None,"resolutionState":"not_in_snapshot"}),"input":id,"normalizedIdentifier":value,"canonicalIdentifier":entry["paper"]["id"] if entry else None}
        return self._envelope("paper",[self._select(item,fields)])

    def papers(self,ids,fields=None):
        if not isinstance(ids,list) or not ids:
            raise PaperTrailError("INVALID_INPUT","ids must be a nonempty list")
        bound(len(ids),100)
        return self._envelope("papers",[self.paper(id,fields)["items"][0] for id in ids])

    def authors(self,name,affiliation=None,match="exact_name",limit=20,offset=0,cursor=None):
        if not isinstance(name,str) or not tokens(name) or len(name)>200 or match not in ("exact_name","all_tokens"):
            raise PaperTrailError("INVALID_QUERY","Provide a name and exact_name/all_tokens")
        wanted=key(name)
        if affiliation is not None and (not isinstance(affiliation,str) or not affiliation.strip()):
            raise PaperTrailError("INVALID_INPUT","affiliation must be a nonempty string")
        bound(limit,100);bound(offset,1_000_000,0)
        if self.db:
            if match=="exact_name":
                ids=[r[0] for r in self.db.execute("SELECT author_id FROM author_names WHERE name_key=?",(wanted,))]
            else:
                ids={r[1] for r in self.db.execute("SELECT name_key,author_id FROM author_names") if all(t in tokens(r[0]) for t in tokens(name))}
            profiles=[json.loads(self.db.execute("SELECT profile FROM researchers WHERE id=?",(id,)).fetchone()[0]) for id in ids]
        else:
            if match=="exact_name":
                prefix=hashlib.sha256(wanted.encode()).hexdigest()[:2]
                ids=self.resource(f"names/{prefix}.json.gz")["names"].get(wanted,[])
            else:
                ids=list({id for variant,id in self.resource("author-names.json.gz")["names"] if all(t in tokens(variant) for t in tokens(name))})
            profiles=[self.resource(f"authors/{hashlib.sha256(id.encode()).hexdigest()[:2]}.json.gz")["authors"][id] for id in ids]
        items=[]
        for profile in profiles:
            variants=profile["nameVariants"]
            if not any(key(v)==wanted if match=="exact_name" else all(t in tokens(v) for t in tokens(name)) for v in variants):
                continue
            if affiliation and not any(key(affiliation) in key(a["name"]) or key(affiliation) in [key(v) for v in a.get("aliases",[])] for a in profile["affiliations"]):
                continue
            item={k:v for k,v in profile.items() if k!="associations"}
            item["matchEvidence"]={"nameMatch":match,"matchedVariants":[v for v in variants if (key(v)==wanted if match=="exact_name" else all(t in tokens(v) for t in tokens(name)))],"affiliationSources":[a["sourceUrl"] for a in profile["affiliations"]]}
            items.append(item)
        items.sort(key=lambda p:(p["identityStatus"]!="upstream_identifier",p["id"]))
        warnings=["NAME_ONLY_GROUPS_ARE_NOT_PERSON_IDENTITIES"] if any(p["identityStatus"]=="name_only_group" for p in items) else []
        return self._page("authors",items,{"operation":"authors","name":wanted,"affiliation":affiliation,"match":match},limit,offset,cursor,warnings)

    def author_papers(self,author_id,venue=None,from_year=None,to_year=None,limit=20,offset=0,cursor=None,fields=None):
        if not isinstance(author_id,str) or not author_id:
            raise PaperTrailError("INVALID_INPUT","author_id must be a candidate id string")
        bound(limit,100);bound(offset,1_000_000,0)
        self._select({},fields)
        self._filters(venue,from_year,to_year)
        if self.db:
            row=self.db.execute("SELECT profile FROM researchers WHERE id=?",(author_id,)).fetchone()
            profile=json.loads(row[0]) if row else None
            if profile:
                profile["associations"]=[json.loads(r[0]) for r in self.db.execute("SELECT association FROM author_papers WHERE author_id=?",(author_id,))]
        else:
            profile=self.resource(f"authors/{hashlib.sha256(author_id.encode()).hexdigest()[:2]}.json.gz")["authors"].get(author_id)
        if not profile:
            raise PaperTrailError("AUTHOR_NOT_IN_SNAPSHOT","Unknown researcher candidate id")
        links={a["paperId"]:a for a in profile["associations"] if (not venue or a["venueId"]==venue) and (from_year is None or a["year"]>=from_year) and (to_year is None or a["year"]<=to_year)}
        items=[]
        for v in sorted({a["venueId"] for a in links.values()}):
            for paper in self._records(v):
                if paper["id"] in links:
                    a=links[paper["id"]]
                    items.append(self._select({**paper,"matchEvidence":{"method":"author_association","authorId":author_id,"associationStatus":a["status"],"sourceUrl":a["sourceUrl"],"checkedAt":a["checkedAt"]}},fields))
        items.sort(key=lambda p:(-links[p["id"]]["year"],p["id"]))
        warnings=["NAME_ONLY_ASSOCIATIONS_NOT_DISAMBIGUATED"] if profile["identityStatus"]=="name_only_group" else []
        return self._page("author_papers",items,{"operation":"author_papers","authorId":author_id,"venue":venue,"fromYear":from_year,"toYear":to_year,"fields":fields},limit,offset,cursor,warnings)

    def _relationships(self,id,incoming,limit,offset,cursor,expand,fields):
        bound(limit,1000);bound(offset,1_000_000,0)
        if not isinstance(expand,bool):
            raise PaperTrailError("INVALID_INPUT","expand must be boolean")
        self._select({},fields)
        operation="cited_by" if incoming else "references"
        entry,_=self._entry(id)
        if not entry:
            raise PaperTrailError("IDENTIFIER_NOT_IN_SNAPSHOT","No corpus record or recorded external node matches")
        seed=entry["paper"]
        items=[]
        for neighbor,mask in entry[operation]:
            edge={"source":neighbor if incoming else seed["id"],"target":seed["id"] if incoming else neighbor,"kind":"cites","sources":[n for b,n in ((1,"OpenAlex"),(2,"Crossref")) if mask&b],"checkedAt":None}
            items.append({"id":neighbor,"relationship":edge})
        items.sort(key=lambda p:p["id"])
        status=seed["relationshipStatus"][operation]
        result=self._page(operation,items,{"operation":operation,"id":seed["id"],"expand":expand,"fields":fields},limit,offset,cursor,["RELATIONSHIP_DATA_UNKNOWN"] if status=="unknown" else [])
        if expand:
            result["items"]=[{**self.paper(item["id"],fields)["items"][0],"relationship":item["relationship"]} for item in result["items"]]
        result.update(relationshipStatus=status,counts=seed["counts"])
        return result

    def references(self,id,limit=100,offset=0,cursor=None,expand=False,fields=None):
        return self._relationships(id,False,limit,offset,cursor,expand,fields)

    def cited_by(self,id,limit=100,offset=0,cursor=None,expand=False,fields=None):
        return self._relationships(id,True,limit,offset,cursor,expand,fields)

    def status(self):
        database=self.manifest.get("database")
        cached=self.path or (self.cache_dir/f"{database['uncompressedSha256']}.sqlite" if database else None)
        return self._envelope("status",[{"sdkVersion":VERSION,"schemaVersion":2,"cacheReady":bool(self.db or (cached and cached.exists())),"database":database,"capabilities":self.manifest.get("capabilities",{}).get("python",CAPABILITIES),"startup":"Static queries need no SQLite; coupling/cocitation/graph use a lazy database"}])

    def warm_cache(self,progress=False):
        if self.db:
            result=self.status()
            result["operation"]="warm_cache"
            return result
        info=self.manifest["database"]
        self.cache_dir.mkdir(parents=True,exist_ok=True)
        path=self.cache_dir/f"{info['uncompressedSha256']}.sqlite"
        if not path.exists() or sha(path)!=info["uncompressedSha256"]:
            with tempfile.TemporaryDirectory(dir=self.cache_dir) as temporary:
                zipped=Path(temporary)/"download.gz"
                for attempt in range(3):
                    received=zipped.stat().st_size if zipped.exists() else 0
                    request=Request(urljoin(self.base_url,self.manifest["snapshotPath"]+info["url"]),headers={"Range":f"bytes={received}-"} if received else {})
                    try:
                        with urlopen(request,timeout=60) as response,zipped.open("ab" if received and response.status==206 else "wb") as target:
                            while chunk:=response.read(1024*1024):
                                target.write(chunk)
                                if progress:
                                    print(canonical({"stage":"download","bytes":target.tell(),"total":info["bytes"]}),file=sys.stderr,flush=True)
                        if zipped.stat().st_size==info["bytes"]:
                            break
                    except IncompleteRead as error:
                        with zipped.open("ab") as target:
                            target.write(error.partial)
                    except HTTPError as error:
                        if error.code!=429 and error.code<500:
                            raise PaperTrailError("SNAPSHOT_UNAVAILABLE","Database resource unavailable",url=request.full_url) from error
                    except (URLError,TimeoutError,OSError):
                        pass
                    if attempt==2:
                        raise PaperTrailError("DOWNLOAD_INTERRUPTED","Database download did not complete",True)
                    time.sleep(.2*2**attempt)
                if sha(zipped)!=info["sha256"]:
                    raise PaperTrailError("INTEGRITY_FAILURE","Compressed database checksum failed")
                extracted=Path(temporary)/"snapshot.sqlite"
                with gzip.open(zipped,"rb") as source,extracted.open("wb") as target:
                    shutil.copyfileobj(source,target)
                if extracted.stat().st_size!=info["uncompressedBytes"] or sha(extracted)!=info["uncompressedSha256"]:
                    raise PaperTrailError("INTEGRITY_FAILURE","Extracted database checksum failed")
                extracted.replace(path)
        self.path=path
        self._open(path)
        if json.loads(self.db.execute("SELECT value FROM metadata WHERE key='snapshotId'").fetchone()[0])!=self.snapshot_id:
            raise PaperTrailError("SNAPSHOT_CHANGED","Database belongs to another snapshot")
        result=self.status()
        result["operation"]="warm_cache"
        return result

    def related(self,id,method="text",limit=20,fields=None):
        bound(limit,100)
        if method not in ("text","coupling","cocitation"):
            raise PaperTrailError("UNSUPPORTED_CAPABILITY","Use text, coupling or cocitation")
        seed=self.paper(id)["items"][0]
        if seed["resolutionState"]!="resolved":
            raise PaperTrailError("METADATA_UNAVAILABLE","Related discovery needs corpus metadata")
        if method=="text":
            stop={"with","from","using","based","through","towards","their","that","this","into","over"}
            terms=list(dict.fromkeys(t for t in tokens(seed["title"]) if len(t)>3 and t not in stop))[:6]
            matches=[]
            for paper in self._records(seed["venueId"]):
                evidence=matching(paper," ".join(terms),["title","topics"],"any_tokens") if terms else None
                if paper["id"]!=seed["id"] and evidence:
                    evidence["relationType"]="inferred_similarity"
                    matches.append(self._select({**paper,"matchEvidence":evidence},fields))
            matches.sort(key=lambda p:(-p["matchEvidence"]["score"],p["id"]))
            return self._envelope("related",matches[:limit],["METADATA_SIMILARITY_NOT_CONTENT_EVIDENCE"],method=method,scope="SEED_VENUE_TITLE_TOPICS")
        self.warm_cache()
        number=self.db.execute("SELECT node_id FROM papers WHERE id=?",(seed["id"],)).fetchone()[0]
        left,neighbor=("target","source") if method=="coupling" else ("source","target")
        rows=self.db.execute(f"SELECT b.{neighbor},COUNT(*) shared FROM edges a JOIN edges b ON a.{left}=b.{left} JOIN papers p ON p.node_id=b.{neighbor} WHERE a.{neighbor}=? AND b.{neighbor}<>? GROUP BY b.{neighbor} ORDER BY shared DESC,p.id LIMIT ?",(number,number,limit))
        items=[]
        for candidate,shared in rows:
            raw=json.loads(self.db.execute("SELECT metadata FROM papers WHERE node_id=?",(candidate,)).fetchone()[0])
            witnesses=[r[0] for r in self.db.execute(f"SELECT n.id FROM edges a JOIN edges b ON a.{left}=b.{left} JOIN nodes n ON n.node_id=a.{left} WHERE a.{neighbor}=? AND b.{neighbor}=? ORDER BY n.id LIMIT 5",(number,candidate))]
            count_field="recordedReferenceCount" if method=="coupling" else "incomingCorpusCitationCount"
            a,b=seed["counts"][count_field],raw["counts"][count_field]
            evidence={"method":method,"relationType":"inferred_similarity","sharedCount":shared,"sharedIdentifiers":witnesses,"evidenceTruncated":shared>len(witnesses),"seedAvailableCount":a,"candidateAvailableCount":b,"normalizedScore":shared/math.sqrt(a*b) if a and b else None,"normalization":"cosine_of_recorded_neighbor_sets","scoreDirection":"higher_is_better"}
            items.append(self._select({**raw,"matchEvidence":evidence},fields))
        return self._envelope("related",items,method=method,scope="RECORDED_CORPUS_RELATIONSHIPS")

    def graph(self,id,direction="both",depth=2,max_nodes=100,max_edges=500,fields=None):
        if direction not in ("references","cited_by","both"):
            raise PaperTrailError("INVALID_INPUT","Use references, cited_by or both")
        bound(depth,3);bound(max_nodes,500);bound(max_edges,5000)
        root=self.paper(id,fields)["items"][0]
        if root["resolutionState"]=="not_in_snapshot":
            raise PaperTrailError("IDENTIFIER_NOT_IN_SNAPSHOT","No recorded node matches")
        self.warm_cache()
        nodes,edges,queue,reasons,frontier={root["id"]:root},{},deque([(root["id"],0)]),set(),set()
        while queue:
            current,level=queue.popleft()
            if level>=depth:
                continue
            entry,_=self._entry(current)
            for operation in (["references","cited_by"] if direction=="both" else [direction]):
                for neighbor,mask in entry[operation]:
                    source,target=(current,neighbor) if operation=="references" else (neighbor,current)
                    if (source,target) in edges:
                        continue
                    if len(edges)>=max_edges:
                        reasons.add("MAX_EDGES");frontier.add(current);break
                    if neighbor not in nodes:
                        if len(nodes)>=max_nodes:
                            reasons.add("MAX_NODES");frontier.add(current);continue
                        nodes[neighbor]=self.paper(neighbor,fields)["items"][0]
                        queue.append((neighbor,level+1))
                    edges[(source,target)]={"source":source,"target":target,"kind":"cites","sources":[n for b,n in ((1,"OpenAlex"),(2,"Crossref")) if mask&b],"checkedAt":None}
        return self._envelope("graph",list(nodes.values()),root=root["id"],edges=list(edges.values()),truncated=bool(reasons),truncationReasons=sorted(reasons),limits={"depth":depth,"maxNodes":max_nodes,"maxEdges":max_edges},continuation={"frontierIds":sorted(frontier)[:20],"operations":["references","cited_by"],"note":"Page frontier relationships; not a resumable graph cursor"})


STRING={"type":"string"}
LIMIT={"type":"integer","minimum":1,"maximum":100,"default":20}
STRINGS={"type":"array","items":STRING,"minItems":1}
PAGE={"limit":LIMIT,"offset":{"type":"integer","minimum":0,"maximum":1_000_000,"default":0},"cursor":STRING}
FILTERS={"venue":STRING,"from_year":{"type":"integer","minimum":1900,"maximum":2100},"to_year":{"type":"integer","minimum":1900,"maximum":2100}}
DEFINITIONS=[
    ("status","Check versions, snapshot, capabilities and cache readiness without downloading SQLite.",{},[]),
    ("warm_cache","Download/verify the pinned SQLite database for coupling/co-citation/graph.",{},[]),
    ("authors","Find researcher candidates. Resolve identity before collecting publications.",{"name":STRING,"affiliation":STRING,"match":{"type":"string","enum":["exact_name","all_tokens"],"default":"exact_name"},**PAGE},["name"]),
    ("author_papers","Retrieve publications supported by a chosen author association.",{"author_id":STRING,**FILTERS,**PAGE,"fields":STRINGS},["author_id"]),
    ("search","Word-aware search; names match within one author entry. Default title/topics.",{"q":STRING,"fields":{"type":"array","items":{"type":"string","enum":["title","topics","authors"]},"default":["title","topics"]},"match":{"type":"string","enum":["all_tokens","any_tokens","exact_name","exact_phrase"],"default":"all_tokens"},**FILTERS,**PAGE,"select":STRINGS},["q"]),
    ("paper","Resolve to resolved, external_reference or not_in_snapshot.",{"id":STRING,"fields":STRINGS},["id"]),
    ("papers","Batch-resolve at most 100 identifiers, with optional field projection.",{"ids":{"type":"array","items":STRING,"minItems":1,"maxItems":100},"fields":STRINGS},["ids"]),
    *[(name,description,{"id":STRING,**PAGE,"limit":{"type":"integer","minimum":1,"maximum":1000,"default":100},"expand":{"type":"boolean","default":False},"fields":STRINGS},["id"]) for name,description in [("references","Outgoing recorded citations; distinguishes unknown/available data."),("cited_by","Incoming citations from corpus sources, including known external targets.")]],
    ("related","Explain inferred similarity from neighbors or title/topic words.",{"id":STRING,"method":{"type":"string","enum":["text","coupling","cocitation"],"default":"text"},"limit":LIMIT,"fields":STRINGS},["id"]),
    ("graph","Bounded citation neighborhood, compact nodes, explicit truncation reasons.",{"id":STRING,"direction":{"type":"string","enum":["references","cited_by","both"],"default":"both"},"depth":{"type":"integer","minimum":1,"maximum":3,"default":2},"max_nodes":{"type":"integer","minimum":1,"maximum":500,"default":100},"max_edges":{"type":"integer","minimum":1,"maximum":5000,"default":500},"fields":STRINGS},["id"]),
]
TOOLS=[{"name":n,"description":d,"inputSchema":{"type":"object","properties":p,"required":r,"additionalProperties":False}} for n,d,p,r in DEFINITIONS]


def validate(schema,arguments):
    if not isinstance(arguments,dict) or set(arguments)-set(schema["properties"]) or set(schema["required"])-set(arguments):
        raise PaperTrailError("INVALID_INPUT","Unknown/missing tool arguments")
    for name,value in arguments.items():
        rule=schema["properties"][name]
        expected={"string":str,"integer":int,"array":list,"boolean":bool}[rule["type"]]
        if not isinstance(value,expected) or (rule["type"]=="integer" and isinstance(value,bool)):
            raise PaperTrailError("INVALID_INPUT",f"{name} must be {rule['type']}")
        if "enum" in rule and value not in rule["enum"]:
            raise PaperTrailError("INVALID_INPUT",f"Unsupported {name}")
        if rule["type"]=="integer":
            bound(value,rule.get("maximum",1_000_000),rule.get("minimum",0))
        if rule["type"]=="array" and (not value or any(not isinstance(item,str) for item in value) or len(value)>rule.get("maxItems",100)):
            raise PaperTrailError("INVALID_INPUT",f"Invalid {name} list")


def mcp(path=None,base_url=DEFAULT_BASE,snapshot=None):
    client=None
    for line in sys.stdin:
        message=None
        try:
            message=json.loads(line)
            if "id" not in message:
                continue
            method,params=message.get("method"),message.get("params",{})
            if method=="initialize":
                result={"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"papertrail","version":VERSION}}
            elif method=="ping":
                result={}
            elif method=="tools/list":
                result={"tools":TOOLS}
            elif method=="tools/call":
                try:
                    name=params.get("name")
                    tool=next((t for t in TOOLS if t["name"]==name),None)
                    if not tool:
                        raise PaperTrailError("UNKNOWN_TOOL","No such tool")
                    arguments=params.get("arguments",{})
                    validate(tool["inputSchema"],arguments)
                    client=client or PaperTrail(path,base_url,snapshot=snapshot)
                    output=getattr(client,name)(**arguments)
                    result={"content":[{"type":"text","text":canonical(output)}],"isError":False}
                except PaperTrailError as error:
                    result={"content":[{"type":"text","text":canonical({"schemaVersion":2,"error":error.error})}],"isError":True}
            else:
                print(canonical({"jsonrpc":"2.0","id":message["id"],"error":{"code":-32601,"message":"Method not found"}}),flush=True)
                continue
            print(canonical({"jsonrpc":"2.0","id":message["id"],"result":result}),flush=True)
        except Exception as error:
            print(canonical({"jsonrpc":"2.0","id":message.get("id") if isinstance(message,dict) else None,"error":{"code":-32602 if message else -32700,"message":str(error)}}),flush=True)
    if client:
        client.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command",choices=[t["name"] for t in TOOLS]+["mcp"])
    parser.add_argument("--args",default="{}")
    parser.add_argument("--db")
    parser.add_argument("--base-url",default=DEFAULT_BASE)
    parser.add_argument("--snapshot")
    parser.add_argument("--progress",action="store_true")
    options=parser.parse_args()
    if options.command=="mcp":
        mcp(options.db,options.base_url,options.snapshot)
        return
    client=None
    try:
        client=PaperTrail(options.db,options.base_url,snapshot=options.snapshot)
        try:
            arguments=json.loads(options.args)
        except ValueError as error:
            raise PaperTrailError("INVALID_INPUT","--args must be a JSON object") from error
        tool=next(t for t in TOOLS if t["name"]==options.command)
        validate(tool["inputSchema"],arguments)
        if options.command=="warm_cache":
            arguments["progress"]=options.progress
        print(canonical(getattr(client,options.command)(**arguments)))
    except PaperTrailError as error:
        print(canonical({"schemaVersion":2,"error":error.error}))
        raise SystemExit(1)
    finally:
        if client:
            client.close()


if __name__=="__main__":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    main()
