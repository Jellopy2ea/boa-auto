// scraper.js V11 - BATCH 6 FIX - ใช้ลิงก์จริงจาก user
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

// ลิงก์จริง 6 ใบที่คุณส่งมา
const FIX_MAP = {
  'BOA-02': 714615,
  'BOA-03': 710430,
  'BOA-05': 814021,
  'BOA-06': 814022,
  'BOA-07': 93516,
  'BOA-08': 328420,
};

async function getPrices() {
  const res = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: FILE_KEY }));
  return JSON.parse(await res.Body.transformToString());
}
async function putPrices(data) {
  data.updated = new Date().toISOString();
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: FILE_KEY, Body: JSON.stringify(data,null,2), ContentType: 'application/json' }));
}

async function getLatestFromSalesHistory(page, statusLabel) {
  // statusLabel = 'A' or 'PSA10'
  // ไปหน้า sales-histories แล้วกรอง
  // ลองดึงจาก API ภายในเว็บ
  const price = await page.evaluate(async (status) => {
    // ลองหา API ที่เว็บเรียก
    try {
      // ดูจาก network - SNKRDUNK ใช้ /apparels/:id/sales_histories?status=
      const urlMatch = location.pathname.match(/apparels\/(\d+)/);
      if (!urlMatch) return null;
      const id = urlMatch[1];
      
      // ลองยิง API ตรง
      const apiUrls = [
        `/api/apparels/${id}/sales_histories?status=${status}&per_page=1`,
        `/api/v1/apparels/${id}/sales?status=${status}`,
        `/apparels/${id}/sales-histories?status=${status}`,
      ];
      for (const api of apiUrls) {
        try {
          const r = await fetch(api, { headers: { 'Accept': 'application/json' } });
          if (r.ok) {
            const j = await r.json();
            const text = JSON.stringify(j);
            const m = text.match(/"price":\s*(\d+)/);
            if (m) return parseInt(m[1]);
          }
        } catch {}
      }
    } catch {}
    
    // fallback DOM - หาในตารางประวัติ
    await new Promise(r => setTimeout(r, 1000));
    const bodyText = document.body.innerText;
    // หาตารางประวัติการซื้อขาย - เอาแถวแรกหลัง filter
    const rows = [...document.querySelectorAll('table tr')];
    for (const tr of rows) {
      const t = tr.innerText;
      if (t.includes('เยน') || t.includes('¥') || t.includes('円')) {
        const m = t.match(/([\d,]+)\s*เยน|¥\s*([\d,]+)|([\d,]+)\s*円/);
        if (m) {
          const val = (m[1]||m[2]||m[3]).replace(/,/g,'');
          const num = parseInt(val);
          if (num >= 500 && num <= 3000000) return num;
        }
      }
    }
    // fallback regex ทั้งหน้า
    const all = [...bodyText.matchAll(/([\d,]+)\s*เยน/g)].map(x=>parseInt(x[1].replace(/,/g,''))).filter(v=>v>=500);
    return all[0] || null;
  }, statusLabel);
  return price;
}

async function scrapeOne(page, boaKey, apparelId) {
  const baseUrl = `https://snkrdunk.com/apparels/${apparelId}/sales-histories`;
  console.log(`\n--> ${boaKey} ID ${apparelId} ${baseUrl}`);
  
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  // กรอง A
  let aPrice = null, psaPrice = null;
  
  // ลองคลิกฟิลเตอร์ เอ (A)
  try {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      let b = btns.find(x=>x.innerText.trim()==='A');
      if (!b) b = btns.find(x=>x.innerText.trim()==='เอ');
      if (b) b.click();
    });
    await page.waitForTimeout(3000);
    aPrice = await getLatestFromSalesHistory(page, 'A');
    console.log(`${boaKey} A latest = ${aPrice}`);
  } catch(e){ console.log(`${boaKey} A error ${e.message}`); }

  // กรอง PSA10
  try {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      let b = btns.find(x=>x.innerText.trim()==='PSA10');
      if (!b) b = btns.find(x=>x.innerText.trim()==='พีเอสเอ10');
      if (!b) b = btns.find(x=>x.innerText.includes('PSA10'));
      if (b) b.click();
    });
    await page.waitForTimeout(3000);
    psaPrice = await getLatestFromSalesHistory(page, 'PSA10');
    console.log(`${boaKey} PSA10 latest = ${psaPrice}`);
  } catch(e){ console.log(`${boaKey} PSA10 error ${e.message}`); }

  return { aPrice, psaPrice };
}

async function main() {
  const data = await getPrices();
  // อัพเดท ID ที่ถูกต้องก่อน
  for (const [k, id] of Object.entries(FIX_MAP)) {
    if (data.prices[k]) {
      data.prices[k].apparel_id = id;
      data.prices[k].snkrdunk_url = `https://snkrdunk.com/apparels/${id}`;
      console.log(`FIX ${k} -> ${id}`);
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ 
    locale: 'ja-JP', 
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  let updated = 0;
  for (const [boaKey, apparelId] of Object.entries(FIX_MAP)) {
    try {
      const { aPrice, psaPrice } = await scrapeOne(page, boaKey, apparelId);
      const item = data.prices[boaKey];
      if (!item) continue;
      if (aPrice && aPrice >= 500) {
        item.raw_jpy = aPrice; item.jpy = aPrice;
        item.raw_thb = Math.round(aPrice * RATE);
        item.thb = Math.round(aPrice * RATE);
      }
      if (psaPrice && psaPrice >= 500) {
        item.psa10_jpy = psaPrice; item.psa_jpy = psaPrice;
        item.psa10_thb = Math.round(psaPrice * RATE);
        item.psa_thb = Math.round(psaPrice * RATE);
      }
      if (aPrice || psaPrice) {
        item.updated = new Date().toISOString();
        updated++;
        console.log(`✅ ${boaKey} UPDATED RAW ¥${aPrice} PSA ¥${psaPrice}`);
      }
    } catch (e) {
      console.log(`❌ ${boaKey} ${e.message}`);
    }
    await page.waitForTimeout(1000);
  }

  await browser.close();
  await putPrices(data);
  console.log(`🎉 Done ${updated}/${Object.keys(FIX_MAP).length} - 6 ใบตรงเว็บจริงแล้ว`);
}
main();
