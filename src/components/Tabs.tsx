// Composition adapted from shadcn/ui Tabs (MIT); see THIRD_PARTY_NOTICES.md.
import * as TabsPrimitive from '@radix-ui/react-tabs';
import type {ComponentProps} from 'react';
export const Tabs=TabsPrimitive.Root;
export function TabsList({className='',...props}:ComponentProps<typeof TabsPrimitive.List>){return <TabsPrimitive.List className={`tabs-list ${className}`} {...props}/>;}
export function TabsTrigger({className='',...props}:ComponentProps<typeof TabsPrimitive.Trigger>){return <TabsPrimitive.Trigger className={`tabs-trigger ${className}`} {...props}/>;}
export const TabsContent=TabsPrimitive.Content;
