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

const SECTION_WORDS = [
  "recruitment",
  "recruitments",
  "career",
  "careers",
  "vacancy",
  "vacancies",
  "employment",
  "jobs",
  "job",
  "notifications",
  "notification",
  "advertisement",
  "advertisements",
  "latest notice",
  "notices",
  "notice",
  "opportunities",
  "current openings",
  "online application",
  "recruitment notice"
];

const LINK_LIMIT = 120;
const CANDIDATE_LIMIT = 8;
const SECTION_PAGE_LIMIT = 6;
const CANDIDATE_PAGE_LIMIT = 6;

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
    ua.href = ua.href.replace(/\/$/, "");

    ub.hash = "";
    ub.href = ub.href.replace(/\/$/, "");

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
/* Section-page discovery         */
/* ----------------------------- */

function isUsefulSectionLink(
  link,
  source
) {
  if (!link?.url) return false;

  if (
    !domainAllowed(
      link.url,
      source.allowed_domains
    )
  ) {
    return false;
  }

  if (isPdf(link.url, link.text)) {
    return false;
  }

  const text = clean(
    `${link.text} ${link.url}`
  ).toLowerCase();

  return SECTION_WORDS.some(word =>
    text.includes(word.toLowerCase())
  );
}

function chooseSectionPages(
  links,
  source
) {
  const selected = [];
  const seen = new Set();

  const scored = links
    .filter(link =>
      isUsefulSectionLink(
        link,
        source
      )
    )
    .map(link => ({
      ...link,
      score: scoreText(
        `${link.text} ${link.url}`,
        SECTION_WORDS
      )
    }))
    .sort(
      (a, b) =>
        b.score - a.score
    );

  for (const link of scored) {
    const normalized =
      link.url.split("#")[0];

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    selected.push({
      url: normalized,
      text: link.text
    });

    if (
      selected.length >=
      SECTION_PAGE_LIMIT
    ) {
      break;
    }
  }

  return selected;
}

/* ----------------------------- */
/* Candidate creation             */
/* ----------------------------- */

function buildCandidate(
  link,
  source
) {
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

  const combined =
    `${link.text} ${link.url}`;

  const type =
    classify(combined);

  if (!type) return null;

  const title =
    clean(link.text) ||
    "Government Update";

  /*
   * Avoid publishing generic navigation labels.
   */
  const badTitles = [
    "home",
    "login",
    "contact",
    "about us",
    "privacy policy",
    "terms",
    "menu",
    "click here",
    "read more",
    "view more",
    "website"
  ];

  if (
    badTitles.includes(
      title.toLowerCase()
    )
  ) {
    return null;
  }

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
      isPdf(
        link.url,
        link.text
      )
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
    .filter(link =>
      link.score > 0
    )
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .find(link =>
      link.score > 0
    )?.url || null;
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
      !isPdf(
        link.url,
        link.text
      )
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
    .filter(link =>
      link.score > 0
    )
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .find(link =>
      link.score > 0
    )?.url || null;
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

  if (
    candidate.type !== "job"
  ) {
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

  /*
   * Recruitment jobs must have
   * three different official URLs.
   */
  if (
    !notificationUrl ||
    !applyUrl
  ) {
    return null;
  }

  if (
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
    notification_url:
      notificationUrl,
    apply_url:
      applyUrl
  };
}

/* ----------------------------- */
/* Fetch official HTML            */
/* ----------------------------- */

async function fetchHtml(url) {
  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",
          redirect: "follow",
          cache: "no-store",
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
        status:
          response.status,
        html: ""
      };
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    /*
     * Some government servers omit
     * a useful content-type.
     * Therefore we still inspect
     * the body if it looks like HTML.
     */
    const html =
      await response.text();

    if (
      !/text\/html|application\/xhtml\+xml/i.test(
        contentType
      ) &&
      !/<html[\s>]/i.test(
        html.slice(0, 5000)
      )
    ) {
      return {
        ok: false,
        status:
          response.status,
        html: ""
      };
    }

    return {
      ok: true,
      status:
        response.status,
      html
    };

  } catch (error) {
    return {
      ok: false,
      status: 0,
      html: "",
      error:
        String(
          error?.message ||
          error
        )
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

  /*
   * 1. Fetch homepage.
   */
  const homepage =
    await fetchHtml(
      source.base_url
    );

  if (!homepage.ok) {
    throw new Error(
      `HTTP ${
        homepage.status ||
        "fetch-error"
      }`
    );
  }

  /*
   * 2. Extract homepage links.
   */
  const homepageLinks =
    extractLinks(
      homepage.html,
      source.base_url,
      LINK_LIMIT
    );

  /*
   * 3. Find recruitment/
   *    notification/career pages.
   */
  const sectionPages =
    chooseSectionPages(
      homepageLinks,
      source
    );

  /*
   * 4. Fetch section pages.
   */
  const allLinks = [
    ...homepageLinks
  ];

  let sectionCount = 0;

  for (
    const section of sectionPages
  ) {
    if (
      sectionCount >=
      SECTION_PAGE_LIMIT
    ) {
      break;
    }

    const page =
      await fetchHtml(
        section.url
      );

    sectionCount++;

    if (!page.ok) {
      continue;
    }

    const pageLinks =
      extractLinks(
        page.html,
        section.url,
        LINK_LIMIT
      );

    allLinks.push(
      ...pageLinks
    );
  }

  /*
   * 5. Deduplicate links.
   */
  const uniqueLinks = [];
  const seenLinks = new Set();

  for (
    const link of allLinks
  ) {
    if (!link?.url) continue;

    const normalized =
      link.url.split("#")[0];

    if (
      seenLinks.has(
        normalized
      )
    ) {
      continue;
    }

    seenLinks.add(
      normalized
    );

    uniqueLinks.push({
      ...link,
      url: normalized
    });
  }

  /*
   * 6. Build candidates.
   */
  const candidates = [];
  const seenCandidates =
    new Set();

  for (
    const link of uniqueLinks
  ) {
    const candidate =
      buildCandidate(
        link,
        source
      );

    if (!candidate) {
      continue;
    }

    if (
      seenCandidates.has(
        candidate.official_url
      )
    ) {
      continue;
    }

    seenCandidates.add(
      candidate.official_url
    );

    candidates.push(
      candidate
    );

    if (
      candidates.length >=
      CANDIDATE_LIMIT
    ) {
      break;
    }
  }

  /*
   * 7. Enrich candidates.
   */
  const results = [];

  let inspected = 0;

  for (
    const candidate of candidates
  ) {
    if (
      inspected >=
      CANDIDATE_PAGE_LIMIT
    ) {
      break;
    }

    /*
     * Fetch candidate page so
     * notification/apply links
     * can be found there.
     */
    const page =
      await fetchHtml(
        candidate.official_url
      );

    inspected++;

    let links =
      uniqueLinks;

    if (page.ok) {
      const candidateLinks =
        extractLinks(
          page.html,
          candidate.official_url,
          LINK_LIMIT
        );

      links = [
        ...uniqueLinks,
        ...candidateLinks
      ];
    }

    /*
     * Deduplicate again.
     */
    const localLinks = [];
    const localSeen =
      new Set();

    for (
      const link of links
    ) {
      if (!link?.url) continue;

      const normalized =
        link.url.split("#")[0];

      if (
        localSeen.has(
          normalized
        )
      ) {
        continue;
      }

      localSeen.add(
        normalized
      );

      localLinks.push({
        ...link,
        url: normalized
      });
    }

    let finalCandidate =
      enrichCandidate(
        candidate,
        localLinks,
        source
      );

    /*
     * For non-job types,
     * enrichCandidate can return
     * the candidate directly.
     */
    if (!finalCandidate) {
      continue;
    }

    /*
     * Use page title only when
     * the original link title is
     * clearly generic.
     */
    if (
      page.ok
    ) {
      const pageTitle =
        extractTitle(
          page.html
        );

      if (
        pageTitle &&
        pageTitle.length >= 8 &&
        !/^(home|login|notice|notices)$/i.test(
          pageTitle
        )
      ) {
        /*
         * Do not replace a useful
         * recruitment title with
         * a generic site title.
         */
        const generic =
          /official website|home page|welcome|homepage/i.test(
            pageTitle
          );

        if (!generic) {
          finalCandidate = {
            ...finalCandidate,
            title:
              finalCandidate.title ||
              pageTitle.slice(
                0,
                300
              )
          };
        }
      }
    }

    results.push(
      finalCandidate
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
/* LIC Smart Automatic Discovery    */
/* -------------------------------- */

async function discoverLIC(source) {
  const seedPages = [
    "https://licindia.in/en/web/guest/careers",
    "https://licindia.in/en/web/guest/golden-jubilee-foundation"
  ];

  const candidates = [];
  const visited = new Set();
  const seen = new Set();

  const MAX_PAGES = 30;
  const MAX_LINKS = 250;
  const MAX_DEPTH = 3;

  function isOfficialLICUrl(url) {
    if (!url) return false;

    const host = hostOf(url);

    return (
      host === "licindia.in" ||
      host === "www.licindia.in" ||
      host.endsWith(".licindia.in")
    );
  }

  function textOf(link) {
    return clean(
      `${link?.text || ""} ${link?.url || ""}`
    );
  }

  function relevant(text) {
    return /recruit|recruitment|career|careers|vacancy|vacancies|employment|job|jobs|officer|assistant|engineer|aao|ado|apprentice|scholarship|fellowship|notification|advertisement|notice|result|admit card|hall ticket|call letter|answer key|corrigendum|shortlist|scorecard|exam|application|registration|selection|engagement|syllabus|admission/i.test(
      clean(text)
    );
  }

  function classifyLIC(text) {
    const value =
      clean(text).toLowerCase();

    /*
     * IMPORTANT:
     * "education" or "student" alone
     * must NOT make a page a scholarship.
     */
    if (
      /scholarship|fellowship/.test(
        value
      )
    ) {
      return "scholarship";
    }

    if (
      /admit card|hall ticket|call letter/.test(
        value
      )
    ) {
      return "admit-card";
    }

    if (
      /answer key|provisional key|final key/.test(
        value
      )
    ) {
      return "answer-key";
    }

    if (
      /\bresult\b|results|scorecard|score card|merit list|selection list|final result/.test(
        value
      )
    ) {
      return "result";
    }

    if (
      /syllabus|exam pattern|scheme of examination/.test(
        value
      )
    ) {
      return "syllabus";
    }

    if (
      /recruitment|vacancy|vacancies|employment|career|careers|job|jobs|officer|assistant|engineer|aao|ado|apprentice|engagement|direct recruitment|selection/.test(
        value
      )
    ) {
      return "job";
    }

    if (
      /admission|entrance examination|entrance/.test(
        value
      )
    ) {
      return "admission";
    }

    if (
      /notification|advertisement|notice|corrigendum|exam date|schedule|latest update/.test(
        value
      )
    ) {
      return "update";
    }

    return null;
  }

  function isCareerIndexPage(
    url,
    title
  ) {
    const value =
      `${url} ${title}`.toLowerCase();

    return (
      /\/careers\/?$/.test(
        url.toLowerCase()
      ) ||
      /^careers?$/i.test(
        clean(title)
      ) ||
      /lic careers/.test(value)
    );
  }

  function isBadPDF(text) {
    return /certificate of registration|registration certificate|premium receipt|policy document|claim form|claim settlement|customer education|branch locator|annual report|financial statement|privacy policy|terms and conditions/i.test(
      text
    );
  }

  function extractYears(text) {
    return [
      ...String(text).matchAll(
        /\b(20\d{2})\b/g
      )
    ]
      .map(match =>
        Number(match[1])
      )
      .filter(
        year =>
          year >= 2020 &&
          year <= 2099
      );
  }

  function pdfScore(
    link,
    context = ""
  ) {
    const text =
      clean(
        `${link?.text || ""} ${link?.url || ""} ${context}`
      ).toLowerCase();

    if (
      !isOfficialLICUrl(
        link?.url
      )
    ) {
      return -Infinity;
    }

    if (
      !isPdf(
        link.url,
        link.text
      )
    ) {
      return -Infinity;
    }

    if (
      isBadPDF(text)
    ) {
      return -500;
    }

    let score = 0;

    if (
      /notification|advertisement|detailed advertisement/.test(
        text
      )
    ) {
      score += 150;
    }

    if (
      /recruitment|employment|vacancy|vacancies/.test(
        text
      )
    ) {
      score += 100;
    }

    if (
      /scholarship|fellowship/.test(
        text
      )
    ) {
      score += 100;
    }

    if (
      /scheme/.test(text)
    ) {
      score += 65;
    }

    if (
      /instructions|guidelines/.test(
        text
      )
    ) {
      score += 35;
    }

    if (
      /notice|corrigendum/.test(
        text
      )
    ) {
      score += 45;
    }

    if (
      /result|scorecard|shortlist/.test(
        text
      )
    ) {
      score += 80;
    }

    if (
      /answer key/.test(
        text
      )
    ) {
      score += 80;
    }

    if (
      /syllabus/.test(
        text
      )
    ) {
      score += 70;
    }

    const years =
      extractYears(text);

    if (years.length) {
      score +=
        Math.max(...years) -
        2020;
    }

    return score;
  }

  function choosePDF(
    links,
    context = ""
  ) {
    const ranked =
      links
        .map(link => ({
          link,
          score:
            pdfScore(
              link,
              context
            )
        }))
        .filter(
          item =>
            item.score >= 50
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        );

    return ranked.length
      ? ranked[0].link.url
      : null;
  }

  function applyScore(
    link,
    context = ""
  ) {
    const text =
      clean(
        `${link?.text || ""} ${link?.url || ""} ${context}`
      ).toLowerCase();

    if (
      !link?.url ||
      isPdf(
        link.url,
        link.text
      )
    ) {
      return -Infinity;
    }

    if (
      !isOfficialLICUrl(
        link.url
      )
    ) {
      return -Infinity;
    }

    if (
      /certificate of registration|registration certificate|certificate|premium|policy|claim|customer education|branch locator|agent portal|login|mylic|download app|calculator/i.test(
        text
      )
    ) {
      return -300;
    }

    let score = 0;

    if (
      /apply here|apply online|online application|apply for/.test(
        text
      )
    ) {
      score += 140;
    }

    if (
      /application|registration|register/.test(
        text
      )
    ) {
      score += 90;
    }

    if (
      /apply|click here/.test(
        text
      )
    ) {
      score += 50;
    }

    if (
      /scholarship|fellowship/.test(
        text
      )
    ) {
      score += 60;
    }

    if (
      /recruitment|vacancy|job|career/.test(
        text
      )
    ) {
      score += 40;
    }

    return score;
  }

  function chooseApply(
    links,
    context = ""
  ) {
    const ranked =
      links
        .map(link => ({
          link,
          score:
            applyScore(
              link,
              context
            )
        }))
        .filter(
          item =>
            item.score >= 80
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        );

    return ranked.length
      ? ranked[0].link.url
      : null;
  }

  function buildTitle(
    pageTitle,
    links,
    type,
    url
  ) {
    const page =
      clean(pageTitle);

    if (
      page &&
      !/^(home|homepage|careers|career|lic|life insurance corporation of india|golden jubilee foundation)$/i.test(
        page
      ) &&
      page.length >= 8
    ) {
      return page.slice(
        0,
        300
      );
    }

    const useful =
      links
        .map(textOf)
        .filter(Boolean)
        .filter(text => {
          const value =
            text.toLowerCase();

          if (
            type ===
            "scholarship"
          ) {
            return /scholarship|fellowship/.test(
              value
            );
          }

          if (
            type === "job"
          ) {
            return /recruitment|vacancy|job|officer|assistant|engineer|aao|ado|apprentice|engagement/.test(
              value
            );
          }

          return relevant(
            value
          );
        });

    if (
      useful.length
    ) {
      return useful.sort(
        (a, b) =>
          b.length -
          a.length
      )[0].slice(
        0,
        300
      );
    }

    const slug =
      clean(
        String(url || "")
          .split("/")
          .pop()
          ?.replace(
            /[-_]+/g,
            " "
          )
      );

    return (
      slug ||
      "LIC Official Update"
    );
  }

  async function inspect(
    pageUrl,
    depth = 0
  ) {
    if (
      !pageUrl ||
      visited.size >=
        MAX_PAGES
    ) {
      return;
    }

    const normalized =
      pageUrl.split("#")[0];

    if (
      visited.has(
        normalized
      )
    ) {
      return;
    }

    if (
      !isOfficialLICUrl(
        normalized
      )
    ) {
      return;
    }

    visited.add(
      normalized
    );

    let response;

    try {
      response =
        await fetchHtml(
          normalized
        );
    } catch {
      return;
    }

    /*
     * IMPORTANT:
     * fetchHtml() in your existing
     * sources.js returns an object:
     * { ok, status, html }
     */
    if (
      !response?.ok ||
      !response?.html
    ) {
      return;
    }

    const html =
      response.html;

    const links =
      extractLinks(
        html,
        normalized,
        MAX_LINKS
      );

    const pageTitle =
      extractTitle(
        html
      );

    const pageContext =
      clean(
        `${pageTitle} ${normalized}`
      );

    const relevantLinks =
      links.filter(link =>
        relevant(
          textOf(link)
        )
      );

    const hasRelevantContent =
      relevant(
        pageContext
      ) ||
      relevantLinks.length >
        0;

    /*
     * Careers index itself should
     * not become a fake job record.
     * It should only lead us to the
     * actual recruitment pages.
     */
    const careerIndex =
      isCareerIndexPage(
        normalized,
        pageTitle
      );

    if (
      hasRelevantContent &&
      !careerIndex
    ) {
      let type =
        classifyLIC(
          pageContext
        );

      /*
       * If page title is generic,
       * infer scholarship only from
       * explicit scholarship links.
       */
      if (!type) {
        if (
          relevantLinks.some(
            link =>
              /scholarship|fellowship/i.test(
                textOf(link)
              )
          )
        ) {
          type =
            "scholarship";
        }
      }

      /*
       * Infer recruitment only from
       * explicit recruitment terms.
       */
      if (!type) {
        if (
          relevantLinks.some(
            link =>
              /recruitment|vacancy|vacancies|employment|job|jobs|officer|assistant|engineer|aao|ado|apprentice|engagement/i.test(
                textOf(link)
              )
          )
        ) {
          type =
            "job";
        }
      }

      /*
       * Other types.
       */
      if (!type) {
        if (
          relevantLinks.some(
            link =>
              /admit card|hall ticket|call letter/i.test(
                textOf(link)
              )
          )
        ) {
          type =
            "admit-card";
        }
      }

      if (!type) {
        if (
          relevantLinks.some(
            link =>
              /answer key|provisional key|final key/i.test(
                textOf(link)
              )
          )
        ) {
          type =
            "answer-key";
        }
      }

      if (!type) {
        if (
          relevantLinks.some(
            link =>
              /\bresult\b|results|scorecard|merit list|selection list/i.test(
                textOf(link)
              )
          )
        ) {
          type =
            "result";
        }
      }

      if (!type) {
        if (
          relevantLinks.some(
            link =>
              /syllabus|exam pattern|scheme of examination/i.test(
                textOf(link)
              )
          )
        ) {
          type =
            "syllabus";
        }
      }

      if (!type) {
        if (
          relevantLinks.some(
            link =>
              /admission|entrance examination|entrance/i.test(
                textOf(link)
              )
          )
        ) {
          type =
            "admission";
        }
      }

      if (!type) {
        if (
          relevantLinks.some(
            link =>
              /notification|advertisement|notice|corrigendum|schedule|latest update/i.test(
                textOf(link)
              )
          )
        ) {
          type =
            "update";
        }
      }

      if (type) {
        const notificationUrl =
          choosePDF(
            links,
            pageContext
          );

        const applyUrl =
          chooseApply(
            links,
            pageContext
          );

        const title =
          buildTitle(
            pageTitle,
            relevantLinks,
            type,
            normalized
          );

        /*
         * Recruitment jobs must have
         * three distinct official URLs.
         */
        const requiresThreeLinks =
          type === "job";

        const validThreeLinks =
          Boolean(
            notificationUrl
          ) &&
          Boolean(
            applyUrl
          ) &&
          !sameUrl(
            normalized,
            notificationUrl
          ) &&
          !sameUrl(
            normalized,
            applyUrl
          ) &&
          !sameUrl(
            notificationUrl,
            applyUrl
          );

        if (
          !requiresThreeLinks ||
          validThreeLinks
        ) {
          const key =
            `${type}|${normalized}`;

          if (
            !seen.has(key)
          ) {
            seen.add(key);

            candidates.push({
              type,

              title:
                title.slice(
                  0,
                  300
                ),

              organization:
                "Life Insurance Corporation of India (LIC)",

              category:
                type === "job"
                  ? "LIC Recruitment"
                  : type ===
                    "scholarship"
                  ? "Scholarship"
                  : type ===
                    "admit-card"
                  ? "LIC Admit Card"
                  : type ===
                    "answer-key"
                  ? "LIC Answer Key"
                  : type ===
                    "result"
                  ? "LIC Result"
                  : type ===
                    "syllabus"
                  ? "LIC Syllabus"
                  : type ===
                    "admission"
                  ? "LIC Admission"
                  : "LIC Official Update",

              description:
                `Official LIC ${type} update: ${title}`,

              official_url:
                normalized,

              notification_url:
                notificationUrl,

              apply_url:
                applyUrl,

              source_url:
                normalized,

              source_name:
                source.name
            });
          }
        }
      }
    }

    /*
     * Continue crawling relevant
     * official LIC pages.
     */
    if (
      depth >=
      MAX_DEPTH
    ) {
      return;
    }

    const nextPages =
      links
        .filter(
          link =>
            isOfficialLICUrl(
              link.url
            )
        )
        .filter(
          link =>
            !isPdf(
              link.url,
              link.text
            )
        )
        .filter(
          link =>
            !sameUrl(
              link.url,
              normalized
            )
        )
        .filter(
          link =>
            relevant(
              textOf(link)
            )
        )
        .sort(
          (a, b) =>
            scoreText(
              textOf(b),
              SECTION_WORDS
            ) -
            scoreText(
              textOf(a),
              SECTION_WORDS
            )
        );

    for (
      const link of nextPages
    ) {
      if (
        visited.size >=
        MAX_PAGES
      ) {
        break;
      }

      await inspect(
        link.url,
        depth + 1
      );
    }
  }

  /*
   * Start from LIC's stable
   * official sections.
   *
   * No year is hard-coded.
   */
  for (
    const seed of seedPages
  ) {
    if (
      candidates.length >=
      CANDIDATE_LIMIT
    ) {
      break;
    }

    await inspect(
      seed,
      0
    );
  }

  return candidates.slice(
    0,
    CANDIDATE_LIMIT
  );
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

  indiapost:
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

  army:
    discoverFromSource,

  "indian-army":
    discoverFromSource,

  navy:
    discoverFromSource,

  "indian-navy":
    discoverFromSource,

  airforce:
    discoverFromSource,

  "indian-air-force":
    discoverFromSource,

  drdo:
    discoverFromSource,

  isro:
    discoverFromSource,

  lic:
    discoverLIC,

  epfo:
    discoverFromSource,

  esic:
    discoverFromSource,

  nta:
    discoverFromSource
};

/*
 * Both exports are intentional.
 * monitor.js currently uses:
 *
 * import adapters from "./sources.js";
 *
 * Older code can also use:
 *
 * import { adapters } from "./sources.js";
 */

export {
  adapters
};

export default adapters;
