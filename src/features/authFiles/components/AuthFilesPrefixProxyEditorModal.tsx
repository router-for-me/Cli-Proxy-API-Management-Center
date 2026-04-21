import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type {
  PrefixProxyEditorField,
  PrefixProxyEditorFieldValue,
  PrefixProxyEditorRefreshState,
  PrefixProxyEditorState,
} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import {
  extractAuthFileAccessToken,
  isPrefixProxyRefreshCallbackSupported,
} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import styles from '@/pages/AuthFilesPage.module.scss';

export type AuthFilesPrefixProxyEditorModalProps = {
  disableControls: boolean;
  editor: PrefixProxyEditorState | null;
  updatedText: string;
  dirty: boolean;
  onClose: () => void;
  onCopyText: (text: string) => void | Promise<void>;
  onSave: () => void;
  onChange: (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => void;
  onRefreshToken: () => void | Promise<void>;
  onRefreshCallbackUrlChange: (value: string) => void;
  onRefreshCallbackSubmit: () => void | Promise<void>;
};

export function AuthFilesPrefixProxyEditorModal(props: AuthFilesPrefixProxyEditorModalProps) {
  const { t } = useTranslation();
  const {
    disableControls,
    editor,
    updatedText,
    dirty,
    onClose,
    onCopyText,
    onSave,
    onChange,
    onRefreshToken,
    onRefreshCallbackUrlChange,
    onRefreshCallbackSubmit,
  } = props;
  const formatJsonText = (text: string) => {
    if (!text) return '';
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  };
  const previewText = formatJsonText(updatedText);
  const accessToken = extractAuthFileAccessToken(editor?.json ?? null);
  const buildAuthLoginKey = (refresh: PrefixProxyEditorRefreshState, suffix: string) =>
    `auth_login.${refresh.providerI18nPrefix}_${suffix}`;
  const refresh = editor?.refresh ?? null;
  const callbackSupported = refresh ? isPrefixProxyRefreshCallbackSupported(refresh) : false;
  const refreshStatusText = (() => {
    if (!refresh || !refresh.providerI18nPrefix) return '';
    if (refresh.status === 'starting') {
      return t('auth_files.refresh_token_starting');
    }
    if (refresh.status === 'waiting') {
      return t(buildAuthLoginKey(refresh, 'oauth_status_waiting'));
    }
    if (refresh.status === 'success') {
      return t(buildAuthLoginKey(refresh, 'oauth_status_success'));
    }
    if (refresh.status === 'error') {
      return [t(buildAuthLoginKey(refresh, 'oauth_status_error')), refresh.error]
        .filter(Boolean)
        .join(' ');
    }
    return '';
  })();
  const refreshStatusClass =
    refresh?.status === 'error'
      ? styles.prefixProxyRefreshStatusError
      : refresh?.status === 'success'
        ? styles.prefixProxyRefreshStatusSuccess
        : refresh?.status === 'waiting' || refresh?.status === 'starting'
          ? styles.prefixProxyRefreshStatusWaiting
          : '';
  const openAuthUrl = (url: string) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Modal
      open={Boolean(editor)}
      onClose={onClose}
      closeDisabled={editor?.saving === true}
      className={styles.prefixProxyModal}
      width={720}
      title={
        editor?.fileName
          ? t('auth_files.auth_field_editor_title', { name: editor.fileName })
          : t('auth_files.prefix_proxy_button')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={editor?.saving === true}>
            {dirty ? t('common.cancel') : t('common.close')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (!updatedText) return;
              void onCopyText(updatedText);
            }}
            disabled={editor?.saving === true || !updatedText}
          >
            {t('common.copy')}
          </Button>
          <Button
            onClick={onSave}
            loading={editor?.saving === true}
            disabled={
              disableControls ||
              editor?.saving === true ||
              !dirty ||
              !editor?.json ||
              Boolean(editor?.headersTouched && editor.headersError)
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {editor && (
        <div className={styles.prefixProxyEditor}>
          {editor.loading ? (
            <div className={styles.prefixProxyLoading}>
              <LoadingSpinner size={14} />
              <span>{t('auth_files.prefix_proxy_loading')}</span>
            </div>
          ) : (
            <>
              {editor.error && <div className={styles.prefixProxyError}>{editor.error}</div>}
              {accessToken && (
                <div className={styles.prefixProxyTokenPanel}>
                  <div className={styles.prefixProxyTokenHeader}>
                    <div className={styles.prefixProxyTokenMeta}>
                      <label className={styles.prefixProxyLabel}>
                        {t('auth_files.access_token_label')}
                      </label>
                      <div className={styles.prefixProxyTokenHint}>
                        {t('auth_files.access_token_hint')}
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void onCopyText(accessToken)}
                      disabled={editor.saving === true}
                    >
                      {t('auth_files.access_token_copy')}
                    </Button>
                  </div>
                </div>
              )}
              {refresh?.supported && (
                <div className={styles.prefixProxyRefreshPanel}>
                  <div className={styles.prefixProxyTokenHeader}>
                    <div className={styles.prefixProxyTokenMeta}>
                      <label className={styles.prefixProxyLabel}>
                        {t('auth_files.refresh_token_label')}
                      </label>
                      <div className={styles.prefixProxyTokenHint}>
                        {t('auth_files.refresh_token_hint')}
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void onRefreshToken()}
                      loading={refresh.status === 'starting'}
                      disabled={
                        disableControls ||
                        editor.saving ||
                        editor.loading ||
                        refresh.callbackSubmitting ||
                        refresh.status === 'waiting'
                      }
                    >
                      {t('auth_files.refresh_token_button')}
                    </Button>
                  </div>
                  {refreshStatusText && (
                    <div
                      className={`${styles.prefixProxyRefreshStatus} ${refreshStatusClass}`.trim()}
                    >
                      {refreshStatusText}
                    </div>
                  )}
                  {refresh.url && refresh.providerI18nPrefix && (
                    <div className={styles.prefixProxyAuthUrlBox}>
                      <div className={styles.prefixProxyAuthUrlLabel}>
                        {t(buildAuthLoginKey(refresh, 'oauth_url_label'))}
                      </div>
                      <div className={styles.prefixProxyAuthUrlValue}>{refresh.url}</div>
                      <div className={styles.prefixProxyAuthUrlActions}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openAuthUrl(refresh.url)}
                          disabled={editor.saving}
                        >
                          {t(buildAuthLoginKey(refresh, 'open_link'))}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void onCopyText(refresh.url)}
                          disabled={editor.saving}
                        >
                          {t(buildAuthLoginKey(refresh, 'copy_link'))}
                        </Button>
                      </div>
                    </div>
                  )}
                  {callbackSupported && Boolean(refresh.url) && (
                    <div className={styles.prefixProxyCallbackSection}>
                      <Input
                        label={t('auth_login.oauth_callback_label')}
                        hint={t('auth_login.oauth_callback_hint')}
                        value={refresh.callbackUrl}
                        placeholder={t('auth_login.oauth_callback_placeholder')}
                        disabled={disableControls || editor.saving || refresh.callbackSubmitting}
                        onChange={(event) => onRefreshCallbackUrlChange(event.target.value)}
                      />
                      <div className={styles.prefixProxyCallbackActions}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void onRefreshCallbackSubmit()}
                          loading={refresh.callbackSubmitting}
                          disabled={disableControls || editor.saving}
                        >
                          {t('auth_login.oauth_callback_button')}
                        </Button>
                      </div>
                      {refresh.callbackStatus === 'success' && refresh.status === 'waiting' && (
                        <div
                          className={`${styles.prefixProxyRefreshStatus} ${styles.prefixProxyRefreshStatusSuccess}`}
                        >
                          {t('auth_login.oauth_callback_status_success')}
                        </div>
                      )}
                      {refresh.callbackStatus === 'error' && (
                        <div
                          className={`${styles.prefixProxyRefreshStatus} ${styles.prefixProxyRefreshStatusError}`}
                        >
                          {[t('auth_login.oauth_callback_status_error'), refresh.callbackError]
                            .filter(Boolean)
                            .join(' ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className={styles.prefixProxyJsonWrapper}>
                <label className={styles.prefixProxyLabel}>
                  {t('auth_files.prefix_proxy_info_label')}
                </label>
                <textarea
                  className={styles.prefixProxyTextarea}
                  rows={8}
                  readOnly
                  value={editor.fileInfoText}
                />
              </div>
              <div className={styles.prefixProxyJsonWrapper}>
                <label className={styles.prefixProxyLabel}>
                  {t('auth_files.prefix_proxy_source_label')}
                </label>
                <textarea
                  className={styles.prefixProxyTextarea}
                  rows={10}
                  readOnly
                  value={previewText}
                />
              </div>
              <div className={styles.prefixProxyFields}>
                <Input
                  label={t('auth_files.prefix_label')}
                  value={editor.prefix}
                  disabled={disableControls || editor.saving || !editor.json}
                  onChange={(e) => onChange('prefix', e.target.value)}
                />
                <Input
                  label={t('auth_files.proxy_url_label')}
                  value={editor.proxyUrl}
                  placeholder={t('auth_files.proxy_url_placeholder')}
                  disabled={disableControls || editor.saving || !editor.json}
                  onChange={(e) => onChange('proxyUrl', e.target.value)}
                />
                <Input
                  label={t('auth_files.priority_label')}
                  value={editor.priority}
                  placeholder={t('auth_files.priority_placeholder')}
                  hint={t('auth_files.priority_hint')}
                  disabled={disableControls || editor.saving || !editor.json}
                  onChange={(e) => onChange('priority', e.target.value)}
                />
                <div className="form-group">
                  <label>{t('auth_files.excluded_models_label')}</label>
                  <textarea
                    className="input"
                    value={editor.excludedModelsText}
                    placeholder={t('auth_files.excluded_models_placeholder')}
                    rows={4}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('excludedModelsText', e.target.value)}
                  />
                  <div className="hint">{t('auth_files.excluded_models_hint')}</div>
                </div>
                <div className="form-group">
                  <label>{t('auth_files.headers_label')}</label>
                  <textarea
                    className={`input ${editor.headersError ? styles.prefixProxyTextareaInvalid : ''}`}
                    value={editor.headersText}
                    placeholder={t('auth_files.headers_placeholder')}
                    rows={4}
                    aria-invalid={Boolean(editor.headersError)}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('headersText', e.target.value)}
                  />
                  {editor.headersError && <div className="error-box">{editor.headersError}</div>}
                  <div className="hint">{t('auth_files.headers_hint')}</div>
                </div>
                <Input
                  label={t('auth_files.disable_cooling_label')}
                  value={editor.disableCooling}
                  placeholder={t('auth_files.disable_cooling_placeholder')}
                  hint={t('auth_files.disable_cooling_hint')}
                  disabled={disableControls || editor.saving || !editor.json}
                  onChange={(e) => onChange('disableCooling', e.target.value)}
                />
                {editor.isCodexFile && (
                  <Input
                    label={t('auth_files.user_agent_label')}
                    value={editor.userAgent}
                    placeholder={t('auth_files.user_agent_placeholder')}
                    hint={t('auth_files.user_agent_hint')}
                    disabled={disableControls || editor.saving || !editor.json}
                    onChange={(e) => onChange('userAgent', e.target.value)}
                  />
                )}
                <Input
                  label={t('auth_files.note_label')}
                  value={editor.note}
                  placeholder={t('auth_files.note_placeholder')}
                  hint={t('auth_files.note_hint')}
                  disabled={disableControls || editor.saving || !editor.json}
                  onChange={(e) => onChange('note', e.target.value)}
                />
                {editor.isCodexFile && (
                  <div className="form-group">
                    <label>{t('ai_providers.codex_websockets_label')}</label>
                    <ToggleSwitch
                      checked={Boolean(editor.websockets)}
                      disabled={disableControls || editor.saving || !editor.json}
                      ariaLabel={t('ai_providers.codex_websockets_label')}
                      onChange={(value) => onChange('websockets', value)}
                    />
                    <div className="hint">{t('ai_providers.codex_websockets_hint')}</div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
