// scraper.js V17 PLAYWRIGHT INTERCEPT - ดัก API ที่ SNKRDUNK ยิงเอง
import { chromium } from 'playwright';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY }
});
const BUCKET = process.env.R2_BUCKET || 'cardmatem-raw';
const FILE_KEY = 'boa-prices.json';
const RATE = 0.245;
const BATCH_SIZE = 6;

async function getPrices() {
  const res = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: FILE_KEY }));
  return JSON.parse(await res.Body.transformToString());
}
async function putPrices(data) {
  data.updated = new Date().toISOString();
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: FILE_KEY, Body: JSON.stringify(data,null,2), ContentType: 'application/json' }));
  console.log('✅ Uploaded to R2');
}

async function scrapeWithIntercept(page, apparelId) {
  const url = `https://snkrdunk.com/apparels/${apparelId}/sales-histories`;
  console.log(`\n--> Goto ${url}`);

  let captured = [];
  
  // ดักทุก response ที่มีคำว่า sales / transaction / history
  page.on('response', async (response) => {
    const u = response.url();
    if (u.includes('sales') || u.includes('transaction') || u.includes('history') || u.includes('_next/data')) {
      try {
        const ct = response.headers()['content-type'] || '';
        if (ct.includes('json') || u.includes('.json')) {
          const json = await response.json().catch(()=>null);
          if (json) {
            const s = JSON.stringify(json).substring(0,2000);
            if (s.includes('price') || s.includes('เยน') || s.includes('sold')) {
              console.log(`  CAPTURED API ${u} len ${JSON.stringify(json).length}`);
              captured.push(json);
            }
          }
        }
      } catch {}
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000); // รอให้ JS ยิง API

  // 1. ลองหาจาก API ที่ดักได้
  let aPrice = null, psaPrice = null;
  
  for (const data of captured) {
    const str = JSON.stringify(data);
    // หา price ทั้งหมด
    const prices = [...str.matchAll(/"price"\s*:\s*(\d+)/g)].map(x=>parseInt(x[1])).filter(v=>v>=300 && v<=10000000);
    if (prices.length > 0) {
      console.log(`  API prices sample ${prices.slice(0,5)}`);
      // ลองหาแบบมี status
      const regex = /"status"\s*:\s*"([^"]+)"[^}]{0,100}"price"\s*:\s*(\d+)/gi;
      let m;
      while ((m = regex.exec(str)) !== null) {
        const status = m[1].toLowerCase();
        const price = parseInt(m[2]);
        if (status.includes('psa') && !psaPrice) psaPrice = price;
        if ((status === 'a' || status === 'เอ' || status.includes('a')) && !status.includes('psa') && !aPrice) aPrice = price;
      }
      // fallback ถ้ายังไม่ได้
      if (!aPrice && prices[0]) aPrice = prices[0];
      if (!psaPrice && prices[1]) psaPrice = prices[1];
      if (aPrice || psaPrice) break;
    }
  }

  // 2. ถ้ายังไม่ได้ อ่านจาก DOM ตรงๆ แบบที่เห็นใน screenshot คุณ
  if (!aPrice || !psaPrice) {
    const domResult = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      const lines = bodyText.split('\n').map(l=>l.trim()).filter(Boolean);
      let a = null, psa = null;
      const debug = [];
      
      for (let i=0; i<lines.length; i++) {
        const line = lines[i];
        // ตัวอย่างจริงจาก SNKRDUNK: "เอ 4,400 เยน" / "พีเอสเอ10 14,400 เยน"
        if (line.includes('เยน')) {
          const priceMatch = line.match(/([\d,]+)\s*เยน/);
          if (!priceMatch) continue;
          const p = parseInt(priceMatch[1].replace(/,/g,''));
          if (!(p>=300 && p<=5000000)) continue;
          
          debug.push(line);
          
          if (line.includes('PSA') || line.includes('พีเอสเอ') || line.includes('PSA10')) {
            if (!psa) psa = p;
          } else if (line.includes(' เอ ') || line.startsWith('เอ ') || line.includes(' สถานะ A') || (!line.includes('PSA') && p)) {
            // ถ้าบรรทัดมีคำว่า เอ และไม่มี PSA
            if (line.includes('เอ') && !line.includes('PSA')) {
              if (!a) a = p;
            }
          }
        }
      }
      
      // ถ้ายังไม่ได้ ให้เอา 2 ราคาแรกที่เจอในตาราง
      if (!a || !psa) {
        const tableRows = [...document.querySelectorAll('table tr')];
        const tablePrices = [];
        for (const tr of tableRows) {
          const txt = tr.innerText;
          if (txt.includes('เยน')) {
            const mm = txt.match(/([\d,]+)\s*เยน/);
            if (mm) {
              const pp = parseInt(mm[1].replace(/,/g,''));
              tablePrices.push({ price: pp, text: txt });
            }
          }
        }
        // เรียงจากบนลงล่างคือล่าสุดก่อน
        if (tablePrices.length >= 1 && !a) a = tablePrices.find(t=>!t.text.includes('PSA'))?.price || tablePrices[0].price;
        if (tablePrices.length >= 1 && !psa) psa = tablePrices.find(t=>t.text.includes('PSA'))?.price || tablePrices[1]?.price || a;
      }
      
      return { a, psa, debug: debug.slice(0,5), bodySnippet: bodyText.substring(0,2000) };
    });
    
    console.log(`  DOM debug lines:`, domResult.debug);
    if (!aPrice) aPrice = domResult.a;
    if (!psaPrice) psaPrice = domResult.psa;
    
    if (!aPrice && !psaPrice) {
      console.log(`  body snippet: ${domResult.bodySnippet.substring(0,500)}`);
    }
  }

  console.log(`  -> FINAL A ¥${aPrice} | PSA10 ¥${psaPrice}`);
  return { aPrice, psaPrice };
}

async function main() {
  const data = await getPrices();
  const allKeys = Object.keys(data.prices).sort();
  const batchIndex = parseInt(process.env.BATCH_INDEX || '0', 10);
  const batchKeys = allKeys.slice(batchIndex * BATCH_SIZE, batchIndex * BATCH_SIZE + BATCH_SIZE);
  console.log(`=== BATCH ${batchIndex} : ${batchKeys.join(',')} ===`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'th-TH',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'th-TH,th;q=0.9,ja;q=0.8,en;q=0.7' }
  });
  
  let updated = 0;
  for (const key of batchKeys) {
    const item = data.prices[key];
    const apparelId = item.apparel_id || item.url?.match(/apparels\/(\d+)/)?.[1];
    if (!apparelId) { console.log(`SKIP ${key} no apparel_id`); continue; }
    
    const page = await context.newPage();
    try {
      const { aPrice, psaPrice } = await scrapeWithIntercept(page, apparelId);
      if (aPrice) {
        item.raw_jpy = aPrice; item.jpy = aPrice;
        item.raw_thb = Math.round(aPrice * RATE);
        item.thb = Math.round(aPrice * RATE);
      }
      if (psaPrice) {
        item.psa10_jpy = psaPrice; item.psa_jpy = psaPrice;
        item.psa10_thb = Math.round(psaPrice * RATE);
        item.psa_thb = Math.round(psaPrice * RATE);
      }
      if (aPrice || psaPrice) {
        item.updated = new Date().toISOString();
        updated++;
        console.log(`  ✅ ${key} UPDATED RAW ¥${aPrice} PSA10 ¥${psaPrice}`);
      } else {
        console.log(`  ❌ ${key} still null`);
      }
    } catch (e) {
      console.log(`  ❌ ${key} error ${e.message}`);
    }
    await page.close();
    await new Promise(r=>setTimeout(r, 2000));
  }

  await browser.close();
  if (updated>0) await putPrices(data);
  console.log(`\n🎉 DONE ${updated}/${batchKeys.length} - Updated: ${updated}`);
}
main();
