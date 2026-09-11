// scraper.js V6 - 1 ID ดึง 2 ราคา (เอ=RAW A และ พีเอสเอ10=PSA10) แบบราคาล่าสุดแถวแรก
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
  console.log('✅ Uploaded R2', data.updated);
}

async function getFirstRowPrice(page) {
  await page.waitForTimeout(2500);
  return await page.evaluate(() => {
    // หาแถวแรกของตารางประวัติการซื้อขาย
    // ลองหลายวิธี
    const bodyText = document.body.innerText;
    // วิธีที่ 1: หาตารางแล้วเอาแถวแรก
    const rows = document.querySelectorAll('table tr, [class*="history"] [class*="row"], [class*="SalesHistory"] > div');
    // วิธีที่ง่ายสุด: เอา ¥ ตัวแรกที่เจอในส่วนประวัติการซื้อขาย (อยู่ล่างๆของหน้า)
    // เพราะในรูป ประวัติจะอยู่ใต้ปุ่มฟิลเตอร์
    const historySection = document.body.innerHTML;
    // หา pattern วันที่ + ราคา
    const priceMatches = [...bodyText.matchAll(/([0-9,]{3,6})\s*เยน/g)].map(m => parseInt(m[1].replace(/,/g,''),10)).filter(v=>v>=1500 && v<=100000);
    
    // เอา 4 อันแรกที่เจอในส่วนประวัติ (หลังคำว่า ประวัติการซื้อขาย)
    const idx = bodyText.indexOf('ประวัติการซื้อขาย');
    if (idx !== -1) {
      const afterHistory = bodyText.slice(idx);
      const m = [...afterHistory.matchAll(/([0-9,]{3,6})\s*เยน/g)].map(x=>parseInt(x[1].replace(/,/g,''),10)).filter(v=>v>=1500 && v<=100000);
      if (m.length) return m[0]; // ตัวแรก = ล่าสุด
    }
    if (priceMatches.length) return priceMatches[0];
    return null;
  });
}

async function clickFilter(page, text) {
  try {
    // หาปุ่มที่มีข้อความนั้น
    const btn = page.locator(`button:has-text("${text}")`).first();
    await btn.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    return true;
  } catch {
    // ลองอีกแบบ
    try {
      await page.evaluate((t) => {
        const btns = [...document.querySelectorAll('button')];
        const found = btns.find(b => b.innerText.includes(t));
        if (found) found.click();
      }, text);
      await page.waitForTimeout(2000);
      return true;
    } catch { return false; }
  }
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
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    locale: 'th-TH'
  });
  const page = await context.newPage();
  
  await page.goto('https://snkrdunk.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  let updated = 0;
  for (const k of batch) {
    const item = data.prices[k];
    if (!item?.apparel_id) continue;
    if (k === 'BOA-02' && item.raw_jpy === 6000 && item.psa10_jpy === 12900) {
      console.log(`${k} locked skip (already correct)`);
      continue;
    }

    try {
      const url = `https://snkrdunk.com/apparels/${item.apparel_id}`;
      console.log(`\n--> ${k} ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4000);

      // เลื่อนลงมาที่ประวัติการซื้อขาย
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight*0.5));
      await page.waitForTimeout(1000);

      // 1. ดึง RAW A - กดฟิลเตอร์ เอ
      console.log(`${k} clicking เอ (RAW A)`);
      await clickFilter(page, 'เอ');
      const rawPrice = await getFirstRowPrice(page);
      console.log(`${k} RAW A latest = ${rawPrice}`);

      // 2. ดึง PSA10 - กดฟิลเตอร์ พีเอสเอ10
      console.log(`${k} clicking พีเอสเอ10`);
      await clickFilter(page, 'พีเอสเอ10');
      const psaPrice = await getFirstRowPrice(page);
      console.log(`${k} PSA10 latest = ${psaPrice}`);

      let changed = false;
      if (rawPrice && rawPrice >= 1500 && rawPrice !== 1000) {
        item.raw_jpy = rawPrice;
        item.jpy = rawPrice;
        item.raw_thb = Math.round(rawPrice * RATE);
        item.thb = Math.round(rawPrice * RATE);
        changed = true;
      }
      if (psaPrice && psaPrice >= 1500 && psaPrice !== 3000) {
        item.psa10_jpy = psaPrice;
        item.psa10_thb = Math.round(psaPrice * RATE);
        item.psa_jpy = psaPrice;
        item.psa_thb = Math.round(psaPrice * RATE);
        changed = true;
      }

      if (changed) {
        item.updated = new Date().toISOString();
        updated++;
        console.log(`✅ ${k} UPDATED RAW ¥${item.raw_jpy} PSA ¥${item.psa10_jpy}`);
      } else {
        console.log(`⚠️ ${k} no valid price (RAW:${rawPrice} PSA:${psaPrice})`);
      }

    } catch (e) {
      console.log(`❌ ${k} error ${e.message}`);
    }
    await page.waitForTimeout(2000);
  }

  await browser.close();
  if (updated > 0) {
    await putPrices(data);
    console.log(`🎉 Done updated ${updated} items`);
  } else {
    console.log('No update - keeping old prices');
  }
}
main();
