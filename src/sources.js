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
  /*
   * LIC discovery is intentionally limited to
   * pages that are actually reachable from the
   * official LIC Careers page.
   *
   * Rules:
   * - Never invent recruitment URLs.
   * - Never invent notification URLs.
   * - Never invent apply URLs.
   * - Recruitment detail page must be an actual
   *   page found on LIC's official website.
   * - Notification must be an actual PDF linked
   *   from that page or its relevant LIC page.
   * - Apply URL must be an actual link exposed
   *   by LIC. External recruitment portals are
   *   allowed only when LIC itself links to them.
   */

  const seedPages = [
    "https://licindia.in/en/web/guest/careers"
  ];

  const candidates = [];
  const visited = new Set();
  const seenCandidates = new Set();

  const MAX_PAGES = 50;
  const MAX_LINKS = 400;
  const MAX_DEPTH = 4;

  /* ----------------------------- */
  /* LIC domain                     */
  /* ----------------------------- */

  function isOfficialLICUrl(url) {
    if (!url) return false;

    const host = hostOf(url);

    return (
      host === "licindia.in" ||
      host === "www.licindia.in" ||
      host.endsWith(".licindia.in")
    );
  }

  /*
   * External application domains are NOT
   * accepted blindly.
   *
   * They are accepted only if the URL was
   * actually discovered as a link from LIC.
   */
  function isAllowedApplyUrl(url) {
    if (!url) return false;

    const host = hostOf(url);

    if (!host) return false;

    if (isOfficialLICUrl(url)) {
      return true;
    }

    /*
     * LIC recruitment currently uses external
     * recruitment/application infrastructure
     * for some recruitment processes.
     *
     * These domains are accepted only after
     * their URL has been discovered from LIC.
     */
    return (
      host === "ibpsonline.ibps.in" ||
      host.endsWith(".ibps.in")
    );
  }

  /* ----------------------------- */
  /* URL normalization              */
  /* ----------------------------- */

  function normalizeLICUrl(url) {
    if (!url) return "";

    try {
      const u = new URL(url);

      u.hash = "";

      /*
       * Remove tracking parameters only.
       * Functional query parameters are retained.
       */
      const trackingParams = [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "fbclid",
        "gclid",
        "mc_cid",
        "mc_eid"
      ];

      for (
        const key of trackingParams
      ) {
        u.searchParams.delete(key);
      }

      u.hostname =
        u.hostname.toLowerCase();

      u.pathname =
        u.pathname.replace(
          /\/+$/,
          ""
        ) || "/";

      return u.toString();

    } catch {
      return String(url)
        .split("#")[0]
        .replace(/\/+$/, "");
    }
  }

  function sameLICUrl(a, b) {
    if (!a || !b) return false;

    return (
      normalizeLICUrl(a) ===
      normalizeLICUrl(b)
    );
  }

  /* ----------------------------- */
  /* Text helpers                   */
  /* ----------------------------- */

  function linkText(link) {
    return clean(
      `${link?.text || ""} ${link?.url || ""}`
    );
  }

  function pageContext(
    pageTitle,
    pageUrl,
    links
  ) {
    return clean(
      [
        pageTitle,
        pageUrl,
        ...links.map(
          link =>
            `${link.text || ""} ${link.url || ""}`
        )
      ].join(" ")
    );
  }

  /* ----------------------------- */
  /* Generic page blocker           */
  /* ----------------------------- */

  function isGenericLICPage(
    text,
    url = ""
  ) {
    const value =
      clean(text).toLowerCase();

    const urlValue =
      String(url || "").toLowerCase();

    /*
     * Block by URL where the URL itself
     * clearly identifies a generic page.
     */
    if (
      /customer-education|customer_education|golden-jubilee-foundation|branch-locator|privacy-policy|terms-and-conditions|annual-report|financial-statement|investor-relations/i.test(
        urlValue
      )
    ) {
      return true;
    }

    /*
     * IMPORTANT:
     *
     * Do NOT block a recruitment page merely
     * because its footer contains words such as
     * "Contact Us", "Privacy Policy", etc.
     *
     * Only a page whose actual identifying text
     * is generic should be blocked.
     */
    if (
      /^(home|homepage|login|contact us|about us|customer education|privacy policy|terms and conditions|branch locator|mylic)$/i.test(
        value
      )
    ) {
      return true;
    }

    return false;
  }

  /* ----------------------------- */
  /* Recruitment signals            */
  /* ----------------------------- */

  function hasRecruitmentSignal(
    text
  ) {
    return /recruitment|recruitment notification|employment notice|employment notification|vacancy|vacancies|career opportunity|career opportunities|job opportunity|job opportunities|online application|application form|engagement of|appointment of|selection of|direct recruitment|assistant engineer|assistant administrative officer|assistant administrative officers|\baao\b|\bado\b|apprentice development officer|officer|engineer|actuary|chief financial officer|\bcfo\b/i.test(
      clean(text)
    );
  }

  function hasStrongRecruitmentSignal(
    text
  ) {
    return /recruitment notification|employment notification|employment notice|recruitment|vacancy|vacancies|online application|engagement of|appointment of|direct recruitment|assistant administrative officer|assistant engineer|apprentice development officer|chief financial officer|\baao\b|\bado\b/i.test(
      clean(text)
    );
  }

  function hasScholarshipSignal(
    text
  ) {
    return /scholarship|fellowship/i.test(
      clean(text)
    );
  }

  function hasAdmitSignal(
    text
  ) {
    return /admit card|admit-card|hall ticket|call letter|download admit/i.test(
      clean(text)
    );
  }

  function hasResultSignal(
    text
  ) {
    return /\bresult\b|results|scorecard|score card|merit list|selection list|shortlisted candidates|shortlist|final result/i.test(
      clean(text)
    );
  }

  function hasAnswerKeySignal(
    text
  ) {
    return /answer key|answer-key|provisional key|final key/i.test(
      clean(text)
    );
  }

  function hasSyllabusSignal(
    text
  ) {
    return /syllabus|exam pattern|scheme of examination/i.test(
      clean(text)
    );
  }

  /* ----------------------------- */
  /* Page classification            */
  /* ----------------------------- */

  function classifyLIC(
    text
  ) {
    const value =
      clean(text).toLowerCase();

    if (
      hasScholarshipSignal(
        value
      )
    ) {
      return "scholarship";
    }

    if (
      hasAdmitSignal(
        value
      )
    ) {
      return "admit-card";
    }

    if (
      hasAnswerKeySignal(
        value
      )
    ) {
      return "answer-key";
    }

    if (
      hasResultSignal(
        value
      )
    ) {
      return "result";
    }

    if (
      hasSyllabusSignal(
        value
      )
    ) {
      return "syllabus";
    }

    if (
      hasStrongRecruitmentSignal(
        value
      )
    ) {
      return "job";
    }

    if (
      /admission|entrance examination|entrance/i.test(
        value
      )
    ) {
      return "admission";
    }

    if (
      /notification|advertisement|notice|corrigendum|schedule|latest update/i.test(
        value
      )
    ) {
      return "update";
    }

    return null;
  }

  /* ----------------------------- */
  /* Careers page detection         */
  /* ----------------------------- */

  function isCareerIndexPage(
    url,
    title = ""
  ) {
    const value =
      clean(
        `${url} ${title}`
      ).toLowerCase();

    return (
      /\/careers(?:\/)?(?:\?.*)?$/i.test(
        String(url || "")
      ) ||
      /^careers?$/i.test(
        clean(title)
      ) ||
      /lic careers/i.test(
        value
      )
    );
  }

  /* ----------------------------- */
  /* Recruitment detail detection  */
  /* ----------------------------- */

  function isRecruitmentDetailPage(
    url,
    title,
    links,
    pageText
  ) {
    if (
      isCareerIndexPage(
        url,
        title
      )
    ) {
      return false;
    }

    const context =
      clean(
        [
          title,
          url,
          pageText,
          ...links.map(
            link =>
              `${link.text || ""} ${link.url || ""}`
          )
        ].join(" ")
      );

    if (
      isGenericLICPage(
        title,
        url
      )
    ) {
      return false;
    }

    /*
     * A detail page should have stronger
     * recruitment evidence than just the word
     * "career" in a navigation link.
     */
    return hasStrongRecruitmentSignal(
      context
    );
  }

  /* ----------------------------- */
  /* Year extraction                */
  /* ----------------------------- */

  function extractYears(
    text
  ) {
    return [
      ...String(
        text || ""
      ).matchAll(
        /\b(20\d{2})\b/g
      )
    ]
      .map(
        match =>
          Number(
            match[1]
          )
      )
      .filter(
        year =>
          year >= 2020 &&
          year <= 2099
      );
  }

  /* ----------------------------- */
  /* Notification PDF scoring       */
  /* ----------------------------- */

  function notificationScore(
    link,
    context = ""
  ) {
    if (!link?.url) {
      return -Infinity;
    }

    const url =
      link.url;

    if (
      !isOfficialLICUrl(
        url
      )
    ) {
      return -Infinity;
    }

    if (
      !isPdf(
        url,
        link.text
      )
    ) {
      return -Infinity;
    }

    const text =
      clean(
        `${link.text || ""} ${url} ${context}`
      ).toLowerCase();

    /*
     * Reject unrelated LIC PDFs.
     */
    if (
      /certificate of registration|registration certificate|premium receipt|policy document|claim form|claim settlement|customer education|branch locator|annual report|financial statement|privacy policy|terms and conditions|investor relations/i.test(
        text
      )
    ) {
      return -Infinity;
    }

    let score = 0;

    if (
      /recruitment notification|employment notification|employment notice|recruitment/i.test(
        text
      )
    ) {
      score += 220;
    }

    if (
      /detailed advertisement|advertisement|notification/i.test(
        text
      )
    ) {
      score += 170;
    }

    if (
      /vacancy|vacancies|appointment|engagement|selection/i.test(
        text
      )
    ) {
      score += 100;
    }

    if (
      /assistant administrative officer|assistant engineer|apprentice development officer|\baao\b|\bado\b|engineer|officer|actuary|chief financial officer|\bcfo\b/i.test(
        text
      )
    ) {
      score += 100;
    }

    if (
      /corrigendum/i.test(
        text
      )
    ) {
      score += 35;
    }

    if (
      /result|scorecard|shortlist|answer key/i.test(
        text
      )
    ) {
      /*
       * Results/answer keys should not outrank
       * a recruitment notification for a job.
       */
      score -= 80;
    }

    const years =
      extractYears(
        text
      );

    if (
      years.length
    ) {
      score +=
        Math.max(
          ...years
        ) - 2020;
    }

    return score;
  }

  function chooseNotificationPDF(
    links,
    context = ""
  ) {
    const ranked =
      links
        .map(
          link => ({
            link,
            score:
              notificationScore(
                link,
                context
              )
          })
        )
        .filter(
          item =>
            item.score >= 100
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        );

    if (
      !ranked.length
    ) {
      return null;
    }

    return normalizeLICUrl(
      ranked[0]
        .link
        .url
    );
  }

  /* ----------------------------- */
  /* Apply-link scoring             */
  /* ----------------------------- */

  function applyScore(
    link,
    context = ""
  ) {
    if (!link?.url) {
      return -Infinity;
    }

    const url =
      link.url;

    if (
      isPdf(
        url,
        link.text
      )
    ) {
      return -Infinity;
    }

    if (
      !isAllowedApplyUrl(
        url
      )
    ) {
      return -Infinity;
    }

    const text =
      clean(
        `${link.text || ""} ${url} ${context}`
      ).toLowerCase();

    /*
     * Generic LIC navigation pages must never
     * become application URLs.
     */
    if (
      /customer education|customer-education|branch locator|privacy policy|terms and conditions|annual report|financial statement|investor relations|login|mylic|contact us|about us/i.test(
        text
      )
    ) {
      return -Infinity;
    }

    let score = 0;

    if (
      /apply here|apply online|online application|apply now|click here to apply|online registration|candidate registration/i.test(
        text
      )
    ) {
      score += 240;
    }

    if (
      /application form|application|registration|register online|candidate login/i.test(
        text
      )
    ) {
      score += 130;
    }

    if (
      /\bapply\b|click here/i.test(
        text
      )
    ) {
      score += 70;
    }

    /*
     * Recruitment context increases confidence.
     */
    if (
      hasRecruitmentSignal(
        context
      )
    ) {
      score += 60;
    }

    /*
     * External application domains get a small
     * confidence reduction compared with LIC
     * hosted application pages.
     */
    if (
      !isOfficialLICUrl(
        url
      )
    ) {
      score -= 10;
    }

    return score;
  }

  function chooseApplyUrl(
    links,
    context = ""
  ) {
    const ranked =
      links
        .map(
          link => ({
            link,
            score:
              applyScore(
                link,
                context
              )
          })
        )
        .filter(
          item =>
            item.score >= 100
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        );

    if (
      !ranked.length
    ) {
      return null;
    }

    return normalizeLICUrl(
      ranked[0]
        .link
        .url
    );
  }

  /* ----------------------------- */
  /* Title creation                 */
  /* ----------------------------- */

  function buildLICTitle(
    pageTitle,
    links,
    type,
    url
  ) {
    const title =
      clean(
        pageTitle
      );

    /*
     * Keep meaningful recruitment page titles.
     */
    if (
      title &&
      title.length >= 8 &&
      !/^(home|homepage|careers|career|lic|life insurance corporation of india|customer education|golden jubilee foundation)$/i.test(
        title
      ) &&
      !/customer education/i.test(
        title
      ) &&
      !/official website of life insurance corporation of india/i.test(
        title
      )
    ) {
      return title.slice(
        0,
        300
      );
    }

    const useful =
      links
        .map(
          link =>
            clean(
              link?.text
            )
        )
        .filter(Boolean)
        .filter(
          text => {
            if (
              type ===
              "job"
            ) {
              return hasRecruitmentSignal(
                text
              );
            }

            if (
              type ===
              "scholarship"
            ) {
              return hasScholarshipSignal(
                text
              );
            }

            return true;
          }
        )
        .sort(
          (a, b) =>
            b.length -
            a.length
        );

    if (
      useful.length
    ) {
      return useful[0].slice(
        0,
        300
      );
    }

    try {
      const pathPart =
        new URL(
          url
        ).pathname
          .split("/")
          .filter(Boolean)
          .pop();

      if (
        pathPart
      ) {
        return clean(
          pathPart.replace(
            /[-_]+/g,
            " "
          )
        ).slice(
          0,
          300
        );
      }
    } catch {}

    return "LIC Official Update";
  }

  /* ----------------------------- */
  /* Candidate key                  */
  /* ----------------------------- */

  function candidateKey(
    type,
    url
  ) {
    return (
      `${type}|${normalizeLICUrl(
        url
      )}`
    );
  }

  /* ----------------------------- */
  /* Candidate creation             */
  /* ----------------------------- */

  function addCandidate(
    candidate
  ) {
    if (!candidate) {
      return;
    }

    if (
      !candidate.official_url
    ) {
      return;
    }

    const key =
      candidateKey(
        candidate.type,
        candidate.official_url
      );

    if (
      seenCandidates.has(
        key
      )
    ) {
      return;
    }

    seenCandidates.add(
      key
    );

    candidates.push(
      candidate
    );
  }

  /* ----------------------------- */
  /* Page inspection                */
  /* ----------------------------- */

  async function inspect(
    pageUrl,
    depth = 0
  ) {
    if (
      !pageUrl
    ) {
      return;
    }

    if (
      visited.size >=
      MAX_PAGES
    ) {
      return;
    }

    if (
      candidates.length >=
      CANDIDATE_LIMIT
    ) {
      return;
    }

    const normalized =
      normalizeLICUrl(
        pageUrl
      );

    if (
      !normalized
    ) {
      return;
    }

    /*
     * The crawler itself only follows LIC
     * pages. External domains are never crawled.
     */
    if (
      !isOfficialLICUrl(
        normalized
      )
    ) {
      return;
    }

    if (
      visited.has(
        normalized
      )
    ) {
      return;
    }

    visited.add(
      normalized
    );

    const response =
      await fetchHtml(
        normalized
      );

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

    /*
     * Use only meaningful page content for
     * page classification. Link text is useful,
     * but footer/navigation text must not alone
     * turn a generic page into a recruitment page.
     */
    const meaningfulLinkText =
      links
        .map(
          link =>
            clean(
              link?.text
            )
        )
        .filter(Boolean)
        .filter(
          text =>
            !/^(home|login|contact us|about us|privacy policy|terms and conditions|customer education|branch locator|read more|view more|menu)$/i.test(
              text
            )
        )
        .join(" ");

    const pageIdentity =
      clean(
        `${pageTitle} ${normalized}`
      );

    const context =
      clean(
        `${pageIdentity} ${meaningfulLinkText}`
      );

    const careerIndex =
      isCareerIndexPage(
        normalized,
        pageTitle
      );

    const genericPage =
      isGenericLICPage(
        pageTitle,
        normalized
      );

    const recruitmentDetail =
      !careerIndex &&
      !genericPage &&
      isRecruitmentDetailPage(
        normalized,
        pageTitle,
        links,
        meaningfulLinkText
      );

    /*
     * --------------------------------
     * RECRUITMENT
     * --------------------------------
     */

    if (
      recruitmentDetail
    ) {
      const notificationUrl =
        chooseNotificationPDF(
          links,
          context
        );

      const applyUrl =
        chooseApplyUrl(
          links,
          context
        );

      /*
       * Recruitment record requires:
       *
       * 1. LIC detail page
       * 2. LIC notification PDF
       * 3. actual apply URL
       *
       * All must be different.
       */
      const valid =
        Boolean(
          notificationUrl
        ) &&
        Boolean(
          applyUrl
        ) &&
        !sameLICUrl(
          normalized,
          notificationUrl
        ) &&
        !sameLICUrl(
          normalized,
          applyUrl
        ) &&
        !sameLICUrl(
          notificationUrl,
          applyUrl
        );

      if (
        valid
      ) {
        const title =
          buildLICTitle(
            pageTitle,
            links,
            "job",
            normalized
          );

        addCandidate({
          type:
            "job",

          title:
            title.slice(
              0,
              300
            ),

          organization:
            "Life Insurance Corporation of India (LIC)",

          category:
            "LIC Recruitment",

          description:
            `Official LIC recruitment: ${title}`,

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

    /*
     * --------------------------------
     * NON-RECRUITMENT OFFICIAL UPDATES
     * --------------------------------
     *
     * We intentionally do not create generic
     * update records from every LIC notice.
     * Only strong, identifiable categories are
     * considered.
     */

    if (
      !careerIndex &&
      !genericPage &&
      !recruitmentDetail
    ) {
      let type =
        classifyLIC(
          pageIdentity
        );

      /*
       * If page identity alone does not identify
       * the category, use meaningful links.
       */
      if (
        !type
      ) {
        type =
          classifyLIC(
            context
          );
      }

      /*
       * Never classify a generic page as a
       * scholarship simply because a footer or
       * navigation link contains the word.
       */
      if (
        type ===
        "scholarship" &&
        !hasScholarshipSignal(
          context
        )
      ) {
        type = null;
      }

      if (
        type &&
        type !== "job"
      ) {
        const title =
          buildLICTitle(
            pageTitle,
            links,
            type,
            normalized
          );

        const notificationUrl =
          chooseNotificationPDF(
            links,
            context
          );

        /*
         * Apply URL is useful for scholarship/
         * admission pages too, but is never
         * invented.
         */
        const applyUrl =
          chooseApplyUrl(
            links,
            context
          );

        addCandidate({
          type,

          title:
            title.slice(
              0,
              300
            ),

          organization:
            "Life Insurance Corporation of India (LIC)",

          category:
            type ===
            "scholarship"
              ? "LIC Scholarship"
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

    /*
     * --------------------------------
     * CRAWL NEXT LIC PAGES
     * --------------------------------
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
              link?.url
            )
        )
        .filter(
          link =>
            !isPdf(
              link?.url,
              link?.text
            )
        )
        .map(
          link => ({
            ...link,
            url:
              normalizeLICUrl(
                link.url
              )
          })
        )
        .filter(
          link =>
            link.url &&
            !sameLICUrl(
              link.url,
              normalized
            )
        )
        .filter(
          link =>
            !isGenericLICPage(
              link.text,
              link.url
            )
        )
        .filter(
          link => {
            const value =
              linkText(
                link
              );

            return (
              hasRecruitmentSignal(
                value
              ) ||
              hasScholarshipSignal(
                value
              ) ||
              hasAdmitSignal(
                value
              ) ||
              hasResultSignal(
                value
              ) ||
              hasAnswerKeySignal(
                value
              ) ||
              hasSyllabusSignal(
                value
              ) ||
              /notification|advertisement|notice|corrigendum|schedule|current openings|opportunities/i.test(
                value
              )
            );
          }
        )
        .sort(
          (a, b) => {
            const scoreA =
              scoreText(
                linkText(a),
                SECTION_WORDS
              );

            const scoreB =
              scoreText(
                linkText(b),
                SECTION_WORDS
              );

            return (
              scoreB -
              scoreA
            );
          }
        );

    for (
      const next of nextPages
    ) {
      if (
        visited.size >=
        MAX_PAGES
      ) {
        break;
      }

      if (
        candidates.length >=
        CANDIDATE_LIMIT
      ) {
        break;
      }

      await inspect(
        next.url,
        depth + 1
      );
    }
  }

  /* ----------------------------- */
  /* Start discovery                */
  /* ----------------------------- */

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
