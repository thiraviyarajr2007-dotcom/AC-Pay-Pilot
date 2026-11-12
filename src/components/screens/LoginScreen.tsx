import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useRole } from '../../context/RoleContext';
import { UserRole } from '../../types';
import { formatFirebaseAuthError } from '../../firebase';

const COUNTRY_CODES = [
  { code: '+91', country: 'India', flag: '🇮🇳' },
  { code: '+1', country: 'United States', flag: '🇺🇸' },
  { code: '+44', country: 'United Kingdom', flag: '🇬🇧' },
  { code: '+65', country: 'Singapore', flag: '🇸🇬' },
  { code: '+971', country: 'UAE', flag: '🇦🇪' },
  { code: '+61', country: 'Australia', flag: '🇦🇺' },
  { code: '+49', country: 'Germany', flag: '🇩🇪' },
  { code: '+81', country: 'Japan', flag: '🇯🇵' },
];

export const LoginScreen: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin';
  const initialRole = (searchParams.get('role') as UserRole) || 'customer';

  const {
    signInWithGoogle,
    signInWithFacebook,
    signInWithGoogleUsingRedirect,
    signInWithEmail,
    signUpWithEmail,
    completeProfileOnboarding,
    role,
    profile,
    firebaseUser,
  } = useRole();

  const [authMode, setAuthMode] = useState<'signin' | 'signup'>(initialMode);
  const [selectedRole, setSelectedRole] = useState<UserRole>(initialRole);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Signup Onboarding Fields
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState<'Male' | 'Female' | 'Non-binary' | 'Prefer not to say'>('Male');
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState<number | string>(28);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // If already logged in, show status
  if (firebaseUser) {
    return (
      <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center p-4">
        <div className="max-w-md w-full p-8 rounded-3xl bg-surface-container-lowest border border-surface-container-high shadow-xl text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/25 flex items-center justify-center">
            <span className="material-symbols-outlined text-[32px]">verified_user</span>
          </div>
          <h2 className="text-xl font-bold text-on-surface">You are currently signed in</h2>
          <p className="text-xs text-secondary">
            Logged in as <span className="font-bold text-on-surface">{firebaseUser.email || firebaseUser.displayName}</span> ({role})
          </p>
          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              onClick={() => navigate(profile.homeRoute)}
              className="w-full py-3 rounded-xl bg-primary hover:bg-primary/90 text-on-primary text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              Continue to {profile.workspaceName}
            </button>
            <button
              type="button"
              onClick={() => navigate('/customer/discover')}
              className="w-full py-2.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold transition-all cursor-pointer"
            >
              Go to Storefront Catalog
            </button>
          </div>
        </div>
      </div>
    );
  }

  const redirectParam = searchParams.get('redirect');
  const safeRedirectTarget =
    redirectParam && redirectParam.startsWith('/') && !redirectParam.startsWith('//')
      ? redirectParam
      : '/customer/discover';

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const signedIn = await signInWithGoogle();
      if (signedIn) {
        navigate(safeRedirectTarget);
      }
    } catch (err: any) {
      setErrorMsg(formatFirebaseAuthError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleFacebookSignIn = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const signedIn = await signInWithFacebook();
      if (signedIn) {
        navigate(safeRedirectTarget);
      }
    } catch (err: any) {
      setErrorMsg(formatFirebaseAuthError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    if (authMode === 'signup') {
      if (!fullName.trim()) {
        setErrorMsg('Please provide your full legal or business name.');
        return;
      }
      if (!phone.trim()) {
        setErrorMsg('Please provide your mobile phone number.');
        return;
      }
    }

    setIsLoading(true);
    setErrorMsg(null);
    try {
      if (authMode === 'signup') {
        await signUpWithEmail(email, password);
        await completeProfileOnboarding({
          name: fullName.trim(),
          gender,
          phone: phone.trim(),
          countryCode,
          age: Number(age) || 28,
          email: email.trim(),
        });
        setSuccessMsg('Account registered successfully! Redirecting...');
      } else {
        await signInWithEmail(email, password);
        setSuccessMsg('Signed in successfully! Redirecting...');
      }
      setTimeout(() => {
        navigate(safeRedirectTarget);
      }, 500);
    } catch (err: any) {
      setErrorMsg(formatFirebaseAuthError(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-4xl rounded-3xl bg-surface-container-lowest border border-surface-container-high shadow-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 animate-fade-in">
        {/* Left Side: Brand Value & Security Highlights */}
        <div className="lg:col-span-5 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-8 text-white flex flex-col justify-between relative overflow-hidden">
          {/* Subtle Glow Backdrop */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="space-y-6 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-400">
                <span className="material-symbols-outlined text-[24px]">verified_user</span>
              </div>
              <div>
                <span className="font-extrabold text-base tracking-tight block">AC PayPilot</span>
                <span className="text-[10px] text-sky-300 font-mono uppercase tracking-wider">
                  Autonomous Commerce &amp; Escrow
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight leading-tight">
                Secure Escrow &amp; Spatial Commerce Portal
              </h1>
              <p className="text-xs text-slate-300 leading-relaxed">
                Connect your business or purchase with 100% PayPal buyer protection, WebXR 3D inspection, and automated settlement.
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-[13px]">lock</span>
                </div>
                <div>
                  <span className="text-xs font-bold block">Autonomous Escrow Engine</span>
                  <span className="text-[11px] text-slate-400">
                    Funds remain securely locked until proof-of-delivery verification.
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-[13px]">view_in_ar</span>
                </div>
                <div>
                  <span className="text-xs font-bold block">Spatial 3D &amp; AR Experience</span>
                  <span className="text-[11px] text-slate-400">
                    True-scale room fitting and 3D preview before release.
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-[13px]">shield</span>
                </div>
                <div>
                  <span className="text-xs font-bold block">Zero-Leak Cyber Security</span>
                  <span className="text-[11px] text-slate-400">
                    Tech stack secrets and customer private identifiers are strictly safeguarded.
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-white/10 text-[10px] text-slate-400 flex items-center justify-between relative z-10">
            <span>Enterprise Grade • AES-256</span>
            <span className="text-emerald-400 font-bold">● Network Active</span>
          </div>
        </div>

        {/* Right Side: Dedicated Auth Form */}
        <div className="lg:col-span-7 p-6 sm:p-8 lg:p-10 flex flex-col justify-center">
          {/* Mode Switcher: Sign In vs Create Account */}
          <div className="flex items-center justify-between pb-4 border-b border-surface-container-high mb-6">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAuthMode('signin')}
                className={`pb-1 text-sm font-bold border-b-2 transition-all cursor-pointer ${
                  authMode === 'signin'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-secondary hover:text-on-surface'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setAuthMode('signup')}
                className={`pb-1 text-sm font-bold border-b-2 transition-all cursor-pointer ${
                  authMode === 'signup'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-secondary hover:text-on-surface'
                }`}
              >
                Create Account
              </button>
            </div>

            {/* Role Toggle */}
            <div className="flex items-center gap-1 p-1 bg-surface-container-low rounded-xl border border-surface-container-high text-xs">
              <button
                type="button"
                onClick={() => setSelectedRole('customer')}
                className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                  selectedRole === 'customer'
                    ? 'bg-teal-600 text-white shadow-xs'
                    : 'text-secondary hover:text-on-surface'
                }`}
              >
                Buyer
              </button>
              <button
                type="button"
                onClick={() => setSelectedRole('seller')}
                className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                  selectedRole === 'seller'
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'text-secondary hover:text-on-surface'
                }`}
              >
                Seller
              </button>
            </div>
          </div>

          {/* Alerts */}
          {errorMsg && (
            <div
              role="alert"
              className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 text-xs font-semibold flex flex-col gap-2"
            >
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">error</span>
                <span>{errorMsg}</span>
              </div>
              {errorMsg.toLowerCase().includes('popup') && (
                <button
                  type="button"
                  onClick={() => void signInWithGoogleUsingRedirect()}
                  className="self-start text-[11px] font-bold underline hover:text-rose-700 cursor-pointer"
                >
                  Continue with Google using redirect instead
                </button>
              )}
            </div>
          )}

          {successMsg && (
            <div className="p-3 mb-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 text-xs font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              <span>{successMsg}</span>
            </div>
          )}

          {/* Social Sign-In Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            <button
              type="button"
              disabled={isLoading}
              onClick={handleGoogleSignIn}
              className="py-2.5 px-4 rounded-xl border border-surface-container-high hover:bg-surface-container-low font-bold text-xs text-on-surface flex items-center justify-center gap-2 transition-all shadow-2xs cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={handleFacebookSignIn}
              className="py-2.5 px-4 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-2xs cursor-pointer"
            >
              <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
              <span>Continue with Facebook</span>
            </button>
          </div>

          <div className="relative mb-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-surface-container-high" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-wider text-secondary">
              <span className="bg-surface-container-lowest px-2">or email authentication</span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleEmailSubmit} className="space-y-3.5 text-xs">
            {authMode === 'signup' && (
              <>
                <div>
                  <label htmlFor="login-full-name" className="block font-bold mb-1 text-on-surface">
                    Full Legal / Business Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="login-full-name"
                    type="text"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Priya Patel"
                    required
                    className="w-full px-3 py-2 rounded-xl bg-surface-container-low border border-surface-container-high text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="login-gender" className="block font-bold mb-1 text-on-surface">
                      Gender <span className="text-rose-500">*</span>
                    </label>
                    <select
                      id="login-gender"
                      value={gender}
                      onChange={(e) => setGender(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-xl bg-surface-container-low border border-surface-container-high text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Non-binary">Non-binary</option>
                      <option value="Prefer not to say">Prefer not to say</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="login-age" className="block font-bold mb-1 text-on-surface">
                      Age <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="login-age"
                      type="number"
                      min="16"
                      max="110"
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      required
                      className="w-full px-3 py-2 rounded-xl bg-surface-container-low border border-surface-container-high text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="login-phone" className="block font-bold mb-1 text-on-surface">
                    Mobile Number (With Country Code) <span className="text-rose-500">*</span>
                  </label>
                  <div className="flex gap-2">
                    <select
                      id="login-country-code"
                      aria-label="Country code"
                      autoComplete="tel-country-code"
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="w-36 px-2.5 py-2 rounded-xl bg-surface-container-low border border-surface-container-high font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer text-on-surface"
                    >
                      {COUNTRY_CODES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.flag} {c.code}
                        </option>
                      ))}
                    </select>
                    <input
                      id="login-phone"
                      type="tel"
                      autoComplete="tel-national"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="98765 43210"
                      required
                      className="flex-1 px-3 py-2 rounded-xl bg-surface-container-low border border-surface-container-high font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 text-on-surface"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label htmlFor="login-email" className="block font-bold mb-1 text-on-surface">
                Email Address{' '}
                {selectedRole === 'seller' ? (
                  <span className="text-rose-500 font-bold">* (Mandatory for Seller)</span>
                ) : (
                  <span className="text-secondary font-normal">(Optional for Buyers)</span>
                )}
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@domain.com"
                required={selectedRole === 'seller' || authMode === 'signin'}
                className="w-full px-3 py-2 rounded-xl bg-surface-container-low border border-surface-container-high text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block font-bold mb-1 text-on-surface">Password</label>
              <input
                id="login-password"
                type="password"
                autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full px-3 py-2 rounded-xl bg-surface-container-low border border-surface-container-high text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-xl bg-primary hover:bg-primary/90 text-on-primary font-bold text-xs transition-all shadow-md cursor-pointer flex items-center justify-center gap-2 mt-4"
            >
              {isLoading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              <span>{authMode === 'signin' ? 'Sign In' : 'Create Verified Account'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
