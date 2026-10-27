import React, { useState } from 'react';
import { useRole } from '../../context/RoleContext';

const COUNTRY_CODES = [
  { code: '+91', country: 'India', flag: '🇮🇳' },
  { code: '+1', country: 'United States', flag: '🇺🇸' },
  { code: '+44', country: 'United Kingdom', flag: '🇬🇧' },
  { code: '+65', country: 'Singapore', flag: '🇸🇬' },
  { code: '+971', country: 'United Arab Emirates', flag: '🇦🇪' },
  { code: '+61', country: 'Australia', flag: '🇦🇺' },
  { code: '+49', country: 'Germany', flag: '🇩🇪' },
  { code: '+81', country: 'Japan', flag: '🇯🇵' },
];

interface ProfileOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast?: (msg: string) => void;
}

export const ProfileOnboardingModal: React.FC<ProfileOnboardingModalProps> = ({
  isOpen,
  onClose,
  showToast = console.log,
}) => {
  const { role, firebaseUser, userProfile, completeProfileOnboarding } = useRole();

  const isSeller = role === 'seller' || role === 'business_head';

  const [name, setName] = useState(
    userProfile?.displayName || firebaseUser?.displayName || ''
  );
  const [gender, setGender] = useState<'Male' | 'Female' | 'Non-binary' | 'Prefer not to say'>(
    userProfile?.gender || 'Male'
  );
  const [countryCode, setCountryCode] = useState(userProfile?.countryCode || '+91');
  const [phone, setPhone] = useState(userProfile?.phone || '');
  const [age, setAge] = useState<number | string>(userProfile?.age || 26);
  const [email, setEmail] = useState(
    userProfile?.email || firebaseUser?.email || ''
  );

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide your full legal or business name.');
      return;
    }
    if (!phone.trim()) {
      setError('Please enter your mobile phone number.');
      return;
    }
    if (isSeller && !email.trim()) {
      setError('Email address is mandatory for Merchant / Seller accounts for GST & Escrow billing.');
      return;
    }

    const numAge = Number(age);
    if (!numAge || numAge < 16 || numAge > 110) {
      setError('Please provide a valid age between 16 and 110.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await completeProfileOnboarding({
        name: name.trim(),
        gender,
        phone: phone.trim(),
        countryCode,
        age: numAge,
        email: email.trim() || undefined,
      });
      showToast('Profile setup complete! Welcome to AC PayPilot.');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not save profile details. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden p-6 text-slate-900 dark:text-slate-100 animate-slide-up">
        {/* Onboarding Header */}
        <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                1-Time Verification
              </span>
              <span className="text-[11px] font-bold text-slate-500">
                {isSeller ? 'Merchant Seller Profile' : 'Customer Buyer Profile'}
              </span>
            </div>
            <h2 className="text-xl font-black tracking-tight mt-1">
              Complete Your Account Details
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Please verify your demographics and contact details for escrow compliance.
            </p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/25 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[22px]">badge</span>
          </div>
        </div>

        {/* Error Notice */}
        {error && (
          <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">error</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 mt-4 text-xs">
          {/* Full Name */}
          <div>
            <label className="block font-bold mb-1 text-slate-700 dark:text-slate-200">
              Full Legal / Business Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Aarav Sharma"
              required
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          {/* Gender & Age Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1 text-slate-700 dark:text-slate-200">
                Gender <span className="text-rose-500">*</span>
              </label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Non-binary">Non-binary</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </select>
            </div>

            <div>
              <label className="block font-bold mb-1 text-slate-700 dark:text-slate-200">
                Age <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min="16"
                max="110"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="28"
                required
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* Mobile Number with Country Code Selection */}
          <div>
            <label className="block font-bold mb-1 text-slate-700 dark:text-slate-200">
              Mobile Number (With Country Code) <span className="text-rose-500">*</span>
            </label>
            <div className="flex gap-2">
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="w-36 px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer"
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.code} ({c.country})
                  </option>
                ))}
              </select>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98765 43210"
                required
                className="flex-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* Email ID (Mandatory for Seller, Optional for Customer) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block font-bold text-slate-700 dark:text-slate-200">
                Email Address{' '}
                {isSeller ? (
                  <span className="text-rose-500 font-extrabold">* (Mandatory for Seller)</span>
                ) : (
                  <span className="text-slate-400 font-normal">(Optional for Customers)</span>
                )}
              </label>
            </div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@business.com"
              required={isSeller}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              {isSeller
                ? 'Required for GST invoicing, automated escrow payout settlements, and PayPal merchant linkage.'
                : 'Optional for order tracking receipts & courier dispatch updates.'}
            </p>
          </div>

          {/* Privacy & Security Guarantee Banner */}
          <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-[10px] space-y-1 text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
              <span className="material-symbols-outlined text-[14px]">shield</span>
              <span>Demographic Privacy Guarantee (India DPDP &amp; GDPR)</span>
            </div>
            <p className="leading-relaxed">
              Your age and gender are aggregated for store telemetry &amp; product fit without revealing your phone number or raw credentials to public analytics dashboards.
            </p>
          </div>

          {/* Action Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-bold text-xs transition-all shadow-sm cursor-pointer flex items-center justify-center gap-2 mt-4"
          >
            {isSubmitting && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            <span>Save &amp; Complete Verification</span>
          </button>
        </form>
      </div>
    </div>
  );
};
