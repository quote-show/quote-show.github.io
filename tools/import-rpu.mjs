/**
 * 把參考站的減額繳清表併進既有商品檔。不複製對方的頁面。
 * 用法：node tools/import-rpu.mjs
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { quoteRpu } from "../js/calc.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ref = process.env.REFERENCE_DIR || "/tmp/ref/quoteyt/pages";

function braceSlice(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === "\\") { i += 1; continue; }
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") { quote = char; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function ourId(code, key) {
  const rest = key.startsWith(code) ? key.slice(code.length) : key;
  if (rest.length === 6) return `${Number(rest.slice(0, 2))}|${Number(rest.slice(2, 4))}|${Number(rest.slice(4, 6))}`;
  if (rest.length === 4) return `1|${Number(rest.slice(0, 2))}|${Number(rest.slice(2, 4))}`;
  return null;
}

function loadStandard(html) {
  const eng = braceSlice(html, "const ENG=");
  const product = braceSlice(html, "const P=");
  if (!eng || !product) return null;
  const context = { Math, Date, String, Number, Object, JSON };
  vm.createContext(context);
  vm.runInContext("const IIF=(c,a,b)=>c?a:(b===undefined?false:b),AND=(...a)=>a.every(Boolean),OR=(...a)=>a.some(Boolean),RND=(x,d)=>Math.round(x*10**d)/10**d;\n" + eng.replace("const ENG=", "ENG="), context);
  vm.runInContext(product.replace("const P=", "P="), context);
  return { ENG: context.ENG, P: context.P };
}

const checks = [];
let ported = 0;
for (const file of fs.readdirSync(ref)) {
  if (!file.endsWith(".html")) continue;
  const code = file.slice(0, -5);
  const productPath = path.join(root, "data/savings", `${code}.json`);
  if (!fs.existsSync(productPath)) continue;
  const html = fs.readFileSync(path.join(ref, file), "utf8");
  const slice = braceSlice(html, "const RPU=");
  if (!slice) continue;
  const context = { Math };
  vm.createContext(context);
  vm.runInContext(slice.replace("const RPU=", "RPU="), context);
  const source = context.RPU;
  const keys = {};
  for (const [key, value] of Object.entries(source.keys || {})) {
    const id = ourId(code, key);
    if (!id || !value.PA?.some((item) => item > 0)) continue;
    keys[id] = { PA: value.PA, PV: value.PV, CV: value.CV, NSP: value.NSP };
  }
  const product = JSON.parse(fs.readFileSync(productPath, "utf8"));
  product.rpu = {
    expRate: source.expRate ?? 0.01,
    saOnly: !!source.saOnly,
    scale: !!source.scale,
    rnd: source.rnd || "up",
    calc: source.calc !== false,
    keys,
  };
  product.withdrawal = html.includes("WDRAWJS");
  fs.writeFileSync(productPath, JSON.stringify(product));
  ported += 1;
  if (["PFZA", "FBQ", "XMP", "PFE", "ICK"].includes(code)) {
    const loaded = loadStandard(html);
    if (loaded) checks.push({ code, product, loaded, rpu: source });
  }
}
console.log(`ported RPU onto ${ported} products`);

function referenceSp(rnd, pa, sum) {
  if (rnd === "round") return Math.floor(Math.round(pa * sum * 1e9) / 1e9 + 0.5);
  if (rnd === "raw") return Math.round(pa * sum * 1e6) / 1e6;
  return Math.ceil(Math.round(pa * sum * 1e9) / 1e9);
}

const frozen = [];
for (const item of checks) {
  const { ENG, P } = item.loaded;
  const meta = P.meta;
  const ages = Object.values(meta.terms)[0];
  const term = Number(Object.keys(meta.terms)[0]);
  const samples = [
    { age: Math.min(ages[1], Math.max(ages[0], 30)), sex: 1, sum: meta.smin || 1 },
    { age: Math.min(ages[1], Math.max(ages[0], 40)), sex: 2, sum: meta.smin || 1 },
    { age: Math.min(ages[1], Math.max(ages[0], 50)), sex: 1, sum: Math.min(meta.smax || 10, (meta.smin || 1) * 2) },
  ];
  for (const sample of samples) {
    const key = ENG.key(meta, sample.sex, sample.age, term);
    const pack = item.rpu.keys[key];
    if (!pack) continue;
    const year = pack.PA.findIndex((value) => value > 0) + 1;
    if (!year) continue;
    const reduced = referenceSp(item.rpu.rnd, pack.PA[year - 1], sample.sum);
    let expect = { reducedSum: reduced };
    if (!meta.isr && !item.rpu.saOnly) {
      const prem = ENG.prem(meta, P.data, sample.sex, sample.age, term, sample.sum, item.product.method1, item.product.method2);
      const mode = ENG.modes(meta, P.data, key).includes("PUA") ? "PUA" : "SAVE";
      const quoted = ENG.quote(meta, P.data, sample.sex, sample.age, term, sample.sum, 2, mode, prem.p1, prem.p2);
      const context = { Math, ENG, M: meta, D: P.data, RPU: item.rpu, RPU_cr: (data, id, t, pay) => {
        const ratio = (point) => {
          const cash = data.CV[id][point - 1];
          const reserve = data.PVFB0[id][point];
          return cash > 0 && reserve > 0 ? Math.min(1, cash / reserve) : 1;
        };
        if (t < (pay || 1) && item.rpu.keys[id]?.PV?.[t - 1] > 0) return Math.min(1, item.rpu.keys[id].CV[t - 1] / item.rpu.keys[id].PV[t - 1]);
        return ratio(Math.max(t, pay || 1));
      } };
      vm.createContext(context);
      vm.runInContext(`
        const cuR=x=>Math.ceil(Math.round(x*1e9)/1e9);
        const SpF=(pa,S)=>RPU.rnd=='round'?Math.floor(Math.round(pa*S*1e9)/1e9+0.5):RPU.rnd=='raw'?Math.round(pa*S*1e6)/1e6:cuR(pa*S);
        function project(key,S,term,sc,p1,p2,N,ymax,age){
          const R=M.rup?ENG.cu:ENG.rh,rh=ENG.rh,f=sc?1:0,bk=key+(sc||1),B=D.BONU[bk],BD=D.BONUDIE&&D.BONUDIE[bk],BC=D.BONUCV&&D.BONUCV[bk],SV=D.SRV&&D.SRV[key],payN=M.payYears=='term'?term:term-age;
          let NP=0,cum=0,Sp=null,rows=[];
          for(let t=1;t<=ymax;t++){
            const cv=N>0&&t>N; if(cv&&Sp==null)Sp=SpF(RPU.keys[key].PA[N-1],S);
            const u=cv?Sp/1e4:S,Kb=(f&&B)?B[t-1]:0;let H,I;
            if(!cv){H=R(D.DIE[key][t-1]*S);I=R(D.CV[key][t-1]*S);}else{H=R(u*D._DIE2[key][t-1]);I=R(u*(D.PVFB0[key][t]||0)*RPU_cr(D,key,t,term));}
            const K=f?R(u*Kb)+((t>1&&M.puaK)?R(NP/1e4*Kb):0):0, pv=D.PVFB[key][t]||0;
            if(t<ymax&&pv)NP+=M.mDiv?rh(K/(pv/1e4)):rh(K/pv);
            const ex=(t==ymax&&M.finalExtra)?K:0, Q=R(NP/1e4*D._DIE2[key][t-1])+ex, R0=R(NP/1e4*D.PVFB0[key][t])+ex;
            const AD=BD?R(f*u*BD[t-1]):0, AE=BC?R(f*u*BC[t-1]):0, Fs=SV?R(SV[t-1]*u):0, Os=SV?R(SV[t-1]*NP/1e4):0;
            const py=(!cv&&t<=payN)?(t==1?p1:p2):0; cum+=py;
            rows.push({t,W:H+Q+AD,X:I+R0+AE,py,cum});
          } return {rows,Sp};}
        out = project(${JSON.stringify(key)}, ${sample.sum}, ${term}, 2, ${prem.p1}, ${prem.p2}, ${year}, ${quoted.rows.length}, ${sample.age});
      `, context);
      const later = Math.min(context.out.rows.length, year + 5) - 1;
      expect = { reducedSum: context.out.Sp, death: context.out.rows[later].W, surrender: context.out.rows[later].X, at: later + 1 };
    } else if (meta.isr) {
      const prem = ENG.prem(meta, P.data, sample.sex, sample.age, term, sample.sum, item.product.method1, item.product.method2);
      const mode = (meta.isrModes || ["PUA"]).includes("PUA") ? "PUA" : (meta.isrModes || ["PS"])[0];
      const quoted = ENG.quoteIsr(meta, P.data, sample.sex, sample.age, term, sample.sum, meta.declIllus || meta.assumed, mode, prem.p1, prem.p2, meta.effDate, { n: year, Sp: reduced });
      const later = Math.min(quoted.rows.length, year + 5) - 1;
      expect = { reducedSum: reduced, death: quoted.rows[later].W, surrender: quoted.rows[later].X, at: later + 1, mode, declaredRate: meta.declIllus || meta.assumed };
    } else {
      expect = { reducedSum: reduced, sumOnly: true };
    }
    const ours = quoteRpu(item.product, {
      age: sample.age,
      sex: sample.sex,
      term,
      sum: sample.sum,
      rpuYear: year,
      scenario: 2,
      declaredRate: expect.declaredRate,
      mode: expect.mode,
    });
    const gotDeath = ours.rows ? ours.rows[expect.at - 1].W : null;
    const gotSurrender = ours.rows ? ours.rows[expect.at - 1].X : null;
    const ok = ours.reducedSum === expect.reducedSum && (expect.sumOnly || (gotDeath === expect.death && gotSurrender === expect.surrender));
    console.log(item.code, sample.age, sample.sex, "year", year, ok ? "ok" : `MIS reduced ${ours.reducedSum}/${expect.reducedSum} death ${gotDeath}/${expect.death} x ${gotSurrender}/${expect.surrender}`);
    if (ok) frozen.push({ code: item.code, age: sample.age, sex: sample.sex, term, sum: sample.sum, rpuYear: year, scenario: 2, declaredRate: expect.declaredRate || null, mode: expect.mode || null, expect });
  }
}
fs.writeFileSync(path.join(root, "data/rpu-checks.json"), JSON.stringify(frozen, null, 2));
console.log("checks", frozen.length);
