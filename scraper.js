// scraper.js V12 FINAL - ใช้ url ที่มีใน boa-prices.json ทุกใบอยู่แล้ว
// แก้ปัญหา: กดปุ่มไม่ติด => ใช้ ?status=A / ?status=PSA10 โดยตรง และดึงแถวแรกของประวัติ
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
const BATCH_SIZE = 6; // ทำทีละ 6 ใบตามที่คุณขอ 2.5 นาทีจบ

async function getPrices() {
  const res = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: FILE_KEY }));
  return JSON.parse(await res.Body.transformToString());
}
async function putPrices(data) {
  data.updated = new Date().toISOString();
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: FILE_KEY, Body: JSON.stringify(data,null,2), ContentType: 'application/json' }));
  console.log('✅ Uploaded', data.updated);
}

async function getLatestByStatus(page, apparelId, status) {
  // status = 'A' or 'PSA10'
  const url = `https://snkrdunk.com/apparels/${apparelId}/sales-histories?status=${status}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  // ถ้าเว็บ redirect กลับหน้า apparel หลัก ให้ลองคลิก filter อีกที
  const price = await page.evaluate(async (targetStatus) => {
    // 1. พยายามดึงจาก DOM ประวัติการซื้อขาย
    const findPriceInRow = (rowText) => {
      const m = rowText.match(/([\d,]+)\s*เยน|¥\s*([\d,]+)|([\d,]+)\s*円/);
      if (m) {
        const v = (m[1]||m[2]||m[3]).replace(/,/g,'');
        return parseInt(v);
      }
      return null;
    };

    // หาตารางประวัติ - ในหน้า sales-histories จะมี table
    const tables = document.querySelectorAll('table tr');
    for (const tr of tables) {
      const txt = tr.innerText;
      if (txt.includes('เอ') || txt.includes(targetStatus) || txt.includes('PSA10') || txt.includes('พีเอสเอ')) {
        const p = findPriceInRow(txt);
        if (p && p >= 500 && p <= 5000000) return p;
      }
    }
    // fallback ทั้งหน้า
    const body = document.body.innerText;
    const matches = [...body.matchAll(/([\d,]+)\s*เยน/g)].map(x=>parseInt(x[1].replace(/,/g,''))).filter(v=>v>=500 && v<=5000000);
    return matches[0] || null;
  }, status);

  console.log(`  ${status} latest = ${price} from ${url}`);
  return price;
}

async function main() {
  const data = await getPrices();
  const allKeys = Object.keys(data.prices).sort();
  
  // หา batch ปัจจุบันจากเวลา (สลับ 6 ใบทุก 15 นาที) หรือรันทั้งหมดถ้าต้องการ
  const batchIndex = parseInt(process.env.BATCH_INDEX || '0', 10); // 0-7
  const start = batchIndex * BATCH_SIZE;
  const batchKeys = allKeys.slice(start, start + BATCH_SIZE);
  console.log(`=== BATCH ${batchIndex+1}/${Math.ceil(allKeys.length/BATCH_SIZE)} : ${batchKeys.join(', ')} ===`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'th-TH',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  let updated = 0;
  for (const key of batchKeys) {
    const item = data.prices[key];
    const apparelId = item.apparel_id || (item.url?.match(/apparels\/(\d+)/)?.[1]);
    if (!apparelId) {
      console.log(`SKIP ${key} no apparel_id`);
      continue;
    }

    try {
      console.log(`\n--> ${key} ${apparelId}`);
      const aPrice = await getLatestByStatus(page, apparelId, 'A');
      await page.waitForTimeout(1000);
      const psaPrice = await getLatestByStatus(page, apparelId, 'PSA10');

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
      }
    } catch (e) {
      console.log(`❌ ${key} ${e.message}`);
    }
  }

  await browser.close();
  if (updated > 0) await putPrices(data);
  console.log(`🎉 BATCH DONE ${updated}/${batchKeys.length}`);
}
main();
