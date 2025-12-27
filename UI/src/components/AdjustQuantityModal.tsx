import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { ArrowUp, ArrowDown, User, Loader2 } from 'lucide-react';
import { Item, Destination, Provider } from '../types'; // Import shared types

type AdjustQuantityModalProps = {
  isOpen: boolean;
  onClose: () => void;
  item: Item; // Use shared Item type
  onItemAdjusted: () => void; // Callback for refreshing data
  // units?: Unit[]; // Only add if unit selection/display logic is added here
};

export const AdjustQuantityModal = ({ isOpen, onClose, item, onItemAdjusted }: AdjustQuantityModalProps) => {
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
      const response = await fetch('/api/destinations');
      if (!response.ok) {
        throw new Error('Failed to fetch destinations');
      }
      const data: Destination[] = await response.json();
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
      const response = await fetch('/api/providers');
      if (!response.ok) {
        throw new Error('Failed to fetch providers');
      }
      const data: Provider[] = await response.json();
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

    fetch(`/api/items/${item.id}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalPayload),
    })
      .then(async response => {
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'An unknown error occurred' }));
          throw new Error(errorData.message || errorData.error || `Failed to ${apiAdjustmentType} stock`);
        }
        onItemAdjusted();
        onClose();
      })
      .catch(apiError => {
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
        className="btn btn-outline ml-2"
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
          className="btn bg-error-500 text-white hover:bg-error-600 ml-2 disabled:opacity-70 disabled:cursor-not-allowed"
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
          className="btn bg-success-500 text-white hover:bg-success-600 disabled:opacity-70 disabled:cursor-not-allowed"
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
          className={`btn w-1/2 text-white ${action === 'remove' ? 'bg-success-300' : 'bg-success-500'}`}
          onClick={() => handleActionClick('add')}
        >
          <ArrowUp size={16} className="ml-2" />
          إضافة رصيد
        </button>
        <button
          className={`btn w-1/2 text-white ${action === 'add' ? 'bg-error-300' : 'bg-error-500'}`}
          onClick={() => handleActionClick('remove')}
        >
          <ArrowDown size={16} className="ml-2" />
          سحب رصيد
        </button>
      </div>

      {errors.api && <p className="form-error bg-error-100 text-error-700 p-3 rounded-md mb-4">{errors.api}</p>}

      {action && (
        <div className="grid grid-cols-1 gap-4">
          <div className="form-group">
            <label htmlFor="quantity" className="form-label">
              الكمية <span className="text-error-500">*</span>
            </label>
            <input
              type="number"
              id="quantity"
              className={`input ${errors.quantity ? 'border-error-500' : ''}`}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="أدخل الكمية"
              min="1"
            />
            {errors.quantity && <p className="form-error">{errors.quantity}</p>}
          </div>

          <div className="form-group">
            <label htmlFor="personName" className="form-label flex items-center">
              <User size={16} className="ml-1 text-gray-400 rtl:mr-1 rtl:ml-0" />
              اسم المستلم/المُسلِّم (اختياري)
            </label>
            <input
              type="text"
              id="personName"
              className="input"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="أدخل الاسم"
            />
          </div>

          {action === 'remove' && (
            <div className="border-t border-gray-200 pt-4 mt-2">
              <h3 className="text-gray-700 font-medium mb-3">معلومات السحب</h3>
              <div className="form-group">
                <label htmlFor="destination" className="form-label">
                  الوجهة <span className="text-error-500">*</span>
                </label>
                {destinationsLoading ? (
                  <p>جاري تحميل الوجهات...</p>
                ) : destinationsError ? (
                  <p className="form-error">{destinationsError}</p>
                ) : (
                  <select
                    id="destination"
                    className={`input ${errors.destination ? 'border-error-500' : ''}`}
                    value={selectedDestinationId}
                    onChange={(e) => setSelectedDestinationId(e.target.value)}
                  >
                    <option value="">اختر الوجهة</option>
                    {destinations.map((dest) => (
                      <option key={dest.id} value={dest.id}>{dest.name}</option>
                    ))}
                  </select>
                )}
                {errors.destination && <p className="form-error">{errors.destination}</p>}
              </div>
            </div>
          )}

          {action === 'add' && (
            <>
              <div className="form-group">
                <h3 className="text-lg font-medium text-gray-800 mb-3 border-b pb-2">
                  معلومات الإضافة
                </h3>
              </div>

              <div className="form-group">
                <label htmlFor="provider" className="form-label">
                  المورد
                </label>
                {providersLoading ? (
                  <p>جاري تحميل الموردين...</p>
                ) : providersError ? (
                  <p className="form-error">{providersError}</p>
                ) : (
                  <select
                    id="provider"
                    className={`input ${errors.provider ? 'border-error-500' : ''}`}
                    value={selectedProviderId}
                    onChange={(e) => setSelectedProviderId(e.target.value)}
                  >
                    <option value="">اختر المورد</option>
                    {providers.map((prov) => (
                      <option key={prov.id} value={prov.id}>{prov.name}</option>
                    ))}
                  </select>
                )}
                {errors.provider && <p className="form-error">{errors.provider}</p>}
              </div>

              <div className="form-group">
                <label htmlFor="cost" className="form-label">التكلفة للوحدة</label>
                <input
                  type="number"
                  id="cost"
                  className={`input ${errors.cost ? 'border-error-500' : ''}`}
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="أدخل التكلفة (اختياري)"
                  min="0"
                />
                {errors.cost && <p className="form-error">{errors.cost}</p>}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};