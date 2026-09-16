/*
  North Bharat Jobs
  Conservative official-source discovery.

  URL roles:
    official_url     = official recruitment/detail page
    notification_url = official notification PDF
    apply_url        = official application page/form

  No URL is invented.
  A homepage is never reused as all three roles.
*/

const COMMON_KEYWORDS = {
  job: [
    "recruitment",
    "vacancy",
    "notification",
    "advertisement",
    "career",
    "employment",
    "post",
    "recruitment notice"
  ],

  admit_card: [
    "admit card",
    "hall ticket",
    "call letter"
  ],

  result: [
    "result",
    "score card",
    "merit list",
    "selection list"
  ],

  answer_key: [
    "answer key",
    "answer-key",
    "provisional key",
    "final key"
  ],

  syllabus: [
    "syllabus",
    "exam pattern"
  ],

  admission: [
    "admission",
    "entrance",
    "application"
  ],

  scholarship: [
    "scholarship",
    "fellowship"
  ],

  update: [
    "corrigendum",
    "notice",
    "important notice",
    "exam date",
    "city intimation",
    "correction"
  ]
};

const APPLY_WORDS = [
  "apply online",
  "online application",
  "application form",
  "apply now",
  "registration",
  "register online",
  "online registration",
  "application portal",
  "application link"
];

const NOTIFICATION_WORDS = [
  "notification",
  "advertisement",
  "detailed advertisement",
  "official notification",
  "recruitment notice",
  "vacancy notice",
  "notification pdf",
  "advertisement pdf"
];

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

  /*
   * Job is checked first because "recruitment application"
   * should normally be treated as a recruitment item.
   */
  const orderedTypes = [
    "job",
    "admit_card",
    "result",
    "answer_key",
    "syllabus",
    "admission",
    "scholarship",
    "update"
  ];

  for (const type of orderedTypes) {
    const words = COMMON_KEYWORDS[type];

    if (words.some(word => value.includes(word))) {
      return type;
    }
  }

  return null;
}

function extractLinks(html, baseUrl, limit = 60) {
  const links = [];

  const anchorRe =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = anchorRe.exec(html)) && links.length < limit) {
    const url = abs(baseUrl, match[1]);

    const text = clean(
      match[2].replace(/<[^>]+>/g, " ")
    );

    if (!url || !text) continue;

    links.push({
      url,
      text
    });
  }

  /*
   * Some application portals expose their destination
   * through a form action.
   */
  const formRe =
    /<form\b[^>]*action=["']([^"']+)["'][^>]*>/gi;

  while ((match = formRe.exec(html)) && links.length < limit) {
    const url = abs(baseUrl, match[1]);

    if (!url) continue;

    links.push({
      url,
      text: "online application form"
    });
  }

  return links;
}

async function fetchHtml(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent":
        "NorthBharatJobsBot/2.2 (+official-source-monitor)",
      "Accept":
        "text/html,application/xhtml+xml"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (
    !/text\/html|application\/xhtml\+xml/i.test(
      contentType
    )
  ) {
    return null;
  }

  const html = await response.text();

  return {
    html,
    finalUrl: response.url || url
  };
}

function chooseNotification(links, source) {
  return links
    .filter(link =>
      domainAllowed(link.url, source.allowed_domains)
    )
    .filter(link =>
      isPdf(link.url, link.text)
    )
    .map(link => ({
      ...link,
      score: scoreText(
        `${link.text} ${link.url}`,
        NOTIFICATION_WORDS
      )
    }))
    .sort((a, b) => b.score - a.score)[0]?.url || null;
}

function chooseApply(links, source) {
  return links
    .filter(link =>
      domainAllowed(link.url, source.allowed_domains)
    )
    .filter(link =>
      !isPdf(link.url, link.text)
    )
    .map(link => ({
      ...link,
      score: scoreText(
        `${link.text} ${link.url}`,
        APPLY_WORDS
      )
    }))
    .filter(link => link.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.url || null;
}

async function resolveOfficialLinks(
  candidate,
  source,
  fetchImpl = fetch
) {
  const officialCandidate =
    candidate.official_url;

  /*
   * A PDF can never be the official detail page.
   */
  if (
    !officialCandidate ||
    isPdf(
      officialCandidate,
      candidate.title
    )
  ) {
    return {
      ...candidate,
      official_url: null,
      notification_url: null,
      apply_url: null
    };
  }

  /*
   * Only source-approved domains are allowed.
   */
  if (
    !domainAllowed(
      officialCandidate,
      source.allowed_domains
    )
  ) {
    return {
      ...candidate,
      official_url: null,
      notification_url: null,
      apply_url: null
    };
  }

  let page;

  try {
    page = await fetchHtml(
      officialCandidate,
      fetchImpl
    );
  } catch {
    return {
      ...candidate,
      notification_url: null,
      apply_url: null
    };
  }

  if (!page) {
    return {
      ...candidate,
      notification_url: null,
      apply_url: null
    };
  }

  const officialUrl =
    domainAllowed(
      page.finalUrl,
      source.allowed_domains
    )
      ? page.finalUrl
      : officialCandidate;

  /*
   * Keep the number of links examined small.
   */
  const links = extractLinks(
    page.html,
    page.finalUrl,
    60
  );

  const notification =
    chooseNotification(
      links,
      source
    );

  const apply =
    chooseApply(
      links,
      source
    );

  /*
   * Every role must remain genuinely different.
   */
  const sameUrl = (a, b) =>
    Boolean(a && b && a === b);

  /*
   * Recruitment jobs require all three official roles.
   */
  if (candidate.type === "job") {
    if (
      !officialUrl ||
      !notification ||
      !apply ||
      sameUrl(officialUrl, notification) ||
      sameUrl(officialUrl, apply) ||
      sameUrl(notification, apply)
    ) {
      return {
        ...candidate,
        official_url: null,
        notification_url: null,
        apply_url: null
      };
    }
  }

  return {
    ...candidate,
    official_url: officialUrl,
    notification_url: notification,
    apply_url: apply
  };
}

export async function genericDiscovery(
  source,
  fetchImpl = fetch
) {
  const response = await fetchImpl(
    source.base_url,
    {
      headers: {
        "User-Agent":
          "NorthBharatJobsBot/2.2 (+official-source-monitor)",
        "Accept":
          "text/html,application/xhtml+xml"
      },
      redirect: "follow"
    }
  );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (
    !/text\/html|application\/xhtml\+xml/i.test(
      contentType
    )
  ) {
    return [];
  }

  const html = await response.text();

  const links = extractLinks(
    html,
    response.url || source.base_url,
    80
  );

  /*
   * First classify links locally.
   * No network request is made here.
   */
  const candidates = [];

  const seen = new Set();

  for (const link of links) {
    if (candidates.length >= 12) break;

    if (
      !link.url ||
      !link.text ||
      link.text.length < 8
    ) {
      continue;
    }

    if (
      !domainAllowed(
        link.url,
        source.allowed_domains
      )
    ) {
      continue;
    }

    if (isPdf(link.url, link.text)) {
      continue;
    }

    const type = classify(link.text);

    if (!type) continue;

    /*
     * Avoid duplicate URLs.
     */
    const normalized =
      link.url.split("#")[0];

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);

    candidates.push({
      type,
      title: link.text,
      organization: source.name,
      official_url: normalized,
      source_url: normalized,
      source_name: source.name,
      description: link.text
    });
  }

  /*
   * Resolve only a small number of candidates.
   * This is the important subrequest protection.
   */
  const resolved = [];

  for (const candidate of candidates) {
    if (resolved.length >= 8) break;

    const item =
      await resolveOfficialLinks(
        candidate,
        source,
        fetchImpl
      );

    /*
     * Keep candidates even when verification fails.
     * verification.js decides whether they publish.
     */
    resolved.push(item);
  }

  return resolved;
}

export const adapters = {
  generic: genericDiscovery,

  ssc: genericDiscovery,
  upsc: genericDiscovery,
  ncs: genericDiscovery,
  railway: genericDiscovery,
  indiapost: genericDiscovery,
  ibps: genericDiscovery,
  sbi: genericDiscovery,
  rbi: genericDiscovery,
  bpsc: genericDiscovery,
  bssc: genericDiscovery,
  "bihar-police": genericDiscovery,
  "upsc-online": genericDiscovery,
  army: genericDiscovery,
  navy: genericDiscovery,
  airforce: genericDiscovery,
  drdo: genericDiscovery,
  isro: genericDiscovery,
  lic: genericDiscovery,
  epfo: genericDiscovery,
  esic: genericDiscovery,
  nta: genericDiscovery
};
