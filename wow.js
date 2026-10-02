(() => {
 const done=new WeakSet(),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 let savedSearch='';
 function detail(title,lines){
  let dialog=document.querySelector('#live-inspector');if(!dialog){dialog=document.createElement('dialog');dialog.id='live-inspector';document.body.append(dialog);}
  dialog.replaceChildren();const h=document.createElement('h2');h.textContent=title;dialog.append(h);
  lines.forEach(([label,value])=>{const row=document.createElement('div');row.className='inspect-row';const k=document.createElement('span'),v=document.createElement('strong');k.textContent=label;v.textContent=value;row.append(k,v);dialog.append(row);});
  const close=document.createElement('button');close.textContent='Close details';close.onclick=()=>dialog.close();dialog.append(close);dialog.showModal();dialog.onclick=e=>{if(e.target===dialog)dialog.close();};
 }
 function enhance(){
 document.querySelectorAll('.live-table td').forEach(td=>{const text=td.textContent.trim();if(/^(Offline|Critical|High|Open|In Progress|New)$/.test(text))td.classList.add('status-bad');if(/^(Online|Healthy|Resolved|Closed|No reported problems)$/.test(text))td.classList.add('status-good');});
  document.querySelectorAll('.kpi-value,.pulse-stats b').forEach(el=>{if(done.has(el))return;done.add(el);const text=el.textContent,n=Number(text.replaceAll(',',''));if(reduced||!/^\d[\d,]*$/.test(text)||!Number.isFinite(n))return;const start=performance.now();function frame(t){if(!el.isConnected)return;const p=Math.min(1,(t-start)/750);el.textContent=Math.round(n*(1-Math.pow(1-p,3))).toLocaleString('en-US');if(p<1)requestAnimationFrame(frame);else el.textContent=text;}requestAnimationFrame(frame);});
  document.querySelectorAll('.live-bar-label').forEach(el=>{if(done.has(el))return;done.add(el);const parent=el.parentElement;parent.classList.add('interactive-bar');parent.tabIndex=0;parent.setAttribute('role','button');const show=()=>detail(el.firstElementChild.textContent,[['Reported count',el.lastElementChild.textContent],['Source','Latest HM Operations snapshot']]);parent.onclick=show;parent.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();show();}};});
  document.querySelectorAll('.live-table tbody tr').forEach(row=>{if(done.has(row)||row.cells.length<2)return;done.add(row);row.tabIndex=0;row.classList.add('interactive-row');const show=()=>{const headers=[...row.closest('table').querySelectorAll('thead th')].map(x=>x.textContent);detail(row.cells[0].textContent,[...row.cells].map((c,i)=>[headers[i],c.textContent]));};row.onclick=show;row.onkeydown=e=>{if(e.key==='Enter'){show();}};});
  const main=document.querySelector('main'),toolbar=document.querySelector('.live-toolbar');
  if(main&&toolbar&&!document.querySelector('#inspect-search')){
   const input=document.createElement('input');input.id='inspect-search';input.placeholder='Find a player or venue…';input.setAttribute('aria-label','Search displayed tables');input.value=savedSearch;toolbar.prepend(input);
   const filter=()=>{savedSearch=input.value;main.querySelectorAll('.live-table tbody tr').forEach(r=>{r.hidden=!r.textContent.toLowerCase().includes(savedSearch.toLowerCase());});};input.oninput=filter;filter();
  }
 }
 let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;enhance();});}).observe(document.getElementById('app'),{childList:true,subtree:true});enhance();
})();

// Screen playback: preserve table progress across DOM replacements on data refresh.
(()=>{
 const positions=new Map();let paused=false,holdUntil=Date.now()+7000,last=performance.now(),pageY=0,lastPage='';
 const params=new URLSearchParams(location.search);if(params.get('panel')==='1')document.body.classList.add('cms-panel');
 const control=document.createElement('button');control.className='playback-toggle';control.textContent='Pause auto-scroll';control.onclick=()=>{paused=!paused;control.textContent=paused?'Resume auto-scroll':'Pause auto-scroll';};document.body.append(control);
 const clock=document.createElement('time');clock.className='screen-clock';document.body.append(clock);
 setInterval(()=>clock.textContent=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())+' GST',1000);
 for(const name of ['wheel','touchstart','keydown'])window.addEventListener(name,()=>{holdUntil=Date.now()+20000;pageY=scrollY;},{passive:true});
 function step(time){const dt=Math.min(100,time-last)/1000;last=time;requestAnimationFrame(step);if(document.hidden||paused||document.querySelector('dialog[open]')||document.activeElement?.matches('input,select,textarea')||Date.now()<holdUntil)return;
 const page=document.querySelector('main')?.dataset.page;if(!page)return;if(page!==lastPage){lastPage=page;pageY=0;window.scrollTo(0,0);holdUntil=Date.now()+6000;}
 const tables=[...document.querySelectorAll('.live-table')];let reading=false;
 for(const [i,el] of tables.entries()){const key=page+':'+(el.closest('.panel')?.querySelector('h2')?.textContent||i);let state=positions.get(key);if(!state){state={y:0,done:false,end:0};positions.set(key,state);}const max=el.scrollHeight-el.clientHeight;if(max<2)continue;el.scrollTop=Math.min(state.y,max);const rect=el.getBoundingClientRect();if(rect.top>=30&&rect.bottom<=innerHeight-25&&!state.done){reading=true;state.y=Math.min(max,state.y+14*dt);el.scrollTop=state.y;if(state.y>=max){if(!state.end)state.end=Date.now()+5000;if(Date.now()>=state.end)state.done=true;}break;}}
 if(reading)return;const maxPage=document.documentElement.scrollHeight-innerHeight;if(maxPage<2)return;pageY=Math.min(maxPage,Math.max(pageY,scrollY)+16*dt);window.scrollTo(0,pageY);if(pageY>=maxPage-1){holdUntil=Date.now()+7000;pageY=0;positions.clear();window.scrollTo(0,0);}
 }requestAnimationFrame(step);
})();
