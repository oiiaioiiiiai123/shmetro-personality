// Real browser V5 persistence / unlock checks. No test-only unlock URL is used.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const base=process.env.METRO_QA_URL||'http://127.0.0.1:4185/shmetro-personality/';
const output=process.env.RECORDS_QA_OUT||path.resolve('test-results/records');
const executable=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const KEY='shmetro.personality.lastResult.v1';
const checks=[],errors=[];
let firstRecord;
const ok=(name,value)=>{assert.ok(value,name);checks.push(name);};
const watch=p=>{
  p.on('pageerror',e=>errors.push(e.message));
  p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  p.on('requestfailed',r=>errors.push(`${r.url()} ${r.failure()?.errorText}`));
  p.on('response',r=>{if(r.status()>=400)errors.push(`HTTP ${r.status()} ${r.url()}`);});
};
const raw=p=>p.evaluate(key=>localStorage.getItem(key),KEY);
const overflow=p=>p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
async function click(p,selector,touch=false){const target=p.locator(selector);if(touch)await target.tap();else await target.click();}
async function finish(p,id,touch=false,multiple=false){
  const answers=await p.evaluate(({id,multiple})=>{
    const role=MetroQuizV4.data.roles.find(r=>r.id===id);
    return [...role.primary].map((key,i)=>i===0&&multiple?[key,role.secondary[i],...['A','B','C','D','E'].filter(k=>k!==key&&k!==role.secondary[i]).slice(0,1)]:[key]);
  },{id,multiple});
  for(let i=0;i<20;i++){
    for(const key of answers[i])await click(p,`.choice[data-key=${key}]`,touch);
    await click(p,'#next-btn',touch);
  }
  await p.locator('#result').waitFor({state:'visible'});
  return answers;
}

async function regularFlow(mobile){
  const label=mobile?'mobile':'desktop';
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'shmetro-v5-browser-'));
  const options={executablePath:executable,headless:true,viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,colorScheme:'light',reducedMotion:'reduce'};
  let context=await chromium.launchPersistentContext(profile,options);
  try{
    let p=context.pages()[0]||await context.newPage();watch(p);
    await p.goto(base,{waitUntil:'networkidle'});
    ok(`${label}: fresh visit has no history`,await p.locator('#history-btn').isDisabled()&&await raw(p)===null);
    ok(`${label}: archive is locked`,(await p.locator('#archive-btn').innerText()).includes('待解锁'));
    await click(p,'#archive-btn',mobile);
    ok(`${label}: lock explanation and start entry`,await p.locator('#locked').isVisible()&&(await p.locator('#locked-message').innerText()).includes('完成一次测试')&&await p.locator('#locked-start-btn').isVisible());
    ok(`${label}: locked archive renders no cards or result`,await p.locator('.archive-card').count()===0&&!await p.locator('#result').isVisible());
    await p.goto(base+'#/archive/L15',{waitUntil:'networkidle'});
    ok(`${label}: direct role link is guarded`,await p.locator('#locked').isVisible());
    await click(p,'#locked-home-btn',mobile);
    await p.goBack();
    ok(`${label}: browser back cannot unlock a role`,await p.locator('#locked').isVisible());
    await p.goForward();
    ok(`${label}: browser forward remains safe`,await p.locator('#start').isVisible());
    await p.evaluate(()=>localStorage.setItem('unrelated.homepage.setting','preserve-me'));
    await click(p,'#start-btn',mobile);
    await click(p,'.choice[data-key=A]',mobile);
    ok(`${label}: incomplete answers never create a record`,await raw(p)===null);
    await p.reload({waitUntil:'networkidle'});
    ok(`${label}: refreshing incomplete test does not unlock`,await raw(p)===null);
    await finish(p,'L03',mobile);
    const firstRaw=await raw(p),record=JSON.parse(firstRaw);
    firstRecord=record;
    ok(`${label}: saves complete v1 / test 5.0 record`,record.schemaVersion===1&&record.testVersion==='5.0'&&record.answers.length===20&&record.result.lineId==='L03'&&record.result.lineName==='3号线'&&Number.isFinite(record.result.score));
    ok(`${label}: timestamp and three scored stable IDs`,Number.isFinite(Date.parse(record.completedAt))&&record.topThree.length===3&&record.topThree.every(r=>r.lineId&&r.lineName&&Number.isFinite(r.score)));
    ok(`${label}: own result shows completed time`,await p.locator('#result-completed time').getAttribute('datetime')===record.completedAt);
    ok(`${label}: no unrelated storage touched`,await p.evaluate(()=>localStorage.getItem('unrelated.homepage.setting'))==='preserve-me');
    await click(p,'#restart-btn',mobile);
    await click(p,'.choice[data-key=C]',mobile);
    await click(p,'#next-btn',mobile);
    ok(`${label}: restarting and partial retest keep earlier complete record`,await raw(p)===firstRaw);
    await p.goto(base,{waitUntil:'networkidle'});
    await p.reload({waitUntil:'networkidle'});
    ok(`${label}: history and unlock survive refresh`,await p.locator('#history-btn').isEnabled()&&!(await p.locator('#archive-btn').innerText()).includes('待解锁'));
    await click(p,'#history-btn',mobile);
    ok(`${label}: restores own result without resaving it`,await p.locator('#result-name').innerText()==='3号线'&&await raw(p)===firstRaw);
    await click(p,'#change-btn',mobile);
    ok(`${label}: edit restores all recorded answers in original order`,await p.evaluate(()=>MetroQuizV4.getState().answers.every((a,i)=>a.join('')===JSON.parse(localStorage.getItem('shmetro.personality.lastResult.v1')).answers[i].join(''))));
    await p.goto(base+'#/archive',{waitUntil:'networkidle'});
    const ids=await p.locator('.archive-card').evaluateAll(cards=>cards.map(c=>c.dataset.roleId));
    ok(`${label}: all 22 unlock together in canonical order`,ids.join(',')==='L01,L02,L03,L04,L05,L06,L07,L08,L09,L10,L11,L12,L13,L14,L15,L16,L17,L18,PJ,MG,AP,JR');
    ok(`${label}: one restrained own-result badge`,await p.locator('.my-result-badge').count()===1&&await p.locator('.archive-card[aria-current=true]').getAttribute('data-role-id')==='L03');
    ok(`${label}: cards have two or three approved keywords`,await p.locator('.archive-card').evaluateAll(cards=>cards.every(card=>card.querySelectorAll('.role-keyword').length>=2&&card.querySelectorAll('.role-keyword').length<=3)));
    ok(`${label}: archive has no illustration or story placeholders`,await p.locator('#archive img,#archive [data-story]').count()===0);
    ok(`${label}: archive layout fits`,!await overflow(p));
    await p.screenshot({path:path.join(output,`${label}-archive.png`),fullPage:true});
    for(const id of ids){
      await click(p,`.archive-card[data-role-id=${id}]`,mobile);
      const valid=await p.evaluate(id=>{
        const role=MetroQuizV4.data.roles.find(r=>r.id===id),corpus=role.title+role.summary+role.growth;
        return document.getElementById('result-name').textContent===role.line&&document.getElementById('result-title').textContent===role.title&&document.getElementById('result-summary').textContent===role.summary&&document.getElementById('result-growth').textContent===role.growth&&[...document.querySelectorAll('#result-keywords span')].every(n=>corpus.includes(n.textContent));
      },id);
      ok(`${label}: ${id} uses existing role data and terms`,valid);
      ok(`${label}: ${id} cannot replace real result`,await raw(p)===firstRaw&& !await p.locator('#personal-analysis').isVisible()&&!await p.locator('#result-completed').isVisible());
      ok(`${label}: ${id} detail fits without artwork`,!await overflow(p)&&await p.locator('#result img').count()===0);
      if(id==='L15')await p.screenshot({path:path.join(output,`${label}-detail.png`),fullPage:true});
      if(id==='L01')ok(`${label}: previous disabled at first role`,await p.locator('#prev-role-btn').isDisabled());
      if(id==='JR')ok(`${label}: next disabled at last role`,await p.locator('#next-role-btn').isDisabled());
      await click(p,'#detail-archive-btn',mobile);
    }
    await click(p,'.archive-card[data-role-id=L15]',mobile);
    await click(p,'#prev-role-btn',mobile);
    ok(`${label}: previous role`,await p.locator('#result-name').innerText()==='14号线');
    await click(p,'#next-role-btn',mobile);
    ok(`${label}: next role`,await p.locator('#result-name').innerText()==='15号线');
    await p.reload({waitUntil:'networkidle'});
    ok(`${label}: direct role refresh preserves unlock`,await p.locator('#result-name').innerText()==='15号线');
    await click(p,'#detail-own-btn',mobile);
    ok(`${label}: easy return to own result`,await p.locator('#result-name').innerText()==='3号线'&&await raw(p)===firstRaw);
    await p.screenshot({path:path.join(output,`${label}-saved-result.png`),fullPage:true});
    await context.close();
    context=await chromium.launchPersistentContext(profile,options);
    p=context.pages()[0]||await context.newPage();watch(p);
    await p.goto(base,{waitUntil:'networkidle'});
    ok(`${label}: survives actual Chrome close and reopen`,await raw(p)===firstRaw&&await p.locator('#history-btn').isEnabled());
    await click(p,'#history-btn',mobile);
    await click(p,'#restart-btn',mobile);
    const secondAnswers=await finish(p,'L15',mobile,true);
    const second=JSON.parse(await raw(p));
    const expected=await p.evaluate(answers=>MetroQuizV4.calculate(answers).slice(0,3).map(r=>({lineId:r.role.id,lineName:r.role.line,score:r.score})),secondAnswers);
    ok(`${label}: new complete test replaces old record`,second.completedAt!==record.completedAt&&JSON.stringify(second.answers)===JSON.stringify(secondAnswers)&&JSON.stringify(second.topThree)===JSON.stringify(expected));
    ok(`${label}: saved click ranks survive`,second.answers[0].length===3&&new Set(second.answers[0]).size===3);
    await click(p,'#result-home-btn',mobile);
    await p.screenshot({path:path.join(output,`${label}-home.png`),fullPage:true});
    await p.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
    await click(p,'#archive-btn',mobile);
    ok(`${label}: reduced motion / dark preference works`,await p.locator('.archive-card').count()===22&&!await overflow(p));
    await p.locator('.archive-card').first().focus();await p.keyboard.press('Enter');
    ok(`${label}: keyboard archive activation`,await p.locator('#result-name').innerText()==='1号线');
  }finally{await context.close();fs.rmSync(profile,{recursive:true,force:true});}
}

async function failureAndScoringChecks(){
  const browser=await chromium.launch({executablePath:executable,headless:true});
  try{
    // Non-persistent browser contexts are Chrome off-the-record contexts.
    let privateContext=await browser.newContext();
    let privatePage=await privateContext.newPage();watch(privatePage);
    await privatePage.goto(base,{waitUntil:'networkidle'});
    await click(privatePage,'#start-btn');await finish(privatePage,'L03');
    ok('Private context: current test can save and unlock',await raw(privatePage)!==null);
    await privatePage.reload({waitUntil:'networkidle'});
    ok('Private context: refresh within the session restores result',await privatePage.locator('#result-name').innerText()==='3号线');
    await privateContext.close();
    privateContext=await browser.newContext();privatePage=await privateContext.newPage();watch(privatePage);
    await privatePage.goto(base,{waitUntil:'networkidle'});
    ok('Private context: closed private session is not falsely recoverable',await raw(privatePage)===null&&await privatePage.locator('#history-btn').isDisabled());
    await privateContext.close();
    for(const width of [320,375,640,768,1024,1920]){
      const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      await context.addInitScript(({key,record})=>localStorage.setItem(key,JSON.stringify(record)),{key:KEY,record:firstRecord});
      const page=await context.newPage();watch(page);
      for(const route of ['/result','/archive','/archive/L15']){
        await page.goto(base+'#'+route,{waitUntil:'networkidle'});
        ok(`${width}px ${route}: correct unlocked screen`,route==='/archive'?await page.locator('.archive-card').count()===22:await page.locator('#result').isVisible());
        ok(`${width}px ${route}: no horizontal overflow`,!await overflow(page));
      }
      await context.close();
    }
    const invalid=[['broken JSON','{'],['old schema',JSON.stringify({...firstRecord,schemaVersion:99})],['unknown test version',JSON.stringify({...firstRecord,testVersion:'4.2'})],['stale data',JSON.stringify({...firstRecord,dataFingerprint:'old-data'})],['incomplete answers',JSON.stringify({...firstRecord,answers:firstRecord.answers.slice(1)})],['duplicate answer',JSON.stringify({...firstRecord,answers:firstRecord.answers.map((a,i)=>i===0?['A','A']:a)})],['unknown line',JSON.stringify({...firstRecord,result:{...firstRecord.result,lineId:'unknown'}})],['wrong score',JSON.stringify({...firstRecord,result:{...firstRecord.result,score:999}})],['invalid timestamp',JSON.stringify({...firstRecord,completedAt:'not a date'})],['missing rankings',JSON.stringify({...firstRecord,topThree:[]})],['invalid choice',JSON.stringify({...firstRecord,answers:firstRecord.answers.map((a,i)=>i===0?['F']:a)})]];
    for(const [name,value] of invalid){
      const context=await browser.newContext();await context.addInitScript(({key,value})=>localStorage.setItem(key,value),{key:KEY,value});
      const p=await context.newPage();watch(p);await p.goto(base+'#/archive/L15',{waitUntil:'networkidle'});
      ok(`${name}: no false unlock or white screen`,await p.locator('#locked').isVisible()&&await p.locator('#history-btn').isDisabled()&&await p.locator('.archive-card').count()===0);
      ok(`${name}: diagnostic and stored data left intact`,(await p.locator('#storage-status').innerText()).includes('不兼容')&&await raw(p)===value);
      await click(p,'#locked-start-btn');await click(p,'.choice[data-key=A]');
      ok(`${name}: quiz remains usable`,await p.locator('#next-btn').isEnabled());await context.close();
    }
    for(const mode of ['getter denied','read denied','quota with earlier result']){
      const context=await browser.newContext();
      await context.addInitScript(({mode,key,previous})=>{
        if(mode==='quota with earlier result')localStorage.setItem(key,JSON.stringify(previous));
        if(mode==='getter denied')Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError');}});
        if(mode==='read denied')Object.defineProperty(Storage.prototype,'getItem',{value(){throw new DOMException('blocked','SecurityError');}});
        Object.defineProperty(Storage.prototype,'setItem',{value(){throw new DOMException('full','QuotaExceededError');}});
      },{mode,key:KEY,previous:firstRecord});
      const p=await context.newPage();watch(p);await p.goto(base,{waitUntil:'networkidle'});
      await click(p,'#start-btn');await finish(p,'L15');
      ok(`${mode}: completes without storage`,await p.locator('#result').isVisible());
      ok(`${mode}: honest persistence warning`,(await p.locator('#storage-status').innerText()).includes('下次访问可能无法恢复'));
      await click(p,'#result-archive-btn');
      ok(`${mode}: all 22 available in current page session`,await p.locator('.archive-card').count()===22);
      if(mode==='quota with earlier result')ok(`${mode}: failed write does not erase old result`,(JSON.parse(await raw(p))).result.lineId===firstRecord.result.lineId);
      await p.reload({waitUntil:'networkidle'});
      ok(`${mode}: reload never fabricates lost record`,mode==='quota with earlier result'?await p.locator('.archive-card').count()===22:await p.locator('#locked').isVisible());
      await context.close();
    }
    const p=await browser.newPage();watch(p);await p.goto(base,{waitUntil:'networkidle'});
    const original=execFileSync('git',['show','2a1d06a:index.html'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
    const originalData=JSON.parse(original.match(/<script id="quiz-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    const oldScript=original.match(/<script>([\s\S]*?)<\/script>/)[1];
    const scoring=oldScript.slice(oldScript.indexOf('function rankContribution'),oldScript.indexOf('function showResult'));
    const scope={DATA:originalData,KEYS:['A','B','C','D','E'],RANK_WEIGHTS:originalData.meta.rankWeights,PREFERENCE_SECONDARY:originalData.meta.secondPreferenceWeight};
    vm.createContext(scope);vm.runInContext(scoring,scope);
    let seed=77531;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    const vectors=Array.from({length:150},()=>originalData.questions.map(()=>['A','B','C','D','E'].map(key=>({key,r:rand()})).sort((a,b)=>a.r-b.r).slice(0,1+Math.floor(rand()*3)).map(v=>v.key)));
    const expected=vectors.map(a=>scope.calculate(a).map(r=>({id:r.role.id,score:r.score})));
    const actual=await p.evaluate(vectors=>vectors.map(a=>MetroQuizV4.calculate(a).map(r=>({id:r.role.id,score:r.score}))),vectors);
    ok('150 ordered-answer vectors exactly match the original V4.2 scoring',JSON.stringify(actual)===JSON.stringify(expected));
    ok('Original 20 questions, roles and weights are unchanged',JSON.stringify(await p.evaluate(()=>MetroQuizV4.data))===JSON.stringify(originalData));
    const winners=await p.evaluate(()=>MetroQuizV4.data.roles.map(role=>({id:role.id,winner:MetroQuizV4.calculate([...role.primary].map(k=>[k]))[0].role.id})));
    ok('All 22 role profiles still produce their own winner',winners.length===22&&winners.every(r=>r.id===r.winner));
    const presentationCompatible=await p.evaluate(record=>{
      const changed=JSON.parse(JSON.stringify(MetroQuizV4.data));
      changed.roles[0].artwork='future-original-illustration';
      changed.roles[0].story='future-approved-story';
      return !!MetroRecords.createStore(changed,MetroQuizV4.calculate).validate(record);
    },firstRecord);
    ok('Future per-ID artwork/story metadata does not invalidate scoring records',presentationCompatible);
    ok('Footer relationship statement removed',!(await p.locator('footer').innerText()).includes('人物无官方恋爱关系'));
  }finally{await browser.close();}
}

(async()=>{
  fs.mkdirSync(output,{recursive:true});
  await regularFlow(false);await regularFlow(true);await failureAndScoringChecks();
  ok('No script, console, request or HTTP errors',errors.length===0);
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({url:base,storageKey:KEY,checks,errors},null,2));
  console.log(`PASS: ${checks.length} V5 browser assertions at ${base}`);
})().catch(e=>{console.error(e);console.error(errors);fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({url:base,checks,errors,error:e.message},null,2));process.exit(1);});
