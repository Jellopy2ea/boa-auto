// scraper.js V26 FINAL - หลักการเดียวกับ BOA-05/06 100% AUTO
// BOA-05: 940195 / 10369683 -> ¥18500 / ¥30500
// BOA-06: 940196 / 10369693 -> ¥10000 / ¥32222
// ใช้ domcontentloaded ไม่ใช่ networkidle จะได้ไม่ Timeout

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
const BATCH_SIZE = 2; // ลด batch ให้ไม่ timeout

async function getPrices() {
  const res = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: FILE_KEY }));
  return JSON.parse(await res.Body.transformToString());
}
async function putPrices(data) {
  data.updated = new Date().toISOString();
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: FILE_KEY, Body: JSON.stringify(data,null,2), ContentType: 'application/json' }));
  console.log('✅ Uploaded R2');
}

async function scrapeOne(browser, card) {
  const { key, apparelId } = card;
  console.log(`\n=== ${key} apparel=${apparelId} ===`);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    locale: 'ja-JP'
  });
  const page = await context.newPage();
  
  try {
    // ใช้ domcontentloaded ไม่ใช่ networkidle - นี่คือสาเหตุ Timeout รอบที่แล้ว
    await page.goto(`https://snkrdunk.com/apparels/${apparelId}`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    await page.waitForTimeout(4000);
    
    // หา product_id / variant_id จากหน้าเว็บ
    const ids = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      // วิธี 1: หาจาก v3 URL ใน html
      let m = html.match(/\/v3\/products\/(\d+)\/trading-history[^"]*variant_id=(\d+)/);
      if (m) return { productId: m[1], variantId: m[2] };
      // วิธี 2: หาจาก NEXT_DATA
      const nextDataEl = document.getElementById('__NEXT_DATA__');
      if (nextDataEl) {
        try {
          const txt = nextDataEl.textContent;
          const mp = txt.match(/"productId":(\d+)/);
          const mv = txt.match(/"variantId":(\d+)/) || txt.match(/"id":(1036\d+)/);
          if (mp) return { productId: mp[1], variantId: mv ? mv[1] : null };
        } catch {}
      }
      // วิธี 3: หาจากทุกที่
      const mp = html.match(/"productId"\s*:\s*"?(\d+)"?/);
      const mv = html.match(/"variantId"\s*:\s*"?(\d+)"?/);
      if (mp) return { productId: mp[1], variantId: mv ? mv[1] : null };
      return { productId: null, variantId: null };
    });
    
    console.log(`  Found ids: productId=${ids.productId} variantId=${ids.variantId}`);
    
    // ใช้ known map สำหรับ BOA-05/06 ที่คุณแกะมาแล้ว - หลักการ BOA 5-6
    const knownMap = {
      '814021': { productId: '940195', variantId: '10369683' }, // BOA-05
      '814022': { productId: '940196', variantId: '10369693' }, // BOA-06
      '713690': { productId: null, variantId: null } // BOA-01 จะหาเอง
    };
    
    let productId = ids.productId || knownMap[apparelId]?.productId;
    let variantId = ids.variantId || knownMap[apparelId]?.variantId;
    
    // ถ้ายังไม่ได้ productId ให้ลองดักจาก response ที่โหลดมาแล้ว
    if (!productId) {
      console.log(`  No productId yet, trying to extract from page scripts...`);
      const content = await page.content();
      const m = content.match(/products\/(\d+)/);
      if (m) productId = m[1];
    }
    
    let rawA = null;
    let psa10 = null;
    
    if (productId && variantId) {
      // หลักการ BOA 5-6 : ยิงในเบราว์เซอร์จริงด้วย fetch ของเบราว์เซอร์
      const prices = await page.evaluate(async ({ productId, variantId }) => {
        const fetchPrice = async (code) => {
          try {
            const url = `https://snkrdunk.com/v3/products/${productId}/trading-history?range=all&condition_code=${code}&variant_id=${variantId}`;
            const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) return { price: null, url, status: res.status };
            const json = await res.json();
            const price = json.trades && json.trades[0] ? json.trades[0].price : null;
            return { price, url, count: json.trades?.length || 0 };
          } catch (e) {
            return { price: null, error: e.message };
          }
        };
        const rawARes = await fetchPrice('trading_card_single_nearly_unused');
        const psa10Res = await fetchPrice('trading_card_single_psa10');
        return { rawARes, psa10Res };
      }, { productId, variantId });
      
      console.log(`  RAW A response: ¥${prices.rawARes.price} count=${prices.rawARes.count} url=${prices.rawARes.url}`);
      console.log(`  PSA10 response: ¥${prices.psa10Res.price} count=${prices.psa10Res.count} url=${prices.psa10Res.url}`);
      
      rawA = prices.rawARes.price;
      psa10 = prices.psa10Res.price;
    } else {
      console.log(`  ❌ No productId/variantId for ${key}, cannot fetch v3`);
      // fallback ดัก v1 ที่เคยได้
      const content = await page.content();
      // ลองหา trades แบบเก่า
    }
    
    console.log(`  FINAL ${key}: RAW A ¥${rawA} | PSA10 ¥${psa10} (product ${productId}/${variantId})`);
    await context.close();
    return { rawA, psa10, productId, variantId };
  } catch (e) {
    console.log(`  ERROR ${key}: ${e.message}`);
    await context.close();
    return { rawA: null, psa10: null };
  }
}

async function main() {
  const data = await getPrices();
  const allKeys = Object.keys(data.prices).sort();
  const batchIndex = parseInt(process.env.BATCH_INDEX || '0', 10);
  const batchKeys = allKeys.slice(batchIndex * BATCH_SIZE, batchIndex * BATCH_SIZE + BATCH_SIZE);
  
  console.log(`=== V26 BATCH ${batchIndex} : ${batchKeys.join(',')} (หลักการ BOA-05/06) ===`);
  
  const browser = await chromium.launch({ 
    headless: true, 
    args: ['--no-sandbox','--disable-blink-features=AutomationControlled'] 
  });
  
  let updated = 0;
  for (const key of batchKeys) {
    const item = data.prices[key];
    if (!item.apparel_id) {
      console.log(`SKIP ${key} no apparel_id`);
      continue;
    }
    const result = await scrapeOne(browser, { key, apparelId: item.apparel_id });
    
    if (result.rawA || result.psa10) {
      if (result.rawA) {
        item.raw_jpy = result.rawA; item.jpy = result.rawA;
        item.raw_thb = Math.round(result.rawA * RATE); item.thb = Math.round(result.rawA * RATE);
      }
      if (result.psa10) {
        item.psa10_jpy = result.psa10; item.psa_jpy = result.psa10;
        item.psa10_thb = Math.round(result.psa10 * RATE); item.psa_thb = Math.round(result.psa10 * RATE);
      }
      if (result.productId) item.product_id = result.productId;
      if (result.variantId) item.variant_id = result.variantId;
      item.updated = new Date().toISOString();
      item.source = 'V26 BOA-05/06 principle - domcontentloaded + v3 nearly_unused/psa10';
      updated++;
      console.log(`  ✅ ${key} UPDATED -> THB ${item.thb} / ${item.psa_thb}`);
    } else {
      console.log(`  ❌ ${key} no price - need product_id mapping`);
    }
    await new Promise(r=>setTimeout(r, 2000));
  }
  
  await browser.close();
  if (updated > 0) await putPrices(data);
  console.log(`\n🎉 V26 DONE ${updated}/${batchKeys.length} -> https://cardmatem.store/boa-board`);
}
main();
