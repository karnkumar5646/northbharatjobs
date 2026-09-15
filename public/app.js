const SECTIONS = [
  ["jobs","Latest Jobs","job","💼"],
  ["admit-card","Admit Card","admit_card","🎫"],
  ["results","Results","result","📊"],
  ["answer-key","Answer Key","answer_key","📝"],
  ["syllabus","Syllabus","syllabus","📚"],
  ["admission","Admission","admission","🎓"],
  ["scholarship","Scholarship","scholarship","🏆"],
  ["updates","Important Updates","update","🔔"]
];

const $ = s => document.querySelector(s);

function card(x){
  return `<article class="card">
    <div class="card-top"><span class="badge">✓ Verified</span><span class="date">${x.last_date ? "Last date: "+x.last_date : "Updated: "+(x.updated_at||"").slice(0,10)}</span></div>
    <h3>${escapeHtml(x.title)}</h3>
    <p class="org">${escapeHtml(x.organization||x.source_name||"Official Source")}</p>
    <p class="small">${escapeHtml(x.qualification||x.description||"See official notification for complete details.")}</p>
    <div class="card-actions"><a href="/item/${encodeURIComponent(x.slug)}" class="btn smallbtn">View Details</a>
    <a href="${escapeAttr(x.official_url)}" target="_blank" rel="noopener nofollow" class="btn secondary smallbtn">Official Link</a></div>
  </article>`;
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function escapeAttr(s){return escapeHtml(s);}

async function load(){
  const counts = await fetch("/api/sections").then(r=>r.json()).catch(()=>({}));
  $("#stats").innerHTML = `<div class="stat"><b>${Object.values(counts).reduce((a,b)=>a+b,0)}</b><span>Verified listings</span></div>`+
    SECTIONS.map(([id,label,type,icon])=>`<div class="stat"><b>${counts[id]??0}</b><span>${icon} ${label}</span></div>`).join("");
  $("#sectionNav").innerHTML = SECTIONS.map(([id,label,,icon])=>`<a href="#${id}">${icon} ${label}</a>`).join("");

  for (const [id,label,type,icon] of SECTIONS){
    const data = await fetch(`/api/items?type=${type}&limit=12`).then(r=>r.json()).catch(()=>[]);
    const section = document.createElement("section");
    section.id = id; section.className="content-section";
    section.innerHTML = `<div class="section-head"><div><span class="eyebrow">${icon} ${label.toUpperCase()}</span><h2>${label}</h2></div><a href="/?type=${type}" class="more">View all →</a></div><div class="cards">${data.length?data.map(card).join(""):`<div class="empty">No verified ${label.toLowerCase()} found yet. The monitor will add items after official-source verification.</div>`}</div>`;
    $("#sections").appendChild(section);
  }
}
$("#searchForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const q=$("#search").value.trim(); if(!q)return;
  const data=await fetch(`/api/items?q=${encodeURIComponent(q)}&limit=50`).then(r=>r.json());
  $("#searchResults").classList.remove("hidden");
  $("#searchGrid").innerHTML=data.length?data.map(card).join(""):`<div class="empty">No verified result found.</div>`;
  $("#searchResults").scrollIntoView({behavior:"smooth"});
});
load();
