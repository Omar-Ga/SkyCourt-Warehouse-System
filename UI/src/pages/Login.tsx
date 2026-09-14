/* eslint-disable */
import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const Login: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('يرجى إدخال اسم المستخدم وكلمة المرور.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await login({ username: username.trim(), password });
    } catch (err: any) {
      const message = err.message || err.data?.error || 'فشل تسجيل الدخول. يرجى التحقق من البيانات.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row relative bg-[#0B1F14] overflow-x-hidden" dir="ltr">
      {/* Background Mall Image with Subtle Blur & Soft Translucent Gradient Overlay */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <img
          src="/assets/login-bg-option4.png"
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover object-center scale-105 blur-[1px]"
        />
        {/* Soft Emerald Gradient Overlay - Subtly balanced for high image visibility and text contrast */}
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(circle at 15% 20%, rgba(30, 125, 70, 0.25) 0%, transparent 60%),
              linear-gradient(135deg, rgba(11, 31, 20, 0.55) 0%, rgba(5, 34, 16, 0.40) 45%, rgba(4, 20, 10, 0.60) 100%)
            `,
          }}
        />
      </div>

      {/* Visual Left: Hero Branding Area (~55.4% on desktop, hidden on mobile) */}
      <div className="relative z-10 hidden md:flex md:w-[55%] lg:w-[55.4%] min-h-screen overflow-hidden">
        {/* Watermark S-mark Outline - Half cut off on the left edge, vertically starting at mid-screen */}
        <div
          className="absolute top-[51%] -left-[120px] lg:-left-[128px] w-[340px] lg:w-[360px] h-[480px] lg:h-[500px] pointer-events-none select-none z-10 opacity-90"
          aria-hidden="true"
        >
          <img
            src="/assets/skycourt-mark-outline.svg"
            alt=""
            className="w-full h-full object-contain object-left-top"
          />
        </div>

        {/* Hero Copy (Lower-Right Area, RTL) */}
        <div
          className="absolute right-8 lg:right-16 xl:right-20 bottom-16 lg:bottom-20 max-w-[460px] flex flex-col items-start text-right z-20 select-none"
          dir="rtl"
        >
          <h1 className="text-4xl lg:text-[48px] xl:text-[54px] font-black text-white leading-[1.3] tracking-tight text-right drop-shadow-sm font-sans">
            كل منتج
            <br />
            في مكانه الصحيح
          </h1>
          <div className="w-16 h-1.5 bg-[#1E7D46] rounded-full mt-4 shadow-sm" />
        </div>
      </div>

      {/* Visual Right: White Login Card (~44.6% on desktop, full width on mobile) */}
      <div
        className="relative z-10 w-full md:w-[45%] lg:w-[44.6%] min-h-screen bg-white md:rounded-l-[36px] lg:rounded-l-[44px] shadow-2xl flex flex-col justify-center items-center p-6 sm:p-10 lg:p-14 py-12 lg:py-16 overflow-y-auto"
        dir="rtl"
      >
        <div className="w-full max-w-[440px] lg:max-w-[480px] my-auto">
          {/* Official Logo */}
          <div className="flex justify-center mb-8">
            <img
              src="/assets/skycourt_logo_transparent.png"
              alt="SkyCourt Mall Logo"
              className="h-24 lg:h-32 w-auto object-contain"
            />
          </div>

          {/* Heading & Subtitle */}
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-[38px] font-black text-[#041831] tracking-tight mb-3.5 leading-snug font-sans">
              مخزن سكاي كورت
            </h2>
            <p className="text-slate-500 text-base lg:text-lg font-medium leading-relaxed font-sans">
              نظام إدارة المخزن
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div
              className="mb-8 p-4 rounded-2xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-700 text-sm"
              role="alert"
            >
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <span className="leading-snug">{error}</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-7">
            <div>
              <label
                htmlFor="username"
                className="block text-slate-900 font-bold text-base lg:text-lg mb-3 text-right font-sans"
              >
                اسم المستخدم
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="أدخل اسم المستخدم"
                className="w-full bg-[#f0f3f8] rounded-2xl border border-slate-200/90 px-5 py-4 text-right placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/25 focus:border-primary-600 transition-all text-slate-800 text-base lg:text-lg font-normal font-sans"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-slate-900 font-bold text-base lg:text-lg mb-3 text-right font-sans"
              >
                كلمة المرور
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="أدخل كلمة المرور"
                className="w-full bg-[#f0f3f8] rounded-2xl border border-slate-200/90 px-5 py-4 text-right placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/25 focus:border-primary-600 transition-all text-slate-800 text-base lg:text-lg font-normal font-sans"
                disabled={isSubmitting}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full !mt-11 py-4.5 lg:py-5 px-6 rounded-2xl bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white font-bold text-lg lg:text-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer font-sans"
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>جاري تسجيل الدخول...</span>
                </div>
              ) : (
                <span>تسجيل الدخول</span>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
