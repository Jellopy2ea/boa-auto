// V33 FINAL ROBIN - ราคาขายแล้วล่าสุดเท่านั้น (Last Sale) PSA10 + RAW A - 27 ใบ
// ใช้โครงสร้างเดียวกับ BOA V33
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { chromium } from 'playwright';

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY }
});
const BUCKET = process.env.R2_BUCKET || 'cardmatem-raw';
const FILE_KEY = 'robin-prices.json';
const RATE = 0.245;

const HARDCODE_MAP = {
  '650033': { productId: '750756', variantId: '9012083', key: 'ROBIN-01' },
  '254306': { productId: '330468', variantId: '2759812', key: 'ROBIN-02' },
  '712256': { productId: '822816', variantId: '9522140', key: 'ROBIN-03' },
  '715016': { productId: '826463', variantId: '9552262', key: 'ROBIN-04' },
  '94908': { productId: '171080', variantId: '1899031', key: 'ROBIN-05' },
  '157939': { productId: '234107', variantId: '2207346', key: 'ROBIN-06' },
  '854164': { productId: '985151', variantId: '10730618', key: 'ROBIN-07' },
  '714619': { productId: '826005', variantId: '9549534', key: 'ROBIN-08' },
  '710437': { productId: '820635', variantId: '9509164', key: 'ROBIN-09' },
  '743031': { productId: '858017', variantId: '9761023', key: 'ROBIN-10' },
  '819291': { productId: '946035', variantId: '10431745', key: 'ROBIN-11' },
  '588850': { productId: '682340', variantId: '8466805', key: 'ROBIN-12' },
  '583601': { productId: '676408', variantId: '5277511', key: 'ROBIN-13' },
  '349449': { productId: '425605', variantId: '3455678', key: 'ROBIN-14' },
  '755884': { productId: '873313', variantId: '9867089', key: 'ROBIN-15' },
  '708624': { productId: '818375', variantId: '9493055', key: 'ROBIN-16' },
  '708625': { productId: '818376', variantId: '9493065', key: 'ROBIN-17' },
  '134322': { productId: '210482', variantId: '2075516', key: 'ROBIN-18' },
  '213937': { productId: '290096', variantId: '2506206', key: 'ROBIN-19' },
  '287037': { productId: '363195', variantId: '2976690', key: 'ROBIN-20' },
  '871057': { productId: '1004552', variantId: '10873379', key: 'ROBIN-21' },
  '781249': { productId: '902607', variantId: '10121408', key: 'ROBIN-22' },
  '478770': { productId: '556223', variantId: '4361715', key: 'ROBIN-23' },
  '879325': { productId: '1013486', variantId: '10946360', key: 'ROBIN-24' },
  '764631': { productId: '883641', variantId: '9986821', key: 'ROBIN-25' },
  '893610': { productId: '1030108', variantId: '11061500', key: 'ROBIN-26' },
  '506994': { productId: '588958', variantId: '4612948', key: 'ROBIN-27' },
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
  console.log(`V33 ROBIN - ราคาขายแล้วล่าสุด PSA10 + RAW A - ${allKeys.length} ใบ`);
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
      item.source='V33 Last Sale ROBIN';
      item.url=`https://snkrdunk.com/apparels/${aid}/sales-histories`;
      item.productId=HARDCODE_MAP[aid].productId;
      item.variantId=HARDCODE_MAP[aid].variantId;
    }
    await new Promise(r=>setTimeout(r,1200));
  }


    for(let i=1;i<=27;i++){
    const k=`ROBIN-${String(i).padStart(2,'0')}`;
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
  console.log('DONE V33 ROBIN - '+Object.keys(data.prices).length+' items');
}
main();
