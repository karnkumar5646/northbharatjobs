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

function hostOf(value) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ""; }
}

function domainAllowed(url, allowedDomains) {
  const host = hostOf(url);
  return allowedDomains.split(";").some(d => host === d || host.endsWith("." + d));
}

export function verifyCandidate(candidate, source) {
  const evidence = [];
  let score = 0;

  const officialOk = domainAllowed(candidate.official_url || "", source.allowed_domains);
  evidence.push({ check: "official_domain", passed: officialOk });
  if (officialOk) score += 35;

  const sourceOk = domainAllowed(candidate.source_url || "", source.allowed_domains);
  evidence.push({ check: "source_domain", passed: sourceOk });
  if (sourceOk) score += 20;

  const titleOk = Boolean(candidate.title && candidate.title.trim().length >= 8);
  evidence.push({ check: "title", passed: titleOk });
  if (titleOk) score += 10;

  const typeOk = Object.hasOwn(TYPE_LABELS, candidate.type);
  evidence.push({ check: "type", passed: typeOk });
  if (typeOk) score += 10;

  const linkOk = /^https?:\/\//i.test(candidate.official_url || "");
  evidence.push({ check: "official_url_format", passed: linkOk });
  if (linkOk) score += 10;

  const notificationOk = candidate.type === "job"
    ? /^https?:\/\//i.test(candidate.notification_url || "") && /\.pdf(?:$|[?#])/i.test(candidate.notification_url || "") && domainAllowed(candidate.notification_url, source.allowed_domains)
    : true;
  evidence.push({ check: "notification_pdf", passed: notificationOk });
  if (notificationOk) score += 10;

  const applyOk = candidate.type === "job"
    ? /^https?:\/\//i.test(candidate.apply_url || "") && domainAllowed(candidate.apply_url, source.allowed_domains)
    : true;
  evidence.push({ check: "apply_url", passed: applyOk });
  if (applyOk) score += 10;

  const distinctLinks = candidate.type === "job"
    ? Boolean(candidate.official_url && candidate.notification_url && candidate.apply_url &&
      candidate.official_url !== candidate.notification_url &&
      candidate.official_url !== candidate.apply_url &&
      candidate.notification_url !== candidate.apply_url)
    : true;
  evidence.push({ check: "distinct_link_roles", passed: distinctLinks });
  if (distinctLinks) score += 10;

  const noFake = !/(example\.com|example\.org|localhost|127\.0\.0\.1|demo|dummy|fake)/i.test(
    `${candidate.official_url || ""} ${candidate.apply_url || ""} ${candidate.notification_url || ""}`
  );
  evidence.push({ check: "no_placeholder_url", passed: noFake });
  if (noFake) score += 15;

  const publish = officialOk && sourceOk && titleOk && typeOk && linkOk && noFake && notificationOk && applyOk && distinctLinks && score >= 90;
  return {
    score,
    publish,
    status: publish ? "published" : "blocked",
    verification_status: publish ? "verified" : "blocked",
    evidence
  };
}

export function sha256Hex(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    .then(buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2,"0")).join(""));
}

export function slugify(text) {
  return text.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,120);
}
