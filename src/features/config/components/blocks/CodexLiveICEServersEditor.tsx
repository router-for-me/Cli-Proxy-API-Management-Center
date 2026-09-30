import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { makeClientId, type CodexLiveICEServerDraft } from '@/types/visualConfig';
import { FieldGrid, FieldGroup, FieldShell, FieldStack } from '../fields/FieldPrimitives';

export function CodexLiveICEServersEditor({
  value,
  disabled,
  error,
  onChange,
}: {
  value: CodexLiveICEServerDraft[];
  disabled?: boolean;
  error?: string;
  onChange: (next: CodexLiveICEServerDraft[]) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hintId, error ? errorId : undefined].filter(Boolean).join(' ');
  const updateServer = (serverId: string, patch: Partial<CodexLiveICEServerDraft>) =>
    onChange(value.map((server) => (server.id === serverId ? { ...server, ...patch } : server)));

  return (
    <FieldStack>
      <FieldShell
        label={t('config_management.visual.additions.codexLiveMediaRelayICEServers.label')}
        labelId={`${id}-label`}
        hint={t('config_management.visual.additions.codexLiveMediaRelayICEServers.hint')}
        hintId={hintId}
        error={error}
        errorId={errorId}
      >
        <div role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy}>
          <FieldStack>
            {value.map((server, index) => {
              const serverLabel = t('config_management.visual.additions.iceServer', {
                index: index + 1,
              });
              const urlsId = `${id}-${server.id}-urls`;
              return (
                <div key={server.id} role="group" aria-label={serverLabel}>
                  <FieldGroup title={serverLabel}>
                    <FieldStack>
                      <FieldShell
                        label={t('config_management.visual.additions.iceURLs')}
                        htmlFor={urlsId}
                      >
                        <textarea
                          id={urlsId}
                          className="input"
                          rows={3}
                          value={server.urlsText}
                          disabled={disabled}
                          spellCheck={false}
                          aria-invalid={Boolean(error)}
                          aria-describedby={describedBy}
                          onChange={(event) =>
                            updateServer(server.id, { urlsText: event.target.value })
                          }
                        />
                      </FieldShell>
                      <FieldGrid>
                        <Input
                          label={t('config_management.visual.additions.iceUsername')}
                          value={server.username}
                          disabled={disabled}
                          autoComplete="off"
                          spellCheck={false}
                          aria-describedby={describedBy}
                          onChange={(event) =>
                            updateServer(server.id, { username: event.target.value })
                          }
                        />
                        <Input
                          label={t('config_management.visual.additions.iceCredential')}
                          type="password"
                          value={server.credential}
                          disabled={disabled}
                          autoComplete="new-password"
                          aria-describedby={describedBy}
                          onChange={(event) =>
                            updateServer(server.id, { credential: event.target.value })
                          }
                        />
                      </FieldGrid>
                      <div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={disabled}
                          aria-label={t('config_management.visual.additions.iceRemove', {
                            index: index + 1,
                          })}
                          onClick={() => onChange(value.filter((item) => item.id !== server.id))}
                        >
                          {t('config_management.visual.additions.iceRemove', { index: index + 1 })}
                        </Button>
                      </div>
                    </FieldStack>
                  </FieldGroup>
                </div>
              );
            })}
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  onChange([
                    ...value,
                    { id: makeClientId(), urlsText: '', username: '', credential: '' },
                  ])
                }
              >
                {t('config_management.visual.additions.iceAdd')}
              </Button>
            </div>
          </FieldStack>
        </div>
      </FieldShell>
    </FieldStack>
  );
}
