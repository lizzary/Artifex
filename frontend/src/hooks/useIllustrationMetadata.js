import { useEffect, useState } from 'react';
import { getIllustrationMetadata } from '../api';

const EMPTY_STATE = {
  illustrationId: null,
  metadata: null,
  loading: false,
  error: '',
};

export default function useIllustrationMetadata(illustrationId, enabled) {
  const [state, setState] = useState(EMPTY_STATE);

  useEffect(() => {
    if (!enabled || illustrationId == null) return undefined;

    let cancelled = false;
    setState({ illustrationId, metadata: null, loading: true, error: '' });
    getIllustrationMetadata(illustrationId)
      .then((metadata) => {
        if (!cancelled) setState({ illustrationId, metadata, loading: false, error: '' });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            illustrationId,
            metadata: null,
            loading: false,
            error: error.message,
          });
        }
      });

    return () => { cancelled = true; };
  }, [enabled, illustrationId]);

  if (state.illustrationId !== illustrationId) {
    return { metadata: null, loading: Boolean(enabled), error: '' };
  }
  return { metadata: state.metadata, loading: state.loading, error: state.error };
}
