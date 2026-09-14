/* eslint-disable */
import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { ArrowUp, ArrowDown, User, Loader2 } from 'lucide-react';
import { Item, Destination, Provider } from '../types'; // Import shared types
import { apiClient, generateIdempotencyKey } from '../services/apiClient';
import { useCapabilities } from '../hooks/useCapabilities';

type AdjustQuantityModalProps = {
  isOpen: boolean;
  onClose: () => void;
  item: Item; // Use shared Item type
  onItemAdjusted: () => void; // Callback for refreshing data
  // units?: Unit[]; // Only add if unit selection/display logic is added here
};

export const AdjustQuantityModal = ({ isOpen, onClose, item, onItemAdjusted }: AdjustQuantityModalProps) => {
  const { canAdjustQuantity } = useCapabilities();
  if (!canAdjustQuantity) return null;

  const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState('');
  const [personName, setPersonName] = useState('');
  const [action, setAction] = useState<'add' | 'remove' | null>(null);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const [isSaving, setIsSaving] = useState(false);

  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [selectedDestinationId, setSelectedDestinationId] = useState<string>('');
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [destinationsError, setDestinationsError] = useState<string | null>(null);


  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);

  useEffect(() => {

    if (isOpen) {
      resetForm();
    }
  }, [isOpen]);

  useEffect(() => {

    if (isOpen) {
      if (action === 'add') {
        fetchProviders();
      } else if (action === 'remove') {
        fetchDestinations();
      }
    }
  }, [isOpen, action]);

  const fetchDestinations = async () => {
    setDestinationsLoading(true);
    setDestinationsError(null);
    try {
      const data = await apiClient.get<Destination[]>('/destinations');
      setDestinations(data);
    } catch (error: any) {
      setDestinationsError(error.message);
      console.error(error);
    } finally {
      setDestinationsLoading(false);
    }
  };

  const fetchProviders = async () => {
    setProvidersLoading(true);
    setProvidersError(null);
    try {
      const data = await apiClient.get<Provider[]>('/providers');
      setProviders(data);
    } catch (error: any) {
      setProvidersError(error.message);
      console.error(error);
    } finally {
      setProvidersLoading(false);
    }
  };

  const validate = (actionToValidate: 'add' | 'remove') => {
    const newErrors: { [key: string]: string } = {};

    if (!quantity) {
      newErrors.quantity = 'الكمية مطلوبة';
    } else if (Number(quantity) <= 0) {
      newErrors.quantity = 'الكمية يجب أن تكون أكبر من 0';
    }

    if (actionToValidate === 'remove' && Number(quantity) > item.current_quantity) {
      newErrors.quantity = 'الكمية المطلوب سحبها أكبر من الرصيد المتاح';
    }

    if (actionToValidate === 'remove' && !selectedDestinationId) {
      newErrors.destination = 'يجب تحديد الوجهة للسحب';
    }

    if (actionToValidate === 'add') {
      if (!selectedProviderId) {
        newErrors.provider = 'يجب تحديد المورد';
      }
      if (cost && Number(cost) < 0) {
        newErrors.cost = 'التكلفة يجب أن تكون 0 أو أكثر';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (currentAction: 'add' | 'remove') => {
    if (isSaving) return;
    if (!validate(currentAction)) {
      return;
    }

    setIsSaving(true);
    const apiAdjustmentType = currentAction === 'add' ? 'addition' : 'removal';

    const basePayload = {
      change_amount: Number(quantity),
      adjustment_type: apiAdjustmentType,
      person_name: personName.trim() || null,
    };

    let finalPayload: any = basePayload;

    if (currentAction === 'add') {
      finalPayload = {
        ...basePayload,
        provider_id: selectedProviderId ? Number(selectedProviderId) : null,
        cost: cost ? Number(cost) : null,
      };
    } else if (currentAction === 'remove') {
      finalPayload = {
        ...basePayload,
        destination_id: Number(selectedDestinationId),
      };
    }

    console.log(`API CALL (${apiAdjustmentType} Stock):`, `/api/items/${item.id}/adjust`, finalPayload);

    const idempotencyKey = generateIdempotencyKey();
    apiClient.post(`/items/${item.id}/adjust`, finalPayload, {
      headers: { 'Idempotency-Key': idempotencyKey }
    })
      .then(() => {
        onItemAdjusted();
        onClose();
      })
      .catch((apiError: any) => {
        console.error(`Failed to ${apiAdjustmentType} stock:`, apiError);
        setErrors(prevErrors => ({ ...prevErrors, api: apiError.message }));
        setIsSaving(false);
      });
  };

  const handleActionClick = (newAction: 'add' | 'remove') => {
    // When action changes, reset errors and specific fields but not the whole form
    setErrors({});
    if (newAction !== action) {
      setAction(newAction);
    }
  };

  const resetForm = () => {
    setQuantity('');
    setCost('');
    setPersonName('');
    setAction(null);
    setErrors({});
    setSelectedDestinationId('');
    setSelectedProviderId('');
    setProviders([]);
    setDestinations([]);
    setIsSaving(false);
  };

  const footer = (
    <>
      <button
        type="button"
        className="h-10 px-4 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer bg-white hover:bg-slate-100 text-ink-700 border border-gray-200 shadow-2xs ml-2"
        onClick={() => {
          onClose();
        }}
        disabled={isSaving}
      >
        إلغاء
      </button>
      {action === 'remove' && (
        <button
          type="button"
          className="h-10 px-4 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer bg-rose-600 hover:bg-rose-700 text-white shadow-xs ml-2"
          onClick={() => handleSubmit('remove')}
          disabled={isSaving}
        >
          {isSaving ? <Loader2 size={16} className="ml-1 animate-spin" /> : <ArrowDown size={16} className="ml-1" />}
          {isSaving ? 'جاري السحب...' : 'تأكيد السحب'}
        </button>
      )}
      {action === 'add' && (
        <button
          type="button"
          className="h-10 px-4 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white shadow-xs"
          onClick={() => handleSubmit('add')}
          disabled={isSaving}
        >
          {isSaving ? <Loader2 size={16} className="ml-1 animate-spin" /> : <ArrowUp size={16} className="ml-1" />}
          {isSaving ? 'جاري الإضافة...' : 'تأكيد الإضافة'}
        </button>
      )}
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`تعديل كمية: ${item.name}`}
      footer={footer}
    >
      <div className="bg-gray-50 p-4 rounded-lg mb-4">
        <div className="flex justify-between">
          <span className="text-gray-500">رقم الصنف:</span>
          <span className="font-medium">{item.id}</span>
        </div>
        <div className="flex justify-between mt-2">
          <span className="text-gray-500">الرصيد الحالي:</span>
          <span className="font-medium">
            {item.current_quantity} {item.unit_name}
          </span>
        </div>
      </div>

      <div className="flex justify-center my-4 space-x-2 space-x-reverse">
        <button
          className={`h-10 px-4 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors select-none cursor-pointer w-1/2 text-white ${action === 'remove' ? 'bg-emerald-300 hover:bg-emerald-400' : 'bg-emerald-600 hover:bg-emerald-700 shadow-xs'}`}
          onClick={() => handleActionClick('add')}
        >
          <ArrowUp size={16} className="ml-2" />
          إضافة رصيد
        </button>
        <button
          className={`h-10 px-4 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors select-none cursor-pointer w-1/2 text-white ${action === 'add' ? 'bg-rose-300 hover:bg-rose-400' : 'bg-rose-600 hover:bg-rose-700 shadow-xs'}`}
          onClick={() => handleActionClick('remove')}
        >
          <ArrowDown size={16} className="ml-2" />
          سحب رصيد
        </button>
      </div>

      {errors.api && <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium mb-4">{errors.api}</p>}

      {action && (
        <div className="grid grid-cols-1 gap-4">
          <div className="mb-3.5">
            <label htmlFor="quantity" className="block text-xs font-bold text-ink-700 mb-1.5">
              الكمية <span className="text-rose-500">*</span>
            </label>
            <input
              type="number"
              id="quantity"
              className={`w-full h-10 px-3.5 py-2 bg-white border border-gray-300 rounded-xl text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all ${errors.quantity ? 'border-rose-500' : ''}`}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="أدخل الكمية"
              min="1"
            />
            {errors.quantity && <p className="mt-1 text-xs font-medium text-rose-600">{errors.quantity}</p>}
          </div>

          <div className="mb-3.5">
            <label htmlFor="personName" className="block text-xs font-bold text-ink-700 mb-1.5 flex items-center">
              <User size={16} className="ml-1 text-gray-400 rtl:mr-1 rtl:ml-0" />
              اسم المستلم/المُسلِّم (اختياري)
            </label>
            <input
              type="text"
              id="personName"
              className="w-full h-10 px-3.5 py-2 bg-white border border-gray-300 rounded-xl text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="أدخل الاسم"
            />
          </div>

          {action === 'remove' && (
            <div className="border-t border-gray-200 pt-4 mt-2">
              <h3 className="text-gray-700 font-medium mb-3">معلومات السحب</h3>
              <div className="mb-3.5">
                <label htmlFor="destination" className="block text-xs font-bold text-ink-700 mb-1.5">
                  الوجهة <span className="text-rose-500">*</span>
                </label>
                {destinationsLoading ? (
                  <p>جاري تحميل الوجهات...</p>
                ) : destinationsError ? (
                  <p className="mt-1 text-xs font-medium text-rose-600">{destinationsError}</p>
                ) : (
                  <select
                    id="destination"
                    className={`w-full h-10 px-3.5 py-2 bg-white border border-gray-300 rounded-xl text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all ${errors.destination ? 'border-rose-500' : ''}`}
                    value={selectedDestinationId}
                    onChange={(e) => setSelectedDestinationId(e.target.value)}
                  >
                    <option value="">اختر الوجهة</option>
                    {destinations.map((dest) => (
                      <option key={dest.id} value={dest.id}>{dest.name}</option>
                    ))}
                  </select>
                )}
                {errors.destination && <p className="mt-1 text-xs font-medium text-rose-600">{errors.destination}</p>}
              </div>
            </div>
          )}

          {action === 'add' && (
            <>
              <div className="mb-3.5">
                <h3 className="text-lg font-medium text-gray-800 mb-3 border-b pb-2">
                  معلومات الإضافة
                </h3>
              </div>

              <div className="mb-3.5">
                <label htmlFor="provider" className="block text-xs font-bold text-ink-700 mb-1.5">
                  المورد
                </label>
                {providersLoading ? (
                  <p>جاري تحميل الموردين...</p>
                ) : providersError ? (
                  <p className="mt-1 text-xs font-medium text-rose-600">{providersError}</p>
                ) : (
                  <select
                    id="provider"
                    className={`w-full h-10 px-3.5 py-2 bg-white border border-gray-300 rounded-xl text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all ${errors.provider ? 'border-rose-500' : ''}`}
                    value={selectedProviderId}
                    onChange={(e) => setSelectedProviderId(e.target.value)}
                  >
                    <option value="">اختر المورد</option>
                    {providers.map((prov) => (
                      <option key={prov.id} value={prov.id}>{prov.name}</option>
                    ))}
                  </select>
                )}
                {errors.provider && <p className="mt-1 text-xs font-medium text-rose-600">{errors.provider}</p>}
              </div>

              <div className="mb-3.5">
                <label htmlFor="cost" className="block text-xs font-bold text-ink-700 mb-1.5">التكلفة للوحدة</label>
                <input
                  type="number"
                  id="cost"
                  className={`w-full h-10 px-3.5 py-2 bg-white border border-gray-300 rounded-xl text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all ${errors.cost ? 'border-rose-500' : ''}`}
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="أدخل التكلفة (اختياري)"
                  min="0"
                />
                {errors.cost && <p className="mt-1 text-xs font-medium text-rose-600">{errors.cost}</p>}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};
