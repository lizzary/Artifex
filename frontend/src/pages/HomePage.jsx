import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Archive, Plus } from 'lucide-react';
import Layout from '../components/Layout';
import GroupCard from '../components/GroupCard';
import CreateGroupModal from '../components/CreateGroupModal';
import ConfirmModal from '../components/ConfirmModal';
import BatchExportModal from '../components/BatchExportModal';
import GroupOverlay from '../components/GroupOverlay';
import SearchOverlay from '../components/SearchOverlay';
import { listGroups, createGroup, updateGroup, deleteGroup } from '../api';
import useGroupOrder from '../hooks/useGroupOrder';
import { refreshGroupSettings } from '../hooks/useGroupSettings';
import { useLocale } from '../contexts/LocaleContext';
import './home-reorder.css';

export default function HomePage() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [searchQuery, setSearchQuery] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deletingGroupId, setDeletingGroupId] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null); // group to rename
  const [draggedGroupId, setDraggedGroupId] = useState(null);
  const [dropPreview, setDropPreview] = useState(null);
  const { t } = useLocale();
  const { applyOrder, persistOrder, error: configError } = useGroupOrder();
  const deleteInFlightRef = useRef(false);
  const groupGridRef = useRef(null);
  const draggedGroupRef = useRef(null);

  useEffect(() => {
    if (configError) setError(t('settings.toast.saveFailed'));
  }, [configError, t]);

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
    const sourceIndex = groups.findIndex((group) => group.id === sourceId);
    if (sourceIndex === -1) return;
    const next = [...groups];
    const [moved] = next.splice(sourceIndex, 1);
    let insertAt = next.findIndex((group) => group.id === targetId);
    if (insertAt === -1) return;
    if (side === 'after') insertAt += 1;
    if (insertAt === sourceIndex) return;
    next.splice(insertAt, 0, moved);
    setGroups(next);
    persistOrder(next);
  }, [groups, persistOrder]);

  const finishReorderDrag = useCallback(() => {
    draggedGroupRef.current = null;
    setDraggedGroupId(null);
    setDropPreview(null);
  }, []);

  useEffect(() => {
    if (draggedGroupId === null) return undefined;
    window.addEventListener('dragend', finishReorderDrag);
    window.addEventListener('blur', finishReorderDrag);
    return () => {
      window.removeEventListener('dragend', finishReorderDrag);
      window.removeEventListener('blur', finishReorderDrag);
    };
  }, [draggedGroupId, finishReorderDrag]);

  function findDropPreview(event) {
    const grid = groupGridRef.current;
    const sourceIndex = groups.findIndex((group) => group.id === draggedGroupRef.current);
    if (!grid || sourceIndex === -1) return null;
    const cards = [...grid.querySelectorAll('[data-group-card-id]')].map((card) => ({
      id: Number(card.dataset.groupCardId),
      rect: card.getBoundingClientRect(),
    }));
    if (cards.length === 0) return null;
    // Row gaps select the start of the next row. Within a row, each midpoint
    // separates its leading and trailing insertion positions.
    const firstInRow = cards.find(({ rect }) => event.clientY <= rect.bottom) ?? cards[cards.length - 1];
    let closest = firstInRow;
    let side = event.clientY < firstInRow.rect.top ? 'before' : 'after';
    if (event.clientY >= firstInRow.rect.top && event.clientY <= firstInRow.rect.bottom) {
      const row = cards.filter(({ rect }) => Math.abs(rect.top - firstInRow.rect.top) < 1);
      closest = row.find(({ rect }) => event.clientX < rect.left + rect.width / 2) ?? row[row.length - 1];
      side = event.clientX < closest.rect.left + closest.rect.width / 2 ? 'before' : 'after';
    }
    if (closest.id === draggedGroupRef.current) return null;
    const targetIndex = groups.findIndex((group) => group.id === closest.id);
    const insertAt = targetIndex - Number(sourceIndex < targetIndex) + Number(side === 'after');
    if (insertAt === sourceIndex) return null;
    const gridRect = grid.getBoundingClientRect();
    const left = (side === 'before' ? closest.rect.left - 10 : closest.rect.right + 10) - gridRect.left;
    return {
      targetId: closest.id,
      name: groups[targetIndex].name,
      side,
      position: insertAt + 1,
      left,
      top: closest.rect.top - gridRect.top,
      height: closest.rect.height,
      align: left > gridRect.width / 2 ? 'end' : 'start',
    };
  }

  function handleGridDragOver(event) {
    if (draggedGroupRef.current === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const next = findDropPreview(event);
    setDropPreview((current) => (
      current?.targetId === next?.targetId && current?.side === next?.side
      && current?.left === next?.left && current?.top === next?.top
        ? current
        : next
    ));
  }

  function handleGridDrop(event) {
    const sourceId = draggedGroupRef.current;
    if (sourceId === null) return;
    event.preventDefault();
    const target = findDropPreview(event);
    if (target) handleReorder(sourceId, target.targetId, target.side);
    finishReorderDrag();
  }

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
    if (!deleteConfirm || deleteInFlightRef.current) return;
    const target = deleteConfirm;
    deleteInFlightRef.current = true;
    setDeletingGroupId(target.id);
    setError('');
    try {
      await deleteGroup(target.id);
      setGroups((current) => current.filter((group) => group.id !== target.id));
      setDeleteConfirm(null);
      setError('');
      void refreshGroupSettings().catch(() => {});
      void fetchGroups();
    } catch (err) {
      setError(err.message || t('home.error.delete'));
    } finally {
      deleteInFlightRef.current = false;
      setDeletingGroupId(null);
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
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-content-primary">{t('home.heading')}</h1>
            <p className="text-sm text-content-muted mt-1">
              {t('home.subtitle', { count: groups.length })}
              {groups.length > 1 && (
                <span className="ml-2 text-content-muted/70">· {t('home.dragHint')}</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={() => setShowExport(true)} disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-edge-primary bg-surface-secondary px-4 py-2.5 text-sm font-medium text-content-secondary transition-colors enabled:hover:border-accent/40 enabled:hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50">
              <Archive className="h-4 w-4" aria-hidden="true" />
              {t('home.batchExport')}
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-sm font-medium text-white shadow-lg shadow-accent/20 hover:shadow-accent/30 transition-all hover:scale-[1.03] inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {t('home.newGroup')}
            </button>
          </div>
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
          <div
            ref={groupGridRef}
            className="home-group-grid relative grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5"
            data-reordering={draggedGroupId !== null ? '' : undefined}
            onDragOver={handleGridDragOver}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget)) return;
              const rect = event.currentTarget.getBoundingClientRect();
              if (event.clientX < rect.left || event.clientX > rect.right
                || event.clientY < rect.top || event.clientY > rect.bottom) setDropPreview(null);
            }}
            onDrop={handleGridDrop}
          >
            <AnimatePresence mode="popLayout">
              {groups.map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  onClick={setSelectedGroup}
                  onDelete={setDeleteConfirm}
                  onRename={setRenameTarget}
                  onReorderDragStart={(id) => {
                    draggedGroupRef.current = id;
                    setDraggedGroupId(id);
                  }}
                  onReorderDragEnd={finishReorderDrag}
                  dragging={draggedGroupId === group.id}
                  quality="low"
                />
              ))}
            </AnimatePresence>
            {dropPreview && (
              <div
                className="home-reorder-marker"
                style={{ left: dropPreview.left, top: dropPreview.top, height: dropPreview.height }}
                aria-hidden="true"
              >
                <div className="home-reorder-label" data-align={dropPreview.align}>
                  <strong>{t('home.reorderPosition', { position: dropPreview.position })}</strong>
                  <span>{t(dropPreview.side === 'before' ? 'home.reorderBefore' : 'home.reorderAfter', { name: dropPreview.name })}</span>
                </div>
              </div>
            )}
            <span className="sr-only" role="status">
              {dropPreview && t('home.reorderPosition', { position: dropPreview.position })}
            </span>
          </div>
        )}
      </div>

      {showExport && <BatchExportModal groups={groups} onClose={() => setShowExport(false)} />}

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
          pending={deletingGroupId === deleteConfirm.id}
          pendingText={t('home.deleting')}
          onConfirm={handleDelete}
          onCancel={() => {
            if (!deleteInFlightRef.current) setDeleteConfirm(null);
          }}
        />
      )}

      {/* Group overlay */}
      {selectedGroup && (
        <GroupOverlay
          key={selectedGroup.id}
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
