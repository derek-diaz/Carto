import logoUrl from '@assets/web/icon-512.png';
import type { ReleaseCheckState } from '../hooks/useReleaseCheck';
import { CARTO_RELEASES_URL, CARTO_REPOSITORY_URL } from '../utils/releaseCheck';
import { IconCheck, IconExternalLink, IconInfo, IconLatest, IconRefresh } from './Icons';

type AboutViewProps = {
  appName: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  releaseState: ReleaseCheckState;
  onCheckForUpdates: () => Promise<void>;
};

const formatDate = (value?: string | number) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date
  );
};

const AboutView = ({
  appName,
  version,
  description,
  author,
  license,
  releaseState,
  onCheckForUpdates
}: AboutViewProps) => {
  const release = releaseState.release;
  const isChecking = releaseState.status === 'checking';
  const releaseUrl = release?.url ?? CARTO_RELEASES_URL;

  const updateMessage = (() => {
    if (isChecking) {
      return {
        tone: 'checking',
        icon: <IconRefresh />,
        title: 'Checking for updates…',
        body: 'Looking for the latest published Carto release.'
      };
    }
    if (releaseState.status === 'error') {
      return {
        tone: 'error',
        icon: <IconInfo />,
        title: 'Couldn’t check for updates',
        body: release
          ? 'Showing the last release information saved on this device.'
          : 'Carto may be offline. You can try again whenever you’re ready.'
      };
    }
    if (releaseState.comparison === 'available') {
      return {
        tone: 'available',
        icon: <IconLatest />,
        title: `${release?.tagName ?? 'A new version'} is available`,
        body: `You’re running ${version}. Open the release page for downloads and release notes.`
      };
    }
    if (releaseState.comparison === 'ahead') {
      return {
        tone: 'ahead',
        icon: <IconCheck />,
        title: 'Development build',
        body: `This ${version} build is newer than the latest published release${release ? ` (${release.tagName})` : ''}.`
      };
    }
    if (releaseState.comparison === 'current') {
      return {
        tone: 'current',
        icon: <IconCheck />,
        title: 'You’re up to date',
        body: `${version} is the latest published Carto release.`
      };
    }
    return {
      tone: 'unknown',
      icon: <IconInfo />,
      title: 'Version status unavailable',
      body: 'Carto couldn’t compare this build with the latest published release.'
    };
  })();

  return (
    <main className="about_page">
      <section className="about_hero">
        <div className="about_identity">
          <img className="about_page-logo" src={logoUrl} alt="" />
          <div>
            <span className="about_eyebrow">About</span>
            <div className="about_heading">
              <h2>{appName}</h2>
              <span className="about_version-pill">v{version}</span>
            </div>
            <p>{description ?? 'A focused desktop client for exploring and working with Zenoh.'}</p>
          </div>
        </div>
        <div className="about_hero-actions">
          <a
            className="button button--ghost"
            href={CARTO_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
          >
            View source{' '}
            <span className="button_icon">
              <IconExternalLink />
            </span>
          </a>
          <a
            className="button button--primary"
            href={CARTO_RELEASES_URL}
            target="_blank"
            rel="noreferrer"
          >
            All releases{' '}
            <span className="button_icon">
              <IconExternalLink />
            </span>
          </a>
        </div>
      </section>

      <section className={`about_update about_update--${updateMessage.tone}`} aria-live="polite">
        <div
          className={`about_update-icon ${isChecking ? 'about_update-icon--spin' : ''}`}
          aria-hidden="true"
        >
          {updateMessage.icon}
        </div>
        <div className="about_update-copy">
          <span className="about_eyebrow">Updates</span>
          <h3>{updateMessage.title}</h3>
          <p>{updateMessage.body}</p>
          {releaseState.checkedAt ? (
            <small className="about_update-checked">
              Last checked {formatDate(releaseState.checkedAt)}
            </small>
          ) : null}
        </div>
        <div className="about_update-actions">
          {releaseState.comparison === 'available' && !isChecking ? (
            <a
              className="button button--primary"
              href={releaseUrl}
              target="_blank"
              rel="noreferrer"
            >
              View release{' '}
              <span className="button_icon">
                <IconExternalLink />
              </span>
            </a>
          ) : null}
          <button
            className="button button--ghost"
            type="button"
            onClick={() => onCheckForUpdates().catch(() => {})}
            disabled={isChecking}
          >
            <span className="button_icon">
              <IconRefresh />
            </span>
            {isChecking ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </section>
      <footer className="about_footer">
        <span className="about_made-in">Made in Puerto Rico</span>
        {author ? (
          <>
            <span aria-hidden="true">·</span>
            <span>Built by {author}</span>
          </>
        ) : null}
        {license ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{license} license</span>
          </>
        ) : null}
      </footer>
    </main>
  );
};

export default AboutView;
