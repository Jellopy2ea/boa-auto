// scraper.js - แก้แล้ว วิ่งครบ 46 ใบ วนลูปอัตโนมัติ
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
const BATCH_SIZE = 12; // ดึงทีละ 12 ใบ กันโดนบล็อค

async function getPrices() {
  const res = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: FILE_KEY }));
  const text = await res.Body.transformToString();
  return JSON.parse(text);
}

async function putPrices(data) {
  data.updated = new Date().toISOString();
  await R2.send(new PutObjectCommand({
    Bucket: BUCKET, Key: FILE_KEY,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json'
  }));
  console.log('Uploaded', FILE_KEY, 'updated', data.updated);
}

async function scrapeOne(page, apparel_id) {
  try {
    await page.goto(`https://snkrdunk.com/apparels/${apparel_id}/sales-histories`, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForTimeout(2000);
    const price = await page.evaluate(async (aid) => {
      for (let opt = 1; opt <= 25; opt++) {
        try {
          const r = await fetch(`/v1/apparels/${aid}/sales-chart/used?salesChartOptionId=${opt}`, { credentials: 'include' });
          if (!r.ok) continue;
          const j = await r.json();
          const pts = j.points || j.data?.points || [];
          if (pts.length) {
            const last = pts[pts.length - 1];
            const v = Array.isArray(last) ? last[1] : last.y || last.price || last.value;
            const nv = parseInt(v, 10);
            if (nv > 500 && nv < 500000) return nv;
          }
        } catch {}
      }
      return null;
    }, apparel_id);
    return price;
  } catch (e) {
    console.log('goto error', apparel_id, e.message);
    return null;
  }
}

async function main() {
  const data = await getPrices();
  const keys = Object.keys(data.prices).sort(); // เรียง BOA-01..BOA-46
  console.log('Total keys', keys.length);

  // วนลูปตามชั่วโมง เพื่อให้ครบ 46 ใบใน 4 รอบ
  const now = new Date();
  const batchIndex = now.getUTCHours() % Math.ceil(keys.length / BATCH_SIZE);
  const start = batchIndex * BATCH_SIZE;
  const batch = keys.slice(start, start + BATCH_SIZE);
  console.log(`Batch ${batchIndex + 1} of ${Math.ceil(keys.length / BATCH_SIZE)} -> ${batch.join(', ')}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ 
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' 
  });

  let updatedCount = 0;
  for (const k of batch) {
    const item = data.prices[k];
    if (!item || !item.apparel_id) { console.log(k, 'skip no apparel_id - ต้องไปใส่ใน R2'); continue; }
    try {
      const p = await scrapeOne(page, item.apparel_id);
      if (p) {
        console.log(k, 'price', p);
        item.raw_jpy = p; 
        item.jpy = p; 
        item.raw_thb = Math.round(p * RATE); 
        item.thb = Math.round(p * RATE); 
        item.updated = new Date().toISOString();
        updatedCount++;
      } else console.log(k, 'no price found for apparel_id', item.apparel_id);
    } catch (e) { console.log(k, 'error', e.message); }
    await new Promise(r => setTimeout(r, 1500));
  }
  await browser.close();
  
  if (updatedCount > 0) {
    await putPrices(data);
    console.log(`Updated ${updatedCount} items`);
  } else {
    console.log('No update this batch - check apparel_id');
  }
}

main();
