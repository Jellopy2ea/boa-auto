// scraper.js V29 FINAL - Hardcode 1-46 ครบจาก Link_SNKR.txt - 100% AUTO
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

const HARDCODE_MAP = {
  '713690': { productId: '824552', variantId: '9534253', key: 'BOA-01' },
  '714615': { productId: '826001', variantId: '9549494', key: 'BOA-02' },
  '710430': { productId: '820628', variantId: '9509094', key: 'BOA-03' },
  '814021': { productId: '940195', variantId: '10369683', key: 'BOA-05' },
  '814022': { productId: '940196', variantId: '10369693', key: 'BOA-06' },
  '93516': { productId: '169690', variantId: '1894048', key: 'BOA-07' },
  '328420': { productId: '404582', variantId: '3289698', key: 'BOA-08' },
  '94889': { productId: '171062', variantId: '1898920', key: 'BOA-09' },
  '126178': { productId: '202361', variantId: '2037236', key: 'BOA-10' },
  '142815': { productId: '218976', variantId: '2125325', key: 'BOA-11' },
  '102461': { productId: '178639', variantId: '1929789', key: 'BOA-12' },
  '201507': { productId: '277674', variantId: '2444260', key: 'BOA-13' },
  '202914': { productId: '279075', variantId: '2452578', key: 'BOA-14' },
  '503464': { productId: '584715', variantId: '4580495', key: 'BOA-15' },
  '198723': { productId: '274885', variantId: '2434508', key: 'BOA-16' },
  '185177': { productId: '261338', variantId: '2364373', key: 'BOA-17' },
  '202924': { productId: '279097', variantId: '2452688', key: 'BOA-18' },
  '349478': { productId: '425629', variantId: '3455878', key: 'BOA-19' },
  '588837': { productId: '682327', variantId: '8466675', key: 'BOA-20' },
  '599084': { productId: '692966', variantId: '8549200', key: 'BOA-21' },
  '764614': { productId: '883679', variantId: '9988990', key: 'BOA-22' },
  '681360': { productId: '784914', variantId: '9290034', key: 'BOA-23' },
  '728141': { productId: '840817', variantId: '9639695', key: 'BOA-24' },
  '727666': { productId: '840322', variantId: '9635990', key: 'BOA-25' },
  '728155': { productId: '840833', variantId: '9639815', key: 'BOA-26' },
  '728156': { productId: '840834', variantId: '9639825', key: 'BOA-27' },
  '828101': { productId: '955651', variantId: '10501810', key: 'BOA-28' },
  '822591': { productId: '949675', variantId: '10456578', key: 'BOA-29' },
  '835345': { productId: '964043', variantId: '10567105', key: 'BOA-30' },
  '205880': { productId: '282041', variantId: '2470263', key: 'BOA-31' },
  '575849': { productId: '667773', variantId: '5214393', key: 'BOA-32' },
  '653502': { productId: '754887', variantId: '9054623', key: 'BOA-33' },
  '656346': { productId: '758208', variantId: '9078233', key: 'BOA-34' },
  '237321': { productId: '313485', variantId: '2653307', key: 'BOA-35' },
  '328675': { productId: '404828', variantId: '3292128', key: 'BOA-36' },
  '328676': { productId: '404831', variantId: '3292198', key: 'BOA-37' },
  '477013': { productId: '554280', variantId: '4345928', key: 'BOA-38' },
  '435343': { productId: '511504', variantId: '4046862', key: 'BOA-39' },
  '568964': { productId: '660093', variantId: '5158841', key: 'BOA-40' },
  '562156': { productId: '652463', variantId: '5097395', key: 'BOA-41' },
  '729310': { productId: '842086', variantId: '9649290', key: 'BOA-42' },
  '766293': { productId: '885518', variantId: '10001963', key: 'BOA-43' },
  '807560': { productId: '932182', variantId: '10305224', key: 'BOA-44' },
  '823977': { productId: '951272', variantId: '10468755', key: 'BOA-45' },
  '220798': { productId: '296958', variantId: '2553525', key: 'BOA-46' },
};

async function getPrices() {
  const res = await R2.send(new GetObjectCommand({ Bucket: BUCKET, Key: FILE_KEY }));
  return JSON.parse(await res.Body.transformToString());
}
async function putPrices(data) {
  data.updated = new Date().toISOString();
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: FILE_KEY, Body: JSON.stringify(data,null,2), ContentType: 'application/json' }));
  console.log('✅ Uploaded R2 - 46 ใบครบ');
}

async function scrapeOne(browser, apparelId) {
  const map = HARDCODE_MAP[apparelId];
  const { productId, variantId, key } = map;
  console.log(`\n=== ${key} apparel=${apparelId} product=${productId} variant=${variantId} ===`);
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0', locale: 'ja-JP' });
  const page = await context.newPage();
  try {
    await page.goto(`https://snkrdunk.com/apparels/${apparelId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const prices = await page.evaluate(async ({ productId, variantId }) => {
      const fetchPrice = async (code) => {
        try {
          const url = `https://snkrdunk.com/v3/products/${productId}/trading-history?range=all&condition_code=${code}&variant_id=${variantId}`;
          const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
          if (!res.ok) return { price: null, status: res.status };
          const json = await res.json();
          const price = json.trades && json.trades[0] ? json.trades[0].price : null;
          return { price, count: json.trades?.length || 0, status: res.status };
        } catch (e) { return { price: null, error: e.message }; }
      };
      const rawA = await fetchPrice('trading_card_single_nearly_unused');
      const psa10 = await fetchPrice('trading_card_single_psa10');
      return { rawA, psa10 };
    }, { productId, variantId });
    console.log(`  RAW A: ¥${prices.rawA.price} (count ${prices.rawA.count}) | PSA10: ¥${prices.psa10.price} (count ${prices.psa10.count})`);
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
  console.log(`=== V29 FINAL HARDCODE 46 ใบครบ 100% AUTO ===`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-blink-features=AutomationControlled'] });
  let updated = 0;
  for (const apparelId of Object.keys(HARDCODE_MAP)) {
    const result = await scrapeOne(browser, apparelId);
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
      item.product_id = result.productId; item.variant_id = result.variantId; item.apparel_id = apparelId;
      item.updated = new Date().toISOString();
      item.source = 'V29 FINAL 46 ใบครบ 100% AUTO';
      updated++;
      console.log(`  ✅ ${foundKey} UPDATED THB ${item.thb || '-'} / ${item.psa_thb || '-'}`);
    }
    await new Promise(r=>setTimeout(r,1000));
  }
  await browser.close();
  if (updated > 0) await putPrices(data);
  console.log(`\n🎉 V29 DONE ${updated}/45 -> https://cardmatem.store/boa-board - ครบ 46 ใบ BOA-04 ว่างตามไฟล์`);
}
main();
