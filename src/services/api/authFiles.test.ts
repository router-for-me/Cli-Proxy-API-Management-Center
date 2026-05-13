import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    postForm: vi.fn(),
  },
}));

vi.mock('./client', () => ({
  apiClient: {
    postForm: mocks.postForm,
  },
}));

import { authFilesApi } from './authFiles';

beforeEach(() => {
  mocks.postForm.mockReset();
});

describe('authFilesApi save auth file upload contracts', () => {
  const getUploadedFile = () => {
    const formData = mocks.postForm.mock.calls[0]?.[1];
    expect(formData).toBeInstanceOf(FormData);
    const file = (formData as FormData).get('file');
    expect(file).toBeInstanceOf(File);
    return file as File;
  };

  it('saveText resolves when upload reports one uploaded file', async () => {
    // Arrange
    mocks.postForm.mockResolvedValue({
      status: 'ok',
      uploaded: 1,
      files: ['direct-auth.json'],
      failed: [],
    });

    // Act / Assert
    await expect(
      authFilesApi.saveText('direct-auth.json', '{"type":"codex","access_token":"token"}')
    ).resolves.toBeUndefined();
    expect(mocks.postForm).toHaveBeenCalledWith('/auth-files', expect.any(FormData));
    const file = getUploadedFile();
    expect(file.name).toBe('direct-auth.json');
    await expect(file.text()).resolves.toBe('{"type":"codex","access_token":"token"}');
  });

  it('saveJsonObject resolves when upload succeeds', async () => {
    // Arrange
    mocks.postForm.mockResolvedValue({
      status: 'ok',
      uploaded: 1,
      files: ['converted-auth.json'],
      failed: [],
    });

    // Act / Assert
    await expect(
      authFilesApi.saveJsonObject('converted-auth.json', {
        type: 'codex',
        access_token: 'token',
      })
    ).resolves.toBeUndefined();
    expect(mocks.postForm).toHaveBeenCalledWith('/auth-files', expect.any(FormData));
    const file = getUploadedFile();
    expect(file.name).toBe('converted-auth.json');
    await expect(file.text()).resolves.toBe('{"type":"codex","access_token":"token"}');
  });

  it('saveJsonObject throws Upload failed when backend reports zero uploaded files without explicit failures', async () => {
    // Arrange
    mocks.postForm.mockResolvedValue({
      status: 'ok',
      uploaded: 0,
      files: [],
      failed: [],
    });

    // Act / Assert
    await expect(
      authFilesApi.saveJsonObject('failed-converted-auth.json', {
        type: 'codex',
        access_token: 'token',
      })
    ).rejects.toThrow('Upload failed');
  });

  it('saveText throws Upload failed when backend reports zero uploaded files without explicit failures', async () => {
    // Arrange
    mocks.postForm.mockResolvedValue({
      status: 'ok',
      uploaded: 0,
      files: [],
      failed: [],
    });

    // Act / Assert
    await expect(authFilesApi.saveText('failed-auth.json', '{"type":"codex"}')).rejects.toThrow(
      'Upload failed'
    );
  });

  it('saveJsonObject surfaces backend failure error text', async () => {
    // Arrange
    mocks.postForm.mockResolvedValue({
      status: 'partial',
      uploaded: 0,
      files: [],
      failed: [{ name: 'converted-auth.json', error: 'Storage quota exceeded' }],
    });

    // Act / Assert
    await expect(
      authFilesApi.saveJsonObject('converted-auth.json', {
        type: 'codex',
        access_token: 'token',
      })
    ).rejects.toThrow('Storage quota exceeded');
  });

  it('saveJsonObject throws when backend reports partial failure despite uploaded files', async () => {
    // Arrange
    mocks.postForm.mockResolvedValue({
      status: 'partial',
      uploaded: 1,
      files: ['converted-auth.json'],
      failed: [{ name: 'secondary-auth.json', error: 'Invalid auth payload' }],
    });

    // Act / Assert
    await expect(
      authFilesApi.saveJsonObject('converted-auth.json', {
        type: 'codex',
        access_token: 'token',
      })
      ).rejects.toThrow('Invalid auth payload');
  });

  it('saveJsonObject throws when backend reports explicit error status without upload counters', async () => {
    // Arrange
    mocks.postForm.mockResolvedValue({
      status: 'error',
      files: [],
      failed: [],
    });

    // Act / Assert
    await expect(
      authFilesApi.saveJsonObject('failed-status-auth.json', {
        type: 'codex',
        access_token: 'token',
      })
    ).rejects.toThrow('Upload failed');
  });
});
