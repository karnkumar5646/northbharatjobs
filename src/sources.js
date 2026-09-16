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
    return new URL(a).href === new URL(b).href;
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

  /*
   * More specific types first.
   * "recruitment application" should remain a job candidate.
   */
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

function extractLinks(html, baseUrl, limit = 100) {
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
   * Some portals put useful URLs in buttons or script-generated
   * attributes. These are only added when an explicit URL exists.
   */
  const urlRe =
    /(?:href|data-href|data-url|data-link)=["']([^"']+)["']/gi;

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
  const type = classify(
    `${link.text} ${link.url}`
  );

  if (!type) return null;

  return {
    type,
    title: clean(link.text).slice(0, 300),
    organization: source.name,
    official_url: link.url,
    source_url: link.url,
    source_name: source.name,
    description: clean(link.text).slice(0, 500)
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
    .sort((a, b) => b.score - a.score)
    .find(link => link.score > 0)?.url || null;
}

function chooseApply(links, source, officialUrl) {
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
