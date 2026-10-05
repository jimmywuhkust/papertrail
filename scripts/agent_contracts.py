"""Publish exact v2 result shapes separately from the static HTTPS transport."""
import copy
import runpy


def obj(properties, required=(), additional=False):
    return {"type":"object","properties":properties,"required":list(required),"additionalProperties":additional}


def array(item):
    return {"type":"array","items":item}


def ref(name):
    return {"$ref":"#/$defs/"+name}


def contracts(manifest, root):
    string={"type":"string"}; integer={"type":"integer","minimum":0}
    nullable={"type":["string","null"]}; boolean={"type":"boolean"}
    strings=array(string)
    definitions={
        "Counts":obj({"upstreamCitationCount":{"type":["integer","null"],"minimum":0},"incomingCorpusCitationCount":integer,"recordedReferenceCount":integer},["upstreamCitationCount","incomingCorpusCitationCount","recordedReferenceCount"]),
        "Coverage":obj({"code":{"const":"VENUE_SNAPSHOT"},"yearRange":obj({"startYear":integer,"endYear":integer},["startYear","endYear"]),"venueIds":strings,"paperSnapshotAt":string,"identityCheckedAt":string,"abstractsAvailable":{"const":False},"fullTextAvailable":{"const":False},"incomingCitationScope":{"const":"CORPUS_SOURCES_ONLY"},"externalIdentityAlignment":{"const":"CORPUS_ASSERTED_ALIASES_ONLY"}},["code","yearRange","venueIds","paperSnapshotAt","identityCheckedAt","abstractsAvailable","fullTextAvailable","incomingCitationScope","externalIdentityAlignment"]),
        "Pagination":obj({"returned":integer,"total":integer,"offset":integer,"nextCursor":nullable,"hasMore":boolean},["returned","total","offset","nextCursor","hasMore"]),
        "Edge":obj({"source":string,"target":string,"kind":{"const":"cites"},"sources":array({"enum":["OpenAlex","Crossref"]}),"checkedAt":nullable},["source","target","kind","sources","checkedAt"]),
        "RelationshipStatus":obj({"references":{"enum":["available","unknown","unavailable"]},"cited_by":{"const":"available"},"referenceSources":strings,"completeness":{"const":"not_asserted"},"checkedAt":nullable},["references","cited_by","referenceSources","completeness","checkedAt"]),
        "Provenance":obj({"source":nullable,"sourceUrl":nullable,"retrievedAt":nullable,"sourceUpdatedAt":nullable,"basis":string},["source","sourceUrl","retrievedAt"]),
        "Authorship":obj({"authorId":string,"name":string,"position":{"type":"integer","minimum":1},"status":{"enum":["upstream_identifier","name_only"]},"source":string,"sourceUrl":string,"checkedAt":nullable},["authorId","name","position","status","source","sourceUrl","checkedAt"]),
        "MatchEvidence":obj({"method":{"enum":["weighted_token_overlap","author_association","coupling","cocitation"]},"score":{"type":"number"},"scoreDirection":{"const":"higher_is_better"},"matchedFields":array({"enum":["title","topics","authors"]}),"matchedTerms":strings,"match":{"enum":["all_tokens","any_tokens","exact_name","exact_phrase"]},"authorId":string,"associationStatus":{"enum":["upstream_identifier","name_only"]},"sourceUrl":string,"checkedAt":nullable,"relationType":{"const":"inferred_similarity"},"sharedCount":integer,"sharedIdentifiers":strings,"evidenceTruncated":boolean,"seedAvailableCount":integer,"candidateAvailableCount":integer,"normalizedScore":{"type":["number","null"],"minimum":0,"maximum":1},"normalization":{"const":"cosine_of_recorded_neighbor_sets"}},["method"]),
        "Affiliation":obj({"name":string,"aliases":strings,"sourceUrl":string,"checkedAt":string,"status":string},["name","sourceUrl"],True),
        "Error":obj({"schemaVersion":{"const":2},"error":obj({"code":string,"message":string,"retryable":boolean,"suggestedTransport":string,"supportedMethods":strings,"resource":string,"url":string,"input":string,"venue":string},["code","message","retryable"],True)},["schemaVersion","error"]),
    }
    definitions["Paper"]=obj({"id":string,"title":nullable,"authors":strings,"year":integer,"venueId":string,"venueName":string,"doi":nullable,"url":nullable,"sourceUrl":string,"metadataSources":strings,"topics":strings,"counts":ref("Counts"),"relationshipStatus":ref("RelationshipStatus"),"resolutionState":{"enum":["resolved","external_reference","not_in_snapshot"]},"input":string,"normalizedIdentifier":string,"canonicalIdentifier":nullable,"matchEvidence":ref("MatchEvidence"),"relationship":ref("Edge"),"fieldProvenance":{"type":"object","additionalProperties":ref("Provenance")},"authorships":array(ref("Authorship")),"fieldConflicts":{"type":"null"},"referenceIds":strings,"citationCount":{"type":["integer","null"]}},["id"])
    definitions["Author"]=obj({"id":string,"name":string,"nameVariants":strings,"identifiers":{"type":"object","additionalProperties":True},"affiliations":array(ref("Affiliation")),"sources":strings,"identityStatus":{"enum":["upstream_identifier","name_only_group"]},"associationStatus":{"enum":["upstream_identifier","name_only"]},"paperCount":integer,"researchAreas":strings,"matchEvidence":obj({"nameMatch":{"enum":["exact_name","all_tokens"]},"matchedVariants":strings,"affiliationSources":strings},["nameMatch","matchedVariants","affiliationSources"])},["id","name","nameVariants","identityStatus","associationStatus","paperCount","affiliations","identifiers","sources","matchEvidence"])
    definitions["Database"]=obj({"url":string,"compression":{"const":"gzip"},"bytes":integer,"sha256":string,"uncompressedBytes":integer,"uncompressedSha256":string},["url","compression","bytes","sha256","uncompressedBytes","uncompressedSha256"])
    definitions["Status"]=obj({"sdkVersion":string,"schemaVersion":{"const":2},"cacheReady":boolean,"database":{"anyOf":[ref("Database"),{"type":"null"}]},"capabilities":{"type":["object","null"]},"startup":string,"cachedResources":integer},["sdkVersion","schemaVersion","cacheReady","database","capabilities","startup"])
    envelope=obj({"schemaVersion":{"const":2},"snapshotId":{"type":"string","pattern":"^[0-9a-f]{24}$"},"operation":string,"items":array(ref("Paper")),"coverage":ref("Coverage"),"warnings":strings,"pagination":ref("Pagination"),"relationshipStatus":{"enum":["available","unknown","unavailable"]},"counts":ref("Counts"),"method":{"enum":["text","coupling","cocitation"]},"scope":string,"root":string,"edges":array(ref("Edge")),"truncated":boolean,"truncationReasons":array({"enum":["MAX_NODES","MAX_EDGES"]}),"limits":obj({"depth":integer,"maxNodes":integer,"maxEdges":integer},["depth","maxNodes","maxEdges"]),"continuation":obj({"frontierIds":strings,"operations":strings,"note":string},["frontierIds","operations","note"])},["schemaVersion","snapshotId","operation","items","coverage","warnings"])
    definitions["Envelope"]=envelope
    definitions["MatchEvidence"]["allOf"]=[
        {"if":{"properties":{"method":{"const":method}}},"then":{"required":required}}
        for method,required in [("weighted_token_overlap",["score","scoreDirection","matchedFields","matchedTerms","match"]),("author_association",["authorId","associationStatus","sourceUrl","checkedAt"]),*[ (method,["relationType","sharedCount","sharedIdentifiers","evidenceTruncated","seedAvailableCount","candidateAvailableCount","normalizedScore","normalization","scoreDirection"]) for method in ("coupling","cocitation")]]]
    tools=runpy.run_path(str(root/"public/agents/papertrail.py"))["TOOLS"]
    for tool in tools:
        schema=copy.deepcopy(envelope)
        name=tool["name"]
        schema["properties"]["operation"]={"const":name}
        schema["properties"]["items"]=array(ref("Author" if name=="authors" else "Status" if name in ("status","warm_cache") else "Paper"))
        required_item=["matchEvidence","resolutionState"] if name in ("search","author_papers","related") else ["input","normalizedIdentifier","canonicalIdentifier","resolutionState"] if name in ("paper","papers","graph") else ["relationship"] if name in ("references","cited_by") else []
        if required_item:
            schema["properties"]["items"]["items"]={"allOf":[ref("Paper"),{"required":required_item}]}
        if name in ("search","authors","author_papers","references","cited_by"):
            schema["required"].append("pagination")
        if name in ("references","cited_by"):
            schema["required"] += ["relationshipStatus","counts"]
        if name=="graph":
            schema["required"] += ["root","edges","truncated","truncationReasons","limits","continuation"]
        if name=="related":
            schema["required"] += ["method","scope"]
        definitions[name+"Result"]=schema
        tool["outputSchema"]={"$schema":"https://json-schema.org/draft/2020-12/schema",**schema,"$defs":definitions}
    # The references resolve inside each outputSchema and the shared schema document.
    schemas={"$schema":"https://json-schema.org/draft/2020-12/schema","$defs":definitions,"operations":{tool["name"]:ref(tool["name"]+"Result") for tool in tools},"error":ref("Error")}
    manifest_schema=obj({"schemaVersion":{"const":2},"apiVersion":string,"snapshotId":string,"snapshotPath":string,"coverage":ref("Coverage"),"database":ref("Database"),"resources":{"type":"object","additionalProperties":obj({"bytes":integer,"sha256":string,"uncompressedBytes":integer,"uncompressedSha256":string},["bytes","sha256"])},"capabilities":{"type":"object"},"venues":{"type":"array"}},["schemaVersion","apiVersion","snapshotId","snapshotPath","coverage","database","resources","capabilities","venues"],True)
    paths={}
    resources=[("/manifest.json","Current snapshot discovery",False), ("/schemas.json","Query output and error schemas",False),("/tools.json","Local MCP input/output schemas",False),("/snapshots/{snapshot}/manifest.json","Pinned snapshot discovery",False),("/snapshots/{snapshot}/search/{venue}.json.gz","Compressed paper search records",True),("/snapshots/{snapshot}/names/{bucket}.json.gz","Exact normalized name to candidate IDs",True),("/snapshots/{snapshot}/authors/{bucket}.json.gz","Researcher profiles and evidenced associations",True),("/snapshots/{snapshot}/author-names.json.gz","Normalized variants for partial name search",True),("/snapshots/{snapshot}/lookup/{bucket}.json.gz","Recorded aliases to canonical IDs",True),("/snapshots/{snapshot}/graph/{bucket}.json.gz","All known nodes and directed citation neighbors",True),("/snapshots/{snapshot}/papertrail.sqlite.gz","Verified indexed relationship database",True)]
    for path,description,zipped in resources:
        params=[]
        for name,rule in [("snapshot",{"type":"string","pattern":"^[0-9a-f]{24}$"}),("bucket",{"type":"string","pattern":"^[0-9a-f]{2}$"}),("venue",{"enum":[v["id"] for v in manifest["venues"]]})]:
            if "{"+name+"}" in path:
                params.append({"name":name,"in":"path","required":True,"schema":rule})
        response_schema={"type":"string","format":"binary"} if zipped else manifest_schema if path.endswith("manifest.json") else {"type":"object"}
        paths[path]={"get":{"summary":description,"parameters":params,"responses":{"200":{"description":"Verify bytes and SHA-256 against the pinned manifest. Gzip payloads are file-compressed JSON/database; servers may also declare HTTP gzip encoding. JSON resources declare both compressed and decoded checksums.","content":{"application/octet-stream" if zipped else "application/json":{"schema":response_schema}}},"404":{"description":"Unknown or unavailable snapshot/resource"}}}}
    openapi={"openapi":"3.1.0","info":{"title":"PaperTrail static resources","version":"2.0.0","description":"GitHub Pages serves files. SDK/MCP operations are local queries, not HTTP search endpoints. See tools.json for callable queries, schemas.json for exact responses; manifest resources declare compressed sizes and checksums. Cache the immutable snapshot for reproducibility."},"servers":[{"url":"https://jimmywuhkust.github.io/papertrail/api/v2"}],"paths":paths,"components":{"schemas":definitions}}
    # OpenAPI uses components refs rather than JSON Schema document refs.
    import json
    openapi=json.loads(json.dumps(openapi).replace('#/$defs/','#/components/schemas/'))
    return {"schemas.json":schemas,"tools.json":{"transport":"local MCP stdio","protocolVersion":"2024-11-05","tools":tools},"openapi.json":openapi}
