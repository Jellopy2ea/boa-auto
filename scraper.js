// scraper.js V5.1 FAST - เร็วขึ้น 2 นาที, ยังดึงจาก DOM จริง
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
const BATCH_SIZE = 5;

async function getPrices() {
  const res = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: FILE_KEY }));
  return JSON.parse(await res.Body.transformToString());
}
async function putPrices(data) {
  data.updated = new Date().toISOString();
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: FILE_KEY, Body: JSON.stringify(data,null,2), ContentType: 'application/json' }));
  console.log('✅ Uploaded:', data.updated);
}

async function getPrice(page) {
  await page.waitForTimeout(2500);
  return await page.evaluate(() => {
    const txt = document.body.innerText;
    const matches = [...txt.matchAll(/¥\s*([0-9,]{3,6})/g)];
    const nums = matches.map(m => parseInt(m[1].replace(/,/g,''),10)).filter(v=>v>=1500 && v<=200000);
    if (nums.length === 0) return null;
    // เอา 8 อันแรก หาต่ำสุด
    return Math.min(...nums.slice(0,8));
  });
}

async function main() {
  const data = await getPrices();
  const keys = Object.keys(data.prices).sort();
  const totalBatches = Math.ceil(keys.length / BATCH_SIZE);
  const now = new Date();
  // วน batch ตามชั่วโมง+นาที/15 จะได้ครบเร็ว
  const batchIdx = (now.getUTCHours()*4 + Math.floor(now.getUTCMinutes()/15)) % totalBatches;
  const batch = keys.slice(batchIdx * BATCH_SIZE, batchIdx * BATCH_SIZE + BATCH_SIZE);
  
  console.log(`BATCH ${batchIdx+1}/${totalBatches}: ${batch.join(', ')} - ${new Date().toISOString()}`);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    locale: 'ja-JP'
  });
  const page = await context.newPage();
  
  await page.goto('https://snkrdunk.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  let updated = 0;
  for (const k of batch) {
    const item = data.prices[k];
    if (!item?.apparel_id) continue;
    if (k === 'BOA-02' && item.raw_jpy === 6000) { console.log(`${k} locked skip`); continue; }

    try {
      const url = `https://snkrdunk.com/apparels/${item.apparel_id}/sales-histories`;
      console.log(`-> ${k} ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3000);

      let price = await getPrice(page);
      console.log(`${k} scraped=${price} old=${item.raw_jpy}`);

      if (!price || price===1000 || price===3000 || price<1500) {
        console.log(`${k} skip invalid`);
        continue;
      }
      // กันราคากระโดดเกิน 2.5 เท่า
      if (item.raw_jpy > 1500 && item.raw_jpy !== 3000) {
        if (price > item.raw_jpy * 2.8 || price < item.raw_jpy * 0.35) {
          console.log(`${k} skip jump ${item.raw_jpy}->${price}`);
          continue;
        }
      }

      item.raw_jpy = price;
      item.jpy = price;
      item.raw_thb = Math.round(price * RATE);
      item.thb = Math.round(price * RATE);

      // PSA10 = RAW * 2.15 ถ้าไม่มี id แยก
      const ratio = (item.psa10_jpy && item.psa10_jpy !== 3000) ? (item.psa10_jpy / (item.raw_jpy||price)) : 2.15;
      const useRatio = (ratio>=1.4 && ratio<=4) ? ratio : 2.15;
      item.psa10_jpy = Math.round(price * useRatio);
      item.psa10_thb = Math.round(item.psa10_jpy * RATE);
      item.psa_jpy = item.psa10_jpy;
      item.psa_thb = item.psa10_thb;
      item.updated = new Date().toISOString();
      updated++;
      console.log(`✅ ${k} UPDATED RAW ¥${price} PSA ¥${item.psa10_jpy}`);
    } catch (e) {
      console.log(`❌ ${k} ${e.message}`);
    }
    await page.waitForTimeout(1500);
  }

  await browser.close();
  if (updated>0) {
    await putPrices(data);
    console.log(`🎉 Updated ${updated} items`);
  } else {
    console.log('No update - will keep old prices');
  }
}
main();
