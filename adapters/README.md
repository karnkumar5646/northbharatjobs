# Source Adapter Checklist

For every major official portal, implement:
1. Fetch official listing page / official API / RSS if provided.
2. Identify new notices.
3. Follow only allowed official-domain URLs.
4. Parse title, type, dates, vacancy, qualification and links.
5. Fetch the official notification PDF when available.
6. Extract text and verify important fields.
7. Detect corrigendum/addendum changes.
8. Hash the normalized record.
9. Publish only if verification threshold is met.
10. Store evidence and verification event.

Recommended first adapters:
SSC, UPSC, Railway RRB, IBPS, SBI, RBI, India Post, Defence, NTA, BPSC, BSSC, Bihar Police, major UP/MP/Rajasthan/Jharkhand/Delhi state recruitment boards.
