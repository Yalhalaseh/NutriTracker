const $ = id => document.getElementById(id);
const TOKEN_KEY = 'nutritrack-token-v2';
let token = localStorage.getItem(TOKEN_KEY) || '';
let user = null;
let state = null;
let authMode = 'login';
let photoData = '';
let saveTimer = null;
let barcodeStream = null;

const todayKey = () => new Date().toISOString().slice(0, 10);
const escapeHtml = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const motivation = [
  'Consistency beats perfection.',
  'One balanced meal is meaningful progress.',
  'Your routine matters more than one day.',
  'Aim for helpful choices you can repeat.',
  'Progress can be quiet and still be real.',
  'Plan the next meal, not the perfect week.',
  'Small habits become easier when they are repeated.'
];

function defaultDay() {
  return { meals: [], water: 0, habits: { vegetables:false, fruit:false, planned:false, mindful:false }, plan: [] };
}
function day() {
  const k = todayKey();
  if (!state.days[k]) state.days[k] = defaultDay();
  return state.days[k];
}
function authHeaders(extra={}) { return { ...extra, Authorization: `Bearer ${token}` }; }
async function api(url, options={}) {
  const response = await fetch(url, { ...options, headers: authHeaders({ 'Content-Type':'application/json', ...(options.headers || {}) }) });
  const json = await response.json().catch(() => ({}));
  if (response.status === 401) { logoutLocal(); throw new Error(json.error || 'Please sign in again.'); }
  if (!response.ok) throw new Error(json.error || 'Request failed.');
  return json;
}
function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await api('/api/data', { method:'PUT', body:JSON.stringify({ data:state }) }); }
    catch (e) { console.error('Save failed', e); }
  }, 250);
  render();
}
function logoutLocal() {
  token=''; user=null; state=null; localStorage.removeItem(TOKEN_KEY);
  $('appShell').classList.add('hidden'); $('authScreen').classList.remove('hidden');
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id));
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === id));
  if (id === 'progress') setTimeout(drawWeightChart, 50);
}

document.querySelectorAll('#nav button').forEach(b => b.onclick = () => showView(b.dataset.view));
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => showView(b.dataset.go));

function setAuthMode(mode) {
  authMode = mode;
  $('loginTab').classList.toggle('active', mode === 'login');
  $('registerTab').classList.toggle('active', mode === 'register');
  $('authName').classList.toggle('hidden', mode !== 'register');
  $('authSubmit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  $('authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('authError').textContent = '';
}
$('loginTab').onclick = () => setAuthMode('login');
$('registerTab').onclick = () => setAuthMode('register');
$('authForm').addEventListener('submit', async e => {
  e.preventDefault(); $('authError').textContent=''; $('authSubmit').disabled=true;
  try {
    const body = { email:$('authEmail').value.trim(), password:$('authPassword').value, name:$('authName').value.trim() };
    const result = await fetch(`/api/auth/${authMode}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const json = await result.json();
    if (!result.ok) throw new Error(json.error || 'Could not sign in.');
    token=json.token; user=json.user; state=json.data; localStorage.setItem(TOKEN_KEY, token); enterApp();
  } catch(e) { $('authError').textContent=e.message; }
  finally { $('authSubmit').disabled=false; }
});
$('logoutBtn').onclick = async () => { try { await api('/api/auth/logout',{method:'POST'}); } catch {} logoutLocal(); };

function totals() {
  return day().meals.reduce((a,m) => ({ calories:a.calories+Number(m.calories||0), protein:a.protein+Number(m.protein||0) }), {calories:0,protein:0});
}
function pct(n,d) { return `${Math.min(100, Math.round((n/Math.max(1,d))*100))}%`; }
function streak() {
  let count=0, d=new Date();
  for(let i=0;i<365;i++){
    const k=d.toISOString().slice(0,10), x=state.days[k];
    const active=x && ((x.meals||[]).length || x.water || Object.values(x.habits||{}).some(Boolean));
    if(active) count++; else if(i>0) break;
    d.setDate(d.getDate()-1);
  }
  return count;
}
function activeDays7() {
  let n=0,d=new Date();
  for(let i=0;i<7;i++){
    const x=state.days[d.toISOString().slice(0,10)];
    if(x && ((x.meals||[]).length || x.water || Object.values(x.habits||{}).some(Boolean))) n++;
    d.setDate(d.getDate()-1);
  }
  return n;
}

function renderMeals(containerId, includePhoto=true) {
  const meals=day().meals||[];
  $(containerId).innerHTML = meals.length ? meals.map((m,i)=>`<div class="meal-row">
    <div style="display:flex;gap:10px;align-items:center">${includePhoto && m.photo ? `<img class="meal-photo" src="${m.photo}" alt="Meal photo">` : ''}<div><strong>${escapeHtml(m.name)}</strong><small>${escapeHtml(m.type)}${m.barcode?` · UPC ${escapeHtml(m.barcode)}`:''}</small></div></div>
    <div class="macro">${Math.round(Number(m.calories||0))} kcal</div><div class="macro">${Number(m.protein||0)} g protein</div>
    <button class="remove" onclick="removeMeal(${i})">×</button></div>`).join('') : '<div class="empty">No meals logged yet.</div>';
}
window.removeMeal = i => { day().meals.splice(i,1); queueSave(); };
window.toggleHabit = key => { day().habits[key] = !day().habits[key]; queueSave(); };
window.toggleGrocery = id => { const item=state.grocery.find(x=>x.id===id); if(item){item.done=!item.done;queueSave();} };
window.removeGrocery = id => { state.grocery=state.grocery.filter(x=>x.id!==id);queueSave(); };
window.removeWeight = id => { state.weights=state.weights.filter(x=>x.id!==id);queueSave();drawWeightChart(); };

function render() {
  if(!state) return;
  const p=state.profile, d=day(), t=totals(), habitCount=Object.values(d.habits||{}).filter(Boolean).length;
  $('userName').textContent=user?.name||'';
  $('todayLabel').textContent=new Intl.DateTimeFormat(undefined,{weekday:'long',month:'short',day:'numeric'}).format(new Date());
  $('greeting').textContent=`${p.name ? `${p.name}, ` : ''}focus on the next helpful choice.`;
  $('motivation').textContent=motivation[new Date().getDay()%motivation.length]; $('streak').textContent=streak();
  $('caloriesNow').textContent=Math.round(t.calories); $('caloriesGoal').textContent=p.targetCalories; $('calBar').style.width=pct(t.calories,p.targetCalories);
  $('proteinNow').textContent=Math.round(t.protein); $('proteinGoal').textContent=p.targetProtein; $('proteinBar').style.width=pct(t.protein,p.targetProtein);
  $('waterNow').textContent=d.water||0; $('waterGoal').textContent=p.targetWater; $('waterBig').textContent=`${d.water||0} cups`; $('waterBar').style.width=pct(d.water||0,p.targetWater);
  $('habitsNow').textContent=habitCount; $('habitBar').style.width=pct(habitCount,4);
  const labels={vegetables:'Vegetables with a meal',fruit:'Fruit today',planned:'Planned meals ahead',mindful:'Ate without rushing'};
  $('habitList').innerHTML=Object.entries(labels).map(([k,v])=>`<label class="habit"><input type="checkbox" ${d.habits?.[k]?'checked':''} onchange="toggleHabit('${k}')"><span>${v}</span></label>`).join('');
  renderMeals('dashboardMeals', false); renderMeals('mealList', true);
  $('goal').value=p.goal||'Maintain weight'; $('targetCalories').value=p.targetCalories||2000; $('targetProtein').value=p.targetProtein||120; $('targetWater').value=p.targetWater||8; $('dietStyle').value=p.dietStyle||'Balanced'; $('likes').value=p.likes||''; $('avoid').value=p.avoid||'';
  $('plan').innerHTML=(d.plan||[]).length?d.plan.map(x=>`<div class="plan-item"><strong>${escapeHtml(x.meal)}</strong><span>${escapeHtml(x.idea)}</span></div>`).join(''):'<div class="empty">Generate a flexible meal template.</div>';
  const weights=[...(state.weights||[])].sort((a,b)=>a.date.localeCompare(b.date)); const latest=weights.at(-1);
  $('latestWeight').textContent=latest?`${latest.value} ${latest.unit}`:'—'; $('activeDays').textContent=activeDays7();
  $('weightList').innerHTML=weights.length?[...weights].reverse().slice(0,10).map(w=>`<div class="weight-row"><div><strong>${w.value} ${escapeHtml(w.unit)}</strong><div class="tiny">${escapeHtml(w.date)}</div></div><button class="remove" onclick="removeWeight('${w.id}')">×</button></div>`).join(''):'<div class="empty">No weight entries yet.</div>';
  $('groceryList').innerHTML=(state.grocery||[]).length?state.grocery.map(x=>`<div class="grocery-row"><div class="grocery-left"><input type="checkbox" ${x.done?'checked':''} onchange="toggleGrocery('${x.id}')"><span class="${x.done?'done':''}">${escapeHtml(x.name)}</span><span class="category">${escapeHtml(x.category)}</span></div><button class="remove" onclick="removeGrocery('${x.id}')">×</button></div>`).join(''):'<div class="empty">Your grocery list is empty.</div>';
  $('chat').innerHTML=(state.chat||[]).slice(-12).map(x=>`<div class="bubble ${x.role==='user'?'user':'ai'}">${escapeHtml(x.text)}</div>`).join('');
  const lastReport=(state.weeklyReports||[]).at(-1); $('weeklyReport').textContent=lastReport?.text||'No weekly review yet.'; $('weeklyReport').classList.toggle('empty',!lastReport);
}

$('plusWater').onclick=()=>{day().water=(day().water||0)+1;queueSave();};
$('minusWater').onclick=()=>{day().water=Math.max(0,(day().water||0)-1);queueSave();};
$('clearToday').onclick=()=>{if(confirm("Clear today's meals, water, habits and plan?")){state.days[todayKey()]=defaultDay();queueSave();}};

$('mealPhoto').addEventListener('change', e => {
  const file=e.target.files?.[0]; if(!file){photoData='';return;}
  if(file.size>3_000_000){alert('Please choose an image under 3 MB.'); e.target.value=''; return;}
  const reader=new FileReader(); reader.onload=()=>{photoData=reader.result;$('photoPreview').src=photoData;$('photoPreview').classList.remove('hidden');$('photoHint').classList.add('hidden');}; reader.readAsDataURL(file);
});
$('mealForm').addEventListener('submit', e => {
  e.preventDefault();
  day().meals.push({ id:crypto.randomUUID(), name:$('mealName').value.trim(), type:$('mealType').value, calories:Number($('mealCalories').value), protein:Number($('mealProtein').value), barcode:$('barcodeInput').value.trim(), photo:photoData, createdAt:new Date().toISOString() });
  e.target.reset(); photoData=''; $('photoPreview').classList.add('hidden'); $('photoHint').classList.remove('hidden');
  queueSave();
  showView('dashboard');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('scanBarcode').onclick=async()=>{
  if(!('BarcodeDetector' in window)){ alert('Camera barcode detection is not supported in this browser. You can type the UPC manually.'); return; }
  try {
    barcodeStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}); const video=$('barcodeVideo'); video.srcObject=barcodeStream; video.classList.remove('hidden'); await video.play();
    const detector=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128']});
    const scan=async()=>{ if(!barcodeStream) return; const codes=await detector.detect(video).catch(()=>[]); if(codes[0]){ $('barcodeInput').value=codes[0].rawValue; stopBarcode(); return; } requestAnimationFrame(scan); }; scan();
  } catch { alert('Could not access the camera. You can enter the barcode manually.'); }
};
function stopBarcode(){ if(barcodeStream){barcodeStream.getTracks().forEach(t=>t.stop());barcodeStream=null;} $('barcodeVideo').classList.add('hidden'); }

$('profileForm').addEventListener('submit',e=>{e.preventDefault();state.profile={...state.profile,goal:$('goal').value,targetCalories:Number($('targetCalories').value),targetProtein:Number($('targetProtein').value),targetWater:Number($('targetWater').value),dietStyle:$('dietStyle').value,likes:$('likes').value.trim(),avoid:$('avoid').value.trim()};queueSave();});
$('generatePlan').onclick=()=>{
  const p=state.profile, likes=p.likes||'foods you enjoy', avoid=p.avoid?` Avoid or substitute: ${p.avoid}.`:'';
  const styles={
    Balanced:['Eggs or yogurt with whole grains and fruit','Protein + vegetables + whole grain or potato','Fruit with yogurt, nuts, or hummus','Protein + vegetables + a satisfying carbohydrate'],
    Mediterranean:['Greek yogurt, oats, berries and nuts','Chicken, fish, lentils or chickpeas with vegetables, olive oil and grains','Fruit with nuts or yogurt','Fish, chicken or beans with vegetables and grains'],
    Vegetarian:['Eggs or yogurt with oats and fruit','Lentil, bean, tofu or tempeh bowl','Fruit, yogurt, nuts or edamame','Tofu, beans, lentils, eggs or dairy with vegetables and grains'],
    Vegan:['Oats with soy milk, fruit, chia and nut butter','Tofu, tempeh, bean or lentil grain bowl','Fruit with nuts or roasted edamame','Tofu, beans or lentils with vegetables and grains'],
    'High-protein':['Eggs plus Greek yogurt or cottage cheese and fruit','Lean protein bowl or wrap with vegetables','Protein-rich yogurt, cottage cheese, edamame or a shake','Lean protein with vegetables and a carbohydrate'],
    'Lower-carb':['Eggs, Greek yogurt, berries and nuts','Protein-rich salad with olive oil and vegetables','Yogurt, cheese, nuts or vegetables with hummus','Protein with non-starchy vegetables and an optional whole-food carbohydrate']
  };
  const items=styles[p.dietStyle]||styles.Balanced;
  day().plan=['Breakfast','Lunch','Snack','Dinner'].map((meal,i)=>({meal,idea:`${items[i]}. Favor ${likes}.${avoid}`}));queueSave();
};

$('weightForm').addEventListener('submit',e=>{e.preventDefault();state.weights.push({id:crypto.randomUUID(),date:todayKey(),value:Number($('weightValue').value),unit:$('weightUnit').value});e.target.reset();queueSave();drawWeightChart();});
function drawWeightChart(){
  const canvas=$('weightChart'); if(!canvas||!state)return; const ctx=canvas.getContext('2d'); const w=canvas.width,h=canvas.height; ctx.clearRect(0,0,w,h);
  const arr=[...(state.weights||[])].sort((a,b)=>a.date.localeCompare(b.date)).slice(-30); ctx.font='28px system-ui'; ctx.fillStyle='#6c756e';
  if(arr.length<2){ctx.fillText('Add at least 2 entries to see a trend.',32,70);return;}
  const values=arr.map(x=>Number(x.value)); const min=Math.min(...values),max=Math.max(...values),range=Math.max(1,max-min); const pad=48;
  ctx.strokeStyle='#dfe4df';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(pad,h-pad);ctx.lineTo(w-pad,h-pad);ctx.stroke();
  ctx.strokeStyle='#1f7a4d';ctx.lineWidth=5;ctx.beginPath();arr.forEach((x,i)=>{const px=pad+i*(w-2*pad)/(arr.length-1),py=pad+(max-x.value)*(h-2*pad)/range;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.stroke();
  ctx.fillStyle='#152017';arr.forEach((x,i)=>{const px=pad+i*(w-2*pad)/(arr.length-1),py=pad+(max-x.value)*(h-2*pad)/range;ctx.beginPath();ctx.arc(px,py,5,0,Math.PI*2);ctx.fill();});
  ctx.font='22px system-ui';ctx.fillStyle='#6c756e';ctx.fillText(`${min.toFixed(1)}–${max.toFixed(1)} ${arr.at(-1).unit}`,pad,28);
}

$('groceryForm').addEventListener('submit',e=>{e.preventDefault();state.grocery.push({id:crypto.randomUUID(),name:$('groceryItem').value.trim(),category:$('groceryCategory').value,done:false});e.target.reset();queueSave();});
$('buildGrocery').onclick=()=>{
  const base={Balanced:[['Produce','Fruit'],['Produce','Mixed vegetables'],['Protein','Eggs / lean protein'],['Dairy','Greek yogurt'],['Grains','Whole grains']],Mediterranean:[['Produce','Fresh vegetables'],['Produce','Fruit'],['Protein','Fish / chicken / chickpeas'],['Pantry','Olive oil'],['Grains','Whole grains']],Vegetarian:[['Produce','Vegetables'],['Produce','Fruit'],['Protein','Beans / lentils / tofu'],['Dairy','Yogurt or eggs'],['Grains','Whole grains']],Vegan:[['Produce','Vegetables'],['Produce','Fruit'],['Protein','Tofu / tempeh / lentils'],['Dairy','Fortified plant milk'],['Grains','Whole grains']]};
  const suggestions=base[state.profile.dietStyle]||base.Balanced; const existing=new Set(state.grocery.map(x=>x.name.toLowerCase())); suggestions.forEach(([category,name])=>{if(!existing.has(name.toLowerCase()))state.grocery.push({id:crypto.randomUUID(),name,category,done:false});});queueSave();
};

async function checkAI(){try{const r=await fetch('/api/health');const x=await r.json();const text=x.aiConfigured?'AI connected':'AI not configured';$('aiStatus').textContent=text;$('aiPill').textContent=text;$('aiStatus').classList.toggle('on',x.aiConfigured);$('aiPill').classList.toggle('on',x.aiConfigured);}catch{$('aiStatus').textContent='Offline';$('aiPill').textContent='Offline';}}
$('chatForm').addEventListener('submit',async e=>{e.preventDefault();const text=$('chatInput').value.trim();if(!text)return;state.chat.push({role:'user',text});$('chatInput').value='';queueSave();const btn=e.target.querySelector('button');btn.disabled=true;btn.textContent='Thinking…';try{const x=await api('/api/chat',{method:'POST',body:JSON.stringify({message:text})});state.chat.push({role:'assistant',text:x.reply});queueSave();}catch(err){state.chat.push({role:'assistant',text:err.message});queueSave();}finally{btn.disabled=false;btn.textContent='Get feedback';}});
$('weeklyReportBtn').onclick=async()=>{const btn=$('weeklyReportBtn');btn.disabled=true;btn.textContent='Generating…';try{const x=await api('/api/weekly-report',{method:'POST',body:'{}'});state.weeklyReports.push({date:todayKey(),text:x.report});queueSave();}catch(err){$('weeklyReport').textContent=err.message;}finally{btn.disabled=false;btn.textContent='Generate';}};

async function enterApp(){
  $('authScreen').classList.add('hidden'); $('appShell').classList.remove('hidden'); render(); checkAI(); setTimeout(drawWeightChart,50);
}
async function boot(){
  if(!token) return;
  try{const x=await api('/api/me');user=x.user;state=x.data;enterApp();}catch{logoutLocal();}
}
boot();
