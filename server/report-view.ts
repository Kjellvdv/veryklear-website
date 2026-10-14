import { RANGES, TABS, type Report, type TabId } from "./report-types";

// ---- small pieces -----------------------------------------------------------

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const nf = new Intl.NumberFormat("en-GB");
const n = (v: number) => nf.format(v);
const pct = (part: number, whole: number) =>
  whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`;

/** Seconds as m:ss, or h:mm:ss past an hour. */
function clock(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

const REASONS: Record<string, { label: string; why: string }> = {
  bot: {
    label: "Announced crawlers and tools",
    why: "The user agent says it is a bot, a script or a link checker, or there is none.",
  },
  "not-a-browser": {
    label: "Pretends to be a browser",
    why: "Claims a recent Chrome, Firefox or Safari but sends none of the headers those browsers send.",
  },
  "no-language": {
    label: "No browser language",
    why: "Every real browser sends a language. A script that borrowed browser headers often forgets it.",
  },
  datacenter: {
    label: "From a cloud or hosting network",
    why: "The address belongs to a data centre, where scanners and crawlers run and people don't browse.",
  },
};

// ---- charts: plain HTML and CSS, so the strict page policy stays as it is ------

/** Vertical bars. `back` is drawn behind `front` in a lighter tone. */
function columns(
  items: { label: string; front: number; back?: number }[],
  opts: { height?: number; unit: string; frontName: string; backName?: string; ticks?: string[] },
): string {
  const peak = Math.max(1, ...items.map((i) => Math.max(i.front, i.back ?? 0)));
  const bars = items
    .map((i) => {
      const outer = Math.max(i.back ?? i.front, i.front);
      const h = Math.round((outer / peak) * 100);
      const inner = outer === 0 ? 0 : Math.round((i.front / outer) * 100);
      const tip = opts.backName
        ? `${i.label}: ${i.front} ${opts.frontName}, ${i.back ?? 0} ${opts.backName}`
        : `${i.label}: ${i.front} ${opts.frontName}`;
      return `<i style="height:${h}%" title="${esc(tip)}"><b style="height:${inner}%"></b></i>`;
    })
    .join("");
  const ticks = (opts.ticks ?? []).map((t) => `<span>${esc(t)}</span>`).join("");
  return `<div class="chart" role="img" aria-label="${esc(opts.unit)}" style="--h:${opts.height ?? 140}px">
<div class="peak">${n(peak)}</div>
<div class="cols">${bars}</div>
<div class="ticks">${ticks}</div>
</div>`;
}

/** A column chart where each column is stacked from several named parts. */
function stacked(
  items: { label: string; parts: { key: string; value: number }[] }[],
  keys: string[],
  ticks: string[],
): string {
  const totals = items.map((i) => i.parts.reduce((s, p) => s + p.value, 0));
  const peak = Math.max(1, ...totals);
  const cols = items
    .map((item, idx) => {
      const total = totals[idx] ?? 0;
      const segs = keys
        .map((k) => {
          const v = item.parts.find((p) => p.key === k)?.value ?? 0;
          return v === 0
            ? ""
            : `<b style="height:${(v / Math.max(total, 1)) * 100}%;background:var(--k-${esc(k)})"></b>`;
        })
        .join("");
      const tip = `${item.label}: ${keys.map((k) => `${item.parts.find((p) => p.key === k)?.value ?? 0} ${REASONS[k]?.label ?? k}`).join(", ")}`;
      return `<i style="height:${Math.round((total / peak) * 100)}%" title="${esc(tip)}">${segs}</i>`;
    })
    .join("");
  return `<div class="chart stack" role="img" aria-label="Left out per day" style="--h:140px">
<div class="peak">${n(peak)}</div>
<div class="cols">${cols}</div>
<div class="ticks">${ticks.map((t) => `<span>${esc(t)}</span>`).join("")}</div>
</div>`;
}

function legend(keys: string[]): string {
  return `<p class="legend">${keys
    .map((k) => `<span><i class="k-${esc(k)}"></i>${esc(REASONS[k]?.label ?? k)}</span>`)
    .join("")}</p>`;
}

/**
 * A table whose number column also carries a bar scaled to the column's largest
 * value, so a glance shows the proportions before the digits are read.
 */
function table(
  head: string[],
  rows: (string | number)[][],
  opts: { numeric?: number[]; bar?: number } = {},
): string {
  if (rows.length === 0) return `<p class="empty">Nothing yet.</p>`;
  const numeric = opts.numeric ?? [];
  const barCol = opts.bar;
  const peak =
    barCol === undefined
      ? 1
      : Math.max(1, ...rows.map((r) => Number(String(r[barCol] ?? 0).replace(/[^\d.]/g, "")) || 0));
  const cell = (tag: string, v: string | number, i: number, row?: (string | number)[]) => {
    const cls = [numeric.includes(i) ? "n" : "", i === barCol && tag === "td" ? "b" : ""]
      .filter(Boolean)
      .join(" ");
    const w =
      i === barCol && tag === "td" && row
        ? ` style="--w:${Math.round(((Number(String(v).replace(/[^\d.]/g, "")) || 0) / peak) * 100)}%"`
        : "";
    return `<${tag}${cls ? ` class="${cls}"` : ""}${w}>${v}</${tag}>`;
  };
  return `<div class="scroll"><table><thead><tr>${head.map((h, i) => cell("th", esc(h), i)).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((v, i) => cell("td", v, i, r)).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

function section(title: string, hint: string, body: string): string {
  return `<section><h2>${esc(title)}</h2><p class="hint">${esc(hint)}</p>${body}</section>`;
}

/** A change against the previous window, as a small coloured line under a figure. */
function delta(now: number, before: number | undefined, days: number): string {
  if (before === undefined || before === 0)
    return `<span class="delta">no data yet for the ${days} days before</span>`;
  const change = Math.round(((now - before) / before) * 100);
  const cls = change > 0 ? "up" : change < 0 ? "down" : "";
  const sign = change > 0 ? "+" : "";
  return `<span class="delta ${cls}">${sign}${change}% against the previous ${days} days</span>`;
}

const route = (pages: { path: string; at: number }[], more: boolean, count: number) =>
  pages
    .map((p, i) => esc(p.path) + (i === 0 ? "" : ` <span class="t">+${clock(p.at)}</span>`))
    .join(" &rarr; ") + (more ? ` &rarr; &hellip; <span class="t">${count} pages</span>` : "");

// ---- the tabs -----------------------------------------------------------------

function overview(r: Report): string {
  const prev = r.previous ?? undefined;
  const b = r.behaviour;
  const first = r.daily[0]?.day ?? r.from;
  const last = r.daily[r.daily.length - 1]?.day ?? r.to;
  const pagesTop = r.pages.slice(0, 5);
  const sourcesTop = r.sources.slice(0, 5);

  return `
<div class="cards">
<div class="card"><b>${n(r.totals.visitors)}</b><span>Visitors</span>${delta(r.totals.visitors, prev?.visitors, r.days)}</div>
<div class="card"><b>${n(r.totals.views)}</b><span>Page views</span>${delta(r.totals.views, prev?.views, r.days)}</div>
<div class="card"><b>${n(r.totals.sessions)}</b><span>Sessions</span>${delta(r.totals.sessions, prev?.sessions, r.days)}</div>
<div class="card"><b>${n(b.reached)}</b><span>Sessions that reached contact or booking</span><span class="delta">${pct(b.reached, b.sessions)} of sessions</span></div>
</div>
${section(
  "Visitors per day",
  "The solid bar is people, the pale bar behind it is page views. A visitor is counted once per day.",
  columns(
    r.daily.map((d) => ({ label: d.day, front: d.visitors, back: d.views })),
    {
      unit: "Visitors and page views per day",
      frontName: "visitors",
      backName: "views",
      ticks: [shortDay(first), shortDay(last)],
    },
  ),
)}
<div class="grid2">
${section(
  "Most visited pages",
  "By visitors. The Pages tab has entries, exits and the rest.",
  table(
    ["Page", "Visitors"],
    pagesTop.map((p) => [esc(p.path), p.visitors]),
    { numeric: [1], bar: 1 },
  ),
)}
${section(
  "Where sessions start",
  "A campaign tag wins, then the referring site. The Sources tab has the detail.",
  table(
    ["Source", "Sessions"],
    sourcesTop.map((s) => [esc(s.source), s.sessions]),
    { numeric: [1], bar: 1 },
  ),
)}
</div>
${section(
  "What sessions did",
  "Share of all sessions. One session can count under several lines.",
  behaviourBars(r),
)}`;
}

function behaviourBars(r: Report): string {
  const b = r.behaviour;
  const lines: [string, number][] = [
    ["Opened a second page", b.multiPage],
    ["Looked at a service page", b.service],
    ["Read an article", b.article],
    ["Reached contact or booking", b.reached],
  ];
  if (b.sessions === 0) return `<p class="empty">No sessions yet.</p>`;
  return `<div class="hbars">${lines
    .map(
      ([label, v]) =>
        `<div class="hb"><span class="l">${esc(label)}</span><span class="bar"><i style="width:${Math.round((v / b.sessions) * 100)}%"></i></span><span class="v">${n(v)} <small>${pct(v, b.sessions)}</small></span></div>`,
    )
    .join("")}</div>`;
}

function sources(r: Report): string {
  return `
${section(
  "Which sources lead to contact or booking",
  "Sessions grouped by where they started, with how many of them reached the contact or booking page. A campaign tag counts as the source when there is one.",
  table(
    ["Source", "Type", "Sessions", "Reached contact or booking", "Rate"],
    r.sources.map((s) => [
      esc(s.source),
      s.kind === "campaign" ? "campaign tag" : s.kind === "referrer" ? "referring site" : "direct",
      s.sessions,
      s.reached,
      pct(s.reached, s.sessions),
    ]),
    { numeric: [2, 3, 4], bar: 2 },
  ),
)}
${section(
  "Where visitors come from",
  "The referring site's address, unique visitors per day. Anything that arrives without one is direct: typed addresses, many apps, links in email.",
  table(
    ["Source", "Visitors", "Views"],
    r.referrers.map((x) => [esc(x.source), x.visitors, x.views]),
    { numeric: [1, 2], bar: 1 },
  ),
)}
${section(
  "Campaigns",
  "Links you tagged with utm_source, utm_medium and utm_campaign. A tag survives where a referrer does not, such as the LinkedIn app.",
  table(
    ["Source", "Medium", "Campaign", "Visitors", "Views"],
    r.campaigns.map((c) => [esc(c.source), esc(c.medium), esc(c.campaign), c.visitors, c.views]),
    { numeric: [3, 4], bar: 3 },
  ),
)}`;
}

function pages(r: Report): string {
  return `
${section(
  "Pages",
  "Visitors and views per page. Entries are sessions that began on the page, exits are sessions that ended there. Time on a page is not measured.",
  table(
    ["Page", "Visitors", "Views", "Entries", "Exits"],
    r.pages.map((p) => [esc(p.path), p.visitors, p.views, p.entries, p.exits]),
    { numeric: [1, 2, 3, 4], bar: 1 },
  ),
)}`;
}

function journeys(r: Report): string {
  const f = r.flows;
  const summary =
    f.sessions === 0
      ? "No sessions yet."
      : `${n(f.sessions)} sessions, ${f.pagesPerSession} pages each on average. ${pct(f.singlePage, f.sessions)} saw one page only.`;
  return `
${section("How visitors move through the site", summary, "")}
<div class="grid2">
${section(
  "Most common routes",
  "The first five pages of sessions that opened more than one.",
  table(
    ["Route", "Sessions"],
    f.paths.map((x) => [
      x.pages.map(esc).join(" &rarr; ") + (x.more ? " &rarr; &hellip;" : ""),
      x.sessions,
    ]),
    { numeric: [1], bar: 1 },
  ),
)}
${section(
  "Where they go next",
  "The page opened after another one, across all sessions.",
  table(
    ["From", "To", "Sessions"],
    f.steps.map((x) => [esc(x.from), esc(x.to), x.sessions]),
    { numeric: [2], bar: 2 },
  ),
)}
</div>
${section(
  "Clicks to contact and the booking page, by the page they came from",
  "Which page of ours the visitor was on when they opened contact or booking. A typed address or a link from elsewhere shows as direct.",
  table(
    ["Reached", "From", "Visitors", "Views"],
    r.routes.map((x) => [esc(x.target), esc(x.source), x.visitors, x.views]),
    { numeric: [2, 3], bar: 2 },
  ),
)}
${section(
  "Sessions, one by one",
  `The ${f.recent.length} most recent. Each row is one visitor on one day. Source, language and device are those of the first page; the numbers beside a page are the seconds since the session began.`,
  table(
    ["Started (UTC)", "Route", "Time", "Came from", "Campaign", "Language", "Device"],
    f.recent.map((x) => [
      esc(new Date(x.start).toISOString().slice(0, 16).replace("T", " ")),
      route(x.pages, x.more, x.pageCount),
      x.pageCount === 1 ? "1 page" : clock(x.seconds),
      esc(x.from),
      esc(x.campaign),
      esc(x.lang),
      esc(x.device),
    ]),
  ),
)}`;
}

function audience(r: Report): string {
  const hourTicks = ["0h", "6h", "12h", "18h", "23h"];
  return `
<div class="grid2">
${section(
  "Devices",
  "What the visitor browsed on, from the browser's own description.",
  table(
    ["Device", "Visitors", "Views"],
    r.devices.map((d) => [esc(d.device), d.visitors, d.views]),
    { numeric: [1, 2], bar: 1 },
  ),
)}
${section(
  "Languages",
  "The first language the browser asks for. It hints at who is reading, not where they are.",
  table(
    ["Language", "Visitors", "Views"],
    r.languages.map((l) => [esc(l.lang), l.visitors, l.views]),
    { numeric: [1, 2], bar: 1 },
  ),
)}
</div>
${section(
  "Page views by hour of the day",
  "Belgian time, summer time included.",
  columns(
    r.hours.map((v, h) => ({ label: `${String(h).padStart(2, "0")}:00`, front: v })),
    { unit: "Page views per hour", frontName: "views", ticks: hourTicks, height: 110 },
  ),
)}
${section(
  "Page views by weekday",
  "Belgian time.",
  columns(
    r.weekdays.map((v, i) => ({
      label:
        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i] ?? "",
      front: v,
    })),
    {
      unit: "Page views per weekday",
      frontName: "views",
      ticks: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      height: 110,
    },
  ),
)}`;
}

function quality(r: Report): string {
  const keys = Object.keys(REASONS);
  const first = r.daily[0]?.day ?? r.from;
  const last = r.daily[r.daily.length - 1]?.day ?? r.to;
  const total = r.automated.requests + r.totals.views;
  return `
<div class="cards">
<div class="card"><b>${pct(r.automated.requests, total)}</b><span>of page requests were automated</span><span class="delta">${n(r.automated.requests)} left out, ${n(r.totals.views)} counted</span></div>
</div>
${section(
  "Left out as automated traffic",
  "Requests that reached a real page and were not counted as visitors. Each is kept only as a daily total, with nothing that identifies it.",
  table(
    ["Why it was left out", "How it is recognised", "Requests"],
    r.filtered.map((f) => [
      esc(REASONS[f.reason]?.label ?? f.reason),
      esc(REASONS[f.reason]?.why ?? ""),
      f.requests,
    ]),
    { numeric: [2], bar: 2 },
  ),
)}
${section(
  "Left out per day",
  "The days with the most automated traffic, by reason.",
  stacked(
    r.filteredDaily.map((d) => ({
      label: d.day,
      parts: keys.map((k) => ({ key: k, value: d.reasons[k] ?? 0 })),
    })),
    keys,
    [shortDay(first), shortDay(last)],
  ) + legend(keys),
)}
<details class="notes"><summary>How these numbers are made</summary>
<ul>
<li><b>Visitor.</b> One browser on one day. Nothing identifies a person across days, so someone who comes on three days counts three times. People behind the same address and browser can merge into one.</li>
<li><b>Page view.</b> A real person opening a page. Assets, prefetches, Do Not Track and Global Privacy Control are left out entirely.</li>
<li><b>Session.</b> One visitor's pages on one day, split after 30 minutes without a page. A reload is not a step. The time on the last page is not known.</li>
<li><b>Source.</b> The campaign tag when there is one, else the referring site. Apps and some browsers send neither, so they show as direct.</li>
<li><b>Left out.</b> Counted as totals per reason, without the visitor, page or user agent. Days are UTC; the hour and weekday charts use Belgian time.</li>
</ul></details>`;
}

// ---- page ---------------------------------------------------------------------

const CSS = `
:root{--bg:#fff;--fg:#14110f;--muted:#6d6862;--line:#e7e3dd;--accent:#d6361f;--card:#faf8f5;--bar:#f4d6d0;--back:#ecd5cf;--up:#2f8f4e;--down:#c0392b;
--k-bot:#8a6f64;--k-not-a-browser:#d6361f;--k-no-language:#e0a34a;--k-datacenter:#4f6d8f}
@media (prefers-color-scheme:dark){:root{--bg:#141210;--fg:#f3efe9;--muted:#a39d95;--line:#2c2825;--accent:#ff6b52;--card:#1b1815;--bar:#47241e;--back:#3a2622;--up:#6cc38a;--down:#ff8a7a;
--k-bot:#b79a8e;--k-not-a-browser:#ff6b52;--k-no-language:#f0b95e;--k-datacenter:#7da3cc}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 Inter,system-ui,-apple-system,sans-serif}
main{max-width:1040px;margin:0 auto;padding:28px 16px 64px}
h1{font-size:1.4rem;margin:0 0 4px}
h2{font-size:1.05rem;margin:0 0 2px}
section{margin-top:32px}
p.sub,.hint{margin:0;color:var(--muted)}
.hint{font-size:.88rem;margin:0 0 10px;max-width:70ch}
.top{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 24px;align-items:baseline}
.range{display:flex;gap:6px}
.range a{padding:3px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);text-decoration:none;font-size:.88rem}
.range a.on{color:var(--fg);border-color:var(--accent);font-weight:600}
.tabs{display:flex;gap:2px 6px;margin:18px 0 0;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
.tabs a{white-space:nowrap;padding:9px 14px;color:var(--muted);text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs a.on{color:var(--fg);font-weight:600;border-color:var(--accent)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-top:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.card b{display:block;font-size:1.7rem;line-height:1.2}
.card span{display:block;color:var(--muted);font-size:.85rem}
.card .delta{margin-top:4px;font-size:.8rem}
.up{color:var(--up)!important}.down{color:var(--down)!important}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:0 32px}
.chart{margin-top:6px}
.chart .peak{color:var(--muted);font-size:.78rem;height:1.1em}
.chart .cols{display:flex;align-items:flex-end;gap:2px;height:var(--h);border-bottom:1px solid var(--line);border-top:1px dashed var(--line)}
.chart .cols>i{flex:1;min-width:1px;background:var(--back);border-radius:2px 2px 0 0;display:flex;align-items:flex-end;min-height:1px}
.chart .cols>i>b{display:block;width:100%;background:var(--accent);border-radius:2px 2px 0 0;opacity:.9}
.chart.stack .cols>i{flex-direction:column-reverse;background:none;align-items:stretch}
.chart.stack .cols>i>b{width:100%;border-radius:0;opacity:1}
.ticks{display:flex;justify-content:space-between;color:var(--muted);font-size:.78rem;margin-top:4px}
.legend{display:flex;flex-wrap:wrap;gap:4px 16px;margin:10px 0 0;color:var(--muted);font-size:.85rem}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend i{width:10px;height:10px;border-radius:2px;display:inline-block}
.k-bot{background:var(--k-bot)}.k-not-a-browser{background:var(--k-not-a-browser)}
.k-no-language{background:var(--k-no-language)}.k-datacenter{background:var(--k-datacenter)}
.hbars{display:grid;gap:8px}
.hb{display:grid;grid-template-columns:minmax(150px,230px) 1fr 90px;gap:12px;align-items:center}
.hb .bar{height:12px;background:var(--card);border:1px solid var(--line);border-radius:6px;overflow:hidden}
.hb .bar i{display:block;height:100%;background:var(--accent);opacity:.85}
.hb .v{text-align:right;white-space:nowrap}.hb small{color:var(--muted)}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;word-break:break-word}
th{color:var(--muted);font-weight:500;font-size:.85rem}
td.n,th.n{text-align:right;white-space:nowrap}
td.b{background:linear-gradient(to right,var(--bar) var(--w),transparent var(--w))}
.t{color:var(--muted);font-size:.8rem;margin-left:4px}
.empty{color:var(--muted);padding:12px 0}
.notes{margin-top:36px;color:var(--muted);font-size:.9rem}
.notes summary{cursor:pointer;color:var(--fg)}
.notes li{margin:6px 0}
footer{margin-top:40px;color:var(--muted);font-size:.82rem}
@media (max-width:560px){.hb{grid-template-columns:1fr 70px}.hb .bar{grid-column:1/-1;order:3}}
`;

const BLURBS: Record<TabId, string> = {
  overview:
    "How the site is doing: totals against the period before, the trend, and the top of every list.",
  sources: "Where sessions come from and which of them go on to contact or book.",
  pages: "What gets read, where sessions begin and where they end.",
  journeys: "How people move through the site, route by route and session by session.",
  audience: "What they browse on, what language they use and when they visit.",
  quality: "How much traffic was left out as automated, and why you can trust the rest.",
};

export function renderHtml(r: Report, reportPath: string, tab: TabId = "overview"): string {
  const href = (t: TabId, days = r.days) => `${esc(reportPath)}?tab=${t}&amp;days=${days}`;
  const body = { overview, sources, pages, journeys, audience, quality }[tab](r);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Numbers</title><style>${CSS}</style></head>
<body><main>
<div class="top">
<div><h1>veryklear.com in numbers</h1>
<p class="sub">${esc(r.from)} to ${esc(r.to)}, UTC</p></div>
<nav class="range" aria-label="Range">${RANGES.map(
    (d) => `<a href="${href(tab, d)}"${d === r.days ? ' class="on"' : ""}>${d} days</a>`,
  ).join("")}</nav>
</div>
<nav class="tabs" aria-label="Sections">${TABS.map(
    (t) =>
      `<a href="${href(t.id)}"${t.id === tab ? ' class="on" aria-current="page"' : ""}>${esc(t.label)}</a>`,
  ).join("")}</nav>
<p class="hint" style="margin-top:14px">${esc(BLURBS[tab])}</p>
${body}
<footer>Counted on the server from the page requests browsers make anyway: no script, no cookies. Visitors are per day. Do Not Track and Global Privacy Control are left out entirely. Days are UTC.</footer>
</main></body></html>`;
}
