// V33 FINAL 2ALL - ราคาขายแล้วล่าสุดเท่านั้น (Last Sale) PSA10 + RAW A - 48 ใบ
// ใช้โครงสร้างเดียวกับ BOA V33
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { chromium } from 'playwright';

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY }
});
const BUCKET = process.env.R2_BUCKET || 'cardmatem-raw';
const FILE_KEY = '2all-prices.json';
const RATE = 0.245;

const HARDCODE_MAP = {
  '650009': { productId: '750732', variantId: '9011843', key: '2ALL-01' },
  '503472': { productId: '584723', variantId: '4580575', key: '2ALL-02' },
  '467306': { productId: '543459', variantId: '4263694', key: '2ALL-03' },
  '520546': { productId: '604672', variantId: '4732253', key: '2ALL-04' },
  '265751': { productId: '341904', variantId: '2822590', key: '2ALL-05' },
  '237291': { productId: '313449', variantId: '2653159', key: '2ALL-06' },
  '112972': { productId: '189147', variantId: '1978653', key: '2ALL-07' },
  '764509': { productId: '883476', variantId: '9985252', key: '2ALL-08' },
  '442291': { productId: '518450', variantId: '4088555', key: '2ALL-09' },
  '129628': { productId: '205797', variantId: '2056420', key: '2ALL-10' },
  '265703': { productId: '341859', variantId: '2822310', key: '2ALL-11' },
  '265707': { productId: '341876', variantId: '2822370', key: '2ALL-12' },
  '656339': { productId: '758201', variantId: '9078163', key: '2ALL-13' },
  '342319': { productId: '418475', variantId: '3402564', key: '2ALL-14' },
  '656311': { productId: '758173', variantId: '9077882', key: '2ALL-15' },
  '714199': { productId: '825371', variantId: '9542685', key: '2ALL-16' },
  '635901': { productId: '734761', variantId: '8874447', key: '2ALL-17' },
  '911930': { productId: '1050545', variantId: '11193997', key: '2ALL-18' },
  '635904': { productId: '734764', variantId: '8874477', key: '2ALL-19' },
  '911856': { productId: '1050413', variantId: '11192331', key: '2ALL-20' },
  '503501': { productId: '584764', variantId: '4581350', key: '2ALL-21' },
  '714426': { productId: '825720', variantId: '9546714', key: '2ALL-22' },
  '710426': { productId: '820624', variantId: '9509054', key: '2ALL-23' },
  '135445': { productId: '211604', variantId: '2079566', key: '2ALL-24' },
  '372848': { productId: '449015', variantId: '3645925', key: '2ALL-25' },
  '819290': { productId: '946034', variantId: '10431735', key: '2ALL-26' },
  '140965': { productId: '217153', variantId: '2112127', key: '2ALL-27' },
  '714427': { productId: '825721', variantId: '9546724', key: '2ALL-28' },
  '477012': { productId: '554279', variantId: '4345918', key: '2ALL-29' },
  '331051': { productId: '407208', variantId: '3308425', key: '2ALL-30' },
  '676049': { productId: '780982', variantId: '9248546', key: '2ALL-31' },
  '315883': { productId: '392042', variantId: '3191284', key: '2ALL-32' },
  '714628': { productId: '826018', variantId: '9549636', key: '2ALL-33' },
  '140968': { productId: '217133', variantId: '2111891', key: '2ALL-34' },
  '713725': { productId: '824587', variantId: '9534603', key: '2ALL-35' },
  '134326': { productId: '210483', variantId: '2075526', key: '2ALL-36' },
  '157940': { productId: '234104', variantId: '2207371', key: '2ALL-37' },
  '102424': { productId: '178595', variantId: '1929485', key: '2ALL-38' },
  '102449': { productId: '178622', variantId: '1929685', key: '2ALL-39' },
  '140966': { productId: '217128', variantId: '2111873', key: '2ALL-40' },
  '158307': { productId: '234469', variantId: '2208528', key: '2ALL-41' },
  '503456': { productId: '584707', variantId: '4580415', key: '2ALL-42' },
  '353101': { productId: '429258', variantId: '3489395', key: '2ALL-43' },
  '98671': { productId: '174840', variantId: '1913516', key: '2ALL-44' },
  '570591': { productId: '662007', variantId: '5171573', key: '2ALL-45' },
  '140963': { productId: '217129', variantId: '2111901', key: '2ALL-46' },
  '715020': { productId: '826467', variantId: '9552302', key: '2ALL-47' },
  '140964': { productId: '217124', variantId: '2111823', key: '2ALL-48' },
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
  console.log(`V33 2ALL - ราคาขายแล้วล่าสุด PSA10 + RAW A - ${allKeys.length} ใบ`);
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
      item.source='V33 Last Sale 2ALL';
      item.url=`https://snkrdunk.com/apparels/${aid}/sales-histories`;
      item.productId=HARDCODE_MAP[aid].productId;
      item.variantId=HARDCODE_MAP[aid].variantId;
    }
    await new Promise(r=>setTimeout(r,1200));
  }


    for(let i=1;i<=48;i++){
    const k=`2ALL-${String(i).padStart(2,'0')}`;
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
  console.log('DONE V33 2ALL - '+Object.keys(data.prices).length+' items');
}
main();
