/* HM Nexus: read-only views over the same Supabase project as HM Operations.
 * Never uses a service-role key or reads vendor credentials. RLS remains authoritative.
 * Snapshots refresh every 30s; upstream timestamps, not fetch time, describe freshness.
 */
(() => {
'use strict';
const pages=[['command','Operations Command Center'],['retail','Retail Media Live'],['players','Player Intelligence'],['wall','Live Wall'],['black','Black Screen Intelligence']];
const $=s=>document.querySelector(s), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>Number(n||0).toLocaleString('en-US'), validDate=x=>x&&Number.isFinite(Date.parse(x));
const age=x=>{if(!validDate(x))return 'Not reported';const m=Math.max(0,Math.floor((Date.now()-Date.parse(x))/60000));return m<1?'Just now':m<60?`${m} min ago`:m<1440?`${Math.floor(m/60)} h ago`:`${Math.floor(m/1440)} days ago`};
const stamp=x=>validDate(x)?new Date(x).toLocaleString('en-GB',{timeZone:'Asia/Dubai'}):'Not reported';
const online=d=>validDate(d.last_seen)&&Date.now()-Date.parse(d.last_seen)<30*60000;
const config=window.HM_CONFIG;
if(!window.supabase||!config){$('#app').textContent='Unable to load sign-in. Please reload.';return;}
const client=window.supabase.createClient(config.url,config.anonKey,{auth:{storageKey:'hm-nexus-session-v1',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
let page=location.hash.slice(1)||window.INITIAL_PAGE||'command';if(!pages.some(p=>p[0]===page))page='command';
let profile=null,perms=[],factor=null,authBusy=false,cache=null,error='',scope='all',generation=0,fetching=false,rotation=null,loadedAt=null,authGeneration=0;
let mapInstance=null,mapView=null;
const params=new URLSearchParams(location.search);if(params.get('display')==='wall')document.body.classList.add('wall-mode');
const brand='<a class="brand" href="#command"><img class="hm-logo" src="hm-logo.png" alt="HM"><span><strong>HYPERMEDIA</strong><small>NETWORK INTELLIGENCE</small></span></a>';
function allowed(area){return profile?.role==='admin'||perms.some(p=>p.area===area&&p.can_view);}
function authView(message=''){
 document.title='HM Nexus · Sign in';
 $('#app').innerHTML=`<section class="auth-card">${brand}<h1>${factor?'Two-step verification':'Sign in to HM Nexus'}</h1><p>Use your HM Operations account. Your existing app permissions apply to these dashboards.</p><form id="login-form">${factor?'<label for="code">Authenticator code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>':'<label for="identifier">Username or email</label><input id="identifier" name="identifier" autocomplete="username" required><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>'}<p class="auth-error" role="alert">${esc(message)}</p><button type="submit">${factor?'Verify and open dashboards':'Sign in'}</button></form><p>The website is public; operational data requires an authorized account. <a href="https://operations.hypermedia.ae/" target="_blank" rel="noopener">Open HM Operations</a></p>${factor?'<button id="cancel-auth">Use another account</button>':''}</section>`;
 $('#login-form').onsubmit=async e=>{
  e.preventDefault();if(authBusy)return;authBusy=true;const btn=e.target.querySelector('button');btn.disabled=true;btn.textContent='Checking…';
  try{
   if(factor){const r=await client.auth.mfa.challengeAndVerify({factorId:factor,code:$('#code').value.trim()});if(r.error)throw r.error;factor=null;}
   else{const identifier=$('#identifier').value.trim(),password=$('#password').value;
    const {data,error:err}=await client.functions.invoke('resolve-login',{body:{identifier,password}});$('#password').value='';
    if(err||data?.error||!data?.access_token)throw new Error('Sign-in failed. Check your HM credentials and try again.');
    const r=await client.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});if(r.error)throw r.error;
   }
   await authenticate();
  }catch(e){authView(e.message||'Sign-in could not be completed.');}finally{authBusy=false;}
 };
 if($('#cancel-auth'))$('#cancel-auth').onclick=signOut;
}
async function signOut(){authGeneration++;generation++;profile=null;perms=[];cache=null;loadedAt=null;error='';factor=null;if(mapInstance){mapInstance.remove();mapInstance=null;}mapView=null;clearInterval(rotation);rotation=null;authView();await client.auth.signOut({scope:'local'});}
async function authenticate(){
 const authId=++authGeneration;
 try{
  const {data:{session},error:sessionError}=await client.auth.getSession();if(sessionError)throw sessionError;
  if(!session){authView();return;}
  const {data:assurance,error:mfaError}=await client.auth.mfa.getAuthenticatorAssuranceLevel();if(mfaError)throw mfaError;
  if(assurance.nextLevel==='aal2'&&assurance.currentLevel!=='aal2'){
   const {data,error:err}=await client.auth.mfa.listFactors();if(err)throw err;factor=data.totp.find(f=>f.status==='verified')?.id;if(!factor)throw new Error('MFA verification is required. Open HM Operations to resolve your sign-in.');authView();return;
  }
  const [{data:p,error:pe},{data:ps,error:pse}]=await Promise.all([client.from('profiles').select('id,role,active').eq('id',session.user.id).maybeSingle(),client.from('user_permissions').select('area,can_view').eq('user_id',session.user.id)]);
  if(pe||pse)throw pe||pse;if(!p?.active)throw new Error('This HM account is inactive or inaccessible.');
  if(authId!==authGeneration)return;profile=p;perms=ps||[];factor=null;render();await refresh();
  if(params.get('rotate')==='1'&&!rotation)toggleRotate();
 }catch(e){profile=null;cache=null;authView(e.message||'Unable to verify account access.');}
}
async function allRows(table,columns,filter){
 const rows=[];for(let from=0;;from+=500){let q=client.from(table).select(columns).order('id').range(from,from+499);if(filter)q=filter(q);const {data,error}=await q;if(error)throw error;rows.push(...data);if(data.length<500)return rows;}
}
async function loadIot(){
 // app_settings is admin-only in the app's existing RLS. Project only telemetry fields;
 // do not request the full JSON object, which also contains vendor credentials.
 if(profile.role!=='admin')throw new Error('This IoT feed currently requires an HM administrator account, matching the app database permissions.');
 const {data,error}=await client.from('app_settings').select('lastSync:value->>lastSync,devices:value->lastDevices,excluded:value->excludedDeviceIds,staleMinutes:value->staleAfterMinutes').eq('key','iotApi').maybeSingle();
 if(error)throw error;if(!data||!Array.isArray(data.devices))throw new Error('No accessible IoT sync snapshot. Run the existing IoT sync from HM Operations.');
 const excluded=new Set((data.excluded||[]).map(String));return {...data,devices:data.devices.filter(d=>!excluded.has(String(d.deviceId)))};
}
async function load(){
 if(page==='wall'||page==='retail')return {iot:await loadIot()};
 if(page==='command'){
  if(!allowed('locations')&&!allowed('maintenancePanels'))throw new Error('Your HM account needs Locations or Maintenance Panels view access.');
  const locations=await allRows('locations','id,name,chain,is_combined,broadsign_healthy_count,grassfish_healthy_count,broadsign_as_of,grassfish_as_of,location_sub_assets(id,name,status,source,poll_last_utc,notes)',q=>q.is('deleted_at',null));
  const mapData={assets:[],devices:[],iot:null,issues:[]};
  if(allowed('assetsInventory')){try{mapData.assets=await allRows('asset_inventory','id,name,venue,lat,lng,player_type,player_box_id',q=>q.is('deleted_at',null));}catch(e){mapData.issues.push('Asset inventory unavailable: '+e.message);}}else mapData.issues.push('Asset Inventory view permission is required for map coordinates.');
  if(allowed('workspaceDirectory')){try{mapData.devices=await allRows('workspace_devices','id,hostname,last_seen,broadsign_player_id,grassfish_box_id',q=>q.is('removed_at',null));}catch(e){mapData.issues.push('Agent status unavailable: '+e.message);}}
  if(profile.role==='admin'){try{mapData.iot=await loadIot();}catch(e){mapData.issues.push('IoT map status unavailable.');}}
  return {locations,mapData};
 }
 if(!allowed('workspaceDirectory'))throw new Error('Your HM account needs Digital Directory view access.');
 const devices=await allRows('workspace_devices','id,hostname,location,last_seen,problems,ignored_problem_types,du_data_used_gb,du_data_total_gb,du_scraped_at',q=>q.is('removed_at',null));
 let globalIgnored=[];
 if(page==='black'){
  const {data,error}=await client.from('app_settings').select('value').eq('key','workspaceDirectoryIgnoredProblemTypes').maybeSingle();if(error)throw error;
  // If RLS hides this setting, do not silently claim the app's suppression policy was applied.
  globalIgnored=Array.isArray(data?.value)?data.value:null;
 }
 return {devices,globalIgnored};
}
async function refresh(){
 if(!profile||fetching)return;fetching=true;const id=generation;
 try{
  // Re-check activity/permissions on every refresh; do not retain rows after access errors.
  const {data:p,error:pe}=await client.from('profiles').select('id,role,active').eq('id',profile.id).maybeSingle();if(pe)throw pe;if(!p?.active){await signOut();return;}
  const {data:ps,error:pse}=await client.from('user_permissions').select('area,can_view').eq('user_id',p.id);if(pse)throw pse;
  profile=p;perms=ps||[];const result=await load();if(id!==generation)return;cache=result;error='';loadedAt=new Date().toISOString();
 }catch(e){if(id===generation){cache=null;error=e.message||'Data unavailable. Please retry.';}}
 finally{fetching=false;if(id===generation&&profile)render();else if(profile)refresh();}
}
function table(headers,rows){return `<div class="live-table"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">No matching records.</td></tr>`}</tbody></table></div>`;}
function panel(title,body){return `<section class="panel"><div class="panel-head"><h2>${esc(title)}</h2></div><div class="live-panel-body">${body}</div></section>`;}
function barChart(items){const max=Math.max(1,...items.map(x=>x[1]));return `<div class="live-bars">${items.map(([label,value])=>`<div><div class="live-bar-label"><span>${esc(label)}</span><b>${number(value)}</b></div><div class="live-track"><div class="live-fill" style="width:${Math.max(0,value/max*100)}%"></div></div></div>`).join('')||'No reported values.'}</div>`;}
function countBy(rows,get){const m=new Map();rows.forEach(r=>{const k=String(get(r)||'Unknown');m.set(k,(m.get(k)||0)+1)});return [...m].sort((a,b)=>b[1]-a[1]);}
function hero(title,value,label,connected,total,stats){const pct=total?Math.min(100,Math.max(0,connected/total*100)):0;return `<section class="pulse-hero"><div class="hero-caption"><span class="micro">HM / AUTHENTICATED TELEMETRY</span><span class="orbit-symbol">◈</span></div><h2>${esc(title)}</h2><div class="holo-stage"><div class="orbital o1"></div><div class="orbital o2"></div><div class="holo-ring" style="--ring:conic-gradient(var(--green) 0 ${pct}%,var(--red) ${pct}% 100%)"><div class="ring-hole"></div></div><div class="holo-number">${esc(value)}<span>${esc(label)}</span></div><div class="chart-coordinate left">HM OPERATIONS</div><div class="chart-coordinate right">SYNCED DATA</div></div><div class="pulse-stats">${stats.map(([k,v])=>`<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div><div class="hero-note">Refreshes every 30 seconds · upstream sync cadence applies</div></section>`;}
function kpis(items){return `<div class="kpis secondary-kpis">${items.map(([label,v,sub])=>`<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(v)}</div><div class="kpi-sub">${esc(sub||'')}</div></div>`).join('')}</div>`;}
function view(){
 if(cache.iot){
  const cfg=cache.iot;let ds=cfg.devices;const venues=[...new Set(ds.map(d=>d.venue||d.storeName||'Unassigned'))].sort();
  if(scope!=='all')ds=ds.filter(d=>(d.venue||d.storeName||'Unassigned')===scope);
  const on=ds.filter(d=>d.online===true).length,off=ds.length-on;
  const sourceStale=!validDate(cfg.lastSync)||Date.now()-Date.parse(cfg.lastSync)>30*60000;
  const notice=`IoT source snapshot: ${stamp(cfg.lastSync)} GST (${age(cfg.lastSync)}). ${sourceStale?'STALE SOURCE — connectivity below reflects the last sync, not current reachability.':'Connectivity is evaluated by the app’s IoT sync from last-seen timestamps.'} Excluded devices are omitted. ${page==='retail'?'This view includes all accessible IoT venues; use the venue filter for your retail estate.':''}`;
  const group=countBy(ds,d=>d.venue||d.storeName||'Unassigned');
  return {options:venues,hero:hero(page==='retail'?'Retail connectivity':'Edge intelligence',ds.length?`${(on/ds.length*100).toFixed(1)}%`:'—','CONNECTED AT SOURCE SYNC',on,ds.length,[['ONLINE',on],['OFFLINE',off],['VENUES',group.length]]),body:kpis([['Devices',ds.length],['Source age',age(cfg.lastSync)],['Snapshot',sourceStale?'Stale':'Available']])+`<div class="live-notice">${esc(notice)}</div><div class="live-summary">${panel(page==='retail'?'Devices by venue':'Compute platforms',barChart(page==='retail'?group:countBy(ds,d=>d.platform)))}${panel(page==='retail'?'Connectivity':'Analytics state',barChart(page==='retail'?[['Online',on],['Offline',off]]:countBy(ds,d=>d.online===true?d.state:'Offline')))}</div>`+panel(page==='retail'?'Venue device status':'Edge devices',table(['Device','Venue','State at sync','Last seen'],ds.slice().sort((a,b)=>Number(a.online)-Number(b.online)).map(d=>[d.displayName||d.deviceId,d.venue||d.storeName||'Unassigned',d.online===true?d.state||'Online':'Offline',age(d.lastSeenUtc)])))};
 }
 if(cache.locations){
  const ls=cache.locations.filter(l=>!l.is_combined);const sources=['broadsign','grassfish'];const rs=sources.map(source=>{let healthy=0;const faults=[],times=[];for(const l of ls){healthy+=Math.max(0,Number(l[source+'_healthy_count'])||0);if(l[source+'_as_of'])times.push(l[source+'_as_of']);const seen=new Set();for(const a of l.location_sub_assets||[]){if(a.source!==source||a.status!=='Offline')continue;const match=/(?:Broadsign ID|Grassfish Box ID):\s*(.+)$/.exec(a.notes||'');const id=match?match[1].trim():a.id;if(seen.has(id))continue;seen.add(id);faults.push({name:a.name,venue:l.name,time:a.poll_last_utc});}}return {source,healthy,faults,time:times.sort()[0]};});
  const selected=scope==='all'?rs:rs.filter(r=>r.source===scope);const on=selected.reduce((s,r)=>s+r.healthy,0),off=selected.reduce((s,r)=>s+r.faults.length,0),total=on+off;
  return {options:sources,hero:hero('Network pulse',total?`${(on/total*100).toFixed(1)}%`:'—','MAPPED PLAYER CONNECTIVITY',on,total,[['ONLINE',on],['OFFLINE',off],['PLAYERS',total]]),body:kpis([['Mapped locations',ls.length],['Offline players',off],['Sources',selected.length]])+`<div class="live-notice">Broadsign and Grassfish mapped-location rollups from HM Operations. Combined location wrappers are excluded to avoid double counting. These are player counts, not physical screen/face counts. No uptime history is inferred.</div>`+panel('Source freshness',table(['Source','Online','Offline','Oldest location sync'],selected.map(r=>[r.source,r.healthy,r.faults.length,age(r.time)])))+panel('Offline player watchlist',table(['Player','Venue','Source','Last poll'],selected.flatMap(r=>r.faults.map(f=>[f.name,f.venue,r.source,age(f.time)]))))};
 }
 const all=cache.devices,ds=scope==='all'?all:all.filter(d=>(d.location||'Unassigned')===scope),on=ds.filter(online).length;
 if(page==='players'){
  const usage=ds.filter(d=>d.du_scraped_at).map(d=>{const alloc=Number(d.du_data_total_gb),used=Number(d.du_data_used_gb);return {...d,pct:alloc>0&&alloc<=500&&Number.isFinite(used)&&used>=0?used/alloc*100:null}});
  const high=usage.filter(d=>d.pct!==null&&d.pct>=90).length;
  return {options:[...new Set(all.map(d=>d.location||'Unassigned'))].sort(),hero:hero('Player intelligence',on,'RECENT DEVICE HEARTBEATS',on,ds.length,[['OFFLINE',ds.length-on],['MONITORED',ds.length],['DATA ≥90%',high]]),body:kpis([['Online',on,'Heartbeat within 30 min'],['Usage readings',usage.length],['Near data limit',high,'At least 90% of allocation']])+`<div class="live-notice">Digital Directory agent telemetry. Device reachability and SIM usage are independent. Missing or invalid allocations show “Unavailable”; readings older than 48 hours are marked stale.</div>`+panel('Player reachability',table(['Player','Venue','Heartbeat','Last seen'],ds.map(d=>[d.hostname,d.location||'Unassigned',online(d)?'Online':'Offline',age(d.last_seen)])))+panel('Cellular usage',table(['Player','Used / allowance GB','Used %','Reading age'],usage.sort((a,b)=>(b.pct??-1)-(a.pct??-1)).map(d=>[d.hostname,d.pct===null?'Unavailable':`${Number(d.du_data_used_gb).toFixed(1)} / ${Number(d.du_data_total_gb).toFixed(1)}`,d.pct===null?'Unavailable':d.pct.toFixed(1)+'%',`${age(d.du_scraped_at)}${Date.now()-Date.parse(d.du_scraped_at)>48*3600000?' · STALE':''}`])))};
 }
 const globallyIgnored=cache.globalIgnored?.includes('signage-black-screen');
 const flagged=ds.filter(d=>!globallyIgnored&&!(d.ignored_problem_types||[]).includes('signage-black-screen')&&(d.problems||[]).some(p=>/^Signage player (not running|running but not visible)/.test(p)));
 const current=flagged.filter(online).length;
 return {options:[...new Set(all.map(d=>d.location||'Unassigned'))].sort(),hero:hero('Signage assurance',flagged.length,'PLAYER ALERTS TO REVIEW',ds.length-flagged.length,ds.length,[['RECENT',current],['STALE',flagged.length-current],['MONITORED',ds.length]]),body:kpis([['Current alerts',current],['Stale reports',flagged.length-current],['Detector','Player visibility']])+`<div class="live-notice">Agent-reported player process/window alerts — not image-based black-pixel detection. No confidence score or camera evidence is available from this feed. ${cache.globalIgnored===null?'Fleet-wide suppression settings are not accessible; these are reported signals with per-device exclusions only.':'App fleet-wide and per-device exclusions are applied.'} A recent heartbeat does not prove the physical display is healthy.</div>`+panel('Reported signage issues',table(['Player','Venue','Reported issue','Evidence age'],flagged.map(d=>[d.hostname,d.location||'Unassigned',(d.problems||[]).filter(p=>/^Signage player (not running|running but not visible)/.test(p)).join('; '),`${age(d.last_seen)}${online(d)?'':' · STALE'}`])))};
}
function render(){
 if(!profile)return;
 if(mapInstance){mapView={center:mapInstance.getCenter(),zoom:mapInstance.getZoom()};mapInstance.remove();mapInstance=null;}
 const title=pages.find(p=>p[0]===page)[1],v=cache?view():null;document.title='HM Nexus · '+title;
 $('#app').innerHTML=`<header>${brand}<span class="edition">NEXUS <b>LIVE</b></span><div class="header-right"><span class="source-button">${error?'DATA UNAVAILABLE':cache?'HM OPERATIONS · CONNECTED':'CONNECTING'}</span><button id="refresh">Refresh</button><button id="rotate">${rotation?'Stop rotation':'Rotate screens'}</button><button id="fullscreen" aria-label="Toggle fullscreen">⛶</button><button id="logout">Sign out</button></div></header><nav>${pages.map(([id,t],i)=>`<a href="#${id}" class="${id===page?'active':''}"><span>0${i+1}</span>${t}</a>`).join('')}</nav><main data-page="${page}"><div class="pagehead"><div><div class="eyebrow">HM OPERATIONS / AUTHENTICATED</div><h1>${title}</h1></div><div class="live-toolbar">${v?.options?.length?`<select id="scope" aria-label="Filter dashboard"><option value="all">All ${page==='command'?'sources':'venues'}</option>${v.options.map(o=>`<option value="${esc(o)}" ${scope===o?'selected':''}>${esc(o)}</option>`).join('')}</select>`:''}<button id="wall-mode">${document.body.classList.contains('wall-mode')?'Standard view':'Wallboard view'}</button></div></div>${v?`<div class="nexus-stage">${v.hero}<div class="nexus-panels">${v.body}</div></div>`:panel(error?'Data unavailable':'Loading HM data',`<div class="live-empty ${error?'load-error':''}" role="status">${esc(error||'Reading your authorized HM Operations data…')}</div>`)}</main><footer><span>HM / NEXUS</span><span>Read-only · Auto-refresh 30s · ${loadedAt?'Last fetched '+stamp(loadedAt)+' GST':'Awaiting data'}</span><a href="https://operations.hypermedia.ae/" target="_blank" rel="noopener">HM Operations</a></footer>`;
 $('#logout').onclick=signOut;$('#refresh').onclick=refresh;$('#rotate').onclick=toggleRotate;$('#wall-mode').onclick=()=>{document.body.classList.toggle('wall-mode');render();};
 $('#fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen().catch(()=>{});
 if($('#scope'))$('#scope').onchange=e=>{scope=e.target.value;render();};
 if(page==='command'&&cache?.mapData){const container=document.createElement('section');container.className='panel map-panel';container.innerHTML='<div class="panel-head"><h2>Asset network map</h2><button id="fit-map">Fit all assets</button></div><div class="map-legend"><span class="map-online">● Online</span><span class="map-offline">● Offline</span><span>● Unknown / stale source</span></div><div id="map-summary" class="live-notice"></div><div id="asset-map" aria-label="Asset inventory location and connectivity map"></div><div class="live-panel-body" id="map-notes"></div>';document.querySelector('main .pagehead').after(container);drawMap(cache.mapData,cache.locations);}
}
function mappedAssets(data,locations){
 const byPlayer=new Map();
 for(const d of data.devices){for(const [source,id] of [['broadsign',d.broadsign_player_id],['grassfish',d.grassfish_box_id]]){if(!id)continue;const key=source+':'+String(id).trim(),old=byPlayer.get(key);if(!old||Date.parse(d.last_seen||0)>Date.parse(old.last_seen||0))byPlayer.set(key,d);}}
 const iotById=new Map((data.iot?.devices||[]).map(d=>[String(d.deviceId).trim(),d]));
 const offline=new Map();for(const l of locations.filter(x=>!x.is_combined)){for(const a of l.location_sub_assets||[]){if(a.status!=='Offline')continue;const m=/(?:Broadsign ID|Grassfish Box ID):\s*(.+)$/.exec(a.notes||'');if(m)offline.set(a.source+':'+m[1].trim(),{lastSync:l[a.source+'_as_of'],lastSeen:a.poll_last_utc});}}
 const points=[];let missing=0;
 for(const a of data.assets){
  if(a.lat===null||a.lng===null||String(a.lat).trim()===''||String(a.lng).trim()===''){missing++;continue;}
  const lat=Number(a.lat),lng=Number(a.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180){missing++;continue;}
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
 $('#map-notes').textContent='Exact player/device ID matching. Agent status uses a 30-minute heartbeat threshold; source syncs older than 30 minutes are not treated as current. Assets at identical coordinates share a dot; click it to see each asset. '+data.issues.join(' ');
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
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(!pages.some(p=>p[0]===next)||next===page)return;page=next;scope='all';cache=null;loadedAt=null;error='';generation++;if(profile){render();refresh();}});
client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){authGeneration++;generation++;profile=null;cache=null;perms=[];if(mapInstance){mapInstance.remove();mapInstance=null;}mapView=null;clearInterval(rotation);rotation=null;authView();}});
setInterval(()=>{if(profile)refresh();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&profile)refresh();});
authView();authenticate();
})();
