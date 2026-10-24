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
  const { role, profile, setRole, authSource } = useRole();
  const navigate = useNavigate();
  const location = useLocation();

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
