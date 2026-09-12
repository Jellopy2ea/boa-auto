// scraper.js V25.1 FIX - หา product_id/variant_id ออโต้จากหน้า apparels
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
const BATCH_SIZE = 4;

async function getPrices() {
  const res = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: FILE_KEY }));
  return JSON.parse(await res.Body.transformToString());
}
async function putPrices(data) {
  data.updated = new Date().toISOString();
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: FILE_KEY, Body: JSON.stringify(data,null,2), ContentType: 'application/json' }));
}

async function scrapeOne(browser, card) {
  const { key, apparelId } = card;
  console.log(`\n=== ${key} apparel=${apparelId} ===`);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    locale: 'ja-JP'
  });
  const page = await context.newPage();
  const captured = {};
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/trading-history') && url.includes('/v3/products/')) {
      try {
        const u = new URL(url);
        const code = u.searchParams.get('condition_code');
        const json = await res.json();
        if (json.trades && json.trades[0]) {
          console.log(`  CAPTURED ${code} -> ¥${json.trades[0].price}`);
          captured[code] = json.trades[0].price;
        }
      } catch {}
    }
  });
  try {
    await page.goto(`https://snkrdunk.com/apparels/${apparelId}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    // หา product_id / variant_id จากหน้าเว็บจริง
    const ids = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      // หาจาก __NEXT_DATA__ หรือ script
      const m1 = html.match(/\/v3\/products\/(\d+)\/trading-history[^"]*variant_id=(\d+)/);
      if (m1) return { productId: m1[1], variantId: m1[2] };
      const m2 = html.match(/"productId":\s*(\d+).*?"variantId":\s*(\d+)/s);
      if (m2) return { productId: m2[1], variantId: m2[2] };
      // ลองจาก window
      try {
        const nextData = document.getElementById('__NEXT_DATA__')?.textContent;
        if (nextData) {
          const j = JSON.parse(nextData);
          const str = JSON.stringify(j);
          const mp = str.match(/"productId":(\d+)/);
          const mv = str.match(/"variantId":(\d+)/) || str.match(/"id":(1036\d+)/);
          if (mp) return { productId: mp[1], variantId: mv ? mv[1] : null };
        }
      } catch {}
      return { productId: null, variantId: null };
    });
    console.log(`  Found productId=${ids.productId} variantId=${ids.variantId}`);
    let productId = ids.productId;
    let variantId = ids.variantId;
    // ถ้ายังไม่ได้ ให้ลองใช้ known map BOA-05/06
    if (!productId) {
      const known = { '814021': { p:'940195', v:'10369683' }, '814022': { p:'940196', v:'10369693' } };
      if (known[apparelId]) { productId = known[apparelId].p; variantId = known[apparelId].v; }
    }
    if (productId && variantId) {
      const prices = await page.evaluate(async ({ productId, variantId }) => {
        const get = async (code) => {
          try {
            const url = `/v3/products/${productId}/trading-history?range=all&condition_code=${code}&variant_id=${variantId}`;
            const r = await fetch(url);
            const j = await r.json();
            return j.trades && j.trades[0] ? j.trades[0].price : null;
          } catch { return null; }
        };
        const rawA = await get('trading_card_single_nearly_unused');
        const psa10 = await get('trading_card_single_psa10');
        return { rawA, psa10 };
      }, { productId, variantId });
      console.log(`  FETCHED RAW A ¥${prices.rawA} | PSA10 ¥${prices.psa10}`);
      if (prices.rawA) captured['trading_card_single_nearly_unused'] = prices.rawA;
      if (prices.psa10) captured['trading_card_single_psa10'] = prices.psa10;
    }
    const rawA = captured['trading_card_single_nearly_unused'];
    const psa10 = captured['trading_card_single_psa10'];
    console.log(`  FINAL ${key}: RAW A ¥${rawA} | PSA10 ¥${psa10}`);
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
  console.log(`=== V25.1 BATCH ${batchIndex} : ${batchKeys.join(',')} ===`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  let updated = 0;
  for (const key of batchKeys) {
    const item = data.prices[key];
    const result = await scrapeOne(browser, { key, apparelId: item.apparel_id });
    if (result.rawA || result.psa10) {
      if (result.rawA) { item.raw_jpy = result.rawA; item.jpy = result.rawA; item.raw_thb = Math.round(result.rawA * RATE); item.thb = Math.round(result.rawA * RATE); }
      if (result.psa10) { item.psa10_jpy = result.psa10; item.psa_jpy = result.psa10; item.psa10_thb = Math.round(result.psa10 * RATE); item.psa_thb = Math.round(result.psa10 * RATE); }
      if (result.productId) item.product_id = result.productId;
      if (result.variantId) item.variant_id = result.variantId;
      item.updated = new Date().toISOString();
      item.source = 'V25.1 Playwright auto product_id + v3 nearly_unused/psa10';
      updated++;
    }
    await new Promise(r=>setTimeout(r,1500));
  }
  await browser.close();
  if (updated>0) await putPrices(data);
  console.log(`V25.1 DONE ${updated}/${batchKeys.length}`);
}
main();
