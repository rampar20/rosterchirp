// Shared mobile-friendly colour picker — used by EventTypesPanel and MobileEventForm
// Renders inline (no sheet wrapper) so callers can embed it wherever they like.
import { useState, useEffect, useRef } from 'react';

const COLOUR_SUGGESTIONS = [
  '#1a73e8','#a142f4','#e53935','#fa7b17','#34a853','#00bcd4',
  '#ff5722','#795548','#607d8b','#e91e63','#9c27b0','#3f51b5',
];

function hexToHsv(hex) {
  const r=parseInt(hex.slice(1,3),16)/255, g=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  let h=0;
  if(d!==0){if(max===r)h=((g-b)/d+(g<b?6:0))/6;else if(max===g)h=((b-r)/d+2)/6;else h=((r-g)/d+4)/6;}
  return{h:h*360,s:max===0?0:d/max,v:max};
}
function hsvToHex(h,s,v){
  h=h/360;const i=Math.floor(h*6),f=h*6-i;
  const p=v*(1-s),q=v*(1-f*s),t=v*(1-(1-f)*s);
  let r,g,b;
  switch(i%6){case 0:r=v;g=t;b=p;break;case 1:r=q;g=v;b=p;break;case 2:r=p;g=v;b=t;break;case 3:r=p;g=q;b=v;break;case 4:r=t;g=p;b=v;break;default:r=v;g=p;b=q;}
  return'#'+[r,g,b].map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join('');
}
function isValidHex(h){return/^#[0-9a-fA-F]{6}$/.test(h);}

function SvSquare({hue,s,v,onChange}){
  const canvasRef=useRef(null);const dragging=useRef(false);
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height;
    const hGrad=ctx.createLinearGradient(0,0,W,0);hGrad.addColorStop(0,'#fff');hGrad.addColorStop(1,`hsl(${hue},100%,50%)`);
    ctx.fillStyle=hGrad;ctx.fillRect(0,0,W,H);
    const vGrad=ctx.createLinearGradient(0,0,0,H);vGrad.addColorStop(0,'transparent');vGrad.addColorStop(1,'#000');
    ctx.fillStyle=vGrad;ctx.fillRect(0,0,W,H);
  },[hue]);
  const getPos=(e,canvas)=>{
    const r=canvas.getBoundingClientRect();
    const cx=(e.touches?e.touches[0].clientX:e.clientX)-r.left;
    const cy=(e.touches?e.touches[0].clientY:e.clientY)-r.top;
    return{s:Math.max(0,Math.min(1,cx/r.width)),v:Math.max(0,Math.min(1,1-cy/r.height))};
  };
  const handle=(e)=>{e.preventDefault();const p=getPos(e,canvasRef.current);onChange(p.s,p.v);};
  return(
    <div style={{position:'relative',userSelect:'none',touchAction:'none'}}>
      <canvas ref={canvasRef} width={280} height={160}
        style={{display:'block',width:'100%',height:160,borderRadius:8,cursor:'crosshair',border:'1px solid var(--border)'}}
        onMouseDown={e=>{dragging.current=true;handle(e);}} onMouseMove={e=>{if(dragging.current)handle(e);}}
        onMouseUp={()=>{dragging.current=false;}} onMouseLeave={()=>{dragging.current=false;}}
        onTouchStart={handle} onTouchMove={handle}/>
      <div style={{position:'absolute',left:`calc(${s*100}% - 7px)`,top:`calc(${(1-v)*100}% - 7px)`,
        width:14,height:14,borderRadius:'50%',border:'2px solid white',
        boxShadow:'0 0 0 1.5px rgba(0,0,0,0.4)',pointerEvents:'none'}}/>
    </div>
  );
}

function HueBar({hue,onChange}){
  const barRef=useRef(null);const dragging=useRef(false);
  const handle=(e)=>{
    e.preventDefault();const r=barRef.current.getBoundingClientRect();
    const cx=(e.touches?e.touches[0].clientX:e.clientX)-r.left;
    onChange(Math.max(0,Math.min(360,(cx/r.width)*360)));
  };
  return(
    <div style={{position:'relative',userSelect:'none',touchAction:'none',marginTop:10}}>
      <div ref={barRef} style={{height:22,borderRadius:11,background:'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)',border:'1px solid var(--border)',cursor:'pointer'}}
        onMouseDown={e=>{dragging.current=true;handle(e);}} onMouseMove={e=>{if(dragging.current)handle(e);}}
        onMouseUp={()=>{dragging.current=false;}} onMouseLeave={()=>{dragging.current=false;}}
        onTouchStart={handle} onTouchMove={handle}/>
      <div style={{position:'absolute',left:`calc(${(hue/360)*100}% - 10px)`,top:-2,
        width:20,height:26,borderRadius:5,background:`hsl(${hue},100%,50%)`,
        border:'2px solid white',boxShadow:'0 0 0 1.5px rgba(0,0,0,0.3)',pointerEvents:'none'}}/>
    </div>
  );
}

// Full inline picker — no sheet wrapper, callers handle the container
export function ColourPicker({ value, onChange }) {
  const {h:ih,s:is,v:iv}=hexToHsv(value||'#6366f1');
  const [mode,setMode]=useState('suggestions'); // 'suggestions' | 'custom'
  const [hue,setHue]=useState(ih);
  const [sat,setSat]=useState(is);
  const [val,setVal]=useState(iv);
  const [hexInput,setHexInput]=useState(value||'#6366f1');
  const [hexError,setHexError]=useState(false);
  const current=hsvToHex(hue,sat,val);

  // Sync from value prop when it changes externally
  useEffect(()=>{
    if(value&&isValidHex(value)){
      const{h,s,v}=hexToHsv(value);
      setHue(h);setSat(s);setVal(v);setHexInput(value);
    }
  },[value]);

  useEffect(()=>{setHexInput(current);setHexError(false);},[current]);

  const handleHexInput=(e)=>{
    const v=e.target.value;setHexInput(v);
    if(isValidHex(v)){const{h,s,v:bv}=hexToHsv(v);setHue(h);setSat(s);setVal(bv);setHexError(false);}
    else setHexError(true);
  };

  if(mode==='suggestions') return(
    <div>
      {/* Current preview */}
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
        <div style={{width:36,height:36,borderRadius:8,background:value,border:'2px solid var(--border)',flexShrink:0}}/>
        <span style={{fontSize:13,fontFamily:'monospace',color:'var(--text-secondary)'}}>{value}</span>
      </div>
      {/* Swatches */}
      <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}}>
        {COLOUR_SUGGESTIONS.map(hex=>(
          <button key={hex} onClick={()=>onChange(hex)} style={{
            width:36,height:36,borderRadius:8,background:hex,cursor:'pointer',flexShrink:0,
            border:hex===value?'3px solid var(--text-primary)':'2px solid var(--border)',
            boxShadow:hex===value?'0 0 0 2px var(--surface),0 0 0 4px var(--text-primary)':'none',
          }}/>
        ))}
      </div>
      <button className="btn btn-secondary btn-sm" onClick={()=>setMode('custom')}>Custom colour</button>
    </div>
  );

  return(
    <div>
      <SvSquare hue={hue} s={sat} v={val} onChange={(s,v)=>{setSat(s);setVal(v);}}/>
      <HueBar hue={hue} onChange={setHue}/>
      <div style={{display:'flex',alignItems:'center',gap:10,marginTop:12}}>
        <div style={{width:40,height:40,borderRadius:8,background:current,border:'2px solid var(--border)',flexShrink:0}}/>
        <input value={hexInput} onChange={handleHexInput} maxLength={7} placeholder="#000000"
          style={{fontFamily:'monospace',fontSize:14,padding:'6px 10px',borderRadius:8,
            border:`1px solid ${hexError?'#e53935':'var(--border)'}`,width:110,
            background:'var(--surface)',color:'var(--text-primary)'}} autoComplete="new-password" />
      </div>
      <div style={{display:'flex',gap:8,marginTop:12}}>
        <button className="btn btn-primary btn-sm" onClick={()=>{onChange(current);setMode('suggestions');}} disabled={hexError}>Set</button>
        <button className="btn btn-secondary btn-sm" onClick={()=>setMode('suggestions')}>Back</button>
      </div>
    </div>
  );
}

// Bottom-sheet wrapper for mobile — position:fixed, slides up from bottom
export default function ColourPickerSheet({ value, onChange, onClose, title='Pick a colour' }) {
  return (
    <div style={{position:'fixed',inset:0,zIndex:300,display:'flex',alignItems:'flex-end'}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:'100%',background:'var(--surface)',borderRadius:'16px 16px 0 0',
        padding:20,boxShadow:'0 -4px 24px rgba(0,0,0,0.2)',maxHeight:'85vh',overflowY:'auto'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
          <span style={{fontWeight:700,fontSize:16}}>{title}</span>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',
            color:'var(--text-secondary)',fontSize:20,lineHeight:1}}>✕</button>
        </div>
        <ColourPicker value={value} onChange={v=>{onChange(v);}}/>
        <button onClick={onClose} style={{width:'100%',padding:'14px',marginTop:16,
          background:'var(--primary)',color:'white',border:'none',borderRadius:'var(--radius)',
          fontSize:16,fontWeight:700,cursor:'pointer'}}>Done</button>
      </div>
    </div>
  );
}
