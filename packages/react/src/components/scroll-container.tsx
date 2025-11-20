import {
  createContext,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export type ScrollContainerContextValue = {
  pinned: boolean;
  hasOverflow: boolean;
  showScrollToBottom: boolean;
  scrollToBottom: (options?: ScrollToOptions) => void;
};

const ScrollContainerContext = createContext<ScrollContainerContextValue | null>(null);

export const useScrollContainer = (): ScrollContainerContextValue => {
  const ctx = useContext(ScrollContainerContext);
  if (!ctx) {
    throw new Error('useScrollContainer must be used within a <ScrollContainer>');
  }
  return ctx;
};

export type ScrollContainerRenderProps = ScrollContainerContextValue & {
  containerRef: (node: HTMLElement | null) => void;
  refObject: MutableRefObject<HTMLElement | null>;
};

export type ScrollContainerProps = {
  children: (props: ScrollContainerRenderProps) => ReactNode;
  /**
   * Number of pixels away from the bottom that still counts as "pinned".
   */
  pinThreshold?: number;
  /**
   * Behavior used when user re-pins (e.g., clicks button).
   */
  repinScrollBehavior?: ScrollBehavior;
  /**
   * Behavior used when already pinned and keeping up with new content.
   */
  pinnedScrollBehavior?: ScrollBehavior;
};

const isNearBottom = (element: HTMLElement, threshold: number): boolean => {
  const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceFromBottom <= threshold;
};

export const ScrollContainer = ({
  children,
  pinThreshold = 32,
  repinScrollBehavior = 'smooth',
  pinnedScrollBehavior = 'auto',
}: ScrollContainerProps): ReactElement => {
  const [pinned, setPinned] = useState(true);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [containerNode, setContainerNode] = useState<HTMLElement | null>(null);
  const refObject = useRef<HTMLElement | null>(null);
  const pinnedRef = useRef(pinned);
  const autoScrollingRef = useRef(false);

  const setContainerRef = useCallback((node: HTMLElement | null) => {
    if (refObject.current === node) return;
    refObject.current = node;
    setContainerNode(node);
  }, []);

  useEffect(() => {
    pinnedRef.current = pinned;
  }, [pinned]);

  const scrollToBottomWithBehavior = useCallback((behavior: ScrollBehavior) => {
    const node = refObject.current;
    if (!node) return;
    autoScrollingRef.current = true;
    node.scrollTo({
      top: node.scrollHeight,
      behavior,
    });
    setPinned(true);
  }, []);

  const scrollToBottom = useCallback(
    (options?: ScrollToOptions) => {
      const behavior = options?.behavior ?? repinScrollBehavior;
      scrollToBottomWithBehavior(behavior);
    },
    [repinScrollBehavior, scrollToBottomWithBehavior],
  );

  const updateOverflow = useCallback(() => {
    const node = refObject.current;
    if (!node) return;
    const overflow = node.scrollHeight > node.clientHeight + 1;
    setHasOverflow((prev) => (prev === overflow ? prev : overflow));
  }, []);

  useIsomorphicLayoutEffect(() => {
    const node = containerNode;
    if (!node) return;

    const handleScroll = () => {
      const nextPinned = isNearBottom(node, pinThreshold);
      if (autoScrollingRef.current) {
        if (nextPinned) {
          autoScrollingRef.current = false;
          setPinned(true);
          pinnedRef.current = true;
        }
        return;
      }
      setPinned((prev) => (prev === nextPinned ? prev : nextPinned));
    };

    node.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      node.removeEventListener('scroll', handleScroll);
    };
  }, [containerNode, pinThreshold]);

  useIsomorphicLayoutEffect(() => {
    const node = containerNode;
    if (!node) return;

    const cancelAutoScroll = () => {
      autoScrollingRef.current = false;
    };

    node.addEventListener('wheel', cancelAutoScroll, { passive: true });
    node.addEventListener('touchstart', cancelAutoScroll, { passive: true });
    node.addEventListener('pointerdown', cancelAutoScroll, { passive: true });

    return () => {
      node.removeEventListener('wheel', cancelAutoScroll);
      node.removeEventListener('touchstart', cancelAutoScroll);
      node.removeEventListener('pointerdown', cancelAutoScroll);
    };
  }, [containerNode]);

  useIsomorphicLayoutEffect(() => {
    const node = containerNode;
    if (!node) return;

    updateOverflow();

    let frame: number | null = null;
    const handleMutations = () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        updateOverflow();
        if (pinnedRef.current) {
          scrollToBottomWithBehavior(pinnedScrollBehavior);
        }
      });
    };

    const supportsResizeObserver = typeof ResizeObserver !== 'undefined';
    const supportsMutationObserver = typeof MutationObserver !== 'undefined';

    const resizeObserver = supportsResizeObserver ? new ResizeObserver(handleMutations) : null;
    resizeObserver?.observe(node);

    const mutationObserver = supportsMutationObserver
      ? new MutationObserver(handleMutations)
      : null;
    mutationObserver?.observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    handleMutations();

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [containerNode, pinnedScrollBehavior, scrollToBottomWithBehavior, updateOverflow]);

  const contextValue = useMemo(
    () => ({
      pinned,
      hasOverflow,
      showScrollToBottom: hasOverflow && !pinned,
      scrollToBottom,
    }),
    [hasOverflow, pinned, scrollToBottom],
  );

  return (
    <ScrollContainerContext.Provider value={contextValue}>
      {children({
        ...contextValue,
        containerRef: setContainerRef,
        refObject,
      })}
    </ScrollContainerContext.Provider>
  );
};
