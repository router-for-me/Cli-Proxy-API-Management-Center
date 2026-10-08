import { describe, expect, test } from 'bun:test';
import { parseApiErrorResponse } from '../src/services/api/apiError';

describe('Management API error parsing', () => {
  test('prefers the human-readable message and preserves the API error code', () => {
    const result = parseApiErrorResponse(
      {
        error: 'plugin_install_failed',
        message: 'download plugin archive: 404 Not Found',
      },
      'Request failed with status code 502'
    );

    expect(result).toEqual({
      message: 'download plugin archive: 404 Not Found',
      apiCode: 'plugin_install_failed',
    });
  });

  test('falls back to a string error used by legacy endpoints', () => {
    expect(parseApiErrorResponse({ error: 'invalid body' }, 'Bad Request')).toEqual({
      message: 'invalid body',
      apiCode: 'invalid body',
    });
  });

  test('supports nested error messages and codes', () => {
    expect(
      parseApiErrorResponse(
        { error: { code: 'invalid_config', message: 'plugins-dir is invalid' } },
        'Bad Request'
      )
    ).toEqual({
      message: 'plugins-dir is invalid',
      apiCode: 'invalid_config',
    });
  });

  test('uses a text response body before the transport fallback', () => {
    expect(parseApiErrorResponse('upstream unavailable', 'Network Error')).toEqual({
      message: 'upstream unavailable',
    });
  });

  test('summarizes a reverse proxy HTML error page instead of returning its markup', () => {
    const nginx =
      '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n' +
      '<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx/1.24.0</center>\r\n' +
      '</body>\r\n</html>\r\n<!-- a padding to disable MSIE and Chrome friendly error page -->\r\n';
    expect(parseApiErrorResponse(nginx, 'Request failed with status code 502')).toEqual({
      message: '502 Bad Gateway',
    });
    expect(
      parseApiErrorResponse(
        '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">\n' +
          '<title>\n  example.test | 504:\n  Gateway time-out\n</title></head><body></body></html>',
        'Request failed with status code 504'
      )
    ).toEqual({ message: 'example.test | 504: Gateway time-out' });
    expect(
      parseApiErrorResponse(
        '<html><body><center><h1>413 Request <b>Entity</b> Too Large</h1></center></body></html>',
        'Request failed with status code 413'
      )
    ).toEqual({ message: '413 Request Entity Too Large' });
  });

  test('falls back to the transport message for an HTML page without a title', () => {
    expect(
      parseApiErrorResponse(
        '<html><body><p>down</p></body></html>',
        'Request failed with status code 503'
      )
    ).toEqual({ message: 'Request failed with status code 503' });
  });

  test('keeps text bodies that only start with an angle bracket', () => {
    expect(parseApiErrorResponse('<nil>', 'Bad Request')).toEqual({ message: '<nil>' });
  });

  test('uses the transport message for an unknown response shape', () => {
    expect(parseApiErrorResponse({ error: null }, 'Network Error')).toEqual({
      message: 'Network Error',
      apiCode: undefined,
    });
  });
});
