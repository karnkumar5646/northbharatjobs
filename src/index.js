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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c])
  );
}

function canonical(base, path) {
  return new URL(path, base).href;
}

async function itemBySlug(env, slug) {
  return env.DB
    .prepare(
      "SELECT * FROM items WHERE slug=? AND status='published' LIMIT 1"
    )
    .bind(slug)
    .first();
}

function jobJsonLd(item, origin) {
  const data = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    "title": item.title,
    "description": item.description || item.title,
    "datePosted": item.date_posted || item.created_at,
    "hiringOrganization": {
      "@type": "Organization",
      "name": item.organization || item.source_name
    },
    "url": canonical(
      origin,
      `/item/${item.slug}`
    )
  };

  if (item.location) {
    data.jobLocation = {
      "@type": "Place",
      "address": {
        "@type": "PostalAddress",
        "addressLocality": item.location
      }
    };
  }

  if (item.last_date) {
    data.validThrough = item.last_date;
  }

  return data;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    /*
     * ----------------------------------------
     * Health
     * ----------------------------------------
     */

    if (path === "/api/health") {
      return json({
        ok: true,
        service: "North Bharat Jobs",
        time: new Date().toISOString()
      });
    }

    /*
     * ----------------------------------------
     * Database check
     * ----------------------------------------
     */

    if (path === "/api/db-check") {
      const r = await env.DB
        .prepare(`
          SELECT
            (SELECT COUNT(*) FROM items) AS item_count,
            (SELECT COUNT(*) FROM sources) AS source_count,
            (SELECT COUNT(*) FROM monitor_runs) AS monitor_run_count
        `)
        .first();

      return json({
        database_binding: "DB",
        item_count: Number(r?.item_count || 0),
        source_count: Number(r?.source_count || 0),
        monitor_run_count: Number(
          r?.monitor_run_count || 0
        )
      });
    }

    /*
     * ----------------------------------------
     * Manual source discovery
     *
     * Example:
     * /api/admin/discover?source=LIC
     *
     * This directly calls:
     * runMonitor(env, "LIC")
     *
     * which selects only the requested source
     * and runs its registered adapter.
     * ----------------------------------------
     */

    if (path === "/api/admin/discover") {
      const sourceName =
        url.searchParams.get("source");

      if (!sourceName) {
        return json(
          {
            ok: false,
            error: "Missing source parameter"
          },
          400
        );
      }

      try {
        const result =
          await runMonitor(
            env,
            sourceName.trim()
          );

        return json({
          ok: true,
          source: sourceName.trim(),
          ...result
        });

      } catch (error) {
        return json(
          {
            ok: false,
            source: sourceName.trim(),
            error: String(
              error?.message || error
            )
          },
          500
        );
      }
    }

    /*
     * ----------------------------------------
     * Automatic monitor
     * ----------------------------------------
     */

    if (path === "/api/monitor") {
      const key =
        request.headers.get(
          "x-monitor-key"
        );

      if (
        !env.MONITOR_KEY ||
        key !== env.MONITOR_KEY
      ) {
        return json(
          {
            error: "Unauthorized"
          },
          401
        );
      }

      return json(
        await runMonitor(env)
      );
    }

    /*
     * ----------------------------------------
     * Section counts
     * ----------------------------------------
     */

    if (path === "/api/sections") {
      const counts = {};

      for (
        const [route, type]
        of Object.entries(SECTION_TYPES)
      ) {
        const r =
          await env.DB
            .prepare(`
              SELECT COUNT(*) c
              FROM items
              WHERE type=?
                AND status='published'
            `)
            .bind(type)
            .first();

        counts[route] =
          Number(r?.c || 0);
      }

      return json(counts);
    }

    /*
     * ----------------------------------------
     * Items API
     * ----------------------------------------
     */

    if (path === "/api/items") {
      const type =
        url.searchParams.get("type");

      const q =
        url.searchParams.get("q");

      const limit = Math.min(
        Number(
          url.searchParams.get("limit") || 50
        ),
        100
      );

      let query =
        "SELECT * FROM items WHERE status='published'";

      const binds = [];

      if (
        type &&
        Object.values(SECTION_TYPES)
          .includes(type)
      ) {
        query += " AND type=?";
        binds.push(type);
      }

      if (q) {
        query += `
          AND (
            title LIKE ?
            OR organization LIKE ?
            OR qualification LIKE ?
          )
        `;

        const x = `%${q}%`;

        binds.push(
          x,
          x,
          x
        );
      }

      query += `
        ORDER BY
          COALESCE(
            published_at,
            created_at
          ) DESC
        LIMIT ?
      `;

      binds.push(limit);

      const r =
        await env.DB
          .prepare(query)
          .bind(...binds)
          .all();

      return json(
        r.results || []
      );
    }

    /*
     * ----------------------------------------
     * Single item API
     * ----------------------------------------
     */

    if (path.startsWith("/api/item/")) {
      const slug =
        decodeURIComponent(
          path.slice(
            "/api/item/".length
          )
        );

      const item =
        await itemBySlug(
          env,
          slug
        );

      return item
        ? json(item)
        : json(
            {
              error: "Not found"
            },
            404
          );
    }

    /*
     * ----------------------------------------
     * Sitemap
     * ----------------------------------------
     */

    if (path === "/sitemap.xml") {
      const origin = url.origin;

      const r =
        await env.DB
          .prepare(`
            SELECT
              slug,
              updated_at
            FROM items
            WHERE status='published'
            ORDER BY updated_at DESC
            LIMIT 50000
          `)
          .all();

      const urls =
        (r.results || [])
          .map(
            x =>
              `<url><loc>${esc(
                canonical(
                  origin,
                  `/item/${x.slug}`
                )
              )}</loc><lastmod>${esc(
                x.updated_at
              )}</lastmod></url>`
          )
          .join("");

      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
        urls +
        `</urlset>`,
        {
          headers: {
            "content-type":
              "application/xml;charset=UTF-8"
          }
        }
      );
    }

    /*
     * ----------------------------------------
     * Robots
     * ----------------------------------------
     */

    if (path === "/robots.txt") {
      return new Response(
        `User-agent: *\n` +
        `Allow: /\n` +
        `Disallow: /api/\n` +
        `Sitemap: ${url.origin}/sitemap.xml\n`,
        {
          headers: {
            "content-type":
              "text/plain;charset=UTF-8"
          }
        }
      );
    }

    /*
     * ----------------------------------------
     * Public item page
     * ----------------------------------------
     */

    if (path.startsWith("/item/")) {
      const slug =
        decodeURIComponent(
          path.slice(
            "/item/".length
          )
        );

      const item =
        await itemBySlug(
          env,
          slug
        );

      if (!item) {
        return new Response(
          "Not found",
          {
            status: 404
          }
        );
      }

      const html =
        `<!doctype html>` +
        `<html lang="en">` +
        `<head>` +
        `<meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${esc(item.title)} | North Bharat Jobs</title>` +
        `<meta name="description" content="${esc(
          (item.description || item.title)
            .slice(0, 155)
        )}">` +
        `<link rel="canonical" href="${esc(
          canonical(
            url.origin,
            path
          )
        )}">` +
        `<script type="application/ld+json">${JSON.stringify(
          jobJsonLd(
            item,
            url.origin
          )
        )}</script>` +
        `<link rel="stylesheet" href="/style.css">` +
        `</head>` +
        `<body>` +
        `<header class="top">` +
        `<a class="brand" href="/">🇮🇳 North Bharat Jobs</a>` +
        `<a href="/">Home</a>` +
        `</header>` +
        `<main class="container">` +
        `<article class="detail">` +
        `<span class="badge">✓ Official-source verified</span>` +
        `<h1>${esc(item.title)}</h1>` +
        `<p class="muted">${esc(
          item.organization ||
          "Government Recruitment"
        )}</p>` +
        `<section class="section">` +
        `<h2>Overview</h2>` +
        `<div class="grid">` +
        [["Category", item.type], ["Organization", item.organization], ["Location", item.location],
          ["Qualification", item.qualification], ["Vacancies", item.vacancies], ["Age Limit", item.age_limit],
          ["Age Relaxation", item.age_relaxation], ["Application Fee", item.fee], ["Application Start", item.application_start],
          ["Last Date", item.last_date], ["Exam Date", item.exam_date], ["Selection Process", item.selection_process],
          ["Salary / Pay Scale", item.salary]]
          .map(([k,v]) => v ? `<div class="info"><b>${esc(k)}</b><span>${esc(v)}</span></div>` : "")
          .join("") +
        `</div></section>` +
        `<section class="section"><h2>Eligibility & Job Requirements</h2>` +
        `<div class="text-block">${esc(item.eligibility || item.qualification || "Not specified in the verified source.")}</div></section>` +
        `<section class="section"><h2>Important Dates</h2>` +
        `<div class="text-block">${esc(item.important_dates || "Not specified in the verified source.")}</div></section>` +
        `<section class="section"><h2>How to Apply</h2>` +
        `<div class="text-block">${esc(item.how_to_apply || "Use the official Apply Online link and follow the official notification instructions.")}</div></section>` +
        `<section class="section"><h2>Verified Information</h2>` +
        `<p class="muted">Verification: ${esc(item.verification_status || "unverified")} · Last verified: ${esc(item.last_verified_at || "Not available")}</p></section>` +
        `<div class="actions">` +
        `<a class="btn" href="${esc(
          item.official_url
        )}" target="_blank" rel="noopener nofollow">` +
        `Official Website</a>` +
        (
          item.notification_url
            ? `<a class="btn secondary" href="${esc(
                item.notification_url
              )}" target="_blank" rel="noopener nofollow">` +
              `Official Notification PDF</a>`
            : ""
        ) +
        (
          item.apply_url
            ? `<a class="btn green" href="${esc(
                item.apply_url
              )}" target="_blank" rel="noopener nofollow">` +
              `Apply Online</a>`
            : ""
        ) +
        `</div>` +
        `<p class="source">` +
        `Source: <a href="${esc(
          item.source_url
        )}" target="_blank" rel="noopener">` +
        `${esc(item.source_name)}</a>` +
        `<br>` +
        `Last verified: ${esc(
          item.last_verified_at
        )}` +
        `</p>` +
        `</article>` +
        `</main>` +
        `</body>` +
        `</html>`;

      return new Response(
        html,
        {
          headers: {
            "content-type":
              "text/html;charset=UTF-8"
          }
        }
      );
    }

    /*
     * ----------------------------------------
     * Frontend assets / homepage
     * ----------------------------------------
     */

    return env.ASSETS.fetch(request);
  },

  /*
   * ----------------------------------------
   * Scheduled monitor
   * ----------------------------------------
   */

  async scheduled(
    controller,
    env,
    ctx
  ) {
    ctx.waitUntil(
      runMonitor(env)
    );
  }
};
