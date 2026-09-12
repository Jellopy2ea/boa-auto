// scraper.js V27 FINAL - Hardcode 10 ใบแรก 100% AUTO
// ไม่ใส่ราคาเอง ให้เบราว์เซอร์ยิง v3 จริง
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { chromium } from 'playwright';

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY }
});
const BUCKET = process.env.R2_BUCKET || 'cardmatem-raw';
const FILE_KEY = 'boa-prices.json';
const RATE = 0.245;

// Hardcode 10 ใบแรกจากลิงค์ F12 ที่ผู้ใช้ให้มา - หลักการ BOA-05/06
const HARDCODE_MAP = {
  // BOA-01
  '713690': { productId: '824552', variantId: '9534253', key: 'BOA-01' },
  // BOA-02
  '714615': { productId: '826001', variantId: '9549494', key: 'BOA-02' },
  // BOA-03
  '710430': { productId: '820628', variantId: '9509094', key: 'BOA-03' },
  // BOA-05
  '814021': { productId: '940195', variantId: '10369683', key: 'BOA-05' },
  // BOA-06
  '814022': { productId: '940196', variantId: '10369693', key: 'BOA-06' },
  // BOA-07
  '93516': { productId: '169690', variantId: '1894048', key: 'BOA-07' },
  // BOA-08
  '328420': { productId: '404582', variantId: '3289698', key: 'BOA-08' },
  // BOA-09
  '94889': { productId: '171062', variantId: '1898920', key: 'BOA-09' },
  // BOA-10
  '126178': { productId: '202361', variantId: '2037236', key: 'BOA-10' },
};

async function getPrices() {
  const res = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: FILE_KEY }));
  return JSON.parse(await res.Body.transformToString());
}
async function putPrices(data) {
  data.updated = new Date().toISOString();
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: FILE_KEY, Body: JSON.stringify(data,null,2), ContentType: 'application/json' }));
  console.log('✅ Uploaded R2');
}

async function scrapeOne(browser, apparelId) {
  const map = HARDCODE_MAP[apparelId];
  if (!map) return { rawA: null, psa10: null };
  const { productId, variantId, key } = map;
  console.log(`\n=== ${key} apparel=${apparelId} product=${productId} variant=${variantId} ===`);
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    locale: 'ja-JP'
  });
  const page = await context.newPage();
  
  try {
    // เปิดหน้า apparels เพื่อให้ได้ cookie Cloudflare
    await page.goto(`https://snkrdunk.com/apparels/${apparelId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // ยิง v3 ในเบราว์เซอร์จริง - หลักการ BOA-05/06 100% AUTO ไม่ใส่ราคาเอง
    const prices = await page.evaluate(async ({ productId, variantId }) => {
      const fetchPrice = async (code) => {
        try {
          const url = `https://snkrdunk.com/v3/products/${productId}/trading-history?range=all&condition_code=${code}&variant_id=${variantId}`;
          const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
          if (!res.ok) return { price: null, status: res.status };
          const json = await res.json();
          const price = json.trades && json.trades[0] ? json.trades[0].price : null;
          return { price, count: json.trades?.length || 0, status: res.status };
        } catch (e) {
          return { price: null, error: e.message };
        }
      };
      const rawA = await fetchPrice('trading_card_single_nearly_unused');
      const psa10 = await fetchPrice('trading_card_single_psa10');
      return { rawA, psa10 };
    }, { productId, variantId });
    
    console.log(`  RAW A: ¥${prices.rawA.price} (count ${prices.rawA.count}) status ${prices.rawA.status}`);
    console.log(`  PSA10: ¥${prices.psa10.price} (count ${prices.psa10.count}) status ${prices.psa10.status}`);
    console.log(`  FINAL ${key}: RAW A ¥${prices.rawA.price} | PSA10 ¥${prices.psa10.price}`);
    
    await context.close();
    return { rawA: prices.rawA.price, psa10: prices.psa10.price, productId, variantId, key };
  } catch (e) {
    console.log(`  ERROR ${key}: ${e.message}`);
    await context.close();
    return { rawA: null, psa10: null, productId, variantId, key };
  }
}

async function main() {
  const data = await getPrices();
  const batchKeys = Object.keys(HARDCODE_MAP).map(apparelId => HARDCODE_MAP[apparelId].key);
  
  console.log(`=== V27 HARDCODE 10 ใบแรก 100% AUTO: ${batchKeys.join(', ')} ===`);
  
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-blink-features=AutomationControlled'] });
  let updated = 0;
  
  for (const apparelId of Object.keys(HARDCODE_MAP)) {
    const result = await scrapeOne(browser, apparelId);
    // หา key ใน boa-prices.json ที่ตรงกับ apparel_id
    let foundKey = null;
    for (const k of Object.keys(data.prices)) {
      if (data.prices[k].apparel_id == apparelId) { foundKey = k; break; }
    }
    if (!foundKey) foundKey = result.key;
    if (!data.prices[foundKey]) data.prices[foundKey] = { apparel_id: apparelId };
    
    const item = data.prices[foundKey];
    if (result.rawA || result.psa10) {
      if (result.rawA) { item.raw_jpy = result.rawA; item.jpy = result.rawA; item.raw_thb = Math.round(result.rawA * RATE); item.thb = Math.round(result.rawA * RATE); }
      if (result.psa10) { item.psa10_jpy = result.psa10; item.psa_jpy = result.psa10; item.psa10_thb = Math.round(result.psa10 * RATE); item.psa_thb = Math.round(result.psa10 * RATE); }
      item.product_id = result.productId;
      item.variant_id = result.variantId;
      item.apparel_id = apparelId;
      item.updated = new Date().toISOString();
      item.source = 'V27 Hardcode F12 10ใบ 100% AUTO - v3 nearly_unused/psa10';
      updated++;
      console.log(`  ✅ ${foundKey} UPDATED THB ${item.thb || '-'} / ${item.psa_thb || '-'}`);
    } else {
      console.log(`  ❌ ${foundKey} no price (BOA-01 PSA10 รอราคา = ปกติถ้าไม่มี trades)`);
      // ยังอัพเดท product_id ไว้
      if (result.productId) {
        item.product_id = result.productId;
        item.variant_id = result.variantId;
      }
    }
    await new Promise(r=>setTimeout(r,1500));
  }
  
  await browser.close();
  if (updated > 0) await putPrices(data);
  console.log(`\n🎉 V27 DONE ${updated}/10 -> https://cardmatem.store/boa-board`);
  console.log('หลักการ BOA-05/06: ไม่ใส่ราคาเอง ให้เบราว์เซอร์ยิง v3 จริง ออโต้ 100%');
}
main();
