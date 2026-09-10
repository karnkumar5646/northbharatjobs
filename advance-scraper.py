import re
from datetime import datetime

print(f"[{datetime.now()}] North Bharat Jobs - Advance Scraper (Same Look)")

TODAY_DISPLAY = datetime.now().strftime("%d %b %Y")
TODAY_ISO = datetime.now().strftime("%Y-%m-%d")
YEAR = datetime.now().year

def update_index():
    try:
        with open("index.html","r",encoding="utf-8") as f:
            content = f.read()
        
        # Keep ALL jobs, ALL design same - only update dates
        # Pattern 1: Last Updated
        content = re.sub(r'Last Updated:\s*[^<\n]{5,30}', f'Last Updated: {TODAY_DISPLAY}', content)
        # Pattern 2: Any dd MMM yyyy
        # Only first occurrence to avoid changing job dates
        if TODAY_DISPLAY not in content:
            content = re.sub(r'\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}', TODAY_DISPLAY, content, count=1, flags=re.IGNORECASE)
        
        # Copyright year
        content = re.sub(r'©\s*\d{4}', f'© {YEAR}', content)
        
        with open("index.html","w",encoding="utf-8") as f:
            f.write(content)
        print(f"✅ index.html Date -> {TODAY_DISPLAY} | Jobs & Look SAME")
        return True
    except Exception as e:
        print(f"❌ index error {e}")
        return False

def update_all_pages():
    pages = ["about.html","privacy.html","contact.html","terms.html","cookies.html","disclaimer.html"]
    for page in pages:
        try:
            with open(page,"r",encoding="utf-8") as f:
                c = f.read()
            c = re.sub(r'08 September 2026', TODAY_DISPLAY, c)
            c = re.sub(r'08 Sep 2026', TODAY_DISPLAY, c)
            c = re.sub(r'\d{1,2} \w{{3}} \d{4}', TODAY_DISPLAY, c, count=1)
            c = re.sub(r'©\s*\d{4}', f'© {YEAR}', c)
            with open(page,"w",encoding="utf-8") as f:
                f.write(c)
            print(f"✅ {page} -> {TODAY_DISPLAY}")
        except Exception as e:
            print(f"skip {page}: {e}")

def update_sitemap():
    try:
        with open("sitemap.xml","r",encoding="utf-8") as f:
            s = f.read()
        s = re.sub(r'<lastmod>.*?</lastmod>', f'<lastmod>{TODAY_ISO}</lastmod>', s)
        with open("sitemap.xml","w",encoding="utf-8") as f:
            f.write(s)
        print(f"✅ sitemap.xml -> {TODAY_ISO}")
        return True
    except Exception as e:
        print(f"❌ sitemap {e}")
        return False

if __name__ == "__main__":
    print("=== Advance Auto Update - Same Look, Same Jobs ===")
    update_index()
    update_all_pages()
    update_sitemap()
    print("✅ Done - GitHub will Push -> Cloudflare Auto Deploy")
