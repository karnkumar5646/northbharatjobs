/*
  North Bharat Jobs
  Official-source discovery engine

  Rules:
  - Never invent URLs.
  - Only allowed official domains are accepted.
  - PDF links are notification links.
  - Apply links must be real non-PDF links.
  - Recruitment jobs require three distinct official links.
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
    "jobs",
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

const LINK_LIMIT = 80;
const CANDIDATE_LIMIT = 8;
const CANDIDATE_PAGE_LIMIT = 2;

/* ----------------------------- */
/* Basic helpers                  */
/* ----------------------------- */

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
      score +
      (value.includes(word.toLowerCase()) ? 1 : 0),
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
  const match =
    /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(
      html || ""
    );

  if (!match) return "";

  return clean(
    match[1].replace(/<[^>]+>/g, " ")
  );
}

/* ----------------------------- */
/* Link extraction                */
/* ----------------------------- */

function extractLinks(
  html,
  baseUrl,
  limit = LINK_LIMIT
) {
  const links = [];
  const seen = new Set();

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

  const dataUrlRe =
    /(?:data-href|data-url|data-link)=["']([^"']+)["']/gi;

  while (
    (match = dataUrlRe.exec(html)) &&
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

/* ----------------------------- */
/* Candidate creation             */
/* ----------------------------- */

function buildCandidate(link, source) {
  if (!link?.url) return null;

  if (
    !domainAllowed(
      link.url,
      source.allowed_domains
    )
  ) {
    return null;
  }

  if (isPdf(link.url, link.text)) {
    return null;
  }

  const type = classify(
    `${link.text} ${link.url}`
  );

  if (!type) return null;

  const title =
    clean(link.text) ||
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

/* ----------------------------- */
/* Notification selection         */
/* ----------------------------- */

function chooseNotification(
  links,
  source,
  officialUrl
) {
  return links
    .filter(link =>
      domainAllowed(
        link.url,
        source.allowed_domains
      )
    )
    .filter(link =>
      isPdf(link.url, link.text)
    )
    .filter(link =>
      !sameUrl(
        link.url,
        officialUrl
      )
    )
    .map(link => ({
      ...link,
      score: scoreText(
        `${link.text} ${link.url}`,
        NOTIFICATION_WORDS
      )
    }))
    .filter(link => link.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .find(link => link.score > 0)?.url || null;
}

/* ----------------------------- */
/* Apply link selection           */
/* ----------------------------- */

function chooseApply(
  links,
  source,
  officialUrl,
  notificationUrl
) {
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
      !sameUrl(
        link.url,
        officialUrl
      )
    )
    .filter(link =>
      !sameUrl(
        link.url,
        notificationUrl
      )
    )
    .map(link => ({
      ...link,
      score: scoreText(
        `${link.text} ${link.url}`,
        APPLY_WORDS
      )
    }))
    .filter(link => link.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .find(link => link.score > 0)?.url || null;
}

/* ----------------------------- */
/* Candidate enrichment           */
/* ----------------------------- */

function enrichCandidate(
  candidate,
  links,
  source
) {
  if (!candidate) return null;

  if (candidate.type !== "job") {
    return {
      ...candidate,
      notification_url: null,
      apply_url: null
    };
  }

  const notificationUrl =
    chooseNotification(
      links,
      source,
      candidate.official_url
    );

  const applyUrl =
    chooseApply(
      links,
      source,
      candidate.official_url,
      notificationUrl
    );

  if (
    !notificationUrl ||
    !applyUrl ||
    sameUrl(
      candidate.official_url,
      notificationUrl
    ) ||
    sameUrl(
      candidate.official_url,
      applyUrl
    ) ||
    sameUrl(
      notificationUrl,
      applyUrl
    )
  ) {
    return null;
  }

  return {
    ...candidate,
    notification_url: notificationUrl,
    apply_url: applyUrl
  };
}

/* ----------------------------- */
/* Fetch official HTML            */
/* ----------------------------- */

async function fetchHtml(url) {
  try {
    const response = await fetch(
      url,
      {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent":
            "NorthBharatJobsBot/1.0 (+official-source-monitor)",
          "Accept":
            "text/html,application/xhtml+xml"
        }
      }
    );

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        html: ""
      };
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

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

    const html =
      await response.text();

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

/* ----------------------------- */
/* Main discovery adapter         */
/* ----------------------------- */

async function discoverFromSource(
  source
) {
  if (!source?.base_url) {
    return [];
  }

  if (
    !domainAllowed(
      source.base_url,
      source.allowed_domains
    )
  ) {
    return [];
  }

  const homepage =
    await fetchHtml(
      source.base_url
    );

  if (!homepage.ok) {
    throw new Error(
      `HTTP ${homepage.status || "fetch-error"}`
    );
  }

  const homepageLinks =
    extractLinks(
      homepage.html,
      source.base_url,
      LINK_LIMIT
    );

  const discovered = [];
  const seenOfficial = new Set();

  for (const link of homepageLinks) {
    const candidate =
      buildCandidate(
        link,
        source
      );

    if (!candidate) continue;

    if (
      seenOfficial.has(
        candidate.official_url
      )
    ) {
      continue;
    }

    seenOfficial.add(
      candidate.official_url
    );

    discovered.push({
      candidate,
      pageHtml: null,
      pageUrl:
        candidate.official_url
    });

    if (
      discovered.length >=
      CANDIDATE_LIMIT
    ) {
      break;
    }
  }

  /* Inspect a small number of candidate pages */
  let inspected = 0;

  for (
    const entry of discovered
  ) {
    if (
      inspected >=
      CANDIDATE_PAGE_LIMIT
    ) {
      break;
    }

    const page =
      await fetchHtml(
        entry.pageUrl
      );

    inspected++;

    if (!page.ok) continue;

    entry.pageHtml =
      page.html;
  }

  const results = [];

  for (
    const entry of discovered
  ) {
    let links =
      homepageLinks;

    if (entry.pageHtml) {
      const pageLinks =
        extractLinks(
          entry.pageHtml,
          entry.pageUrl,
          LINK_LIMIT
        );

      links = [
        ...homepageLinks,
        ...pageLinks
      ];
    }

    const uniqueLinks = [];
    const seen =
      new Set();

    for (
      const link of links
    ) {
      if (!link?.url) continue;

      const normalized =
        link.url.split("#")[0];

      if (
        seen.has(normalized)
      ) {
        continue;
      }

      seen.add(normalized);

      uniqueLinks.push({
        ...link,
        url: normalized
      });
    }

    let title =
      entry.candidate.title;

    if (entry.pageHtml) {
      const pageTitle =
        extractTitle(
          entry.pageHtml
        );

      if (
        pageTitle &&
        pageTitle.length >= 8
      ) {
        title =
          pageTitle.slice(
            0,
            300
          );
      }
    }

    const candidate = {
      ...entry.candidate,
      title
    };

    const enriched =
      enrichCandidate(
        candidate,
        uniqueLinks,
        source
      );

    if (!enriched) {
      continue;
    }

    results.push(
      enriched
    );

    if (
      results.length >=
      CANDIDATE_LIMIT
    ) {
      break;
    }
  }

  return results;
}

/* -------------------------------- */
/* Adapter registry                  */
/* -------------------------------- */

const adapters = {

  generic:
    discoverFromSource,

  ssc:
    discoverFromSource,

  upsc:
    discoverFromSource,

  "upsc-online":
    discoverFromSource,

  ncs:
    discoverFromSource,

  rrb:
    discoverFromSource,

  railway:
    discoverFromSource,

  "railway-recruitment-boards":
    discoverFromSource,

  "india-post":
    discoverFromSource,

  "indian-post":
    discoverFromSource,

  ibps:
    discoverFromSource,

  sbi:
    discoverFromSource,

  rbi:
    discoverFromSource,

  bpsc:
    discoverFromSource,

  bssc:
    discoverFromSource,

  "bihar-police":
    discoverFromSource,

  "indian-army":
    discoverFromSource,

  /*
    IMPORTANT:
    Database may contain "army".
  */
  army:
    discoverFromSource,

  "indian-navy":
    discoverFromSource,

  /*
    IMPORTANT:
    Database may contain "navy".
  */
  navy:
    discoverFromSource,

  "indian-air-force":
    discoverFromSource,

  /*
    IMPORTANT:
    Database may contain "airforce".
  */
  airforce:
    discoverFromSource,

  drdo:
    discoverFromSource,

  isro:
    discoverFromSource,

  lic:
    discoverFromSource,

  epfo:
    discoverFromSource,

  esic:
    discoverFromSource,

  nta:
    discoverFromSource
};

/*
  Export both named and default.
  This makes the module compatible with:
  import { adapters } from "./sources.js";
  and
  import adapters from "./sources.js";
*/

export {
  adapters
};

export default adapters;
