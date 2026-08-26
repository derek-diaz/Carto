import type { CartoRelease } from '../utils/releaseCheck';
import { IconClose, IconExternalLink, IconLatest } from './Icons';

type UpdateBannerProps = {
  release: CartoRelease;
  onShowAbout: () => void;
  onDismiss: () => void;
};

const UpdateBanner = ({ release, onShowAbout, onDismiss }: UpdateBannerProps) => (
  <aside className="update_banner" aria-label="Carto update available">
    <span className="update_banner-icon" aria-hidden="true">
      <IconLatest />
    </span>
    <div className="update_banner-copy">
      <strong>Carto {release.tagName} is available</strong>
      <span>See what changed or download the latest release.</span>
    </div>
    <div className="update_banner-actions">
      <button className="button button--ghost button--compact" type="button" onClick={onShowAbout}>
        Details
      </button>
      <a
        className="button button--primary button--compact"
        href={release.url}
        target="_blank"
        rel="noreferrer"
      >
        View release{' '}
        <span className="button_icon">
          <IconExternalLink />
        </span>
      </a>
      <button
        className="icon-button icon-button--ghost"
        type="button"
        onClick={onDismiss}
        aria-label={`Dismiss ${release.tagName} update`}
        title="Dismiss this release"
      >
        <span className="icon-button_icon">
          <IconClose />
        </span>
      </button>
    </div>
  </aside>
);

export default UpdateBanner;
