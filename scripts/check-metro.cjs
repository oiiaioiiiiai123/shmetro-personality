// Run against a local server or the deployed GitHub Pages HTTPS address.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.METRO_QA_URL || 'http://127.0.0.1:4174/shmetro-personality/';
const output = process.env.METRO_QA_OUT || path.resolve('test-results/metro');
const checks = [], errors = [];
const ok = (name, value) => { assert.ok(value, name); checks.push(name); };
const choice = (p, key) => p.locator(`.choice[data-key="${key}"]`);
const ranks = p => p.locator('.choice.selected').evaluateAll(nodes => Object.fromEntries(nodes.map(n => [n.dataset.key, n.querySelector('.choice-rank').textContent])));
async function stableChoice(p, key, touch, label) {
  const button = choice(p, key);
  await button.scrollIntoViewIfNeeded();
  const before = await button.evaluate(n => ({top:n.getBoundingClientRect().top, y:scrollY}));
  if (touch) await button.tap(); else await button.click();
  const after = await choice(p,key).evaluate(n => ({top:n.getBoundingClientRect().top, y:scrollY}));
  ok(`${label}: choice keeps its viewport position`, Math.abs(before.top-after.top)<2);
  ok(`${label}: choice does not jump to page top`, before.y<50 || after.y>30);
}
(async () => {
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  try {
    for (const mobile of [false,true]) {
      const label=mobile?'mobile':'desktop';
      const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
      const p=await context.newPage();
      p.on('pageerror', e=>errors.push(`${label}: ${e.message}`));
      p.on('console',m=>{if(m.type()==='error')errors.push(`${label}: ${m.text()}`);});
      p.on('requestfailed',r=>errors.push(`${label}: ${r.url()} ${r.failure()?.errorText}`));
      p.on('response',r=>{if(r.status()>=400)errors.push(`${label}: HTTP ${r.status()} ${r.url()}`);});
      const response=await p.goto(base,{waitUntil:'networkidle'});
      ok(`${label}: entry HTTP 200`,response.status()===200);
      ok(`${label}: original title`,await p.title()==='测测你是哪条上海地铁');
      ok(`${label}: cover loads`,await p.locator('.hero-art img').evaluate(i=>i.complete&&i.naturalWidth>0));
      await p.screenshot({path:path.join(output,`${label}-start.png`),fullPage:true});
      await p.locator('#start-btn').click();
      ok(`${label}: cannot skip unanswered question`,await p.locator('#next-btn').isDisabled());
      await stableChoice(p,'A',mobile,`${label}: first choice`);
      ok(`${label}: one answer enables next`,await p.locator('#next-btn').isEnabled());
      await stableChoice(p,'B',mobile,`${label}: second choice`);
      ok(`${label}: two answer ranks`,JSON.stringify(await ranks(p))===JSON.stringify({A:'①',B:'②'}));
      await stableChoice(p,'C',mobile,`${label}: third choice`);
      ok(`${label}: three answer ranks`,JSON.stringify(await ranks(p))===JSON.stringify({A:'①',B:'②',C:'③'}));
      ok(`${label}: fourth and fifth choices disabled`,await choice(p,'D').isDisabled()&&await choice(p,'E').isDisabled());
      await p.keyboard.press('d');
      ok(`${label}: keyboard cannot add fourth answer`,await p.evaluate(()=>MetroQuizV4.getState().answers[0].join(''))==='ABC');
      await stableChoice(p,'B',mobile,`${label}: cancel middle choice`);
      ok(`${label}: cancellation renumbers later answers`,JSON.stringify(await ranks(p))===JSON.stringify({A:'①',C:'②'}));
      await stableChoice(p,'B',mobile,`${label}: append cancelled choice`);
      ok(`${label}: reselect appends rank three`,await p.evaluate(()=>MetroQuizV4.getState().answers[0].join(''))==='ACB');
      await p.locator('#next-btn').click();
      ok(`${label}: next navigates and scrolls to top`,(await p.locator('#progress-num').innerText()).startsWith('02')&&await p.evaluate(()=>scrollY)===0);
      await p.locator('#back-btn').click();
      ok(`${label}: back preserves selection order`,await p.evaluate(()=>MetroQuizV4.getState().answers[0].join(''))==='ACB');
      const reset=p.locator('.rank-reset'); await reset.scrollIntoViewIfNeeded();
      // Check a genuinely scrolled viewport. At scrollY=0 the browser cannot
      // compensate a shrinking rank strip with a negative scroll offset.
      await p.evaluate(()=>scrollTo({top:180,behavior:'instant'}));
      const beforeReset=await choice(p,'A').evaluate(n=>n.getBoundingClientRect().top);
      if(mobile)await reset.tap();else await reset.click();
      const afterReset=await choice(p,'A').evaluate(n=>n.getBoundingClientRect().top);
      ok(`${label}: clear keeps answer position`,Math.abs(beforeReset-afterReset)<2);
      ok(`${label}: clear removes all answers`,await p.locator('.choice.selected').count()===0&&await p.locator('#next-btn').isDisabled());
      await choice(p,'A').focus();await p.keyboard.press('b');
      ok(`${label}: keyboard selects and retains focus`,await p.evaluate(()=>document.activeElement.dataset.key==='B'&&MetroQuizV4.getState().answers[0][0]==='B'));
      await p.locator('#next-btn').click();
      for(let i=1;i<20;i++) {
        ok(`${label}: question ${i+1} has five choices`,await p.locator('.choice').count()===5);
        if(mobile)await choice(p,'ABCDE'[i%5]).tap();else await choice(p,'ABCDE'[i%5]).click();
        await p.locator('#next-btn').click();
      }
      ok(`${label}: result visible after 20 questions`,await p.locator('#result').isVisible());
      ok(`${label}: character and explanation populated`,(await p.locator('#result-name').innerText()).length>0&&(await p.locator('#result-title').innerText()).length>0&&(await p.locator('#result-summary').innerText()).length>0&&await p.locator('.result-reason').count()>0);
      ok(`${label}: two related characters`,await p.locator('.neighbor').count()===2);
      ok(`${label}: result has no horizontal overflow`,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await p.screenshot({path:path.join(output,`${label}-result.png`),fullPage:true});
      const audit=await p.evaluate(()=>{
        const {data,calculate}=MetroQuizV4;
        return {questions:data.questions.length,choices:data.questions.every(q=>q.choices.length===5),roles:data.roles.length,
          witnesses:data.roles.map(role=>{const r=calculate([...role.primary].map(k=>[k]));return {id:role.id,line:role.line,winner:r[0].role.id,score:r[0].score};}),
          weighted:Math.abs(calculate(data.questions.map(()=>['A','B'])) .find(r=>r.role.id==='L01').score-calculate(data.questions.map(()=>['B','A'])).find(r=>r.role.id==='L01').score)>0,
          disclaimer:document.querySelector('footer').textContent.includes('人物无官方恋爱关系')};
      });
      ok(`${label}: original 20 questions / 5 choices / 22 roles`,audit.questions===20&&audit.choices&&audit.roles===22);
      ok(`${label}: every role can win with its primary profile`,audit.witnesses.every(w=>w.id===w.winner));
      ok(`${label}: rank order changes score`,audit.weighted);
      ok(`${label}: original relationship disclaimer preserved`,audit.disclaimer);
      fs.writeFileSync(path.join(output,`${label}-role-witnesses.json`),JSON.stringify(audit,null,2));
      // Exercise rendering for every result, using the original scoring API and data.
      for(const witness of audit.witnesses){
        await p.evaluate(id=>{const api=MetroQuizV4,s=api.getState(),role=api.data.roles.find(r=>r.id===id);s.answers=[...role.primary].map(k=>[k]);api.showResult();},witness.id);
        ok(`${label}: renders ${witness.line}`,await p.locator('#result-name').innerText()===witness.line&&await p.locator('.neighbor').count()===2);
        ok(`${label}: ${witness.line} fits viewport`,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
      await p.locator('#restart-btn').click();
      ok(`${label}: restart clears all 20 answers`,await p.evaluate(()=>MetroQuizV4.getState().index===0&&MetroQuizV4.getState().answers.every(a=>a.length===0)));
      await p.reload({waitUntil:'networkidle'});
      ok(`${label}: refresh opens start screen`,await p.locator('#start-btn').isVisible());
      await p.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
      await p.locator('#start-btn').click();
      await choice(p,'A').click();
      ok(`${label}: reduced motion and dark OS preference remain usable`,await p.locator('#next-btn').isEnabled());
      ok(`${label}: no horizontal overflow`,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await context.close();
    }
    ok('No browser, console, network or HTTP resource errors',errors.length===0);
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({url:base,checks,errors},null,2));
    console.log(`PASS: ${checks.length} browser assertions at ${base}`);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);console.error(errors);fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({url:base,checks,errors,error:e.message},null,2));process.exit(1);});
