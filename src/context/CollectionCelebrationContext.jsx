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

  const previewCollectionCelebration = useCallback(async () => {
    const current = await fetchCollectionCelebrationKpis();
    const openAmount = current.openCollectionAmount;
    const recorded = current.recordedCollection;
    const delta = openAmount > 0
      ? Math.min(Math.max(Math.round(openAmount * 0.08), 1500), 12000)
      : 3500;

    showCelebration({
      before: current,
      after: {
        openCollectionAmount: Math.max(0, openAmount - delta),
        recordedCollection: recorded + delta,
      },
    });
  }, [showCelebration]);

  const value = useMemo(() => ({
    completeCollectionDueWithCelebration,
    previewCollectionCelebration,
    isCelebrating: Boolean(celebration),
  }), [completeCollectionDueWithCelebration, previewCollectionCelebration, celebration]);

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
