import React from 'react';

export const LoadingScreen: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4" dir="rtl">
      <div className="w-12 h-12 border-4 border-primary-600 border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-gray-600 font-medium text-base">جاري التحميل والتأكد من الجلسة...</p>
    </div>
  );
};
