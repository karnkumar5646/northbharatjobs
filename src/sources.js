/*
  Source adapters are deliberately conservative.
  URL roles are kept separate:
    official_url     = related official recruitment/detail page
    notification_url = related official notification PDF
    apply_url        = related official application page/form
  No URL is invented and a homepage is never reused as all three links.
*/

const COMMON_KEYWORDS = {
  job: ["recruitment","vacancy","notification","advertisement","career","employment","post"],
  admit_card: ["admit card","hall ticket","call letter"],
  result: ["result","score card","merit list","selection list"],
  answer_key: ["answer key","answer-key","provisional key","final key"],
  syllabus: ["syllabus","exam pattern"],
  admission: ["admission","entrance","application"],
  scholarship: ["scholarship","fellowship"],
  update: ["corrigendum","notice","important","exam date","city intimation","correction"]
};

const APPLY_WORDS = [
  "apply online", "online application", "application form", "apply now",
  "registration", "register online", "online registration", "application portal"
];
const NOTIFICATION_WORDS = [
  "notification", "advertisement", "detailed advertisement", "official notification",
  "notice", "recruitment notice", "vacancy notice", "pdf"
];

function abs(base, href) {
  try { return new URL(href, base).href; } catch { return null; }
}
function clean(s) { return (s || "").replace(/\s+/g," ").trim(); }
function hostOf(value) { try { return new URL(value).hostname.toLowerCase(); } catch { return ""; } }
function domainAllowed(url, allowedDomains) {
  const host = hostOf(url);
  return Boolean(host) && allowedDomains.split(";").some(d => host === d || host.endsWith("." + d));
}
function isPdf(url, text = "") {
  return /\.pdf(?:$|[?#])/i.test(url || "") || /\bpdf\b/i.test(text || "");
}
function scoreText(text, words) {
  const t = clean(text).toLowerCase();
  return words.reduce((n, word) => n + (t.includes(word) ? 1 : 0), 0);
}
function classify(text) {
  const t = text.toLowerCase();
  for (const [type, words] of Object.entries(COMMON_KEYWORDS)) {
    if (words.some(w => t.includes(w))) return type;
  }
  return null;
}

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = abs(baseUrl, m[1]);
    const text = clean(m[2].replace(/<[^>]+>/g," "));
    if (url && text) links.push({ url, text });
  }

  // Some official application portals expose the destination only in a form action.
  const formRe = /<form\b[^>]*action=["']([^"']+)["'][^>]*>/gi;
  while ((m = formRe.exec(html))) {
    const url = abs(baseUrl, m[1]);
    if (url) links.push({ url, text: "online application form" });
  }
  return links;
}

async function fetchHtml(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { "User-Agent": "NorthBharatJobsBot/2.1 (+official-source-monitor)" },
    redirect: "follow"
  });
  if (!res.ok) return null;
  const type = res.headers.get("content-type") || "";
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) return null;
  return { html: await res.text(), finalUrl: res.url || url };
}

async function resolveOfficialLinks(candidate, source, fetchImpl) {
  // Never treat a PDF itself as the recruitment/detail page.
  if (isPdf(candidate.official_url, candidate.title)) {
    return { ...candidate, official_url: null, notification_url: null, apply_url: null };
  }

  if (!domainAllowed(candidate.official_url, source.allowed_domains)) {
    return { ...candidate, official_url: null, notification_url: null, apply_url: null };
  }

  const page = await fetchHtml(candidate.official_url, fetchImpl);
  if (!page) return { ...candidate, notification_url: null, apply_url: null };

  const links = extractLinks(page.html, page.finalUrl);
  const officialUrl = domainAllowed(page.finalUrl, source.allowed_domains) ? page.finalUrl : candidate.official_url;

  const pdfCandidates = links
    .filter(x => domainAllowed(x.url, source.allowed_domains) && isPdf(x.url, x.text))
    .map(x => ({ ...x, score: scoreText(x.text + " " + x.url, NOTIFICATION_WORDS) }))
    .sort((a,b) => b.score - a.score);

  const applyCandidates = links
    .filter(x => domainAllowed(x.url, source.allowed_domains) && !isPdf(x.url, x.text))
    .map(x => ({ ...x, score: scoreText(x.text + " " + x.url, APPLY_WORDS) }))
    .filter(x => x.score > 0)
    .sort((a,b) => b.score - a.score);

  const notification = pdfCandidates[0]?.url || null;
  const apply = applyCandidates[0]?.url || null;

  // A job is publishable only when all three roles are genuinely different.
  if (candidate.type === "job") {
    const same = (a,b) => Boolean(a && b && a === b);
    if (!officialUrl || !notification || !apply || same(officialUrl, notification) || same(officialUrl, apply) || same(notification, apply)) {
      return { ...candidate, official_url: null, notification_url: null, apply_url: null };
    }
  }

  return {
    ...candidate,
    official_url: officialUrl,
    notification_url: notification,
    apply_url: apply
  };
}

export async function genericDiscovery(source, fetchImpl = fetch) {
  const res = await fetchImpl(source.base_url, {
    headers: { "User-Agent": "NorthBharatJobsBot/2.1 (+official-source-monitor)" },
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 100) {
    const title = clean(m[2].replace(/<[^>]+>/g," "));
    const url = abs(source.base_url, m[1]);
    if (!url || !title || title.length < 8) continue;
    const type = classify(title);
    if (!type) continue;

    const candidate = {
      type, title,
      organization: source.name,
      official_url: url,
      source_url: url,
      source_name: source.name,
      description: title
    };

    out.push(await resolveOfficialLinks(candidate, source, fetchImpl));
  }
  return out;
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
