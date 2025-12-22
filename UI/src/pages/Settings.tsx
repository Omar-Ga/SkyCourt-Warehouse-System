import { useState } from 'react';
import { Save, RefreshCw, Database, Monitor, FileText, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { apiClient } from '../services/apiClient';

export const Settings = () => {
  const [backupInProgress, setBackupInProgress] = useState(false);
  const [backupSuccessMessage, setBackupSuccessMessage] = useState<string | null>(null);
  const [backupErrorMessage, setBackupErrorMessage] = useState<string | null>(null);

  const handleBackup = async () => {
    setBackupInProgress(true);
    setBackupSuccessMessage(null);
    setBackupErrorMessage(null);

    try {
      // The backend now handles the path, so we just need to trigger the endpoint.
      const data = await apiClient.post<{ message: string }>('/backup', {});



      // The backend now returns a detailed success message with the path.
      setBackupSuccessMessage(data.message || 'تم إنشاء النسخة الاحتياطية بنجاح!');
      setTimeout(() => setBackupSuccessMessage(null), 7000);

    } catch (err: any) {
      console.error("Backup error:", err);
      setBackupErrorMessage(err.message || 'حدث خطأ غير متوقع أثناء إنشاء النسخة الاحتياطية.');
      setTimeout(() => setBackupErrorMessage(null), 7000);
    } finally {
      setBackupInProgress(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-8">الإعدادات</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Backup Section */}
        <div className="card">
          <div className="flex items-start mb-4">
            <div className="p-2 rounded-full bg-primary-100 text-primary-600 ml-3">
              <Database size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-1">النسخ الاحتياطي</h2>
              <p className="text-gray-500">إنشاء نسخة احتياطية للبيانات</p>
            </div>
          </div>

          <p className="mb-4 text-sm">
            سيقوم هذا الخيار بإنشاء نسخة احتياطية تلقائية من قاعدة البيانات في مجلد آمن.
          </p>

          <button
            className={`btn btn-primary w-full flex items-center justify-center ${backupInProgress ? 'opacity-75 cursor-not-allowed' : ''}`}
            onClick={handleBackup}
            disabled={backupInProgress}
          >
            {backupInProgress ? (
              <>
                <RefreshCw size={18} className="ml-2 animate-spin" />
                جاري إنشاء النسخة الاحتياطية...
              </>
            ) : (
              <>
                <Save size={18} className="ml-2" />
                إنشاء نسخة احتياطية الآن
              </>
            )}
          </button>

          {/* Feedback Messages */}
          {backupSuccessMessage && (
            <div className="mt-4 p-3 bg-success-50 rounded-md border border-success-200 text-success-700 flex items-center">
              <CheckCircle size={18} className="ml-2" />
              {backupSuccessMessage}
            </div>
          )}
          {backupErrorMessage && (
            <div className="mt-4 p-3 bg-error-50 rounded-md border border-error-200 text-error-700 flex items-center">
              <XCircle size={18} className="ml-2" />
              {backupErrorMessage}
            </div>
          )}

          <div className="mt-4 p-3 bg-primary-50 rounded-md border border-primary-100">
            <p className="text-sm text-primary-800">
              <span className="font-medium">تذكير:</span> يُنصح بإنشاء نسخة احتياطية بشكل دوري للحفاظ على البيانات من الفقدان.
            </p>
          </div>
        </div>

        {/* Application Info Section */}
        <div className="card">
          <div className="flex items-start mb-4">
            <div className="p-2 rounded-full bg-accent-100 text-accent-600 ml-3">
              <Monitor size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-1">معلومات التطبيق</h2>
              <p className="text-gray-500">معلومات عن إصدار النظام</p>
            </div>
          </div>

          <ul className="space-y-3">
            <li className="flex justify-between items-center text-sm border-b border-gray-100 pb-2">
              <span className="text-gray-500">الإصدار:</span>
              <span className="font-medium">1.0.7</span>
            </li>
            <li className="flex justify-between items-center text-sm border-b border-gray-100 pb-2">
              <span className="text-gray-500">تاريخ الإصدار:</span>
              <span className="font-medium">13 يوليو 2025</span>
            </li>
            <li className="flex justify-between items-center text-sm border-b border-gray-100 pb-2">
              <span className="text-gray-500">قاعدة البيانات:</span>
              <span className="font-medium">SQLite 3</span>
            </li>
            <li className="flex justify-between items-center text-sm">
              <span className="text-gray-500">لغة الواجهة:</span>
              <span className="font-medium">العربية</span>
            </li>
          </ul>
        </div>

        {/* Help Section */}
        <div className="card">
          <div className="flex items-start mb-4">
            <div className="p-2 rounded-full bg-secondary-100 text-secondary-600 ml-3">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-1">المساعدة</h2>
              <p className="text-gray-500">دليل الاستخدام</p>
            </div>
          </div>

          <p className="mb-4 text-sm">
            يمكنك الاطلاع على دليل الاستخدام الكامل لمعرفة كيفية استخدام جميع ميزات النظام.
          </p>

          <button className="btn btn-outline w-full flex items-center justify-center">
            <FileText size={18} className="ml-2" />
            عرض دليل الاستخدام
          </button>
        </div>

        {/* Support Section */}
        <div className="card">
          <div className="flex items-start mb-4">
            <div className="p-2 rounded-full bg-warning-100 text-warning-600 ml-3">
              <AlertTriangle size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-1">الدعم الفني</h2>
              <p className="text-gray-500">الحصول على المساعدة</p>
            </div>
          </div>

          <p className="mb-4 text-sm">
            إذا واجهتك أي مشكلة أثناء استخدام النظام، يرجى التواصل.
          </p>

          <div className="bg-gray-50 p-3 rounded-md mb-4">
            <p className="font-medium text-gray-700 mb-1">معلومات الاتصال:</p>
            <p className="text-sm">البريد الإلكتروني: oomarolayan.gamal@gmail.com</p>
            <p className="text-sm">الهاتف: <span dir="ltr">+20 1068194494</span></p>
          </div>

          <button className="btn btn-secondary w-full">
            طلب المساعدة
          </button>
        </div>
      </div>
    </div>
  );
};
