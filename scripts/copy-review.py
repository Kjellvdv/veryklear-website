"""Write one HTML page with all site copy, for reviewing it in one go.

Reads src/content/copy/*.yaml in site order and shows every text field with its
path, editable. Edits stay in the browser; "Copy changes" puts them on the
clipboard as a list for Claude to write back into the YAML files.

Run with any Python that has PyYAML, e.g. the GTM dashboard's venv:
  <venv>/bin/python scripts/copy-review.py ~/brands/very-klear/site-copy-review.html
"""
import html, sys, datetime
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parent.parent / "src/content/copy"
PAGES = [
    ("home", "/"), ("diensten", "/diensten"), ("dienst-positionering", "/positionering"),
    ("dienst-marketing-strategie", "/marketing-strategie"), ("dienst-ai-implementeren", "/ai"),
    ("fractioneel", "/fractioneel"), ("partners", "/partners"), ("strategiesessie", "/strategiesessie"),
    ("contact", "/contact"), ("artikels", "/artikels"), ("privacy", "/privacy"), ("404", "(404)"),
    ("site", "nav, footer, closing block"),
]
SKIP = {"href", "keys", "booking_url", "booking_embed", "booking_page", "email", "vat_number"}


def leaves(d, path=""):
    if isinstance(d, dict):
        for k, v in d.items():
            if k in SKIP:
                continue
            yield from leaves(v, f"{path}.{k}" if path else str(k))
    elif isinstance(d, list):
        for i, v in enumerate(d):
            yield from leaves(v, f"{path}[{i + 1}]")
    elif isinstance(d, str) and d.strip():
        yield path, d


def main(out):
    sections, nav, total = [], [], 0
    for name, url in PAGES:
        f = ROOT / f"{name}.yaml"
        if not f.exists():
            continue
        rows = []
        for p, text in leaves(yaml.safe_load(f.read_text())):
            total += 1
            rows.append(
                f'<tr><th>{html.escape(p)}</th><td><div class="t" contenteditable="plaintext-only" '
                f'spellcheck="true" lang="nl" data-id="{html.escape(name)}.yaml::{html.escape(p)}">{html.escape(text)}</div></td></tr>')
        nav.append(f'<a href="#{name}">{html.escape(url)}</a>')
        sections.append(
            f'<section id="{name}"><h2>{html.escape(url)} <span>src/content/copy/{name}.yaml</span></h2>'
            f'<table><tbody>{"".join(rows)}</tbody></table></section>')
    today = datetime.date.today().isoformat()
    page = TEMPLATE.replace("{{NAV}}", "".join(nav)).replace("{{SECTIONS}}", "".join(sections)) \
        .replace("{{DATE}}", today).replace("{{TOTAL}}", str(total))
    Path(out).expanduser().write_text(page)
    print(out, total, "texts")


TEMPLATE = """<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site copy review</title>
<style>
:root{--bg:#f7f5f2;--card:#fff;--text:#1f1f1f;--muted:#6b6763;--line:#dedad5;--head:#ece8e3;--edit:#e7f0ff;--red:#c8102e}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--card:#1f1f1f;--text:#ececec;--muted:#a09b95;--line:#3a3a3a;--head:#2a2a2a;--edit:#1d2a40}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,Inter,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header h1{font-size:16px;margin:0 6px 0 0}
nav{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:13px} nav a{color:inherit}
.btns{margin-left:auto;display:flex;gap:8px;align-items:center}
button{font:inherit;font-size:13px;padding:6px 12px;border-radius:7px;border:1px solid var(--line);background:var(--card);color:inherit;cursor:pointer}
#count{font-size:13px;color:var(--muted)}
main{padding:8px 16px 80px;max-width:1100px;margin:0 auto}
.intro{color:var(--muted);max-width:80ch}
h2{font-size:20px;margin:36px 0 10px} h2 span{font-size:12px;color:var(--muted);font-weight:400;margin-left:8px}
table{width:100%;border-collapse:collapse;table-layout:fixed;background:var(--card);border:1px solid var(--line)}
th{width:230px;text-align:left;vertical-align:top;padding:9px 12px;font:12px/1.5 ui-monospace,Menlo,monospace;color:var(--muted);border-bottom:1px solid var(--line);word-break:break-word}
td{border-bottom:1px solid var(--line);border-left:1px solid var(--line);padding:0}
.t{padding:9px 12px;white-space:pre-wrap;outline:none;min-height:22px}
.t:focus{background:var(--edit)} .t.changed{background:var(--edit);box-shadow:inset 3px 0 0 #3b6fd8}
@media (max-width:700px){th{width:120px}}
</style></head><body>
<header><h1>Site copy review</h1><nav>{{NAV}}</nav>
<div class="btns"><span id="count"></span><button id="copy">Copy changes</button><button id="reset">Discard changes</button></div></header>
<main>
<p class="intro">All {{TOTAL}} texts of www.veryklear.com, page by page in site order, built {{DATE}} from src/content/copy/*.yaml (links, slugs and other technical fields left out). Click any text to edit it; changes turn blue and stay in this browser. "Copy changes" puts them on the clipboard, ready to paste to Claude, who writes them into the YAML files. Rebuild with scripts/copy-review.py.</p>
{{SECTIONS}}
</main>
<script>
const KEY='vk-copy-review-{{DATE}}';
let edits={};try{edits=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
const cells=[...document.querySelectorAll('.t')];
cells.forEach(c=>{c.dataset.orig=c.textContent;if(c.dataset.id in edits){c.textContent=edits[c.dataset.id];c.classList.add('changed')}});
function save(){try{localStorage.setItem(KEY,JSON.stringify(edits))}catch(e){};const n=Object.keys(edits).length;document.getElementById('count').textContent=n?n+' changed':''}
cells.forEach(c=>c.addEventListener('input',()=>{const k=c.dataset.id;if(c.textContent===c.dataset.orig){delete edits[k];c.classList.remove('changed')}else{edits[k]=c.textContent;c.classList.add('changed')};save()}));
document.getElementById('copy').onclick=async()=>{const out=Object.entries(edits).map(([k,v])=>{const[f,p]=k.split('::');const orig=document.querySelector('[data-id="'+CSS.escape(k)+'"]').dataset.orig;return '### '+f+' → '+p+'\\nWas: '+orig+'\\nNow: '+v}).join('\\n\\n');if(!out){alert('No changes yet.');return}const msg='Write these site copy edits into src/content/copy:\\n\\n'+out;try{await navigator.clipboard.writeText(msg);alert('Copied '+Object.keys(edits).length+' changes.')}catch(e){prompt('Copy this:',msg)}};
document.getElementById('reset').onclick=()=>{if(!confirm('Discard all edits in this browser?'))return;edits={};cells.forEach(c=>{c.textContent=c.dataset.orig;c.classList.remove('changed')});save()};
save();
</script></body></html>"""

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "site-copy-review.html")
