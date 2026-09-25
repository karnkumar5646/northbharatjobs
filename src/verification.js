/*
  North Bharat Jobs
  Verification Engine

  Purpose:
  - Block generic navigation pages
  - Block fake/demo URLs
  - Require official domains
  - Require meaningful titles
  - Require real recruitment links for jobs
  - Keep verification evidence for audit
*/

const TYPE_LABELS = {
  job: "Latest Jobs",
  admit_card: "Admit Card",
  result: "Results",
  answer_key: "Answer Key",
  syllabus: "Syllabus",
  admission: "Admission",
  scholarship: "Scholarship",
  update: "Important Updates"
};

/* -------------------------------- */
/* Generic / useless title blockers */
/* -------------------------------- */

const GENERIC_TITLES = [
  "home",
  "homepage",
  "home page",
  "welcome",
  "welcome to official website",

  "notice",
  "notices",
  "notice board",
  "सूचना पट्ट",
  "सूचना पटल",
  "सूचना बोर्ड",

  "click here",
  "click here to download",
  "click here to download admit card",
  "download admit card",
  "download",
  "download here",

  "read more",
  "view more",
  "view details",
  "click here",

  "login",
  "sign in",
  "register",
  "registration",

  "contact",
  "contact us",
  "about",
  "about us",

  "privacy policy",
  "terms",
  "terms and conditions",

  "menu",
  "search",
  "search result",
  "website",
  "official website"
];

/* -------------------------------- */
/* Generic URL fragments            */
/* -------------------------------- */

const GENERIC_URL_PARTS = [
  "/home",
  "/index",
  "index.htm",
  "index.html",
  "/noticeboard",
  "/notice-board",
  "/notices",
  "/login",
  "/signin",
  "/sign-in",
  "/contact",
  "/about"
];

/* -------------------------------- */
/* Useful content keywords          */
/* -------------------------------- */

const ADMINISTRATIVE_PATTERNS = [
  "administrative",
  "administration",
  "office order",
  "office memorandum",
  "memorandum",
  "right to information",
  "rti",
  "policy",
  "procedure",
  "guidelines",
  "minutes",
  "annual report",
  "financial statement",
  "press release",
  "tender",
  "procurement",
  "vendor",
  "customer care",
  "citizen charter"
];

const STRONG_TYPE_PATTERNS = {
  job: [
    "recruitment",
    "recruitment notification",
    "recruitment notice",
    "vacancy",
    "vacancies",
    "employment notice",
    "direct recruitment",
    "selection post",
    "advertisement for recruitment",
    "engagement of"
  ],
  answer_key: [
    "answer key",
    "provisional answer key",
    "final answer key",
    "answer-key"
  ],
  result: [
    "final result",
    "exam result",
    "result of",
    "result for",
    "merit list",
    "selection list",
    "score card",
    "scorecard"
  ],
  admit_card: [
    "admit card",
    "hall ticket",
    "call letter"
  ],
  syllabus: [
    "syllabus",
    "exam pattern",
    "scheme of examination"
  ]
};

const TYPE_KEYWORDS = {
  job: [
    "recruitment",
    "recruitment notification",
    "recruitment notice",
    "vacancy",
    "vacancies",
    "advertisement",
    "employment",
    "career",
    "careers",
    "job",
    "jobs",
    "post",
    "posts",
    "selection post",
    "direct recruitment",
    "engagement",
    "hiring"
  ],

  admit_card: [
    "admit card",
    "admit-card",
    "hall ticket",
    "call letter",
    "download admit",
    "exam admit"
  ],

  result: [
    "result",
    "results",
    "score card",
    "scorecard",
    "merit list",
    "selection list",
    "final result",
    "exam result"
  ],

  answer_key: [
    "answer key",
    "answer-key",
    "provisional key",
    "final key",
    "answer sheet"
  ],

  syllabus: [
    "syllabus",
    "exam pattern",
    "scheme of examination",
    "course syllabus"
  ],

  admission: [
    "admission",
    "entrance",
    "entrance examination",
    "application form",
    "admission notice"
  ],

  scholarship: [
    "scholarship",
    "fellowship",
    "scholarship application"
  ],

  update: [
    "corrigendum",
    "important notice",
    "exam date",
    "city intimation",
    "correction",
    "schedule",
    "extension",
    "postponed",
    "rescheduled",
    "latest update"
  ]
};

/* -------------------------------- */
/* Helpers                          */
/* -------------------------------- */

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function domainAllowed(
  url,
  allowedDomains = ""
) {
  const host = hostOf(url);

  if (!host) {
    return false;
  }

  return String(allowedDomains)
    .split(";")
    .map(x =>
      x.trim().toLowerCase()
    )
    .filter(Boolean)
    .some(domain =>
      host === domain ||
      host.endsWith("." + domain)
    );
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(
    String(value || "")
  );
}

function isPdf(value) {
  return /\.pdf(?:$|[?#])/i.test(
    String(value || "")
  );
}

function sameUrl(a, b) {
  if (!a || !b) {
    return false;
  }

  try {
    const ua = new URL(a);
    const ub = new URL(b);

    ua.hash = "";
    ub.hash = "";

    ua.pathname =
      ua.pathname.replace(/\/+$/, "");

    ub.pathname =
      ub.pathname.replace(/\/+$/, "");

    return ua.href === ub.href;
  } catch {
    return a === b;
  }
}

function containsKeyword(
  text,
  keywords
) {
  const value =
    normalizeText(text);

  return keywords.some(
    keyword =>
      value.includes(
        normalizeText(keyword)
      )
  );
}

/* -------------------------------- */
/* Generic title detection          */
/* -------------------------------- */

function isGenericTitle(title) {
  const value =
    normalizeText(title);

  if (!value) {
    return true;
  }

  if (
    GENERIC_TITLES.includes(value)
  ) {
    return true;
  }

  /*
   * Very short navigation labels
   */
  if (
    value.length < 8
  ) {
    return true;
  }

  /*
   * Common navigation phrases
   */
  if (
    /^(click here|click here to|download|read more|view more|view details)$/i.test(
      value
    )
  ) {
    return true;
  }

  /*
   * Generic notice-board wording
   */
  if (
    /^(notice|notices|notice board|सूचना पट्ट|सूचना पटल|सूचना बोर्ड)$/i.test(
      value
    )
  ) {
    return true;
  }

  return false;
}

/* -------------------------------- */
/* Generic URL detection             */
/* -------------------------------- */

function isGenericUrl(url) {
  const value =
    normalizeText(url);

  return GENERIC_URL_PARTS.some(
    part =>
      value.includes(
        normalizeText(part)
      )
  );
}

/* -------------------------------- */
/* Type-specific validation          */
/* -------------------------------- */

function validateTypeContent(
  candidate
) {
  const type = candidate?.type;

  const text = normalizeText([
    candidate?.title,
    candidate?.description,
    candidate?.official_url,
    candidate?.source_url,
    candidate?.organization
  ].join(" "));

  if (!TYPE_LABELS[type]) {
    return { passed: false, reason: "Unknown item type" };
  }

  const hasStrongRecruitment =
    STRONG_TYPE_PATTERNS.job.some(x => text.includes(normalizeText(x)));

  const administrativeOnly =
    ADMINISTRATIVE_PATTERNS.some(x => text.includes(normalizeText(x))) &&
    !hasStrongRecruitment;

  if (administrativeOnly) {
    return {
      passed: false,
      reason: "Administrative/policy page without strong recruitment context"
    };
  }

  if (type === "job") {
    if (!hasStrongRecruitment) {
      return { passed: false, reason: "Strong recruitment context not found" };
    }
    return { passed: true, reason: "Strong recruitment context verified" };
  }

  const strongPatterns = STRONG_TYPE_PATTERNS[type] || [];
  const hasStrongType = strongPatterns.some(x =>
    text.includes(normalizeText(x))
  );

  if (["answer_key","result","admit_card","syllabus"].includes(type)) {
    if (!hasStrongType) {
      return {
        passed: false,
        reason: `Strong ${TYPE_LABELS[type]} context not found`
      };
    }
    return {
      passed: true,
      reason: `Strong ${TYPE_LABELS[type]} context verified`
    };
  }

  if (!containsKeyword(text, TYPE_KEYWORDS[type])) {
    return {
      passed: false,
      reason: `No ${TYPE_LABELS[type]} keyword found`
    };
  }

  return { passed: true, reason: "Type context verified" };
}

/* -------------------------------- */
/* Recruitment URL validation       */
/* -------------------------------- */

function validateJobLinks(
  candidate,
  source
) {
  const evidence = [];

  const official =
    candidate?.official_url || "";

  const notification =
    candidate?.notification_url || "";

  const apply =
    candidate?.apply_url || "";

  /*
   * Official URL
   */
  const officialFormat =
    isHttpUrl(official);

  evidence.push({
    check:
      "official_url_format",
    passed:
      officialFormat
  });

  /*
   * Official domain
   */
  const officialDomain =
    domainAllowed(
      official,
      source.allowed_domains
    );

  evidence.push({
    check:
      "official_domain",
    passed:
      officialDomain
  });

  /*
   * Notification
   */
  const notificationFormat =
    isHttpUrl(notification);

  evidence.push({
    check:
      "notification_url_format",
    passed:
      notificationFormat
  });

  const notificationPdf =
    isPdf(notification);

  evidence.push({
    check:
      "notification_pdf",
    passed:
      notificationPdf
  });

  const notificationDomain =
    domainAllowed(
      notification,
      source.allowed_domains
    );

  evidence.push({
    check:
      "notification_domain",
    passed:
      notificationDomain
  });

  /*
   * Apply URL
   */
  const applyFormat =
    isHttpUrl(apply);

  evidence.push({
    check:
      "apply_url_format",
    passed:
      applyFormat
  });

  const applyDomain =
    domainAllowed(
      apply,
      source.allowed_domains
    );

  evidence.push({
    check:
      "apply_domain",
    passed:
      applyDomain
  });

  /*
   * Apply must NOT be PDF.
   */
  const applyNotPdf =
    applyFormat &&
    !isPdf(apply);

  evidence.push({
    check:
      "apply_not_pdf",
    passed:
      applyNotPdf
  });

  /*
   * All three links must be
   * different.
   */
  const distinct =
    official &&
    notification &&
    apply &&
    !sameUrl(
      official,
      notification
    ) &&
    !sameUrl(
      official,
      apply
    ) &&
    !sameUrl(
      notification,
      apply
    );

  evidence.push({
    check:
      "distinct_link_roles",
    passed:
      Boolean(distinct)
  });

  const passed =
    officialFormat &&
    officialDomain &&
    notificationFormat &&
    notificationPdf &&
    notificationDomain &&
    applyFormat &&
    applyDomain &&
    applyNotPdf &&
    Boolean(distinct);

  return {
    passed,
    evidence
  };
}

/* -------------------------------- */
/* Placeholder/fake URL validation  */
/* -------------------------------- */

function validateNoFakeUrls(
  candidate
) {
  const combined =
    [
      candidate?.official_url,
      candidate?.notification_url,
      candidate?.apply_url,
      candidate?.source_url
    ]
      .filter(Boolean)
      .join(" ");

  const fakePattern =
    /(example\.com|example\.org|example\.net|localhost|127\.0\.0\.1|0\.0\.0\.0|dummy|fake|demo-url|sample-url)/i;

  const passed =
    !fakePattern.test(
      combined
    );

  return {
    passed,
    evidence: {
      check:
        "no_placeholder_url",
      passed
    }
  };
}

/* -------------------------------- */
/* Main verification                */
/* -------------------------------- */

export function verifyCandidate(
  candidate,
  source
) {
  const evidence = [];

  let score = 0;

  /*
   * Basic candidate checks
   */
  const title =
    cleanTitle(
      candidate?.title
    );

  const titleExists =
    Boolean(title);

  evidence.push({
    check:
      "title_exists",
    passed:
      titleExists
  });

  if (
    titleExists
  ) {
    score += 10;
  }

  /*
   * Generic title blocker
   */
  const genericTitle =
    isGenericTitle(title);

  evidence.push({
    check:
      "non_generic_title",
    passed:
      !genericTitle
  });

  if (
    !genericTitle
  ) {
    score += 20;
  }

  /*
   * Type
   */
  const typeValid =
    Boolean(
      candidate?.type &&
      TYPE_LABELS[
        candidate.type
      ]
    );

  evidence.push({
    check:
      "type",
    passed:
      typeValid
  });

  if (
    typeValid
  ) {
    score += 10;
  }

  /*
   * Official URL
   */
  const officialUrl =
    candidate?.official_url ||
    "";

  const officialFormat =
    isHttpUrl(
      officialUrl
    );

  evidence.push({
    check:
      "official_url_format",
    passed:
      officialFormat
  });

  if (
    officialFormat
  ) {
    score += 10;
  }

  /*
   * Official domain
   */
  const officialDomain =
    domainAllowed(
      officialUrl,
      source?.allowed_domains
    );

  evidence.push({
    check:
      "official_domain",
    passed:
      officialDomain
  });

  if (
    officialDomain
  ) {
    score += 25;
  }

  /*
   * Source URL
   */
  const sourceUrl =
    candidate?.source_url ||
    "";

  const sourceDomain =
    domainAllowed(
      sourceUrl,
      source?.allowed_domains
    );

  evidence.push({
    check:
      "source_domain",
    passed:
      sourceDomain
  });

  if (
    sourceDomain
  ) {
    score += 10;
  }

  /*
   * Generic URL blocker
   *
   * Do not block a legitimate
   * page only because it contains
   * "notice" in a path.
   *
   * This check only applies to
   * obvious generic navigation URLs.
   */
  const genericUrl =
    isGenericUrl(
      officialUrl
    );

  /*
   * Only strongly generic URLs
   * are rejected.
   */
  const genericUrlBlocked =
    genericUrl &&
    (
      !containsKeyword(
        title,
        TYPE_KEYWORDS[
          candidate?.type
        ] || []
      )
    );

  evidence.push({
    check:
      "specific_official_page",
    passed:
      !genericUrlBlocked
  });

  if (
    !genericUrlBlocked
  ) {
    score += 5;
  }

  /*
   * Type-specific content
   */
  const typeCheck =
    validateTypeContent(
      candidate
    );

  evidence.push({
    check:
      "type_specific_content",
    passed:
      typeCheck.passed,
    reason:
      typeCheck.reason
  });

  if (
    typeCheck.passed
  ) {
    score += 15;
  }

  /*
   * Fake URL check
   */
  const fakeCheck =
    validateNoFakeUrls(
      candidate
    );

  evidence.push(
    fakeCheck.evidence
  );

  if (
    fakeCheck.passed
  ) {
    score += 10;
  }

  /*
   * Recruitment-specific checks
   */
  let jobLinksPassed =
    true;

  if (
    candidate?.type === "job"
  ) {
    const jobLinks =
      validateJobLinks(
        candidate,
        source
      );

    jobLinksPassed =
      jobLinks.passed;

    evidence.push(
      ...jobLinks.evidence
    );

    if (
      jobLinks.passed
    ) {
      score += 35;
    }
  }

  /*
   * Non-job items do not require
   * notification/apply URLs.
   *
   * They still require:
   * - official domain
   * - meaningful title
   * - type context
   */
  const commonPassed =
    titleExists &&
    !genericTitle &&
    typeValid &&
    officialFormat &&
    officialDomain &&
    sourceDomain &&
    !genericUrlBlocked &&
    typeCheck.passed &&
    fakeCheck.passed;

  /*
   * Jobs require all three
   * distinct official links.
   */
  const publish =
    commonPassed &&
    jobLinksPassed &&
    score >=
      (
        candidate?.type === "job"
          ? 100
          : 70
      );

  return {
    score,
    publish,

    status:
      publish
        ? "published"
        : "blocked",

    verification_status:
      publish
        ? "verified"
        : "blocked",

    evidence
  };
}

/* -------------------------------- */
/* SHA-256                          */
/* -------------------------------- */

export function sha256Hex(
  text
) {
  return crypto.subtle
    .digest(
      "SHA-256",
      new TextEncoder().encode(
        String(text || "")
      )
    )
    .then(
      buffer =>
        [...new Uint8Array(buffer)]
          .map(
            x =>
              x
                .toString(16)
                .padStart(2, "0")
          )
          .join("")
    );
}

/* -------------------------------- */
/* Slug generation                  */
/* -------------------------------- */

export function slugify(
  text
) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    )
    .slice(
      0,
      120
    );
      }
