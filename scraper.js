// scraper.js V5 FINAL - อ่านราคาจริงจาก DOM แบบตาเห็น ไม่พึ่ง API ที่โดนบล็อค
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
const BATCH_SIZE = 4; // ลดเหลือ 4 ใบต่อรอบ ช้าแต่ชัวร์

async function getPrices() {
  const res = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: FILE_KEY }));
  return JSON.parse(await res.Body.transformToString());
}
async function putPrices(data) {
  data.updated = new Date().toISOString();
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: FILE_KEY, Body: JSON.stringify(data,null,2), ContentType: 'application/json' }));
  console.log('✅ Uploaded to R2:', data.updated);
}

async function getRealPriceFromPage(page) {
  // รอหน้าโหลด
  await page.waitForTimeout(4000);
  
  // ลองหลาย selector
  const price = await page.evaluate(() => {
    const texts = [];
    // หาทุก element ที่อาจมีราคา
    const all = document.body.innerText;
    // หา ¥ ทั้งหมด
    const matches = [...all.matchAll(/¥\s*([0-9,]{4,6})/g)];
    const nums = matches.map(m => parseInt(m[1].replace(/,/g,''),10)).filter(v=>v>=1000 && v<=200000);
    
    if (nums.length === 0) return null;
    
    // ในหน้า sales-histories ราคาจะเรียงจากใหม่ไปเก่า เอา 10 อันแรก
    // กรองเอาราคาที่ซ้ำๆ ที่เป็นราคาขายจริง ไม่ใช่ราคาตั้งขาย
    // วิธี: เอา median ของ 5 อันแรก หรือต่ำสุดของ 5 อันแรก
    const recent = nums.slice(0, 10);
    // ถ้ามีราคาหลากหลาย ให้เอาตัวที่พบบ่อยหรือต่ำสุด
    const lowest = Math.min(...recent);
    const avg = recent.reduce((a,b)=>a+b,0)/recent.length;
    
    console.log('Found nums:', recent, 'lowest', lowest, 'avg', avg);
    
    // ถ้าต่ำสุดต่างจากเฉลี่ยมากเกิน (เช่น 1000 กับ 6000) ให้เอา median แทน
    // แต่สำหรับ BOA ส่วนใหญ่ ต่ำสุดคือราคาจริง
    return lowest;
  });
  
  return price;
}

async function main() {
  const data = await getPrices();
  const keys = Object.keys(data.prices).sort();
  const totalBatches = Math.ceil(keys.length / BATCH_SIZE);
  const batchIdx = new Date().getUTCHours() % totalBatches;
  // ใช้ Date แบบนาทีด้วยเพื่อให้วนครบเร็วขึ้น
  const minuteFactor = Math.floor(new Date().getUTCMinutes() / 15);
  const realIdx = (batchIdx * 4 + minuteFactor) % totalBatches;
  const batch = keys.slice(realIdx * BATCH_SIZE, realIdx * BATCH_SIZE + BATCH_SIZE);
  
  console.log(`=== BATCH ${realIdx+1}/${totalBatches}: ${batch.join(', ')} ===`);
  console.log(`Total keys: ${keys.length}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    locale: 'ja-JP',
    extraHTTPHeaders: {
      'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
      'Referer': 'https://snkrdunk.com/'
    }
  });
  const page = await context.newPage();
  
  // ไปหน้าแรกก่อนเพื่อเอา cookie + ผ่าน Cloudflare
  console.log('Getting cookies from snkrdunk...');
  await page.goto('https://snkrdunk.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  let updated = 0;
  for (const k of batch) {
    const item = data.prices[k];
    if (!item) continue;
    
    const apparelId = item.apparel_id;
    if (!apparelId) {
      console.log(`${k} no apparel_id skip`);
      continue;
    }

    // BOA-02 ล็อคไว้แล้ว ห้ามทับ
    if (k === 'BOA-02' && item.raw_jpy === 6000 && item.psa10_jpy === 12900) {
      console.log(`${k} locked at 6000/12900 - skip`);
      continue;
    }

    try {
      const url = item.url || `https://snkrdunk.com/apparels/${apparelId}/sales-histories`;
      console.log(`\n--> ${k} goto ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(5000);

      // เช็คว่าโดนบล็อคไหม
      const title = await page.title();
      console.log(`${k} title: ${title}`);
      if (title.includes('Access') || title.includes('Cloudflare') || title.includes('Just a moment')) {
        console.log(`${k} blocked by Cloudflare, waiting...`);
        await page.waitForTimeout(10000);
      }

      const realPrice = await getRealPriceFromPage(page);
      console.log(`${k} REAL SCRAPED: ${realPrice} | OLD: ${item.raw_jpy}`);

      if (!realPrice || realPrice < 1000 || realPrice === 1000 || realPrice === 3000) {
        console.log(`${k} skip - no valid price (got ${realPrice})`);
        continue;
      }

      // ป้องกันราคากระโดดเกิน 3 เท่า (ถ้าเคยมีราคาจริงแล้ว)
      if (item.raw_jpy > 1500 && item.raw_jpy !== 3000) {
        if (realPrice > item.raw_jpy * 3 || realPrice < item.raw_jpy * 0.33) {
          console.log(`${k} skip - jump too big ${item.raw_jpy} -> ${realPrice}`);
          continue;
        }
      }

      // อัพเดท
      const oldRaw = item.raw_jpy;
      item.raw_jpy = realPrice;
      item.jpy = realPrice;
      item.raw_thb = Math.round(realPrice * RATE);
      item.thb = Math.round(realPrice * RATE);

      // PSA10 - ถ้ามี id แยกก็ดึงแยก ถ้าไม่มีให้คำนวณ
      if (item.apparel_id_psa10 && item.apparel_id_psa10 !== apparelId) {
        const psaUrl = `https://snkrdunk.com/apparels/${item.apparel_id_psa10}/sales-histories`;
        await page.goto(psaUrl, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(5000);
        const psaReal = await getRealPriceFromPage(page);
        if (psaReal && psaReal >= 1000) {
          item.psa10_jpy = psaReal;
          item.psa10_thb = Math.round(psaReal * RATE);
          console.log(`${k} PSA updated to ${psaReal}`);
        }
      } else {
        // คำนวณ PSA จาก RAW
        let ratio = 2.15;
        if (item.psa10_jpy && item.psa10_jpy !== 3000 && item.raw_jpy) {
          const oldRatio = item.psa10_jpy / (oldRaw || realPrice);
          if (oldRatio >= 1.4 && oldRatio <= 4) ratio = oldRatio;
        }
        item.psa10_jpy = Math.round(realPrice * ratio);
        item.psa10_thb = Math.round(item.psa10_jpy * RATE);
      }
      
      item.psa_jpy = item.psa10_jpy;
      item.psa_thb = item.psa10_thb;
      item.updated = new Date().toISOString();
      updated++;
      console.log(`✅ UPDATED ${k}: RAW ¥${item.raw_jpy} (฿${item.raw_thb}) PSA ¥${item.psa10_jpy} (฿${item.psa10_thb})`);

    } catch (e) {
      console.log(`❌ ${k} error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 4000));
  }

  await browser.close();

  if (updated > 0) {
    await putPrices(data);
    console.log(`\n🎉 Done! Updated ${updated} items`);
  } else {
    console.log(`\n⚠️ No update this batch - keeping old prices. Will retry next 15 min`);
    // ไม่อัพโหลดถ้าไม่มีอะไรเปลี่ยน เพื่อไม่ให้ทับราคาดีๆ ด้วย 1000
  }
}

main();
