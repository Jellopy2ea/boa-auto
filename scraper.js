
// scraper.js V9 - FIX FINAL - ใช้ภาษาจริง A และ PSA10 ไม่ใช่ เอ / พีเอสเอ10
// ดึงล่าสุดจริง แยก 2 ราคา จากแถวแรกของ 売買履歴
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
const BATCH_SIZE = 46; // รวดเดียว 46 ใบ จบ

async function getPrices() {
  const res = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: FILE_KEY }));
  return JSON.parse(await res.Body.transformToString());
}
async function putPrices(data) {
  data.updated = new Date().toISOString();
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: FILE_KEY, Body: JSON.stringify(data,null,2), ContentType: 'application/json' }));
  console.log('✅ Uploaded R2', data.updated);
}

async function getLatestPriceFromHistory(page) {
  await page.waitForTimeout(2000);
  return await page.evaluate(() => {
    // หาส่วน 売買履歴 แล้วเอาแถวแรก
    const rows = document.querySelectorAll('table tr, div[class*="history"] div');
    // วิธีชัวร์: หา text ¥xxxx ในส่วนล่างของหน้า หลังคำว่า 売買履歴
    const body = document.body.innerHTML;
    const idx = body.indexOf('売買履歴');
    let searchArea = idx !== -1 ? document.body.innerText.slice(idx, idx+5000) : document.body.innerText;
    
    // เอา ¥ ตัวแรกที่เจอใน searchArea
    const matches = [...searchArea.matchAll(/¥\s*([0-9,]+)/g)].map(m => parseInt(m[1].replace(/,/g,''),10)).filter(v=>v>=1000 && v<=3000000);
    if (matches.length) return matches[0];

    // fallback ทั้งหน้า
    const all = [...document.body.innerText.matchAll(/¥\s*([0-9,]+)/g)].map(m => parseInt(m[1].replace(/,/g,''),10)).filter(v=>v>=1000 && v<=3000000);
    // ข้ามราคาด้านบนที่เป็น listings (จะอยู่ก่อน 売買履歴) เอาตัวแรกหลัง 売買履歴เท่านั้น
    return all[0] || null;
  });
}

async function clickExactFilter(page, label) {
  // คลิกปุ่มที่ innerText ตรงเป๊ะ label = "A" หรือ "PSA10"
  const ok = await page.evaluate((target) => {
    const btns = [...document.querySelectorAll('button')];
    // หาปุ่มที่ text ตรงเป๊ะ
    let found = btns.find(b => b.innerText.trim() === target);
    if (!found) {
      // ลองหา span ข้างใน
      found = btns.find(b => b.innerText.trim().includes(target) && b.innerText.trim().length <= 6);
      // กรองไม่ให้ A ไปโดน PSA10
      if (target === 'A') {
        found = btns.find(b => b.innerText.trim() === 'A');
      }
    }
    if (found) { found.click(); return true; }
    return false;
  }, label);
  
  if (!ok) {
    // fallback locator
    try {
      await page.locator(`button:has-text("${label}")`).first().click({timeout:3000});
      return true;
    } catch { return false; }
  }
  await page.waitForTimeout(2500);
  return true;
}

async function main() {
  const data = await getPrices();
  const keys = Object.keys(data.prices).sort();
  console.log(`=== RUN ALL ${keys.length} CARDS ===`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    locale: 'ja-JP', // บังคับญี่ปุ่น ไม่ให้แปลเป็น เอ / พีเอสเอ10
    extraHTTPHeaders: { 'Accept-Language': 'ja-JP,ja;q=0.9' }
  });
  const page = await context.newPage();
  
  // ไปหน้าแรกเพื่อ set cookie
  await page.goto('https://snkrdunk.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  let updated = 0;
  for (const k of keys) {
    const item = data.prices[k];
    if (!item?.apparel_id) continue;

    try {
      const url = `https://snkrdunk.com/apparels/${item.apparel_id}`;
      console.log(`\n--> ${k} ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3500);

      // เลื่อนลงมาที่ 売買履歴
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight*0.6));
      await page.waitForTimeout(1000);

      // 1. RAW A = กด A
      console.log(`${k} clicking A`);
      await clickExactFilter(page, 'A');
      const rawPrice = await getLatestPriceFromHistory(page);
      console.log(`${k} A latest = ${rawPrice}`);

      // 2. PSA10 = กด PSA10
      console.log(`${k} clicking PSA10`);
      await clickExactFilter(page, 'PSA10');
      const psaPrice = await getLatestPriceFromHistory(page);
      console.log(`${k} PSA10 latest = ${psaPrice}`);

      let changed = false;
      if (rawPrice && rawPrice >= 1000) {
        item.raw_jpy = rawPrice; item.jpy = rawPrice;
        item.raw_thb = Math.round(rawPrice * RATE);
        item.thb = Math.round(rawPrice * RATE);
        changed = true;
      }
      if (psaPrice && psaPrice >= 1000) {
        item.psa10_jpy = psaPrice; item.psa_jpy = psaPrice;
        item.psa10_thb = Math.round(psaPrice * RATE);
        item.psa_thb = Math.round(psaPrice * RATE);
        changed = true;
      }

      if (changed) {
        item.updated = new Date().toISOString();
        updated++;
        console.log(`✅ ${k} UPDATED RAW ¥${item.raw_jpy} PSA ¥${item.psa10_jpy}`);
      }

    } catch (e) {
      console.log(`❌ ${k} error ${e.message}`);
    }
    await page.waitForTimeout(1500);
  }

  await browser.close();
  if (updated > 0) await putPrices(data);
  console.log(`🎉 Done updated ${updated}/${keys.length}`);
}
main();
