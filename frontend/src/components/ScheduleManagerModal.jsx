import { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { api } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

// ── Utility ───────────────────────────────────────────────────────────────────
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(d) { return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function fmtTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtTimeRange(start, end) { return `${fmtTime(start)} – ${fmtTime(end)}`; }
function toLocalDateInput(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function toLocalTimeInput(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2,'0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
function addHours(isoStr, hrs) {
  const d = new Date(isoStr);
  d.setMinutes(d.getMinutes() + hrs * 60);
  const pad = n => String(n).padStart(2,'0');
  // Return local datetime string — do NOT use toISOString() which shifts to UTC
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}
function sameDay(a, b) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
function startOfWeek(d) { const r=new Date(d); r.setDate(d.getDate()-d.getDay()); r.setHours(0,0,0,0); return r; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function daysInMonth(y,m) { return new Date(y,m+1,0).getDate(); }

const RESPONSE_LABELS = { going: 'Going', maybe: 'Maybe', not_going: 'Not Going' };
const RESPONSE_COLOURS = { going: '#22c55e', maybe: '#f59e0b', not_going: '#ef4444' };

// ── Mini Calendar ─────────────────────────────────────────────────────────────
function MiniCalendar({ selected, onChange, eventDates = new Set() }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(selected||Date.now()); d.setDate(1); return d; });
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const total = daysInMonth(year, month);
  const today = new Date();
  const cells = [];
  for (let i=0;i<firstDow;i++) cells.push(null);
  for (let d=1;d<=total;d++) cells.push(d);
  return (
    <div style={{ userSelect: 'none' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8, fontSize:13, fontWeight:600 }}>
        <button style={{ background:'none',border:'none',cursor:'pointer',padding:'2px 6px',color:'var(--text-secondary)'}} onClick={() => { const n=new Date(cursor); n.setMonth(n.getMonth()-1); setCursor(n); }}>‹</button>
        <span>{MONTHS[month]} {year}</span>
        <button style={{ background:'none',border:'none',cursor:'pointer',padding:'2px 6px',color:'var(--text-secondary)'}} onClick={() => { const n=new Date(cursor); n.setMonth(n.getMonth()+1); setCursor(n); }}>›</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:1, fontSize:11 }}>
        {DAYS.map(d => <div key={d} style={{ textAlign:'center', fontWeight:600, color:'var(--text-tertiary)', padding:'2px 0' }}>{d[0]}</div>)}
        {cells.map((d,i) => {
          if (!d) return <div key={i}/>;
          const date = new Date(year, month, d);
          const isSel = selected && sameDay(date, new Date(selected));
          const isToday = sameDay(date, today);
          const hasEvent = eventDates.has(`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
          return (
            <div key={i} onClick={() => onChange(date)} style={{
              textAlign:'center', padding:'3px 2px', borderRadius:4, cursor:'pointer',
              background: isSel ? 'var(--primary)' : 'transparent',
              color: isSel ? 'white' : isToday ? 'var(--primary)' : 'var(--text-primary)',
              fontWeight: isToday ? 700 : 400, position:'relative',
            }}>
              {d}
              {hasEvent && !isSel && <span style={{ position:'absolute', bottom:1, left:'50%', transform:'translateX(-50%)', width:4, height:4, borderRadius:'50%', background:'var(--primary)', display:'block' }}/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Event Type Form (popup) ───────────────────────────────────────────────────
function EventTypePopup({ userGroups, onSave, onClose, editing = null }) {
  const toast = useToast();
  const [name, setName] = useState(editing?.name || '');
  const [colour, setColour] = useState(editing?.colour || '#6366f1');
  const [defaultGroupId, setDefaultGroupId] = useState(editing?.default_user_group_id || '');
  const [defaultDur, setDefaultDur] = useState(editing?.default_duration_hrs || 1);
  const [setDur, setSetDur] = useState(!!(editing?.default_duration_hrs && editing.default_duration_hrs !== 1));
  const [saving, setSaving] = useState(false);
  const DUR_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  const handleSave = async () => {
    if (!name.trim()) return toast('Name required', 'error');
    setSaving(true);
    try {
      const body = { name: name.trim(), colour, defaultUserGroupId: defaultGroupId || null, defaultDurationHrs: setDur ? defaultDur : 1 };
      const result = editing ? await api.updateEventType(editing.id, body) : await api.createEventType(body);
      onSave(result.eventType);
      onClose();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };
  return (
    <div style={{ position:'absolute', top:'100%', left:0, zIndex:200, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:16, width:280, boxShadow:'0 4px 20px rgba(0,0,0,0.15)' }}>
      <div style={{ marginBottom:10 }}>
        <label className="settings-section-label">Type Name</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="new-password" style={{ marginTop:4 }} autoFocus />
      </div>
      <div style={{ marginBottom:10 }}>
        <label className="settings-section-label">Colour</label>
        <input type="color" value={colour} onChange={e => setColour(e.target.value)} style={{ marginTop:4, width:'100%', height:32, padding:2, borderRadius:4, border:'1px solid var(--border)' }} />
      </div>
      <div style={{ marginBottom:10 }}>
        <label className="settings-section-label">Default Group</label>
        <select className="input" value={defaultGroupId} onChange={e=>setDefaultGroupId(e.target.value)} style={{ marginTop:4 }}>
          <option value="">None</option>
          {userGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div style={{ marginBottom:14 }}>
        <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer' }}>
          <input type="checkbox" checked={setDur} onChange={e=>setSetDur(e.target.checked)} /> Set default duration
        </label>
        {setDur && (
          <select className="input" value={defaultDur} onChange={e=>setDefaultDur(Number(e.target.value))} style={{ marginTop:6 }}>
            {DUR_OPTIONS.map(d => <option key={d} value={d}>{d}hr{d!==1?'s':''}</option>)}
          </select>
        )}
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving?'Saving…':'Save'}</button>
        <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ── Event Form ────────────────────────────────────────────────────────────────
function EventForm({ event, userGroups, eventTypes, selectedDate, onSave, onCancel, onDelete, isToolManager }) {
  const toast = useToast();
  const today = new Date();
  const _defD = selectedDate || today;
  const _p = n => String(n).padStart(2,'0');
  const defaultDate = `${_defD.getFullYear()}-${_p(_defD.getMonth()+1)}-${_p(_defD.getDate())}`;
  const [title, setTitle] = useState(event?.title || '');
  const [eventTypeId, setEventTypeId] = useState(event?.event_type_id || '');
  const [startDate, setStartDate] = useState(event ? toLocalDateInput(event.start_at) : defaultDate);
  const [startTime, setStartTime] = useState(event ? toLocalTimeInput(event.start_at) : '09:00');
  const [endDate, setEndDate] = useState(event ? toLocalDateInput(event.end_at) : defaultDate);
  const [endTime, setEndTime] = useState(event ? toLocalTimeInput(event.end_at) : '10:00');
  const [allDay, setAllDay] = useState(!!event?.all_day);
  const [location, setLocation] = useState(event?.location || '');
  const [description, setDescription] = useState(event?.description || '');
  const [isPublic, setIsPublic] = useState(event ? !!event.is_public : true);
  const [trackAvail, setTrackAvail] = useState(!!event?.track_availability);
  const [selectedGroups, setSelectedGroups] = useState(new Set((event?.user_groups||[]).map(g=>g.id)));
  const [saving, setSaving] = useState(false);
  const [showTypeForm, setShowTypeForm] = useState(false);
  const [localEventTypes, setLocalEventTypes] = useState(eventTypes);
  const typeRef = useRef(null);
  const savedDurMins = event
    ? (new Date(event.end_at) - new Date(event.start_at)) / 60000
    : null;
  const prevTypeIdRef = useRef(event?.event_type_id ? String(event.event_type_id) : '');
  const mountedRef = useRef(false);

  // Mark mounted after first render so effects skip initial fire
  useEffect(() => { mountedRef.current = true; }, []);

  // Auto-update end time only when type, start date, or start time actually changes
  useEffect(() => {
    if (!mountedRef.current) return; // skip initial mount
    if (!startDate || !startTime) return;
    const et = localEventTypes.find(t => t.id === Number(eventTypeId));
    const start = buildISO(startDate, startTime);
    if (!start) return;
    const typeChanged = String(eventTypeId) !== prevTypeIdRef.current;
    prevTypeIdRef.current = String(eventTypeId);
    if (!event || typeChanged) {
      // New event or explicit type change: apply eventType duration
      const dur = et?.default_duration_hrs || 1;
      setEndDate(toLocalDateInput(addHours(start, dur)));
      setEndTime(toLocalTimeInput(addHours(start, dur)));
    } else {
      // Editing start date/time with same type: preserve saved duration
      const durMins = savedDurMins || 60;
      setEndDate(toLocalDateInput(addHours(start, durMins/60)));
      setEndTime(toLocalTimeInput(addHours(start, durMins/60)));
    }
    if (et?.default_user_group_id && !event) setSelectedGroups(prev => new Set([...prev, et.default_user_group_id]));
  }, [eventTypeId, startDate, startTime]);

  const toggleGroup = (id) => setSelectedGroups(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });

  const handleSave = async () => {
    if (!title.trim()) return toast('Title required', 'error');
    if (!allDay && (!startDate||!startTime||!endDate||!endTime)) return toast('Start and end required', 'error');
    if (endDate < startDate) return toast('End date cannot be before start date', 'error');
    if (!allDay && endDate === startDate && buildISO(endDate, endTime) <= buildISO(startDate, startTime)) return toast('End time must be after start time, or use a later end date', 'error');
    setSaving(true);
    try {
      const body = {
        title: title.trim(), eventTypeId: eventTypeId || null,
        startAt: allDay ? buildISO(startDate, '00:00') : buildISO(startDate, startTime),
        endAt: allDay ? buildISO(endDate, '23:59') : buildISO(endDate, endTime),
        allDay, location, description, isPublic, trackAvailability: trackAvail,
        userGroupIds: [...selectedGroups],
      };
      const result = event ? await api.updateEvent(event.id, body) : await api.createEvent(body);
      onSave(result.event);
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const Row = ({ label, children }) => (
    <div style={{ display:'flex', alignItems:'flex-start', gap:16, marginBottom:14 }}>
      <div style={{ width:80, flexShrink:0, fontSize:13, color:'var(--text-tertiary)', paddingTop:8 }}>{label}</div>
      <div style={{ flex:1 }}>{children}</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
      {/* Title */}
      <input className="input" placeholder="Add title" value={title} onChange={e => setTitle(e.target.value)} autoComplete="new-password" style={{ fontSize:18, fontWeight:600, marginBottom:16, border:'none', borderBottom:'2px solid var(--border)', borderRadius:0, padding:'4px 0' }} />

      {/* Date/Time */}
      <Row label="">
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
          <input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width:150 }} />
          {!allDay && <input type="time" className="input" value={startTime} onChange={e => setStartTime(e.target.value)} style={{ width:120 }} />}
          <span style={{ color:'var(--text-tertiary)', fontSize:13 }}>to</span>
          {!allDay && <input type="time" className="input" value={endTime} onChange={e => {
            const newEt = e.target.value; setEndTime(newEt);
            if(startDate === endDate && newEt <= startTime) {
              const d = new Date(buildISO(startDate, startTime)); d.setDate(d.getDate()+1);
              const p = n => String(n).padStart(2,'0');
              setEndDate(`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`);
            }
          }} style={{ width:120 }} />}
          <input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ width:150 }} />
        </div>
        <label style={{ display:'flex', alignItems:'center', gap:8, marginTop:8, fontSize:13, cursor:'pointer' }}>
          <input type="checkbox" checked={allDay} onChange={e=>setAllDay(e.target.checked)} /> All day
        </label>
      </Row>

      {/* Event Type */}
      <Row label="Event Type">
        <div style={{ display:'flex', gap:8, alignItems:'center', position:'relative' }} ref={typeRef}>
          <select className="input flex-1" value={eventTypeId} onChange={e=>setEventTypeId(e.target.value)}>
            <option value="">Default</option>
            {localEventTypes.filter(t=>!t.is_default).map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {isToolManager && (
            <button className="btn btn-secondary btn-sm" onClick={()=>setShowTypeForm(v=>!v)} style={{ flexShrink:0 }}>
              {showTypeForm ? 'Cancel' : '+ Add Type'}
            </button>
          )}
          {showTypeForm && (
            <EventTypePopup userGroups={userGroups} onSave={et => setLocalEventTypes(prev=>[...prev,et])} onClose={()=>setShowTypeForm(false)} />
          )}
        </div>
      </Row>

      {/* Groups */}
      <Row label="Groups">
        <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden', maxHeight:160, overflowY:'auto' }}>
          {userGroups.length === 0 ? (
            <div style={{ padding:'10px 14px', fontSize:13, color:'var(--text-tertiary)' }}>No user groups created yet</div>
          ) : userGroups.map(g => (
            <label key={g.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 12px', borderBottom:'1px solid var(--border)', cursor:'pointer', fontSize:13 }}>
              <input type="checkbox" checked={selectedGroups.has(g.id)} onChange={()=>toggleGroup(g.id)} style={{ accentColor:'var(--primary)' }} />
              {g.name}
            </label>
          ))}
        </div>
        <div style={{ fontSize:11, color:'var(--text-tertiary)', marginTop:4 }}>
          {selectedGroups.size === 0 ? 'No groups — event visible to all (if public)' : `${selectedGroups.size} group${selectedGroups.size!==1?'s':''} selected`}
        </div>
      </Row>

      {/* Visibility + Availability */}
      <Row label="Options">
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:13, cursor:'pointer' }}>
            <input type="checkbox" checked={!isPublic} onChange={e=>setIsPublic(!e.target.checked)} />
            <span>Viewable by selected groups only</span>
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:13, cursor:'pointer' }}>
            <input type="checkbox" checked={trackAvail} onChange={e=>setTrackAvail(e.target.checked)} />
            <span>Track availability for assigned groups</span>
          </label>
        </div>
      </Row>

      {/* Location */}
      <Row label="Location">
        <input className="input" placeholder="Add location" value={location} onChange={e => setLocation(e.target.value)} autoComplete="new-password" />
      </Row>

      {/* Description */}
      <Row label="Description">
        <textarea className="input" placeholder="Add description" value={description} onChange={e=>setDescription(e.target.value)} rows={3} style={{ resize:'vertical' }} />
      </Row>

      <div style={{ display:'flex', gap:8, marginTop:8 }}>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving?'Saving…':event?'Save Changes':'Create Event'}</button>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
        {event && isToolManager && (
          <button className="btn btn-sm" style={{ marginLeft:'auto', background:'var(--error)', color:'white' }} onClick={()=>onDelete(event)}>Delete</button>
        )}
      </div>
    </div>
  );
}

// ── Event Detail Popup ────────────────────────────────────────────────────────
function EventDetailPopup({ event, onClose, onEdit, onAvailabilityChange, isToolManager, currentUserId }) {
  const toast = useToast();
  const [myResponse, setMyResponse] = useState(event.my_response);
  const [avail, setAvail] = useState(event.availability || []);
  const canSeeAvail = isToolManager || (event.user_groups||[]).some(g => {
    // Check if current user is in assigned group — simplified: trust event.my_response existing
    return true; // backend already filtered; if they can view, they're in the group
  });
  const isInGroup = event.track_availability && (isToolManager || event.user_groups?.length > 0);

  const handleResponse = async (resp) => {
    try {
      if (myResponse === resp) {
        await api.deleteAvailability(event.id);
        setMyResponse(null);
      } else {
        await api.setAvailability(event.id, resp);
        setMyResponse(resp);
      }
      onAvailabilityChange?.();
    } catch (e) { toast(e.message, 'error'); }
  };

  const counts = { going: 0, maybe: 0, not_going: 0 };
  avail.forEach(r => { if (counts[r.response] !== undefined) counts[r.response]++; });

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{ maxWidth:520 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:16 }}>
          <div style={{ flex:1, paddingRight:16 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
              {event.event_type && (
                <span style={{ width:12, height:12, borderRadius:'50%', background:event.event_type.colour, flexShrink:0, display:'inline-block' }}/>
              )}
              <h2 style={{ fontSize:20, fontWeight:700, margin:0 }}>{event.title}</h2>
            </div>
            <div style={{ fontSize:13, color:'var(--text-secondary)' }}>
              {event.event_type?.name && <span style={{ marginRight:8 }}>{event.event_type.name}</span>}
              {!event.is_public && <span style={{ background:'var(--surface-variant)', borderRadius:10, padding:'1px 8px', fontSize:11 }}>Private</span>}
            </div>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            {isToolManager && <button className="btn btn-secondary btn-sm" onClick={onEdit}>Edit</button>}
            <button className="btn-icon" onClick={onClose}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
        </div>

        {/* Date/Time */}
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:12, fontSize:14 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>{fmtDate(new Date(event.start_at))}{!event.all_day && ` · ${fmtTimeRange(event.start_at, event.end_at)}`}</span>
        </div>

        {event.location && (
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:12, fontSize:14 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <span>{event.location}</span>
          </div>
        )}

        {event.description && (
          <div style={{ display:'flex', gap:8, marginBottom:12, fontSize:14 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" style={{ flexShrink:0, marginTop:2 }}><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg>
            <span style={{ whiteSpace:'pre-wrap' }}>{event.description}</span>
          </div>
        )}

        {(event.user_groups||[]).length > 0 && (
          <div style={{ display:'flex', gap:8, marginBottom:16, fontSize:13, color:'var(--text-secondary)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" style={{ flexShrink:0, marginTop:2 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>
            <span>{event.user_groups.map(g=>g.name).join(', ')}</span>
          </div>
        )}

        {/* Availability response buttons */}
        {event.track_availability && (
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:14, marginTop:4 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8 }}>Your Availability</div>
            <div style={{ display:'flex', gap:8 }}>
              {Object.entries(RESPONSE_LABELS).map(([key, label]) => (
                <button key={key} onClick={()=>handleResponse(key)} className="btn btn-sm"
                  style={{ flex:1, background: myResponse===key ? RESPONSE_COLOURS[key] : 'var(--surface-variant)', color: myResponse===key ? 'white' : 'var(--text-primary)', borderColor: RESPONSE_COLOURS[key] }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Availability breakdown (tool managers + assigned group members) */}
            {isToolManager && avail.length >= 0 && (
              <div style={{ marginTop:14 }}>
                <div style={{ fontSize:12, fontWeight:600, color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8 }}>Responses</div>
                <div style={{ display:'flex', gap:16, marginBottom:8 }}>
                  {Object.entries(counts).map(([key, n]) => (
                    <span key={key} style={{ fontSize:13 }}>
                      <span style={{ color:RESPONSE_COLOURS[key], fontWeight:600 }}>{n}</span> {RESPONSE_LABELS[key]}
                    </span>
                  ))}
                  {event.no_response_count > 0 && (
                    <span style={{ fontSize:13 }}><span style={{ fontWeight:600 }}>{event.no_response_count}</span> No response</span>
                  )}
                </div>
                <div style={{ maxHeight:140, overflowY:'auto' }}>
                  {avail.map(r => (
                    <div key={r.user_id} style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 0', fontSize:13 }}>
                      <span style={{ width:8, height:8, borderRadius:'50%', background:RESPONSE_COLOURS[r.response], flexShrink:0, display:'inline-block' }}/>
                      <span style={{ flex:1 }}>{r.display_name || r.name}</span>
                      <span style={{ color:RESPONSE_COLOURS[r.response], fontSize:12 }}>{RESPONSE_LABELS[r.response]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Schedule (List) View ──────────────────────────────────────────────────────
function ScheduleView({ events, selectedDate, onSelectEvent }) {
  const filtered = events.filter(e => new Date(e.end_at) >= (selectedDate || new Date(0)));
  return (
    <div style={{ overflowY:'auto', flex:1 }}>
      {filtered.length === 0 && (
        <div style={{ textAlign:'center', padding:'40px 20px', color:'var(--text-tertiary)', fontSize:14 }}>No upcoming events</div>
      )}
      {filtered.map(e => {
        const start = new Date(e.start_at);
        const colour = e.event_type?.colour || '#9ca3af';
        return (
          <div key={e.id} onClick={()=>onSelectEvent(e)} style={{ display:'flex', alignItems:'center', gap:16, padding:'12px 16px', borderBottom:'1px solid var(--border)', cursor:'pointer', transition:'background var(--transition)' }}
            onMouseEnter={el=>el.currentTarget.style.background='var(--background)'}
            onMouseLeave={el=>el.currentTarget.style.background=''}>
            <div style={{ width:40, textAlign:'center', flexShrink:0 }}>
              <div style={{ fontSize:18, fontWeight:700, lineHeight:1 }}>{start.getDate()}</div>
              <div style={{ fontSize:11, color:'var(--text-tertiary)', textTransform:'uppercase' }}>{SHORT_MONTHS[start.getMonth()]}, {DAYS[start.getDay()]}</div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0, width:90, fontSize:13, color:'var(--text-secondary)' }}>
              <span style={{ width:10, height:10, borderRadius:'50%', background:colour, flexShrink:0 }}/>
              {e.all_day ? 'All day' : `${fmtTime(e.start_at)} – ${fmtTime(e.end_at)}`}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:600, display:'flex', alignItems:'center', gap:8 }}>
                {e.event_type?.name && <span style={{ fontSize:12, color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'0.5px' }}>{e.event_type.name}:</span>}
                {e.title}
                {e.track_availability && !e.my_response && (
                  <span style={{ width:8, height:8, borderRadius:'50%', background:'#ef4444', flexShrink:0 }} title="Awaiting your response"/>
                )}
              </div>
              {e.location && <div style={{ fontSize:12, color:'var(--text-tertiary)', marginTop:2 }}>{e.location}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Day View ──────────────────────────────────────────────────────────────────
function DayView({ events, selectedDate, onSelectEvent }) {
  const hours = Array.from({length:16}, (_,i)=>i+7); // 7am–10pm
  const dayEvents = events.filter(e => sameDay(new Date(e.start_at), selectedDate));
  return (
    <div style={{ overflowY:'auto', flex:1, position:'relative' }}>
      <div style={{ display:'flex', borderBottom:'1px solid var(--border)', padding:'8px 0 8px 52px', fontSize:13, fontWeight:600, color:'var(--primary)' }}>
        <div style={{ textAlign:'center' }}>
          <div>{DAYS[selectedDate.getDay()]}</div>
          <div style={{ fontSize:24, fontWeight:700 }}>{selectedDate.getDate()}</div>
        </div>
      </div>
      {hours.map(h => (
        <div key={h} style={{ display:'flex', borderBottom:'1px solid var(--border)', minHeight:48 }}>
          <div style={{ width:52, flexShrink:0, fontSize:11, color:'var(--text-tertiary)', padding:'2px 8px 0', textAlign:'right' }}>{h > 12 ? `${h-12} PM` : h === 12 ? '12 PM' : `${h} AM`}</div>
          <div style={{ flex:1, position:'relative' }}>
            {dayEvents.filter(e => new Date(e.start_at).getHours()===h).map(e => (
              <div key={e.id} onClick={()=>onSelectEvent(e)} style={{
                margin:'2px 4px', padding:'4px 8px', borderRadius:4,
                background: e.event_type?.colour || '#6366f1', color:'white',
                fontSize:12, cursor:'pointer', fontWeight:600
              }}>
                {e.title} · {fmtTimeRange(e.start_at, e.end_at)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Week View ─────────────────────────────────────────────────────────────────
function WeekView({ events, selectedDate, onSelectEvent }) {
  const weekStart = startOfWeek(selectedDate);
  const days = Array.from({length:7}, (_,i) => { const d=new Date(weekStart); d.setDate(d.getDate()+i); return d; });
  const hours = Array.from({length:16}, (_,i)=>i+7);
  const today = new Date();
  return (
    <div style={{ overflowY:'auto', flex:1 }}>
      <div style={{ display:'grid', gridTemplateColumns:'52px repeat(7,1fr)', borderBottom:'1px solid var(--border)' }}>
        <div/>
        {days.map((d,i) => (
          <div key={i} style={{ textAlign:'center', padding:'6px 4px', fontSize:12, fontWeight:600, color:sameDay(d,today)?'var(--primary)':'var(--text-secondary)' }}>
            {DAYS[d.getDay()]} {d.getDate()}
          </div>
        ))}
      </div>
      {hours.map(h => (
        <div key={h} style={{ display:'grid', gridTemplateColumns:'52px repeat(7,1fr)', borderBottom:'1px solid var(--border)', minHeight:44 }}>
          <div style={{ fontSize:11, color:'var(--text-tertiary)', padding:'2px 8px 0', textAlign:'right' }}>
            {h>12?`${h-12} PM`:h===12?'12 PM':`${h} AM`}
          </div>
          {days.map((d,i) => (
            <div key={i} style={{ borderLeft:'1px solid var(--border)', padding:'1px 2px' }}>
              {events.filter(e=>sameDay(new Date(e.start_at),d)&&new Date(e.start_at).getHours()===h).map(e=>(
                <div key={e.id} onClick={()=>onSelectEvent(e)} style={{ background:e.event_type?.colour||'#6366f1', color:'white', borderRadius:3, padding:'2px 4px', fontSize:11, cursor:'pointer', marginBottom:1, fontWeight:600 }}>
                  {e.title}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Month View ────────────────────────────────────────────────────────────────
function MonthView({ events, selectedDate, onSelectEvent, onSelectDay }) {
  const year = selectedDate.getFullYear(), month = selectedDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const total = daysInMonth(year, month);
  const today = new Date();
  const cells = [];
  for (let i=0;i<firstDow;i++) cells.push(null);
  for (let d=1;d<=total;d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i=0;i<cells.length;i+=7) weeks.push(cells.slice(i,i+7));
  return (
    <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', borderBottom:'1px solid var(--border)' }}>
        {DAYS.map(d=><div key={d} style={{ textAlign:'center', padding:'6px', fontSize:12, fontWeight:600, color:'var(--text-tertiary)' }}>{d}</div>)}
      </div>
      {weeks.map((week,wi)=>(
        <div key={wi} style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', flex:1, minHeight:80 }}>
          {week.map((d,di)=>{
            if (!d) return <div key={di} style={{ borderRight:'1px solid var(--border)', borderBottom:'1px solid var(--border)', background:'var(--surface-variant)' }}/>;
            const date = new Date(year, month, d);
            const dayEvents = events.filter(e=>sameDay(new Date(e.start_at),date));
            const isToday = sameDay(date, today);
            return (
              <div key={di} onClick={()=>onSelectDay(date)} style={{ borderRight:'1px solid var(--border)', borderBottom:'1px solid var(--border)', padding:'4px', cursor:'pointer', minHeight:80 }}
                onMouseEnter={el=>el.currentTarget.style.background='var(--background)'}
                onMouseLeave={el=>el.currentTarget.style.background=''}>
                <div style={{ width:24, height:24, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:2, fontSize:12, fontWeight:isToday?700:400, background:isToday?'var(--primary)':'transparent', color:isToday?'white':'var(--text-primary)' }}>{d}</div>
                {dayEvents.slice(0,3).map(e=>(
                  <div key={e.id} onClick={ev=>{ev.stopPropagation();onSelectEvent(e);}} style={{ background:e.event_type?.colour||'#6366f1', color:'white', borderRadius:2, padding:'1px 5px', fontSize:11, marginBottom:1, truncate:true, cursor:'pointer', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {!e.all_day&&<span style={{ marginRight:3 }}>{fmtTime(e.start_at)}</span>}{e.title}
                  </div>
                ))}
                {dayEvents.length>3&&<div style={{ fontSize:10, color:'var(--text-tertiary)' }}>+{dayEvents.length-3} more</div>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Bulk Import ───────────────────────────────────────────────────────────────
function BulkImportPanel({ onImported, onCancel }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [skipped, setSkipped] = useState(new Set());
  const [importing, setSaving] = useState(false);
  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const result = await api.importPreview(file);
      if (result.error) return toast(result.error, 'error');
      setRows(result.rows);
      setSkipped(new Set(result.rows.filter(r=>r.duplicate||r.error).map(r=>r.row)));
    } catch (err) { toast('Upload failed', 'error'); }
  };
  const handleImport = async () => {
    setSaving(true);
    try {
      const toImport = rows.filter(r => !skipped.has(r.row) && !r.error);
      const { imported } = await api.importConfirm(toImport);
      toast(`${imported} event${imported!==1?'s':''} imported`, 'success');
      onImported();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };
  return (
    <div>
      <div className="settings-section-label">Bulk Event Import</div>
      <p style={{ fontSize:12, color:'var(--text-tertiary)', marginBottom:12 }}>
        CSV fields: <code>Event Title, start_date (YYYY-MM-DD), start_time (HH:MM), event_location, event_type, default_duration</code>
      </p>
      <input type="file" accept=".csv" onChange={handleFile} style={{ marginBottom:16 }} />
      {rows && (
        <>
          <div style={{ overflowX:'auto', marginBottom:12 }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ borderBottom:'2px solid var(--border)' }}>
                  {['','Row','Title','Start','End','Type','Duration','Status'].map(h=>(
                    <th key={h} style={{ padding:'4px 8px', textAlign:'left', color:'var(--text-tertiary)', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r=>(
                  <tr key={r.row} style={{ borderBottom:'1px solid var(--border)', opacity:skipped.has(r.row)?0.4:1 }}>
                    <td style={{ padding:'4px 8px' }}>
                      <input type="checkbox" checked={!skipped.has(r.row)} disabled={!!r.error}
                        onChange={()=>setSkipped(prev=>{const n=new Set(prev);n.has(r.row)?n.delete(r.row):n.add(r.row);return n;})} />
                    </td>
                    <td style={{ padding:'4px 8px' }}>{r.row}</td>
                    <td style={{ padding:'4px 8px', fontWeight:600 }}>{r.title}</td>
                    <td style={{ padding:'4px 8px' }}>{r.startAt?.slice(0,16).replace('T',' ')}</td>
                    <td style={{ padding:'4px 8px' }}>{r.endAt?.slice(0,16).replace('T',' ')}</td>
                    <td style={{ padding:'4px 8px' }}>{r.typeName}</td>
                    <td style={{ padding:'4px 8px' }}>{r.durHrs}hr</td>
                    <td style={{ padding:'4px 8px' }}>
                      {r.error ? <span style={{ color:'var(--error)' }}>{r.error}</span>
                        : r.duplicate ? <span style={{ color:'#f59e0b' }}>⚠ Duplicate</span>
                        : <span style={{ color:'var(--success)' }}>✓ Ready</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button className="btn btn-primary btn-sm" onClick={handleImport} disabled={importing}>
              {importing ? 'Importing…' : `Import ${rows.filter(r=>!skipped.has(r.row)&&!r.error).length} events`}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Event Types Manager ───────────────────────────────────────────────────────
function EventTypesPanel({ eventTypes, userGroups, onUpdated, onClose }) {
  const toast = useToast();
  const [editingType, setEditingType] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const ref = useRef(null);

  const handleDelete = async (et) => {
    if (!confirm(`Delete event type "${et.name}"? Existing events will lose their type.`)) return;
    try {
      await api.deleteEventType(et.id);
      toast('Event type deleted', 'success');
      onUpdated();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
        <div className="settings-section-label" style={{ margin:0 }}>Event Types</div>
        <div style={{ position:'relative' }} ref={ref}>
          <button className="btn btn-primary btn-sm" onClick={()=>{setShowForm(v=>!v);setEditingType(null);}}>+ New Type</button>
          {showForm && !editingType && (
            <EventTypePopup userGroups={userGroups} onSave={()=>onUpdated()} onClose={()=>setShowForm(false)} />
          )}
        </div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {eventTypes.map(et => (
          <div key={et.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', border:'1px solid var(--border)', borderRadius:'var(--radius)' }}>
            <span style={{ width:16, height:16, borderRadius:'50%', background:et.colour, flexShrink:0 }}/>
            <span style={{ flex:1, fontSize:14, fontWeight:500 }}>{et.name}</span>
            {et.default_duration_hrs > 1 && <span style={{ fontSize:12, color:'var(--text-tertiary)' }}>{et.default_duration_hrs}hr default</span>}
            {!et.is_default && (
              <>
                <div style={{ position:'relative' }}>
                  <button className="btn btn-secondary btn-sm" onClick={()=>{setEditingType(et);setShowForm(true);}}>Edit</button>
                  {showForm && editingType?.id===et.id && (
                    <EventTypePopup editing={et} userGroups={userGroups} onSave={()=>{onUpdated();setShowForm(false);setEditingType(null);}} onClose={()=>{setShowForm(false);setEditingType(null);}} />
                  )}
                </div>
                <button className="btn btn-sm" style={{ background:'var(--error)', color:'white' }} onClick={()=>handleDelete(et)}>Delete</button>
              </>
            )}
            {et.is_default && <span style={{ fontSize:11, color:'var(--text-tertiary)' }}>Default</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function ScheduleManagerModal({ onClose, isToolManager }) {
  const { user } = useAuth();
  const toast = useToast();
  const [view, setView] = useState('schedule'); // schedule | day | week | month
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [eventTypes, setEventTypes] = useState([]);
  const [userGroups, setUserGroups] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [rightPanel, setRightPanel] = useState('calendar'); // calendar | eventForm | eventTypes | bulkImport
  const [editingEvent, setEditingEvent] = useState(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const createRef = useRef(null);

  const loadAll = useCallback(() => {
    Promise.all([
      api.getEvents(),
      api.getEventTypes(),
      api.getUserGroups(),
    ]).then(([ev, et, ug]) => {
      setEvents(ev.events || []);
      setEventTypes(et.eventTypes || []);
      setUserGroups(ug.groups || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Close create menu on outside click
  useEffect(() => {
    if (!createMenuOpen) return;
    const h = e => { if (createRef.current && !createRef.current.contains(e.target)) setCreateMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [createMenuOpen]);

  const eventDates = new Set(events.map(e => e.start_at?.slice(0,10)));

  const navDate = (dir) => {
    const d = new Date(selectedDate);
    if (view === 'day') d.setDate(d.getDate() + dir);
    else if (view === 'week') d.setDate(d.getDate() + dir*7);
    else if (view === 'month') d.setMonth(d.getMonth() + dir);
    else d.setDate(d.getDate() + dir*7);
    setSelectedDate(d);
  };

  const navLabel = () => {
    if (view === 'day') return `${DAYS[selectedDate.getDay()]} ${selectedDate.getDate()} ${MONTHS[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`;
    if (view === 'week') { const ws=startOfWeek(selectedDate); const we=new Date(ws); we.setDate(we.getDate()+6); return `${SHORT_MONTHS[ws.getMonth()]} ${ws.getDate()} – ${SHORT_MONTHS[we.getMonth()]} ${we.getDate()} ${we.getFullYear()}`; }
    return `${MONTHS[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`;
  };

  const openEventDetail = async (e) => {
    try {
      const { event } = await api.getEvent(e.id);
      setSelectedEvent(event);
    } catch (err) { toast('Failed to load event', 'error'); }
  };

  const handleEventSaved = () => {
    loadAll();
    setRightPanel('calendar');
    setEditingEvent(null);
  };

  const handleDeleteEvent = async (e) => {
    if (!confirm(`Delete "${e.title}"?`)) return;
    try { await api.deleteEvent(e.id); toast('Event deleted', 'success'); loadAll(); setSelectedEvent(null); } catch (err) { toast(err.message, 'error'); }
  };

  if (loading) return (
    <div className="modal-overlay"><div className="modal" style={{ maxWidth:200, textAlign:'center' }}>Loading…</div></div>
  );

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{ maxWidth:1024, width:'96vw', height:'90vh', display:'flex', flexDirection:'column', padding:0, overflow:'hidden' }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 20px', borderBottom:'1px solid var(--border)', flexShrink:0, gap:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            {/* Create dropdown */}
            {isToolManager && (
              <div style={{ position:'relative' }} ref={createRef}>
                <button className="btn btn-primary btn-sm" onClick={()=>setCreateMenuOpen(v=>!v)} style={{ display:'flex', alignItems:'center', gap:6 }}>
                  + Create
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {createMenuOpen && (
                  <div style={{ position:'absolute', top:'100%', left:0, zIndex:100, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--radius)', marginTop:4, minWidth:180, boxShadow:'0 4px 16px rgba(0,0,0,0.12)' }}>
                    {[['Event', ()=>{setRightPanel('eventForm');setEditingEvent(null);setCreateMenuOpen(false);}],
                      ['Event Type', ()=>{setRightPanel('eventTypes');setCreateMenuOpen(false);}],
                      ['Bulk Event Import', ()=>{setRightPanel('bulkImport');setCreateMenuOpen(false);}]
                    ].map(([label, action]) => (
                      <button key={label} onClick={action} style={{ display:'block', width:'100%', padding:'9px 14px', textAlign:'left', fontSize:14, background:'none', border:'none', cursor:'pointer', color:'var(--text-primary)' }}
                        onMouseEnter={e=>e.currentTarget.style.background='var(--background)'}
                        onMouseLeave={e=>e.currentTarget.style.background=''}>{label}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Nav */}
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <button className="btn btn-secondary btn-sm" onClick={()=>setSelectedDate(new Date())}>Today</button>
              <button className="btn-icon" onClick={()=>navDate(-1)}>‹</button>
              <button className="btn-icon" onClick={()=>navDate(1)}>›</button>
              {view !== 'schedule' && <span style={{ fontSize:14, fontWeight:600, minWidth:200 }}>{navLabel()}</span>}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {/* View switcher */}
            <div style={{ display:'flex', gap:2, background:'var(--surface-variant)', borderRadius:'var(--radius)', padding:3 }}>
              {[['schedule','Schedule'],['day','Day'],['week','Week'],['month','Month']].map(([v,l])=>(
                <button key={v} onClick={()=>{setView(v);setRightPanel('calendar');}} style={{ padding:'4px 10px', borderRadius:5, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, background: view===v ? 'var(--surface)' : 'transparent', color: view===v ? 'var(--text-primary)' : 'var(--text-tertiary)', boxShadow: view===v ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>{l}</button>
              ))}
            </div>
            <button className="btn-icon" onClick={onClose}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
        </div>

        {/* Body */}
        <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
          {/* Left panel: mini calendar */}
          <div style={{ width:210, flexShrink:0, borderRight:'1px solid var(--border)', padding:16, overflowY:'auto' }}>
            <MiniCalendar selected={selectedDate} onChange={d=>{setSelectedDate(d);setRightPanel('calendar');}} eventDates={eventDates} />
          </div>

          {/* Right panel */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            {rightPanel === 'calendar' && view === 'schedule' && (
              <ScheduleView events={events} selectedDate={selectedDate} onSelectEvent={openEventDetail} />
            )}
            {rightPanel === 'calendar' && view === 'day' && (
              <DayView events={events} selectedDate={selectedDate} onSelectEvent={openEventDetail} />
            )}
            {rightPanel === 'calendar' && view === 'week' && (
              <WeekView events={events} selectedDate={selectedDate} onSelectEvent={openEventDetail} />
            )}
            {rightPanel === 'calendar' && view === 'month' && (
              <MonthView events={events} selectedDate={selectedDate} onSelectEvent={openEventDetail}
                onSelectDay={d=>{setSelectedDate(d);setView('schedule');}} />
            )}
            {rightPanel === 'eventForm' && (
              <div style={{ padding:24, overflowY:'auto', flex:1 }}>
                <EventForm event={editingEvent} userGroups={userGroups} eventTypes={eventTypes}
                  selectedDate={selectedDate} isToolManager={isToolManager}
                  onSave={handleEventSaved}
                  onCancel={()=>{setRightPanel('calendar');setEditingEvent(null);}}
                  onDelete={handleDeleteEvent} />
              </div>
            )}
            {rightPanel === 'eventTypes' && (
              <div style={{ padding:24, overflowY:'auto', flex:1 }}>
                <EventTypesPanel eventTypes={eventTypes} userGroups={userGroups} onUpdated={loadAll}
                  onClose={()=>setRightPanel('calendar')} />
              </div>
            )}
            {rightPanel === 'bulkImport' && (
              <div style={{ padding:24, overflowY:'auto', flex:1 }}>
                <BulkImportPanel onImported={()=>{loadAll();setRightPanel('calendar');}} onCancel={()=>setRightPanel('calendar')} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Event detail popup */}
      {selectedEvent && (
        <EventDetailPopup
          event={selectedEvent}
          isToolManager={isToolManager}
          currentUserId={user?.id}
          onClose={()=>setSelectedEvent(null)}
          onEdit={()=>{ setEditingEvent(selectedEvent); setRightPanel('eventForm'); setSelectedEvent(null); }}
          onAvailabilityChange={()=>openEventDetail(selectedEvent)} />
      )}
    </div>
  );
}
