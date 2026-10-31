import useGroupViewSetting from './useGroupSettings';

export default function useQuality(groupId) {
  return useGroupViewSetting(groupId, 'quality');
}
