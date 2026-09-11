// scraper.js V19 LOWEST ASK - เอาราคาขายปัจจุบัน ไม่ใช่ประวัติ
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

async function scrapeLowest(page, apparelId) {
  const url = `https://snkrdunk.com/apparels/${apparelId}/`;
  const map = {}; // condition_id -> lowest price

  page.on('response', async (res) => {
    const u = res.url();
    // ดักทุก API ที่เกี่ยวกับ apparels
    if (!u.includes(`/apparels/${apparelId}`)) return;
    if (!u.includes('/v1/')) return;
    try {
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const json = await res.json().catch(()=>null);
      if (!json) return;
      const urlObj = new URL(u);
      const cond = urlObj.searchParams.get('condition_id') || urlObj.searchParams.get('card_status') || 'unknown';

      // หา lowest price ใน response
      let price = null;
      // ลองหลายรูปแบบ
      if (json.lowest_price) price = json.lowest_price;
      else if (json.lowestPrice) price = json.lowestPrice;
      else if (json.data && Array.isArray(json.data) && json.data[0]) {
        const first = json.data[0];
        price = first.lowest_price || first.price || first.min_price;
      }
      else if (json.minPrice) price = json.minPrice;
      else if (json.price) price = json.price;

      // บาง API ส่งเป็น { data: { lowest_price: ... } }
      if (!price && json.data && json.data.lowest_price) price = json.data.lowest_price;

      if (price) {
        const p = parseInt(price);
        if (p>=300 && p<=10000000) {
          console.log(`  CAPTURED ${u} cond=${cond} lowest ¥${p} len ${JSON.stringify(json).length}`);
          // เก็บราคาถูกสุดต่อ condition
          if (!map[cond] || p < map[cond]) map[cond] = p;
        }
      } else {
        // ถ้าไม่มี lowest_price แต่มี list ของ sell orders
        const list = json.data || json.sell_orders || json.sells || [];
        const arr = Array.isArray(list) ? list : [];
        if (arr.length > 0) {
          const prices = arr.map(o=>o.price||o.lowest_price).filter(Boolean).map(v=>parseInt(v)).filter(v=>v>=300);
          if (prices.length > 0) {
            const min = Math.min(...prices);
            console.log(`  CAPTURED ${u} cond=${cond} min from list ¥${min} count ${prices.length}`);
            if (!map[cond] || min < map[cond]) map[cond] = min;
          }
        } else {
          if (JSON.stringify(json).length < 100) {
            console.log(`  CAPTURED ${u} cond=${cond} empty len ${JSON.stringify(json).length}`);
          }
        }
      }
    } catch {}
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);

  // จากที่เทสมา:
  // condition_id 18 = PSA10, 19 = RAW A, 23 = RAW A (แล้วแต่การ์ด)
  // เราจะลองหาทั้งหมดแล้วเลือก
  // ถ้าเจอ 18 = PSA10, 19 หรือ 23 = RAW A
  let aPrice = map['19'] || map['23'] || map['18'] || null;
  let psaPrice = map['18'] || map['22'] || map['23'] || null;

  // ถ้าได้อันเดียวกัน ให้แยกกัน: ถ้า 18 มีค่า ให้ลองใช้ 18 เป็น PSA10 และ 23 เป็น A
  // ดูจาก log เดิม: BOA-01 cond 18 มีขาย, cond 20 ว่าง
  // เราจะใช้ heuristic: ราคา PSA10 ต้อง >= RAW A ถ้าได้มาแล้ว PSA10 < RAW ให้สลับ
  if (aPrice && psaPrice && psaPrice < aPrice) {
    // สลับให้ PSA10 แพงกว่า
    const tmp = aPrice;
    aPrice = Math.min(aPrice, psaPrice);
    psaPrice = Math.max(tmp, psaPrice);
    // ถ้ายังต่ำกว่า ให้ PSA10 = RAW + 20%
    if (psaPrice < aPrice) psaPrice = Math.round(aPrice * 1.2);
  }

  console.log(`  FINAL MAP ${JSON.stringify(map)} -> A ¥${aPrice} | PSA10 ¥${psaPrice}`);
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
    if (!apparelId) { console.log(`SKIP ${key} no apparel_id`); continue; }
    console.log(`\n--> ${key} ${apparelId}`);
    const page = await context.newPage();
    try {
      const { aPrice, psaPrice } = await scrapeLowest(page, apparelId);
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
