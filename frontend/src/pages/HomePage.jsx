import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Plus } from 'lucide-react';
import Layout from '../components/Layout';
import GroupCard from '../components/GroupCard';
import CreateGroupModal from '../components/CreateGroupModal';
import ConfirmModal from '../components/ConfirmModal';
import GroupOverlay from '../components/GroupOverlay';
import SearchOverlay from '../components/SearchOverlay';
import { listGroups, createGroup, updateGroup, deleteGroup } from '../api';
import useQuality from '../hooks/useQuality';
import useGroupOrder from '../hooks/useGroupOrder';
import { useLocale } from '../contexts/LocaleContext';

export default function HomePage() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [searchQuery, setSearchQuery] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { group }
  const [renameTarget, setRenameTarget] = useState(null); // group to rename
  const [quality] = useQuality();
  const { t } = useLocale();
  const { applyOrder, persistOrder } = useGroupOrder();

  const fetchGroups = useCallback(async () => {
    try {
      const data = await listGroups();
      setGroups(applyOrder(data));
      setError('');
    } catch (err) {
      setError(err.message || t('home.error.load'));
    } finally {
      setLoading(false);
    }
  }, [applyOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReorder = useCallback((sourceId, targetId, side) => {
    setGroups((prev) => {
      const src = prev.findIndex((g) => g.id === sourceId);
      if (src === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(src, 1);
      let insertAt = next.findIndex((g) => g.id === targetId);
      if (insertAt === -1) return prev;
      if (side === 'after') insertAt += 1;
      next.splice(insertAt, 0, moved);
      persistOrder(next);
      return next;
    });
  }, [persistOrder]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleCreate = async (name) => {
    await createGroup(name);
    await fetchGroups();
  };

  const handleRename = async (name) => {
    if (!renameTarget) return;
    await updateGroup(renameTarget.id, { name });
    setRenameTarget(null);
    await fetchGroups();
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteGroup(deleteConfirm.id);
      setDeleteConfirm(null);
      await fetchGroups();
      setError('');
    } catch (err) {
      setError(err.message || t('home.error.delete'));
    }
  };

  const handleSearch = (query) => {
    setSearchQuery(query);
  };

  return (
    <Layout onSearch={handleSearch}>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Error banner */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-danger/20 border border-danger/50 text-danger text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-danger hover:underline text-xs opacity-80 hover:opacity-100">{t('home.dismiss')}</button>
          </div>
        )}

        {/* Page header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-content-primary">{t('home.heading')}</h1>
            <p className="text-sm text-content-muted mt-1">
              {t('home.subtitle', { count: groups.length })}
              {groups.length > 1 && (
                <span className="ml-2 text-content-muted/70">· {t('home.dragHint')}</span>
              )}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-sm font-medium text-white shadow-lg shadow-accent/20 hover:shadow-accent/30 transition-all hover:scale-[1.03] inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t('home.newGroup')}
          </button>
        </div>

        {/* Group grid */}
        {loading ? (
          <div className="flex items-center justify-center h-64 text-content-muted text-sm">{t('home.loading')}</div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-content-muted">
            <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-sm">{t('home.empty')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
            <AnimatePresence mode="popLayout">
              {groups.map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  onClick={setSelectedGroup}
                  onDelete={setDeleteConfirm}
                  onRename={setRenameTarget}
                  onReorderRequest={handleReorder}
                  quality={quality}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateGroupModal
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreate}
        />
      )}

      {/* Rename modal */}
      {renameTarget && (
        <CreateGroupModal
          initialName={renameTarget.name}
          headingKey="renameGroup.heading"
          submitKey="renameGroup.rename"
          submitLoadingKey="renameGroup.renaming"
          onClose={() => setRenameTarget(null)}
          onSubmit={handleRename}
        />
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <ConfirmModal
          title={t('home.deleteTitle')}
          message={t('home.deleteMessage', { name: deleteConfirm.name })}
          confirmText={t('home.deleteConfirm')}
          cancelText={t('home.deleteCancel')}
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {/* Group overlay */}
      {selectedGroup && (
        <GroupOverlay
          group={selectedGroup}
          onClose={() => setSelectedGroup(null)}
          onGroupUpdated={fetchGroups}
        />
      )}

      {/* Search overlay */}
      {searchQuery && (
        <SearchOverlay
          query={searchQuery}
          onClose={() => setSearchQuery(null)}
        />
      )}
    </Layout>
  );
}
