import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { api } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useSocket } from '../contexts/SocketContext.jsx';
import UserFooter from './UserFooter.jsx';
import MobileEventForm from './MobileEventForm.jsx';
import ColourPickerSheet from './ColourPickerSheet.jsx';
import MobileGroupManager from './MobileGroupManager.jsx';

// ── Utilities ─────────────────────────────────────────────────────────────────
const DAYS        = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS      = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SHORT_MONTHS= ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(d)    { return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function fmtTime(iso)  { if(!iso) return ''; const d=new Date(iso); return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
function fmtRange(s,e) { return `${fmtTime(s)} – ${fmtTime(e)}`; }
// Convert a UTC ISO string (from Postgres TIMESTAMPTZ) to local YYYY-MM-DD for <input type="date">
function toDateIn(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
// Convert a UTC ISO string to local HH:MM for <input type="time">, snapped to :00 or :30
function toTimeIn(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
// Build an ISO string with local timezone offset so Postgres stores the right UTC value
function buildISO(date, time) {
  if (!date || !time) return '';
  // Parse as local datetime then get offset-aware ISO string
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
function sameDay(a,b)  { return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); }
function weekStart(d)  { const r=new Date(d); r.setDate(d.getDate()-d.getDay()); r.setHours(0,0,0,0); return r; }
function daysInMonth(y,m){ return new Date(y,m+1,0).getDate(); }

const RESP_LABEL = { going:'Going', maybe:'Maybe', not_going:'Not Going' };
const RESP_COLOR = { going:'#22c55e', maybe:'#f59e0b', not_going:'#ef4444' };
const RESP_ICON = {
  going: (color,size=15) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={color} width={size} height={size} style={{flexShrink:0}}>
      <title>Going</title>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" />
    </svg>
  ),
  maybe: (color,size=15) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={color} width={size} height={size} style={{flexShrink:0}}>
      <title>Maybe</title>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
    </svg>
  ),
  not_going: (color,size=15) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={color} width={size} height={size} style={{flexShrink:0}}>
      <title>Not Going</title>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 16.318A4.486 4.486 0 0 0 12.016 15a4.486 4.486 0 0 0-3.198 1.318M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" />
    </svg>
  ),
};
const BELL_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" fill="#fbbf24" viewBox="0 0 24 24" strokeWidth={1.5} stroke="var(--warning-stroke)" width={15} height={15} style={{flexShrink:0}}>
    <title>Awaiting your response</title>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
  </svg>
);

// 30-minute time slots
const TIME_SLOTS = (() => {
  const s=[];
  for(let h=0;h<24;h++) for(let m of [0,30]) {
    const hh=String(h).padStart(2,'0'), mm=String(m).padStart(2,'0');
    const disp=`${h===0?12:h>12?h-12:h}:${mm} ${h<12?'AM':'PM'}`;
    s.push({value:`${hh}:${mm}`,label:disp});
  }
  return s;
})();

// Returns current time rounded up to the next :00 or :30 as HH:MM
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

// Parse a typed time string (various formats) into HH:MM, or return null
function parseTypedTime(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  // Try HH:MM
  let m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (m) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (m[3] === 'pm' && h < 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }
  // Try H am/pm or HH am/pm
  m = s.match(/^(\d{1,2})\s*(am|pm)$/);
  if (m) {
    let h = parseInt(m[1]);
    if (m[2] === 'pm' && h < 12) h += 12;
    if (m[2] === 'am' && h === 12) h = 0;
    if (h < 0 || h > 23) return null;
    return `${String(h).padStart(2,'0')}:00`;
  }
  // Try bare number 0-23 as hour
  m = s.match(/^(\d{1,2})$/);
  if (m) {
    const h = parseInt(m[1]);
    if (h < 0 || h > 23) return null;
    return `${String(h).padStart(2,'0')}:00`;
  }
  return null;
}

// Format HH:MM value as 12-hour display string
function fmt12(val) {
  if (!val) return '';
  const [hh, mm] = val.split(':').map(Number);
  const h = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  const ampm = hh < 12 ? 'AM' : 'PM';
  return `${h}:${String(mm).padStart(2,'0')} ${ampm}`;
}

// ── TimeInput — free-text time entry with 5-slot scrollable dropdown ──────────
function TimeInput({ value, onChange, style }) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState(fmt12(value));
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  // Keep display in sync when value changes externally
  useEffect(() => { setInputVal(fmt12(value)); }, [value]);

  // Scroll the dropdown so that selected slot is near the top
  useEffect(() => {
    if (!open || !listRef.current) return;
    const idx = TIME_SLOTS.findIndex(s => s.value === value);
    if (idx >= 0) {
      listRef.current.scrollTop = idx * 36 - 36;
    }
  }, [open, value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const h = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const commit = (raw) => {
    const parsed = parseTypedTime(raw);
    if (parsed) {
      onChange(parsed);
      setInputVal(fmt12(parsed));
    } else {
      // Revert to last valid value
      setInputVal(fmt12(value));
    }
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...style }}>
      <input
        type="text"
        className="input"
        value={inputVal}
        onChange={e => setInputVal(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={e => {
          // Delay so dropdown click fires first
          setTimeout(() => commit(e.target.value), 150);
        }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(inputVal); } if (e.key === 'Escape') { setInputVal(fmt12(value)); setOpen(false); } }}
        style={{ width: '100%', cursor: 'text' }}
        autoComplete="off"
        inputMode="text"
        enterKeyHint="done"
        placeholder="9:00 AM"
      />
      {open && (
        <div
          ref={listRef}
          style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 9999,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            width: '100%', minWidth: 120,
            maxHeight: 5 * 36, overflowY: 'auto',
            pointerEvents: 'auto',
          }}
        >
          {TIME_SLOTS.map(s => (
            <div
              key={s.value}
              onMouseDown={e => { e.preventDefault(); onChange(s.value); setInputVal(s.label); setOpen(false); }}
              style={{
                padding: '8px 12px', fontSize: 13, cursor: 'pointer', height: 36,
                boxSizing: 'border-box', whiteSpace: 'nowrap',
                background: s.value === value ? 'var(--primary)' : 'transparent',
                color: s.value === value ? 'white' : 'var(--text-primary)',
              }}
              onMouseEnter={e => { if (s.value !== value) e.currentTarget.style.background = 'var(--background)'; }}
              onMouseLeave={e => { if (s.value !== value) e.currentTarget.style.background = 'transparent'; }}
            >
              {s.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Mini Calendar (desktop) ───────────────────────────────────────────────────
function MiniCalendar({ selected, onChange, events=[] }) {
  const [cur, setCur] = useState(()=>{ const d=new Date(selected||Date.now()); d.setDate(1); return d; });

  // BUG FIX: sync displayed month when selected date changes (e.g. switching Day/Week/Month view resets to today)
  useEffect(() => {
    const n = new Date(selected || Date.now());
    n.setDate(1); n.setHours(0,0,0,0);
    setCur(prev => (prev.getFullYear()===n.getFullYear()&&prev.getMonth()===n.getMonth()) ? prev : n);
  }, [selected]);

  const y=cur.getFullYear(), m=cur.getMonth(), first=new Date(y,m,1).getDay(), total=daysInMonth(y,m), today=new Date();
  const cells=[]; for(let i=0;i<first;i++) cells.push(null); for(let d=1;d<=total;d++) cells.push(d);

  // BUG FIX: expand recurring events for the displayed month so all occurrences show as dots
  const eventDates = useMemo(() => {
    const rangeStart = new Date(y, m, 1);
    const rangeEnd   = new Date(y, m+1, 0, 23, 59, 59);
    const s = new Set();
    for (const ev of events) {
      const occs = expandRecurringEvent(ev, rangeStart, rangeEnd);
      for (const occ of occs) {
        if (!occ.start_at) continue;
        const d = new Date(occ.start_at);
        if (d.getFullYear()===y && d.getMonth()===m)
          s.add(`${y}-${String(m+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
      }
    }
    return s;
  }, [events, y, m]);

  return (
    <div style={{userSelect:'none'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8,fontSize:13,fontWeight:600}}>
        <button style={{background:'none',border:'none',cursor:'pointer',padding:'2px 8px',color:'var(--text-secondary)',fontSize:16}} onClick={()=>{const n=new Date(cur);n.setMonth(m-1);setCur(n);}}>‹</button>
        <span>{MONTHS[m]} {y}</span>
        <button style={{background:'none',border:'none',cursor:'pointer',padding:'2px 8px',color:'var(--text-secondary)',fontSize:16}} onClick={()=>{const n=new Date(cur);n.setMonth(m+1);setCur(n);}}>›</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:1,fontSize:11}}>
        {DAYS.map(d=><div key={d} style={{textAlign:'center',fontWeight:600,color:'var(--text-tertiary)',padding:'2px 0'}}>{d[0]}</div>)}
        {cells.map((d,i)=>{
          if(!d) return <div key={i}/>;
          const date=new Date(y,m,d), isSel=selected&&sameDay(date,new Date(selected)), isToday=sameDay(date,today);
          const key=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          return (
            <div key={i} onClick={()=>onChange(date)} style={{textAlign:'center',padding:'3px 2px',borderRadius:4,cursor:'pointer',background:isSel?'var(--primary)':'transparent',color:isSel?'white':isToday?'var(--primary)':'var(--text-primary)',fontWeight:isToday?700:400,position:'relative'}}>
              {d}
              {eventDates.has(key)&&!isSel&&<span style={{position:'absolute',bottom:1,left:'50%',transform:'translateX(-50%)',width:4,height:4,borderRadius:'50%',background:'var(--primary)',display:'block'}}/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Mobile Filter Bar (Schedule view: keyword+type filters with month nav; Day view: calendar accordion) ──
function MobileScheduleFilter({ selected, onMonthChange, view, eventTypes, filterKeyword, onFilterKeyword, filterTypeId, onFilterTypeId, filterAvailability=false, onFilterAvailability, onClearFromDate, eventDates=new Set(), onInputFocus, onInputBlur }) {
  // Day view: keep accordion calendar
  const [open, setOpen] = useState(false);
  const y=selected.getFullYear(), m=selected.getMonth();
  const today=new Date();

  if(view==='day') {
    const first=new Date(y,m,1).getDay(), total=daysInMonth(y,m);
    const cells=[]; for(let i=0;i<first;i++) cells.push(null); for(let d=1;d<=total;d++) cells.push(d);
    return (
      <div style={{borderBottom:'1px solid var(--border)',background:'var(--surface)'}}>
        <button onClick={()=>setOpen(v=>!v)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%',padding:'10px 16px',background:'none',border:'none',cursor:'pointer',fontSize:14,fontWeight:600,color:'var(--text-primary)'}}>
          <span>{MONTHS[m]} {y}</span>
          <span style={{fontSize:10,transform:open?'rotate(180deg)':'none',display:'inline-block',transition:'transform 0.2s'}}>▼</span>
        </button>
        {open && (
          <div style={{padding:'8px 12px 12px',userSelect:'none'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
              <button style={{background:'none',border:'none',cursor:'pointer',padding:'4px 10px',fontSize:16,color:'var(--text-secondary)'}} onClick={()=>onMonthChange(-1)}>‹</button>
              <button style={{background:'none',border:'none',cursor:'pointer',padding:'4px 10px',fontSize:16,color:'var(--text-secondary)'}} onClick={()=>onMonthChange(1)}>›</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,fontSize:12}}>
              {DAYS.map(d=><div key={d} style={{textAlign:'center',fontWeight:600,color:'var(--text-tertiary)',padding:'2px 0'}}>{d[0]}</div>)}
              {cells.map((d,i)=>{
                if(!d) return <div key={i}/>;
                const date=new Date(y,m,d), isSel=sameDay(date,selected), isToday=sameDay(date,today);
                const key=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                return (
                  <div key={i} onClick={()=>{const nd=new Date(y,m,d);onMonthChange(0,nd);setOpen(false);}} style={{textAlign:'center',padding:'5px 2px',borderRadius:4,cursor:'pointer',background:isSel?'var(--primary)':'transparent',color:isSel?'white':isToday?'var(--primary)':'var(--text-primary)',fontWeight:isToday&&!isSel?700:400,position:'relative'}}>
                    {d}
                    {eventDates.has(key)&&!isSel&&<span style={{position:'absolute',bottom:2,left:'50%',transform:'translateX(-50%)',width:4,height:4,borderRadius:'50%',background:'var(--primary)',display:'block'}}/>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Schedule view: accordion "Filter Events" + month nav
  const hasFilters = filterKeyword || filterTypeId || filterAvailability;
  return (
    <div style={{background:'var(--surface)',borderBottom:'1px solid var(--border)'}}>
      {/* Month nav row — always visible */}
      <div style={{display:'flex',alignItems:'center',padding:'0 8px',gap:4}}>
        <button onClick={()=>onMonthChange(-1)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-secondary)',fontSize:18,padding:'6px 8px',lineHeight:1}}>‹</button>
        <span style={{flex:1,textAlign:'center',fontSize:14,fontWeight:600}}>{MONTHS[m]} {y}</span>
        <button onClick={()=>onMonthChange(1)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-secondary)',fontSize:18,padding:'6px 8px',lineHeight:1}}>›</button>
        {/* Filter accordion toggle */}
        <button onClick={()=>setOpen(v=>!v)} style={{background:'none',border:'none',cursor:'pointer',display:'flex',alignItems:'center',gap:4,padding:'6px 8px',color:hasFilters?'var(--primary)':'var(--text-secondary)',fontSize:12,fontWeight:600}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          {hasFilters ? 'Filtered' : 'Filter'}
          <span style={{fontSize:9,transform:open?'rotate(180deg)':'none',display:'inline-block',transition:'transform 0.15s'}}>▼</span>
        </button>
      </div>
      {/* Collapsible filter panel */}
      {open && (
        <div style={{padding:'8px 12px 12px',borderTop:'1px solid var(--border)'}}>
          <div style={{position:'relative',marginBottom:8}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" style={{position:'absolute',left:9,top:'50%',transform:'translateY(-50%)',pointerEvents:'none'}}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={filterKeyword} onChange={e => onFilterKeyword(e.target.value)} autoComplete="new-password" onFocus={onInputFocus} onBlur={onInputBlur}
              placeholder="Search events…" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              style={{width:'100%',padding:'7px 8px 7px 28px',border:'1px solid var(--border)',borderRadius:'var(--radius)',background:'var(--background)',color:'var(--text-primary)',fontSize:13,boxSizing:'border-box'}}/>
          </div>
          <select value={filterTypeId} onChange={e=>onFilterTypeId(e.target.value)}
            style={{width:'100%',padding:'7px 8px',border:'1px solid var(--border)',borderRadius:'var(--radius)',background:'var(--background)',color:'var(--text-primary)',fontSize:13,marginBottom:8}}>
            <option value="">All event types</option>
            {eventTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer',marginBottom:hasFilters?8:0}}>
            <input type="checkbox" checked={filterAvailability} onChange={e=>onFilterAvailability(e.target.checked)} style={{accentColor:'var(--primary)',width:14,height:14}}/>
            Requires Availability
          </label>
          {hasFilters && (
            <button onClick={()=>{onFilterKeyword('');onFilterTypeId('');onFilterAvailability(false);onClearFromDate?.();}} style={{fontSize:12,color:'var(--error)',background:'none',border:'none',cursor:'pointer',padding:0}}>✕ Clear all filters</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Event Type Popup ──────────────────────────────────────────────────────────
function EventTypePopup({ userGroups, onSave, onClose, editing=null }) {
  const toast=useToast();
  const DUR=[1,1.5,2,2.5,3,3.5,4,4.5,5];
  const [name,setName]=useState(editing?.name||'');
  const [colour,setColour]=useState(editing?.colour||'#6366f1');
  const [groupId,setGroupId]=useState(editing?.default_user_group_id||'');
  const [dur,setDur]=useState(editing?.default_duration_hrs||1);
  const [useDur,setUseDur]=useState(!!(editing?.default_duration_hrs));
  const [saving,setSaving]=useState(false);
  const handle=async()=>{
    if(!name.trim()) return toast('Name required','error');
    setSaving(true);
    try{const body={name:name.trim(),colour,defaultUserGroupId:groupId||null,defaultDurationHrs:useDur?dur:null};const r=editing?await api.updateEventType(editing.id,body):await api.createEventType(body);onSave(r.eventType);onClose();}catch(e){toast(e.message,'error');}finally{setSaving(false);}
  };
  return (
    <div style={{position:'absolute',top:'100%',left:0,zIndex:300,background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:16,width:270,boxShadow:'0 4px 20px rgba(0,0,0,0.2)'}}>
      <div style={{marginBottom:8}}><label className="settings-section-label">Name</label><input className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="new-password" autoCorrect="off" style={{marginTop:4}} autoFocus/></div>
      <div style={{marginBottom:8}}><label className="settings-section-label">Colour</label><input type="color" value={colour} onChange={e => setColour(e.target.value)} style={{marginTop:4,width:'100%',height:32,padding:2,borderRadius:4,border:'1px solid var(--border)'}}/></div>
      <div style={{marginBottom:8}}><label className="settings-section-label">Default Group</label><select className="input" value={groupId} onChange={e=>setGroupId(e.target.value)} style={{marginTop:4}}><option value="">None</option>{userGroups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
      <div style={{marginBottom:12}}>
        <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}><input type="checkbox" checked={useDur} onChange={e=>setUseDur(e.target.checked)}/> Set default duration</label>
        {useDur&&<select className="input" value={dur} onChange={e=>setDur(Number(e.target.value))} style={{marginTop:6}}>{DUR.map(d=><option key={d} value={d}>{d}hr{d!==1?'s':''}</option>)}</select>}
      </div>
      <div style={{display:'flex',gap:8}}><button className="btn btn-primary btn-sm" onClick={handle} disabled={saving}>{saving?'…':'Save'}</button><button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button></div>
    </div>
  );
}

// ── Recurrence helpers ────────────────────────────────────────────────────────
const FREQ_OPTIONS = [
  { value: '', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
  { value: 'custom', label: 'Custom…' },
];
const DAY_PILLS = ['S','M','T','W','T','F','S'];
const DAY_KEYS  = ['SU','MO','TU','WE','TH','FR','SA'];

function recurrenceLabel(rule) {
  if (!rule || !rule.freq) return 'Does not repeat';
  const opt = FREQ_OPTIONS.find(o => o.value === rule.freq);
  if (rule.freq !== 'custom') return opt?.label || rule.freq;
  // Custom summary
  const unit = rule.interval === 1 ? rule.unit : `${rule.interval} ${rule.unit}s`;
  return `Every ${unit}`;
}

// Desktop recurrence selector — shown inline in the form
function RecurrenceSelector({ value, onChange }) {
  // value: { freq, interval, unit, byDay, ends, endDate, endCount } or null
  const [showCustom, setShowCustom] = useState(false);
  const rule = value || {};

  const handleFreqChange = (freq) => {
    if (freq === '') { onChange(null); return; }
    if (freq === 'custom') { setShowCustom(true); onChange({ freq:'custom', interval:1, unit:'week', byDay:[], ends:'never', endDate:'', endCount:13 }); return; }
    setShowCustom(false);
    onChange({ freq });
  };

  return (
    <div>
      <select className="input" value={rule.freq||''} onChange={e=>handleFreqChange(e.target.value)} style={{marginBottom: (rule.freq==='custom'||showCustom) ? 12 : 0}}>
        {FREQ_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {(rule.freq==='custom') && (
        <CustomRecurrenceFields rule={rule} onChange={onChange}/>
      )}
    </div>
  );
}

function CustomRecurrenceFields({ rule, onChange }) {
  const upd = (k,v) => onChange({...rule,[k]:v});
  return (
    <div style={{border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:12,display:'flex',flexDirection:'column',gap:10}}>
      <div style={{display:'flex',alignItems:'center',gap:8,fontSize:13}}>
        <span style={{color:'var(--text-tertiary)'}}>Every</span>
        <input type="number" className="input" min={1} max={99} value={rule.interval||1} onChange={e => upd('interval',Math.max(1,parseInt(e.target.value)||1))} autoComplete="new-password" style={{width:60,textAlign:'center'}}/>
        <select className="input" value={rule.unit||'week'} onChange={e=>upd('unit',e.target.value)} style={{flex:1}}>
          {['day','week','month','year'].map(u=><option key={u} value={u}>{u}{(rule.interval||1)>1?'s':''}</option>)}
        </select>
      </div>
      {(rule.unit||'week')==='week' && (
        <div>
          <div style={{fontSize:12,color:'var(--text-tertiary)',marginBottom:6}}>Repeats on</div>
          <div style={{display:'flex',gap:6}}>
            {DAY_PILLS.map((d,i)=>{
              const key=DAY_KEYS[i], sel=(rule.byDay||[]).includes(key);
              return <button key={key} type="button" onClick={()=>upd('byDay',sel?(rule.byDay||[]).filter(x=>x!==key):[...(rule.byDay||[]),key])} style={{width:32,height:32,borderRadius:'50%',border:'1px solid var(--border)',background:sel?'var(--primary)':'transparent',color:sel?'white':'var(--text-primary)',fontSize:11,fontWeight:600,cursor:'pointer'}}>{d}</button>;
            })}
          </div>
        </div>
      )}
      <div>
        <div style={{fontSize:12,color:'var(--text-tertiary)',marginBottom:6}}>Ends</div>
        {[['never','Never'],['on','On date'],['after','After']].map(([val,lbl])=>(
          <label key={val} style={{display:'flex',alignItems:'center',gap:10,marginBottom:6,fontSize:13,cursor:'pointer'}}>
            <input type="radio" name="recur_ends" checked={(rule.ends||'never')===val} onChange={()=>upd('ends',val)}/>
            {lbl}
            {val==='on' && (rule.ends||'never')==='on' && <input type="date" className="input" value={rule.endDate||''} onChange={e => upd('endDate',e.target.value)} autoComplete="new-password" style={{marginLeft:8,flex:1}}/>}
            {val==='after' && (rule.ends||'never')==='after' && <><input type="number" className="input" min={1} max={999} value={rule.endCount||13} onChange={e => upd('endCount',parseInt(e.target.value)||1)} autoComplete="new-password" style={{width:64,textAlign:'center',marginLeft:8}}/><span style={{color:'var(--text-tertiary)'}}>occurrences</span></>}
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Shared Row layout — defined OUTSIDE EventForm so it's stable across renders ─
function FormRow({ label, children, required }) {
  return (
    <div style={{display:'flex',alignItems:'flex-start',gap:0,marginBottom:16}}>
      <div style={{width:120,flexShrink:0,fontSize:13,color:'var(--text-tertiary)',paddingTop:9,paddingRight:16,textAlign:'right',whiteSpace:'nowrap'}}>
        {label}{required&&<span style={{color:'var(--error)'}}> *</span>}
      </div>
      <div style={{flex:1,minWidth:0}}>{children}</div>
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

// ── Confirm modal (non-recurring delete) ──────────────────────────────────────
function ConfirmModal({ title, message, confirmLabel='Delete', onConfirm, onCancel }) {
  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onCancel()}>
      <div className="modal" style={{maxWidth:360}}>
        <h3 style={{fontSize:17,fontWeight:700,margin:'0 0 12px'}}>{title}</h3>
        <p style={{fontSize:14,color:'var(--text-secondary)',margin:'0 0 24px'}}>{message}</p>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm" style={{background:'var(--error)',color:'white'}} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Event Form ────────────────────────────────────────────────────────────────
function EventForm({ event, userGroups, eventTypes, selectedDate, onSave, onCancel, onDelete, isToolManager, userId }) {
  const toast=useToast();
  const _defD = selectedDate || new Date();
  const _p = n => String(n).padStart(2,'0');
  const def = `${_defD.getFullYear()}-${_p(_defD.getMonth()+1)}-${_p(_defD.getDate())}`;
  const [title,setTitle]=useState(event?.title||'');
  const [typeId,setTypeId]=useState(event?.event_type_id||'');
  const [sd,setSd]=useState(event?toDateIn(event.start_at):def);
  const [st,setSt]=useState(event?toTimeIn(event.start_at):roundUpToHalfHour());
  const [ed,setEd]=useState(event?toDateIn(event.end_at):def);
  const [et,setEt]=useState(event?toTimeIn(event.end_at):(() => { const s=roundUpToHalfHour(); const d=new Date(`${def}T${s}:00`); d.setHours(d.getHours()+1); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; })());
  const [allDay,setAllDay]=useState(!!event?.all_day);
  const [loc,setLoc]=useState(event?.location||'');
  const [desc,setDesc]=useState(event?.description||'');
  const [pub,setPub]=useState(event?!!event.is_public:!!isToolManager);
  const [track,setTrack]=useState(!!event?.track_availability);
  const accessibleGroupIds = new Set(userGroups.map(g=>g.id));
  const [grps,setGrps]=useState(new Set((event?.user_groups||[]).map(g=>g.id).filter(id=>isToolManager||accessibleGroupIds.has(id))));
  const [saving,setSaving]=useState(false);
  const [showTypeForm,setShowTypeForm]=useState(false);
  const [localTypes,setLocalTypes]=useState(eventTypes);
  const [recRule,setRecRule]=useState(event?.recurrence_rule||null);
  const [showScopeModal,setShowScopeModal]=useState(false);
  // Sync localTypes when parent provides updated eventTypes (e.g. after async load)
  // Also initialise typeId to the default event type for new events
  useEffect(()=>{
    setLocalTypes(eventTypes);
    if(!event && typeId==='' && eventTypes.length>0) {
      const def = eventTypes.find(t=>t.is_default) || eventTypes[0];
      if(def) setTypeId(String(def.id));
    }
  },[eventTypes]);
  const typeRef=useRef(null);

  // Track whether the user has manually changed the end time (vs auto-computed)
  const userSetEndTime = useRef(!!event); // editing mode: treat saved end as user-set
  // Duration of the saved event in minutes (preserved when editing with same type)
  const savedDurMins = event
    ? (new Date(event.end_at) - new Date(event.start_at)) / 60000
    : null;
  const prevTypeIdRef = useRef(event?.event_type_id ? String(event.event_type_id) : '');
  const mountedRef = useRef(false); // skip all auto-calc effects on initial mount

  // When event type changes:
  //  - Creating: always apply the type's duration to compute end time
  //  - Editing:  only apply duration if the type HAS a defined duration
  //              (if no duration on type, keep existing saved end time)
  useEffect(()=>{
    if(!mountedRef.current) return; // skip on initial mount
    if(!sd||!st) return;
    const typ=localTypes.find(t=>t.id===Number(typeId));
    const start=buildISO(sd,st);
    if(!start) return;
    const typeChanged = typeId !== prevTypeIdRef.current;
    prevTypeIdRef.current = String(typeId);
    if(!event || typeChanged) {
      // New event or type change only: apply eventType duration
      const dur=typ?.default_duration_hrs||1;
      const endIso=addHours(start,dur);
      setEd(toDateIn(endIso)); setEt(toTimeIn(endIso));
      userSetEndTime.current = false;
    }
    if(typ?.default_user_group_id&&!event) setGrps(prev=>new Set([...prev,Number(typ.default_user_group_id)]));
  },[typeId]);

  // When start date changes: recalculate end preserving duration
  useEffect(()=>{
    if(!mountedRef.current) return;
    if(!sd||!st) return;
    const start=buildISO(sd,st);
    if(!start) return;
    const durMins = (event && savedDurMins) ? savedDurMins : (localTypes.find(t=>t.id===Number(typeId))?.default_duration_hrs||1)*60;
    const endIso=addHours(start,durMins/60);
    setEd(toDateIn(endIso)); setEt(toTimeIn(endIso));
  },[sd]);

  // When start time changes: recompute end preserving duration
  useEffect(()=>{
    if(!mountedRef.current) return;
    if(!sd||!st) return;
    const start=buildISO(sd,st);
    if(!start) return;
    const durMins = (event && savedDurMins) ? savedDurMins : (localTypes.find(t=>t.id===Number(typeId))?.default_duration_hrs||1)*60;
    setEd(toDateIn(addHours(start,durMins/60)));
    setEt(toTimeIn(addHours(start,durMins/60)));
  },[st]);

  // Mark mounted after all effects have registered — effects skip on initial render
  useEffect(()=>{ mountedRef.current = true; },[]);

  const toggleGrp=id=>setGrps(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const groupsRequired = track || !isToolManager; // tracking requires groups; non-managers always require groups

  const handle=()=>{
    if(!title.trim()) return toast('Title required','error');
    if(!allDay&&(!sd||!st||!ed||!et)) return toast('Start and end required','error');
    if(groupsRequired&&grps.size===0) return toast('Select at least one group','error');
    if(ed<sd) return toast('End date cannot be before start date','error');
    if(!allDay&&ed===sd&&buildISO(ed,et)<=buildISO(sd,st)) return toast('End time must be after start time, or use a later end date','error');
    if(!event && !allDay && new Date(buildISO(sd,st)) < new Date()) return toast('Start date and time cannot be in the past','error');
    if(!event && allDay && sd < toDateIn(new Date().toISOString())) return toast('Start date cannot be in the past','error');
    if(event && event.recurrence_rule?.freq) { setShowScopeModal(true); return; }
    doSave('this');
  };
  const doSave=async(scope)=>{
    setShowScopeModal(false);
    setSaving(true);
    try{
      const body={title:title.trim(),eventTypeId:typeId||null,startAt:allDay?buildISO(sd,'00:00'):buildISO(sd,st),endAt:allDay?buildISO(ed,'23:59'):buildISO(ed,et),allDay,location:loc,description:desc,isPublic:isToolManager?pub:false,trackAvailability:track,userGroupIds:[...grps],recurrenceRule:recRule||null};
      let r;
      if(event){
        const updateBody={...body,recurringScope:scope};
        if(event._virtual) updateBody.occurrenceStart=event.start_at;
        r=await api.updateEvent(event.id,updateBody);
      } else {
        r=await api.createEvent(body);
      }
      onSave(r.event);
    }catch(e){toast(e.message,'error');}finally{setSaving(false);}
  };

  return (
    <>
    <div style={{width:'100%',maxWidth:1024,overflowX:'auto'}}>
      {/* form wrapper suppresses Chrome Android's autofill chip bar; autoComplete="new-password"
          on individual inputs is ignored by Chrome but respected on the form element */}
      <form autoComplete="off" onSubmit={e => e.preventDefault()}>
      <div style={{minWidth:500}} onKeyDown={e=>{if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA') e.preventDefault();}}>
        {/* Title */}
        <div style={{marginBottom:20}}>
          <input className="input" placeholder="Add title" value={title} onChange={e => setTitle(e.target.value)} autoComplete="new-password" autoCorrect="off" autoCapitalize="sentences" style={{fontSize:20,fontWeight:700,border:'none',borderBottom:'2px solid var(--border)',borderRadius:0,padding:'4px 0',background:'transparent',width:'100%'}}/>
        </div>

        {/* Event Type */}
        <FormRow label="Event Type">
          <div style={{display:'flex',gap:8,alignItems:'center',position:'relative'}} ref={typeRef}>
            <select className="input" value={typeId} onChange={e=>setTypeId(e.target.value)} style={{flex:1}}>
              <option value="">— Select type —</option>
              {localTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {isToolManager&&<button className="btn btn-secondary btn-sm" style={{flexShrink:0}} onClick={()=>setShowTypeForm(v=>!v)}>{showTypeForm?'Cancel':'+ Type'}</button>}
            {showTypeForm&&<EventTypePopup userGroups={userGroups} onSave={et=>{setLocalTypes(p=>[...p,et]);setShowTypeForm(false);}} onClose={()=>setShowTypeForm(false)}/>}
          </div>
        </FormRow>

        {/* Date/Time */}
        <FormRow label="Date & Time">
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'nowrap'}}>
              <input type="date" className="input" value={sd} onChange={e => setSd(e.target.value)} autoComplete="new-password" style={{width:150,flexShrink:0}}/>
              {!allDay&&(
                <>
                  <TimeInput value={st} onChange={setSt} style={{width:120,flexShrink:0}}/>
                  <span style={{color:'var(--text-tertiary)',fontSize:13,flexShrink:0}}>to</span>
                  <TimeInput value={et} onChange={newEt=>{
                    setEt(newEt); userSetEndTime.current=true;
                    if(sd===ed && newEt<=st){ const d=new Date(buildISO(sd,st)); d.setDate(d.getDate()+1); const p=n=>String(n).padStart(2,'0'); setEd(`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`); }
                  }} style={{width:120,flexShrink:0}}/>
                  <input type="date" className="input" value={ed} onChange={e => {setEd(e.target.value);userSetEndTime.current=true;}} autoComplete="new-password" style={{width:150,flexShrink:0}}/>
                </>
              )}
            </div>
            <div style={{display:'flex',alignItems:'center',gap:16}}>
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}>
                <input type="checkbox" checked={allDay} onChange={e=>setAllDay(e.target.checked)}/> All day
              </label>
              <div style={{display:'flex',alignItems:'center',gap:8,fontSize:13}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                <span style={{color:'var(--text-tertiary)',flexShrink:0}}>Repeat:</span>
                <div style={{flex:1}}><RecurrenceSelector value={recRule} onChange={setRecRule}/></div>
              </div>
            </div>
          </div>
        </FormRow>

        {/* Availability */}
        <FormRow label="Availability">
          <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,cursor:'pointer',paddingTop:6}}>
            <input type="checkbox" checked={track} onChange={e=>{setTrack(e.target.checked);if(!e.target.checked) setPub(true);}}/>
            Track availability for assigned groups
          </label>
        </FormRow>

        {/* Groups — required when tracking */}
        <FormRow label="Groups" required={groupsRequired}>
          <div>
            <div style={{border:`1px solid ${groupsRequired&&grps.size===0?'var(--error)':'var(--border)'}`,borderRadius:'var(--radius)',overflow:'hidden',maxHeight:160,overflowY:'auto'}}>
              {userGroups.length===0
                ?<div style={{padding:'10px 14px',fontSize:13,color:'var(--text-tertiary)'}}>No user groups yet</div>
                :userGroups.map(g=>(
                  <label key={g.id} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 12px',borderBottom:'1px solid var(--border)',cursor:'pointer',fontSize:13}}>
                    <input type="checkbox" checked={grps.has(g.id)} onChange={()=>toggleGrp(g.id)} style={{accentColor:'var(--primary)'}}/>
                    {g.name}
                  </label>
                ))}
            </div>
            <p style={{fontSize:11,color:groupsRequired&&grps.size===0?'var(--error)':'var(--text-tertiary)',marginTop:4}}>
              {grps.size===0
                ? (groupsRequired?'At least one group required':'No groups — event visible to all (if public)')
                : `${grps.size} group${grps.size!==1?'s':''} selected`}
            </p>
          </div>
        </FormRow>

        {/* Visibility — only tool managers can set; regular users always create private events */}
        {isToolManager && (grps.size>0||track) && (
          <FormRow label="Visibility">
            <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,cursor:'pointer',paddingTop:6}}>
              <input type="checkbox" checked={!pub} onChange={e=>setPub(!e.target.checked)}/>
              Viewable by selected groups only (private)
            </label>
          </FormRow>
        )}

        {/* Location */}
        <FormRow label="Location">
          <input className="input" placeholder="Add location" value={loc} onChange={e => setLoc(e.target.value)} autoComplete="new-password" autoCorrect="off" autoCapitalize="off" />
        </FormRow>

        {/* Description */}
        <FormRow label="Description">
          <textarea className="input" placeholder="Add description" value={desc} onChange={e=>setDesc(e.target.value)} rows={3} autoComplete="new-password" autoCorrect="off" style={{resize:'vertical'}}/>
        </FormRow>

        <div style={{display:'flex',gap:8,marginTop:8}}>
          <button className="btn btn-primary btn-sm" onClick={handle} disabled={saving}>{saving?'Saving…':event?'Save Changes':'Create Event'}</button>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          {event&&(isToolManager||(userId&&event.created_by===userId))&&<button className="btn btn-sm" style={{marginLeft:'auto',background:'var(--error)',color:'white'}} onClick={()=>onDelete(event)}>Delete</button>}
        </div>
      </div>
      </form>
    </div>
    {showScopeModal&&<RecurringChoiceModal title="Edit recurring event" onConfirm={doSave} onCancel={()=>setShowScopeModal(false)}/>}
    </>
  );
}

// ── Event Detail Modal ────────────────────────────────────────────────────────
function EventDetailModal({ event, onClose, onEdit, onAvailabilityChange, isToolManager, userId }) {
  const toast=useToast();
  const [myResp,setMyResp]=useState(event.my_response);
  const [myNote,setMyNote]=useState(event.my_note||'');
  const [noteInput,setNoteInput]=useState(event.my_note||'');
  const [noteSaving,setNoteSaving]=useState(false);
  const [avail,setAvail]=useState(event.availability||[]);
  const [expandedNotes,setExpandedNotes]=useState(new Set());
  const [responsesExpanded,setResponsesExpanded]=useState(false);
  // Guardian Only: responder select ('all' | 'self' | 'alias:<id>' | 'partner:<id>')
  const myAliases = event.my_aliases || [];
  const myPartner = event.my_partner || null;
  const showResponderSelect = !!(event.has_players_group && (myAliases.length > 0 || myPartner)) || !!(myPartner && event.in_guardians_group);
  const [responder, setResponder] = useState(event.in_guardians_group ? 'self' : 'all');

  // Response that should be highlighted for the currently selected responder
  const activeResp = !showResponderSelect || responder === 'all'
    ? myResp
    : responder === 'self'
      ? myResp
      : responder.startsWith('alias:')
        ? (avail.find(r => r.is_alias && r.alias_id === parseInt(responder.replace('alias:','')))?.response || null)
        : (avail.find(r => !r.is_alias && r.user_id === parseInt(responder.replace('partner:','')))?.response || null);

  // Sync when parent reloads event after availability change
  useEffect(()=>{
    setMyResp(event.my_response);
    setAvail(event.availability||[]);
    setMyNote(event.my_note||'');
    setNoteInput(event.my_note||'');
  },[event]);
  const counts={going:0,maybe:0,not_going:0};
  avail.forEach(r=>{if(counts[r.response]!==undefined)counts[r.response]++;});
  const isPast = !!event.end_at && new Date(event.end_at) < new Date();
  const noteChanged = noteInput.trim() !== myNote.trim();

  const handleResp=async resp=>{
    // Guardian Only multi-responder logic
    if (showResponderSelect) {
      const note = noteInput.trim() || null;
      // Build list of responders for this action
      const targets = responder === 'all'
        ? [
            ...(event.in_guardians_group ? [{ type:'self' }] : []),
            ...myAliases.map(a => ({ type:'alias', aliasId:a.id })),
            ...(myPartner && !myPartner.respond_separately ? [{ type:'partner', userId:myPartner.id }] : []),
          ]
        : responder === 'self'
          ? [{ type:'self' }]
          : responder.startsWith('alias:')
            ? [{ type:'alias', aliasId:parseInt(responder.replace('alias:','')) }]
            : [{ type:'partner', userId:parseInt(responder.replace('partner:','')) }];

      const getCurrentResp = (t) =>
        t.type === 'self' ? myResp
        : t.type === 'alias' ? (avail.find(r => r.is_alias && r.alias_id === t.aliasId)?.response || null)
        : (avail.find(r => !r.is_alias && r.user_id === t.userId)?.response || null);

      // For "All": toggle all off only when every target already has this response;
      // otherwise set all to this response (avoids partial-toggle confusion)
      const allHaveResp = responder === 'all' && targets.every(t => getCurrentResp(t) === resp);
      try {
        for (const t of targets) {
          const prevResp = getCurrentResp(t);
          const shouldDelete = responder === 'all' ? allHaveResp : prevResp === resp;
          if (shouldDelete) {
            await api.deleteAvailability(event.id, t.type === 'alias' ? t.aliasId : undefined, t.type === 'partner' ? t.userId : undefined);
          } else {
            await api.setAvailability(event.id, resp, note, t.type === 'alias' ? t.aliasId : undefined, t.type === 'partner' ? t.userId : undefined);
          }
        }
        if (targets.some(t => t.type === 'self')) {
          setMyResp(responder === 'all' ? (allHaveResp ? null : resp) : (myResp === resp ? null : resp));
        }
        onAvailabilityChange?.(resp);
      } catch(e) { toast(e.message,'error'); }
      return;
    }

    // Normal (non-Guardian-Only) path
    const prev=myResp;
    const next=myResp===resp?null:resp;
    setMyResp(next); // optimistic update
    try{
      if(prev===resp){await api.deleteAvailability(event.id);}else{await api.setAvailability(event.id,resp,noteInput.trim()||null);}
      onAvailabilityChange?.(next); // triggers parent re-fetch to update avail list
    }catch(e){setMyResp(prev);toast(e.message,'error');} // rollback on error
  };

  const handleNoteSave=async()=>{
    if(!myResp) return; // no response row to attach note to
    setNoteSaving(true);
    try{
      await api.setAvailabilityNote(event.id,noteInput.trim()||null);
      setMyNote(noteInput.trim());
      onAvailabilityChange?.(myResp); // re-fetch to update responses list
    }catch(e){toast(e.message,'error');}finally{setNoteSaving(false);}
  };

  const toggleNote=id=>setExpandedNotes(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;});

  const handleDownloadAvailability = () => {
    // Format as "Lastname, Firstname" using first_name/last_name fields when available
    const fmtName = u => {
      // Alias entries have first_name/last_name directly
      const last  = (u.last_name  || '').trim();
      const first = (u.first_name || '').trim();
      if (last && first) return `${last}, ${first}`;
      // Fall back to splitting the combined name field
      const parts = (u.name || u.display_name || 'Unknown').trim().split(/\s+/);
      if (parts.length >= 2) return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
      return parts[0] || 'Unknown';
    };
    const sortByLastName = arr => [...arr].sort((a, b) => fmtName(a).localeCompare(fmtName(b)));
    const fmtEntry = u => {
      const note = (u.note || '').trim();
      return note ? `${fmtName(u)} - Note: ${note}` : fmtName(u);
    };

    const going     = sortByLastName(avail.filter(r => r.response === 'going'));
    const maybe     = sortByLastName(avail.filter(r => r.response === 'maybe'));
    const notGoing  = sortByLastName(avail.filter(r => r.response === 'not_going'));
    const noResp    = sortByLastName(event.no_response_users || []);

    const sections = [
      { heading: 'Going',       rows: going    },
      { heading: 'Maybe',       rows: maybe    },
      { heading: 'Not Going',   rows: notGoing },
      { heading: 'No Response', rows: noResp   },
    ];

    const eventDate = event.start_at ? fmtDate(new Date(event.start_at)) : '';
    const lines = [`${event.title}${eventDate ? ' — ' + eventDate : ''}`, ''];
    for (const sec of sections) {
      lines.push(`#### ${sec.heading}`);
      if (sec.rows.length === 0) {
        lines.push('(none)');
      } else {
        sec.rows.forEach(r => lines.push(fmtEntry(r)));
      }
      lines.push('');
    }

    const safeName = (event.title || 'event').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const fileName = `availability_${safeName}.txt`;
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });

    // On mobile use the native share sheet (lets the user choose Save to Files, etc.)
    // On desktop fall back to a standard download link.
    const file = new File([blob], fileName, { type: 'text/plain' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: fileName }).catch(() => {});
    } else {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:520,maxHeight:'88vh',overflowY:'auto'}}>
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16}}>
          <div style={{flex:1,paddingRight:12}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
              {event.event_type&&<span style={{width:13,height:13,borderRadius:'50%',background:event.event_type.colour,flexShrink:0,display:'inline-block'}}/>}
              <h2 style={{fontSize:20,fontWeight:700,margin:0}}>{event.title}</h2>
            </div>
            <div style={{fontSize:13,color:'var(--text-secondary)',display:'flex',alignItems:'center',gap:8}}>
              {event.event_type?.name&&<span>{event.event_type.name}</span>}
              {event.is_public
                ? <span style={{color:'#22c55e',fontWeight:600,fontSize:12}}>Public Event</span>
                : <span style={{color:'#ef4444',fontWeight:600,fontSize:12}}>Private Event</span>}
            </div>
          </div>
          <div style={{display:'flex',gap:6,flexShrink:0}}>
            {(isToolManager||(!isPast&&userId&&event.created_by===userId))&&<button className="btn btn-secondary btn-sm" onClick={()=>{onClose();onEdit();}}>Edit</button>}
            <button className="btn-icon" onClick={onClose}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
        </div>

        <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:12,fontSize:14}}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>{fmtDate(new Date(event.start_at))}{!event.all_day&&` · ${fmtRange(event.start_at,event.end_at)}`}</span>
        </div>
        {event.recurrence_rule?.freq&&(
          <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:12,fontSize:14}}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span>{recurrenceLabel(event.recurrence_rule)}</span>
          </div>
        )}
        {event.location&&<div style={{display:'flex',gap:10,alignItems:'center',marginBottom:12,fontSize:14}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>{event.location}</div>}
        {event.description&&<div style={{display:'flex',gap:10,marginBottom:12,fontSize:14}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" style={{flexShrink:0,marginTop:2}}><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg><span style={{whiteSpace:'pre-wrap'}}>{event.description}</span></div>}
        {(event.user_groups||[]).length>0&&<div style={{display:'flex',gap:10,marginBottom:16,fontSize:13,color:'var(--text-secondary)'}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" style={{flexShrink:0,marginTop:2}}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>{event.user_groups.map(g=>g.name).join(', ')}</div>}

        {!!event.track_availability&&(
          <div style={{borderTop:'1px solid var(--border)',paddingTop:16,marginTop:4}}>
            <div style={{display:'flex',alignItems:'center',marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:700,color:'var(--text-tertiary)',textTransform:'uppercase',letterSpacing:'0.6px',flex:1}}>Your Availability</div>
              {isToolManager&&(
                <button
                  onClick={handleDownloadAvailability}
                  title="Download Availability List"
                  style={{background:'none',border:'none',padding:2,cursor:'pointer',color:'var(--text-secondary)',display:'flex',alignItems:'center',borderRadius:4}}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" width="18" height="18">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                </button>
              )}
            </div>
            {isPast ? (
              <p style={{fontSize:13,color:'var(--text-tertiary)',marginBottom:16}}>Past event — availability is read-only.</p>
            ) : (
              <>
                <div style={{display:'flex',gap:8,marginBottom:12}}>
                  {Object.entries(RESP_LABEL).map(([key,label])=>(
                    <button key={key} onClick={()=>handleResp(key)} style={{flex:1,padding:'9px 4px',borderRadius:'var(--radius)',border:`2px solid ${RESP_COLOR[key]}`,background:activeResp===key?RESP_COLOR[key]:'transparent',color:activeResp===key?'white':RESP_COLOR[key],fontSize:13,fontWeight:600,cursor:'pointer',transition:'all 0.15s'}}>
                      {activeResp===key?'✓ ':''}{label}
                    </button>
                  ))}
                </div>
                {/* Guardian Only: responder select — shown when event targets the players group and user has aliases */}
                {showResponderSelect && (
                  <div style={{marginBottom:10}}>
                    <label style={{fontSize:11,color:'var(--text-tertiary)',textTransform:'uppercase',letterSpacing:'0.5px',display:'block',marginBottom:4}}>Responding for</label>
                    <select value={responder} onChange={e=>setResponder(e.target.value)}
                      style={{width:'100%',padding:'7px 10px',borderRadius:'var(--radius)',border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text-primary)',fontSize:13}}>
                      {event.in_guardians_group && <option value="self">Myself</option>}
                      <option value="all">Entire Family</option>
                      {myPartner && !myPartner.respond_separately && <option value={`partner:${myPartner.id}`}>{myPartner.display_name || myPartner.name}</option>}
                      {myAliases.map(a=><option key={a.id} value={`alias:${a.id}`}>{a.first_name} {a.last_name}</option>)}
                    </select>
                  </div>
                )}
                <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:16}}>
                  <input
                    type="text"
                    value={noteInput}
                    onChange={e=>setNoteInput(e.target.value.slice(0,20))}
                    placeholder="Add a note (optional)"
                    maxLength={20}
                    style={{flex:1,minWidth:0,padding:'7px 10px',borderRadius:'var(--radius)',border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text-primary)',fontSize:13,outline:'none'}}
                  />
                  <span style={{fontSize:11,color:'var(--text-tertiary)',flexShrink:0,minWidth:32,textAlign:'right'}}>{noteInput.length}/20</span>
                  {myResp&&noteChanged&&(
                    <button onClick={handleNoteSave} disabled={noteSaving} className="btn btn-primary btn-sm" style={{flexShrink:0}}>
                      {noteSaving?'…':'Save'}
                    </button>
                  )}
                </div>
              </>
            )}
            {(isToolManager||avail.length>0)&&(
              <>
                <div
                  onClick={()=>setResponsesExpanded(e=>!e)}
                  style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',userSelect:'none',marginBottom:responsesExpanded?8:0}}
                >
                  <span style={{fontSize:12,fontWeight:700,color:'var(--text-tertiary)',textTransform:'uppercase',letterSpacing:'0.6px'}}>Responses</span>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{display:'flex',gap:12,fontSize:12}}>
                      {Object.entries(counts).map(([k,n])=><span key={k}><span style={{color:RESP_COLOR[k],fontWeight:700}}>{n}</span> {RESP_LABEL[k]}</span>)}
                      {isToolManager&&<span><span style={{fontWeight:700}}>{event.no_response_count||0}</span> No response</span>}
                    </div>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5" style={{flexShrink:0,transition:'transform 0.15s',transform:responsesExpanded?'rotate(180deg)':'rotate(0deg)'}}><polyline points="6 9 12 15 18 9"/></svg>
                  </div>
                </div>
                {responsesExpanded&&avail.length>0&&(()=>{
                  const RESP_ORDER={going:0,maybe:1,not_going:2};
                  const sortedAvail=[...avail].sort((a,b)=>{
                    const od=(RESP_ORDER[a.response]??99)-(RESP_ORDER[b.response]??99);
                    if(od!==0)return od;
                    const na=a.is_alias?`${a.first_name} ${a.last_name}`:(a.display_name||a.name||'');
                    const nb=b.is_alias?`${b.first_name} ${b.last_name}`:(b.display_name||b.name||'');
                    return na.localeCompare(nb);
                  });
                  return(
                    <div style={{border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden',maxHeight:avail.length>4?'140px':undefined,overflowY:avail.length>4?'auto':undefined}}>
                      {sortedAvail.map(r=>{
                        const rowKey=r.is_alias?`alias:${r.alias_id}`:`user:${r.user_id}`;
                        const displayName=r.is_alias?`${r.first_name} ${r.last_name}`:(r.display_name||r.name);
                        const hasNote=!!(r.note&&r.note.trim());
                        const expanded=expandedNotes.has(rowKey);
                        return(
                          <div key={rowKey} style={{borderBottom:'1px solid var(--border)'}}>
                            <div
                              style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',fontSize:13,cursor:hasNote?'pointer':'default'}}
                              onClick={hasNote?()=>toggleNote(rowKey):undefined}
                            >
                              <span style={{width:9,height:9,borderRadius:'50%',background:RESP_COLOR[r.response],flexShrink:0,display:'inline-block'}}/>
                              <span style={{flex:1}}>{displayName}</span>
                              {r.is_alias&&<span style={{fontSize:11,color:'var(--text-tertiary)',fontStyle:'italic'}}>child</span>}
                              {hasNote&&(
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5" style={{flexShrink:0,transition:'transform 0.15s',transform:expanded?'rotate(180deg)':'rotate(0deg)'}}><polyline points="6 9 12 15 18 9"/></svg>
                              )}
                              <span style={{color:RESP_COLOR[r.response],fontSize:12,fontWeight:600}}>{RESP_LABEL[r.response]}</span>
                            </div>
                            {hasNote&&expanded&&(
                              <div style={{padding:'0 12px 10px 31px',fontSize:12,color:'var(--text-secondary)',fontStyle:'italic'}}>
                                {r.note}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Event Types Panel ─────────────────────────────────────────────────────────
function EventTypesPanel({ eventTypes, userGroups, onUpdated, isMobile=false }) {
  const toast=useToast();
  const [editingType,setEditingType]=useState(null);
  const [showForm,setShowForm]=useState(false);
  // Mobile bottom sheet state
  const [sheetMode,setSheetMode]=useState(null); // null | 'create' | 'edit'
  const [sheetName,setSheetName]=useState('');
  const [sheetColour,setSheetColour]=useState('#6366f1');
  const [showColourPicker,setShowColourPicker]=useState(false);
  const [sheetSaving,setSheetSaving]=useState(false);
  const openCreateSheet=()=>{setSheetName('');setSheetColour('#6366f1');setSheetMode('create');};
  const openEditSheet=(et)=>{setSheetName(et.name);setSheetColour(et.colour);setEditingType(et);setSheetMode('edit');};
  const closeSheet=()=>{setSheetMode(null);setEditingType(null);};
  const saveSheet=async()=>{
    if(!sheetName.trim()) return;
    setSheetSaving(true);
    try{
      if(sheetMode==='create') await api.createEventType({name:sheetName.trim(),colour:sheetColour});
      else await api.updateEventType(editingType.id,{name:sheetName.trim(),colour:sheetColour});
      onUpdated(); closeSheet();
    }catch(e){} finally{setSheetSaving(false);}
  };
  const handleDel=async et=>{
    if(!confirm(`Delete "${et.name}"?`)) return;
    try{await api.deleteEventType(et.id);toast('Deleted','success');onUpdated();}catch(e){toast(e.message,'error');}
  };
  return (
    <div style={{maxWidth:560}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <div className="settings-section-label" style={{margin:0}}>Event Types</div>
        <div style={{position:'relative'}}>
          <button className="btn btn-primary btn-sm" onClick={()=>isMobile?openCreateSheet():(setShowForm(v=>!v),setEditingType(null))}>+ New Type</button>
          {!isMobile&&showForm&&!editingType&&<EventTypePopup userGroups={userGroups} onSave={()=>onUpdated()} onClose={()=>setShowForm(false)}/>}
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        {eventTypes.map(et=>(
          <div key={et.id} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',border:'1px solid var(--border)',borderRadius:'var(--radius)'}}>
            <span style={{width:16,height:16,borderRadius:'50%',background:et.colour,flexShrink:0}}/>
            <span style={{flex:1,fontSize:14,fontWeight:500}}>{et.name}</span>
            {et.default_duration_hrs&&<span style={{fontSize:12,color:'var(--text-tertiary)'}}>{et.default_duration_hrs}hr default</span>}
            {!et.is_protected?(
              <div style={{display:'flex',gap:6,position:'relative'}}>
                <button className="btn btn-secondary btn-sm" onClick={()=>isMobile?openEditSheet(et):(setEditingType(et),setShowForm(true))}>Edit</button>
                {!isMobile&&showForm&&editingType?.id===et.id&&<EventTypePopup editing={et} userGroups={userGroups} onSave={()=>{onUpdated();setShowForm(false);setEditingType(null);}} onClose={()=>{setShowForm(false);setEditingType(null);}}/>}
                <button className="btn btn-sm" style={{background:'var(--error)',color:'white'}} onClick={()=>handleDel(et)}>Delete</button>
              </div>
            ):<span style={{fontSize:11,color:'var(--text-tertiary)'}}>{et.is_default?'Default':'Protected'}</span>}
          </div>
        ))}
      </div>

      {/* Mobile bottom sheet for create/edit event type */}
      {isMobile && sheetMode && (
        <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'flex-end'}} onClick={e=>e.target===e.currentTarget&&closeSheet()}>
          <div style={{width:'100%',background:'var(--surface)',borderRadius:'16px 16px 0 0',padding:20,boxShadow:'0 -4px 20px rgba(0,0,0,0.2)'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
              <span style={{fontWeight:700,fontSize:16}}>{sheetMode==='create'?'New Event Type':'Edit Event Type'}</span>
              <button onClick={closeSheet} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-secondary)',fontSize:20,lineHeight:1}}>✕</button>
            </div>
            <input autoFocus value={sheetName} onChange={e => setSheetName(e.target.value)} autoComplete="new-password" autoCorrect="off" onKeyDown={e=>e.key==='Enter'&&saveSheet()} placeholder="Type name…"
              style={{width:'100%',padding:'12px 14px',border:'1px solid var(--border)',borderRadius:'var(--radius)',fontSize:16,marginBottom:12,boxSizing:'border-box',background:'var(--background)',color:'var(--text-primary)'}}/>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
              <label style={{fontSize:14,color:'var(--text-tertiary)',flexShrink:0}}>Colour</label>
              <button onClick={()=>setShowColourPicker(true)} style={{flex:1,height:40,borderRadius:'var(--radius)',border:'2px solid var(--border)',background:sheetColour,cursor:'pointer'}}/>
            </div>
            <button onClick={saveSheet} disabled={sheetSaving||!sheetName.trim()}
              style={{width:'100%',padding:'14px',background:'var(--primary)',color:'white',border:'none',borderRadius:'var(--radius)',fontSize:16,fontWeight:700,cursor:'pointer',opacity:sheetSaving?0.6:1}}>
              {sheetSaving?'Saving…':'Save'}
            </button>
          </div>
        </div>
      )}
      {showColourPicker && (
        <ColourPickerSheet value={sheetColour} onChange={setSheetColour} onClose={()=>setShowColourPicker(false)} title="Event Type Colour"/>
      )}
    </div>
  );
}

// ── Bulk Import Panel ─────────────────────────────────────────────────────────
function BulkImportPanel({ onImported, onCancel }) {
  const toast=useToast();
  const [rows,setRows]=useState(null);
  const [skipped,setSkipped]=useState(new Set());
  const [saving,setSaving]=useState(false);
  const handleFile=async e=>{const file=e.target.files[0];if(!file)return;try{const r=await api.importPreview(file);if(r.error)return toast(r.error,'error');setRows(r.rows);setSkipped(new Set(r.rows.filter(r=>r.duplicate||r.error).map(r=>r.row)));}catch{toast('Upload failed','error');}};
  const handleImport=async()=>{setSaving(true);try{const toImport=rows.filter(r=>!skipped.has(r.row)&&!r.error);const{imported}=await api.importConfirm(toImport);toast(`${imported} event${imported!==1?'s':''} imported`,'success');onImported();}catch(e){toast(e.message,'error');}finally{setSaving(false);}};
  return (
    <div style={{maxWidth:800}}>
      <div className="settings-section-label">Bulk Event Import</div>
      <p style={{fontSize:12,color:'var(--text-tertiary)',marginBottom:12}}>CSV: <code>Event Title, start_date (YYYY-MM-DD), start_time (HH:MM), event_location, event_type, default_duration</code></p>
      <input type="file" accept=".csv" onChange={handleFile} style={{marginBottom:16}}/>
      {rows&&(<><div style={{overflowX:'auto',marginBottom:12}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr style={{borderBottom:'2px solid var(--border)'}}>{['','Row','Title','Start','End','Type','Dur','Status'].map(h=><th key={h} style={{padding:'4px 8px',textAlign:'left',color:'var(--text-tertiary)',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead><tbody>{rows.map(r=>(<tr key={r.row} style={{borderBottom:'1px solid var(--border)',opacity:skipped.has(r.row)?0.45:1}}><td style={{padding:'4px 8px'}}><input type="checkbox" checked={!skipped.has(r.row)} disabled={!!r.error} onChange={()=>setSkipped(p=>{const n=new Set(p);n.has(r.row)?n.delete(r.row):n.add(r.row);return n;})}/></td><td style={{padding:'4px 8px'}}>{r.row}</td><td style={{padding:'4px 8px',fontWeight:600}}>{r.title}</td><td style={{padding:'4px 8px'}}>{r.startAt?.slice(0,16).replace('T',' ')}</td><td style={{padding:'4px 8px'}}>{r.endAt?.slice(0,16).replace('T',' ')}</td><td style={{padding:'4px 8px'}}>{r.typeName}</td><td style={{padding:'4px 8px'}}>{r.durHrs}hr</td><td style={{padding:'4px 8px'}}>{r.error?<span style={{color:'var(--error)'}}>{r.error}</span>:r.duplicate?<span style={{color:'#f59e0b'}}>⚠ Duplicate</span>:<span style={{color:'var(--success)'}}>✓ Ready</span>}</td></tr>))}</tbody></table></div><div style={{display:'flex',gap:8}}><button className="btn btn-primary btn-sm" onClick={handleImport} disabled={saving}>{saving?'Importing…':`Import ${rows.filter(r=>!skipped.has(r.row)&&!r.error).length} events`}</button><button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button></div></>)}
    </div>
  );
}

// ── Calendar Views ────────────────────────────────────────────────────────────
// Parse keyword string into array of terms.
// Quoted phrases ("foo bar") count as one term; space-separated words are individual OR terms.
// ── Recurring event expansion ─────────────────────────────────────────────────
// Generates virtual occurrences from a recurring event's rule.
// Returns array of cloned event objects with adjusted start_at / end_at.
function expandRecurringEvent(ev, rangeStart, rangeEnd) {
  const rule = ev.recurrence_rule;
  if (!rule || !rule.freq) return [ev];

  const origStart = new Date(ev.start_at);
  const origEnd   = new Date(ev.end_at);
  const durMs     = origEnd - origStart;

  const occurrences = [];
  let cur = new Date(origStart);
  let count = 0;
  const maxOccurrences = 500; // safety cap

  // Step size based on freq/unit
  const freq = rule.freq === 'custom' ? rule.unit : rule.freq.replace('ly','').replace('dai','day').replace('week','week').replace('month','month').replace('year','year');
  const interval = rule.interval || 1;

  const step = (d) => {
    const n = new Date(d);
    if (freq === 'day'   || rule.freq === 'daily')   n.setDate(n.getDate() + interval);
    else if (freq === 'week'  || rule.freq === 'weekly')  n.setDate(n.getDate() + 7 * interval);
    else if (freq === 'month' || rule.freq === 'monthly') n.setMonth(n.getMonth() + interval);
    else if (freq === 'year'  || rule.freq === 'yearly')  n.setFullYear(n.getFullYear() + interval);
    else n.setDate(n.getDate() + 7); // fallback weekly
    return n;
  };

  // For weekly with byDay, generate per-day occurrences
  const byDay = rule.byDay && rule.byDay.length > 0 ? rule.byDay : null;
  const DAY_MAP = {SU:0,MO:1,TU:2,WE:3,TH:4,FR:5,SA:6};

  // Determine end condition
  const endDate = rule.ends === 'on' && rule.endDate ? new Date(rule.endDate + 'T23:59:59') : null;
  const endCount = rule.ends === 'after' ? (rule.endCount || 13) : null;
  const exceptions = new Set(rule.exceptions || []);
  const _pad = n => String(n).padStart(2, '0');
  const _toDateStr = d => `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}`;

  // totalOcc counts ALL occurrences from origStart regardless of range,
  // so endCount is respected even when rangeStart is after the event's start.
  let totalOcc = 0;

  // Start from original and step forward
  while (count < maxOccurrences) {
    // Check end conditions
    if (endDate && cur > endDate) break;
    if (endCount && totalOcc >= endCount) break;
    if (cur > rangeEnd) break;

    if (byDay && (rule.freq === 'weekly' || freq === 'week')) {
      // Emit one occurrence per byDay in this week
      const weekStart = new Date(cur);
      weekStart.setDate(cur.getDate() - cur.getDay()); // Sunday of this week
      for (const dayKey of byDay) {
        if (endCount && totalOcc >= endCount) break;
        const dayNum = DAY_MAP[dayKey];
        const occ = new Date(weekStart);
        occ.setDate(weekStart.getDate() + dayNum);
        occ.setHours(origStart.getHours(), origStart.getMinutes(), origStart.getSeconds());
        if (!endDate || occ <= endDate) {
          if (!exceptions.has(_toDateStr(occ))) {
            totalOcc++;
            if (occ >= rangeStart && occ <= rangeEnd) {
              const occEnd = new Date(occ.getTime() + durMs);
              occurrences.push({...ev, start_at: occ.toISOString(), end_at: occEnd.toISOString(), _virtual: true});
            }
          }
        }
      }
      cur = step(cur);
    } else {
      if (!exceptions.has(_toDateStr(cur))) {
        totalOcc++;
        if (cur >= rangeStart && cur <= rangeEnd) {
          const occEnd = new Date(cur.getTime() + durMs);
          occurrences.push({...ev, start_at: cur.toISOString(), end_at: occEnd.toISOString(), _virtual: cur.toISOString() !== ev.start_at});
        }
      }
      cur = step(cur);
    }
    count++;
  }

  // Return only occurrences that fell within the range — never return the raw event
  // as a fallback, since it may be before rangeStart (a past recurring event that
  // has no future occurrences in this window should simply not appear).
  return occurrences;
}

// Expand all recurring events in a list within a date range
function expandEvents(events, rangeStart, rangeEnd) {
  const result = [];
  for (const ev of events) {
    if (ev.recurrence_rule?.freq) {
      const expanded = expandRecurringEvent(ev, rangeStart, rangeEnd);
      result.push(...expanded);
    } else {
      result.push(ev);
    }
  }
  // Sort by start_at
  result.sort((a,b) => new Date(a.start_at) - new Date(b.start_at));
  return result;
}

// Parse keyword string into match descriptors.
// Quoted terms ("mount") -> exact whole-word match only.
// Unquoted terms (mount) -> word-boundary prefix: term must start a word,
// so "mount" matches "mountain" but "mounte" does not.
function parseKeywords(raw) {
  const terms = [];
  const re = /"([^"]+)"|(\S+)/g;
  let match;
  while((match = re.exec(raw)) !== null) {
    if (match[1] !== undefined) {
      terms.push({ term: match[1].toLowerCase(), exact: true });
    } else {
      terms.push({ term: match[2].toLowerCase(), exact: false });
    }
  }
  return terms;
}

function ScheduleView({ events, selectedDate, onSelect, filterKeyword='', filterTypeId='', filterAvailability=false, filterFromDate=null, isMobile=false }) {
  const y=selectedDate.getFullYear(), m=selectedDate.getMonth();
  const today=new Date(); today.setHours(0,0,0,0);
  const todayRef = useRef(null);
  useEffect(()=>{
    if(todayRef.current) todayRef.current.scrollIntoView({ block:'start', behavior:'instant' });
  },[selectedDate.getFullYear(), selectedDate.getMonth()]);
  const terms=parseKeywords(filterKeyword);
  const hasFilters = terms.length > 0 || !!filterTypeId || filterAvailability;
  // Only keyword/availability filters should shift the date window to today-onwards.
  // Type filter is for browsing within the current time window, not jumping to future-only.
  const hasDateShiftingFilters = terms.length > 0 || filterAvailability;
  // Expand recurring events over a wide range (2 years forward)
  const farFuture = new Date(today); farFuture.setFullYear(farFuture.getFullYear()+2);
  const expandedEvents = expandEvents(events, new Date(y,m,1), farFuture);
  const now = new Date(); // exact now for end-time comparison
  const isCurrentMonth = y === today.getFullYear() && m === today.getMonth();
  // from/to logic:
  // - filterFromDate set (mini-calendar click): show from that date to end of its month
  // - keyword/availability filters: show from today to far future (find upcoming matches)
  // - type filter only: use normal month window (same events, just filtered by type)
  // - no filters: show full month, including past events in grey
  let from, to;
  if (filterFromDate) {
    const fd = new Date(filterFromDate); fd.setHours(0,0,0,0);
    from = fd;
    to   = new Date(fd.getFullYear(), fd.getMonth()+1, 0, 23, 59, 59);
  } else if (hasDateShiftingFilters) {
    from = today;
    to   = new Date(9999,11,31);
  } else {
    // Full month — start of month to end of month, past events included (shown grey)
    from = new Date(y,m,1);
    to   = new Date(y,m+1,0,23,59,59);
  }
  const filtered=expandedEvents.filter(e=>{
    const s=new Date(e.start_at);
    if(s<from||s>to) return false;
    if(filterTypeId && String(e.event_type_id)!==String(filterTypeId)) return false;
    if(filterAvailability && !e.track_availability) return false;
    if(terms.length>0) {
      const haystack=[e.title||'',e.location||'',e.description||''].join(' ').toLowerCase();
      const matches = ({ term, exact }) => {
        if (exact) {
          // Quoted: whole-word match only — term must be surrounded by word boundaries
          return new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(haystack);
        } else {
          // Unquoted: prefix-of-word match — term must appear at the start of a word
          return new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(haystack);
        }
      };
      if(!terms.some(matches)) return false;
    }
    return true;
  });
  const emptyMsg = hasFilters
    ? 'No events match your filters'
    : new Date(y,m+1,0) < today
      ? `No events — ${MONTHS[m]} ${y} is in the past`
      : `No events in ${MONTHS[m]} ${y}`;
  if(!filtered.length) return <div style={{textAlign:'center',padding:'60px 20px',color:'var(--text-tertiary)',fontSize:14}}>{emptyMsg}</div>;
  let todayMarked = false;
  return <>{filtered.map(e=>{
    const s=new Date(e.start_at);
    const end=new Date(e.end_at);
    const sDay=new Date(s); sDay.setHours(0,0,0,0);
    const isFirstTodayOrFuture = !todayMarked && sDay >= today;
    if(isFirstTodayOrFuture) todayMarked = true;
    const isPast = !e.all_day && end < now; // event fully ended
    const col = isPast ? '#9ca3af' : (e.event_type?.colour||'#9ca3af');
    const textColor = isPast ? 'var(--text-tertiary)' : 'var(--text-primary)';
    const subColor  = isPast ? 'var(--text-tertiary)' : 'var(--text-secondary)';
    // Use CSS media query breakpoint logic — compact below 640px regardless of isMobile prop
    // so responsive desktop doesn't compact when there's plenty of room
    const compact = isMobile; // isMobile is only true on genuine mobile, not responsive desktop
    const rowPad=compact?'12px 14px':'14px 20px';
    const rowGap=compact?10:20;
    const datW=compact?36:44; const datFs=compact?20:22; const datSFs=compact?10:11;
    const timeW=compact?80:100; const timeGap=compact?5:8; const timeFs=compact?11:13;
    const dotSz=compact?8:10;
    const availIcon = !!e.track_availability && (
      e.my_response
        ? RESP_ICON[e.my_response](isPast ? '#9ca3af' : RESP_COLOR[e.my_response])
        : isPast
          ? <svg xmlns="http://www.w3.org/2000/svg" fill="#d97706" viewBox="0 0 24 24" strokeWidth={1.5} stroke="var(--warning-stroke)" width={15} height={15} style={{flexShrink:0,opacity:0.5}}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/></svg>
          : BELL_ICON
    );
    return(
      <div key={`${e.id}-${e.start_at}`} ref={isFirstTodayOrFuture ? todayRef : null} onClick={()=>onSelect(e)} style={{display:'flex',alignItems:'center',gap:rowGap,padding:rowPad,borderBottom:'1px solid var(--border)',cursor:'pointer',opacity:isPast?0.7:1}} onMouseEnter={el=>el.currentTarget.style.background='var(--background)'} onMouseLeave={el=>el.currentTarget.style.background=''}>
        {/* Date column */}
        <div style={{width:datW,textAlign:'center',flexShrink:0}}>
          <div style={{fontSize:datFs,fontWeight:700,lineHeight:1,color:textColor}}>{s.getDate()}</div>
          <div style={{fontSize:datSFs,color:'var(--text-tertiary)',textTransform:'uppercase',lineHeight:1.5}}>{SHORT_MONTHS[s.getMonth()]}</div>
          <div style={{fontSize:datSFs,color:'var(--text-tertiary)',textTransform:'uppercase',lineHeight:1.5}}>{DAYS[s.getDay()]}</div>
        </div>
        {/* Time + dot column */}
        <div style={{width:timeW,flexShrink:0,display:'flex',alignItems:'flex-start',gap:timeGap,fontSize:timeFs,color:subColor}}>
          <span style={{width:dotSz,height:dotSz,borderRadius:'50%',background:col,flexShrink:0,marginTop:3}}/>
          {e.all_day?<span>All day</span>:<span style={{lineHeight:1.5}}>{fmtTime(e.start_at)} –<br/>{fmtTime(e.end_at)}</span>}
        </div>
        {/* Title + meta column */}
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
            <span style={{fontSize:14,fontWeight:600,color:textColor,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1,minWidth:0}}>{e.title}</span>
            {availIcon}
          </div>
          {(e.event_type?.name||e.location) && (
            <div style={{fontSize:12,color:'var(--text-tertiary)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {e.event_type?.name&&<span style={{textTransform:'uppercase',letterSpacing:'0.4px',fontWeight:600,marginRight:e.location?6:0}}>{e.event_type.name}{e.location?' ·':''}</span>}
              {e.location&&<span>{e.location}</span>}
            </div>
          )}
        </div>
      </div>
    );
  })}</>;
}

const HOUR_H = 52; // px per hour row
const DAY_START = 0; // show from midnight
const DAY_END   = 24; // to midnight

function eventTopOffset(startDate) {
  const h=startDate.getHours(), m=startDate.getMinutes();
  return (h - DAY_START)*HOUR_H + (m/60)*HOUR_H;
}
function eventHeightPx(startDate, endDate) {
  const diffMs=endDate-startDate;
  const diffHrs=diffMs/(1000*60*60);
  return Math.max(diffHrs*HOUR_H, HOUR_H*0.4); // min 40% of one hour row
}

// Compute column assignments for events that overlap in time.
// Returns array of {event, col, totalCols} where col 0..totalCols-1.
function layoutEvents(evs) {
  if (!evs.length) return [];
  const sorted = [...evs].sort((a,b) => new Date(a.start_at) - new Date(b.start_at));
  const cols = []; // each col is array of events placed there
  const result = [];

  for (const e of sorted) {
    const eStart = new Date(e.start_at), eEnd = new Date(e.end_at);
    // Find first column where this event doesn't overlap with the last event
    let placed = false;
    for (let ci = 0; ci < cols.length; ci++) {
      const lastInCol = cols[ci][cols[ci].length - 1];
      if (new Date(lastInCol.end_at) <= eStart) {
        cols[ci].push(e);
        result.push({ event: e, col: ci });
        placed = true;
        break;
      }
    }
    if (!placed) {
      cols.push([e]);
      result.push({ event: e, col: cols.length - 1 });
    }
  }

  // Determine totalCols for each event = max cols among overlapping group
  for (const item of result) {
    const eStart = new Date(item.event.start_at), eEnd = new Date(item.event.end_at);
    let maxCol = item.col;
    for (const other of result) {
      const oStart = new Date(other.event.start_at), oEnd = new Date(other.event.end_at);
      if (oStart < eEnd && oEnd > eStart) maxCol = Math.max(maxCol, other.col);
    }
    item.totalCols = maxCol + 1;
  }
  return result;
}

function DayView({ events: rawEvents, selectedDate, onSelect, onSwipe }) {
  const dayStart = new Date(selectedDate); dayStart.setHours(0,0,0,0);
  const dayEnd   = new Date(selectedDate); dayEnd.setHours(23,59,59,999);
  const events = expandEvents(rawEvents, dayStart, dayEnd);
  const hours=Array.from({length:DAY_END - DAY_START},(_,i)=>i+DAY_START);
  const day=events.filter(e=>sameDay(new Date(e.start_at),selectedDate));
  const allDayEvs=day.filter(e=>e.all_day);
  const timedEvs=day.filter(e=>!e.all_day);
  const tzOff=-new Date().getTimezoneOffset();
  const tzLabel=`GMT${tzOff>=0?'+':'-'}${String(Math.floor(Math.abs(tzOff)/60)).padStart(2,'0')}`;
  const scrollRef = useRef(null);
  const touchRef = useRef({ x:0, y:0 });
  useEffect(()=>{
    if(!scrollRef.current) return;
    const now = new Date();
    const topPx = Math.max(0, now.getHours() * HOUR_H + (now.getMinutes() / 60) * HOUR_H - 2 * HOUR_H);
    scrollRef.current.scrollTop = topPx;
  },[selectedDate]);
  const fmtHour = h => h===0?'12 AM':h<12?`${h} AM`:h===12?'12 PM':`${h-12} PM`;
  const handleTouchStart = e => { touchRef.current = { x:e.touches[0].clientX, y:e.touches[0].clientY }; };
  const handleTouchEnd = e => {
    const dx = e.changedTouches[0].clientX - touchRef.current.x;
    const dy = Math.abs(e.changedTouches[0].clientY - touchRef.current.y);
    // Only trigger horizontal swipe if clearly horizontal (dx > dy) and > 60px
    // and not from left edge (< 30px = OS back gesture)
    if(Math.abs(dx) > 60 && Math.abs(dx) > dy * 1.5 && touchRef.current.x > 30) {
      onSwipe?.(dx < 0 ? 1 : -1); // left = next day, right = prev day
    }
  };
  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%',touchAction:'pan-y'}} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div style={{display:'flex',borderBottom:'1px solid var(--border)',padding:'8px 0 8px 60px',fontSize:13,fontWeight:600,color:'var(--primary)',flexShrink:0}}>
        <div style={{textAlign:'center'}}><div>{DAYS[selectedDate.getDay()]}</div><div style={{fontSize:28,fontWeight:700}}>{selectedDate.getDate()}</div></div>
      </div>
      <div style={{display:'flex',borderBottom:'1px solid var(--border)',flexShrink:0,minHeight:28}}>
        <div style={{width:60,flexShrink:0,fontSize:10,color:'var(--text-tertiary)',padding:'4px 8px',textAlign:'right',alignSelf:'center'}}>{tzLabel}</div>
        <div style={{flex:1,padding:'2px 4px',display:'flex',flexDirection:'column',gap:2}}>
          {allDayEvs.map(e=>(
            <div key={e.id} onClick={()=>onSelect(e)} style={{background:e.event_type?.colour||'#6366f1',color:'white',borderRadius:3,padding:'2px 6px',fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              {e.title}
            </div>
          ))}
        </div>
      </div>
      <div ref={scrollRef} style={{flex:1,overflowY:'auto',position:'relative',touchAction:'pan-y'}}>
        <div style={{position:'relative',paddingBottom:onSwipe?80:0}}>
          {hours.map(h=>(
            <div key={h} style={{display:'flex',borderBottom:'1px solid var(--border)',height:HOUR_H}}>
              <div style={{width:60,flexShrink:0,fontSize:11,color:'var(--text-tertiary)',padding:'3px 10px 0',textAlign:'right'}}>{fmtHour(h)}</div>
              <div style={{flex:1}}/>
            </div>
          ))}
          {layoutEvents(timedEvs).map(({event:e,col,totalCols})=>{
            const s=new Date(e.start_at), en=new Date(e.end_at);
            const top=eventTopOffset(s), height=eventHeightPx(s,en);
            return(
              <div key={e.id} onClick={()=>onSelect(e)} style={{
                position:'absolute',
                left: `calc(64px + ${col / totalCols * 100}% - ${col * 64 / totalCols}px)`,
                right: `calc(${(totalCols - col - 1) / totalCols * 100}% - ${(totalCols - col - 1) * 64 / totalCols}px + 4px)`,
                top, height,
                background:e.event_type?.colour||'#6366f1', color:'white',
                borderRadius:5, padding:'3px 6px', cursor:'pointer',
                fontSize:11, fontWeight:600, overflow:'hidden',
                boxShadow:'0 1px 3px rgba(0,0,0,0.2)',
                zIndex: col,
              }}>
                <div style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.title}</div>
                {height>28&&<div style={{fontSize:9,opacity:0.85,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{fmtRange(e.start_at,e.end_at)}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WeekView({ events: rawEvents, selectedDate, onSelect }) {
  const _ws = weekStart(selectedDate);
  const _we = new Date(_ws); _we.setDate(_we.getDate()+6); _we.setHours(23,59,59,999);
  const events = expandEvents(rawEvents, _ws, _we);
  const ws=weekStart(selectedDate), days=Array.from({length:7},(_,i)=>{const d=new Date(ws);d.setDate(d.getDate()+i);return d;});
  const hours=Array.from({length:DAY_END - DAY_START},(_,i)=>i+DAY_START), today=new Date();
  const tzOff=-new Date().getTimezoneOffset();
  const tzLabel=`GMT${tzOff>=0?'+':'-'}${String(Math.floor(Math.abs(tzOff)/60)).padStart(2,'0')}`;
  const scrollRef = useRef(null);
  const touchRef = useRef({ x:0, y:0 });
  useEffect(()=>{
    if(!scrollRef.current) return;
    const now = new Date();
    const topPx = Math.max(0, now.getHours() * HOUR_H + (now.getMinutes() / 60) * HOUR_H - 2 * HOUR_H);
    scrollRef.current.scrollTop = topPx;
  },[selectedDate]);
  const fmtHour = h => h===0?'12 AM':h<12?`${h} AM`:h===12?'12 PM':`${h-12} PM`;
  const handleTouchStart = e => { touchRef.current = { x:e.touches[0].clientX, y:e.touches[0].clientY }; };
  const handleTouchEnd = e => {
    const dx = e.changedTouches[0].clientX - touchRef.current.x;
    const dy = Math.abs(e.changedTouches[0].clientY - touchRef.current.y);
    // Only trigger horizontal swipe if clearly horizontal (dx > dy) and > 60px
    // and not from left edge (< 30px = OS back gesture)
    if(Math.abs(dx) > 60 && Math.abs(dx) > dy * 1.5 && touchRef.current.x > 30) {
      onSwipe?.(dx < 0 ? 1 : -1); // left = next day, right = prev day
    }
  };
  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%',touchAction:'pan-y'}} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {/* Day headers */}
      <div style={{display:'grid',gridTemplateColumns:'60px repeat(7,1fr)',borderBottom:'1px solid var(--border)',background:'var(--surface)',flexShrink:0}}>
        <div/>
        {days.map((d,i)=><div key={i} style={{textAlign:'center',padding:'6px 4px',fontSize:12,fontWeight:600,color:sameDay(d,today)?'var(--primary)':'var(--text-secondary)'}}>{DAYS[d.getDay()]} {d.getDate()}</div>)}
      </div>
      {/* All-day row */}
      <div style={{display:'grid',gridTemplateColumns:'60px repeat(7,1fr)',borderBottom:'1px solid var(--border)',flexShrink:0,minHeight:28}}>
        <div style={{fontSize:10,color:'var(--text-tertiary)',padding:'4px 8px',textAlign:'right',alignSelf:'center'}}>{tzLabel}</div>
        {days.map((d,di)=>{
          const adEvs=events.filter(e=>e.all_day&&sameDay(new Date(e.start_at),d));
          return(
            <div key={di} style={{borderLeft:'1px solid var(--border)',padding:'2px 2px',display:'flex',flexDirection:'column',gap:1}}>
              {adEvs.map(e=>(
                <div key={e.id} onClick={()=>onSelect(e)} style={{background:e.event_type?.colour||'#6366f1',color:'white',borderRadius:3,padding:'2px 4px',fontSize:10,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                  {e.title}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {/* Scrollable time grid */}
      <div ref={scrollRef} style={{flex:1,overflowY:'auto',touchAction:'pan-y'}}>
      <div style={{display:'grid',gridTemplateColumns:'60px repeat(7,1fr)',position:'relative'}}>
        {/* Time labels column */}
        <div>
          {hours.map(h=>(
            <div key={h} style={{height:HOUR_H,borderBottom:'1px solid var(--border)',fontSize:11,color:'var(--text-tertiary)',padding:'3px 10px 0',textAlign:'right'}}>{fmtHour(h)}</div>
          ))}
        </div>
        {/* Day columns */}
        {days.map((d,di)=>{
          const dayEvs=events.filter(e=>!e.all_day&&sameDay(new Date(e.start_at),d));
          return(
            <div key={di} style={{position:'relative',borderLeft:'1px solid var(--border)'}}>
              {hours.map(h=><div key={h} style={{height:HOUR_H,borderBottom:'1px solid var(--border)'}}/>)}
              {layoutEvents(dayEvs).map(({event:e,col,totalCols})=>{
                const s=new Date(e.start_at),en=new Date(e.end_at);
                const top=eventTopOffset(s), height=eventHeightPx(s,en);
                const pctLeft  = `${col / totalCols * 100}%`;
                const pctWidth = `calc(${100 / totalCols}% - 4px)`;
                return(
                  <div key={e.id} onClick={()=>onSelect(e)} style={{
                    position:'absolute', top, height,
                    left: pctLeft, width: pctWidth,
                    background:e.event_type?.colour||'#6366f1',color:'white',
                    borderRadius:3,padding:'2px 4px',cursor:'pointer',
                    fontSize:11,fontWeight:600,overflow:'hidden',
                    boxShadow:'0 1px 2px rgba(0,0,0,0.2)',
                    zIndex: col,
                  }}>
                    <div style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.title}</div>
                    {height>26&&<div style={{fontSize:9,opacity:0.85,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{fmtTime(e.start_at)}-{fmtTime(e.end_at)}</div>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

const MONTH_CELL_H = 90; // fixed cell height in px

function MonthView({ events: rawEvents, selectedDate, onSelect, onSelectDay }) {
  const y=selectedDate.getFullYear(), m=selectedDate.getMonth(), first=new Date(y,m,1).getDay(), total=daysInMonth(y,m), today=new Date();
  const monthStart = new Date(y,m,1), monthEnd = new Date(y,m+1,0,23,59,59,999);
  const events = expandEvents(rawEvents, monthStart, monthEnd);
  const cells=[]; for(let i=0;i<first;i++) cells.push(null); for(let d=1;d<=total;d++) cells.push(d);
  while(cells.length%7!==0) cells.push(null);
  const weeks=[]; for(let i=0;i<cells.length;i+=7) weeks.push(cells.slice(i,i+7));
  const nWeeks = weeks.length;
  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',borderBottom:'1px solid var(--border)',flexShrink:0}}>
        {DAYS.map(d=><div key={d} style={{textAlign:'center',padding:'8px',fontSize:12,fontWeight:600,color:'var(--text-tertiary)'}}>{d}</div>)}
      </div>
      <div style={{flex:1,display:'grid',gridTemplateRows:`repeat(${nWeeks},1fr)`,overflow:'hidden'}}>
      {weeks.map((week,wi)=>(
        <div key={wi} style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)'}}>
          {week.map((d,di)=>{
            if(!d) return <div key={di} style={{borderRight:'1px solid var(--border)',borderBottom:'1px solid var(--border)',minHeight:MONTH_CELL_H,background:'var(--surface-variant)'}}/>;
            const date=new Date(y,m,d), dayEvs=events.filter(e=>sameDay(new Date(e.start_at),date)), isToday=sameDay(date,today);
            return(
              <div key={di} onClick={()=>onSelectDay(date)} style={{borderRight:'1px solid var(--border)',borderBottom:'1px solid var(--border)',minHeight:MONTH_CELL_H,padding:'3px',cursor:'pointer',overflow:'hidden',display:'flex',flexDirection:'column'}}
                onMouseEnter={el=>el.currentTarget.style.background='var(--background)'} onMouseLeave={el=>el.currentTarget.style.background=''}>
                <div style={{width:24,height:24,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:2,fontSize:12,fontWeight:isToday?700:400,background:isToday?'var(--primary)':'transparent',color:isToday?'white':'var(--text-primary)',flexShrink:0}}>{d}</div>
                {dayEvs.slice(0,2).map(e=>(
                  <div key={e.id} onClick={ev=>{ev.stopPropagation();onSelect(e);}} style={{
                    background:e.event_type?.colour||'#6366f1',color:'white',
                    borderRadius:3,padding:'1px 4px',fontSize:11,marginBottom:1,cursor:'pointer',
                    whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',flexShrink:0,
                  }}>
                    {e.all_day?<span style={{marginRight:3,opacity:0.85}}>All Day:</span>:<span style={{marginRight:3,opacity:0.85}}>{fmtTime(e.start_at)}</span>}{e.title}
                  </div>
                ))}
                {dayEvs.length>2&&<div style={{fontSize:10,color:'var(--text-tertiary)',flexShrink:0}}>+{dayEvs.length-2} more</div>}
              </div>
            );
          })}
        </div>
      ))}
      </div>
    </div>
  );
}

// ── Main Schedule Page ────────────────────────────────────────────────────────
export default function SchedulePage({ isToolManager, isMobile, onProfile, onHelp, onAbout }) {
  const { user } = useAuth();
  const toast = useToast();
  const { socket } = useSocket();

  // Mobile: only day + schedule views
  const allowedViews = isMobile ? ['schedule','day'] : ['schedule','day','week','month'];
  const [view, setView] = useState('schedule');
  const [selDate, setSelDate] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [eventTypes, setEventTypes] = useState([]);
  const [userGroups, setUserGroups] = useState([]);
  const [panel, setPanel] = useState('calendar');
  const [editingEvent, setEditingEvent] = useState(null);
  const [filterKeyword, setFilterKeyword] = useState('');
  const [filterTypeId, setFilterTypeId] = useState('');
  const [filterAvailability, setFilterAvailability] = useState(false);
  const [filterFromDate, setFilterFromDate] = useState(null); // set by mini-calendar click
  const [inputFocused, setInputFocused] = useState(false); // hides footer when keyboard open on mobile
  const [detailEvent, setDetailEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(null); // null | 'eventForm' | 'groupManager'
  const createRef = useRef(null);
  const contentRef = useRef(null);

  const load = useCallback(() => {
    const ugPromise = isToolManager ? api.getUserGroups() : api.getMyScheduleGroups();
    Promise.all([api.getEvents(), api.getEventTypes(), ugPromise])
      .then(([ev,et,ug]) => { setEvents(ev.events||[]); setEventTypes(et.eventTypes||[]); setUserGroups(ug.groups||[]); setLoading(false); })
      .catch(() => setLoading(false));
  }, [isToolManager]);

  useEffect(() => { load(); }, [load]);

  // Re-fetch when removed from a user group (private event visibility may change)
  useEffect(() => {
    if (!socket) return;
    socket.on('schedule:refresh', load);
    return () => socket.off('schedule:refresh', load);
  }, [socket, load]);

  // Reset scroll to top on date/view change; schedule view scrolls to today via ScheduleView's own effect
  useEffect(() => { if (contentRef.current && view !== 'schedule') contentRef.current.scrollTop = 0; }, [selDate, view]);

  useEffect(() => {
    if (!createOpen) return;
    const h = e => { if (createRef.current && !createRef.current.contains(e.target)) setCreateOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [createOpen]);

  const eventDates = new Set(events.map(e => {
    if (!e.start_at) return null;
    const d = new Date(e.start_at);
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }).filter(Boolean));

  const navDate = dir => {
    const d = new Date(selDate);
    if (view==='day') d.setDate(d.getDate()+dir);
    else if (view==='week') d.setDate(d.getDate()+dir*7);
    else {
      d.setDate(1); // prevent overflow (e.g. Jan 31 + 1 month = Mar 3 without this)
      d.setMonth(d.getMonth()+dir);
      // Month nav: clear mini-calendar filter and show full month
      setFilterFromDate(null);
      setFilterKeyword('');
      setFilterTypeId('');
      setFilterAvailability(false);
    }
    setSelDate(d);
  };

  const navLabel = () => {
    if (view==='day') return `${DAYS[selDate.getDay()]} ${selDate.getDate()} ${MONTHS[selDate.getMonth()]} ${selDate.getFullYear()}`;
    if (view==='week') { const ws=weekStart(selDate),we=new Date(ws); we.setDate(we.getDate()+6); return `${SHORT_MONTHS[ws.getMonth()]} ${ws.getDate()} – ${SHORT_MONTHS[we.getMonth()]} ${we.getDate()} ${we.getFullYear()}`; }
    return `${MONTHS[selDate.getMonth()]} ${selDate.getFullYear()}`; // schedule + month
  };

  const openDetail = async e => {
    try {
      const { event } = await api.getEvent(e.id);
      // Virtual recurring occurrences carry their own start/end dates — overlay them so
      // the modal shows the correct occurrence time and isPast evaluates against the
      // occurrence's end_at, not the base event's first-occurrence end_at.
      if (e._virtual) { event.start_at = e.start_at; event.end_at = e.end_at; event._virtual = true; }
      setDetailEvent(event);
    } catch { toast('Failed to load event','error'); }
  };

  const handleSaved = () => { load(); setPanel('calendar'); setEditingEvent(null); };
  const [deleteTarget, setDeleteTarget] = useState(null);
  const handleDelete = (e) => setDeleteTarget(e);
  const doDelete = async (scope = 'this') => {
    const e = deleteTarget;
    setDeleteTarget(null);
    try {
      await api.deleteEvent(e.id, scope, e._virtual ? e.start_at : null);
      toast('Deleted','success');
      setPanel('calendar');
      setEditingEvent(null);
      setDetailEvent(null);
      load();
    } catch(err) { toast(err.message,'error'); }
  };

  if (loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',flex:1,color:'var(--text-tertiary)',fontSize:14}}>Loading schedule…</div>;

  // ── Sidebar width matches Messages sidebar (320px) ────────────────────────
  const SIDEBAR_W = isMobile ? 0 : 320;

  return (
    <div style={{ display:'flex', flex:1, overflow:'hidden', minHeight:0 }}>
      {/* Left panel — matches sidebar width */}
      {!isMobile && (
        <div style={{ width:SIDEBAR_W, flexShrink:0, borderRight:'1px solid var(--border)', display:'flex', flexDirection:'column', background:'var(--surface)', overflow:'hidden' }}>
          <div style={{ padding:'16px 16px 0' }}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:12, color:'var(--text-primary)' }}>Team Schedule</div>

            {/* Create button — visible to all users */}
            <div style={{ position:'relative', marginBottom:12 }} ref={createRef}>
              <button className="newchat-btn" onClick={() => setCreateOpen(v=>!v)} style={{ width:'100%', justifyContent:'center', gap:8 }}>
                Create Event
                {isToolManager && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>}
              </button>
              {createOpen && (
                <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:100, background:'var(--surface-variant)', border:'1px solid var(--border)', borderRadius:'var(--radius)', marginTop:4, boxShadow:'0 4px 16px rgba(0,0,0,0.18)' }}>
                  {[
                    ['Event', ()=>{setPanel('eventForm');setEditingEvent(null);setCreateOpen(false);setFilterKeyword('');setFilterTypeId('');}],
                    ...(isToolManager ? [
                      ['Event Type', ()=>{setPanel('eventTypes');setCreateOpen(false);setFilterKeyword('');setFilterTypeId('');}],
                      ['Bulk Event Import', ()=>{setPanel('bulkImport');setCreateOpen(false);}],
                    ] : []),
                  ].map(([label,action])=>(
                    <button key={label} onClick={action} style={{display:'block',width:'100%',padding:'9px 16px',textAlign:'left',fontSize:14,background:'none',border:'none',cursor:'pointer',color:'var(--text-primary)'}}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--background)'} onMouseLeave={e=>e.currentTarget.style.background=''}>{label}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Mini calendar */}
          <div style={{ padding:'8px 16px 16px' }}>
            <div className="section-label" style={{ marginBottom:8 }}>Filter Events</div>
            <MiniCalendar selected={selDate} onChange={d=>{
              setSelDate(d);
              setPanel('calendar');
              setFilterFromDate(d);
              setFilterKeyword('');
              setFilterTypeId('');
              setFilterAvailability(false);
            }} events={events}/>
          </div>

          {/* List view filters — only shown in Schedule list view */}
          {view==='schedule' && panel==='calendar' && (
            <div style={{ padding:'0 16px 16px' }}>
              <div className="section-label" style={{ marginBottom:8 }}>Search (today &amp; future)</div>
              <input
                className="input"
                placeholder={`Keyword… (space = OR, "phrase")`}
                value={filterKeyword}
                onChange={e => { setFilterKeyword(e.target.value); if (!e.target.value) setFilterFromDate(null); }} autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                style={{ marginBottom:8, fontSize:13 }} />
              <select
                className="input"
                value={filterTypeId}
                onChange={e=>setFilterTypeId(e.target.value)}
                style={{ fontSize:13 }}
              >
                <option value="">All event types</option>
                {eventTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer',marginTop:6}}>
                <input type="checkbox" checked={filterAvailability} onChange={e=>setFilterAvailability(e.target.checked)} style={{accentColor:'var(--primary)',width:14,height:14}}/>
                Requires Availability
              </label>
              {(filterKeyword||filterTypeId||filterAvailability) && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={()=>{setFilterKeyword('');setFilterTypeId('');setFilterAvailability(false);setFilterFromDate(null);}}
                  style={{ marginTop:8, width:'100%' }}
                >Clear filters</button>
              )}
            </div>
          )}
          <div style={{ flex:1 }}/>
          <UserFooter onProfile={onProfile} onHelp={onHelp} onAbout={onAbout} />
        </div>
      )}

      {/* Right panel + mobile bottom bar — column flex so bottom bar stays at bottom */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>
        {/* View toolbar */}
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 16px', borderBottom:'1px solid var(--border)', background:'var(--surface)', flexShrink:0, flexWrap:'nowrap' }}>
          {/* Mobile title + create */}
          {isMobile && (
            <span style={{ fontSize:15, fontWeight:700, flex:1 }}>Team Schedule</span>
          )}

          {!isMobile && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => setSelDate(new Date())}>Today</button>
              <div style={{ display:'flex', gap:2 }}>
                <button className="btn-icon" onClick={() => navDate(-1)} style={{ fontSize:16, padding:'2px 8px' }}>‹</button>
                <button className="btn-icon" onClick={() => navDate(1)}  style={{ fontSize:16, padding:'2px 8px' }}>›</button>
              </div>
              <span style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', whiteSpace:'nowrap' }}>{navLabel()}</span>
              <div style={{ marginLeft:'auto' }}/>
            </>
          )}

          {/* View switcher */}
          <div style={{ display:'flex', gap:2, background:'var(--surface-variant)', borderRadius:'var(--radius)', padding:3, flexShrink:0 }}>
            {allowedViews.map(v => {
              const labels = { schedule:'Schedule', day:'Day', week:'Week', month:'Month' };
              return (
                <button key={v} onClick={()=>{setView(v);setPanel('calendar');setSelDate(new Date());setFilterKeyword('');setFilterTypeId('');setFilterAvailability(false);setFilterFromDate(null);}} style={{ padding:'4px 10px', borderRadius:5, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, background:view===v?'var(--surface)':'transparent', color:view===v?'var(--text-primary)':'var(--text-tertiary)', boxShadow:view===v?'0 1px 3px rgba(0,0,0,0.1)':'none', transition:'all 0.15s', whiteSpace:'nowrap' }}>
                  {labels[v]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Mobile filter bar — Schedule view: filters + month nav; Day view: calendar accordion */}
        {isMobile && panel === 'calendar' && (
          <MobileScheduleFilter
            selected={selDate}
            view={view}
            eventTypes={eventTypes}
            filterKeyword={filterKeyword}
            onFilterKeyword={val => { setFilterKeyword(val); if (!val) setFilterFromDate(null); }}
            filterTypeId={filterTypeId}
            onFilterTypeId={setFilterTypeId}
            filterAvailability={filterAvailability}
            onFilterAvailability={setFilterAvailability}
            onClearFromDate={() => setFilterFromDate(null)}
            onInputFocus={()=>setInputFocused(true)}
            onInputBlur={()=>setInputFocused(false)}
            eventDates={eventDates}
            onMonthChange={(dir, exactDate) => {
              if(exactDate) { setSelDate(exactDate); }
              else { const d=new Date(selDate); d.setDate(1); d.setMonth(d.getMonth()+dir); setFilterFromDate(null); setSelDate(d); }
            }} />
        )}

        {/* Calendar or panel content */}
        <div ref={contentRef} style={{ flex:1, display:'flex', flexDirection:'column', overflow: view==='month' && panel==='calendar' ? 'hidden' : (panel==='eventForm'?'auto':'auto'), overflowX: panel==='eventForm'?'auto':'hidden' }}>
          {panel === 'calendar' && view === 'schedule' && <div style={{paddingBottom: isMobile ? 80 : 0}}><ScheduleView events={events} selectedDate={selDate} onSelect={openDetail} filterKeyword={filterKeyword} filterTypeId={filterTypeId} filterAvailability={filterAvailability} filterFromDate={filterFromDate} isMobile={isMobile}/></div>}
          {panel === 'calendar' && view === 'day'      && <DayView events={events} selectedDate={selDate} onSelect={openDetail} onSwipe={isMobile ? dir => { const d=new Date(selDate); d.setDate(d.getDate()+dir); setSelDate(d); } : undefined}/>}
          {panel === 'calendar' && view === 'week'     && <WeekView events={events} selectedDate={selDate} onSelect={openDetail}/>}
          {panel === 'calendar' && view === 'month'    && <MonthView events={events} selectedDate={selDate} onSelect={openDetail} onSelectDay={d=>{setSelDate(d);setView('day');}}/>}

          {panel === 'eventForm' && !isMobile && (
            <div style={{ padding:28, maxWidth:1024 }}>
              <h2 style={{ fontSize:17, fontWeight:700, marginBottom:24 }}>{editingEvent?'Edit Event':'New Event'}</h2>
              <EventForm event={editingEvent} userGroups={userGroups} eventTypes={eventTypes} selectedDate={selDate} isToolManager={isToolManager} userId={user.id}
                onSave={handleSaved} onCancel={()=>{setPanel('calendar');setEditingEvent(null);setFilterKeyword('');setFilterTypeId('');}} onDelete={handleDelete}/>
            </div>
          )}

          {panel === 'eventTypes' && isToolManager && (
            <div style={{ padding:28 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:24 }}>
                <h2 style={{ fontSize:17, fontWeight:700, margin:0 }}>Event Types</h2>
                <button className="btn btn-secondary btn-sm" onClick={()=>setPanel('calendar')}>← Back</button>
              </div>
              <EventTypesPanel eventTypes={eventTypes} userGroups={userGroups} onUpdated={load} isMobile={isMobile}/>
            </div>
          )}
          {panel === 'bulkImport' && isToolManager && (
            <div style={{ padding:28 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:24 }}>
                <h2 style={{ fontSize:17, fontWeight:700, margin:0 }}>Bulk Event Import</h2>
                <button className="btn btn-secondary btn-sm" onClick={()=>setPanel('calendar')}>← Back</button>
              </div>
              <BulkImportPanel onImported={()=>{load();setPanel('calendar');}} onCancel={()=>setPanel('calendar')}/>
            </div>
          )}
        </div>

        {/* Mobile bottom bar — hidden when keyboard open to avoid being pushed up */}
        {isMobile && !inputFocused && (
          <div style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:20, background:'var(--surface)', borderTop:'1px solid var(--border)' }}>
            <UserFooter onProfile={onProfile} onHelp={onHelp} onAbout={onAbout} />
          </div>
        )}
      </div>

      {/* Delete confirmation modals */}
      {deleteTarget && deleteTarget.recurrence_rule?.freq
        ? <RecurringChoiceModal title="Delete recurring event" onConfirm={doDelete} onCancel={()=>setDeleteTarget(null)}/>
        : deleteTarget && <ConfirmModal title="Delete event" message={`Delete "${deleteTarget.title}"?`} onConfirm={()=>doDelete('this')} onCancel={()=>setDeleteTarget(null)}/>
      }

      {/* Fixed overlays — position:fixed so they escape layout, can live anywhere in tree */}
      {isMobile && mobilePanel === 'groupManager' && (
        <div style={{ position:'fixed',inset:0,zIndex:50,background:'var(--background)' }}>
          <MobileGroupManager onClose={() => setMobilePanel(null)}/>
        </div>
      )}
      {panel === 'eventForm' && isMobile && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, zIndex:40, background:'var(--background)', display:'flex', flexDirection:'column' }}>
          <MobileEventForm
            event={editingEvent}
            userGroups={userGroups}
            eventTypes={eventTypes}
            selectedDate={selDate}
            isToolManager={isToolManager}
            userId={user.id}
            onSave={handleSaved}
            onCancel={()=>{setPanel('calendar');setEditingEvent(null);setFilterKeyword('');setFilterTypeId('');}}
            onDelete={handleDelete} />
        </div>
      )}

      {/* Mobile FAB — same position as Messages newchat-fab */}
      {isMobile && panel === 'calendar' && (
        <div ref={createRef} style={{ position:'fixed', bottom:'calc(80px + env(safe-area-inset-bottom, 0px))', right:16, zIndex:30 }}>
          <button className="newchat-fab" style={{ position:'static' }} onClick={() => {
            if (isToolManager) { setCreateOpen(v=>!v); }
            else { setPanel('eventForm'); setEditingEvent(null); setFilterKeyword(''); setFilterTypeId(''); }
          }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="24" height="24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
          {isToolManager && createOpen && (
            <div style={{ position:'absolute', bottom:'calc(100% + 8px)', right:0, zIndex:100, background:'var(--surface-variant)', border:'1px solid var(--border)', borderRadius:'var(--radius)', boxShadow:'0 -4px 16px rgba(0,0,0,0.15)', minWidth:180 }}>
              {[['Event', ()=>{setPanel('eventForm');setEditingEvent(null);setCreateOpen(false);setFilterKeyword('');setFilterTypeId('');}],
                ['Event Type', ()=>{setPanel('eventTypes');setCreateOpen(false);setFilterKeyword('');setFilterTypeId('');}],
              ].map(([label,action])=>(
                <button key={label} onClick={action} style={{display:'block',width:'100%',padding:'12px 16px',textAlign:'left',fontSize:15,background:'none',border:'none',cursor:'pointer',color:'var(--text-primary)',borderBottom:'1px solid var(--border)'}}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--background)'} onMouseLeave={e=>e.currentTarget.style.background=''}>{label}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Event detail modal */}
      {detailEvent && (
        <EventDetailModal
          event={detailEvent}
          isToolManager={isToolManager}
          userId={user.id}
          onClose={() => setDetailEvent(null)}
          onEdit={() => { setEditingEvent(detailEvent); setPanel('eventForm'); setDetailEvent(null); }}
          onAvailabilityChange={(resp) => {
            // Update the list so the "awaiting response" dot disappears immediately
            setEvents(prev => prev.map(e => e.id === detailEvent.id ? {...e, my_response: resp} : e));
            openDetail(detailEvent);
          }} />
      )}
    </div>
  );
}
