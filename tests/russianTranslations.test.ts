import { expect, test } from 'bun:test';
import { createInstance } from 'i18next';
import ru from '../src/i18n/locales/ru.json';
import zhCN from '../src/i18n/locales/zh-CN.json';

test('Russian quota reset messages resolve locally and interpolate the account and failure', async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'ru',
    fallbackLng: 'zh-CN',
    resources: { ru: { translation: ru }, 'zh-CN': { translation: zhCN } },
    interpolation: { escapeValue: false },
  });
  const messages = {
    reset_button: 'Сбросить квоту',
    reset_confirm_title: 'Сброс квоты Codex',
    reset_confirm_message:
      'Для сброса квоты Codex для «account.json» будет использован 1 ручной сброс. Продолжить?',
    reset_confirm_button: 'Сбросить квоту',
    reset_success: 'Квота Codex для «account.json» сброшена',
    reset_failed: 'Не удалось сбросить квоту Codex для «account.json»: Нет доступных сбросов',
  };
  for (const [key, expected] of Object.entries(messages)) {
    expect(
      i18n.t(`codex_quota.${key}`, { name: 'account.json', message: 'Нет доступных сбросов' })
    ).toBe(expected);
  }
});

test('Russian auth-file headers have local labels, JSON help and validation errors', async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'ru',
    fallbackLng: 'zh-CN',
    resources: { ru: { translation: ru }, 'zh-CN': { translation: zhCN } },
    interpolation: { escapeValue: false },
  });
  const messages = {
    headers_label: 'Пользовательские заголовки (headers)',
    headers_placeholder: '{\n  "Header-Name": "value"\n}',
    headers_hint:
      'Введите пользовательские HTTP-заголовки в виде JSON-объекта, например: {"X-My-Header": "value"}',
    headers_invalid_json: 'Заголовки должны быть записаны в корректном формате JSON.',
    headers_invalid_object: 'Заголовки должны быть JSON-объектом.',
    headers_invalid_value: 'Значение каждого заголовка должно быть строкой.',
  };
  for (const [key, expected] of Object.entries(messages)) {
    expect(i18n.t(`auth_files.${key}`)).toBe(expected);
    expect(i18n.getResource('ru', 'translation', `auth_files.${key}`)).toBe(expected);
  }
});
