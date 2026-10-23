// One-time, read-only visual inventory. No data writes, no deployment.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Stagehand } from '@browserbasehq/stagehand';

const input = process.env.AUDIT_BASE_URL;
const root = new URL(input);
if (root.protocol !== 'https:' || root.pathname.replace(/\/$/, '') !== '/admin') {
  throw Error('Supply an HTTPS URL ending with /admin');
}
if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_CONTEXT_ID) {
  throw Error('BROWSERBASE_API_KEY and an already authenticated BROWSERBASE_CONTEXT_ID are required');
}
const stagehand = new Stagehand({
  env: 'BROWSERBASE',
  apiKey: process.env.BROWSERBASE_API_KEY,
  browserbaseSessionCreateParams: {
    browserSettings: {context: {id: process.env.BROWSERBASE_CONTEXT_ID, persist: false}},
  },
});
const out = 'audit-screenshots';
const records = [];
const seen = new Set();
const queued = [root.href];
const allowed = value => {
  try {
    const u = new URL(value, root);
    return u.origin === root.origin && /^\/admin(?:\/|$)/.test(u.pathname)
      && !/\/api\//.test(u.pathname);
  } catch {return false;}
};
await fs.mkdir(out,{recursive:true});
try {
  await stagehand.init();
  const page = stagehand.context.pages()[0];
  while (queued.length && seen.size < 160) {
    const next = queued.shift();
    if (!allowed(next) || seen.has(next)) continue;
    seen.add(next);
    const result = {url:next, images:[], errors:[], links:[]};
    try {
      await page.goto(next);
      await new Promise(resolve => setTimeout(resolve,1200));
      result.finalUrl = page.url();
      if (!allowed(result.finalUrl)) {
        result.errors.push('Authentication failed or redirected outside admin');
        records.push(result);
        break;
      }
      result.title = await page.title();
      // Stagehand inspects the rendered UI. No autonomous write-capable agent is used.
      try {
        const nav = await stagehand.observe('Find navigation links and tabs to other pages in this admin portal. Do not click or modify anything.');
        result.navigationObserved = Array.isArray(nav) ? nav.length : 0;
      } catch(e) {result.errors.push('Stagehand observation: '+String(e.message||e));}
      const found = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a=>a.href));
      for (const candidate of found) {
        if (!allowed(candidate)) continue;
        const u = new URL(candidate);
        u.search = '';u.hash='';
        if (!seen.has(u.href) && !queued.includes(u.href)) queued.push(u.href);
      }
      result.links = found.filter(allowed);
      const slug = new URL(next).pathname.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'');
      // Capture the actual page plus safe expandable menus and tab views.
      const capture = async suffix => {
        const filename = path.join(out,slug+'-'+suffix+'.png');
        const bytes = await page.screenshot({fullPage:true});
        await fs.writeFile(filename,bytes);
        result.images.push(filename);
      };
      await capture('default');
      // Open disclosure elements only; no forms, submit buttons or destructive actions.
      await page.evaluate(() => {
        document.querySelectorAll('details').forEach(el => {el.open=true;});
      });
      await capture('menus-open');
      const tabIds = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="tab"]'))
          .filter(el => el.getAttribute('aria-disabled')!=='true')
          .map((el,i)=>({index:i,label:(el.textContent||'').trim().slice(0,60)})).slice(0,12));
      for (const tab of tabIds) {
        try {
          await page.evaluate(i => document.querySelectorAll('[role="tab"]')[i]?.click(),tab.index);
          await new Promise(resolve => setTimeout(resolve,350));
          await capture('tab-'+tab.index);
        }catch(e){result.errors.push('Tab '+tab.index+': '+String(e.message||e));}
      }
    } catch(e) {result.errors.push(String(e.message||e));}
    records.push(result);
  }
} finally {
  await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({
    createdAt:new Date().toISOString(), pages:records, remaining:queued.length,
    warning:'Read-only screenshot inventory; role-restricted pages and hidden modal states may require separate authenticated captures.',
  },null,2));
  await stagehand.close().catch(()=>{});
}
console.log('Captured '+records.length+' admin routes; '+records.reduce((n,r)=>n+r.images.length,0)+' screenshots');
if (!records.length || records[0].errors.some(x=>x.includes('Authentication failed'))) process.exitCode=1;
