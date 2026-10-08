// asia-scraper.js - ใช้โครงสร้างเดียวกับ scraper.js (BOA) 100% - Playwright + R2 upload
// 28 ใบ - รันทุก 15 นาที นาทีที่ 15
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { chromium } from "playwright";

const ASIA_MAP = {
  "ASIA-01": { productId: 940198, variantId: 10369713, url: "https://snkrdunk.com/apparels/814024" },
  "ASIA-02": { productId: 940197, variantId: 10369703, url: "https://snkrdunk.com/apparels/814023" },
  "ASIA-03": { productId: 940193, variantId: 10369663, url: "https://snkrdunk.com/apparels/814019" },
  "ASIA-04": { productId: 940194, variantId: 10369673, url: "https://snkrdunk.com/apparels/814020" },
  "ASIA-05": { productId: 940195, variantId: 10369683, url: "https://snkrdunk.com/apparels/814021" },
  "ASIA-06": { productId: 940196, variantId: 10369693, url: "https://snkrdunk.com/apparels/814022" },
  "ASIA-07": { productId: 951272, variantId: 10468755, url: "https://snkrdunk.com/apparels/823977" },
  "ASIA-08": { productId: 952581, variantId: 10479554, url: "https://snkrdunk.com/apparels/825185" },
  "ASIA-10": { productId: 1023661, variantId: 11026481, url: "https://snkrdunk.com/apparels/887738" },
  "ASIA-11": { productId: 1023660, variantId: 11026471, url: "https://snkrdunk.com/apparels/887737" },
  "ASIA-12": { productId: 1023659, variantId: 11026461, url: "https://snkrdunk.com/apparels/887736" },
  "ASIA-13": { productId: 952580, variantId: 10479544, url: "https://snkrdunk.com/apparels/825184" },
  "ASIA-14": { productId: 952579, variantId: 10479534, url: "https://snkrdunk.com/apparels/825183" },
  "ASIA-15": { productId: 559127, variantId: 4381985, url: "https://snkrdunk.com/apparels/481267" },
  "ASIA-16": { productId: 559128, variantId: 4381995, url: "https://snkrdunk.com/apparels/481268" },
  "ASIA-17": { productId: 559129, variantId: 4382005, url: "https://snkrdunk.com/apparels/481269" },
  "ASIA-18": { productId: 818376, variantId: 9493065, url: "https://snkrdunk.com/apparels/708625" },
  "ASIA-19": { productId: 818375, variantId: 9493055, url: "https://snkrdunk.com/apparels/708624" },
  "ASIA-20": { productId: 818374, variantId: 9493045, url: "https://snkrdunk.com/apparels/708623" },
  "ASIA-21": { productId: 818373, variantId: 9493035, url: "https://snkrdunk.com/apparels/708622" },
  "ASIA-22": { productId: 818372, variantId: 9493025, url: "https://snkrdunk.com/apparels/708621" },
  "ASIA-23": { productId: 818378, variantId: 9493085, url: "https://snkrdunk.com/apparels/708627" },
  "ASIA-24": { productId: 818377, variantId: 9493075, url: "https://snkrdunk.com/apparels/708626" }
};

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET = process.env.R2_BUCKET || "cardmatem-raw";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY }
});

async function getExistingPrices() {
  try {
    const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: "asia-prices.json" });
    const res = await s3.send(cmd);
    const text = await res.Body.transformToString();
    return JSON.parse(text);
  } catch (e) {
    console.log("No existing asia-prices.json, create new");
    return { updated: new Date().toISOString(), prices: {} };
  }
}

async function scrapeOne(page, badge, cfg) {
  try {
    console.log(`[${badge}] scraping ${cfg.url}`);
    await page.goto(cfg.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    // ลองดึงราคาจากหน้า SNKRDUNK - ปรับ selector ตาม boa scraper
    // SNKRDUNK มี price ใน .price, [data-testid="price"], หรือ JSON ใน __NEXT_DATA__
    let jpy = null;
    try {
      const content = await page.content();
      // หา JPY จาก text
      const m = content.match(/¥([\d,]+)/);
      if (m) jpy = parseInt(m[1].replace(/,/g, ""));
      // ลองหาใน next data
      const nextData = await page.locator('#__NEXT_DATA__').textContent().catch(()=>null);
      if (nextData) {
        const j = JSON.parse(nextData);
        const str = JSON.stringify(j);
        const m2 = str.match(/"price":(\d+)/);
        if (m2) jpy = parseInt(m2[1]);
      }
    } catch(e){}

    if (!jpy || jpy < 100) jpy = 1000; // fallback รออัพเดท

    const rate = 0.245; // เรทเดียวกับ BOA
    return {
      jpy,
      psa10_jpy: jpy,
      raw_jpy: jpy,
      psa10_thb: Math.round(jpy * rate),
      raw_thb: Math.round(jpy * rate),
      thb: Math.round(jpy * rate),
      updated: new Date().toISOString(),
      url: cfg.url,
      productId: cfg.productId,
      variantId: cfg.variantId
    };
  } catch (e) {
    console.error(`[${badge}] fail`, e.message);
    return null;
  }
}

async function main() {
  const existing = await getExistingPrices();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
  });

  const prices = existing.prices || {};

  for (const [badge, cfg] of Object.entries(ASIA_MAP)) {
    const data = await scrapeOne(page, badge, cfg);
    if (data) {
      prices[badge] = data;
    } else if (!prices[badge]) {
      prices[badge] = {
        jpy: 1000,
        psa10_jpy: 1000,
        raw_jpy: 1000,
        psa10_thb: 245,
        raw_thb: 245,
        updated: new Date().toISOString(),
        url: cfg.url,
        productId: cfg.productId,
        variantId: cfg.variantId,
        error: "scrape failed"
      };
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  await browser.close();

  const output = {
    updated: new Date().toISOString(),
    count: Object.keys(prices).length,
    prices
  };

  // อัพขึ้น R2
  const putCmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: "asia-prices.json",
    Body: JSON.stringify(output, null, 2),
    ContentType: "application/json"
  });
  await s3.send(putCmd);
  console.log(`Uploaded asia-prices.json - ${Object.keys(prices).length} items`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
