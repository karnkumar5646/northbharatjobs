import { adapters } from "./sources.js";
import { verifyCandidate, sha256Hex, slugify } from "./verification.js";

export async function runMonitor(env) {
  const started = new Date().toISOString();
  const sources = await env.DB.prepare(
    "SELECT * FROM sources WHERE enabled=1 ORDER BY priority ASC"
  ).all();

  let discovered = 0, published = 0, updated = 0, blocked = 0, errors = 0;
  const details = [];

  for (const source of sources.results || []) {
    try {
      const adapter = adapters[source.adapter] || adapters.generic;
      const candidates = await adapter(source);
      discovered += candidates.length;

      for (const candidate of candidates) {
        const verification = verifyCandidate(candidate, source);
        const hash = await sha256Hex(JSON.stringify(candidate));
        const slug = `${slugify(candidate.title)}-${hash.slice(0,10)}`;

        const existing = await env.DB.prepare(
          "SELECT id FROM items WHERE slug=? OR source_url=? LIMIT 1"
        ).bind(slug, candidate.source_url).first();

        if (!verification.publish) {
          blocked++;
          if (existing) {
            await env.DB.prepare(
              "INSERT INTO verification_events(item_id,event_type,passed,score,details) VALUES(?,?,?,?,?)"
            ).bind(existing.id,"monitor_recheck",0,verification.score,JSON.stringify(verification.evidence)).run();
          }
          continue;
        }

        const now = new Date().toISOString();
        const values = [
          candidate.type, candidate.title, candidate.organization || source.name,
          candidate.category || null, candidate.location || null,
          candidate.description || null, candidate.qualification || null,
          candidate.vacancies || null, candidate.age_limit || null,
          candidate.fee || null, candidate.selection_process || null,
          candidate.salary || null, candidate.application_start || null,
          candidate.last_date || null, candidate.exam_date || null,
          candidate.date_posted || now.slice(0,10),
          candidate.official_url, candidate.apply_url || null,
          candidate.notification_url || null, candidate.source_url,
          source.name, source.id, hash, "published", "verified",
          verification.score, JSON.stringify(verification.evidence), now, now
        ];

        if (existing) {
          await env.DB.prepare(`
            UPDATE items SET type=?,title=?,organization=?,category=?,location=?,description=?,
            qualification=?,vacancies=?,age_limit=?,fee=?,selection_process=?,salary=?,
            application_start=?,last_date=?,exam_date=?,date_posted=?,official_url=?,apply_url=?,
            notification_url=?,source_url=?,source_name=?,source_id=?,source_hash=?,status=?,
            verification_status=?,confidence_score=?,evidence_json=?,last_verified_at=?,
            last_seen_at=?,updated_at=CURRENT_TIMESTAMP
            WHERE id=?
          `).bind(...values, existing.id).run();
          updated++;
        } else {
          await env.DB.prepare(`
            INSERT INTO items(
              type,title,organization,category,location,description,qualification,vacancies,
              age_limit,fee,selection_process,salary,application_start,last_date,exam_date,
              date_posted,official_url,apply_url,notification_url,source_url,source_name,
              source_id,source_hash,status,verification_status,confidence_score,evidence_json,
              last_verified_at,last_seen_at,published_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
          `).bind(...values).run();
          published++;
        }
      }

      await env.DB.prepare(
        "UPDATE sources SET last_checked_at=?,last_success_at=?,last_error=NULL WHERE id=?"
      ).bind(new Date().toISOString(), new Date().toISOString(), source.id).run();
    } catch (e) {
      errors++;
      await env.DB.prepare(
        "UPDATE sources SET last_checked_at=?,last_error=? WHERE id=?"
      ).bind(new Date().toISOString(), String(e?.message || e), source.id).run();
      details.push({ source: source.name, error: String(e?.message || e) });
    }
  }

  const finished = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO monitor_runs(started_at,finished_at,source_count,discovered_count,published_count,
    updated_count,blocked_count,error_count,details)
    VALUES(?,?,?,?,?,?,?,?,?)
  `).bind(started,finished,sources.results?.length||0,discovered,published,updated,blocked,errors,JSON.stringify(details)).run();

  return { started, finished, sources: sources.results?.length||0, discovered, published, updated, blocked, errors };
}
