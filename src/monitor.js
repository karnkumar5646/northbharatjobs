import adapters from "./sources.js";
import {
  verifyCandidate,
  sha256Hex,
  slugify
} from "./verification.js";

const SOURCES_PER_RUN = 4;
const MAX_CANDIDATES_PER_SOURCE = 8;

/*
  North Bharat Jobs
  Monitoring engine

  Responsibilities:
  - Read enabled official sources
  - Run correct adapter
  - Verify candidates
  - Save verified jobs
  - Update existing jobs
  - Store verification events
  - Store monitor run statistics
*/

export async function runMonitor(env) {

  const started =
    new Date().toISOString();

  /* -------------------------------- */
  /* Load sources                     */
  /* -------------------------------- */

  const sourcesResult =
    await env.DB.prepare(`
      SELECT *
      FROM sources
      WHERE enabled=1
      ORDER BY
        CASE
          WHEN last_checked_at IS NULL
          THEN 0
          ELSE 1
        END ASC,
        last_checked_at ASC,
        priority ASC
      LIMIT ?1
    `)
      .bind(
        SOURCES_PER_RUN
      )
      .all();

  const sources =
    sourcesResult.results || [];

  let discovered = 0;
  let published = 0;
  let updated = 0;
  let blocked = 0;
  let errors = 0;

  const details = [];

  /* -------------------------------- */
  /* Process each source              */
  /* -------------------------------- */

  for (
    const source of sources
  ) {

    try {

      /*
        IMPORTANT:
        Some database rows use:
        army
        navy
        airforce
        drdo

        sources.js now contains all aliases.
      */

      const adapter =
        adapters?.[source.adapter] ||
        adapters?.generic;

      if (
        typeof adapter !==
        "function"
      ) {
        throw new Error(
          `Adapter not found: ${source.adapter}`
        );
      }

      let candidates =
        await adapter(source);

      if (
        !Array.isArray(
          candidates
        )
      ) {
        candidates = [];
      }

      candidates =
        candidates.slice(
          0,
          MAX_CANDIDATES_PER_SOURCE
        );

      discovered +=
        candidates.length;

      /* ------------------------------ */
      /* Process candidates              */
      /* ------------------------------ */

      for (
        const candidate of candidates
      ) {

        try {

          /*
            Verify candidate first.
          */

          const verification =
            verifyCandidate(
              candidate,
              source
            );

          /*
            Stable content hash.
          */

          const hash =
            await sha256Hex(
              JSON.stringify(
                candidate
              )
            );

          /*
            Create slug.
          */

          const baseSlug =
            slugify(
              candidate.title ||
              "job"
            );

          const slug =
            `${baseSlug}-${hash.slice(
              0,
              10
            )}`;

          /*
            Check existing item.
          */

          const existing =
            await env.DB.prepare(`
              SELECT
                id,
                slug
              FROM items
              WHERE source_url=?1
              LIMIT 1
            `)
              .bind(
                candidate.source_url ||
                null
              )
              .first();

          /* ---------------------------- */
          /* Block unverified candidate   */
          /* ---------------------------- */

          if (
            !verification.publish
          ) {

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
                VALUES(
                  ?1,
                  ?2,
                  ?3,
                  ?4,
                  ?5
                )
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

          /* ---------------------------- */
          /* Common values                */
          /* ---------------------------- */

          const now =
            new Date().toISOString();

          /*
            EXACTLY 30 values.
          */

          const values = [

            // 1
            candidate.type ||
              "job",

            // 2
            candidate.title ||
              "Untitled",

            // 3
            candidate.organization ||
              source.name,

            // 4
            candidate.category ||
              null,

            // 5
            candidate.location ||
              null,

            // 6
            candidate.description ||
              null,

            // 7
            candidate.qualification ||
              null,

            // 8
            candidate.vacancies ||
              null,

            // 9
            candidate.age_limit ||
              null,

            // 10
            candidate.fee ||
              null,

            // 11
            candidate.selection_process ||
              null,

            // 12
            candidate.salary ||
              null,

            // 13
            candidate.application_start ||
              null,

            // 14
            candidate.last_date ||
              null,

            // 15
            candidate.exam_date ||
              null,

            // 16
            candidate.date_posted ||
              now.slice(0, 10),

            // 17
            candidate.official_url ||
              null,

            // 18
            candidate.apply_url ||
              null,

            // 19
            candidate.notification_url ||
              null,

            // 20
            candidate.source_url ||
              null,

            // 21
            source.name,

            // 22
            source.id,

            // 23
            hash,

            // 24
            "published",

            // 25
            "verified",

            // 26
            verification.score,

            // 27
            JSON.stringify(
              verification.evidence
            ),

            // 28
            now,

            // 29
            now,

            // 30
            now
          ];

          /* ---------------------------- */
          /* Update existing item         */
          /* ---------------------------- */

          if (existing) {

            await env.DB.prepare(`
              UPDATE items SET

                type=?1,
                title=?2,
                organization=?3,
                category=?4,
                location=?5,
                description=?6,
                qualification=?7,
                vacancies=?8,
                age_limit=?9,
                fee=?10,
                selection_process=?11,
                salary=?12,
                application_start=?13,
                last_date=?14,
                exam_date=?15,
                date_posted=?16,
                official_url=?17,
                apply_url=?18,
                notification_url=?19,
                source_url=?20,
                source_name=?21,
                source_id=?22,
                source_hash=?23,
                status=?24,
                verification_status=?25,
                confidence_score=?26,
                evidence_json=?27,
                last_verified_at=?28,
                last_seen_at=?29,
                published_at=?30

              WHERE id=?31
            `)
              .bind(
                ...values,
                existing.id
              )
              .run();

            /*
              Keep slug synchronized.
            */

            await env.DB.prepare(`
              UPDATE items
              SET slug=?1
              WHERE id=?2
            `)
              .bind(
                slug,
                existing.id
              )
              .run();

            updated++;

          } else {

            /* -------------------------- */
            /* Insert new item             */
            /* -------------------------- */

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
                ?30
              )
            `)
              .bind(
                ...values
              )
              .run();

            /*
              The INSERT intentionally uses
              exactly 30 columns and 30 values.

              Slug is updated separately so
              slug handling cannot create a
              column/value count mismatch.
            */

            await env.DB.prepare(`
              UPDATE items
              SET slug=?1
              WHERE source_url=?2
            `)
              .bind(
                slug,
                candidate.source_url ||
                  null
              )
              .run();

            published++;
          }

        } catch (
          candidateError
        ) {

          errors++;

          details.push({
            source:
              source.name,

            candidate:
              candidate.title ||
              "Unknown candidate",

            error:
              String(
                candidateError?.message ||
                candidateError
              )
          });
        }
      }

      /* ------------------------------ */
      /* Source success                 */
      /* ------------------------------ */

      const checkedAt =
        new Date().toISOString();

      await env.DB.prepare(`
        UPDATE sources
        SET
          last_checked_at=?1,
          last_success_at=?2,
          last_error=NULL
        WHERE id=?3
      `)
        .bind(
          checkedAt,
          checkedAt,
          source.id
        )
        .run();

    } catch (
      sourceError
    ) {

      errors++;

      const errorMessage =
        String(
          sourceError?.message ||
          sourceError
        );

      await env.DB.prepare(`
        UPDATE sources
        SET
          last_checked_at=?1,
          last_error=?2
        WHERE id=?3
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

  /* -------------------------------- */
  /* Finish monitor run               */
  /* -------------------------------- */

  const finished =
    new Date().toISOString();

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
    VALUES(
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7,
      ?8,
      ?9
    )
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
      JSON.stringify(
        details
      )
    )
    .run();

  /* -------------------------------- */
  /* Return monitor summary           */
  /* -------------------------------- */

  return {

    started,

    finished,

    sources:
      sources.length,

    discovered,

    published,

    updated,

    blocked,

    errors
  };
}
