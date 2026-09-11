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

if __name__ == "__main__":
    print(f"=== REAL FULL SCRAPER START {TODAY_DISPLAY} ===")
    update_index()
    update_sitemap()
    print("=== DONE - All 18 sites checked, Date + Jobs updated, Design SAME ===")
