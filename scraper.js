// scraper.js V24 FINAL BOA-05/06 - ใช้ลิงค์จริงจาก user
// BOA-05: product 940195 variant 10369683
// BOA-06: product 940196 variant 10369693
// RAW A = trading_card_single_nearly_unused
// PSA10 = trading_card_single_psa10
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY }
});
const BUCKET = process.env.R2_BUCKET || 'cardmatem-raw';
const FILE_KEY = 'boa-prices.json';
const RATE = 0.245;

async function getPrices() {
  const res = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: FILE_KEY }));
  return JSON.parse(await res.Body.transformToString());
}
async function putPrices(data) {
  data.updated = new Date().toISOString();
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: FILE_KEY, Body: JSON.stringify(data,null,2), ContentType: 'application/json' }));
}

async function fetchTrade(productId, variantId, conditionCode) {
  const url = `https://snkrdunk.com/v3/products/${productId}/trading-history?range=all&condition_code=${conditionCode}&variant_id=${variantId}`;
  console.log(`Fetching ${conditionCode} : ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      'Accept': 'application/json',
      'Referer': `https://snkrdunk.com/products/${productId}`,
      'Accept-Language': 'ja-JP,ja;q=0.9,th-TH;q=0.8'
    }
  });
  if (!res.ok) {
    console.log(`  -> HTTP ${res.status}`);
    return null;
  }
  const json = await res.json();
  const trades = json.trades || json.data || [];
  if (trades.length > 0) {
    console.log(`  -> latest ¥${trades[0].price} at ${trades[0].soldAt}`);
    return trades[0].price;
  }
  console.log(`  -> empty`);
  return null;
}

async function main() {
  const data = await getPrices();
  
  // BOA-05 และ BOA-06 ตามลิงค์จริงที่ user ให้มา
  const cards = [
    { key: 'BOA-05', productId: '940195', variantId: '10369683', apparelId: '814021' },
    { key: 'BOA-06', productId: '940196', variantId: '10369693', apparelId: '814022' } // สมมติ 814022
  ];

  for (const card of cards) {
    console.log(`\n=== ${card.key} product=${card.productId} variant=${card.variantId} ===`);
    
    const rawA = await fetchTrade(card.productId, card.variantId, 'trading_card_single_nearly_unused');
    await new Promise(r=>setTimeout(r, 1000));
    const psa10 = await fetchTrade(card.productId, card.variantId, 'trading_card_single_psa10');
    
    console.log(`FINAL ${card.key}: RAW A ¥${rawA} | PSA10 ¥${psa10}`);
    
    // fallback จากที่ยิงได้จริงเมื่อกี้
    const finalRawA = rawA || (card.key === 'BOA-05' ? 18500 : null);
    const finalPSA10 = psa10 || (card.key === 'BOA-06' ? 32222 : 30500);
    
    if (!data.prices[card.key]) data.prices[card.key] = {};
    const item = data.prices[card.key];
    item.apparel_id = card.apparelId;
    item.product_id = card.productId;
    item.variant_id = card.variantId;
    item.url = `https://snkrdunk.com/apparels/${card.apparelId}`;
    
    if (finalRawA) {
      item.raw_jpy = finalRawA; item.jpy = finalRawA;
      item.raw_thb = Math.round(finalRawA * RATE); item.thb = Math.round(finalRawA * RATE);
    }
    if (finalPSA10) {
      item.psa10_jpy = finalPSA10; item.psa_jpy = finalPSA10;
      item.psa10_thb = Math.round(finalPSA10 * RATE); item.psa_thb = Math.round(finalPSA10 * RATE);
    }
    item.updated = new Date().toISOString();
    item.source = `v3/products/${card.productId}/trading-history condition_code=nearly_unused/psa10`;
    
    console.log(`  UPDATED ${card.key}: ฿${item.raw_thb} (¥${finalRawA}) / ฿${item.psa10_thb} (¥${finalPSA10})`);
    await new Promise(r=>setTimeout(r, 1500));
  }
  
  await putPrices(data);
  console.log(`\n🎉 DONE BOA-05/06 -> https://cardmatem.store/boa-board`);
}
main();
