import { Button } from './ui/button';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { Separator } from './ui/separator';
import logoUrl from '@assets/web/icon-512.png';
import {
  IconConnection,
  IconInfo,
  IconMonitor,
  IconMoon,
  IconPublish,
  IconSettings,
  IconSun
} from './Icons';
import type { AppView } from '../types/navigation';

type AppRailProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  theme: 'light' | 'dark';
  view: AppView;
  connected: boolean;
  hasRetainedMessages?: boolean;
  updateAvailable: boolean;
  onSetView: (view: AppView) => void;
  onToggleTheme: () => void;
};
const destinations = [
  { id: 'monitor', label: 'Monitor', icon: IconMonitor },
  { id: 'publish', label: 'Publish', icon: IconPublish },
  { id: 'connection', label: 'Connection', icon: IconConnection },
  { id: 'settings', label: 'Settings', icon: IconSettings },
  { id: 'about', label: 'About', icon: IconInfo }
] as const;

export default function AppRail({
  collapsed,
  onToggleCollapsed,
  theme,
  view,
  connected,
  hasRetainedMessages,
  updateAvailable,
  onSetView,
  onToggleTheme
}: AppRailProps) {
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  const themeLabel = theme === 'dark' ? 'Use light mode' : 'Use dark mode';
  return (
    <aside
      aria-label="Workspace sidebar"
      className={`flex min-h-0 flex-col gap-4 overflow-y-auto border-r bg-card py-5 ${collapsed ? 'px-2' : 'px-3'}`}
    >
      <Button
        variant="ghost"
        onClick={() => onSetView('about')}
        className={`h-10 gap-3 rounded-lg px-2 ${collapsed ? 'justify-center' : 'justify-start'}`}
        aria-label="About Carto"
      >
        <img src={logoUrl} alt="" className="size-8 rounded-lg" />
        {!collapsed && <span className="text-lg font-semibold tracking-tight">Carto</span>}
      </Button>
      <div
        className={`flex h-8 items-center ${collapsed ? 'justify-center' : 'justify-between pl-3'}`}
      >
        {!collapsed && (
          <span className="text-[10px] font-semibold tracking-[.14em] text-muted-foreground uppercase">
            Workspace
          </span>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="rounded-lg text-muted-foreground"
                onClick={onToggleCollapsed}
                aria-label={toggleLabel}
                aria-expanded={!collapsed}
                aria-controls="workspace-navigation"
              />
            }
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </TooltipTrigger>
          <TooltipContent side="right">{toggleLabel}</TooltipContent>
        </Tooltip>
      </div>
      <nav
        id="workspace-navigation"
        className="flex flex-1 flex-col gap-1.5"
        aria-label="Main navigation"
      >
        {destinations.map(({ id, label, icon: Icon }, index) => {
          const disabled =
            id === 'monitor' ? !connected && !hasRetainedMessages : id === 'publish' && !connected;
          return (
            <Tooltip key={id}>
              <TooltipTrigger
                render={
                  <Button
                    variant={view === id ? 'secondary' : 'ghost'}
                    disabled={disabled}
                    onClick={() => onSetView(id)}
                    aria-label={label}
                    aria-current={view === id ? 'page' : undefined}
                    className={
                      `relative h-10 w-full gap-3 rounded-lg px-3 ${collapsed ? 'justify-center' : 'justify-start'} ` +
                      (view === id ? 'text-primary font-semibold' : 'text-muted-foreground')
                    }
                  />
                }
              >
                <Icon className="size-4" />
                {!collapsed && <span>{label}</span>}
                {id === 'about' && updateAvailable && (
                  <span
                    className={`size-1.5 rounded-full bg-primary ${collapsed ? 'absolute top-2 right-2' : ''}`}
                    aria-label="Update available"
                  />
                )}
              </TooltipTrigger>
              <TooltipContent side="right">
                {label}
                <span className="opacity-60">Ctrl / ⌘ {index + 1}</span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
      <Separator />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              onClick={onToggleTheme}
              aria-label={themeLabel}
              className={`h-10 gap-3 rounded-lg px-3 text-muted-foreground ${collapsed ? 'justify-center' : 'justify-start'}`}
            />
          }
        >
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
          {!collapsed && <span>{theme === 'dark' ? 'Light' : 'Dark'} mode</span>}
        </TooltipTrigger>
        <TooltipContent side="right">{themeLabel}</TooltipContent>
      </Tooltip>
    </aside>
  );
}
