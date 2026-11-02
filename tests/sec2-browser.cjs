// Uses an isolated browser context and serves all content from memory. No live API.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const context = await browser.newContext();
    let aiCalls = 0;
    const errors = [];
    const attack = '<img src=x onerror="window.__sec2=1"> & "한글"';
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url === 'http://sec2.invalid/') {
        const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, '');
        return route.fulfill({contentType:'text/html', body:html});
      }
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        aiCalls++;
        return route.fulfill({contentType:'application/json', body:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({date:'2026-11-02',amount:12345,item:attack,store:'합성 상호',category:'supplies'})}]}}]})});
      }
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://sec2.invalid/');
    // Positive control: the harmless marker must execute in this browser.
    await page.evaluate(text => { document.querySelector('#app').innerHTML=text; }, attack);
    await page.waitForFunction(() => window.__sec2 === 1);
    await page.evaluate(() => { delete window.__sec2; });
    for (const file of ['data-safety','storage','excel-export','pages','app']) await page.addScriptTag({content:fs.readFileSync(path.join(root,'js',file+'.js'),'utf8')});
    await page.evaluate(text => {
      localStorage.setItem('classbudget_settings',JSON.stringify({budgetName:text,totalBudget:500000,schoolName:text,geminiApiKey:'synthetic-not-a-key'}));
      localStorage.setItem('classbudget_receipts',JSON.stringify([{id:'legacy',date:'2026-11-02',amount:1000,item:text,store:text,category:'supplies',memo:text,imageName:text,imageData:'data:image/png;base64,AA=='}]));
      App.navigate('#/list'); App.showToast(text);
    }, attack);
    assert.ok((await page.locator('tbody').textContent()).includes(attack));
    await page.locator('.receipt-thumb').click();
    assert.ok((await page.locator('.modal__title').textContent()).includes(attack));
    assert.equal(await page.locator('#image-modal-overlay [onerror], #toast-container [onerror], tbody [onerror]').count(),0);
    await page.locator('#close-image-modal').click();
    await page.evaluate(() => App.navigate('#/settings'));
    assert.equal(await page.locator('#setting-budget-name').inputValue(),attack);
    await page.evaluate(() => App.navigate('#/edit/legacy'));
    assert.equal(await page.locator('#receipt-item').inputValue(),attack);
    await page.evaluate(() => App.navigate('#/add'));
    await page.locator('input[type=file]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a21sAAAAASUVORK5CYII=','base64')});
    await page.locator('#ai-consent').waitFor({state:'visible'});
    assert.equal(aiCalls,0);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#btn-run-ai').click();
    await page.waitForFunction(text => document.getElementById('receipt-item').value===text,attack);
    assert.equal(aiCalls,1);
    await page.locator('#receipt-form button[type=submit]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('classbudget_receipts')).length===2);
    await page.evaluate(() => App.navigate('#/list'));
    assert.equal(await page.evaluate(() => window.__sec2),undefined);
    assert.deepEqual(errors,[]);
    console.log('PASS: browser positive control, XSS display/modal/toast/settings/edit, image resize + mocked OCR + save; real API calls: 0');
    await context.close();
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
