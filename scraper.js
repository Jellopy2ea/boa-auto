// scraper.js V7 - FIX null - ใช้ API ตรงๆ ไม่กดปุ่ม เอาตัวล่าสุดแบบหุ้น
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
const BATCH_SIZE = 4;

async function getPrices() {
  const res = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: FILE_KEY }));
  return JSON.parse(await res.Body.transformToString());
}
async function putPrices(data) {
  data.updated = new Date().toISOString();
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: FILE_KEY, Body: JSON.stringify(data,null,2), ContentType: 'application/json' }));
  console.log('✅ Uploaded', data.updated);
}

// ดึงราคาล่าสุดโดยใช้ fetch ใน page context (ผ่าน Cloudflare ได้)
async function fetchLatest(page, apparelId, status) {
  return await page.evaluate(async ({id, st}) => {
    // ลองหลาย endpoint ที่ SNKRDUNK ใช้จริง
    const urls = [
      `https://snkrdunk.com/api/v1/apparels/${id}/sales?status=${st}&limit=1&sort=sold_at_desc`,
      `https://snkrdunk.com/api/v1/apparels/${id}/sales_histories?status=${st}&limit=1`,
      `https://snkrdunk.com/v1/apparels/${id}/sales?status=${st}&per=1`,
      `https://snkrdunk.com/apparels/${id}/sales-histories?status=${st}`
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, { credentials: 'include', headers: { 'Accept': 'application/json' } });
        const text = await res.text();
        if (!text) continue;
        try {
          const json = JSON.parse(text);
          // หาราคาใน json
          if (Array.isArray(json) && json[0]?.price) return { price: json[0].price, raw: json };
          if (json.data && Array.isArray(json.data) && json.data[0]?.price) return { price: json.data[0].price, raw: json.data };
          if (json.sales && Array.isArray(json.sales) && json.sales[0]?.price) return { price: json.sales[0].price, raw: json.sales };
          if (json.price) return { price: json.price, raw: json };
        } catch {
          // ถ้าไม่ใช่ json ให้ลองหาด้วย regex ¥
          const m = text.match(/(\d{3,6})\s*yen/i) || text.match(/¥\s*([0-9,]+)/);
          if (m) return { price: parseInt(m[1].replace(/,/g,'')), raw: text.slice(0,500) };
        }
      } catch {}
    }
    // fallback: อ่านจาก DOM ของหน้านี้เลย เอาราคาแรกที่เจอในส่วนประวัติ
    try {
      const html = document.documentElement.innerHTML;
      const matches = [...html.matchAll(/¥\s*([0-9,]{3,6})/g)].map(m=>parseInt(m[1].replace(/,/g,''))).filter(v=>v>=1500&&v<=100000);
      if (matches.length) return { price: matches[0], raw: 'dom' };
    } catch {}
    return null;
  }, { id: apparelId, st: status });
}

async function main() {
  const data = await getPrices();
  const keys = Object.keys(data.prices).sort();
  const totalBatches = Math.ceil(keys.length / BATCH_SIZE);
  const now = new Date();
  const batchIdx = (now.getUTCHours()*4 + Math.floor(now.getUTCMinutes()/15)) % totalBatches;
  const batch = keys.slice(batchIdx * BATCH_SIZE, batchIdx * BATCH_SIZE + BATCH_SIZE);
  console.log(`=== BATCH ${batchIdx+1}/${totalBatches}: ${batch.join(', ')} ===`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    locale: 'ja-JP'
  });
  const page = await context.newPage();
  await page.goto('https://snkrdunk.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  let updated = 0;
  for (const k of batch) {
    const item = data.prices[k];
    if (!item?.apparel_id) continue;

    try {
      const id = item.apparel_id;
      const url = `https://snkrdunk.com/apparels/${id}`;
      console.log(`\n--> ${k} ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3000);

      // RAW A = status A, PSA10 = status PSA10
      const rawRes = await fetchLatest(page, id, 'A');
      console.log(`${k} RAW A latest =`, rawRes?.price ?? null);

      const psaRes = await fetchLatest(page, id, 'PSA10');
      console.log(`${k} PSA10 latest =`, psaRes?.price ?? null);

      let changed = false;
      if (rawRes?.price && rawRes.price >= 1500 && rawRes.price <= 100000) {
        item.raw_jpy = rawRes.price;
        item.jpy = rawRes.price;
        item.raw_thb = Math.round(rawRes.price * RATE);
        item.thb = Math.round(rawRes.price * RATE);
        changed = true;
      }
      if (psaRes?.price && psaRes.price >= 1500 && psaRes.price <= 200000) {
        item.psa10_jpy = psaRes.price;
        item.psa10_thb = Math.round(psaRes.price * RATE);
        item.psa_jpy = psaRes.price;
        item.psa_thb = Math.round(psaRes.price * RATE);
        changed = true;
      }

      if (changed) {
        item.updated = new Date().toISOString();
        updated++;
        console.log(`✅ ${k} UPDATED RAW ¥${item.raw_jpy} PSA ¥${item.psa10_jpy}`);
      } else {
        console.log(`⚠️ ${k} no valid price (RAW:${rawRes?.price} PSA:${psaRes?.price})`);
      }
    } catch (e) {
      console.log(`❌ ${k} error ${e.message}`);
    }
    await page.waitForTimeout(1500);
  }

  await browser.close();
  if (updated > 0) {
    await putPrices(data);
    console.log(`🎉 Done ${updated} items`);
  } else {
    console.log('No update - keeping old prices');
  }
}
main();
