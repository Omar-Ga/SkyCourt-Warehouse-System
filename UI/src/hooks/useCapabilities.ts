import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { getCapabilitiesForRole, RoleCapabilities } from '../navigation';

export const useCapabilities = (): RoleCapabilities => {
  const { role } = useAuth();
  return useMemo(() => getCapabilitiesForRole(role), [role]);
};
