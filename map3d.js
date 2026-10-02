/* Inventory coordinates remain authoritative; no artificial position offsets. */
window.HMMap3D={mount({points,view,container,token}){
 const root=document.getElementById(container);root.replaceChildren();
 if(!token||!token.startsWith('pk.')){root.textContent='3D map is ready for a Mapbox public access token.';return null;}
 if(!window.mapboxgl||!mapboxgl.supported()){root.textContent='3D maps require WebGL support in this browser.';return null;}
 const wrapper=root.parentElement;
 const tools=document.createElement('div');tools.className='map3d-tools';
 const search=document.createElement('input');search.type='search';search.placeholder='Find a venue or screen…';search.setAttribute('aria-label','Find a venue or screen');
 const tilt=document.createElement('button');tilt.textContent='2D / 3D';
 const tour=document.createElement('button');tour.textContent='Start venue tour';
 const details=document.createElement('div');details.className='map3d-details';details.setAttribute('aria-live','polite');
 tools.append(search,tilt,tour);root.before(tools);root.after(details);
 const groups=new Map();points.forEach(p=>{const key=p.lng+','+p.lat;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);});
 let sites=[...groups.values()];let timer=null,current=0,pulseTimer=null,selectedKey=null;
 const statusColor=['case',['>', ['get','offline'],0],'#ff3e58',['>', ['get','unknown'],0],'#9ba8b8','#16ef9d'];
 const snapshot=()=>({type:'FeatureCollection',features:sites.map((g,index)=>({type:'Feature',geometry:{type:'Point',coordinates:[g[0].lng,g[0].lat]},properties:{index,screens:g.length,online:g.filter(p=>p.state==='online').length,offline:g.filter(p=>p.state==='offline').length,unknown:g.filter(p=>p.state==='unknown').length,name:g[0].venue||g[0].name||'Screen location'}}))});
 const makeButton=(text,action)=>{const b=document.createElement('button');b.textContent=text;b.onclick=action;return b;};
 const map=new mapboxgl.Map({container,accessToken:token,style:'mapbox://styles/mapbox/dark-v11',center:view?.center||[55.25,25.1],zoom:view?.zoom||7,pitch:view?.pitch??55,bearing:view?.bearing??-18,antialias:true});
 map.addControl(new mapboxgl.NavigationControl({visualizePitch:true}),'top-right');
 map.addControl(new mapboxgl.FullscreenControl(),'top-right');
 const stop=()=>{clearInterval(timer);timer=null;tour.textContent='Start venue tour';};
 const describe=group=>{
  selectedKey=group[0].lng+','+group[0].lat;details.replaceChildren();const heading=document.createElement('h3');heading.textContent=[...new Set(group.map(p=>p.venue||'Unassigned venue'))].join(' / ');details.append(heading);
  const summary=document.createElement('p');summary.textContent=group.length+' screens at this inventory coordinate · '+group.filter(p=>p.state==='online').length+' online · '+group.filter(p=>p.state==='offline').length+' offline';details.append(summary);
  group.forEach(p=>{const row=document.createElement('div');row.className='map3d-screen';const status=document.createElement('span');status.className='map3d-status '+p.state;status.textContent=p.state.toUpperCase();const text=document.createElement('span');text.textContent=(p.name||'Unnamed screen')+' · '+p.source+(p.lastSeen?' · Last seen '+new Date(p.lastSeen).toLocaleString('en-GB',{timeZone:'Asia/Dubai'})+' GST':'');row.append(status,text);details.append(row);});
 };
 const fly=index=>{const group=sites[index];if(!group)return;map.flyTo({center:[group[0].lng,group[0].lat],zoom:17,pitch:60,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:1600});describe(group);};
 const list=()=>{selectedKey=null;details.replaceChildren();const q=search.value.toLowerCase().trim();const matches=sites.map((group,index)=>({group,index})).filter(x=>x.group.some(p=>((p.venue||'')+' '+(p.name||'')).toLowerCase().includes(q)));const info=document.createElement('p');info.textContent=matches.length+' locations · Select a venue to locate its screens';details.append(info);matches.slice(0,40).forEach(({group,index})=>details.append(makeButton((group[0].venue||group[0].name||'Unnamed location')+' · '+group.length+' screens',()=>{stop();fly(index);})));if(matches.length>40){const more=document.createElement('p');more.textContent='Search to narrow the locations shown.';details.append(more);}};
 search.oninput=()=>{stop();list();};tilt.onclick=()=>map.easeTo({pitch:map.getPitch()>10?0:60,duration:600});
 const startTour=()=>{
  if(!sites.length)return;stop();tour.textContent='Pause venue tour';
  const unique=new Map();sites.forEach((g,i)=>{const venue=g[0].venue||g[0].name||String(i);if(!unique.has(venue))unique.set(venue,i);});const stops=[...unique.values()];let visits=0;
  const overview=()=>{
   const bounds=new mapboxgl.LngLatBounds([51.5,22.5],[56.5,26.2]);points.forEach(p=>bounds.extend([p.lng,p.lat]));
   map.fitBounds(bounds,{padding:55,maxZoom:8,pitch:25,bearing:0,duration:2200});selectedKey=null;details.replaceChildren();const h=document.createElement('h3');h.textContent='United Arab Emirates · Network overview';const summary=document.createElement('p');summary.textContent=points.length+' mapped screens · '+points.filter(p=>p.state==='online').length+' online · '+points.filter(p=>p.state==='offline').length+' offline · Overview for 30 seconds, then venue close-ups';details.append(h,summary);visits=0;timer=setTimeout(venue,30000);
  };
  const venue=()=>{fly(stops[current++%stops.length]);visits++;timer=setTimeout(visits>=5?overview:venue,10000);};
  overview();
 };
 tour.onclick=()=>{if(timer)stop();else startTour();};
 map.on('dragstart',stop);map.on('zoomstart',e=>{if(e.originalEvent)stop();});
 const fit=()=>{stop();if(!points.length)return;const bounds=new mapboxgl.LngLatBounds();points.forEach(p=>bounds.extend([p.lng,p.lat]));map.fitBounds(bounds,{padding:65,maxZoom:16,pitch:45,duration:900});};
 map.on('load',()=>{
  const layers=map.getStyle().layers||[];const label=layers.find(l=>l.type==='symbol'&&l.layout?.['text-field']);
  if(map.getSource('composite'))map.addLayer({id:'hm-buildings',source:'composite','source-layer':'building',filter:['==','extrude','true'],type:'fill-extrusion',minzoom:14,paint:{'fill-extrusion-color':'#187987','fill-extrusion-height':['coalesce',['get','height'],0],'fill-extrusion-base':['coalesce',['get','min_height'],0],'fill-extrusion-opacity':0.62}},label?.id);
  map.addSource('hm-sites',{type:'geojson',cluster:true,clusterMaxZoom:15,clusterRadius:42,clusterProperties:{screens:['+',['get','screens']],online:['+',['get','online']],offline:['+',['get','offline']],unknown:['+',['get','unknown']]},data:snapshot()});
  map.addLayer({id:'hm-pulse',type:'circle',source:'hm-sites',paint:{'circle-color':statusColor,'circle-radius':15,'circle-opacity':0.18,'circle-blur':0.35}});
  map.addLayer({id:'hm-clusters',type:'circle',source:'hm-sites',filter:['has','point_count'],paint:{'circle-color':statusColor,'circle-radius':['step',['get','point_count'],16,20,20,100,24],'circle-stroke-width':2,'circle-stroke-color':'#d9ffef','circle-opacity':0.95}});
  map.addLayer({id:'hm-counts',type:'symbol',source:'hm-sites',filter:['has','point_count'],layout:{'text-field':['to-string',['get','screens']],'text-size':12},paint:{'text-color':'#07130e'}});
  map.addLayer({id:'hm-cluster-status',type:'symbol',source:'hm-sites',filter:['has','point_count'],layout:{'text-field':['concat','ON ',['to-string',['get','online']],' / OFF ',['to-string',['get','offline']]],'text-size':10,'text-offset':[0,3],'text-anchor':'top'},paint:{'text-color':'#e1fdef','text-halo-color':'#09141e','text-halo-width':2}});
  map.addLayer({id:'hm-screen-points',type:'circle',source:'hm-sites',filter:['!',['has','point_count']],paint:{'circle-radius':['interpolate',['linear'],['zoom'],6,4,15,6,19,8],'circle-color':statusColor,'circle-stroke-color':'#d9ffef','circle-stroke-width':1.5}});
  if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)pulseTimer=setInterval(()=>{if(document.hidden)return;const phase=(performance.now()%2000)/2000;map.setPaintProperty('hm-pulse','circle-radius',9+phase*17);map.setPaintProperty('hm-pulse','circle-opacity',0.3*(1-phase));},80);
  map.addLayer({id:'hm-venue-labels',type:'symbol',source:'hm-sites',minzoom:12,filter:['!',['has','point_count']],layout:{'text-field':['concat',['get','name'],' · ',['to-string',['get','screens']]],'text-size':12,'text-offset':[0,1.4],'text-anchor':'top','text-max-width':16},paint:{'text-color':'#b7fff2','text-halo-color':'#101923','text-halo-width':2}});
  map.on('click','hm-clusters',e=>{stop();const f=e.features[0];map.getSource('hm-sites').getClusterExpansionZoom(f.properties.cluster_id,(error,zoom)=>{if(!error)map.easeTo({center:f.geometry.coordinates,zoom,pitch:55});});});
  map.on('click','hm-screen-points',e=>{stop();fly(Number(e.features[0].properties.index));});
  for(const id of ['hm-clusters','hm-screen-points']){map.on('mouseenter',id,()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave',id,()=>map.getCanvas().style.cursor='');}
  if(!view)fit();list();if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)startTour();
 });
 map.on('error',e=>{if(e.error?.status===401||e.error?.status===403){details.textContent='Mapbox access was denied. Check the public token and allowed URL restrictions.';}});
 document.getElementById('fit-map').onclick=fit;
 return {getCenter:()=>map.getCenter(),getZoom:()=>map.getZoom(),getPitch:()=>map.getPitch(),getBearing:()=>map.getBearing(),resize:()=>map.resize(),update:newPoints=>{points=newPoints;groups.clear();points.forEach(p=>{const key=p.lng+','+p.lat;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);});sites=[...groups.values()];map.getSource('hm-sites')?.setData(snapshot());if(selectedKey&&groups.has(selectedKey))describe(groups.get(selectedKey));else if(!timer)list();},remove:()=>{stop();clearInterval(pulseTimer);map.remove();tools.remove();details.remove();}};
}};
