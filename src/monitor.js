import { adapters } from "./sources.js";
import { verifyCandidate, sha256Hex, slugify } from "./verification.js";

const SOURCES_PER_RUN = 4;
const MAX_CANDIDATES_PER_SOURCE = 8;

export async function runMonitor(env) {
  const started = new Date().toISOString();

  /*
   * IMPORTANT:
   * Do not process all sources in one invocation.
   * We rotate through the sources using last_checked_at.
   */
  const sourcesResult = await env.DB.prepare(`
    SELECT *
    FROM sources
    WHERE enabled=1
    ORDER BY
      CASE WHEN last_checked_at IS NULL THEN 0 ELSE 1 END ASC,
      last_checked_at ASC,
      priority ASC
    LIMIT ?
  `).bind(SOURCES_PER_RUN).all();

  const sources = sourcesResult.results || [];

  let discovered = 0;
  let published = 0;
  let updated = 0;
  let blocked = 0;
  let errors = 0;

  const details = [];

  for (const source of sources) {
    try {
      const adapter = adapters[source.adapter] || adapters.generic;

      let candidates = await adapter(source);

      if (!Array.isArray(candidates)) {
        candidates = [];
      }

      /*
       * Safety limit:
       * Never process an unlimited number of candidates from one source.
       */
      candidates = candidates.slice(0, MAX_CANDIDATES_PER_SOURCE);

      discovered += candidates.length;

      for (const candidate of candidates) {
        try {
          const verification = verifyCandidate(candidate, source);

          const hash = await sha256Hex(
            JSON.stringify(candidate)
          );

          const slug = `${slugify(candidate.title || "job")}-${hash.slice(0, 10)}`;

          /*
           * Only one lookup is required.
           */
          const existing = await env.DB.prepare(`
            SELECT id
            FROM items
            WHERE source_url=?
            LIMIT 1
          `).bind(candidate.source_url || null).first();

          /*
           * Candidate failed verification.
           */
          if (!verification.publish) {
            blocked++;

            if (existing) {
              await env.DB.prepare(`
                INSERT INTO verification_events(
                  item_id,
                  event_type,
                  passed,
                  score,
                  details
                )
                VALUES(?,?,?,?,?)
              `).bind(
                existing.id,
                "monitor_recheck",
                0,
                verification.score,
                JSON.stringify(verification.evidence)
              ).run();
            }

            continue;
          }

          const now = new Date().toISOString();

          const values = [
            candidate.type || "job",
            candidate.title || "Untitled",
            candidate.organization || source.name,
            candidate.category || null,
            candidate.location || null,
            candidate.description || null,
            candidate.qualification || null,
            candidate.vacancies || null,
            candidate.age_limit || null,
            candidate.fee || null,
            candidate.selection_process || null,
            candidate.salary || null,
            candidate.application_start || null,
            candidate.last_date || null,
            candidate.exam_date || null,
            candidate.date_posted || now.slice(0, 10),
            candidate.official_url || null,
            candidate.apply_url || null,
            candidate.notification_url || null,
            candidate.source_url || null,
            source.name,
            source.id,
            hash,
            "published",
            "verified",
            verification.score,
            JSON.stringify(verification.evidence),
            now,
            now,
            now
          ];

          if (existing) {
            await env.DB.prepare(`
              UPDATE items SET
                type=?,
                title=?,
                organization=?,
                category=?,
                location=?,
                description=?,
                qualification=?,
                vacancies=?,
                age_limit=?,
                fee=?,
                selection_process=?,
                salary=?,
                application_start=?,
                last_date=?,
                exam_date=?,
                date_posted=?,
                official_url=?,
                apply_url=?,
                notification_url=?,
                source_url=?,
                source_name=?,
                source_id=?,
                source_hash=?,
                status=?,
                verification_status=?,
                confidence_score=?,
                evidence_json=?,
                last_verified_at=?,
                last_seen_at=?,
                updated_at=CURRENT_TIMESTAMP
              WHERE id=?
            `).bind(
              ...values.slice(0, 29),
              existing.id
            ).run();

            updated++;
          } else {
            /*
             * 30 columns = 30 placeholders.
             * published_at receives the final "now" value.
             */
            await env.DB.prepare(`
              INSERT INTO items(
                type,
                title,
                organization,
                category,
                location,
                description,
                qualification,
                vacancies,
                age_limit,
                fee,
                selection_process,
                salary,
                application_start,
                last_date,
                exam_date,
                date_posted,
                official_url,
                apply_url,
                notification_url,
                source_url,
                source_name,
                source_id,
                source_hash,
                status,
                verification_status,
                confidence_score,
                evidence_json,
                last_verified_at,
                last_seen_at,
                published_at
              )
              VALUES(
                ?,?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,?,
                ?
              )
            `).bind(...values).run();

            published++;
          }
        } catch (candidateError) {
          errors++;

          details.push({
            source: source.name,
            candidate: candidate.title || "Unknown candidate",
            error: String(
              candidateError?.message || candidateError
            )
          });
        }
      }

      const checkedAt = new Date().toISOString();

      await env.DB.prepare(`
        UPDATE sources
        SET
          last_checked_at=?,
          last_success_at=?,
          last_error=NULL
        WHERE id=?
      `).bind(
        checkedAt,
        checkedAt,
        source.id
      ).run();

    } catch (sourceError) {
      errors++;

      const errorMessage = String(
        sourceError?.message || sourceError
      );

      await env.DB.prepare(`
        UPDATE sources
        SET
          last_checked_at=?,
          last_error=?
        WHERE id=?
      `).bind(
        new Date().toISOString(),
        errorMessage,
        source.id
      ).run();

      details.push({
        source: source.name,
        error: errorMessage
      });
    }
  }

  const finished = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO monitor_runs(
      started_at,
      finished_at,
      source_count,
      discovered_count,
      published_count,
      updated_count,
      blocked_count,
      error_count,
      details
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
    JSON.stringify(details)
  ).run();

  return {
    started,
    finished,
    sources: sources.length,
    discovered,
    published,
    updated,
    blocked,
    errors
  };
}
