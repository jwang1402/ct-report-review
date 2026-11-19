import './CTLoadProgress.css';

export function CTLoadProgress({label,ratio,detail}:{label:string;ratio?:number;detail?:string}) {
  return <div className="ct-load-progress">
    <div><span role="status">{label}</span>
      {ratio!==undefined&&<strong>{ratio>=1?100:Math.min(99,Math.round(ratio*100))}%</strong>}
    </div>
    <progress aria-label={label} max={1} value={ratio}/>
    {detail&&<small>{detail}</small>}
  </div>;
}
