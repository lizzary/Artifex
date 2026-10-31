import useGroupViewSetting from './useGroupSettings';

export default function useOriginalRatio(groupId) {
  return useGroupViewSetting(groupId, 'original_ratio');
}
