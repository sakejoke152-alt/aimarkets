// ╔══════════════════════════════════════════════════╗
// ║  app.js — Fresh Harvest · Supabase + Gemini      ║
// ║  ⚙️  CFG-dagi placeholder-larni almashtırıń      ║
// ╚══════════════════════════════════════════════════╝

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Sazlamalar ────────────────────────────────────────
export const CFG = {
  SUPABASE_URL : 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON: 'YOUR_ANON_KEY',
  GEMINI_KEY   : 'YOUR_GEMINI_API_KEY',
  GEMINI_MODEL : 'gemini-2.5-flash-preview-05-20',
  ADMIN_PHONE  : '998901234567',
  IMG_BUCKET   : 'product-images',
};

// ── Supabase client ───────────────────────────────────
export const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON);

// ── Auth ─────────────────────────────────────────────
export const Auth = {
  login(phone) {
    const d = phone.replace(/\D/g,'');
    if (d.length < 9) return { err: 'Nomer noto\'ǵrı' };
    const role = d.endsWith(CFG.ADMIN_PHONE) || phone==='admin' ? 'admin' : 'user';
    const u = { phone, role, name: role==='admin' ? 'Admin' : 'Paydalanıwshı' };
    localStorage.setItem('fh_user', JSON.stringify(u));
    return { user: u };
  },
  logout() { localStorage.removeItem('fh_user'); },
  me()     { return JSON.parse(localStorage.getItem('fh_user')||'null'); },
  isAdmin(){ return this.me()?.role === 'admin'; },
};

// ── DB ───────────────────────────────────────────────
export const DB = {
  async all() {
    const { data, error } = await sb.from('products').select('*').order('id');
    if (error) throw error;
    // Supabase Storage-dan public URL qo'shish
    return (data||[]).map(p => ({
      ...p,
      image_url: p.image_url?.startsWith('http')
        ? p.image_url
        : sb.storage.from(CFG.IMG_BUCKET).getPublicUrl(p.image_url||'').data.publicUrl
    }));
  },

  // Real-time: soft animation bilan callback chaqiradi
  realtime(cb) {
    this.all().then(cb).catch(console.error);
    const ch = sb.channel('fh-rt')
      .on('postgres_changes', { event:'*', schema:'public', table:'products' },
          async () => cb(await this.all()))
      .subscribe(s => {
        if (s==='CHANNEL_ERROR'||s==='TIMED_OUT') {
          // Polling fallback
          if (!this._poll) this._poll = setInterval(async()=>cb(await this.all()), 6000);
        } else if (s==='SUBSCRIBED') {
          clearInterval(this._poll); this._poll = null;
        }
      });
    return () => { sb.removeChannel(ch); clearInterval(this._poll); };
  },

  async add(p)       { const {data,error}=await sb.from('products').insert([p]).select().single(); if(error)throw error; return data; },
  async update(id,p) { const {error}=await sb.from('products').update(p).eq('id',id); if(error)throw error; },
  async delete(id)   { const {error}=await sb.from('products').delete().eq('id',id); if(error)throw error; },
};

// ── Storage ───────────────────────────────────────────
export const Store = {
  async upload(file, onPct) {
    if (!file?.type.startsWith('image/')) throw new Error('Tek rasm fayllar');
    if (file.size > 5*1024*1024) throw new Error('Rasm 5MB dan kichik bolıwı kerek');
    const blob = await this._compress(file, 900, 0.85);
    onPct?.(40);
    const name = `p_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
    const { error } = await sb.storage.from(CFG.IMG_BUCKET).upload(name, blob, { contentType:'image/jpeg' });
    if (error) throw error;
    onPct?.(100);
    return sb.storage.from(CFG.IMG_BUCKET).getPublicUrl(name).data.publicUrl;
  },
  _compress(file, max, q) {
    return new Promise((ok, fail) => {
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(u);
        let {width:w, height:h} = img;
        if (w>max||h>max) w>h ? (h=h*max/w|0,w=max) : (w=w*max/h|0,h=max);
        const c = document.createElement('canvas');
        c.width=w; c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        c.toBlob(b=>b?ok(b):fail(Error('Siqıw xatası')),'image/jpeg',q);
      };
      img.onerror = () => fail(Error('Rasm oqilmadi'));
      img.src = u;
    });
  },
};

// ── Sebet ─────────────────────────────────────────────
export const Cart = {
  get()      { return JSON.parse(localStorage.getItem('fh_cart')||'[]'); },
  save(c)    { localStorage.setItem('fh_cart', JSON.stringify(c)); },
  add(p)     { const c=this.get(), f=c.find(z=>z.id===p.id); f?f.qty++:c.push({...p,qty:1}); this.save(c); },
  dec(id)    { this.save(this.get().map(z=>z.id===id?{...z,qty:z.qty-1}:z).filter(z=>z.qty>0)); },
  clear()    { this.save([]); },
  qty()      { return this.get().reduce((s,z)=>s+z.qty,0); },
  total()    { return this.get().reduce((s,z)=>s+z.price*z.qty,0); },
};

// ── Gemini — faqat knopka bosilganda chaqiriladi ──────
export const Gemini = {
  _busy: false,

  async ask(prompt) {
    if (this._busy) return null;
    if (!CFG.GEMINI_KEY || CFG.GEMINI_KEY==='YOUR_GEMINI_API_KEY')
      return { _fallback: true };
    this._busy = true;
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${CFG.GEMINI_MODEL}:generateContent?key=${CFG.GEMINI_KEY}`,
        { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ contents:[{parts:[{text:prompt}]}],
            generationConfig:{ maxOutputTokens:600, temperature:0.7 } }) }
      );
      const j = await r.json();
      return JSON.parse((j.candidates?.[0]?.content?.parts?.[0]?.text||'{}')
        .replace(/```json|```/g,'').trim());
    } catch { return { _fallback: true }; }
    finally  { this._busy = false; }
  },

  // 1️⃣ Reseptlar
  async reseptlar(cart) {
    const r = await this.ask(
      `Ingredients: ${cart.map(z=>z.name).join(',')}. ` +
      `3 quick recipes in Karakalpak. JSON: [{"nom":"...","vaqt":"5 min","desc":"..."}]`
    );
    if (r?._fallback) return this._reseptFallback(cart);
    return Array.isArray(r) ? r : this._reseptFallback(cart);
  },
  _reseptFallback(cart) {
    const c = new Set(cart.map(z=>z.category));
    const r = [];
    if (c.has('paliz')&&c.has('sut'))   r.push({nom:'Palızlı salat',    vaqt:'5 min', desc:'Kók shóp + pendir'});
    if (c.has('miyweler'))              r.push({nom:'Miywe salatı',      vaqt:'7 min', desc:'Kesip aralashtırıw'});
    if (c.has('nan'))                   r.push({nom:'Tez sandvich',      vaqt:'3 min', desc:'Non + sebet zatları'});
    if (c.has('sut')&&!c.has('paliz')) r.push({nom:'Sútli smoothie',    vaqt:'2 min', desc:'Sút + miywe'});
    return r.slice(0,3);
  },

  // 4️⃣ Iqtisad
  async iqtisad(cart, all) {
    const top = [...cart].sort((a,b)=>b.price-a.price)[0];
    if (!top) return [];
    const alts = all.filter(t=>t.category===top.category&&t.price<top.price&&!cart.find(z=>z.id===t.id));
    const r = await this.ask(
      `Cart total: ${Cart.total()} sum. Most expensive: ${top.name}(${top.price}). ` +
      `Cheaper alternatives: ${alts.slice(0,5).map(t=>`${t.name}(${t.price})`).join(',')}. ` +
      `Best 2 swaps to save money. JSON: [{"from":"...","to":"...","tejeydi":5000}]`
    );
    if (r?._fallback) return alts[0] ? [{from:top.name,to:alts[0].name,tejeydi:top.price-alts[0].price}] : [];
    return Array.isArray(r) ? r : [];
  },

  // 5️⃣ Admin tavsif
  async tavsif(name, cat) {
    const r = await this.ask(`"${name}" (${cat}) Karakalpak marketing desc, 15-20 words. JSON: {"text":"..."}`);
    return r?._fallback||!r?.text ? `Taze ${name} — sifatli hám organik ónım 🌿` : r.text;
  },

  // 7️⃣ Saǵlamlılıq
  async saglik(cart) {
    const r = await this.ask(
      `Cart: ${cart.map(z=>`${z.name}(${z.calories}cal)`).join(',')}. ` +
      `Nutritional balance. JSON: {"score":7,"good":["..."],"bad":["..."],"add":["..."]}`
    );
    if (r?._fallback||!r?.score) return this._saglikFallback(cart);
    return r;
  },
  _saglikFallback(cart) {
    const c=new Set(cart.map(z=>z.category));
    const good=[],bad=[],add=[];
    c.has('miyweler')?good.push('Vitamin bar ✅'):bad.push('Miywe kem')&&add.push('Alma');
    c.has('paliz')   ?good.push('Palız bar ✅') :bad.push('Palız joq')&&add.push('Kók shóp');
    c.has('sut')     ?good.push('Sút bar ✅')   :add.push('Kefir');
    return { score: Math.min(good.length*3+1,10), good, bad, add };
  },

  // 8️⃣ Voice
  async voice(text, all) {
    const r = await this.ask(
      `User said: "${text}". Products: ${all.map(t=>t.name).join(',')}. ` +
      `Match product names. JSON: {"matches":["..."]}`
    );
    const names = r?._fallback ? [] : (r?.matches||[]);
    return names.length
      ? all.filter(t=>names.some(n=>t.name.toLowerCase().includes(n.toLowerCase())))
      : all.filter(t=>t.name.toLowerCase().includes(text.toLowerCase())).slice(0,4);
  },
};

// ── Yordamchi ─────────────────────────────────────────
export const som   = n => `${(n||0).toLocaleString()} so'm`;
export const catIc = k => ({miyweler:'🍎',sut:'🥛',paliz:'🥦',nan:'🍞'}[k]||'📦');
export const plImg = n => `https://placehold.co/400x280/f0fdf4/10b981?text=${encodeURIComponent(n||'?')}`;

// ═══════════════════════════════════════════════════════
// AI CHAT — Gemini 2.5 Vision + resept logikasi
// ═══════════════════════════════════════════════════════
export const AiChat = {

  // Asosiy Gemini 2.5 chaqiruvi (rasm + matn qo'llab-quvvatlaydi)
  async call(parts) {
    const key = CFG.GEMINI_KEY;
    if (!key || key === 'YOUR_GEMINI_API_KEY') return null;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${CFG.GEMINI_MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { maxOutputTokens: 1500, temperature: 0.7 }
        })
      }
    );
    const j = await res.json();
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
    try { return JSON.parse(text.replace(/```json|```/g,'').trim()); }
    catch { return { text }; }
  },

  // 📸 RASM → RESEPT
  async rasmResept(base64, mime, portion, shopList) {
    return this.call([
      { inline_data: { mime_type: mime, data: base64 } },
      { text: `Siz oshpaz yordamchisiz. Rasmni tahlil qilib, ${portion} kishilik resept tuzing.
Do'konda bor mahsulotlar: ${shopList}.
Faqat JSON qaytaring:
{"taom":"...","emoji":"🥘","vaqt":"30 min","qiyinlik":"Oson","porsiya":${portion},
"ingredientlar":[{"nom":"...","miqdor":"...","dukonda_bor":true}],
"qadamlar":["1. ...","2. ..."],
"maslahat":"..."}`
      }
    ]);
  },

  // 🔄 NIMAM BOR?
  async nimamBor(text, portion, shopList) {
    return this.call([{ text:
      `Foydalanuvchi qo'lida: "${text}". ${portion} kishilik.
Do'konda: ${shopList}.
2 ta taom tavsiya qiling. JSON:
{"taomlar":[{"taom":"...","emoji":"🍽️","vaqt":"...","qiyinlik":"...","porsiya":${portion},
"ingredientlar":[{"nom":"...","miqdor":"...","dukonda_bor":true}],
"qadamlar":["..."]}]}`
    }]);
  },

  // 💰 BYUDJET
  async byudjet(summa, ovqatTuri, portion, shopList) {
    return this.call([{ text:
      `${ovqatTuri} uchun ${summa} so'm. ${portion} kishi. Do'konda: ${shopList}.
Eng mos taomni tavsiya qiling. JSON:
{"taom":"...","emoji":"🍽️","jami_narx":45000,"vaqt":"...","qiyinlik":"...","porsiya":${portion},
"ingredientlar":[{"nom":"...","miqdor":"...","narx":5000,"dukonda_bor":true}],
"qadamlar":["..."],"tejash_maslahati":"..."}`
    }]);
  },

  // 🗓️ HAFTALIK MENYU
  async haftalikMenu(portion, shopList) {
    return this.call([{ text:
      `${portion} kishilik 5 kunlik menyu. Do'konda: ${shopList}. JSON:
{"hafta":[
{"kun":"Dushanba","nonushta":{"taom":"...","emoji":"🥣"},"tushlik":{"taom":"...","emoji":"🍲"},"kechki":{"taom":"...","emoji":"🥗"}},
{"kun":"Seshanba","nonushta":{"taom":"...","emoji":"🥣"},"tushlik":{"taom":"...","emoji":"🍲"},"kechki":{"taom":"...","emoji":"🥗"}},
{"kun":"Chorshanba","nonushta":{"taom":"...","emoji":"🥣"},"tushlik":{"taom":"...","emoji":"🍲"},"kechki":{"taom":"...","emoji":"🥗"}},
{"kun":"Payshanba","nonushta":{"taom":"...","emoji":"🥣"},"tushlik":{"taom":"...","emoji":"🍲"},"kechki":{"taom":"...","emoji":"🥗"}},
{"kun":"Juma","nonushta":{"taom":"...","emoji":"🥣"},"tushlik":{"taom":"...","emoji":"🍲"},"kechki":{"taom":"...","emoji":"🥗"}}
],"kerakli_mahsulotlar":["..."]}`
    }]);
  },

  // 📊 PORSIYA KALKULYATORI
  async porsiya(taomNomi, portion, shopList) {
    return this.call([{ text:
      `"${taomNomi}" taomini aniq ${portion} kishilik ingredientlarini hisoblang. Do'konda: ${shopList}. JSON:
{"taom":"${taomNomi}","emoji":"🥘","porsiya":${portion},
"ingredientlar":[{"nom":"...","miqdor":"...","dukonda_bor":true}],
"maslahat":"..."}`
    }]);
  },

  // Demo fallback (API key yo'q bo'lganda)
  demo(mode, portion) {
    const base = {
      taom:'Sabzavotli osh', emoji:'🥘', vaqt:'45 min', qiyinlik:"O'rta", porsiya: portion,
      ingredientlar:[
        {nom:'Guruch',  miqdor:portion*100+'g',  dukonda_bor:true},
        {nom:'Sabzi',   miqdor:portion+' dona',   dukonda_bor:false},
        {nom:'Piyoz',   miqdor:portion+' dona',   dukonda_bor:false},
        {nom:"Go'sht",  miqdor:portion*125+'g',   dukonda_bor:false},
        {nom:"O'simlik yog'i", miqdor:'100 ml',    dukonda_bor:false},
      ],
      qadamlar:[
        "Guruchni yuvib 20 daqiqa suvda qoldiring",
        "Piyoz va sabzini to'g'rang",
        "Qozonda yog'ni qizdiring, piyozni qovorib oling",
        "Go'sht va sabzini solib, 15 daqiqa qovuring",
        "Guruch solib, ikki baravar suv quying va qopqog'ini yoping",
        "Quruq bug'lanib pishguncha 20-25 daqiqa kutib turing"
      ],
      maslahat:"Oshni zira va qalampir bilan to'yintirsangiz yanada mazali bo'ladi!"
    };
    if (mode === 'hafta') return {
      hafta:[
        {kun:'Dushanba',nonushta:{taom:'Tuxum qovurma',emoji:'🍳'},tushlik:{taom:'Lag\'mon',emoji:'🍜'},kechki:{taom:'Salat',emoji:'🥗'}},
        {kun:'Seshanba',nonushta:{taom:'Choy va non',emoji:'🍵'},tushlik:{taom:'Manti',emoji:'🥟'},kechki:{taom:'Osh',emoji:'🥘'}},
        {kun:'Chorshanba',nonushta:{taom:'Qaymoqli non',emoji:'🍞'},tushlik:{taom:'Shurva',emoji:'🍲'},kechki:{taom:'Somsa',emoji:'🥐'}},
        {kun:'Payshanba',nonushta:{taom:'Sut bilan jo\'xori',emoji:'🥛'},tushlik:{taom:'Plov',emoji:'🍚'},kechki:{taom:'Qovurma',emoji:'🍖'}},
        {kun:'Juma',nonushta:{taom:'Tvorog',emoji:'🧀'},tushlik:{taom:'Dimlama',emoji:'🥘'},kechki:{taom:'Chuchvara',emoji:'🥟'}},
      ],
      kerakli_mahsulotlar:['Guruch','Sabzi','Piyoz','Go\'sht','Tuxum','Un']
    };
    return base;
  }
};
