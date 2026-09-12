// scraper.js V25 FINAL 100% AUTO - Playwright ดัก v3 trading-history
// RAW A = trading_card_single_nearly_unused
// PSA10 = trading_card_single_psa10
// ใช้เบราว์เซอร์จริงยิง ไม่โดนบล็อค

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
  console.log('✅ Uploaded to R2');
}

async function scrapeOne(browser, card) {
  const { key, apparelId, productId: knownProductId, variantId: knownVariantId } = card;
  console.log(`\n=== ${key} apparel=${apparelId} ===`);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    locale: 'ja-JP',
    extraHTTPHeaders: { 'Accept-Language': 'ja-JP,ja;q=0.9' }
  });
  const page = await context.newPage();
  const captured = {};
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/v3/products/') && url.includes('/trading-history')) {
      try {
        const u = new URL(url);
        const code = u.searchParams.get('condition_code');
        const json = await res.json();
        const trades = json.trades || [];
        if (trades.length > 0) {
          console.log(`  CAPTURED ${code} -> ¥${trades[0].price}`);
          captured[code] = trades[0].price;
        }
      } catch {}
    }
  });
  try {
    await page.goto(`https://snkrdunk.com/apparels/${apparelId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    let productId = knownProductId;
    let variantId = knownVariantId;
    if (productId && variantId) {
      const inBrowser = await page.evaluate(async ({ productId, variantId }) => {
        const fetchPrice = async (code) => {
          try {
            const url = `/v3/products/${productId}/trading-history?range=all&condition_code=${code}&variant_id=${variantId}`;
            const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) return null;
            const j = await res.json();
            return j.trades && j.trades[0] ? j.trades[0].price : null;
          } catch { return null; }
        };
        const rawA = await fetchPrice('trading_card_single_nearly_unused');
        const psa10 = await fetchPrice('trading_card_single_psa10');
        return { rawA, psa10 };
      }, { productId, variantId });
      console.log(`  IN-BROWSER FETCH: RAW A ¥${inBrowser.rawA} | PSA10 ¥${inBrowser.psa10}`);
      if (inBrowser.rawA) captured['trading_card_single_nearly_unused'] = inBrowser.rawA;
      if (inBrowser.psa10) captured['trading_card_single_psa10'] = inBrowser.psa10;
    }
    await page.waitForTimeout(2000);
    const rawA = captured['trading_card_single_nearly_unused'];
    const psa10 = captured['trading_card_single_psa10'];
    console.log(`  FINAL ${key}: RAW A ¥${rawA} | PSA10 ¥${psa10}`);
    await context.close();
    return { rawA, psa10, productId, variantId, apparelId };
  } catch (e) {
    console.log(`  ERROR ${key}: ${e.message}`);
    await context.close();
    return { rawA: null, psa10: null, productId: knownProductId, variantId: knownVariantId, apparelId };
  }
}

async function main() {
  const data = await getPrices();
  const allKeys = Object.keys(data.prices).sort();
  const batchIndex = parseInt(process.env.BATCH_INDEX || '0', 10);
  const batchKeys = allKeys.slice(batchIndex * BATCH_SIZE, batchIndex * BATCH_SIZE + BATCH_SIZE);
  console.log(`=== V25 BATCH ${batchIndex} : ${batchKeys.join(',')} ===`);
  const knownMap = {
    'BOA-05': { productId: '940195', variantId: '10369683', apparelId: '814021' },
    'BOA-06': { productId: '940196', variantId: '10369693', apparelId: '814022' }
  };
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  let updated = 0;
  for (const key of batchKeys) {
    const item = data.prices[key];
    const known = knownMap[key] || {};
    const card = {
      key,
      apparelId: item.apparel_id || known.apparelId,
      productId: item.product_id || known.productId,
      variantId: item.variant_id || known.variantId
    };
    if (!card.apparelId) continue;
    const result = await scrapeOne(browser, card);
    if (result.rawA || result.psa10) {
      if (result.rawA) { item.raw_jpy = result.rawA; item.jpy = result.rawA; item.raw_thb = Math.round(result.rawA * RATE); item.thb = Math.round(result.rawA * RATE); }
      if (result.psa10) { item.psa10_jpy = result.psa10; item.psa_jpy = result.psa10; item.psa10_thb = Math.round(result.psa10 * RATE); item.psa_thb = Math.round(result.psa10 * RATE); }
      if (result.productId) item.product_id = result.productId;
      if (result.variantId) item.variant_id = result.variantId;
      item.updated = new Date().toISOString();
      item.source = 'V25 Playwright v3 nearly_unused/psa10 100% AUTO';
      updated++;
      console.log(`  ✅ ${key} UPDATED`);
    }
    await new Promise(r=>setTimeout(r,2000));
  }
  await browser.close();
  if (updated>0) await putPrices(data);
  console.log(`🎉 V25 DONE ${updated}/${batchKeys.length}`);
}
main();
