// scraper.js V21 - อ่านราคาขายล่าสุดจากหน้า sales-histories ตรงๆ
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

async function scrapeSalesHistory(page, apparelId) {
  const url = `https://snkrdunk.com/apparels/${apparelId}/sales-histories`;
  console.log(`--> ${url}`);
  
  const salesByCond = {};

  page.on('response', async (res) => {
    const u = res.url();
    if (!u.includes(`/apparels/${apparelId}`)) return;
    if (!u.includes('sales-history')) return;
    if (!u.includes('/v1/')) return;
    try {
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const json = await res.json().catch(()=>null);
      if (!json) return;
      
      const urlObj = new URL(u);
      const condId = urlObj.searchParams.get('condition_id') || 'all';
      const list = json.data || json.sales_histories || json || [];
      const arr = Array.isArray(list) ? list : (list.data || []);
      
      if (arr.length > 0) {
        const latest = arr[0];
        const price = latest.price || latest.sold_price || latest.transaction_price;
        const condLabel = latest.condition || latest.card_condition || latest.status || condId;
        console.log(`  CAPTURED sales-history cond=${condId} label=${condLabel} latest ¥${price} count=${arr.length} len=${JSON.stringify(json).length}`);
        if (price) {
          const p = parseInt(price);
          if (p>=300) {
            salesByCond[condId] = { price: p, label: condLabel, raw: latest };
          }
        }
      } else {
        console.log(`  CAPTURED cond=${condId} empty len=${JSON.stringify(json).length}`);
      }
    } catch {}
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);

  // อ่านจาก DOM ด้วย เผื่อ API โดนบล็อค
  const domPrices = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    const result = [];
    for (const tr of rows.slice(0,10)) {
      const text = tr.innerText;
      const priceMatch = text.match(/([\d,]+)/);
      if (priceMatch) {
        result.push({ text: text.substring(0,100), price: parseInt(priceMatch[1].replace(/,/g,'')) });
      }
    }
    return result;
  });
  console.log(`  DOM first rows: ${JSON.stringify(domPrices.slice(0,3))}`);

  // หา A และ PSA10 จาก salesByCond
  // SNKRDUNK trading card: condition_id 18=A, 19=B, 20=C, 22=PSA10?, 23=PSA10?
  // เราจะดูจาก label ถ้ามี
  let aPrice = null, psaPrice = null;
  
  for (const [condId, data] of Object.entries(salesByCond)) {
    const label = (data.label || '').toString().toUpperCase();
    if (label.includes('PSA10') || label.includes('PSA 10') || condId === '23' || condId === '22') {
      if (!psaPrice || data.price > psaPrice) {
        // เลือก cond 23 ก่อน ถ้ามี
        if (condId === '23' || label.includes('PSA10')) {
          psaPrice = data.price;
        } else if (!psaPrice) {
          psaPrice = data.price;
        }
      }
    }
    if (label === 'A' || label.includes(' A ') || condId === '18' || condId === '19') {
      if (!aPrice) aPrice = data.price;
      if (condId === '18') aPrice = data.price; // 18 = A หลัก
    }
  }

  // fallback ถ้ายังไม่ได้ ใช้ cond 18 = A, cond 23 = PSA10 ตามที่เจอจริง
  if (!aPrice && salesByCond['18']) aPrice = salesByCond['18'].price;
  if (!aPrice && salesByCond['19']) aPrice = salesByCond['19'].price;
  if (!psaPrice && salesByCond['23']) psaPrice = salesByCond['23'].price;
  if (!psaPrice && salesByCond['22']) psaPrice = salesByCond['22'].price;

  // ถ้ายังไม่มี PSA10 ให้ลองดูว่า cond 18 มี PSA10 ไหม (บางการ์ดใช้ cond เดียวกัน)
  if (!psaPrice && salesByCond['18'] && salesByCond['18'].label && salesByCond['18'].label.toString().toUpperCase().includes('PSA')) {
    psaPrice = salesByCond['18'].price;
  }

  console.log(`  FINAL MAP ${JSON.stringify(Object.fromEntries(Object.entries(salesByCond).map(([k,v])=>[k,v.price])))} -> A ¥${aPrice} | PSA10 ¥${psaPrice}`);
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
    locale: 'ja-JP',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'ja-JP,ja;q=0.9' }
  });

  let updated = 0;
  for (const key of batchKeys) {
    const item = data.prices[key];
    const apparelId = item.apparel_id || item.url?.match(/apparels\/(\d+)/)?.[1];
    if (!apparelId) { console.log(`SKIP ${key} no apparel_id - need to fix boa-prices.json`); continue; }
    console.log(`\n--> ${key} ${apparelId}`);
    const page = await context.newPage();
    try {
      const { aPrice, psaPrice } = await scrapeSalesHistory(page, apparelId);
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
        console.log(`✅ ${key} UPDATED RAW ¥${aPrice} PSA10 ¥${psaPrice}`);
      } else {
        console.log(`❌ ${key} no sales found`);
      }
    } catch (e) {
      console.log(`❌ ${key} error ${e.message}`);
    }
    await page.close();
    await new Promise(r=>setTimeout(r,2000));
  }

  await browser.close();
  if (updated>0) await putPrices(data);
  console.log(`\n🎉 DONE ${updated}/${batchKeys.length}`);
}
main();
