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
  const LIC_PAGES = [
    {
      url:
        "https://licindia.in/en/web/guest/careers",
      section: "career"
    },
    {
      url:
        "https://licindia.in/en/web/guest/golden-jubilee-foundation",
      section: "scholarship"
    }
  ];

  const candidates = [];

  for (const pageInfo of LIC_PAGES) {
    try {
      const page =
        await fetchHtml(pageInfo.url);

      if (!page.ok) {
        continue;
      }

      const links = extractLinks(
        page.html,
        pageInfo.url,
        LINK_LIMIT
      );

      for (const link of links) {
        if (!link?.url) continue;

        const url = link.url;
        const text =
          clean(link.text || "");

        const combined =
          `${text} ${url}`.toLowerCase();

        /*
         * Ignore obvious non-job/business pages.
         */
        const irrelevant =
          /insurance|policy|premium|claim|calculator|customer|branch locator|agent portal|mylic|download app/i
            .test(combined);

        if (irrelevant) {
          continue;
        }

        /*
         * Identify useful LIC content.
         */
        const isCareer =
          /recruit|career|vacancy|vacancies|job|assistant|officer|engineer|aao|ado|apprentice|employment/i
            .test(combined);

        const isScholarship =
          /scholarship|golden jubilee|education|student/i
            .test(combined);

        const isNotice =
          /notice|notification|result|admit card|answer key|corrigendum|shortlist|scorecard|exam/i
            .test(combined);

        /*
         * Only keep relevant LIC
         * government-job / scholarship
         * type information.
         */
        if (
          !isCareer &&
          !isScholarship &&
          !isNotice
        ) {
          continue;
        }

        /*
         * Ignore generic navigation links.
         */
        if (
          /^(home|careers|contact us|about us|login|search|privacy policy)$/i
            .test(text.trim())
        ) {
          continue;
        }

        /*
         * Determine item type.
         */
        let type = "other";

        if (isScholarship) {
          type = "scholarship";
        } else if (isCareer) {
          type = "job";
        } else if (/result/i.test(combined)) {
          type = "result";
        } else if (/admit card|call letter/i.test(combined)) {
          type = "admit-card";
        } else if (/answer key/i.test(combined)) {
          type = "answer-key";
        } else if (/syllabus/i.test(combined)) {
          type = "syllabus";
        } else if (/notice|notification|corrigendum/i.test(combined)) {
          type = "notice";
        }

        /*
         * Make sure the title is useful.
         */
        const title =
          text ||
          extractTitle(page.html) ||
          "LIC Official Update";

        /*
         * Do not publish a bare PDF as the
         * official page unless it is the
         * actual notification.
         */
        let notificationUrl = null;

        if (isPdf(url, text)) {
          notificationUrl = url;
        }

        /*
         * Apply links are non-PDF links
         * containing application language.
         */
        let applyUrl = null;

        if (
          !isPdf(url, text) &&
          /apply|application|registration|online application|click here/i
            .test(combined)
        ) {
          applyUrl = url;
        }

        /*
         * For a page/detail link, inspect it
         * and search inside it for notification
         * and application links.
         */
        if (
          !isPdf(url, text) &&
          (
            isCareer ||
            isScholarship ||
            isNotice
          )
        ) {
          try {
            const detail =
              await fetchHtml(url);

            if (detail.ok) {
              const detailLinks =
                extractLinks(
                  detail.html,
                  url,
                  LINK_LIMIT
                );

              /*
               * Find notification PDF.
               */
              const pdf =
                detailLinks
                  .filter(x => x?.url)
                  .filter(x =>
                    isPdf(
                      x.url,
                      x.text
                    )
                  )
                  .find(x =>
                    /notification|employment|recruit|scholarship|scheme|notice|corrigendum/i
                      .test(
                        `${x.text || ""} ${x.url}`
                      )
                  );

              if (pdf) {
                notificationUrl =
                  pdf.url;
              }

              /*
               * Find actual application URL.
               */
              const application =
                detailLinks
                  .filter(x => x?.url)
                  .filter(x =>
                    !isPdf(
                      x.url,
                      x.text
                    )
                  )
                  .filter(x =>
                    /apply|application|registration|online|new registration|click here/i
                      .test(
                        `${x.text || ""} ${x.url}`
                      )
                  )
                  .find(x =>
                    !sameUrl(
                      x.url,
                      notificationUrl
                    )
                  );

              if (application) {
                applyUrl =
                  application.url;
              }
            }
          } catch {
            /*
             * Detail-page failure should not
             * stop the rest of LIC discovery.
             */
          }
        }

        /*
         * Prevent duplicate candidates.
         */
        const duplicate =
          candidates.some(
            item =>
              sameUrl(
                item.source_url,
                url
              )
          );

        if (duplicate) {
          continue;
        }

        candidates.push({
          type,

          title,

          organization:
            "Life Insurance Corporation of India (LIC)",

          category:
            type === "scholarship"
              ? "Scholarship"
              : type === "job"
              ? "LIC Recruitment"
              : "LIC Official Update",

          description:
            `Official LIC ${type} update: ${title}`,

          official_url:
            url,

          notification_url:
            notificationUrl,

          apply_url:
            applyUrl,

          /*
           * Keep the discovered official
           * source link as the identity.
           */
          source_url:
            url,

          source_name:
            source.name
        });

        /*
         * Keep the number of candidates
         * controlled for Worker limits.
         */
        if (
          candidates.length >=
          CANDIDATE_LIMIT
        ) {
          break;
        }
      }
    } catch {
      /*
       * One LIC section failing must not
       * stop another LIC section.
       */
      continue;
    }
  }

  return candidates;
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
