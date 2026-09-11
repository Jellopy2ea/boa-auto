// scraper.js V14 FINAL FIX - แก้ Timeout + null
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

async function scrapeOne(page, apparelId) {
  const url = `https://snkrdunk.com/apparels/${apparelId}/sales-histories`;
  console.log(`Goto ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000); // รอให้ JS โหลดประวัติ

  const result = await page.evaluate(() => {
    const text = document.body.innerText;
    // ดูตารางทั้งหมด
    const rows = [...document.querySelectorAll('tr')];
    const debugRows = rows.slice(0,10).map(r=>r.innerText.substring(0,150));

    let aPrice = null, psaPrice = null;
    
    // วิธีใหม่: หาเลขราคา + คำว่า A / PSA จากทั้งหน้า
    // จาก screenshot ที่คุณส่ง: "เอ 4,400 เยน" "พีเอสเอ10 14,400 เยน"
    const lines = text.split('\n');
    for (const line of lines) {
      const priceMatch = line.match(/([\d,]{3,})\s*เยน|¥\s*([\d,]+)/);
      if (!priceMatch) continue;
      let priceStr = (priceMatch[1]||priceMatch[2]||'').replace(/,/g,'');
      let price = parseInt(priceStr);
      if (!(price >= 300 && price <= 10000000)) continue;

      if (!psaPrice && /PSA\s*10|พีเอสเอ\s*10|PSA10/i.test(line)) {
        psaPrice = price;
      }
      if (!aPrice && (/^\s*เอ\s/.test(line) || / สถานการณ์.*เอ /i.test(line) || (line.includes(' เอ ') && !line.includes('PSA')))) {
        // ต้องไม่ใช่ PSA
        if (!/PSA/i.test(line)) aPrice = price;
      }
    }

    // fallback: ถ้ายังไม่ได้ ให้เอา 2 ราคาแรกที่เจอในตาราง sales
    if (!aPrice || !psaPrice) {
      const tablePrices = [];
      for (const tr of rows) {
        const m = tr.innerText.match(/([\d,]+)\s*เยน/);
        if (m) {
          let p = parseInt(m[1].replace(/,/g,''));
          if (p>=300) tablePrices.push({ price:p, text:tr.innerText });
        }
      }
      // สมมติแถวแรกคือล่าสุด ถ้ามี PSA ในแถวนั้น
      for (const item of tablePrices) {
        if (!psaPrice && /PSA|พีเอสเอ/i.test(item.text)) psaPrice = item.price;
        if (!aPrice && !/PSA/i.test(item.text)) aPrice = item.price;
        if (aPrice && psaPrice) break;
      }
      if (!aPrice && tablePrices[0]) aPrice = tablePrices[0].price;
      if (!psaPrice && tablePrices[1]) psaPrice = tablePrices[1].price;
      if (!psaPrice) psaPrice = aPrice;
    }

    return { aPrice, psaPrice, debugRows, bodySnippet: text.substring(0,1000) };
  });

  console.log(`  -> RESULT A ¥${result.aPrice} | PSA10 ¥${result.psaPrice}`);
  console.log(`  Debug first rows:`, result.debugRows?.slice(0,2));
  return result;
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
  const page = await context.newPage();

  let updated = 0;
  for (const key of batchKeys) {
    const item = data.prices[key];
    const apparelId = item.apparel_id || item.url?.match(/apparels\/(\d+)/)?.[1];
    if (!apparelId) { console.log(`SKIP ${key} no apparel_id`); continue; }
    try {
      console.log(`\n--> ${key} ${apparelId}`);
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
        console.log(`✅ ${key} UPDATED RAW ¥${aPrice} PSA ¥${psaPrice}`);
      }
    } catch (e) {
      console.log(`❌ ${key} ${e.message}`);
    }
    await page.waitForTimeout(2000);
  }

  await browser.close();
  if (updated > 0) await putPrices(data);
  console.log(`🎉 DONE ${updated}/${batchKeys.length}`);
}
main();
