/* HM Nexus: read-only views over the same Supabase project as HM Operations.
 * Never uses a service-role key or reads vendor credentials. RLS remains authoritative.
 * Snapshots refresh every 30s; upstream timestamps, not fetch time, describe freshness.
 */
(() => {
'use strict';
const pages=[['command','Operations Command Center'],['retail','Retail Media Live'],['players','Player Intelligence'],['wall','IoT Wall'],['black','Screen Intelligence'],['map','Network Map']];
const $=s=>document.querySelector(s), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Public display: PC hostnames are shown as a stable pseudonym (FNV-1a), never verbatim.
const player=h=>{if(!h)return 'Unnamed player';let x=2166136261;for(const c of String(h))x=Math.imul(x^c.charCodeAt(0),16777619);return 'Player '+(x>>>0).toString(16).toUpperCase().padStart(8,'0').slice(0,6);};
// Public display: coordinates rounded to 3 decimals (~100 m), enough to place a venue, not a screen.
const coarse=n=>Math.round(n*1000)/1000;
const number=n=>Number(n||0).toLocaleString('en-US'), validDate=x=>x&&Number.isFinite(Date.parse(x));
const age=x=>{if(!validDate(x))return 'Not reported';const m=Math.max(0,Math.floor((Date.now()-Date.parse(x))/60000));return m<1?'Just now':m<60?`${m} min ago`:m<1440?`${Math.floor(m/60)} h ago`:`${Math.floor(m/1440)} days ago`};
const stamp=x=>validDate(x)?new Date(x).toLocaleString('en-GB',{timeZone:'Asia/Dubai'}):'Not reported';
const online=d=>validDate(d.last_seen)&&Date.now()-Date.parse(d.last_seen)<30*60000;
const config=window.HM_CONFIG;
if(!config){$('#app').textContent='Unable to load dashboard configuration. Please reload.';return;}
let page=location.hash.slice(1)||window.INITIAL_PAGE||'command';if(!pages.some(p=>p[0]===page))page='command';
let profile=null,perms=[],factor=null,authBusy=false,cache=null,error='',scope='all',generation=0,fetching=false,rotation=null,loadedAt=null,authGeneration=0;
let mapInstance=null,mapView=null;
const params=new URLSearchParams(location.search);if(params.get('display')==='wall')document.body.classList.add('wall-mode');
const brand='<a class="brand" href="#command"><img class="hm-logo" src="hm-logo.png" alt="HM"><span><strong>HYPERMEDIA</strong><small>NETWORK INTELLIGENCE</small></span></a>';
async function refresh(){
 if(fetching)return;fetching=true;const id=generation;
 try{
  const response=await fetch(config.url+'/rest/v1/rpc/hm_public_dashboard',{
   method:'POST',headers:{'Content-Type':'application/json',apikey:config.anonKey},
   body:JSON.stringify({p_view:page}),signal:AbortSignal.timeout(15000),cache:'no-store'
  });
  if(!response.ok)throw new Error('Public data feed unavailable (HTTP '+response.status+').');
  const result=await response.json();
  if(!result||typeof result!=='object'||!(result.iot||result.locations||result.devices))throw new Error('Public feed returned an invalid snapshot.');
  if(id!==generation)return;cache=result;error='';loadedAt=new Date().toISOString();
 }catch(e){if(id===generation){cache=null;error=e.message||'Data unavailable. Please retry.';}}
 finally{fetching=false;if(id===generation)render();else refresh();}
}
function table(headers,rows){return `<div class="live-table"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">No matching records.</td></tr>`}</tbody></table></div>`;}
function panel(title,body){return `<section class="panel"><div class="panel-head"><h2>${esc(title)}</h2></div><div class="live-panel-body">${body}</div></section>`;}
function barChart(items){const max=Math.max(1,...items.map(x=>x[1]));return `<div class="live-bars">${items.map(([label,value])=>`<div><div class="live-bar-label"><span>${esc(label)}</span><b>${number(value)}</b></div><div class="live-track"><div class="live-fill" data-metric="${esc(String(label).toLowerCase())}" style="width:${Math.max(0,value/max*100)}%"></div></div></div>`).join('')||'No reported values.'}</div>`;}
function countBy(rows,get){const m=new Map();rows.forEach(r=>{const k=String(get(r)||'Unknown');m.set(k,(m.get(k)||0)+1)});return [...m].sort((a,b)=>b[1]-a[1]);}
function hero(title,value,label,connected,total,stats){const pct=total?Math.min(100,Math.max(0,connected/total*100)):0;return `<section class="pulse-hero"><div class="hero-caption"><span class="micro">HM / PUBLIC TELEMETRY</span><span class="orbit-symbol">◈</span></div><h2>${esc(title)}</h2><div class="holo-stage"><div class="orbital o1"></div><div class="orbital o2"></div><div class="holo-ring" style="--ring:conic-gradient(var(--green) 0 ${pct}%,var(--red) ${pct}% 100%)"><div class="ring-hole"></div></div><div class="holo-number">${esc(value)}<span>${esc(label)}</span></div><div class="chart-coordinate left">HM OPERATIONS</div><div class="chart-coordinate right">SYNCED DATA</div></div><div class="pulse-stats">${stats.map(([k,v])=>`<div data-metric="${esc(k.toLowerCase())}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div><div class="hero-note">Refreshes every 30 seconds · upstream sync cadence applies</div></section>`;}
function kpis(items){return `<div class="kpis secondary-kpis">${items.map(([label,v,sub])=>`<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(v)}</div><div class="kpi-sub">${esc(sub||'')}</div></div>`).join('')}</div>`;}
// Retail membership is explicit; extend this list when another store joins.
const retailStores=['LULU Al Wahda','Union Coop Umm Suqeim','Union Coop Al Warqa'];
const retailKey=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function retailStore(device){return retailStores.find(name=>retailKey(name)===retailKey(device.venue||device.storeName))||null;}
function retailDetails(c){
 const devices=(c.retailDevices||[]).filter(d=>retailStore({venue:d.location})&&(scope==='all'||retailStore({venue:d.location})===scope));
 const usage=devices.filter(d=>validDate(d.du_scraped_at));
 let content=panel('Retail player status',table(['Player','Store','Status','Reported problems','Last seen'],devices.map(d=>[player(d.hostname),d.location,online(d)?'Online':'Offline',(d.problems||[]).join('; ')||'No reported problems',age(d.last_seen)])));
 content+=panel('Retail data consumption',table(['Player','Store','Used GB','Allowance GB','Reading age'],usage.map(d=>[player(d.hostname),d.location,Number.isFinite(Number(d.du_data_used_gb))?Number(d.du_data_used_gb).toFixed(1):'Unavailable',Number(d.du_data_total_gb)>0&&Number(d.du_data_total_gb)<=500?Number(d.du_data_total_gb).toFixed(1):'Unavailable',age(d.du_scraped_at)+(Date.now()-Date.parse(d.du_scraped_at)>172800000?' · STALE':'')])));
 content+='<div class="live-notice">Player and consumption records use exact store names or unambiguous inventory player-ID matches. Unmatched devices are omitted. '+esc((c.retailIssues||[]).join(' '))+'</div>';return content;
}
function shoutbox(c){
 const entries=[];
 // Ticket titles and report descriptions are staff free text: never shown publicly.
 for(const t of c.tickets||[])if(!['Closed','Resolved'].includes(t.status))entries.push({time:t.date_reported,source:'TICKET',name:t.location||'Maintenance',text:'Maintenance ticket · '+t.priority+' · '+t.status});
 for(const r of c.reports||[])if(!['Resolved','Dismissed'].includes(r.status))entries.push({time:r.created_at,source:'SCREEN REPORT',name:r.asset_id||'Screen',text:'Screen report · '+r.status});
 for(const d of c.devices||[]){const problems=(d.problems||[]).filter(p=>!(/^Signage player (not running|running but not visible)/.test(p)&&((c.globalIgnored||[]).includes('signage-black-screen')||(d.ignored_problem_types||[]).includes('signage-black-screen'))));if(!online(d)||problems.length)entries.push({time:d.last_seen,source:'DEVICE',name:player(d.hostname)+' · '+(d.location||'Unassigned'),text:!online(d)?'Offline — last heartbeat '+age(d.last_seen):problems.join('; ')});}
 entries.sort((a,b)=>(Date.parse(b.time)||0)-(Date.parse(a.time)||0));
 return panel('Live issue shoutbox','<div class="live-table shoutbox" aria-label="Live app issues">'+(entries.map(e=>'<article class="shout"><div><b>'+esc(e.source)+'</b><time>'+esc(age(e.time))+'</time></div><strong>'+esc(e.name)+'</strong><p>'+esc(e.text)+'</p></article>').join('')||'<p class="status-good">No open issues reported in the available feeds.</p>')+'</div><small>App issue feed · refreshed every 30 seconds · device timestamps are heartbeats, not issue creation times</small>');
}
function intelligenceView(c){
 const devices=(c.devices||[]).map(d=>({...d,problems:(d.problems||[]).filter(p=>!(/^Signage player (not running|running but not visible)/.test(p)&&((c.globalIgnored||[]).includes('signage-black-screen')||(d.ignored_problem_types||[]).includes('signage-black-screen'))))})),issues=devices.filter(d=>!online(d)||(d.problems||[]).length),tickets=(c.tickets||[]).filter(t=>!['Closed','Resolved'].includes(t.status)),reports=(c.reports||[]).filter(r=>!['Resolved','Dismissed'].includes(r.status));
 const recommendations=[];if(issues.some(d=>!online(d)))recommendations.push('Check power and connectivity for missing heartbeats before restarting players.');if(reports.some(r=>!r.ticket_id))recommendations.push('Review new screen reports and link confirmed faults to a maintenance ticket.');if(tickets.some(t=>['Critical','High'].includes(t.priority)))recommendations.push('Prioritize high and critical tickets; verify the screen after repair before closure.');if(!recommendations.length)recommendations.push('Continue monitoring; a healthy heartbeat alone does not verify the physical picture.');
 return {options:[],hero:hero('Screen assurance',issues.length,'DEVICES REQUIRING REVIEW',devices.length-issues.length,devices.length,[['ONLINE',devices.filter(online).length],['OFFLINE',devices.filter(d=>!online(d)).length],['OPEN TICKETS',tickets.length]]),body:shoutbox(c)+kpis([['Screen reports',reports.length],['Devices with issues',issues.length],['Open tickets',tickets.length]])+panel('Recommended actions','<ul>'+recommendations.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>')+'<div class="live-notice">Reported signals, not camera or pixel verification. Existing app alert scheduling remains responsible for automatic Slack delivery. '+esc((c.issueErrors||[]).join(' '))+'</div>'+panel('Digital Directory issues',table(['Player','Location','Status','Problems'],issues.map(d=>[player(d.hostname),d.location,!online(d)?'Offline':'Online',(d.problems||[]).join('; ')||'No recent heartbeat'])))+panel('Open maintenance tickets',table(['Location','Priority','Status','Reported'],tickets.map(t=>[t.location||'Not reported',t.priority,t.status,age(t.date_reported)])))+panel('Screen reports',table(['Asset','Status','Linked ticket','Age'],reports.map(r=>[r.asset_id,r.status,r.ticket_id?'Linked':'Not linked',age(r.created_at)])))};
}
function view(){
 if(page==='map')return {options:[],hero:'',body:''};
 if(cache.iot){
  const cfg=cache.iot;let ds=page==='retail'?cfg.devices.filter(retailStore).map(d=>({...d,venue:retailStore(d)})):cfg.devices;const venues=[...new Set(ds.map(d=>d.venue||d.storeName||'Unassigned'))].sort();
  if(scope!=='all')ds=ds.filter(d=>(d.venue||d.storeName||'Unassigned')===scope);
  const on=ds.filter(d=>d.online===true).length,off=ds.length-on;
  const sourceStale=!validDate(cfg.lastSync)||Date.now()-Date.parse(cfg.lastSync)>30*60000;
  const notice=`IoT source snapshot: ${stamp(cfg.lastSync)} GST (${age(cfg.lastSync)}). ${sourceStale?'STALE SOURCE — connectivity below reflects the last sync, not current reachability.':'Connectivity is evaluated by the app’s IoT sync from last-seen timestamps.'} Excluded devices are omitted. ${page==='retail'?'Retail scope: LULU Al Wahda, Union Coop Umm Suqeim and Union Coop Al Warqa only.':''}`;
  const group=countBy(ds,d=>d.venue||d.storeName||'Unassigned');
  return {options:venues,hero:hero(page==='retail'?'Retail connectivity':'Edge intelligence',ds.length?`${(on/ds.length*100).toFixed(1)}%`:'—','CONNECTED AT SOURCE SYNC',on,ds.length,[['ONLINE',on],['OFFLINE',off],['TOTAL DEVICES',ds.length],['VENUES',group.length]]),body:kpis([['Devices',ds.length],['Source age',age(cfg.lastSync)],['Snapshot',sourceStale?'Stale':'Available']])+`<div class="live-notice">${esc(notice)}</div><div class="live-summary">${panel(page==='retail'?'Devices by venue':'Compute platforms',barChart(page==='retail'?group:countBy(ds,d=>d.platform)))}${panel(page==='retail'?'Connectivity':'Analytics state',barChart(page==='retail'?[['Online',on],['Offline',off]]:countBy(ds,d=>d.online===true?d.state:'Offline')))}</div>`+panel(page==='retail'?'Venue device status':'Edge devices',table(['Device','Venue','State at sync','Last seen'],ds.slice().sort((a,b)=>Number(a.online)-Number(b.online)).map(d=>[d.displayName||d.deviceId,d.venue||d.storeName||'Unassigned',d.online===true?d.state||'Online':'Offline',age(d.lastSeenUtc)])))+(page==='retail'?retailDetails(cache):'')};
 }
 if(cache.locations){
  const ls=cache.locations.filter(l=>!l.is_combined);const sources=['broadsign','grassfish'];const rs=sources.map(source=>{let healthy=0;const faults=[],times=[];for(const l of ls){healthy+=Math.max(0,Number(l[source+'_healthy_count'])||0);if(l[source+'_as_of'])times.push(l[source+'_as_of']);const seen=new Set();for(const a of l.location_sub_assets||[]){if(a.source!==source||a.status!=='Offline')continue;const match=/(?:Broadsign ID|Grassfish Box ID):\s*(.+)$/.exec(a.notes||'');const id=match?match[1].trim():a.id;if(seen.has(id))continue;seen.add(id);faults.push({name:a.name,venue:l.name,time:a.poll_last_utc});}}return {source,healthy,faults,time:times.sort()[0]};});
  const selected=scope==='all'?rs:rs.filter(r=>r.source===scope);const on=selected.reduce((s,r)=>s+r.healthy,0),off=selected.reduce((s,r)=>s+r.faults.length,0),total=on+off;
  return {options:sources,hero:hero('Network pulse',total?`${(on/total*100).toFixed(1)}%`:'—','MAPPED PLAYER CONNECTIVITY',on,total,[['ONLINE',on],['OFFLINE',off],['PLAYERS',total]]),body:kpis([['Mapped locations',ls.length],['Offline players',off],['Sources',selected.length]])+`<div class="live-notice">Broadsign and Grassfish mapped-location rollups from HM Operations. Combined location wrappers are excluded to avoid double counting. These are player counts, not physical screen/face counts. No uptime history is inferred.</div>`+panel('Source freshness',table(['Source','Online','Offline','Oldest location sync'],selected.map(r=>[r.source,r.healthy,r.faults.length,age(r.time)])))+panel('Offline player watchlist',table(['Player','Venue','Source','Last poll'],selected.flatMap(r=>r.faults.map(f=>[f.name,f.venue,r.source,age(f.time)]))))};
 }
 const all=cache.devices,ds=scope==='all'?all:all.filter(d=>(d.location||'Unassigned')===scope),on=ds.filter(online).length;
 if(page==='black')return intelligenceView(cache);
 if(page==='players'){
  const usage=ds.filter(d=>d.du_scraped_at).map(d=>{const alloc=Number(d.du_data_total_gb),used=Number(d.du_data_used_gb);return {...d,pct:alloc>0&&alloc<=500&&Number.isFinite(used)&&used>=0?used/alloc*100:null}});
  const high=usage.filter(d=>d.pct!==null&&d.pct>=90).length;
  return {options:[...new Set(all.map(d=>d.location||'Unassigned'))].sort(),hero:hero('Player intelligence',on,'RECENT DEVICE HEARTBEATS',on,ds.length,[['OFFLINE',ds.length-on],['MONITORED',ds.length],['DATA ≥90%',high]]),body:kpis([['Online',on,'Heartbeat within 30 min'],['Usage readings',usage.length],['Near data limit',high,'At least 90% of allocation']])+`<div class="live-notice">Digital Directory agent telemetry. Device reachability and SIM usage are independent. Missing or invalid allocations show “Unavailable”; readings older than 48 hours are marked stale.</div>`+panel('Player reachability',table(['Player','Venue','Heartbeat','Last seen'],ds.map(d=>[player(d.hostname),d.location||'Unassigned',online(d)?'Online':'Offline',age(d.last_seen)])))+panel('Cellular usage',table(['Player','Used / allowance GB','Used %','Reading age'],usage.sort((a,b)=>(b.pct??-1)-(a.pct??-1)).map(d=>[player(d.hostname),d.pct===null?'Unavailable':`${Number(d.du_data_used_gb).toFixed(1)} / ${Number(d.du_data_total_gb).toFixed(1)}`,d.pct===null?'Unavailable':d.pct.toFixed(1)+'%',`${age(d.du_scraped_at)}${Date.now()-Date.parse(d.du_scraped_at)>48*3600000?' · STALE':''}`])))};
 }
 const globallyIgnored=cache.globalIgnored?.includes('signage-black-screen');
 const flagged=ds.filter(d=>!globallyIgnored&&!(d.ignored_problem_types||[]).includes('signage-black-screen')&&(d.problems||[]).some(p=>/^Signage player (not running|running but not visible)/.test(p)));
 const current=flagged.filter(online).length;
 return {options:[...new Set(all.map(d=>d.location||'Unassigned'))].sort(),hero:hero('Signage assurance',flagged.length,'PLAYER ALERTS TO REVIEW',ds.length-flagged.length,ds.length,[['RECENT',current],['STALE',flagged.length-current],['MONITORED',ds.length]]),body:kpis([['Current alerts',current],['Stale reports',flagged.length-current],['Detector','Player visibility']])+`<div class="live-notice">Agent-reported player process/window alerts — not image-based black-pixel detection. No confidence score or camera evidence is available from this feed. ${cache.globalIgnored===null?'Fleet-wide suppression settings are not accessible; these are reported signals with per-device exclusions only.':'App fleet-wide and per-device exclusions are applied.'} A recent heartbeat does not prove the physical display is healthy.</div>`+panel('Reported signage issues',table(['Player','Venue','Reported issue','Evidence age'],flagged.map(d=>[player(d.hostname),d.location||'Unassigned',(d.problems||[]).filter(p=>/^Signage player (not running|running but not visible)/.test(p)).join('; '),`${age(d.last_seen)}${online(d)?'':' · STALE'}`])))};
}
function render(){

 const retainedMap=page==='map'&&cache?.mapData&&mapInstance?.update?document.querySelector('.map-panel'):null;
 if(retainedMap)retainedMap.remove();
 if(mapInstance&&!retainedMap){mapView={center:mapInstance.getCenter(),zoom:mapInstance.getZoom(),pitch:mapInstance.getPitch?.(),bearing:mapInstance.getBearing?.()};mapInstance.remove();mapInstance=null;}
 const title=pages.find(p=>p[0]===page)[1],v=cache?view():null;document.title='HM Nexus · '+title;
 $('#app').innerHTML=`<header>${brand}<span class="edition">NEXUS <b>LIVE</b></span><div class="header-right"><span class="source-button">${error?'DATA UNAVAILABLE':cache?'HM OPERATIONS · CONNECTED':'CONNECTING'}</span><button id="refresh">Refresh</button><button id="rotate">${rotation?'Stop rotation':'Rotate screens'}</button><button id="fullscreen" aria-label="Toggle fullscreen">⛶</button></div></header><nav>${pages.map(([id,t],i)=>`<a href="#${id}" class="${id===page?'active':''}"><span>0${i+1}</span>${t}</a>`).join('')}</nav><main data-page="${page}"><div class="pagehead"><div><div class="eyebrow">HM OPERATIONS / PUBLIC DISPLAY</div><h1>${title}</h1></div><div class="live-toolbar">${v?.options?.length?`<select id="scope" aria-label="Filter dashboard"><option value="all">All ${page==='command'?'sources':'venues'}</option>${v.options.map(o=>`<option value="${esc(o)}" ${scope===o?'selected':''}>${esc(o)}</option>`).join('')}</select>`:''}<button id="wall-mode">${document.body.classList.contains('wall-mode')?'Standard view':'Wallboard view'}</button></div></div>${v?`<div class="nexus-stage ${page==='map'?'wide-stage':''}">${v.hero}<div class="nexus-panels">${v.body}</div></div>`:panel(error?'Data unavailable':'Loading HM data',`<div class="live-empty ${error?'load-error':''}" role="status">${esc(error||'Reading your authorized HM Operations data…')}</div>`)}</main><footer><span>HM / NEXUS</span><span>Read-only · Auto-refresh 30s · ${loadedAt?'Last fetched '+stamp(loadedAt)+' GST':'Awaiting data'}</span><a href="https://operations.hypermedia.ae/" target="_blank" rel="noopener">HM Operations</a></footer>`;
 $('#refresh').onclick=refresh;$('#rotate').onclick=toggleRotate;$('#wall-mode').onclick=()=>{document.body.classList.toggle('wall-mode');render();};
 $('#fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen().catch(()=>{});
 if($('#scope'))$('#scope').onchange=e=>{scope=e.target.value;render();};
 if(retainedMap){document.querySelector('main .pagehead').after(retainedMap);drawMap(cache.mapData,cache.locations);mapInstance.resize();}
 else if(page==='map'&&cache?.mapData){const container=document.createElement('section');container.className='panel map-panel';container.innerHTML='<div class="panel-head"><h2>Asset network map</h2><button id="fit-map">Fit all assets</button></div><div class="map-legend"><span class="map-online">● Online</span><span class="map-offline">● Offline</span><span>● Unknown / stale source</span></div><div id="map-summary" class="live-notice"></div><div id="asset-map" aria-label="Asset inventory location and connectivity map"></div><div class="live-panel-body" id="map-notes"></div>';document.querySelector('main .pagehead').after(container);drawMap(cache.mapData,cache.locations);}
}
function mappedAssets(data,locations){
 const byPlayer=new Map();
 for(const d of data.devices){for(const [source,id] of [['broadsign',d.broadsign_player_id],['grassfish',d.grassfish_box_id]]){if(!id)continue;const key=source+':'+String(id).trim(),old=byPlayer.get(key);if(!old||Date.parse(d.last_seen||0)>Date.parse(old.last_seen||0))byPlayer.set(key,d);}}
 const iotById=new Map((data.iot?.devices||[]).map(d=>[String(d.deviceId).trim(),d]));
 const offline=new Map();for(const l of locations.filter(x=>!x.is_combined)){for(const a of l.location_sub_assets||[]){if(a.status!=='Offline')continue;const m=/(?:Broadsign ID|Grassfish Box ID):\s*(.+)$/.exec(a.notes||'');if(m)offline.set(a.source+':'+m[1].trim(),{lastSync:l[a.source+'_as_of'],lastSeen:a.poll_last_utc});}}
 const points=[];let missing=0;
 for(const a of data.assets){
  if(a.lat===null||a.lng===null||String(a.lat).trim()===''||String(a.lng).trim()===''){missing++;continue;}
  const lat=coarse(Number(a.lat)),lng=coarse(Number(a.lng));if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180){missing++;continue;}
  const type=String(a.player_type||'').toLowerCase(),box=String(a.player_box_id||'').trim(),key=type+':'+box;
  let state='unknown',source='No exact device match',lastSeen=null;
  if(type==='iot'){
   const d=iotById.get(box);if(d){lastSeen=d.lastSeenUtc;source='IoT sync';if(validDate(data.iot.lastSync)&&Date.now()-Date.parse(data.iot.lastSync)<30*60000&&typeof d.online==='boolean')state=d.online?'online':'offline';else source='IoT sync is stale';}
  }else{
   const fault=offline.get(key),d=byPlayer.get(key);
   if(fault&&validDate(fault.lastSync)&&Date.now()-Date.parse(fault.lastSync)<30*60000){state='offline';source=type+' sync';lastSeen=fault.lastSeen;}
   else if(d&&validDate(d.last_seen)){state=online(d)?'online':'offline';source='HM agent heartbeat';lastSeen=d.last_seen;}
  }
  points.push({...a,lat,lng,state,source,lastSeen});
 }
 return {points,missing};
}
function drawMap(data,locations){
 const {points,missing}=mappedAssets(data,locations);
 $('#map-summary').textContent=`${points.length} mapped assets · ${points.filter(p=>p.state==='online').length} online · ${points.filter(p=>p.state==='offline').length} offline · ${points.filter(p=>p.state==='unknown').length} unknown · ${missing} without valid coordinates`;
 $('#map-notes').textContent='Exact player/device ID matching. Agent status uses a 30-minute heartbeat threshold; source syncs older than 30 minutes are not treated as current. Pulsing green = online; red = offline; grey = unknown. Groups turn red if any screen is offline; ON / OFF labels show the counts. Click a location for each screen. Use Start venue tour for animated fly-throughs. '+data.issues.join(' ');
 if(mapInstance?.update){mapInstance.update(points);return;}
 if(window.HMMap3D){mapInstance=window.HMMap3D.mount({points,view:mapView,container:'asset-map',token:config.mapboxToken});return;}
 if(!window.L){$('#asset-map').textContent='Map library could not load. Refresh to retry.';return;}
 mapInstance=L.map('asset-map',{scrollWheelZoom:false}).setView([25.15,55.3],8);
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(mapInstance);
 const groups=new Map();for(const p of points){const key=p.lat+','+p.lng;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
 for(const group of groups.values()){
  const first=group[0],state=group.some(p=>p.state==='offline')?'offline':group.some(p=>p.state==='unknown')?'unknown':'online';
  const popup=document.createElement('div');popup.className='map-popup';
  for(const p of group){const row=document.createElement('p');row.textContent=`${p.name} · ${p.venue||'Unassigned'} — ${p.state.toUpperCase()} (${p.source}; last seen ${age(p.lastSeen)})`;popup.append(row);}
  const icon=L.divIcon({className:'asset-pin',html:`<span class="map-dot ${state}">${group.length>1?group.length:''}</span>`,iconSize:[22,22],iconAnchor:[11,11]});
  L.marker([first.lat,first.lng],{icon,title:`${group.length} asset(s): ${state}`}).addTo(mapInstance).bindPopup(popup,{maxHeight:250,maxWidth:360});
 }
 const fit=()=>{if(points.length)mapInstance.fitBounds(points.map(p=>[p.lat,p.lng]),{padding:[35,35],maxZoom:15});};
 if(mapView)mapInstance.setView(mapView.center,mapView.zoom);else fit();$('#fit-map').onclick=()=>{mapView=null;fit();};
}
function toggleRotate(){if(rotation){clearInterval(rotation);rotation=null;}else rotation=setInterval(()=>{location.hash=pages[(pages.findIndex(p=>p[0]===page)+1)%pages.length][0];},20000);render();}
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(!pages.some(p=>p[0]===next)||next===page)return;page=next;scope='all';cache=null;loadedAt=null;error='';generation++;render();refresh();});
setInterval(refresh,30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
render();refresh();if(params.get('rotate')==='1')toggleRotate();
})();
