// scraper.js V18 - แยก condition_id 18 = RAW A, 23 = PSA10 ถูกต้อง
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
}

async function scrapeOne(page, apparelId) {
  const url = `https://snkrdunk.com/apparels/${apparelId}/sales-histories`;
  const salesMap = {}; // condition_id -> latest price

  page.on('response', async (response) => {
    const u = response.url();
    if (u.includes('/sales-history?')) {
      try {
        const urlObj = new URL(u);
        const cond = urlObj.searchParams.get('condition_id') || 'unknown';
        const json = await response.json().catch(()=>null);
        if (!json) return;
        // json อาจเป็น { data: [...] } หรือ [...]
        const list = json.data || json.sales || json || [];
        const arr = Array.isArray(list) ? list : (list.data || []);
        if (arr.length > 0) {
          // เอารายการแรก = ล่าสุด
          const first = arr[0];
          const price = first.price || first.sold_price || first.transaction_price || first.total_price;
          if (price) {
            console.log(`  CAPTURED cond=${cond} latest ¥${price} len ${JSON.stringify(json).length}`);
            // เก็บเฉพาะถ้ายังไม่มี หรืออัพเดทใหม่
            if (!salesMap[cond]) salesMap[cond] = parseInt(price);
          }
        } else {
          console.log(`  CAPTURED cond=${cond} empty len ${JSON.stringify(json).length}`);
        }
      } catch {}
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);

  // สรุป
  // จากที่ดู: 18=A, 19=B, 20=C, 21=D, 22=PSA? 23=PSA10
  // ใช้ 18 สำหรับ RAW A, 23 สำหรับ PSA10
  let aPrice = salesMap['18'] || salesMap['19'] || null;
  let psaPrice = salesMap['23'] || salesMap['22'] || null;

  // ถ้าไม่มี 23 ลองดู 22
  console.log(`  MAP ${JSON.stringify(salesMap)} -> A ¥${aPrice} | PSA10 ¥${psaPrice}`);
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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });

  let updated = 0;
  for (const key of batchKeys) {
    const item = data.prices[key];
    const apparelId = item.apparel_id || item.url?.match(/apparels\/(\d+)/)?.[1];
    if (!apparelId) { console.log(`SKIP ${key}`); continue; }
    console.log(`\n--> ${key} ${apparelId}`);
    const page = await context.newPage();
    try {
      const { aPrice, psaPrice } = await scrapeOne(page, apparelId);
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
        console.log(`❌ ${key} no sales`);
      }
    } catch (e) { console.log(`❌ ${key} ${e.message}`); }
    await page.close();
    await new Promise(r=>setTimeout(r,1500));
  }

  await browser.close();
  if (updated>0) await putPrices(data);
  console.log(`🎉 DONE ${updated}/${batchKeys.length}`);
}
main();
