import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
const URL = process.env.URL || 'http://localhost:8152/index.html';
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
const out = await p.evaluate(async () => {
  // 直接调用页面内的真实实现
  const S = window.Store;
  const st = JSON.parse(S.exportJSON());
  st.courses = Array.from({length:60},(_,i)=>({id:'c'+i,name:'课程'+i,day:i%5,start:1,span:2,weeks:[1,16]}));
  st.tasks = Array.from({length:120},(_,i)=>({id:'t'+i,title:'任务'+i,done:false,note:'备注'+i}));
  S.importJSON(JSON.stringify(st)); S.emit();
  function b64(u8){let s='',CH=0x8000;for(let i=0;i<u8.length;i+=CH)s+=String.fromCharCode.apply(null,u8.subarray(i,i+CH));return btoa(s);}
  async function pack(t){const e=new TextEncoder().encode(t);const buf=await new Response(new Blob([e]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();return 'CP1G'+b64(new Uint8Array(buf));}
  const code = await pack(S.exportJSON('standard'));
  const r = { codeLen: code.length };
  // 用页面真实函数（它们在 IIFE 内，通过重建同步码弹窗间接触发不方便，这里复刻最新逻辑）
  const PART_HEAD='CP1P', PART_SIZE=700;
  function pad2(n){return (n<10?'0':'')+n;}
  function split(c){if(c.length<=PART_SIZE)return null;const n=Math.ceil(c.length/PART_SIZE);const a=[];for(let i=0;i<n;i++)a.push(PART_HEAD+pad2(n)+pad2(i+1)+c.substr(i*PART_SIZE,PART_SIZE));return a;}
  function join(text){
    const s=String(text||''); const pos=[]; let idx=0;
    while(true){const at=s.indexOf(PART_HEAD,idx); if(at<0)break; pos.push(at); idx=at+PART_HEAD.length;}
    if(!pos.length) return null;
    let total=0; const got={};
    for(let i=0;i<pos.length;i++){
      const seg=s.slice(pos[i], i+1<pos.length?pos[i+1]:s.length);
      const tn=parseInt(seg.substr(4,2),10), sq=parseInt(seg.substr(6,2),10);
      if(!tn||!sq) continue; total=tn;
      const m=/^[A-Za-z0-9+/=]+/.exec(seg.substr(8));
      got[sq]= m?m[0]:'';
    }
    const missing=[]; for(let k=1;k<=total;k++) if(!got[k]) missing.push(k);
    return { total, missing, code: missing.length?null:Object.keys(got).sort((a,b)=>a-b).map(k=>got[k]).join('') };
  }
  const parts = split(code);
  r.partCount = parts.length;
  // 1) 带【1/N】标注 + 换行
  const j1 = join(parts.map((x,i)=>'【'+(i+1)+'/'+parts.length+'】'+x).join('\n'));
  r.withMarks = { missing: j1.missing, same: j1.code === code };
  // 2) 乱序
  const j2 = join([...parts].reverse().join('\n'));
  r.shuffled = { same: j2.code === code };
  // 3) 模拟微信复制：片之间夹 "小明 上午10:30"
  const j3 = join(parts.map(x=>x+'\n小明 上午10:30').join('\n'));
  r.withWechatNoise = { missing: j3.missing, same: j3.code === code };
  // 4) 缺片
  const j4 = join(parts.filter((_,i)=>i!==2).join('\n'));
  r.missingOne = { missing: j4.missing, codeNull: j4.code === null };
  return r;
});
console.log(JSON.stringify(out, null, 2));
await b.close();
