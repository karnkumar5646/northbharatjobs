import adapters from "./sources.js";
import {
  verifyCandidate,
  sha256Hex,
  slugify
} from "./verification.js";

const SOURCES_PER_RUN = 4;
const MAX_CANDIDATES_PER_SOURCE = 8;

/*
 * ----------------------------------------
 * Expiry / Archive helpers
 * ----------------------------------------
 */

function validDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

/*
 * A published item is archived when:
 *
 * 1. It has a last_date and 30 days have passed
 *    after that last date.
 *
 * 2. It has no last_date but is older than 1 year.
 *
 * 3. Any published item is older than 1 year.
 *
 * Database record is NEVER deleted.
 */
function getArchiveReason(item, now = new Date()) {
  /*
   * ----------------------------------------
   * Rule 1:
   * Last date + 30 days
   * ----------------------------------------
   */

  const lastDate = validDate(item.last_date);

  if (lastDate) {
    const expiryDate = new Date(lastDate.getTime());

    expiryDate.setUTCDate(
      expiryDate.getUTCDate() + 30
    );

    if (now >= expiryDate) {
      return "Application last date passed more than 30 days ago";
    }
  }

  /*
   * ----------------------------------------
   * Rule 2:
   * Maximum one year lifetime
   * ----------------------------------------
   */

  const baseDate =
    validDate(item.date_posted) ||
    validDate(item.created_at);

  if (baseDate) {
    const oneYearLater = new Date(baseDate.getTime());

    oneYearLater.setUTCFullYear(
      oneYearLater.getUTCFullYear() + 1
    );

    if (now >= oneYearLater) {
      return "Item is older than one year";
    }
  }

  return null;
}

/*
 * ----------------------------------------
 * Archive old published items
 * ----------------------------------------
 */

async function archiveExpiredItems(env) {
  const now = new Date();

  const result = await env.DB
    .prepare(`
      SELECT
        id,
        type,
        title,
        last_date,
        date_posted,
        created_at
      FROM items
      WHERE status = 'published'
    `)
    .all();

  const items = result.results || [];

  let archived = 0;

  for (const item of items) {
    try {
      const reason =
        getArchiveReason(item, now);

      if (!reason) {
        continue;
      }

      await env.DB
        .prepare(`
          UPDATE items
          SET
            status = 'archived',
            archived_at = ?,
            archive_reason = ?,
            updated_at = ?
          WHERE id = ?
            AND status = 'published'
        `)
        .bind(
          now.toISOString(),
          reason,
          now.toISOString(),
          item.id
        )
        .run();

      archived++;

    } catch (error) {
      console.error(
        "Archive error:",
        item?.id,
        error
      );
    }
  }

  return archived;
}

/*
 * ----------------------------------------
 * Monitor
 *
 * requestedSource:
 *   null  -> normal automatic monitor
 *   "LIC" -> run only LIC
 * ----------------------------------------
 */

export async function runMonitor(
  env,
  requestedSource = null
) {
  const started =
    new Date().toISOString();

  /*
   * ----------------------------------------
   * Archive old published items first
   * ----------------------------------------
   */

  let archived = 0;

  try {
    archived =
      await archiveExpiredItems(env);
  } catch (archiveError) {
    console.error(
      "Archive system error:",
      archiveError
    );
  }

  /*
   * ----------------------------------------
   * Select sources
   * ----------------------------------------
   *
   * Normal monitor:
   *   Select next SOURCES_PER_RUN sources.
   *
   * Manual source:
   *   Select only requested source.
   *
   * Matching works with either:
   *   sources.name
   *   sources.adapter
   *
   * Example:
   *   ?source=LIC
   *   matches:
   *   name = LIC
   *   adapter = lic
   * ----------------------------------------
   */

  let sources = [];

  if (requestedSource) {
    const sourceName =
      String(requestedSource).trim();

    const sourceResult =
      await env.DB
        .prepare(`
          SELECT *
          FROM sources
          WHERE enabled = 1
            AND (
              name = ? COLLATE NOCASE
              OR adapter = ? COLLATE NOCASE
            )
          LIMIT 1
        `)
        .bind(
          sourceName,
          sourceName
        )
        .all();

    sources =
      sourceResult.results || [];

    /*
     * If a manually requested source does
     * not exist, return a clear error.
     */
    if (sources.length === 0) {
      throw new Error(
        `Enabled source not found: ${sourceName}`
      );
    }

  } else {

    /*
     * Normal automatic monitor.
     */

    const sourcesResult =
      await env.DB
        .prepare(`
          SELECT *
          FROM sources
          WHERE enabled = 1
          ORDER BY
            CASE
              WHEN last_checked_at IS NULL THEN 0
              ELSE 1
            END ASC,
            last_checked_at ASC,
            priority ASC
          LIMIT ?
        `)
        .bind(SOURCES_PER_RUN)
        .all();

    sources =
      sourcesResult.results || [];
  }

  let discovered = 0;
  let published = 0;
  let updated = 0;
  let blocked = 0;
  let errors = 0;

  const details = [];

  /*
   * ----------------------------------------
   * Process sources
   * ----------------------------------------
   */

  for (const source of sources) {
    try {

      /*
       * ----------------------------------------
       * Find adapter
       * ----------------------------------------
       */

      const adapter =
        adapters?.[source.adapter] ||
        adapters?.generic;

      if (typeof adapter !== "function") {
        throw new Error(
          `Adapter not found: ${
            source.adapter || "generic"
          }`
        );
      }

      /*
       * ----------------------------------------
       * Run source discovery
       * ----------------------------------------
       */

      let candidates =
        await adapter(source);

      if (!Array.isArray(candidates)) {
        candidates = [];
      }

      candidates =
        candidates.slice(
          0,
          MAX_CANDIDATES_PER_SOURCE
        );

      discovered +=
        candidates.length;

      /*
       * ----------------------------------------
       * Process candidates
       * ----------------------------------------
       */

      for (const candidate of candidates) {
        try {

          /*
           * ----------------------------------------
           * Verification
           * ----------------------------------------
           */

          const verification =
            verifyCandidate(
              candidate,
              source
            );

          /*
           * ----------------------------------------
           * Source hash
           * ----------------------------------------
           */

          const hash =
            await sha256Hex(
              JSON.stringify(candidate)
            );

          /*
           * ----------------------------------------
           * Slug
           * ----------------------------------------
           */

          const baseSlug =
            slugify(
              candidate.title ||
              "government-update"
            );

          const slug =
            `${baseSlug}-${hash.slice(0, 10)}`;

          /*
           * ----------------------------------------
           * Find existing item
           * ----------------------------------------
           *
           * Source URL is used as the stable
           * identity of an already discovered item.
           * ----------------------------------------
           */

          const existing =
            await env.DB
              .prepare(\`
                INSERT INTO items(
                  type, slug, notification_key, title, organization, category, location,
                  description, eligibility, qualification, vacancies, age_limit, age_relaxation,
                  fee, selection_process, salary, application_start, last_date, exam_date,
                  how_to_apply, important_dates, official_url, apply_url, notification_url,
                  source_url, source_name, source_id, source_hash, canonical_url, status,
                  verification_status, confidence_score, evidence_json, change_summary,
                  last_verified_at, last_seen_at, published_at, archived_at, archive_reason
                ) VALUES(
                  ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL
                )
              \`
              .bind(...values)
              .run();

            published++;
          }

        } catch (candidateError) {

          errors++;

          details.push({
            source:
              source.name,

            candidate:
              candidate?.title ||
              "Unknown candidate",

            error:
              String(
                candidateError?.message ||
                candidateError
              )
          });
        }
      }

      /*
       * ----------------------------------------
       * Source success
       * ----------------------------------------
       */

      const checkedAt =
        new Date().toISOString();

      await env.DB
        .prepare(`
          UPDATE sources
          SET
            last_checked_at=?,
            last_success_at=?,
            last_error=NULL
          WHERE id=?
        `)
        .bind(
          checkedAt,
          checkedAt,
          source.id
        )
        .run();

    } catch (sourceError) {

      errors++;

      const errorMessage =
        String(
          sourceError?.message ||
          sourceError
        );

      /*
       * ----------------------------------------
       * Source error
       * ----------------------------------------
       */

      await env.DB
        .prepare(`
          UPDATE sources
          SET
            last_checked_at=?,
            last_error=?
          WHERE id=?
        `)
        .bind(
          new Date().toISOString(),
          errorMessage,
          source.id
        )
        .run();

      details.push({
        source:
          source.name,

        error:
          errorMessage
      });
    }
  }

  /*
   * ----------------------------------------
   * Monitor run log
   * ----------------------------------------
   */

  const finished =
    new Date().toISOString();

  await env.DB
    .prepare(`
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
    `)
    .bind(
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
        requested_source:
          requestedSource || null,
        details
      })
    )
    .run();

  /*
   * ----------------------------------------
   * Return monitor result
   * ----------------------------------------
   */

  return {
    ok: true,

    started,

    finished,

    requested_source:
      requestedSource || null,

    sources:
      sources.length,

    discovered,

    published,

    updated,

    blocked,

    errors,

    archived,

    details
  };
      }
