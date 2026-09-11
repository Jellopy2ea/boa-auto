// scraper.js V16 _NEXT_DATA BYPASS - ใช้ buildId ยิง JSON ตรง
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
}

async function fetchWithNextData(apparelId) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'th-TH,th;q=0.9,ja;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml'
  };

  // 1. โหลดหน้า apparels ปกติ
  const pageRes = await fetch(`https://snkrdunk.com/apparels/${apparelId}/`, { headers });
  const html = await pageRes.text();
  console.log(`  page /apparels/${apparelId} len ${html.length} status ${pageRes.status}`);

  let buildId = null;
  let nextData = null;
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (nextMatch) {
    try {
      nextData = JSON.parse(nextMatch[1]);
      buildId = nextData.buildId;
      console.log(`  buildId ${buildId}`);
    } catch {}
  }
  if (!buildId) {
    // หา buildId แบบสำรอง
    const m2 = html.match(/"buildId"\s*:\s*"([^"]+)"/);
    if (m2) buildId = m2[1];
  }

  // 2. ยิง JSON ตรงของ Next.js
  if (buildId) {
    const jsonUrl = `https://snkrdunk.com/_next/data/${buildId}/apparels/${apparelId}/sales-histories.json`;
    try {
      const r = await fetch(jsonUrl, { headers: { ...headers, 'Accept': 'application/json', 'Referer': `https://snkrdunk.com/apparels/${apparelId}/sales-histories` } });
      const t = await r.text();
      console.log(`  _next/data sales-histories.json ${r.status} len ${t.length}`);
      if (r.status === 200 && t.length > 200) {
        const j = JSON.parse(t);
        return j;
      }
    } catch (e) { console.log(`  jsonUrl error ${e.message}`); }

    // ลองอีกแบบ
    const jsonUrl2 = `https://snkrdunk.com/_next/data/${buildId}/th/apparels/${apparelId}/sales-histories.json`;
    try {
      const r = await fetch(jsonUrl2, { headers });
      const t = await r.text();
      console.log(`  _next/data th sales-histories.json ${r.status} len ${t.length}`);
      if (r.status === 200 && t.length > 200) return JSON.parse(t);
    } catch {}
  }

  // 3. ถ้ายังไม่ได้ ใช้ html เดิมที่มี NEXT_DATA อยู่แล้ว
  if (nextData) return nextData;

  return { rawHtml: html };
}

function deepFindSales(obj) {
  let aPrice = null, psaPrice = null;
  const stack = [obj];
  const visited = new Set();
  
  while (stack.length && (!aPrice || !psaPrice)) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (visited.has(cur)) continue;
    visited.add(cur);

    // ถ้าเป็น array ให้ดันลูกเข้าไป
    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
      continue;
    }

    // เช็คว่า object นี้มีราคา + สถานะไหม
    const hasPrice = cur.price != null || cur.sold_price != null || cur.transaction_price != null;
    const priceVal = cur.price || cur.sold_price || cur.transaction_price;
    const status = (cur.status || cur.condition || cur.card_status || cur.grade || '').toString().toUpperCase();
    const statusTh = (cur.status_label || cur.condition_label || '').toString();

    if (hasPrice && priceVal) {
      let p = parseInt(String(priceVal).replace(/,/g,''));
      if (p >= 300 && p <= 10000000) {
        const text = JSON.stringify(cur).toLowerCase();
        if ((status.includes('PSA') || text.includes('psa10') || statusTh.includes('พีเอสเอ')) && !psaPrice) {
          psaPrice = p;
        }
        if ((status === 'A' || status.includes(' A ') || statusTh.includes('เอ') || text.includes('"a"') ) && !text.includes('psa')) {
          if (!aPrice) aPrice = p;
        }
        // heuristic: ถ้า text มี เอ
        if (!aPrice && (text.includes(' เอ ') || text.includes('"condition":"a"'))) {
          if (!text.includes('psa')) aPrice = p;
        }
      }
    }

    // ดันลูก
    for (const k of Object.keys(cur)) {
      const v = cur[k];
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return { aPrice, psaPrice };
}

function parseHtmlFallback(html) {
  let aPrice = null, psaPrice = null;
  // หาแบบตรงๆใน html: 4,400 เยน + คำว่า เอ / PSA
  const regex = /([^\n]{0,30})([\d,]{3,})\s*เยน([^\n]{0,30})/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const before = m[1] + m[3];
    let p = parseInt(m[2].replace(/,/g,''));
    if (!(p >= 300)) continue;
    if (before.toLowerCase().includes('psa') || before.includes('พีเอสเอ')) {
      if (!psaPrice) psaPrice = p;
    } else {
      if (!aPrice) aPrice = p;
    }
  }
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
    if (!apparelId) { console.log(`SKIP ${key} no apparel_id`); continue; }
    console.log(`\n--> ${key} ${apparelId}`);
    try {
      const raw = await fetchWithNextData(apparelId);
      let { aPrice, psaPrice } = deepFindSales(raw);

      if (!aPrice || !psaPrice) {
        const fallback = parseHtmlFallback(raw.rawHtml || JSON.stringify(raw));
        if (!aPrice) aPrice = fallback.aPrice;
        if (!psaPrice) psaPrice = fallback.psaPrice;
      }

      // ถ้ายังไม่ได้ ลองหาใน JSON.stringify ทั้งก้อนแบบง่าย
      if (!aPrice || !psaPrice) {
        const all = JSON.stringify(raw);
        const prices = [...all.matchAll(/"price"\s*:\s*(\d+)/g)].map(x=>parseInt(x[1])).filter(v=>v>=300);
        console.log(`  all prices found ${prices.slice(0,10)}`);
        if (!aPrice && prices[0]) aPrice = prices[0];
        if (!psaPrice && prices[1]) psaPrice = prices[1];
        else if (!psaPrice) psaPrice = aPrice;
      }

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
        console.log(`  ✅ ${key} UPDATED`);
      } else {
        console.log(`  ❌ ${key} still null`);
      }
    } catch (e) {
      console.log(`  ❌ ${key} error ${e.message} ${e.stack}`);
    }
    await new Promise(r=>setTimeout(r, 1200));
  }

  if (updated>0) await putPrices(data);
  console.log(`🎉 DONE ${updated}/${batchKeys.length}`);
}
main();
