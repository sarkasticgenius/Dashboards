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
