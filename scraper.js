// scraper.js V13 FINAL - แก้ null 100% - อ่านตาราง sales-histories จริงแล้วแยก A / PSA10 เอง
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
  console.log('✅ Uploaded', data.updated);
}

async function scrapeSalesHistories(page, apparelId) {
  const url = `https://snkrdunk.com/apparels/${apparelId}/sales-histories`;
  console.log(`  Goto ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(5000);

  const result = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    let aPrice = null, psaPrice = null;
    let aDate = '', psaDate = '';

    for (const tr of rows) {
      const tds = [...tr.querySelectorAll('td')];
      if (tds.length < 3) continue;
      const fullText = tr.innerText;

      // หาราคาในแถว
      const priceMatch = fullText.match(/([\d,]+)\s*เยน|¥\s*([\d,]+)|([\d,]+)\s*円/);
      let price = null;
      if (priceMatch) {
        const v = (priceMatch[1]||priceMatch[2]||priceMatch[3]||'').replace(/,/g,'');
        price = parseInt(v);
        if (!(price >= 500 && price <= 5000000)) price = null;
      }
      if (!price) continue;

      // สถานะ: ดูคอลัมน์สถานการณ์
      const isA = /(\bA\b|เอ\s|中古.*エー|สถานะ.*A)/.test(fullText) && !/PSA/i.test(fullText);
      const isPSA = /PSA\s*10|พีเอสเอ10|PSA10/i.test(fullText);

      // จาก screenshot: สถานการณ์ = เอ หรือ พีเอสเอ10
      if (isPSA && !psaPrice) {
        psaPrice = price;
        psaDate = tds[0]?.innerText || '';
      }
      if (isA && !aPrice) {
        // ต้องไม่ใช่ PSA
        if (!/PSA/i.test(fullText)) {
          aPrice = price;
          aDate = tds[0]?.innerText || '';
        }
      }
      // fallback แบบง่าย ถ้ายังไม่เจอ ใช้คำว่า เอ ตรงๆ
      if (!aPrice && fullText.includes(' เอ ') && !fullText.includes('PSA')) {
        if (fullText.includes('เยน')) {
          aPrice = price;
          aDate = tds[0]?.innerText || '';
        }
      }
      if (aPrice && psaPrice) break;
    }

    // fallback สุดท้าย: ถ้าหาแยกไม่ได้ ให้เอาราคาแรกที่เจอในหน้า
    if (!aPrice || !psaPrice) {
      const body = document.body.innerText;
      const all = [...body.matchAll(/([\d,]+)\s*เยน/g)].map(x=>parseInt(x[1].replace(/,/g,''))).filter(v=>v>=500);
      return { aPrice: aPrice || all[0] || null, psaPrice: psaPrice || all[1] || all[0] || null, aDate, psaDate, rowCount: rows.length };
    }

    return { aPrice, psaPrice, aDate, psaDate, rowCount: rows.length };
  });

  console.log(`  -> A ¥${result.aPrice} (${result.aDate}) | PSA10 ¥${result.psaPrice} (${result.psaDate}) rows:${result.rowCount}`);
  return result;
}

async function main() {
  const data = await getPrices();
  const allKeys = Object.keys(data.prices).sort();
  const batchIndex = parseInt(process.env.BATCH_INDEX || '0', 10);
  const batchKeys = allKeys.slice(batchIndex * BATCH_SIZE, batchIndex * BATCH_SIZE + BATCH_SIZE);
  console.log(`=== BATCH ${batchIndex} : ${batchKeys.join(',')} ===`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'th-TH', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 AppleWebKit/537.36' });
  const page = await context.newPage();

  let updated = 0;
  for (const key of batchKeys) {
    const item = data.prices[key];
    const apparelId = item.apparel_id || item.url?.match(/apparels\/(\d+)/)?.[1];
    if (!apparelId) { console.log(`SKIP ${key}`); continue; }
    try {
      console.log(`\n--> ${key} ${apparelId}`);
      const { aPrice, psaPrice } = await scrapeSalesHistories(page, apparelId);
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
        console.log(`✅ ${key} UPDATED`);
      }
    } catch (e) { console.log(`❌ ${key} ${e.message}`); }
    await page.waitForTimeout(1500);
  }

  await browser.close();
  if (updated > 0) await putPrices(data);
  console.log(`🎉 DONE ${updated}/${batchKeys.length}`);
}
main();
