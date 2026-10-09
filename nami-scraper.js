// V33 FINAL NAMI - ราคาขายแล้วล่าสุดเท่านั้น (Last Sale) PSA10 + RAW A - 53 ใบ
// ใช้โครงสร้างเดียวกับ BOA V33
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { chromium } from 'playwright';

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY }
});
const BUCKET = process.env.R2_BUCKET || 'cardmatem-raw';
const FILE_KEY = 'nami-prices.json';
const RATE = 0.245;

const HARDCODE_MAP = {
  '650030': { productId: '750753', variantId: '9012053', key: 'NAMI-00' },
  '310224': { productId: '386390', variantId: '3142948', key: 'NAMI-02' },
  '729311': { productId: '842087', variantId: '9649300', key: 'NAMI-03' },
  '710436': { productId: '820634', variantId: '9509154', key: 'NAMI-04' },
  '854160': { productId: '985147', variantId: '10730578', key: 'NAMI-05' },
  '135442': { productId: '211602', variantId: '2079706', key: 'NAMI-06' },
  '435341': { productId: '511502', variantId: '4046805', key: 'NAMI-07' },
  '477011': { productId: '554278', variantId: '4345908', key: 'NAMI-08' },
  '708622': { productId: '818373', variantId: '9493035', key: 'NAMI-09' },
  '708621': { productId: '818372', variantId: '9493025', key: 'NAMI-10' },
  '837244': { productId: '966326', variantId: '10588770', key: 'NAMI-11' },
  '506992': { productId: '588956', variantId: '4612928', key: 'NAMI-12' },
  '297575': { productId: '373733', variantId: '3058766', key: 'NAMI-13' },
  '349482': { productId: '425638', variantId: '3455938', key: 'NAMI-14' },
  '129616': { productId: '205790', variantId: '2056337', key: 'NAMI-15' },
  '714423': { productId: '825717', variantId: '9546684', key: 'NAMI-16' },
  '141832': { productId: '217994', variantId: '2119839', key: 'NAMI-17' },
  '102441': { productId: '178606', variantId: '1929505', key: 'NAMI-18' },
  '515452': { productId: '598785', variantId: '4691622', key: 'NAMI-19' },
  '198742': { productId: '274904', variantId: '2434660', key: 'NAMI-20' },
  '825185': { productId: '952581', variantId: '10479554', key: 'NAMI-21' },
  '764629': { productId: '883639', variantId: '9986801', key: 'NAMI-22' },
  '221368': { productId: '297527', variantId: '2557601', key: 'NAMI-23' },
  '94918': { productId: '171091', variantId: '1899135', key: 'NAMI-24' },
  '714196': { productId: '825368', variantId: '9542655', key: 'NAMI-25' },
  '549077': { productId: '636852', variantId: '4977953', key: 'NAMI-26' },
  '93521': { productId: '169685', variantId: '1893988', key: 'NAMI-27' },
  '743994': { productId: '859239', variantId: '9770040', key: 'NAMI-28' },
  '744313': { productId: '859673', variantId: '9773633', key: 'NAMI-29' },
  '520544': { productId: '604670', variantId: '4732233', key: 'NAMI-30' },
  '887435': { productId: '1023290', variantId: '11023925', key: 'NAMI-31' },
  '287033': { productId: '363192', variantId: '2976660', key: 'NAMI-32' },
  '254304': { productId: '330462', variantId: '2759755', key: 'NAMI-33' },
  '254303': { productId: '330465', variantId: '2759729', key: 'NAMI-34' },
  '755880': { productId: '873309', variantId: '9867049', key: 'NAMI-35' },
  '710442': { productId: '820647', variantId: '9509359', key: 'NAMI-36' },
  '911922': { productId: '1050537', variantId: '11193917', key: 'NAMI-37' },
  '911924': { productId: '1050539', variantId: '11193937', key: 'NAMI-38' },
  '158945': { productId: '235107', variantId: '2211635', key: 'NAMI-39' },
  '712256': { productId: '822816', variantId: '9522140', key: 'NAMI-40' },
  '221667': { productId: '297831', variantId: '2560226', key: 'NAMI-41' },
  '129630': { productId: '205795', variantId: '2056379', key: 'NAMI-42' },
  '819283': { productId: '946027', variantId: '10431665', key: 'NAMI-43' },
  '112952': { productId: '189122', variantId: '1978533', key: 'NAMI-44' },
  '537530': { productId: '623477', variantId: '4880100', key: 'NAMI-45' },
  '818888': { productId: '945604', variantId: '10429512', key: 'NAMI-46' },
  '856573': { productId: '987885', variantId: '10745585', key: 'NAMI-47' },
  '881637': { productId: '1016454', variantId: '10972831', key: 'NAMI-48' },
  '635919': { productId: '734779', variantId: '8874627', key: 'NAMI-49' },
  '911918': { productId: '1050533', variantId: '11193877', key: 'NAMI-50' },
  '911917': { productId: '1050532', variantId: '11193867', key: 'NAMI-51' },
  '893609': { productId: '1030107', variantId: '11061491', key: 'NAMI-52' },
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
  console.log(`V33 NAMI - ราคาขายแล้วล่าสุด PSA10 + RAW A - ${allKeys.length} ใบ`);
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
      item.source='V33 Last Sale NAMI';
      item.url=`https://snkrdunk.com/apparels/${aid}/sales-histories`;
      item.productId=HARDCODE_MAP[aid].productId;
      item.variantId=HARDCODE_MAP[aid].variantId;
    }
    await new Promise(r=>setTimeout(r,1200));
  }


  // Copy NAMI-00 price to NAMI-01 if NAMI-01 has no sale yet (same apparel 650030)
  if(data.prices['NAMI-00'] && !data.prices['NAMI-01']){
    data.prices['NAMI-01'] = { ...data.prices['NAMI-00'], code: 'NAMI-01', apparel_id: '650030' };
  } else if(data.prices['NAMI-00'] && data.prices['NAMI-01']){
    // If both exist, keep NAMI-00 as primary, but ensure NAMI-01 has same link
    if(!data.prices['NAMI-01'].psa10_jpy || data.prices['NAMI-01'].psa10_jpy===1000){
      data.prices['NAMI-01'].psa10_jpy = data.prices['NAMI-00'].psa10_jpy;
      data.prices['NAMI-01'].psa10_thb = data.prices['NAMI-00'].psa10_thb;
      data.prices['NAMI-01'].raw_jpy = data.prices['NAMI-00'].raw_jpy;
      data.prices['NAMI-01'].raw_thb = data.prices['NAMI-00'].raw_thb;
    }
  }

  for(let i=0;i<=52;i++){
    const k=`NAMI-${String(i).padStart(2,'0')}`;
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
  console.log('DONE V33 NAMI - '+Object.keys(data.prices).length+' items');
}
main();
