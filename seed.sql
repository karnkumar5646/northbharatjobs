INSERT OR IGNORE INTO settings(key,value) VALUES
('site_name','North Bharat Jobs'),
('site_url','northbharatjobs.shantanukumar5646.workers.dev'),
('adsense_client',''),
('google_site_verification',''),
('indexing_api_enabled','0');

INSERT OR IGNORE INTO sources(name,source_type,base_url,allowed_domains,adapter,priority) VALUES
('Staff Selection Commission','html','https://ssc.gov.in/','ssc.gov.in','ssc',10),
('Union Public Service Commission','html','https://upsc.gov.in/','upsc.gov.in','upsc',10),
('National Career Service','html','https://www.ncs.gov.in/','ncs.gov.in','ncs',20),
('Railway Recruitment Boards','html','https://indianrailways.gov.in/','indianrailways.gov.in;rrbapply.gov.in','railway',10),
('India Post','html','https://www.indiapost.gov.in/','indiapost.gov.in','indiapost',20),
('IBPS','html','https://www.ibps.in/','ibps.in','ibps',20),
('SBI Careers','html','https://sbi.co.in/web/careers','sbi.co.in','sbi',20),
('RBI','html','https://www.rbi.org.in/','rbi.org.in','rbi',20),
('Bihar Public Service Commission','html','https://www.bpsc.bih.nic.in/','bpsc.bih.nic.in','bpsc',20),
('Bihar Staff Selection Commission','html','https://bssc.bihar.gov.in/','bssc.bihar.gov.in','bssc',20),
('Bihar Police','html','https://police.bihar.gov.in/','police.bihar.gov.in','bihar-police',30),
('UPSC Online','html','https://upsconline.nic.in/','upsconline.nic.in','upsc-online',10),
('Indian Army','html','https://joinindianarmy.nic.in/','joinindianarmy.nic.in','army',20),
('Indian Navy','html','https://www.joinindiannavy.gov.in/','joinindiannavy.gov.in','navy',20),
('Indian Air Force','html','https://agnipathvayu.cdac.in/','agnipathvayu.cdac.in','airforce',20),
('DRDO','html','https://www.drdo.gov.in/','drdo.gov.in','drdo',20),
('ISRO','html','https://www.isro.gov.in/','isro.gov.in','isro',20),
('LIC','html','https://licindia.in/','licindia.in','lic',30),
('EPFO','html','https://www.epfindia.gov.in/','epfindia.gov.in','epfo',30),
('ESIC','html','https://www.esic.gov.in/','esic.gov.in','esic',30),
('NTA','html','https://exams.nta.ac.in/','exams.nta.ac.in','nta',20);
