/*
  North Bharat Jobs
  Conservative official-source discovery engine.

  Rules:
  - Never invent URLs.
  - Only official/allowed domains are accepted.
  - PDF is notification_url, not official_url.
  - Apply URL must be a real non-PDF official URL.
  - Recruitment jobs require three distinct official URLs.
  - Network requests are deliberately limited for Cloudflare Workers.
*/

const COMMON_KEYWORDS = {
  job: [
    "recruitment",
    "recruitment notice",
    "recruitment notification",
    "vacancy",
    "vacancies",
    "advertisement",
    "employment",
    "career",
    "job",
    "post",
    "posts",
    "engagement",
    "selection post",
    "direct recruitment"
  ],

  admit_card: [
    "admit card",
    "admit-card",
    "hall ticket",
    "call letter",
    "download admit"
  ],

  result: [
    "result",
    "results",
    "score card",
    "scorecard",
    "merit list",
    "selection list",
    "final result"
  ],

  answer_key: [
    "answer key",
    "answer-key",
    "provisional key",
    "final key"
  ],

  syllabus: [
    "syllabus",
    "exam pattern",
    "scheme of examination"
  ],

  admission: [
    "admission",
    "entrance",
    "entrance examination",
    "application"
  ],

  scholarship: [
    "scholarship",
    "fellowship"
  ],

  update: [
    "corrigendum",
    "important notice",
    "notice",
    "exam date",
    "city intimation",
    "correction",
    "schedule",
    "latest update"
  ]
};

const APPLY_WORDS = [
  "apply online",
  "apply now",
  "online application",
  "application form",
  "application portal",
  "apply",
  "registration",
  "register online",
  "online registration",
  "candidate registration",
  "application link",
  "online form"
];

const NOTIFICATION_WORDS = [
  "notification",
  "advertisement",
  "detailed advertisement",
  "official notification",
  "recruitment notice",
  "vacancy notice",
  "employment notice",
  "notification pdf",
  "advertisement pdf",
  "notice pdf"
];

const DISCOVERY_WORDS = [
  ...COMMON_KEYWORDS.job,
  ...COMMON_KEYWORDS.admit_card,
  ...COMMON_KEYWORDS.result,
  ...COMMON_KEYWORDS.answer_key,
  ...COMMON_KEYWORDS.syllabus,
  ...COMMON_KEYWORDS.admission,
  ...COMMON_KEYWORDS.scholarship,
  ...COMMON_KEYWORDS.update
];

/*
 * Keep network usage conservative.
 *
 * One source normally needs:
 *   1 request for the source homepage
 *   + at most 2 candidate-page requests
 *
 * This keeps the monitor comfortably below the Workers
 * external-subrequest limit when several sources run together.
 */
const SOURCE_PAGE_LIMIT = 1;
const CANDIDATE_PAGE_LIMIT = 2;
const LINK_LIMIT = 80;
const CANDIDATE_LIMIT = 8;

function abs(base, href) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function domainAllowed(url, allowedDomains = "") {
  const host = hostOf(url);

  if (!host) return false;

  return String(allowedDomains)
    .split(";")
    .map(x => x.trim().toLowerCase())
    .filter(Boolean)
    .some(domain =>
      host === domain ||
      host.endsWith("." + domain)
    );
}

function isPdf(url, text = "") {
  return (
    /\.pdf(?:$|[?#])/i.test(url || "") ||
    /\bpdf\b/i.test(text || "")
  );
}

function sameUrl(a, b) {
  if (!a || !b) return false;

  try {
    const ua = new URL(a);
    const ub = new URL(b);

    ua.hash = "";
    ub.hash = "";

    return ua.href === ub.href;
  } catch {
    return a === b;
  }
}

function scoreText(text, words) {
  const value = clean(text).toLowerCase();

  return words.reduce(
    (score, word) =>
      score + (value.includes(word.toLowerCase()) ? 1 : 0),
    0
  );
}

function classify(text) {
  const value = clean(text).toLowerCase();

  const orderedTypes = [
    "job",
    "admit_card",
    "answer_key",
    "result",
    "syllabus",
    "admission",
    "scholarship",
    "update"
  ];

  for (const type of orderedTypes) {
    if (
      COMMON_KEYWORDS[type].some(word =>
        value.includes(word.toLowerCase())
      )
    ) {
      return type;
    }
  }

  return null;
}

function extractTitle(html) {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(
    html || ""
  );

  if (!titleMatch) return "";

  return clean(
    titleMatch[1].replace(/<[^>]+>/g, " ")
  );
}

function extractLinks(html, baseUrl, limit = LINK_LIMIT) {
  const links = [];
  const seen = new Set();

  /*
   * Standard anchors.
   */
  const anchorRe =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match = anchorRe.exec(html)) &&
    links.length < limit
  ) {
    const url = abs(baseUrl, match[1]);

    const text = clean(
      match[2].replace(/<[^>]+>/g, " ")
    );

    if (!url) continue;

    const normalized = url.split("#")[0];

    if (seen.has(normalized)) continue;

    seen.add(normalized);

    links.push({
      url: normalized,
      text: text || normalized
    });
  }

  /*
   * Form actions can expose application portals.
   */
  const formRe =
    /<form\b[^>]*action=["']([^"']+)["'][^>]*>/gi;

  while (
    (match = formRe.exec(html)) &&
    links.length < limit
  ) {
    const url = abs(baseUrl, match[1]);

    if (!url) continue;

    const normalized = url.split("#")[0];

    if (seen.has(normalized)) continue;

    seen.add(normalized);

    links.push({
      url: normalized,
      text: "online application form"
    });
  }

  /*
   * Explicit data URL attributes.
   */
  const urlRe =
    /(?:data-href|data-url|data-link)=["']([^"']+)["']/gi;

  while (
    (match = urlRe.exec(html)) &&
    links.length < limit
  ) {
    const url = abs(baseUrl, match[1]);

    if (!url) continue;

    const normalized = url.split("#")[0];

    if (seen.has(normalized)) continue;

    seen.add(normalized);

    links.push({
      url: normalized,
      text: normalized
    });
  }

  return links;
}

function buildCandidate(link, source) {
  if (!link?.url) return null;

  if (!domainAllowed(link.url, source.allowed_domains)) {
    return null;
  }

  /*
   * A PDF can never be the official_url.
   */
  if (isPdf(link.url, link.text)) {
    return null;
  }

  const type = classify(
    `${link.text} ${link.url}`
  );

  if (!type) return null;

  const title =
    clean(link.text) ||
    clean(extractTitle("")) ||
    "Government Update";

  return {
    type,
    title: title.slice(0, 300),
    organization: source.name,
    official_url: link.url,
    source_url: link.url,
    source_name: source.name,
    description: title.slice(0, 500)
  };
}

function chooseNotification(links, source, officialUrl) {
  return links
    .filter(link =>
      domainAllowed(link.url, source.allowed_domains)
    )
    .filter(link =>
      isPdf(link.url, link.text)
    )
    .filter(link =>
      !sameUrl(link.url, officialUrl)
    )
    .map(link => ({
      ...link,
      score: scoreText(
        `${link.text} ${link.url}`,
        NOTIFICATION_WORDS
      )
    }))
    .filter(link => link.score > 0)
    .sort((a, b) => b.score - a.score)
    .find(link => link.score > 0)?.url || null;
}

function chooseApply(links, source, officialUrl, notificationUrl) {
  return links
    .filter(link =>
      domainAllowed(link.url, source.allowed_domains)
    )
    .filter(link =>
      !isPdf(link.url, link.text)
    )
    .filter(link =>
      !sameUrl(link.url, officialUrl)
    )
    .filter(link =>
      !sameUrl(link.url, notificationUrl)
    )
    .map(link => ({
      ...link,
      score: scoreText(
        `${link.text} ${link.url}`,
        APPLY_WORDS
      )
    }))
    .filter(link => link.score > 0)
    .sort((a, b) => b.score - a.score)
    .find(link => link.score > 0)?.url || null;
}

function enrichCandidate(candidate, links, source) {
  if (!candidate) return null;

  /*
   * Non-job sections do not require the three-link
   * recruitment structure.
   */
  if (candidate.type !== "job") {
    return {
      ...candidate,
      notification_url: null,
      apply_url: null
    };
  }

  const notificationUrl = chooseNotification(
    links,
    source,
    candidate.official_url
  );

  const applyUrl = chooseApply(
    links,
    source,
    candidate.official_url,
    notificationUrl
  );

  /*
   * Recruitment jobs are published only when all
   * three roles are available and distinct.
   */
  if (
    !notificationUrl ||
    !applyUrl ||
    sameUrl(candidate.official_url, notificationUrl) ||
    sameUrl(candidate.official_url, applyUrl) ||
    sameUrl(notificationUrl, applyUrl)
  ) {
    return null;
  }

  return {
    ...candidate,
    notification_url: notificationUrl,
    apply_url: applyUrl
  };
}

async function fetchHtml(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "NorthBharatJobsBot/1.0 (+official-source-monitor)",
        "Accept":
          "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        html: ""
      };
    }

    const contentType =
      response.headers.get("content-type") || "";

    /*
     * We only parse HTML.
     */
    if (
      !/text\/html|application\/xhtml\+xml/i.test(
        contentType
      )
    ) {
      return {
        ok: false,
        status: response.status,
        html: ""
      };
    }

    const html = await response.text();

    return {
      ok: true,
      status: response.status,
      html
    };
  } catch {
    return {
      ok: false,
      status: 0,
      html: ""
    };
  }
}

function candidateLinksFromPage(html, pageUrl, source) {
  const links = extractLinks(
    html,
    pageUrl,
    LINK_LIMIT
  );

  return links
    .filter(link =>
      domainAllowed(
        link.url,
        source.allowed_domains
      )
    )
    .filter(link =>
      !isPdf(link.url, link.text)
    )
    .filter(link =>
      scoreText(
        `${link.text} ${link.url}`,
        DISCOVERY_WORDS
      ) > 0
    )
    .map(link =>
      buildCandidate(link, source)
    )
    .filter(Boolean);
}

async function discoverFromSource(source) {
  if (!source?.base_url) return [];

  if (
    !domainAllowed(
      source.base_url,
      source.allowed_domains
    )
  ) {
    return [];
  }

  const discovered = [];
  const seenOfficial = new Set();

  /*
   * One source homepage request.
   */
  const homepage = await fetchHtml(source.base_url);

  if (!homepage.ok) {
    return [];
  }

  const homepageLinks = extractLinks(
    homepage.html,
    source.base_url,
    LINK_LIMIT
  );

  /*
   * Direct candidates from the homepage.
   */
  for (const link of homepageLinks) {
    const candidate = buildCandidate(
      link,
      source
    );

    if (!candidate) continue;

    if (seenOfficial.has(candidate.official_url)) {
      continue;
    }

    seenOfficial.add(candidate.official_url);

    discovered.push({
      candidate,
      pageHtml: null,
      pageUrl: candidate.official_url
    });

    if (discovered.length >= CANDIDATE_LIMIT) {
      break;
    }
  }

  /*
   * If the homepage itself does not expose enough
   * useful details, inspect at most two candidate pages.
   */
  let inspectedPages = 0;

  for (
    const entry of discovered.slice(
      0,
      CANDIDATE_PAGE_LIMIT
    )
  ) {
    if (
      inspectedPages >= CANDIDATE_PAGE_LIMIT
    ) {
      break;
    }

    /*
     * The homepage may already have enough links.
     * Still inspect only a small number of pages
     * so that application/notification URLs can be
     * found without excessive Worker requests.
     */
    const page = await fetchHtml(
      entry.pageUrl
    );

    inspectedPages++;

    if (!page.ok) continue;

    entry.pageHtml = page.html;
  }

  const results = [];

  for (const entry of discovered) {
    let links = homepageLinks;

    if (entry.pageHtml) {
      const pageLinks = extractLinks(
        entry.pageHtml,
        entry.pageUrl,
        LINK_LIMIT
      );

      links = [
        ...homepageLinks,
        ...pageLinks
      ];
    }

    /*
     * Deduplicate combined links.
     */
    const uniqueLinks = [];
    const seen = new Set();

    for (const link of links) {
      if (!link?.url) continue;

      const normalized = link.url.split("#")[0];

      if (seen.has(normalized)) continue;

      seen.add(normalized);

      uniqueLinks.push({
        ...link,
        url: normalized
      });
    }

    /*
     * Use the candidate's own page title when available.
     */
    let title = entry.candidate.title;

    if (entry.pageHtml) {
      const pageTitle =
        extractTitle(entry.pageHtml);

      if (
        pageTitle &&
        pageTitle.length >= 8
      ) {
        title = pageTitle.slice(0, 300);
      }
    }

    const candidate = {
      ...entry.candidate,
      title
    };

    const enriched = enrichCandidate(
      candidate,
      uniqueLinks,
      source
    );

    if (!enriched) continue;

    results.push(enriched);

    if (results.length >= CANDIDATE_LIMIT) {
      break;
    }
  }

  return results;
}

/*
 * Adapter registry.
 *
 * IMPORTANT:
 * monitor.js imports this exact named export:
 *
 *   import { adapters } from "./sources.js";
 *
 * Every adapter receives the source row from D1.
 */
export const adapters = {
  generic: discoverFromSource,

  /*
   * Official-source aliases.
   *
   * These deliberately use the same conservative discovery
   * engine unless a source later needs a specialized parser.
   */
  ssc: discoverFromSource,
  upsc: discoverFromSource,
  "upsc-online": discoverFromSource,
  ncs: discoverFromSource,
  rrb: discoverFromSource,
  railway: discoverFromSource,
  "railway-recruitment-boards": discoverFromSource,
  "india-post": discoverFromSource,
  ibps: discoverFromSource,
  sbi: discoverFromSource,
  rbi: discoverFromSource,
  bpsc: discoverFromSource,
  bssc: discoverFromSource,
  "bihar-police": discoverFromSource,
  "indian-army": discoverFromSource,
  "indian-navy": discoverFromSource,
  "indian-air-force": discoverFromSource,
  drdo: discoverFromSource,
  isro: discoverFromSource,
  lic: discoverFromSource,
  epfo: discoverFromSource,
  esic: discoverFromSource,
  nta: discoverFromSource
};
