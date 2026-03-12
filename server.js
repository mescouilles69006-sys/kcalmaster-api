const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(cors({ origin: function(o,cb){cb(null,true)}, methods:['GET','POST','OPTIONS'], allowedHeaders:['Content-Type','Authorization'], credentials:true }));

const GROQ_API_KEY      = process.env.GROQ_API_KEY;
const GROQ_URL          = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_CHAT_MODEL   = 'llama-3.3-70b-versatile';
const GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const GFIT_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID || '241850404756-f3mulk7lvrgsos28gcah1gi9nuie6jd8.apps.googleusercontent.com';
const GFIT_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GFIT_REDIRECT_URI  = 'https://kcalmaster-api.onrender.com/api/gfit/callback';
const GFIT_SCOPES        = 'https://www.googleapis.com/auth/fitness.activity.read https://www.googleapis.com/auth/fitness.sleep.read https://www.googleapis.com/auth/fitness.heart_rate.read';

// Stockage temporaire tokens (TTL 10 min)
const _pendingTokens = new Map();
function _store(state, data){ _pendingTokens.set(state,{...data,ts:Date.now()}); setTimeout(()=>_pendingTokens.delete(state),600000); }
setInterval(()=>{ const n=Date.now(); _pendingTokens.forEach((v,k)=>{ if(n-v.ts>600000) _pendingTokens.delete(k); }); },300000);

async function callGroq(body, retries=2){
  for(let a=0;a<=retries;a++){
    try{
      const r=await fetch(GROQ_URL,{method:'POST',headers:{'Authorization':`Bearer ${GROQ_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
      const d=await r.json();
      if(!r.ok){ if((r.status===429||r.status===503)&&a<retries){await new Promise(r=>setTimeout(r,(a+1)*3000));continue;} throw{status:r.status,message:d.error?.message||'Groq error'}; }
      return d;
    }catch(e){ if(e.status) throw e; if(a<retries){await new Promise(r=>setTimeout(r,2000));continue;} throw{status:500,message:e.message}; }
  }
}

app.get('/',(req,res)=>res.json({status:'ok',service:'KcalMaster API (Groq)'}));
app.get('/health',(req,res)=>res.json({status:'OK',models:{chat:GROQ_CHAT_MODEL,vision:GROQ_VISION_MODEL},gfit:GFIT_CLIENT_SECRET?'✅':'⚠️ secret manquant'}));

app.post('/api/claude',async(req,res)=>{
  try{
    if(!GROQ_API_KEY) return res.status(500).json({error:'GROQ_API_KEY not configured'});
    const{messages,max_tokens=1000}=req.body;
    if(!messages||!Array.isArray(messages)) return res.status(400).json({error:'messages[] requis'});
    console.log(`📡 /api/claude — model: ${GROQ_CHAT_MODEL} max_tokens: ${max_tokens}`);
    const d=await callGroq({model:GROQ_CHAT_MODEL,messages,max_tokens,temperature:0.7});
    res.json({content:[{type:'text',text:d.choices[0].message.content}]});
  }catch(e){console.error('❌ /api/claude:',e);res.status(e.status||500).json({error:e.message||'Server error'});}
});

app.post('/api/vision',async(req,res)=>{
  try{
    if(!GROQ_API_KEY) return res.status(500).json({error:'GROQ_API_KEY not configured'});
    const{image_base64,prompt='Analysez ce repas'}=req.body;
    if(!image_base64) return res.status(400).json({error:'image_base64 requis'});
    console.log(`📷 /api/vision — model: ${GROQ_VISION_MODEL}`);
    const d=await callGroq({model:GROQ_VISION_MODEL,messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${image_base64}`}}]}],max_tokens:1024});
    res.json({content:[{type:'text',text:d.choices[0].message.content}]});
  }catch(e){console.error('❌ /api/vision:',e);res.status(e.status||500).json({error:e.message||'Server error'});}
});

// ══ GOOGLE FIT — Flux Chrome système + polling ══

app.get('/api/gfit/auth',(req,res)=>{
  if(!GFIT_CLIENT_SECRET) return res.status(500).send('<h2>GOOGLE_CLIENT_SECRET manquant dans Render</h2>');
  const state=req.query.state||('s'+Math.random().toString(36).slice(2));
  const url='https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:GFIT_CLIENT_ID,redirect_uri:GFIT_REDIRECT_URI,scope:GFIT_SCOPES,response_type:'code',access_type:'offline',prompt:'consent',state}).toString();
  console.log(`🔗 /api/gfit/auth — state:${state.slice(0,8)}`);
  res.redirect(url);
});

app.get('/api/gfit/callback',async(req,res)=>{
  const{code,error,state}=req.query;
  if(error||!code){
    if(state) _store(state,{error:error||'cancelled'});
    return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KcalMaster</title></head><body style="font-family:sans-serif;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;text-align:center;padding:24px"><div style="font-size:3rem">❌</div><h2>Connexion annulée</h2><p style="color:#888">Retournez dans KcalMaster et réessayez.</p></body></html>`);
  }
  try{
    const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:GFIT_CLIENT_ID,client_secret:GFIT_CLIENT_SECRET,redirect_uri:GFIT_REDIRECT_URI,grant_type:'authorization_code'}).toString()});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error_description||d.error||'Token exchange failed');
    console.log(`✅ Token obtenu — state:${(state||'').slice(0,8)}`);
    if(state) _store(state,{access_token:d.access_token,expires_in:d.expires_in||3600,refresh_token:d.refresh_token||''});
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KcalMaster — Succès</title><style>body{font-family:-apple-system,sans-serif;background:#0d1117;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;text-align:center;padding:24px;box-sizing:border-box}.icon{font-size:4rem;margin-bottom:16px;animation:pop .4s cubic-bezier(.34,1.56,.64,1)}@keyframes pop{0%{transform:scale(0)}100%{transform:scale(1)}}h2{color:#00e676;margin:0 0 10px}p{color:#888;font-size:.9rem;line-height:1.6;margin:0 0 24px}.badge{background:rgba(0,230,118,.1);border:1px solid rgba(0,230,118,.3);border-radius:12px;padding:14px 20px;font-size:.85rem;color:#00e676}</style></head><body><div class="icon">✅</div><h2>Google Fit connecté !</h2><p>Votre compte est lié à KcalMaster.<br>Vous pouvez fermer cet onglet et retourner dans l'application.</p><div class="badge">🏃 Synchronisation active</div></body></html>`);
  }catch(e){
    console.error('❌ callback error:',e.message);
    if(state) _store(state,{error:e.message});
    res.status(500).send(`<html><body style="background:#111;color:#fff;padding:40px;text-align:center;font-family:sans-serif"><h2>❌ Erreur</h2><p>${e.message}</p></body></html>`);
  }
});

// L'app poll cette route pour récupérer le token
app.get('/api/gfit/token',(req,res)=>{
  const{state}=req.query;
  if(!state) return res.status(400).json({error:'state requis'});
  const p=_pendingTokens.get(state);
  if(!p) return res.json({status:'pending'});
  if(p.error){ _pendingTokens.delete(state); return res.json({status:'error',error:p.error}); }
  _pendingTokens.delete(state);
  console.log(`📦 Token récupéré — state:${state.slice(0,8)}`);
  res.json({status:'ok',access_token:p.access_token,expires_in:p.expires_in,refresh_token:p.refresh_token});
});

app.post('/api/gfit/data',async(req,res)=>{
  const auth=req.headers.authorization;
  if(!auth||!auth.startsWith('Bearer ')) return res.status(401).json({error:'Token manquant'});
  const token=auth.split(' ')[1];
  const{startMs,endMs}=req.body;
  if(!startMs||!endMs) return res.status(400).json({error:'startMs et endMs requis'});
  const h={'Authorization':`Bearer ${token}`,'Content-Type':'application/json'};

  // Agrégat journalier — bucketByTime sur toute la période pour avoir 1 seul bucket
  const agg=(t)=>JSON.stringify({
    aggregateBy:[{dataTypeName:t}],
    bucketByTime:{durationMillis: endMs - startMs},
    startTimeMillis:startMs,
    endTimeMillis:endMs
  });

  // Agrégat pas uniquement depuis la source "derived" (montre, pas téléphone)
  // Google Fit : com.google.step_count.delta avec dataSourceId derived filtre les doublons
  const aggStepsDerived=JSON.stringify({
    aggregateBy:[{dataTypeName:'com.google.step_count.delta',dataSourceId:'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps'}],
    bucketByTime:{durationMillis: endMs - startMs},
    startTimeMillis:startMs,
    endTimeMillis:endMs
  });

  // Agrégat FC par tranches de 30 minutes pour la courbe
  const aggHR30=JSON.stringify({
    aggregateBy:[{dataTypeName:'com.google.heart_rate.bpm'}],
    bucketByTime:{durationMillis:1800000},
    startTimeMillis:startMs,
    endTimeMillis:endMs
  });

  try{
    const[sr,cr,slr,hrr,hrPoints30r]=await Promise.all([
      fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',{method:'POST',headers:h,body:aggStepsDerived}),
      fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',{method:'POST',headers:h,body:agg('com.google.calories.expended')}),
      fetch(`https://www.googleapis.com/fitness/v1/users/me/sessions?startTime=${new Date(startMs).toISOString()}&endTime=${new Date(endMs).toISOString()}&activityType=72`,{headers:h}),
      fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',{method:'POST',headers:h,body:agg('com.google.heart_rate.bpm')}),
      fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',{method:'POST',headers:h,body:aggHR30})
    ]);

    if(sr.status===401) return res.status(401).json({error:'Token expiré'});
    const[sd,cd,sld,hrd,hrPtsD]=await Promise.all([sr.json(),cr.json(),slr.json(),hrr.json(),hrPoints30r.json()]);

    // Pas — somme sur le bucket unique
    let steps=0;
    (sd.bucket||[]).forEach(b=>(b.dataset||[]).forEach(ds=>(ds.point||[]).forEach(pt=>{
      steps+=(pt.value||[]).reduce((a,v)=>a+(v.intVal||0),0);
    })));

    // Calories brûlées (montre)
    let cal=0;
    (cd.bucket||[]).forEach(b=>(b.dataset||[]).forEach(ds=>(ds.point||[]).forEach(pt=>{
      cal+=(pt.value||[]).reduce((a,v)=>a+(v.fpVal||0),0);
    })));

    // Sommeil
    let sleep=0;
    (sld.session||[]).forEach(s=>{sleep+=(parseInt(s.endTimeMillis)-parseInt(s.startTimeMillis))/3600000;});

    // FC — moyenne, min, max
    let hrVals=[];
    (hrd.bucket||[]).forEach(b=>(b.dataset||[]).forEach(ds=>(ds.point||[]).forEach(pt=>{
      (pt.value||[]).forEach(v=>{ if(v.fpVal>0) hrVals.push(v.fpVal); });
    })));
    const hrAvg = hrVals.length>0 ? Math.round(hrVals.reduce((a,b)=>a+b,0)/hrVals.length) : 0;
    const hrMin = hrVals.length>0 ? Math.round(Math.min.apply(null,hrVals)) : 0;
    const hrMax = hrVals.length>0 ? Math.round(Math.max.apply(null,hrVals)) : 0;

    // Points FC toutes les 30 min pour la courbe
    const hrPoints=[];
    (hrPtsD.bucket||[]).forEach(bucket=>{
      const bucketStart=parseInt(bucket.startTimeMillis);
      (bucket.dataset||[]).forEach(ds=>(ds.point||[]).forEach(pt=>{
        const vals=(pt.value||[]).filter(v=>v.fpVal>0).map(v=>v.fpVal);
        if(vals.length>0){
          const avg=Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
          hrPoints.push({t:bucketStart,v:avg});
        }
      }));
    });
    const hrPointsSorted=[...new Map(hrPoints.map(p=>[p.t,p])).values()].sort((a,b)=>a.t-b.t);

    console.log(`📊 steps:${steps} cal:${Math.round(cal)} sleep:${sleep.toFixed(1)}h FC:${hrAvg}bpm points:${hrPointsSorted.length}`);

    res.json({
      steps,
      calBurned: Math.round(cal),
      sleepHours: parseFloat(sleep.toFixed(1)),
      distKm: parseFloat((steps*0.00075).toFixed(2)),
      hrAvg, hrMin, hrMax,
      hrPoints: hrPointsSorted
    });

  }catch(e){
    console.error('❌ /api/gfit/data error:',e);
    res.status(500).json({error:e.message});
  }
});

app.post('/api/gfit/refresh',async(req,res)=>{
  const{refresh_token}=req.body;
  if(!refresh_token) return res.status(400).json({error:'refresh_token requis'});
  if(!GFIT_CLIENT_SECRET) return res.status(500).json({error:'GOOGLE_CLIENT_SECRET manquant'});
  try{
    const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({refresh_token,client_id:GFIT_CLIENT_ID,client_secret:GFIT_CLIENT_SECRET,grant_type:'refresh_token'}).toString()});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error_description||'Refresh failed');
    res.json({access_token:d.access_token,expires_in:d.expires_in||3600});
  }catch(e){res.status(500).json({error:e.message});}
});

app.use((err,req,res,next)=>{ console.error('Unhandled:',err); res.status(500).json({error:'Internal server error'}); });

const PORT=process.env.PORT||3000, HOST=process.env.HOST||'0.0.0.0';
app.listen(PORT,HOST,()=>{
  console.log(`🚀 KcalMaster API running on http://${HOST}:${PORT}`);
  console.log(`📡 Chat: ${GROQ_CHAT_MODEL} | 📷 Vision: ${GROQ_VISION_MODEL}`);
  console.log(`🔑 GROQ: ${GROQ_API_KEY?'✅':'❌'} | 🏃 GFit: ${GFIT_CLIENT_SECRET?'✅':'⚠️ secret manquant'}`);
});
