import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import styles from '../../../ConfigPage.module.scss';
import { makeClientId } from '../types';
import type { VisualSectionProps } from './sectionTypes';

export function OauthModelMappingsSection({ t, values, setValues, disabled }: VisualSectionProps) {
  return (
    <div className={styles.visualSectionWide}>
      <div className={styles.sectionTitle}>
        {t('config_management.visual_group.oauth_model_mappings', {
          defaultValue: 'Global OAuth model mappings',
        })}
      </div>
      <div className={styles.oauthChannels}>
        {(values.oauthModelMappings || []).map((channel, channelIndex) => (
          <div key={channel.id} className={styles.oauthChannelCard}>
            <div className={styles.oauthChannelHeader}>
              <input
                className="input"
                value={channel.channel}
                placeholder={t('config_management.field.oauth_channel.placeholder', {
                  defaultValue: 'channel',
                })}
                disabled={disabled}
                onChange={(e) => {
                  const value = e.target.value;
                  setValues((prev) => ({
                    ...prev,
                    oauthModelMappings: (prev.oauthModelMappings || []).map((ch, i) =>
                      i === channelIndex
                        ? {
                            ...ch,
                            originalChannel: ch.originalChannel.trim() || ch.channel.trim() || value.trim(),
                            channel: value,
                          }
                        : ch
                    ),
                  }));
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setValues((prev) => ({
                    ...prev,
                    oauthModelMappings: (prev.oauthModelMappings || []).filter((_, i) => i !== channelIndex),
                  }))
                }
                disabled={disabled}
              >
                {t('config_management.action.remove_channel', {
                  defaultValue: 'Remove channel',
                })}
              </Button>
            </div>

            <div className={styles.mappingList}>
              {(channel.entries || []).map((entry, entryIndex) => (
                <div key={entry.id} className={styles.oauthMappingRow}>
                  <input
                    className="input"
                    placeholder={t('config_management.field.oauth_mapping_name.placeholder', {
                      defaultValue: 'name',
                    })}
                    value={entry.name}
                    disabled={disabled}
                    onChange={(e) => {
                      const value = e.target.value;
                      setValues((prev) => ({
                        ...prev,
                        oauthModelMappings: (prev.oauthModelMappings || []).map((ch, i) => {
                          if (i !== channelIndex) return ch;
                          const entries = ch.entries || [];
                          return {
                            ...ch,
                            entries: entries.map((en, j) => (j === entryIndex ? { ...en, name: value } : en)),
                          };
                        }),
                      }));
                    }}
                  />
                  <span className={styles.mappingArrow}>→</span>
                  <input
                    className="input"
                    placeholder={t('config_management.field.oauth_mapping_alias.placeholder', {
                      defaultValue: 'alias',
                    })}
                    value={entry.alias}
                    disabled={disabled}
                    onChange={(e) => {
                      const value = e.target.value;
                      setValues((prev) => ({
                        ...prev,
                        oauthModelMappings: (prev.oauthModelMappings || []).map((ch, i) => {
                          if (i !== channelIndex) return ch;
                          const entries = ch.entries || [];
                          return {
                            ...ch,
                            entries: entries.map((en, j) => (j === entryIndex ? { ...en, alias: value } : en)),
                          };
                        }),
                      }));
                    }}
                  />
                  <ToggleSwitch
                    size="sm"
                    label={t('config_management.field.oauth_mapping_fork.label', {
                      defaultValue: 'fork',
                    })}
                    checked={entry.fork}
                    disabled={disabled}
                    onChange={(value) => {
                      setValues((prev) => ({
                        ...prev,
                        oauthModelMappings: (prev.oauthModelMappings || []).map((ch, i) => {
                          if (i !== channelIndex) return ch;
                          const entries = ch.entries || [];
                          return {
                            ...ch,
                            entries: entries.map((en, j) => (j === entryIndex ? { ...en, fork: value } : en)),
                          };
                        }),
                      }));
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setValues((prev) => ({
                        ...prev,
                        oauthModelMappings: (prev.oauthModelMappings || []).map((ch, i) => {
                          if (i !== channelIndex) return ch;
                          const entries = ch.entries || [];
                          const nextEntries = entries.filter((_, j) => j !== entryIndex);
                          return {
                            ...ch,
                            entries: nextEntries,
                          };
                        }),
                      }))
                    }
                    disabled={disabled}
                  >
                    {t('config_management.action.remove', { defaultValue: 'Remove' })}
                  </Button>
                </div>
              ))}
            </div>

            <div className={styles.mappingActions}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setValues((prev) => ({
                    ...prev,
                    oauthModelMappings: (prev.oauthModelMappings || []).map((ch, i) => {
                      if (i !== channelIndex) return ch;
                      return {
                        ...ch,
                        entries: [...(ch.entries || []), { id: makeClientId(), name: '', alias: '', fork: false }],
                      };
                    }),
                  }))
                }
                disabled={disabled}
              >
                {t('config_management.action.add_mapping', {
                  defaultValue: 'Add mapping',
                })}
              </Button>
            </div>
          </div>
        ))}

        <div className={styles.mappingActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setValues((prev) => ({
                ...prev,
                oauthModelMappings: [
                  ...(prev.oauthModelMappings || []),
                  {
                    id: makeClientId(),
                    channel: '',
                    originalChannel: '',
                    entries: [{ id: makeClientId(), name: '', alias: '', fork: false }],
                  },
                ],
              }))
            }
            disabled={disabled}
          >
            {t('config_management.action.add_channel', { defaultValue: 'Add channel' })}
          </Button>
        </div>
      </div>
      <div className="hint">
        {t('config_management.field.oauth_mappings_help.help', { defaultValue: '' })}
      </div>
    </div>
  );
}
