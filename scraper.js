
// scraper.js - BOA V4 FIX - ไม่ทับราคาด้วย 1000/3000, เก็บราคาจริงไว้
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
const BATCH_SIZE = 6; // ลดเหลือ 6 ใบต่อรอบ กันโดนบล็อค

async function getPrices() {
  const res = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: FILE_KEY }));
  return JSON.parse(await res.Body.transformToString());
}
async function putPrices(data) {
  data.updated = new Date().toISOString();
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: FILE_KEY, Body: JSON.stringify(data,null,2), ContentType: 'application/json' }));
  console.log('Uploaded', data.updated);
}

async function getLowest(page, apparel_id) {
  return await page.evaluate(async (id) => {
    const apis = [
      `/v1/apparels/${id}/sales-histories?per=20&page=1`,
      `/v1/apparels/${id}/sales-histories`,
      `/v1/trading-cards/${id}/sales-histories?per=20`
    ];
    for (const url of apis) {
      try {
        const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!r.ok) continue;
        const j = await r.json();
        let list = j.data || j.sales_histories || j.histories || j.items || j;
        if (!Array.isArray(list)) continue;
        const prices = list.map(o => parseInt(o.price || o.sales_price || o.sold_price || 0,10)).filter(v=>v>=1000 && v<=200000);
        if (prices.length) {
          // เอา 5 รายการล่าสุด หาต่ำสุด = ราคาซื้อขายล่างสุด
          const lowest = Math.min(...prices.slice(0,8));
          console.log('API', url, 'prices', prices.slice(0,5), 'lowest', lowest);
          return lowest;
        }
      } catch(e){}
    }
    // Fallback: หา ¥ ในหน้า
    try {
      const txt = document.body.innerText;
      const m = [...txt.matchAll(/¥\s?([0-9,]+)/g)].map(x=>parseInt(x[1].replace(/,/g,''),10)).filter(v=>v>=1000 && v<=200000);
      if (m.length) return Math.min(...m.slice(0,10));
    } catch{}
    return null;
  }, apparel_id);
}

async function main() {
  const data = await getPrices();
  const keys = Object.keys(data.prices).sort();
  const now = new Date();
  const totalBatches = Math.ceil(keys.length / BATCH_SIZE);
  const batchIdx = now.getUTCHours() % totalBatches;
  const batch = keys.slice(batchIdx * BATCH_SIZE, batchIdx * BATCH_SIZE + BATCH_SIZE);
  console.log(`BATCH ${batchIdx+1}/${totalBatches}: ${batch.join(', ')}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  await page.goto('https://snkrdunk.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  let updated = 0;
  for (const k of batch) {
    const item = data.prices[k];
    if (!item.apparel_id) continue;

    try {
      await page.goto(`https://snkrdunk.com/apparels/${item.apparel_id}/sales-histories`, { waitUntil: 'domcontentloaded', timeout: 40000 });
      await page.waitForTimeout(3000);
      
      const realPrice = await getLowest(page, item.apparel_id);
      console.log(`${k} scraped=${realPrice} old=${item.raw_jpy}`);

      // ถ้าดึงไม่ได้ ให้ข้าม ไม่ทับด้วย 1000
      if (!realPrice || realPrice < 1000) {
        console.log(`${k} skip - no real price`);
        continue;
      }

      // ถ้าได้ราคาจริงมา และไม่ใช่ 1000/3000 ค่าเริ่มต้น
      if (realPrice !== 1000 && realPrice !== 3000) {
        // ป้องกันราคาผิดปกติ เกิน 5 เท่าจากของเดิมที่เป็นราคาจริงแล้ว (ไม่ใช่ 1000)
        if (item.raw_jpy > 1000 && item.raw_jpy !== 3000) {
          if (realPrice > item.raw_jpy * 3 || realPrice < item.raw_jpy * 0.3) {
            console.log(`${k} skip - price jump too high ${item.raw_jpy} -> ${realPrice}`);
            continue;
          }
        }
        item.raw_jpy = realPrice;
        item.jpy = realPrice;
        item.raw_thb = Math.round(realPrice * RATE);
        item.thb = Math.round(realPrice * RATE);
        
        // PSA10: ถ้ามี id แยกให้ดึงแยก ถ้าไม่มีให้ใช้ ratio เดิมที่เคยคำนวณไว้ แต่ถ้าเป็น 3000 ให้ใช้ x2.15
        if (item.apparel_id_psa10) {
          await page.goto(`https://snkrdunk.com/apparels/${item.apparel_id_psa10}/sales-histories`, { waitUntil: 'domcontentloaded', timeout: 40000 });
          await page.waitForTimeout(3000);
          const psaReal = await getLowest(page, item.apparel_id_psa10);
          if (psaReal && psaReal >= 1000) {
            item.psa10_jpy = psaReal;
            item.psa10_thb = Math.round(psaReal * RATE);
          }
        } else {
          // ถ้าเคยเป็น 3000 ให้ใช้ 2.15 เท่า
          const ratio = (item.psa10_jpy === 3000) ? 2.15 : (item.psa10_jpy / item.raw_jpy);
          const useRatio = (ratio >= 1.3 && ratio <= 4) ? ratio : 2.15;
          item.psa10_jpy = Math.round(realPrice * useRatio);
          item.psa10_thb = Math.round(item.psa10_jpy * RATE);
        }
        item.psa_jpy = item.psa10_jpy;
        item.psa_thb = item.psa10_thb;
        item.updated = new Date().toISOString();
        updated++;
        console.log(`UPDATED ${k} -> RAW ¥${realPrice} PSA ¥${item.psa10_jpy}`);
      }
    } catch (e) {
      console.log(k, 'error', e.message);
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  await browser.close();
  if (updated > 0) {
    await putPrices(data);
  } else {
    console.log('No real update, keeping old prices (not overwriting with 1000)');
  }
}
main();
