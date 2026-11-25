import { expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useVertexImport } from '../src/features/oauth/hooks/useVertexImport';
import { vertexApi } from '../src/services/api/vertex';

test('rejecting B.txt clears A.json and prevents importing it', async () => {
  const upload = spyOn(vertexApi, 'importCredential').mockResolvedValue({ status: 'ok' });
  const json = new File(['{}'], 'A.json');
  const txt = new File([''], 'B.txt');
  let hook!: ReturnType<typeof useVertexImport>;
  let step = 0;
  function Harness() {
    hook = useVertexImport({ isFocused: () => true, onCredentialAdded: () => {} });
    if (step++ === 0) {
      hook.setLocation('us-central1');
      hook.pickFile(json);
    } else if (step === 2) {
      expect(hook.vertex.file).toBe(json);
      hook.pickFile(txt);
    }
    return null;
  }
  try {
    renderToStaticMarkup(createElement(Harness));
    expect(hook.vertex.error).toBeTruthy();
    expect(hook.vertex.file).toBeUndefined();
    expect(hook.vertex.location).toBe('us-central1');
    await hook.importCredential();
    expect(upload).not.toHaveBeenCalled();
  } finally {
    upload.mockRestore();
  }
});
