import re
import requests
from bs4 import BeautifulSoup
from datetime import datetime
import os

TODAY_DISPLAY = datetime.now().strftime("%d %b %Y")
TODAY_UPPER = TODAY_DISPLAY.upper()
TODAY_ISO = datetime.now().strftime("%Y-%m-%d")
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

ALL_SITES = [
    {"name": "BPSC", "url": "https://bpsc.bih.nic.in/", "base": "https://bpsc.bih.nic.in/", "dept": "Bihar Public Service Commission"},
    {"name": "BSSC", "url": "https://bssc.bihar.gov.in/", "base": "https://bssc.bihar.gov.in/", "dept": "Bihar Staff Selection Commission"},
    {"name": "CSBC", "url": "https://csbc.bih.nic.in/", "base": "https://csbc.bih.nic.in/", "dept": "Central Selection Board of Constable Bihar"},
    {"name": "UPPSC", "url": "https://uppsc.up.nic.in/", "base": "https://uppsc.up.nic.in/", "dept": "Uttar Pradesh PSC"},
    {"name": "UPSSSC", "url": "https://upsssc.gov.in/", "base": "https://upsssc.gov.in/", "dept": "UP Subordinate Service Selection Commission"},
    {"name": "JPSC", "url": "https://jpsc.gov.in/", "base": "https://jpsc.gov.in/", "dept": "Jharkhand PSC"},
    {"name": "JSSC", "url": "https://jssc.nic.in/", "base": "https://jssc.nic.in/", "dept": "Jharkhand Staff Selection Commission"},
    {"name": "WBPSC", "url": "https://wbpsc.gov.in/", "base": "https://wbpsc.gov.in/", "dept": "West Bengal PSC"},
    {"name": "RPSC", "url": "https://rpsc.rajasthan.gov.in/", "base": "https://rpsc.rajasthan.gov.in/", "dept": "Rajasthan PSC"},
    {"name": "RSMSSB", "url": "https://rsmssb.rajasthan.gov.in/", "base": "https://rsmssb.rajasthan.gov.in/", "dept": "Rajasthan Staff Selection Board"},
    {"name": "UKPSC", "url": "https://psc.uk.gov.in/", "base": "https://psc.uk.gov.in/", "dept": "Uttarakhand PSC"},
    {"name": "UKSSSC", "url": "https://uksssc.uk.gov.in/", "base": "https://uksssc.uk.gov.in/", "dept": "Uttarakhand Subordinate Service Selection Commission"},
    {"name": "HPPSC", "url": "https://hppsc.hp.gov.in/", "base": "https://hppsc.hp.gov.in/", "dept": "Himachal Pradesh PSC"},
    {"name": "HPSSSB", "url": "https://hpsssb.hp.gov.in/", "base": "https://hpsssb.hp.gov.in/", "dept": "Himachal Pradesh Staff Selection Board"},
    {"name": "DSSSB", "url": "https://dsssb.delhi.gov.in/", "base": "https://dsssb.delhi.gov.in/", "dept": "Delhi Subordinate Services Selection Board"},
    {"name": "SSC", "url": "https://ssc.gov.in/", "base": "https://ssc.gov.in/", "dept": "Staff Selection Commission"},
    {"name": "UPSC", "url": "https://upsc.gov.in/whats-new", "base": "https://upsc.gov.in", "dept": "Union Public Service Commission"},
    {"name": "IBPS", "url": "https://www.ibps.in/", "base": "https://www.ibps.in/", "dept": "Institute of Banking Personnel Selection"},
]

KEYWORDS = ["advertisement", "recruitment", "vacancy", "notification", "apply online", "corrigendum", "notice"]

def fetch_site(site):
    jobs = []
    try:
        r = requests.get(site["url"], headers=HEADERS, timeout=25)
        if r.status_code != 200:
            print(f"{site['name']} status {r.status_code}")
            return jobs
        soup = BeautifulSoup(r.text, 'html.parser')
        links = soup.find_all("a", href=True)
        count = 0
        for a in links:
            text = a.get_text(strip=True)
            if len(text) < 18:
                continue
            low = text.lower()
            if any(k in low for k in KEYWORDS):
                href = a["href"]
                if href.startswith("/"):
                    href = site["base"].rstrip("/") + href
                elif not href.startswith("http"):
                    href = site["base"].rstrip("/") + "/" + href.lstrip("/")
                if len(text) > 150:
                    text = text[:150]
                jobs.append({"title": text, "dept": site["dept"], "url": href, "source": site["name"]})
                count += 1
                if count >= 2:
                    break
    except Exception as e:
        print(f"{site['name']} error: {e}")
    return jobs

def get_all_jobs():
    all_jobs = []
    for site in ALL_SITES:
        js = fetch_site(site)
        print(f"{site['name']}: {len(js)} found")
        all_jobs.extend(js)
    return all_jobs

def update_index():
    if not os.path.exists("index.html"):
        print("index.html missing")
        return False
    with open("index.html", "r", encoding="utf-8") as f:
        content = f.read()
    
    orig = len(content)
    
    # FIXED: Handle both formats - with and without colon, and inside JS bundle
    # 1. LAST UPDATED 08 SEP 2026 -> LAST UPDATED 11 SEP 2026
    content = re.sub(r'LAST UPDATED\s+\d{1,2}\s+\w+\s+\d{4}', f'LAST UPDATED {TODAY_UPPER}', content, flags=re.IGNORECASE)
    # 2. Last Updated 08 Sep 2026 (without colon) - for React bundle
    content = re.sub(r'Last Updated\s+\d{1,2}\s+\w+\s+\d{4}', f'Last Updated {TODAY_DISPLAY}', content, flags=re.IGNORECASE)
    # 3. Last Updated: 08 Sep 2026 (with colon)
    content = re.sub(r'Last Updated:\s*\d{1,2}\s+\w+\s+\d{4}', f'Last Updated: {TODAY_DISPLAY}', content, flags=re.IGNORECASE)
    # 4. Any date like 08 Sep 2026 -> today (first occurrence is the header date)
    # Do this only once for the header
    content = re.sub(r'\b\d{1,2}\s+\w{3}\s+2026\b', TODAY_DISPLAY, content, count=1)
    
    new_jobs = get_all_jobs()
    added = 0
    for job in new_jobs:
        check = job["title"][:35]
        if check in content:
            continue
        job_card = f"""<div class="job-card new-job" data-source="{job['source']}">
<h3>{job['title']}</h3>
<p>{job['dept']} | Source: {job['source']}</p>
<a href="{job['url']}" target="_blank" rel="noopener noreferrer">Official Link - {job['source']}.gov.in</a>
<span class="badge">NEW - {TODAY_DISPLAY}</span>
</div>
"""
        if '<div class="job-card' in content:
            content = content.replace('<div class="job-card', job_card + '<div class="job-card', 1)
            added += 1
        else:
            content = content.replace('</body>', job_card + '</body>', 1)
            added += 1
        if added >= 8:
            break
    
    content = re.sub(r'©\s*\d{4}', f'© {datetime.now().year}', content)
    
    with open("index.html", "w", encoding="utf-8") as f:
        f.write(content)
    
    print(f"index.html {orig}->{len(content)} Date->{TODAY_UPPER} Added->{added}")
    return True

def update_sitemap():
    if not os.path.exists("sitemap.xml"):
        return False
    with open("sitemap.xml", "r", encoding="utf-8") as f:
        s = f.read()
    s = re.sub(r'<lastmod>.*?</lastmod>', f'<lastmod>{TODAY_ISO}</lastmod>', s)
    with open("sitemap.xml", "w", encoding="utf-8") as f:
        f.write(s)
    print(f"sitemap.xml -> {TODAY_ISO}")
    return True

def update_all_pages():
    pages = ["about.html", "privacy.html", "terms.html", "disclaimer.html", "contact.html", "cookies.html"]
    for page in pages:
        if not os.path.exists(page):
            continue
        with open(page, "r", encoding="utf-8") as f:
            c = f.read()
        c = re.sub(r'08 September 2026', TODAY_DISPLAY, c)
        c = re.sub(r'08 Sep 2026', TODAY_DISPLAY, c)
        c = re.sub(r'Last Updated:\s*\d{1,2}\s+\w+\s+\d{4}', f'Last Updated: {TODAY_DISPLAY}', c, flags=re.IGNORECASE)
        c = re.sub(r'Effective Date:\s*\d{1,2}\s+\w+\s+\d{4}', f'Effective Date: {TODAY_DISPLAY}', c, flags=re.IGNORECASE)
        with open(page, "w", encoding="utf-8") as f:
            f.write(c)
        print(f"{page} -> {TODAY_DISPLAY}")
    return True
if __name__ == "__main__": 
    print(f"=== REAL FULL SCRAPER START {TODAY_DISPLAY} - 18 sites ===")
    update_index()
    update_sitemap()
    update_all_page()
    print("=== DONE - All 18 sites checked + All Page, Auto Date + Jobs updated, Design SAME ===")
