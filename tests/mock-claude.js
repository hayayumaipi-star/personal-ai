/* 本番の claude.ai を模す：db は凍結したデータを返す。sample と downloads も用意する。 */
(function(){
  var store={};
  function deepFreeze(o){
    if(o&&typeof o==="object"){ Object.getOwnPropertyNames(o).forEach(function(k){deepFreeze(o[k]);}); Object.freeze(o); }
    return o;
  }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function docRef(path){
    return {
      id: path.split("/").pop(), path: path,
      get: function(){ var v=store[path]; return Promise.resolve({id:this.id,exists:!!v,data:function(){return v;},metadata:{}}); },
      set: function(d){
        if(!d||typeof d!=="object"||Array.isArray(d)) return Promise.reject({code:"invalid_argument",message:"body must be an object"});
        var s=JSON.stringify(d);
        if(s.length>262144) return Promise.reject({code:"invalid_argument",message:"document too large"});
        store[path]=deepFreeze(clone(d)); return Promise.resolve();
      },
      delete: function(){ delete store[path]; return Promise.resolve(); },
      collection: function(p){ return colRef(path+"/"+p); }
    };
  }
  function colRef(path){
    var self={ path:path, _limit:1000,
      limit: function(n){ self._limit=n; return self; },
      where: function(){ return self; }, orderBy: function(){ return self; },
      get: function(){
        var docs=Object.keys(store).filter(function(k){
          return k.indexOf(path+"/")===0 && k.slice(path.length+1).indexOf("/")<0;
        }).slice(0,self._limit).map(function(k){
          return {id:k.split("/").pop(),exists:true,data:function(){return store[k];},metadata:{}};
        });
        return Promise.resolve({docs:docs,size:docs.length,empty:!docs.length,docChanges:function(){return [];},metadata:{}});
      },
      doc: function(id){ return docRef(path+"/"+(id||("auto"+Math.random().toString(36).slice(2)))); }
    };
    return self;
  }
  var DB={ doc:function(p){return docRef(p);}, collection:function(p){return colRef(p);} };

  function makeSample(){
    var f=function(input,opts){
      return Promise.resolve({text:"うん、聞いたよ。",truncated:false,modelTierApplied:(opts&&opts.modelTier)||"default"});
    };
    f.json=function(input){
      var s=String(input);
      if(/その人について/.test(s)){   // 資料からの「わたしのこと」
        return Promise.resolve([{text:"人前で発表するのが苦手",category:"苦手・制約",quote:"人前で発表するのは昔から苦手です"}]);
      }
      var ops=[];
      if(/歯医者/.test(s)) ops.push({op:"add",kind:"event",title:"歯医者に行く",dueDate:"2026-09-13",dueTime:"15:00",travelMin:30,quote:"歯医者に行く"});
      if(/資料/.test(s)) ops.push({op:"add",kind:"task",title:"資料を作る",dueDate:"2026-09-13",estimateMin:120,targetDate:"2026-09-12",preferWindow:"morning",quote:"資料を作らないと"});
      if(/牛乳/.test(s)) ops.push({op:"add",kind:"task",title:"牛乳を買っておく",quote:"牛乳を買っておく"});
      if(/美容院/.test(s)) ops.push({op:"add",kind:"event",title:"美容院の予約",dueDate:"2026-09-16",quote:"美容院の予約"});
      if(/面談/.test(s)) ops.push({op:"add",kind:"event",title:"面談",dueDate:"2026-09-14",dueTime:"10:00",quote:"面談"});
      if(/打ち合わせ/.test(s)) ops.push({op:"add",kind:"event",title:"打ち合わせ",dueDate:"2026-09-13",dueTime:"11:00",quote:"打ち合わせ"});
      if(/眠|寝てない/.test(s)) ops.push({op:"condition",text:"あんまり寝ていなくて眠い",quote:"眠い"});
      return Promise.resolve({ops:ops,reply:"わかった、入れておくね。"});
    };
    f.limits=function(){return Promise.resolve({maxPromptBytes:65536});};
    return f;
  }
  window.claude={ use:function(n){
    if(n==="db") return Promise.resolve(DB);
    if(n==="sample") return Promise.resolve(makeSample());
    if(n==="downloads") return Promise.resolve({save:function(){return Promise.resolve();}});
    return Promise.resolve(null);
  }};
})();