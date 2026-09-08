import {Component,type ReactNode} from 'react';
export class ViewerBoundary extends Component<{children:ReactNode},{error:string}>{
 state={error:''};
 static getDerivedStateFromError(error:Error){return {error:error.message};}
 render(){return this.state.error?<div className="empty"><h2>Viewer unavailable</h2><p role="alert">The imaging engine could not start. {this.state.error}</p><button className="button secondary" onClick={()=>location.reload()}>Reload viewer</button></div>:this.props.children;}
}
