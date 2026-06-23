import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Monitor, Cpu, Globe, Download, ChevronDown, Upload, X, Trash2, FilePlus2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLocale } from '../contexts/LocaleContext';
import { useToast } from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import NamingFormatInput from '../components/NamingFormatInput';
import useDownloadConfig from '../hooks/useDownloadConfig';
import { listModels, uploadModel, deleteModel, deleteDefaultModel } from '../api';

const BASE_URL = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8000';
const LANG_OPTIONS = [
  { value: 'en', labelKey: 'settings.general.language.en' },
  { value: 'zh', labelKey: 'settings.general.language.zh' },
];
const CONFLICT_POLICY_OPTIONS = [
  { value: 'skip', labelKey: 'settings.general.conflictPolicy.skip' },
  { value: 'overwrite', labelKey: 'settings.general.conflictPolicy.overwrite' },
];

export default function SettingsPage() {
  const { locale, setLocale, t } = useLocale();
  const { addToast } = useToast();
  const { format, setFormat } = useDownloadConfig();
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formatSaved, setFormatSaved] = useState(false);

  // Model management state
  const [models, setModels] = useState([]);
  const [activeModel, setActiveModel] = useState('');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmResetDefault, setConfirmResetDefault] = useState(false);
  const modelDropdownRef = useRef(null);
  const fileInputRef = useRef(null);

  const fetchModels = useCallback(() => {
    listModels()
      .then(data => {
        setModels(data.models || []);
        setActiveModel(data.active_model || '');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${BASE_URL}/api/settings`)
      .then(r => r.json())
      .then(setSettings)
      .catch(() => {});
    fetchModels();
  }, [fetchModels]);

  // Click-outside for model dropdown
  useEffect(() => {
    const handler = (e) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target)) {
        setModelDropdownOpen(false);
      }
    };
    if (modelDropdownOpen) {
      document.addEventListener('mousedown', handler);
    }
    return () => document.removeEventListener('mousedown', handler);
  }, [modelDropdownOpen]);

  const handleFormatBlur = () => {
    if (formatSaved) return;
    addToast(t('settings.toast.saved'), 'success');
    setFormatSaved(true);
    setTimeout(() => setFormatSaved(false), 3000);
  };

  const handleBackendSettingChange = async (key, value) => {
    const prevValue = settings ? settings[key] : undefined;
    setSettings(prev => prev ? { ...prev, [key]: value } : prev);
    setSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json();
      setSettings(updated);
      addToast(t('settings.toast.saved'), 'success');
    } catch {
      setSettings(prev => prev ? { ...prev, [key]: prevValue } : prev);
      addToast(t('settings.toast.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleModelSelect = async (modelName) => {
    setModelDropdownOpen(false);
    if (modelName === activeModel) return;
    setActiveModel(modelName);
    try {
      const res = await fetch(`${BASE_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_model: modelName }),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json();
      setSettings(updated);
      addToast(t('settings.toast.saved'), 'success');
    } catch {
      setActiveModel(activeModel);
      addToast(t('settings.toast.saveFailed'), 'error');
    }
  };

  const handleModelDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/model/download`, { method: 'POST' });
      if (!res.ok) throw new Error('Download failed');
      addToast(t('settings.toast.saved'), 'success');
      fetchModels(); // refresh cached status
    } catch {
      addToast(t('settings.toast.saveFailed'), 'error');
    } finally {
      setDownloading(false);
    }
  };

  const handleModelUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadModel(file);
      addToast(t('settings.toast.saved'), 'success');
      fetchModels();
    } catch {
      addToast(t('settings.toast.saveFailed'), 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDefaultModelReset = async () => {
    setConfirmResetDefault(false);
    setResetting(true);
    try {
      await deleteDefaultModel();
      addToast(t('settings.toast.saved'), 'success');
      fetchModels();
    } catch {
      addToast(t('settings.toast.saveFailed'), 'error');
    } finally {
      setResetting(false);
    }
  };

  const handleModelDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteModel(deleteTarget.name);
      if (activeModel === deleteTarget.name) setActiveModel('');
      addToast(t('settings.toast.saved'), 'success');
      fetchModels();
    } catch {
      addToast(t('settings.toast.saveFailed'), 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  const selectedDisplayName = activeModel
    ? (models.find(m => m.name === activeModel)?.name || activeModel)
    : t('settings.indexing.modelDefault');
  const defaultModel = models.find(m => m.type === 'default');
  const defaultCached = defaultModel?.cached ?? false;
  const userModels = models.filter(m => m.type === 'user');

  return (
    <div className="min-h-screen bg-surface-primary text-content-primary">
      <header className="sticky top-0 z-40 border-b border-edge-primary bg-surface-primary/80 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center gap-4">
          <Link to="/" className="p-2 rounded-lg hover:bg-surface-tertiary text-content-tertiary hover:text-content-primary transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-bold">{t('settings.heading')}</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {/* General */}
        <section>
          <h2 className="text-sm font-semibold text-content-secondary uppercase tracking-wide mb-4 flex items-center gap-2">
            <Monitor className="w-4 h-4" />
            {t('settings.general.heading')}
          </h2>
          <div className="bg-surface-secondary rounded-2xl border border-edge-secondary divide-y divide-edge-subtle">
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-content-tertiary" />
                <span className="text-sm font-medium text-content-primary">{t('settings.general.language')}</span>
              </div>
              <select
                value={locale}
                onChange={e => setLocale(e.target.value)}
                className="px-3 py-2 rounded-lg bg-surface-tertiary border border-edge-secondary text-sm text-content-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors cursor-pointer"
              >
                {LANG_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-start gap-3 pr-4">
                <FilePlus2 className="w-5 h-5 text-content-tertiary mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-sm font-medium text-content-primary">{t('settings.general.conflictPolicy')}</span>
                  <p className="text-xs text-content-muted mt-0.5">{t('settings.general.conflictPolicyDesc')}</p>
                </div>
              </div>
              <select
                value={settings?.upload_conflict_policy || 'skip'}
                disabled={saving || !settings}
                onChange={e => handleBackendSettingChange('upload_conflict_policy', e.target.value)}
                className="px-3 py-2 rounded-lg bg-surface-tertiary border border-edge-secondary text-sm text-content-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors cursor-pointer flex-shrink-0"
              >
                {CONFLICT_POLICY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Image Indexing */}
        <section>
          <h2 className="text-sm font-semibold text-content-secondary uppercase tracking-wide mb-1 flex items-center gap-2">
            <Cpu className="w-4 h-4" />
            {t('settings.indexing.heading')}
          </h2>
          <p className="text-xs text-content-muted mb-4 ml-6">
            {t('settings.indexing.description')}
          </p>
          <div className="bg-surface-secondary rounded-2xl border border-edge-secondary divide-y divide-edge-subtle">
            {/* Model selector */}
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <span className="text-sm font-medium text-content-primary">{t('settings.indexing.model')}</span>
                <p className="text-xs text-content-muted mt-0.5">{t('settings.indexing.modelDesc')}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                {/* Dropdown */}
                <div className="relative" ref={modelDropdownRef}>
                  <button
                    onClick={() => setModelDropdownOpen(v => !v)}
                    disabled={uploading || downloading}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-tertiary border border-edge-secondary text-sm text-content-primary hover:border-accent/50 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all min-w-[180px]"
                  >
                    <span className="flex-1 text-left truncate max-w-[180px]">{selectedDisplayName}</span>
                    <ChevronDown className={`w-4 h-4 text-content-tertiary transition-transform flex-shrink-0 ${modelDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {modelDropdownOpen && (
                    <div className="absolute top-full mt-1 right-0 w-[320px] bg-surface-secondary border border-edge-primary rounded-xl shadow-2xl z-50 overflow-hidden">
                      {/* Default model */}
                      <button
                        onClick={() => handleModelSelect('')}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-surface-tertiary ${
                          !activeModel ? 'text-accent bg-accent/5' : 'text-content-primary'
                        }`}
                      >
                        <div>
                          <span className="truncate">{t('settings.indexing.modelDefault')}</span>
                          {defaultCached ? (
                            <span className="ml-2 text-xs text-success">{t('settings.indexing.modelCached')}</span>
                          ) : (
                            <span className="ml-2 text-xs text-content-muted">{t('settings.indexing.modelNotCached')}</span>
                          )}
                        </div>
                        {!activeModel && (
                          <span className="w-4 h-4 rounded-full bg-accent flex items-center justify-center flex-shrink-0 ml-2">
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </span>
                        )}
                      </button>

                      {/* User models */}
                      {userModels.length > 0 && (
                        <>
                          <div className="border-t border-edge-subtle" />
                          {userModels.map(m => {
                            const isActive = m.name === activeModel;
                            return (
                              <div
                                key={m.name}
                                className={`flex items-center group transition-colors ${
                                  isActive ? 'bg-accent/5' : 'hover:bg-surface-tertiary'
                                }`}
                              >
                                <button
                                  onClick={() => handleModelSelect(m.name)}
                                  className={`flex-1 text-left px-4 py-2.5 text-sm truncate transition-colors ${
                                    isActive ? 'text-accent font-medium' : 'text-content-primary'
                                  }`}
                                >
                                  {m.name}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteTarget(m);
                                  }}
                                  className="px-3 py-2.5 text-content-tertiary hover:text-danger hover:bg-danger/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 flex-shrink-0 mr-1"
                                  title={t('settings.indexing.modelDeleteConfirm')}
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            );
                          })}
                        </>
                      )}

                      {userModels.length === 0 && (
                        <div className="border-t border-edge-subtle px-4 py-4 text-center text-xs text-content-muted">
                          {t('settings.indexing.modelNoUserModels')}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Upload button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || downloading}
                  className={`p-2 rounded-lg border border-edge-secondary bg-surface-tertiary hover:bg-edge-secondary hover:border-accent/50 text-content-tertiary hover:text-accent transition-all ${
                    (uploading || downloading) ? 'opacity-50 cursor-wait' : ''
                  }`}
                  title={t('settings.indexing.modelUpload')}
                >
                  <Upload className="w-4 h-4" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".onnx,.csv"
                  onChange={handleModelUpload}
                />
              </div>
            </div>

            {/* Download default model button — only shown when not cached */}
            {!defaultCached && (
              <div className="flex items-center justify-between px-5 py-4">
                <div>
                  <span className="text-sm font-medium text-content-primary">{t('settings.indexing.modelDownloadTitle')}</span>
                  <p className="text-xs text-content-muted mt-0.5">{t('settings.indexing.modelDownloadDesc')}</p>
                </div>
                <button
                  onClick={handleModelDownload}
                  disabled={downloading}
                  className={`px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-all ${
                    downloading
                      ? 'bg-surface-tertiary text-content-muted cursor-wait'
                      : 'bg-accent hover:bg-accent-hover text-white shadow-lg shadow-accent/20 hover:shadow-accent/30 hover:scale-[1.03]'
                  }`}
                >
                  <Download className={`w-4 h-4 ${downloading ? 'animate-pulse' : ''}`} />
                  {downloading ? t('settings.indexing.modelDownloading') : t('settings.indexing.modelDownload')}
                </button>
              </div>
            )}

            {/* Reset default model — only shown when cached, lets the user wipe a broken download */}
            {defaultCached && (
              <div className="flex items-center justify-between px-5 py-4">
                <div className="pr-4">
                  <span className="text-sm font-medium text-content-primary">{t('settings.indexing.modelResetTitle')}</span>
                  <p className="text-xs text-content-muted mt-0.5">{t('settings.indexing.modelResetDesc')}</p>
                </div>
                <button
                  onClick={() => setConfirmResetDefault(true)}
                  disabled={resetting || downloading}
                  className={`px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-all flex-shrink-0 ${
                    resetting
                      ? 'bg-surface-tertiary text-content-muted cursor-wait'
                      : 'bg-surface-tertiary border border-edge-secondary text-content-tertiary hover:border-danger/60 hover:text-danger hover:bg-danger/5'
                  }`}
                >
                  <Trash2 className={`w-4 h-4 ${resetting ? 'animate-pulse' : ''}`} />
                  {resetting ? t('settings.indexing.modelResetting') : t('settings.indexing.modelResetButton')}
                </button>
              </div>
            )}

            {/* Auto-tag toggle */}
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <span className="text-sm font-medium text-content-primary">{t('settings.indexing.autoTag')}</span>
                <p className="text-xs text-content-muted mt-0.5">{t('settings.indexing.autoTagDesc')}</p>
              </div>
              <button
                role="switch"
                aria-checked={settings?.auto_tag ?? true}
                disabled={saving || !settings}
                onClick={() => handleBackendSettingChange('auto_tag', !(settings?.auto_tag ?? true))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ml-4 ${
                  (settings?.auto_tag ?? true) ? 'bg-accent' : 'bg-gray-400 dark:bg-gray-600'
                } ${saving ? 'opacity-50 cursor-wait' : ''}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    (settings?.auto_tag ?? true) ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* GPU toggle */}
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <span className="text-sm font-medium text-content-primary">{t('settings.indexing.gpu')}</span>
                <p className="text-xs text-content-muted mt-0.5">{t('settings.indexing.gpuDesc')}</p>
              </div>
              <button
                role="switch"
                aria-checked={settings?.gpu_enabled ?? false}
                disabled={saving || !settings}
                onClick={() => handleBackendSettingChange('gpu_enabled', !(settings?.gpu_enabled ?? false))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ml-4 ${
                  (settings?.gpu_enabled ?? false) ? 'bg-accent' : 'bg-gray-400 dark:bg-gray-600'
                } ${saving ? 'opacity-50 cursor-wait' : ''}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    (settings?.gpu_enabled ?? false) ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Download Settings */}
        <section>
          <h2 className="text-sm font-semibold text-content-secondary uppercase tracking-wide mb-1 flex items-center gap-2">
            <Download className="w-4 h-4" />
            {t('settings.download.heading')}
          </h2>
          <p className="text-xs text-content-muted mb-4 ml-6">
            {t('settings.download.description')}
          </p>
          <div className="bg-surface-secondary rounded-2xl border border-edge-secondary divide-y divide-edge-subtle">
            <div className="px-5 py-4">
              <div>
                <span className="text-sm font-medium text-content-primary">{t('settings.download.namingFormat')}</span>
                <p className="text-xs text-content-muted mt-0.5 mb-3">{t('settings.download.namingFormatDesc')}</p>
              </div>
              <NamingFormatInput
                value={format}
                onChange={setFormat}
                onBlur={handleFormatBlur}
                placeholder={t('settings.download.namingFormatPlaceholder')}
              />
            </div>
          </div>
        </section>
      </main>

      {/* Delete model confirmation modal */}
      {deleteTarget && (
        <ConfirmModal
          title={t('settings.indexing.modelDeleteTitle')}
          message={t('settings.indexing.modelDeleteMessage', { name: deleteTarget.name })}
          confirmText={t('settings.indexing.modelDeleteConfirm')}
          cancelText={t('confirmModal.cancel')}
          onConfirm={handleModelDelete}
          onCancel={() => setDeleteTarget(null)}
          danger
        />
      )}

      {/* Reset default model confirmation modal */}
      {confirmResetDefault && (
        <ConfirmModal
          title={t('settings.indexing.modelResetConfirmTitle')}
          message={t('settings.indexing.modelResetConfirmMessage')}
          confirmText={t('settings.indexing.modelResetConfirm')}
          cancelText={t('confirmModal.cancel')}
          onConfirm={handleDefaultModelReset}
          onCancel={() => setConfirmResetDefault(false)}
          danger
        />
      )}
    </div>
  );
}
