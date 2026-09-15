import { runMonitor } from "./monitor.js";

const SECTION_TYPES = {
  jobs: "job",
  "admit-card": "admit_card",
  results: "result",
  "answer-key": "answer_key",
  syllabus: "syllabus",
  admission: "admission",
  scholarship: "scholarship",
  updates: "update"
};

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function canonical(base, path) {
  return new URL(path, base).href;
}

async function itemBySlug(env, slug) {
  return env.DB.prepare("SELECT * FROM items WHERE slug=? AND status='published' LIMIT 1").bind(slug).first();
}

function jobJsonLd(item, origin) {
  const data = {
    "@context":"https://schema.org",
    "@type":"JobPosting",
    "title":item.title,
    "description":item.description || item.title,
    "datePosted":item.date_posted || item.created_at,
    "hiringOrganization":{"@type":"Organization","name":item.organization || item.source_name},
    "url":canonical(origin, `/item/${item.slug}`)
  };
  if (item.location) data.jobLocation = {"@type":"Place","address":{"@type":"PostalAddress","addressLocality":item.location}};
  if (item.last_date) data.validThrough = item.last_date;
  return data;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health") return json({ok:true,service:"North Bharat Jobs",time:new Date().toISOString()});

    if (path === "/api/monitor") {
      const key = request.headers.get("x-monitor-key");
      if (!env.MONITOR_KEY || key !== env.MONITOR_KEY) return json({error:"Unauthorized"},401);
      return json(await runMonitor(env));
    }

    if (path === "/api/sections") {
      const counts = {};
      for (const [route,type] of Object.entries(SECTION_TYPES)) {
        const r = await env.DB.prepare("SELECT COUNT(*) c FROM items WHERE type=? AND status='published'").bind(type).first();
        counts[route] = Number(r?.c || 0);
      }
      return json(counts);
    }

    if (path === "/api/items") {
      const type = url.searchParams.get("type");
      const q = url.searchParams.get("q");
      const limit = Math.min(Number(url.searchParams.get("limit")||50),100);
      let query = "SELECT * FROM items WHERE status='published'";
      const binds = [];
      if (type && Object.values(SECTION_TYPES).includes(type)) { query += " AND type=?"; binds.push(type); }
      if (q) { query += " AND (title LIKE ? OR organization LIKE ? OR qualification LIKE ?)"; const x=`%${q}%`; binds.push(x,x,x); }
      query += " ORDER BY COALESCE(published_at,created_at) DESC LIMIT ?";
      binds.push(limit);
      const r = await env.DB.prepare(query).bind(...binds).all();
      return json(r.results||[]);
    }

    if (path.startsWith("/api/item/")) {
      const slug = decodeURIComponent(path.slice("/api/item/".length));
      const item = await itemBySlug(env, slug);
      return item ? json(item) : json({error:"Not found"},404);
    }

    if (path === "/sitemap.xml") {
      const origin = url.origin;
      const r = await env.DB.prepare("SELECT slug,updated_at FROM items WHERE status='published' ORDER BY updated_at DESC LIMIT 50000").all();
      const urls = (r.results||[]).map(x =>
        `<url><loc>${esc(canonical(origin,`/item/${x.slug}`))}</loc><lastmod>${esc(x.updated_at)}</lastmod></url>`
      ).join("");
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
        headers: {"content-type":"application/xml;charset=UTF-8"}
      });
    }

    if (path === "/robots.txt") {
      return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${url.origin}/sitemap.xml\n`, {
        headers: {"content-type":"text/plain;charset=UTF-8"}
      });
    }

    if (path.startsWith("/item/")) {
      const slug = decodeURIComponent(path.slice("/item/".length));
      const item = await itemBySlug(env, slug);
      if (!item) return new Response("Not found",{status:404});
      const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(item.title)} | North Bharat Jobs</title>
<meta name="description" content="${esc((item.description||item.title).slice(0,155))}">
<link rel="canonical" href="${esc(canonical(url.origin,path))}">
<script type="application/ld+json">${JSON.stringify(jobJsonLd(item,url.origin))}</script>
<link rel="stylesheet" href="/style.css"></head><body>
<header class="top"><a class="brand" href="/">🇮🇳 North Bharat Jobs</a><a href="/">Home</a></header>
<main class="container"><article class="detail"><span class="badge">✓ Official-source verified</span>
<h1>${esc(item.title)}</h1><p class="muted">${esc(item.organization||"Government Recruitment")}</p>
<div class="grid">${[
["Category",item.type],["Qualification",item.qualification],["Vacancies",item.vacancies],
["Age Limit",item.age_limit],["Fee",item.fee],["Selection",item.selection_process],
["Salary",item.salary],["Application Start",item.application_start],["Last Date",item.last_date],
["Exam Date",item.exam_date]
].map(([k,v])=>`<div class="info"><b>${esc(k)}</b><span>${esc(v||"See Official Notification")}</span></div>`).join("")}</div>
<p>${esc(item.description||"See the official source for the complete notification.")}</p>
<div class="actions"><a class="btn" href="${esc(item.official_url)}" target="_blank" rel="noopener nofollow">Official Website</a>
${item.notification_url?`<a class="btn secondary" href="${esc(item.notification_url)}" target="_blank" rel="noopener nofollow">Official Notification PDF</a>`:""}
${item.apply_url?`<a class="btn green" href="${esc(item.apply_url)}" target="_blank" rel="noopener nofollow">Apply Online</a>`:""}</div>
<p class="source">Source: <a href="${esc(item.source_url)}" target="_blank" rel="noopener">${esc(item.source_name)}</a><br>Last verified: ${esc(item.last_verified_at)}</p>
</article></main></body></html>`;
      return new Response(html,{headers:{"content-type":"text/html;charset=UTF-8"}});
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runMonitor(env));
  }
};
