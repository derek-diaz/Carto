import logoUrl from '@shared/logo.png';
import { IconClose } from './Icons';

type AboutDialogProps = {
  open: boolean;
  appName: string;
  version: string;
  description?: string;
  author?: string;
  onClose: () => void;
};

const AboutDialog = ({
  open,
  appName,
  version,
  description,
  author,
  onClose
}: AboutDialogProps) => {
  if (!open) return null;

  return (
    <dialog className="modal" aria-label={`About ${appName}`} open>
      <div className="modal_backdrop" onClick={onClose} />
      <div className="modal_content">
        <section className="panel panel--about">
          <div className="about_header">
            <div className="about_brand">
              <img className="about_logo" src={logoUrl} alt={`${appName} logo`} />
              <div>
                <div className="about_title">{appName}</div>
                <div className="about_version">Version {version}</div>
              </div>
            </div>
            <button
              className="icon-button icon-button--compact icon-button--ghost"
              type="button"
              onClick={onClose}
              title="Close"
              aria-label="Close"
            >
              <span className="icon-button_icon" aria-hidden="true">
                <IconClose />
              </span>
            </button>
          </div>
          {description ? <p className="about_description">{description}</p> : null}
          <div className="about_meta">
            <div className="about_row">
              <span className="about_label">App</span>
              <span className="about_value">{appName}</span>
            </div>
            <div className="about_row">
              <span className="about_label">Version</span>
              <span className="about_value">{version}</span>
            </div>
            {author ? (
              <div className="about_row">
                <span className="about_label">Author</span>
                <span className="about_value">{author}</span>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </dialog>
  );
};

export default AboutDialog;
