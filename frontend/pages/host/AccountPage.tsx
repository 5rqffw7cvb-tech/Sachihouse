import React, { useState } from 'react';
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  LogOut,
  Share,
  Sparkles,
} from 'lucide-react';
import { HostCard, HostScreen } from '../../components/host/HostScreen';
import { useHostContext } from '../../components/host/HostShell';
import { EntryCodeSheet } from '../../components/host/EntryCodeSheet';
import { logout } from '../../services/auth';
import { getCleaningCalendarLink } from '../../services/cleaningCalendar';
import { copyText, HostProperty } from '../../services/hostApp';
import { hasAccess } from '../../services/permissions';

const Row: React.FC<{
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  last?: boolean;
}> = ({ Icon, label, value, trailing, onClick, last = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    className={`w-full h-14 px-4 flex items-center gap-3 text-left active:bg-subtle disabled:active:bg-transparent ${
      last ? '' : 'border-b border-line'
    }`}
  >
    <Icon className="w-[19px] h-[19px] text-ink-muted shrink-0" />
    <span className="flex-1 min-w-0 text-[15px] text-ink truncate">{label}</span>
    {value && <span className="text-[13px] text-ink-muted shrink-0">{value}</span>}
    {trailing ?? <ChevronRight className="w-[18px] h-[18px] text-line-strong shrink-0" />}
  </button>
);

const AccountPage: React.FC = () => {
  const { user, properties, propertiesError } = useHostContext();

  const [showProperties, setShowProperties] = useState(false);
  const [openProperty, setOpenProperty] = useState<HostProperty | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [cleaningLinkState, setCleaningLinkState] = useState<'idle' | 'loading' | 'copied'>('idle');
  const [error, setError] = useState<string | null>(null);

  // The shared cleaning link covers every property at once, so regenerating it
  // cuts off every cleaner. The API keeps it admin-only for that reason and
  // this row follows the same rule rather than offering a 403.
  const isAdmin = user.role === 'ADMIN';
  // The backend wants host level 2 to write a property; below that the sheet
  // stays readable and says why the edit button is missing.
  const canEditProperty = hasAccess(user, 'propertyWrite');

  const initials = (user.name || user.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  const roleLabel = user.role === 'ADMIN'
    ? 'ADMIN'
    : `HOST${user.hostLevel ? ` L${user.hostLevel}` : ''}`;

  const handleCleaningLink = async () => {
    setCleaningLinkState('loading');
    setError(null);
    try {
      const url = await getCleaningCalendarLink();
      await copyText(url);
      setCleaningLinkState('copied');
      window.setTimeout(() => setCleaningLinkState('idle'), 2000);
    } catch (cause) {
      setCleaningLinkState('idle');
      setError(cause instanceof Error ? cause.message : 'Could not fetch the cleaning link.');
    }
  };

  const openInConsole = (path: string) => {
    window.location.hash = path;
  };

  return (
    <HostScreen title="Account" error={propertiesError ?? error}>
      <HostCard padded className="flex items-center gap-3.5">
        <div className="w-13 h-13 min-w-[52px] min-h-[52px] rounded-[18px] bg-brand text-white shrink-0
          flex items-center justify-center font-['Plus_Jakarta_Sans'] text-[19px] font-bold">
          {initials || '?'}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-[16px] font-semibold text-ink truncate">{user.name || 'Host'}</span>
          <span className="text-[13px] text-ink-muted truncate">{user.email}</span>
        </div>
        <span className="bg-brand-tint text-ink-soft rounded-full px-2.5 py-[3px] text-[11px] font-bold tracking-[0.03em] shrink-0">
          {roleLabel}
        </span>
      </HostCard>

      <HostCard>
        <Row
          Icon={Building2}
          label="Properties"
          value={String(properties.length)}
          onClick={() => setShowProperties((value) => !value)}
          trailing={
            <ChevronDown
              className={`w-[18px] h-[18px] text-line-strong shrink-0 transition-transform ${
                showProperties ? 'rotate-180' : ''
              }`}
            />
          }
        />
        {showProperties && (
          <ul className="bg-subtle border-b border-line">
            {properties.length === 0 ? (
              <li className="px-4 py-3 text-[13px] text-ink-muted">Nothing assigned to your account yet.</li>
            ) : properties.map((property) => (
              <li key={property.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpenProperty(property)}
                  className="w-full flex items-center gap-3 px-4 h-14 text-left active:bg-brand-tint"
                >
                  <KeyRound className="w-4 h-4 text-ink-muted shrink-0" />
                  <span className="flex-1 min-w-0 text-[14px] text-ink-soft truncate">{property.name}</span>
                  <span className="text-[12px] text-ink-muted shrink-0">Entry code</span>
                  <ChevronRight className="w-4 h-4 text-line-strong shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {isAdmin && (
          <Row
            Icon={Sparkles}
            label="Cleaning calendar link"
            onClick={() => { void handleCleaningLink(); }}
            trailing={
              cleaningLinkState === 'loading'
                ? <Loader2 className="w-[18px] h-[18px] text-ink-muted animate-spin shrink-0" />
                : cleaningLinkState === 'copied'
                  ? <span className="flex items-center gap-1 text-[13px] font-semibold text-ok shrink-0">
                      <Check className="w-4 h-4" /> Copied
                    </span>
                  : undefined
            }
          />
        )}

        <Row
          Icon={FileText}
          label="Booking confirmations"
          onClick={() => openInConsole('#/admin/booking-confirm')}
          trailing={<ExternalLink className="w-[17px] h-[17px] text-line-strong shrink-0" />}
          last
        />
      </HostCard>

      <HostCard>
        <Row
          Icon={Share}
          label="Add to Home Screen"
          onClick={() => setShowInstall((value) => !value)}
          trailing={
            <ChevronDown
              className={`w-[18px] h-[18px] text-line-strong shrink-0 transition-transform ${
                showInstall ? 'rotate-180' : ''
              }`}
            />
          }
          last={!showInstall}
        />
        {showInstall && (
          <div className="px-4 py-3.5 bg-subtle text-[13px] text-ink-soft leading-relaxed">
            <p className="font-semibold text-ink mb-1">iPhone (Safari)</p>
            <p>Share &rarr; Add to Home Screen. The app then opens full screen with no browser bar.</p>
            <p className="font-semibold text-ink mt-3 mb-1">Android (Chrome)</p>
            <p>Menu &rarr; Add to Home screen.</p>
          </div>
        )}
      </HostCard>

      <button
        type="button"
        onClick={() => { void logout(); }}
        className="h-13 min-h-[52px] rounded-card bg-surface border border-line
          flex items-center justify-center gap-2 text-[15px] font-semibold text-danger"
      >
        <LogOut className="w-[18px] h-[18px]" />
        Sign out
      </button>

      <p className="text-center text-[12px] text-ink-muted pt-1">
        Signed in on this device until you sign out.
      </p>

      {openProperty && (
        <EntryCodeSheet
          property={openProperty}
          canEdit={canEditProperty}
          onClose={() => setOpenProperty(null)}
        />
      )}
    </HostScreen>
  );
};

export default AccountPage;
