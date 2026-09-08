// Composition adapted from OHIF/Viewers Resizable (MIT); see THIRD_PARTY_NOTICES.md.
import * as Primitive from 'react-resizable-panels';
import type {ComponentProps} from 'react';
export const ResizablePanel=Primitive.Panel;
export function ResizablePanelGroup(props:ComponentProps<typeof Primitive.PanelGroup>){return <Primitive.PanelGroup {...props}/>;}
export function ResizableHandle(){return <Primitive.PanelResizeHandle className="resize-handle"><span/></Primitive.PanelResizeHandle>;}
