// Fake @supabase/supabase-js for browser tests: in-memory records table, auth and the 3 public RPCs.
(function(){
  const DB = window.__FAKEDB = window.__FAKEDB || { rows: new Map(), session: null, chans: [], log: [] };
  try{const s=sessionStorage.getItem('fakeSession');if(s)DB.session=JSON.parse(s)}catch(e){}
  const key=(c,id)=>c+'\u0001'+id;
  const seed = window.__SEED || []; seed.forEach(r=>DB.rows.set(key(r.collection,r.id),r));
  const tmin=t=>{const p=String(t).split(':');return +p[0]*60+(+p[1]||0)};
  const rpcs = {
    bg_my_role:()=>window.__ROLE||'owner',
    bg_team:()=>window.__TEAM||[{email:'kate@test',role:'owner',last_sign_in_at:'2026-10-24T09:00:00Z'},{email:'amy@test',role:'admin',last_sign_in_at:null},{email:'new@test',role:'none',last_sign_in_at:null}],
    bg_set_role:(a)=>{DB.log.push(['role',a.p_email,a.p_role]);window.__TEAM=(window.__TEAM||[{email:'kate@test',role:'owner',last_sign_in_at:'2026-10-24T09:00:00Z'},{email:'amy@test',role:'admin',last_sign_in_at:null},{email:'new@test',role:'none',last_sign_in_at:null}]).map(u=>u.email===a.p_email?Object.assign({},u,{role:a.p_role}):u);return null},
    public_booking_config:()=>{const r=DB.rows.get(key('pubcfg','main'));return r?r.data:{}},
    public_busy:({p_from,p_to})=>[...DB.rows.values()].filter(r=>r.collection==='slots'&&r.data.date>=p_from&&r.data.date<=p_to).map(r=>({date:r.data.date,s:r.data.s,e:r.data.e,staff:r.data.staff})),
    public_request_booking:(a)=>{
      const cfg=rpcs.public_booking_config();if(!cfg.services)return{ok:false,error:'not_configured'};
      const svc=cfg.services.find(s=>s.id===a.p_service);if(!svc)return{ok:false,error:'unknown_service'};
      const buf=cfg.buffer||0;let staff=null;
      for(const st of cfg.staff){const clash=[...DB.rows.values()].some(r=>r.collection==='slots'&&r.data.date===a.p_date&&r.data.staff===st&&r.data.s<a.p_start+svc.dur+buf&&a.p_start<r.data.e);if(!clash){staff=st;break}}
      if(!staff)return{ok:false,error:'taken'};
      const id='x'+Date.now().toString(16)+Math.random().toString(16).slice(2,6);
      DB.rows.set(key('slots',id),{collection:'slots',id,data:{id,date:a.p_date,s:a.p_start,e:a.p_start+svc.dur+buf,staff,st:'Pending confirmation',ts:Date.now()}});
      const rid='y'+id;DB.rows.set(key('inbox',rid),{collection:'inbox',id:rid,data:{id:rid,name:a.p_name,phone:a.p_phone,serviceId:svc.id,svcName:svc.name,price:svc.price,date:a.p_date,start:a.p_start,dur:svc.dur,staff,source:a.p_source,notes:a.p_notes,status:'New',apptId:id,ts:Date.now()}});
      return{ok:true,staff,dur:svc.dur,slotId:id};
    }
  };
  function qb(){
    const q={f:[],op:'select',range:null,row:null,single:false};
    const run=()=>{
      if(!DB.session&&q.op!=='rpc'){return {data:null,error:{message:'permission denied for table records',code:'42501'}}}
      const match=r=>q.f.every(([k,v])=>r[k]===v);
      if(q.op==='select'){let rows=[...DB.rows.values()].filter(match).sort((a,b)=>a.id<b.id?-1:1);if(q.range)rows=rows.slice(q.range[0],q.range[1]+1);
        if(q.single)return{data:rows[0]||null,error:null};return{data:rows.map(r=>({id:r.id,collection:r.collection,data:r.data})),error:null}}
      if(q.op==='upsert'){const r=q.row;DB.rows.set(key(r.collection,r.id),r);DB.log.push(['upsert',r.collection,r.id]);return{data:null,error:null}}
      if(q.op==='delete'){[...DB.rows.entries()].forEach(([k,r])=>{if(match(r))DB.rows.delete(k)});return{data:null,error:null}}
    };
    const api={select(){q.op='select';return api},eq(k,v){q.f.push([k,v]);return api},order(){return api},range(a,b){q.range=[a,b];return api},
      maybeSingle(){q.single=true;return api},upsert(row){q.op='upsert';q.row=row;return api},delete(){q.op='delete';return api},
      then(res,rej){return Promise.resolve(run()).then(res,rej)}};
    return api;
  }
  window.supabase={createClient:()=>({
    from:()=>qb(),
    rpc:async(name,args)=>{DB.log.push(['rpc',name]);try{return{data:rpcs[name](args||{}),error:null}}catch(e){return{data:null,error:{message:String(e)}}}},
    channel:()=>{const c={on(){return c},subscribe(cb){setTimeout(()=>cb&&cb('SUBSCRIBED'),10);return c}};return c},
    auth:{
      async getSession(){return{data:{session:DB.session}}},
      async signInWithPassword({email,password}){if(password==='correct-horse'){DB.session={user:{id:'u1',email}};sessionStorage.setItem('fakeSession',JSON.stringify(DB.session));return{data:{session:DB.session},error:null}}return{data:{},error:{message:'Invalid login credentials'}}},
      async signOut(){DB.session=null;sessionStorage.removeItem('fakeSession')},
      onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},
      async resetPasswordForEmail(){return{error:null}},async updateUser(){return{error:null}}
    }})};
})();
