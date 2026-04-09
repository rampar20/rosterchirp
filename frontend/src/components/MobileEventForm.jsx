import { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { api } from '../utils/api.js';
import ColourPickerSheet from './ColourPickerSheet.jsx';
import { useToast } from '../contexts/ToastContext.jsx';

// ── Utilities ─────────────────────────────────────────────────────────────────
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_PILLS = ['S','M','T','W','T','F','S'];
const DAY_KEYS  = ['SU','MO','TU','WE','TH','FR','SA'];

const TIME_SLOTS = (() => {
  const s=[];
  for(let h=0;h<24;h++) for(let m of [0,30]) {
    const hh=String(h).padStart(2,'0'), mm=String(m).padStart(2,'0');
    const disp=`${h===0?12:h>12?h-12:h}:${mm} ${h<12?'AM':'PM'}`;
    s.push({value:`${hh}:${mm}`,label:disp});
  }
  return s;
})();

function roundUpToHalfHour() {
  const now = new Date();
  const m = now.getMinutes();
  const snap = m === 0 ? 0 : m <= 30 ? 30 : 60;
  const snapped = new Date(now);
  snapped.setMinutes(snap, 0, 0);
  const h = String(snapped.getHours()).padStart(2,'0');
  const min = String(snapped.getMinutes()).padStart(2,'0');
  return `${h}:${min}`;
}

function parseTypedTime(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  let m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (m) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (m[3] === 'pm' && h < 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }
  m = s.match(/^(\d{1,2})\s*(am|pm)$/);
  if (m) {
    let h = parseInt(m[1]);
    if (m[2] === 'pm' && h < 12) h += 12;
    if (m[2] === 'am' && h === 12) h = 0;
    if (h < 0 || h > 23) return null;
    return `${String(h).padStart(2,'0')}:00`;
  }
  m = s.match(/^(\d{1,2})$/);
  if (m) {
    const h = parseInt(m[1]);
    if (h < 0 || h > 23) return null;
    return `${String(h).padStart(2,'0')}:00`;
  }
  return null;
}

function fmt12(val) {
  if (!val) return '';
  const [hh, mm] = val.split(':').map(Number);
  const h = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  const ampm = hh < 12 ? 'AM' : 'PM';
  return `${h}:${String(mm).padStart(2,'0')} ${ampm}`;
}

// Mobile TimeInput — free-text time entry with smart-positioned scrollable dropdown
function TimeInputMobile({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState(fmt12(value));
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { setInputVal(fmt12(value)); }, [value]);

  // Calculate dropdown position — always above the input.
  // getBoundingClientRect() is relative to the visual viewport on mobile Chrome,
  // so this correctly clears the keyboard regardless of its height.
  useEffect(() => {
    if (open && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      const dropdownHeight = 5 * 40;
      setDropdownPos({ top: Math.max(0, rect.top - dropdownHeight), left: rect.left });
    }
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const idx = TIME_SLOTS.findIndex(s => s.value === value);
    if (idx >= 0) listRef.current.scrollTop = idx * 40 - 40;
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const h = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const commit = (raw) => {
    const parsed = parseTypedTime(raw);
    if (parsed) { onChange(parsed); setInputVal(fmt12(parsed)); }
    else setInputVal(fmt12(value));
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <input
        type="text"
        value={inputVal}
        onChange={e => setInputVal(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={e => setTimeout(() => commit(e.target.value), 150)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(inputVal); } if (e.key === 'Escape') { setInputVal(fmt12(value)); setOpen(false); } }}
        autoComplete="off"
        inputMode="text"
        enterKeyHint="done"
        style={{ fontSize: 15, color: 'var(--primary)', fontWeight: 600, background: 'transparent', border: 'none', outline: 'none', cursor: 'text', width: 90 }}
      />
      {open && (
        <div
          ref={listRef}
          style={{
            position: 'fixed',
            zIndex: 9999,
            top: dropdownPos.top,
            left: dropdownPos.left,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
            width: 130, maxHeight: 5 * 40, overflowY: 'auto',
            pointerEvents: 'auto',
          }}
        >
          {TIME_SLOTS.map(s => (
            <div
              key={s.value}
              onMouseDown={e => { e.preventDefault(); onChange(s.value); setInputVal(s.label); setOpen(false); }}
              style={{
                padding: '10px 14px', fontSize: 14, cursor: 'pointer', height: 40,
                boxSizing: 'border-box',
                background: s.value === value ? 'var(--primary)' : 'transparent',
                color: s.value === value ? 'white' : 'var(--text-primary)',
              }}
            >
              {s.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function toDateIn(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function toTimeIn(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function buildISO(date, time) {
  if (!date || !time) return '';
  const d = new Date(`${date}T${time}:00`);
  const pad = n => String(n).padStart(2,'0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${date}T${time}:00${sign}${pad(Math.floor(abs/60))}:${pad(abs%60)}`;
}
function addHours(iso, h) {
  const d = new Date(iso); d.setMinutes(d.getMinutes() + h * 60);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}
// Parse YYYY-MM-DD as local midnight (appending T00:00:00 prevents new Date() treating
// a bare date string as UTC, which rolls back one day for timezones behind UTC).
function fmtDateDisplay(iso) { if(!iso) return ''; const d=new Date(iso+'T00:00:00'); return `${DAYS[d.getDay()]}, ${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }
function fmtTimeDisplay(slot) { const f=TIME_SLOTS.find(s=>s.value===slot); return f?f.label:slot; }

const FREQ_OPTIONS = [
  { value: '', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
  { value: 'custom', label: 'Custom…' },
];
function recurrenceLabel(rule) {
  if (!rule || !rule.freq) return 'Does not repeat';
  if (rule.freq === 'custom') { const unit = (rule.interval||1)===1 ? rule.unit : `${rule.interval} ${rule.unit}s`; return `Every ${unit}`; }
  return FREQ_OPTIONS.find(o=>o.value===rule.freq)?.label || rule.freq;
}

// ── Toggle Switch ─────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }) {
  return (
    <div onClick={()=>onChange(!checked)} style={{ width:44,height:24,borderRadius:12,background:checked?'var(--primary)':'var(--surface-variant)',cursor:'pointer',position:'relative',transition:'background 0.2s',flexShrink:0 }}>
      <div style={{ position:'absolute',top:2,left:checked?22:2,width:20,height:20,borderRadius:'50%',background:'white',transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.2)' }}/>
    </div>
  );
}

// ── Calendar Picker Overlay ───────────────────────────────────────────────────
function CalendarPicker({ value, onChange, onClose }) {
  const [cur, setCur] = useState(() => { const d = new Date(value||Date.now()); d.setDate(1); return d; });
  const y=cur.getFullYear(), m=cur.getMonth(), first=new Date(y,m,1).getDay(), total=new Date(y,m+1,0).getDate(), today=new Date();
  const cells=[]; for(let i=0;i<first;i++) cells.push(null); for(let d=1;d<=total;d++) cells.push(d);
  const selDate = value ? new Date(value+'T00:00:00') : null;
  return (
    <div style={{ position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'flex-end' }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ width:'100%',background:'var(--surface)',borderRadius:'16px 16px 0 0',padding:20,boxShadow:'0 -4px 20px rgba(0,0,0,0.2)' }}>
        <div style={{ fontSize:13,color:'var(--text-tertiary)',marginBottom:4 }}>Select Date</div>
        <div style={{ fontSize:22,fontWeight:700,marginBottom:12 }}>
          {selDate ? `${SHORT_MONTHS[selDate.getMonth()]} ${selDate.getDate()}, ${selDate.getFullYear()}` : '—'}
        </div>
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8 }}>
          <button onClick={()=>{const n=new Date(cur);n.setMonth(m-1);setCur(n);}} style={{ background:'none',border:'none',fontSize:20,cursor:'pointer',color:'var(--text-secondary)',padding:'4px 10px' }}>‹</button>
          <span style={{ fontWeight:600 }}>{MONTHS[m]} {y}</span>
          <button onClick={()=>{const n=new Date(cur);n.setMonth(m+1);setCur(n);}} style={{ background:'none',border:'none',fontSize:20,cursor:'pointer',color:'var(--text-secondary)',padding:'4px 10px' }}>›</button>
        </div>
        <div style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,marginBottom:12 }}>
          {['S','M','T','W','T','F','S'].map((d,i)=><div key={i} style={{ textAlign:'center',fontSize:11,fontWeight:600,color:'var(--text-tertiary)',padding:'4px 0' }}>{d}</div>)}
          {cells.map((d,i) => {
            if(!d) return <div key={i}/>;
            const date=new Date(y,m,d);
            const isSel = selDate && date.toDateString()===selDate.toDateString();
            const isToday = date.toDateString()===today.toDateString();
            return <div key={i} onClick={()=>onChange(`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`)} style={{ textAlign:'center',padding:'8px 4px',borderRadius:'50%',cursor:'pointer',background:isSel?'var(--primary)':'transparent',color:isSel?'white':isToday?'var(--primary)':'var(--text-primary)',fontWeight:isToday&&!isSel?700:400,fontSize:14 }}>{d}</div>;
          })}
        </div>
        <div style={{ display:'flex',justifyContent:'flex-end',gap:12 }}>
          <button onClick={onClose} style={{ background:'none',border:'none',color:'var(--text-secondary)',fontSize:14,cursor:'pointer',padding:'8px 16px' }}>Cancel</button>
          <button onClick={onClose} style={{ background:'none',border:'none',color:'var(--primary)',fontSize:14,fontWeight:700,cursor:'pointer',padding:'8px 16px' }}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ── Recurrence Sheet ──────────────────────────────────────────────────────────
function RecurrenceSheet({ value, onChange, onClose }) {
  const rule = value || {};
  const [showCustom, setShowCustom] = useState(rule.freq==='custom');
  const [customRule, setCustomRule] = useState(rule.freq==='custom' ? rule : {freq:'custom',interval:1,unit:'week',byDay:[],ends:'never',endDate:'',endCount:13});

  const selectFreq = (freq) => {
    if(freq==='custom') { setShowCustom(true); return; }
    onChange(freq ? {freq} : null);
    onClose();
  };
  const upd = (k,v) => setCustomRule(r=>({...r,[k]:v}));

  if(showCustom) return (
    <div style={{ position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'flex-end' }}>
      <div style={{ width:'100%',background:'var(--surface)',borderRadius:'16px 16px 0 0',padding:20,boxShadow:'0 -4px 20px rgba(0,0,0,0.2)',maxHeight:'90vh',overflowY:'auto' }}>
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20 }}>
          <button onClick={()=>setShowCustom(false)} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--text-secondary)',display:'flex',alignItems:'center',gap:6,fontSize:14 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span style={{ fontWeight:700,fontSize:16 }}>Custom recurrence</span>
          <button onClick={()=>{onChange(customRule);onClose();}} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--primary)',fontSize:14,fontWeight:700 }}>Done</button>
        </div>

        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:12,color:'var(--text-tertiary)',marginBottom:8 }}>Repeats every</div>
          <div style={{ display:'flex',gap:10 }}>
            <input type="number" className="input" min={1} max={99} value={customRule.interval||1} onChange={e => upd('interval',Math.max(1,parseInt(e.target.value)||1))} autoComplete="off" style={{ width:70,textAlign:'center',fontSize:16 }}/>
            <select className="input" value={customRule.unit||'week'} onChange={e=>upd('unit',e.target.value)} style={{ flex:1,fontSize:14 }}>
              {['day','week','month','year'].map(u=><option key={u} value={u}>{u}{(customRule.interval||1)>1?'s':''}</option>)}
            </select>
          </div>
        </div>

        {(customRule.unit||'week')==='week' && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:12,color:'var(--text-tertiary)',marginBottom:8 }}>Repeats on</div>
            <div style={{ display:'flex',gap:8 }}>
              {DAY_PILLS.map((d,i)=>{
                const key=DAY_KEYS[i], sel=(customRule.byDay||[]).includes(key);
                return <button key={key} type="button" onClick={()=>upd('byDay',sel?(customRule.byDay||[]).filter(x=>x!==key):[...(customRule.byDay||[]),key])} style={{ flex:1,aspectRatio:'1',borderRadius:'50%',border:'1px solid var(--border)',background:sel?'var(--primary)':'transparent',color:sel?'white':'var(--text-primary)',fontSize:12,fontWeight:600,cursor:'pointer',padding:4 }}>{d}</button>;
              })}
            </div>
          </div>
        )}

        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:12,color:'var(--text-tertiary)',marginBottom:8 }}>Ends</div>
          {[['never','Never'],['on','On'],['after','After']].map(([val,lbl])=>(
            <div key={val} style={{ display:'flex',alignItems:'center',gap:12,padding:'12px 0',borderBottom:'1px solid var(--border)' }}>
              <div onClick={()=>upd('ends',val)} style={{ width:20,height:20,borderRadius:'50%',border:`2px solid ${(customRule.ends||'never')===val?'var(--primary)':'var(--border)'}`,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0 }}>
                {(customRule.ends||'never')===val&&<div style={{ width:10,height:10,borderRadius:'50%',background:'var(--primary)' }}/>}
              </div>
              <span style={{ flex:1,fontSize:15 }}>{lbl}</span>
              {val==='on'&&(customRule.ends||'never')==='on'&&<input type="date" className="input" value={customRule.endDate||''} onChange={e => upd('endDate',e.target.value)} autoComplete="off" style={{ width:150 }}/>}
              {val==='after'&&(customRule.ends||'never')==='after'&&<><input type="number" className="input" min={1} max={999} value={customRule.endCount||13} onChange={e => upd('endCount',parseInt(e.target.value)||1)} autoComplete="off" style={{ width:64,textAlign:'center' }}/><span style={{ fontSize:13,color:'var(--text-tertiary)' }}>occurrences</span></>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'flex-end' }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ width:'100%',background:'var(--surface)',borderRadius:'16px 16px 0 0',padding:20,boxShadow:'0 -4px 20px rgba(0,0,0,0.2)' }}>
        {FREQ_OPTIONS.map(opt=>(
          <div key={opt.value} onClick={()=>selectFreq(opt.value)} style={{ display:'flex',alignItems:'center',gap:12,padding:'14px 4px',borderBottom:'1px solid var(--border)',cursor:'pointer' }}>
            <div style={{ width:20,height:20,borderRadius:'50%',border:`2px solid ${(rule.freq||'')===(opt.value)?'var(--primary)':'var(--border)'}`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
              {(rule.freq||'')===(opt.value)&&<div style={{ width:10,height:10,borderRadius:'50%',background:'var(--primary)' }}/>}
            </div>
            <span style={{ fontSize:16 }}>{opt.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Row — must be defined OUTSIDE the component to avoid focus loss ─────────────
function MobileRow({ icon, label, children, onPress, border=true }) {
  return (
    <div onClick={onPress} style={{ display:'flex',alignItems:'center',gap:16,padding:'14px 20px',borderBottom:border?'1px solid var(--border)':'none',cursor:onPress?'pointer':'default',minHeight:52 }}>
      <span style={{ color:'var(--text-tertiary)',flexShrink:0,width:20,textAlign:'center' }}>{icon}</span>
      <div style={{ flex:1,minWidth:0 }}>
        {label && <div style={{ fontSize:12,color:'var(--text-tertiary)',marginBottom:2 }}>{label}</div>}
        {children}
      </div>
    </div>
  );
}

// ── Recurring choice modal ────────────────────────────────────────────────────
function RecurringChoiceModal({ title, onConfirm, onCancel }) {
  const [choice, setChoice] = useState('this');
  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onCancel()}>
      <div className="modal" style={{maxWidth:360}}>
        <h3 style={{fontSize:17,fontWeight:700,margin:'0 0 20px'}}>{title}</h3>
        <div style={{display:'flex',flexDirection:'column',gap:14,marginBottom:24}}>
          {[['this','This event'],['future','This and following events'],['all','All events']].map(([val,label])=>(
            <label key={val} style={{display:'flex',alignItems:'center',gap:10,fontSize:14,cursor:'pointer'}}>
              <input type="radio" name="rec-scope" value={val} checked={choice===val} onChange={()=>setChoice(val)} style={{accentColor:'var(--primary)',width:16,height:16}}/>
              {label}
            </label>
          ))}
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={()=>onConfirm(choice)}>OK</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main Mobile Event Form ────────────────────────────────────────────────────
export default function MobileEventForm({ event, eventTypes, userGroups, selectedDate, onSave, onCancel, onDelete, isToolManager, userId }) {
  const toast = useToast();
  // Use local date for default, not UTC slice (avoids off-by-one for UTC- timezones)
  const defDate = selectedDate || new Date();
  const _pad = n => String(n).padStart(2,'0');
  const def = `${defDate.getFullYear()}-${_pad(defDate.getMonth()+1)}-${_pad(defDate.getDate())}`;
  const [title, setTitle] = useState(event?.title||'');
  const [typeId, setTypeId] = useState(event?.event_type_id ? String(event.event_type_id) : '');
  const [localTypes, setLocalTypes] = useState(eventTypes);
  const [showAddType, setShowAddType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeColour, setNewTypeColour] = useState('#6366f1');
  const [showTypeColourPicker, setShowTypeColourPicker] = useState(false);
  const [savingType, setSavingType] = useState(false);
  const [sd, setSd] = useState(event ? toDateIn(event.start_at) : def);
  const [st, setSt] = useState(event ? toTimeIn(event.start_at) : roundUpToHalfHour());
  const [ed, setEd] = useState(event ? toDateIn(event.end_at) : def);
  const [et, setEt] = useState(event ? toTimeIn(event.end_at) : (() => { const s=roundUpToHalfHour(); const d=new Date(`${def}T${s}:00`); d.setHours(d.getHours()+1); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; })());
  // Track the saved event duration (minutes) so editing preserves it
  const savedDurMins = event
    ? (new Date(event.end_at) - new Date(event.start_at)) / 60000
    : null;
  // Track previous typeId so we can detect a type change vs start time change
  const prevTypeIdRef = useRef(event?.event_type_id ? String(event.event_type_id) : '');
  const mountedRef = useRef(false);
  const [allDay, setAllDay] = useState(!!event?.all_day);
  const [track, setTrack] = useState(!!event?.track_availability);
  const [isPrivate, setIsPrivate] = useState(event ? !event.is_public : !isToolManager);
  const [groups, setGroups] = useState(new Set((event?.user_groups||[]).map(g=>g.id)));
  const [location, setLocation] = useState(event?.location||'');
  const [description, setDescription] = useState(event?.description||'');
  const [recRule, setRecRule] = useState(event?.recurrence_rule||null);
  const [saving, setSaving] = useState(false);
  const [showScopeModal, setShowScopeModal] = useState(false);

  // Overlay state
  const [showStartDate, setShowStartDate] = useState(false);
  const [showEndDate, setShowEndDate] = useState(false);
  const [showRecurrence, setShowRecurrence] = useState(false);
  const [showGroups, setShowGroups] = useState(false);

  // Sync and initialise typeId
  useEffect(() => {
    setLocalTypes(eventTypes);
    if(!event && typeId==='' && eventTypes.length>0) {
      const def = eventTypes.find(t=>t.is_default) || eventTypes[0];
      if(def) setTypeId(String(def.id));
    }
  }, [eventTypes]);

  const createEventType = async () => {
    if(!newTypeName.trim()) return;
    setSavingType(true);
    try {
      const r = await api.createEventType({ name: newTypeName.trim(), colour: newTypeColour });
      setLocalTypes(prev => [...prev, r.eventType]);
      setTypeId(String(r.eventType.id));
      setNewTypeName(''); setShowAddType(false);
    } catch(e) { toast(e.message, 'error'); }
    finally { setSavingType(false); }
  };

  // Mark mounted after first render
  useEffect(() => { mountedRef.current = true; }, []);

  // Auto-calculate end date/time ONLY when start date, start time, or type actually changes.
  // Skips initial mount so edit mode fields are never overwritten on open.
  useEffect(() => {
    if(!mountedRef.current) return; // skip initial mount — never auto-change on open
    if(!sd||!st) return;
    const start = buildISO(sd,st);
    if(!start) return;

    const typeChanged = typeId !== prevTypeIdRef.current;
    prevTypeIdRef.current = typeId;

    let durMins;
    if(!event || typeChanged) {
      // New event or explicit type change: use eventType duration
      const typ = localTypes.find(t=>t.id===Number(typeId));
      durMins = (typ?.default_duration_hrs||1) * 60;
    } else {
      // Editing start date/time with same type: preserve saved duration
      durMins = savedDurMins || 60;
    }

    const endIso = addHours(start, durMins/60);
    setEd(toDateIn(endIso));
    setEt(toTimeIn(endIso));
  }, [sd, st, typeId]);

  const handle = () => {
    if(!title.trim()) return toast('Title required','error');
    if(!isToolManager && groups.size === 0) return toast('Select at least one group','error');
    const startMs = new Date(buildISO(sd, allDay?'00:00':st)).getTime();
    const endMs   = new Date(buildISO(ed, allDay?'23:59':et)).getTime();
    if(ed < sd) return toast('End date cannot be before start date','error');
    if(!allDay && endMs <= startMs && ed === sd) return toast('End time must be after start time, or set a later end date','error');
    if(!event && !allDay && new Date(buildISO(sd,st)) < new Date()) return toast('Start date and time cannot be in the past','error');
    if(!event && allDay && sd < toDateIn(new Date().toISOString())) return toast('Start date cannot be in the past','error');
    if(event && event.recurrence_rule?.freq) { setShowScopeModal(true); return; }
    doSave('this');
  };
  const doSave = async (scope) => {
    setShowScopeModal(false);
    setSaving(true);
    try {
      const body = { title:title.trim(), eventTypeId:typeId||null, startAt:allDay?buildISO(sd,'00:00'):buildISO(sd,st), endAt:allDay?buildISO(ed,'23:59'):buildISO(ed,et), allDay, location, description, isPublic:isToolManager?!isPrivate:false, trackAvailability:track, userGroupIds:[...groups], recurrenceRule:recRule||null };
      let r;
      if (event) {
        const updateBody = { ...body, recurringScope: scope };
        if (event._virtual) updateBody.occurrenceStart = event.start_at;
        r = await api.updateEvent(event.id, updateBody);
      } else {
        r = await api.createEvent(body);
      }
      onSave(r.event);
    } catch(e) { toast(e.message,'error'); }
    finally { setSaving(false); }
  };

  const currentType = eventTypes.find(t=>t.id===Number(typeId));



  return (
    <div style={{ display:'flex',flexDirection:'column',height:'100%',background:'var(--background)' }}>
      {/* Header */}
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',background:'var(--surface)',borderBottom:'1px solid var(--border)',flexShrink:0 }}>
        <button onClick={onCancel} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--text-secondary)',display:'flex',alignItems:'center',gap:4,fontSize:14 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <span style={{ fontWeight:700,fontSize:16 }}>{event ? 'Edit Event' : 'New Event'}</span>
        <button onClick={handle} disabled={saving} style={{ background:'var(--primary)',border:'none',cursor:'pointer',color:'white',borderRadius:20,padding:'8px 20px',fontSize:14,fontWeight:700,opacity:saving?0.6:1 }}>{saving?'…':'Save'}</button>
      </div>

      {/* form wrapper suppresses Chrome Android's autofill chip bar; autoComplete="off"
          on individual inputs is ignored by Chrome but respected on the form element */}
      <form autoComplete="off" onSubmit={e => e.preventDefault()} style={{ flex:1,overflowY:'auto' }}>
        {/* Title */}
        <div style={{ padding:'16px 20px',borderBottom:'1px solid var(--border)' }}>
          <input value={title} onChange={e => setTitle(e.target.value)} autoComplete="off" placeholder="Add title" autoCorrect="off" autoCapitalize="sentences" spellCheck={false} style={{ width:'100%',border:'none',background:'transparent',fontSize:22,fontWeight:700,color:'var(--text-primary)',outline:'none' }}/>
        </div>

        {/* Event Type */}
        <MobileRow icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2H2l8 9.46V19l4 2v-8.54L22 2z"/></svg>} label="Event Type">
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <select value={typeId} onChange={e=>setTypeId(e.target.value)} style={{ background:'transparent',border:'none',fontSize:15,color:'var(--text-primary)',flex:1,outline:'none' }}>
              {localTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {isToolManager && (
              <button onClick={()=>setShowAddType(true)} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--primary)',fontSize:13,fontWeight:600,flexShrink:0,padding:'2px 4px' }}>
                + Type
              </button>
            )}
          </div>
        </MobileRow>

        {/* All-day toggle */}
        <div style={{ display:'flex',alignItems:'center',padding:'14px 20px',borderBottom:'1px solid var(--border)' }}>
          <span style={{ color:'var(--text-tertiary)',width:20,textAlign:'center',marginRight:16 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
          <span style={{ flex:1,fontSize:15 }}>All day</span>
          <Toggle checked={allDay} onChange={setAllDay}/>
        </div>

        {/* Start date/time */}
        <div style={{ display:'flex',alignItems:'center',padding:'12px 20px 6px 56px' }}>
          <span onClick={()=>setShowStartDate(true)} style={{ flex:1,fontSize:15,cursor:'pointer' }}>{fmtDateDisplay(sd)}</span>
          {!allDay && (
            <TimeInputMobile value={st} onChange={setSt} />
          )}
        </div>

        {/* End date/time */}
        <div style={{ display:'flex',alignItems:'center',padding:'6px 20px 14px 56px',borderBottom:'1px solid var(--border)' }}>
          <span onClick={()=>setShowEndDate(true)} style={{ flex:1,fontSize:15,color:'var(--text-secondary)',cursor:'pointer' }}>{fmtDateDisplay(ed)}</span>
          {!allDay && (
            <TimeInputMobile value={et} onChange={newEt => {
              setEt(newEt);
              if(sd === ed && newEt <= st) {
                const nextDay = addHours(buildISO(sd, st), 0);
                const d = new Date(nextDay); d.setDate(d.getDate()+1);
                const pad = n => String(n).padStart(2,'0');
                setEd(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`);
              }
            }} />
          )}
        </div>



        {/* Recurrence */}
        <MobileRow icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>} onPress={()=>setShowRecurrence(true)}>
          <span style={{ fontSize:15 }}>{recurrenceLabel(recRule)}</span>
        </MobileRow>

        {/* Track Availability */}
        <div style={{ display:'flex',alignItems:'center',padding:'14px 20px',borderBottom:'1px solid var(--border)' }}>
          <span style={{ color:'var(--text-tertiary)',width:20,textAlign:'center',marginRight:16 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
          <span style={{ flex:1,fontSize:15 }}>Track Availability</span>
          <Toggle checked={track} onChange={setTrack}/>
        </div>

        {/* Groups */}
        <div>
          <div onClick={()=>setShowGroups(!showGroups)} style={{ display:'flex',alignItems:'center',padding:'14px 20px',borderBottom:'1px solid var(--border)',cursor:'pointer' }}>
            <span style={{ color:'var(--text-tertiary)',width:20,textAlign:'center',marginRight:16 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
            <span style={{ flex:1,fontSize:15 }}>{groups.size>0 ? `${groups.size} group${groups.size!==1?'s':''} selected` : 'Add Groups'}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"><polyline points={showGroups?"18 15 12 9 6 15":"6 9 12 15 18 9"}/></svg>
          </div>
          {showGroups && userGroups.map(g=>(
            <label key={g.id} style={{ display:'flex',alignItems:'center',gap:14,padding:'12px 20px 12px 56px',borderBottom:'1px solid var(--border)',cursor:'pointer' }}>
              <input type="checkbox" checked={groups.has(g.id)} onChange={()=>setGroups(prev=>{const n=new Set(prev);n.has(g.id)?n.delete(g.id):n.add(g.id);return n;})} style={{ width:18,height:18,accentColor:'var(--primary)' }}/>
              <span style={{ fontSize:15 }}>{g.name}</span>
            </label>
          ))}
        </div>

        {/* Private Event — tool managers can toggle; regular users always private */}
        <div style={{ display:'flex',alignItems:'center',padding:'14px 20px',borderBottom:'1px solid var(--border)' }}>
          <span style={{ color:'var(--text-tertiary)',width:20,textAlign:'center',marginRight:16 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg></span>
          <span style={{ flex:1,fontSize:15 }}>Private Event</span>
          {isToolManager
            ? <Toggle checked={isPrivate} onChange={setIsPrivate}/>
            : <span style={{ fontSize:13,color:'var(--text-tertiary)' }}>Always private</span>
          }
        </div>

        {/* Location */}
        <MobileRow icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>}>
          <input value={location} onChange={e => setLocation(e.target.value)} autoComplete="off" placeholder="Add location" autoCorrect="off" autoCapitalize="off" spellCheck={false} style={{ width:'100%',border:'none',background:'transparent',fontSize:15,color:'var(--text-primary)',outline:'none' }}/>
        </MobileRow>

        {/* Description */}
        <MobileRow icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg>} border={false}>
          <textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="Add description" rows={3} autoComplete="off" autoCorrect="off" spellCheck={false} style={{ width:'100%',border:'none',background:'transparent',fontSize:15,color:'var(--text-primary)',outline:'none',resize:'none' }}/>
        </MobileRow>

        {/* Delete */}
        {event && (isToolManager || (userId && event.created_by === userId)) && (
          <div style={{ padding:'16px 20px' }}>
            <button onClick={()=>onDelete(event)} style={{ width:'100%',padding:'14px',border:'1px solid var(--error)',borderRadius:'var(--radius)',background:'transparent',color:'var(--error)',fontSize:15,fontWeight:600,cursor:'pointer' }}>Delete Event</button>
          </div>
        )}
      </form>

      {/* Overlays */}
      {showStartDate && <CalendarPicker value={sd} onChange={v=>{setSd(v);setShowStartDate(false);}} onClose={()=>setShowStartDate(false)}/>}
      {showEndDate   && <CalendarPicker value={ed} onChange={v=>{setEd(v);setShowEndDate(false);}} onClose={()=>setShowEndDate(false)}/>}
      {showRecurrence && <RecurrenceSheet value={recRule} onChange={v=>{setRecRule(v);}} onClose={()=>setShowRecurrence(false)}/>}
      {showScopeModal && <RecurringChoiceModal title="Edit recurring event" onConfirm={doSave} onCancel={()=>setShowScopeModal(false)}/>}
      {showTypeColourPicker && (
        <ColourPickerSheet value={newTypeColour} onChange={setNewTypeColour} onClose={()=>setShowTypeColourPicker(false)} title="Event Type Colour"/>
      )}
      {showAddType && (
        <div style={{ position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'flex-end' }} onClick={e=>e.target===e.currentTarget&&setShowAddType(false)}>
          <div style={{ width:'100%',background:'var(--surface)',borderRadius:'16px 16px 0 0',padding:20,boxShadow:'0 -4px 20px rgba(0,0,0,0.2)' }}>
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16 }}>
              <span style={{ fontWeight:700,fontSize:16 }}>New Event Type</span>
              <button onClick={()=>{setShowAddType(false);setNewTypeName('');setNewTypeColour('#6366f1');}} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--text-secondary)',fontSize:20,lineHeight:1 }}>✕</button>
            </div>
            <input
              autoFocus
              value={newTypeName}
              onChange={e => setNewTypeName(e.target.value)} autoComplete="off" onKeyDown={e=>e.key==='Enter'&&createEventType()}
              placeholder="Type name…" autoCorrect="off" autoCapitalize="words" spellCheck={false}
              style={{ width:'100%',padding:'12px 14px',border:'1px solid var(--border)',borderRadius:'var(--radius)',fontSize:16,marginBottom:12,boxSizing:'border-box',background:'var(--background)',color:'var(--text-primary)' }} />
            <div style={{ display:'flex',alignItems:'center',gap:12,marginBottom:16 }}>
              <label style={{ fontSize:14,color:'var(--text-tertiary)',flexShrink:0 }}>Colour</label>
              <button onClick={()=>setShowTypeColourPicker(true)} style={{ flex:1,height:40,borderRadius:'var(--radius)',border:'2px solid var(--border)',background:newTypeColour,cursor:'pointer' }}/>
            </div>
            <button
              onClick={createEventType}
              disabled={savingType||!newTypeName.trim()}
              style={{ width:'100%',padding:'14px',background:'var(--primary)',color:'white',border:'none',borderRadius:'var(--radius)',fontSize:16,fontWeight:700,cursor:'pointer',opacity:savingType?0.6:1 }}
            >{savingType?'Creating…':'Create Type'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
