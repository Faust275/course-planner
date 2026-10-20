import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:8152/index.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.evaluate(() => { const e=document.querySelector('.ob-skip')||[...document.querySelectorAll('button,div,span,a')].find(x=>x.textContent.trim()==='跳过'); if(e)e.click(); });
await p.waitForTimeout(500);

const out = await p.evaluate(async () => {
  const S = window.Store;
  // 造足够大的数据，让码超过 700 字符触发分片
  const st = JSON.parse(S.exportJSON());
  st.courses = Array.from({length:60},(_,i)=>({id:'c'+i,name:'课程名称'+i,teacher:'教师'+i,location:'地点'+i,day:i%5,start:(i%4)+1,span:2,weeks:[1,16]}));
  st.tasks = Array.from({length:120},(_,i)=>({id:'t'+i,title:'任务标题内容'+i,done:i%3===0,due:'2026-09-'+String((i%28)+1).padStart(2,'0'),quadrant:i%4,note:'备注内容'+i}));
  st.notes = Array.from({length:60},(_,i)=>({id:'n'+i,title:'笔记'+i,body:'正文'.repeat(25),createdAt:Date.now()-i*1e6}));
  S.importJSON(JSON.stringify(st)); S.emit();

  function b64(u8){let s='',CH=0x8000;for(let i=0;i<u8.length;i+=CH)s+=String.fromCharCode.apply(null,u8.subarray(i,i+CH));return btoa(s);}
  async function pack(t){const e=new TextEncoder().encode(t);const buf=await new Response(new Blob([e]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();return 'CP1G'+b64(new Uint8Array(buf));}
  const code = await pack(S.exportJSON('standard'));
  const r = { codeLen: code.length };

  // 分片（复用页面里的实现：通过 UI 不好取，这里复刻逻辑验证格式可解析）
  const PART_HEAD='CP1P', PART_SIZE=700;
  function pad2(n){return (n<10?'0':'')+n;}
  function split(c){ if(c.length<=PART_SIZE) return null; const n=Math.ceil(c.length/PART_SIZE); const a=[]; for(let i=0;i<n;i++) a.push(PART_HEAD+pad2(n)+pad2(i+1)+c.substr(i*PART_SIZE,PART_SIZE)); return a; }
  function join(text){
    const s=String(text||''); const pos=[]; let idx=0;
    while(true){const at=s.indexOf(PART_HEAD,idx); if(at<0)break; pos.push(at); idx=at+PART_HEAD.length;}
    if(!pos.length) return null;
    let total=0; const got={};
    for(let i=0;i<pos.length;i++){const seg=s.slice(pos[i], i+1<pos.length?pos[i+1]:s.length);
      const tn=parseInt(seg.substr(4,2),10), sq=parseInt(seg.substr(6,2),10);
      if(!tn||!sq) continue; total=tn; got[sq]=seg.substr(8).replace(/[^A-Za-z0-9+/=]/g,'');}
    const missing=[]; for(let k=1;k<=total;k++) if(!got[k]) missing.push(k);
    return { total, missing, code: missing.length?null:Object.keys(got).sort((a,b)=>a-b).map(k=>got[k]).join('') };
  }
  const parts = split(code);
  r.partCount = parts ? parts.length : 0;
  r.partSample = parts ? parts[0].slice(0,12) : null;
  r.partLen = parts ? parts[0].length : 0;

  // 1) 全部粘（带【1/N】标注 + 换行）
  const withMarks = parts.map((x,i)=>'【'+(i+1)+'/'+parts.length+'】'+x).join('\n');
  const j1 = join(withMarks);
  r.allParts = { total: j1.total, missing: j1.missing, same: j1.code === code };

  // 2) 乱序粘
  const shuffled = [...parts].reverse().join('\n');
  const j2 = join(shuffled);
  r.shuffled = { missing: j2.missing, same: j2.code === code };

  // 3) 缺一片
  const missing1 = parts.filter((_,i)=>i!==1).join('\n');
  const j3 = join(missing1);
  r.missingOne = { missing: j3.missing, codeNull: j3.code === null };

  // 4) 短码不分片（兼容旧格式）
  const smallCode = await pack('{"courses":[]}');
  r.smallNotSplit = split(smallCode) === null;

  return r;
});
console.log(JSON.stringify({ out, errors: errs.slice(0,5) }, null, 2));
await b.close();
