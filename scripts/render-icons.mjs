import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const require=createRequire('C:/Users/Zojekin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/Zojekin/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',args:['--use-mock-keychain','--password-store=basic']});
try{
 const page=await browser.newPage({viewport:{width:128,height:128},deviceScaleFactor:1});
 const source=await readFile('public/brand/symbol.svg','utf8');
 await page.setContent(source);const bounds=await page.locator('svg').evaluate(el=>{const b=el.getBBox();return {x:b.x,y:b.y,width:b.width,height:b.height}});
 const canvas=Math.max(bounds.width,bounds.height)/.96;
 const viewBox=[bounds.x-(canvas-bounds.width)/2,bounds.y-(canvas-bounds.height)/2,canvas,canvas].join(' ');
 const svg=source.replace(/width="[^"]*"/,'width="128"').replace(/height="[^"]*"/,'height="128"').replace(/viewBox="[^"]*"/,`viewBox="${viewBox}"`);
 await writeFile('public/brand/extension-icon.svg',svg);
 for(const size of [16,32,48,96,128]){await page.setViewportSize({width:size,height:size});await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);await page.screenshot({path:`public/icon/${size}.png`,omitBackground:true});}
 const manifest=JSON.parse(await readFile('public/manifest.json','utf8'));manifest.action.default_icon=manifest.icons;await writeFile('public/manifest.json',JSON.stringify(manifest,null,2)+'\n');
 await mkdir('qa/shots',{recursive:true});
 const old=await readFile('../Tabtab/docs/branding/tabnido-final/assets/icon-128-black.png');const next=await readFile('public/icon/128.png');
 await page.setViewportSize({width:500,height:240});await page.setContent(`<style>body{margin:0;padding:24px;background:#f6f6f6;font:14px Arial;color:#111;display:flex;gap:32px}.tile{width:192px;text-align:center}.canvas{width:128px;height:128px;margin:0 auto 16px;background:white;border:1px solid #ddd}img{width:128px;height:128px;display:block}</style><div class="tile"><div class="canvas"><img src="data:image/png;base64,${old.toString('base64')}"></div>原图标</div><div class="tile"><div class="canvas"><img src="data:image/png;base64,${next.toString('base64')}"></div>放大后 · 宽度占比 96%</div>`);await page.screenshot({path:'qa/shots/icon-comparison.png'});
 console.log(JSON.stringify({canvasWidthOccupancy:.96,sizes:[16,32,48,96,128],viewBox}));
}finally{await browser.close()}
