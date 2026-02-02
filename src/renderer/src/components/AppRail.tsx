import logoUrl from '@shared/logo.png';
import { IconConnection, IconLogs, IconMonitor, IconMoon, IconPublish, IconSun } from './Icons';

type AppRailProps = {
  theme: 'light' | 'dark';
  view: 'monitor' | 'publish' | 'connection' | 'logs';
  connected: boolean;
  onSetView: (view: 'monitor' | 'publish' | 'connection' | 'logs') => void;
  onToggleTheme: () => void;
};

const AppRail = ({ theme, view, connected, onSetView, onToggleTheme }: AppRailProps) => (
  <aside className="app_rail">
    <div className="rail_brand">
      <img className="rail_logo" src={logoUrl} alt="Carto logo" />
      <span className="rail_name">Carto</span>
    </div>
    <div className="rail_group">
      <button
        className={`rail_button ${view === 'monitor' ? 'rail_button--active' : ''}`}
        onClick={() => onSetView('monitor')}
        disabled={!connected}
        title="Monitor (Ctrl/Cmd+1)"
      >
        <span className="rail_icon" aria-hidden="true">
          <IconMonitor aria-hidden="true" />
        </span>{' '}<span className="rail_label">Monitor</span>
      </button>
      <button
        className={`rail_button ${view === 'publish' ? 'rail_button--active' : ''}`}
        onClick={() => onSetView('publish')}
        disabled={!connected}
        title="Publish (Ctrl/Cmd+2)"
      >
        <span className="rail_icon" aria-hidden="true">
          <IconPublish aria-hidden="true" />
        </span>{' '}<span className="rail_label">Publish</span>
      </button>
      <button
        className={`rail_button ${view === 'connection' ? 'rail_button--active' : ''}`}
        onClick={() => onSetView('connection')}
        title="Connection (Ctrl/Cmd+3)"
      >
        <span className="rail_icon" aria-hidden="true">
          <IconConnection aria-hidden="true" />
        </span>{' '}<span className="rail_label">Connection</span>
      </button>
      <button
        className={`rail_button ${view === 'logs' ? 'rail_button--active' : ''}`}
        onClick={() => onSetView('logs')}
        title="Logs (Ctrl/Cmd+4)"
      >
        <span className="rail_icon" aria-hidden="true">
          <IconLogs aria-hidden="true" />
        </span>{' '}<span className="rail_label">Logs</span>
      </button>
    </div>
    <div className="rail_footer">
      <button
        className="rail_button"
        onClick={onToggleTheme}
        type="button"
        title="Toggle theme (Ctrl/Cmd+Shift+L)"
      >
        <span className="rail_icon" aria-hidden="true">
          {theme === 'dark' ? <IconSun aria-hidden="true" /> : <IconMoon aria-hidden="true" />}
        </span>{' '}<span className="rail_label">{theme === 'dark' ? 'Light' : 'Dark'} mode</span>
      </button>
    </div>
  </aside>
);

export default AppRail;
