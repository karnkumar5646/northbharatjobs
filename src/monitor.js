import adapters from "./sources.js";
import { verifyCandidate, sha256Hex, slugify } from "./verification.js";

const SOURCES_PER_RUN = 4;
const MAX_CANDIDATES_PER_SOURCE = 8;

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getArchiveReason(item, now = new Date()) {
  const lastDate = validDate(item.last_date);
  if (lastDate) {
    const expiryDate = new Date(lastDate.getTime());
    expiryDate.setUTCDate(expiryDate.getUTCDate() + 30);
    if (now >= expiryDate) {
      return "Application last date passed more than 30 days ago";
    }
  }

  const baseDate =
    validDate(item.date_posted) ||
    validDate(item.created_at);

  if (baseDate) {
    const oneYearLater = new Date(baseDate.getTime());
    oneYearLater.setUTCFullYear(oneYearLater.getUTCFullYear() + 1);
    if (now >= oneYearLater) {
      return "Item is older than one year";
    }
  }

  return null;
}

async function archiveExpiredItems(env) {
  const result = await env.DB.prepare(`
    SELECT id, last_date, date_posted, created_at
    FROM items
    WHERE status='published'
  `).all();

  const now = new Date();
  let archived = 0;

  for (const item of result.results || []) {
    const reason = getArchiveReason(item, now);
    if (!reason) continue;

    await env.DB.prepare(`
      UPDATE items
      SET status='archived',
          archived_at=?,
          archive_reason=?,
          updated_at=?
      WHERE id=? AND status='published'
    `).bind(
      now.toISOString(),
      reason,
      now.toISOString(),
      item.id
    ).run();

    archived++;
  }

  return archived;
}

function firstValue(...values) {
  return values.find(value =>
    value !== null &&
    value !== undefined &&
    String(value).trim() !== ""
  ) || null;
}

/*
 * Stable notification identity.
 *
 * Priority:
 * 1. Explicit notification_key supplied by adapter
 * 2. Canonical official detail URL
 * 3. Official notification PDF
 * 4. Official source URL
 *
 * source_url alone is intentionally the last fallback because
 * many source pages are listing/index pages.
 */
function getNotificationKey(candidate) {
  return firstValue(
    candidate?.notification_key,
    candidate?.notificationKey,
    candidate?.canonical_url,
    candidate?.canonicalUrl,
    candidate?.notification_url,
    candidate?.notificationUrl,
    candidate?.source_url
  );
}

function getCanonicalUrl(candidate) {
  return firstValue(
    candidate?.canonical_url,
    candidate?.canonicalUrl,
    candidate?.official_url,
    candidate?.officialUrl,
    candidate?.source_url
  );
}

async function findExisting(env, source, candidate, notificationKey, canonicalUrl) {
  const sourceId = source?.id || null;
  const notificationUrl = candidate?.notification_url || null;
  const sourceUrl = candidate?.source_url || null;

  if (sourceId && notificationKey) {
    const r = await env.DB.prepare(`
      SELECT *
      FROM items
      WHERE source_id=?
        AND notification_key=?
      ORDER BY id DESC
      LIMIT 1
    `).bind(sourceId, notificationKey).first();
    if (r) return r;
  }

  if (sourceId && canonicalUrl) {
    const r = await env.DB.prepare(`
      SELECT *
      FROM items
      WHERE source_id=?
        AND canonical_url=?
      ORDER BY id DESC
      LIMIT 1
    `).bind(sourceId, canonicalUrl).first();
    if (r) return r;
  }

  if (sourceId && notificationUrl) {
    const r = await env.DB.prepare(`
      SELECT *
      FROM items
      WHERE source_id=?
        AND notification_url=?
      ORDER BY id DESC
      LIMIT 1
    `).bind(sourceId, notificationUrl).first();
    if (r) return r;
  }

  if (sourceId && sourceUrl) {
    const r = await env.DB.prepare(`
      SELECT *
      FROM items
      WHERE source_id=?
        AND source_url=?
      ORDER BY id DESC
      LIMIT 1
    `).bind(sourceId, sourceUrl).first();
    if (r) return r;
  }

  return null;
}

function candidateValues(candidate, source, verification, hash, slug, notificationKey, canonicalUrl, now, existing) {
  return [
    candidate?.type || "update",
    slug,
    notificationKey,
    candidate?.title || "Government Update",
    candidate?.organization || source?.name || null,
    candidate?.category || null,
    candidate?.location || null,
    candidate?.description || null,
    candidate?.eligibility || null,
    candidate?.qualification || null,
    candidate?.vacancies || null,
    candidate?.age_limit || null,
    candidate?.age_relaxation || null,
    candidate?.fee || null,
    candidate?.selection_process || null,
    candidate?.salary || null,
    candidate?.application_start || null,
    candidate?.last_date || null,
    candidate?.exam_date || null,
    candidate?.how_to_apply || null,
    candidate?.important_dates || null,
    candidate?.official_url || null,
    candidate?.apply_url || null,
    candidate?.notification_url || null,
    candidate?.source_url || null,
    source?.name || null,
    source?.id || null,
    hash,
    canonicalUrl,
    "published",
    verification.verification_status,
    verification.score,
    JSON.stringify(verification.evidence || []),
    candidate?.change_summary || null,
    now,
    now,
    existing?.published_at || now,
    null,
    null
  ];
}

export async function runMonitor(env, requestedSource = null) {
  const started = new Date().toISOString();
  let archived = 0;

  try {
    archived = await archiveExpiredItems(env);
  } catch (error) {
    console.error("Archive system error:", error);
  }

  let sources = [];

  if (requestedSource) {
    const sourceName = String(requestedSource).trim();

    const result = await env.DB.prepare(`
      SELECT *
      FROM sources
      WHERE enabled=1
        AND (name=? COLLATE NOCASE OR adapter=? COLLATE NOCASE)
      LIMIT 1
    `).bind(sourceName, sourceName).all();

    sources = result.results || [];

    if (!sources.length) {
      throw new Error(`Enabled source not found: ${sourceName}`);
    }
  } else {
    const result = await env.DB.prepare(`
      SELECT *
      FROM sources
      WHERE enabled=1
      ORDER BY
        CASE WHEN last_checked_at IS NULL THEN 0 ELSE 1 END ASC,
        last_checked_at ASC,
        priority ASC
      LIMIT ?
    `).bind(SOURCES_PER_RUN).all();

    sources = result.results || [];
  }

  let discovered = 0;
  let published = 0;
  let updated = 0;
  let blocked = 0;
  let errors = 0;
  const details = [];

  for (const source of sources) {
    try {
      const adapter =
        adapters?.[source.adapter] ||
        adapters?.generic;

      if (typeof adapter !== "function") {
        throw new Error(`Adapter not found: ${source.adapter || "generic"}`);
      }

      let candidates = await adapter(source);
      if (!Array.isArray(candidates)) candidates = [];
      candidates = candidates.slice(0, MAX_CANDIDATES_PER_SOURCE);
      discovered += candidates.length;

      for (const candidate of candidates) {
        try {
          const verification = verifyCandidate(candidate, source);

          if (!verification.publish) {
            blocked++;
            details.push({
              source: source.name,
              candidate: candidate?.title || "Unknown candidate",
              status: "blocked",
              reason: verification.evidence
                ?.filter(x => x && x.passed === false)
                ?.map(x => x.reason || x.check)
                ?.slice(0, 5)
            });
            continue;
          }

          const hash = await sha256Hex(JSON.stringify(candidate));
          const baseSlug = slugify(candidate?.title || "government-update");
          const newSlug = `${baseSlug}-${hash.slice(0, 10)}`;
          const notificationKey = getNotificationKey(candidate);
          const canonicalUrl = getCanonicalUrl(candidate);
          const now = new Date().toISOString();

          const existing = await findExisting(
            env,
            source,
            candidate,
            notificationKey,
            canonicalUrl
          );

          if (existing) {
            await env.DB.prepare(`
              UPDATE items
              SET type=?,
                  title=?,
                  organization=?,
                  category=?,
                  location=?,
                  description=?,
                  eligibility=?,
                  qualification=?,
                  vacancies=?,
                  age_limit=?,
                  age_relaxation=?,
                  fee=?,
                  selection_process=?,
                  salary=?,
                  application_start=?,
                  last_date=?,
                  exam_date=?,
                  how_to_apply=?,
                  important_dates=?,
                  official_url=?,
                  apply_url=?,
                  notification_url=?,
                  source_url=?,
                  source_name=?,
                  source_hash=?,
                  canonical_url=?,
                  verification_status=?,
                  confidence_score=?,
                  evidence_json=?,
                  change_summary=?,
                  last_verified_at=?,
                  last_seen_at=?,
                  updated_at=?,
                  status='published',
                  archived_at=NULL,
                  archive_reason=NULL
              WHERE id=?
            `).bind(
              candidate?.type || existing.type,
              candidate?.title || existing.title,
              candidate?.organization || source.name || existing.organization,
              candidate?.category || existing.category,
              candidate?.location || existing.location,
              candidate?.description || existing.description,
              candidate?.eligibility || existing.eligibility,
              candidate?.qualification || existing.qualification,
              candidate?.vacancies || existing.vacancies,
              candidate?.age_limit || existing.age_limit,
              candidate?.age_relaxation || existing.age_relaxation,
              candidate?.fee || existing.fee,
              candidate?.selection_process || existing.selection_process,
              candidate?.salary || existing.salary,
              candidate?.application_start || existing.application_start,
              candidate?.last_date || existing.last_date,
              candidate?.exam_date || existing.exam_date,
              candidate?.how_to_apply || existing.how_to_apply,
              candidate?.important_dates || existing.important_dates,
              candidate?.official_url || existing.official_url,
              candidate?.apply_url || existing.apply_url,
              candidate?.notification_url || existing.notification_url,
              candidate?.source_url || existing.source_url,
              source.name || existing.source_name,
              hash,
              canonicalUrl || existing.canonical_url,
              verification.verification_status,
              verification.score,
              JSON.stringify(verification.evidence || []),
              candidate?.change_summary || null,
              now,
              now,
              now,
              existing.id
            ).run();

            updated++;
            details.push({
              source: source.name,
              candidate: candidate?.title || existing.title,
              status: "updated",
              id: existing.id
            });
          } else {
            const values = candidateValues(
              candidate,
              source,
              verification,
              hash,
              newSlug,
              notificationKey,
              canonicalUrl,
              now,
              null
            );

            await env.DB.prepare(`
              INSERT INTO items(
                type, slug, notification_key, title, organization, category, location,
                description, eligibility, qualification, vacancies, age_limit, age_relaxation,
                fee, selection_process, salary, application_start, last_date, exam_date,
                how_to_apply, important_dates, official_url, apply_url, notification_url,
                source_url, source_name, source_id, source_hash, canonical_url, status,
                verification_status, confidence_score, evidence_json, change_summary,
                last_verified_at, last_seen_at, published_at, archived_at, archive_reason
              )
              VALUES(
                ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
              )
            `).bind(...values).run();

            published++;
            details.push({
              source: source.name,
              candidate: candidate?.title || "Government Update",
              status: "published"
            });
          }
        } catch (candidateError) {
          errors++;
          details.push({
            source: source.name,
            candidate: candidate?.title || "Unknown candidate",
            status: "error",
            error: String(candidateError?.message || candidateError)
          });
        }
      }

      const checkedAt = new Date().toISOString();
      await env.DB.prepare(`
        UPDATE sources
        SET last_checked_at=?, last_success_at=?, last_error=NULL
        WHERE id=?
      `).bind(checkedAt, checkedAt, source.id).run();

    } catch (sourceError) {
      errors++;
      const errorMessage = String(sourceError?.message || sourceError);

      await env.DB.prepare(`
        UPDATE sources
        SET last_checked_at=?, last_error=?
        WHERE id=?
      `).bind(new Date().toISOString(), errorMessage, source.id).run();

      details.push({
        source: source.name,
        status: "error",
        error: errorMessage
      });
    }
  }

  const finished = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO monitor_runs(
      started_at, finished_at, source_count, discovered_count,
      published_count, updated_count, blocked_count, error_count, details
    )
    VALUES(?,?,?,?,?,?,?,?,?)
  `).bind(
    started,
    finished,
    sources.length,
    discovered,
    published,
    updated,
    blocked,
    errors,
    JSON.stringify({
      archived,
      requested_source: requestedSource || null,
      details
    })
  ).run();

  return {
    ok: true,
    started,
    finished,
    requested_source: requestedSource || null,
    sources: sources.length,
    discovered,
    published,
    updated,
    blocked,
    errors,
    archived,
    details
  };
}
