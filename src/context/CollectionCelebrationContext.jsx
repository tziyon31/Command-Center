import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import CollectionCelebrationOverlay from '@/components/collection/CollectionCelebrationOverlay';
import { completeCollectionDue } from '@/lib/collectionDueUtils';
import { fetchCollectionCelebrationKpis } from '@/lib/collectionCelebrationKpis';

const CollectionCelebrationContext = createContext(null);

export function CollectionCelebrationProvider({ children }) {
  const [celebration, setCelebration] = useState(null);
  const isCelebratingRef = useRef(false);

  const dismissCelebration = useCallback(() => {
    isCelebratingRef.current = false;
    setCelebration(null);
  }, []);

  const showCelebration = useCallback((payload) => {
    if (isCelebratingRef.current || !payload?.before || !payload?.after) return;
    isCelebratingRef.current = true;
    setCelebration(payload);
  }, []);

  const completeCollectionDueWithCelebration = useCallback(async (collectionDue, options = {}) => {
    const before = await fetchCollectionCelebrationKpis();
    const result = await completeCollectionDue(collectionDue, options);
    const after = await fetchCollectionCelebrationKpis();
    showCelebration({ before, after });
    return result;
  }, [showCelebration]);

  const value = useMemo(() => ({
    completeCollectionDueWithCelebration,
    isCelebrating: Boolean(celebration),
  }), [completeCollectionDueWithCelebration, celebration]);

  return (
    <CollectionCelebrationContext.Provider value={value}>
      {children}
      <CollectionCelebrationOverlay
        celebration={celebration}
        onDismiss={dismissCelebration}
      />
    </CollectionCelebrationContext.Provider>
  );
}

export function useCollectionCelebration() {
  const context = useContext(CollectionCelebrationContext);
  if (!context) {
    throw new Error('useCollectionCelebration must be used within CollectionCelebrationProvider');
  }
  return context;
}
