// V33 FINAL 4ALL - ราคาขายแล้วล่าสุดเท่านั้น (Last Sale) PSA10 + RAW A - 37 ใบ d-01 to d-37 - R2 4all-board/
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { chromium } from 'playwright';
const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY }
});
const BUCKET = process.env.R2_BUCKET || 'cardmatem-raw';
const FILE_KEY = '4all-prices.json';
const RATE = 0.245;
const HARDCODE_MAP = {
  '710434': { productId: '820632', variantId: '9509134', key: 'D-01' },
  '714617': { productId: '826003', variantId: '9549514', key: 'D-02' },
  '728130': { productId: '840809', variantId: '9640939', key: 'D-03' },
  '822581': { productId: '949665', variantId: '10456478', key: 'D-04' },
  '265750': { productId: '341911', variantId: '2822700', key: 'D-05' },
  '710428': { productId: '820626', variantId: '9509074', key: 'D-06' },
  '751292': { productId: '867924', variantId: '9830780', key: 'D-07' },
  '714613': { productId: '825999', variantId: '9549474', key: 'D-08' },
  '588859': { productId: '682349', variantId: '8466895', key: 'D-09' },
  '765620': { productId: '884818', variantId: '9997121', key: 'D-10' },
  '158363': { productId: '234530', variantId: '2209211', key: 'D-11' },
  '710431': { productId: '820629', variantId: '9509104', key: 'D-12' },
  '503460': { productId: '584711', variantId: '4580455', key: 'D-13' },
  '214795': { productId: '290962', variantId: '2510607', key: 'D-14' },
  '714616': { productId: '826002', variantId: '9549504', key: 'D-15' },
  '752790': { productId: '869627', variantId: '9840788', key: 'D-16' },
  '158341': { productId: '234506', variantId: '2208921', key: 'D-17' },
  '328621': { productId: '404780', variantId: '3291698', key: 'D-18' },
  '588846': { productId: '682336', variantId: '8466765', key: 'D-19' },
  '126080': { productId: '202248', variantId: '2036211', key: 'D-20' },
  '135428': { productId: '211593', variantId: '2079446', key: 'D-21' },
  '158400': { productId: '234570', variantId: '2209543', key: 'D-22' },
  '364788': { productId: '440948', variantId: '3577370', key: 'D-23' },
  '656308': { productId: '758170', variantId: '9077852', key: 'D-24' },
  '451816': { productId: '527976', variantId: '4157907', key: 'D-25' },
  '758749': { productId: '876929', variantId: '9922075', key: 'D-26' },
  '764624': { productId: '883634', variantId: '9986751', key: 'D-27' },
  '911928': { productId: '1050543', variantId: '11193977', key: 'D-28' },
  '890821': { productId: '1027035', variantId: '11042277', key: 'D-29' },
  '520534': { productId: '604660', variantId: '4732133', key: 'D-30' },
  '887701': { productId: '1023611', variantId: '11025915', key: 'D-31' },
  '676057': { productId: '780990', variantId: '9248626', key: 'D-32' },
  '202948': { productId: '279110', variantId: '2452948', key: 'D-33' },
  '871068': { productId: '1004563', variantId: '10873489', key: 'D-34' },
  '300066': { productId: '376228', variantId: '3073262', key: 'D-35' },
  '407058': { productId: '483219', variantId: '3871036', key: 'D-36' },
  '158401': { productId: '234567', variantId: '2209533', key: 'D-37' },
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
  console.log(`V33 4ALL - ${allKeys.length} ใบ d-01 to d-37`);
  for(const aid of allKeys){
    const r=await scrapeOne(browser, aid);
    const k=r.key;
    if(!data.prices[k]) data.prices[k]={apparel_id:aid, code:k};
    const item=data.prices[k];
    let changed=false;
    if(r.psa10 && r.psa10>1000){ item.psa10_jpy=r.psa10; item.psa_jpy=r.psa10; item.psa10_thb=Math.round(r.psa10*RATE); item.psa_thb=Math.round(r.psa10*RATE); changed=true; console.log(`✅ ${k} PSA10 ¥${r.psa10}`); }
    if(r.rawA && r.rawA>1000){ item.raw_jpy=r.rawA; item.jpy=r.rawA; item.raw_thb=Math.round(r.rawA*RATE); item.thb=Math.round(r.rawA*RATE); changed=true; console.log(`✅ ${k} RAW ¥${r.rawA}`); }
    if(changed){ item.updated=new Date().toISOString(); item.source='V33 Last Sale 4ALL 37'; item.url=`https://snkrdunk.com/apparels/${aid}/sales-histories`; item.productId=HARDCODE_MAP[aid].productId; item.variantId=HARDCODE_MAP[aid].variantId; }
    await new Promise(r=>setTimeout(r,1200));
  }
  await browser.close();
  await putPrices(data);
  console.log('DONE V33 4ALL 37 - '+Object.keys(data.prices).length+' items');
}
main();
