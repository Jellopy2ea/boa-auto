// V33 FINAL 1ALL - ราคาขายแล้วล่าสุดเท่านั้น (Last Sale) PSA10 + RAW A - 36 ใบ
// ใช้โครงสร้างเดียวกับ BOA V33 / 2ALL V33
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { chromium } from 'playwright';

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY }
});
const BUCKET = process.env.R2_BUCKET || 'cardmatem-raw';
const FILE_KEY = '1all-prices.json';
const RATE = 0.245;

const HARDCODE_MAP = {
  '710429': { productId: '820627', variantId: '9509084', key: '1ALL-01' },
  '710425': { productId: '820623', variantId: '9509044', key: '1ALL-02' },
  '126174': { productId: '202340', variantId: '2037151', key: '1ALL-03' },
  '364787': { productId: '440946', variantId: '3577340', key: '1ALL-04' },
  '126034': { productId: '202196', variantId: '2035747', key: '1ALL-05' },
  '126173': { productId: '202341', variantId: '2037217', key: '1ALL-06' },
  '714193': { productId: '825365', variantId: '9542625', key: '1ALL-07' },
  '751297': { productId: '867929', variantId: '9830830', key: '1ALL-08' },
  '691537': { productId: '798341', variantId: '9358731', key: '1ALL-09' },
  '911897': { productId: '1050512', variantId: '11193667', key: '1ALL-10' },
  '503500': { productId: '584763', variantId: '4581340', key: '1ALL-11' },
  '503415': { productId: '584666', variantId: '4580005', key: '1ALL-12' },
  '106738': { productId: '182913', variantId: '1949187', key: '1ALL-13' },
  '407059': { productId: '483211', variantId: '3870997', key: '1ALL-14' },
  '856575': { productId: '987887', variantId: '10745605', key: '1ALL-15' },
  '914266': { productId: '1053117', variantId: '11207718', key: '1ALL-16' },
  '911923': { productId: '1050538', variantId: '11193927', key: '1ALL-17' },
  '520532': { productId: '604658', variantId: '4732113', key: '1ALL-18' },
  '515450': { productId: '598783', variantId: '4691602', key: '1ALL-19' },
  '364786': { productId: '440947', variantId: '3577330', key: '1ALL-20' },
  '328560': { productId: '404718', variantId: '3291138', key: '1ALL-21' },
  '221727': { productId: '297891', variantId: '2560736', key: '1ALL-22' },
  '449943': { productId: '526098', variantId: '4145516', key: '1ALL-23' },
  '710435': { productId: '820633', variantId: '9509144', key: '1ALL-24' },
  '714618': { productId: '826004', variantId: '9549524', key: '1ALL-25' },
  '503458': { productId: '584709', variantId: '4580435', key: '1ALL-26' },
  '158383': { productId: '234546', variantId: '2209371', key: '1ALL-27' },
  '165934': { productId: '242099', variantId: '2258980', key: '1ALL-28' },
  '728126': { productId: '840805', variantId: '9640899', key: '1ALL-29' },
  '764515': { productId: '883482', variantId: '9985312', key: '1ALL-30' },
  '588841': { productId: '682331', variantId: '8466715', key: '1ALL-31' },
  '728139': { productId: '840818', variantId: '9641029', key: '1ALL-32' },
  '158327': { productId: '234489', variantId: '2208761', key: '1ALL-33' },
  '730903': { productId: '843967', variantId: '9663614', key: '1ALL-34' },
  '744315': { productId: '859675', variantId: '9773653', key: '1ALL-35' },
  '331027': { productId: '407186', variantId: '3308195', key: '1ALL-36' },
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
  console.log(`V33 1ALL - ราคาขายแล้วล่าสุด PSA10 + RAW A - ${allKeys.length} ใบ`);
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
      item.source='V33 Last Sale 1ALL';
      item.url=`https://snkrdunk.com/apparels/${aid}/sales-histories`;
      item.productId=HARDCODE_MAP[aid].productId;
      item.variantId=HARDCODE_MAP[aid].variantId;
    }
    await new Promise(r=>setTimeout(r,1200));
  }

    for(let i=1;i<=36;i++){
    const k=`1ALL-${String(i).padStart(2,'0')}`;
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
  console.log('DONE V33 1ALL - '+Object.keys(data.prices).length+' items');
}
main();
