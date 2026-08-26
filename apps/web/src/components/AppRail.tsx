import logoUrl from '@assets/web/icon-512.png';
import {
  IconConnection,
  IconInfo,
  IconLogs,
  IconMonitor,
  IconMoon,
  IconPublish,
  IconSettings,
  IconSun
} from './Icons';
import type { AppView } from '../types/navigation';

type AppRailProps = {
  theme: 'light' | 'dark';
  view: AppView;
  connected: boolean;
  updateAvailable: boolean;
  onSetView: (view: AppView) => void;
  onToggleTheme: () => void;
};

const AppRail = ({
  theme,
  view,
  connected,
  updateAvailable,
  onSetView,
  onToggleTheme
}: AppRailProps) => (
  <aside className="app_rail">
    <button
      className="rail_brand rail_brand--button"
      type="button"
      onClick={() => onSetView('about')}
      title="About Carto"
      aria-label="About Carto"
    >
      <img className="rail_logo" src={logoUrl} alt="Carto logo" />
      <span className="rail_name">Carto</span>
    </button>
    <div className="rail_group">
      <button
        className={`rail_button ${view === 'monitor' ? 'rail_button--active' : ''}`}
        onClick={() => onSetView('monitor')}
        disabled={!connected}
        title="Monitor (Ctrl/Cmd+1)"
        aria-current={view === 'monitor' ? 'page' : undefined}
      >
        <span className="rail_icon" aria-hidden="true">
          <IconMonitor aria-hidden="true" />
        </span>{' '}
        <span className="rail_label">Monitor</span>
      </button>
      <button
        className={`rail_button ${view === 'publish' ? 'rail_button--active' : ''}`}
        onClick={() => onSetView('publish')}
        disabled={!connected}
        title="Publish (Ctrl/Cmd+2)"
        aria-current={view === 'publish' ? 'page' : undefined}
      >
        <span className="rail_icon" aria-hidden="true">
          <IconPublish aria-hidden="true" />
        </span>{' '}
        <span className="rail_label">Publish</span>
      </button>
      <button
        className={`rail_button ${view === 'connection' ? 'rail_button--active' : ''}`}
        onClick={() => onSetView('connection')}
        title="Connection (Ctrl/Cmd+3)"
        aria-current={view === 'connection' ? 'page' : undefined}
      >
        <span className="rail_icon" aria-hidden="true">
          <IconConnection aria-hidden="true" />
        </span>{' '}
        <span className="rail_label">Connection</span>
      </button>
      <button
        className={`rail_button ${view === 'logs' ? 'rail_button--active' : ''}`}
        onClick={() => onSetView('logs')}
        title="Logs (Ctrl/Cmd+4)"
        aria-current={view === 'logs' ? 'page' : undefined}
      >
        <span className="rail_icon" aria-hidden="true">
          <IconLogs aria-hidden="true" />
        </span>{' '}
        <span className="rail_label">Logs</span>
      </button>
      <button
        className={`rail_button ${view === 'settings' ? 'rail_button--active' : ''}`}
        onClick={() => onSetView('settings')}
        title="Settings (Ctrl/Cmd+5)"
        aria-current={view === 'settings' ? 'page' : undefined}
      >
        <span className="rail_icon" aria-hidden="true">
          <IconSettings aria-hidden="true" />
        </span>{' '}
        <span className="rail_label">Settings</span>
      </button>
    </div>
    <div className="rail_footer">
      <button
        className={`rail_button ${view === 'about' ? 'rail_button--active' : ''}`}
        onClick={() => onSetView('about')}
        type="button"
        title="About & updates (Ctrl/Cmd+6)"
        aria-current={view === 'about' ? 'page' : undefined}
      >
        <span className="rail_icon rail_icon--status" aria-hidden="true">
          <IconInfo aria-hidden="true" />
          {updateAvailable ? <span className="rail_update-dot" /> : null}
        </span>{' '}
        <span className="rail_label">About</span>
      </button>
      <button
        className="rail_button"
        onClick={onToggleTheme}
        type="button"
        title="Toggle theme (Ctrl/Cmd+Shift+L)"
      >
        <span className="rail_icon" aria-hidden="true">
          {theme === 'dark' ? <IconSun aria-hidden="true" /> : <IconMoon aria-hidden="true" />}
        </span>{' '}
        <span className="rail_label">{theme === 'dark' ? 'Light' : 'Dark'} mode</span>
      </button>
    </div>
  </aside>
);

export default AppRail;
