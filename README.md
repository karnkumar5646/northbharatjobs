# North Bharat Jobs — Maximum Coverage Foundation

## Included
- Separate sections: Jobs, Admit Card, Results, Answer Key, Syllabus, Admission, Scholarship, Important Updates
- Modern responsive homepage
- Search
- Cloudflare Workers + D1
- Cron monitoring every 30 minutes
- Source registry and adapter architecture
- Official-domain verification
- Duplicate prevention
- Verification score and audit log
- Automatic homepage updates from D1
- Sitemap and robots.txt
- JobPosting JSON-LD on individual job pages
- Privacy / Terms / Contact / About
- AdSense-ready `ads.txt` placeholder
- No fake/demo job records

## Important
This project does NOT pretend that a generic scraper can reliably parse every government website.
For maximum real coverage, each portal should have a source-specific adapter when its structure requires one.
The included generic discovery is intentionally conservative: it discovers candidates but blocks them unless the verification rules pass.

## Setup
1. Install Node.js.
2. `npm install`
3. `npx wrangler login`
4. `npx wrangler d1 create north_bharat_jobs`
5. Put the returned database_id into `wrangler.jsonc`.
6. `npx wrangler d1 execute north_bharat_jobs --remote --file=schema.sql`
7. `npx wrangler d1 execute north_bharat_jobs --remote --file=seed.sql`
8. Set a monitor secret:
   `npx wrangler secret put MONITOR_KEY`
9. Replace the site URL, contact email, AdSense publisher ID and Google verification values.
10. `npm run deploy`

## Monitoring
Cron is configured for every 30 minutes. Cloudflare Cron uses UTC.
The scheduled Worker calls the monitor. The monitor checks enabled sources, verifies candidates, updates D1, and the homepage reads the latest verified data.

## Manual monitor
Use:
`curl -H "x-monitor-key: YOUR_SECRET" https://YOUR-DOMAIN.example/api/monitor`

## Adding a source
1. Add a row to `sources`.
2. Add an adapter in `src/sources.js`.
3. Make it extract real official URLs and fields.
4. Keep verification strict.
5. Test locally.
6. Deploy.

## Google
- Submit `/sitemap.xml` in Search Console.
- Verify individual job pages with Rich Results Test / URL Inspection.
- JobPosting structured data belongs on individual job pages, not category/list pages.
- AdSense approval is a Google review process, not something code can guarantee.
- Replace `ads.txt` with the exact line supplied by your AdSense account.

## Accuracy policy
No evidence -> no publish.
If official links or fields cannot be verified, the item stays blocked.
No fake jobs, fake URLs, or invented vacancies should be inserted.
