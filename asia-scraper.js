// asia-scraper.js - BUILD: 2026-10-07 - Asia Board 28 cards
// ใช้โครงสร้างเดียวกับ boa-auto/scraper.js
// productId / variantId จาก SNKRDUNK

const ASIA_MAP = {
  "ASIA-01": {
    "productId": 940198,
    "variantId": 10369713,
    "url": "https://snkrdunk.com/apparels/814024",
    "image": "asia-board/asia-01.jpg"
  },
  "ASIA-02": {
    "productId": 940197,
    "variantId": 10369703,
    "url": "https://snkrdunk.com/apparels/814023",
    "image": "asia-board/asia-02.jpg"
  },
  "ASIA-03": {
    "productId": 940193,
    "variantId": 10369663,
    "url": "https://snkrdunk.com/apparels/814019",
    "image": "asia-board/asia-03.jpg"
  },
  "ASIA-04": {
    "productId": 940194,
    "variantId": 10369673,
    "url": "https://snkrdunk.com/apparels/814020",
    "image": "asia-board/asia-04.jpg"
  },
  "ASIA-05": {
    "productId": 940195,
    "variantId": 10369683,
    "url": "https://snkrdunk.com/apparels/814021",
    "image": "asia-board/asia-05.jpg"
  },
  "ASIA-06": {
    "productId": 940196,
    "variantId": 10369693,
    "url": "https://snkrdunk.com/apparels/814022",
    "image": "asia-board/asia-06.jpg"
  },
  "ASIA-07": {
    "productId": 951272,
    "variantId": 10468755,
    "url": "https://snkrdunk.com/apparels/823977",
    "image": "asia-board/asia-07.jpg"
  },
  "ASIA-08": {
    "productId": 952581,
    "variantId": 10479554,
    "url": "https://snkrdunk.com/apparels/825185",
    "image": "asia-board/asia-08.jpg"
  },
  "ASIA-10": {
    "productId": 1023661,
    "variantId": 11026481,
    "url": "https://snkrdunk.com/apparels/887738",
    "image": "asia-board/asia-10.jpg"
  },
  "ASIA-11": {
    "productId": 1023660,
    "variantId": 11026471,
    "url": "https://snkrdunk.com/apparels/887737",
    "image": "asia-board/asia-11.jpg"
  },
  "ASIA-12": {
    "productId": 1023659,
    "variantId": 11026461,
    "url": "https://snkrdunk.com/apparels/887736",
    "image": "asia-board/asia-12.jpg"
  },
  "ASIA-13": {
    "productId": 952580,
    "variantId": 10479544,
    "url": "https://snkrdunk.com/apparels/825184",
    "image": "asia-board/asia-13.jpg"
  },
  "ASIA-14": {
    "productId": 952579,
    "variantId": 10479534,
    "url": "https://snkrdunk.com/apparels/825183",
    "image": "asia-board/asia-14.jpg"
  },
  "ASIA-15": {
    "productId": 559127,
    "variantId": 4381985,
    "url": "https://snkrdunk.com/apparels/481267",
    "image": "asia-board/asia-15.jpg"
  },
  "ASIA-16": {
    "productId": 559128,
    "variantId": 4381995,
    "url": "https://snkrdunk.com/apparels/481268",
    "image": "asia-board/asia-16.jpg"
  },
  "ASIA-17": {
    "productId": 559129,
    "variantId": 4382005,
    "url": "https://snkrdunk.com/apparels/481269",
    "image": "asia-board/asia-17.jpg"
  },
  "ASIA-18": {
    "productId": 818376,
    "variantId": 9493065,
    "url": "https://snkrdunk.com/apparels/708625",
    "image": "asia-board/asia-18.jpg"
  },
  "ASIA-19": {
    "productId": 818375,
    "variantId": 9493055,
    "url": "https://snkrdunk.com/apparels/708624",
    "image": "asia-board/asia-19.jpg"
  },
  "ASIA-20": {
    "productId": 818374,
    "variantId": 9493045,
    "url": "https://snkrdunk.com/apparels/708623",
    "image": "asia-board/asia-20.jpg"
  },
  "ASIA-21": {
    "productId": 818373,
    "variantId": 9493035,
    "url": "https://snkrdunk.com/apparels/708622",
    "image": "asia-board/asia-21.jpg"
  },
  "ASIA-22": {
    "productId": 818372,
    "variantId": 9493025,
    "url": "https://snkrdunk.com/apparels/708621",
    "image": "asia-board/asia-22.jpg"
  },
  "ASIA-23": {
    "productId": 818378,
    "variantId": 9493085,
    "url": "https://snkrdunk.com/apparels/708627",
    "image": "asia-board/asia-23.jpg"
  },
  "ASIA-24": {
    "productId": 818377,
    "variantId": 9493075,
    "url": "https://snkrdunk.com/apparels/708626",
    "image": "asia-board/asia-24.jpg"
  }
};

const SNKRDUNK_API_BASE = "https://snkrdunk.com/api/v1/apparels";

async function fetchSnkrPrice(productId, variantId) {
  try {
    // SNKRDUNK sales history endpoint (same as boa)
    const url = `${SNKRDUNK_API_BASE}/${productId}/sales_histories?variant_id=${variantId}&currency=JPY`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
      }
    });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    // คาดว่า json มี recent sales -> คำนวณราคาเฉลี่ย / ล่าสุด
    // ปรับ logic ตาม boa scraper เดิม
    const sales = json.sales || json.data || [];
    if(!sales.length) return null;
    const last = sales[0];
    return {
      jpy: last.price || last.jpy_price || null,
      raw_jpy: last.price,
      psa10_jpy: last.psa10_price || null,
      updated: new Date().toISOString()
    };
  } catch(e){
    console.error(`fetch ${productId} failed`, e.message);
    return null;
  }
}

async function scrapeAll() {
  const prices = {};
  for(const [badge, cfg] of Object.entries(ASIA_MAP)) {
    console.log(`Scraping ${badge} -> ${cfg.productId}`);
    const priceData = await fetchSnkrPrice(cfg.productId, cfg.variantId);
    if(priceData){
      // แปลง JPY -> THB (ใช้เรทเดียวกับ boa)
      const rate = 0.25; // TODO: ใช้เรทจริงจาก boa-auto
      prices[badge] = {
        psa10_jpy: priceData.psa10_jpy || priceData.jpy || 1000,
        raw_jpy: priceData.raw_jpy || priceData.jpy || 1000,
        psa10_thb: Math.round((priceData.psa10_jpy||0)*rate),
        raw_thb: Math.round((priceData.raw_jpy||0)*rate),
        jpy: priceData.jpy,
        updated: priceData.updated,
        url: cfg.url,
        productId: cfg.productId,
        variantId: cfg.variantId
      };
    } else {
      prices[badge] = {
        psa10_jpy: 1000,
        raw_jpy: 1000,
        updated: new Date().toISOString(),
        url: cfg.url,
        productId: cfg.productId,
        variantId: cfg.variantId,
        error: "no data"
      };
    }
    await new Promise(r=>setTimeout(r, 800)); // กันโดน block
  }
  return prices;
}

async function main(){
  const prices = await scrapeAll();
  const output = {
    updated: new Date().toISOString(),
    count: Object.keys(prices).length,
    prices
  };
  const fs = await import('fs');
  fs.writeFileSync('asia-prices.json', JSON.stringify(output, null, 2));
  console.log('Wrote asia-prices.json', Object.keys(prices).length, 'items');
}

if(typeof window === 'undefined'){
  main();
}

export { ASIA_MAP, fetchSnkrPrice, scrapeAll };
