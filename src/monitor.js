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
    const expiryDate =
      new Date(lastDate.getTime());

    expiryDate.setUTCDate(
      expiryDate.getUTCDate() + 30
    );

    if (now >= expiryDate) {
      return (
        "Application last date passed more than 30 days ago"
      );
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
    const oneYearLater =
      new Date(baseDate.getTime());

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
 * ----------------------------------------
 */

export async function runMonitor(env) {
  const started =
    new Date().toISOString();

  /*
   * First archive old items.
   *
   * This happens before discovery so old
   * cards disappear from the public site
   * even if no new source is discovered.
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
   * Select next sources
   * ----------------------------------------
   */

  const sourcesResult =
    await env.DB.prepare(`
      SELECT *
      FROM sources
      WHERE enabled=1
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

  const sources =
    sourcesResult.results || [];

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
          const verification =
            verifyCandidate(
              candidate,
              source
            );

          const hash =
            await sha256Hex(
              JSON.stringify(candidate)
            );

          /*
           * slug generated BEFORE INSERT
           */
          const baseSlug =
            slugify(
              candidate.title ||
              "government-update"
            );

          const slug =
            `${baseSlug}-${hash.slice(0, 10)}`;

          /*
           * Find existing item by source URL.
           */
          const existing =
            await env.DB
              .prepare(`
                SELECT
                  id,
                  status,
                  last_date,
                  date_posted,
                  created_at
                FROM items
                WHERE source_url=?
                LIMIT 1
              `)
              .bind(
                candidate.source_url ||
                null
              )
              .first();

          /*
           * ----------------------------------------
           * Verification failed
           * ----------------------------------------
           */

          if (!verification.publish) {
            blocked++;

            if (existing) {
              await env.DB
                .prepare(`
                  INSERT INTO verification_events(
                    item_id,
                    event_type,
                    passed,
                    score,
                    details
                  )
                  VALUES(?,?,?,?,?)
                `)
                .bind(
                  existing.id,
                  "monitor_recheck",
                  0,
                  verification.score,
                  JSON.stringify(
                    verification.evidence
                  )
                )
                .run();
            }

            continue;
          }

          /*
           * ----------------------------------------
           * Expiry check BEFORE publishing
           *
           * This is important.
           *
           * It prevents an old job from being
           * automatically re-published after the
           * adapter discovers it again.
           * ----------------------------------------
           */

          const candidateForExpiry = {
            last_date:
              candidate.last_date ||
              null,

            date_posted:
              candidate.date_posted ||
              null,

            created_at:
              existing?.created_at ||
              new Date().toISOString()
          };

          const archiveReason =
            getArchiveReason(
              candidateForExpiry,
              new Date()
            );

          if (archiveReason) {
            /*
             * If the item already exists,
             * keep it archived.
             */
            if (existing) {
              await env.DB
                .prepare(`
                  UPDATE items
                  SET
                    status = 'archived',
                    archived_at = COALESCE(
                      archived_at,
                      ?
                    ),
                    archive_reason = ?,
                    updated_at = ?
                  WHERE id = ?
                `)
                .bind(
                  new Date().toISOString(),
                  archiveReason,
                  new Date().toISOString(),
                  existing.id
                )
                .run();
            }

            /*
             * Do not publish stale candidates.
             */
            continue;
          }

          const now =
            new Date().toISOString();

          /*
           * ----------------------------------------
           * Explicit database values
           * ----------------------------------------
           */

          const values = [
            candidate.type ||
              "job",

            slug,

            candidate.title ||
              "Untitled",

            candidate.organization ||
              source.name,

            candidate.category ||
              null,

            candidate.location ||
              null,

            candidate.description ||
              null,

            candidate.qualification ||
              null,

            candidate.vacancies ||
              null,

            candidate.age_limit ||
              null,

            candidate.fee ||
              null,

            candidate.selection_process ||
              null,

            candidate.salary ||
              null,

            candidate.application_start ||
              null,

            candidate.last_date ||
              null,

            candidate.exam_date ||
              null,

            candidate.date_posted ||
              now.slice(0, 10),

            candidate.official_url ||
              null,

            candidate.apply_url ||
              null,

            candidate.notification_url ||
              null,

            candidate.source_url ||
              null,

            source.name,

            source.id,

            hash,

            "published",

            "verified",

            verification.score,

            JSON.stringify(
              verification.evidence
            ),

            now,

            now,

            now
          ];

          /*
           * ----------------------------------------
           * Existing item
           * ----------------------------------------
           */

          if (existing) {
            await env.DB
              .prepare(`
                UPDATE items SET
                  type=?,
                  slug=?,
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
                  published_at=?,
                  archived_at=NULL,
                  archive_reason=NULL,
                  updated_at=?
                WHERE id=?
              `)
              .bind(
                ...values,
                now,
                existing.id
              )
              .run();

            updated++;

          } else {

            /*
             * ----------------------------------------
             * New item
             * ----------------------------------------
             */

            await env.DB
              .prepare(`
                INSERT INTO items(
                  type,
                  slug,
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
                  published_at,
                  archived_at,
                  archive_reason
                )
                VALUES(
                  ?1,
                  ?2,
                  ?3,
                  ?4,
                  ?5,
                  ?6,
                  ?7,
                  ?8,
                  ?9,
                  ?10,
                  ?11,
                  ?12,
                  ?13,
                  ?14,
                  ?15,
                  ?16,
                  ?17,
                  ?18,
                  ?19,
                  ?20,
                  ?21,
                  ?22,
                  ?23,
                  ?24,
                  ?25,
                  ?26,
                  ?27,
                  ?28,
                  ?29,
                  ?30,
                  ?31,
                  NULL,
                  NULL
                )
              `)
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
    started,
    finished,
    sources:
      sources.length,

    discovered,

    published,

    updated,

    blocked,

    errors,

    archived
  };
        }
