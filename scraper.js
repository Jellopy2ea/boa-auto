// V31 FIXED - จับแค่ PSA10 + RAW A ล่าสุดเท่านั้น ไม่เอา B C PSA8-9
// แก้ BOA-22-23-24-26 ที่ขึ้นวันที่ 11 ก.ย. ย้อนกลับไปใช้ราคาเก่ามั่ว
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

async function getPrices(){ const r=await R2.send(new GetObjectCommand({Bucket:BUCKET,Key:FILE_KEY})); return JSON.parse(await r.Body.transformToString()); }
async function putPrices(d){ d.updated=new Date().toISOString(); await R2.send(new PutObjectCommand({Bucket:BUCKET,Key:FILE_KEY,Body:JSON.stringify(d,null,2),ContentType:'application/json'})); }

async function scrapeOne(browser, apparelId){
  const map=HARDCODE_MAP[apparelId];
  const {productId,variantId,key}=map;
  const ctx=await browser.newContext({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',locale:'ja-JP'});
  const page=await ctx.newPage();
  try{
    await page.goto(`https://snkrdunk.com/apparels/${apparelId}`,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(2500);
    const result=await page.evaluate(async({productId,variantId})=>{
      // 1. ลองแค่ 2 condition ที่ต้องการเท่านั้น: PSA10 + RAW A (nearly_unused)
      const fetchCond=async(code)=>{
        try{
          const url=`https://snkrdunk.com/v3/products/${productId}/trading-history?range=all&condition_code=${code}&variant_id=${variantId}`;
          const res=await fetch(url,{headers:{'Accept':'application/json'}});
          if(!res.ok) return null;
          const j=await res.json();
          const price=j.trades?.[0]?.price;
          // ต้องมากกว่า 3000 ถึงจะถือว่า valid ไม่ใช่ placeholder
          if(price && price>3000) return price;
          return null;
        }catch{return null;}
      };
      const psa10=await fetchCond('trading_card_single_psa10');
      const rawA=await fetchCond('trading_card_single_nearly_unused');
      // ถ้าไม่ได้ ให้ fallback ไป sales-chart จุดล่าสุด (อันนี้คือ RAW A จริงที่ SNKR โชว์หน้าเว็บ)
      let fallback=null;
      if(!rawA){
        for(let opt=1; opt<=10; opt++){
          try{
            const r=await fetch(`/v1/apparels/${productId}/sales-chart/used?salesChartOptionId=${opt}`,{credentials:'include'});
            if(!r.ok) continue;
            const j=await r.json();
            const pts=j.points||j.data?.points||[];
            if(pts.length){
              const last=pts[pts.length-1];
              const v=Array.isArray(last)?last[1]:last.y||last.price;
              const nv=parseInt(v,10);
              if(nv>3000) {fallback=nv; break;}
            }
          }catch{}
        }
      }
      return {psa10, rawA: rawA||fallback};
    },{productId,variantId});
    await ctx.close();
    return {...result, key};
  }catch(e){ await ctx.close(); return {psa10:null, rawA:null, key}; }
}

async function main(){
  const allKeys=Object.keys(HARDCODE_MAP);
  const data=await getPrices();
  const browser=await require('playwright').chromium.launch({headless:true,args:['--no-sandbox']});
  // FIX: รันทีละใบที่ BOA-22,23,24,26 ก่อน เพื่อแก้ด่วน
  const priority=['764614','681360','728141','728155']; // 22,23,24,26
  const toRun = [...priority, ...allKeys.filter(k=>!priority.includes(k))].slice(0,15);
  console.log('PRIORITY RUN:', toRun.map(k=>HARDCODE_MAP[k].key).join(','));
  for(const aid of toRun){
    const r=await scrapeOne(browser, aid);
    const k=r.key;
    if(!data.prices[k]) data.prices[k]={apparel_id:aid};
    const item=data.prices[k];
    let changed=false;
    if(r.psa10 && r.psa10>3000){
      // ไม่เอา PSA8-9, ไม่เอา B C
      item.psa10_jpy=r.psa10; item.psa_jpy=r.psa10;
      item.psa10_thb=Math.round(r.psa10*RATE); item.psa_thb=Math.round(r.psa10*RATE);
      changed=true;
      console.log(`✅ ${k} PSA10 ¥${r.psa10}`);
    }
    if(r.rawA && r.rawA>3000){
      item.raw_jpy=r.rawA; item.jpy=r.rawA;
      item.raw_thb=Math.round(r.rawA*RATE); item.thb=Math.round(r.rawA*RATE);
      changed=true;
      console.log(`✅ ${k} RAW A ¥${r.rawA}`);
    }
    if(changed){
      item.updated=new Date().toISOString();
      item.source='V31 PSA10+RAW A only';
    } else {
      console.log(`❌ ${k} skip - no valid PSA10/RAW A (keep old price, not overwrite with 1000)`);
    }
    await new Promise(r=>setTimeout(r,1200));
  }
  await browser.close();
  await putPrices(data);
  console.log('DONE - ไม่ทับราคาดีด้วย 1000/3000 แล้ว');
}
main();
