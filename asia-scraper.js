// V33 FINAL ASIA - ราคาขายแล้วล่าสุดเท่านั้น (Last Sale) PSA10 + RAW A - 28 ใบ
// ใช้โครงสร้างเดียวกับ BOA V33 ที่คุณให้มา - apparelId เป็น key หลัก
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { chromium } from 'playwright';

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY }
});
const BUCKET = process.env.R2_BUCKET || 'cardmatem-raw';
const FILE_KEY = 'asia-prices.json';
const RATE = 0.245;

const HARDCODE_MAP = {
  // 1 เลขลิ้งค์ : { productId, variantId, key }
  '814024': { productId: '940198', variantId: '10369713', key: 'ASIA-01' },
  '814023': { productId: '940197', variantId: '10369703', key: 'ASIA-02' },
  '814019': { productId: '940193', variantId: '10369663', key: 'ASIA-03' },
  '814020': { productId: '940194', variantId: '10369673', key: 'ASIA-04' },
  '814021': { productId: '940195', variantId: '10369683', key: 'ASIA-05' },
  '814022': { productId: '940196', variantId: '10369693', key: 'ASIA-06' },
  '823977': { productId: '951272', variantId: '10468755', key: 'ASIA-07' },
  '825185': { productId: '952581', variantId: '10479554', key: 'ASIA-08' },
  '887738': { productId: '1023661', variantId: '11026481', key: 'ASIA-10' },
  '887737': { productId: '1023660', variantId: '11026471', key: 'ASIA-11' },
  '887736': { productId: '1023659', variantId: '11026461', key: 'ASIA-12' },
  '825184': { productId: '952580', variantId: '10479544', key: 'ASIA-13' },
  '825183': { productId: '952579', variantId: '10479534', key: 'ASIA-14' },
  '481267': { productId: '559127', variantId: '4381985', key: 'ASIA-15' },
  '481268': { productId: '559128', variantId: '4381995', key: 'ASIA-16' },
  '481269': { productId: '559129', variantId: '4382005', key: 'ASIA-17' },
  '708625': { productId: '818376', variantId: '9493065', key: 'ASIA-18' },
  '708624': { productId: '818375', variantId: '9493055', key: 'ASIA-19' },
  '708623': { productId: '818374', variantId: '9493045', key: 'ASIA-20' },
  '708622': { productId: '818373', variantId: '9493035', key: 'ASIA-21' },
  '708621': { productId: '818372', variantId: '9493025', key: 'ASIA-22' },
  '708627': { productId: '818378', variantId: '9493085', key: 'ASIA-23' },
  '708626': { productId: '818377', variantId: '9493075', key: 'ASIA-24' },
};

async function getPrices(){ try{ const r=await R2.send(new GetObjectCommand({Bucket:BUCKET,Key:FILE_KEY})); return JSON.parse(await r.Body.transformToString()); } catch { return { updated: new Date().toISOString(), prices: {} }; } }
async function putPrices(d){ d.updated=new Date().toISOString(); d.count=Object.keys(d.prices).length; await R2.send(new PutObjectCommand({Bucket:BUCKET,Key:FILE_KEY,Body:JSON.stringify(d,null,2),ContentType:'application/json'})); }

async function scrapeOne(browser, apparelId){
  const map=HARDCODE_MAP[apparelId];
  const {productId, key}=map;
  const ctx=await browser.newContext({userAgent:'Mozilla/5.0 Chrome/120',locale:'ja-JP'});
  const page=await ctx.newPage();
  try{
    await page.goto(`https://snkrdunk.com/apparels/${apparelId}/sales-histories`,{waitUntil:'domcontentloaded',timeout:40000});
    await page.waitForTimeout(3000);
    const result=await page.evaluate(async({productId})=>{
      const getLastSold = async (condition_code) => {
        try{
          const url = `/v3/products/${productId}/trading-history?range=all&condition_code=${condition_code}&limit=1`;
          const res = await fetch(url,{headers:{'Accept':'application/json'}});
          if(!res.ok) return null;
          const j=await res.json();
          const price = j.trades?.[0]?.price || j.data?.trades?.[0]?.price;
          if(price && price>1000) return price;
          return null;
        }catch{return null;}
      };
      const getLastSoldChart = async () => {
        for(let opt=1; opt<=15; opt++){
          try{
            const r=await fetch(`/v1/apparels/${productId}/sales-chart/used?salesChartOptionId=${opt}`,{credentials:'include'});
            if(!r.ok) continue;
            const j=await r.json();
            const pts=j.points||j.data?.points||[];
            if(pts.length){
              const last=pts[pts.length-1];
              const v=Array.isArray(last)?last[1]:last.y||last.price;
              const nv=parseInt(v,10);
              if(nv>1000) return nv;
            }
          }catch{}
        }
        return null;
      };
      let psa10 = await getLastSold('trading_card_single_psa10');
      let rawA = await getLastSold('trading_card_single_nearly_unused');
      if(!rawA){ rawA = await getLastSoldChart(); }
      return {psa10, rawA};
    },{productId});
    await ctx.close();
    return {...result, key, apparelId};
  }catch(e){
    await ctx.close();
    return {psa10:null, rawA:null, key, apparelId};
  }
}

async function main(){
  const allKeys=Object.keys(HARDCODE_MAP);
  const data=await getPrices();
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  console.log(`V33 ASIA - ราคาขายแล้วล่าสุด PSA10 + RAW A - ${allKeys.length} ใบ`);
  for(const aid of allKeys){
    const r=await scrapeOne(browser, aid);
    const k=r.key;
    if(!data.prices[k]) data.prices[k]={apparel_id:aid, code:k};
    const item=data.prices[k];
    let changed=false;
    if(r.psa10 && r.psa10>1000){
      item.psa10_jpy=r.psa10; item.psa_jpy=r.psa10;
      item.psa10_thb=Math.round(r.psa10*RATE); item.psa_thb=Math.round(r.psa10*RATE);
      changed=true;
      console.log(`✅ ${k} PSA10 ขายแล้ว ¥${r.psa10}`);
    } else {
      console.log(`⏭ ${k} PSA10 ไม่มีขายแล้ว - คงราคาเดิม`);
    }
    if(r.rawA && r.rawA>1000){
      item.raw_jpy=r.rawA; item.jpy=r.rawA;
      item.raw_thb=Math.round(r.rawA*RATE); item.thb=Math.round(r.rawA*RATE);
      changed=true;
      console.log(`✅ ${k} RAW A ขายแล้ว ¥${r.rawA}`);
    } else {
      console.log(`⏭ ${k} RAW A ไม่มีขายแล้ว`);
    }
    if(changed){
      item.updated=new Date().toISOString();
      item.source='V33 Last Sale ASIA';
      item.url=`https://snkrdunk.com/apparels/${aid}/sales-histories`;
      item.productId=HARDCODE_MAP[aid].productId;
      item.variantId=HARDCODE_MAP[aid].variantId;
    }
    await new Promise(r=>setTimeout(r,1200));
  }
  for(let i=1;i<=28;i++){
    const k=`ASIA-${String(i).padStart(2,'0')}`;
    if(!data.prices[k]){
      data.prices[k]={
        apparel_id: "", code: k,
        psa10_jpy: 1000, psa_jpy: 1000, raw_jpy: 1000, jpy: 1000,
        psa10_thb: 245, psa_thb: 245, raw_thb: 245, thb: 245,
        updated: new Date().toISOString(),
        status: "รอเพิ่มลิ้งค์",
        source: "placeholder"
      };
    }
  }
  await browser.close();
  await putPrices(data);
  console.log('DONE V33 ASIA - 28 items');
}
main();
