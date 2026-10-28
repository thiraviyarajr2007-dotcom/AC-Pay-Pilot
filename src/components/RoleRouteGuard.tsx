import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ROLE_PROFILES, useRole } from '../context/RoleContext';
import { UserRole } from '../types';

interface RoleRouteGuardProps {
  allowedRoles: UserRole[];
  routeTitle?: string;
  children: React.ReactNode;
}

export const RoleRouteGuard: React.FC<RoleRouteGuardProps> = ({
  allowedRoles,
  routeTitle,
  children,
}) => {
  const { role, profile, setRole, authSource, authStatus, authError } = useRole();
  const navigate = useNavigate();
  const location = useLocation();

  // 1. Loading & Profile Resolution: Never render protected screens before "ready"
  if (authStatus === 'loading' || authStatus === 'authenticated-profile-loading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 py-12 text-center animate-pulse">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 shadow-sm">
          <span className="material-symbols-outlined text-primary text-[28px] animate-spin">
            progress_activity
          </span>
        </div>
        <h2 className="text-base font-bold text-on-surface">
          Verifying Security Credentials...
        </h2>
        <p className="text-xs text-secondary mt-1 max-w-sm">
          Establishing authenticated session and loading authoritative profile from Cloud Firestore.
        </p>
      </div>
    );
  }

  // 2. Error State: Honest reporting with retry action
  if (authStatus === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 py-12 text-center">
        <div className="bg-surface-container-lowest p-8 rounded-2xl shadow-md border border-error/20 max-w-md w-full flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-error-container text-error flex items-center justify-center shadow-xs">
            <span className="material-symbols-outlined text-[30px]">warning</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-label-sm text-[11px] uppercase tracking-widest text-error font-bold">
              Profile Sync Failure
            </span>
            <h2 className="text-base font-bold text-on-surface">
              Unable to load account profile
            </h2>
          </div>
          <p className="text-xs text-secondary leading-relaxed">
            {authError || 'An error occurred while communicating with the Firestore database.'}
          </p>
          <div className="flex gap-2 w-full pt-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold hover:bg-primary/90 transition-all cursor-pointer"
            >
              Retry Connection
            </button>
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="px-4 py-2.5 rounded-xl bg-surface-container-high text-on-surface text-xs font-semibold hover:bg-surface-container-highest transition-all cursor-pointer"
            >
              Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Unauthenticated: Prompt to sign in
  if (authStatus === 'unauthenticated') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 py-12 text-center">
        <div className="bg-surface-container-lowest p-8 rounded-2xl shadow-md border border-surface-container-high max-w-md w-full flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shadow-xs">
            <span className="material-symbols-outlined text-[30px]">lock</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-label-sm text-[11px] uppercase tracking-widest text-primary font-bold">
              Access Restricted • Sign-In Required
            </span>
            <h2 className="text-base font-bold text-on-surface">
              Authentication Required
            </h2>
          </div>
          <p className="text-xs text-secondary leading-relaxed">
            You must be signed in to access{' '}
            <code className="px-1.5 py-0.5 rounded bg-surface-container font-mono text-xs text-primary">
              {location.pathname}
            </code>
            {routeTitle ? ` (${routeTitle})` : ''}.
          </p>
          <button
            type="button"
            onClick={() => navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`)}
            className="w-full py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold hover:bg-primary/90 transition-all shadow-sm cursor-pointer flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">login</span>
            <span>Sign In to Continue</span>
          </button>
        </div>
      </div>
    );
  }

  // 4. Ready State: Role Policy Check
  if (allowedRoles.includes(role)) {
    return <>{children}</>;
  }

  const allowedLabels = allowedRoles.map((r) => ROLE_PROFILES[r].label).join(', ');

  return (
    <div className="flex flex-col items-center justify-center min-h-[72vh] px-6 py-12 text-center">
      <div className="bg-surface-container-lowest p-8 rounded-2xl shadow-md border border-error/20 max-w-lg w-full flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-error-container text-on-error-container flex items-center justify-center shadow-xs">
          <span className="material-symbols-outlined text-[34px]">lock</span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="font-label-sm text-[11px] uppercase tracking-widest text-error font-bold">
            Role Policy Enforcement • Route Guard
          </span>
          <h1 className="font-headline-xl text-headline-xl text-on-surface font-bold">
            Access restricted
          </h1>
        </div>

        <p className="font-body-md text-secondary text-sm leading-relaxed">
          Your current active role is{' '}
          <strong className="text-on-surface font-semibold">
            {profile.label} ({profile.userName})
          </strong>
          . The route{' '}
          <code className="px-1.5 py-0.5 rounded bg-surface-container font-mono text-xs text-primary">
            {location.pathname}
          </code>
          {routeTitle ? ` (${routeTitle})` : ''} is restricted to:{' '}
          <strong className="text-on-surface font-semibold">{allowedLabels}</strong>.
        </p>

        <div className="w-full p-3.5 rounded-xl bg-surface-container-low border border-surface-container-high/60 text-left flex flex-col gap-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-secondary font-medium">Current Persona:</span>
            <span className="font-bold text-on-surface">
              {profile.userName} • {profile.label}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-secondary font-medium">Required Role(s):</span>
            <span className="font-bold text-primary">{allowedLabels}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full pt-2">
          <button
            type="button"
            onClick={() => navigate(profile.homeRoute)}
            className="w-full sm:w-auto flex-1 px-5 py-2.5 rounded-xl bg-primary text-on-primary font-label-lg text-xs font-bold hover:bg-primary-container transition-colors shadow-sm flex items-center justify-center gap-2 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">home</span>
            <span>Back to {profile.label} Home</span>
          </button>

          {authSource === 'demo-switcher' && allowedRoles[0] && (
            <button
              type="button"
              onClick={() => setRole(allowedRoles[0], false)}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-md text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">switch_account</span>
              <span>Switch Demo Role to {ROLE_PROFILES[allowedRoles[0]].label}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
