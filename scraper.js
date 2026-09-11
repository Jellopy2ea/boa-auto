// scraper.js V15 API BYPASS - ไม่เปิดหน้าเว็บแล้ว ยิง API ตรง
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
  console.log('✅ Uploaded');
}

async function fetchSales(apparelId) {
  // ลองหลาย endpoint ที่ SNKRDUNK ใช้จริง
  const endpoints = [
    `https://snkrdunk.com/api/v1/apparels/${apparelId}/sales_histories?status=&page=1`,
    `https://snkrdunk.com/api/v2/apparels/${apparelId}/sales?limit=20`,
    `https://snkrdunk.com/api/apparels/${apparelId}/transactions`,
    `https://snkrdunk.com/apparels/${apparelId}/sales-histories.json`,
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'application/json',
          'Accept-Language': 'th-TH,th;q=0.9,ja;q=0.8,en;q=0.7',
          'Referer': `https://snkrdunk.com/apparels/${apparelId}/`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      const text = await res.text();
      if (text.includes('sales') || text.includes('price') || text.includes('transactions') || text.length > 500) {
        console.log(`  API ${ep} -> ${res.status} len ${text.length}`);
        try {
          const json = JSON.parse(text);
          return json;
        } catch {
          // ถ้าไม่ใช่ JSON แต่เป็น HTML ที่มีข้อมูล
          if (text.includes('เยน') || text.includes('¥')) return { rawHtml: text };
        }
      }
    } catch (e) {
      console.log(`  API ${ep} error ${e.message}`);
    }
  }

  // fallback สุดท้าย: ดึงหน้าปกติแล้วหาข้อมูลใน __NEXT_DATA__
  try {
    const res = await fetch(`https://snkrdunk.com/apparels/${apparelId}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'th-TH',
      }
    });
    const html = await res.text();
    console.log(`  Fallback page len ${html.length}`);
    // หา next data
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (m) {
      const json = JSON.parse(m[1]);
      return json;
    }
    return { rawHtml: html };
  } catch (e) {
    console.log(`  fallback error ${e.message}`);
  }
  return null;
}

function parseFromAny(data) {
  let aPrice = null, psaPrice = null;
  const str = JSON.stringify(data).substring(0, 20000);

  // หา pattern แบบที่ SNKRDUNK ส่งมา
  // ตัวอย่าง: {"status":"A","price":4400} , {"status":"PSA10","price":14400}
  const regex = /"status"\s*:\s*"(A|PSA10)"[^}]*?"price"\s*:\s*(\d+)/gi;
  const regex2 = /"condition"\s*:\s*"(A|PSA10)"[^}]*?(\d{3,6})/gi;
  
  let m;
  while ((m = regex.exec(str)) !== null) {
    const status = m[1];
    const price = parseInt(m[2]);
    if (status === 'A' && !aPrice) aPrice = price;
    if (status === 'PSA10' && !psaPrice) psaPrice = price;
  }

  // ถ้ายังไม่เจอ ลองหาแบบไทย
  if (!aPrice || !psaPrice) {
    const text = data.rawHtml || str;
    const lines = text.split(/[\\n{}]+/);
    for (const line of lines) {
      if (line.includes('เยน')) {
        const pm = line.match(/([\d,]+)\s*เยน/);
        if (pm) {
          let p = parseInt(pm[1].replace(/,/g,''));
          if (line.includes('PSA') || line.includes('พีเอสเอ')) {
            if (!psaPrice) psaPrice = p;
          } else {
            if (!aPrice) aPrice = p;
          }
        }
      }
    }
  }

  // สุดท้ายถ้าเจอแค่ราคาเดียวให้ใช้ทั้งคู่ไปก่อน
  if (aPrice && !psaPrice) psaPrice = aPrice;
  if (psaPrice && !aPrice) aPrice = psaPrice;

  return { aPrice, psaPrice };
}

async function main() {
  const data = await getPrices();
  const allKeys = Object.keys(data.prices).sort();
  const batchIndex = parseInt(process.env.BATCH_INDEX || '0', 10);
  const batchKeys = allKeys.slice(batchIndex * BATCH_SIZE, batchIndex * BATCH_SIZE + BATCH_SIZE);
  console.log(`=== BATCH ${batchIndex} : ${batchKeys.join(',')} ===`);

  let updated = 0;
  for (const key of batchKeys) {
    const item = data.prices[key];
    const apparelId = item.apparel_id || item.url?.match(/apparels\/(\d+)/)?.[1];
    if (!apparelId) { console.log(`SKIP ${key}`); continue; }
    console.log(`\n--> ${key} ${apparelId}`);
    const salesData = await fetchSales(apparelId);
    if (!salesData) { console.log(`  ❌ no data`); continue; }
    const { aPrice, psaPrice } = parseFromAny(salesData);
    console.log(`  -> RESULT A ¥${aPrice} | PSA10 ¥${psaPrice}`);
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
    }
    await new Promise(r=>setTimeout(r, 1500));
  }

  if (updated>0) await putPrices(data);
  console.log(`🎉 DONE ${updated}/${batchKeys.length}`);
}
main();
