
'use strict';
// V4.2 questions, ranking and scroll repair are retained. V5 stores only completed tests.
const DATA=JSON.parse(document.getElementById('quiz-data').textContent);
const state={index:0,answers:DATA.questions.map(()=>[])};
const $=id=>document.getElementById(id);
const KEYS=['A','B','C','D','E'];
const BADGES=['①','②','③'];
const RANK_WEIGHTS=DATA.meta.rankWeights;
const PREFERENCE_SECONDARY=DATA.meta.secondPreferenceWeight;
const records=MetroRecords.createStore(DATA,calculate);
const loaded=records.load();
let lastRecord=loaded.record;
let storageStatus=loaded.status;
let viewedRole=null;
let archiveFocusId=null;
// Only excerpts from the already approved title, summary and growth text.
const ROLE_TERMS={
  L01:['主见','责任','从容'],L02:['效率','结果','个人爱好'],L03:['好奇','快乐','阳光'],
  L04:['敏感','温柔','相伴'],L05:['认真','成长','榜样'],L06:['行动','热心','倔强'],
  L07:['细心','温柔','可靠'],L08:['责任','守护者','委屈'],L09:['进步','投入','严格'],
  L10:['观察','点子','边界'],L11:['探索','接纳','自由'],L12:['社交','联系','关系'],
  L13:['情感','记忆','过去'],L14:['安排','规则','失控'],L15:['兴趣','细节','安静'],
  L16:['行动','挑战','奔跑'],L17:['安静','细节','节奏'],L18:['好奇','点子','善后'],
  PJ:['独立','成长','认真'],MG:['信心','竞争','骄傲'],AP:['行动','在意','愿望'],JR:['沉稳','务实','记忆']
};
function escapeHTML(x){return String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// Only scroll to the top when navigating to a different question / screen.
// A choice click must never reset the reader's scroll position.
function show(screen,scrollToTop=true){
  for(const id of ['start','quiz','result','archive','locked'])$(id).classList.toggle('hidden',id!==screen);
  if(scrollToTop){
    window.scrollTo({top:0,behavior:'instant'});
    const heading=$(screen).querySelector('h1,h2');
    if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
  }
}
function rankInfo(ans){return ans.map((key,i)=>({key,rank:i+1,badge:BADGES[i]}));}
function showQuestion({scrollToTop=true,anchorKey=null,anchorTop=null}={}){
  const q=DATA.questions[state.index],ans=state.answers[state.index];
  $('part-label').textContent=state.index<5?'01 · 真实的情绪':state.index<10?'02 · 面对挑战':state.index<15?'03 · 与人的距离':'04 · 新的选择';
  $('progress-num').textContent=String(state.index+1).padStart(2,'0')+' / '+DATA.questions.length;
  $('progress-fill').style.width=((state.index+1)/DATA.questions.length*100)+'%';
  $('progress-bar').setAttribute('aria-valuenow',state.index+1);
  $('q-number').textContent='QUESTION '+String(q.id).padStart(2,'0');
  $('q-title').textContent=q.title;
  $('q-prompt').textContent=q.prompt;
  $('choice-count').textContent='已选 '+ans.length+' / 3';
  $('choice-count').classList.toggle('at-max',ans.length===3);
  $('next-btn').disabled=ans.length===0;
  $('next-btn').textContent=state.index===DATA.questions.length-1?'查看我的线路 →':'下一题 →';
  const strip=$('rank-strip');strip.replaceChildren();
  if(ans.length===0){const msg=document.createElement('span');msg.className='rank-placeholder';msg.textContent='先选择最符合的一项；只有其他答案也贴近时才补选';strip.appendChild(msg);}
  else{
    for(const item of rankInfo(ans)){
      const chip=document.createElement('span');chip.className='rank-chip';
      const corresponding=q.choices.find(c=>c.key===item.key);
      chip.title=corresponding.text;
      chip.innerHTML='<b>'+item.badge+'</b><span>'+item.key+' · '+(item.rank===1?'最符合':item.rank===2?'其次':'补充')+'</span>';
      strip.appendChild(chip);
    }
    if(ans.length>1){const reset=document.createElement('button');reset.type='button';reset.className='rank-reset';reset.textContent='清空重新排序';reset.addEventListener('click',()=>{
        const first=$('choices').querySelector('.choice');
        const previousTop=first?.getBoundingClientRect().top ?? null;
        state.answers[state.index]=[];
        showQuestion({scrollToTop:false,anchorKey:q.choices[0].key,anchorTop:previousTop});
      });strip.appendChild(reset);}
  }
  const wrapper=$('choices');wrapper.replaceChildren();
  for(const option of q.choices){
    const idx=ans.indexOf(option.key),selected=idx!==-1,limit=ans.length===3&&!selected;
    const button=document.createElement('button');button.type='button';
    button.className='choice'+(selected?' selected rank-'+(idx+1):'');button.disabled=limit;button.dataset.key=option.key;
    button.setAttribute('aria-pressed',String(selected));
    button.setAttribute('aria-label',option.key+' '+option.text+(selected?'，第'+(idx+1)+'选择，点击取消':limit?'，已选满三个选项':''));
    button.innerHTML='<span class="choice-letter">'+option.key+'</span><span class="choice-text">'+escapeHTML(option.text)+'</span><span class="choice-rank" aria-hidden="true">'+(selected?BADGES[idx]:'＋')+'</span>';
    button.addEventListener('click',()=>toggle(option.key));wrapper.appendChild(button);
  }
  $('question-note').textContent=ans.length===3?'最多选3项；已选满。点击已选项可取消，其他名次自动前移。':ans.length===0?'选择最符合你的一项，就可以进入下一题。':'选1项即可进入下一题；只有其他答案也贴近时才补选。';
  show('quiz',scrollToTop);
  if(!scrollToTop && anchorKey!==null){
    const refreshed=$('choices').querySelector('button[data-key="'+anchorKey+'"]');
    if(refreshed){
      // Keep the tapped option at the same screen coordinate even if rank chips grow.
      if(Number.isFinite(anchorTop)){
        const delta=refreshed.getBoundingClientRect().top-anchorTop;
        if(Math.abs(delta)>0.5)window.scrollBy({top:delta,behavior:'instant'});
      }
      // Rerendering replaces the old button; restore keyboard focus without scrolling.
      refreshed.focus({preventScroll:true});
    }
  }
}
function toggle(key){
  const existing=$('choices').querySelector('button[data-key="'+key+'"]');
  if(existing?.disabled)return;
  const previousTop=existing?.getBoundingClientRect().top ?? null;
  const a=state.answers[state.index],i=a.indexOf(key);
  if(i>=0)a.splice(i,1);
  else if(a.length<3)a.push(key);
  showQuestion({scrollToTop:false,anchorKey:key,anchorTop:previousTop});
}
function next(){if(state.answers[state.index].length===0)return;if(state.index===DATA.questions.length-1)return showResult();state.index++;showQuestion();}
function back(){if(state.index===0)navigate('/');else{state.index--;showQuestion();}}
function rankContribution(choiceIndex,kind){return RANK_WEIGHTS[choiceIndex]*(kind==='primary'?1:PREFERENCE_SECONDARY);}
function calculate(answers){
  if(answers.length!==DATA.questions.length||answers.some(a=>!Array.isArray(a)||a.length<1||a.length>3||new Set(a).size!==a.length||a.some(x=>!KEYS.includes(x))))throw new Error('答题未完成或格式不正确');
  return DATA.roles.map(role=>{
    let score=0,firstPrimary=0,primaryHits=0,secondaryHits=0;const hits=[];
    for(let i=0;i<answers.length;i++){
      const selected=answers[i],w=DATA.questions[i].weight;
      const denom=selected.reduce((acc,_,idx)=>acc+RANK_WEIGHTS[idx],0);
      let questionRaw=0;
      selected.forEach((key,j)=>{
        const kind=key===role.primary[i]?'primary':key===role.secondary[i]?'secondary':null;
        if(!kind)return;
        const contribution=w*rankContribution(j,kind)/denom;
        questionRaw+=contribution;
        if(kind==='primary'){primaryHits++;if(j===0)firstPrimary++;}else secondaryHits++;
        hits.push({i,key,rank:j+1,kind,contribution});
      });
      score+=questionRaw;
    }
    return {role,score,firstPrimary,primaryHits,secondaryHits,hits:hits.sort((a,b)=>b.contribution-a.contribution||a.i-b.i)};
  }).sort((a,b)=>b.score-a.score||b.firstPrimary-a.firstPrimary||b.primaryHits-a.primaryHits||b.secondaryHits-a.secondaryHits||a.role.id.localeCompare(b.role.id));
}
function showResult(){
  // Creating a record calculates and validates all 20 ordered answers first.
  const saved=records.save(records.create(state.answers));
  lastRecord=saved.record;storageStatus=saved.status;
  updateHome();navigate('/result');
}
function lineLabel(role){return role.line==='市域机场线'?'机场':role.line==='金山铁路'?'金山':role.line.replace('号线','').replace('线','');}
function renderKeywords(container,role){
  container.replaceChildren();
  for(const word of ROLE_TERMS[role.id]){
    const chip=document.createElement('span');chip.className='role-keyword';chip.textContent=word;container.appendChild(chip);
  }
}
function renderRole(win,personal){
  viewedRole=win;
  $('result-disc').style.setProperty('--result-color',win.color);
  $('result-growth').style.setProperty('--result-color',win.color);
  $('result-disc').textContent=lineLabel(win);
  $('result-name').textContent=win.line;
  $('result-title').textContent=win.title;
  $('result-summary').textContent=win.summary;
  $('result-growth').textContent=win.growth;
  renderKeywords($('result-keywords'),win);
  $('result-mode').textContent=personal?'YOUR METRO PERSONALITY':'CHARACTER ARCHIVE';
  $('personal-analysis').classList.toggle('hidden',!personal);
  for(const id of ['result-completed','result-score','change-btn','copy-btn','restart-btn','result-archive-btn'])$(id).classList.toggle('hidden',!personal);
  for(const id of ['role-pagination','detail-archive-btn','detail-own-btn'])$(id).classList.toggle('hidden',personal);
  if(!personal){
    const index=DATA.roles.findIndex(role=>role.id===win.id);
    const previous=DATA.roles[index-1],nextRole=DATA.roles[index+1];
    $('prev-role-btn').disabled=!previous;$('next-role-btn').disabled=!nextRole;
    $('prev-role-btn').textContent=previous?'← '+previous.line:'已是第一位';
    $('next-role-btn').textContent=nextRole?nextRole.line+' →':'已是最后一位';
    show('result');return;
  }
  const time=document.createElement('time');time.dateTime=lastRecord.completedAt;
  time.textContent=new Date(lastRecord.completedAt).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  $('result-completed').replaceChildren(document.createTextNode('完成于 '),time);
  $('result-score').textContent='匹配得分 '+lastRecord.result.score.toFixed(2);
  const ranking=calculate(lastRecord.answers);
  const reasons=$('result-reasons');reasons.replaceChildren();
  const usedQuestionIds=new Set();
  const selectedHits=ranking[0].hits.filter(hit=>{if(usedQuestionIds.has(hit.i))return false;usedQuestionIds.add(hit.i);return true;}).slice(0,3);
  if(selectedHits.length===0){const p=document.createElement('div');p.className='result-reason';p.textContent='你的回答在多个情境中的整体倾向，与这位角色的画像比较接近。';reasons.appendChild(p);}
  else for(const hit of selectedHits){
    const q=DATA.questions[hit.i],option=q.choices.find(c=>c.key===hit.key);
    const p=document.createElement('div');p.className='result-reason';
    p.innerHTML='<span class="reason-mark"></span><span><strong>'+escapeHTML(q.title)+'</strong>：你把「'+escapeHTML(option.text)+'」排在第'+hit.rank+'选择。</span>';
    reasons.appendChild(p);
  }
  const near=$('neighbors');near.replaceChildren();
  for(const r of ranking.slice(1,3)){
    const pill=document.createElement('span');pill.className='neighbor';
    pill.innerHTML='<b style="background:'+r.role.color+'"></b>'+escapeHTML(r.role.line)+' · '+escapeHTML(r.role.title);
    near.appendChild(pill);
  }
  $('copy-btn').textContent='复制结果';show('result');
}
function restart(){state.answers=DATA.questions.map(()=>[]);state.index=0;navigate('/quiz');}
function updateHome(){
  $('history-btn').disabled=!lastRecord;
  $('history-hint').classList.toggle('hidden',!!lastRecord);
  $('archive-btn').textContent=lastRecord?'浏览全部线路人格':'线路图鉴 · 待解锁';
  let message='';
  if(storageStatus==='invalid')message='上次记录已损坏或与当前版本不兼容，请重新完成测试。';
  if(storageStatus==='unavailable')message='无法保存或读取浏览器记录。本页完成测试后仍可查看结果与图鉴，下次访问可能无法恢复。';
  if(storageStatus==='saved')message='记录仅保存在当前浏览器；无痕浏览或清理数据后可能丢失。';
  $('storage-status').textContent=message;$('storage-status').classList.toggle('hidden',!message);
}
function renderArchive(){
  const grid=$('archive-grid');grid.replaceChildren();
  for(const role of DATA.roles){
    const card=document.createElement('button');card.type='button';card.className='archive-card';card.dataset.roleId=role.id;
    card.style.setProperty('--line-color',role.color);
    card.setAttribute('aria-label',role.line+' · '+role.title+'，查看详情');
    const mine=role.id===lastRecord.result.lineId;card.setAttribute('aria-current',String(mine));
    card.innerHTML='<span class="archive-card-top"><span class="archive-disc" aria-hidden="true">'+escapeHTML(lineLabel(role))+'</span><span class="archive-line">'+escapeHTML(role.line)+'</span>'+(mine?'<span class="my-result-badge">我的结果</span>':'')+'</span><span class="archive-card-title">'+escapeHTML(role.title)+'</span><span class="role-keywords"></span><span class="archive-card-link">查看详情 →</span>';
    renderKeywords(card.querySelector('.role-keywords'),role);
    card.addEventListener('click',()=>{archiveFocusId=role.id;navigate('/archive/'+role.id);});grid.appendChild(card);
  }
  show('archive');
  if(archiveFocusId){
    const card=grid.querySelector('[data-role-id="'+archiveFocusId+'"]');
    if(card){card.focus({preventScroll:true});card.scrollIntoView({block:'center',behavior:'instant'});}
    archiveFocusId=null;
  }
}
function navigate(route){
  const hash='#'+route;
  if(location.hash!==hash)history.pushState(null,'',hash);
  renderRoute();
}
function renderRoute(){
  updateHome();
  const route=location.hash.slice(1)||'/';
  // Every route, including direct links and back/forward navigation, is gated.
  if(route==='/result'||route==='/archive'||route.startsWith('/archive/')){
    if(!lastRecord){
      $('locked-title').textContent=route==='/result'?'还没有完整测试记录':'线路图鉴 · 待解锁';
      show('locked');return;
    }
    if(route==='/result'){renderRole(DATA.roles.find(role=>role.id===lastRecord.result.lineId),true);return;}
    if(route==='/archive'){renderArchive();return;}
    const role=DATA.roles.find(item=>'/archive/'+item.id===route);
    if(role){archiveFocusId=role.id;renderRole(role,false);}else renderArchive();
    return;
  }
  if(route==='/quiz'){showQuestion();return;}
  show('start');
}
$('start-btn').addEventListener('click',restart);
$('back-btn').addEventListener('click',back);
$('next-btn').addEventListener('click',next);
$('restart-btn').addEventListener('click',restart);
$('change-btn').addEventListener('click',()=>{if(!lastRecord)return;state.answers=lastRecord.answers.map(answer=>[...answer]);state.index=DATA.questions.length-1;navigate('/quiz');});
$('history-btn').addEventListener('click',()=>navigate('/result'));
$('archive-btn').addEventListener('click',()=>navigate('/archive'));
$('result-archive-btn').addEventListener('click',()=>navigate('/archive'));
for(const id of ['result-home-btn','archive-home-btn','locked-home-btn'])$(id).addEventListener('click',()=>navigate('/'));
for(const id of ['detail-own-btn','archive-own-btn','archive-bottom-own-btn'])$(id).addEventListener('click',()=>navigate('/result'));
$('detail-archive-btn').addEventListener('click',()=>navigate('/archive'));
$('locked-start-btn').addEventListener('click',restart);
for(const [id,direction] of [['prev-role-btn',-1],['next-role-btn',1]])$(id).addEventListener('click',()=>{
  const role=DATA.roles[DATA.roles.findIndex(item=>item.id===viewedRole?.id)+direction];
  if(role)navigate('/archive/'+role.id);
});
$('copy-btn').addEventListener('click',async()=>{
  if(!lastRecord)return;
  const winner=DATA.roles.find(role=>role.id===lastRecord.result.lineId);
  const str='我的上海地铁线路人格是 '+winner.line+'｜'+winner.title+'。'+winner.summary;
  try{
    if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(str);
    else{
      const ta=document.createElement('textarea');ta.value=str;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();if(!ok)throw Error('copy unavailable');
    }
    $('copy-btn').textContent='已复制 ✓';
  }catch(e){window.prompt('复制你的测试结果：',str);}
});
document.addEventListener('keydown',e=>{
  if($('quiz').classList.contains('hidden')||e.altKey||e.ctrlKey||e.metaKey||['INPUT','TEXTAREA'].includes(document.activeElement.tagName))return;
  const idx=KEYS.indexOf(e.key.toUpperCase());
  if(idx>=0){e.preventDefault();toggle(KEYS[idx]);}
});
// Keep the existing browser regression API; this is not a UI unlock shortcut.
window.MetroQuizV4={calculate,data:DATA,getState:()=>state,restart,toggle,back,next,showResult};
window.addEventListener('popstate',renderRoute);
window.addEventListener('hashchange',renderRoute);
renderRoute();
