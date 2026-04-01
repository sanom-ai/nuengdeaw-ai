'use strict';
// น้องหนึ่งเดียวAIโดย2026ตะวัน

// ============================================================================
// NUENGDEAW HUMAN SIMULATOR — COMPLETE + ENHANCED
// ============================================================================
// CHANGELOG (เพิ่มจาก รุ่นก่อน):
//   [+] Personality Drift       — Big-5 เปลี่ยนช้าตามประสบการณ์ (growth model)
//   [+] Semantic Memory         — episodic consolidation → semantic + autobiographical
//   [+] Deception Micro-Leak    — cognitive cost + micro-expression leak rate
//
// References (เพิ่มเติม):
//   - McAdams, D.P. (2001). The psychology of life stories. (narrative identity / autobiographical)
//   - McCrae, R.R. & Costa, P.T. (2003). Personality in Adulthood. (Big-5 longitudinal drift)
//   - Tulving, E. (1972). Episodic and semantic memory. (memory consolidation)
//   - Ekman, P. (2003). Emotions Revealed. (micro-expression leakage)
// ============================================================================

// ============================================================================
// SECTION 1: CONSTANTS & REFERENCE DATA
// ============================================================================

const EMOTION_STATES = [
  'FLOW','READY','STRESS','CONFUSION','BOREDOM','EXCITEMENT','FATIGUE','NEUTRAL',
  'FRUSTRATION','ANXIETY','CURIOSITY','DISGUST','SURPRISE','CALM',
];

const _PHYSIO_REF = {
  FLOW:        { hrv:[52,6,28,80],  hr:[66,5,54,80],   gsr:[2.8,0.8,1.0,6.5],  rr:[13,2,9,18],  eeg:[0.55,0.10,0.25,0.90] },
  READY:       { hrv:[56,5,36,78],  hr:[62,5,50,76],   gsr:[2.2,0.6,1.0,5.0],  rr:[11,2,8,16],  eeg:[0.40,0.08,0.20,0.70] },
  STRESS:      { hrv:[18,4,10,30],  hr:[108,8,85,132], gsr:[15,3,8.0,25],       rr:[25,4,18,35], eeg:[3.10,0.30,2.0,4.2]   },
  CONFUSION:   { hrv:[22,5,12,36],  hr:[98,7,78,120],  gsr:[11,2,6.0,18],       rr:[22,3,16,30], eeg:[2.60,0.25,1.8,3.6]   },
  BOREDOM:     { hrv:[36,5,22,52],  hr:[66,4,56,78],   gsr:[8.5,1.5,5.0,14],   rr:[14,2,10,18], eeg:[1.30,0.15,0.8,1.9]   },
  EXCITEMENT:  { hrv:[34,5,20,50],  hr:[92,8,74,118],  gsr:[12,2,7.0,20],       rr:[20,3,14,28], eeg:[1.70,0.20,1.0,2.6]   },
  FATIGUE:     { hrv:[30,5,16,46],  hr:[70,5,58,86],   gsr:[3.5,0.8,1.5,7.5],  rr:[16,2,11,22], eeg:[1.10,0.12,0.6,1.7]   },
  NEUTRAL:     { hrv:[38,6,22,58],  hr:[72,6,57,92],   gsr:[4.5,1.0,2.0,9.0],  rr:[15,2,10,20], eeg:[1.00,0.10,0.5,1.5]   },
  FRUSTRATION: { hrv:[16,4,8,28],   hr:[112,9,90,138], gsr:[17,3,10.0,28],      rr:[26,4,18,36], eeg:[3.30,0.30,2.2,4.5]   },
  ANXIETY:     { hrv:[14,3,7,24],   hr:[115,9,92,140], gsr:[16,3,9.0,26],       rr:[28,5,20,38], eeg:[3.50,0.35,2.4,4.8]   },
  CURIOSITY:   { hrv:[44,5,28,64],  hr:[78,6,64,96],   gsr:[5.5,1.0,2.5,10],   rr:[16,2,11,22], eeg:[1.20,0.14,0.6,2.0]   },
  DISGUST:     { hrv:[20,4,10,32],  hr:[90,7,72,112],  gsr:[13,2,7.0,22],       rr:[20,3,14,28], eeg:[2.20,0.22,1.4,3.2]   },
  SURPRISE:    { hrv:[28,6,14,44],  hr:[100,10,78,130],gsr:[14,3,7.0,24],       rr:[22,4,14,32], eeg:[2.00,0.25,1.2,3.0]   },
  CALM:        { hrv:[62,6,40,90],  hr:[58,4,46,70],   gsr:[1.8,0.5,0.6,4.0],  rr:[10,2,6,14],  eeg:[0.38,0.08,0.18,0.65] },
};

const _EEG_BAND_REF = {
  FLOW:        { theta:0.90, alpha:2.20, beta:1.00, gamma:0.50 },
  READY:       { theta:0.70, alpha:2.50, beta:0.80, gamma:0.30 },
  STRESS:      { theta:1.40, alpha:0.60, beta:2.80, gamma:1.20 },
  CONFUSION:   { theta:2.20, alpha:0.80, beta:2.00, gamma:0.80 },
  BOREDOM:     { theta:1.80, alpha:1.20, beta:0.70, gamma:0.20 },
  EXCITEMENT:  { theta:1.00, alpha:1.00, beta:2.50, gamma:1.50 },
  FATIGUE:     { theta:2.50, alpha:1.50, beta:0.50, gamma:0.20 },
  NEUTRAL:     { theta:1.00, alpha:1.00, beta:1.00, gamma:0.50 },
  FRUSTRATION: { theta:1.80, alpha:0.50, beta:2.60, gamma:0.90 },
  ANXIETY:     { theta:1.20, alpha:0.55, beta:3.20, gamma:1.10 },
  CURIOSITY:   { theta:1.60, alpha:1.30, beta:1.40, gamma:1.80 },
  DISGUST:     { theta:1.50, alpha:0.70, beta:1.80, gamma:0.60 },
  SURPRISE:    { theta:0.80, alpha:0.60, beta:2.20, gamma:2.00 },
  CALM:        { theta:0.60, alpha:3.00, beta:0.50, gamma:0.15 },
};

const _STATE_ORDER = [
  'FLOW','READY','STRESS','CONFUSION','BOREDOM','EXCITEMENT','FATIGUE','NEUTRAL',
  'FRUSTRATION','ANXIETY','CURIOSITY','DISGUST','SURPRISE','CALM',
];

const _MARKOV_TBL = {
  FLOW:       [0.55,0.12,0.02,0.03,0.04,0.07,0.03,0.02,0.01,0.01,0.05,0.01,0.01,0.03],
  READY:      [0.18,0.42,0.03,0.06,0.03,0.05,0.03,0.03,0.02,0.02,0.07,0.01,0.02,0.03],
  STRESS:     [0.02,0.04,0.40,0.12,0.02,0.01,0.14,0.05,0.10,0.07,0.01,0.01,0.01,0.00],
  CONFUSION:  [0.04,0.08,0.14,0.36,0.05,0.02,0.09,0.04,0.08,0.05,0.03,0.01,0.01,0.00],
  BOREDOM:    [0.06,0.08,0.03,0.04,0.38,0.12,0.06,0.04,0.04,0.02,0.07,0.02,0.02,0.02],
  EXCITEMENT: [0.14,0.07,0.06,0.03,0.04,0.36,0.05,0.09,0.03,0.03,0.04,0.01,0.04,0.01],
  FATIGUE:    [0.03,0.05,0.09,0.06,0.12,0.02,0.42,0.04,0.06,0.05,0.02,0.01,0.01,0.02],
  NEUTRAL:    [0.08,0.13,0.06,0.06,0.10,0.08,0.08,0.22,0.04,0.04,0.05,0.02,0.03,0.01],
  FRUSTRATION:[0.02,0.04,0.22,0.10,0.02,0.02,0.08,0.06,0.32,0.08,0.01,0.01,0.00,0.00],
  ANXIETY:    [0.01,0.03,0.20,0.08,0.02,0.02,0.10,0.06,0.08,0.32,0.02,0.01,0.01,0.04],
  CURIOSITY:  [0.12,0.10,0.02,0.04,0.03,0.10,0.03,0.05,0.02,0.02,0.36,0.02,0.05,0.04],
  DISGUST:    [0.02,0.04,0.10,0.08,0.05,0.02,0.07,0.10,0.06,0.06,0.02,0.32,0.02,0.04],
  SURPRISE:   [0.05,0.08,0.06,0.06,0.04,0.12,0.03,0.10,0.04,0.06,0.10,0.02,0.20,0.04],
  CALM:       [0.08,0.10,0.01,0.02,0.06,0.04,0.04,0.10,0.01,0.02,0.06,0.02,0.02,0.42],
};

const COGNITIVE_THRESHOLDS = { UNDERLOAD:0.3, OPTIMAL_MIN:0.3, OPTIMAL_MAX:0.7, OVERLOAD:0.7 };
const WORKING_MEMORY_CONFIG = { CAPACITY_MEAN:7, CAPACITY_RANGE:2, DECAY_RATE:0.75, REHEARSAL_BOOST:0.5 };
const LEARNING_CONFIG = { OPERANT_SUCCESS_BOOST:0.05, OPERANT_FAILURE_PENALTY:0.03, ANXIETY_BUILDUP:0.02, CONFIDENCE_TO_FLOW:0.24 };

const EVENT_IMPACTS = {
  criticism:          { stress:0.40, frustration:0.30, anxiety:0.20 },
  praise:             { confidence:0.20, excitement:0.15, flow:0.10 },
  deadline_approaching:{ stress:0.30, anxiety:0.25, timePressure:0.40 },
  social_pressure:    { anxiety:0.25, masking:0.30 },
  success:            { confidence:0.15, excitement:0.20, flow:0.10 },
  failure:            { frustration:0.30, anxiety:0.10, confidence:-0.20 },
  memory_recall:      { stress:0.15, surprise:0.20 },
  cognitive_overload: { stress:0.25, confusion:0.30, frustration:0.20 },
};

const _CIRCADIAN_TABLE = {
   0:[-8,4,-1.2],  1:[-12,6,-1.6], 2:[-15,7,-1.9], 3:[-18,8,-2.0],
   4:[-18,8,-2.0], 5:[-15,7,-1.8], 6:[-10,5,-1.4], 7:[-5,3,-1.0],
   8:[-2,2,-0.5],  9:[0,0,0.0],   10:[2,-1,0.3],  11:[3,-2,0.5],
  12:[2,-1,0.3],  13:[1,0,0.2],   14:[-3,2,-0.4], 15:[-2,1,-0.3],
  16:[1,-1,0.2],  17:[3,-2,0.4],  18:[4,-2,0.5],  19:[5,-3,0.6],
  20:[5,-3,0.6],  21:[4,-2,0.5],  22:[2,-1,0.3],  23:[-3,2,-0.6],
};

const TASK_EEG_MODIFIERS = {
  problem_solving: { theta:1.35, alpha:0.90, beta:1.10, gamma:1.00 },
  creativity:      { theta:1.10, alpha:1.35, beta:1.05, gamma:1.25 },
  concentration:   { theta:0.85, alpha:0.80, beta:1.40, gamma:1.10 },
  mind_wandering:  { theta:1.35, alpha:1.25, beta:0.70, gamma:0.80 },
  neutral:         { theta:1.00, alpha:1.00, beta:1.00, gamma:1.00 },
};

const MICROSTATES = { A:'self_referential', B:'visual', C:'salience', D:'attention' };

const _DEFAULT_PERSONALITY = {
  openness:0.5, conscientiousness:0.5, extraversion:0.5, agreeableness:0.5, neuroticism:0.5,
};
const _DEFAULT_CONTEXT = {
  timeOfDay:'morning', dayOfWeek:1, socialContext:'alone', taskType:'learning',
  environment:'quiet', caffeineIntake:0, sleepQuality:7, ambientTemp:23, systolicBP:120,
};

// ============================================================================
// SECTION 2: UTILITIES
// ============================================================================

const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _randn = () => { let u=0,v=0; while(!u)u=Math.random(); while(!v)v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
const _lerp = (a, b, t) => a + (b-a)*t;

// ============================================================================
// SECTION 3: CORE HUMAN SIMULATOR
// ============================================================================

const HumanSim = (() => {
  let _state='NEUTRAL', _prevState='NEUTRAL', _tickCount=0, _stateAge=0, _refractory=0;
  let _scenarioQ=[], _history=[];
  let _personality = { ..._DEFAULT_PERSONALITY };
  let _context = { ..._DEFAULT_CONTEXT };
  const _iaf = 9.5 + (Math.random()-0.5)*1.5;
  let _p300=null, _empathyBoost=null;

  const _ou = {
    hrv:{x:38,th:0.07,sig:1.4}, hr:{x:72,th:0.07,sig:1.8}, gsr:{x:4.5,th:0.09,sig:0.38},
    rr:{x:15,th:0.06,sig:0.75}, eeg:{x:1.0,th:0.11,sig:0.05},
    theta_b:{x:1.0,th:0.09,sig:0.07}, alpha_b:{x:1.0,th:0.09,sig:0.07},
    beta_b:{x:1.0,th:0.11,sig:0.09},  gamma_b:{x:0.5,th:0.14,sig:0.06},
  };

  let _hour=new Date().getHours(), _sleepP=0, _ultra=0;
  const _ultraRate = (2*Math.PI)/10800;

  const _ouStep = (key,mu) => { const o=_ou[key]; o.x=_clamp(o.x+o.th*(mu-o.x)+o.sig*_randn(),-99999,99999); return o.x; };
  const _sample = (key,state) => { const [mean,,lo,hi]=_PHYSIO_REF[state][key]; return _clamp(_ouStep(key,mean),lo,hi); };

  const _applyContextBaseline = (bio) => {
    const c=_context;
    if(c.socialContext==='with_friends'){bio.gsr+=1.5;bio.hr+=3;}
    if(c.socialContext==='in_class'){bio.gsr+=2.0;bio.hr+=4;}
    if(c.socialContext==='presentation'){bio.gsr+=4.0;bio.hr+=8;}
    bio.hr=_clamp(bio.hr+c.caffeineIntake*0.02,40,145);
    const sp=(10-c.sleepQuality)*0.04;
    bio.hrv=_clamp(bio.hrv-sp*8,6,95);
    bio.hr=_clamp(bio.hr+sp*4,40,145);
    return bio;
  };
  const _applyPersonalityBaseline = (bio) => {
    const p=_personality;
    bio.hr=_clamp(bio.hr+(p.extraversion-0.5)*6,40,145);
    bio.gsr=_clamp(bio.gsr+(p.extraversion-0.5)*1.5,0.3,28);
    bio.hrv=_clamp(bio.hrv-(p.neuroticism-0.5)*8,6,95);
    return bio;
  };
  const _thermoRegulation = (bio) => { const t=_context.ambientTemp; if(t>28)bio.gsr=_clamp(bio.gsr*1.2,0.3,28); else if(t<18)bio.gsr=_clamp(bio.gsr*0.7,0.3,28); return bio; };
  const _baroreflex    = (bio) => { bio.hr=_clamp(bio.hr-(_context.systolicBP-120)*0.05,40,145); return bio; };
  const _addRSA        = (bio) => { const a=8/Math.max(bio.rr,4); bio.hrv=_clamp(bio.hrv+a*Math.sin(Date.now()/(60000/Math.max(bio.rr,4))),6,95); return bio; };
  const _crossCorr     = (bio) => { const r=_PHYSIO_REF[_state]; const d=bio.hrv-r.hrv[0]; bio.hr=_clamp(bio.hr-0.42*d,r.hr[2],r.hr[3]); bio.gsr=_clamp(bio.gsr+0.018*(bio.hr-r.hr[0]),r.gsr[2],r.gsr[3]); return bio; };
  const _circadianCorr = (bio) => {
    const [dH,dR,dG]=_CIRCADIAN_TABLE[_hour]||[0,0,0]; const u=Math.sin(_ultra); const sp=_sleepP;
    bio.hrv=_clamp(bio.hrv+dH+u*3.0-sp*11.0,8,95);
    bio.hr =_clamp(bio.hr+dR-u*1.8+sp*5.5,40,145);
    bio.gsr=_clamp(bio.gsr+dG+u*0.5+sp*2.0,0.3,28);
    bio.rr =_clamp(bio.rr-dH*0.1+u*0.6+sp*1.5,6,36);
    bio.eeg=_clamp(bio.eeg-dH*0.018+sp*0.30,0.05,5.0);
    return bio;
  };
  const _tickCircadian = () => { _ultra=(_ultra+_ultraRate)%(2*Math.PI); _sleepP=Math.min(1.0,_sleepP+1/115200); if(_tickCount%7200===0)_hour=new Date().getHours(); };
  const _getMicrostate  = () => ({FLOW:'D',READY:'D',STRESS:'C',CONFUSION:'C',BOREDOM:'A',EXCITEMENT:'B',FATIGUE:'A',NEUTRAL:'A',FRUSTRATION:'C',ANXIETY:'C',CURIOSITY:'B',DISGUST:'C',SURPRISE:'B',CALM:'A'}[_state]??'A');
  const _computePAC     = (tp,ga) => ga*Math.cos(tp);

  // ── SECTION 4: COGNITIVE ──────────────────────────────────────────────────
  let _cognitiveLoad=0.5, _taskDifficulty=0.5, _timePressure=0.3, _taskType='neutral';
  let _workingMemory={items:[],lastRehearsal:0}, _errorRate=0.05, _attentionFocus=0.8;
  let _heuristicBiasEnabled=true;

  const _updateCognitiveLoad = () => {
    const sf=['STRESS','ANXIETY','FRUSTRATION'].includes(_state)?0.4:_state==='CONFUSION'?0.3:0.1;
    const ff=_state==='FATIGUE'?0.3:_state==='BOREDOM'?0.1:0;
    _cognitiveLoad=_clamp(_taskDifficulty*0.4+sf*0.3+ff*0.2+_timePressure*0.1,0,1);
    if(_cognitiveLoad>COGNITIVE_THRESHOLDS.OVERLOAD) _errorRate=_clamp(_errorRate+0.02,0.05,0.35);
    else if(_cognitiveLoad<COGNITIVE_THRESHOLDS.UNDERLOAD) _errorRate=_clamp(_errorRate-0.01,0.02,0.25);
    else _errorRate=_clamp(_errorRate*0.99,0.02,0.20);
    _attentionFocus=_clamp(0.9-(_cognitiveLoad*0.3)+(Math.random()-0.5)*0.1,0.3,0.95);
    return _cognitiveLoad;
  };
  const _updateWorkingMemory = () => {
    const cap=WORKING_MEMORY_CONFIG.CAPACITY_MEAN+(Math.random()-0.5)*WORKING_MEMORY_CONFIG.CAPACITY_RANGE;
    const now=Date.now()/1000; const decay=WORKING_MEMORY_CONFIG.DECAY_RATE*Math.min(now-_workingMemory.lastRehearsal,10);
    _workingMemory.items=_workingMemory.items.filter(i=>{i.strength-=decay;return i.strength>0.1;});
    while(_workingMemory.items.length>cap)_workingMemory.items.shift();
    _workingMemory.lastRehearsal=now;
  };
  const _makeDecision = (options) => {
    if(!_heuristicBiasEnabled||Math.random()>0.7) return options.reduce((b,o)=>o.value>b.value?o:b,options[0]);
    const sl=['STRESS','ANXIETY'].includes(_state)?0.7:0.3;
    const rb=_personality.extraversion>0.6?0.7:0.3;
    if(Math.random()<sl) return options.reduce((b,o)=>(o.risk||0)<(b.risk||0)?o:b,options[0]);
    if(Math.random()<rb) return options.reduce((b,o)=>(o.risk||0)>(b.risk||0)?o:b,options[0]);
    return options[Math.floor(Math.random()*options.length)];
  };

  // ── SECTION 5: MEMORY & LEARNING ─────────────────────────────────────────
  let _episodicMemory=[];
  let _conditioning={
    classical:new Map(),
    operant:{successCount:0,failureCount:0,confidence:0.5,anxietyBaseline:0.3,avoidance:new Map()},
  };
  let _learningEnabled=true, _memoryPersistence=false;

  // ── [NEW] SEMANTIC MEMORY ────────────────────────────────────────────
  // Tulving (1972): episodic → semantic consolidation based on emotional intensity
  let _semanticMemory = {
    concepts: new Map(),      // key → { strength, count, associations[], lastAccess }
    autobiographical: [],     // เหตุการณ์สำคัญระดับ "ความทรงจำชีวิต"
  };

  const _consolidateToSemantic = (episode) => {
    const highArousal = ['STRESS','ANXIETY','FLOW','FRUSTRATION','EXCITEMENT'].includes(episode.state);
    const intensity = highArousal ? 0.75 : 0.25;
    if(Math.random() > intensity) return; // ไม่ทุก episode ถูก consolidate

    const key = `${episode.type}_${episode.state}`;
    const existing = _semanticMemory.concepts.get(key) || { strength:0, count:0, associations:[], lastAccess:0 };
    existing.strength = _clamp(existing.strength + 0.08, 0, 1);
    existing.count++;
    existing.lastAccess = Date.now();
    if(_context.taskType && !existing.associations.includes(_context.taskType))
      existing.associations.push(_context.taskType);
    _semanticMemory.concepts.set(key, existing);

    // autobiographical: เฉพาะ intensity สูงมาก + random gate
    if(intensity > 0.6 && Math.random() < 0.25) {
      _semanticMemory.autobiographical.push({
        summary: `${episode.state} during ${_context.taskType} (${_context.socialContext})`,
        strength: intensity,
        emotionalTag: episode.state,
        ts: Date.now(),
      });
      if(_semanticMemory.autobiographical.length > 60) _semanticMemory.autobiographical.shift();
    }
  };

  const _recordEpisodic = (event) => {
    const entry = { ...event, ts:Date.now(), state:_state, cognitiveLoad:_cognitiveLoad };
    _episodicMemory.push(entry);
    if(_episodicMemory.length > 200) _episodicMemory.shift();
    _consolidateToSemantic(entry); // [NEW]
    if(_memoryPersistence) {
      try { localStorage.setItem('nuengdeaw_episodic', JSON.stringify(_episodicMemory.slice(-50))); } catch(e){}
    }
  };

  const _applyOperantConditioning = (outcome) => {
    if(!_learningEnabled) return;
    if(outcome==='success') {
      _conditioning.operant.successCount++;
      _conditioning.operant.confidence=_clamp(_conditioning.operant.confidence+LEARNING_CONFIG.OPERANT_SUCCESS_BOOST,0,1);
      _conditioning.operant.anxietyBaseline=_clamp(_conditioning.operant.anxietyBaseline-0.01,0,0.8);
    } else if(outcome==='failure') {
      _conditioning.operant.failureCount++;
      _conditioning.operant.confidence=_clamp(_conditioning.operant.confidence-LEARNING_CONFIG.OPERANT_FAILURE_PENALTY,0,1);
      _conditioning.operant.anxietyBaseline=_clamp(_conditioning.operant.anxietyBaseline+LEARNING_CONFIG.ANXIETY_BUILDUP,0,1);
    }
  };
  const _applyClassicalConditioning = (stimulus, response) => {
    const key=`${stimulus}_${response}`; const cur=_conditioning.classical.get(key)||0;
    _conditioning.classical.set(key, _clamp(cur+0.05,0,1));
  };
  const _getConditionedResponse = (stimulus) => {
    let max=0, best=null;
    for(const [k,s] of _conditioning.classical.entries())
      if(k.startsWith(stimulus+'_')&&s>max){max=s;best=k.slice(stimulus.length+1);}
    return best;
  };

  // ── [NEW] PERSONALITY DRIFT ──────────────────────────────────────────
  // McCrae & Costa (2003): Big-5 เปลี่ยนช้าตามประสบการณ์สะสม
  let _personalityDrift = { lastDrift: Date.now(), flowCount: 0, stressCount: 0 };

  const _driftPersonality = () => {
    const elapsed = (Date.now() - _personalityDrift.lastDrift) / 1000;
    if(elapsed < 30) return; // drift ทุก ~30 วินาที sim-time

    const keys = ['openness','conscientiousness','extraversion','agreeableness','neuroticism'];
    for(const k of keys) {
      // baseline random walk ช้ามาก
      const delta = _randn() * 0.006;
      _personality[k] = _clamp(_personality[k] + delta, 0.05, 0.95);
    }

    // growth: FLOW บ่อย → neuroticism ↓, conscientiousness ↑
    if(_state === 'FLOW' && _stateAge > 15) {
      _personality.neuroticism      = _clamp(_personality.neuroticism      - 0.003, 0.05, 0.95);
      _personality.conscientiousness = _clamp(_personality.conscientiousness + 0.002, 0.05, 0.95);
    }
    // trauma pattern: STRESS/ANXIETY สะสม → neuroticism ↑, agreeableness ↓
    if(['STRESS','ANXIETY'].includes(_state) && _stateAge > 20) {
      _personality.neuroticism  = _clamp(_personality.neuroticism  + 0.002, 0.05, 0.95);
      _personality.agreeableness= _clamp(_personality.agreeableness- 0.001, 0.05, 0.95);
    }
    // success accumulation → openness ↑, confidence proxy
    if(_conditioning.operant.successCount > 0 && _conditioning.operant.successCount % 10 === 0) {
      _personality.openness = _clamp(_personality.openness + 0.005, 0.05, 0.95);
    }

    _personalityDrift.lastDrift = Date.now();
  };

  // ── SECTION 6: EVENT SYSTEM ───────────────────────────────────────────────
  let _pendingEvents=[], _emotionalInertia=0.5, _eventOverrideEnabled=true, _messyTransitionRate=0.05;

  const _triggerEvent = (eventName, intensity=1.0) => {
    const impact=EVENT_IMPACTS[eventName]; if(!impact) return false;
    _pendingEvents.push({ name:eventName, impact, intensity:_clamp(intensity,0,1), ts:Date.now() });
    _recordEpisodic({ type:'event', name:eventName, intensity });
    return true;
  };
  const _processEvents = () => {
    if(!_eventOverrideEnabled||!_pendingEvents.length) return null;
    let ts=0,ta=0,tf=0,tc=0,te=0;
    for(const ev of _pendingEvents) {
      const i=ev.intensity;
      ts+=(ev.impact.stress||0)*i; ta+=(ev.impact.anxiety||0)*i;
      tf+=(ev.impact.frustration||0)*i; tc+=(ev.impact.confidence||0)*i; te+=(ev.impact.excitement||0)*i;
    }
    _pendingEvents=[];
    if(ts>0.3)_applyClassicalConditioning('stressful_event','STRESS');
    if(tc>0.2)_applyOperantConditioning('success');
    const t=0.25;
    if(ts>t&&_state!=='STRESS')return'STRESS';
    if(ta>t&&_state!=='ANXIETY')return'ANXIETY';
    if(tf>t&&_state!=='FRUSTRATION')return'FRUSTRATION';
    if(te>t&&_state!=='EXCITEMENT')return'EXCITEMENT';
    if(tc!==0)_conditioning.operant.confidence=_clamp(_conditioning.operant.confidence+tc*0.3,0,1);
    return null;
  };

  // ── SECTION 7: SOCIAL INTELLIGENCE ───────────────────────────────────────
  let _socialContext='alone', _audienceSize=0, _socialStakes=0.3;
  let _theoryOfMindEnabled=true, _maskingLevel=0, _displayedEmotion='NEUTRAL';

  const _updateSocialPressure = () => _clamp((_audienceSize/100)*_socialStakes*(1-_personality.extraversion/2),0,1);
  const _updateMasking = () => {
    const sp=_updateSocialPressure();
    const base=_personality.neuroticism*0.5+(1-_personality.agreeableness)*0.3+sp*0.4;
    _maskingLevel=_clamp(base,0,1);

    // [NEW] DeceptionEngine micro-leak integration
    if(typeof DeceptionEngine!=='undefined'&&DeceptionEngine.isActive()) {
      const leak = DeceptionEngine.getMicroLeakRate(_personality);
      _maskingLevel=_clamp(_maskingLevel+DeceptionEngine.getLevel()*0.2,0,1);
      // cognitive cost จาก deception
      _cognitiveLoad=_clamp(_cognitiveLoad+DeceptionEngine.getCognitiveCost(),0,1);
      // micro-leak: แสดง true state แว่บเดียว
      if(DeceptionEngine.checkMicroLeak(leak)) {
        _displayedEmotion=_state;
        return; // ให้ leak ออกมา แล้วค่อย mask ใน tick ถัดไป
      }
    }

    if(Math.random()<_maskingLevel) {
      const safe=['NEUTRAL','CALM','READY'];
      _displayedEmotion=safe[Math.floor(Math.random()*safe.length)];
    } else {
      _displayedEmotion=_state;
    }
  };
  const _theoryOfMind = (otherState) => {
    if(!_theoryOfMindEnabled) return null;
    const emp=_personality.agreeableness*0.7+(1-_personality.neuroticism)*0.3;
    return { state:otherState, confidence:_clamp(0.5+emp*0.3+(Math.random()-0.5)*0.2,0,1) };
  };

  // ── SECTION 8: NOISE & ARTIFACT ───────────────────────────────────────────
  let _sensorDropoutRate=0, _contradictionMode=false, _inconsistencyLevel=0.15;

  const _applyNoise = (bio) => {
    if(_sensorDropoutRate>0&&Math.random()<_sensorDropoutRate) {
      const f=['hrv','hr','gsr','rr','eeg'][Math.floor(Math.random()*5)];
      bio[f]=null;
    }
    if(Math.random()<_inconsistencyLevel) {
      bio.hr+=(Math.random()-0.5)*8; bio.hrv+=(Math.random()-0.5)*6; bio.gsr+=(Math.random()-0.5)*1.5;
      bio=Object.fromEntries(Object.entries(bio).map(([k,v])=>[k,_clamp(v,0,999)]));
    }
    return bio;
  };
  const _applyContradiction = (bio) => {
    if(!_contradictionMode) return bio;
    if(['STRESS','ANXIETY'].includes(_state)) { bio.hr=_clamp(bio.hr*0.7,55,85); bio.hrv=_clamp(bio.hrv*1.3,35,70); bio.gsr=_clamp(bio.gsr*0.5,1,8); }
    if(_state==='CALM'&&Math.random()<0.3) { bio.hr=_clamp(bio.hr*1.4,80,120); bio.gsr=_clamp(bio.gsr*2.5,5,20); }
    return bio;
  };

  // ── STATE TRANSITIONS ─────────────────────────────────────────────────────
  const _nextState = () => {
    const row=[..._MARKOV_TBL[_state]]; const p=_personality;
    const idx=s=>_STATE_ORDER.indexOf(s);
    const boost=(s,val)=>{const i=idx(s);if(i>=0)row[i]=_clamp(row[i]+val,0,1);};
    if(p.neuroticism>0.5){boost('STRESS',(p.neuroticism-0.5)*0.30);boost('ANXIETY',(p.neuroticism-0.5)*0.30);boost('CALM',-(p.neuroticism-0.5)*0.20);}
    if(p.extraversion>0.5){boost('EXCITEMENT',(p.extraversion-0.5)*0.16);boost('BOREDOM',-(p.extraversion-0.5)*0.10);}
    if(p.conscientiousness>0.5){if(_state==='FLOW')boost('FLOW',(p.conscientiousness-0.5)*0.24);boost('BOREDOM',-(p.conscientiousness-0.5)*0.16);}
    boost('CURIOSITY',(p.openness-0.5)*0.12);
    const total=row.reduce((a,b)=>a+b,0); const norm=row.map(v=>v/total);
    let r=Math.random(),cum=0;
    for(let i=0;i<_STATE_ORDER.length;i++){cum+=norm[i];if(r<cum)return _STATE_ORDER[i];}
    return _state;
  };
  const _flipTo = (next) => {
    if(next===_state)return;
    _prevState=_state; _state=next; _stateAge=0; _refractory=3;
    _history.push({state:next,ts:Date.now()});
    if(_history.length>500)_history.shift();
    if(next==='SURPRISE')_p300={latency:300+Math.random()*50,amplitude:5+Math.random()*3,ts:Date.now()};
  };

  const _SCENARIOS = {
    wearable_monitoring_normal:['NEUTRAL','READY','READY','FLOW','FLOW','FLOW','FATIGUE','NEUTRAL'],
    acute_stress_episode:['READY','READY','STRESS','STRESS','STRESS','FATIGUE','FATIGUE','NEUTRAL'],
    hypoarousal_recovery:['NEUTRAL','BOREDOM','BOREDOM','EXCITEMENT','FLOW','FLOW'],
    anxiety_escalation:['READY','EXCITEMENT','STRESS','CONFUSION','CONFUSION','FATIGUE'],
    sympathetic_hyperactivation:['READY','ANXIETY','ANXIETY','STRESS','FRUSTRATION','FATIGUE','NEUTRAL'],
    positive_arousal_flow:['NEUTRAL','CURIOSITY','CURIOSITY','FLOW','FLOW','CALM'],
    recovery:['STRESS','FATIGUE','NEUTRAL','CALM','CALM','READY'],
  };

  // ── SECTION 9: MAIN TICK ──────────────────────────────────────────────────
  const _tick = () => {
    _tickCount++; _stateAge++;
    _tickCircadian();
    _updateWorkingMemory();
    _updateCognitiveLoad();
    _driftPersonality(); // [NEW]

    const evOverride=_processEvents();
    if(evOverride){_flipTo(evOverride);_refractory=2;}
    _updateMasking();

    if(_refractory>0){_refractory--;return;}
    const HIGH=['STRESS','CONFUSION','FRUSTRATION','ANXIETY'];
    const MED=['FLOW','FATIGUE','CALM'];
    let minDwell=HIGH.includes(_state)?6:MED.includes(_state)?4:2;
    if(_cognitiveLoad>0.7)minDwell+=2; if(_cognitiveLoad<0.3)minDwell-=1;
    const neuroExt=(['STRESS','ANXIETY'].includes(_state))?Math.round((_personality.neuroticism-0.5)*8):0;
    const conExt=_state==='FLOW'?Math.round((_personality.conscientiousness-0.5)*6):0;
    if(_stateAge<minDwell+neuroExt+conExt)return;
    if(_scenarioQ.length>0){
      const target=_scenarioQ[0];
      if(_state===target&&_stateAge>=minDwell+2)_scenarioQ.shift();
      else if(_state!==target)_flipTo(target);
    } else {
      if(Math.random()<_messyTransitionRate){
        const r=_STATE_ORDER[Math.floor(Math.random()*_STATE_ORDER.length)];
        if(r!==_state)_flipTo(r);
      } else {
        const next=_nextState();
        const inertia=_emotionalInertia*(HIGH.includes(_state)?1.5:1);
        if(Math.random()>inertia)_flipTo(next);
      }
    }
  };

  // ── GENERATE BIO ──────────────────────────────────────────────────────────
  const generateBio = () => {
    let bio={ hrv:_sample('hrv',_state), hr:_sample('hr',_state), gsr:_sample('gsr',_state), rr:_sample('rr',_state), eeg:_sample('eeg',_state) };
    bio=_crossCorr(bio); bio=_circadianCorr(bio); bio=_addRSA(bio); bio=_baroreflex(bio);
    bio=_thermoRegulation(bio); bio=_applyPersonalityBaseline(bio); bio=_applyContextBaseline(bio);
    bio.hr =_clamp(bio.hr +(_cognitiveLoad-0.5)*8,40,145);
    bio.gsr=_clamp(bio.gsr+(_cognitiveLoad-0.5)*2,0.3,28);
    const sp=_updateSocialPressure();
    bio.hr =_clamp(bio.hr +sp*5,40,145);
    bio.gsr=_clamp(bio.gsr+sp*1.5,0.3,28);
    if(_empathyBoost&&['STRESS','ANXIETY','FRUSTRATION'].includes(_state)){bio.hrv=_clamp(bio.hrv+_empathyBoost.hrvBoost,6,95);_empathyBoost=null;}
    bio=_applyNoise(bio);
    bio=_applyContradiction(bio);
    return bio;
  };

  // ── GENERATE EEG ─────────────────────────────────────────────────────────
  const generateEEGBands = () => {
    const t=_EEG_BAND_REF[_state];
    let theta=_clamp(_ouStep('theta_b',t.theta),0.10,5.0);
    let alpha=_clamp(_ouStep('alpha_b',t.alpha),0.10,5.0);
    let beta =_clamp(_ouStep('beta_b', t.beta), 0.10,6.0);
    let gamma=_clamp(_ouStep('gamma_b',t.gamma),0.05,3.0);
    const tm=TASK_EEG_MODIFIERS[_taskType]||TASK_EEG_MODIFIERS.neutral;
    theta=_clamp(theta*tm.theta,0.1,5.0); alpha=_clamp(alpha*tm.alpha,0.1,5.0);
    beta =_clamp(beta *tm.beta, 0.1,6.0); gamma=_clamp(gamma*tm.gamma,0.05,3.0);
    if(['CONFUSION','STRESS','FRUSTRATION'].includes(_state)) alpha=_clamp(alpha,0.1,Math.min(alpha,theta*0.55));
    if(['FLOW','READY'].includes(_state)){theta=_clamp(theta,0.1,Math.min(theta,alpha*0.50));beta=_clamp(beta,0.1,1.4);}
    if(_state==='FATIGUE'){beta=_clamp(beta*0.62,0.1,1.0);gamma=_clamp(gamma*0.58,0.05,0.5);}
    if(['EXCITEMENT','CURIOSITY'].includes(_state)) gamma=_clamp(gamma,Math.max(gamma,beta*0.58),3.0);
    if(_state==='CALM'){theta=_clamp(theta,0.1,Math.min(theta,alpha*0.25));beta=_clamp(beta*0.4,0.1,0.6);}
    if(_state==='ANXIETY'){beta=_clamp(beta,Math.max(beta,2.5),6.0);alpha=_clamp(alpha*0.5,0.1,1.0);}
    if(_state==='SURPRISE') gamma=_clamp(gamma*1.8,0.05,3.0);
    alpha=_clamp(alpha*(_iaf/10.0),0.1,5.0);
    const tp=(Date.now()/1000)*2*Math.PI*(t.theta*0.5);
    gamma=_clamp(gamma+_computePAC(tp,gamma)*0.06,0.05,3.0);
    return { theta,alpha,beta,gamma, thetaAlphaRatio:alpha>0.01?theta/alpha:1.0, iaf:_iaf, microstate:_getMicrostate(), microstateLabel:MICROSTATES[_getMicrostate()], p300:_p300 };
  };

  // ── PUBLIC API ────────────────────────────────────────────────────────────
  return {
    tick() { _tick(); },
    generateBio, generateEEGBands,
    getState()            { return _state; },
    getPrevState()        { return _prevState; },
    getDisplayedEmotion() { return _displayedEmotion; },
    getTick()             { return _tickCount; },
    getHistory()          { return [..._history]; },
    getPersonality()      { return { ..._personality }; },
    getContext()          { return { ..._context }; },

    getCognitiveLoad()    { return _cognitiveLoad; },
    getErrorRate()        { return _errorRate; },
    getAttentionFocus()   { return _attentionFocus; },
    getWorkingMemory()    { return { items:[..._workingMemory.items], capacity:WORKING_MEMORY_CONFIG.CAPACITY_MEAN }; },
    setTaskDifficulty(d)  { _taskDifficulty=_clamp(d,0,1); },
    setTimePressure(p)    { _timePressure=_clamp(p,0,1); },
    setTaskType(t)        { if(TASK_EEG_MODIFIERS[t])_taskType=t; },
    makeDecision(opts)    { return _makeDecision(opts); },
    enableHeuristicBias(e){ _heuristicBiasEnabled=e; },

    getMemory() {
      return {
        episodic:[..._episodicMemory],
        semantic: {                                    // [NEW]
          concepts: Object.fromEntries(_semanticMemory.concepts),
          autobiographical:[..._semanticMemory.autobiographical],
        },
        conditioning:{ classical:Object.fromEntries(_conditioning.classical), operant:{..._conditioning.operant} },
      };
    },
    recordOutcome(o)       { _applyOperantConditioning(o); _recordEpisodic({type:'outcome',outcome:o}); },
    recallRecent(n=10)     { return _episodicMemory.slice(-n); },
    recallSemantic(key)    { return _semanticMemory.concepts.get(key)||null; }, // [NEW]
    getAutobiographical()  { return [..._semanticMemory.autobiographical]; },   // [NEW]
    getConfidence()        { return _conditioning.operant.confidence; },
    getAnxietyBaseline()   { return _conditioning.operant.anxietyBaseline; },
    enableLearning(e)      { _learningEnabled=e; },
    enableMemoryPersistence(e){ _memoryPersistence=e; },

    triggerEvent(n,i=1.0)  { return _triggerEvent(n,i); },
    setEmotionalInertia(i) { _emotionalInertia=_clamp(i,0.3,0.7); },
    enableEventOverride(e) { _eventOverrideEnabled=e; },
    setMessyTransitionRate(r){ _messyTransitionRate=_clamp(r,0,0.15); },

    setSocialContext(ctx)  {
      _socialContext=ctx; _context.socialContext=ctx;
      _audienceSize=ctx==='presentation'?50:ctx==='in_class'?30:ctx==='with_friends'?3:0;
    },
    setAudienceSize(n)     { _audienceSize=Math.max(0,n); },
    setSocialStakes(s)     { _socialStakes=_clamp(s,0,1); },
    getSocialPressure()    { return _updateSocialPressure(); },
    getMaskingLevel()      { return _maskingLevel; },
    getTheoryOfMind(s)     { return _theoryOfMind(s); },
    enableTheoryOfMind(e)  { _theoryOfMindEnabled=e; },

    setSensorDropoutRate(r){ _sensorDropoutRate=_clamp(r,0,0.1); },
    enableContradictionMode(e){ _contradictionMode=e; },
    setInconsistencyLevel(l){ _inconsistencyLevel=_clamp(l,0,0.3); },

    setPersonality(t={})   { _personality={..._DEFAULT_PERSONALITY,..._personality,...t}; },
    setContext(c={})        { _context={..._DEFAULT_CONTEXT,..._context,...c}; },
    setScenario(n)          { _scenarioQ=_SCENARIOS[n]?[..._SCENARIOS[n]]:[]; },
    force(s)                { const u=s?.toUpperCase(); if(_PHYSIO_REF[u])_flipTo(u); },
    applyEmpathy(type='stress_comfort') {
      if(type==='stress_comfort'&&['STRESS','ANXIETY','FRUSTRATION'].includes(_state)){_empathyBoost={hrvBoost:5};_refractory=0;}
      else if(type==='encouragement'){_empathyBoost={hrvBoost:3};}
      else if(type==='calm_presence'){_empathyBoost={hrvBoost:8};if(_state!=='CALM')_flipTo('CALM');}
    },
    performAction(action) {
      const sp=1-_errorRate-(_cognitiveLoad>0.7?0.2:0);
      const ok=Math.random()<sp;
      _recordEpisodic({type:'action',action,success:ok});
      _applyOperantConditioning(ok?'success':'failure');
      if(ok&&_cognitiveLoad<COGNITIVE_THRESHOLDS.OPTIMAL_MAX)_triggerEvent('success',0.5);
      else if(!ok)_triggerEvent('failure',0.6);
      return ok;
    },

    reset() {
      _state='NEUTRAL'; _prevState='NEUTRAL'; _tickCount=0; _stateAge=0; _refractory=0;
      _scenarioQ=[]; _history=[]; _ultra=Math.random()*2*Math.PI; _sleepP=0;
      _hour=new Date().getHours(); _p300=null; _empathyBoost=null;
      _cognitiveLoad=0.5; _taskDifficulty=0.5; _timePressure=0.3; _taskType='neutral';
      _workingMemory={items:[],lastRehearsal:0}; _errorRate=0.05; _attentionFocus=0.8;
      _pendingEvents=[];
      _episodicMemory=[];
      _semanticMemory={ concepts:new Map(), autobiographical:[] }; // [NEW]
      _personalityDrift={ lastDrift:Date.now(), flowCount:0, stressCount:0 }; // [NEW]
      _conditioning={ classical:new Map(), operant:{successCount:0,failureCount:0,confidence:0.5,anxietyBaseline:0.3,avoidance:new Map()} };
      const d={hrv:38,hr:72,gsr:4.5,rr:15,eeg:1.0,theta_b:1.0,alpha_b:1.0,beta_b:1.0,gamma_b:0.5};
      for(const k of Object.keys(_ou))_ou[k].x=d[k]??1.0;
    },

    snapshot() {
      return {
        state:_state, displayedEmotion:_displayedEmotion, prevState:_prevState,
        tick:_tickCount, stateAge:_stateAge, cognitiveLoad:_cognitiveLoad,
        errorRate:_errorRate, attentionFocus:_attentionFocus,
        confidence:_conditioning.operant.confidence,
        anxietyBaseline:_conditioning.operant.anxietyBaseline,
        socialPressure:_updateSocialPressure(), maskingLevel:_maskingLevel,
        personality:{..._personality},
        context:{..._context},
        circadian:{hour:_hour,sleepPressure:+_sleepP.toFixed(4)},
        iaf:+_iaf.toFixed(2), microstate:_getMicrostate(), p300Active:!!_p300,
        memory:{
          burnoutRisk:_clamp((_cognitiveLoad>0.7?0.4:0)+_conditioning.operant.anxietyBaseline*0.3+_sleepP*0.3,0,1),
          confidence:_conditioning.operant.confidence,
          episodicCount:_episodicMemory.length,
          semanticCount:_semanticMemory.concepts.size,         // [NEW]
          autobiographicalCount:_semanticMemory.autobiographical.length, // [NEW]
        },
        // [NEW] personality drift summary
        personalityDrift:{ lastDrift:_personalityDrift.lastDrift, current:{..._personality} },
      };
    },
  };
})();

// ============================================================================
// SECTION 10: SUPPORT MODULES
// ============================================================================

const StorageManager = {
  KEYS:{ ABTESTS:'nuengdeaw_abtests', MODEL:'nuengdeaw_model_' },
  getJSON(key,def){try{const v=localStorage.getItem(key);return v?JSON.parse(v):def;}catch{return def;}},
  setJSON(key,val){try{localStorage.setItem(key,JSON.stringify(val));return true;}catch{return false;}},
  get(key){return localStorage.getItem(key);},
  set(key,val){localStorage.setItem(key,val);},
};

// ============================================================================
// [NEW] DECEPTION ENGINE — enhanced with micro-leak & cognitive cost
// ============================================================================
// Ekman (2003): การโกหกมี cognitive cost จริง และ emotion จะ "leak" ออกมาสั้นๆ
// ============================================================================
const DeceptionEngine = (() => {
  let _level=0, _active=false, _tick=0, _autoTimer=null, _reboundCd=0, _flatCount=0;
  let _cogCost=0;      // [NEW] cognitive cost ของการโกหก
  let _consistency=new Map(); // [NEW] track statement ที่พูดไปแล้วเพื่อ consistency
  const _lerp=(a,b,t)=>a+(b-a)*t;
  const _randn=()=>{let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};

  // [NEW] คำนวณ micro-leak rate จาก personality
  const getMicroLeakRate = (personality={}) => {
    const neuro = personality.neuroticism ?? 0.5;
    const agree = personality.agreeableness ?? 0.5;
    // คนที่ neuroticism สูง / agreeableness สูง โกหกได้ยากกว่า = leak มากกว่า
    return _clamp(0.04 + neuro*0.18 + agree*0.12 - _level*0.08, 0.01, 0.45);
  };

  // [NEW] ตรวจ micro-leak รอบนี้
  const checkMicroLeak = (leakRate) => _active && Math.random() < (leakRate ?? 0.1);

  // [NEW] cognitive cost ที่ HumanSim ดึงไปใช้เพิ่ม _cognitiveLoad
  const getCognitiveCost = () => _cogCost;

  const _level1 = (bio,bands) => {
    const s=HumanSim.getState();
    if(['STRESS','CONFUSION','EXCITEMENT'].includes(s)){
      bio.hr=_lerp(bio.hr,72,0.55); bio.hrv=_lerp(bio.hrv,40,0.50); bio.hrv=Math.max(bio.hrv,28);
      if(_tick%(7+Math.floor(Math.random()*6))===0)bio.gsr=Math.min(bio.gsr*1.35+0.8,22);
      else bio.gsr=_lerp(bio.gsr,5.0,0.40);
    }
    return {bio,bands};
  };
  const _level2 = (bio,bands) => {
    bio.hr=_lerp(bio.hr,64,0.70); bio.hrv=_lerp(bio.hrv,54,0.65); bio.gsr=_lerp(bio.gsr,2.5,0.60);
    _reboundCd=Math.max(0,_reboundCd-1);
    if(_reboundCd===0&&_tick%20===0){bio.hr+=12+Math.random()*8;bio.gsr+=3.5+Math.random()*2;bio.hrv=Math.max(bio.hrv-14,12);_reboundCd=5;}
    if(bands){bands.theta=Math.max(bands.theta,1.8+Math.random()*0.4);bands.alpha=Math.min(bands.alpha,1.1);bands.thetaAlphaRatio=bands.theta/Math.max(bands.alpha,0.01);}
    return {bio,bands};
  };
  const _level3 = (bio,bands) => {
    bio.hr=_lerp(bio.hr,72,0.80); bio.hrv=_lerp(bio.hrv,38,0.78); bio.gsr=_lerp(bio.gsr,4.5,0.75); bio.rr=_lerp(bio.rr,15,0.70);
    const n=_randn()*3; bio.hr+=n*0.8; bio.hrv+=n*0.7; bio.rr+=_randn()*2.5; bio.rr=Math.max(8,Math.min(35,bio.rr));
    if(bands){bands.beta=Math.max(bands.beta,2.2+Math.random()*0.6);bands.gamma=Math.max(bands.gamma,0.9+Math.random()*0.3);bands.thetaAlphaRatio=bands.theta/Math.max(bands.alpha,0.01);}
    return {bio,bands};
  };
  const _level4 = (bio,bands) => {
    _flatCount++;
    bio.hr=_lerp(bio.hr,70,0.93); bio.hrv=_lerp(bio.hrv,42,0.91); bio.gsr=_lerp(bio.gsr,4.2,0.89); bio.rr=_lerp(bio.rr,14,0.86); bio.eeg=_lerp(bio.eeg,1.0,0.89);
    if(bands){if(_flatCount%15===0)bands.gamma=2.1+Math.random()*0.8;else bands.gamma=_lerp(bands.gamma,0.3,0.85);}
    if(_flatCount%2===0)bio.hrv=Math.min(bio.hrv+6,65);else bio.hrv=Math.max(bio.hrv-5,22);
    bio.rr+=_randn()*0.4; bio.rr=Math.max(8,Math.min(36,bio.rr));
    if(bands)bands.thetaAlphaRatio=bands.theta/Math.max(bands.alpha,0.01);
    return {bio,bands};
  };

  const startAuto = (ticksPerLevel=60) => {
    _active=true; _level=1; _tick=0;
    if(_autoTimer)clearInterval(_autoTimer);
    let elapsed=0;
    _autoTimer=setInterval(()=>{ elapsed++; if(elapsed>=ticksPerLevel){elapsed=0;_level++;if(_level>4){_level=0;_active=false;clearInterval(_autoTimer);_autoTimer=null;}} },1000);
  };

  return {
    applyDeception(bio,bands){
      if(!_active||_level===0)return{bio,bands};
      _tick++;
      const fn=[null,_level1,_level2,_level3,_level4][_level];
      return fn?fn(bio,bands):{bio,bands};
    },
    setLevel(l){
      _level=Math.max(0,Math.min(4,l)); _active=_level>0; _tick=0; _flatCount=0; _reboundCd=0;
      _cogCost=_level*0.07; // [NEW] level 1→0.07, level 4→0.28 cognitive overhead
    },
    getLevel()         { return _level; },
    isActive()         { return _active; },
    getLevelName()     { return ['NONE','MILD','TRAINED_LIAR','PATHOLOGICAL','SOCIOPATH'][_level]; },
    getMicroLeakRate,  // [NEW]
    checkMicroLeak,    // [NEW]
    getCognitiveCost,  // [NEW]
    // [NEW] บันทึก statement ไว้ตรวจ consistency
    recordStatement(topic, statement) {
      if(!_consistency.has(topic))_consistency.set(topic,[]);
      _consistency.get(topic).push({statement,ts:Date.now()});
    },
    recallStatement(topic){ return _consistency.get(topic)??[]; },
    startAuto,
    stopAuto(){ if(_autoTimer){clearInterval(_autoTimer);_autoTimer=null;}_active=false;_level=0;_cogCost=0; },
  };
})();

// DeceptionScorer (PCI v2) — ไม่เปลี่ยน
const DeceptionScorer = (() => {
  const BUF=30;
  const _buf={hrv:[],hr:[],gsr:[],eeg:[],theta:[],alpha:[],rr:[]};
  let _history=[];
  const _push=(key,val)=>{_buf[key].push(val);if(_buf[key].length>BUF)_buf[key].shift();};
  const _pearson=(xs,ys)=>{
    const n=Math.min(xs.length,ys.length);if(n<5)return 0;
    const mx=xs.slice(-n).reduce((a,b)=>a+b)/n,my=ys.slice(-n).reduce((a,b)=>a+b)/n;
    let num=0,dx=0,dy=0;
    for(let i=0;i<n;i++){const xd=xs[xs.length-n+i]-mx,yd=ys[ys.length-n+i]-my;num+=xd*yd;dx+=xd*xd;dy+=yd*yd;}
    return dx>0&&dy>0?num/Math.sqrt(dx*dy):0;
  };
  const _score=(bio,bands,reportedState)=>{
    if(bio.hrv!=null)_push('hrv',bio.hrv);if(bio.hr!=null)_push('hr',bio.hr);
    if(bio.gsr!=null)_push('gsr',bio.gsr);if(bio.eeg!=null)_push('eeg',bio.eeg);
    if(bio.rr!=null)_push('rr',bio.rr);
    if(bands){if(bands.theta!=null)_push('theta',bands.theta);if(bands.alpha!=null)_push('alpha',bands.alpha);}
    const n=_buf.hrv.length;if(n<5)return{pci:0,avgPci:0,deceptionFlag:false,violations:[],confidence:'insufficient_data'};
    const violations=[];let total=0;
    const _m=a=>a.reduce((s,v)=>s+v,0)/a.length;
    const _s=a=>{const m=_m(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length);};
    const hrMean=_m(_buf.hr.slice(-10));const hrvMean=_m(_buf.hrv.slice(-10));
    const gsrMean=_m(_buf.gsr.slice(-10));
    const v1=Math.max(0,0.8+_pearson(_buf.hrv,_buf.hr));if(v1>0.25)violations.push({pair:'HRV↔HR',score:+v1.toFixed(3)});total+=v1*0.20;
    const v2=Math.max(0,0.8-_pearson(_buf.gsr,_buf.hrv));if(v2>0.30)violations.push({pair:'GSR↓HRV',score:+v2.toFixed(3)});total+=v2*0.20;
    const n6=Math.min(_buf.theta.length,_buf.alpha.length);
    if(n6>=5){const ta=_buf.theta.slice(-n6).map((t,i)=>t/_buf.alpha[_buf.alpha.length-n6+i]);const taMean=_m(ta);const v3=Math.max(0,taMean-1.5);if(v3>0.15)violations.push({pair:'θ/α>1.5',score:+v3.toFixed(3)});total+=v3*0.15;}
    const v4=_s(_buf.rr.slice(-10))<0.3?0.4:0;if(v4>0)violations.push({pair:'RR_flat',score:v4});total+=v4*0.15;
    const v5=_s(_buf.gsr.slice(-10))>4?0.3:0;if(v5>0)violations.push({pair:'GSR_variance',score:v5});total+=v5*0.20;
    if(reportedState){const ref=typeof _PHYSIO_REF!=='undefined'?_PHYSIO_REF[reportedState]:null;if(ref){const v6=Math.abs(hrMean-ref.hr[0])/ref.hr[0];if(v6>0.40)violations.push({pair:'BioMean↔State',hrObs:+hrMean.toFixed(1),hrExp:ref.hr,score:+v6.toFixed(3)});total+=v6*0.10;}}
    const pci=Math.min(1.0,total);
    _history.push(pci);if(_history.length>60)_history.shift();
    const avg=_history.reduce((s,v)=>s+v,0)/_history.length;
    const deceptionFlag=pci>0.60&&violations.length>=2;
    const confidence=avg>0.75?'high_deception':avg>0.60?'probable_deception':avg>0.35?'mild_inconsistency':'coherent';
    return{pci:+pci.toFixed(3),avgPci:+avg.toFixed(3),deceptionFlag,violations,confidence};
  };
  return{score:_score,getHistory:()=>[..._history],reset:()=>{Object.keys(_buf).forEach(k=>_buf[k]=[]);_history=[];}};
})();

const ABTestManager = (() => {
  let _tests=StorageManager.getJSON(StorageManager.KEYS.ABTESTS,{})??{};
  const _save=()=>StorageManager.setJSON(StorageManager.KEYS.ABTESTS,_tests);
  const _normCDF=z=>{const t=1/(1+0.2316419*z);return 1-(1/Math.sqrt(2*Math.PI))*Math.exp(-0.5*z*z)*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));};
  const _welchT=(a,b)=>{
    if(a.length<2||b.length<2)return{t:0,p:1};
    const ma=a.reduce((s,v)=>s+v,0)/a.length,mb=b.reduce((s,v)=>s+v,0)/b.length;
    const va=a.reduce((s,v)=>s+(v-ma)**2,0)/(a.length-1),vb=b.reduce((s,v)=>s+(v-mb)**2,0)/(b.length-1);
    if(va+vb===0)return{t:0,p:1};
    const t=(ma-mb)/Math.sqrt(va/a.length+vb/b.length);
    return{t:+t.toFixed(3),p:+(2*(1-_normCDF(Math.abs(t)))).toFixed(4),ma:+ma.toFixed(3),mb:+mb.toFixed(3)};
  };
  return{
    createTest(id,variants=['control','treatment'],metric='flow_ticks',durationTicks=0){_tests[id]={id,variants,metric,durationTicks,createdAt:Date.now(),closed:false,data:Object.fromEntries(variants.map(v=>[v,[]])),totalAssignments:Object.fromEntries(variants.map(v=>[v,0]))};_save();return _tests[id];},
    assign(testId){const t=_tests[testId];if(!t||t.closed)return null;const v=t.variants.reduce((a,b)=>t.totalAssignments[a]<=t.totalAssignments[b]?a:b);t.totalAssignments[v]++;_save();return v;},
    record(testId,variantName,value){const t=_tests[testId];if(!t||t.closed||!t.data[variantName])return;t.data[variantName].push(value);_save();},
    getResult(testId){const t=_tests[testId];if(!t)return null;const means={};t.variants.forEach(v=>{const d=t.data[v];means[v]=d.length>0?d.reduce((s,x)=>s+x,0)/d.length:0;});const winner=Object.entries(means).sort((a,b)=>b[1]-a[1])[0][0];const[v0,v1]=t.variants;const stats=_welchT(t.data[v0]??[],t.data[v1]??[]);return{winner,means,stats,significant:stats.p<0.05,sampleSizes:Object.fromEntries(t.variants.map(v=>[v,t.data[v].length]))};},
    close(id){if(_tests[id]){_tests[id].closed=true;_save();}},
    listTests(){return Object.keys(_tests);},
    getTest(id){return _tests[id]??null;},
    deleteTest(id){delete _tests[id];_save();},
    exportAll(){return JSON.stringify(_tests,null,2);},
    importAll(json){try{_tests=JSON.parse(json);_save();return true;}catch{return false;}},
  };
})();

const ArtifactDetector = (() => {
  const BUF=20; const _h={hr:[],gsr:[],eeg:[],hrv:[],alpha:[],rr:[]}; let _last=[];
  const _push=(k,v)=>{_h[k].push(v);if(_h[k].length>BUF)_h[k].shift();};
  const _mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
  const _std=a=>{const m=_mean(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length);};
  const _check=(bio,bands)=>{
    _push('hr',bio.hr);_push('gsr',bio.gsr);_push('eeg',bio.eeg);_push('hrv',bio.hrv);_push('rr',bio.rr??15);
    if(bands)_push('alpha',bands.alpha??1);
    const n=_h.hr.length; if(n<4)return{isClean:true,artifacts:[],severity:'ok',ready:false};
    const arts=[];
    if(n>=2&&Math.abs(_h.gsr[n-1]-_h.gsr[n-2])>5.0)arts.push({type:'motion_gsr',msg:'GSR spike — Motion Artifact'});
    if(n>=2&&Math.abs(_h.hr[n-1]-_h.hr[n-2])>25)arts.push({type:'motion_hr',msg:'HR spike — Motion Artifact'});
    if(n>=8){const m=_mean(_h.eeg),s=_std(_h.eeg);if(s>0&&Math.abs(bio.eeg-m)>4*s)arts.push({type:'electrode_pop',msg:'EEG Electrode Pop'});}
    if(bands&&n>=3){const prev=_h.alpha[n-2]??1;if((bands.alpha??1)>prev*2.5&&(bands.alpha??1)>3.0)arts.push({type:'eye_blink_eeg',msg:'Eye Blink Artifact'});}
    if(n>=15){const early=_mean(_h.gsr.slice(0,5)),late=_mean(_h.gsr.slice(-5));if(late-early>6.0)arts.push({type:'baseline_drift',msg:'GSR Baseline Drift'});}
    if(n>=10){const hv=_std(_h.hr.slice(-10));if(hv<0.05)arts.push({type:'flat_signal',msg:'HR Flat Signal'});}
    if(n>=2&&Math.abs(bio.eeg)>4.8)arts.push({type:'saturation_clip',msg:'EEG Saturation'});
    _last=arts;
    return{isClean:arts.length===0,artifacts:arts,severity:arts.length===0?'ok':arts.length===1?'warn':'error',ready:true};
  };
  return{ check:_check, getLastArtifacts:()=>_last, getWarningMessage:()=>_last.length?'⚠️ '+_last.map(a=>a.msg).join(' | '):'', reset:()=>{Object.keys(_h).forEach(k=>_h[k]=[]);_last=[];} };
})();

// ============================================================================
// SECTION 11: GLOBAL EXPORTS
// ============================================================================

if(typeof window!=='undefined'){
  window.HumanSim         = HumanSim;
  window.EMOTION_STATES   = EMOTION_STATES;
  window.MICROSTATES      = MICROSTATES;
  window.StorageManager   = StorageManager;
  window.DeceptionEngine  = DeceptionEngine;
  window.DeceptionScorer  = DeceptionScorer;
  window.ABTestManager    = ABTestManager;
  window.ArtifactDetector = ArtifactDetector;
  window.logSys = window.logSys || ((...a)=>console.log('[Nuengdeaw]',...a));
}

if(typeof module!=='undefined'&&module.exports){
  module.exports={ HumanSim, DeceptionEngine, DeceptionScorer, ABTestManager, ArtifactDetector, StorageManager };
}

console.log('✅ nuengdeaw_simu.js loaded— Personality Drift + Semantic Memory + Deception Micro-Leak');
