"""Build both offline manuals from the four authoring chapters."""
import hashlib
import html
import json
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "guide"
OUTPUT = ROOT / "guide-package"
TITLE = "世界状态使用手册"
SUMMARY = "从角色追查天气，在剧情发生时组合多个来源的状态与演出。"
REVISION = "beta.1"
CHAPTERS = ["data", "story", "providers", "verification"]

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def main():
    manifest = json.loads((ROOT/"extension.json").read_text(encoding="utf8"))
    version, plugin = manifest["version"], manifest["id"]
    docs = []
    for section in CHAPTERS:
        content = (SOURCE/"references"/(section+".md")).read_text(encoding="utf8")
        heading, body = content.split("\n",1)
        docs.append({"id":section,"title":heading[2:],"html":markdown.markdown(body,extensions=["fenced_code","tables"])})
    meta = dict(section="skills", id=plugin, version=version, revision=REVISION, title=TITLE, summary=SUMMARY)
    uid = sha(json.dumps([meta[k] for k in ["section","id","version","revision"]],ensure_ascii=False).encode())[:16]
    item = dict(meta, uid="ext-"+uid,status="available",documents=docs,
                navigation={"start":"data","intro":SUMMARY,"groups":[{"title":"作品编写","documents":["data","story"]},{"title":"工程接入","documents":["providers","verification"]}]})
    files = {p.relative_to(SOURCE).as_posix():sha(p.read_bytes()) for p in sorted(SOURCE.rglob("*")) if p.is_file()}
    declaration={"schema":1,"kind":"letsgal-package-registration","package_type":"plugin-guide","id":plugin,"enabled":True,
                 "show_when_paused":False,"selection_mode":"auto","selected_version":None,"versions":{version:{
                     "root":f"plugins/{plugin}/{version}","entry":"SKILL.md","revision":REVISION,"title":TITLE,"summary":SUMMARY,
                     "section":"skills","files":files,"wiki_library":{"schema":1,"kind":"letsgal-wiki-library","items":[item]}}}}
    OUTPUT.mkdir(exist_ok=True)
    (OUTPUT/"registration.json").write_text(json.dumps(declaration,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    nav = "".join(f'<a href="#{d["id"]}">{html.escape(d["title"])}</a>' for d in docs)
    contents = "".join(f'<article id="{d["id"]}"><h2>{html.escape(d["title"])}</h2>{d["html"]}</article>' for d in docs)
    template = (ROOT/"guide-tools"/"manual.template.html").read_text(encoding="utf8")
    (OUTPUT/"index.html").write_text(template.replace("{{nav}}",nav).replace("{{chapters}}",contents),encoding="utf8")

if __name__=="__main__":
    main()
