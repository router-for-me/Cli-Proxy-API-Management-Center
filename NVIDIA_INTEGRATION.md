# NVIDIA Provider Frontend Integration Guide

## ✅ Backend Integration Complete

The backend already supports NVIDIA management API:
- ✅ GET `/v0/management/nvidia-api-key`
- ✅ PUT `/v0/management/nvidia-api-key`
- ✅ PATCH `/v0/management/nvidia-api-key`
- ✅ DELETE `/v0/management/nvidia-api-key`

## ✅ API Layer Complete (src/services/api/)

### 1. providers.ts
```typescript
// Added NVIDIA API methods:
async getNvidiaConfigs(): Promise<ProviderKeyConfig[]>
saveNvidiaConfigs: async (configs: ProviderKeyConfig[])
deleteNvidiaConfig: (apiKey: string, baseUrl?: string)
```

### 2. transformers.ts
```typescript
// Added NVIDIA config parsing:
const nvidiaList = raw['nvidia-api-key'];
if (Array.isArray(nvidiaList)) {
  config.nvidiaApiKeys = nvidiaList
    .map((item) => normalizeProviderKeyConfig(item))
    .filter(Boolean) as ProviderKeyConfig[];
}
```

### 3. types/config.ts
```typescript
// Added to Config interface:
nvidiaApiKeys?: ProviderKeyConfig[];

// Added to RawConfigSection type:
| 'nvidia-api-key'
```

## 🔲 TODO: Frontend UI Integration

### Required Changes

#### 1. Add NVIDIA Section to ConfigPage

Location: `src/pages/ConfigPage.tsx`

Need to add a new provider section similar to Gemini/Claude/Codex.

#### 2. Add NVIDIA Section to VisualConfigEditor

Location: `src/components/config/VisualConfigEditor.tsx`

This is a large file (~1800 lines). Need to:
- Add `nvidiaApiKeys` to VisualConfigValues
- Add NVIDIA provider section with ProviderKeysEditor
- Add field anchors for search support

#### 3. Update Visual Config Types

Location: `src/types/visualConfig.ts`

Add `nvidiaApiKeys?: ProviderKeyConfig[]` to visual config types.

#### 4. Update Search Index

Location: `src/components/config/configSearchIndex.ts`

Add NVIDIA fields to the search index.

#### 5. Add Translations

Add NVIDIA-related translations to i18n files.

#### 6. Add NVIDIA Icon

Use NVIDIA icon from: `https://lobehub.com/icons/nvidia`

## 🎯 Quick Test via API

You can test NVIDIA management without UI:

```bash
# Get current NVIDIA configs
curl -H "X-Management-Key: your-password" \
  http://localhost:8317/v0/management/nvidia-api-key

# Update NVIDIA configs
curl -X PUT \
  -H "X-Management-Key: your-password" \
  -H "Content-Type: application/json" \
  -d '[{"api-key":"nvapi-xxx","base-url":"https://integrate.api.nvidia.com/v1"}]' \
  http://localhost:8317/v0/management/nvidia-api-key
```

## 📝 Recommended Approach

Since the visual config editor is very complex, consider these options:

### Option A: Use config.yaml directly
Edit `config.yaml` and let the backend handle NVIDIA configuration.

### Option B: Add minimal API UI
Create a simple dedicated NVIDIA management page instead of integrating into the visual editor.

### Option C: Full integration (most work)
Follow the pattern of existing providers (Gemini/Claude/Codex) and add all UI components.

## 🔗 Files Modified

Backend (CLIProxyAPI):
- ✅ internal/api/handlers/management/config_lists.go
- ✅ internal/api/handlers/management/config_auth_index.go
- ✅ internal/api/server.go
- ✅ internal/config/config.go

Frontend (Management Center):
- ✅ src/services/api/providers.ts
- ✅ src/services/api/transformers.ts
- ✅ src/types/config.ts
- ⏳ src/components/config/VisualConfigEditor.tsx
- ⏳ src/pages/ConfigPage.tsx
- ⏳ src/types/visualConfig.ts
- ⏳ src/components/config/configSearchIndex.ts
- ⏳ i18n translation files

## 🚀 Next Steps

1. Build and test the management center with current changes
2. Verify API endpoints work correctly
3. Add UI components following existing provider patterns
4. Test end-to-end NVIDIA configuration flow
